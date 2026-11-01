// 운영 점검용 공개 요약(/api/ops/health). 비밀값·IP·로그 원문 없이 숫자/상태만 내보낸다. 순수 함수(테스트 가능).
const H = 3600_000;
const kstDay = t => new Date(t + 9 * H).toISOString().slice(0, 10);
const num = v => (Number.isFinite(+v) ? +v : null);
const pct = (used, limit) => (limit > 0 && Number.isFinite(used) ? Math.round((used / limit) * 1000) / 10 : null);
const ACTIVE = ['text_waiting', 'text_summary', 'supadata_inflight', 'vidiq_inflight', 'text_summary_inflight', 'caption_inflight'];
const DONE = ['sent', 'text_delivery', 'historical_complete'];

function parseTwoStage(msg) {
  const m = /^\[TwoStage\] (\{.*?\}); estimatedTokenBudget/.exec(msg);
  if (!m) return null;
  try { const s = JSON.parse(m[1]); return { screened: num(s.screened), detailed: num(s.detailed), failed: num(s.failed), unassessed: num(s.unassessed), awaitingDetail: num(s.awaitingDetail), isRateLimited: Boolean(s.isRateLimited) }; } catch { return null; }
}
function parseAnalysisOnly(msg) {
  const m = /^\[AnalysisOnly\] finished in ([\d.]+)s\. screened=(\d+), detailed=(\d+), failed=(\d+), telegram=(\d+)/.exec(msg);
  return m ? { seconds: +m[1], screened: +m[2], detailed: +m[3], failed: +m[4], telegram: +m[5] } : null;
}
function parseCycle(msg) {
  const m = /^Monitoring cycle finished in ([\d.]+)s\. New articles: (\d+), Events: (\d+), Telegram alerts: (\d+)/.exec(msg);
  return m ? { seconds: +m[1], articles: +m[2], events: +m[3], telegram: +m[4] } : null;
}

