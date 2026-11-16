export type { CompanyProfile, CompanyRenewalHistoryEntry, CompanyRenewalLock } from './companyProfiles';

export type InvestmentImpact = 'positive' | 'neutral' | 'negative';

export type NewsCategory =
  | 'IPO / 주식'
  | '기업가치 / 자금조달'
  | '실적 / 재무'
  | 'AI 가속기 / 반도체'
  | 'AI 모델 / Agent'
  | '클라우드 / 데이터센터'
  | '자율주행 / Robotaxi'
  | 'Starship / 우주인프라'
  | 'Starlink / 통신'
  | '국방 / 정부계약'
  | '규제 / 반독점'
  | '에너지 / 배터리'
  | '공급망 / CAPEX'
  | '경쟁사 / 시장점유율'
  | '기타';

export type SourceTier = 'tier1' | 'tier2' | 'tier3';

export interface ArticleSource {
  name: string;
  url: string;
  title: string;
  publishedAt: string;
  snippet?: string;
  credibilityScore?: number; // 1-10 (Reuters/Bloomberg/WSJ/NASA/SEC: 10, CNBC: 9, etc.)
  sourceTier?: SourceTier; // 'tier1' | 'tier2' | 'tier3'
  sourceReliability?: number; // 1-10
  detectedOriginalSource?: string;
  sourceType?: 'official_announcement' | 'agency_regulatory' | 'investor_relations' | 'news_aggregator';
}

export interface RawArticle {
  id: string;
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  snippet: string;
  content?: string;
  guid?: string;
  categories?: string[];
  firstSeenAt: string;
  matchedCompanyIds?: string[];
  sourceTier?: SourceTier;
  sourceReliability?: number;
  detectedOriginalSource?: string;
  sourceType?: 'official_announcement' | 'agency_regulatory' | 'investor_relations' | 'news_aggregator';
}

export interface CompanyImpactItem {
  companyId: string; // e.g. 'nvda', 'msft', 'googl', 'tsla', 'spacex'
  companyName: string; // e.g. 'NVIDIA'
  ticker?: string; // 'NVDA'
  impact: InvestmentImpact; // 'positive' | 'neutral' | 'negative'
  rationale: string; // reason for this specific company
}

export type ArticleContentType =
  | 'official_announcement'
  | 'financial_result'
  | 'regulatory_event'
  | 'contract'
  | 'product_event'
  | 'new_fact'
  | 'analyst_opinion'
  | 'market_commentary'
  | 'rumor'
  | 'recap';

export const TELEGRAM_LIFECYCLE_KEYS = [
  'isSentToTelegram',
  'telegramDispatchStatus',
  'telegramSentAt',
  'sentAt',
  'dispatchClaimedAt',
  'telegramDispatchClaimedAt',
  'lastTelegramError',
  'telegramDispatchError',
  'telegramMessageId',
] as const;

export type TelegramLifecycleKey = typeof TELEGRAM_LIFECYCLE_KEYS[number];

