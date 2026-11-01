import { Firestore } from '@google-cloud/firestore';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CompanyProfile, NewsEvent, RawArticle, MonitorSettings, SystemLog, TelegramSubscriber, DailyPollRunDoc, TELEGRAM_LIFECYCLE_KEYS, TelegramLifecycleKey, CompanyRenewalHistoryEntry } from './types';
import { INITIAL_COMPANIES } from './companyProfiles';

let dbInstance: Firestore | null = null;
let isFirestoreAvailable = false;

/**
 * Returns today's date formatted as YYYY-MM-DD in Asia/Seoul (UTC+9) timezone
 */
export function getSeoulDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Returns the current ISO-8601 week string as YYYY-Www in Asia/Seoul (UTC+9) timezone
 */
export function getSeoulWeekString(date: Date = new Date()): string {
  const seoulDateStr = getSeoulDateString(date);
  const [yearStr, monthStr, dayStr] = seoulDateStr.split('-');
  const target = new Date(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
  const weekPad = weekNumber < 10 ? `0${weekNumber}` : `${weekNumber}`;
  return `${yearStr}-W${weekPad}`;
}

/**
 * Strips all Telegram lifecycle fields from an event payload
 * to prevent stale in-memory states from clobbering Firestore's
 * authoritative Telegram dispatch records.
 */
export function stripTelegramLifecycleFields<T extends Record<string, any>>(obj: T): Omit<T, TelegramLifecycleKey> {
  const result: any = { ...obj };
  for (const key of TELEGRAM_LIFECYCLE_KEYS) {
    delete result[key];
  }
  return result;
}

/**
 * Recursively strips all `undefined` values from an object or array,
 * because Firestore set/update throws on `undefined`.
 * Preserves `null`, `0`, `false`, `""`, empty objects `{}`, empty arrays `[]`,
 * and special Firestore SDK objects (Date, Timestamp, FieldValue, DocumentReference).
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === undefined) {
    return undefined as any;
  }
  if (data === null || typeof data !== 'object') {
    return data;
  }
  // Preserve special class instances like Date, Firestore Timestamp, FieldValue, DocumentReference
  if (
    data instanceof Date ||
    typeof (data as any).toDate === 'function' ||
    (data.constructor && data.constructor.name !== 'Object' && data.constructor.name !== 'Array')
  ) {
    return data;
  }
  if (Array.isArray(data)) {
    return data
      .filter(item => item !== undefined)
      .map(item => sanitizeForFirestore(item)) as any;
  }
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data as Record<string, any>)) {
    if (value !== undefined) {
      sanitized[key] = sanitizeForFirestore(value);
    }
  }
  return sanitized as T;
}

// Compute deterministic URL Hash for permanent duplicate checking
export function computeUrlHash(url: string): string {
  const normalized = url.trim().toLowerCase().split('?')[0].replace(/\/+$/, '');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}

// Compute deterministic Title Hash for normalization checking
export function computeNormalizedTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function initFirestore(): Firestore | null {
  if (dbInstance) return dbInstance;

  try {
    let firebaseConfig: any = null;
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');

    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else if (process.env.FIREBASE_CONFIG) {
      firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    }

    const projectId = firebaseConfig?.projectId || 'gen-lang-client-0064554427';
    const databaseId = firebaseConfig?.firestoreDatabaseId || 'ai-studio-spacexintelligen-5ece8bd2-4283-450c-8ff7-bbc38569174d';

    // Initialize using Google Cloud Application Default Credentials (ADC)
    dbInstance = new Firestore({
      projectId,
      databaseId,
    });

    isFirestoreAvailable = true;
    console.log(`✅ [Firestore] Initialized Google Cloud Firestore server connection successfully (Project: ${projectId}, Database: ${databaseId}, Auth: ADC/IAM).`);
    return dbInstance;
  } catch (err: any) {
    console.warn('⚠️ [Firestore] Initialization warning:', err.message);
  }

  isFirestoreAvailable = false;
  return null;
}

export function getIsFirestoreAvailable(): boolean {
  return isFirestoreAvailable && dbInstance !== null;
}

export function _setIsFirestoreAvailableForTesting(available: boolean, mockDb: any = null): void {
  isFirestoreAvailable = available;
  if (mockDb !== null || !available) {
    dbInstance = mockDb;
  }
}

function handleFirestoreError(operation: string, e: any) {
  const msg = e?.message || String(e);
  console.error(`[Firestore] ${operation} error:`, msg);
  if (
    e?.code === 'resource-exhausted' ||
    e?.code === 8 ||
    msg.includes('Quota limit exceeded') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('Quota exceeded')
  ) {
    if (isFirestoreAvailable) {
      isFirestoreAvailable = false;
      console.warn('⚠️ [Firestore] Free daily quota exceeded. Falling back to persistent local storage for remaining session.');
    }
  }
}

// ----------------------------------------------------
// Firestore Collections Data Access Layer
// ----------------------------------------------------

export const firestoreRepo = {
  // 1. Settings
  async getSettings(): Promise<MonitorSettings | null> {
    if (!getIsFirestoreAvailable()) return null;
    const db = initFirestore();
    if (!db) return null;
    try {
      const snap = await db.collection('settings').doc('global').get();
      if (snap.exists) {
        return snap.data() as MonitorSettings;
      }
    } catch (e: any) {
      handleFirestoreError('getSettings', e);
    }
    return null;
  },

  async saveSettings(settings: MonitorSettings): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      await db.collection('settings').doc('global').set(
        sanitizeForFirestore({ ...settings, updatedAt: new Date().toISOString() }),
        { merge: true }
      );
    } catch (e: any) {
      handleFirestoreError('saveSettings', e);
    }
  },

  // 2. Companies
  async getCompanies(): Promise<CompanyProfile[]> {
    if (!getIsFirestoreAvailable()) return [];
    const db = initFirestore();
    if (!db) return [];
    try {
      const snap = await db.collection('companies').get();
      if (!snap.empty) {
        return snap.docs.map(d => d.data() as CompanyProfile);
      }
    } catch (e: any) {
      handleFirestoreError('getCompanies', e);
    }
    return [];
  },

  async saveCompany(company: CompanyProfile): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      await db.collection('companies').doc(company.id).set(
        sanitizeForFirestore({ ...company, updatedAt: new Date().toISOString() }),
        { merge: true }
      );
    } catch (e: any) {
      handleFirestoreError('saveCompany', e);
    }
  },

  async deleteCompany(companyId: string): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      await db.collection('companies').doc(companyId).delete();
    } catch (e: any) {
      handleFirestoreError(`deleteCompany (${companyId})`, e);
    }
  },

  async saveCompaniesBatch(companies: CompanyProfile[]): Promise<void> {
    if (!getIsFirestoreAvailable() || companies.length === 0) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const batch = db.batch();
      for (const comp of companies) {
        const docRef = db.collection('companies').doc(comp.id);
        batch.set(docRef, sanitizeForFirestore({ ...comp, updatedAt: new Date().toISOString() }), { merge: true });
      }
      await batch.commit();
    } catch (e: any) {
      handleFirestoreError('saveCompaniesBatch', e);
    }
  },

  // 3. Articles (Permanent URL deduplication index)
  async isArticleProcessed(link: string, title?: string): Promise<boolean> {
    if (!getIsFirestoreAvailable()) return false;
    const db = initFirestore();
    if (!db) return false;
    try {
      const urlHash = computeUrlHash(link);
      const snap = await db.collection('articles').doc(urlHash).get();
      if (snap.exists) return true;
    } catch (e: any) {
      handleFirestoreError('isArticleProcessed', e);
    }
    return false;
  },

  async saveArticle(article: RawArticle, eventId?: string): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const urlHash = computeUrlHash(article.link);
      await db.collection('articles').doc(urlHash).set(
        sanitizeForFirestore({
          id: article.id,
          urlHash,
          title: article.title,
          normalizedTitle: computeNormalizedTitle(article.title),
          link: article.link,
          source: article.source,
          publishedAt: article.publishedAt,
          snippet: article.snippet,
          matchedCompanyIds: article.matchedCompanyIds || [],
          eventId: eventId || null,
          processedAt: new Date().toISOString(),
        }),
        { merge: true }
      );
    } catch (e: any) {
      handleFirestoreError('saveArticle', e);
    }
  },

  async saveArticlesBatch(articles: RawArticle[]): Promise<void> {
    if (!getIsFirestoreAvailable() || articles.length === 0) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const batch = db.batch();
      for (const article of articles) {
        const urlHash = computeUrlHash(article.link);
        const docRef = db.collection('articles').doc(urlHash);
        batch.set(
          docRef,
          sanitizeForFirestore({
            id: article.id,
            urlHash,
            title: article.title,
            normalizedTitle: computeNormalizedTitle(article.title),
            link: article.link,
            source: article.source,
            publishedAt: article.publishedAt,
            snippet: article.snippet,
            matchedCompanyIds: article.matchedCompanyIds || [],
            processedAt: new Date().toISOString(),
          }),
          { merge: true }
        );
      }
      await batch.commit();
    } catch (e: any) {
      handleFirestoreError('saveArticlesBatch', e);
    }
  },

  // 4. Events (Investment News Events)
  /** CEO 보조 자료용: 헤드라인·출처·등급만 가볍게 읽기 (본문·분석 필드 제외) */
  async getEventHeadlines(limitCount = 4000): Promise<Array<Pick<NewsEvent, 'id' | 'sourceTier' | 'primarySource'>>> {
    if (!getIsFirestoreAvailable()) return [];
    const db = initFirestore();
    if (!db) return [];
    const snap = await db.collection('events').orderBy('firstSeenAt', 'desc').limit(limitCount).select('id', 'sourceTier', 'primarySource').get();
    return snap.docs.map(d => d.data() as any);
  },

  async getEvents(limitCount = 100): Promise<NewsEvent[]> {
    if (!getIsFirestoreAvailable()) return [];
    const db = initFirestore();
    if (!db) return [];
    try {
      // 최신 이벤트부터 불러오기: 정렬 없이 limit만 쓰면 문서 ID(evt-<시각>) 오름차순, 즉 가장 오래된 이벤트만
      // 불러와 새로 수집된 이벤트가 재시작 후 화면에서 사라집니다.
      let snap;
      try {
        snap = await db.collection('events').orderBy('firstSeenAt', 'desc').limit(limitCount * 2).get();
      } catch (orderErr: any) {
        console.warn('[Firestore] getEvents ordered query failed, falling back to unordered query:', orderErr?.message || orderErr);
        snap = await db.collection('events').limit(limitCount * 2).get();
      }
      const events = snap.docs.map(d => d.data() as NewsEvent);
      return events
        .sort((a, b) => {
          const timeA = new Date(a.primarySource?.publishedAt || a.firstSeenAt).getTime();
          const timeB = new Date(b.primarySource?.publishedAt || b.firstSeenAt).getTime();
          const safeA = isNaN(timeA) || timeA <= 0 ? new Date(a.updatedAt || 0).getTime() || 0 : timeA;
          const safeB = isNaN(timeB) || timeB <= 0 ? new Date(b.updatedAt || 0).getTime() || 0 : timeB;
          return safeB - safeA;
        })
        .slice(0, limitCount);
    } catch (e: any) {
      handleFirestoreError('getEvents', e);
    }
    return [];
  },

  async getEvent(eventId: string): Promise<NewsEvent | null> {
    if (!getIsFirestoreAvailable()) return null;
    const db = initFirestore();
    if (!db) return null;
    try {
      const snap = await db.collection('events').doc(eventId).get();
      if (!snap.exists) return null;
      return snap.data() as NewsEvent;
    } catch (e: any) {
      handleFirestoreError(`getEvent (${eventId})`, e);
      return null;
    }
  },

  async saveEvent(event: NewsEvent): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const docRef = db.collection('events').doc(event.id);
      const snap = await docRef.get();

      if (!snap.exists) {
        // New Event: Initialize with safe Telegram initial state
        const initialData = {
          ...event,
          isSentToTelegram: event.isSentToTelegram ?? false,
          telegramDispatchStatus: event.telegramDispatchStatus || 'pending',
          updatedAt: new Date().toISOString(),
        };
        await docRef.set(sanitizeForFirestore(initialData));
      } else {
        // Existing Event: Strip ALL Telegram lifecycle fields completely from the write payload!
        // This guarantees that stale in-memory false/pending states from other Cloud Run instances
        // can NEVER overwrite or revert Firestore's authoritative true/sent records.
        const nonTelegramPayload = stripTelegramLifecycleFields(event);
        await docRef.set(
          sanitizeForFirestore({
            ...nonTelegramPayload,
            updatedAt: new Date().toISOString(),
          }),
          { merge: true }
        );
      }
    } catch (e: any) {
      handleFirestoreError('saveEvent', e);
    }
  },

  /**
   * Atomically patches pending event status, reason, and updatedAt in Firestore using a transaction.
   * If the cloud document was already updated by another Cloud Run instance
   * (status is completed, failed, skipped, sent to telegram, or retryCount/updatedAt changed),
   * the write is aborted, and the authoritative cloud event is returned to sync local cache.
   * Never overwrites the entire event.
   */
  async normalizePendingEvent(
    eventId: string,
    patch: {
      analysisStatus: 'pending' | 'completed' | 'failed' | 'skipped';
      skipReason?: string;
      analysisError?: string;
      analysisRetryCount?: number;
      expectedRetryCount?: number;
      expectedUpdatedAt?: string;
    },
    options?: {
      expectedRetryCount?: number;
      expectedUpdatedAt?: string;
    }
  ): Promise<{
    success: boolean;
    conflict?: boolean;
    cloudEvent?: NewsEvent;
    reason?: string;
  }> {
    if (!getIsFirestoreAvailable()) {
      return { success: false, reason: 'firestore_unavailable' };
    }
    const db = initFirestore();
    if (!db) return { success: false, reason: 'firestore_unavailable' };

    try {
      const docRef = db.collection('events').doc(eventId);
      return await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(docRef);
        if (!snap.exists) {
          return { success: false, reason: 'not_found' };
        }

        const cloudEvent = snap.data() as NewsEvent;

        // 1. Conflict Check: already completed or dispatched to Telegram
        const isCompleted = cloudEvent.analysisStatus === 'completed';
        const isSent = cloudEvent.isSentToTelegram || cloudEvent.telegramDispatchStatus === 'sent';
        if (isCompleted || isSent) {
          return {
            success: false,
            conflict: true,
            cloudEvent,
            reason: `cloud_already_completed_or_sent (Status: ${cloudEvent.analysisStatus}, TelegramSent: ${cloudEvent.isSentToTelegram})`,
          };
        }

        // 2. Conflict Check: already resolved to failed or skipped by another instance
        if (cloudEvent.analysisStatus === 'failed' || cloudEvent.analysisStatus === 'skipped') {
          return {
            success: false,
            conflict: true,
            cloudEvent,
            reason: `cloud_already_resolved (Status: ${cloudEvent.analysisStatus})`,
          };
        }

        // 3. Conflict Check: retryCount or updatedAt changed in cloud since local read
        const expectedRetry = options?.expectedRetryCount ?? patch.expectedRetryCount;
        if (expectedRetry !== undefined && (cloudEvent.analysisRetryCount || 0) !== expectedRetry) {
          return {
            success: false,
            conflict: true,
            cloudEvent,
            reason: `retry_count_changed (Expected: ${expectedRetry}, Cloud: ${cloudEvent.analysisRetryCount})`,
          };
        }

        const expectedUpd = options?.expectedUpdatedAt ?? patch.expectedUpdatedAt;
        if (expectedUpd !== undefined && cloudEvent.updatedAt && cloudEvent.updatedAt !== expectedUpd) {
          return {
            success: false,
            conflict: true,
            cloudEvent,
            reason: `updated_at_changed (Expected: ${expectedUpd}, Cloud: ${cloudEvent.updatedAt})`,
          };
        }

        // 4. Atomic conditional patch: only status, skipReason, analysisError, analysisRetryCount, updatedAt
        const updateData: Record<string, any> = {
          analysisStatus: patch.analysisStatus,
          updatedAt: new Date().toISOString(),
        };

        if (patch.skipReason !== undefined) {
          updateData.skipReason = patch.skipReason;
        }
        if (patch.analysisError !== undefined) {
          updateData.analysisError = patch.analysisError;
        }
        if (patch.analysisRetryCount !== undefined) {
          updateData.analysisRetryCount = patch.analysisRetryCount;
        }

        transaction.set(docRef, sanitizeForFirestore(updateData), { merge: true });

        const updatedEvent: NewsEvent = {
          ...cloudEvent,
          ...updateData,
        };

        return {
          success: true,
          cloudEvent: updatedEvent,
        };
      });
    } catch (e: any) {
      handleFirestoreError(`normalizePendingEvent (${eventId})`, e);
      return { success: false, reason: e?.message || String(e) };
    }
  },

  // Pending work must survive scrolling out of the latest-100 dashboard window.
  async getOutstandingAnalysisEvents(): Promise<NewsEvent[]> {
    const fs = initFirestore();
    if (!fs || !getIsFirestoreAvailable()) throw new Error('firestore_unavailable');
    const all: NewsEvent[] = [];
    let cursor: any;
    for (;;) {
      let query = fs.collection('events').where('analysisStatus', 'in', ['pending','failed']).limit(200);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      for (const doc of page.docs) all.push({ ...doc.data(), id: doc.id } as NewsEvent);
      if (page.size < 200) return all;
      cursor = page.docs[page.docs.length - 1];
    }
  },

  // Optimistic, field-limited update: preserve completed analysis and concurrent source/Telegram changes.
  /** 표시용 한국어 제목만 저장(updatedAt·분석 상태는 건드리지 않아 분석 조건부 저장과 충돌하지 않음) */
  async setTitleKo(id: string, titleKo: string): Promise<boolean> {
    if (!getIsFirestoreAvailable()) return false;
    const fs = initFirestore();
    if (!fs) return false;
    try { await fs.collection('events').doc(id).set({ titleKo }, { merge: true }); return true; }
    catch (error) { handleFirestoreError('setTitleKo', error); return false; }
  },

  async commitScreeningAnalysis(expected: NewsEvent, patch: Partial<NewsEvent>): Promise<NewsEvent | null> {
    if (!getIsFirestoreAvailable()) return null;
    const fs = initFirestore();
    if (!fs) return null;
    const allowed = ['analysisStatus','screening','analysisDeferredReason','analysisError',
      'analysisRetryCount','lastAnalysisAttemptAt','title','category','contentType','importance',
      'isImportant','impact','impactRationale','relatedCompanies','companyImpacts','factualPoints',
      'summaryBulletPoints','investmentImplications','whyItMatters','keyCheckpointsToWatch',
      'investmentImpactExplanation','relatedBusinesses','analyzedByGemini','geminiModelUsed','skipReason'];
    try {
      return await fs.runTransaction(async tx => {
        const ref = fs.collection('events').doc(expected.id);
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const current = snap.data() as NewsEvent;
        if (current.analysisStatus === 'completed' || (!current.analysisStatus && current.importance > 0) ||
            current.isSentToTelegram || current.telegramDispatchStatus === 'sent' ||
            current.updatedAt !== expected.updatedAt || current.analysisStatus !== expected.analysisStatus ||
            (current.analysisRetryCount || 0) !== (expected.analysisRetryCount || 0)) return current;
        const fields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        for (const key of allowed) if (patch[key] !== undefined) fields[key] = patch[key];
        tx.set(ref, sanitizeForFirestore(fields), { merge: true });
        return { ...current, ...fields } as NewsEvent;
      });
    } catch (error) {
      handleFirestoreError('commitScreeningAnalysis', error);
      return null; // Never fall back to an unconditional cloud write.
    }
  },

  async deleteEvent(eventId: string): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      await db.collection('events').doc(eventId).delete();
    } catch (e: any) {
      handleFirestoreError(`deleteEvent (${eventId})`, e);
    }
  },

  // Atomic reservation for Telegram dispatch to prevent dual-instance double alerts
  // and prevent duplicate alerts for the same event fingerprint even across different event IDs
  async claimEventForTelegramDispatch(eventId: string, fingerprint?: string): Promise<boolean> {
    if (!getIsFirestoreAvailable()) return true;
    const db = initFirestore();
    if (!db) return true; // Fallback to local DB lock if Firestore is offline

    try {
      const eventRef = db.collection('events').doc(eventId);
      const fpHash = fingerprint
        ? crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)
        : null;
      const fpRef = fpHash ? db.collection('telegram_fingerprints').doc(fpHash) : null;

      const claimed = await db.runTransaction(async (transaction) => {
        // 1. Check fingerprint document first (if provided)
        if (fpRef) {
          const fpSnap = await transaction.get(fpRef);
          if (fpSnap.exists) {
            const fpData = fpSnap.data() as {
              status?: 'sending' | 'sent' | 'failed';
              eventId?: string;
              claimedAt?: string;
            };
            if (fpData.status === 'sent') {
              console.log(`[Firestore Claim] Blocked: fingerprint "${fingerprint}" already dispatched in Firestore (Event: ${fpData.eventId}).`);
              return false; // Already sent for this exact fingerprint!
            }
            if (fpData.status === 'sending') {
              const leaseTime = fpData.claimedAt ? new Date(fpData.claimedAt).getTime() : 0;
              if (Date.now() - leaseTime < 5 * 60 * 1000) {
                console.log(`[Firestore Claim] Blocked: fingerprint "${fingerprint}" actively being sent by another instance.`);
                return false; // Another instance is actively sending
              }
            }
          }
        }

        // 2. Check event document
        const snap = await transaction.get(eventRef);
        if (snap.exists) {
          const data = snap.data() as Partial<NewsEvent>;
          if (data.isSentToTelegram || data.telegramDispatchStatus === 'sent') {
            return false; // Already sent
          }

          if (data.telegramDispatchStatus === 'sending') {
            const leaseTime = data.dispatchClaimedAt ? new Date(data.dispatchClaimedAt).getTime() : 0;
            if (Date.now() - leaseTime < 5 * 60 * 1000) {
              return false; // Another instance is actively sending
            }
          }
        }

        const now = new Date().toISOString();

        // 3. Atomically reserve fingerprint in Firestore
        if (fpRef) {
          transaction.set(
            fpRef,
            sanitizeForFirestore({
              fingerprint,
              status: 'sending',
              eventId,
              claimedAt: now,
              updatedAt: now,
            }),
            { merge: true }
          );
        }

        // 4. Atomically reserve event in Firestore
        transaction.set(
          eventRef,
          sanitizeForFirestore({
            id: eventId,
            telegramDispatchStatus: 'sending',
            dispatchClaimedAt: now,
            isSentToTelegram: false,
            eventFingerprint: fingerprint || null,
            updatedAt: now,
          }),
          { merge: true }
        );

        return true;
      });

      return claimed;
    } catch (e: any) {
      handleFirestoreError('claimEventForTelegramDispatch', e);
      return false; // Fail-safe: do not duplicate send on transaction conflict
    }
  },

  async markEventTelegramSent(eventId: string, messageId?: string, fingerprint?: string): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const now = new Date().toISOString();
      const batch = db.batch();

      const eventRef = db.collection('events').doc(eventId);
      batch.set(
        eventRef,
        sanitizeForFirestore({
          isSentToTelegram: true,
          telegramDispatchStatus: 'sent',
          telegramMessageId: messageId || null,
          telegramSentAt: now,
          sentAt: now,
          eventFingerprint: fingerprint || null,
          updatedAt: now,
        }),
        { merge: true }
      );

      if (fingerprint) {
        const fpHash = crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32);
        const fpRef = db.collection('telegram_fingerprints').doc(fpHash);
        batch.set(
          fpRef,
          sanitizeForFirestore({
            fingerprint,
            status: 'sent',
            eventId,
            messageId: messageId || null,
            sentAt: now,
            updatedAt: now,
          }),
          { merge: true }
        );
      }

      await batch.commit();
    } catch (e: any) {
      handleFirestoreError('markEventTelegramSent', e);
    }
  },

  async markEventTelegramFailed(eventId: string, errorMessage?: string, fingerprint?: string): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const eventRef = db.collection('events').doc(eventId);
      const fpHash = fingerprint
        ? crypto.createHash('sha256').update(fingerprint).digest('hex').slice(0, 32)
        : null;
      const fpRef = fpHash ? db.collection('telegram_fingerprints').doc(fpHash) : null;

      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(eventRef);
        if (snap.exists) {
          const data = snap.data() as Partial<NewsEvent>;
          // CRITICAL: Never revert an already sent event to failed!
          if (data.isSentToTelegram || data.telegramDispatchStatus === 'sent') {
            return;
          }
        }

        transaction.set(
          eventRef,
          sanitizeForFirestore({
            isSentToTelegram: false,
            telegramDispatchStatus: 'failed',
            lastTelegramError: errorMessage || 'Dispatch failed',
            updatedAt: new Date().toISOString(),
          }),
          { merge: true }
        );

        if (fpRef) {
          const fpSnap = await transaction.get(fpRef);
          if (fpSnap.exists) {
            const fpData = fpSnap.data() as { status?: string };
            if (fpData.status === 'sending') {
              transaction.set(
                fpRef,
                sanitizeForFirestore({
                  status: 'failed',
                  lastError: errorMessage || 'Dispatch failed',
                  updatedAt: new Date().toISOString(),
                }),
                { merge: true }
              );
            }
          }
        }
      });
    } catch (e: any) {
      handleFirestoreError('markEventTelegramFailed', e);
    }
  },

  // 5. System Logs
  async getLogs(limitCount = 150): Promise<SystemLog[]> {
    if (!getIsFirestoreAvailable()) return [];
    const db = initFirestore();
    if (!db) return [];
    try {
      const snap = await db.collection('logs').orderBy('timestamp', 'desc').limit(limitCount).get();
      return snap.docs.map(d => d.data() as SystemLog);
    } catch (e: any) {
      handleFirestoreError('getLogs', e);
    }
    return [];
  },

  async addLog(log: SystemLog): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      await db.collection('logs').doc(log.id).set(sanitizeForFirestore(log));
    } catch (e: any) {
      handleFirestoreError('addLog', e);
    }
  },

  // 6. Telegram Subscribers
  async getTelegramSubscriber(chatId: string): Promise<TelegramSubscriber | null> {
    if (!getIsFirestoreAvailable()) return null;
    const db = initFirestore();
    if (!db) return null;
    try {
      const snap = await db.collection('telegramSubscribers').doc(String(chatId)).get();
      if (snap.exists) {
        return snap.data() as TelegramSubscriber;
      }
    } catch (e: any) {
      handleFirestoreError(`getTelegramSubscriber (${chatId})`, e);
    }
    return null;
  },

  async saveTelegramSubscriber(subscriber: TelegramSubscriber): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const id = String(subscriber.chatId);
      await db.collection('telegramSubscribers').doc(id).set(
        sanitizeForFirestore({
          ...subscriber,
          chatId: id,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true }
      );
    } catch (e: any) {
      handleFirestoreError(`saveTelegramSubscriber (${subscriber.chatId})`, e);
    }
  },

  async getActiveTelegramSubscribers(): Promise<TelegramSubscriber[]> {
    if (!getIsFirestoreAvailable()) return [];
    const db = initFirestore();
    if (!db) return [];
    try {
      const snap = await db.collection('telegramSubscribers').where('active', '==', true).get();
      if (!snap.empty) {
        return snap.docs.map(d => d.data() as TelegramSubscriber);
      }
    } catch (e: any) {
      handleFirestoreError('getActiveTelegramSubscribers', e);
    }
    return [];
  },

  async updateTelegramSubscriberActive(chatId: string, active: boolean): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const id = String(chatId);
      await db.collection('telegramSubscribers').doc(id).set(
        sanitizeForFirestore({
          active,
          updatedAt: new Date().toISOString(),
        }),
        { merge: true }
      );
    } catch (e: any) {
      handleFirestoreError(`updateTelegramSubscriberActive (${chatId})`, e);
    }
  },

  // 7. Daily Poll Run Guard (하루 1회 실행 보장 - Asia/Seoul 기준)
  async getDailyPollRun(dateStr: string): Promise<DailyPollRunDoc | null> {
    if (!getIsFirestoreAvailable()) return null;
    const db = initFirestore();
    if (!db) return null;
    try {
      const snap = await db.collection('poll_runs').doc(dateStr).get();
      if (snap.exists) {
        return snap.data() as DailyPollRunDoc;
      }
    } catch (e: any) {
      handleFirestoreError(`getDailyPollRun (${dateStr})`, e);
    }
    return null;
  },

  async claimDailyPollRun(dateStr: string, triggerSource: string = 'Cloud Scheduler'): Promise<{
    canRun: boolean;
    reason?: 'already_completed' | 'currently_running' | 'firestore_error';
    existingRecord?: DailyPollRunDoc;
  }> {
    if (!getIsFirestoreAvailable()) return { canRun: true };
    const db = initFirestore();
    if (!db) return { canRun: true };

    try {
      const runRef = db.collection('poll_runs').doc(dateStr);
      const result = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(runRef);
        const now = new Date().toISOString();

        if (snap.exists) {
          const data = snap.data() as DailyPollRunDoc;
          if (data.status === 'completed') {
            console.log(`[DailyGuard] Blocked: Daily poll for Asia/Seoul date "${dateStr}" is already completed.`);
            return {
              canRun: false,
              reason: 'already_completed' as const,
              existingRecord: data,
            };
          }
          if (data.status === 'running') {
            const started = data.startedAt ? new Date(data.startedAt).getTime() : 0;
            // 30 minute lease time: if started within 30 min, another instance is actively running
            if (Date.now() - started < 30 * 60 * 1000) {
              console.log(`[DailyGuard] Blocked: Daily poll for Asia/Seoul date "${dateStr}" is currently in progress by another instance.`);
              return {
                canRun: false,
                reason: 'currently_running' as const,
                existingRecord: data,
              };
            }
          }
        }

        // Atomically claim today's run
        transaction.set(
          runRef,
          sanitizeForFirestore({
            date: dateStr,
            status: 'running',
            startedAt: now,
            triggerSource,
            updatedAt: now,
          }),
          { merge: true }
        );

        return { canRun: true };
      });

      return result;
    } catch (e: any) {
      handleFirestoreError('claimDailyPollRun', e);
      return { canRun: false, reason: 'firestore_error' };
    }
  },

  async completeDailyPollRun(
    dateStr: string,
    summary: { articlesCount: number; eventsCreatedCount: number; telegramAlertsCount: number }
  ): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const now = new Date().toISOString();
      await db.collection('poll_runs').doc(dateStr).set(
        sanitizeForFirestore({
          date: dateStr,
          status: 'completed',
          completedAt: now,
          articlesCount: summary.articlesCount,
          eventsCreatedCount: summary.eventsCreatedCount,
          telegramAlertsCount: summary.telegramAlertsCount,
          updatedAt: now,
        }),
        { merge: true }
      );
    } catch (e: any) {
      handleFirestoreError('completeDailyPollRun', e);
    }
  },

  async recordDailyPollRunFailed(dateStr: string, errorMessage: string): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const now = new Date().toISOString();
      await db.collection('poll_runs').doc(dateStr).set(
        sanitizeForFirestore({
          date: dateStr,
          status: 'failed',
          errorMessage,
          updatedAt: now,
        }),
        { merge: true }
      );
    } catch (e: any) {
      handleFirestoreError('recordDailyPollRunFailed', e);
    }
  },

  // 8. Weekly Company Keyword & Business Renewal (Firestore Transactions)
  async getWeeklyRenewalBudget(weekId: string): Promise<{ usedCount: number; maxBudget: number; remaining: number }> {
    const maxBudget = 5;
    if (!getIsFirestoreAvailable()) return { usedCount: 0, maxBudget, remaining: maxBudget };
    const db = initFirestore();
    if (!db) return { usedCount: 0, maxBudget, remaining: maxBudget };
    try {
      const snap = await db.collection('weekly_renewal_budgets').doc(weekId).get();
      if (snap.exists) {
        const data = snap.data();
        const usedCount = Number(data?.callsCount) || 0;
        return { usedCount, maxBudget, remaining: Math.max(0, maxBudget - usedCount) };
      }
    } catch (e: any) {
      handleFirestoreError(`getWeeklyRenewalBudget (${weekId})`, e);
    }
    return { usedCount: 0, maxBudget, remaining: maxBudget };
  },

  async claimWeeklyCompanyRenewalLock(
    companyId: string,
    weekId: string,
    maxWeeklyBudget = 5,
    now: Date = new Date()
  ): Promise<{
    success: boolean;
    reason?: 'not_found' | 'disabled' | 'cooldown_7_days' | 'currently_locked' | 'weekly_budget_exhausted' | 'firestore_error';
    company?: CompanyProfile;
    expectedVersion?: number;
    lockToken?: string;
  }> {
    if (!getIsFirestoreAvailable()) return { success: false, reason: 'firestore_error' };
    const db = initFirestore();
    if (!db) return { success: false, reason: 'firestore_error' };

    try {
      const compRef = db.collection('companies').doc(companyId);
      const budgetRef = db.collection('weekly_renewal_budgets').doc(weekId);

      const result = await db.runTransaction(async (transaction) => {
        const compSnap = await transaction.get(compRef);
        if (!compSnap.exists) {
          return { success: false, reason: 'not_found' as const };
        }
        const authoritativeCompany = compSnap.data() as CompanyProfile;

        // Re-verify eligibility inside transaction
        if (authoritativeCompany.enabled === false || authoritativeCompany.autoWeeklyRenewalEnabled === false) {
          return { success: false, reason: 'disabled' as const, company: authoritativeCompany };
        }

        const nowTime = now.getTime();
        const nowIso = now.toISOString();

        // 7-day cooldown check using injected now
        if (authoritativeCompany.lastKeywordRenewalAttemptAt) {
          const lastAttemptTime = new Date(authoritativeCompany.lastKeywordRenewalAttemptAt).getTime();
          if (nowTime - lastAttemptTime < 7 * 24 * 60 * 60 * 1000) {
            return { success: false, reason: 'cooldown_7_days' as const, company: authoritativeCompany };
          }
        }

        // Active lock check (5 min lease)
        if (authoritativeCompany.renewalLock?.lockedAt) {
          const lockedTime = new Date(authoritativeCompany.renewalLock.lockedAt).getTime();
          const leaseMs = authoritativeCompany.renewalLock.leaseMs || 300000;
          if (nowTime - lockedTime < leaseMs) {
            return { success: false, reason: 'currently_locked' as const, company: authoritativeCompany };
          }
        }

        // Weekly budget check
        const budgetSnap = await transaction.get(budgetRef);
        let usedCalls = 0;
        if (budgetSnap.exists) {
          usedCalls = Number(budgetSnap.data()?.callsCount) || 0;
        }

        if (usedCalls >= maxWeeklyBudget) {
          return { success: false, reason: 'weekly_budget_exhausted' as const, company: authoritativeCompany };
        }

        const lockToken = crypto.randomUUID();
        const expectedVersion = typeof authoritativeCompany.version === 'number' ? authoritativeCompany.version : 1;

        // Atomically lock company & update lastKeywordRenewalAttemptAt so daily cycle won't retry on failure
        const lockedCompany: CompanyProfile = {
          ...authoritativeCompany,
          lastKeywordRenewalAttemptAt: nowIso,
          lastRenewalStatus: 'running',
          renewalLock: {
            lockedAt: nowIso,
            leaseMs: 300000,
            token: lockToken,
          },
          updatedAt: nowIso,
        };

        transaction.set(compRef, sanitizeForFirestore(lockedCompany), { merge: true });

        // Atomically increment weekly budget
        transaction.set(
          budgetRef,
          sanitizeForFirestore({
            weekId,
            callsCount: usedCalls + 1,
            updatedAt: nowIso,
          }),
          { merge: true }
        );

        return {
          success: true,
          company: lockedCompany,
          expectedVersion,
          lockToken,
        };
      });

      return result;
    } catch (e: any) {
      handleFirestoreError(`claimWeeklyCompanyRenewalLock (${companyId})`, e);
      return { success: false, reason: 'firestore_error' };
    }
  },

  async recordCompanyRenewalAttemptFailed(
    companyId: string,
    lockToken: string | undefined,
    status: 'failed' | 'skipped' | 'rate_limited',
    reason: string,
    now: Date = new Date()
  ): Promise<{ success: boolean; company?: CompanyProfile }> {
    if (!getIsFirestoreAvailable()) return { success: false };
    const db = initFirestore();
    if (!db) return { success: false };

    try {
      const compRef = db.collection('companies').doc(companyId);
      const result = await db.runTransaction(async (transaction) => {
        const compSnap = await transaction.get(compRef);
        if (!compSnap.exists) {
          return { success: false };
        }
        const currentData = compSnap.data() as CompanyProfile;

        // Lock owner verification:
        if (lockToken) {
          // If lockToken is provided, currentData.renewalLock?.token must strictly match!
          if (!currentData.renewalLock?.token || currentData.renewalLock.token !== lockToken) {
            console.warn(`[Firestore] Lock ownership mismatch for ${companyId}: expected ${lockToken}, got ${currentData.renewalLock?.token}`);
            return { success: false, company: currentData };
          }
        } else {
          // If lockToken is NOT provided, check if another worker currently holds an active lock
          if (currentData.renewalLock?.lockedAt) {
            const lockedTime = new Date(currentData.renewalLock.lockedAt).getTime();
            const leaseMs = currentData.renewalLock.leaseMs || 300000;
            if (now.getTime() - lockedTime < leaseMs) {
              console.warn(`[Firestore] Cannot record failure without token while active lock exists for ${companyId}`);
              return { success: false, company: currentData };
            }
          }
        }

        const nowIso = now.toISOString();
        const metadataPatch: Partial<CompanyProfile> = {
          lastKeywordRenewalAttemptAt: nowIso,
          lastRenewalStatus: status,
          lastRenewalReason: reason,
          renewalLock: lockToken ? null : (currentData.renewalLock || null),
          updatedAt: nowIso,
        };

        // Strictly patch only metadata to preserve any concurrent human edits to keywords/businesses/pins!
        transaction.set(compRef, sanitizeForFirestore(metadataPatch), { merge: true });

        const patched: CompanyProfile = {
          ...currentData,
          ...metadataPatch,
        };
        return { success: true, company: patched };
      });

      return result;
    } catch (e: any) {
      handleFirestoreError(`recordCompanyRenewalAttemptFailed (${companyId})`, e);
      return { success: false };
    }
  },

  async saveCompanyRenewalSuccess(
    companyId: string,
    updatedCompany: CompanyProfile,
    expectedVersion: number,
    lockToken?: string
  ): Promise<{ success: boolean; reason?: 'not_found' | 'version_conflict' | 'lock_mismatch' | 'firestore_error'; updatedCompany?: CompanyProfile }> {
    if (!getIsFirestoreAvailable()) return { success: false, reason: 'firestore_error' };
    const db = initFirestore();
    if (!db) return { success: false, reason: 'firestore_error' };

    try {
      const compRef = db.collection('companies').doc(companyId);

      const result = await db.runTransaction(async (transaction) => {
        const compSnap = await transaction.get(compRef);
        if (!compSnap.exists) {
          return { success: false, reason: 'not_found' as const };
        }
        const currentData = compSnap.data() as CompanyProfile;
        const currentVersion = typeof currentData.version === 'number' ? currentData.version : 1;

        if (currentVersion !== expectedVersion) {
          console.warn(`[Firestore] Conflict: Company "${companyId}" was modified by an admin or another worker (expected v${expectedVersion}, got v${currentVersion}). Aborting auto renewal.`);
          return { success: false, reason: 'version_conflict' as const };
        }

        // Lock verification: if lockToken is provided, currentData.renewalLock?.token must strictly match!
        if (lockToken) {
          if (!currentData.renewalLock?.token || currentData.renewalLock.token !== lockToken) {
            console.warn(`[Firestore] Lock mismatch: Company "${companyId}" lock token mismatch (expected ${lockToken}, got ${currentData.renewalLock?.token}). Aborting auto renewal.`);
            return { success: false, reason: 'lock_mismatch' as const };
          }
        }

        const now = new Date().toISOString();
        const newVersion = currentVersion + 1;

        const merged: CompanyProfile = {
          ...currentData,
          ...updatedCompany,
          version: newVersion,
          lastKeywordRenewalSuccessAt: now,
          lastRenewalStatus: 'success',
          renewalLock: null,
          updatedAt: now,
        };

        transaction.set(compRef, sanitizeForFirestore(merged), { merge: true });
        return { success: true, updatedCompany: merged };
      });

      return result;
    } catch (e: any) {
      handleFirestoreError(`saveCompanyRenewalSuccess (${companyId})`, e);
      return { success: false, reason: 'firestore_error' };
    }
  },

  async saveCompanyHumanEdit(
    company: CompanyProfile,
    expectedVersion?: number
  ): Promise<{ success: boolean; reason?: 'not_found' | 'version_conflict' | 'firestore_error'; company?: CompanyProfile }> {
    if (!getIsFirestoreAvailable()) return { success: false, reason: 'firestore_error' };
    const db = initFirestore();
    if (!db) return { success: false, reason: 'firestore_error' };

    try {
      const compRef = db.collection('companies').doc(company.id);

      const result = await db.runTransaction(async (transaction) => {
        const compSnap = await transaction.get(compRef);
        const exists = compSnap.exists;
        const currentData = exists ? (compSnap.data() as CompanyProfile) : null;
        const currentVersion = currentData && typeof currentData.version === 'number' ? currentData.version : 1;

        if (exists && expectedVersion !== undefined && currentVersion !== expectedVersion) {
          return { success: false, reason: 'version_conflict' as const };
        }

        const nowIso = new Date().toISOString();
        const nextVersion = exists ? currentVersion + 1 : (typeof company.version === 'number' ? company.version : 1);

        const initialMatch = INITIAL_COMPANIES.find(ic => ic.id === company.id);
        const sanitized: CompanyProfile = {
          ...(currentData || {}),
          id: company.id,
          name: company.name || currentData?.name || initialMatch?.name || company.id,
          ticker: company.ticker !== undefined ? company.ticker : (currentData?.ticker || initialMatch?.ticker),
          color: company.color || currentData?.color || initialMatch?.color || '#3b82f6',
          enabled: company.enabled !== undefined ? company.enabled : (currentData?.enabled ?? true),
          autoWeeklyRenewalEnabled: company.autoWeeklyRenewalEnabled !== undefined ? company.autoWeeklyRenewalEnabled : (currentData?.autoWeeklyRenewalEnabled ?? true),
          searchKeywords: (company.searchKeywords || currentData?.searchKeywords || []).slice(0, 6),
          coreBusinesses: (company.coreBusinesses || currentData?.coreBusinesses || []).slice(0, 4),
          // 중요한 중요도 프로필(importantKeywords)은 6개 한도 없이 원형 보존
          importantKeywords: company.importantKeywords || currentData?.importantKeywords || initialMatch?.importantKeywords || [],
          lowImportanceKeywords: company.lowImportanceKeywords || currentData?.lowImportanceKeywords || initialMatch?.lowImportanceKeywords || [],
          competitorKeywords: company.competitorKeywords || currentData?.competitorKeywords || initialMatch?.competitorKeywords || [],
          pinnedSearchKeywords: (company.pinnedSearchKeywords || currentData?.pinnedSearchKeywords || initialMatch?.pinnedSearchKeywords || []).slice(0, 6),
          pinnedCoreBusinesses: (company.pinnedCoreBusinesses || currentData?.pinnedCoreBusinesses || initialMatch?.pinnedCoreBusinesses || []).slice(0, 4),
          // 서버 메타데이터는 클라이언트 입력 덮어쓰기를 방지하고 현재 서버값 엄격 보존
          lastKeywordRenewalAttemptAt: currentData?.lastKeywordRenewalAttemptAt ?? company.lastKeywordRenewalAttemptAt,
          lastKeywordRenewalSuccessAt: currentData?.lastKeywordRenewalSuccessAt ?? company.lastKeywordRenewalSuccessAt,
          lastRenewalStatus: currentData?.lastRenewalStatus ?? company.lastRenewalStatus,
          lastRenewalReason: currentData?.lastRenewalReason ?? company.lastRenewalReason,
          renewalLock: currentData?.renewalLock !== undefined ? currentData.renewalLock : (company.renewalLock || null),
          renewalHistory: currentData?.renewalHistory && currentData.renewalHistory.length > 0
            ? currentData.renewalHistory.slice(0, 10)
            : (company.renewalHistory || []).slice(0, 10),
          version: nextVersion,
          updatedAt: nowIso,
        };

        transaction.set(compRef, sanitizeForFirestore(sanitized), { merge: true });
        return { success: true, company: sanitized };
      });

      return result;
    } catch (e: any) {
      handleFirestoreError(`saveCompanyHumanEdit (${company.id})`, e);
      return { success: false, reason: 'firestore_error' };
    }
  },

  async rollbackCompanyInFirestore(
    companyId: string,
    historyId: string,
    expectedVersion?: number
  ): Promise<{ success: boolean; error?: string; company?: CompanyProfile }> {
    if (!getIsFirestoreAvailable()) return { success: false, error: 'firestore_unavailable' };
    const db = initFirestore();
    if (!db) return { success: false, error: 'firestore_unavailable' };

    try {
      const compRef = db.collection('companies').doc(companyId);

      const result = await db.runTransaction(async (transaction) => {
        const compSnap = await transaction.get(compRef);
        if (!compSnap.exists) {
          return { success: false, error: `Company "${companyId}" not found` };
        }
        const current = compSnap.data() as CompanyProfile;
        const currentVersion = typeof current.version === 'number' ? current.version : 1;

        if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
          return {
            success: false,
            error: `기업 정보가 다른 사용자에 의해 변경되었습니다 (현재 v${currentVersion}, 요청 v${expectedVersion}). 새로고침 후 다시 시도해주세요.`,
          };
        }

        const historyEntry = (current.renewalHistory || []).find((h) => h.id === historyId);
        if (!historyEntry) {
          return { success: false, error: `History record "${historyId}" not found for company "${companyId}"` };
        }

        const pinnedKeywords = (current.pinnedSearchKeywords || []).map((k) => k.trim()).filter(Boolean);
        const pinnedBusinesses = (current.pinnedCoreBusinesses || []).map((b) => b.trim()).filter(Boolean);

        const restoredKeywords = historyEntry.before.searchKeywords || [];
        const restoredBusinesses = historyEntry.before.coreBusinesses || [];

        const finalKeywords = Array.from(new Set([...pinnedKeywords, ...restoredKeywords])).slice(0, 6);
        const finalBusinesses = Array.from(new Set([...pinnedBusinesses, ...restoredBusinesses])).slice(0, 4);

        const nowIso = new Date().toISOString();
        const nextVersion = currentVersion + 1;

        const rollbackAuditEntry: CompanyRenewalHistoryEntry = {
          id: `hist-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          companyId: current.id,
          timestamp: nowIso,
          status: 'rolled_back',
          before: {
            searchKeywords: [...current.searchKeywords],
            coreBusinesses: [...current.coreBusinesses],
          },
          after: {
            searchKeywords: finalKeywords,
            coreBusinesses: finalBusinesses,
          },
          addedKeywords: finalKeywords.filter((k) => !current.searchKeywords.includes(k)),
          removedKeywords: current.searchKeywords.filter((k) => !finalKeywords.includes(k)),
          addedBusinesses: finalBusinesses.filter((b) => !current.coreBusinesses.includes(b)),
          removedBusinesses: current.coreBusinesses.filter((b) => !finalBusinesses.includes(b)),
          reason: `관리자에 의한 이전 상태 복원 (기준 이력: ${new Date(historyEntry.timestamp).toLocaleString('ko-KR')})`,
          evidenceArticleIds: historyEntry.evidenceArticleIds || [],
          versionBefore: currentVersion,
          versionAfter: nextVersion,
        };

        const restoredProfile: CompanyProfile = {
          ...current,
          searchKeywords: finalKeywords,
          coreBusinesses: finalBusinesses,
          version: nextVersion,
          lastRenewalStatus: 'success',
          lastRenewalReason: rollbackAuditEntry.reason,
          renewalHistory: [rollbackAuditEntry, ...(current.renewalHistory || [])].slice(0, 10),
          updatedAt: nowIso,
        };

        transaction.set(compRef, sanitizeForFirestore(restoredProfile), { merge: true });
        return { success: true, company: restoredProfile };
      });

      return result;
    } catch (e: any) {
      handleFirestoreError(`rollbackCompanyInFirestore (${companyId})`, e);
      return { success: false, error: String(e?.message || e) };
    }
  },

  async releaseCompanyRenewalLock(
    companyId: string,
    status?: 'failed' | 'skipped' | 'rate_limited',
    reason?: string
  ): Promise<void> {
    if (!getIsFirestoreAvailable()) return;
    const db = initFirestore();
    if (!db) return;
    try {
      const now = new Date().toISOString();
      const patch: any = {
        renewalLock: null,
        updatedAt: now,
      };
      if (status) patch.lastRenewalStatus = status;
      if (reason) patch.lastRenewalReason = reason;

      await db.collection('companies').doc(companyId).set(
        sanitizeForFirestore(patch),
        { merge: true }
      );
    } catch (e: any) {
      handleFirestoreError(`releaseCompanyRenewalLock (${companyId})`, e);
    }
  },
};
