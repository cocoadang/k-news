/**
 * ceo6: 선별 공식 페이지(작성글·실적 통화 발언문·발표문)·한국어 번역 사전·운영 판 1 보존 테스트 (순수: 네트워크 없음).
 * 실행: npx tsx server/ceo/ceoPages.test.ts
 * 페이지 구조는 합성 fixture(testing/pageFixtures.ts) — 실제 HTML 검증은 PC에서 testing/parseLocalPages.ts로 분리 보고합니다.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import { CURATED_PAGES, CuratedPage, extractPageQuotes, linkQuoteAttribution, pageArticle, pageScope } from './officialPages';
import { CURATED_TRANSCRIPTS, transcriptArticle } from './transcripts';
import { TRANSLATIONS, translationFor, translationSourceHash, withTranslation } from './translations';
import { htmlToText } from './htmlText';
import { ceoUrlHash } from './urlHash';
import { SourceFetchError } from './fetchText';
import { FeedItem } from './officialSource';
import { CeoRuntime, ceoAllowedHosts, createCompositeExtractor } from './runtime';
import { MemoryStateBackend, MemoryStateStore } from './stateStore';
import { CEO_PERSONS, CEO_ROLES, CEO_TOPICS, FEED_EXTRACTOR_PERSON_IDS } from './registry';
import { buildCeoDataset, contentHashOf, emptyCeoCache, planExtraction, refreshCeoCache, SourceArticle } from './pipeline';
import { reconcileHistory, statementKey } from './history';
import { CeoStatement } from '../../src/ceo/types';
import { buildCeoView } from '../../src/ceo/view';
import { pageFixture as basePageFixture, prodTranscriptFixture } from './testing/pageFixtures';
import { PROD_REV1_FIRST_VERIFIED, PROD_REV1_STATEMENTS } from './testing/productionRev1';
import { rssFeed } from './testing/liveFixtures';

let finished = false;
process.on('beforeExit', () => { if (!finished) { console.log('FAIL (테스트가 끝나기 전에 이벤트 루프가 비었습니다 — 멈춘 약속)'); process.exit(3); } });
const results: { name: string; ok: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e: any) { results.push({ name, ok: false, error: e?.stack || String(e) }); console.log(`FAIL ${name}\n  ${e?.message || e}`); }
}


function pageFixture(p: CuratedPage, o: Parameters<typeof basePageFixture>[1] = {}) {
  const html = basePageFixture(p, o);
  if (!p.sourceId.startsWith('tsla-model-s-')) return html;
  const date = `<div class="article-date">${p.dateExcerpt}</div>`;
  return html.replace(date + '<h1>' + p.pageTitle + '</h1>', '<h1>' + p.pageTitle + '</h1>' + date);
}

const REGISTRY = { persons: CEO_PERSONS, roles: CEO_ROLES, topics: CEO_TOPICS };
const page = (id: string) => CURATED_PAGES.find(p => p.sourceId === id)!;
const [MUSK06, MUSK16, PICHAI_Q1, PICHAI_Q4, HUANG_Q1, HUANG_Q2] = [
  'tsla-master-plan-2006', 'tsla-master-plan-2016', 'googl-q1-2025-remarks', 'googl-q4-2025-remarks', 'nvda-q1-fy2026-release', 'nvda-q2-fy2026-release',
].map(page);
const PROD_SENTENCES = PROD_REV1_STATEMENTS.map(s => s.evidence[0].excerpt);

/** 페이지 1개 → 추출·검증까지 (운영 추출기·파이프라인·실제 등록부) */
async function buildFromPage(p: CuratedPage, html: string) {
  const art = pageArticle(p, htmlToText(html));
  if (!art) return { art: null, statements: [] as CeoStatement[], heldBack: 0 };
  const a: SourceArticle = { ...art, articleId: ceoUrlHash(p.url) };
  const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES);
  const { cache } = await refreshCeoCache([a], emptyCeoCache(), ex);
  const built = await buildCeoDataset([a], cache, REGISTRY, { extractor: ex });
  return { art: a, statements: built.dataset.statements, heldBack: built.dataset.heldBackCount };
}

