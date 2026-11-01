import fs from 'fs';
import path from 'path';
import { NewsEvent, RawArticle, MonitorSettings, SystemLog, NewsCategory, CompanyProfile, TelegramSubscriber } from './types';
import { INITIAL_COMPANIES } from './companyProfiles';
import { firestoreRepo, getIsFirestoreAvailable, initFirestore } from './firestore';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export const DEFAULT_CATEGORIES: NewsCategory[] = [
  'IPO / 주식',
  '기업가치 / 자금조달',
  '실적 / 재무',
  'AI 가속기 / 반도체',
  'AI 모델 / Agent',
  '클라우드 / 데이터센터',
  '자율주행 / Robotaxi',
  'Starship / 우주인프라',
  'Starlink / 통신',
  '국방 / 정부계약',
  '규제 / 반독점',
  '에너지 / 배터리',
  '공급망 / CAPEX',
  '경쟁사 / 시장점유율',
  '기타',
];

export const DEFAULT_ENABLED_COMPANIES = ['spacex', 'googl', 'tsla', 'msft', 'nvda'];

const DEFAULT_KEYWORDS: string[] = [
  'SpaceX Starship',
  'SpaceX Starlink',
  'SpaceX IPO',
  'Google Gemini AI',
  'Google TPU',
  'Waymo Robotaxi',
  'Tesla FSD',
  'Tesla Optimus',
  'Tesla Robotaxi',
  'Microsoft Azure AI',
  'Microsoft Copilot',
  'Microsoft OpenAI',
  'NVIDIA Blackwell',
  'NVIDIA Rubin GPU',
  'NVIDIA Datacenter',
  'Hyperscaler AI CAPEX',
  'TSMC HBM SK hynix',
];

interface DatabaseSchema {
  events: NewsEvent[];
  rawArticles: RawArticle[];
  companies: CompanyProfile[];
  settings: MonitorSettings;
  logs: SystemLog[];
  telegramSubscribers?: TelegramSubscriber[];
}

export function getEventEffectivePublishedTime(event: NewsEvent): number {
  // 1순위: 기사 실제 발행 시각(primarySource.publishedAt)
  if (event.primarySource?.publishedAt) {
    const pub = new Date(event.primarySource.publishedAt).getTime();
    if (!isNaN(pub) && pub > 0) {
      return pub;
    }
  }

  // 2순위: 시스템 수집 시각(firstSeenAt 또는 createdAt)
  if (event.firstSeenAt) {
    const firstSeen = new Date(event.firstSeenAt).getTime();
    if (!isNaN(firstSeen) && firstSeen > 0) {
      return firstSeen;
    }
  }

  if (event.updatedAt) {
    const updated = new Date(event.updatedAt).getTime();
    if (!isNaN(updated) && updated > 0) {
      return updated;
    }
  }

  return 0;
}

export function compareEventsLatestFirst(a: NewsEvent, b: NewsEvent): number {
  const timeA = new Date(a.primarySource?.publishedAt || a.firstSeenAt).getTime();
  const timeB = new Date(b.primarySource?.publishedAt || b.firstSeenAt).getTime();
  const safeA = isNaN(timeA) || timeA <= 0 ? new Date(a.updatedAt || 0).getTime() || 0 : timeA;
  const safeB = isNaN(timeB) || timeB <= 0 ? new Date(b.updatedAt || 0).getTime() || 0 : timeB;
  return safeB - safeA;
}

class Database {
  private data: DatabaseSchema;
  private isInitialized = false;
  private isFirestoreSynced = false;
  private inFlightInitPromise: Promise<void> | null = null;
  private inFlightEventsRead: Promise<void> | null = null;
  private telegramFingerprints = new Map<string, { status: 'sending' | 'sent'; claimedAt: number; eventId: string }>();
  private dailyPollRuns = new Map<string, { status: 'running' | 'completed' | 'failed'; startedAt: number }>();

