/**
 * CEO 발언 영속 상태 저장 계약 (Firestore 어댑터와 테스트용 메모리 대역이 같은 판단 함수를 씀).
 *
 * 컬렉션 'ceo_statement_history' (서버 전용, 기존 Firestore 인스턴스·ADC 사용):
 * - head 문서: 저장 판(revision), lease(소유자·펜싱 토큰·만료), 전역 마지막 시작 시각, 마지막 갱신 결과, 마지막 실패 시도, 현재 판 조각 목록
 * - 조각 문서 r{revision}-c{n}: 이력 기록 + 추출 캐시를 JSON으로 직렬화해 나눈 것. 판마다 새로 쓰고 이후 바꾸지 않음
 *
 * 갱신 규칙 (트랜잭션으로 다중 인스턴스에서도 유효):
 * - acquire: 유효한 lease가 있으면 already_running, 전역 최소 간격 안이면 too_soon. 아니면 토큰+1, lease 기록, 기준 판 반환
 * - commit: 토큰 일치 + lease 미만료 + 기준 판 일치일 때만 새 조각 쓰기·head 판+1·옛 조각 삭제·lease 해제 (원자적)
 * - release: 토큰이 일치할 때만 lease 해제 + 실패 시도 기록. 이력·판은 그대로
 * 시간 값은 호출자가 넘김(now, epoch ms). commit의 now는 함수로도 받아 트랜잭션 안(head 읽은 뒤, 재시도마다)에서 평가 →
 * 트랜잭션 지연·재시도 중 lease가 만료되면 저장하지 않음. 인스턴스 간 시계 차이는 lease 길이(분 단위)에 비해 작다고 가정.
 */
import { createHash } from 'node:crypto';
import { CeoDataset, CeoSourceReport } from '../../src/ceo/types';
import { CeoCacheState } from './pipeline';
import { HistoryRecord } from './history';

export const CEO_STATE_COLLECTION = 'ceo_statement_history';
export const STATE_SCHEMA_VERSION = 1;
export const STORE_LIMITS = {
  /** 조각 하나 최대 바이트 (Firestore 문서 1MiB 제한 아래) */
  chunkBytes: 700_000,
  /** 전체 저장 최대 바이트 (넘으면 저장하지 않고 오류) */
  totalBytes: 3_000_000,
  /** head 문서(JSON) 최대 바이트 */
  headBytes: 600_000,
};

/** head 크기 확인(두 저장소 공통). 넘으면 쓰지 않고 오류 */
export function assertHeadSize(h: StoreHead): string {
  const json = JSON.stringify(h);
  if (Buffer.byteLength(json, 'utf8') > STORE_LIMITS.headBytes) throw new StoreError('too_large', `CEO 이력 head 크기가 상한 ${STORE_LIMITS.headBytes}바이트를 넘어 저장하지 않았습니다.`);
  return json;
}

export interface LeaseInfo { holder: string; token: number; expiresAt: number }
export interface LastResult {
  status: 'ready' | 'partial';
  refreshedAt: string;
  sources: CeoSourceReport[];
  message?: string;
  /** statements를 뺀 데이터셋 머리(인물·주제·보류 수 등). 비교 판정은 저장하지 않음(comparisons []) */
  dataset: Omit<CeoDataset, 'statements'>;
}
export interface LastAttempt { at: string; status: 'error'; message: string }
export interface StoreHead {
  schemaVersion: number;
  revision: number;
  committedAt: string | null;
  lease: LeaseInfo | null;
  fenceToken: number;
  lastStartedAt: number;
  lastResult: LastResult | null;
  lastAttempt: LastAttempt | null;
  chunkIds: string[];
  totalBytes: number;
  payloadSha256: string | null;
}
export interface StoredPayload { records: HistoryRecord[]; cache: CeoCacheState; discovery?: import('./officialSource').DiscoveryState }
export interface StoredState { head: StoreHead; payload: StoredPayload }
export interface ChunkDoc { revision: number; index: number; data: string; sha256: string }

