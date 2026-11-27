import { AdminOperations } from './components/AdminOperations';
import { startVisiblePolling } from './screenPolling';
import { YoutubeMenu } from './components/YoutubeMenu';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Header } from './components/Header';
import { CompanyTabs } from './components/CompanyTabs';
import { FilterBar } from './components/FilterBar';
import { EventCard } from './components/EventCard';
import { buildIssueFlows, groupNewsFeed } from './newsFeed';
import { EventDetailModal } from './components/EventDetailModal';
import { TelegramPreviewModal } from './components/TelegramPreviewModal';
import { AdminSettings as SettingsModal } from './components/AdminSettings';
import { AdminLoginModal } from './components/AdminLoginModal';
import { CeoMenu } from './components/ceo/CeoMenu';
import { StrategyMenu } from './components/StrategyMenu';
import { SystemHealthMenu } from './components/SystemHealthMenu';
import { useLang } from './i18n';
import { NewsEvent, SystemStatus, MonitorSettings, CompanyProfile, AuthStatus } from './types';
import { Sparkles, Newspaper, AlertCircle, CheckCircle2, PlaySquare, MessagesSquare, TrendingUp, Landmark } from 'lucide-react';

export default function App() {
  const { t } = useLang();
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<MonitorSettings | null>(null);
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [isPolling, setIsPolling] = useState(false);

  // Multi-Company Tab State
  const [selectedCompany, setSelectedCompany] = useState<string>('all');

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [detailEvent, setDetailEvent] = useState<NewsEvent | null>(null);
  const [previewTelegramEvent, setPreviewTelegramEvent] = useState<NewsEvent | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [viewVersion,setViewVersion]=useState(0);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Toast Notification
  // 상단 메뉴: 뉴스 피드 / CEO 발언 (CEO 발언은 읽기 전용 API /api/ceo/dataset, 예시 데이터 대체 없음)
  const [mainView, setMainView] = useState<'news' | 'ceo' | 'youtube' | 'strategy' | 'system'>('youtube');
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Safe fetch helper (Relies solely on secure HttpOnly cookies; no stored secrets or bypass headers)
  const safeFetchJson = async <T,>(url: string, options?: RequestInit): Promise<T | null> => {
    try {
      const res = await fetch(url, {
        credentials: 'include',
        ...options,
        headers: {
          ...(options?.headers || {}),
        },
      });
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        return null;
      }
      if (!res.ok) {
        if (res.status === 401) {
          setAuthStatus(prev => ({ ...prev, isAuthenticated: false }));
          // Do NOT automatically pop up login modal on background polling / safeFetchJson
        }
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      console.warn(`Request to ${url} warning:`, err);
      return null;
    }
  };

  // Check 401 on responses and trigger login for deliberate user actions
  const handlePotentialAuthError = (res: Response, errData?: { error?: string }) => {
    if (res.status === 401) {
      setAuthStatus(prev => ({ requiresAuth: true, isAuthenticated: false }));
      setIsLoginModalOpen(true);
      showToast('관리자 인증이 필요합니다. 로그인해주세요.', 'info');
      return true;
    }
    return false;
  };

  // Fetch Data Handlers
  const fetchAuthStatus = useCallback(async () => {
    const data = await safeFetchJson<AuthStatus>('/api/auth/status');
    if (data) {
      setAuthStatus(data);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    const data = await safeFetchJson<SystemStatus>('/api/status');
    if (data) {
      setStatus(data);
    }
  }, []);

  // 평소에는 CDN·서버 캐시본, 관리자 작업 직후에는 fresh로 바로 새 목록
  // 방금 재분석·전송한 건은 2분 동안 화면의 새 값을 유지(캐시된 목록이 잠시 옛 값을 줄 수 있음)
  const pinnedRef = useRef(new Map<string, { at: number; event: NewsEvent }>());
  const pinEvent = (event: NewsEvent) => { pinnedRef.current.set(event.id, { at: Date.now(), event }); };
  const fetchEvents = useCallback(async (fresh = false) => {
    const data = await safeFetchJson<NewsEvent[]>(fresh ? `/api/events?fresh=${Date.now()}` : '/api/events');
    if (data && Array.isArray(data)) {
      const pins = pinnedRef.current, now = Date.now();
      for (const [id, p] of pins) if (now - p.at > 120_000) pins.delete(id);
      setEvents(pins.size ? data.map(e => pins.get(e.id)?.event ?? e) : data);
    }
  }, []);

  const fetchCompanies = useCallback(async () => {
    const data = await safeFetchJson<CompanyProfile[]>('/api/companies');
    if (data && Array.isArray(data)) {
      setCompanies(data);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    const data = await safeFetchJson<MonitorSettings>('/api/settings');
    if (data) {
      setSettings(data);
    }
  }, []);

  // Initial Load: Clean up historical secrets and fetch public views only
  // (Do NOT fetch /api/settings or /api/logs prior to authentication)
  useEffect(() => {
    try {
      localStorage.removeItem('admin_secret');
    } catch {
      // ignore
    }

    fetchAuthStatus();
    fetchCompanies();
  }, [fetchAuthStatus, fetchCompanies]);

  // Only refresh data used by the visible screen. Hidden tabs do no polling;
  // returning to a screen refreshes immediately, including after sleep/resume.
  useEffect(() => {
    if (mainView !== 'news' && !isSettingsOpen) return;
    const refresh = () => {
      if (mainView === 'news' || isSettingsOpen) void fetchEvents();
      if (isSettingsOpen) void fetchStatus();
    };
    return startVisiblePolling(refresh);
  }, [mainView, isSettingsOpen, fetchStatus, fetchEvents]);

  // Handle Login / Logout
  const handleLoginSuccess = () => {
    setAuthStatus({ requiresAuth: true, isAuthenticated: true });
    showToast('관리자 인증이 완료되었습니다!', 'success');
    fetchStatus();
    fetchSettings();
    fetchEvents(true);
    fetchCompanies();
  };

  const handleLogout = async () => {
    try {
      try {
        localStorage.removeItem('admin_secret');
      } catch {
        // ignore
      }
      await fetch('/api/auth/logout', { 
        method: 'POST', 
        credentials: 'include' 
      });
      setAuthStatus({ requiresAuth: true, isAuthenticated: false });
      setIsSettingsOpen(false);setSettings(null);
      showToast('로그아웃되었습니다.', 'info');
    } catch {
      // ignore
    }
  };

  // Manual Trigger
  const handleManualPoll = async () => {
    setIsPolling(true);
    showToast('5대 핵심 기업 최신 뉴스 수집 및 Gemini 3.7 Flash 다중 기업 교차 분석을 시작합니다...', 'info');
    try {
      const res = await fetch('/api/poll', { 
        method: 'POST', 
        credentials: 'include' 
      });
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (handlePotentialAuthError(res, data)) {
          return;
        }
        if (data.success) {
          showToast(`수집 완료! 신규 기사: ${data.newArticlesCount}건, 분석 및 통합 사건: ${data.newEventsCreated?.length || 0}건`);
        } else {
          showToast(data.error || '수집 중 오류가 발생했습니다.', 'error');
        }
      } else {
        if (handlePotentialAuthError(res)) return;
        showToast('서버 응답을 처리할 수 없습니다.', 'error');
      }
      await fetchEvents(true);
      await fetchStatus();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(errorMsg, 'error');
    } finally {
      setIsPolling(false);
    }
  };

  // Re-analyze single event
  const handleReanalyze = async (id: string) => {
    showToast('Gemini 3.7 Flash 모델로 다중 기업 교차 영향을 재분석 중입니다...', 'info');
    try {
      const res = await fetch(`/api/events/${id}/reanalyze`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      const contentType = res.headers.get('content-type');
      if (res.status === 401 || handlePotentialAuthError(res)) {
        return;
      }
      if (res.ok && contentType && contentType.includes('application/json')) {
        const updated = await res.json();
        pinEvent(updated);
        setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)));
        if (detailEvent?.id === id) setDetailEvent(updated);
        showToast('다중 기업 교차 AI 재분석이 완료되었습니다!');
      } else {
        showToast('재분석에 실패했습니다.', 'error');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(errorMsg, 'error');
    }
  };

  // Send Event to Telegram
  const handleSendTelegram = async (id: string) => {
    try {
      const res = await fetch(`/api/events/${id}/send-telegram`, { 
        method: 'POST', 
        credentials: 'include' 
      });
      const contentType = res.headers.get('content-type');
      if (res.status === 401 || handlePotentialAuthError(res)) {
        return;
      }
      if (contentType && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.success) {
          showToast('Telegram으로 투자 인텔리전스 알림이 성공적으로 전송되었습니다!');
          setEvents((prev) =>
            prev.map((e) => {
              if (e.id !== id) return e;
              const sent = { ...e, isSentToTelegram: true, sentAt: new Date().toISOString() };
              pinEvent(sent);
              return sent;
            })
          );
          if (previewTelegramEvent?.id === id) {
            setPreviewTelegramEvent(null);
          }
          await fetchStatus();
        } else {
          showToast(data.error || 'Telegram 전송 실패. 설정에서 Bot Token 및 Chat ID를 확인해주세요.', 'error');
        }
      } else {
        showToast('서버 응답 오류로 Telegram 전송을 완료하지 못했습니다.', 'error');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(errorMsg, 'error');
    }
  };

  // Save Settings
  const handleSaveSettings = async (updated: Partial<MonitorSettings>) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.status === 401 || handlePotentialAuthError(res)) {
        throw new Error('관리자 인증이 필요합니다.');
      }
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        const saved = await res.json();
        setSettings(saved);
        showToast('설정이 성공적으로 저장되었습니다!');
        await fetchStatus();
      } else {
        throw new Error('설정을 저장하지 못했습니다. 다시 확인해 주세요.');
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(errorMsg, 'error');
      throw err;
    }
  };

  // Save Company Profile
  const handleSaveCompany = async (company: CompanyProfile): Promise<void> => {
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(company),
      });
      if (res.status === 401 || handlePotentialAuthError(res)) {
        throw new Error('관리자 인증이 필요합니다.');
      }
      if (res.ok) {
        const updatedList = await res.json();
        setCompanies(updatedList);
        showToast(`[${company.name}] 기업 설정이 업데이트되었습니다.`);
        await fetchStatus();
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `저장 실패 (HTTP ${res.status})`);
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(errorMsg, 'error');
      throw err;
    }
  };

  // Delete Company Profile
  const handleDeleteCompany = async (companyId: string): Promise<void> => {
    const prevCompanies = companies;
    const optimisticList = companies.filter((c) => c.id !== companyId);
    setCompanies(optimisticList);
    if (selectedCompany === companyId) {
      setSelectedCompany('all');
    }

    try {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.status === 401 || handlePotentialAuthError(res)) {
        setCompanies(prevCompanies);
        throw new Error('관리자 인증이 필요합니다.');
      }
      if (res.ok) {
        const updatedList: CompanyProfile[] = await res.json();
        setCompanies(updatedList);
        showToast('기업 프로필이 성공적으로 삭제되었습니다.');
        await fetchStatus();
      } else {
        setCompanies(prevCompanies);
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `삭제 실패 (HTTP ${res.status})`);
      }
    } catch (err: unknown) {
      setCompanies(prevCompanies);
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(errorMsg, 'error');
      throw err;
    }
  };

  // Filtered Events
  const newsFeed = useMemo(() => groupNewsFeed(events), [events]);
  const issueFlows = useMemo(() => buildIssueFlows(newsFeed), [newsFeed]);
  const filteredEvents = newsFeed.filter((e) => {
    // 1. Company Filter
    if (selectedCompany !== 'all') {
      const target = selectedCompany.toLowerCase();
      const inRelated = e.relatedCompanies?.some((c) =>
        c.toLowerCase().includes(target) ||
        (target === 'googl' && c.toLowerCase().includes('google')) ||
        (target === 'tsla' && c.toLowerCase().includes('tesla')) ||
        (target === 'msft' && c.toLowerCase().includes('microsoft')) ||
        (target === 'nvda' && c.toLowerCase().includes('nvidia')) ||
        (target === 'spacex' && c.toLowerCase().includes('spacex'))
      );
      const inImpacts = e.companyImpacts?.some((ci) =>
        ci.companyId.toLowerCase() === target || ci.companyName.toLowerCase().includes(target)
      );
      if (!inRelated && !inImpacts) {
        return false;
      }
    }

    // Search query
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = e.title.toLowerCase().includes(q) || e.originalTitle?.toLowerCase().includes(q) || e.titleKo?.toLowerCase().includes(q);
      const matchBullets = e.summaryBulletPoints.some((b) => b.toLowerCase().includes(q));
      const matchCompanies = e.relatedCompanies?.some((c) => c.toLowerCase().includes(q));
      const matchImpacts = e.companyImpacts?.some((ci) => ci.companyName.toLowerCase().includes(q) || ci.rationale.toLowerCase().includes(q));
      const matchBiz = e.relatedBusinesses.some((b) => b.toLowerCase().includes(q));
      const matchSource = [e.primarySource, ...(e.relatedSources || [])].some(source =>
        source.name.toLowerCase().includes(q) || source.title?.toLowerCase().includes(q));
      if (!matchTitle && !matchBullets && !matchCompanies && !matchImpacts && !matchBiz && !matchSource) {
        return false;
      }
    }
    return true;
  });


  return (
    <div className="flex min-h-screen flex-col bg-[#090d16] pb-[var(--main-nav-space)] font-sans text-slate-100 selection:bg-cyan-500 selection:text-white [--main-nav-space:calc(60px_+_env(safe-area-inset-bottom,0px))]">
      
      {/* Toast Banner */}
      {toast && (
        <div className="fixed bottom-[calc(var(--main-nav-space)_+_12px)] right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl border text-xs font-semibold backdrop-blur-md ${
            toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-700 text-emerald-200' :
            toast.type === 'error' ? 'bg-rose-950/90 border-rose-700 text-rose-200' :
            'bg-slate-900/90 border-slate-700 text-cyan-200'
          }`}>
            {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {toast.type === 'info' && <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />}
            <span>{toast.text}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <Header
        authStatus={authStatus}
        onOpenSettings={() => {
            if(!authStatus?.isAuthenticated){setIsLoginModalOpen(true);return;}
          setIsSettingsOpen(true);
          if (authStatus.isAuthenticated) {
            fetchSettings();
          }
        }}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
      />

      <nav className="fixed inset-x-0 bottom-0 z-40 h-[var(--main-nav-space)] border-t border-slate-800 bg-[#0b1220]" aria-label={t('주 메뉴', 'Main menu')}>
        <div className="mx-auto grid h-[59px] max-w-7xl grid-cols-5 gap-0.5 px-2 py-1 sm:gap-1 sm:px-6 lg:px-8">
          {([
            ['youtube', t('유튜브 요약', 'YouTube'), PlaySquare],
            ['news', t('뉴스 피드', 'News'), Newspaper],
            ['ceo', t('CEO 발언', 'CEO Quotes'), MessagesSquare],
            ['strategy', t('나스닥 전략', 'Nasdaq Strategy'), TrendingUp],
            ['system', t('미국 시스템', 'US System'), Landmark],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              aria-current={mainView === key ? 'page' : undefined}
              onClick={() => {
                if (key === mainView) return;
                setMainView(key);
                window.scrollTo({top: 0, behavior: 'instant'});
              }}
              className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-0.5 text-center text-[11px] font-semibold leading-tight break-keep focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:text-xs ${
                mainView === key ? 'bg-cyan-950 text-cyan-200' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6">
        {mainView === 'youtube' ? (<YoutubeMenu key={viewVersion} isAdmin={false} onLogin={() => setIsLoginModalOpen(true)} />) : mainView === 'ceo' ? (
          <CeoMenu key={viewVersion} isAdmin={false} />
        ) : mainView === 'strategy' ? (
          <StrategyMenu key={viewVersion} />
        ) : mainView === 'system' ? (
          <SystemHealthMenu />
        ) : (<>
        <div className="news-filters mb-3 flex min-w-0 flex-col gap-2 sm:mb-4 sm:flex-row sm:items-center sm:gap-3">
          <CompanyTabs companies={companies} selectedCompany={selectedCompany} onSelectCompany={setSelectedCompany} events={events} />
          <FilterBar searchQuery={searchQuery} setSearchQuery={setSearchQuery} />
        </div>

        {/* Events Feed */}
        {filteredEvents.length === 0 ? (
          <div className="py-12 text-center bg-slate-900/50 rounded-2xl border border-slate-800 p-6">
            <Newspaper className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-300">
              {t('선택한 기업 및 조건에 맞는 뉴스가 없습니다.', 'No news matches the selected company and filters.')}
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              {t('다른 기업이나 검색 조건을 선택해 보세요.', 'Try another company or search filter.')}
            </p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {filteredEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                hasIssueFlow={issueFlows.has(event.id)}
                onOpenDetail={(evt) => setDetailEvent(evt)}
              />
            ))}
          </div>
        )}
        </>)}

      </main>

      {/* Modals */}
      {detailEvent && (
        <EventDetailModal
          event={newsFeed.find(event => event.id === detailEvent.id) ?? detailEvent}
          issueFlow={issueFlows.get(detailEvent.id)}
          onClose={() => setDetailEvent(null)}
          onSendTelegram={handleSendTelegram}
          onReanalyze={handleReanalyze}
          onPreviewTelegram={(evt) => setPreviewTelegramEvent(evt)}
        />
      )}

      {previewTelegramEvent && (
        <TelegramPreviewModal
          event={previewTelegramEvent}
          onClose={() => setPreviewTelegramEvent(null)}
          onSend={handleSendTelegram}
        />
      )}

      {isSettingsOpen && authStatus?.isAuthenticated && (
        <SettingsModal
          settings={settings}
          companies={companies}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
          onSaveCompany={handleSaveCompany}
          onDeleteCompany={handleDeleteCompany}
          onCompaniesUpdated={(newCompanies) => setCompanies(newCompanies)}
          operations={<AdminOperations onPoll={handleManualPoll} polling={isPolling} onRefresh={()=>{setViewVersion(v=>v+1);fetchEvents(true);fetchStatus();fetchCompanies();}} onLogout={handleLogout} events={events} onSendNews={handleSendTelegram} onReanalyze={handleReanalyze}/>}
        />
      )}

      {/* Admin Login Modal */}
      <AdminLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />

    </div>
  );
}
