/**
 * CEO 한국어 요약(Gemini)·비용 원장 테스트 — 전부 합성: 가짜 KoClient(네트워크 없음)·메모리 원장(대역).
 * 실행: npx tsx server/ceo/ceoKo.test.ts
 * 실제 SDK(2.19.0) 변환·실제 Firestore는 PC에서 따로(ceoStore.firestore.test.ts의 원장 계약, 실제 유료 호출은 별도 승인 1건).
 */
import assert from 'node:assert';
import { MemoryKoLedger, outstandingNano } from './koLedger';
import { costFromUsage, KO_MAX_OUTPUT_TOKENS, KoClient, koContents, koJobKey, parseKoOutput, priceAt, runKoSummaries } from './koSummary';
import { runKoLedgerContract } from './testing/koLedgerContract';
import { CeoRuntime } from './runtime';
import { MemoryStateBackend, MemoryStateStore } from './stateStore';
import { SourceFetchError } from './fetchText';
import { FeedItem } from './officialSource';
import { LIVE_REGISTRY, LIVE_TRANSCRIPT, rssFeed, transcriptPage } from './testing/liveFixtures';
import { PROD_REV1_STATEMENTS } from './testing/productionRev1';
import { translationFor } from './translations';
import { CeoStatement } from '../../src/ceo/types';

let finished = false;
process.on('beforeExit', () => { if (!finished) { console.log('FAIL (멈춘 약속)'); process.exit(3); } });
const results: { name: string; ok: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e: any) { results.push({ name, ok: false, error: e?.stack || String(e) }); console.log(`FAIL ${name}\n  ${e?.message || e}`); }
}

const NOW = Date.parse('2026-10-20T00:00:00Z');
const OK_TEXT = JSON.stringify({ title: '새 지표 강조', summary: '효율 지표를 계속 개선하고 있다는 취지의 발언입니다.' });
type Gen = Awaited<ReturnType<KoClient['generate']>>;
function fakeClient(o: { count?: number | (() => Promise<number>); gen?: (n: number) => Promise<Gen> } = {}) {
  const calls = { count: 0, gen: 0 };
  const c: KoClient = {
    countTokens: async () => { calls.count++; const v = typeof o.count === 'function' ? await o.count() : (o.count ?? 200); return { totalTokens: v }; },
    generate: async () => { calls.gen++; return o.gen ? o.gen(calls.gen) : { text: OK_TEXT, modelVersion: 'gemini-3.8-flash-001', usageMetadata: { promptTokenCount: 210, candidatesTokenCount: 40, thoughtsTokenCount: 100, totalTokenCount: 350 } }; },
  };
  return { c, calls };
}
/** 사전 번역이 없는 새 발언(원문은 합성) */
const stmt = (q = 'We keep improving the key metric every quarter', id = 'st_new1'): CeoStatement => ({
  ...PROD_REV1_STATEMENTS[0], statementId: id, quoteText: q,
  evidence: [{ ...PROD_REV1_STATEMENTS[0].evidence[0], excerpt: q + '.' }],
});
const enabled = async (limitNano?: number) => { const l = new MemoryKoLedger(); await l.configure({ enabled: true, limitNano, now: NOW - 1000 }); return l; };
const run = (s: CeoStatement[], l: MemoryKoLedger, c: KoClient | null, extra: Partial<Parameters<typeof runKoSummaries>[1]> = {}) =>
  runKoSummaries(s, { ledger: l, client: c, now: () => NOW, deadline: NOW + 120_000, ...extra });

