/**
 * CEO 한국어 요약 원장 계약 테스트 (구현 무관 같은 항목).
 * - 컨테이너: MemoryKoLedger(대역) — "계약 테스트(대역)"일 뿐 실제 Firestore 통과가 아님
 * - PC: FirestoreKoLedger + Firestore 에뮬레이터(ceoStore.firestore.test.ts)로 같은 항목
 * 시간은 가상 값. 비용은 정수 나노달러.
 */
import assert from 'node:assert';
import { KoLedger, KO_HARD_LIMIT_NANO, outstandingNano } from '../koLedger';

export interface KoLedgerHarness { a: KoLedger; b: KoLedger; reopen: () => KoLedger; cleanup?: () => Promise<void> }
const T0 = Date.parse('2026-10-31T23:59:00Z');
const T1 = Date.parse('2026-11-01T00:01:00Z');
const res = { title: '제목', summary: '요약', generatedAt: 'x', model: 'gemini-3.8-flash-001' };

export async function runKoLedgerContract(test: (name: string, fn: () => Promise<void>) => Promise<void>, label: string, make: () => Promise<KoLedgerHarness>) {
  const on = async (l: KoLedger, limitNano = KO_HARD_LIMIT_NANO) => l.configure({ enabled: true, limitNano, now: T0 });
  const r = (l: KoLedger, jobKey: string, costNano: number, now = T0, attemptId = 'att-' + jobKey + now) => l.reserve({ jobKey, statementId: 's-' + jobKey, costNano, now, attemptId });

  await test(`${label} KL1 기본 꺼짐(호출 예약 불가), 켜면 활성 시각 1회 기록, 한도는 USD 1 초과·음수·비정수 거부`, async () => {
    const h = await make();
    try {
      assert.deepStrictEqual(await r(h.a, 'j', 10), { ok: false, reason: 'disabled' });
      const s1 = await on(h.a); assert.ok(s1.enabled && s1.activatedAt);
      const s2 = await h.a.configure({ enabled: false, now: T1 }); await h.a.configure({ enabled: true, now: T1 });
      assert.strictEqual((await h.a.read()).activatedAt, s1.activatedAt, 'activation time kept (no backfill window change)');
      for (const bad of [KO_HARD_LIMIT_NANO + 1, -1, 1.5]) await assert.rejects(h.a.configure({ limitNano: bad, now: T0 }));
      assert.strictEqual(s2.enabled, false);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} KL2 마지막 예산 경쟁: 서로 다른 작업 3건 동시 예약 → 한도 안 2건만, 확정+미확정+새 예약 ≤ 한도`, async () => {
    const h = await make();
    try {
      await on(h.a, 2_000);
      const out = await Promise.all([r(h.a, 'x1', 900), r(h.b, 'x2', 900), r(h.a, 'x3', 900)]);
      assert.strictEqual(out.filter(o => o.ok).length, 2);
      assert.ok(out.some(o => o.ok === false && o.reason === 'over_limit'));
      assert.ok(outstandingNano(await h.b.read()) <= 2_000);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} KL3 같은 작업(같은 입력 hash)을 여러 인스턴스가 동시에 예약 → 정확히 1건, 나머지 exists (유료 호출 1회)`, async () => {
    const h = await make();
    try {
      await on(h.a);
      const ls = [h.a, h.b, h.reopen(), h.reopen(), h.a];
      const out = await Promise.all(ls.map((l, i) => r(l, 'same', 100, T0, 'att' + i)));
      assert.strictEqual(out.filter(o => o.ok).length, 1);
      assert.strictEqual(out.filter(o => o.ok === false && o.reason === 'exists').length, 4);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} KL4 정산은 같은 시도만 정확히 1회, 비용은 원래 예약 월(UTC)에 기록 — 월 경계를 넘겨 정산해도`, async () => {
    const h = await make();
    try {
      await on(h.a);
      const a = await r(h.a, 'm', 500, T0); assert.ok(a.ok);
      assert.strictEqual(await h.b.settle({ jobKey: 'm', attemptId: 'wrong', costNano: 400, now: T1, usage: undefined, result: res }), false);
      assert.strictEqual(await h.b.settle({ jobKey: 'm', attemptId: (a as any).attemptId, costNano: 400, now: T1, usage: { prompt: 1, candidates: 1, thoughts: 0 }, result: res }), true);
      assert.strictEqual(await h.a.settle({ jobKey: 'm', attemptId: (a as any).attemptId, costNano: 400, now: T1, usage: undefined, result: res }), false, 'second settle no-op');
      const s = await h.reopen().read();
      assert.strictEqual(s.months['2026-10'].spentNano, 400); assert.strictEqual(s.months['2026-11'], undefined);
      assert.strictEqual(outstandingNano(s), 0); assert.ok(s.results.m);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} KL5 결과 불명: 예약 유지(미확정)·추가 호출 중지, 같은 작업 재예약 불가, 새 달에도 미확정 예약이 가용 예산에서 차감`, async () => {
    const h = await make();
    try {
      await on(h.a, 1_000);
      const a = await r(h.a, 'u', 600, T0); assert.ok(a.ok);
      assert.strictEqual(await h.a.markUncertain({ jobKey: 'u', attemptId: (a as any).attemptId, now: T0, note: 'timeout' }), true);
      const s = await h.b.read();
      assert.strictEqual(outstandingNano(s), 600); assert.ok(s.halted);
      assert.deepStrictEqual(await r(h.b, 'u', 600, T1), { ok: false, reason: 'exists' });
      assert.deepStrictEqual(await r(h.b, 'other', 100, T1), { ok: false, reason: 'halted' });
      // 중지를 풀어도(사람 확인 가정) 새 달 가용 = 1000 - 0 - 600
      const st = await h.a.read();
      const { availableNano } = await import('../koLedger');
      assert.strictEqual(availableNano({ ...st, halted: null }, '2026-11'), 400);
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} KL6 실제 비용이 예약을 넘으면 숨기거나 줄이지 않고 기록 + 중지 / 해제는 같은 시도의 reserved만, 해제 뒤 재예약 가능`, async () => {
    const h = await make();
    try {
      await on(h.a);
      const a = await r(h.a, 'o', 100, T0); assert.ok(a.ok);
      assert.ok(await h.a.settle({ jobKey: 'o', attemptId: (a as any).attemptId, costNano: 150, now: T0, usage: { prompt: 1, candidates: 1, thoughts: 1 }, result: null }));
      const s = await h.a.read();
      assert.strictEqual(s.months['2026-10'].spentNano, 150); assert.match(s.halted!, /넘음/);
      await h.a.configure({ now: T0 }); // 설정만 바꿔도 중지는 유지
      assert.ok((await h.a.read()).halted);
      const h2 = await make();
      try {
        await on(h2.a);
        const b = await r(h2.a, 'rel', 100, T0); assert.ok(b.ok);
        assert.strictEqual(await h2.a.release({ jobKey: 'rel', attemptId: 'x', now: T0, note: 'n' }), false);
        assert.strictEqual(await h2.a.release({ jobKey: 'rel', attemptId: (b as any).attemptId, now: T0, note: '미전송' }), true);
        assert.strictEqual(outstandingNano(await h2.a.read()), 0);
        assert.ok((await r(h2.a, 'rel', 100, T0, 'again')).ok);
      } finally { await h2.cleanup?.(); }
    } finally { await h.cleanup?.(); }
  });

  await test(`${label} KL7 재시작(새 클라이언트)도 같은 원장: 확정·미확정·결과·중지 상태 그대로`, async () => {
    const h = await make();
    try {
      await on(h.a);
      const a = await r(h.a, 'p', 100, T0); assert.ok(a.ok);
      await h.a.settle({ jobKey: 'p', attemptId: (a as any).attemptId, costNano: 90, now: T0, usage: { prompt: 1, candidates: 1, thoughts: 0 }, result: res });
      const s = await h.reopen().read();
      assert.strictEqual(s.months['2026-10'].spentNano, 90); assert.strictEqual(s.results.p.title, '제목'); assert.strictEqual(s.enabled, true);
    } finally { await h.cleanup?.(); }
  });
}