export type StoreErrorCode = 'unavailable' | 'permission_denied' | 'timeout' | 'too_large' | 'corrupt' | 'not_configured';
export class StoreError extends Error {
  constructor(readonly code: StoreErrorCode, message: string) { super(message); this.name = 'StoreError'; }
}

export type AcquireResult = { ok: true; token: number; base: StoredState | null; head: StoreHead } | { ok: false; reason: 'already_running' | 'too_soon'; head: StoreHead };
export type CommitResult = { ok: true; head: StoreHead } | { ok: false; reason: 'fenced' | 'lease_expired' | 'stale_revision' };

export interface CeoStateStore {
  readonly kind: 'firestore' | 'memory';
  /** true면 인스턴스 재시작 뒤에도 남는 저장소 */
  readonly durable: boolean;
  readHead(): Promise<StoreHead | null>;
  /** head와 그 판의 조각을 일관되게 읽음(조각 판·해시 재검증, 경쟁 시 재시도) */
  readState(): Promise<StoredState | null>;
  acquire(o: { holder: string; now: number; minIntervalMs: number; leaseMs: number }): Promise<AcquireResult>;
  commit(o: { token: number; baseRevision: number; now: Clock; payload: StoredPayload; result: LastResult }): Promise<CommitResult>;
  release(o: { token: number; now: number; attempt: LastAttempt }): Promise<boolean>;
}

/** 시각 값 또는 시각 함수(트랜잭션 안에서 평가) */
export type Clock = number | (() => number);
export const readClock = (c: Clock): number => (typeof c === 'function' ? c() : c);
/** 테스트 전용 훅: commit 트랜잭션 안에서 head를 읽은 직후(시각 평가 전) 실행 — 트랜잭션 지연 재현용 */
export interface StoreTestHooks { afterCommitRead?: () => Promise<void> }

export const emptyHead = (): StoreHead => ({
  schemaVersion: STATE_SCHEMA_VERSION, revision: 0, committedAt: null, lease: null, fenceToken: 0, lastStartedAt: 0,
  lastResult: null, lastAttempt: null, chunkIds: [], totalBytes: 0, payloadSha256: null,
});

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export const chunkId = (revision: number, index: number) => `r${revision}-c${index}`;

/** 저장할 내용을 조각으로 나눔. 상한을 넘으면 StoreError('too_large') — 일부만 저장하거나 기존 이력을 지우지 않음 */
export function encodePayload(payload: StoredPayload, revision: number): { chunks: ChunkDoc[]; totalBytes: number; sha256: string } {
  const json = JSON.stringify(payload);
  const totalBytes = Buffer.byteLength(json, 'utf8');
  if (totalBytes > STORE_LIMITS.totalBytes) {
    throw new StoreError('too_large', `CEO 이력 저장 크기 ${totalBytes}바이트가 상한 ${STORE_LIMITS.totalBytes}바이트를 넘어 저장하지 않았습니다.`);
  }
  const chunks: ChunkDoc[] = [];
  let i = 0;
  while (i < json.length) {
    // UTF-16 한 단위가 UTF-8 최대 3바이트 → chunkBytes/3 단위씩 자르되 대리쌍 중간은 피함
    let end = Math.min(json.length, i + Math.floor(STORE_LIMITS.chunkBytes / 3));
    const last = json.charCodeAt(end - 1);
    if (end < json.length && last >= 0xd800 && last <= 0xdbff) end--;
    const data = json.slice(i, end);
    chunks.push({ revision, index: chunks.length, data, sha256: sha256(data) });
    i = end;
  }
  return { chunks, totalBytes, sha256: sha256(json) };
}

