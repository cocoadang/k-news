import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CeoApiResponse } from '../../ceo/types';
import { fetchCeoDataset, requestCeoRefresh } from '../../ceo/dataSource';
import type { CeoViewState } from './CeoStatementsView';
import { CeoTimeline } from './timeline/CeoTimelineCandidate';
import { CeoKoAdmin } from './CeoKoAdmin';
import { RefreshButton, CollectButton } from '../ui';
import { useLang } from '../../i18n';

let lastPublicDataset: { api: CeoApiResponse; fetchedAt: number } | undefined;

/** CEO 메뉴 컨테이너: 읽기 전용 API 조회 → 화면 상태. 관리자에게만 원문 새로고침 버튼 */
export function CeoMenu({ isAdmin,adminToolsOnly=false }: { isAdmin: boolean;adminToolsOnly?:boolean }) {
  const { t } = useLang();
  const [api, setApi] = useState<CeoApiResponse | null>(() => !isAdmin && lastPublicDataset
    && Date.now() - lastPublicDataset.fetchedAt < 120_000 ? lastPublicDataset.api : null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 늦게 도착한 옛 응답이 새 결과를 덮지 않도록: 요청마다 번호를 매기고 가장 최근 요청의 응답만 반영
  const seq = useRef(0);
  const accept = (n: number, r: CeoApiResponse) => { if (n === seq.current) setApi(r); };
  const load = useCallback(async () => {
    const n = ++seq.current;
    setError(null);
    try {
      const response = await fetchCeoDataset();
      if (!isAdmin && n === seq.current && response.dataset && response.status !== 'not_loaded') {
        lastPublicDataset = { api: response, fetchedAt: Date.now() };
      }
      accept(n, response);
    }
    catch (e) { if (n === seq.current) setError(e instanceof Error ? e.message : String(e)); }
  }, [isAdmin]);
  useEffect(() => {
    void load();
    return () => { seq.current++; };
  }, [load]);

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

  const state: CeoViewState = error && !api?.dataset ? { status: 'error', message: error }
    : !api ? { status: 'loading' }
    : api.status === 'not_loaded' ? { status: 'not_loaded', message: api.message || '공식 출처 원문을 아직 불러오지 않았습니다.' }
    : !api.dataset ? { status: 'error', message: api.message || '공식 출처를 읽지 못했습니다.', sources: api.sources }
    : { status: 'ready', dataset: api.dataset, source: { status: api.status, refreshedAt: api.refreshedAt, sources: api.sources, message: api.message, historyDurable: api.historyDurable, withdrawnCount: api.withdrawnCount, koSummary: api.koSummary } };

  // 기존 목록·번역 관리 화면은 공식 수집 자료(spokenAt·evidence 보유)만 다룹니다.
  // 보도 헤드라인·영상 발언은 타임라인 전용이라 여기로 넘기면 화면 전체가 멈춥니다.
  const legacyStatements = (api?.dataset?.statements || []).filter(isLegacyStatement);

  if(adminToolsOnly)return isAdmin?<section aria-label="CEO 발언 관리자 영역" data-testid="ceo-admin-panel"><p className="mb-3 text-sm text-slate-400">공식 원문과 번역은 정기 실행에서 수집합니다.</p><div className="flex flex-wrap gap-2"><CollectButton onClick={onRefresh} busy={refreshing} label="공식 원문 수집"/><RefreshButton onClick={load}/></div>{notice&&<p role="status" className="mt-3 text-sm text-cyan-300">{notice}</p>}{api?.koSummary&&<details className="mt-4"><summary className="cursor-pointer text-sm text-slate-400">한국어 번역 관리</summary><CeoKoAdmin info={api.koSummary} statements={legacyStatements} onChanged={load}/></details>}</section>:null;

  return (
    <div>
      {state.status === 'ready' ? (
        <SectionBoundary label={t('CEO 발언 타임라인', 'CEO timeline')}>
          <CeoTimeline dataset={state.dataset} />
        </SectionBoundary>
      ) : state.status === 'loading' ? (
        <p role="status" className="py-2 text-sm text-slate-400">
          {t('발언 이력을 불러오는 중…', 'Loading statement history…')}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 py-2 text-sm text-slate-300">
          <p role="status">{state.status === 'not_loaded'
            ? t('아직 표시할 발언 이력이 없습니다.', 'No statement history is available yet.')
            : t('발언 이력을 불러오지 못했습니다.', 'Could not load statement history.')}</p>
          <button type="button" onClick={load} className="min-h-11 rounded-lg border border-slate-700 px-3 text-cyan-200 hover:bg-slate-800">
            {t('다시 시도', 'Retry')}
          </button>
        </div>
      )}

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
