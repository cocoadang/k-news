/**
 * CEO HTTP 테스트 — 실제 의존성 환경 전용(실제 express·rss-parser·Node fetch). 운영 server.ts와 같은 createCeoRouter 사용.
 * 실행(PC): npx tsx server/ceo/ceoHttp.test.ts
 * - db 싱글턴·Firestore·수집기·Gemini·Telegram을 불러오지 않음. 외부 통신 없음: 피드·기록은 127.0.0.1 루프백 고정 자료
 * - 요청기는 운영과 같은 createFetchText(허용 호스트 = 127.0.0.1, 루프백 http 허용)이며, 운영 URL을 루프백 경로로 바꾸는 매핑만 주입
 * - 자료는 전부 가상(liveFixtures)
 */
import assert from 'node:assert';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import express from 'express';
import { createCeoRouter, parseFeedWithRssParser } from './routes';
import { CeoRuntime } from './runtime';
import { createFetchText } from './fetchText';
import { MemoryStateBackend, MemoryStateStore } from './stateStore';
import { ARTICLE_1, ARTICLE_2, BODY_1, BODY_2, FEED_URL_GOOG, FEED_URL_MSFT, FEED_URL_NVDA, LIVE_REGISTRY, LIVE_TRANSCRIPT, rssFeed, TRANSCRIPT_URL, transcriptPage } from './testing/liveFixtures';

// 끝나지 않은 약속 때문에 이벤트 루프가 비어 조용히 종료(코드 0)되는 것을 실패로 처리
let finished = false;
process.on('beforeExit', () => { if (!finished) { console.log('FAIL (테스트가 끝나기 전에 이벤트 루프가 비었습니다 — 멈춘 약속)'); process.exit(3); } });
const results: { name: string; ok: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e: any) { results.push({ name, ok: false, error: e?.stack || String(e) }); console.log(`FAIL ${name}\n  ${e?.message || e}`); }
}

async function listen(app: http.RequestListener): Promise<{ base: string; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise<void>(r => server.close(() => r())) };
}