/** 조각을 head와 대조해 복원. 판·순서·해시가 맞지 않으면 null(호출자가 재시도) */
export function decodePayload(head: StoreHead, chunks: (ChunkDoc | null | undefined)[]): StoredPayload | null {
  if (chunks.length !== head.chunkIds.length) return null;
  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (!c || c.revision !== head.revision || c.index !== i || sha256(c.data) !== c.sha256) return null;
    parts.push(c.data);
  }
  const json = parts.join('');
  if (head.payloadSha256 && sha256(json) !== head.payloadSha256) return null;
  try { return JSON.parse(json) as StoredPayload; } catch { return null; }
}

export function normalizeHead(raw: unknown): StoreHead {
  const h = raw as Partial<StoreHead> | null | undefined;
  if (!h) return emptyHead();
  if (h.schemaVersion !== STATE_SCHEMA_VERSION) throw new StoreError('corrupt', `CEO 이력 head 형식 버전 불일치(${String(h.schemaVersion)})`);
  return { ...emptyHead(), ...h } as StoreHead;
}

/** acquire 판단 (순수). 새 head 또는 거절 사유 */
export function decideAcquire(head: StoreHead, o: { holder: string; now: number; minIntervalMs: number; leaseMs: number }):
  { ok: true; next: StoreHead; token: number } | { ok: false; reason: 'already_running' | 'too_soon' } {
  if (head.lease && head.lease.expiresAt > o.now) return { ok: false, reason: 'already_running' };
  if (head.lastStartedAt && o.now - head.lastStartedAt < o.minIntervalMs) return { ok: false, reason: 'too_soon' };
  const token = head.fenceToken + 1;
  return { ok: true, token, next: { ...head, fenceToken: token, lastStartedAt: o.now, lease: { holder: o.holder, token, expiresAt: o.now + o.leaseMs } } };
}

/** commit 판단 (순수) */
export function decideCommit(head: StoreHead, o: { token: number; baseRevision: number; now: number }): { ok: true } | { ok: false; reason: 'fenced' | 'lease_expired' | 'stale_revision' } {
  if (!head.lease || head.lease.token !== o.token || head.fenceToken !== o.token) return { ok: false, reason: 'fenced' };
  if (head.lease.expiresAt <= o.now) return { ok: false, reason: 'lease_expired' };
  if (head.revision !== o.baseRevision) return { ok: false, reason: 'stale_revision' };
  return { ok: true };
}

export function committedHead(head: StoreHead, o: { now: number; result: LastResult; enc: { chunks: ChunkDoc[]; totalBytes: number; sha256: string } }): StoreHead {
  const revision = head.revision + 1;
  return {
    ...head, revision, committedAt: new Date(o.now).toISOString(), lease: null, lastResult: o.result, lastAttempt: null,
    chunkIds: o.enc.chunks.map(c => chunkId(revision, c.index)), totalBytes: o.enc.totalBytes, payloadSha256: o.enc.sha256,
  };
}

// ------------------------------------------------------------------ 테스트용 메모리 대역 (durable 아님)

type Fault = { op: 'readHead' | 'readState' | 'acquire' | 'commit' | 'release'; code: StoreErrorCode };

/** 여러 "인스턴스"가 공유하는 메모리 저장소. 트랜잭션은 직렬 실행으로 흉내. 장애·경쟁 주입 지원. 운영에서 쓰지 않음 */
export class MemoryStateBackend {
  head: StoreHead | null = null;
  chunks = new Map<string, ChunkDoc>();
  writes = 0;
  faults: Fault[] = [];
  /** readState에서 head를 읽은 뒤 조각을 읽기 전에 한 번 실행(경쟁 재현용) */
  betweenHeadAndChunks: (() => Promise<void>) | null = null;
  private lock: Promise<void> = Promise.resolve();
  async tx<T>(fn: () => Promise<T> | T): Promise<T> {
    const prev = this.lock; let done!: () => void;
    this.lock = new Promise<void>(r => (done = r));
    await prev;
    try { return await fn(); } finally { done(); }
  }
  fault(op: Fault['op']) {
    const i = this.faults.findIndex(f => f.op === op);
    if (i >= 0) { const f = this.faults.splice(i, 1)[0]; throw new StoreError(f.code, `주입된 저장소 오류: ${f.code}`); }
  }
}

