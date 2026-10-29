import { NewsEvent } from './types';

/**
 * Shared Noise Filter for Investment News Collection, Analysis Pipeline, and Company Profile Renewal
 * Eliminates job postings, user tech support queries, developer API references, product usage guides,
 * and unrelated natural photography, while strictly preserving legitimate earnings, financial results,
 * contracts, regulations, and major commercial product launches.
 */

// Explicit job posting / recruitment patterns
const RECRUITMENT_REGEX =
  /(채용\s*공고|신입\s*채용|경력\s*채용|인턴\s*모집|인턴십|인턴\b|구인|공채|\b채용\b|hiring\b|we\s+are\s+hiring|job\s+opening|job\s+posting|job\s+listing|careers\s+at\b|open\s+positions\b|\bintern\b|\binternship\b|engineering\s+intern|software\s+engineering\s+intern|student\s+intern)/i;

// Customer support / troubleshooting patterns
const SUPPORT_REGEX =
  /(고객센터|기술지원|오류\s*해결|질문답변|단순\s*질문|how\s+to\s+fix|troubleshooting|customer\s+support|user\s+forum|\bq&a\b|error\s+code\s+0x|error\s+message|help\s+desk)/i;

// Developer API documentation / library reference patterns
const API_DOC_REGEX =
  /(api\s+documentation|sdk\s+docs|developer\s+docs|api\s+reference|npm\s+release|release\s+notes\s+v\d|minor\s+bug\s+fix|api\s+문서|개발자\s+레퍼런스|sdk\s+reference|api\s+guide|class\s*\(api\s+ref\)|\bclass\b.*\(api\s+ref\)|\binterface\b.*\(api\s+ref\)|\bnamespace\b.*\(api\s+ref\)|onunauthenticatedrequest)/i;

// Product usage guides / tutorials / training / certification
const TUTORIAL_GUIDE_REGEX =
  /(certification\s+program|training\s+module|copilot\s+cowork|microsoft\s+learn|nvidia\s+docs|developer\.nvidia\.com|learn\.microsoft\.com|user\s+guide|getting\s+started\s+guide|how\s+to\s+use|step-by-step\s+tutorial|use\s+sales\s+skills\s+in)/i;

// NASA / Astronomy natural photography without investment relevance
const NASA_NATURAL_PHOTO_REGEX =
  /(earthobservatory\.nasa\.gov|apod\.nasa\.gov|image\s+of\s+the\s+day|astronomy\s+picture\s+of\s+the\s+day|waters\s+of\s+rupert\s+bay|the\s+beaver\s+brown\s+waters|clouds\s+over|ice\s+shelf\s+calving|volcano\s+erupts|aurora\s+borealis\s+over|aurora\s+australis)/i;

// Legitimate investment & financial transaction keywords that must be preserved
const GENUINE_INVESTMENT_REGEX =
  /(실적|매출|영업이익|순이익|재무제표|분기\s*실적|주가|시총|기업가치|밸류에이션|자금조달|투자유치|수주\s*계약|공급\s*계약|납품\s*계약|계약\s*체결|수주\b|반독점\s*소송|반독점\s*규제|과징금|제재|인수\s*합병|m&a|capex|설비투자|수주액|출시\b|공개\b|신제품|파운드리|수주|규제|승인|허가|earnings|quarterly\s+revenue|operating\s+profit|net\s+income|billion\s+contract|contract\s+award|awards\s+.*contract|deal\s+signed|antitrust|lawsuit|merger|acquisition|guidance|launches\b|unveils\b|announces\s+deal)/i;

// Unambiguous strict noise headlines that must NEVER be rescued
const STRICT_NOISE_REGEX =
  /(software\s+engineering\s+intern|채용\s*공고|인턴\s*모집|신입\s*채용|job\s+opening|we\s+are\s+hiring|how\s+to\s+fix|error\s+code\s+0x|api\s+documentation|api\s+reference|class\s*\(api\s+ref\)|onunauthenticatedrequest|copilot\s+cowork|certification\s+program|waters\s+of\s+rupert\s+bay|the\s+beaver\s+brown\s+waters|image\s+of\s+the\s+day)/i;

// 출처(매체명)·URL·제목 형식으로 판별하는 비뉴스 문서 (포럼 질문, 기술 문서, 마켓플레이스 등록, 채용, 다운로드 페이지)
// Google News 링크는 원래 도메인이 가려지므로 매체명(sourceName)을 우선 사용합니다.
const NOISE_SOURCE_NAME_REGEX =
  /(developer\s+forums?|tech\s*community|microsoft\s+q&a|community\s+hub|answers\.microsoft|reddit|stack\s*overflow|microsoft\s+learn|nvidia\s+docs|microsoft\s+marketplace|azure\s+marketplace|appsource|microsoft\s+adoption|microsoft\s+support)/i;
