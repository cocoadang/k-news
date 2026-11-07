/**
 * CEO 발언 실행 상태 (영속 저장소 기반).
 * - snapshot(): GET용. 저장소의 head(판 번호)를 읽고, 판이 바뀌었을 때만 조각을 읽어 복원. 원문 요청·추출·모델·알림·쓰기 없음.
 *   서버 재시작·다른 인스턴스에서도 같은 저장 판을 보여줌.
 * - refresh(): 관리자 요청 시에만. 저장소 lease(펜싱 토큰) 획득 → 공식 피드(기존 기사 URL 한정)·선별 IR 기록을 전체 기한 안에서 읽고
 *   기사 ID+본문 hash+추출기 버전 캐시로 바뀐 원문만 다시 추출 → 원문 재검증 → 이력과 대조(피드 창 밖·일시 실패 ≠ 삭제)
 *   → 토큰·lease·기준 판이 모두 맞을 때만 원자적으로 저장. 성공 응답은 저장 완료 뒤에만.
 *   실패하면 lease만 풀고 실패 시도를 기록(기존 이력·판은 그대로).
 * 이 모듈은 db 싱글턴·Firestore SDK·수집기·스케줄러·Telegram을 불러오지 않습니다(이벤트 목록·저장소는 주입).
 */
import { pdfToText } from './pdfText';
import { randomUUID } from 'node:crypto';
import { CeoApiResponse, CeoPerson, CeoRole, CeoSourceReport, CeoTopic } from '../../src/ceo/types';
import { buildCeoDataset, emptyCeoCache, refreshCeoCache, RefreshReport, SourceArticle, StatementExtractor } from './pipeline';
import { ceoFeeds, EventLike, FeedItem, loadOfficialArticles, loadDiscoveredArticles, extractDiscoveredQuotes, discoveryAllowedHosts, DISCOVERY_VERSION } from './officialSource';
import { CEO_PERSONS, CEO_ROLES, CEO_TOPICS, FEED_EXTRACTOR_PERSON_IDS } from './registry';
import { createQuoteExtractor, QUOTE_EXTRACTOR_VERSION } from './quoteExtractor';
import { CURATED_TRANSCRIPTS, CURATION_HASH, CuratedTranscript, extractCuratedQuotes, transcriptArticle } from './transcripts';
import { activePages, CURATED_PAGES, CuratedPage, extractPageQuotes, pageArticle, PAGES_HASH } from './officialPages';
import { CURATED_SEC_EXHIBITS, CuratedSecExhibit, extractSecQuotes, SEC_HASH, secArticle, secReady } from './secExhibits';
import { withTranslation } from './translations';
import { KoLedger } from './koLedger';
import { KoClient, KoRunReport, koInfo, koSummaryFor, runKoSummaries } from './koSummary';
import { translateHeadlines } from './koHeadlines';
import { reconcileHistory, visibleStatements } from './history';
import { ceoUrlHash } from './urlHash';
import { htmlToText } from './htmlText';
import { FetchBytes, FetchText, SourceFetchError } from './fetchText';
import { CeoStateStore, LastResult, StoredPayload, StoredState, StoreError, StoreHead } from './stateStore';

