/**
 * CEO 상태 저장소 — Firestore 어댑터 (서버 전용).
 * 운영 server.ts가 기존 Firestore 인스턴스(initFirestore, ADC)를 주입합니다. 이 파일은 SDK를 타입으로만 참조하고
 * 기존 firestore.ts·db 싱글턴·다른 컬렉션을 건드리지 않습니다. 쓰기는 관리자 갱신 경로(acquire/commit/release)뿐입니다.
 * 모든 트랜잭션은 필요한 읽기(head, 조각)를 쓰기 전에 마칩니다. 각 작업에는 시간 상한을 둡니다.
 */
import type { DocumentReference, DocumentSnapshot, Firestore, Transaction } from '@google-cloud/firestore';
import {
  AcquireResult, CEO_STATE_COLLECTION, Clock, readClock, StoreTestHooks, CeoStateStore, chunkId, ChunkDoc, CommitResult, committedHead, decideAcquire, decideCommit,
  assertHeadSize, decodePayload, emptyHead, encodePayload, LastAttempt, LastResult, normalizeHead, StoredPayload, StoredState, StoreError, StoreHead,
} from './stateStore';

/** gRPC/Firestore 오류 → 저장소 오류 코드 */
export function mapFirestoreError(e: any): StoreError {
  if (e instanceof StoreError) return e;
  const code = e?.code;
  const msg = String(e?.message || e).slice(0, 160);
  if (code === 7 || code === 16 || code === 'permission-denied' || code === 'unauthenticated') return new StoreError('permission_denied', `Firestore 권한 거부: ${msg}`);
  if (code === 4 || code === 'deadline-exceeded') return new StoreError('timeout', `Firestore 시간 초과: ${msg}`);
  return new StoreError('unavailable', `Firestore 사용 불가: ${msg}`);
}

export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => { t = setTimeout(() => rej(new StoreError('timeout', `${what} 시간 초과(${ms}ms, 결과 미확정일 수 있음)`)), ms); })]);
  } finally { if (t) clearTimeout(t); }
}

export class FirestoreCeoStateStore implements CeoStateStore {
  readonly kind = 'firestore' as const;
  readonly durable = true;
  private headRef: DocumentReference;
  constructor(private db: Firestore, private opts: { collection?: string; opTimeoutMs?: number; hooks?: StoreTestHooks } = {}) {
    this.headRef = db.collection(this.col).doc('head');
  }
  private get col() { return this.opts.collection || CEO_STATE_COLLECTION; }
  private ref(id: string) { return this.db.collection(this.col).doc(id); }
  private run<T>(what: string, p: () => Promise<T>): Promise<T> {
    return withTimeout(p(), this.opts.opTimeoutMs ?? 15_000, what).catch(e => { throw mapFirestoreError(e); });
  }
  /** head는 JSON 문자열 한 필드로 저장(undefined·중첩 배열 등 Firestore 값 제약을 피하고 형식 그대로 보존) */
  private headOf(s: DocumentSnapshot): StoreHead | null {
    if (!s.exists) return null;
    const d = s.data() as { schemaVersion?: number; json?: string } | undefined;
    if (!d || typeof d.json !== 'string') throw new StoreError('corrupt', 'CEO 이력 head 형식이 아닙니다.');
    let parsed: unknown;
    try { parsed = JSON.parse(d.json); } catch { throw new StoreError('corrupt', 'CEO 이력 head JSON을 읽지 못했습니다.'); }
    return normalizeHead(parsed);
  }
  private headDoc(h: StoreHead) {
    const json = assertHeadSize(h);
    return { schemaVersion: h.schemaVersion, revision: h.revision, json };
  }
  private async chunksIn(tx: Transaction, head: StoreHead): Promise<(ChunkDoc | undefined)[]> {
    if (!head.chunkIds.length) return [];
    const snaps = await tx.getAll(...head.chunkIds.map(id => this.ref(id)));
    return snaps.map((s: DocumentSnapshot) => (s.exists ? (s.data() as ChunkDoc) : undefined));
  }

  readHead() {
    return this.run('CEO 이력 head 읽기', async () => this.headOf(await this.headRef.get()));
  }

  /** 읽기 전용 트랜잭션 안에서 head와 조각을 함께 읽음(같은 시점) + 판·해시 재검증. 맞지 않으면 재시도 */
  readState(): Promise<StoredState | null> {
    return this.run('CEO 이력 읽기', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const got = await this.db.runTransaction(async (tx: Transaction) => {
          const head = this.headOf(await tx.get(this.headRef));
          if (!head) return null;
          if (head.revision === 0) return { head, payload: { records: [], cache: { entries: {} } } as StoredPayload };
          const payload = decodePayload(head, await this.chunksIn(tx, head));
          return payload ? { head, payload } : 'retry' as const;
        }, { readOnly: true });
        if (got !== 'retry') return got;
      }
      throw new StoreError('corrupt', 'CEO 이력 조각을 head 판과 일치하게 읽지 못했습니다(재시도 3회).');
    });
  }

  acquire(o: { holder: string; now: number; minIntervalMs: number; leaseMs: number }): Promise<AcquireResult> {
    return this.run('CEO 갱신 시작(lease)', () => this.db.runTransaction(async (tx: Transaction) => {
      const head = this.headOf(await tx.get(this.headRef)) || emptyHead();
      const d = decideAcquire(head, o);
      if (d.ok === false) return { ok: false as const, reason: d.reason, head };
      let payload: StoredPayload | null = null;
      if (head.revision > 0) {
        payload = decodePayload(head, await this.chunksIn(tx, head)); // 읽기 먼저
        if (!payload) throw new StoreError('corrupt', 'CEO 이력 조각이 head와 맞지 않습니다.');
      }
      tx.set(this.headRef, this.headDoc(d.next));
      return { ok: true as const, token: d.token, head: d.next, base: payload ? { head: d.next, payload } : null };
    }));
  }

  async commit(o: { token: number; baseRevision: number; now: Clock; payload: StoredPayload; result: LastResult }): Promise<CommitResult> {
    const enc = encodePayload(o.payload, o.baseRevision + 1); // 크기 초과는 트랜잭션 전에 거절(기존 이력 그대로)
    return this.run('CEO 갱신 저장', () => this.db.runTransaction(async (tx: Transaction) => {
      const head = this.headOf(await tx.get(this.headRef)) || emptyHead(); // 유일한 읽기, 쓰기 전에 수행
      if (this.opts.hooks?.afterCommitRead) await this.opts.hooks.afterCommitRead();
      const now = readClock(o.now); // 재시도마다 다시 평가
      const d = decideCommit(head, { token: o.token, baseRevision: o.baseRevision, now });
      if (d.ok === false) return { ok: false as const, reason: d.reason };
      const next = committedHead(head, { now, result: o.result, enc });
      for (const c of enc.chunks) tx.set(this.ref(chunkId(next.revision, c.index)), c);
      for (const id of head.chunkIds) tx.delete(this.ref(id));
      tx.set(this.headRef, this.headDoc(next));
      return { ok: true as const, head: next };
    }));
  }

  release(o: { token: number; now: number; attempt: LastAttempt }): Promise<boolean> {
    return this.run('CEO 갱신 실패 기록', () => this.db.runTransaction(async (tx: Transaction) => {
      const head = this.headOf(await tx.get(this.headRef));
      if (!head || !head.lease || head.lease.token !== o.token) return false;
      tx.set(this.headRef, this.headDoc({ ...head, lease: null, lastAttempt: o.attempt }));
      return true;
    }));
  }
}
