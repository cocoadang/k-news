import { db } from './db';
import { collectNewArticles } from './collector';
import { clusterAndProcessArticles, runTwoStageAnalysis } from './geminiAnalyzer';
import { sendEventToTelegram, isEventQualifiedForTelegramAutoDispatch } from './telegram';
import { NewsEvent } from './types';
import { getSeoulDateString, getIsFirestoreAvailable, initFirestore } from './firestore';
import { runWeeklyCompanyRenewalsBatch } from './companyRenewal';
import { CeoRuntime } from './ceo/runtime';
import { createCeoRuntime } from './ceo/routes';

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

export async function runMonitoringCycle(isManual: boolean = false): Promise<{
  newArticlesCount: number;
  newEventsCreated: NewsEvent[];
  telegramAlertsSentCount: number;
  skipped?: boolean;
  skipReason?: string;
  seoulDate?: string;
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
      ? await runTwoStageAnalysis({ deadlineAt: startTime + CYCLE_ANALYSIS_DEADLINE_MS })
      : null;
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
      try {
        const weeklyResult = await runWeeklyCompanyRenewalsBatch();
        if (weeklyResult.processedCount > 0) {
          db.addLog(
            'Scheduler',
            'info',
            `[Weekly Renewal] Processed ${weeklyResult.processedCount} companies (Updated: ${weeklyResult.updatedCount}, Skipped: ${weeklyResult.skippedCount}, Weekly Model Calls: ${weeklyResult.modelCallsCount}/5).`
          );
        }
      } catch (weeklyErr: unknown) {
        // CRITICAL: Do NOT propagate to daily poll failure
        const wMsg = weeklyErr instanceof Error ? weeklyErr.message : String(weeklyErr);
        db.addLog('Scheduler', 'warn', `[Weekly Renewal] Weekly renewal encountered a non-fatal error: ${wMsg}`);
      }
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
    } else if (ceoRuntime) {
      try {
        const snap = await ceoRuntime.snapshot();
        const lastSeoulDate = snap.refreshedAt ? getSeoulDateString(new Date(snap.refreshedAt)) : null;
        if (!isManual && lastSeoulDate === seoulDate) {
          db.addLog('Scheduler', 'info', `[CEO Daily] Today's CEO collection (${seoulDate}) already completed. Skipping.`);
        } else {
          db.addLog('Scheduler', 'info', `[CEO Daily] Starting scheduled CEO official collection for Asia/Seoul ${seoulDate}...`);
          const ceoResult = await ceoRuntime.refresh();
          if (ceoResult.accepted) {
            db.addLog('Scheduler', 'success', `[CEO Daily] CEO collection completed (revision: ${ceoResult.response.storeRevision}).`);
          } else {
            db.addLog('Scheduler', 'warn', `[CEO Daily] CEO collection skipped or not accepted: ${ceoResult.error || ceoResult.reason}`);
          }
        }
      } catch (ceoErr: unknown) {
        // Non-fatal error: news monitoring cycle succeeds even if CEO collection encounters an issue
        const cMsg = ceoErr instanceof Error ? ceoErr.message : String(ceoErr);
        db.addLog('Scheduler', 'warn', `[CEO Daily] CEO official collection encountered a non-fatal error: ${cMsg}`);
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