export class MemoryStateStore implements CeoStateStore {
  readonly kind = 'memory' as const;
  readonly durable = false;
  constructor(readonly backend: MemoryStateBackend, private hooks: StoreTestHooks = {}) {}
  private clone<T>(x: T): T { return JSON.parse(JSON.stringify(x)); }

  async readHead() { this.backend.fault('readHead'); return this.backend.head ? this.clone(this.backend.head) : null; }

  async readState(): Promise<StoredState | null> {
    this.backend.fault('readState');
    for (let attempt = 0; attempt < 3; attempt++) {
      const head = this.backend.head ? this.clone(this.backend.head) : null; // 트랜잭션 밖 2단계 읽기(경쟁 가능)
      if (!head || head.revision === 0) return head ? { head, payload: { records: [], cache: { entries: {} } } } : null;
      if (this.backend.betweenHeadAndChunks) { const h = this.backend.betweenHeadAndChunks; this.backend.betweenHeadAndChunks = null; await h(); }
      const payload = decodePayload(head, head.chunkIds.map(id => this.backend.chunks.get(id)));
      if (payload) return { head, payload: this.clone(payload) };
    }
    throw new StoreError('corrupt', 'CEO 이력 조각을 head 판과 일치하게 읽지 못했습니다(재시도 3회).');
  }

  acquire(o: { holder: string; now: number; minIntervalMs: number; leaseMs: number }): Promise<AcquireResult> {
    return this.backend.tx(async () => {
      this.backend.fault('acquire');
      const head = this.backend.head ? this.clone(this.backend.head) : emptyHead();
      const d = decideAcquire(head, o);
      if (d.ok === false) return { ok: false, reason: d.reason, head };
      assertHeadSize(d.next);
      const payload = head.revision === 0 ? null : decodePayload(head, head.chunkIds.map(id => this.backend.chunks.get(id)));
      if (head.revision > 0 && !payload) throw new StoreError('corrupt', 'CEO 이력 조각이 head와 맞지 않습니다.');
      this.backend.head = this.clone(d.next); this.backend.writes++;
      return { ok: true, token: d.token, head: this.clone(d.next), base: payload ? { head: this.clone(d.next), payload: this.clone(payload) } : null };
    });
  }

  commit(o: { token: number; baseRevision: number; now: Clock; payload: StoredPayload; result: LastResult }): Promise<CommitResult> {
    return this.backend.tx(async () => {
      this.backend.fault('commit');
      const head = this.backend.head ? this.clone(this.backend.head) : emptyHead();
      if (this.hooks.afterCommitRead) await this.hooks.afterCommitRead();
      const now = readClock(o.now);
      const d = decideCommit(head, { token: o.token, baseRevision: o.baseRevision, now });
      if (d.ok === false) return { ok: false, reason: d.reason };
      const enc = encodePayload(o.payload, head.revision + 1);
      const next = committedHead(head, { now, result: o.result, enc });
      assertHeadSize(next);
      for (const c of enc.chunks) this.backend.chunks.set(chunkId(next.revision, c.index), this.clone(c));
      for (const id of head.chunkIds) this.backend.chunks.delete(id);
      this.backend.head = this.clone(next); this.backend.writes++;
      return { ok: true, head: this.clone(next) };
    });
  }

  release(o: { token: number; now: number; attempt: LastAttempt }): Promise<boolean> {
    return this.backend.tx(async () => {
      this.backend.fault('release');
      const head = this.backend.head;
      if (!head || !head.lease || head.lease.token !== o.token) return false;
      const next = { ...this.clone(head), lease: null, lastAttempt: o.attempt };
      assertHeadSize(next);
      this.backend.head = next; this.backend.writes++;
      return true;
    });
  }
}
