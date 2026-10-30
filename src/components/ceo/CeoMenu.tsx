import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CeoApiResponse } from '../../ceo/types';
import { fetchCeoDataset, requestCeoRefresh } from '../../ceo/dataSource';
import { CeoStatementsView, CeoViewState } from './CeoStatementsView';
import { CeoTimeline } from './timeline/CeoTimelineCandidate';
import { CeoKoAdmin } from './CeoKoAdmin';
import { PageHeader, RefreshButton, CollectButton } from '../ui';

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

  // 기존 목록·번역 관리 화면은 공식 수집 자료(spokenAt·evidence 보유)만 다룹니다.
  // 보도 헤드라인·영상 발언은 타임라인 전용이라 여기로 넘기면 화면 전체가 멈춥니다.
  const legacyStatements = (api?.dataset?.statements || []).filter(isLegacyStatement);
  const legacyState: CeoViewState = state.status === 'ready' ? { ...state, dataset: { ...state.dataset, statements: legacyStatements } } : state;

  return (
    <div>
      <PageHeader title="CEO 발언" description="같은 질문에 대한 CEO의 발언을 날짜순으로 보여줍니다. 입장 변화는 자동으로 판단하지 않고, 원문과 수치를 나란히 비교할 수 있게 합니다."
        status={notice || undefined}
        actions={<>{isAdmin && <CollectButton onClick={onRefresh} busy={refreshing} label="공식 원문 수집 (관리자)" />}<RefreshButton onClick={load} /></>} />
      {/* 관리자 전용 제어 영역: 조건부 렌더링 (비관리자 방문자에게는 렌더링하지 않음) */}
      {isAdmin && (
        <section aria-label="CEO 발언 관리자 영역" className="mb-5 rounded-2xl border border-cyan-800/60 bg-cyan-950/20 p-4" data-testid="ceo-admin-panel">
          <h3 className="mb-3 text-sm font-semibold text-cyan-200">CEO 발언 관리자 영역 · 한국어 번역 관리</h3>
          {api?.dataset && api.koSummary && (
            <CeoKoAdmin info={api.koSummary} statements={legacyStatements} onChanged={load} />
          )}
        </section>
      )}
      {state.status === 'ready' ? <><p className="mb-3 text-xs text-slate-500">저장된 자료의 일부 출처 또는 발언일이 미확인일 수 있습니다. 자료 부족은 발언 부재를 의미하지 않습니다.</p><SectionBoundary label="CEO 발언 타임라인"><CeoTimeline dataset={state.dataset} /></SectionBoundary><details className="mt-6"><summary className="cursor-pointer text-sm text-slate-400">기존 목록과 수집 상태 보기</summary><SectionBoundary label="기존 목록"><CeoStatementsView state={legacyState} onRetry={load} isAdmin={isAdmin} /></SectionBoundary></details></> : <CeoStatementsView state={state} onRetry={load} isAdmin={isAdmin} />}
    </div>
  );
}

export function isLegacyStatement(s: any): boolean {
  return !!s && typeof s.spokenAt === 'object' && s.spokenAt !== null && Array.isArray(s.evidence) && !['reported_headline', 'reported_excerpt', 'video_quote'].includes(s.kind);
}

/** 한 영역에서 오류가 나도 페이지 전체가 하얗게 멈추지 않도록 그 영역만 안내문으로 바꿉니다. */
class SectionBoundary extends React.Component<{ label: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('[CeoMenu]', this.props.label, e); }
  render() {
    return this.state.failed
      ? <p role="alert" className="rounded-lg border border-amber-700 bg-amber-950/30 p-4 text-amber-200">{this.props.label}을(를) 표시하지 못했습니다. 다른 영역은 계속 이용할 수 있습니다.</p>
      : this.props.children;
  }
}
