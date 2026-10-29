/**
 * CEO 상태 저장소 계약 테스트 (저장소 구현과 무관하게 같은 항목).
 * - 컨테이너: MemoryStateStore(대역)로 실행 → "계약 테스트(대역)"일 뿐 실제 저장소 통과가 아님
 * - PC: FirestoreCeoStateStore + Firestore 에뮬레이터(ceoStore.firestore.test.ts)로 같은 항목 실행
 * 시간은 호출자가 넘기는 값(가상 시계)이라 실제 대기 없음. 데이터는 전부 가상.
 */
import assert from 'node:assert';
import { AcquireResult, CeoStateStore, LastResult, StoredPayload, STORE_LIMITS, StoreError, StoreTestHooks } from '../stateStore';
import { HistoryRecord } from '../history';

export interface StoreHarness {
  /** 같은 저장소를 쓰는 두 "인스턴스" */
  a: CeoStateStore;
  b: CeoStateStore;
  /** 재시작: 새 클라이언트로 같은 저장소 열기 */
  reopen: () => CeoStateStore;
  /** 조각 문서 존재 확인(옛 조각 삭제 검증) */
  chunkExists: (id: string) => Promise<boolean>;
  /** 같은 저장소를 쓰되 테스트 훅을 단 인스턴스 */
  withHooks: (hooks: StoreTestHooks) => CeoStateStore;
  cleanup?: () => Promise<void>;
}

const LEASE = 60_000;
const T0 = 1_800_000_000_000;
const result = (tag: string): LastResult => ({
  status: 'ready', refreshedAt: new Date(T0).toISOString(), sources: [{ feedName: tag, feedUrl: 'https://example.invalid/' + tag, ok: true, itemsInFeed: 1, matchedExisting: 1, withBody: 1 }],
  dataset: { schemaVersion: 2, isExample: true, persons: [], roles: [], topics: [], comparisons: [], heldBackCount: 0, unavailableArticles: { pending: 0, failed: 0 } },
});
function record(key: string, quote: string): HistoryRecord {
  return {
    key, articleId: 'art-' + key, status: 'verified', firstVerifiedAt: '2026-10-01T00:00:00.000Z', lastVerifiedAt: '2026-10-01T00:00:00.000Z', lastCheckedAt: '2026-10-01T00:00:00.000Z',
    statement: {
      statementId: 's-' + key, personId: 'ex-person', roleAtTime: { companyId: 'x', title: 'CEO', status: 'current' } as any, topicId: 't',
      spokenAt: { value: '2026-01-28', precision: 'day', basisType: 'explicit_in_text', basisExcerpt: 'Wednesday January 28, 2026' } as any,
      kind: 'direct_quote', quoteText: quote, quoteLanguage: 'en', summaryKo: '',
      evidence: [{ articleId: 'art-' + key, articleContentHash: 'h-' + key, sourceName: '가상 출처', url: 'https://example.invalid/' + key, articlePublishedAt: null, excerpt: quote }],
      isExample: true,
    } as any,
  };
}
const payload = (n: number, quote = 'q', pad = 0): StoredPayload => ({
  records: Array.from({ length: n }, (_, i) => record(`k${i}`, `${quote} ${i} ${'가'.repeat(pad)}`)),
  cache: { entries: { 'art-k0': { articleId: 'art-k0', contentHash: 'h-k0', extractorName: 'x', extractorVersion: '1', schemaVersion: 2, status: 'ok', raw: [], attempts: 1, extractedAt: '2026-10-01T00:00:00.000Z' } } },
});