  constructor() {
    this.ensureDataDir();
    this.data = this.loadLocalData();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Ensures Firestore is connected and data synchronized.
   * If already synced and healthy, returns true immediately.
   * If an initialization is in flight, awaits it.
   * If previous initialization failed or timed out, retries cleanly without getting stuck on a rejected Promise.
   */
  public async ensureFirestoreReady(timeoutMs = 25000): Promise<boolean> {
    if (this.isFirestoreReady()) {
      return true;
    }

    if (!this.inFlightInitPromise) {
      this.inFlightInitPromise = this.init(timeoutMs).finally(() => {
        this.inFlightInitPromise = null;
      });
    }

    try {
      await this.inFlightInitPromise;
      return this.isFirestoreReady();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ [Firestore] ensureFirestoreReady attempt failed: ${msg}`);
      return this.isFirestoreReady();
    }
  }

  // Asynchronously initialize and hydrate from Firestore
  public async init(timeoutMs = 25000): Promise<void> {
    if (this.isInitialized && this.isFirestoreSynced && getIsFirestoreAvailable()) return;
    initFirestore();

    if (!getIsFirestoreAvailable()) {
      this.isInitialized = true;
      this.isFirestoreSynced = false;
      console.error('[POLL] rejected: firestore_unavailable (ADC or database uninitialized)');
      throw new Error('Google Cloud Firestore connection is not available (ADC or database uninitialized).');
    }

    try {
      console.log(`🔄 [Firestore] Syncing persistent data from Cloud Firestore (timeout: ${timeoutMs}ms)...`);
      
      // Fetch settings, companies, events, and recent logs (capped at 50 for fast startup)
      const syncPromise = Promise.all([
        firestoreRepo.getSettings(),
        firestoreRepo.getCompanies(),
        firestoreRepo.getEvents(100),
        firestoreRepo.getLogs(50),
      ]);

      let timer: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
        if (timer && typeof timer.unref === 'function') {
          timer.unref();
        }
      });

      let syncResult: any;
      try {
        syncResult = await Promise.race([syncPromise, timeoutPromise]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }

      if (!syncResult || !getIsFirestoreAvailable()) {
        this.isInitialized = true;
        this.isFirestoreSynced = false;
        console.warn(`⚠️ [Firestore] Sync timeout (${timeoutMs}ms) or quota exceeded. Using local persistent storage.`);
        throw new Error(`Firestore sync timed out (${timeoutMs}ms) or quota exceeded.`);
      }

      const [cloudSettings, cloudCompanies, cloudEvents, cloudLogs] = syncResult;

      if (cloudSettings) {
        this.data.settings = { ...this.data.settings, ...cloudSettings };
      } else if (getIsFirestoreAvailable()) {
        await firestoreRepo.saveSettings(this.data.settings);
      }

      if (cloudCompanies && cloudCompanies.length > 0) {
        this.data.companies = cloudCompanies.map(comp => {
          const initialMatch = INITIAL_COMPANIES.find(ic => ic.id === comp.id);
          return {
            ...comp,
            searchKeywords: (comp.searchKeywords || []).slice(0, 6),
            coreBusinesses: (comp.coreBusinesses || []).slice(0, 4),
            pinnedSearchKeywords: (comp.pinnedSearchKeywords || initialMatch?.pinnedSearchKeywords || []).slice(0, 6),
            pinnedCoreBusinesses: (comp.pinnedCoreBusinesses || initialMatch?.pinnedCoreBusinesses || []).slice(0, 4),
            autoWeeklyRenewalEnabled: comp.autoWeeklyRenewalEnabled !== false,
            version: typeof comp.version === 'number' ? comp.version : 1,
            renewalHistory: Array.isArray(comp.renewalHistory) ? comp.renewalHistory.slice(0, 10) : [],
          };
        });
      } else if (getIsFirestoreAvailable()) {
        await firestoreRepo.saveCompaniesBatch(INITIAL_COMPANIES);
        this.data.companies = INITIAL_COMPANIES;
      }

      if (cloudEvents && cloudEvents.length > 0) {
        this.data.events = cloudEvents.sort(compareEventsLatestFirst);
      }

      if (cloudLogs && cloudLogs.length > 0) {
        this.data.logs = cloudLogs;
      }

      this.saveLocalData();
      this.isInitialized = true;
      this.isFirestoreSynced = true;
      this.addLog('Firestore', 'success', 'Successfully synchronized data with Google Cloud Firestore.');
      console.log('✅ [Firestore] Persistent data sync completed successfully.');
    } catch (err: any) {
      this.isInitialized = true;
      this.isFirestoreSynced = false;
      console.warn('⚠️ [Firestore] Sync fallback warning:', err?.message || err);
      throw err;
    }
  }

  public isFirestoreReady(): boolean {
    return this.isInitialized && this.isFirestoreSynced && getIsFirestoreAvailable();
  }

  private loadLocalData(): DatabaseSchema {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);

        const loadedCompanies: CompanyProfile[] = (parsed.companies && parsed.companies.length > 0
          ? parsed.companies
          : INITIAL_COMPANIES
        ).map((comp: CompanyProfile) => {
          const initialMatch = INITIAL_COMPANIES.find(ic => ic.id === comp.id);
          return {
            ...comp,
            searchKeywords: (comp.searchKeywords || []).slice(0, 6),
            coreBusinesses: (comp.coreBusinesses || []).slice(0, 4),
            pinnedSearchKeywords: (comp.pinnedSearchKeywords || initialMatch?.pinnedSearchKeywords || []).slice(0, 6),
            pinnedCoreBusinesses: (comp.pinnedCoreBusinesses || initialMatch?.pinnedCoreBusinesses || []).slice(0, 4),
            autoWeeklyRenewalEnabled: comp.autoWeeklyRenewalEnabled !== false,
            version: typeof comp.version === 'number' ? comp.version : 1,
            renewalHistory: Array.isArray(comp.renewalHistory) ? comp.renewalHistory.slice(0, 10) : [],
          };
        });

        const loadedEvents: NewsEvent[] = parsed.events || [];
        for (const evt of loadedEvents) {
          if ((evt.isSentToTelegram || evt.telegramDispatchStatus === 'sent') && evt.eventFingerprint) {
            this.telegramFingerprints.set(evt.eventFingerprint, {
              status: 'sent',
              claimedAt: Date.now(),
              eventId: evt.id,
            });
          }
        }

        const rawInterval = parsed.settings?.pollIntervalMinutes;
        const normalizedInterval = (!rawInterval || rawInterval === 15) ? 1440 : rawInterval;

        return {
          events: loadedEvents,
          rawArticles: parsed.rawArticles || [],
          companies: loadedCompanies,
          settings: {
            minImportance: parsed.settings?.minImportance ?? 3,
            pollIntervalMinutes: normalizedInterval,
            autoSendTelegram: parsed.settings?.autoSendTelegram ?? true,
            autoAnalyzeWithGemini: parsed.settings?.autoAnalyzeWithGemini ?? true,
            enabledCategories: parsed.settings?.enabledCategories || DEFAULT_CATEGORIES,
            enabledCompanies: parsed.settings?.enabledCompanies || DEFAULT_ENABLED_COMPANIES,
            customKeywords: parsed.settings?.customKeywords || DEFAULT_KEYWORDS,
            lastPollTime: parsed.settings?.lastPollTime,
            nextPollTime: parsed.settings?.nextPollTime,
            totalArticlesTracked: parsed.settings?.totalArticlesTracked ?? 0,
            totalEventsCreated: parsed.events?.length ?? 0,
            totalTelegramAlertsSent: parsed.settings?.totalTelegramAlertsSent ?? 0,
          },
          logs: parsed.logs || [
            {
              id: 'init-log',
              timestamp: new Date().toISOString(),
              level: 'info',
              module: 'System',
              message: 'Investment Intelligence Monitor initialized. Ready to track SpaceX & BigTech.',
            }
          ],
          telegramSubscribers: parsed.telegramSubscribers || [],
        };
      }
    } catch (err) {
      console.error('Error loading local DB, initializing clean DB:', err);
    }

    const cleanSchema: DatabaseSchema = {
      events: [],
      rawArticles: [],
      companies: INITIAL_COMPANIES,
      settings: {
        minImportance: 3,
        pollIntervalMinutes: 1440,
        autoSendTelegram: true,
        autoAnalyzeWithGemini: true,
        enabledCategories: DEFAULT_CATEGORIES,
        enabledCompanies: DEFAULT_ENABLED_COMPANIES,
        customKeywords: DEFAULT_KEYWORDS,
        totalArticlesTracked: 0,
        totalEventsCreated: 0,
        totalTelegramAlertsSent: 0,
      },
      logs: [
        {
          id: `log-${Date.now()}`,
          timestamp: new Date().toISOString(),
          level: 'info',
          module: 'System',
          message: 'Investment Intelligence Monitor initialized with 5 core investment targets (SpaceX, Google, Tesla, Microsoft, NVIDIA).',
        }
      ],
      telegramSubscribers: [],
    };
    this.saveLocalData(cleanSchema);
    return cleanSchema;
  }

  private saveLocalData(dataToSave: DatabaseSchema = this.data) {
    try {
      this.ensureDataDir();
      fs.writeFileSync(DB_FILE, JSON.stringify(dataToSave, null, 2), 'utf-8');
    } catch (err) {
      console.error('Error saving local DB:', err);
    }
  }

  // Companies API
  public getCompanies(): CompanyProfile[] {
    return this.data.companies || INITIAL_COMPANIES;
  }

  public getCompanyById(id: string): CompanyProfile | undefined {
    return (this.data.companies || []).find(c => c.id === id);
  }

  public syncAuthoritativeCompany(company: CompanyProfile): CompanyProfile {
    const currentIdx = this.data.companies.findIndex(c => c.id === company.id);
    if (currentIdx >= 0) {
      this.data.companies[currentIdx] = company;
    } else {
      this.data.companies.push(company);
    }
    this.saveLocalData();
    return company;
  }

  public patchCompanyRenewalMetadata(
    id: string,
    patch: Partial<Pick<
      CompanyProfile,
      | 'lastKeywordRenewalAttemptAt'
      | 'lastKeywordRenewalSuccessAt'
      | 'lastRenewalStatus'
      | 'lastRenewalReason'
      | 'renewalLock'
    >>
  ): CompanyProfile | undefined {
    const currentIdx = this.data.companies.findIndex(c => c.id === id);
    if (currentIdx < 0) return undefined;

    const current = this.data.companies[currentIdx];
    const updated: CompanyProfile = {
      ...current,
      ...patch,
      // Strictly preserve keywords, businesses, pinned items, and version!
      searchKeywords: current.searchKeywords,
      coreBusinesses: current.coreBusinesses,
      pinnedSearchKeywords: current.pinnedSearchKeywords,
      pinnedCoreBusinesses: current.pinnedCoreBusinesses,
      version: current.version,
    };
    this.data.companies[currentIdx] = updated;
    this.saveLocalData();
    return updated;
  }

  public async saveCompany(
    company: CompanyProfile,
    options?: { incrementVersion?: boolean; expectedVersion?: number }
  ): Promise<CompanyProfile> {
    const currentIdx = this.data.companies.findIndex(c => c.id === company.id);
    const existing = currentIdx >= 0 ? this.data.companies[currentIdx] : null;

    if (
      options?.expectedVersion !== undefined &&
      existing &&
      typeof existing.version === 'number' &&
      existing.version !== options.expectedVersion
    ) {
      throw new Error(`version_conflict: expected ${options.expectedVersion}, got ${existing.version}`);
    }

    if (getIsFirestoreAvailable()) {
      const cloudRes = await firestoreRepo.saveCompanyHumanEdit(company, options?.expectedVersion);
      if (!cloudRes.success) {
        if (cloudRes.reason === 'version_conflict') {
          throw new Error(`version_conflict: expected ${options?.expectedVersion}`);
        }
        throw new Error(`firestore_error: ${cloudRes.reason}`);
      }
      if (cloudRes.company) {
        return this.syncAuthoritativeCompany(cloudRes.company);
      }
    }

    const initialMatch = INITIAL_COMPANIES.find(ic => ic.id === company.id);
    const currentVersion = typeof company.version === 'number'
      ? company.version
      : (existing && typeof existing.version === 'number' ? existing.version : 1);
    const nextVersion = options?.incrementVersion ? currentVersion + 1 : currentVersion;

    const sanitizedCompany: CompanyProfile = {
      ...(existing || {}),
      id: company.id,
      name: company.name || existing?.name || initialMatch?.name || company.id,
      ticker: company.ticker !== undefined ? company.ticker : (existing?.ticker || initialMatch?.ticker),
      color: company.color || existing?.color || initialMatch?.color || '#3b82f6',
      enabled: company.enabled !== undefined ? company.enabled : (existing?.enabled ?? true),
      autoWeeklyRenewalEnabled: company.autoWeeklyRenewalEnabled !== undefined ? company.autoWeeklyRenewalEnabled : (existing?.autoWeeklyRenewalEnabled ?? true),
      searchKeywords: (company.searchKeywords || existing?.searchKeywords || []).slice(0, 6),
      coreBusinesses: (company.coreBusinesses || existing?.coreBusinesses || []).slice(0, 4),
      // 중요한 중요도 프로필(importantKeywords)은 6개 한도 없이 원형 보존
      importantKeywords: company.importantKeywords || existing?.importantKeywords || initialMatch?.importantKeywords || [],
      lowImportanceKeywords: company.lowImportanceKeywords || existing?.lowImportanceKeywords || initialMatch?.lowImportanceKeywords || [],
      competitorKeywords: company.competitorKeywords || existing?.competitorKeywords || initialMatch?.competitorKeywords || [],
      pinnedSearchKeywords: (company.pinnedSearchKeywords || existing?.pinnedSearchKeywords || initialMatch?.pinnedSearchKeywords || []).slice(0, 6),
      pinnedCoreBusinesses: (company.pinnedCoreBusinesses || existing?.pinnedCoreBusinesses || initialMatch?.pinnedCoreBusinesses || []).slice(0, 4),
      lastKeywordRenewalAttemptAt: existing?.lastKeywordRenewalAttemptAt ?? company.lastKeywordRenewalAttemptAt,
      lastKeywordRenewalSuccessAt: existing?.lastKeywordRenewalSuccessAt ?? company.lastKeywordRenewalSuccessAt,
      lastRenewalStatus: existing?.lastRenewalStatus ?? company.lastRenewalStatus,
      lastRenewalReason: existing?.lastRenewalReason ?? company.lastRenewalReason,
      renewalLock: existing?.renewalLock !== undefined ? existing.renewalLock : (company.renewalLock || null),
      renewalHistory: existing?.renewalHistory && existing.renewalHistory.length > 0
        ? existing.renewalHistory.slice(0, 10)
        : (company.renewalHistory || []).slice(0, 10),
      version: nextVersion,
    };

    if (currentIdx >= 0) {
      this.data.companies[currentIdx] = sanitizedCompany;
    } else {
      this.data.companies.push(sanitizedCompany);
    }
    this.saveLocalData();

    return sanitizedCompany;
  }

  // Local Weekly Renewal Budget (Used for testing and local environments when Firestore is absent)
  private weeklyBudgets = new Map<string, number>();

  public getLocalWeeklyRenewalBudget(weekId: string): { usedCount: number; maxBudget: number; remaining: number } {
    const maxBudget = 5;
    const usedCount = this.weeklyBudgets.get(weekId) || 0;
    return { usedCount, maxBudget, remaining: Math.max(0, maxBudget - usedCount) };
  }

  public claimLocalWeeklyRenewalBudget(weekId: string, maxBudget = 5): boolean {
    const current = this.weeklyBudgets.get(weekId) || 0;
    if (current >= maxBudget) {
      return false;
    }
    this.weeklyBudgets.set(weekId, current + 1);
    return true;
  }

  public _resetWeeklyBudgetsForTesting(): void {
    this.weeklyBudgets.clear();
  }

  public async deleteCompany(id: string): Promise<void> {
    this.data.companies = this.data.companies.filter(c => c.id !== id);
    this.saveLocalData();

    if (getIsFirestoreAvailable()) {
      firestoreRepo.deleteCompany(id).catch((e: any) => {
        console.error(`[Firestore] deleteCompany (${id}) sync error:`, e?.message || e);
      });
    }
  }

  // Events API
  public getEvents(): NewsEvent[] {
    return [...this.data.events].sort(compareEventsLatestFirst);
  }

  public async getEventsForRead(): Promise<NewsEvent[]> {
    // A cold-start background hydration can time out while request CPU is idle.
    // Recover the existing news view with a read only; never run init, polling,
    // settings initialization, model generation, or notification code here.
    if (!this.data.events.length && !this.isFirestoreReady() && getIsFirestoreAvailable()) {
      this.inFlightEventsRead ||= firestoreRepo.getEvents(100).then(events => {
        if (!this.data.events.length && events.length) this.data.events = events;
      }).finally(() => { this.inFlightEventsRead = null; });
      await this.inFlightEventsRead;
    }
    return this.getEvents();
  }

  public _setEventsForTesting(events: NewsEvent[]): void {
    this.data.events = [...events];
  }

  public _clearFingerprintsForTesting(): void {
    this.telegramFingerprints.clear();
  }

  public _clearDailyPollRunsForTesting(): void {
    this.dailyPollRuns.clear();
  }

  // Daily Poll Run Guard (하루 1회 실행 보장 - Asia/Seoul 기준)
  public async claimDailyPollRun(dateStr: string, triggerSource: string = 'Cloud Scheduler'): Promise<{
    canRun: boolean;
    reason?: 'already_completed' | 'currently_running' | 'firestore_error';
  }> {
    // 1. Local in-memory check (for fast local dev/testing rejection)
    const local = this.dailyPollRuns.get(dateStr);
    if (local) {
      if (local.status === 'completed') {
        return { canRun: false, reason: 'already_completed' };
      }
      if (local.status === 'running' && Date.now() - local.startedAt < 30 * 60 * 1000) {
        return { canRun: false, reason: 'currently_running' };
      }
    }

    // 2. Authoritative Firestore distributed lock
    if (getIsFirestoreAvailable()) {
      const cloudResult = await firestoreRepo.claimDailyPollRun(dateStr, triggerSource);
      if (!cloudResult.canRun) {
        if (cloudResult.existingRecord?.status) {
          this.dailyPollRuns.set(dateStr, {
            status: cloudResult.existingRecord.status,
            startedAt: cloudResult.existingRecord.startedAt ? new Date(cloudResult.existingRecord.startedAt).getTime() : Date.now(),
          });
        }
        return cloudResult;
      }
    }

    this.dailyPollRuns.set(dateStr, { status: 'running', startedAt: Date.now() });
    return { canRun: true };
  }

  public async completeDailyPollRun(
    dateStr: string,
    summary: { articlesCount: number; eventsCreatedCount: number; telegramAlertsCount: number }
  ): Promise<void> {
    this.dailyPollRuns.set(dateStr, { status: 'completed', startedAt: Date.now() });
    if (getIsFirestoreAvailable()) {
      try {
        await firestoreRepo.completeDailyPollRun(dateStr, summary);
      } catch (e: any) {
        console.error('[Firestore] completeDailyPollRun error:', e?.message || e);
      }
    }
  }

  public async recordDailyPollRunFailed(dateStr: string, errorMessage: string): Promise<void> {
    this.dailyPollRuns.set(dateStr, { status: 'failed', startedAt: Date.now() });
    if (getIsFirestoreAvailable()) {
      try {
        await firestoreRepo.recordDailyPollRunFailed(dateStr, errorMessage);
      } catch (e: any) {
        console.error('[Firestore] recordDailyPollRunFailed error:', e?.message || e);
      }
    }
  }

  public getEventById(id: string): NewsEvent | undefined {
    return this.data.events.find(e => e.id === id);
  }

  public async saveEvent(event: NewsEvent): Promise<void> {
    const idx = this.data.events.findIndex(e => e.id === event.id);
    if (idx >= 0) {
      const existing = this.data.events[idx];
      // Defensive in-memory preservation:
      // Never allow a caller's stale in-memory event to clobber sent or sending status
      const isAlreadySent = existing.isSentToTelegram || existing.telegramDispatchStatus === 'sent';
      const isCurrentlySending = existing.telegramDispatchStatus === 'sending';

      let preservedTelegramState: Partial<NewsEvent>;
      if (isAlreadySent) {
        preservedTelegramState = {
          isSentToTelegram: true,
          telegramDispatchStatus: 'sent',
          telegramSentAt: existing.telegramSentAt || event.telegramSentAt,
          sentAt: existing.sentAt || event.sentAt,
          telegramMessageId: existing.telegramMessageId || event.telegramMessageId,
        };
      } else if (isCurrentlySending && !event.isSentToTelegram) {
        preservedTelegramState = {
          isSentToTelegram: false,
          telegramDispatchStatus: 'sending',
          dispatchClaimedAt: existing.dispatchClaimedAt,
        };
      } else {
        preservedTelegramState = {
          isSentToTelegram: existing.isSentToTelegram ?? event.isSentToTelegram ?? false,
          telegramDispatchStatus: existing.telegramDispatchStatus || event.telegramDispatchStatus || 'pending',
          lastTelegramError: existing.lastTelegramError || event.lastTelegramError,
        };
      }

      this.data.events[idx] = {
        ...event,
        ...preservedTelegramState,
      };
    } else {
      this.data.events.unshift(event);
      this.data.settings.totalEventsCreated += 1;
    }
    this.saveLocalData();

    if (getIsFirestoreAvailable()) {
      try {
        await firestoreRepo.saveEvent(event);
      } catch (e: any) {
        console.error('[Firestore] saveEvent error:', e.message);
      }
    }
  }

  /**
   * Syncs an event directly from Firestore cloud state into local in-memory cache,
   * keeping instance memory completely up-to-date with work completed by other instances.
   */
  public syncEventFromCloud(cloudEvent: NewsEvent): void {
    const idx = this.data.events.findIndex(e => e.id === cloudEvent.id);
    if (idx >= 0) {
      this.data.events[idx] = { ...this.data.events[idx], ...cloudEvent };
    } else {
      this.data.events.unshift(cloudEvent);
    }
    this.saveLocalData();
  }

  // Atomic Telegram claim to prevent duplicate dispatches across multiple Cloud Run instances
  // and guarantee exactly-once delivery for the same event fingerprint even if different event IDs were assigned
  public async claimEventForTelegram(id: string, fingerprint?: string): Promise<boolean> {
    const event = this.getEventById(id);
    const fp = fingerprint || event?.eventFingerprint;

    // 1. Check in-memory event state
    if (event) {
      if (event.isSentToTelegram || event.telegramDispatchStatus === 'sent') {
        return false;
      }
      if (event.telegramDispatchStatus === 'sending') {
        const leaseTime = event.dispatchClaimedAt ? new Date(event.dispatchClaimedAt).getTime() : 0;
        if (Date.now() - leaseTime < 5 * 60 * 1000) {
          return false;
        }
      }
    }

    // 2. Check in-memory fingerprint state (protects against duplicate dispatches across differing event IDs)
    if (fp) {
      const fpRecord = this.telegramFingerprints.get(fp);
      if (fpRecord) {
        if (fpRecord.status === 'sent') {
          console.log(`[Local Claim] Blocked: fingerprint "${fp}" already sent to Telegram (Event: ${fpRecord.eventId}).`);
          return false;
        }
        if (fpRecord.status === 'sending' && Date.now() - fpRecord.claimedAt < 5 * 60 * 1000) {
          console.log(`[Local Claim] Blocked: fingerprint "${fp}" actively being sent by another worker (Event: ${fpRecord.eventId}).`);
          return false;
        }
      }
    }

    // 3. Cloud Firestore transaction claim (atomic across distributed instances)
    if (getIsFirestoreAvailable()) {
      try {
        const cloudClaimed = await firestoreRepo.claimEventForTelegramDispatch(id, fp);
        if (!cloudClaimed) {
          return false;
        }
      } catch (e: any) {
        console.warn('[Firestore] claimEventForTelegram warning:', e.message);
        return false;
      }
    }

    // 4. Mark local state as sending
    if (event) {
      event.telegramDispatchStatus = 'sending';
      event.dispatchClaimedAt = new Date().toISOString();
      if (fp) event.eventFingerprint = fp;
      this.saveLocalData();
    }

    if (fp) {
      this.telegramFingerprints.set(fp, {
        status: 'sending',
        claimedAt: Date.now(),
        eventId: id,
      });
    }

    return true;
  }

  public async updateEventTelegramStatus(id: string, sent: boolean, msgId?: string, errorMsg?: string, fingerprint?: string): Promise<void> {
    const event = this.getEventById(id);
    const fp = fingerprint || event?.eventFingerprint;

    if (event) {
      // If already sent, do NOT allow it to be marked unsent or failed!
      if (!sent && (event.isSentToTelegram || event.telegramDispatchStatus === 'sent')) {
        return;
      }

      event.isSentToTelegram = sent;
      if (sent) {
        event.telegramDispatchStatus = 'sent';
        event.sentAt = new Date().toISOString();
        event.telegramSentAt = new Date().toISOString();
        if (msgId) event.telegramMessageId = msgId;
        if (fp) event.eventFingerprint = fp;
        this.data.settings.totalTelegramAlertsSent += 1;
      } else {
        event.telegramDispatchStatus = 'failed';
        if (errorMsg) event.lastTelegramError = errorMsg;
      }
      this.saveLocalData();
    }

    if (fp) {
      if (sent) {
        this.telegramFingerprints.set(fp, {
          status: 'sent',
          claimedAt: Date.now(),
          eventId: id,
        });
      } else {
        const fpRecord = this.telegramFingerprints.get(fp);
        if (fpRecord && fpRecord.status === 'sending') {
          this.telegramFingerprints.delete(fp);
        }
      }
    }

    if (getIsFirestoreAvailable()) {
      try {
        if (sent) {
          await firestoreRepo.markEventTelegramSent(id, msgId, fp);
        } else {
          await firestoreRepo.markEventTelegramFailed(id, errorMsg, fp);
        }
      } catch (e: any) {
        console.error('[Firestore] updateEventTelegramStatus error:', e.message);
      }
    }
  }

  // Raw Articles API
  public getRawArticles(): RawArticle[] {
    return this.data.rawArticles;
  }

  public isArticleProcessed(url: string, title: string): boolean {
    const cleanUrl = url.split('?')[0].toLowerCase();
    const cleanTitle = title.trim().toLowerCase();

    if (this.data.rawArticles.some(a => a.link.split('?')[0].toLowerCase() === cleanUrl || a.title.toLowerCase() === cleanTitle)) {
      return true;
    }

    for (const evt of this.data.events) {
      if (evt.primarySource.url.split('?')[0].toLowerCase() === cleanUrl || evt.primarySource.title.toLowerCase() === cleanTitle) {
        return true;
      }
      for (const rel of evt.relatedSources) {
        if (rel.url.split('?')[0].toLowerCase() === cleanUrl || rel.title.toLowerCase() === cleanTitle) {
          return true;
        }
      }
    }

    return false;
  }

  public async addRawArticles(articles: RawArticle[]): Promise<void> {
    this.data.rawArticles.push(...articles);
    if (this.data.rawArticles.length > 800) {
      this.data.rawArticles = this.data.rawArticles.slice(-800);
    }
    this.data.settings.totalArticlesTracked += articles.length;
    this.saveLocalData();

    if (getIsFirestoreAvailable()) {
      try {
        await firestoreRepo.saveArticlesBatch(articles);
      } catch (e: any) {
        console.error('[Firestore] addRawArticles batch save error:', e.message);
      }
    }
  }

  // Settings API with CompanyProfile.enabled as Single Source of Truth
  public getSettings(): MonitorSettings {
    const enabledCompanyIds = (this.data.companies || []).filter(c => c.enabled).map(c => c.id);
    return {
      ...this.data.settings,
      enabledCompanies: enabledCompanyIds.length > 0 ? enabledCompanyIds : (this.data.settings.enabledCompanies || DEFAULT_ENABLED_COMPANIES),
    };
  }

  public async updateSettings(partial: Partial<MonitorSettings>): Promise<MonitorSettings> {
    // If enabledCompanies array is supplied, sync it to company profiles
    if (Array.isArray(partial.enabledCompanies)) {
      const activeSet = new Set(partial.enabledCompanies);
      this.data.companies.forEach(c => {
        c.enabled = activeSet.has(c.id);
      });
      if (getIsFirestoreAvailable()) {
        firestoreRepo.saveCompaniesBatch(this.data.companies).catch(() => {});
      }
    }

    this.data.settings = {
      ...this.data.settings,
      ...partial,
      enabledCompanies: (this.data.companies || []).filter(c => c.enabled).map(c => c.id),
    };
    this.saveLocalData();

    if (getIsFirestoreAvailable()) {
      try {
        await firestoreRepo.saveSettings(this.data.settings);
      } catch (e: any) {
        console.error('[Firestore] updateSettings error:', e.message);
      }
    }

    return this.getSettings();
  }

  // Logs API
  public getLogs(limit: number = 150): SystemLog[] {
    return this.data.logs.slice(-limit).reverse();
  }

  public addLog(module: SystemLog['module'], level: SystemLog['level'], message: string, details?: Record<string, unknown>) {
    const log: SystemLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      details,
    };
    this.data.logs.push(log);
    if (this.data.logs.length > 400) {
      this.data.logs = this.data.logs.slice(-400);
    }
    this.saveLocalData();

    if (getIsFirestoreAvailable()) {
      firestoreRepo.addLog(log).catch(() => {});
    }
  }

  // Telegram Subscribers API
  public getTelegramSubscriber(chatId: string): TelegramSubscriber | null {
    const sub = (this.data.telegramSubscribers || []).find(s => String(s.chatId) === String(chatId));
    return sub ? { ...sub } : null;
  }

  public async getActiveTelegramSubscribers(): Promise<TelegramSubscriber[]> {
    if (getIsFirestoreAvailable()) {
      try {
        const cloudSubs = await firestoreRepo.getActiveTelegramSubscribers();
        if (cloudSubs && Array.isArray(cloudSubs)) {
          // Merge or sync into local memory
          this.data.telegramSubscribers = cloudSubs;
          this.saveLocalData();
          return cloudSubs;
        }
      } catch (e: any) {
        console.warn('[Firestore] getActiveTelegramSubscribers warning:', e?.message || e);
      }
    }
    return (this.data.telegramSubscribers || []).filter(s => s.active);
  }

  public async saveTelegramSubscriber(subscriber: TelegramSubscriber): Promise<void> {
    const id = String(subscriber.chatId);
    if (!this.data.telegramSubscribers) {
      this.data.telegramSubscribers = [];
    }
    const idx = this.data.telegramSubscribers.findIndex(s => String(s.chatId) === id);
    const subData: TelegramSubscriber = {
      ...subscriber,
      chatId: id,
      updatedAt: subscriber.updatedAt || new Date().toISOString(),
    };

    if (idx >= 0) {
      this.data.telegramSubscribers[idx] = { ...this.data.telegramSubscribers[idx], ...subData };
    } else {
      this.data.telegramSubscribers.push(subData);
    }
    this.saveLocalData();

    if (getIsFirestoreAvailable()) {
      try {
        await firestoreRepo.saveTelegramSubscriber(subData);
      } catch (e: any) {
        console.error('[Firestore] saveTelegramSubscriber error:', e?.message || e);
      }
    }
  }

  public async setTelegramSubscriberActive(chatId: string, active: boolean): Promise<void> {
    const id = String(chatId);
    if (!this.data.telegramSubscribers) {
      this.data.telegramSubscribers = [];
    }
    const idx = this.data.telegramSubscribers.findIndex(s => String(s.chatId) === id);
    const now = new Date().toISOString();

    if (idx >= 0) {
      this.data.telegramSubscribers[idx].active = active;
      this.data.telegramSubscribers[idx].updatedAt = now;
    } else {
      this.data.telegramSubscribers.push({
        chatId: id,
        active,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.saveLocalData();

    if (getIsFirestoreAvailable()) {
      try {
        await firestoreRepo.updateTelegramSubscriberActive(id, active);
      } catch (e: any) {
        console.error('[Firestore] updateTelegramSubscriberActive error:', e?.message || e);
      }
    }
  }
}

export const db = new Database();