async function main() {
  await runKoLedgerContract(test, 'MEMORY(대역)', async () => {
    const shared = new MemoryKoLedger();
    // 같은 저장소를 여러 인스턴스가 쓰는 것 흉내: 같은 객체(직렬 트랜잭션). 실제 동시성은 PC 에뮬레이터 계약에서
    return { a: shared, b: shared, reopen: () => shared };
  });

  await test('K1 정상 1건: count 1 → 예약 → 생성 1 → 정산(입력 + (출력+사고) 단가, 올림) → 결과 캐시, 예약 = ceil(count×1.1)+32 입력 + 512 출력', async () => {
    const l = await enabled(); const { c, calls } = fakeClient();
    const r = await run([stmt()], l, c);
    assert.deepStrictEqual([calls.count, calls.gen, r.settled], [1, 1, 1]);
    const s = await l.read(); const j = Object.values(s.jobs)[0];
    assert.strictEqual(j.reservedNano, Math.ceil((Math.ceil(200 * 1.1) + 32) * 750 + KO_MAX_OUTPUT_TOKENS * 3750));
    assert.strictEqual(j.costNano, 210 * 750 + (40 + 100) * 3750);
    assert.strictEqual(s.months['2026-10'].spentNano, j.costNano); assert.strictEqual(outstandingNano(s), 0);
    assert.strictEqual(Object.values(s.results)[0].title, '새 지표 강조');
    assert.strictEqual(s.halted, null);
  });

  await test('K2 캐시 hit(같은 입력 hash)은 count조차 0 / 정적 검토 번역이 있으면 호출 0 / 승인된 초기 확인(override)만 1건', async () => {
    const l = await enabled(); const { c, calls } = fakeClient();
    await run([stmt()], l, c);
    const r2 = await run([stmt(), stmt()], l, c);
    assert.deepStrictEqual([calls.count, calls.gen, r2.cacheHits], [1, 1, 2]);
    const reviewed = { ...PROD_REV1_STATEMENTS[0], translationKo: translationFor(PROD_REV1_STATEMENTS[0]) };
    const r3 = await run([reviewed], l, c);
    assert.deepStrictEqual([r3.skippedReviewed, calls.count, calls.gen], [1, 1, 1]);
    const r4 = await run([reviewed], l, c, { overrideReviewed: true, maxCalls: 1 });
    assert.deepStrictEqual([r4.calls, calls.gen], [1, 2]);
  });

  await test('K3 꺼짐·키 없음·요금 확인 만료·기한 부족·원장 읽기/예약 실패·count 실패/이상값(0, NaN, 상한 초과) → 생성 호출 0', async () => {
    const off = new MemoryKoLedger(); const f0 = fakeClient();
    assert.strictEqual((await run([stmt()], off, f0.c)).stoppedReason, '꺼짐');
    assert.strictEqual((await run([stmt()], await enabled(), null)).stoppedReason, 'Gemini 키 미설정');
    const late = await run([stmt()], await enabled(), f0.c, { now: () => Date.parse('2027-04-01T00:00:00Z'), deadline: Date.parse('2027-04-01T00:02:00Z') });
    assert.match(late.stoppedReason!, /요금 확인 유효기간/);
    assert.match((await run([stmt()], await enabled(), f0.c, { deadline: NOW + 10_000 })).stoppedReason!, /기한/);
    const lf = await enabled(); lf.failNext = 'reserve';
    assert.match((await run([stmt()], lf, f0.c)).stoppedReason!, /예약 결과 불확실/);
    assert.strictEqual(outstandingNano(await lf.read()), 0);
    for (const bad of [0, NaN, 1201, 12.5]) {
      const l = await enabled(); const f = fakeClient({ count: bad });
      const r = await run([stmt()], l, f.c);
      assert.match(r.stoppedReason!, /countTokens 값 이상/); assert.strictEqual(f.calls.gen, 0); assert.strictEqual(Object.keys((await l.read()).jobs).length, 0);
    }
    const lc = await enabled(); const fc = fakeClient({ count: async () => { throw new Error('count 500'); } });
    assert.match((await run([stmt()], lc, fc.c)).stoppedReason!, /countTokens 실패/); assert.strictEqual(fc.calls.gen, 0);
    assert.strictEqual(f0.calls.gen, 0);
  });

  await test('K4 요청 오류·시간 초과·응답 유실(전송됐을 수 있음): 예약 전액 유지(uncertain)·중지, 같은 작업 재호출 0, 새 달·재시작 뒤에도 복구·재호출 없음', async () => {
    const l = await enabled(); const f = fakeClient({ gen: async () => { throw new Error('deadline exceeded'); } });
    const r = await run([stmt()], l, f.c);
    assert.strictEqual(r.uncertain, 1);
    const s = await l.read(); const j = Object.values(s.jobs)[0];
    assert.strictEqual(j.status, 'uncertain'); assert.strictEqual(outstandingNano(s), j.reservedNano); assert.ok(s.halted);
    const f2 = fakeClient();
    const nextMonth = await run([stmt()], l, f2.c, { now: () => Date.parse('2026-11-02T00:00:00Z'), deadline: Date.parse('2026-11-02T00:02:00Z') });
    assert.strictEqual(f2.calls.count + f2.calls.gen, 0); assert.strictEqual(nextMonth.cacheHits, 1);
    assert.strictEqual(outstandingNano(await l.read()), j.reservedNano, 'reservation kept across month');
  });

  await test('K5 usage 누락 → 예약 유지·중지 / usage 합계 불일치 → 큰 쪽으로 비용 기록·중지 / 사고 토큰이 커서 예약 초과 → 그대로 기록·중지', async () => {
    const a = await enabled();
    await run([stmt()], a, fakeClient({ gen: async () => ({ text: OK_TEXT, modelVersion: 'gemini-3.8-flash-001' }) }).c);
    const sa = await a.read(); assert.strictEqual(Object.values(sa.jobs)[0].status, 'uncertain'); assert.ok(sa.halted);
    const b = await enabled();
    await run([stmt()], b, fakeClient({ gen: async () => ({ text: OK_TEXT, modelVersion: 'gemini-3.8-flash-001', usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 0, totalTokenCount: 400 } }) }).c);
    const sb = await b.read(); const jb = Object.values(sb.jobs)[0];
    assert.strictEqual(jb.costNano, 200 * 750 + 200 * 3750); assert.match(sb.halted!, /불일치/);
    const c = await enabled();
    await run([stmt()], c, fakeClient({ gen: async () => ({ text: OK_TEXT, modelVersion: 'gemini-3.8-flash-001', usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 40, thoughtsTokenCount: 2000, totalTokenCount: 2240 } }) }).c);
    const sc = await c.read(); const jc = Object.values(sc.jobs)[0];
    assert.ok(jc.costNano! > jc.reservedNano); assert.strictEqual(sc.months['2026-10'].spentNano, jc.costNano); assert.match(sc.halted!, /넘음/);
  });

  await test('K6 잘못된 JSON·거절·빈 답변·숫자 누락·한국어 아님: usage 비용은 기록, 결과 없음(원문 유지), 중지는 아님', async () => {
    for (const text of ['not json', '', '{"title":"","summary":""}', '{"title":"Title","summary":"English only"}', JSON.stringify({ title: '목표', summary: '수치 없이 요약' })]) {
      const l = await enabled();
      const q = 'We expect 25 percent growth in 2027';
      await run([stmt(q)], l, fakeClient({ gen: async () => ({ text, modelVersion: 'gemini-3.8-flash-001', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 0, totalTokenCount: 105 } }) }).c);
      const s = await l.read();
      assert.strictEqual(Object.keys(s.results).length, 0, text); assert.strictEqual(s.months['2026-10'].spentNano, 100 * 750 + 5 * 3750); assert.strictEqual(s.halted, null);
    }
    assert.ok(parseKoOutput(JSON.stringify({ title: '성장 전망', summary: '2027년 25 퍼센트 성장을 예상한다는 발언' }), 'We expect 25 percent growth in 2027'));
  });

  await test('K7 예상 밖 모델 응답(별칭·다른 모델) → 비용 기록·결과 버림·추가 호출 중지 / 실제 입력 토큰이 예약 입력 초과(고유니코드 등) → 기록·중지', async () => {
    const l = await enabled(); const f = fakeClient({ gen: async () => ({ text: OK_TEXT, modelVersion: 'gemini-3.7-flash', usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 10, thoughtsTokenCount: 0, totalTokenCount: 210 } }) });
    const r = await run([stmt('a b c d e f'), stmt('g h i j k l', 'st2')], l, f.c);
    assert.strictEqual(f.calls.gen, 1); assert.match(r.stoppedReason!, /예상 밖 모델/);
    assert.strictEqual(Object.keys((await l.read()).results).length, 0);
    const u = await enabled(); const fu = fakeClient({ count: 300, gen: async () => ({ text: OK_TEXT, modelVersion: 'gemini-3.8-flash-002', usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 10, thoughtsTokenCount: 0, totalTokenCount: 510 } }) });
    const ru = await run([stmt('😀 한국어 ✓ 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 test quote here'), stmt('another quote here please', 'st3')], u, fu.c);
    assert.match(ru.stoppedReason!, /예약 입력/); assert.strictEqual(fu.calls.gen, 1);
  });

  await test('K8 월 한도: 남은 예산보다 큰 예약은 호출 0, 2027년 요금(2배)으로 예약 증가, 한도 0이면 바로 한도 도달', async () => {
    const small = await enabled(100_000); const f = fakeClient();
    const r = await run([stmt()], small, f.c);
    assert.strictEqual(f.calls.gen, 0); assert.match(r.stoppedReason!, /한도/);
    assert.deepStrictEqual(priceAt(Date.parse('2027-01-01T00:00:00Z')), { inNano: 1500, outNano: 7500 });
    assert.deepStrictEqual(priceAt(Date.parse('2026-12-31T23:59:59Z')), { inNano: 750, outNano: 3750 });
    const zero = await enabled(0);
    assert.match((await run([stmt()], zero, fakeClient().c)).stoppedReason!, /한도/);
  });

  await test('K9 입력 hash: 원문·근거가 바뀌면 새 작업(옛 요약 미표시), 같으면 같은 키 / 입력은 인용·근거 문장만(인물·날짜·직책 없음)', () => {
    const a = stmt(); const b = { ...a, evidence: [{ ...a.evidence[0], excerpt: a.quoteText + ', and more context.' }] };
    assert.notStrictEqual(koJobKey(a), koJobKey(b));
    assert.strictEqual(koJobKey(a), koJobKey({ ...a, statementId: 'other', spokenAt: { value: null, precision: 'unknown', basisType: 'none' } }));
    const c = koContents(a);
    assert.ok(c.includes(a.quoteText!) && !c.includes('satya') && !c.includes('2025-01-29') && !c.includes('CEO'));
  });

  await test('K13 usage 부분 누락(PC 재현: prompt만 210)·불완전·이상값 → 정산하지 않고 uncertain(예약 유지·중지·ready 캐시 없음) / total 기준 정상·명시 0·사고 생략 대조군은 정산', async () => {
    const P = { inNano: 750, outNano: 3750 };
    const uncertain: [string, any][] = [
      ['prompt만', { promptTokenCount: 210 }],
      ['prompt+후보(사고·합계 없음)', { promptTokenCount: 210, candidatesTokenCount: 40 }],
      ['prompt+사고(후보·합계 없음)', { promptTokenCount: 210, thoughtsTokenCount: 10 }],
      ['음수 후보', { promptTokenCount: 210, candidatesTokenCount: -1, totalTokenCount: 250 }],
      ['비정수 합계', { promptTokenCount: 210, totalTokenCount: 250.5 }],
      ['NaN 사고', { promptTokenCount: 210, thoughtsTokenCount: NaN, totalTokenCount: 250 }],
      ['합계 < prompt', { promptTokenCount: 210, totalTokenCount: 200 }],
      ['prompt 0', { promptTokenCount: 0, totalTokenCount: 40 }],
      ['prompt 없음', { candidatesTokenCount: 40, totalTokenCount: 250 }],
    ];
    for (const [name, u] of uncertain) assert.strictEqual(costFromUsage(u, P), null, name);
    const settle: [string, any, number, boolean][] = [
      ['정상(사고 생략, total 기준)', { promptTokenCount: 210, candidatesTokenCount: 40, totalTokenCount: 250 }, 210 * 750 + 40 * 3750, false],
      ['명시 0 사고', { promptTokenCount: 210, candidatesTokenCount: 40, thoughtsTokenCount: 0, totalTokenCount: 250 }, 210 * 750 + 40 * 3750, false],
      ['total만', { promptTokenCount: 210, totalTokenCount: 350 }, 210 * 750 + 140 * 3750, false],
      ['total 없음·후보·사고 명시', { promptTokenCount: 210, candidatesTokenCount: 40, thoughtsTokenCount: 100 }, 210 * 750 + 140 * 3750, false],
      ['합계 불일치(큰 쪽·중지)', { promptTokenCount: 210, candidatesTokenCount: 40, thoughtsTokenCount: 0, totalTokenCount: 400 }, 210 * 750 + 190 * 3750, true],
    ];
    for (const [name, u, cost, mismatch] of settle) {
      const c = costFromUsage(u, P)!;
      assert.ok(c, name); assert.strictEqual(c.costNano, cost, name); assert.strictEqual(c.mismatch, mismatch, name);
    }
    // 런타임 경로: prompt만 → uncertain, 예약 전액 유지, 결과 캐시 없음, 추가 생성 중지
    const l = await enabled(); const f = fakeClient({ gen: async () => ({ text: OK_TEXT, modelVersion: 'gemini-3.8-flash-001', usageMetadata: { promptTokenCount: 210 } }) });
    const r = await run([stmt(), stmt('another new quote here please', 'st9')], l, f.c);
    const s = await l.read(); const j = Object.values(s.jobs)[0];
    assert.strictEqual(j.status, 'uncertain'); assert.strictEqual(outstandingNano(s), j.reservedNano); assert.strictEqual(s.months['2026-10'], undefined);
    assert.deepStrictEqual(s.results, {}); assert.ok(s.halted); assert.strictEqual(f.calls.gen, 1); assert.strictEqual(r.uncertain, 1);
  });

  // ------------------------------------------------ 런타임 통합 (가상 인물·가상 IR 기록, 가짜 Gemini)
  function world() {
    const pages = new Map<string, string>();
    const fetchText = async (u: string) => { const p = pages.get(u); if (p === undefined) throw new SourceFetchError('HTTP 503', 503); return p; };
    pages.set('https://blogs.nvidia.com/feed/', rssFeed([])); pages.set('https://blogs.microsoft.com/feed/', rssFeed([])); pages.set('https://blog.google/rss/', rssFeed([]));
    pages.set(LIVE_TRANSCRIPT.url, transcriptPage());
    const backend = new MemoryStateBackend(); const ledger = new MemoryKoLedger(); const clock = { t: NOW };
    const fc = fakeClient();
    const mk = () => new CeoRuntime({
      getEvents: () => [], fetchText, parseFeed: async (): Promise<FeedItem[]> => [], registry: LIVE_REGISTRY, transcripts: [LIVE_TRANSCRIPT],
      getStore: () => new MemoryStateStore(backend), minIntervalMs: 0, headCacheMs: 0, now: () => clock.t, allowExampleData: true,
      koLedger: () => ledger, koClient: () => fc.c,
    });
    return { pages, ledger, clock, fc, mk, backend };
  }

  await test('K10 켜기 전 이력은 소급 처리 0, 켠 뒤 refresh에서 처음 확인된 발언만 처리 / GET은 원장 읽기만(호출·쓰기 0), 재시작 GET도 같은 요약', async () => {
    const w = world();
    await w.mk().refresh(); // 꺼진 상태 → 2건 저장, 호출 0
    assert.strictEqual(w.fc.calls.count + w.fc.calls.gen, 0);
    await w.ledger.configure({ enabled: true, now: w.clock.t + 1 });
    w.clock.t += 60_000;
    await w.mk().refresh(); // 같은 2건 재확인 → 처음 확인 시각이 활성 이전 → 처리 0
    assert.strictEqual(w.fc.calls.gen, 0, 'no backfill');
    w.pages.set(LIVE_TRANSCRIPT.url, transcriptPage().replace('We expect demand to keep growing all year.', 'We expect demand to keep growing all year. We will open three new regions next year.'));
    const lt2 = { ...LIVE_TRANSCRIPT, quotes: [...LIVE_TRANSCRIPT.quotes, 'We will open three new regions next year'] };
    const rt = new CeoRuntime({ ...(w.mk() as any).opts, transcripts: [lt2] });
    w.clock.t += 60_000;
    const r = await rt.refresh();
    assert.strictEqual(r.httpStatus, 200);
    assert.strictEqual(w.fc.calls.gen, 1, 'only the newly verified statement');
    const writes = w.ledger.writes; const before = { ...w.fc.calls };
    const g = await rt.snapshot();
    assert.deepStrictEqual(w.fc.calls, before); assert.strictEqual(w.ledger.writes, writes, 'GET: no ledger writes');
    const withKo = g.dataset!.statements.filter(s => s.koSummary?.status === 'ready');
    assert.strictEqual(withKo.length, 1); assert.strictEqual(withKo[0].quoteText, 'We will open three new regions next year');
    assert.strictEqual(g.koSummary!.state, 'on'); assert.ok(g.koSummary!.spentUsd! > 0 && g.koSummary!.limitUsd === 1);
    const stored = await new MemoryStateStore(w.backend).readState();
    assert.ok(stored!.payload.records.every(x => !('koSummary' in x.statement) && !('translationKo' in x.statement)), 'not persisted in history');
    const g2 = await new CeoRuntime({ ...(rt as any).opts }).snapshot();
    assert.deepStrictEqual(g2.dataset!.statements.map(s => s.koSummary), g.dataset!.statements.map(s => s.koSummary));
  });

  await test('K11 여러 인스턴스가 같은 발언 1건을 동시에 요청 → 유료 호출 1회 / 관리자 설정: 한도 USD 1 초과 거부, 원장 없음 503', async () => {
    const w = world();
    await w.mk().refresh();
    await w.ledger.configure({ enabled: true, now: w.clock.t });
    const id = (await w.mk().snapshot()).dataset!.statements[0].statementId;
    const out = await Promise.all([w.mk().koOne(id), w.mk().koOne(id), w.mk().koOne(id)]);
    assert.ok(out.every(o => o.httpStatus === 200));
    assert.strictEqual(w.fc.calls.gen, 1);
    assert.strictEqual((await w.mk().koConfigure({ limitUsd: 1.01 })).httpStatus, 400);
    assert.strictEqual((await w.mk().koConfigure({ limitUsd: 0.5 })).httpStatus, 200);
    assert.strictEqual((await w.mk().koOne('nope')).httpStatus, 404);
    const none = new CeoRuntime({ ...(w.mk() as any).opts, koLedger: () => null });
    assert.strictEqual((await none.koOne(id)).httpStatus, 503);
    const g = await none.snapshot(); assert.strictEqual(g.koSummary, undefined);
  });

  await test('K12 원장 읽기 실패 → GET은 상태 "알 수 없음"·요약 없음(원문 표시), 발언 목록은 그대로', async () => {
    const w = world();
    await w.mk().refresh();
    const broken = new CeoRuntime({ ...(w.mk() as any).opts, koLedger: () => ({ read: async () => { throw new Error('down'); } }) as any });
    const g = await broken.snapshot();
    assert.strictEqual(g.koSummary!.state, 'unknown'); assert.strictEqual(g.dataset!.statements.length, 2);
    assert.ok(g.dataset!.statements.every(s => !s.koSummary));
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (합성: 가짜 Gemini·메모리 원장 — 실제 SDK·Firestore 통과 아님)`);
  for (const f of failed) console.log(`--- ${f.name}\n${f.error}`);
  finished = true;
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
