/**
 * CEO 발언 Express 라우터 (운영 server.ts와 HTTP 테스트가 같은 라우터를 씀).
 * - GET  /api/ceo/dataset        저장된 CEO 상태 읽기·복원만 (원문 요청·추출·모델·알림·쓰기 없음)
 * - POST /api/admin/ceo/refresh  관리자 인증 필요: lease 획득 → 공식 피드·선별 IR 기록 한정 읽기 → 저장 성공 후에만 200
 *   실패 코드: 409 진행 중·펜싱 거절, 429 최소 간격, 413 저장 크기 초과, 502 모든 출처 실패, 503 저장소 없음·불가·권한, 504 기한·저장 시간 초과
 * db 싱글턴을 불러오지 않습니다. 운영에서는 server.ts가 이벤트 목록 함수와 관리자 인증 미들웨어를 주입합니다.
 */
import { headlineKey } from './koHeadlines';
import express from 'express';
import Parser from 'rss-parser';
import { CeoRuntime, ceoAllowedHosts, feedCompanyIds } from './runtime';
import { EventLike, FeedItem, discoveryAllowedHosts, discoveryPdfHosts } from './officialSource';
import { createFetchBytes, createFetchText } from './fetchText';
import { FirestoreCeoStateStore } from './firestoreStateStore';
import { CEO_PERSONS, CEO_ROLES } from './registry';
import { CURATED_SEC_EXHIBITS, SEC_HOST, SEC_USER_AGENT } from './secExhibits';
import { CURATED_PAGES } from './officialPages';
import { FirestoreKoLedger } from './koLedger';
import { createKoGeminiClient } from './koGeminiClient';
import { HeadlineEvent, reportedCeoStatements } from './reportedHeadlines';

type FirestoreLike = ConstructorParameters<typeof FirestoreCeoStateStore>[0];
type Middleware = (req: any, res: any, next: any) => any;

export async function parseFeedWithRssParser(xml: string): Promise<FeedItem[]> {
  const feed = await new Parser().parseString(xml);
  return (feed.items || []).map((it: any) => ({
    link: String(it.link || ''),
    title: String(it.title || ''),
    html: String(it['content:encoded'] || it.content || ''),
    pubDate: it.isoDate || it.pubDate || null,
  }));
}

/**
 * 운영용 실행 상태: 허용 호스트만 요청하는 fetch + rss-parser + Firestore 저장소(기존 인스턴스 주입, ADC).
 * Firestore를 쓸 수 없으면 저장소 없음 → 조회 오류·갱신 503 (메모리로 대신하지 않음).
 */
export function createCeoRuntime(getEvents: () => EventLike[], getFirestore: () => FirestoreLike | null) {
  const companyIds = feedCompanyIds({ persons: CEO_PERSONS, roles: CEO_ROLES });
  let cached: { db: FirestoreLike; store: FirestoreCeoStateStore } | null = null;
  let ledgerCache: { db: FirestoreLike; ledger: FirestoreKoLedger } | null = null;
  let koClient: ReturnType<typeof createKoGeminiClient> | undefined;
  return new CeoRuntime({
    getEvents,
    fetchText: createFetchText({ allowHosts: [...ceoAllowedHosts(companyIds, undefined, CURATED_PAGES), ...discoveryAllowedHosts()] }),
    discovery: true,
    parseFeed: parseFeedWithRssParser,
    pages: CURATED_PAGES,
    // SEC 제출 문서: www.sec.gov만, 정직한 User-Agent(이 요청기에만), 리다이렉트 0, 재시도 0, 기존 3MB·요청 기한 그대로
    secExhibits: CURATED_SEC_EXHIBITS,
    fetchSecBytes: createFetchBytes({ allowHosts: [SEC_HOST], maxRedirects: 0, headers: { 'User-Agent': SEC_USER_AGENT } }),
    // 주주서한 PDF: 공식 자료실 호스트만, 최대 35MB·30초
    fetchPdfBytes: createFetchBytes({ allowHosts: discoveryPdfHosts(), maxBytes: 35_000_000, timeoutMs: 30_000 }),
    // CEO 한국어 요약 원장(Firestore, 기본 꺼짐)·Gemini 어댑터(기존 GEMINI_API_KEY). 원장이 없으면 요약 기능 없음
    koLedger: () => {
      const db = getFirestore();
      if (!db) return null;
      if (!ledgerCache || ledgerCache.db !== db) ledgerCache = { db, ledger: new FirestoreKoLedger(db) };
      return ledgerCache.ledger;
    },
    koClient: () => (koClient === undefined ? (koClient = createKoGeminiClient()) : koClient),
    getStore: () => {
      const db = getFirestore();
      if (!db) return null;
      if (!cached || cached.db !== db) cached = { db, store: new FirestoreCeoStateStore(db) };
      return cached.store;
    },
  });
}

