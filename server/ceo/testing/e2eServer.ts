/**
 * PC 화면 점검용 격리 서버 (운영 server.ts·db·수집기·Gemini·Telegram을 불러오지 않음).
 * - 정적 파일: vite build 결과(dist)
 * - 앱 초기 조회(auth/status/events/companies/settings): 고정 자료
 * - /api/ceo/dataset, /api/admin/ceo/refresh: 운영과 같은 createCeoRouter(실제 express) + 루프백 고정 원문 서버(가상 인물·문장)
 * - 그 밖의 /api/*(수집 /api/poll 포함)는 410으로 막고 요청 기록만 남김
 * 사용: npx tsx server/ceo/testing/e2eServer.ts <dist 경로> [포트=4310]   (관리자 버튼 확인: E2E_ADMIN=1)
 * 저장소: 기본은 메모리 대역(재시작하면 사라짐, 화면에 '메모리' 표시).
 *   재시작 복원 확인: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-ceo-test 로 실행하면
 *   실제 Firestore SDK 어댑터가 에뮬레이터의 'ceo_statement_history_e2e' 컬렉션을 씀 (루프백 + demo- 프로젝트가 아니면 거부, 운영 DB 금지)
 * 외부 네트워크 요청 없음: 원문 요청기는 127.0.0.1만 허용.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import express from 'express';
import { createCeoRouter, parseFeedWithRssParser } from '../routes';
import { CeoRuntime } from '../runtime';
import { createFetchText } from '../fetchText';
import { CeoStateStore, MemoryStateBackend, MemoryStateStore } from '../stateStore';
import { FirestoreCeoStateStore } from '../firestoreStateStore';
import { ARTICLE_1, ARTICLE_2, BODY_1, BODY_2, FEED_URL_MSFT, FEED_URL_NVDA, LIVE_REGISTRY, LIVE_TRANSCRIPT, rssFeed, TRANSCRIPT_URL, transcriptPage } from './liveFixtures';

const dist = path.resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4310);
const admin = process.env.E2E_ADMIN === '1';
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

async function main() {
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error(`dist/index.html 없음: ${dist}`); process.exit(2); }

  // 루프백 고정 원문 서버
  const pages: Record<string, { status: number; body?: string; type?: string; location?: string }> = {
    '/nvda/feed': { status: 200, type: 'application/rss+xml', body: rssFeed([
      { link: ARTICLE_1, title: 'Launch', html: BODY_1, pubDate: 'Thu, 15 Oct 2026 17:00:00 +0000' },
      { link: ARTICLE_2, title: 'Roadmap', html: BODY_2, pubDate: 'Fri, 16 Oct 2026 17:00:00 +0000' },
    ]) },
    '/msft/feed': { status: 302, location: 'http://169.254.169.254/latest/meta-data' },
    '/transcript': { status: 200, type: 'text/html', body: transcriptPage() },
  };
  const origin = http.createServer((req, res) => {
    const p = pages[req.url || ''];
    if (!p) { res.statusCode = 404; return res.end(); }
    res.statusCode = p.status; if (p.type) res.setHeader('content-type', p.type); if (p.location) res.setHeader('location', p.location);
    res.end(p.body || '');
  });
  await new Promise<void>(r => origin.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(origin.address() as AddressInfo).port}`;
  const map: Record<string, string> = { [FEED_URL_NVDA]: '/nvda/feed', [FEED_URL_MSFT]: '/msft/feed', [TRANSCRIPT_URL]: '/transcript' };
  const loopback = createFetchText({ allowHosts: ['127.0.0.1'], allowHttpLoopback: true });
  let store: CeoStateStore;
  const emu = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (emu) {
    const projectId = process.env.GCLOUD_PROJECT || '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(emu) || !projectId.startsWith('demo-')) { console.error('거부: 루프백 에뮬레이터 + demo- 프로젝트에서만'); process.exit(2); }
    const { Firestore } = await import('@google-cloud/firestore');
    store = new FirestoreCeoStateStore(new Firestore({ projectId }), { collection: 'ceo_statement_history_e2e' });
    console.log(`저장소: Firestore 에뮬레이터 ${emu} (${projectId})`);
  } else {
    store = new MemoryStateStore(new MemoryStateBackend());
    console.log('저장소: 메모리 대역(재시작 시 사라짐)');
  }
  const runtime = new CeoRuntime({
    getEvents: () => [{ id: 'evt-1', category: 'AI 가속기 / 반도체', primarySource: { url: ARTICLE_1 } }, { id: 'evt-2', category: 'AI 가속기 / 반도체', primarySource: { url: ARTICLE_2 } }],
    fetchText: (url, o) => loopback(base + (map[url] || '/missing'), o),
    parseFeed: parseFeedWithRssParser, registry: LIVE_REGISTRY, transcripts: [LIVE_TRANSCRIPT], getStore: () => store, allowExampleData: true, minIntervalMs: 30_000,
  });
  const ceoApp = express();
  ceoApp.use(createCeoRouter({ runtime, verifyAdmin: (_req: unknown, res: any, next: () => void) => (admin ? next() : res.status(401).json({ error: '관리자 인증 필요(E2E_ADMIN=1로 실행)' })) }));

  const blocked: string[] = [];
  const sendJson = (res: http.ServerResponse, status: number, o: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); };
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    console.log(`${req.method} ${url}`);
    if (url.startsWith('/api/ceo/') || url.startsWith('/api/admin/ceo/')) return ceoApp(req, res);
    if (url === '/api/auth/status') return sendJson(res, 200, { requiresAuth: true, isAuthenticated: admin });
    if (url === '/api/events' || url === '/api/companies') return sendJson(res, 200, []);
    if (url.startsWith('/api/')) { blocked.push(`${req.method} ${url}`); return sendJson(res, 410, { error: 'e2e: 차단된 경로', path: url }); }
    let file = path.join(dist, path.normalize(url).replace(/^([/\\])+/, ''));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, '127.0.0.1', () => console.log(`e2e: http://127.0.0.1:${port}  (admin=${admin}, dist=${dist})`));
  process.on('SIGINT', () => { console.log(`차단된 /api 요청: ${blocked.length ? blocked.join(', ') : '없음'}`); process.exit(0); });
}
main().catch(e => { console.error(e); process.exit(1); });
