import React, { useId, useState } from 'react';
import { CeoStatement, KoSummaryInfo } from '../../ceo/types';
import { postKoOne, postKoSettings } from '../../ceo/dataSource';

const btn = 'min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm font-semibold text-slate-200 hover:border-slate-500 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400';
const usd = (v: number | null | undefined) => (v === null || v === undefined ? '?' : `$${v.toFixed(v < 0.01 ? 4 : 2)}`);
const STATE: Record<KoSummaryInfo['state'], string> = {
  off: '꺼짐', on: '켜짐', limit_reached: '월 한도 도달', halted: '중지됨(확인 필요)', config_unverified: '요금 설정 미확인', unknown: '상태 확인 불가',
};

/**
 * 관리자 전용 CEO 한국어 요약 제어 (기존 관리자 인증 API만 사용, 일반 사용자에게는 렌더링하지 않음).
 * - 켜기·끄기, 월 한도(USD 0~1) 저장. 저장 완료·실패 표시
 * - 저장된 검증 발언 1건 선택 → 비용 설명 확인 체크 → 1회 실행. 진행 중 중복 클릭 차단, 응답 불명은 자동 재시도 없음
 * - 검토 번역이 있는 발언은 '초기 검증 override'를 명시적으로 고를 때만 실행 가능
 */
export function CeoKoAdmin({ info, statements, onChanged }: { info?: KoSummaryInfo; statements: CeoStatement[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'settings' | 'one' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [limit, setLimit] = useState<string>(info?.limitUsd !== null && info?.limitUsd !== undefined ? String(info.limitUsd) : '1');
  const [sel, setSel] = useState<string>('');
  const [override, setOverride] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const panelId = useId();
  const chosen = statements.find(s => s.statementId === sel);
  const reviewed = chosen?.translationKo?.status === 'reviewed';
  const hasSummary = chosen?.koSummary?.status === 'ready';

  const save = async (body: { enabled?: boolean; limitUsd?: number }) => {
    if (busy) return;
    setBusy('settings'); setMsg(null);
    try {
      const r = await postKoSettings(body);
      setMsg(r.ok ? '저장 완료' : `저장 실패 (HTTP ${r.status})${r.body?.error ? `: ${r.body.error}` : ''}`);
      if (r.ok) onChanged();
    } catch (e) {
      setMsg(`저장 결과를 확인하지 못했습니다(자동 재시도 안 함): ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBusy(null); }
  };
  const runOne = async () => {
    if (busy || !chosen || !confirmed || (reviewed && !override)) return;
    setBusy('one'); setMsg(null);
    try {
      const r = await postKoOne({ statementId: chosen.statementId, overrideReviewed: reviewed ? override : undefined });
      const rep = r.body?.report;
      setMsg(r.ok && rep
        ? `실행 결과: 유료 생성 ${rep.calls}회 · 정산 ${rep.settled} · 결과 불명 ${rep.uncertain} · 캐시 ${rep.cacheHits}${rep.stoppedReason ? ` · 중단 사유: ${rep.stoppedReason}` : ''}`
        : `실행 실패 (HTTP ${r.status})${r.body?.error ? `: ${r.body.error}` : ''}`);
      onChanged();
    } catch (e) {
      setMsg(`응답을 받지 못했습니다. 비용이 발생했을 수 있어 자동 재시도하지 않습니다. 새로고침 후 예약·확정 금액을 확인하세요. (${e instanceof Error ? e.message : String(e)})`);
    } finally { setBusy(null); setConfirmed(false); }
  };
  const limitNum = Number(limit);
  const limitOk = limit.trim() !== '' && Number.isFinite(limitNum) && limitNum >= 0 && limitNum <= 1;

  return (
    <div className="mb-3 rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-200" data-testid="ko-admin">
      <button type="button" className={btn} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}>
        {open ? '▾' : '▸'} AI 한국어 요약 설정 (관리자)
      </button>
      <div id={panelId} hidden={!open} className="mt-3 space-y-3">
        <p data-testid="ko-admin-status">
          현재: <strong>{info ? STATE[info.state] : '원장 미연결'}</strong>
          {info && <> · {info.month}(UTC 기준 월) · 확정 비용 {usd(info.spentUsd)} · 확인 대기 예약 {usd(info.outstandingUsd)} · 월 한도 {usd(info.limitUsd)}</>}
        </p>
        <p className="text-[13px] text-slate-400">확정 비용은 정산된 실제 사용량, 확인 대기 예약은 결과가 확정되지 않아 한도에서 미리 빼 둔 최대 금액입니다. 한도는 USD 1을 넘을 수 없습니다.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} disabled={!!busy || info?.enabled === true} onClick={() => save({ enabled: true })}>켜기</button>
          <button type="button" className={btn} disabled={!!busy || info?.enabled === false} onClick={() => save({ enabled: false })}>끄기</button>
          <label className="flex items-center gap-1">월 한도 USD
            <input type="number" min={0} max={1} step={0.01} value={limit} onChange={e => setLimit(e.target.value)}
              className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100" aria-label="월 한도 USD (0~1)" />
          </label>
          <button type="button" className={btn} disabled={!!busy || !limitOk} onClick={() => save({ limitUsd: limitNum })}>한도 저장</button>
          {!limitOk && <span className="text-amber-200">0~1 사이 숫자만 가능합니다.</span>}
        </div>
        <fieldset className="space-y-2 border-t border-slate-800 pt-3">
          <legend className="font-semibold">저장된 검증 발언 1건만 한국어 요약 실행</legend>
          <select value={sel} onChange={e => { setSel(e.target.value); setOverride(false); setConfirmed(false); }} aria-label="요약할 발언 선택"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100">
            <option value="">발언 선택…</option>
            {statements.filter(s => s.kind === 'direct_quote' && s.verification?.status === 'verified').map(s => (
              <option key={s.statementId} value={s.statementId}>
                {s.evidence[0]?.sourceName.slice(0, 40)} · “{(s.quoteText || '').slice(0, 50)}”{s.translationKo?.status === 'reviewed' ? ' (검토 번역 있음)' : ''}{s.koSummary?.status === 'ready' ? ' (요약 있음)' : ''}
              </option>
            ))}
          </select>
          {reviewed && (
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
              <span>이 발언은 검토 번역이 있어 기본적으로 호출하지 않습니다. 초기 검증용으로 명시적으로 실행합니다.</span>
            </label>
          )}
          {hasSummary && <p className="text-slate-400">이미 요약이 있어 실행해도 호출하지 않습니다(캐시).</p>}
          <p className="text-[13px] text-amber-200">실행하면 Gemini 유료 호출이 최대 1회(토큰 계수 요청 1회 별도) 발생할 수 있습니다. 1건 최대 예약은 약 $0.003이며 월 한도 안에서만 실행됩니다. 결과가 불명확하면 예약을 유지하고 다시 호출하지 않습니다.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} disabled={!chosen} onChange={e => setConfirmed(e.target.checked)} data-testid="ko-confirm" />
            <span>비용 발생 가능성을 확인했습니다(1회 실행).</span>
          </label>
          <button type="button" className={btn} disabled={!!busy || !chosen || !confirmed || (reviewed && !override)} onClick={runOne}>
            {busy === 'one' ? '실행 중…' : '1건 실행'}
          </button>
        </fieldset>
        {msg && <p role="status" className="text-amber-100" data-testid="ko-admin-msg">{msg}</p>}
      </div>
    </div>
  );
}
