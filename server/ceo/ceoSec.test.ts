/**
 * ceo7: SEC 제출 문서 검증 인용·Google Q2 2026·Tesla 보류·SpaceX 역할·요청 상한·한국어 요약 문맥 테스트 (순수: 네트워크 없음).
 * 실행: npx tsx server/ceo/ceoSec.test.ts
 * 전부 합성 fixture(testing/secFixtures.ts, testing/pageFixtures.ts)와 가짜 요청기·메모리 저장소/원장입니다.
 * 실제 SEC·Google 원본 바이트 검증은 PC에서 testing/parseLocalSec.ts·parseLocalPages.ts로 따로 합니다(이 테스트 통과 ≠ 실제 원문 통과).
 */
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { CURATED_SEC_EXHIBITS, CuratedSecExhibit, extractSecQuotes, PC_TODO, SEC_USER_AGENT, secArticle, secReady } from './secExhibits';
import { CURATED_PAGES, CuratedPage, extractPageQuotes, pageArticle } from './officialPages';
import { CURATED_TRANSCRIPTS } from './transcripts';
import { htmlToText } from './htmlText';
import { ceoUrlHash } from './urlHash';
import { createFetchBytes, createFetchText, SourceFetchError } from './fetchText';
import { ceoFeeds, FeedItem } from './officialSource';
import { CeoRuntime, createCompositeExtractor, DEFAULT_MAX_SOURCE_REQUESTS, feedCompanyIds } from './runtime';
import { MemoryStateBackend, MemoryStateStore } from './stateStore';
import { CEO_PERSONS, CEO_ROLES, CEO_TOPICS, FEED_COMPANY_IDS } from './registry';
import { buildCeoDataset, emptyCeoCache, refreshCeoCache, SourceArticle } from './pipeline';
import { MemoryKoLedger } from './koLedger';
import { KoClient, koContents, koJobKey } from './koSummary';
import { TRANSLATIONS } from './translations';
import { CeoStatement } from '../../src/ceo/types';
import { A_SYN, aEntry, aPages, B_SYN, bEntry, bPages, bytesOf, secHtml, sha } from './testing/secFixtures';
import { pageFixture as basePageFixture, prodTranscriptFixture } from './testing/pageFixtures';
import { PROD_REV1_STATEMENTS } from './testing/productionRev1';
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
const Q2 = CURATED_PAGES.find(p => p.sourceId === 'googl-q2-2026-remarks')!;
const HTML_A = secHtml(aPages()), HTML_B = secHtml(bPages());
const ENTRY_A = aEntry(HTML_A), ENTRY_B = bEntry(HTML_B);

/** SEC 문서 1개 → 바이트 검증 → 추출 → 파이프라인 검증까지 */
async function buildSec(e: CuratedSecExhibit, html: string) {
  const r = secArticle(e, bytesOf(html));
  if (r.ok === false) return { held: r.reason, statements: [] as CeoStatement[], rejected: [] as { reason: string }[] };
  const a: SourceArticle = { ...r.article, articleId: ceoUrlHash(e.url) };
  const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES, [e]);
  const { cache } = await refreshCeoCache([a], emptyCeoCache(), ex);
  const built = await buildCeoDataset([a], cache, REGISTRY, { extractor: ex });
  return { held: null, statements: built.dataset.statements, rejected: extractSecQuotes(e, r.article.body).rejected, heldBack: built.dataset.heldBackCount };
}
const reasonOf = async (e: CuratedSecExhibit, html: string) => {
  const b = await buildSec(e, html);
  return b.held ?? b.rejected.map(x => x.reason).join(' | ');
};

