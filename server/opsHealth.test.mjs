import test from 'node:test'; import assert from 'node:assert/strict';
import { buildOpsHealth } from './opsHealth.mjs';
const now = Date.parse('2026-11-01T00:20:00Z'); // 09:20 KST
const at = h => new Date(now - h * 3600_000).toISOString();
const config = { disabledProgrammes: ['crypto'], dailySummaryMicros: 260000, monthlySummaryMicros: 2000000, supadataCycleLimit: 90, supadataDailyLimit: 6, ceoVideo: { monthlyVideos: 15 } };

test('healthy morning: no issues, counts parsed, no raw messages leaked', () => {
  const logs = [
    { timestamp: at(2.3), level: 'info', module: 'Scheduler', message: '[StatusReport] 📊 아침 점검 | 뉴스 새 기사 160 | ✅ 이상 없음' },
    { timestamp: at(2.4), level: 'success', module: 'Scheduler', message: 'Monitoring cycle finished in 180.6s. New articles: 160, Events: 148, Telegram alerts: 0.' },
    { timestamp: at(2.5), level: 'info', module: 'Gemini', message: '[TwoStage] {"screened":40,"detailed":4,"failed":0,"unassessed":10,"awaitingDetail":20,"isRateLimited":false,"completedEventIds":["a"]}; estimatedTokenBudget=1. x' },
    { timestamp: at(26), level: 'info', module: 'Gemini', message: '[TwoStage] {"screened":30,"detailed":5,"failed":0}; estimatedTokenBudget=1. x' },
    { timestamp: at(1), level: 'warn', module: 'System', message: 'Unauthorized Admin API access attempt from 1.2.3.4' },
  ];
  const youtube = { videos: { a: { video: { id: 'aSXBm4bNsas', publishedAt: 1 }, programmes: ['bullbear'], stage: 'sent', firstSeen: now - 12 * 3600_000 }, c: { video: { id: 'x' }, programmes: ['crypto'], stage: 'text_review_required', firstSeen: now } },
    budgets: { 'text:2026-11-01': 20000, 'text:2026-11': 20000 }, supadata: { used: 12, days: { '2026-11-01': 1 } }, ceoVideoBudget: { months: { '2026-11': 1 } } };
  const r = buildOpsHealth({ now, lastPollTime: at(2.3), logs, youtube, ko: { state: 'on', spentUsd: 0, limitUsd: 1 }, config });
  assert.equal(r.ok, true, r.issues.join());
  assert.equal(r.news.lastCycle.articles, 160);
  assert.equal(r.news.detailedByDay['2026-11-01'], 4);
  assert.equal(r.youtube.recent.length, 1);
  assert.equal(r.youtube.supadata.usedPct, 13.3);
  assert.ok(!JSON.stringify(r).includes('1.2.3.4'));
  assert.ok(!JSON.stringify(r).includes('completedEventIds'));
});

test('flags stale poll, warn report, two days without detailed analysis, YouTube hold and budgets ≥80%', () => {
  const logs = [
    { timestamp: at(30), level: 'warn', module: 'Scheduler', message: '[StatusReport] 뉴스 | ⚠️ 상세 분석 0건' },
    { timestamp: at(2), level: 'info', module: 'Gemini', message: '[TwoStage] {"screened":40,"detailed":0,"failed":0}; estimatedTokenBudget=1.' },
    { timestamp: at(26), level: 'info', module: 'Gemini', message: '[TwoStage] {"screened":40,"detailed":0,"failed":0}; estimatedTokenBudget=1.' },
    { timestamp: at(3), level: 'error', module: 'Scheduler', message: 'Cloud Scheduler /api/jobs/poll execution failed: boom' },
  ];
  const youtube = { videos: { b: { video: { id: 'b' }, programmes: ['wallstreet'], stage: 'text_review_required', hold: 'summary_outcome_unknown', firstSeen: now - 3600_000 } },
    budgets: { 'text:2026-11': 1700000 }, supadata: { used: 75 } };
  const r = buildOpsHealth({ now, lastPollTime: at(30), logs, youtube, ko: { spentUsd: 0.9, limitUsd: 1 }, config });
  assert.equal(r.ok, false);
  for (const re of [/26시간/, /상세 분석 0건이 이틀/, /정기 실행 오류 1건/, /유튜브 요약 실패\/보류 1건/, /요약 예산 85%/, /Supadata 사용량 83.3%/, /CEO 번역 원장 90%/]) assert.ok(r.issues.some(i => re.test(i)), re.source);
  assert.ok(!r.issues.some(i => /아침 상태 보고/.test(i)), 'report older than 26h is not re-flagged');
});
