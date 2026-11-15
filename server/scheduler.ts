import { db } from './db';
import { collectNewArticles } from './collector';
import { clusterAndProcessArticles, runTwoStageAnalysis } from './geminiAnalyzer';
import { sendPublicEventToTelegram as sendEventToTelegram, isEventQualifiedForTelegramAutoDispatch } from './telegram';
import { NewsEvent } from './types';
import { getSeoulDateString, getIsFirestoreAvailable, initFirestore } from './firestore';
import { maintainCompanyKeywords } from './keywordMaintenance';
import { CeoRuntime } from './ceo/runtime';
import { createCeoRuntime } from './ceo/routes';
import { OpenAITextClient as GoogleGenAI, resolveOpenAIModel } from './openaiClient';
import { firestoreRepo } from './firestore';

/** 뉴스 제목 한국어 번역(표시 전용, Flash-Lite, 월 USD 1 상한). 분석만 하는 사이클 시작 때 최대 30초 */
export async function runNewsTitleTranslation(deadline: number) {
  const apiKey = process.env.OPENAI_API_KEY;
  const fs = getIsFirestoreAvailable() ? initFirestore() : null;
  if (!apiKey || !fs) return { skipped: true };
  const { translateTitles, TITLE_KO_MODEL, MAX_OUTPUT } = await import('./newsTitleKo.mjs');
  const ai = new GoogleGenAI({ apiKey, httpOptions: { headers: { 'User-Agent': 'aistudio-build' }, retryOptions: { attempts: 1 } } });
  const { createTitleKoStore } = await import('./newsTitleKoStore.mjs');
  const result = await translateTitles(db.getEvents(), {
    now: () => Date.now(), deadline, maxBatches: 8,
    store: createTitleKoStore(fs),
    generate: async (prompt: string, timeoutMs: number) => {
      const r = await ai.models.generateContent({ model: TITLE_KO_MODEL, contents: prompt, config: { responseMimeType: 'application/json', maxOutputTokens: MAX_OUTPUT, temperature: 0.2, httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } } } });
      const u: any = r.usageMetadata || {};
      return { text: r.text, usage: { in: u.promptTokenCount, out: Number.isSafeInteger(u.totalTokenCount) && Number.isSafeInteger(u.promptTokenCount) && u.totalTokenCount >= u.promptTokenCount ? u.totalTokenCount - u.promptTokenCount : NaN } };
    },
    save: async (id: string, titleKo: string) => {
      const saved = await firestoreRepo.setTitleKo(id, titleKo);
      if (saved) { const e = db.getEventById(id); if (e) db.syncEventFromCloud({ ...e, titleKo }); }
      return saved;
    },
  });
  db.addLog('Gemini', 'info', `[TitleKo] ${JSON.stringify(result)}`);
  return result;
}

let schedulerCeoRuntime: CeoRuntime | null = null;

export function setSchedulerCeoRuntime(runtime: CeoRuntime | null) {
  schedulerCeoRuntime = runtime;
}

export function getSchedulerCeoRuntime(): CeoRuntime | null {
  if (!schedulerCeoRuntime && getIsFirestoreAvailable()) {
    schedulerCeoRuntime = createCeoRuntime(
      () => db.getEvents(),
      () => (getIsFirestoreAvailable() ? initFirestore() : null)
    );
  }
  return schedulerCeoRuntime;
}

let customCollectArticles: (() => Promise<{ totalFetched: number; newRelevantArticles: any[] }>) | null = null;

export function _setCollectArticlesForTesting(fn: (() => Promise<{ totalFetched: number; newRelevantArticles: any[] }>) | null) {
  customCollectArticles = fn;
}

let pollTimer: NodeJS.Timeout | null = null;
let isPollingInProgress = false;

/**
 * 분석 전용 사이클: 수집 없이 밀린 간단 평가·상세 분석만 진행(하루 1회 수집 뒤 남은 시간대에 Cloud Scheduler가 호출).
 * 72시간 이내 뉴스가 먼저, 그다음 과거 미평가분. 텔레그램은 72시간 이내 + 기존 발송 조건(5★)을 만족할 때만.
 */