const NOISE_URL_REGEX =
  /(forums\.developer\.nvidia\.com|techcommunity\.microsoft\.com|answers\.microsoft\.com|learn\.microsoft\.com|docs\.nvidia\.com|marketplace\.microsoft\.com|azuremarketplace|appsource\.microsoft\.com|support\.microsoft\.com|jobs\.nvidia\.com|myworkdayjobs\.com|greenhouse\.io|lever\.co|\/careers?\/|reddit\.com|stackoverflow\.com)/i;
const NOISE_TITLE_FORMAT_REGEX =
  /(^showing tag results for|^support matrix$|descarga e instalaci[oó]n|free download|^kb\d{6,}|\(kb\d{6,}\)|^security update for |replacement .* - \d+(\.\d+)? inch|software engineering intern|\bintern\s*-\s*20\d\d)/i;
// 기업 자체 채용 페이지 (매체명이 기업명 그대로이고 제목이 직무명 형식)
const JOB_TITLE_FORMAT_REGEX =
  /^(senior |principal |staff |lead )?[a-z0-9 ,&/()–-]{0,60}\b(engineer|manager|intern|architect|scientist|director|specialist|developer relations)\b\s*(,|–|-|$)/i;
const COMPANY_SELF_SOURCE_REGEX = /^(nvidia|microsoft|google|alphabet|tesla|spacex)$/i;
// 공식 문서라도 가격·서비스 종료·정책 변경은 투자 정보가 될 수 있어 제외하지 않음
const DOC_MATERIAL_CHANGE_REGEX =
  /(pricing|price\s+(increase|hike|change)|retire(ment|s|d)?\b|deprecat|end\s+of\s+(life|support)|discontinu|sunset|가격\s*(인상|변경)|서비스\s*종료|지원\s*종료|정책\s*변경)/i;

/**
 * 매체명·URL·제목 형식만으로 비뉴스 문서를 판별합니다. 도메인 전체를 차단하지 않고,
 * 문서 내용이 가격·종료·정책 변경이면 통과시킵니다.
 */
export function classifyNoiseBySource(input: { sourceName?: string; url?: string; title?: string }): { isNoise: boolean; kind?: 'title_format' | 'source' | 'url' | 'job_posting' } {
  const title = (input.title || '').trim();
  const sourceName = (input.sourceName || '').trim();
  if (DOC_MATERIAL_CHANGE_REGEX.test(title)) return { isNoise: false };
  if (NOISE_TITLE_FORMAT_REGEX.test(title)) return { isNoise: true, kind: 'title_format' };
  if (NOISE_SOURCE_NAME_REGEX.test(sourceName)) return { isNoise: true, kind: 'source' };
  if (NOISE_URL_REGEX.test(input.url || '')) return { isNoise: true, kind: 'url' };
  if (COMPANY_SELF_SOURCE_REGEX.test(sourceName) && JOB_TITLE_FORMAT_REGEX.test(title)) return { isNoise: true, kind: 'job_posting' };
  return { isNoise: false };
}

/**
 * Returns true if the text is noise (job posting, support question, API doc, guide, natural photo)
 * and should be excluded from investment news and company keyword renewal.
 */
export function isNoiseNewsArticle(
  text: string,
  extra?: { url?: string; sourceName?: string }
): boolean {
  if (!text || typeof text !== 'string') return true;
  const combined = [text, extra?.sourceName || '', extra?.url || ''].join(' ').trim();
  if (combined.length < 5) return true;

  const isRecruitment = RECRUITMENT_REGEX.test(combined);
  const isSupport = SUPPORT_REGEX.test(combined);
  const isApiDoc = API_DOC_REGEX.test(combined);
  const isTutorialGuide = TUTORIAL_GUIDE_REGEX.test(combined);
  const isNasaNaturalPhoto = NASA_NATURAL_PHOTO_REGEX.test(combined);

  if (!isRecruitment && !isSupport && !isApiDoc && !isTutorialGuide && !isNasaNaturalPhoto) {
    return false;
  }

  // Pure noise headline must never be rescued if it matches unambiguous strict noise
  if (STRICT_NOISE_REGEX.test(combined)) {
    return true;
  }

  // Rescue rule: Only rescue if the headline is fundamentally about a financial transaction/contract/regulation
  const hasInvestmentSignal = GENUINE_INVESTMENT_REGEX.test(combined);
  if (hasInvestmentSignal) {
    return false; // Rescued: legitimate corporate investment/regulatory event
  }

  return true;
}

export const isExcludedFromCompanyRenewal = isNoiseNewsArticle;

/**
 * Returns the effective date for an event:
 * Prefers primarySource.publishedAt, falls back to firstSeenAt.
 */