export interface CeoRuntimeOptions {
  getEvents: () => EventLike[];
  fetchText: FetchText;
  parseFeed: (xml: string) => Promise<FeedItem[]>;
  /** 영속 저장소. null이면 조회는 오류, 갱신은 503 (메모리로 대신하지 않음) */
  getStore: () => CeoStateStore | null;
  registry?: { persons: CeoPerson[]; roles: CeoRole[]; topics: CeoTopic[] };
  transcripts?: CuratedTranscript[];
  /** 선별 공식 페이지 (운영은 CURATED_PAGES를 명시 전달, 생략하면 없음). hold 표시 페이지는 요청하지 않음 */
  pages?: CuratedPage[];
  /** SEC 제출 문서 검증 항목 (운영은 CURATED_SEC_EXHIBITS 명시 전달, 생략하면 없음) + SEC 전용 원본 바이트 요청기 */
  secExhibits?: CuratedSecExhibit[];
  fetchSecBytes?: FetchBytes;
  /** 공식 자료실 PDF(주주서한) 바이트 요청기: 허용 호스트만 */
  fetchPdfBytes?: FetchBytes;
  /** 갱신 1회의 원문 요청 상한(피드·IR 기록·페이지·SEC 합계). 기본 12 */
  maxSourceRequests?: number;
  /** 전역 최소 갱신 간격(모든 인스턴스 공통, 저장소 head 기준). 기본 10분 */
  minIntervalMs?: number;
  /** lease 길이. 기본 5분 (전체 원문 기한보다 길어야 함) */
  leaseMs?: number;
  /** 원문 읽기 전체 기한. 기본 2분 */
  deadlineMs?: number;
  /** GET에서 head 재확인 간격. 기본 10초 */
  headCacheMs?: number;
  now?: () => number;
  holder?: string;
  /** CEO 한국어 요약 원장·Gemini 어댑터 (없으면 기능 없음: 조회에 상태만 '알 수 없음' 없이 생략) */
  koLedger?: () => KoLedger | null;
  koClient?: () => KoClient | null;
  /** 테스트 전용: 가상(isExample) 인물 자료 저장 허용. 운영 기본 false → 가상 자료는 운영 이력에 저장되지 않음 */
  allowExampleData?: boolean;
  /** 운영의 독립 공식자료 탐색. 테스트·개별 도구는 명시적으로 켰을 때만. */
  discovery?: boolean;
}

export interface RefreshOutcome {
  accepted: boolean;
  httpStatus: number;
  reason?: string;
  error?: string;
  response: CeoApiResponse;
}

/**
 * 피드 인용 추출기 + 선별 기록·선별 공식 페이지 검증기 (버전에 선별 목록 해시 포함 → 목록이 바뀌면 다시 추출).
 * 피드 추출기의 이름 매칭 대상은 FEED_EXTRACTOR_PERSON_IDS(기존 3인)만 — 등록부에 인물이 늘어도 피드에서 새 인용이 늘지 않음.
 */
export function createCompositeExtractor(persons: CeoPerson[], transcripts: CuratedTranscript[], pages: CuratedPage[] = [], sec: CuratedSecExhibit[] = []): StatementExtractor {
  const feedPersons = persons.filter(p => p.isExample || FEED_EXTRACTOR_PERSON_IDS.includes(p.personId));
  const feed = createQuoteExtractor(feedPersons);
  const tv = transcripts === CURATED_TRANSCRIPTS ? CURATION_HASH : 'custom-' + transcripts.map(t => t.sourceId + ':' + t.quotes.length).join(',');
  const pv = pages.length ? `+p${pages === CURATED_PAGES ? PAGES_HASH : 'custom-' + pages.map(p => p.sourceId + ':' + p.quotes.length).join(',')}` : '';
  const sv = sec.length ? `+s${sec === CURATED_SEC_EXHIBITS ? SEC_HASH : 'custom-' + sec.map(e => e.secId + ':' + e.rawSha256.slice(0, 12)).join(',')}` : '';
  return {
    name: 'ceo-composite',
    version: `1.0+q${QUOTE_EXTRACTOR_VERSION}+c${tv}${pv}${sv}+d${DISCOVERY_VERSION}`,
    async extract(a: SourceArticle) {
      if (a.sourceKind === 'discovered') return (await extractDiscoveredQuotes(a)).filter(r => !a.discoveryTopics || a.discoveryTopics.includes(r.topicId));
      if (a.sourceKind === 'transcript') {
        const t = transcripts.find(x => x.sourceId === a.transcriptId);
        return t ? extractCuratedQuotes(t, a.body).items : [];
      }
      if (a.sourceKind === 'page') {
        const p = pages.find(x => x.sourceId === a.pageId);
        return p ? extractPageQuotes(p, a.body).items : [];
      }
      if (a.sourceKind === 'sec') {
        const e = sec.find(x => x.secId === a.secId);
        return e ? extractSecQuotes(e, a.body).items : [];
      }
      return feed.extract(a);
    },
  };
}

