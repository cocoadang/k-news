/**
 * CEO 발언 Express 라우터 (운영 server.ts와 HTTP 테스트가 같은 라우터를 씀).
 * - GET  /api/ceo/dataset        저장된 CEO 상태 읽기·복원만 (원문 요청·추출·모델·알림·쓰기 없음)
 * - POST /api/admin/ceo/refresh  관리자 인증 필요: lease 획득 → 공식 피드·선별 IR 기록 한정 읽기 → 저장 성공 후에만 200
 *   실패 코드: 409 진행 중·펜싱 거절, 429 최소 간격, 413 저장 크기 초과, 502 모든 출처 실패, 503 저장소 없음·불가·권한, 504 기한·저장 시간 초과
 * db 싱글턴을 불러오지 않습니다. 운영에서는 server.ts가 이벤트 목록 함수와 관리자 인증 미들웨어를 주입합니다.
 */
import express from 'express';
import Parser from 'rss-parser';
import { CeoRuntime, ceoAllowedHosts, feedCompanyIds } from './runtime';
import { EventLike, FeedItem, discoveryAllowedHosts } from './officialSource';
import { createFetchBytes, createFetchText } from './fetchText';
import { FirestoreCeoStateStore } from './firestoreStateStore';
import { CEO_PERSONS, CEO_ROLES } from './registry';
import { CURATED_SEC_EXHIBITS, SEC_HOST, SEC_USER_AGENT } from './secExhibits';
import { CURATED_PAGES } from './officialPages';
import { FirestoreKoLedger } from './koLedger';
import { createKoGeminiClient } from './koGeminiClient';
import { HeadlineEvent, reportedMuskTeslaStatements } from './reportedHeadlines';

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

export function createCeoRouter(deps: {
  runtime?: CeoRuntime;
  getReportedEvents?: () => HeadlineEvent[] | Promise<HeadlineEvent[]>;
  getRuntime?: () => CeoRuntime | null;
  verifyAdmin: Middleware;
}) {
  const router = express.Router();
  const getActiveRuntime = (): CeoRuntime => {
    const r = deps.getRuntime ? deps.getRuntime() : deps.runtime;
    if (!r) throw new Error('CEO runtime is not available');
    return r;
  };

  router.get('/api/ceo/dataset', async (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const snap: any = await getActiveRuntime().snapshot();
      // Tesla 공식 출처가 403으로 막혀 있어, 이미 수집한 기사 헤드라인의 '머스크 발언 보도'를 따로 표시합니다(직접 인용 아님).
      if (snap?.dataset && Array.isArray(snap.dataset.statements) && deps.getReportedEvents) {
        try {
          const extra = reportedMuskTeslaStatements(await deps.getReportedEvents());
          const ids = new Set(snap.dataset.statements.map((x: any) => x.statementId));
          snap.dataset = { ...snap.dataset, statements: [...snap.dataset.statements, ...extra.filter(x => !ids.has(x.statementId))] };
        } catch { /* 보조 자료 실패는 공식 자료 응답에 영향 없음 */ }
      }
      res.json(snap);
    } catch (e: any) {
      res.status(500).json({ status: 'error', refreshedAt: null, dataset: null, sources: [], error: String(e?.message || e).slice(0, 160) });
    }
  });
  router.post('/api/admin/ceo/refresh', deps.verifyAdmin, async (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const r = await getActiveRuntime().refresh();
      if (r.httpStatus === 200) return res.json(r.response);
      res.status(r.httpStatus).json({ ...r.response, error: r.error, reason: r.reason });
    } catch (e: any) {
      res.status(500).json({ error: String(e?.message || e).slice(0, 160) });
    }
  });
  // CEO 한국어 요약: 관리자 인증 필요(기존 verifyAdmin). 본문 JSON은 server.ts의 전역 express.json()이 해석. 설정(켜기·끄기·한도 USD 1 이하)과 지정 발언 1건 생성만
  router.post('/api/admin/ceo/ko-summary/settings', deps.verifyAdmin, async (req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const b = req.body || {};
      const r: any = await getActiveRuntime().koConfigure({ enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined, limitUsd: b.limitUsd });
      res.status(r.httpStatus).json(r);
    } catch (e: any) { res.status(500).json({ error: String(e?.message || e).slice(0, 160) }); }
  });
  router.post('/api/admin/ceo/ko-summary/one', deps.verifyAdmin, async (req: express.Request, res: express.Response) => {
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
