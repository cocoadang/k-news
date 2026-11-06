// 매일 아침 수집 뒤 관리자(TELEGRAM_CHAT_ID)에게만 보내는 상태 보고. 이상이 있을 때만 발송(statusHasIssue). 순수 함수(테스트 가능).
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = n => Number.isFinite(n) ? `$${n.toFixed(3)}` : '?';

export function statusHasIssue(text){return /⚠️/.test(String(text));}
export function buildStatusReport({ date, now = Date.now(), poll = {}, analysis = null, ceoStatus = '', headline = null, ko = null, youtube = null }) {
  const warn = [];
  const a = analysis || {};
  if (poll.error) warn.push(`뉴스 수집 실패: ${poll.error}`);
  if (analysis && a.detailed === 0 && (a.awaitingDetail || 0) > 0) warn.push('상세 분석 0건');
  if (analysis && a.failed > 0) warn.push(`분석 실패 ${a.failed}건`);
  if (analysis?.isRateLimited) warn.push('Gemini 할당량 초과');
  const lines = [`📊 <b>미국주식 모니터링 · ${esc(date)} 아침 점검</b>`, ''];
  lines.push(`<b>뉴스</b> 새 기사 ${poll.articles ?? 0} · 새 사건 ${poll.events ?? 0} · ${poll.elapsed ?? '?'}초`);
  if (analysis) lines.push(`   분석: 간단 ${a.screened ?? 0} · 상세 ${a.detailed ?? 0} · 알림 ${poll.telegram ?? 0} · 남은 미평가 ${a.unassessed ?? 0} · 상세 대기 ${a.awaitingDetail ?? 0}`);
  // 유튜브: 최근 36시간에 처음 본 영상
  if (youtube) {
    const recent = Object.values(youtube.videos || {}).filter(r => (r.firstSeen || 0) >= now - 36 * 3600_000 && !(r.programmes || []).includes('crypto'));
    const sent = recent.filter(r => ['sent', 'text_delivery'].includes(r.stage));
    const waiting = recent.filter(r => ['text_waiting', 'text_summary', 'supadata_inflight', 'vidiq_inflight', 'text_summary_inflight'].includes(r.stage));
    const failed = recent.filter(r => r.stage === 'text_review_required' || /expired|failed/.test(r.stage || ''));
    lines.push(`<b>유튜브</b> 요약 완료 ${sent.length} · 대기 ${waiting.length} · 실패/보류 ${failed.length}`);
    for (const r of failed.slice(0, 3)) lines.push(`   · ${esc(String(r.video?.title || r.video?.id).slice(0, 40))} — ${esc(r.summaryFailure || r.captionFailure || r.hold || r.stage)}`);
    if (failed.length) warn.push(`유튜브 요약 실패/보류 ${failed.length}건`);
    const day = new Date(now).toISOString().slice(0, 10);
    const cv = youtube.ceoVideoBudget?.days?.[new Date(now + 9 * 3600_000).toISOString().slice(0, 10)] ?? 0;
    lines.push(`   요약 예약 오늘 ${usd((youtube.budgets?.['text:' + day] || 0) / 1e6)} · 자막(Supadata) 이번 주기 ${youtube.supadata?.used ?? 0}건 · CEO 영상 오늘 ${cv}건`);
  }
  lines.push(`<b>CEO</b> 공식 원문 ${esc(ceoStatus || '미실행')}` + (headline ? ` · 헤드라인 번역 +${headline.translated ?? 0}${headline.pending ? ` (대기 ${Math.max(0, headline.pending - (headline.translated || 0))})` : ''}` : ''));
  if (headline?.stoppedReason && !/^꺼짐$/.test(headline.stoppedReason) && headline.pending) warn.push(`헤드라인 번역 중단: ${headline.stoppedReason}`);
  if (ko) lines.push(`<b>비용</b> CEO 번역·요약 이번 달 ${usd(ko.spentUsd)} / ${usd(ko.limitUsd)}`);
  lines.push('', warn.length ? `⚠️ ${warn.map(esc).join(' · ')}` : '✅ 이상 없음');
  return lines.join('\n');
}