/** 원문 요청이 허용되는 호스트 (CEO 피드 + 선별 기록 + 보류 아닌 선별 공식 페이지). SEC는 별도 전용 요청기(www.sec.gov만) */
export function ceoAllowedHosts(companyIds: string[], transcripts: CuratedTranscript[] = CURATED_TRANSCRIPTS, pages: CuratedPage[] = CURATED_PAGES): string[] {
  return Array.from(new Set([
    ...ceoFeeds(companyIds).map(f => new URL(f.url).hostname),
    ...transcripts.map(t => new URL(t.url).hostname),
    ...activePages(pages).map(p => new URL(p.url).hostname),
  ]));
}

/** CEO 공식 피드를 읽는 회사: 피드 추출 대상 인물(기존 3인, 테스트의 예시 인물)의 회사만 — 등록부에 SpaceX 등 역할이 늘어도 피드가 늘지 않음 */
export function feedCompanyIds(registry: { persons: CeoPerson[]; roles: CeoRole[] }): string[] {
  const ids = new Set(registry.persons.filter(p => p.isExample || FEED_EXTRACTOR_PERSON_IDS.includes(p.personId)).map(p => p.personId));
  return Array.from(new Set(registry.roles.filter(r => ids.has(r.personId)).map(r => r.companyId)));
}

/** 갱신 1회 원문 요청 상한 기본값: 피드 3 + IR 기록 2 + 선별 페이지 7(보류 Tesla 2 제외, NASA 2건 포함) + SEC 2 = 14 */
export const DEFAULT_MAX_SOURCE_REQUESTS = 18;

const STORE_HTTP: Record<string, number> = { too_large: 413, timeout: 504, unavailable: 503, permission_denied: 503, corrupt: 500, not_configured: 503 };
const asStoreError = (e: any) => (e instanceof StoreError ? e : new StoreError('unavailable', String(e?.message || e).slice(0, 160)));
const short = (e: any) => String(e?.message || e).slice(0, 160);

export class CeoRuntime {
  readonly registry: { persons: CeoPerson[]; roles: CeoRole[]; topics: CeoTopic[] };
  readonly transcripts: CuratedTranscript[];
  readonly pages: CuratedPage[];
  readonly secExhibits: CuratedSecExhibit[];
  readonly extractor: StatementExtractor;
  readonly holder: string;
  lastRefreshReport: RefreshReport | null = null;
  lastKoReport: KoRunReport | null = null;
  private inFlight: Promise<RefreshOutcome> | null = null;
  private headCache: { at: number; head: StoreHead | null } | null = null;
  private stateCache: StoredState | null = null;

  constructor(private opts: CeoRuntimeOptions) {
    this.registry = opts.registry || { persons: CEO_PERSONS, roles: CEO_ROLES, topics: CEO_TOPICS };
    this.transcripts = opts.transcripts || CURATED_TRANSCRIPTS;
    // 선별 공식 페이지는 명시적으로 넘길 때만(운영: routes.createCeoRuntime이 CURATED_PAGES 전달). 기본은 없음
    this.pages = opts.pages || [];
    this.secExhibits = opts.secExhibits || [];
    this.extractor = createCompositeExtractor(this.registry.persons, this.transcripts, this.pages, this.secExhibits);
    this.holder = opts.holder || `ceo-${randomUUID()}`;
  }

  private now() { return (this.opts.now || Date.now)(); }

  private noStore(): CeoApiResponse {
    return { status: 'error', refreshedAt: null, dataset: null, sources: [], historyDurable: false, storeError: 'not_configured',
      message: 'CEO 이력 저장소(Firestore)를 사용할 수 없어 저장된 발언을 표시할 수 없습니다.' };
  }

  private notLoaded(store: CeoStateStore, head: StoreHead | null): CeoApiResponse {
    const failed = head?.lastAttempt ? ` 마지막 갱신 시도(${head.lastAttempt.at})는 실패했습니다: ${head.lastAttempt.message}` : '';
    return { status: 'not_loaded', refreshedAt: null, dataset: null, sources: [], historyDurable: store.durable, storeRevision: head?.revision ?? 0,
      message: `공식 출처 원문을 아직 불러와 저장한 적이 없습니다.${failed}` };
  }