export async function runAnalysisOnlyCycle(deadlineMs = 150_000): Promise<{ skipped?: boolean; summary?: any; telegramAlertsSentCount: number }> {
  if (isPollingInProgress) return { skipped: true, telegramAlertsSentCount: 0 };
  isPollingInProgress = true;
  const startTime = Date.now();
  let telegramAlertsSentCount = 0;
  try {
    const settings = db.getSettings();
    await maintainCompanyKeywords({settings});
    if (settings.autoAnalyzeWithGemini === false) return { skipped: true, telegramAlertsSentCount: 0 };
    // 제목 번역을 먼저 짧게(최대 30초) 처리: 분석이 시간을 다 써서 번역이 밀리지 않게
    try { await runNewsTitleTranslation(startTime + 30_000); } catch (e) { db.addLog('Gemini', 'warn', `[TitleKo] failed: ${String(e).slice(0, 120)}`); }
    const summary = await runTwoStageAnalysis({ deadlineAt: startTime + 30_000 + deadlineMs, includeBacklog: true });
    const completedIds = new Set(summary?.completedEventIds || []);
    if (settings.autoSendTelegram) {
      for (const event of db.getEvents().filter(e => completedIds.has(e.id))) {
        if (!isEventQualifiedForTelegramAutoDispatch(event, settings).qualified) continue;
        const r = await sendEventToTelegram(event);
        if (r.success) telegramAlertsSentCount++;
      }
    }
    db.addLog('Scheduler', 'success', `[AnalysisOnly] finished in ${((Date.now() - startTime) / 1000).toFixed(1)}s. screened=${summary.screened}, detailed=${summary.detailed}, failed=${summary.failed}, telegram=${telegramAlertsSentCount}`);
    return { summary, telegramAlertsSentCount };
  } finally {
    isPollingInProgress = false;
  }
}