export function buildOpsHealth({ now = Date.now(), lastPollTime = null, logs = [], youtube = null, ko = null, config = {} } = {}) {
  const issues = [];
  const sorted = [...logs].filter(l => l && l.timestamp && typeof l.message === 'string').sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const since = t => sorted.filter(l => Date.parse(l.timestamp) >= now - t);

  // 뉴스 수집
  const pollAgeH = lastPollTime ? (now - Date.parse(lastPollTime)) / H : null;
  if (pollAgeH == null || pollAgeH > 26) issues.push('뉴스 수집이 26시간 넘게 실행되지 않음');
  const cycleLog = sorted.find(l => l.message.startsWith('Monitoring cycle finished'));
  const reportLog = sorted.find(l => l.message.startsWith('[StatusReport]'));
  const reportText = reportLog ? reportLog.message.replace(/^\[StatusReport\]\s*/, '') : null;
  const reportWarn = reportText && reportText.includes('⚠️') ? reportText.slice(reportText.indexOf('⚠️') + 2).trim() : null;
  if (reportLog && reportLog.level === 'warn' && now - Date.parse(reportLog.timestamp) < 26 * H) issues.push(`아침 상태 보고 경고: ${reportWarn || '내용 확인 필요'}`);

  const runs = [];
  for (const l of since(72 * H)) {
    const t = parseTwoStage(l.message), a = !t && parseAnalysisOnly(l.message);
    if (t) runs.push({ at: l.timestamp, kind: 'two_stage', ...t });
    else if (a) runs.push({ at: l.timestamp, kind: 'analysis_only', ...a });
  }
  const detailedByDay = {};
  for (const r of runs.filter(r => r.kind === 'two_stage')) { const d = kstDay(Date.parse(r.at)); detailedByDay[d] = (detailedByDay[d] || 0) + (r.detailed || 0); }
  const today = kstDay(now), yesterday = kstDay(now - 24 * H);
  if (detailedByDay[today] === 0 && detailedByDay[yesterday] === 0) issues.push('상세 분석 0건이 이틀 연속');
  if (runs.some(r => r.isRateLimited && now - Date.parse(r.at) < 24 * H)) issues.push('Gemini 할당량 초과(최근 24시간)');

  const errors24h = {};
  for (const l of since(24 * H)) if (l.level === 'error') errors24h[l.module || 'unknown'] = (errors24h[l.module || 'unknown'] || 0) + 1;
  const schedulerErrors = errors24h.Scheduler || 0;
  if (schedulerErrors) issues.push(`정기 실행 오류 ${schedulerErrors}건(최근 24시간)`);

  // 유튜브
  let yt = null;
  if (youtube) {
    const recent = Object.values(youtube.videos || {})
      .filter(r => (r.firstSeen || 0) >= now - 72 * H && !(r.programmes || []).some(p => (config.disabledProgrammes || []).includes(p)))
      .sort((a, b) => (b.firstSeen || 0) - (a.firstSeen || 0))
      .map(r => ({ id: r.video?.id || null, programmes: r.programmes || [], publishedAt: r.video?.publishedAt || null, firstSeen: r.firstSeen || null, stage: r.stage || null, hold: r.hold || null, summaryFailure: r.summaryFailure || null }));
    const failed = recent.filter(r => r.stage === 'text_review_required' || /expired|failed/.test(r.stage || ''));
    if (failed.length) issues.push(`유튜브 요약 실패/보류 ${failed.length}건`);
    const iso = new Date(now).toISOString();
    const b = youtube.budgets || {};
    const textDay = b['text:' + iso.slice(0, 10)] || 0, textMonth = b['text:' + iso.slice(0, 7)] || 0;
    const sd = youtube.supadata || null;
    const ceoMonth = youtube.ceoVideoBudget?.months?.[today.slice(0, 7)] || 0;
    yt = {
      recent, counts: { done: recent.filter(r => DONE.includes(r.stage)).length, active: recent.filter(r => ACTIVE.includes(r.stage)).length, failed: failed.length },
      summaryBudget: { todayMicros: textDay, dailyLimitMicros: config.dailySummaryMicros ?? null, monthMicros: textMonth, monthlyLimitMicros: config.monthlySummaryMicros ?? null, monthPct: pct(textMonth, config.monthlySummaryMicros) },
      supadata: sd ? { used: sd.used ?? 0, cycleLimit: config.supadataCycleLimit ?? null, usedPct: pct(sd.used ?? 0, config.supadataCycleLimit), today: sd.days?.[today] ?? 0, dailyLimit: config.supadataDailyLimit ?? null, cycleEnd: sd.end ?? null } : null,
      ceoVideo: { month: ceoMonth, monthlyLimit: config.ceoVideo?.monthlyVideos ?? null },
    };
    if (yt.summaryBudget.monthPct >= 80) issues.push(`유튜브 요약 예산 ${yt.summaryBudget.monthPct}% 사용`);
    if (yt.supadata?.usedPct >= 80) issues.push(`Supadata 사용량 ${yt.supadata.usedPct}%`);
  }

  // CEO 번역·요약 원장
  const ceo = ko ? { state: ko.state ?? null, spentUsd: num(ko.spentUsd), limitUsd: num(ko.limitUsd), usedPct: pct(num(ko.spentUsd) + (num(ko.outstandingUsd) || 0), num(ko.limitUsd)) } : null;
  if (ceo?.usedPct >= 80) issues.push(`CEO 번역 원장 ${ceo.usedPct}% 사용`);

  return {
    generatedAt: new Date(now).toISOString(), ok: issues.length === 0, issues,
    news: {
      lastPollTime, pollAgeHours: pollAgeH == null ? null : Math.round(pollAgeH * 10) / 10,
      lastCycle: cycleLog ? { at: cycleLog.timestamp, ...parseCycle(cycleLog.message) } : null,
      lastStatusReport: reportLog ? { at: reportLog.timestamp, level: reportLog.level, warning: reportWarn, text: reportText.slice(0, 600) } : null,
      analysisRuns: runs.slice(0, 12), detailedByDay, errors24h,
    },
    youtube: yt, ceo,
  };
}