async function simpleParse(xml: string): Promise<FeedItem[]> {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  const tag = (s: string, t: string) => (new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(s)?.[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, '');
  return items.map(it => ({ link: tag(it, 'link'), title: tag(it, 'title'), html: tag(it, 'content:encoded'), pubDate: tag(it, 'pubDate') || null }));
}

/** 운영과 같은 출처 구성(피드 3 + IR 2 + 선별 페이지 7(보류 2) + SEC 2)의 가상 세계 */
function world(o: { sec?: CuratedSecExhibit[]; cap?: number; pages?: CuratedPage[] } = {}) {
  const pages = new Map<string, string>();
  const secDocs = new Map<string, Uint8Array | SourceFetchError>();
  const calls: string[] = []; const secCalls: string[] = [];
  const clock = { t: Date.parse('2026-10-18T12:14:00.667Z') };
  const fetchText = async (url: string) => {
    calls.push(url);
    const p = pages.get(url);
    if (p === undefined) throw new SourceFetchError('HTTP 503', 503);
    return p;
  };
  const fetchSecBytes = async (url: string) => {
    secCalls.push(url);
    const d = secDocs.get(url);
    if (d === undefined) throw new SourceFetchError('HTTP 503', 503);
    if (d instanceof SourceFetchError) throw d;
    return d;
  };
  for (const f of ['https://blogs.nvidia.com/feed/', 'https://blogs.microsoft.com/feed/', 'https://blog.google/rss/']) pages.set(f, rssFeed([]));
  const sentences = PROD_REV1_STATEMENTS.map(s => s.evidence[0].excerpt);
  CURATED_TRANSCRIPTS.forEach((t, i) => pages.set(t.url, prodTranscriptFixture(t, sentences[i])));
  for (const p of CURATED_PAGES) pages.set(p.url, pageFixture(p)); // 보류 Tesla도 응답은 준비(요청되면 안 됨)
  secDocs.set(ENTRY_A.url, bytesOf(HTML_A)); secDocs.set(ENTRY_B.url, bytesOf(HTML_B));
  const backend = new MemoryStateBackend();
  const store = new MemoryStateStore(backend);
  const ledger = new MemoryKoLedger();
  const ko = { count: 0, gen: 0, contents: [] as string[] };
  const client: KoClient = {
    countTokens: async ({ contents }) => { ko.count++; ko.contents.push(contents); return { totalTokens: 200 }; },
    generate: async () => { ko.gen++; return { text: JSON.stringify({ title: '합성 제목', summary: '합성 요약 문장입니다.' }), modelVersion: 'gemini-3.8-flash-001',
      usageMetadata: { promptTokenCount: 210, candidatesTokenCount: 40, thoughtsTokenCount: 10, totalTokenCount: 260 } }; },
  };
  const mk = (over: { sec?: CuratedSecExhibit[]; pages?: CuratedPage[]; withKo?: boolean } = {}) => new CeoRuntime({
    getEvents: () => [], fetchText, fetchSecBytes, parseFeed: simpleParse, getStore: () => store,
    pages: over.pages ?? o.pages ?? CURATED_PAGES, secExhibits: over.sec ?? o.sec ?? [ENTRY_A, ENTRY_B], maxSourceRequests: o.cap,
    minIntervalMs: 0, headCacheMs: 0, now: () => clock.t,
    ...(over.withKo ? { koLedger: () => ledger, koClient: () => client } : {}),
  });
  return { pages, secDocs, calls, secCalls, store, backend, clock, mk, ledger, ko };
}

async function main() {
  // ------------------------------------------------------------ SEC 바이트 단계
  await test('S1 문서 B(합성, 실제 구조 IMG>DIV>FONT·대문자 표기): SHA·UTF-8·Exhibit B 이후 지정 페이지 1회 → 인용 1건, 발언일 2026-06-04(도입 "June 4, 2026"+"conducted a video interview"), SpaceX 당시 역할, 근거 = 질문 표기+질문+머스크 표기+인용 연속 구간(600자 이하), 인용문은 머스크 문장만', async () => {
    const b = await buildSec(ENTRY_B, HTML_B);
    assert.strictEqual(b.held, null); assert.deepStrictEqual(b.rejected, []);
    assert.strictEqual(b.statements.length, 1);
    const s = b.statements[0];
    assert.strictEqual(s.personId, 'elon-musk'); assert.strictEqual(s.companyId, 'spacex');
    assert.strictEqual(s.roleTitleAtTime, 'SpaceX CEO·최고기술책임자(CTO)·이사회 의장'); assert.strictEqual(s.roleStatusAtTime, 'current');
    assert.deepStrictEqual([s.spokenAt.value, s.spokenAt.precision, s.spokenAt.basisType], ['2026-06-04', 'day', 'explicit_in_text']);
    assert.ok(s.spokenAt.basisExcerpt!.includes('June 4, 2026') && s.spokenAt.basisExcerpt!.includes('conducted a video interview') && !s.spokenAt.basisExcerpt!.includes('June 5'));
    assert.strictEqual(s.sourceType, 'filed_transcript');
    assert.strictEqual(s.quoteText, 'We think it’s easier than building communication satellites');
    const ev = s.evidence[0].excerpt;
    assert.strictEqual(ev, `JAMIE DIMON: ${B_SYN.question} ELON MUSK: We think it’s easier than building communication satellites.`);
    assert.ok(ev.length <= 600 && ev.indexOf('JAMIE DIMON:') < ev.indexOf('AI data centers in space') && ev.indexOf('AI data centers in space') < ev.indexOf('ELON MUSK:'), 'question precedes the Musk label (not attributed to Musk)');
    assert.ok(!s.quoteText!.includes('data centers'));
    // SEC 제출 문서는 문서 게시일을 따로 채우지 않음(publishedAt null): 인터뷰 날짜·Accepted 시각을 게시일로 쓰지 않음
    assert.strictEqual(s.evidence[0].articlePublishedAt, null, 'filing date is not stored; interview date and Accepted timestamp are never used as publication date');
    assert.strictEqual(s.evidence[0].publishedAtBasis, undefined);
    assert.strictEqual(s.context, undefined, 'no separate context branch');
    assert.ok(s.provenance!.some(p => /편집된 전사 고지/.test(p.label) && p.excerpt === 'Transcript slightly edited for clarity.'));
    assert.ok(s.provenance!.some(p => p.excerpt === 'ELON MUSK:'));
  });

  await test('S2 문서 A(합성): 발언일 미상 유지 + 영상 게시일 2026-06-08은 "posted on X"+Elon Musk·Dan Huot·Ian Dahl·Exhibit B 구간만 provenance로(같은 날짜 다른 인터뷰 재게시 문장은 쓰지 않음), 문서 게시일 필드 비움, SpaceX 역할(상태 미상)', async () => {
    const b = await buildSec(ENTRY_A, HTML_A);
    assert.strictEqual(b.statements.length, 1, String(b.held) + JSON.stringify(b.rejected));
    const s = b.statements[0];
    assert.deepStrictEqual([s.spokenAt.value, s.spokenAt.precision], [null, 'unknown']);
    assert.match(s.spokenAt.basis!, /영상 게시일 2026-06-08은 발언일이 아님/);
    const v = s.provenance!.find(p => /영상 게시일.*실제 발언일 아님/.test(p.label))!;
    assert.strictEqual(v.excerpt, 'Elon Musk by Dan Huot and Ian Dahl was posted on X on June 8, 2026 and is attached as Exhibit B');
    assert.ok(!v.excerpt.includes('CFO') && !v.excerpt.includes('Exhibit A'), 'repost sentence of another interview not used');
    assert.strictEqual(s.evidence[0].articlePublishedAt, null, '문서 게시일 필드 비움');
    assert.deepStrictEqual(s.referenceDate, { value: '2026-06-08', precision: 'day', basis: 'video' }, '타임라인 위치는 영상 게시일(발언일 아님)');
    assert.strictEqual(s.evidence[0].excerpt, ENTRY_A.quote, 'no context turn for A: evidence = quote sentence');
    assert.strictEqual(s.companyId, 'spacex'); assert.strictEqual(s.roleTitleAtTime, 'SpaceX CEO·최고기술책임자(CTO)·이사회 의장'); assert.strictEqual(s.roleStatusAtTime, 'unknown');
    assert.strictEqual(s.roleDateBasis, undefined, 'video date is never used as a role date');
    assert.strictEqual(s.quoteText, 'Yeah, now the AI satellite is actually much simpler than a Starlink satellite');
    // 재게시 문장에도 'posted on X'가 있고 이름이 멀면 그 구간은 상한 밖 → 정확히 하나만 / 이름이 붙은 구간이 둘이면 모호 → 보류
    const twoPosts = secHtml(aPages({ introText: `${A_SYN.intro} ${'Invented filler sentence. '.repeat(20)}A CFO interview was also posted on X on June 8, 2026.` }));
    assert.strictEqual((await buildSec(aEntry(twoPosts), twoPosts)).statements.length, 1);
    const ambiguous = secHtml(aPages({ introText: `${A_SYN.intro} Elon Musk, Dan Huot and Ian Dahl clip posted on X on June 8, 2026, also in Exhibit B.` }));
    assert.match(await reasonOf(aEntry(ambiguous), ambiguous), /여럿/);
  });

  await test('S3 원문 SHA·크기 불일치(1바이트 변경·고정 SHA 다름)·UTF-8 엄격 실패 → 재검토 필요 보류(인용 0)', async () => {
    const bytes = bytesOf(HTML_B); const changed = bytesOf(HTML_B.replace('launch cadence', 'launch cadencE'));
    assert.strictEqual(changed.byteLength, bytes.byteLength);
    const r1 = secArticle(ENTRY_B, changed); assert.ok(r1.ok === false && /재검토 필요/.test(r1.reason));
    const r2 = secArticle({ ...ENTRY_B, rawSha256: CURATED_SEC_EXHIBITS[1].rawSha256 }, bytes); assert.ok(r2.ok === false && /고정본과 다름/.test(r2.reason));
    const bad = new Uint8Array([...bytes.slice(0, 50), 0xff, 0xfe, ...bytes.slice(50)]);
    const r3 = secArticle({ ...ENTRY_B, rawBytes: bad.byteLength, rawSha256: sha(bad) }, bad); assert.ok(r3.ok === false && /UTF-8/.test(r3.reason));
    assert.ok(secArticle(ENTRY_B, bytes).ok);
  });

  await test('S4 잘못된 이미지 페이지·이미지 누락·Exhibit A(CFO·투자설명서) 범위 인용·Exhibit A에도 같은 인용 → 보류', async () => {
    assert.match(await reasonOf({ ...ENTRY_B, quoteImage: 'eu_interviewtranscript06406.jpg' }, HTML_B), /지정 이미지.*페이지 텍스트층에 있지 않음/);
    assert.match(await reasonOf({ ...ENTRY_B, quoteImage: 'eu_interviewtranscript06499.jpg' }, HTML_B), /정확히 1번/);
    const inA = secHtml(bPages({ quoteInExhibitA: true }));
    assert.match(await reasonOf(bEntry(inA, { quoteImage: 'eu_interviewtranscript06002.jpg' }), inA), /Exhibit B 시작 뒤가 아님/);
    assert.match(await reasonOf(bEntry(inA), inA), /지정 이미지/);
    const both = secHtml(bPages({ quoteAlsoInExhibitA: true }));
    assert.match(await reasonOf(bEntry(both), both), /2번/);
    const aCfo = secHtml(aPages());
    assert.match(await reasonOf(aEntry(aCfo, { quoteImage: 'fwp_cfointerview002.jpg' }), aCfo), /Exhibit B 시작 뒤가 아님|지정 이미지/);
  });

  await test('S5 다른 화자·같은 인용, 화자 경계 불일치, Exhibit B 참여자 순서·편집 고지 불일치 → 보류 (다른 사람에게 귀속하지 않음)', async () => {
    const other = secHtml(bPages({ quoteSpeaker: 'JAMIE DIMON' }));
    assert.match(await reasonOf(bEntry(other), other), /지정 화자\(Elon Musk\)가 아님/);
    const maye = secHtml(bPages({ quoteSpeaker: 'MAYE MUSK' }));
    assert.match(await reasonOf(bEntry(maye), maye), /지정 화자\(Elon Musk\)가 아님\(MAYE MUSK\)/, 'same surname is not the same speaker');
    const wrongPrev = secHtml(bPages({ prevSpeaker: 'IAN DAHL' }));
    assert.match(await reasonOf(bEntry(wrongPrev, { contextTurn: undefined }), wrongPrev), /앞 화자 경계/);
    assert.match(await reasonOf({ ...ENTRY_B, turns: { before: 'Jamie Dimon', after: 'Mary Erdoes' } }, HTML_B), /뒤 화자 경계/);
    assert.match(await reasonOf({ ...ENTRY_B, speakerLabel: 'Jamie Dimon' }, HTML_B), /지정 화자/);
    const rev = secHtml(bPages({ participantsReversed: true }));
    assert.match(await reasonOf(bEntry(rev), rev), /참여자 표기.*순서/);
    const noNotice = secHtml(bPages({ noNotice: true }));
    assert.match(await reasonOf(bEntry(noNotice), noNotice), /편집된 전사 고지/);
    // 앞 문장 끝 대문자 단어가 붙어도 알려진 표기만 화자로 / 혼합 대소문자 'Note:'는 표기가 아님
    const glued = secHtml(bPages({ quotePrefix: '' }).map(p => p.img === 'eu_interviewtranscript06407.jpg' ? { ...p, text: p.text.replace('ground? ELON MUSK:', 'ground in the USA. ELON MUSK:').replace('JAMIE DIMON: Invented', 'JAMIE DIMON: Note: Invented') } : p));
    assert.strictEqual((await buildSec(bEntry(glued), glued)).statements.length, 1);
  });

  await test('S6 부분 문장(문장 중간 시작·끝나지 않음·뒤로 이어짐) → 보류', async () => {
    assert.match(await reasonOf({ ...ENTRY_B, quote: 'it’s easier than building communication satellites.' }, HTML_B), /부분 문장/);
    assert.match(await reasonOf({ ...ENTRY_B, quote: 'We think it’s easier than building communication' }, HTML_B), /부분 문장/);
    const mid = secHtml(bPages({ quotePrefix: 'Honestly ' }));
    assert.match(await reasonOf(bEntry(mid), mid), /부분 문장|첫머리/);
    const aMid = secHtml(aPages({ quotePrefix: 'and so ' }));
    assert.match(await reasonOf(aEntry(aMid), aMid), /부분 문장|첫머리/);
  });

  await test('S7 질문 오귀속 방지: 문맥 앵커가 머스크 구간에 있으면 보류, 질문자≠앞 화자면 보류, 앵커 없음 보류, 질문+인용 600자 초과 보류', async () => {
    const inMusk = secHtml(bPages({ anchorInMuskTurn: true }));
    assert.match(await reasonOf(bEntry(inMusk), inMusk), /질문 오귀속/);
    assert.match(await reasonOf({ ...ENTRY_B, contextTurn: { speaker: 'Elon Musk', anchor: 'AI data centers in space' } }, HTML_B), /질문자가 앞 화자 경계와 다름/);
    assert.match(await reasonOf({ ...ENTRY_B, contextTurn: { speaker: 'Jamie Dimon', anchor: 'lunar factories' } }, HTML_B), /문맥 앵커를 확인하지 못함/);
    const long = secHtml(bPages({ longQuestion: true }));
    assert.match(await reasonOf(bEntry(long), long), /600자/);
  });

  await test('S8 날짜: June 8(영상 게시일)·June 5(투자설명서 발행) 발언일 대입 거부, 앵커 없는 날짜·도입 밖 날짜 거부, 한 구간에 날짜 둘이면 거부, June 4 정확', async () => {
    assert.match(await reasonOf({ ...ENTRY_A, spokenDate: { value: '2026-06-08', dateText: 'June 8, 2026', anchor: 'posted on X', maxSpan: 200 } }, HTML_A), /영상 게시일.*발언일로 쓰지 않음/);
    assert.match(await reasonOf({ ...ENTRY_B, spokenDate: { value: '2026-06-05', dateText: 'June 5, 2026', anchor: 'published a prospectus', maxSpan: 200 } }, HTML_B), /투자설명서 발행일.*발언일로 쓰지 않음/);
    const noAnchor = secHtml(bPages({ introText: 'Invented introduction. Elon Musk spoke on June 4, 2026.' }));
    assert.match(await reasonOf(bEntry(noAnchor), noAnchor), /인터뷰 날짜/, 'date without the interview anchor is not used');
    const twoDates = secHtml(bPages({ introText: 'On June 4, 2026 and June 5, 2026, Jamie Dimon conducted a video interview with Elon Musk.' }));
    assert.match(await reasonOf(bEntry(twoDates), twoDates), /인터뷰 날짜/);
    const coverOnly = secHtml(bPages({ introText: 'Invented introduction without a date.' }).map(p => (p.img === null ? { ...p, text: 'On June 4, 2026, Jamie Dimon conducted a video interview.' } : p)));
    assert.match(await reasonOf(bEntry(coverOnly), coverOnly), /인터뷰 날짜/, 'only the intro page is used');
    assert.strictEqual((await buildSec(ENTRY_B, HTML_B)).statements[0].spokenAt.value, '2026-06-04');
  });

  await test('S9 (ceo7a) 운영 고정 항목(출하 상태): PC 실원문 통과로 pcConfirmed=true → 요청 대상, false 사본은 보류(관문 유지), PC 확인 앵커·SHA·크기·이미지 SHA·인용·화자·날짜 값 그대로, 미확인 표시 없음', () => {
    for (const e of CURATED_SEC_EXHIBITS) {
      assert.strictEqual(e.pcConfirmed, true); assert.ok(secReady(e).ok);
      assert.strictEqual(secReady({ ...e, pcConfirmed: false }).ok, false, 'gate still holds unconfirmed entries');
      assert.ok(new URL(e.url).hostname === 'www.sec.gov' && e.companyId === 'spacex' && e.speakerName === 'Elon Musk');
      assert.strictEqual(e.editedNotice, 'Transcript slightly edited for clarity.');
    }
    const [a, b] = CURATED_SEC_EXHIBITS;
    assert.deepStrictEqual([a.rawBytes, a.rawSha256], [84285, '60b8f146ed4a47d496bc1444b12316d45391694fcfb6089026aabf8ad914cae7']);
    assert.deepStrictEqual([b.rawBytes, b.rawSha256], [1954229, '4eff68cfb4e55f7db708609f60fe7db035a5e79cb04b2ff8b0ae6dc07d59a8ab']);
    assert.strictEqual(a.spokenDate, null); assert.deepStrictEqual([a.videoPosted!.value, a.videoPosted!.dateText, a.videoPosted!.anchor], ['2026-06-08', 'June 8, 2026', 'posted on X']);
    assert.deepStrictEqual([b.spokenDate!.value, b.spokenDate!.dateText, b.spokenDate!.anchor], ['2026-06-04', 'June 4, 2026', 'conducted a video interview']);
    assert.deepStrictEqual(b.notSpokenDates.map(x => x.value), ['2026-06-05']);
    assert.deepStrictEqual([a.exhibitParticipants, b.exhibitParticipants], [['Elon Musk', 'Dan Huot', 'Ian Dahl'], ['Jamie Dimon', 'Elon Musk']]);
    assert.deepStrictEqual([a.turns, b.turns], [{ before: 'Ian Dahl', after: 'Ian Dahl' }, { before: 'Jamie Dimon', after: 'Jamie Dimon' }]);
    assert.deepStrictEqual(b.contextTurn, { speaker: 'Jamie Dimon', anchor: 'AI data centers in space' }); assert.strictEqual(a.contextTurn, undefined);
    assert.strictEqual(a.images.length + b.images.length, 7);
    assert.ok(a.topicId === b.topicId, 'same topic group (no stance-change claim)');
    assert.ok(!JSON.stringify(CURATED_SEC_EXHIBITS).includes(PC_TODO));
  });

  await test('S10 reviewedRawVariants 합성 회귀: 원본 통과, 추가 허용본 통과, 크기·해시 다른 항목 혼합 거부, 허용되지 않은 1바이트 변조 거부, 허용 해시여도 화자·날짜·Exhibit 검증 계속 작동', async () => {
    const origBytes = bytesOf(HTML_B);
    const origSha = sha(origBytes);

    // 합성 변형본(유효한 구조 + 다른 본문 길이/해시)
    const varHtml = secHtml(bPages({ introText: `${B_SYN.intro} Valid additional text for review verification.` }));
    const varBytes = bytesOf(varHtml);
    const varSha = sha(varBytes);
    assert.notStrictEqual(varBytes.byteLength, origBytes.byteLength);
    assert.notStrictEqual(varSha, origSha);

    const curatedWithVariant: CuratedSecExhibit = {
      ...ENTRY_B,
      rawBytes: origBytes.byteLength,
      rawSha256: origSha,
      reviewedRawVariants: [
        { rawBytes: varBytes.byteLength, rawSha256: varSha, reviewedAt: '2026-10-20' },
      ],
    };

    // 1. 원본 통과
    const rOrig = secArticle(curatedWithVariant, origBytes);
    assert.strictEqual(rOrig.ok, true, '원본 바이트 통과');
    assert.strictEqual(rOrig.sha256, origSha);
    const builtOrig = await buildSec(curatedWithVariant, HTML_B);
    assert.strictEqual(builtOrig.statements.length, 1, '원본 파이프라인 인용 1건 생성');

    // 2. 추가 허용본 통과
    const rVar = secArticle(curatedWithVariant, varBytes);
    assert.strictEqual(rVar.ok, true, '추가 허용본 통과');
    assert.strictEqual(rVar.sha256, varSha);
    const builtVar = await buildSec(curatedWithVariant, varHtml);
    assert.strictEqual(builtVar.statements.length, 1, '추가 허용본 파이프라인 인용 1건 생성');

    // 3. 크기·해시 다른 항목 혼합 거부
    // 3-1: 크기는 원본 크기인데 해시 불일치
    const mismatchedShaForOrigSize = new Uint8Array(origBytes.byteLength);
    mismatchedShaForOrigSize.set(origBytes);
    mismatchedShaForOrigSize[mismatchedShaForOrigSize.length - 1] = mismatchedShaForOrigSize[mismatchedShaForOrigSize.length - 1] === 65 ? 66 : 65;
    const rMixed1 = secArticle(curatedWithVariant, mismatchedShaForOrigSize);
    assert.strictEqual(rMixed1.ok, false, '크기는 원본이지만 해시 불일치 시 거부');
    assert.match(rMixed1.reason, /고정본과 다름|재검토 필요/);

    // 3-2: 크기는 변형본 크기인데 해시 불일치
    const mismatchedShaForVarSize = new Uint8Array(varBytes.byteLength);
    mismatchedShaForVarSize.set(varBytes);
    mismatchedShaForVarSize[mismatchedShaForVarSize.length - 1] = mismatchedShaForVarSize[mismatchedShaForVarSize.length - 1] === 65 ? 66 : 65;
    const rMixed2 = secArticle(curatedWithVariant, mismatchedShaForVarSize);
    assert.strictEqual(rMixed2.ok, false, '크기는 변형본이지만 해시 불일치 시 거부');
    assert.match(rMixed2.reason, /고정본과 다름|재검토 필요/);

    // 3-3: reviewedRawVariants의 정의에서 rawBytes와 rawSha256가 다른 항목과 교차된 경우
    const crossExhibit: CuratedSecExhibit = {
      ...ENTRY_B,
      rawBytes: origBytes.byteLength,
      rawSha256: origSha,
      reviewedRawVariants: [
        { rawBytes: varBytes.byteLength, rawSha256: origSha, reviewedAt: '2026-10-20' },
      ],
    };
    const rCross = secArticle(crossExhibit, varBytes);
    assert.strictEqual(rCross.ok, false, '크기와 해시가 교차된 변형본 등록 시 거부');

    // 4. 허용되지 않은 1바이트 변조 거부
    const tampered1 = new Uint8Array(origBytes);
    tampered1[0] = tampered1[0] ^ 0x01;
    const rTampered1 = secArticle(curatedWithVariant, tampered1);
    assert.strictEqual(rTampered1.ok, false, '원본 1바이트 변조 거부');

    const tampered2 = new Uint8Array(varBytes);
    tampered2[0] = tampered2[0] ^ 0x01;
    const rTampered2 = secArticle(curatedWithVariant, tampered2);
    assert.strictEqual(rTampered2.ok, false, '허용본 1바이트 변조 거부');

    // 5. 허용 해시여도 화자·날짜·Exhibit 검증 계속 작동
    // 5-1: 허용 해시이지만 화자 불일치
    const badSpeakerHtml = secHtml(bPages({ quoteSpeaker: 'JAMIE DIMON' }));
    const badSpeakerBytes = bytesOf(badSpeakerHtml);
    const badSpeakerEx: CuratedSecExhibit = {
      ...ENTRY_B,
      rawBytes: badSpeakerBytes.byteLength,
      rawSha256: sha(badSpeakerBytes),
      reviewedRawVariants: [],
    };
    assert.strictEqual(secArticle(badSpeakerEx, badSpeakerBytes).ok, true);
    const bSpeaker = await buildSec(badSpeakerEx, badSpeakerHtml);
    assert.strictEqual(bSpeaker.statements.length, 0, '허용 해시여도 화자 검증 실패 시 인용 0');
    assert.match(bSpeaker.rejected.map(x => x.reason).join(' | '), /지정 화자/);

    // 5-2: 허용 해시이지만 날짜 앵커 없음/불일치
    const badDateHtml = secHtml(bPages({ introText: 'On June 4, 2026 and June 5, 2026, Jamie Dimon conducted a video interview with Elon Musk.' }));
    const badDateBytes = bytesOf(badDateHtml);
    const badDateEx: CuratedSecExhibit = {
      ...ENTRY_B,
      rawBytes: badDateBytes.byteLength,
      rawSha256: sha(badDateBytes),
      reviewedRawVariants: [],
    };
    assert.strictEqual(secArticle(badDateEx, badDateBytes).ok, true);
    const bDate = await buildSec(badDateEx, badDateHtml);
    assert.strictEqual(bDate.statements.length, 0, '허용 해시여도 날짜 검증 실패 시 인용 0');
    assert.match(bDate.rejected.map(x => x.reason).join(' | '), /인터뷰 날짜/);

    // 5-3: 허용 해시이지만 Exhibit 순서/범위 불일치
    const badExhibitHtml = secHtml(bPages({ quoteInExhibitA: true }));
    const badExhibitBytes = bytesOf(badExhibitHtml);
    const badExhibitEx: CuratedSecExhibit = {
      ...bEntry(badExhibitHtml, { quoteImage: 'eu_interviewtranscript06002.jpg' }),
      rawBytes: badExhibitBytes.byteLength,
      rawSha256: sha(badExhibitBytes),
      reviewedRawVariants: [],
    };
    const rExhibit = secArticle(badExhibitEx, badExhibitBytes);
    assert.strictEqual(rExhibit.ok, false, '허용 해시여도 Exhibit B 이전 범위 인용 거부');
    assert.match(rExhibit.reason, /Exhibit B 시작 뒤가 아님/);
  });

  // ------------------------------------------------------------ Google Q2 2026
  await test('G2 Google Q2 2026(합성 요약문 배치): 탐색·관련 글의 제목·날짜 제외, 머리 영역의 날짜 단독 줄·작성자·편집 고지 → 발언일 2026-07-22, 편집 전사 provenance / 반례는 보류·미상', async () => {
    const r = extractPageQuotes(Q2, htmlToText(pageFixture(Q2)));
    assert.deepStrictEqual(r.rejected, []); assert.strictEqual(r.items.length, 1);
    const it = r.items[0];
    assert.deepStrictEqual([it.spokenAt.value, it.spokenAt.precision, it.spokenAt.basisExcerpt], ['2026-07-22', 'day', 'Jul 22, 2026']);
    assert.ok(it.provenance!.some(p => /편집된 전사/.test(p.label) && /edited transcript of his remarks/.test(p.excerpt)));
    assert.ok(it.provenance!.some(p => p.excerpt === 'CEO of Google and Alphabet'));
    const a = pageArticle(Q2, htmlToText(pageFixture(Q2)))!;
    assert.strictEqual(a.publishedAt, '2026-07-22T00:00:00.000Z');
    assert.ok(!a.body.includes('Home · News'), 'navigation excluded from article scope');
    // 반례
    const rej = (o: Parameters<typeof pageFixture>[1]) => extractPageQuotes(Q2, htmlToText(pageFixture(Q2, o)));
    assert.strictEqual(rej({ dateAfterQuote: true }).items.length, 0, 'date only after quote → held');
    assert.strictEqual(rej({ dateFarAway: true, dateAfterQuote: true }).items.length, 0, 'related-list date is not used');
    assert.strictEqual(rej({ authorAfterQuote: true }).items.length, 0, 'author only after quote → held');
    assert.strictEqual(rej({ otherAuthor: true }).items.length, 0);
    assert.strictEqual(rej({ noEditedNotice: true }).items[0].spokenAt.precision, 'unknown', 'no edited-transcript notice → spoken date unknown');
    assert.strictEqual(rej({ noLink: true }).items[0].spokenAt.precision, 'unknown');
    assert.strictEqual(rej({ quoteInNote: true }).items.length, 0);
    // 기존 Q1·Q4는 이전 규칙(before_note) 그대로
    assert.ok(CURATED_PAGES.filter(p => p.kind === 'call_remarks' && p !== Q2).every(p => !p.metaOrder));
  });

  // ------------------------------------------------------------ 등록부·피드
  await test('R1 SpaceX/Tesla 구별: SEC 발언은 SpaceX 역할만, Tesla 발언 규칙 그대로, 피드 회사는 기존 3곳(SpaceX 뉴스 검색 피드 추가 안 됨), 피드 이름 매칭 3인 그대로', async () => {
    assert.deepStrictEqual(feedCompanyIds(REGISTRY).sort(), [...FEED_COMPANY_IDS].sort());
    assert.deepStrictEqual(ceoFeeds(feedCompanyIds(REGISTRY)).map(f => f.url).sort(), ['https://blog.google/rss/', 'https://blogs.microsoft.com/feed/', 'https://blogs.nvidia.com/feed/']);
    assert.ok(!ceoFeeds(feedCompanyIds(REGISTRY)).some(f => f.companyId === 'spacex' || f.url.includes('news.google.com')));
    const b = (await buildSec(ENTRY_B, HTML_B)).statements[0];
    assert.ok(!/Tesla/.test(b.roleTitleAtTime) && /^SpaceX /.test(b.roleTitleAtTime) && b.companyId === 'spacex');
    const sameOnTesla = (await buildSec({ ...ENTRY_B, companyId: 'tsla' }, HTML_B)).statements[0];
    assert.strictEqual(sameOnTesla.roleTitleAtTime, 'CEO', 'control: companyId decides the role (SEC entries are pinned to spacex)');
    assert.ok(CURATED_SEC_EXHIBITS.every(e => e.companyId === 'spacex'));
  });

  // ------------------------------------------------------------ 요청기
  await test('F1 요청기: SEC 전용만 정직한 User-Agent, 일반 요청기에는 없음 / SEC 리다이렉트 0(따라가지 않음)·재시도 0 / 3MB·기한 그대로(바이트 요청기도)', async () => {
    const seen: { url: string; ua: string | null }[] = [];
    const fake = (status: number, body = 'x', headers: Record<string, string> = {}) => (async (u: string, init: any) => {
      seen.push({ url: u, ua: init?.headers?.['User-Agent'] ?? null });
      return new Response(status >= 300 && status < 400 ? null : body, { status, headers });
    }) as unknown as typeof fetch;
    const sec = createFetchBytes({ allowHosts: ['www.sec.gov'], maxRedirects: 0, headers: { 'User-Agent': SEC_USER_AGENT }, fetchImpl: fake(200, 'abc') });
    assert.strictEqual(new TextDecoder().decode(await sec('https://www.sec.gov/x.htm')), 'abc');
    assert.strictEqual(seen.pop()!.ua, 'KNewsCEOCollector/1.0 (+https://k-news.ai.studio)');
    await createFetchText({ allowHosts: ['blog.google'], fetchImpl: fake(200) })('https://blog.google/a');
    assert.strictEqual(seen.pop()!.ua, null, 'other sources: no SEC user agent');
    seen.length = 0;
    await assert.rejects(createFetchBytes({ allowHosts: ['www.sec.gov'], maxRedirects: 0, fetchImpl: fake(301, '', { location: 'https://www.sec.gov/y' }) })('https://www.sec.gov/x'), /too many redirects/);
    assert.strictEqual(seen.length, 1, 'redirect not followed');
    seen.length = 0;
    await assert.rejects(createFetchBytes({ allowHosts: ['www.sec.gov'], maxRedirects: 0, fetchImpl: fake(429) })('https://www.sec.gov/x'), (e: any) => e.httpStatus === 429);
    assert.strictEqual(seen.length, 1, 'no retry');
    await assert.rejects(createFetchBytes({ allowHosts: ['www.sec.gov'] , fetchImpl: fake(200) })('https://sec.gov.evil.example/x'), /host not allowed/);
    // 3MB 스트림 상한(선언 없음)과 기한
    const big = (async () => new Response(new ReadableStream({ start(c) { for (let i = 0; i < 4; i++) c.enqueue(new Uint8Array(1_000_000)); c.close(); } }), { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(createFetchBytes({ allowHosts: ['www.sec.gov'], fetchImpl: big })('https://www.sec.gov/x'), /too large \(> 3000000 bytes\)/);
    const ok3 = (async () => new Response(new Uint8Array(1_954_229), { status: 200 })) as unknown as typeof fetch;
    assert.strictEqual((await createFetchBytes({ allowHosts: ['www.sec.gov'], fetchImpl: ok3 })('https://www.sec.gov/x')).byteLength, 1_954_229, 'doc B size fits under 3MB');
    const never = (async (_u: string, init: any) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) as unknown as typeof fetch;
    await assert.rejects(createFetchBytes({ allowHosts: ['www.sec.gov'], fetchImpl: never })('https://www.sec.gov/x', { deadline: Date.now() + 50 }), /deadline exceeded/);
  });

  // ------------------------------------------------------------ 실행 상태(갱신)
  await test('W1 갱신 1회: 요청 14(피드 3+IR 2+페이지 7+SEC 2) 각 1회, Tesla HTTP 0·보고=보류(실패·삭제·성공 아님), 새 Google Q2·NASA 2·SEC 2건 포함 11건, 상한 기본 14', async () => {
    const w = world();
    const r = await w.mk().refresh();
    assert.strictEqual(r.httpStatus, 200, JSON.stringify(r.error));
    assert.strictEqual(DEFAULT_MAX_SOURCE_REQUESTS, 18);
    assert.strictEqual(w.calls.length + w.secCalls.length, 18); assert.strictEqual(new Set([...w.calls, ...w.secCalls]).size, 18);
    assert.strictEqual(w.secCalls.length, 2);
    assert.ok(w.calls.filter(u => u.includes('tesla.com')).length === 4 && !w.calls.some(u => u.includes('sec.gov')));
    const st = r.response.dataset!.statements;
    assert.strictEqual(st.length, 15, st.map(s => s.quoteText).join(' | '));
    const musk = st.filter(s => s.personId === 'elon-musk');
    assert.strictEqual(musk.length, 8);
    assert.strictEqual(musk.filter(s => s.companyId === 'spacex').length, 4);
    assert.strictEqual(musk.filter(s => s.companyId === 'tsla').length, 4);
    assert.strictEqual(musk.filter(s => s.sourceType === 'filed_transcript').length, 2);
    assert.strictEqual(musk.filter(s => s.sourceType === 'press_release').length, 4);
    const tesla = r.response.sources.filter(x => x.feedUrl.includes('tesla.com'));
    assert.ok(tesla.length === 4 && tesla.every(x => x.ok && !x.held));
    assert.ok(r.response.sources.filter(x => x.kind === 'sec').every(x => x.ok && !x.held && !x.rejectedQuotes));
    assert.strictEqual(r.response.status, 'ready');
    assert.strictEqual(r.response.withdrawnCount, 0);
    if (process.env.CEO_DUMP) fs.writeFileSync(process.env.CEO_DUMP, JSON.stringify(await w.mk().snapshot(), null, 1));
  });

  await test('W2 SEC 차단(403·429): 첫 SEC 실패 뒤 남은 SEC 요청 0(재시도·우회 없음), 이전 SEC 확인 기록은 지우지 않음(not_rechecked)', async () => {
    for (const status of [403, 429]) {
      const w = world();
      await w.mk().refresh();
      w.secDocs.set(ENTRY_A.url, new SourceFetchError(`HTTP ${status}`, status));
      w.secCalls.length = 0; w.clock.t += 86_400_000;
      const r = await w.mk().refresh();
      assert.strictEqual(r.httpStatus, 200);
      assert.deepStrictEqual(w.secCalls, [ENTRY_A.url], `${status}: one SEC request, then stop`);
      const reps = r.response.sources.filter(x => x.kind === 'sec');
      assert.ok(!reps[0].ok && reps[0].error === `HTTP ${status}` && !reps[0].held);
      assert.ok(!reps[1].ok && reps[1].held && /남은 SEC 요청 중단/.test(reps[1].held.reason));
      const musk = r.response.dataset!.statements.filter(s => s.personId === 'elon-musk');
      assert.strictEqual(musk.length, 8);
      const muskSec = musk.filter(s => s.sourceType === 'filed_transcript');
      assert.strictEqual(muskSec.length, 2);
      assert.ok(muskSec.every(s => s.verification!.status === 'not_rechecked'));
      const muskNasa = musk.filter(s => s.evidence.some(e => e.url.includes('nasa.gov')));
      assert.strictEqual(muskNasa.length, 2);
      assert.ok(muskNasa.every(s => s.verification!.status === 'verified'));
      assert.strictEqual(r.response.withdrawnCount, 0);
    }
  });

  await test('W3 SEC 원문 해시가 바뀌면 재검토 보류: 인용을 새로 만들지 않고 이전 기록 not_rechecked(삭제·철회 아님) / 요청 상한 11이면 마지막 요청은 보내지 않음', async () => {
    const w = world();
    await w.mk().refresh();
    w.secDocs.set(ENTRY_B.url, bytesOf(HTML_B.replace('launch cadence', 'launch cadences')));
    w.clock.t += 86_400_000;
    const r = await w.mk().refresh();
    const rep = r.response.sources.find(x => x.feedUrl === ENTRY_B.url)!;
    assert.ok(!rep.ok && rep.held && /재검토 필요/.test(rep.held.reason));
    const b = r.response.dataset!.statements.find(s => s.evidence[0].url === ENTRY_B.url)!;
    assert.strictEqual(b.verification!.status, 'not_rechecked');
    assert.strictEqual(r.response.withdrawnCount, 0);
    const w2 = world({ cap: 11 });
    const r2 = await w2.mk().refresh();
    assert.strictEqual(w2.calls.length + w2.secCalls.length, 11);
    assert.match(r2.response.sources.find(x => x.feedUrl === ENTRY_B.url)!.error!, /request cap reached \(11\)/);
  });

  await test('W4 (ceo7a) 출하 항목 그대로: SEC 2곳 각 1회 요청(전체 14) — 합성 바이트는 고정 SHA와 달라 재검토 보류(인용 0, 임의 인용 없음) / pcConfirmed=false 사본이면 SEC 요청 0·전체 12', async () => {
    const w = world({ sec: CURATED_SEC_EXHIBITS });
    const r = await w.mk().refresh();
    assert.strictEqual(r.httpStatus, 200);
    assert.strictEqual(w.secCalls.length, 2); assert.strictEqual(w.calls.length + w.secCalls.length, 18);
    const reps = r.response.sources.filter(x => x.kind === 'sec');
    assert.ok(reps.length === 2 && reps.every(x => !x.ok && x.held && /고정본과 다름.*재검토 필요/.test(x.held.reason)));
    assert.strictEqual(r.response.dataset!.statements.length, 13);
    const w2 = world({ sec: CURATED_SEC_EXHIBITS.map(e => ({ ...e, pcConfirmed: false })) });
    const r2 = await w2.mk().refresh();
    assert.strictEqual(w2.secCalls.length, 0); assert.strictEqual(w2.calls.length, 16);
    assert.ok(r2.response.sources.filter(x => x.kind === 'sec').every(x => x.held && /PC 실제 원본 파일로 이 파서를 통과시키기 전/.test(x.held.reason)));
  });

  // ------------------------------------------------------------ 보존·한국어 요약
  await test('K1 한국어 요약 입력·키 규칙 변경 없음: 기존 8개 원문 키·입력 해시 = ceo6m 골든, context 있는 피드 발언도 이전과 같음 / 문서 B는 기존 형식 그대로(근거 문장 칸에 질문+인용 연속 구간)', async () => {
    // ceo6m koJobKey·koContents로 계산해 둔 값 (harness/ceo7/golden_ko.json과 같음)
    const GOLDEN: Record<string, [string, string]> = {
      'msft-fy25-q2-nadella': ['939619d85800e421ec007f725ddd72886cedc26e8ff42279eb8cb169bf40f16c', '8eb1f3251c745dc9e341ec2c88f9b5acf1b9d63395c6e86316c19f00bd0a765f'],
      'msft-fy26-q2-nadella': ['adc32fedfcc5d59b9e5190b26b8781e3ba03353c55f4c58a5f2a3574fff2c0af', '36641cf450f4d67b1b7c359a311cc2b3c181f0e773c3f1aa37ebd652938fe671'],
      'tsla-master-plan-2006-musk': ['3790269bd47b6b9b60919b61f21764e651539b884a042402ab345054d178ae79', '019c4e81853be15f903405c040390a27b8e6da99a04f15063c5436694a813d97'],
      'tsla-master-plan-2016-musk': ['0223e583768ef57736219c4b574338ad63bc69cb6a17c2aac49bfaf1aa77c20f', 'c306d557d8e0a1992420a53f6b6983d7e80520876ee59b59e397a3e7bd028ac1'],
      'googl-q1-2025-pichai': ['289cc1ef9a6ea67d74faba22d66cb6922b009a19d6425073b02fe78e6d60cf28', '72af4a58e2f46f4185ede6ec5c778690fa5bbd910aebd9327be77de7378d3ce2'],
      'googl-q4-2025-pichai': ['016dd6d7893d90265abf094ae4d468d11b22f0e8e76536571a1b2aea51c1be58', '0da3032a227ca10c57ed286706e57dc08a5b360374517a9cb570609150a6a2e6'],
      'nvda-q1-fy2026-huang': ['0b17be2341598ffa40bcb387fe135d71d944f222c0f4ef3bf5efdb1ad3d786f7', '685c1a8c9c0ce0edc19a9219e3822a77a999bad507b2513d2ac84ba501f3d96e'],
      'nvda-q2-fy2026-huang': ['9939d947760e631b4658ece8b8c30a466bf021ec9dd3760427450ac1d43e4431', 'cc4379550364e57333086a8afaf48cd9b38f385452aef89f5b07ae0fab630ece'],
    };
    assert.strictEqual(TRANSLATIONS.length, 8);
    for (const t of TRANSLATIONS) {
      const s: CeoStatement = { ...PROD_REV1_STATEMENTS[0], statementId: 'g_' + t.id, quoteText: t.quote, evidence: [{ ...PROD_REV1_STATEMENTS[0].evidence[0], excerpt: t.excerpt }] };
      assert.deepStrictEqual([koJobKey(s), crypto.createHash('sha256').update(koContents(s)).digest('hex')], GOLDEN[t.id], t.id);
    }
    // 피드 발언처럼 context가 있어도 입력·키는 context와 무관(ceo6m과 같은 규칙 — koSummary.ts는 ceo6m과 바이트 동일)
    const base: CeoStatement = { ...PROD_REV1_STATEMENTS[0] };
    const withCtx: CeoStatement = { ...base, context: { text: '상황', sources: [{ articleId: base.evidence[0].articleId, excerpt: 'Invented context sentence.' }] } };
    assert.deepStrictEqual([koJobKey(withCtx), koContents(withCtx)], [koJobKey(base), koContents(base)]);
    // 문서 B: 기존 입력 형식 그대로 — QUOTE = 머스크 인용만, SENTENCE = 질문 표기+질문+머스크 표기+인용(원문 연속 구간, 600자 이하)
    const b = (await buildSec(ENTRY_B, HTML_B)).statements[0];
    const c = koContents(b);
    assert.ok(c.includes('QUOTE: "We think it’s easier than building communication satellites"'));
    assert.ok(c.includes(`SENTENCE: ${JSON.stringify(b.evidence[0].excerpt)}`) && c.includes('JAMIE DIMON: ') && c.includes('AI data centers in space'));
    assert.ok(!c.includes('QUESTION') && !/June|2026/.test(c), 'no new prompt line, no dates');
    const a = (await buildSec(ENTRY_A, HTML_A)).statements[0];
    assert.ok(koContents(a).includes(`SENTENCE: ${JSON.stringify(ENTRY_A.quote)}`));
  });

  await test('K2 보존 + 새 3건만 유료 대상: 기존 6건(판 1) ID·처음 확인 시각 그대로, 요약 켠 뒤 갱신에서 새 3건만 count 3·생성 3, 다시 갱신하면 0(재요약 없음), 원장 비용 = 3건 정산 합', async () => {
    const w = world();
    const basePages = CURATED_PAGES.filter(p => p !== Q2 && !p.sourceId.startsWith('nasa-') && p.companyId !== 'tsla');
    const allExcludingNasa = CURATED_PAGES.filter(p => !p.sourceId.startsWith('nasa-') && p.companyId !== 'tsla');
    const r1 = await w.mk({ pages: basePages, sec: [] }).refresh(); // 운영 판처럼 6건 (Tesla 0)
    assert.strictEqual(r1.response.dataset!.statements.length, 6);
    const first = r1.response.dataset!.statements.map(s => [s.statementId, s.verification!.firstVerifiedAt]);
    w.clock.t += 3_600_000;
    await w.ledger.configure({ enabled: true, now: w.clock.t });
    w.clock.t += 3_600_000;
    const rt = w.mk({ pages: allExcludingNasa, withKo: true });
    const r2 = await rt.refresh();
    const st = r2.response.dataset!.statements;
    assert.strictEqual(st.length, 9);
    for (const [id, at] of first) assert.strictEqual(st.find(s => s.statementId === id)!.verification!.firstVerifiedAt, at, id);
    const fresh = st.filter(s => !first.some(f => f[0] === s.statementId));
    assert.deepStrictEqual(fresh.map(s => s.personId).sort(), ['elon-musk', 'elon-musk', 'sundar-pichai']);
    // 검토 번역 사전(translationsHashed)에 있는 새 발언은 AI 요약을 부르지 않음 → 유료 대상 = 검토 번역이 없는 새 발언
    const paid = fresh.filter(s => s.translationKo?.status !== 'reviewed');
    const n = paid.length;
    assert.ok(n >= 1 && n <= 3);
    assert.deepStrictEqual([w.ko.count, w.ko.gen], [n, n]);
    assert.deepStrictEqual([rt.lastKoReport!.considered, rt.lastKoReport!.calls, rt.lastKoReport!.settled, rt.lastKoReport!.uncertain], [3, n, n, 0]);
    assert.ok(w.ko.contents.filter(c => c.includes('JAMIE DIMON: ')).length <= 1, 'question context only in document B input');
    const ls = await w.ledger.read();
    assert.strictEqual(Object.keys(ls.results).length, n);
    // 정산 = 실제 usage(prompt 210, 출력 total-prompt 50) × 2026년 단가(750/3750 나노달러) × n건, 예약 잔액 0
    assert.strictEqual(ls.months['2026-10'].spentNano, n * (210 * 750 + 50 * 3750));
    assert.ok(paid.every(s => ls.results[koJobKey(s)!]));
    w.clock.t += 86_400_000;
    const rt3 = w.mk({ pages: allExcludingNasa, withKo: true });
    const r3 = await rt3.refresh();
    assert.strictEqual(r3.httpStatus, 200);
    assert.deepStrictEqual([w.ko.count, w.ko.gen], [n, n], 'no re-summary');
    assert.strictEqual(rt3.lastKoReport!.considered, 0);
    const g = await w.mk({ pages: allExcludingNasa, withKo: true }).snapshot();
    assert.strictEqual(g.dataset!.statements.filter(s => s.koSummary?.status === 'ready').length, n);
    assert.strictEqual(g.koSummary!.outstandingUsd, 0);
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (합성 fixture·가짜 요청기/모델·메모리 저장소 — 실제 SEC/Google 원문·SDK·Firestore 통과 아님)`);
  for (const f of failed) console.log(`--- ${f.name}\n${f.error}`);
  finished = true;
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