  private compose(store: CeoStateStore, st: StoredState): CeoApiResponse {
    const r = st.head.lastResult!;
    const records = st.payload.records;
    const attempt = st.head.lastAttempt;
    return {
      status: attempt ? 'partial' : r.status,
      refreshedAt: st.head.committedAt,
      // 한국어 번역은 조회 응답에서만 정적 사전으로 붙임(저장 이력·키·판 번호 변화 없음, 재수집 불필요)
      dataset: { ...r.dataset, comparisons: [], statements: visibleStatements(records).map(withTranslation) },
      sources: r.sources,
      historyDurable: store.durable,
      storeRevision: st.head.revision,
      withdrawnCount: records.filter(x => x.status === 'withdrawn' || x.status === 'source_removed').length,
      message: attempt ? `마지막 갱신 시도(${attempt.at})가 실패해 저장된 확인 기록(${st.head.committedAt})을 표시합니다: ${attempt.message}` : r.message,
    };
  }

  /** GET: 저장된 상태 + 한국어 요약 원장을 읽기만 함 (모델 호출·원문 요청·쓰기 없음) */
  async snapshot(): Promise<CeoApiResponse> {
    return this.withKo(await this.snapshotBase());
  }

  /** 원장(결과 캐시·이번 달 예산)을 읽어 붙임. 읽기 실패면 상태 '알 수 없음'·요약 없음(원문 표시) */
  private async withKo(r: CeoApiResponse): Promise<CeoApiResponse> {
    const ledger = this.opts.koLedger?.();
    if (!ledger) return r;
    let state = null; let err: string | undefined;
    try { state = await ledger.read(); } catch (e: any) { err = `한국어 요약 원장을 읽지 못함: ${short(e)}`; }
    const info = koInfo(state, this.now(), err);
    if (!r.dataset) return { ...r, koSummary: info };
    return { ...r, koSummary: info, dataset: { ...r.dataset, statements: r.dataset.statements.map(s => {
      const k = koSummaryFor(s, state);
      return k ? { ...s, koSummary: k } : s;
    }) } };
  }

  private async snapshotBase(): Promise<CeoApiResponse> {
    const store = this.opts.getStore();
    if (!store) return this.noStore();
    try {
      const now = this.now();
      let head: StoreHead | null;
      if (this.headCache && now - this.headCache.at < (this.opts.headCacheMs ?? 10_000)) head = this.headCache.head;
      else { head = await store.readHead(); this.headCache = { at: now, head }; }
      if (!head || head.revision === 0) return this.notLoaded(store, head);
      if (!this.stateCache || this.stateCache.head.revision !== head.revision) {
        const st = await store.readState();
        if (!st || st.head.revision === 0) return this.notLoaded(store, st?.head ?? null);
        this.stateCache = st;
      }
      // 조각은 판이 바뀔 때만 다시 읽지만 lease·실패 시도 등 head의 최신 값은 반영
      const merged = this.stateCache.head.revision === head.revision ? { ...this.stateCache, head } : this.stateCache;
      return this.compose(store, merged);
    } catch (e) {
      const err = asStoreError(e);
      this.headCache = null;
      if (this.stateCache) {
        return { ...this.compose(store, this.stateCache), status: 'partial', storeError: err.code,
          message: `저장소 확인 실패(${err.code}): 이 서버가 마지막으로 읽은 저장 판 ${this.stateCache.head.revision}(${this.stateCache.head.committedAt})을 표시합니다.` };
      }
      return { status: 'error', refreshedAt: null, dataset: null, sources: [], historyDurable: store.durable, storeError: err.code,
        message: `CEO 이력 저장소를 읽지 못했습니다(${err.code}): ${err.message}` };
    }
  }