export interface NewsEvent {
  id: string;
  title: string; // Korean headline synthesized
  originalTitle: string; // Original primary source headline
  titleKo?: string; // 표시용 AI 한국어 제목(상세 분석 전 뉴스). 분석에는 쓰지 않음
  category: NewsCategory;
  importance: number; // 1 to 5 (0 if pending/failed unanalyzed)
  isImportant: boolean; // true if importance >= 4 (5 is 🚨 긴급 중요)
  impact: InvestmentImpact; // primary overall impact
  impactRationale: string;
  relatedCompanies: string[]; // e.g. ['SpaceX', 'NVIDIA', 'Microsoft', 'Google', 'Tesla']
  companyImpacts: CompanyImpactItem[]; // company-by-company detailed breakdown
  factualPoints: string[]; // 기사에서 객관적으로 확인된 사실 (Fact Summary)
  summaryBulletPoints: string[]; // 하위 호환용 요약
  investmentImplications: string; // 투자 관점의 엄격한 AI 추론
  whyItMatters: string; // Long-term valuation significance
  keyCheckpointsToWatch: string[]; // 향후 확인해야 할 핵심 지표나 이벤트 (Investment Checkpoints)
  investmentImpactExplanation: string; // Enterprise value impact description
  relatedBusinesses: string[]; // e.g. ['Blackwell', 'DataCenter', 'Azure', 'Starshield']
  primarySource: ArticleSource;
  relatedSources: ArticleSource[];
  articleCount: number;
  eventFingerprint?: string;
  sourceTier?: SourceTier;
  sourceReliability?: number;
  corroboratedSourceCount?: number;
  hasTrustedSource?: boolean;
  detectedOriginalSource?: string;
  sourceDomains?: string[];
  isSentToTelegram: boolean;
  telegramDispatchStatus?: 'pending' | 'sending' | 'sent' | 'failed';
  dispatchClaimedAt?: string;
  lastTelegramError?: string;
  telegramMessageId?: string;
  telegramSentAt?: string;
  sentAt?: string;
  firstSeenAt: string;
  updatedAt: string;
  analyzedByGemini: boolean;
  geminiModelUsed?: string;
  analysisStatus?: 'pending' | 'completed' | 'failed' | 'skipped' | 'screened';
  screening?: { score: number; reason: string; uncertain: boolean; evidenceKey: string; evaluatedAt: string };
  analysisDeferredReason?: string;
  skipReason?: string;
  analysisRetryCount?: number;
  lastAnalysisAttemptAt?: string;
  analysisError?: string;
  analysisFailureCode?: string;
  analysisAutoRetry?: {attempts:1;status:'inflight'|'ready'|'recovered'|'review_required';phase:'screen'|'detail';token:string;at:string};
  contentType?: ArticleContentType;
  rawKeywordsMatched?: string[];
  // 기사 묶음 정리로 분리·생성된 카드는 텔레그램 자동 발송에서 제외 (수동 발송은 가능)
  telegramSuppressed?: boolean;
  // 기사 묶음 정리 이력 (중복 실행 방지 및 감사용)
  dataCleanup?: { at: string; note: string; removedCount?: number; fromEventId?: string };
}

export interface MonitorSettings {
  minImportance: number; // default 3
  pollIntervalMinutes: number; // default 1440 (하루 1회)
  autoSendTelegram: boolean;
  autoAnalyzeWithGemini: boolean;
  enabledCategories: NewsCategory[];
  enabledCompanies: string[]; // company IDs: ['spacex', 'googl', 'tsla', 'msft', 'nvda']
  customKeywords: string[];
  trustedSources?: string[];
  blockedSources?: string[];
  weeklyCompanyRenewalEnabled?: boolean; // default true
  lastPollTime?: string;
  nextPollTime?: string;
  totalArticlesTracked: number;
  totalEventsCreated: number;
  totalTelegramAlertsSent: number;
}

export interface SystemLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  module: 'Collector' | 'Gemini' | 'Telegram' | 'Scheduler' | 'System' | 'Firestore' | 'Dedup' | 'SourceFilter';
  message: string;
  details?: Record<string, unknown>;
}

export type MonitorLog = SystemLog;

export interface DailyPollRunDoc {
  date: string; // "YYYY-MM-DD" (Asia/Seoul)
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt?: string;
  articlesCount?: number;
  eventsCreatedCount?: number;
  telegramAlertsCount?: number;
  triggerSource?: string;
  errorMessage?: string;
  updatedAt: string;
}

export interface TelegramSubscriber {
  chatId: string;
  username?: string;
  firstName?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SystemStatus {
  aiProvider?: string;
  aiModel?: string;
  hasOpenAIKey?: boolean;
  status: 'idle' | 'polling' | 'analyzing' | 'error';
  lastPollTime?: string;
  nextPollTime?: string;
  totalEvents: number;
  highPriorityEvents: number;
  telegramSentCount: number;
  hasGeminiKey: boolean;
  hasTelegramConfig: boolean;
  isFirestoreConnected: boolean;
  geminiModel: string;
  activeKeywordsCount: number;
  activeCompaniesCount: number;
  uptimeSeconds: number;
}