/** 아직 번역되지 않은 X 게시물을 최신순으로 번역 (호출 최대 calls회) */
export async function translatePendingXPosts(runtime: CeoRuntime, statements: any[], deadline: number, calls = 3) {
  const texts = [...statements].sort((a, b) => String(b.referenceDate?.value || '').localeCompare(String(a.referenceDate?.value || ''))).map(x => String(x.quoteText || ''));
  const reports = [];
  for (let i = 0; i < calls; i++) {
    const r = await runtime.translateHeadlines(texts, deadline, true);
    reports.push(r);
    if (!r.translated || r.stoppedReason || r.pending <= r.sent) break;
  }
  return reports;
}

/** 아직 번역되지 않은 보도 헤드라인을 묶어 번역 (호출 최대 1회) */
export async function translatePendingHeadlines(runtime: CeoRuntime, getReportedEvents: () => HeadlineEvent[] | Promise<HeadlineEvent[]>, deadline: number) {
  const texts = reportedCeoStatements(await getReportedEvents()).map((x: any) => String(x.quoteText || ''));
  return runtime.translateHeadlines(texts, deadline);
}

export function createCeoRouter(deps: {
  runtime?: CeoRuntime;
  getReportedEvents?: () => HeadlineEvent[] | Promise<HeadlineEvent[]>;
  getVideoStatements?: () => any[] | Promise<any[]>;
  /** 본인 X 게시물 (xPosts 저장소) */
  getXStatements?: () => any[] | Promise<any[]>;
  getRuntime?: () => CeoRuntime | null;
  verifyAdmin: Middleware;
  /** 공개 묶음 응답 캐시(ms). 기본: 운영 120초, 그 외 0(끄기) */
  datasetCacheMs?: number;
}) {
  const router = express.Router();
  const getActiveRuntime = (): CeoRuntime => {
    const r = deps.getRuntime ? deps.getRuntime() : deps.runtime;
    if (!r) throw new Error('CEO runtime is not available');
    return r;
  };

  /** 공개 화면용 묶음(공식 발언 + 보도 헤드라인 + X + 영상). koResults는 한 번만 읽음 */
  const assemble = async () => {
    const snap: any = await getActiveRuntime().snapshot();
    if (!snap?.dataset || !Array.isArray(snap.dataset.statements)) return snap;
    let results: Record<string, any> = {};
    try { results = await getActiveRuntime().koResults(); } catch { /* 번역 없이 원문 표시 */ }
    const withKo = (x: any) => { const t = results[headlineKey(x.quoteText)]; return t?.title ? { ...x, aiTranslationKo: t.title } : x; };
    const [reported, posts, vids] = await Promise.all([
      // Tesla 공식 출처가 403으로 막혀 있어, 이미 수집한 기사 헤드라인의 '머스크 발언 보도'를 따로 표시(직접 인용 아님)
      deps.getReportedEvents ? Promise.resolve(deps.getReportedEvents()).then(e => reportedCeoStatements(e).map(withKo)).catch(() => []) : [],
      // 본인 X 게시물 (AI 번역이 있으면 함께)
      deps.getXStatements ? Promise.resolve(deps.getXStatements()).then(x => x.map(withKo)).catch(() => []) : [],
      // CEO 발언 영상 자막에서 확인한 인용 (유튜브 요약 런타임이 저장)
      deps.getVideoStatements ? Promise.resolve(deps.getVideoStatements()).catch(() => []) : [],
    ]);
    const ids = new Set(snap.dataset.statements.map((x: any) => x.statementId));
    const extra = [...reported, ...posts, ...vids].filter((x: any) => !ids.has(x.statementId) && (ids.add(x.statementId), true));
    return { ...snap, dataset: { ...snap.dataset, statements: [...snap.dataset.statements, ...extra] } };
  };
  // 응답 캐시: 2분 동안 같은 묶음을 바로 보내고, 1분이 지나면 뒤에서 새로 만듦(첫 화면 대기 ~2초 → 즉시)
  let dsCache: { at: number; body: any } | null = null;
  let building: Promise<any> | null = null;
  const rebuild = () => (building ||= assemble().then(body => { if (body?.dataset) dsCache = { at: Date.now(), body }; return body; }).finally(() => { building = null; }));
  const invalidate = () => { dsCache = null; };
  const ttl = deps.datasetCacheMs ?? (process.env.NODE_ENV === 'production' ? 120_000 : 0);
  if (ttl > 0) setTimeout(() => { rebuild().catch(() => null); }, 8000).unref?.();

  router.get('/api/ceo/dataset', async (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const age = dsCache ? Date.now() - dsCache.at : Infinity;
      if (ttl > 0 && dsCache && age < ttl) {
        if (age > ttl / 2) rebuild().catch(() => null);
        return res.json(dsCache.body);
      }
      res.json(await rebuild());
    } catch (e: any) {
      res.status(500).json({ status: 'error', refreshedAt: null, dataset: null, sources: [], error: String(e?.message || e).slice(0, 160) });
    }
  });
  router.post('/api/admin/ceo/refresh', deps.verifyAdmin, async (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const r = await getActiveRuntime().refresh();
      invalidate();
      // 공식 원문 수집 뒤 언론 헤드라인 번역도 함께(최대 1회 호출, 실패해도 응답에 영향 없음)
      if (deps.getReportedEvents) await translatePendingHeadlines(getActiveRuntime(), deps.getReportedEvents, Date.now() + 90_000).catch(() => null);
      if (r.httpStatus === 200) return res.json(r.response);
      res.status(r.httpStatus).json({ ...r.response, error: r.error, reason: r.reason });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e).slice(0, 160) });
    }
  });
  // CEO 한국어 요약: 관리자 인증 필요(기존 verifyAdmin). 본문 JSON은 server.ts의 전역 express.json()이 해석. 설정(켜기·끄기·한도 USD 1 이하)과 지정 발언 1건 생성만
  router.post('/api/admin/ceo/ko-summary/settings', deps.verifyAdmin, async (req: express.Request, res: express.Response) => {
    invalidate();
    res.setHeader('Cache-Control', 'no-store');
    try {
      const b = req.body || {};
      const r: any = await getActiveRuntime().koConfigure({ enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined, limitUsd: b.limitUsd });
      res.status(r.httpStatus).json(r);
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e).slice(0, 160) }); }
  });
  router.post('/api/admin/ceo/ko-summary/one', deps.verifyAdmin, async (req: express.Request, res: express.Response) => {
    invalidate();
    res.setHeader('Cache-Control', 'no-store');
    try {
      const b = req.body || {};
      if (typeof b.statementId !== 'string' || !b.statementId) return res.status(400).json({ error: 'statementId 필요' });
      const r = await getActiveRuntime().koOne(b.statementId, { overrideReviewed: b.overrideReviewed === true });
      res.status(r.httpStatus).json(r);
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e).slice(0, 160) }); }
  });
  return router;
}
