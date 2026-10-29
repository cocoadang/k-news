/**
 * CEO 실연동 경로 테스트 (순수: 네트워크 없음, 요청기·피드 파서·이벤트 목록·이력 저장소를 주입).
 * 실행: npx tsx server/ceo/ceoLive.test.ts   (PC 실제 의존성 환경에서는 실제 rss-parser도 함께 확인 — R0)
 * 자료는 전부 가상(liveFixtures.ts). 실존 CEO 발언을 지어내지 않습니다.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { curatedFixturePage } from './testing/curatedFixtures';
import { createQuoteExtractor } from './quoteExtractor';
import { CURATED_TRANSCRIPTS, extractCuratedQuotes, speakerSections, transcriptScope } from './transcripts';
import { htmlToText } from './htmlText';
import { ceoUrlHash } from './urlHash';
import { createFetchText, SourceFetchError } from './fetchText';
import { loadOfficialArticles, FeedItem } from './officialSource';
import { CeoRuntime } from './runtime';
import { CeoStateStore, MemoryStateBackend, MemoryStateStore, StoreError, decideCommit, emptyHead } from './stateStore';
import { runStoreContract } from './testing/storeContract';
import { mapFirestoreError, withTimeout } from './firestoreStateStore';
import { CEO_PERSONS, CEO_ROLES } from './registry';
import { contentHashOf, planExtraction, SourceArticle } from './pipeline';
import { reconcileHistory, statementKey } from './history';
import { CEO_SCHEMA_VERSION, CeoStatement } from '../../src/ceo/types';
import { mergeStatements } from '../../src/ceo/merge';
import {
  ARTICLE_1, ARTICLE_2, BODY_1, BODY_2, FEED_URL_GOOG, FEED_URL_MSFT, FEED_URL_NVDA, LIVE_PERSONS, LIVE_REGISTRY, LIVE_TRANSCRIPT,
  rssFeed, TRANSCRIPT_URL, transcriptPage,
} from './testing/liveFixtures';

// 끝나지 않은 약속 때문에 이벤트 루프가 비어 조용히 종료(코드 0)되는 것을 실패로 처리
let finished = false;
process.on('beforeExit', () => { if (!finished) { console.log('FAIL (테스트가 끝나기 전에 이벤트 루프가 비었습니다 — 멈춘 약속)'); process.exit(3); } });
const results: { name: string; ok: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e: any) { results.push({ name, ok: false, error: e?.stack || String(e) }); console.log(`FAIL ${name}\n  ${e?.message || e}`); }
}

/** 간단 RSS 파서 (테스트용 주입). 운영은 rss-parser — R0에서 실제 의존성으로 같은 결과인지 확인 */
async function simpleParse(xml: string): Promise<FeedItem[]> {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  const tag = (s: string, t: string) => (new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(s)?.[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '');
  return items.map(it => ({ link: tag(it, 'link'), title: tag(it, 'title'), html: tag(it, 'content:encoded'), pubDate: tag(it, 'pubDate') || null }));
}

function makeWorld(opts: { backend?: MemoryStateBackend; clock?: { t: number }; minIntervalMs?: number; leaseMs?: number; deadlineMs?: number; allowExampleData?: boolean } = {}) {
  const pages = new Map<string, string | { status: number }>();
  const calls: string[] = [];
  const hooks: { beforeFetch?: (url: string) => Promise<void> } = {};
  const fetchText = async (url: string) => {
    calls.push(url);
    if (hooks.beforeFetch) await hooks.beforeFetch(url);
    const p = pages.get(url);
    if (p === undefined) throw new SourceFetchError('HTTP 503', 503);
    if (typeof p !== 'string') throw new SourceFetchError(`HTTP ${p.status}`, p.status);
    return p;
  };
  let events = [
    { id: 'evt-1', category: 'AI 가속기 / 반도체', primarySource: { url: ARTICLE_1 } },
    { id: 'evt-2', category: 'AI 가속기 / 반도체', primarySource: { url: ARTICLE_2 } },
  ];
  const feedNvda = (items = [
    { link: ARTICLE_1, title: 'Launch', html: BODY_1, pubDate: 'Thu, 15 Oct 2026 17:00:00 +0000' },
    { link: ARTICLE_2, title: 'Roadmap', html: BODY_2, pubDate: 'Fri, 16 Oct 2026 17:00:00 +0000' },
    { link: 'https://blogs.nvidia.com/blog/not-collected/', title: 'Other', html: BODY_1, pubDate: 'Fri, 16 Oct 2026 17:00:00 +0000' },
  ]) => rssFeed(items);
  pages.set(FEED_URL_NVDA, feedNvda());
  pages.set(FEED_URL_MSFT, rssFeed([]));
  pages.set(FEED_URL_GOOG, rssFeed([]));
  pages.set(TRANSCRIPT_URL, transcriptPage());
  const clock = opts.clock || { t: Date.parse('2026-10-18T00:00:00Z') };
  const backend = opts.backend || new MemoryStateBackend();
  let store: CeoStateStore | null = new MemoryStateStore(backend);
  let extractCalls = 0;
  const mkRuntime = () => {
    const rt = new CeoRuntime({
      getEvents: () => events, fetchText, parseFeed: simpleParse, registry: LIVE_REGISTRY, transcripts: [LIVE_TRANSCRIPT],
      getStore: () => store, minIntervalMs: opts.minIntervalMs ?? 0, leaseMs: opts.leaseMs ?? 300_000, deadlineMs: opts.deadlineMs ?? 120_000,
      headCacheMs: 0, now: () => clock.t, allowExampleData: opts.allowExampleData ?? true,
    });
    const orig = rt.extractor.extract.bind(rt.extractor);
    rt.extractor.extract = async a => { extractCalls++; return orig(a); };
    return rt;
  };
  const runtime = mkRuntime();
  return {
    pages, calls, runtime, mkRuntime, feedNvda, backend, hooks, clock,
    setEvents: (e: typeof events) => { events = e; }, tick: (ms: number) => { clock.t += ms; },
    setStore: (s: CeoStateStore | null) => { store = s; }, extractCalls: () => extractCalls,
  };
}

async function main() {
  // ---------------------------------------------------------------- 기본 부품
  await test('B1 기사 ID = 기존 computeUrlHash와 같은 규칙 (복제본 동일성)', async () => {
    const { computeUrlHash } = await import('../firestore');
    for (const u of [ARTICLE_1, 'HTTPS://Blogs.Nvidia.com/blog/x/?utm=1', 'https://a.example/b//']) assert.strictEqual(ceoUrlHash(u), computeUrlHash(u));
  });
  await test('B2 HTML→평문: 엔티티 해독, head·nav·footer·script 제거, 단락 줄바꿈', () => {
    const t = htmlToText('<html><head><title>T 2026</title></head><nav>N</nav><p>&ldquo;Hi,&rdquo; said A &amp; B.</p><script>x</script><footer>F</footer></html>');
    assert.strictEqual(t, '“Hi,” said A & B.');
  });
  await test('B3 CEO 모듈은 db 싱글턴·기존 Firestore 모듈·수집기·스케줄러·Telegram·기존 Gemini 분석기를 불러오지 않음, Gemini SDK는 한국어 요약 어댑터 1곳만, Firestore SDK는 저장 어댑터·원장의 타입 참조만 (정적 확인)', () => {
    const dir = path.join(process.env.CEO_SRC_ROOT || process.cwd(), 'server/ceo');
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const bad of ["'../db'", "'../firestore'", "'../collector'", "'../scheduler'", "'../telegram'", "'../geminiAnalyzer'"]) {
        assert.ok(!src.includes(bad), `${f} imports ${bad}`);
      }
      // Gemini SDK는 CEO 한국어 요약 전용 어댑터 1곳만 (기존 뉴스 분석 함수는 불러오지 않음)
      if (f !== 'koGeminiClient.ts') assert.ok(!src.includes('@google/genai'), `${f} imports @google/genai`);
      // Firestore SDK는 저장 어댑터·한국어 요약 원장에서 타입으로만 참조(실행 시 import 없음, 인스턴스는 server.ts가 주입)
      const sdk = src.split('\n').filter(l => l.includes('@google-cloud/firestore') && /^\s*import/.test(l));
      if (f === 'firestoreStateStore.ts' || f === 'koLedger.ts') assert.ok(sdk.length === 1 && /^import type /.test(sdk[0]), sdk.join());
      else assert.strictEqual(sdk.length, 0, `${f} imports firestore SDK`);
    }
  });

  // ---------------------------------------------------------------- 피드 인용 추출
  const ex = createQuoteExtractor(LIVE_PERSONS);
  const art = (body: string, extra: Partial<SourceArticle> = {}): SourceArticle => ({ articleId: 'a', title: 't', body: htmlToText(body), sourceName: 's', url: ARTICLE_1, publishedAt: '2026-10-15T17:00:00Z', topicId: 'AI 가속기 / 반도체', ...extra });
  await test('E1 귀속 인용만 추출: said 이름 / 이름 said: 패턴, 부분 인용(called it)·두 인물 공동 귀속은 제외', async () => {
    const r1 = await ex.extract(art(BODY_1));
    const quotes = r1.map(r => r.quoteText);
    assert.ok(quotes.includes('Demand for accelerated computing keeps rising across every industry'));
    assert.ok(quotes.includes('We will ship the next platform on March 3, 2027 for all customers'));
    assert.ok(!quotes.some(q => q?.includes('remarkable year')), 'unattributed partial quote');
    assert.ok(!quotes.some(q => q?.includes('Partnership matters')), 'two speakers in attribution');
    const r2 = await ex.extract(art(BODY_2));
    assert.deepStrictEqual(r2.map(r => r.quoteText), ['Efficiency per watt is now the metric we optimize above all others.'].map(q => q.replace(/[,]\s*$/, '')));
  });
  await test('E2 발언일: 인용 밖 "said … on 날짜"만. dateline·기사일·인용문 안 날짜(출시 예정일)는 발언일 아님', async () => {
    const r = await ex.extract(art(BODY_1));
    const demand = r.find(x => x.quoteText!.startsWith('Demand'))!;
    assert.strictEqual(demand.spokenAt.value, '2026-10-14'); assert.strictEqual(demand.spokenAt.basisExcerpt!.includes('on Oct. 14, 2026'), true);
    const ship = r.find(x => x.quoteText!.startsWith('We will ship'))!;
    assert.strictEqual(ship.spokenAt.precision, 'unknown', 'date inside quote is not the speaking date');
    const r2 = await ex.extract(art(BODY_2));
    assert.strictEqual(r2[0].spokenAt.precision, 'unknown', 'no date phrase → unknown (not article/dateline date)');
  });
  await test('E3 등록되지 않은 이름·성만 일치는 귀속하지 않음', async () => {
    const r = await ex.extract(art('<p>“This is a long enough quote here,” said Mina Parker.</p><p>“Another long enough quote here,” said Park.</p>'));
    assert.strictEqual(r.length, 0);
  });

  // ---------------------------------------------------------------- 선별 IR 기록
  await test('T1 기록 범위·화자 구간: 제목~END, 날짜는 제목~첫 화자 사이에서만, Q&A 포함 모든 다음 화자 라벨이 경계', () => {
    const text = htmlToText(transcriptPage());
    const sc = transcriptScope(text, LIVE_TRANSCRIPT.transcriptTitle)!;
    assert.ok(sc.header.includes('Wednesday January 28, 2026')); assert.ok(!sc.scope.includes('archive'));
    const labels = speakerSections(sc.scope).map(s => s.label);
    assert.deepStrictEqual(labels, ['LEO GRANT', 'ANNA LEE', 'KEITH WRIGHT', 'LEO GRANT']);
    const r = extractCuratedQuotes(LIVE_TRANSCRIPT, text);
    assert.strictEqual(r.items.length, 2); assert.strictEqual(r.items[0].spokenAt.value, '2026-01-28');
  });
  await test('T2 화자 오귀속 차단: 같은 문장이 다른 화자 구간에 있으면 보류', () => {
    const r = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ swapSpeaker: true })));
    assert.strictEqual(r.items.length, 0);
    assert.ok(r.rejected.every(x => x.reason.includes('다른 화자')));
  });
  await test('T3 날짜가 머리·메타·꼬리에만 있으면(본문 날짜 단락 없음) 보류 — 페이지 전체 날짜 검색 금지', () => {
    const r = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ dateParagraph: null })));
    assert.strictEqual(r.items.length, 0); assert.ok(r.rejected[0].reason.includes('행사 날짜'));
    const other = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ dateParagraph: 'Wednesday October 21, 2026' })));
    assert.strictEqual(other.items.length, 0, 'different event date in body');
  });
  await test('T5 같은 제목·행사 날짜가 페이지 다른 영역(관련 행사 목록)이나 화자 발언 안에만 있으면 보류, 기록 머리에 있으면 확인', () => {
    const rel = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ related: true, dateParagraph: null })));
    assert.strictEqual(rel.items.length, 0, 'related-events block title+date must not count'); assert.ok(rel.rejected[0].reason.includes('행사 날짜'));
    const inBody = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ bodyDate: true, dateParagraph: null })));
    assert.strictEqual(inBody.items.length, 0, 'date inside a speaker section must not count');
    const ok = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ related: true })));
    assert.strictEqual(ok.items.length, 2, 'nearest title before first speaker is the transcript title');
  });
  await test('T6 다음 화자 라벨이 혼합 대소문자·직책 괄호·모르는 화자여도 경계로 인식: 그 뒤 인용은 지정 화자에게 귀속하지 않고 보류', () => {
    const base = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage()));
    assert.strictEqual(base.items.length, 2, 'control');
    for (const label of ['Anna Lee', 'ANNA LEE (CFO)', 'Unknown Analyst']) {
      const r = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ nextLabel: label })));
      assert.deepStrictEqual(r.items.map(i => i.quoteText), ['The key metric we are optimizing for is efficiency per dollar'], label);
      assert.strictEqual(r.rejected.length, 1, label); assert.match(r.rejected[0].reason, /다른 화자/, label);
    }
    // 지정 화자 라벨이 혼합 대소문자·직책 괄호로 바뀌어도 같은 화자로 인식
    const own = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage().replace(/<strong>LEO GRANT: <\/strong>/g, '<strong>Leo Grant (CEO): </strong>')));
    assert.strictEqual(own.items.length, 2);
  });
  await test('T7 운영 선별 기록 2건 구조 대조군: 정상 구조는 확인, 다음 화자 라벨이 혼합 대소문자·직책 괄호·모르는 화자면 보류', () => {
    for (const t of CURATED_TRANSCRIPTS) {
      const ok = extractCuratedQuotes(t, htmlToText(curatedFixturePage(t)));
      assert.strictEqual(ok.items.length, t.quotes.length, `${t.sourceId} control: ${JSON.stringify(ok.rejected)}`);
      assert.strictEqual(ok.items[0].spokenAt.value, t.eventDate);
      for (const label of ['Amy Hood', 'AMY HOOD (CFO)', 'Unknown Speaker']) {
        const r = extractCuratedQuotes(t, htmlToText(curatedFixturePage(t, { nextLabel: label })));
        assert.strictEqual(r.items.length, 0, `${t.sourceId} ${label}`);
        assert.ok(r.rejected.every(x => x.reason.includes('다른 화자')), `${t.sourceId} ${label}`);
      }
    }
  });
  await test('T8 날짜 머리도 넓은 화자 경계로 끝남: 제목 뒤 머리 없이 혼합 대소문자·직책·모르는 화자가 다른 행사 날짜를 말하면 발언일로 확정하지 않음', () => {
    for (const label of ['Amy Hood', 'AMY HOOD (CFO)', 'Unknown Analyst', 'AMY HOOD']) {
      const html = transcriptPage({ headerAttack: label });
      const sc = transcriptScope(htmlToText(html), LIVE_TRANSCRIPT.transcriptTitle)!;
      assert.ok(!sc.header.includes('January 28, 2026'), `${label}: header must end at the label`);
      const r = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(html));
      assert.strictEqual(r.items.length, 0, label);
      assert.ok(r.rejected.every(x => x.reason.includes('행사 날짜')), `${label}: ${JSON.stringify(r.rejected)}`);
    }
    // 대조군: 정상 머리(참가자·날짜 단락)는 계속 확인, 운영 선별 기록 2건 구조도 확인
    assert.strictEqual(extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage())).items.length, 2);
    for (const t of CURATED_TRANSCRIPTS) assert.strictEqual(extractCuratedQuotes(t, htmlToText(curatedFixturePage(t))).items.length, t.quotes.length, t.sourceId);
    for (const t of CURATED_TRANSCRIPTS) for (const label of ['Amy Hood', 'AMY HOOD (CFO)', 'Unknown Speaker', 'AMY HOOD']) {
      const r = extractCuratedQuotes(t, htmlToText(curatedFixturePage(t, { headerAttack: label })));
      assert.strictEqual(r.items.length, 0, `${t.sourceId} ${label}`); assert.ok(r.rejected.every(x => x.reason.includes('행사 날짜')));
    }
    // 머리 안의 콜론 라벨(예: 'Participants:')도 같은 경계 → 날짜 단락이 그 뒤면 보류(fail-closed). 실제 원문은 PC의 headerHasEventDate로 확인
    const colon = extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ participants: 'Participants: Leo Grant, Anna Lee' })));
    assert.strictEqual(colon.items.length, 0);
  });
  await test('T4 녹음 통화 문구·제목이 없으면 보류', () => {
    assert.strictEqual(extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ recording: false }))).items.length, 0);
    assert.ok(extractCuratedQuotes(LIVE_TRANSCRIPT, htmlToText(transcriptPage({ title: 'Other Conference Call' }))).rejected[0].reason.includes('제목'));
  });

  // ---------------------------------------------------------------- 공식 피드 어댑터
  await test('S1 기존 기사 URL과 일치하는 피드 항목만, 본문 짧으면 제외, 피드별 결과 보고', async () => {
    const w = makeWorld();
    const { articles, reports } = await loadOfficialArticles([{ id: 'evt-1', category: 'c', primarySource: { url: ARTICLE_1 } }], ['nvda', 'msft', 'googl'],
      { fetchText: async url => { const v = w.pages.get(url); if (typeof v !== 'string') throw new Error('x'); return v; }, parseFeed: simpleParse });
    assert.deepStrictEqual(articles.map(a => a.url), [ARTICLE_1]);
    assert.strictEqual(articles[0].articleId, ceoUrlHash(ARTICLE_1)); assert.strictEqual(articles[0].eventId, 'evt-1');
    const nv = reports.find(r => r.feedUrl === FEED_URL_NVDA)!;
    assert.strictEqual(nv.itemsInFeed, 3); assert.strictEqual(nv.matchedExisting, 1); assert.strictEqual(nv.withBody, 1);
  });

  // ---------------------------------------------------------------- 저장소 계약 (메모리 대역 — 실제 Firestore 통과 아님)
  await runStoreContract(test, 'MEM(대역)', async () => {
    const be = new MemoryStateBackend();
    return { a: new MemoryStateStore(be), b: new MemoryStateStore(be), reopen: () => new MemoryStateStore(be), chunkExists: async id => be.chunks.has(id), withHooks: hk => new MemoryStateStore(be, hk) };
  });
  await test('S2 판단 함수: 토큰·lease가 맞아도 기준 판이 다르면 stale_revision', async () => {
    const h = { ...emptyHead(), revision: 3, fenceToken: 5, lease: { holder: 'x', token: 5, expiresAt: 100 } };
    assert.deepStrictEqual(decideCommit(h, { token: 5, baseRevision: 2, now: 50 }), { ok: false, reason: 'stale_revision' });
    assert.deepStrictEqual(decideCommit(h, { token: 5, baseRevision: 3, now: 50 }), { ok: true });
  });
  await test('S3 읽기 경쟁: head를 읽은 뒤 조각을 읽기 전에 다른 인스턴스가 새 판 저장·옛 조각 삭제 → 재검증·재시도로 새 판을 일관되게 읽음', async () => {
    const be = new MemoryStateBackend(); const a = new MemoryStateStore(be); const b = new MemoryStateStore(be);
    const T = 1_900_000_000_000;
    const res = (tag: string) => ({ status: 'ready' as const, refreshedAt: 'x', sources: [], dataset: { schemaVersion: 2, isExample: true, persons: [], roles: [], topics: [], comparisons: [], heldBackCount: 0, unavailableArticles: { pending: 0, failed: 0 } }, message: tag });
    const l1 = await a.acquire({ holder: 'a', now: T, minIntervalMs: 0, leaseMs: 1000 }); assert.ok(l1.ok);
    assert.ok((await a.commit({ token: l1.token, baseRevision: 0, now: T + 1, payload: { records: [], cache: { entries: { one: {} as any } } }, result: res('r1') })).ok);
    be.betweenHeadAndChunks = async () => {
      const l2 = await b.acquire({ holder: 'b', now: T + 10, minIntervalMs: 0, leaseMs: 1000 }); assert.ok(l2.ok);
      assert.ok((await b.commit({ token: l2.token, baseRevision: 1, now: T + 11, payload: { records: [], cache: { entries: { two: {} as any } } }, result: res('r2') })).ok);
    };
    const st = (await a.readState())!;
    assert.strictEqual(st.head.revision, 2); assert.deepStrictEqual(Object.keys(st.payload.cache.entries), ['two']); assert.strictEqual(st.head.lastResult!.message, 'r2');
    // 조각 손상(해시 불일치)이 계속되면 조용히 빈 값이 아니라 오류
    const anyChunk = [...be.chunks.keys()][0]; be.chunks.set(anyChunk, { ...be.chunks.get(anyChunk)!, data: 'tampered' });
    await assert.rejects(a.readState(), (e: any) => e instanceof StoreError && e.code === 'corrupt');
  });
  await test('S4 Firestore 오류 분류·시간 상한 (순수): 권한 7/16 → permission_denied, 4 → timeout, 14 등 → unavailable', async () => {
    assert.strictEqual(mapFirestoreError({ code: 7, message: 'x' }).code, 'permission_denied');
    assert.strictEqual(mapFirestoreError({ code: 16 }).code, 'permission_denied');
    assert.strictEqual(mapFirestoreError({ code: 4 }).code, 'timeout');
    assert.strictEqual(mapFirestoreError({ code: 14 }).code, 'unavailable');
    assert.strictEqual(mapFirestoreError(new StoreError('too_large', 'x')).code, 'too_large');
    await assert.rejects(withTimeout(new Promise(() => undefined), 20, 'op'), (e: any) => e instanceof StoreError && e.code === 'timeout');
  });

  // ---------------------------------------------------------------- 실행 상태·이력·캐시 (메모리 대역 저장소로 런타임 흐름 확인)
  await test('R1 GET: 저장 전 not_loaded·데이터 없음(예시 대체 없음), 여러 번 호출해도 원문 요청 0·저장소 쓰기 0', async () => {
    const w = makeWorld();
    const s = await w.runtime.snapshot();
    assert.strictEqual(s.status, 'not_loaded'); assert.strictEqual(s.dataset, null); assert.strictEqual(s.historyDurable, false);
    await w.runtime.snapshot(); await w.runtime.snapshot();
    assert.strictEqual(w.calls.length, 0); assert.strictEqual(w.backend.writes, 0);
  });
  await test('R2 새로고침 → 저장 후 200 / 재시작(새 런타임)한 GET이 같은 이력을 원문 요청 없이 복원 / 재시작 뒤 같은 내용 재갱신은 재추출 0', async () => {
    const w = makeWorld();
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 200); assert.strictEqual(r.response.status, 'ready'); assert.strictEqual(r.response.storeRevision, 1);
    const st = r.response.dataset!.statements;
    assert.ok(st.some(s => s.quoteText?.startsWith('Demand for accelerated')));
    assert.ok(st.some(s => s.quoteText === 'The key metric we are optimizing for is efficiency per dollar' && s.spokenAt.value === '2026-01-28'));
    assert.ok(st.every(s => s.verification?.status === 'verified'));
    const fetched = w.calls.length;
    const restarted = w.mkRuntime();
    const g = await restarted.snapshot();
    assert.strictEqual(w.calls.length, fetched, 'GET after restart: no source requests');
    assert.deepStrictEqual(g.dataset!.statements, r.response.dataset!.statements);
    assert.strictEqual(g.storeRevision, 1); assert.strictEqual(g.refreshedAt, r.response.refreshedAt);
    const before = w.extractCalls();
    w.tick(60_000);
    const r2 = await restarted.refresh();
    assert.strictEqual(r2.httpStatus, 200); assert.strictEqual(w.extractCalls(), before, 'persisted cache: unchanged articles not re-extracted');
    assert.strictEqual(restarted.lastRefreshReport!.plan.toExtract.length, 0);
    const ev = g.dataset!.statements.find(s => s.quoteText?.startsWith('Demand'))!.evidence[0];
    assert.ok(ev.url === ARTICLE_1 && ev.articleId === ceoUrlHash(ARTICLE_1) && ev.articleContentHash.length > 0, 'URL/ID/hash preserved');
  });
  await test('R3 본문 변경으로 인용 삭제 → 그 기사만 재추출, 옛 인용 숨김(withdrawn)이 저장되어 재시작 뒤에도 숨김', async () => {
    const w = makeWorld();
    await w.runtime.refresh();
    w.pages.set(FEED_URL_NVDA, w.feedNvda([
      { link: ARTICLE_1, title: 'Launch', html: BODY_1.replace(/<p>“Demand[\s\S]*?summit\.<\/p>/, '<p>Updated paragraph without the remark, long enough to keep the body over the minimum size threshold for testing purposes.</p>'), pubDate: 'Thu, 15 Oct 2026 17:00:00 +0000' },
      { link: ARTICLE_2, title: 'Roadmap', html: BODY_2, pubDate: 'Fri, 16 Oct 2026 17:00:00 +0000' },
    ]));
    w.tick(60_000);
    const r = await w.runtime.refresh();
    assert.deepStrictEqual(w.runtime.lastRefreshReport!.plan.toExtract.map(x => x.reason), ['content_changed']);
    const g = await w.mkRuntime().snapshot();
    assert.ok(!g.dataset!.statements.some(s => s.quoteText?.startsWith('Demand for accelerated')));
    assert.ok(g.dataset!.statements.some(s => s.quoteText?.startsWith('Efficiency per watt')));
    assert.ok(r.response.withdrawnCount! >= 1 && g.withdrawnCount === r.response.withdrawnCount);
  });
  await test('R4 피드 창 밖으로 밀림(rollover) ≠ 삭제: not_rechecked로 저장·계속 표시, 마지막 확인 시각 보존', async () => {
    const w = makeWorld();
    const first = await w.runtime.refresh();
    const firstAt = first.response.dataset!.statements.find(s => s.quoteText?.startsWith('Demand'))!.verification!.lastVerifiedAt;
    w.pages.set(FEED_URL_NVDA, w.feedNvda([{ link: ARTICLE_2, title: 'Roadmap', html: BODY_2, pubDate: 'Fri, 16 Oct 2026 17:00:00 +0000' }]));
    w.tick(60_000);
    await w.runtime.refresh();
    const g = await w.mkRuntime().snapshot();
    const demand = g.dataset!.statements.find(s => s.quoteText?.startsWith('Demand for accelerated'))!;
    assert.strictEqual(demand.verification!.status, 'not_rechecked'); assert.strictEqual(demand.verification!.lastVerifiedAt, firstAt);
    assert.strictEqual(g.withdrawnCount, 0);
  });
  await test('R5 피드 일시 실패 → partial 저장, 그 피드 발언 not_rechecked 유지 / 복구 후 verified', async () => {
    const w = makeWorld();
    await w.runtime.refresh();
    w.pages.delete(FEED_URL_NVDA);
    w.tick(60_000);
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 200); assert.strictEqual(r.response.status, 'partial');
    assert.ok(r.response.dataset!.statements.filter(s => s.evidence[0].url === ARTICLE_1).every(s => s.verification!.status === 'not_rechecked'));
    w.pages.set(FEED_URL_NVDA, w.feedNvda());
    w.tick(60_000);
    const r2 = await w.runtime.refresh();
    assert.strictEqual(r2.response.status, 'ready');
    assert.ok(r2.response.dataset!.statements.every(s => s.verification!.status === 'verified'));
  });
  await test('R6 선별 기록 출처 404 → source_removed(숨김), 503은 not_rechecked 유지', async () => {
    const w = makeWorld();
    await w.runtime.refresh();
    w.pages.set(TRANSCRIPT_URL, { status: 503 });
    w.tick(60_000);
    let r = await w.runtime.refresh();
    assert.ok(r.response.dataset!.statements.some(s => s.quoteText?.includes('efficiency per dollar') && s.verification!.status === 'not_rechecked'));
    w.pages.set(TRANSCRIPT_URL, { status: 404 });
    w.tick(60_000);
    r = await w.runtime.refresh();
    assert.ok(!r.response.dataset!.statements.some(s => s.quoteText?.includes('efficiency per dollar')));
  });
  await test('R7 두 인스턴스 동시 새로고침: lease로 하나만 실행(409 already_running), 원문 요청 1벌 / 전역 최소 간격은 다른 인스턴스에도 429', async () => {
    const w = makeWorld({ minIntervalMs: 600_000 });
    const other = w.mkRuntime();
    let release!: () => void; const gate = new Promise<void>(r => (release = r));
    w.hooks.beforeFetch = async u => { if (u === FEED_URL_NVDA) await gate; };
    const a = w.runtime.refresh();
    await new Promise(r => setTimeout(r, 5));
    const b = await other.refresh();
    assert.strictEqual(b.httpStatus, 409); assert.strictEqual(b.reason, 'already_running');
    release();
    const ra = await a;
    assert.strictEqual(ra.httpStatus, 200);
    assert.strictEqual(w.calls.filter(u => u === FEED_URL_NVDA).length, 1);
    w.tick(60_000);
    const c = await other.refresh();
    assert.strictEqual(c.httpStatus, 429); assert.strictEqual(c.reason, 'too_soon');
    assert.strictEqual(c.response.storeRevision, 1, 'existing state returned');
  });
  await test('R8 모든 출처 실패 → 502, 저장 판·이력 그대로(verified 유지), GET은 실패 시도와 함께 기존 기록 표시 / 다음 성공 시 실패 표시 해제', async () => {
    const w = makeWorld();
    const ok = await w.runtime.refresh();
    const saved = ok.response.dataset!.statements;
    const pages = new Map(w.pages);
    for (const u of [FEED_URL_NVDA, FEED_URL_MSFT, FEED_URL_GOOG, TRANSCRIPT_URL]) w.pages.delete(u);
    w.tick(60_000);
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 502); assert.strictEqual(r.reason, 'all_sources_failed');
    const g = await w.mkRuntime().snapshot();
    assert.strictEqual(g.storeRevision, 1); assert.strictEqual(g.status, 'partial'); assert.match(g.message!, /마지막 갱신 시도/);
    assert.deepStrictEqual(g.dataset!.statements, saved);
    assert.strictEqual(w.backend.head!.lease, null, 'lease released');
    for (const [k, v] of pages) w.pages.set(k, v);
    w.tick(60_000);
    const r2 = await w.runtime.refresh();
    assert.strictEqual(r2.httpStatus, 200); assert.strictEqual(r2.response.status, 'ready'); assert.strictEqual(w.backend.head!.lastAttempt, null);
  });
  await test('R9 늦은 작업 거부(런타임): 작업 중 다른 인스턴스가 만료 후 새 lease 획득 → 옛 작업 commit은 409 fenced, 새 상태를 덮지 않음', async () => {
    const w = makeWorld({ leaseMs: 1_000, deadlineMs: 800 });
    const start = w.clock.t;
    const otherStore = new MemoryStateStore(w.backend);
    let once = true;
    w.hooks.beforeFetch = async () => {
      if (!once) return; once = false;
      // 다른 인스턴스 시계로는 lease가 이미 만료(시계 차이·정지 상황 재현). 이 작업의 시계는 기한 안
      const l = await otherStore.acquire({ holder: 'other', now: start + 1_001, minIntervalMs: 0, leaseMs: 1_000 }); assert.ok(l.ok);
      assert.ok((await otherStore.commit({ token: l.token, baseRevision: 0, now: start + 1_002, payload: { records: [], cache: { entries: {} } },
        result: { status: 'ready', refreshedAt: 'NEWER', sources: [], message: 'NEWER', dataset: { schemaVersion: 2, isExample: true, persons: [], roles: [], topics: [], comparisons: [], heldBackCount: 0, unavailableArticles: { pending: 0, failed: 0 } } } })).ok);
    };
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 409); assert.strictEqual(r.reason, 'fenced');
    assert.strictEqual(w.backend.head!.revision, 1); assert.strictEqual(w.backend.head!.lastResult!.message, 'NEWER');
  });
  await test('R10 기한 초과(느린 원문) → 504, 저장하지 않고 lease 해제', async () => {
    const w = makeWorld({ leaseMs: 1_000, deadlineMs: 800 });
    w.hooks.beforeFetch = async u => { if (u === FEED_URL_NVDA) w.tick(900); };
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 504); assert.strictEqual(w.backend.head!.revision, 0); assert.strictEqual(w.backend.head!.lease, null);
  });
  await test('R11 저장소 장애: GET unavailable·permission·timeout은 오류(이전 사본 없음)/부분 가용(이전 사본 있음), commit 권한 거부 503·시간 초과 504는 기존 판 보존', async () => {
    const w = makeWorld();
    for (const code of ['unavailable', 'permission_denied', 'timeout'] as const) {
      w.backend.faults.push({ op: 'readHead', code });
      const g = await w.mkRuntime().snapshot();
      assert.strictEqual(g.status, 'error'); assert.strictEqual(g.storeError, code); assert.strictEqual(g.dataset, null);
    }
    await w.runtime.refresh();
    await w.runtime.snapshot();
    w.backend.faults.push({ op: 'readHead', code: 'unavailable' });
    const p = await w.runtime.snapshot();
    assert.strictEqual(p.status, 'partial'); assert.strictEqual(p.storeError, 'unavailable'); assert.match(p.message!, /저장소 확인 실패/);
    assert.ok(p.dataset!.statements.length > 0);
    w.tick(60_000);
    w.backend.faults.push({ op: 'commit', code: 'permission_denied' });
    const c = await w.runtime.refresh();
    assert.strictEqual(c.httpStatus, 503); assert.strictEqual(w.backend.head!.revision, 1); assert.strictEqual(w.backend.head!.lease, null);
    assert.match(w.backend.head!.lastAttempt!.message, /permission_denied/);
    w.tick(60_000);
    w.backend.faults.push({ op: 'commit', code: 'timeout' });
    const t = await w.runtime.refresh();
    assert.strictEqual(t.httpStatus, 504); assert.strictEqual(w.backend.head!.revision, 1);
    assert.ok(w.backend.head!.lease, 'timeout: outcome unknown → lease kept until expiry');
  });
  await test('R12 저장 크기 초과 → 413, 기존 판·이력 보존(일부만 저장하거나 지우지 않음)', async () => {
    const w = makeWorld();
    await w.runtime.refresh();
    const before = JSON.stringify(await new MemoryStateStore(w.backend).readState());
    const { STORE_LIMITS } = await import('./stateStore');
    const saved = STORE_LIMITS.totalBytes; STORE_LIMITS.totalBytes = 1_000;
    try {
      w.tick(60_000);
      const r = await w.runtime.refresh();
      assert.strictEqual(r.httpStatus, 413); assert.strictEqual(r.reason, 'store_too_large');
    } finally { STORE_LIMITS.totalBytes = saved; }
    const after = await new MemoryStateStore(w.backend).readState();
    assert.deepStrictEqual(after!.payload, JSON.parse(before).payload); assert.strictEqual(after!.head.revision, 1);
  });
  await test('R13 저장소 없음 → GET 오류(not_configured), POST 503, 메모리로 대신하지 않음 / 가상 인물 자료는 운영 설정에서 저장 차단', async () => {
    const w = makeWorld();
    w.setStore(null);
    const g = await w.runtime.snapshot();
    assert.strictEqual(g.status, 'error'); assert.strictEqual(g.storeError, 'not_configured');
    const r = await w.runtime.refresh(); assert.strictEqual(r.httpStatus, 503); assert.strictEqual(w.calls.length, 0);
    const prod = makeWorld({ allowExampleData: false });
    const b = await prod.runtime.refresh();
    assert.strictEqual(b.httpStatus, 500); assert.strictEqual(b.reason, 'example_data_blocked'); assert.strictEqual(prod.backend.head!.revision, 0);
  });

  await test('R14 다른 인스턴스가 새 판을 저장하면 이 인스턴스의 GET도 새 판으로 바뀜(head 판 확인), 판이 같으면 조각을 다시 읽지 않음', async () => {
    const w = makeWorld();
    const a = w.runtime; const b = w.mkRuntime();
    await a.refresh();
    const g1 = await a.snapshot(); assert.strictEqual(g1.storeRevision, 1);
    w.pages.set(FEED_URL_NVDA, w.feedNvda([{ link: ARTICLE_2, title: 'Roadmap', html: BODY_2, pubDate: 'Fri, 16 Oct 2026 17:00:00 +0000' }]));
    w.tick(60_000);
    assert.strictEqual((await b.refresh()).httpStatus, 200);
    const g2 = await a.snapshot(); assert.strictEqual(g2.storeRevision, 2);
    assert.strictEqual(g2.dataset!.statements.find(s => s.quoteText?.startsWith('Demand'))!.verification!.status, 'not_rechecked');
    let reads = 0; const orig = w.backend.chunks.get.bind(w.backend.chunks);
    w.backend.chunks.get = (k: string) => { reads++; return orig(k); };
    await a.snapshot(); await a.snapshot();
    assert.strictEqual(reads, 0, 'same revision: chunks not re-read');
  });

  await test('R15 다른 출처는 모두 503 + 선별 기록 404 → 삭제 확인은 저장(200 partial, 판 2), 기록 발언 숨김, 재시작 뒤에도 숨김·저장 상태 source_removed', async () => {
    const w = makeWorld();
    const first = await w.runtime.refresh();
    assert.ok(first.response.dataset!.statements.some(s => s.quoteText?.includes('efficiency per dollar') && s.verification!.status === 'verified'));
    for (const u of [FEED_URL_NVDA, FEED_URL_MSFT, FEED_URL_GOOG]) w.pages.delete(u); // 503
    w.pages.set(TRANSCRIPT_URL, { status: 404 });
    w.tick(60_000);
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 200); assert.strictEqual(r.response.status, 'partial'); assert.strictEqual(r.response.storeRevision, 2);
    assert.ok(!r.response.dataset!.statements.some(s => s.quoteText?.includes('efficiency per dollar')));
    assert.match(r.response.message!, /삭제가 확인된/);
    const g = await w.mkRuntime().snapshot();
    assert.strictEqual(g.storeRevision, 2); assert.ok(!g.dataset!.statements.some(s => s.quoteText?.includes('efficiency per dollar')));
    const stored = (await new MemoryStateStore(w.backend).readState())!.payload.records;
    assert.ok(stored.filter(x => x.statement.quoteText?.includes('efficiency per dollar')).every(x => x.status === 'source_removed'));
    // 일시 실패한 피드의 발언은 지우지 않고 not_rechecked로 유지
    assert.ok(g.dataset!.statements.some(s => s.quoteText?.startsWith('Demand') && s.verification!.status === 'not_rechecked'));
  });
  await test('R16 같은 혼합 결과에서 저장(commit)이 실패하면 아무것도 바뀌지 않음(판 1·기록 verified·표시 유지, lease 해제) → 다음 성공 때 숨김 반영', async () => {
    const w = makeWorld();
    await w.runtime.refresh();
    for (const u of [FEED_URL_NVDA, FEED_URL_MSFT, FEED_URL_GOOG]) w.pages.delete(u);
    w.pages.set(TRANSCRIPT_URL, { status: 410 });
    w.tick(60_000);
    w.backend.faults.push({ op: 'commit', code: 'unavailable' });
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 503); assert.strictEqual(w.backend.head!.revision, 1); assert.strictEqual(w.backend.head!.lease, null);
    const stored = (await new MemoryStateStore(w.backend).readState())!.payload.records;
    assert.ok(stored.every(x => x.status === 'verified'), 'no partial write');
    const g = await w.mkRuntime().snapshot();
    assert.ok(g.dataset!.statements.some(s => s.quoteText?.includes('efficiency per dollar')));
    w.tick(60_000);
    const r2 = await w.runtime.refresh();
    assert.strictEqual(r2.httpStatus, 200); assert.strictEqual(w.backend.head!.revision, 2);
    assert.ok(!r2.response.dataset!.statements.some(s => s.quoteText?.includes('efficiency per dollar')));
  });
  await test('R17 모든 출처가 일시 실패(503·기한 등, 404/410 없음)면 502로 저장하지 않고 기존 이력 그대로(verified 유지)', async () => {
    const w = makeWorld();
    await w.runtime.refresh();
    for (const u of [FEED_URL_NVDA, FEED_URL_MSFT, FEED_URL_GOOG]) w.pages.delete(u);
    w.pages.set(TRANSCRIPT_URL, { status: 503 });
    w.tick(60_000);
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 502); assert.strictEqual(w.backend.head!.revision, 1);
    const stored = (await new MemoryStateStore(w.backend).readState())!.payload.records;
    assert.ok(stored.every(x => x.status === 'verified'));
  });

  // ---------------------------------------------------------------- 발언 발생 보존 (같은 문장의 다른 인물·다른 날짜·다른 행사 문맥·실제 반복)
  const ARTICLE_3 = 'https://blogs.nvidia.com/blog/example-repeat/';
  const DEMAND = 'Demand for our products will keep growing';
  const SAME = 'Accelerated computing demand will keep growing every single quarter';
  const START = 'We are only at the start of this platform transition today';
  type Blk = 'summit' | 'investor' | 'leo' | 'dated' | 'replay1' | 'replay2';
  const BLOCKS: Record<Blk, string> = {
    summit: `<p>At the customer summit.</p>\n<p>“${DEMAND},” said Mina Park.</p>`,
    investor: `<p>At a separate investor meeting.</p>\n<p>“${DEMAND},” said Mina Park.</p>`,
    leo: `<p>At the partner day on the west coast.</p>\n<p>“${DEMAND},” said Leo Grant.</p>`,
    dated: `<p>“${SAME},” said Mina Park on Oct. 14, 2026 at the summit.</p>\n<p>“${SAME},” Mina Park said on Oct. 20, 2026 at the investor day.</p>`,
    replay1: `<p>Replay of the keynote.</p>\n<p>“${START},” said Mina Park.</p>`,
    replay2: `<p>Replay of the keynote.</p>\n<p>“${START},” said Mina Park.</p>`,
  };
  const ALL: Blk[] = ['summit', 'investor', 'leo', 'dated', 'replay1', 'replay2'];
  const body = (blocks: Blk[], o: { prefix?: string; edit?: (s: string) => string } = {}) =>
    (o.prefix ?? '') + `<p>Example Chips held several events this month, and leaders spoke to customers and partners about the roadmap ahead.</p>\n`
    + blocks.map(b => (o.edit ? o.edit(BLOCKS[b]) : BLOCKS[b])).join('\n');
  const occWorld = () => {
    const w = makeWorld();
    w.setEvents([{ id: 'evt-3', category: 'AI 가속기 / 반도체', primarySource: { url: ARTICLE_3 } }]);
    const setBody = (html: string) => w.pages.set(FEED_URL_NVDA, rssFeed([{ link: ARTICLE_3, title: 'Events', html, pubDate: 'Wed, 21 Oct 2026 09:00:00 +0000' }]));
    w.pages.set(TRANSCRIPT_URL, { status: 503 }); // 이 묶음은 피드 기사만
    return { w, setBody };
  };
  const ctxOf = (s: { context?: { sources: { excerpt: string }[] } }) => s.context?.sources[0]?.excerpt ?? '-';
  const sig = (st: { personId: string; quoteText?: string; spokenAt: { value: string | null }; context?: { sources: { excerpt: string }[] } }[]) =>
    st.map(s => `${s.personId}|${(s.quoteText || '').replace(/\.$/, '')}|${s.spokenAt.value ?? '미상'}|${ctxOf(s)}`).sort();
  const mineOf = (r: { response: { dataset: { statements: any[] } | null } }) => r.response.dataset!.statements.filter((s: { evidence: { url: string }[] }) => s.evidence[0].url === ARTICLE_3);
  const EXPECT_ALL = [
    `ex-mina-park|${DEMAND}|미상|At the customer summit.`,
    `ex-mina-park|${DEMAND}|미상|At a separate investor meeting.`,
    `ex-leo-grant|${DEMAND}|미상|At the partner day on the west coast.`,
    `ex-mina-park|${SAME}|2026-10-14|-`,
    `ex-mina-park|${SAME}|2026-10-20|-`,
    `ex-mina-park|${START}|미상|Replay of the keynote.`,
    `ex-mina-park|${START}|미상|Replay of the keynote.`,
  ].sort();

  await test('Y1 정확한 반례: 날짜 미상·별도 행사 문맥의 같은 인용·같은 귀속 문장 2회 → 추출 2, 각자 문맥 근거 보존', async () => {
    const ex1 = createQuoteExtractor(LIVE_PERSONS);
    const text = htmlToText(`<p>At the customer summit.</p>\n<p>“${DEMAND},” said Mina Park.</p>\n<p>At a separate investor meeting.</p>\n<p>“${DEMAND},” said Mina Park.</p>`);
    const raw = await ex1.extract(art(text, { articleId: 'r', url: ARTICLE_3 }));
    assert.deepStrictEqual(raw.map(r => `${r.speaker.name}|${r.quoteText}|${r.spokenAt.value ?? '미상'}|${r.context?.excerpts[0]}`),
      [`Mina Park|${DEMAND}|미상|At the customer summit.`, `Mina Park|${DEMAND}|미상|At a separate investor meeting.`]);
  });

  await test('Y2 추출→캐시→검증→이력→저장→재시작: 같은/다른 사람, 같은/다른 명시 날짜, 별도 행사 문맥, 문맥·귀속까지 같은 실제 2회 발생 모두 보존(7건), 보류 0, 키·statementId 충돌 없음', async () => {
    const { w, setBody } = occWorld();
    setBody(body(ALL));
    const r = await w.runtime.refresh();
    assert.strictEqual(r.httpStatus, 200);
    assert.deepStrictEqual(sig(mineOf(r)), EXPECT_ALL);
    assert.strictEqual(r.response.dataset!.heldBackCount, 0);
    const ids = r.response.dataset!.statements.map(s => s.statementId);
    assert.strictEqual(new Set(ids).size, ids.length, 'statementId unique (UI keys)');
    const stored = (await new MemoryStateStore(w.backend).readState())!.payload.records;
    assert.strictEqual(new Set(stored.map(x => x.key)).size, stored.length, 'history keys unique');
    assert.strictEqual(stored.filter(x => x.statement.evidence[0].url === ARTICLE_3 && x.status === 'verified').length, 7);
    const g = await w.mkRuntime().snapshot();
    assert.deepStrictEqual(sig(g.dataset!.statements.filter(s => s.evidence[0].url === ARTICLE_3)), EXPECT_ALL);
  });

  await test('Y3 같은 원문 재조회·앞부분만 변경·문단 순서 변경 → 키와 처음 확인 시각이 각 발생에 그대로(다른 발언에 물려주지 않음), 철회·새 기록 0', async () => {
    const { w, setBody } = occWorld();
    setBody(body(['summit', 'leo', 'dated', 'replay1', 'replay2']));
    const r1 = await w.runtime.refresh();
    const t1 = r1.response.refreshedAt!;
    w.tick(60_000);
    setBody(body(['summit', 'investor', 'leo', 'dated', 'replay1', 'replay2'])); // 투자자 행사 발생 추가
    const r2 = await w.runtime.refresh();
    const t2 = r2.response.refreshedAt!;
    const firstOf = (r: typeof r2, ctx: string) => mineOf(r).filter((s: any) => ctxOf(s) === ctx).map((s: any) => s.verification.firstVerifiedAt);
    assert.deepStrictEqual(firstOf(r2, 'At the customer summit.'), [t1]);
    assert.deepStrictEqual(firstOf(r2, 'At a separate investor meeting.'), [t2]);
    const snap = (r: typeof r2) => sig(mineOf(r)).length + ':' + JSON.stringify(mineOf(r).map((s: any) => [ctxOf(s), s.spokenAt.value, s.personId, s.verification.firstVerifiedAt]).sort());
    const base = snap(r2);
    for (const [label, html] of [
      ['재조회', body(['summit', 'investor', 'leo', 'dated', 'replay1', 'replay2'])],
      ['앞부분 변경', body(['summit', 'investor', 'leo', 'dated', 'replay1', 'replay2'], { prefix: '<p>Editor’s note: this post was updated with a new photo gallery and a correction to a product name.</p>\n' })],
      ['문단 순서 변경', body(['replay2', 'investor', 'dated', 'leo', 'summit', 'replay1'])],
    ] as const) {
      w.tick(60_000); setBody(html);
      const r = await w.runtime.refresh();
      assert.strictEqual(snap(r), base, label);
      assert.strictEqual(r.response.withdrawnCount, 0, label);
      const stored = (await new MemoryStateStore(w.backend).readState())!.payload.records.filter(x => x.statement.evidence[0].url === ARTICLE_3);
      assert.strictEqual(stored.length, 7, `${label}: no record growth`);
    }
  });

  await test('Y4 반복 중 한 건만 수정·삭제 → 그 발생만 숨김, 같은 문장의 다른 발생·다른 문맥은 유지(재시작 뒤에도), 처음 확인 시각 유지', async () => {
    const { w, setBody } = occWorld();
    setBody(body(ALL));
    const r1 = await w.runtime.refresh();
    const t1 = r1.response.refreshedAt!;
    w.tick(60_000);
    // 투자자 행사 발생의 귀속 문구 수정 + 실제 2회 반복 중 하나 삭제 + 다른 인물 발생 삭제
    setBody(body(['summit', 'investor', 'dated', 'replay1'], { edit: s => s.replace('investor meeting.</p>\n<p>“Demand for our products will keep growing,” said Mina Park.', 'investor meeting.</p>\n<p>“Demand for our products will keep growing,” said Mina Park in a written note.') }));
    const r = await w.runtime.refresh();
    const mine = mineOf(r);
    assert.strictEqual(r.response.withdrawnCount, 3, 'investor(수정 전) + replay 1건 + leo');
    assert.deepStrictEqual(sig(mine), [
      `ex-mina-park|${DEMAND}|미상|At the customer summit.`, `ex-mina-park|${DEMAND}|미상|At a separate investor meeting.`,
      `ex-mina-park|${SAME}|2026-10-14|-`, `ex-mina-park|${SAME}|2026-10-20|-`, `ex-mina-park|${START}|미상|Replay of the keynote.`,
    ].sort());
    assert.strictEqual(mine.find((s: any) => ctxOf(s) === 'At the customer summit.').verification.firstVerifiedAt, t1);
    assert.strictEqual(mine.find((s: any) => ctxOf(s) === 'Replay of the keynote.').verification.firstVerifiedAt, t1);
    assert.notStrictEqual(mine.find((s: any) => ctxOf(s) === 'At a separate investor meeting.').verification.firstVerifiedAt, t1, 'edited occurrence is a new statement');
    const g = await w.mkRuntime().snapshot();
    assert.deepStrictEqual(sig(g.dataset!.statements.filter(s => s.evidence[0].url === ARTICLE_3)), sig(mine));
  });

  await test('Y5 확실한 같은 사건 중복은 기존 merge 계약대로만 합침: 같은 eventKey·인물·주제·회사·인용·확정 날짜·같은 문맥이면 근거 합침, 문맥이 다르거나 날짜 미상이면 별도', async () => {
    const { w, setBody } = occWorld();
    setBody(body(ALL));
    const r = await w.runtime.refresh();
    const dated = mineOf(r).find((s: any) => s.spokenAt.value === '2026-10-14') as CeoStatement;
    const twin = (o: Partial<CeoStatement>): CeoStatement => ({ ...dated, statementId: dated.statementId + 'b', evidence: [{ ...dated.evidence[0], articleId: 'other-article', url: 'https://example.invalid/other' }], ...o });
    const a = { ...dated, eventKey: 'e1' };
    assert.strictEqual(mergeStatements([a, twin({ eventKey: 'e1' })]).statements.length, 1, 'same event merged');
    assert.strictEqual(mergeStatements([a, twin({ eventKey: 'e1' })]).statements[0].evidence.length, 2);
    const ctxA = { ...a, context: { text: 'x', sources: [{ articleId: a.evidence[0].articleId, excerpt: 'At the summit.' }] } };
    const ctxB = twin({ eventKey: 'e1', context: { text: 'x', sources: [{ articleId: 'other-article', excerpt: 'A different meeting.' }] } });
    assert.strictEqual(mergeStatements([ctxA, ctxB]).statements.length, 2, 'different context kept separate');
    const unk = { value: null, precision: 'unknown' as const, basisType: 'none' as const };
    assert.strictEqual(mergeStatements([{ ...a, spokenAt: unk }, twin({ eventKey: 'e1', spokenAt: unk })]).statements.length, 2, 'unknown dates never merged');
    assert.strictEqual(mergeStatements([dated, twin({})]).statements.length, 2, 'no eventKey → never merged');
  });

  await test('Y6 캐시 무효화: 추출기 1.2, 이전 1.1·1.0 캐시는 extractor_changed로 다시 추출 / 키 규칙 변경 전 기록(옛 키)도 같은 발생이면 이어짐', async () => {
    const { w, setBody } = occWorld();
    setBody(body(ALL));
    await w.runtime.refresh();
    assert.match(w.runtime.extractor.version, /\+q1\.2\+/);
    const art3 = { articleId: 'a3', title: 't', body: 'b', sourceName: 's', url: ARTICLE_3, publishedAt: null };
    for (const oldV of ['+q1.1+', '+q1.0+']) {
      const old = { entries: { a3: { articleId: 'a3', contentHash: contentHashOf(art3), extractorName: w.runtime.extractor.name, extractorVersion: w.runtime.extractor.version.replace('+q1.2+', oldV), schemaVersion: CEO_SCHEMA_VERSION, status: 'ok' as const, raw: [], attempts: 1, extractedAt: 'x' } } };
      assert.deepStrictEqual(planExtraction([art3], old, w.runtime.extractor).toExtract.map(x => x.reason), ['extractor_changed'], oldV);
    }
    const st = (await new MemoryStateStore(w.backend).readState())!.payload.records;
    const legacy = st.map((x, i) => ({ ...x, key: 'legacy-' + i, firstVerifiedAt: '2026-01-01T00:00:00.000Z' }));
    const again = reconcileHistory({ previous: legacy, current: st.map(x => x.statement), readArticleIds: new Set([ceoUrlHash(ARTICLE_3)]), removedArticleIds: new Set(), now: '2026-10-19T00:00:00.000Z' });
    assert.strictEqual(again.length, st.length);
    assert.ok(again.every(x => x.status === 'verified' && x.firstVerifiedAt === '2026-01-01T00:00:00.000Z'));
  });

  await test('Y7 이력 키 계약(순수): 인물·발언일·문맥이 다르면 다른 키, 본문 해시·발행일은 키에 영향 없음, 완전히 같은 발생이 2번이면 순번으로 둘 다 보존', async () => {
    const { w, setBody } = occWorld();
    setBody(body(ALL));
    const r = await w.runtime.refresh();
    const base = mineOf(r).find((s: any) => ctxOf(s) === 'At the customer summit.') as CeoStatement;
    const k = statementKey(base);
    assert.notStrictEqual(statementKey({ ...base, personId: 'ex-leo-grant' }), k, 'person');
    assert.notStrictEqual(statementKey({ ...base, spokenAt: { value: '2026-10-15', precision: 'day', basisType: 'explicit_in_text' } }), k, 'date');
    assert.notStrictEqual(statementKey({ ...base, context: { text: 'x', sources: [{ articleId: base.evidence[0].articleId, excerpt: 'At a separate investor meeting.' }] } }), k, 'context');
    assert.strictEqual(statementKey({ ...base, evidence: base.evidence.map(e => ({ ...e, articleContentHash: 'changed', articlePublishedAt: '2030-01-01T00:00:00Z' })) }), k, 'hash/published not in key');
    const twice = reconcileHistory({ previous: [], current: [base, { ...base, statementId: 'x2' }], readArticleIds: new Set(), removedArticleIds: new Set(), now: 'n' });
    assert.strictEqual(twice.length, 2); assert.strictEqual(new Set(twice.map(x => x.key)).size, 2);
  });

  // ---------------------------------------------------------------- 요청기 (SSRF·크기·기한)
  await test('F1 허용 호스트·https만, 리다이렉트 매 단계 재검사(다른 호스트·http·메타데이터 주소 거부), 404는 상태 코드 보존', async () => {
    const responses: Record<string, () => Response> = {};
    const fake = (async (u: string) => {
      const r = responses[u];
      if (!r) throw new Error('unexpected ' + u);
      return r();
    }) as unknown as typeof fetch;
    const ft = createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: fake });
    await assert.rejects(ft('https://evil.example/feed'), /host not allowed/);
    await assert.rejects(ft('http://blogs.nvidia.com/feed/'), /host not allowed/);
    responses['https://blogs.nvidia.com/feed/'] = () => new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    await assert.rejects(ft('https://blogs.nvidia.com/feed/'), /host not allowed/);
    responses['https://blogs.nvidia.com/a'] = () => new Response('', { status: 301, headers: { location: '/b' } });
    responses['https://blogs.nvidia.com/b'] = () => new Response('ok', { status: 200 });
    assert.strictEqual(await ft('https://blogs.nvidia.com/a'), 'ok');
    responses['https://blogs.nvidia.com/gone'] = () => new Response('', { status: 404 });
    await assert.rejects(ft('https://blogs.nvidia.com/gone'), (e: any) => e instanceof SourceFetchError && e.httpStatus === 404);
  });
  const H = 'https://blogs.nvidia.com/';
  const streamOf = (chunks: Uint8Array[], opts: { hang?: boolean; track?: { pulls: number; cancelled: boolean } } = {}) => new ReadableStream<Uint8Array>({
    pull(c) {
      if (opts.track) opts.track.pulls++;
      const next = chunks.shift();
      if (next) c.enqueue(next);
      else if (!opts.hang) c.close();
      else return new Promise<void>(() => undefined); // 영원히 다음 조각이 오지 않음(느린 본문)
    },
    cancel() { if (opts.track) opts.track.cancelled = true; },
  });
  const enc = (s: string) => new TextEncoder().encode(s);
  await test('F2 크기 상한은 바이트 기준: maxBytes=3에 "한글"(6바이트) 거부, content-length 없음·속임(2)·다바이트 모두 누적 바이트로 즉시 중단·읽기 취소, 정확히 6바이트 상한이면 통과', async () => {
    for (const headers of [{}, { 'content-length': '2' }] as Record<string, string>[]) {
      const track = { pulls: 0, cancelled: false };
      const fake = (async () => new Response(streamOf([enc('한'), enc('글'), enc('x'.repeat(1000))], { track }), { status: 200, headers })) as unknown as typeof fetch;
      await assert.rejects(createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: fake, maxBytes: 3 })(H), /too large/);
      assert.ok(track.cancelled, 'reader cancelled'); assert.ok(track.pulls <= 3, `stopped early (pulls ${track.pulls})`);
    }
    const ok = (async () => new Response(streamOf([enc('한'), enc('글')]), { status: 200 })) as unknown as typeof fetch;
    assert.strictEqual(await createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: ok, maxBytes: 6 })(H), '한글');
  });
  await test('F3 content-length가 상한보다 크다고 선언되면 본문을 읽지 않고 거부', async () => {
    const track = { pulls: 0, cancelled: false };
    const fake = (async () => new Response(streamOf([enc('a')], { track }), { status: 200, headers: { 'content-length': '5000000' } })) as unknown as typeof fetch;
    await assert.rejects(createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: fake })(H), /declared 5000000/);
    assert.ok(track.cancelled);
  });
  await test('F4 느린 본문: 첫 조각 뒤 멈추면 요청 기한에 중단(fetch가 신호를 무시해도), 전체 기한이 더 이르면 그 기한 적용, 기한이 지났으면 요청 안 함', async () => {
    let n = 0; let gotSignal: AbortSignal | undefined;
    const fake = (async (_u: string, init: RequestInit) => { n++; gotSignal = init.signal as AbortSignal; return new Response(streamOf([enc('<rss>')], { hang: true }), { status: 200 }); }) as unknown as typeof fetch;
    const t0 = Date.now();
    await assert.rejects(createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: fake, timeoutMs: 80 })(H), /deadline exceeded/);
    assert.ok(Date.now() - t0 < 2_000); assert.ok(gotSignal!.aborted, 'abort signal fired');
    const t1 = Date.now();
    await assert.rejects(createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: fake, timeoutMs: 10_000 })(H, { deadline: Date.now() + 60 }), /deadline exceeded/);
    assert.ok(Date.now() - t1 < 2_000, 'overall deadline applied');
    const before = n;
    await assert.rejects(createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: fake })(H, { deadline: Date.now() - 1 }), /deadline exceeded/);
    assert.strictEqual(n, before, 'no request after deadline');
    // 응답 헤더 자체가 오지 않는 경우도 기한에 중단
    const never = (async () => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    await assert.rejects(createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: never, timeoutMs: 50 })(H), /deadline exceeded/);
  });
  await test('F5 리다이렉트 반복(a→b→a…)은 최대 횟수에서 중단, 요청 수 제한', async () => {
    let n = 0;
    const fake = (async (u: string) => { n++; return new Response('', { status: 302, headers: { location: u.endsWith('/a') ? '/b' : '/a' } }); }) as unknown as typeof fetch;
    await assert.rejects(createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: fake, maxRedirects: 3 })('https://blogs.nvidia.com/a'), /too many redirects/);
    assert.strictEqual(n, 4);
  });

  await test('F6 취소(cancel)가 영원히 대기하거나 거부해도 요청은 기한·오류 시점에 끝남: 느린 본문·크기 초과·선언 크기 초과·리다이렉트·오류 응답', async () => {
    const PENDING = Symbol('pending');
    const settle = async (p: Promise<unknown>, ms: number) => {
      const t0 = Date.now();
      const r = await Promise.race([p.then(v => ({ ok: true, v }), e => ({ ok: false, e })), new Promise(r => setTimeout(() => r(PENDING), ms))]);
      return { r, dt: Date.now() - t0 };
    };
    for (const cancelMode of ['never', 'reject'] as const) {
      const body = (chunks: Uint8Array[], hang: boolean) => new ReadableStream<Uint8Array>({
        pull(c) { const n = chunks.shift(); if (n) c.enqueue(n); else if (!hang) c.close(); else return new Promise<void>(() => undefined); },
        cancel() { return cancelMode === 'never' ? new Promise<void>(() => undefined) : Promise.reject(new Error('cancel failed')); },
      });
      const mk = (fn: (u: string) => Response) => createFetchText({ allowHosts: ['blogs.nvidia.com'], fetchImpl: (async (u: string) => fn(u)) as unknown as typeof fetch, timeoutMs: 20, maxBytes: 4 });
      // 느린 본문: 20ms 기한
      let x = await settle(mk(() => new Response(body([enc('<r')], true), { status: 200 }))(H), 300);
      assert.ok(x.r !== PENDING && !(x.r as any).ok && /deadline/.test((x.r as any).e.message), `${cancelMode} slow body ${String((x.r as any)?.e)}`);
      // 크기 초과
      x = await settle(mk(() => new Response(body([enc('한글'), enc('x')], true), { status: 200 }))(H), 300);
      assert.ok(x.r !== PENDING && /too large/.test((x.r as any).e.message), `${cancelMode} size`);
      // 선언 크기 초과
      x = await settle(mk(() => new Response(body([enc('a')], true), { status: 200, headers: { 'content-length': '99' } }))(H), 300);
      assert.ok(x.r !== PENDING && /declared 99/.test((x.r as any).e.message), `${cancelMode} declared`);
      // 리다이렉트 응답 본문 취소가 끝나지 않아도 다음 단계로 진행
      x = await settle(mk(u => (u.endsWith('/r') ? new Response(body([enc('moved')], true), { status: 302, headers: { location: '/ok' } }) : new Response('ok', { status: 200 })))('https://blogs.nvidia.com/r'), 300);
      assert.ok(x.r !== PENDING && (x.r as any).ok && (x.r as any).v === 'ok', `${cancelMode} redirect`);
      // 오류 응답 본문 취소가 끝나지 않아도 상태 코드와 함께 즉시 실패
      x = await settle(mk(() => new Response(body([enc('err')], true), { status: 500 }))(H), 300);
      assert.ok(x.r !== PENDING && (x.r as any).e?.httpStatus === 500, `${cancelMode} error response`);
    }
  });

  // ---------------------------------------------------------------- 운영 등록부
  await test('G1 (ceo7) 운영 등록부: 공식 출처로 확인한 4인·재임 시작(Musk: Tesla 이사회 2004-04, Tesla CEO 2008-10, SpaceX CEO·CTO·의장 2002-05), 이름 변형은 전체 이름만', () => {
    assert.deepStrictEqual(CEO_PERSONS.map(p => p.personId), ['jensen-huang', 'satya-nadella', 'sundar-pichai', 'elon-musk']);
    assert.ok(CEO_PERSONS.every(p => !p.isExample && p.nameVariants.every(n => n.includes(' '))));
    assert.strictEqual(CEO_ROLES.find(r => r.personId === 'satya-nadella')!.start, '2014-02');
    const musk = CEO_ROLES.filter(r => r.personId === 'elon-musk');
    assert.deepStrictEqual(musk.map(r => [r.companyId, r.roleType, r.start, r.end]), [['tsla', 'other', '2004-04', null], ['tsla', 'ceo', '2008-10', null], ['spacex', 'ceo', '2002-05', null]]);
    assert.deepStrictEqual(CEO_ROLES.filter(r => r.companyId === 'spacex').map(r => [r.personId, r.companyName, r.title]), [['elon-musk', 'SpaceX', 'SpaceX CEO·최고기술책임자(CTO)·이사회 의장']]);
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`--- ${f.name}\n${f.error}`);
  finished = true;
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