export async function runMonitoringCycle(isManual: boolean = false): Promise<{
  newArticlesCount: number;
  newEventsCreated: NewsEvent[];
  telegramAlertsSentCount: number;
  skipped?: boolean;
  skipReason?: string;
  seoulDate?: string;
  analysisSummary?: any;
  ceoStatus?: string;
  elapsedSeconds?: number;
}> {
  if (isPollingInProgress) {
    db.addLog('Scheduler', 'warn', 'Monitoring cycle requested while previous cycle is still in progress. Skipping.');
    return { newArticlesCount: 0, newEventsCreated: [], telegramAlertsSentCount: 0 };
  }

  const seoulDate = getSeoulDateString();

  // Daily Execution Guard: In production and automated cron triggers, strictly enforce exactly ONE execution per calendar day (Asia/Seoul)
  // Manual trigger from UI (isManual === true) bypasses this guard for testing and on-demand refresh.
  if (!isManual) {
    const claim = await db.claimDailyPollRun(seoulDate, 'Cloud Scheduler /api/jobs/poll');
    if (!claim.canRun) {
      const reasonMsg = claim.reason === 'already_completed'
        ? '이미 금일 자동 뉴스 수집이 완료되었습니다'
        : claim.reason === 'currently_running'
        ? '현재 다른 인스턴스에서 금일 자동 수집이 진행 중입니다'
        : 'Firestore 트랜잭션 충돌로 중복 실행이 차단되었습니다';

      db.addLog(
        'Scheduler',
        'info',
        `[DailyGuard] Today's automated poll (${seoulDate}) skipped: ${claim.reason} (${reasonMsg}). Gemini API 토큰 절약 및 하루 1회 정책 준수.`
      );
      return {
        newArticlesCount: 0,
        newEventsCreated: [],
        telegramAlertsSentCount: 0,
        skipped: true,
        skipReason: claim.reason,
        seoulDate,
      };
    }
  }

  isPollingInProgress = true;
  const startTime = Date.now();
  db.addLog('Scheduler', 'info', `Monitoring cycle started (${isManual ? 'Manual Trigger' : `Scheduled Poll for Asia/Seoul ${seoulDate}`}).`);

  let newArticlesCount = 0;
  let newEventsCreated: NewsEvent[] = [];
  let telegramAlertsSentCount = 0;
  let analysisSummaryOut: any = null;
  let ceoStatus = '미실행';

  try {
    const settings = db.getSettings();

    // 1. Collect articles from multi-source RSS feeds
    let collectResult;
    try {
      collectResult = customCollectArticles ? await customCollectArticles() : await collectNewArticles();
      newArticlesCount = collectResult.newRelevantArticles.length;
    } catch (collectorErr: unknown) {
      const cMsg = collectorErr instanceof Error ? collectorErr.message : String(collectorErr);
      console.error(`[POLL] failed: collector_error - ${cMsg}`);
      db.addLog('Collector', 'error', `[POLL] RSS feed collection failed: ${cMsg}`);
      throw collectorErr;
    }

    // Rule-only clustering first: never spend the analysis allowance on the first eight articles.
    if (newArticlesCount > 0) {
      newEventsCreated = await clusterAndProcessArticles(collectResult.newRelevantArticles, false, 0);
    }
    // Cloud Scheduler 기본 응답 제한(180초) 안에 사이클이 끝나도록 분석 시작 시한을 둡니다.
    // 시한을 넘긴 기사는 다음 사이클로 이월되며, 사이클 종료 기록(lastPollTime)은 항상 남습니다.
    const CYCLE_ANALYSIS_DEADLINE_MS = 140 * 1000;
    const analysisSummary = settings.autoAnalyzeWithGemini !== false
      ? await runTwoStageAnalysis({ deadlineAt: startTime + CYCLE_ANALYSIS_DEADLINE_MS, includeBacklog: true })
      : null;
    analysisSummaryOut = analysisSummary;
    if (analysisSummary?.timeBudgetExceeded) {
      db.addLog('Scheduler', 'info', '[TimeBudget] 사이클 시간 한도로 남은 분석은 다음 사이클로 이월합니다.');
    }
    // Include old queued events completed today, not only new articles.
    const completedIds = new Set(analysisSummary?.completedEventIds || []);
    const dispatchCandidates = db.getEvents().filter(e => completedIds.has(e.id));
    newEventsCreated = newEventsCreated.map(e => db.getEventById(e.id) || e);

    // 4. Dispatch Telegram alerts for newly created events matching criteria
    if (settings.autoSendTelegram) {
      for (const event of dispatchCandidates) {
        const qualification = isEventQualifiedForTelegramAutoDispatch(event, settings);
        if (!qualification.qualified) {
          continue;
        }

        const sendRes = await sendEventToTelegram(event);
        if (sendRes.success) {
          telegramAlertsSentCount++;
        }
      }
    }

    // 5. Weekly Company Keyword & Business Renewal (Every 7 days per active company, weekly budget cap: 5)
    // Runs inside the daily cycle without any extra timers/schedulers; skipped if Firestore is disconnected
    const RENEWAL_START_LIMIT_MS = 150 * 1000;
    if (Date.now() - startTime > RENEWAL_START_LIMIT_MS) {
      db.addLog('Scheduler', 'info', '[TimeBudget] 사이클 시간 한도로 주간 키워드 갱신은 다음 사이클로 미룹니다.');
    } else if (settings.weeklyCompanyRenewalEnabled !== false && getIsFirestoreAvailable()) {
      await maintainCompanyKeywords({settings});
    }

    // 6. Daily CEO Official Sources Collection (Connected to existing server schedule path)
    // Runs inside the daily monitoring cycle without creating new local timers.
    // Strictly adheres to 하루 1회 Asia/Seoul policy, Firestore lease/fencing/cache, and minInterval.
    // CEO collection failure MUST be isolated from news monitoring cycle results.
    const ceoRuntime = getSchedulerCeoRuntime();
    // CEO collection takes ~30s. Start it only while the whole cycle can still answer the
    // scheduler before Cloud Run's 300s request timeout; otherwise it runs on the next cycle.
    const CEO_START_LIMIT_MS = 210 * 1000;
    if (ceoRuntime && Date.now() - startTime > CEO_START_LIMIT_MS) {
      db.addLog('Scheduler', 'info', '[TimeBudget] 사이클 시간 한도로 CEO 공식 자료 수집은 다음 사이클로 미룹니다.');
      ceoStatus = '시간 부족으로 미룸';
    } else if (ceoRuntime) {
      try {
        const snap = await ceoRuntime.snapshot();
        const lastSeoulDate = snap.refreshedAt ? getSeoulDateString(new Date(snap.refreshedAt)) : null;
        if (!isManual && lastSeoulDate === seoulDate) {
          db.addLog('Scheduler', 'info', `[CEO Daily] Today's CEO collection (${seoulDate}) already completed. Skipping.`);
          ceoStatus = '오늘 이미 수집함';
        } else {
          db.addLog('Scheduler', 'info', `[CEO Daily] Starting scheduled CEO official collection for Asia/Seoul ${seoulDate}...`);
          const ceoResult = await ceoRuntime.refresh();
          if (ceoResult.accepted) {
            db.addLog('Scheduler', 'success', `[CEO Daily] CEO collection completed (revision: ${ceoResult.response.storeRevision}).`);
            ceoStatus = '수집 완료';
          } else {
            db.addLog('Scheduler', 'warn', `[CEO Daily] CEO collection skipped or not accepted: ${ceoResult.error || ceoResult.reason}`);
            ceoStatus = `건너뜀(${String(ceoResult.reason || ceoResult.error || '').slice(0, 40)})`;
          }
        }
      } catch (ceoErr: unknown) {
        // Non-fatal error: news monitoring cycle succeeds even if CEO collection encounters an issue
        const cMsg = ceoErr instanceof Error ? ceoErr.message : String(ceoErr);
        db.addLog('Scheduler', 'warn', `[CEO Daily] CEO official collection encountered a non-fatal error: ${cMsg}`);
        ceoStatus = '오류';
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const nextPoll = new Date(Date.now() + settings.pollIntervalMinutes * 60 * 1000).toISOString();

    await db.updateSettings({
      lastPollTime: new Date().toISOString(),
      nextPollTime: nextPoll,
    });

    db.addLog('Scheduler', 'success', `Monitoring cycle finished in ${elapsed}s. New articles: ${newArticlesCount}, Events: ${newEventsCreated.length}, Telegram alerts: ${telegramAlertsSentCount}.`);

    if (!isManual) {
      await db.completeDailyPollRun(seoulDate, {
        articlesCount: newArticlesCount,
        eventsCreatedCount: newEventsCreated.length,
        telegramAlertsCount: telegramAlertsSentCount,
      });
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    db.addLog('Scheduler', 'error', `Monitoring cycle encountered an error: ${errorMsg}`);
    if (!isManual) {
      await db.recordDailyPollRunFailed(seoulDate, errorMsg);
    }
    // Propagate error so caller (e.g. Cloud Scheduler endpoint) knows execution failed and does not report false success
    throw err;
  } finally {
    isPollingInProgress = false;
  }

  return {
    newArticlesCount,
    newEventsCreated,
    telegramAlertsSentCount,
    analysisSummary: analysisSummaryOut,
    ceoStatus,
    elapsedSeconds: Math.round((Date.now() - startTime) / 1000),
  };
}

export function startScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Internal setInterval scheduler is ONLY started if explicitly requested via ENABLE_INTERNAL_SCHEDULER=true.
  // In serverless Cloud Run and standard environments, polling is driven by Cloud Scheduler (/api/jobs/poll) or manual UI requests.
  const shouldRunInternalTimer = process.env.ENABLE_INTERNAL_SCHEDULER === 'true';

  if (!shouldRunInternalTimer) {
    db.addLog('Scheduler', 'info', 'Serverless mode active: Internal background setInterval is idle (ENABLE_INTERNAL_SCHEDULER is false). Periodic execution is delegated to Cloud Scheduler (/api/jobs/poll) or manual triggers.');
    return;
  }

  const settings = db.getSettings();
  const intervalMinutes = settings.pollIntervalMinutes || 1440;
  const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;

  db.addLog('Scheduler', 'info', `Local/Container scheduler running with interval ${intervalMinutes} minutes (하루 1회).`);

  db.updateSettings({
    nextPollTime: new Date(Date.now() + intervalMs).toISOString(),
  });

  pollTimer = setInterval(() => {
    runMonitoringCycle(false).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Scheduler] Internal background cycle failed:', msg);
    });
  }, intervalMs);
}

export function stopScheduler() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function restartSchedulerWithNewInterval(minutes: number) {
  db.updateSettings({ pollIntervalMinutes: minutes });
  startScheduler();
}

export function getSchedulerStatus(): { isPolling: boolean } {
  return { isPolling: isPollingInProgress };
}