async function main() {
  // 원문 서버(루프백): 피드·기록·리다이렉트
  const hits: string[] = [];
  const routes: Record<string, { status: number; body?: string; location?: string; type?: string }> = {
    '/nvda/feed': { status: 200, type: 'application/rss+xml', body: rssFeed([
      { link: ARTICLE_1, title: 'Launch', html: BODY_1, pubDate: 'Thu, 15 Oct 2026 17:00:00 +0000' },
      { link: ARTICLE_2, title: 'Roadmap', html: BODY_2, pubDate: 'Fri, 16 Oct 2026 17:00:00 +0000' },
    ]) },
    // 등록부 회사(nvda·msft) 피드만 요청됨 → msft 피드가 메타데이터 주소로 리다이렉트(SSRF 시도)
    '/msft/feed': { status: 302, location: 'http://169.254.169.254/latest/meta-data' },
    '/transcript': { status: 200, type: 'text/html', body: transcriptPage() },
  };
  const origin = await listen((req, res) => {
    hits.push(req.url || '');
    const r = routes[req.url || ''];
    if (!r) { res.statusCode = 404; return res.end(); }
    res.statusCode = r.status;
    if (r.location) res.setHeader('location', r.location);
    if (r.type) res.setHeader('content-type', r.type);
    res.end(r.body || '');
  });
  const map: Record<string, string> = { [FEED_URL_NVDA]: '/nvda/feed', [FEED_URL_MSFT]: '/msft/feed', [TRANSCRIPT_URL]: '/transcript' };
  const backend = new MemoryStateBackend();
  let store: MemoryStateStore | null = new MemoryStateStore(backend);
  const loopbackFetch = createFetchText({ allowHosts: ['127.0.0.1'], allowHttpLoopback: true });
  const runtime = new CeoRuntime({
    getEvents: () => [{ id: 'evt-1', category: 'AI 가속기 / 반도체', primarySource: { url: ARTICLE_1 } }, { id: 'evt-2', category: 'AI 가속기 / 반도체', primarySource: { url: ARTICLE_2 } }],
    fetchText: (url, o) => loopbackFetch(origin.base + (map[url] || '/missing'), o),
    parseFeed: parseFeedWithRssParser, registry: LIVE_REGISTRY, transcripts: [LIVE_TRANSCRIPT],
    // 저장소: 메모리 대역(실제 Firestore 아님 — 실제 SDK는 ceoStore.firestore.test.ts + 에뮬레이터). 가상 인물 자료 저장은 테스트에서만 허용
    getStore: () => store, allowExampleData: true, headCacheMs: 0, // 매 GET마다 head 확인(장애 주입 확인용; 운영 기본 10초)
  });
  const app = express();
  app.use(createCeoRouter({ runtime, verifyAdmin: (req: any, res: any, next: any) => (req.get('x-test-admin') === 'yes' ? next() : res.status(401).json({ error: 'auth' })) }));
  const api = await listen(app);

  await test('H1 GET /api/ceo/dataset 첫 상태: 200, not_loaded, dataset null, no-store, 원문 요청 0', async () => {
    const r = await fetch(`${api.base}/api/ceo/dataset`);
    assert.strictEqual(r.status, 200); assert.match(r.headers.get('cache-control') || '', /no-store/);
    const j = await r.json(); assert.strictEqual(j.status, 'not_loaded'); assert.strictEqual(j.dataset, null);
    assert.strictEqual(hits.length, 0);
  });
  await test('H2 POST 새로고침: 관리자 인증 없으면 401 (원문 요청 0)', async () => {
    const r = await fetch(`${api.base}/api/admin/ceo/refresh`, { method: 'POST' });
    assert.strictEqual(r.status, 401); assert.strictEqual(hits.length, 0);
  });
  await test('H3 POST 관리자 새로고침: 실제 rss-parser로 content:encoded 본문 → 인용 확인, 기록 검증, 리다이렉트 SSRF 차단은 해당 출처만 실패(partial)', async () => {
    const r = await fetch(`${api.base}/api/admin/ceo/refresh`, { method: 'POST', headers: { 'x-test-admin': 'yes' } });
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.strictEqual(j.status, 'partial');
    const msft = j.sources.find((s: any) => s.feedUrl === FEED_URL_MSFT); assert.strictEqual(msft.ok, false); assert.match(msft.error, /host not allowed/);
    assert.ok(!j.sources.some((s: any) => s.feedUrl === FEED_URL_GOOG), '등록부 밖 회사 피드는 요청하지 않음');
    assert.ok(j.sources.filter((s: any) => s.ok).length >= 2, 'nvda 피드·기록은 성공');
    const quotes = j.dataset.statements.map((s: any) => s.quoteText);
    assert.ok(quotes.includes('Demand for accelerated computing keeps rising across every industry'));
    assert.ok(quotes.includes('The key metric we are optimizing for is efficiency per dollar'));
    assert.ok(!hits.some(h => h.includes('meta-data')), 'redirect target never requested');
  });
  await test('H4 GET은 읽기 전용: 여러 번 호출해도 원문 요청·저장소 쓰기 없음, 저장된 결과 그대로', async () => {
    const before = hits.length;
    const a = await (await fetch(`${api.base}/api/ceo/dataset`)).json();
    const b = await (await fetch(`${api.base}/api/ceo/dataset`)).json();
    const writes = backend.writes;
    const c = await (await fetch(`${api.base}/api/ceo/dataset`)).json();
    assert.strictEqual(hits.length, before); assert.deepStrictEqual(a, b); assert.deepStrictEqual(b, c); assert.strictEqual(a.status, 'partial');
    assert.strictEqual(backend.writes, writes, 'no store writes on GET');
  });
  await test('H5 최소 간격 안 재요청은 429, 결과는 이전 그대로', async () => {
    const r = await fetch(`${api.base}/api/admin/ceo/refresh`, { method: 'POST', headers: { 'x-test-admin': 'yes' } });
    assert.strictEqual(r.status, 429);
    const j = await r.json(); assert.strictEqual(j.reason, 'too_soon'); assert.strictEqual(j.status, 'partial'); assert.strictEqual(j.storeRevision, 1);
  });

  await test('H5b 한국어 요약 관리자 엔드포인트: 인증 없으면 401(설정·생성 모두), 인증돼도 원장 없으면 503·요청 본문 없으면 400, 원문 요청 0', async () => {
    const before = hits.length;
    for (const path of ['/api/admin/ceo/ko-summary/settings', '/api/admin/ceo/ko-summary/one']) {
      assert.strictEqual((await fetch(`${api.base}${path}`, { method: 'POST' })).status, 401, path);
    }
    assert.strictEqual((await fetch(`${api.base}/api/admin/ceo/ko-summary/settings`, { method: 'POST', headers: { 'x-test-admin': 'yes' } })).status, 503);
    assert.strictEqual((await fetch(`${api.base}/api/admin/ceo/ko-summary/one`, { method: 'POST', headers: { 'x-test-admin': 'yes' } })).status, 400);
    assert.strictEqual(hits.length, before);
  });

  await test('H6 저장소 장애: GET은 마지막으로 읽은 사본을 부분 가용(storeError)으로, 저장 권한 거부 POST는 503·기존 판 유지, 저장소 없음은 GET 오류·POST 503', async () => {
    backend.faults.push({ op: 'readHead', code: 'unavailable' });
    const g = await (await fetch(`${api.base}/api/ceo/dataset`)).json();
    assert.strictEqual(g.status, 'partial'); assert.strictEqual(g.storeError, 'unavailable'); assert.ok(g.dataset.statements.length > 0);
    backend.head = { ...backend.head!, lastStartedAt: 0 }; // 최소 간격 테스트 이후 재시도 허용(대역 직접 조작)
    backend.faults.push({ op: 'commit', code: 'permission_denied' });
    const before = backend.head!.revision;
    const p = await fetch(`${api.base}/api/admin/ceo/refresh`, { method: 'POST', headers: { 'x-test-admin': 'yes' } });
    assert.strictEqual(p.status, 503); const pj = await p.json(); assert.match(pj.error, /permission_denied/);
    assert.strictEqual(backend.head!.revision, before);
    store = null;
    const g2 = await fetch(`${api.base}/api/ceo/dataset`); const g2j = await g2.json();
    assert.strictEqual(g2.status, 200); assert.strictEqual(g2j.status, 'error'); assert.strictEqual(g2j.storeError, 'not_configured');
    const p2 = await fetch(`${api.base}/api/admin/ceo/refresh`, { method: 'POST', headers: { 'x-test-admin': 'yes' } });
    assert.strictEqual(p2.status, 503);
  });

  await api.close(); await origin.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed (loopback fixtures; express/rss-parser = 실행 환경이 해석한 모듈)`);
  for (const f of failed) console.log(`--- ${f.name}\n${f.error}`);
  finished = true;
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
