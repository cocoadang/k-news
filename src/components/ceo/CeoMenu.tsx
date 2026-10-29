import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CeoApiResponse } from '../../ceo/types';
import { fetchCeoDataset, requestCeoRefresh } from '../../ceo/dataSource';
import { CeoStatementsView, CeoViewState } from './CeoStatementsView';
import { CeoTimeline } from './timeline/CeoTimelineCandidate';
import { CeoKoAdmin } from './CeoKoAdmin';

/** CEO 메뉴 컨테이너: 읽기 전용 API 조회 → 화면 상태. 관리자에게만 원문 새로고침 버튼 */
export function CeoMenu({ isAdmin }: { isAdmin: boolean }) {
  const [api, setApi] = useState<CeoApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 늦게 도착한 옛 응답이 새 결과를 덮지 않도록: 요청마다 번호를 매기고 가장 최근 요청의 응답만 반영
  const seq = useRef(0);
  const accept = (n: number, r: CeoApiResponse) => { if (n === seq.current) setApi(r); };
  const load = useCallback(async () => {
    const n = ++seq.current;
    setError(null);
    try { accept(n, await fetchCeoDataset()); }
    catch (e) { if (n === seq.current) setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true); setNotice(null);
    try {
      const r = await requestCeoRefresh();
      if (r.status === 401 || r.status === 403) setNotice('관리자 인증이 필요합니다.');
      else if (r.status === 429) setNotice(r.body?.error || '잠시 후 다시 시도하세요.');
      else if (!r.ok) setNotice(r.body?.error || `새로고침 실패 (HTTP ${r.status})`);
      // 새로고침 결과가 있을 때만 번호를 올려 그 이전에 시작된 조회 응답을 무효화. 결과가 없으면(401 등) 진행 중 조회는 그대로 반영
      if (r.body && 'status' in r.body && r.body.status) { const n = ++seq.current; setError(null); accept(n, r.body); }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const state: CeoViewState = error ? { status: 'error', message: error }
    : !api ? { status: 'loading' }
    : api.status === 'not_loaded' ? { status: 'not_loaded', message: api.message || '공식 출처 원문을 아직 불러오지 않았습니다.' }
    : !api.dataset ? { status: 'error', message: api.message || '공식 출처를 읽지 못했습니다.', sources: api.sources }
    : { status: 'ready', dataset: api.dataset, source: { status: api.status, refreshedAt: api.refreshedAt, sources: api.sources, message: api.message, historyDurable: api.historyDurable, withdrawnCount: api.withdrawnCount, koSummary: api.koSummary } };

  return (
    <div>
      {/* 관리자 전용 제어 영역: 조건부 렌더링 (비관리자 방문자에게는 렌더링하지 않음) */}
      {isAdmin && (
        <section aria-label="CEO 발언 관리자 영역" className="mb-5 rounded-2xl border border-cyan-800/60 bg-cyan-950/20 p-4" data-testid="ceo-admin-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-bold text-cyan-200 flex items-center gap-1.5">
              <span aria-hidden="true">🔒</span> CEO 발언 관리자 영역
            </h3>
            <button type="button" onClick={onRefresh} disabled={refreshing}
              className="min-h-[40px] rounded-lg border border-cyan-700 bg-cyan-950 px-3 text-sm font-semibold text-cyan-100 hover:border-cyan-500 hover:bg-cyan-900 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400">
              {refreshing ? '공식 원문 불러오는 중…' : '공식 원문 새로고침 (관리자)'}
            </button>
          </div>
          {notice && <p role="status" className="mb-3 text-sm font-medium text-amber-200">{notice}</p>}
          {api?.dataset && api.koSummary && (
            <CeoKoAdmin info={api.koSummary} statements={api.dataset.statements} onChanged={load} />
          )}
        </section>
      )}
      {state.status === 'ready' ? <><p className="mb-3 text-sm text-slate-400">저장된 자료의 일부 출처 또는 발언일이 미확인일 수 있습니다. 자료 부족은 발언 부재를 의미하지 않습니다.</p><CeoTimeline dataset={state.dataset} /><details className="mt-6"><summary className="cursor-pointer text-slate-400">기존 목록과 수집 상태 보기</summary><CeoStatementsView state={state} onRetry={load} isAdmin={isAdmin} /></details></> : <CeoStatementsView state={state} onRetry={load} isAdmin={isAdmin} />}
    </div>
  );
}