export async function runStoreContract(
  test: (name: string, fn: () => Promise<void>) => Promise<void>, label: string, make: () => Promise<StoreHarness>,
) {
  const acq = (s: CeoStateStore, now: number, minIntervalMs = 0) => s.acquire({ holder: 'h' + now, now, minIntervalMs, leaseMs: LEASE });

  await test(`${label} C1 빈 저장소: head·상태 없음`, async () => {
    const h = await make();
    try { assert.strictEqual(await h.a.readHead(), null); assert.strictEqual(await h.a.readState(), null); } finally { await h.cleanup?.(); }
  });

  await test(`${label} C2 동시 시작은 한 인스턴스만 lease 획득, 유효 lease 동안 다른 인스턴스는 already_running, 만료 뒤 새 토큰`, async () => {
    const h = await make();
    try {
      const [ra, rb] = await Promise.all([acq(h.a, T0), acq(h.b, T0)]);
      assert.strictEqual([ra, rb].filter(r => r.ok).length, 1, 'exactly one');
      const loser = ra.ok ? rb : ra;
      assert.ok(loser.ok === false && loser.reason === 'already_running');
      const again = await acq(h.b, T0 + LEASE - 1);
      assert.ok(again.ok === false && again.reason === 'already_running');
      const after = await acq(h.b, T0 + LEASE + 1);
      assert.ok(after.ok); assert.strictEqual(after.token, 2);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C3 늦은 작업 거부: 만료 후 다른 인스턴스가 새 lease → 옛 토큰 commit은 fenced, 새 토큰 commit만 저장`, async () => {
    const h = await make();
    try {
      const a = await acq(h.a, T0); assert.ok(a.ok);
      const b = await acq(h.b, T0 + LEASE + 1); assert.ok(b.ok);
      const late = await h.a.commit({ token: a.token, baseRevision: 0, now: T0 + LEASE + 2, payload: payload(1, 'OLD'), result: result('old') });
      assert.deepStrictEqual(late, { ok: false, reason: 'fenced' });
      const ok = await h.b.commit({ token: b.token, baseRevision: 0, now: T0 + LEASE + 3, payload: payload(1, 'NEW'), result: result('new') });
      assert.ok(ok.ok); assert.strictEqual(ok.head.revision, 1); assert.strictEqual(ok.head.lease, null);
      const lateAgain = await h.a.commit({ token: a.token, baseRevision: 0, now: T0 + LEASE + 4, payload: payload(1, 'OLD'), result: result('old') });
      assert.ok(!lateAgain.ok);
      const st = (await h.reopen().readState())!;
      assert.strictEqual(st.head.revision, 1); assert.ok(st.payload.records[0].statement.quoteText!.startsWith('NEW'));
      assert.strictEqual(st.head.lastResult!.sources[0].feedName, 'new');
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C4 lease 만료 뒤 commit은 (다른 인스턴스가 없어도) lease_expired, 기존 상태 그대로`, async () => {
    const h = await make();
    try {
      const a = await acq(h.a, T0); assert.ok(a.ok);
      const r = await h.a.commit({ token: a.token, baseRevision: 0, now: T0 + LEASE, payload: payload(1), result: result('x') });
      assert.deepStrictEqual(r, { ok: false, reason: 'lease_expired' });
      assert.strictEqual((await h.b.readHead())!.revision, 0);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C5 전역 최소 간격: 한 인스턴스가 시작한 뒤 간격 안에는 다른 인스턴스도 too_soon`, async () => {
    const h = await make();
    try {
      const a = await acq(h.a, T0, 600_000); assert.ok(a.ok);
      assert.ok((await h.a.commit({ token: a.token, baseRevision: 0, now: T0 + 1, payload: payload(1), result: result('x') })).ok);
      const b = await acq(h.b, T0 + 599_999, 600_000);
      assert.ok(b.ok === false && b.reason === 'too_soon');
      assert.ok((await acq(h.b, T0 + 600_000, 600_000)).ok);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C6 크기 초과는 저장하지 않고 오류(too_large), 기존 판·이력 보존, 실패 기록 후 lease 해제`, async () => {
    const h = await make();
    try {
      const a = await acq(h.a, T0); assert.ok(a.ok);
      assert.ok((await h.a.commit({ token: a.token, baseRevision: 0, now: T0 + 1, payload: payload(2, 'KEEP'), result: result('keep') })).ok);
      const b = await acq(h.b, T0 + 10); assert.ok(b.ok);
      const huge = payload(4, 'BIG', Math.ceil(STORE_LIMITS.totalBytes / 3 / 4) + 10);
      await assert.rejects(h.b.commit({ token: b.token, baseRevision: 1, now: T0 + 11, payload: huge, result: result('big') }), (e: any) => e instanceof StoreError && e.code === 'too_large');
      const mid = (await h.a.readState())!;
      assert.strictEqual(mid.head.revision, 1); assert.ok(mid.payload.records.every(r => r.statement.quoteText!.startsWith('KEEP')));
      assert.ok(mid.head.lease && mid.head.lease.token === b.token, 'lease still held until release');
      assert.strictEqual(await h.b.release({ token: b.token, now: T0 + 12, attempt: { at: 'x', status: 'error', message: 'too large' } }), true);
      const after = (await h.a.readState())!;
      assert.strictEqual(after.head.revision, 1); assert.strictEqual(after.head.lease, null); assert.strictEqual(after.head.lastAttempt!.message, 'too large');
      assert.deepStrictEqual(after.payload, mid.payload);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C7 다른 토큰의 release는 무시(현재 lease·이력 유지)`, async () => {
    const h = await make();
    try {
      const a = await acq(h.a, T0); assert.ok(a.ok);
      assert.strictEqual(await h.b.release({ token: a.token + 5, now: T0 + 1, attempt: { at: 'x', status: 'error', message: 'm' } }), false);
      assert.strictEqual((await h.b.readHead())!.lease!.token, a.token);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C8 재시작 복원: 새 클라이언트가 여러 조각 상태를 그대로 복원, 다음 판 저장 후 옛 조각 삭제`, async () => {
    const h = await make();
    try {
      const big = payload(3, 'MULTI', Math.ceil(STORE_LIMITS.chunkBytes / 3 / 3) + 1000); // 조각 2개 이상
      const a = await acq(h.a, T0); assert.ok(a.ok);
      const c1 = await h.a.commit({ token: a.token, baseRevision: 0, now: T0 + 1, payload: big, result: result('multi') });
      assert.ok(c1.ok); assert.ok(c1.head.chunkIds.length >= 2, `chunks ${c1.ok && c1.head.chunkIds.length}`);
      const restored = (await h.reopen().readState())!;
      assert.deepStrictEqual(restored.payload, big); assert.strictEqual(restored.head.revision, 1);
      const old = c1.head.chunkIds;
      const b = await acq(h.b, T0 + 10); assert.ok(b.ok);
      const c2 = await h.b.commit({ token: b.token, baseRevision: 1, now: T0 + 11, payload: payload(1, 'SMALL'), result: result('small') });
      assert.ok(c2.ok);
      for (const id of old) assert.strictEqual(await h.chunkExists(id), false, `old chunk ${id} deleted`);
      assert.deepStrictEqual((await h.reopen().readState())!.payload, payload(1, 'SMALL'));
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C9 같은 판 기준 동시 commit 경쟁 불가: 첫 commit이 lease를 풀면 같은 토큰 재commit은 fenced`, async () => {
    const h = await make();
    try {
      const a = await acq(h.a, T0); assert.ok(a.ok);
      const [x, y] = await Promise.all([
        h.a.commit({ token: a.token, baseRevision: 0, now: T0 + 1, payload: payload(1, 'X'), result: result('x') }),
        h.b.commit({ token: a.token, baseRevision: 0, now: T0 + 1, payload: payload(1, 'Y'), result: result('y') }),
      ]);
      assert.strictEqual([x, y].filter(r => r.ok).length, 1);
      assert.strictEqual((await h.a.readHead())!.revision, 1);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C10 commit 트랜잭션 지연 중 lease 만료(시각을 트랜잭션 안에서 평가) → 저장 거부, 그 사이 다른 인스턴스가 새 lease 획득, 늦은 작업 내용은 남지 않음`, async () => {
    const h = await make();
    try {
      const clock = { t: T0 };
      const bg: { other?: Promise<AcquireResult> } = {};
      const slow = h.withHooks({ afterCommitRead: async () => {
        clock.t = T0 + LEASE + 5; // 트랜잭션이 지연되는 동안 lease 만료
        if (!bg.other) bg.other = acq(h.b, T0 + LEASE + 5); // 기다리지 않음(같은 문서 경쟁·재시도 유발)
        await new Promise(r => setTimeout(r, 50));
      } });
      const a = await acq(slow, T0); assert.ok(a.ok === true);
      const r = await slow.commit({ token: a.ok === true ? a.token : -1, baseRevision: 0, now: () => clock.t, payload: payload(1, 'LATE'), result: result('late') });
      assert.ok(r.ok === false && (r.reason === 'lease_expired' || r.reason === 'fenced'), JSON.stringify(r));
      const o = await bg.other;
      assert.ok(o !== undefined && o.ok === true, 'other instance acquired after expiry');
      const st = await h.reopen().readState();
      assert.ok(!st || st.head.revision === 0, 'late payload never stored');
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} C11 대조군: 같은 훅으로 지연돼도 lease 안이면 정상 저장`, async () => {
    const h = await make();
    try {
      const slow = h.withHooks({ afterCommitRead: async () => { await new Promise(r => setTimeout(r, 30)); } });
      const a = await acq(slow, T0); assert.ok(a.ok === true);
      const r = await slow.commit({ token: a.ok === true ? a.token : -1, baseRevision: 0, now: () => T0 + 10, payload: payload(1, 'ONTIME'), result: result('ontime') });
      assert.ok(r.ok === true);
      assert.strictEqual((await h.reopen().readState())!.head.revision, 1);
    } finally { await h.cleanup?.(); }
  });
}