export function getEffectiveEventTime(event: {
  primarySource?: { publishedAt?: string };
  firstSeenAt?: string;
}): { timestamp: number; timeIso: string; source: 'publishedAt' | 'firstSeenAt' } {
  let pubTime = event.primarySource?.publishedAt ? new Date(event.primarySource.publishedAt).getTime() : NaN;
  if (!isNaN(pubTime) && pubTime > 0) {
    return { timestamp: pubTime, timeIso: new Date(pubTime).toISOString(), source: 'publishedAt' };
  }
  const fallback = event.firstSeenAt ? new Date(event.firstSeenAt).getTime() : NaN;
  if (!isNaN(fallback) && fallback > 0) {
    return { timestamp: fallback, timeIso: new Date(fallback).toISOString(), source: 'firstSeenAt' };
  }
  const now = Date.now();
  return { timestamp: now, timeIso: new Date(now).toISOString(), source: 'firstSeenAt' };
}

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface AnalysisEligibilityResult {
  eligible: boolean;
  reason?: 'stale_article' | 'noise_content';
  details?: string;
}

/**
 * Evaluates whether an event qualifies for automatic Gemini analysis or background retry.
 * Shared pure policy:
 * - Effective timestamp prefers publishedAt, fallback firstSeenAt.
 * - Age > 7 days (7 * 24h) is marked stale_article (skipped).
 * - Noise content (job posting, support, API docs, usage guides, natural photos) is marked noise_content (skipped).
 * - Completed events are strictly preserved.
 */
export function checkArticleAnalysisEligibility(
  event: {
    title?: string;
    originalTitle?: string;
    primarySource?: { name?: string; url?: string; snippet?: string; publishedAt?: string };
    firstSeenAt?: string;
    analysisStatus?: string;
  },
  now: Date = new Date()
): AnalysisEligibilityResult {
  if (event.analysisStatus === 'completed') {
    return { eligible: true };
  }

  const { timestamp } = getEffectiveEventTime(event);
  const ageMs = now.getTime() - timestamp;
  if (ageMs > SEVEN_DAYS_MS) {
    const daysOld = Math.floor(ageMs / (24 * 3600 * 1000));
    return {
      eligible: false,
      reason: 'stale_article',
      details: `오래된 기사 (${daysOld}일 경과)로 자동 분석 제외`,
    };
  }

  const combinedText = [
    event.title || '',
    event.originalTitle || '',
    event.primarySource?.name || '',
    event.primarySource?.url || '',
    event.primarySource?.snippet || '',
  ].join(' ');

  if (isNoiseNewsArticle(combinedText, { url: event.primarySource?.url, sourceName: event.primarySource?.name })) {
    return {
      eligible: false,
      reason: 'noise_content',
      details: '투자 무관 잡음 문서 (채용/지원/API/가이드/자연관측)로 분석 제외',
    };
  }

  const sourceNoise = classifyNoiseBySource({
    sourceName: event.primarySource?.name,
    url: event.primarySource?.url,
    title: event.originalTitle || event.title,
  });
  if (sourceNoise.isNoise) {
    return {
      eligible: false,
      reason: 'noise_content',
      details: `투자 무관 비뉴스 문서 (포럼/문서/마켓플레이스/채용, ${sourceNoise.kind})로 분석 제외`,
    };
  }

  return { eligible: true };
}

/**
 * Projects analysis status and reasons onto an event without mutating persisted database.
 * Used for GET /api/events and UI to immediately present accurate status without DB migration.
 */
export function projectEventAnalysisStatus(
  event: NewsEvent,
  now: Date = new Date()
): NewsEvent {
  // If already completed or legacy event where importance > 0
  if (event.analysisStatus === 'completed' || (!event.analysisStatus && event.importance > 0)) {
    // 분석 완료 후에도 남아 있는 대기·오류 문구는 화면에 보이지 않게 정리
    const stale = (v?: string) => !!v && /분석\s*대기|한도.*초과|다음 사이클 대기/.test(v);
    return {
      ...event,
      analysisStatus: 'completed',
      analysisError: stale(event.analysisError) ? '' : event.analysisError,
      analysisDeferredReason: stale(event.analysisDeferredReason) ? '' : event.analysisDeferredReason,
      investmentImpactExplanation: stale(event.investmentImpactExplanation)
        ? (event.investmentImplications || '')
        : event.investmentImpactExplanation,
    };
  }

  if (event.analysisStatus === 'failed') {
    return {
      ...event,
      analysisError: event.analysisError || '최대 자동 재시도 횟수 초과 또는 모델 분석 실패',
    };
  }

  if (event.analysisStatus === 'skipped') {
    return {
      ...event,
      skipReason: event.skipReason || event.analysisError || '자동 분석 제외',
    };
  }

  if (event.screening && event.analysisStatus === 'pending') return event;

  // If pending (or undefined)
  if (!event.analysisStatus || event.analysisStatus === 'pending') {
    if ((event.analysisRetryCount || 0) >= 3) {
      return {
        ...event,
        analysisStatus: 'failed',
        analysisError: event.analysisError || '최대 자동 재시도 횟수(3회) 초과',
      };
    }

    const eligibility = checkArticleAnalysisEligibility(event, now);
    if (!eligibility.eligible) {
      return {
        ...event,
        analysisStatus: 'skipped',
        skipReason: eligibility.details || eligibility.reason,
        analysisError: eligibility.details || eligibility.reason,
      };
    }

    return {
      ...event,
      analysisStatus: 'pending',
    };
  }

  return event;
}
