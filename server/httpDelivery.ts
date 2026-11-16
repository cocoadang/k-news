import express from 'express';
import fs from 'fs';
import path from 'path';
import { brotliCompressSync, gzipSync, constants } from 'zlib';
import { createHash } from 'node:crypto';

/** 브라우저가 지원하는 압축 방식(br 우선, 그다음 gzip) */
export function pickEncoding(acceptEncoding: string | undefined): 'br' | 'gzip' | null {
  const ok = new Set<string>();
  for (const part of String(acceptEncoding || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';').map(s => s.trim());
    const q = params.find(p => p.startsWith('q='));
    if (name && !(q && Number(q.slice(2)) === 0)) ok.add(name);
  }
  if (ok.has('br')) return 'br';
  if (ok.has('gzip')) return 'gzip';
  return null;
}

/**
 * JSON 응답 압축: 2KB 이상인 res.json 응답만 압축합니다(뉴스 목록 약 4MB → 수백 KB).
 * 추가 패키지 없이 Node 내장 zlib 사용, 빠른 압축 수준(br 4 / gzip 6).
 */
export function jsonCompression(minBytes = 2048): express.RequestHandler {
  return (req, res, next) => {
    const enc = pickEncoding(req.headers['accept-encoding'] as string | undefined);
    if (!enc) return next();
    const original = res.json.bind(res);
    res.json = ((body: unknown) => {
      const text = JSON.stringify(body);
      if (text === undefined || Buffer.byteLength(text) < minBytes || res.getHeader('Content-Encoding')) return original(body);
      const buf = enc === 'br'
        ? brotliCompressSync(text, { params: { [constants.BROTLI_PARAM_QUALITY]: 4, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } })
        : gzipSync(text, { level: 6 });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', enc);
      res.vary('Accept-Encoding');
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
      return res;
    }) as typeof res.json;
    next();
  };
}

const TYPES: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/**
 * 빌드 결과 정적 파일 제공:
 * - /assets/* 는 파일명에 해시가 있어 1년 캐시(immutable), 미리 압축한 .br/.gz가 있으면 그것을 보냄
 * - index.html 은 매번 새로 확인(no-cache) → 배포 직후 새 화면이 바로 보임
 */
export function serveBuiltApp(app: express.Express, distPath: string) {
  const assetsDir = path.join(distPath, 'assets');
  app.use('/assets', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const rel = decodeURIComponent(req.path);
    const file = path.join(assetsDir, rel);
    if (!file.startsWith(assetsDir + path.sep)) return next();
    const type = TYPES[path.extname(file)];
    const enc = type ? pickEncoding(req.headers['accept-encoding'] as string | undefined) : null;
    if (!enc) return next();
    const compressed = file + (enc === 'br' ? '.br' : '.gz');
    fs.stat(compressed, (err, st) => {
      if (err || !st.isFile()) return next();
      res.setHeader('Content-Type', type!);
      res.setHeader('Content-Encoding', enc);
      res.vary('Accept-Encoding');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Length', String(st.size));
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(compressed).on('error', () => next()).pipe(res);
    });
  });
  app.use('/assets', express.static(assetsDir, { immutable: true, maxAge: '365d', index: false }));
  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

export interface PackedJson { at: number; json: Buffer; br: Buffer; gz: Buffer; etag: string }

/** JSON을 한 번 직렬화하고 br·gzip 압축본까지 미리 만들어 둠 */
export function packJson(body: unknown, at = Date.now()): PackedJson {
  const json = Buffer.from(JSON.stringify(body));
  // A weak validator covers equivalent JSON across identity/br/gzip encodings.
  const etag = `W/"${createHash('sha256').update(json).digest('base64url')}"`;
  return { at, json, etag, br: brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 5, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } }), gz: gzipSync(json, { level: 6 }) };
}

/** 미리 압축한 JSON 보내기(요청마다 수 MB 직렬화·압축을 반복하지 않음) */
export function sendPacked(req: express.Request, res: express.Response, p: PackedJson) {
  res.setHeader('ETag', p.etag);
  res.vary('Accept-Encoding');
  // Deliberate admin refreshes must always return the newly built payload.
  if (res.getHeader('Cache-Control') !== 'no-store' && req.fresh) {
    res.status(304).end();
    return;
  }
  const enc = pickEncoding(req.headers['accept-encoding'] as string | undefined);
  const buf = enc === 'br' ? p.br : enc === 'gzip' ? p.gz : p.json;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (enc) res.setHeader('Content-Encoding', enc);
  res.vary('Accept-Encoding');
  res.setHeader('Content-Length', String(buf.length));
  res.end(buf);
}

/**
 * 짧은 응답 캐시: ttl 안에는 저장된 압축본을 바로 보내고, 절반이 지나면 뒤에서 새로 만듦.
 * 동시에 여러 요청이 와도 만드는 작업은 한 번만(single-flight). ttl 0 이면 캐시하지 않음.
 */
export function packedCache(build: () => Promise<unknown>, ttlMs: number, now: () => number = Date.now) {
  let cur: PackedJson | null = null;
  let building: Promise<PackedJson> | null = null;
  const rebuild = () => (building ||= build().then(body => (cur = packJson(body, now()))).finally(() => { building = null; }));
  return {
    async get(): Promise<{ packed: PackedJson; hit: boolean }> {
      const age = cur ? now() - cur.at : Infinity;
      if (ttlMs > 0 && cur && age < ttlMs) {
        return { packed: cur, hit: true };
      }
      return { packed: await rebuild(), hit: false };
    },
    /** 관리자 작업 직후: 캐시를 버리고 바로 새로 만듦 */
    async fresh(): Promise<PackedJson> { if (building) await building.catch(() => null); cur = null; return rebuild(); },
    invalidate() { cur = null; },
  };
}

/** 공개(로그인 무관) 목록용 CDN 헤더: Firebase Hosting 가장자리에 잠깐 보관, 이후 묵은 본을 주면서 새로 받음 */
export const publicCdnHeader = (sMaxAge: number, swr: number) => `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;
