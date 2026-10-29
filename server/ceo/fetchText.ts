/**
 * CEO 모듈 전용 원문 요청기: 허용된 공식 호스트만, https만(테스트에서만 루프백 http 허용),
 * 리다이렉트는 직접 따라가며 매 단계 호스트를 다시 확인(SSRF 방지).
 * 상한:
 * - 크기: 응답 본문을 스트림으로 읽으며 **바이트** 누적이 maxBytes를 넘는 즉시 읽기 취소·요청 중단(content-length가 없거나 속여도 동일).
 *   content-length가 상한보다 크다고 선언되면 본문을 읽지 않고 거부.
 * - 시간: 요청 1건 기한(timeoutMs, 리다이렉트 전체·본문 수신 포함) + 호출자가 준 전체 기한(deadline, epoch ms) 중 이른 쪽.
 *   본문이 느리게 와도 기한에 걸리면 중단.
 * - 리다이렉트: 최대 maxRedirects회.
 * - 정리(cleanup): 중단 신호를 먼저 보내고, 본문·읽기 취소(cancel)는 기다리지 않습니다(끝나지 않거나 실패하는 cancel이 기한을 막지 않도록).
 * - 재시도 없음(요청 1회). headers: 이 요청기 전용 추가 헤더(SEC 전용 정직한 User-Agent 등 — 다른 출처 요청기에는 넣지 않음).
 * createFetchBytes: 같은 규칙으로 받은 원본 바이트(해시 고정 출처용). createFetchText는 이를 UTF-8(비엄격)로 디코딩 — 기존 동작 그대로.
 */
export interface FetchTextOptions {
  allowHosts: string[];
  allowHttpLoopback?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  now?: () => number;
  headers?: Record<string, string>;
}

export class SourceFetchError extends Error {
  constructor(message: string, readonly httpStatus?: number) { super(message); this.name = 'SourceFetchError'; }
}

export type FetchText = (url: string, opts?: { deadline?: number }) => Promise<string>;
export type FetchBytes = (url: string, opts?: { deadline?: number }) => Promise<Uint8Array>;

/** 취소를 시작만 하고 기다리지 않음. 동기 throw·거부·영원히 대기 모두 무시 */
function discard(cancel: () => Promise<unknown> | undefined): void {
  try { const p = cancel(); if (p) p.catch(() => undefined); } catch { /* 이미 잠김·종료 */ }
}

export function createFetchText(opts: FetchTextOptions): FetchText {
  const get = createFetchBytes(opts);
  return async (url, callOpts = {}) => new TextDecoder('utf-8').decode(await get(url, callOpts));
}

export function createFetchBytes(opts: FetchTextOptions): FetchBytes {
  const f = opts.fetchImpl || fetch;
  const now = opts.now || Date.now;
  const maxBytes = opts.maxBytes ?? 3_000_000;
  const allowed = new Set(opts.allowHosts.map(h => h.toLowerCase()));
  const check = (u: URL) => {
    const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
    if (u.protocol === 'https:' && allowed.has(u.hostname.toLowerCase())) return;
    if (opts.allowHttpLoopback && loopback && u.protocol === 'http:' && allowed.has(u.hostname.toLowerCase())) return;
    throw new SourceFetchError(`host not allowed: ${u.protocol}//${u.hostname}`);
  };

  return async (url, callOpts = {}) => {
    const limitAt = Math.min(now() + (opts.timeoutMs ?? 10_000), callOpts.deadline ?? Number.POSITIVE_INFINITY);
    if (limitAt <= now()) throw new SourceFetchError('request deadline exceeded');
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(new SourceFetchError('request deadline exceeded')); }, Math.max(0, limitAt - now()));
    // fetch 구현이 신호를 무시해도 읽기를 멈추도록 중단 신호를 약속으로도 만듦
    const aborted = new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new SourceFetchError('request deadline exceeded')), { once: true }));
    aborted.catch(() => undefined);
    const guard = <T,>(p: Promise<T>) => Promise.race([p, aborted]);
    try {
      let current = new URL(url);
      for (let hop = 0; hop <= (opts.maxRedirects ?? 3); hop++) {
        check(current);
        const res = await guard(f(current.toString(), {
          redirect: 'manual',
          signal: ctrl.signal,
          headers: { Accept: 'application/rss+xml, application/xml, text/xml, text/html', ...(opts.headers || {}) },
        }));
        if (res.status >= 300 && res.status < 400) {
          discard(() => res.body?.cancel());
          const loc = res.headers.get('location');
          if (!loc) throw new SourceFetchError(`redirect without location (HTTP ${res.status})`, res.status);
          current = new URL(loc, current);
          continue;
        }
        if (!res.ok) { discard(() => res.body?.cancel()); throw new SourceFetchError(`HTTP ${res.status}`, res.status); }
        const declared = Number(res.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > maxBytes) {
          ctrl.abort(); discard(() => res.body?.cancel());
          throw new SourceFetchError(`response too large (declared ${declared} bytes > ${maxBytes})`);
        }
        if (!res.body) return new Uint8Array(0);
        const reader = res.body.getReader();
        const parts: Uint8Array[] = [];
        let total = 0;
        try {
          for (;;) {
            const { done, value } = await guard(reader.read());
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) throw new SourceFetchError(`response too large (> ${maxBytes} bytes)`);
            parts.push(value);
          }
        } catch (e) {
          ctrl.abort();
          discard(() => reader.cancel());
          throw e;
        }
        const buf = new Uint8Array(total); let at = 0;
        for (const p of parts) { buf.set(p, at); at += p.byteLength; }
        return buf;
      }
      throw new SourceFetchError('too many redirects');
    } catch (e: any) {
      if (e instanceof SourceFetchError) throw e;
      if (timedOut || e?.name === 'AbortError' || e?.name === 'TimeoutError') throw new SourceFetchError('request deadline exceeded');
      throw new SourceFetchError(`fetch failed: ${String(e?.message || e).slice(0, 120)}`);
    } finally {
      clearTimeout(timer);
    }
  };
}