  /** 관리자 갱신 */
  async refresh(): Promise<RefreshOutcome> {
    const store = this.opts.getStore();
    if (!store) return { accepted: false, httpStatus: 503, reason: 'no_store', error: 'CEO 이력 저장소(Firestore)를 사용할 수 없어 갱신하지 않았습니다.', response: this.noStore() };
    if (this.inFlight) return { accepted: false, httpStatus: 409, reason: 'already_running', error: '이 서버에서 갱신이 이미 진행 중입니다.', response: await this.snapshot() };
    this.inFlight = this.doRefresh(store).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async fail(store: CeoStateStore, token: number, httpStatus: number, reason: string, message: string): Promise<RefreshOutcome> {
    let releaseNote = '';
    try { await store.release({ token, now: this.now(), attempt: { at: new Date(this.now()).toISOString(), status: 'error', message: message.slice(0, 300) } }); }
    catch (e) { releaseNote = ` (실패 기록도 저장하지 못함: ${asStoreError(e).code}; lease는 만료 시 풀림)`; }
    this.headCache = null;
    return { accepted: false, httpStatus, reason, error: message + releaseNote, response: await this.snapshot() };
  }

  private async doRefresh(store: CeoStateStore): Promise<RefreshOutcome> {
    const start = this.now();
    const leaseMs = this.opts.leaseMs ?? 5 * 60_000;
    const deadlineMs = Math.min(this.opts.deadlineMs ?? 2 * 60_000, Math.floor(leaseMs * 0.8)); // 기한 < lease
    let acq;
    try {
      acq = await store.acquire({ holder: this.holder, now: start, minIntervalMs: this.opts.minIntervalMs ?? 10 * 60_000, leaseMs });
    } catch (e) {
      const err = asStoreError(e);
      return { accepted: false, httpStatus: STORE_HTTP[err.code] ?? 503, reason: `store_${err.code}`, error: `갱신 시작 실패: ${err.message}`, response: await this.snapshot() };
    }
    if (acq.ok === false) {
      return { accepted: false, httpStatus: acq.reason === 'too_soon' ? 429 : 409, reason: acq.reason,
        error: acq.reason === 'too_soon' ? '잠시 후 다시 시도하세요 (최소 간격 10분, 모든 서버 공통).' : '다른 서버에서 갱신이 진행 중입니다.', response: await this.snapshot() };
    }
    const token = acq.token;
    const deadline = start + deadlineMs;

    let work: Awaited<ReturnType<CeoRuntime['collect']>>;
    try {
      work = await this.collect(acq.base, deadline);
    } catch (e) {
      return this.fail(store, token, 500, 'processing_error', `처리 오류: ${short(e)}`);
    }
    // 모든 출처가 '일시' 실패(404/410 삭제 확인 없음)일 때만 저장하지 않음. 삭제 확인이 하나라도 있으면 그 숨김 상태는 다른 실패와 섞여도 저장
    if (work.allFailedTemporarily) return this.fail(store, token, 502, 'all_sources_failed', '공식 출처를 모두 읽지 못했습니다(일시 실패). 기존 확인 기록은 그대로 둡니다.');
    if (this.now() > deadline) return this.fail(store, token, 504, 'deadline', `원문 읽기 전체 기한(${deadlineMs}ms)을 넘겨 저장하지 않았습니다.`);
    if (!this.opts.allowExampleData && (work.result.dataset.isExample || work.result.dataset.persons.some(p => p.isExample))) {
      return this.fail(store, token, 500, 'example_data_blocked', '가상(예시) 인물 자료는 운영 이력에 저장하지 않습니다.');
    }

    let res;
    try {
      // 시각은 트랜잭션 안에서(재시도마다) 다시 읽음 → 지연·재시도 중 lease가 만료되면 저장하지 않음
      res = await store.commit({ token, baseRevision: acq.head.revision, now: () => this.now(), payload: work.payload, result: work.result });
    } catch (e) {
      const err = asStoreError(e);
      if (err.code === 'timeout') {
        // 저장 결과 미확정: lease를 풀지 않음(풀면 저장이 이미 됐을 때 다른 서버가 곧바로 시작). 만료 시 자동 해제
        this.headCache = null;
        return { accepted: false, httpStatus: 504, reason: 'store_timeout', error: `저장 시간 초과(결과 미확정): ${err.message}`, response: await this.snapshot() };
      }
      return this.fail(store, token, STORE_HTTP[err.code] ?? 503, `store_${err.code}`, `저장 실패(${err.code}): ${err.message}`);
    }
    if (res.ok === false) {
      this.headCache = null;
      return { accepted: false, httpStatus: 409, reason: res.reason,
        error: res.reason === 'lease_expired' ? 'lease가 만료되어 이 갱신 결과를 저장하지 않았습니다(더 늦게 끝난 작업).' : '다른 갱신이 먼저 시작·저장되어 이 결과를 버렸습니다.', response: await this.snapshot() };
    }
    this.lastRefreshReport = work.report;
    this.stateCache = { head: res.head, payload: work.payload };
    this.headCache = { at: this.now(), head: res.head };
    const response = this.compose(store, this.stateCache);
    // 한국어 요약: 저장 성공 뒤, 같은 refresh 기한(lease 안) 안에서만, 이번에 처음 확인된 발언 중 기능을 켠 이후 것만
    const ledger = this.opts.koLedger?.();
    if (ledger && response.dataset) {
      try {
        const st = await ledger.read();
        if (st.enabled && st.activatedAt) {
          const fresh = response.dataset.statements.filter(x => x.verification?.firstVerifiedAt === work.result.refreshedAt && x.verification.firstVerifiedAt >= st.activatedAt!);
          this.lastKoReport = await runKoSummaries(fresh, { ledger, client: this.opts.koClient?.() ?? null, now: () => this.now(), deadline });
        }
      } catch (e) { this.lastKoReport = { considered: 0, cacheHits: 0, skippedReviewed: 0, counted: 0, calls: 0, settled: 0, uncertain: 0, stoppedReason: `원장 오류: ${short(e)}` }; }
    }
    return { accepted: true, httpStatus: 200, response: await this.withKo(response) };
  }

  /** 관리자 전용: 지정 발언 1건만 한국어 요약 (승인된 초기 확인용). 저장된 발언만 대상, 호출 최대 1회 */
  async koOne(statementId: string, opts: { overrideReviewed?: boolean } = {}): Promise<{ httpStatus: number; report?: KoRunReport; error?: string }> {
    const ledger = this.opts.koLedger?.();
    if (!ledger) return { httpStatus: 503, error: '한국어 요약 원장을 사용할 수 없습니다.' };
    const snap = await this.snapshotBase();
    const s = snap.dataset?.statements.find(x => x.statementId === statementId);
    if (!s) return { httpStatus: 404, error: '저장된 발언에서 찾지 못했습니다.' };
    const now = this.now();
    const report = await runKoSummaries([s], { ledger, client: this.opts.koClient?.() ?? null, now: () => this.now(), deadline: now + 60_000, overrideReviewed: !!opts.overrideReviewed, maxCalls: 1 });
    this.lastKoReport = report;
    return { httpStatus: 200, report };
  }

  /** 언론 헤드라인 AI 번역 (매일 수집 뒤·관리자 공식 원문 수집 뒤). 결과는 원장 캐시에 저장 */
  async translateHeadlines(texts: string[], deadline: number) {
    const ledger = this.opts.koLedger?.();
    if (!ledger) return { pending: 0, sent: 0, translated: 0, stoppedReason: '원장 없음' };
    return translateHeadlines(texts, { ledger, client: this.opts.koClient?.() ?? null, now: () => this.now(), deadline });
  }
  /** 읽기 전용: 헤드라인 번역 결과 캐시 */
  async koResults(): Promise<Record<string, { title: string }>> {
    const ledger = this.opts.koLedger?.();
    if (!ledger) return {};
    try { return (await ledger.read()).results; } catch { return {}; }
  }

  /** 관리자 전용: 켜기·끄기·한도(USD 1 이하) */
  async koConfigure(o: { enabled?: boolean; limitUsd?: number }) {
    const ledger = this.opts.koLedger?.();
    if (!ledger) return { httpStatus: 503, error: '한국어 요약 원장을 사용할 수 없습니다.' };
    if (o.limitUsd !== undefined && !(typeof o.limitUsd === 'number' && o.limitUsd >= 0 && o.limitUsd <= 1)) return { httpStatus: 400, error: '한도는 0~1 USD만 허용합니다.' };
    const st = await ledger.configure({ enabled: o.enabled, limitNano: o.limitUsd === undefined ? undefined : Math.floor(o.limitUsd * 1e9), now: this.now() });
    return { httpStatus: 200, info: koInfo(st, this.now()) };
  }

  /** 원문 읽기·추출·이력 대조 (저장소 쓰기 없음) */
  private async collect(base: StoredState | null, deadline: number) {
    // 요청 상한: 상한을 넘는 요청은 보내지 않고 실패로 기록(HTTP 0)
    const cap = this.opts.maxSourceRequests ?? (this.opts.discovery ? 60 : DEFAULT_MAX_SOURCE_REQUESTS);
    let requests = 0;
    const admit = () => {
      if (this.now() >= deadline) throw new SourceFetchError('overall deadline exceeded');
      if (requests >= cap) throw new SourceFetchError(`source request cap reached (${cap})`);
      requests++;
    };
    const fetched = new Map<string, Promise<string>>();
    const fetchText = async (u: string, opts?: { deadline?: number }) => {
      if (!fetched.has(u)) { admit(); fetched.set(u, this.opts.fetchText(u, { deadline: Math.min(deadline, opts?.deadline ?? deadline) })); }
      return fetched.get(u)!;
    };
    const companyIds = feedCompanyIds(this.registry);
    const { articles: feedArticles, reports } = await loadOfficialArticles(this.opts.getEvents(), companyIds, { fetchText, parseFeed: this.opts.parseFeed });
    const articles: SourceArticle[] = [...feedArticles];
    const removed = new Set<string>();
    for (const t of this.transcripts) {
      const id = ceoUrlHash(t.url);
      const rep: CeoSourceReport = { feedName: t.title, feedUrl: t.url, ok: false, itemsInFeed: 1, matchedExisting: 0, withBody: 0, kind: 'transcript' };
      reports.push(rep);
      try {
        const text = htmlToText(await fetchText(t.url));
        const art = transcriptArticle(t, text);
        rep.ok = true;
        if (art) { articles.push({ ...art, articleId: id }); rep.withBody = 1; }
        const check = extractCuratedQuotes(t, art ? art.body : text);
        if (check.rejected.length) rep.rejectedQuotes = check.rejected;
      } catch (e: any) {
        rep.error = short(e);
        if (e instanceof SourceFetchError && (e.httpStatus === 404 || e.httpStatus === 410)) removed.add(id);
      }
    }
    for (const p of this.pages) {
      const id = ceoUrlHash(p.url);
      const rep: CeoSourceReport = { feedName: p.title, feedUrl: p.url, ok: false, itemsInFeed: 1, matchedExisting: 0, withBody: 0, kind: 'page' };
      reports.push(rep);
      if (p.hold) {
        // 일시 보류: 요청 0, 삭제·성공 아님(이전 확인 기록은 not_rechecked로 유지)
        rep.held = { reason: p.hold.reason, since: p.hold.since }; rep.error = `보류: ${p.hold.reason}`;
        continue;
      }
      try {
        const text = htmlToText(await fetchText(p.url));
        const art = pageArticle(p, text);
        rep.ok = true;
        if (art) { articles.push({ ...art, articleId: id }); rep.withBody = 1; }
        const check = extractPageQuotes(p, art ? art.body : text);
        if (check.rejected.length) rep.rejectedQuotes = check.rejected;
      } catch (e: any) {
        rep.error = short(e);
        if (e instanceof SourceFetchError && (e.httpStatus === 404 || e.httpStatus === 410)) removed.add(id);
      }
    }
    // SEC 제출 문서: 전용 요청기(정직한 User-Agent·리다이렉트 0·재시도 0). 요청이 하나라도 실패하면 이번 갱신의 남은 SEC 요청은 보내지 않음
    let secStop: string | null = null;
    for (const e of this.secExhibits) {
      const id = ceoUrlHash(e.url);
      const rep: CeoSourceReport = { feedName: e.title, feedUrl: e.url, ok: false, itemsInFeed: 1, matchedExisting: 0, withBody: 0, kind: 'sec' };
      reports.push(rep);
      const hold = (reason: string) => { rep.held = { reason }; rep.error = `보류: ${reason}`; };
      const ready = secReady(e);
      if (ready.ok === false) { hold(ready.reason); continue; }
      if (!this.opts.fetchSecBytes) { hold('SEC 전용 요청기가 없음 — 요청하지 않음'); continue; }
      if (secStop) { hold(`같은 갱신의 앞선 SEC 요청 실패(${secStop}) — 남은 SEC 요청 중단, 재시도하지 않음`); continue; }
      let bytes: Uint8Array;
      try {
        admit();
        bytes = await this.opts.fetchSecBytes(e.url, { deadline });
      } catch (err: any) {
        rep.error = short(err); secStop = rep.error;
        if (err instanceof SourceFetchError && (err.httpStatus === 404 || err.httpStatus === 410)) removed.add(id);
        continue;
      }
      const r = secArticle(e, bytes);
      if (r.ok === false) { hold(r.reason); continue; } // 해시 불일치 등: 기사로 쓰지 않음 → 이전 기록은 not_rechecked
      rep.ok = true; rep.withBody = 1;
      articles.push({ ...r.article, articleId: id });
      const check = extractSecQuotes(e, r.article.body);
      if (check.rejected.length) rep.rejectedQuotes = check.rejected;
    }
    let discovery = base?.payload.discovery;
    if (this.opts.discovery && this.now() < deadline - 15000) {
      const result = await loadDiscoveredArticles({
        fetchText, parseFeed: this.opts.parseFeed, now: () => this.now(), deadline,
        previous: discovery, existing: visibleStatements(base?.payload.records ?? []),
        knownUrls: new Set(articles.map(a => a.url)),
        fetchSecText: this.opts.fetchSecBytes ? async (url, at) => { admit(); return new TextDecoder().decode(await this.opts.fetchSecBytes!(url, { deadline: at })); } : undefined,
        fetchPdfText: this.opts.fetchPdfBytes ? async (url, at) => { admit(); return pdfToText(await this.opts.fetchPdfBytes!(url, { deadline: at }), { maxPages: 60 }); } : undefined,
      });
      articles.push(...result.articles); reports.push(...result.reports); discovery = result.state;
      result.removed.forEach(id => removed.add(id));
    }
    const prevCache = base?.payload.cache ?? emptyCeoCache();
    const refreshed = await refreshCeoCache(articles, prevCache, this.extractor);
    const built = await buildCeoDataset(articles, refreshed.cache, this.registry, { extractor: this.extractor });
    const nowIso = new Date(this.now()).toISOString();
    const records = reconcileHistory({
      previous: base?.payload.records ?? [], current: built.dataset.statements,
      readArticleIds: new Set(articles.map(a => a.articleId)), removedArticleIds: removed, now: nowIso,
    });
    const failed = reports.filter(r => !r.ok).length;
    const allFailedTemporarily = reports.length > 0 && failed === reports.length && removed.size === 0;
    const { statements: _omit, ...datasetHead } = built.dataset;
    const result: LastResult = {
      status: failed > 0 ? 'partial' : 'ready',
      refreshedAt: nowIso,
      sources: reports,
      dataset: { ...datasetHead, comparisons: [] },
      message: failed > 0
        ? `일부 공식 출처를 읽지 못했습니다. 그 출처의 발언은 이전 확인 기록으로만 표시합니다.${removed.size ? ` 삭제가 확인된(404/410) 출처 ${removed.size}곳의 발언은 숨겼습니다.` : ''}`
        : undefined,
    };
    const payload: StoredPayload = { records, cache: built.cache, ...(discovery ? { discovery } : {}) };
    return { payload, result, allFailedTemporarily, report: refreshed.report };
  }
}
