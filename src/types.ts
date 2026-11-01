export interface CompanyRenewalHistoryEntry {
  id: string;
  companyId: string;
  timestamp: string;
  status: 'success' | 'failed' | 'rolled_back';
  before: {
    searchKeywords: string[];
    coreBusinesses: string[];
  };
  after: {
    searchKeywords: string[];
    coreBusinesses: string[];
  };
  addedKeywords: string[];
  removedKeywords: string[];
  addedBusinesses: string[];
  removedBusinesses: string[];
  reason: string;
  evidenceArticleIds: string[];
  versionBefore?: number;
  versionAfter?: number;
}

export interface CompanyRenewalLock {
  lockedAt: string;
  leaseMs: number;
  token?: string;
  workerId?: string;
}

export interface CompanyProfile {
  id: string; // 'spacex', 'googl', 'tsla', 'msft', 'nvda'
  name: string;
  ticker?: string;
  color: string;
  searchKeywords: string[];
  coreBusinesses: string[];
  importantKeywords: string[];
  lowImportanceKeywords: string[];
  competitorKeywords?: string[];
  enabled: boolean;
  pinnedSearchKeywords?: string[];
  pinnedCoreBusinesses?: string[];
  autoWeeklyRenewalEnabled?: boolean;
  lastKeywordRenewalAttemptAt?: string;
  lastKeywordRenewalSuccessAt?: string;
  lastRenewalStatus?: 'success' | 'failed' | 'skipped' | 'rate_limited' | 'running';
  lastRenewalReason?: string;
  renewalLock?: CompanyRenewalLock | null;
  version?: number;
  renewalHistory?: CompanyRenewalHistoryEntry[];
  updatedAt?: string;
}

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
  credibilityScore?: number;
  sourceTier?: SourceTier;
  sourceReliability?: number;
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
  firstSeenAt: string;
  sourceTier?: SourceTier;
  sourceReliability?: number;
  detectedOriginalSource?: string;
  sourceType?: 'official_announcement' | 'agency_regulatory' | 'investor_relations' | 'news_aggregator';
}

export interface CompanyImpactAnalysis {
  companyId: string;
  companyName: string;
  ticker?: string;
  impact: InvestmentImpact;
  rationale: string;
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

export interface NewsEvent {
  id: string;
  title: string;
  originalTitle?: string;
  titleKo?: string;
  category: NewsCategory;
  importance: number; // 1 to 5 (0 if pending/failed)
  impact: InvestmentImpact;
  impactRationale: string;
  investmentImpactExplanation?: string;
  summaryBulletPoints: string[];
  factualPoints?: string[];
  investmentImplications?: string[];
  whyItMatters: string;
  keyCheckpointsToWatch?: string[];
  relatedBusinesses: string[];
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
  firstSeenAt: string;
  updatedAt?: string;
  isSentToTelegram: boolean;
  telegramDispatchStatus?: 'pending' | 'sending' | 'sent' | 'failed';
  dispatchClaimedAt?: string;
  lastTelegramError?: string;
  sentAt?: string;
  telegramSentAt?: string;
  telegramMessageId?: number;
  geminiModelUsed?: string;
  primaryCompanyId?: string;
  relatedCompanies?: string[];
  companyImpacts?: CompanyImpactAnalysis[];
  analysisStatus?: 'pending' | 'completed' | 'failed' | 'skipped' | 'screened';
  screening?: { score: number; reason: string; uncertain: boolean; evidenceKey: string; evaluatedAt: string };
  analysisDeferredReason?: string;
  skipReason?: string;
  analysisRetryCount?: number;
  lastAnalysisAttemptAt?: string;
  analysisError?: string;
  contentType?: ArticleContentType;
  rawKeywordsMatched?: string[];
}

export interface MonitorSettings {
  minImportance: number;
  pollIntervalMinutes: number;
  autoSendTelegram: boolean;
  autoAnalyzeWithGemini: boolean;
  enabledCategories: NewsCategory[];
  enabledCompanies: string[];
  customKeywords: string[];
  trustedSources?: string[];
  blockedSources?: string[];
  weeklyCompanyRenewalEnabled?: boolean;
  lastPollTime?: string;
  nextPollTime?: string;
  totalArticlesTracked: number;
  totalEventsCreated: number;
  totalTelegramAlertsSent: number;
}

export interface SystemStatus {
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

export interface AuthStatus {
  requiresAuth: boolean;
  isAuthenticated: boolean;
}

export interface MonitorLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  module: 'Collector' | 'Gemini' | 'Telegram' | 'Scheduler' | 'System' | 'Firestore' | 'Dedup' | 'SourceFilter';
  message: string;
  details?: unknown;
}