async function simpleParse(xml: string): Promise<FeedItem[]> {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  const tag = (s: string, t: string) => (new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(s)?.[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '');
  return items.map(it => ({ link: tag(it, 'link'), title: tag(it, 'title'), html: tag(it, 'content:encoded'), pubDate: tag(it, 'pubDate') || null }));
}

/** 운영과 같은 출처 구성(피드 3 + IR 기록 2 + 선별 페이지 6)의 가상 세계. 페이지 내용은 합성 fixture */
function prodWorld(backend = new MemoryStateBackend(), clock = { t: Date.parse('2026-10-18T12:14:00.667Z') }) {
  const pages = new Map<string, string>();
  const calls: string[] = [];
  const fetchText = async (url: string) => {
    calls.push(url);
    const p = pages.get(url);
    if (p === undefined) throw new SourceFetchError('HTTP 503', 503);
    return p;
  };
  pages.set('https://blogs.nvidia.com/feed/', rssFeed([]));
  pages.set('https://blogs.microsoft.com/feed/', rssFeed([]));
  pages.set('https://blog.google/rss/', rssFeed([]));
  CURATED_TRANSCRIPTS.forEach((t, i) => pages.set(t.url, prodTranscriptFixture(t, PROD_SENTENCES[i])));
  for (const p of CURATED_PAGES) pages.set(p.url, pageFixture(p));
  const store = new MemoryStateStore(backend);
  const mk = (withPages: boolean) => new CeoRuntime({
    getEvents: () => [], fetchText, parseFeed: simpleParse, getStore: () => store, pages: withPages ? CURATED_PAGES : [],
    minIntervalMs: 0, headCacheMs: 0, now: () => clock.t,
  });
  return { pages, calls, store, backend, clock, mk };
}

async function main() {
  // ------------------------------------------------------------ 선별 공식 페이지 (합성 fixture)
  await test('P1 (ceo7) 선별 9곳(Google Q2 2026, NASA 2건 추가, 보류 Tesla 2곳도 파서 자체는 그대로) 정상 구조: 출처당 인용 1개만 확인, 근거 구간=원문 인용 그대로, 출처 이름은 발행 조직별(Microsoft 고정 아님)', async () => {
    assert.strictEqual(CURATED_PAGES.length, 11);
    assert.deepStrictEqual(CURATED_PAGES.filter(p => p.hold).map(p => p.sourceId), []);
    assert.ok(CURATED_PAGES.every(p => p.quotes.length === 1), 'each source: exactly 1 quote');
    for (const p of CURATED_PAGES) {
      const r = extractPageQuotes(p, htmlToText(pageFixture(p)));
      assert.deepStrictEqual(r.rejected, [], p.sourceId);
      assert.strictEqual(r.items.length, 1, p.sourceId);
      assert.strictEqual(r.items[0].excerpts[0], p.quotes[0]);
      assert.strictEqual(r.items[0].sourceType, p.kind);
      const a = pageArticle(p, htmlToText(pageFixture(p)))!;
      assert.ok(a.sourceName.startsWith(`${p.orgName} · `) && (p.companyId === 'msft' || !a.sourceName.includes('Microsoft')), a.sourceName);
    }
  });

  await test('P2 Musk 작성글: 발언일은 비움(작성일로 채우지 않음), 작성일은 바이라인 근거로 따로, 2006=이사회 멤버·CEO 취임(2008-10) 전, 2016=CEO', async () => {
    const a = await buildFromPage(MUSK06, pageFixture(MUSK06));
    assert.strictEqual(a.statements.length, 1);
    const s06 = a.statements[0];
    assert.strictEqual(s06.personId, 'elon-musk'); assert.strictEqual(s06.companyId, 'tsla');
    assert.strictEqual(s06.spokenAt.precision, 'unknown'); assert.strictEqual(s06.spokenAt.value, null);
    assert.strictEqual(s06.evidence[0].articlePublishedAt, '2006-08-02T00:00:00.000Z');
    assert.strictEqual(s06.evidence[0].publishedAtBasis!.kind, 'written');
    assert.ok(s06.evidence[0].publishedAtBasis!.excerpt.includes('August 2, 2006') && s06.evidence[0].publishedAtBasis!.excerpt.startsWith('Elon Musk'));
    assert.strictEqual(s06.roleTitleAtTime, '이사회 멤버'); assert.strictEqual(s06.roleStatusAtTime, 'current');
    assert.strictEqual(s06.roleNoteAtTime, 'CEO 취임(2008-10) 전'); assert.strictEqual(s06.roleDateBasis, 'written');
    assert.ok(!s06.roleTitleAtTime.includes('Example Title'), 'byline title not used as role (role from registry tenure)');
    assert.match(s06.provenance![0].label, /바이라인/);
    const b = await buildFromPage(MUSK16, pageFixture(MUSK16));
    const s16 = b.statements[0];
    assert.strictEqual(s16.roleTitleAtTime, 'CEO'); assert.strictEqual(s16.roleNoteAtTime, undefined);
    assert.strictEqual(s16.spokenAt.precision, 'unknown'); assert.strictEqual(s16.evidence[0].articlePublishedAt, '2016-07-20T00:00:00.000Z');
  });

  await test('P3 Musk 반례: 다른 작성자면 보류, 날짜가 메타·꼬리에만 있으면 작성일 미상(직책도 미상), 인용이 목록 항목 전체가 아니면 보류, 같은 인용 2회면 보류', async () => {
    assert.strictEqual(extractPageQuotes(MUSK06, htmlToText(pageFixture(MUSK06, { otherAuthor: true }))).items.length, 0);
    const meta = await buildFromPage(MUSK06, pageFixture(MUSK06, { dateOnlyInMeta: true, dateFarAway: true }));
    assert.strictEqual(meta.statements.length, 0, 'byline date unverified → quote held back (not date-downgraded)');
    const inSentence = extractPageQuotes(MUSK06, htmlToText(pageFixture(MUSK06, { quoteInSentence: true })));
    assert.strictEqual(inSentence.items.length, 0); assert.match(inSentence.rejected[0].reason, /목록 항목/);
    const dup = extractPageQuotes(MUSK06, htmlToText(pageFixture(MUSK06, { duplicateQuote: true })));
    assert.strictEqual(dup.items.length, 0); assert.match(dup.rejected[0].reason, /여러 번/);
    assert.strictEqual(extractPageQuotes(MUSK06, htmlToText(pageFixture(MUSK06, { noTitle: true }))).items.length, 0);
  });

  await test('P4 Pichai 통화 발언문: 연결 문구+작성자+게시일이 모두 있을 때만 행사일=발언일, 근거 provenance 보존', async () => {
    for (const p of [PICHAI_Q1, PICHAI_Q4]) {
      const r = await buildFromPage(p, pageFixture(p));
      assert.strictEqual(r.statements.length, 1, p.sourceId);
      const s = r.statements[0];
      assert.strictEqual(s.personId, 'sundar-pichai');
      assert.strictEqual(s.spokenAt.value, p.date); assert.strictEqual(s.spokenAt.precision, 'day');
      assert.match(s.spokenAt.basis!, /편집자 주/);
      assert.strictEqual(s.evidence[0].publishedAtBasis!.kind, 'posted');
      assert.ok(s.provenance!.some(x => x.label.includes('오늘')) && s.provenance!.some(x => x.excerpt === 'Below is a transcript of his remarks'));
      assert.ok(s.provenance!.some(x => x.excerpt === 'CEO of Google and Alphabet'));
      assert.strictEqual(s.roleStatusAtTime, 'current'); assert.strictEqual(s.roleDateBasis, undefined);
    }
  });

  await test('P5 Pichai 반례: 연결 문구 없으면 발언일 미상(게시일만), 날짜가 메타에만 있으면 게시일도 미상, 인용이 편집자 주 안이면 보류, 다른 작성자 보류, 관련 글 날짜는 쓰지 않음', async () => {
    const noLink = await buildFromPage(PICHAI_Q1, pageFixture(PICHAI_Q1, { noLink: true }));
    assert.strictEqual(noLink.statements[0].spokenAt.precision, 'unknown');
    assert.strictEqual(noLink.statements[0].evidence[0].articlePublishedAt, '2025-04-24T00:00:00.000Z');
    const meta = await buildFromPage(PICHAI_Q4, pageFixture(PICHAI_Q4, { dateOnlyInMeta: true }));
    assert.strictEqual(meta.statements.length, 0, 'metadata-only date → held back');
    const meta2 = await buildFromPage(PICHAI_Q4, pageFixture(PICHAI_Q4, { dateOnlyInMeta: true, dateFarAway: true }));
    assert.strictEqual(meta2.statements.length, 0, 'related-stories date not used → held back');
    const inNote = extractPageQuotes(PICHAI_Q1, htmlToText(pageFixture(PICHAI_Q1, { quoteInNote: true })));
    assert.strictEqual(inNote.items.length, 0); assert.match(inNote.rejected[0].reason, /편집자 주/);
    assert.strictEqual(extractPageQuotes(PICHAI_Q4, htmlToText(pageFixture(PICHAI_Q4, { otherAuthor: true }))).items.length, 0);
  });

  await test('P6 Huang 발표문: 귀속 확인된 인용, 실제 발언일 미상 + 발표문 게시일 따로(분기 종료일 아님), 발표 당시 직책', async () => {
    for (const p of [HUANG_Q1, HUANG_Q2]) {
      const r = await buildFromPage(p, pageFixture(p));
      const s = r.statements[0];
      assert.strictEqual(s.personId, 'jensen-huang');
      assert.strictEqual(s.spokenAt.precision, 'unknown');
      assert.strictEqual(s.evidence[0].articlePublishedAt, `${p.date}T00:00:00.000Z`);
      assert.strictEqual(s.evidence[0].publishedAtBasis!.kind, 'released');
      assert.ok(s.provenance!.some(x => x.excerpt.startsWith('said Jensen Huang, founder and CEO of NVIDIA')));
      assert.strictEqual(s.roleDateBasis, 'released'); assert.strictEqual(s.roleStatusAtTime, 'current');
    }
  });

  await test('P7 Huang 반례: 다른 사람 귀속·따옴표 밖 문장·회사 소개(About) 뒤 인용은 보류, 제목에서 먼 날짜는 게시일로 쓰지 않음', async () => {
    const other = extractPageQuotes(HUANG_Q1, htmlToText(pageFixture(HUANG_Q1, { otherSpeaker: true })));
    assert.strictEqual(other.items.length, 0); assert.match(other.rejected[0].reason, /귀속/);
    const outside = extractPageQuotes(HUANG_Q2, htmlToText(pageFixture(HUANG_Q2, { quoteOutsideQuotes: true })));
    assert.strictEqual(outside.items.length, 0);
    const after = extractPageQuotes(HUANG_Q2, htmlToText(pageFixture(HUANG_Q2, { quoteAfterBoilerplate: true })));
    assert.strictEqual(after.items.length, 0); assert.match(after.rejected[0].reason, /찾지 못함/);
    const far = await buildFromPage(HUANG_Q1, pageFixture(HUANG_Q1, { dateFarAway: true }));
    assert.strictEqual(far.statements.length, 0, 'release date unverified → held back');
  });

  await test('P9 발표문 귀속 연결(합성 반례, 실제 HTML 판정과 별개): 인접 귀속·이어지는 같은 화자만 인정, 다른 화자·미상·사슬·단락 경계·따옴표 모호성은 보류', async () => {
    const p = HUANG_Q2, q = p.quotes[0];
    const run = (para: string) => extractPageQuotes(p, [p.dateExcerpt, p.pageTitle, para, 'About NVIDIA'].join('\n'));
    const J = 'said Jensen Huang, founder and CEO of NVIDIA.';
    const cases: [string, string, number, RegExp?][] = [
      ['A 앞 인용은 다른 사람 귀속, 뒤에 무관한 Huang 인용', `“${q}” said Jane Doe. “An unrelated statement,” ${J}`, 0, /다른 사람\(Jane Doe\)/],
      ['B 귀속 문장 바로 뒤 이어지는 같은 화자 인용', `“A separate opening sentence,” ${J} “${q}”`, 1],
      ['C 통제군: 바로 뒤 귀속', `“${q}” ${J}`, 1],
      ['C2 인용 구간 안 여러 문장(마지막 문장)', `“Invented first sentence. ${q}” ${J}`, 1],
      ['D 사이에 다른 화자 인용이 끼면 이어짐 불인정', `“A,” ${J} “B,” said Jane Doe. “${q}”`, 0, /다른 사람\(Jane Doe\)/],
      ['E 귀속 뒤 다른 서술(미상 화자) 후 인용', `“A separate opening sentence,” ${J} The analyst added: “${q}”`, 0, /귀속이 확인되지 않아/],
      ['E2 인용 뒤 귀속 아닌 서술', `“${q}” the analyst noted, adding that Jensen Huang agreed.`, 0, /미상 화자/],
      ['F 단락 경계: 귀속은 앞 단락, 인용은 다음 단락', `“A separate opening sentence,” ${J}\n“${q}”`, 0, /귀속 문구가 없음/],
      ['G 따옴표 짝 불일치', `“${q}” ${J} “dangling`, 0, /짝이 맞지 않아/],
      ['H 이어짐의 사슬(앞 구간도 귀속 없는 이어짐)', `“A,” ${J} “B.” “${q}”`, 0, /귀속이 확인되지 않아/],
      ['I 인용이 따옴표 밖', `${q} ${J}`, 0, /따옴표 구간 안에 있지 않음/],
      ['J 귀속 앞 위치(이름 said: “…”)는 이번 범위에서 인정하지 않음', `Jensen Huang said: “${q}”`, 0],
    ];
    for (const [name, para, n, re] of cases) {
      const r = run(para);
      assert.strictEqual(r.items.length, n, `${name}: ${JSON.stringify(r.rejected)}`);
      if (re) assert.match(r.rejected[0].reason, re, name);
      if (n === 1) assert.ok(r.items[0].provenance!.some(x => x.excerpt === J), `${name} provenance = adjacent attribution`);
    }
    // B는 검증·데이터셋까지 통과(귀속 근거가 본문에 그대로 있음)
    const html = `<html><body><div>${p.dateExcerpt}</div><h1>${p.pageTitle}</h1><p>NVIDIA (NASDAQ: NVDA) today reported invented figures.</p><p>“A separate opening sentence,” ${J} “${q}”</p><p>About NVIDIA</p></body></html>`;
    const built = await buildFromPage(p, html);
    assert.strictEqual(built.statements.length, 1);
    assert.match(built.statements[0].provenance![0].label, /이어지는 인용/);
    assert.strictEqual(linkQuoteAttribution('“x y z w” said Jensen Huang.', 1, 7, 'Jensen Huang').ok, true);
  });

  await test('P10 작성자 오인 재현(합성): 본문의 이름 언급은 바이라인이 아님 → Musk 작성글·Google 발언문 모두 보류, 정상 바이라인 줄만 인정', async () => {
    const p = MUSK06, q = p.quotes[0];
    const jane = `${p.pageTitle}\nJane Example, ${p.dateExcerpt}\nElon Musk rejected Jane's proposed plan. Jane wrote:\n${q}`;
    const r = extractPageQuotes(p, jane);
    assert.strictEqual(r.items.length, 0); assert.match(r.rejected[0].reason, /바이라인/);
    const art = { ...pageArticle(p, jane)!, articleId: 'qa-page' };
    const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES);
    const { cache } = await refreshCeoCache([art], emptyCeoCache(), ex);
    const built = await buildCeoDataset([art], cache, REGISTRY, { extractor: ex });
    assert.strictEqual(built.dataset.statements.length, 0);
    // 바이라인 줄 뒤에 다른 내용이 붙거나(일부 일치), 이름이 본문 문장 앞에만 있으면 불인정
    assert.strictEqual(extractPageQuotes(p, `${p.pageTitle}\nElon Musk, ${p.dateExcerpt} and Jane Example wrote this\n${q}`).items.length, 0);
    assert.strictEqual(extractPageQuotes(p, `${p.pageTitle}\nElon Musk, Example Title, ${p.dateExcerpt}\n${q}`).items.length, 1, 'control: real byline line');
    // 바이라인 형식의 줄이 본문 뒤쪽에 있어도(인용된 서명 등) 제목 바로 아래 줄이 아니면 불인정
    assert.strictEqual(extractPageQuotes(p, `${p.pageTitle}\nJane Example, ${p.dateExcerpt}\nShe quoted an old note signed:\nElon Musk, Example Title, ${p.dateExcerpt}\n${q}`).items.length, 0);
    // Google: 작성자 이름이 편집자 주 문장 안에만 있으면 보류
    const g = PICHAI_Q1;
    const html = pageFixture(g).replace(`<div class="article-author"><p>${g.bylineExcerpt}</p><p>${g.bylineTitleExcerpt}</p></div>`, '<div class="article-author"><p>Jane Example</p><p>Staff writer</p></div>');
    const rg = extractPageQuotes(g, htmlToText(html));
    assert.strictEqual(rg.items.length, 0); assert.match(rg.rejected[0].reason, /작성자/);
    // Google: 직함과 날짜가 한 줄로 붙으면(구조 변경) 날짜 단독 줄 아님 → 보류
    const joined = pageFixture(PICHAI_Q1).replace(`<p>${g.bylineTitleExcerpt}</p></div><div class="article-meta__date">${g.dateExcerpt}</div>`, `<p>${g.bylineTitleExcerpt} ${g.dateExcerpt}</p></div>`);
    assert.notStrictEqual(joined, pageFixture(PICHAI_Q1));
    assert.strictEqual(extractPageQuotes(g, htmlToText(joined)).items.length, 0);
  });

  await test('P11 구조 변경은 추출 캐시를 무효화(재현): 목록 항목 줄 경계·바이라인/날짜 줄 경계가 바뀌면 본문 해시가 달라져 다시 추출 → 옛 결과로 통과시키지 않음 / 줄 안 공백만 바뀌면 같은 해시', async () => {
    const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES);
    for (const [p, from, to] of [
      [MUSK06, `Invented second step\n${MUSK06.quotes[0]}`, `Invented second step ${MUSK06.quotes[0]}`],
      [PICHAI_Q1, `${PICHAI_Q1.bylineTitleExcerpt}\n${PICHAI_Q1.dateExcerpt}`, `${PICHAI_Q1.bylineTitleExcerpt} ${PICHAI_Q1.dateExcerpt}`],
    ] as [CuratedPage, string, string][]) {
      const t1 = htmlToText(pageFixture(p));
      assert.ok(t1.includes(from), p.sourceId);
      const a1 = { ...pageArticle(p, t1)!, articleId: 'qa-page' };
      const r1 = await refreshCeoCache([a1], emptyCeoCache(), ex);
      assert.strictEqual((await buildCeoDataset([a1], r1.cache, REGISTRY, { extractor: ex })).dataset.statements.length, 1);
      const t2 = t1.replace(from, to);
      const a2 = { ...pageArticle(p, t2)!, articleId: 'qa-page' };
      assert.notStrictEqual(contentHashOf(a1), contentHashOf(a2), `${p.sourceId}: structure change → hash change`);
      const plan = planExtraction([a2], r1.cache, ex);
      assert.deepStrictEqual(plan.reuse, []); assert.strictEqual(plan.toExtract[0].reason, 'content_changed');
      const stale = await buildCeoDataset([a2], r1.cache, REGISTRY, { extractor: ex });
      assert.strictEqual(stale.dataset.statements.length, 0, 'old cache not shown for changed structure');
      const r2 = await refreshCeoCache([a2], r1.cache, ex);
      assert.strictEqual((await buildCeoDataset([a2], r2.cache, REGISTRY, { extractor: ex })).dataset.statements.length, 0, `${p.sourceId}: new parser verdict used`);
      const a3 = { ...a1, body: a1.body.replace(/ /g, '  ') };
      assert.strictEqual(contentHashOf(a3), contentHashOf(a1), 'intra-line whitespace only → same hash');
    }
  });

  await test('P12 실제 공식 구조 최소 재현(PC 실HTML 3건 실패 원인, 합성 최소 fixture): Tesla2006 괄호 부제, Tesla2016 본문 말미 제목 문자열, GoogleQ1 링크 뒤 " ," — 모두 통과, 기존 반례는 계속 보류', async () => {
    const H = (lines: string[]) => `<html><body>${lines.map(l => `<p>${l}</p>`).join('')}</body></html>`;
    // Tesla 2006: 제목 / (just between you and me) / 바이라인
    const t06 = await buildFromPage(MUSK06, H([MUSK06.pageTitle, '(just between you and me)', `Elon Musk, Co-Founder &amp; CEO of Tesla Motors, ${MUSK06.dateExcerpt}`, 'Invented paragraph.', 'Invented first step', MUSK06.quotes[0]]));
    assert.strictEqual(t06.statements.length, 1); assert.strictEqual(t06.statements[0].evidence[0].articlePublishedAt, '2006-08-02T00:00:00.000Z');
    assert.strictEqual(t06.statements[0].roleNoteAtTime, 'CEO 취임(2008-10) 전');
    // 부제가 괄호가 아니거나 2줄이면 불인정, 부제 뒤 Jane 바이라인도 불인정
    assert.strictEqual(extractPageQuotes(MUSK06, [MUSK06.pageTitle, 'just between you and me', `Elon Musk, ${MUSK06.dateExcerpt}`, MUSK06.quotes[0]].join('\n')).items.length, 0);
    assert.strictEqual(extractPageQuotes(MUSK06, [MUSK06.pageTitle, '(a)', '(b)', `Elon Musk, ${MUSK06.dateExcerpt}`, MUSK06.quotes[0]].join('\n')).items.length, 0);
    assert.strictEqual(extractPageQuotes(MUSK06, [MUSK06.pageTitle, '(just between you and me)', `Jane Example, ${MUSK06.dateExcerpt}`, `Elon Musk said this plan was Jane's.`, MUSK06.quotes[0]].join('\n')).items.length, 0);
    // Tesla 2016: 머리 제목·바이라인 … 본문 말미 'Master Plan, Part Deux is:' 줄 뒤 요약 목록
    const t16 = await buildFromPage(MUSK16, H([MUSK16.pageTitle, `Elon Musk, ${MUSK16.dateExcerpt}`, 'Invented body paragraph.', 'So, in short, Master Plan, Part Deux is:', MUSK16.quotes[0], 'Invented second item']));
    assert.strictEqual(t16.statements.length, 1); assert.strictEqual(t16.statements[0].evidence[0].articlePublishedAt, '2016-07-20T00:00:00.000Z');
    // 제목 줄 없이 본문 문장 속 제목 문자열만 있으면(바이라인 없음) 보류
    assert.strictEqual(extractPageQuotes(MUSK16, ['Intro', 'So, in short, Master Plan, Part Deux is:', MUSK16.quotes[0]].join('\n')).items.length, 0);
    // Google Q1: 링크 마크업 뒤 공백(" ,") → 당일 통화 연결 유지, 발언일 확정
    const gq = pageFixture(PICHAI_Q1).replace('On today’s 2025 Q1 earnings call, Google', 'On today’s 2025 Q1 <a href="#">earnings call</a> , Google');
    assert.ok(htmlToText(gq).includes('earnings call , Google'));
    const g = await buildFromPage(PICHAI_Q1, gq);
    assert.strictEqual(g.statements.length, 1); assert.strictEqual(g.statements[0].spokenAt.value, '2025-04-24');
    // 공백 외 문구가 다르면 여전히 연결 실패(발언일 미상)
    const gx = await buildFromPage(PICHAI_Q1, pageFixture(PICHAI_Q1).replace('On today’s 2025 Q1 earnings call, Google', 'On today’s 2025 Q1 earnings call; Google'));
    assert.strictEqual(gx.statements[0].spokenAt.precision, 'unknown');
    // 기존 정상 3개(Q4·NVIDIA 2개) 구조 그대로 통과
    for (const p of [PICHAI_Q4, HUANG_Q1, HUANG_Q2]) assert.strictEqual((await buildFromPage(p, pageFixture(p))).statements.length, 1, p.sourceId);
  });

  await test('P8 피드 인용 추출기는 기존 3인만: 등록부에 Musk가 늘어도 피드 본문의 "said Elon Musk" 인용은 새로 추출하지 않음, 피드 목록 3곳 그대로', async () => {
    assert.deepStrictEqual(FEED_EXTRACTOR_PERSON_IDS, ['jensen-huang', 'satya-nadella', 'sundar-pichai']);
    const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES);
    const raw = await ex.extract({ articleId: 'x', title: 't', body: '“Rockets and cars will keep getting much better every year,” said Elon Musk on Oct. 1, 2026.', sourceName: 's', url: 'https://blogs.nvidia.com/x', publishedAt: null, sourceKind: 'feed' });
    assert.strictEqual(raw.length, 0);
    const hosts = ceoAllowedHosts(Array.from(new Set(CEO_ROLES.map(r => r.companyId))));
    // ceo7: 보류 Tesla 페이지 호스트는 허용 목록에서 빠짐(요청 0). SpaceX 역할이 생겨도 피드(뉴스 검색 피드 포함)는 늘지 않음
    assert.deepStrictEqual(hosts.sort(), ['blog.google', 'blogs.microsoft.com', 'blogs.nvidia.com', 'nvidianews.nvidia.com', 'www.microsoft.com', 'www.nasa.gov', 'www.tesla.com', 'ir.tesla.com'].sort());
    assert.ok(!hosts.includes('news.google.com') && !hosts.includes('www.sec.gov'));
    assert.ok(hosts.includes('ir.tesla.com'), 'Tesla official releases are allowed');
  });

  // ------------------------------------------------------------ 번역 사전
  await test('Q1 번역 사전: 8건 모두 비어 있지 않고, 기록된 해시 = 원문+근거로 다시 계산한 해시, 사용자 확인 전 표시(userConfirmed=false)', () => {
    assert.strictEqual(TRANSLATIONS.length, 8);
    for (const t of TRANSLATIONS) {
      assert.ok(t.ko.trim().length > 0 && /[가-힣]/.test(t.ko), t.id);
      assert.strictEqual(translationSourceHash(t.quote, t.excerpt), t.sourceHash, t.id);
      assert.strictEqual(t.userConfirmed, false);
    }
    assert.strictEqual(new Set(TRANSLATIONS.map(t => t.sourceHash)).size, 8);
  });

  await test('Q2 번역 의미 보존(검토표 기계 점검): 고유명·제품명 원어 유지, 미래·진행 시제 표지, 계획 항목은 실행 사실로 쓰지 않음', () => {
    const ko = (id: string) => TRANSLATIONS.find(t => t.id === id)!.ko;
    assert.match(ko('msft-fy25-q2-nadella'), /될 것입니다/); assert.match(ko('msft-fy25-q2-nadella'), /짐에 따라/);
    assert.match(ko('msft-fy26-q2-nadella'), /tokens per watt per dollar/); assert.match(ko('msft-fy26-q2-nadella'), /하고 있는/);
    assert.match(ko('nvda-q2-fy2026-huang'), /Blackwell/); assert.match(ko('nvda-q1-fy2026-huang'), /NVIDIA/);
    assert.match(ko('googl-q4-2025-pichai'), /보고 있습니다/); assert.match(ko('googl-q1-2025-pichai'), /계속해서/);
    assert.match(ko('tsla-master-plan-2006-musk'), /제공한다/); assert.ok(!/제공했다|제공했/.test(ko('tsla-master-plan-2006-musk')));
    assert.ok(!/만들었|출시했/.test(ko('tsla-master-plan-2016-musk')));
    for (const t of TRANSLATIONS) for (const n of t.quote.match(/\d+/g) || []) assert.ok(t.ko.includes(n), `${t.id} number ${n}`);
  });

  await test('Q3 번역 붙이기: 같은 원문+근거면 reviewed, 근거 구간이 바뀌면 stale(낡은 번역 안 씀), 사전에 없으면 missing, 한국어 원문·직접 인용 아님은 번역 필드 없음', () => {
    const [a] = PROD_REV1_STATEMENTS;
    const t = translationFor(a)!;
    assert.strictEqual(t.status, 'reviewed');
    assert.strictEqual(t.status === 'reviewed' && t.text, TRANSLATIONS[0].ko);
    const changed: CeoStatement = { ...a, evidence: [{ ...a.evidence[0], excerpt: a.evidence[0].excerpt.replace('.', ', and that will change everything.') }] };
    assert.strictEqual(translationFor(changed)!.status, 'stale');
    assert.ok(!('text' in translationFor(changed)!), 'no stale text exposed');
    const other: CeoStatement = { ...a, quoteText: 'Some other verified quote here', evidence: [{ ...a.evidence[0], excerpt: 'Some other verified quote here.' }] };
    assert.strictEqual(translationFor(other)!.status, 'missing');
    assert.strictEqual(translationFor({ ...a, quoteLanguage: 'ko' }), undefined);
    assert.strictEqual(translationFor({ ...a, kind: 'paraphrase' }), undefined);
    // 따옴표 모양만 다른 원문(’ vs ')은 같은 원문으로 봄 (normalizeForMatch 규칙)
    const q4 = TRANSLATIONS.find(x => x.id === 'googl-q4-2025-pichai')!;
    assert.strictEqual(translationSourceHash(q4.quote.replace('’', "'"), q4.excerpt.replace('’', "'")), q4.sourceHash);
  });

  // ------------------------------------------------------------ 운영 판 1 보존
  await test('H1 운영 판 1의 2건: ceo6 추출 결과가 같은 statementId·근거·이력 키 → 처음 확인 시각(2026-10-18T12:14:00.667Z) 그대로 이어짐', async () => {
    const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES);
    const arts: SourceArticle[] = CURATED_TRANSCRIPTS.map((t, i) => ({ ...transcriptArticle(t, htmlToText(prodTranscriptFixture(t, PROD_SENTENCES[i])))!, articleId: ceoUrlHash(t.url) }));
    const { cache } = await refreshCeoCache(arts, emptyCeoCache(), ex);
    const built = await buildCeoDataset(arts, cache, REGISTRY, { extractor: ex });
    const cur = built.dataset.statements;
    assert.strictEqual(cur.length, 2);
    for (const p of PROD_REV1_STATEMENTS) {
      const c = cur.find(x => x.statementId === p.statementId)!;
      assert.ok(c, `statementId ${p.statementId}`);
      assert.strictEqual(c.evidence[0].articleId, p.evidence[0].articleId);
      assert.strictEqual(c.evidence[0].excerpt, p.evidence[0].excerpt);
      assert.strictEqual(c.evidence[0].sourceName, p.evidence[0].sourceName);
      assert.strictEqual(statementKey(c), statementKey(p), 'history key identical');
      assert.strictEqual(c.translationKo, undefined, 'translation not part of extracted/stored statement');
    }
    const previous = PROD_REV1_STATEMENTS.map(s => ({ key: statementKey(s), articleId: s.evidence[0].articleId, statement: s, status: 'verified' as const,
      firstVerifiedAt: PROD_REV1_FIRST_VERIFIED, lastVerifiedAt: PROD_REV1_FIRST_VERIFIED, lastCheckedAt: PROD_REV1_FIRST_VERIFIED }));
    const rec = reconcileHistory({ previous, current: cur, readArticleIds: new Set(arts.map(a => a.articleId)), removedArticleIds: new Set(), now: '2026-10-20T00:00:00.000Z' });
    assert.strictEqual(rec.length, 2);
    assert.ok(rec.every(r => r.status === 'verified' && r.firstVerifiedAt === PROD_REV1_FIRST_VERIFIED && r.lastVerifiedAt === '2026-10-20T00:00:00.000Z'));
  });

  await test('H2 배포 직후(재수집 없음) GET: 판 1의 저장 2건에 검토 번역이 붙고, 원문 요청 0·저장소 쓰기 0·판 번호 그대로, 저장 이력에는 번역이 없음', async () => {
    const w = prodWorld();
    const r1 = await w.mk(false).refresh(); // 운영 판 1과 같은 구성(선별 페이지 없음)으로 저장
    assert.strictEqual(r1.httpStatus, 200); assert.strictEqual(r1.response.storeRevision, 1);
    const calls = w.calls.length;
    const snapBefore = `${w.backend.writes}|${JSON.stringify(w.backend.head)}|${w.backend.chunks.size}`;
    const g = await w.mk(true).snapshot();
    assert.strictEqual(w.calls.length, calls, 'GET: no source requests');
    assert.strictEqual(`${w.backend.writes}|${JSON.stringify(w.backend.head)}|${w.backend.chunks.size}`, snapBefore, 'GET: no store writes');
    assert.strictEqual(g.storeRevision, 1);
    const st = g.dataset!.statements;
    assert.strictEqual(st.length, 2);
    assert.ok(st.every(s => s.translationKo?.status === 'reviewed'));
    assert.deepStrictEqual(st.map(s => s.statementId).sort(), PROD_REV1_STATEMENTS.map(s => s.statementId).sort());
    const stored = await w.store.readState();
    assert.ok(stored!.payload.records.every(r => !('translationKo' in r.statement)), 'translation not persisted');
  });

  await test('H3 (ceo7) 관리자 1회 갱신: 요청 10곳(피드 3+IR 2+페이지 5, 보류 Tesla 0) 각 1회, 판 2, 기존 2건 ID·처음 확인 시각 유지 + 새 5건(7건), Tesla 보고=보류(실패·삭제 아님), 기존 번역 reviewed·새 Google Q2는 번역 없음, 재시작 GET 동일', async () => {
    const w = prodWorld();
    await w.mk(false).refresh();
    const first = (await w.mk(false).snapshot()).dataset!.statements;
    w.calls.length = 0;
    w.clock.t += 2 * 86_400_000;
    const rt = w.mk(true);
    const r = await rt.refresh();
    assert.strictEqual(r.httpStatus, 200, JSON.stringify(r.error));
    assert.strictEqual(r.response.storeRevision, 2);
    assert.strictEqual(w.calls.length, 16); assert.strictEqual(new Set(w.calls).size, 16);
    assert.strictEqual(w.calls.filter(u => u.includes('tesla.com')).length, 4);
    const st = r.response.dataset!.statements;
    assert.strictEqual(st.length, 13);
    for (const p of first) {
      const c = st.find(x => x.statementId === p.statementId)!;
      assert.ok(c); assert.strictEqual(c.verification!.firstVerifiedAt, p.verification!.firstVerifiedAt);
    }
    const q2 = st.filter(s => s.evidence[0].url.includes('alphabet-earnings-q2-2026'));
    assert.strictEqual(q2.length, 1); assert.strictEqual(q2[0].translationKo?.status, 'missing');
    assert.strictEqual(q2[0].spokenAt.value, '2026-07-22');
    assert.ok(st.filter(s => s !== q2[0] && !s.evidence[0].url.includes('nasa.gov') && !s.evidence[0].url.includes('ir.tesla.com')).every(s => s.translationKo?.status === 'reviewed'), st.filter(s => s.translationKo?.status !== 'reviewed').map(s => s.quoteText).join(' | '));
    assert.deepStrictEqual([...new Set(st.map(s => s.personId))].sort(), ['elon-musk', 'jensen-huang', 'satya-nadella', 'sundar-pichai']);
    const pageReps = r.response.sources.filter(x => x.kind === 'page');
    assert.ok(pageReps.filter(x => !x.held).every(x => x.ok && !x.rejectedQuotes));
    assert.deepStrictEqual(pageReps.filter(x => x.held).map(x => [x.ok, x.feedUrl.includes('tesla.com'), /403/.test(x.held!.reason)]), []);
    assert.strictEqual(r.response.status, 'ready');
    assert.strictEqual(r.response.dataset!.heldBackCount, 0);
    const g = await w.mk(true).snapshot();
    assert.deepStrictEqual(g.dataset!.statements, st);
    if (process.env.CEO_DUMP) fs.writeFileSync(process.env.CEO_DUMP, JSON.stringify(g, null, 1));
    // 화면 모델: Musk·Huang 비교는 게시일순(published), Pichai·Nadella는 발언일순(spoken)
    const basis = (personId: string) => buildCeoView(g.dataset!, { personId, sort: 'newest' }).comparison!.basis;
    assert.strictEqual(basis('jensen-huang'), 'released');
    assert.strictEqual(basis('sundar-pichai'), 'spoken'); assert.strictEqual(basis('satya-nadella'), 'spoken');
    const musk = buildCeoView(g.dataset!, { personId: 'elon-musk', companyId: 'spacex', sort: 'newest' });
    assert.strictEqual(musk.dated.length, 2, 'NASA releases enter the timeline using verified release dates');
    assert.strictEqual(musk.comparison!.basis, 'released');
    for (const s of musk.dated) { assert.strictEqual(s.spokenAt.precision, 'unknown'); assert.strictEqual(s.referenceDate?.basis, 'released'); }
  });

  await test('H4 다시 같은 내용으로 갱신(재시작 후): 재추출 0, 이력 그대로 / 선별 페이지 원문이 바뀌면 그 출처만 다시 추출하고 바뀐 인용은 숨김(번역도 붙지 않음)', async () => {
    const w = prodWorld();
    await w.mk(true).refresh();
    w.clock.t += 86_400_000;
    const rt2 = w.mk(true);
    const r2 = await rt2.refresh();
    assert.strictEqual(rt2.lastRefreshReport!.plan.toExtract.length, 0);
    assert.strictEqual(r2.response.dataset!.statements.length, 13);
    w.pages.set(HUANG_Q2.url, pageFixture(HUANG_Q2, { quoteOverride: 'The AI race is on, and Blackwell is the platform at its very center.' }));
    w.clock.t += 86_400_000;
    const rt3 = w.mk(true);
    const r3 = await rt3.refresh();
    assert.deepStrictEqual(rt3.lastRefreshReport!.plan.toExtract.map(x => x.reason), ['content_changed']);
    const st = r3.response.dataset!.statements;
    assert.strictEqual(st.length, 12);
    assert.ok(!st.some(s => s.quoteText?.includes('very center')));
    assert.ok(r3.response.sources.find(x => x.feedUrl === HUANG_Q2.url)!.rejectedQuotes!.length === 1);
    assert.strictEqual(r3.response.withdrawnCount, 1);
  });

  await test('H5 선별 페이지 일시 오류(503) → 그 출처 발언은 이전 확인 기록 유지(not_rechecked), 부분 가용 (404 숨김은 기존 R6·R15와 같은 경로)', async () => {
    const w = prodWorld();
    await w.mk(true).refresh();
    w.pages.delete(HUANG_Q1.url); // 503 (ceo7: Tesla는 보류라 요청하지 않으므로 다른 선별 페이지로 확인)
    w.clock.t += 86_400_000;
    const r = await w.mk(true).refresh();
    const m = r.response.dataset!.statements.find(s => s.evidence[0].url === HUANG_Q1.url)!;
    assert.strictEqual(m.verification!.status, 'not_rechecked');
    assert.strictEqual(r.response.status, 'partial');
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`--- ${f.name}\n${f.error}`);
  finished = true;
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
