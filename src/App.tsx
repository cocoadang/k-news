import { YoutubeMenu } from './components/YoutubeMenu';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { CompanyTabs } from './components/CompanyTabs';
import { FilterBar } from './components/FilterBar';
import { EventCard } from './components/EventCard';
import { EventDetailModal } from './components/EventDetailModal';
import { TelegramPreviewModal } from './components/TelegramPreviewModal';
import { SettingsModal } from './components/SettingsModal';
import { AdminLoginModal } from './components/AdminLoginModal';
import { CeoMenu } from './components/ceo/CeoMenu';
import { NewsEvent, SystemStatus, MonitorSettings, NewsCategory, CompanyProfile, AuthStatus } from './types';
import { Sparkles, Newspaper, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function App() {
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
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [minImportance, setMinImportance] = useState<number>(0);
  const [selectedImpact, setSelectedImpact] = useState<string>('all');
  const [onlyTelegramSent, setOnlyTelegramSent] = useState<boolean | null>(null);

  // Modals
  const [detailEvent, setDetailEvent] = useState<NewsEvent | null>(null);
  const [previewTelegramEvent, setPreviewTelegramEvent] = useState<NewsEvent | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Toast Notification
  // 상단 메뉴: 뉴스 피드 / CEO 발언 (CEO 발언은 읽기 전용 API /api/ceo/dataset, 예시 데이터 대체 없음)
  const [mainView, setMainView] = useState<'news' | 'ceo' | 'youtube'>('news');
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

  const fetchEvents = useCallback(async () => {
    const data = await safeFetchJson<NewsEvent[]>('/api/events');
    if (data && Array.isArray(data)) {
      setEvents(data);
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
    fetchStatus();
    fetchEvents();
    fetchCompanies();

    const interval = setInterval(() => {
      fetchStatus();
      fetchEvents();
    }, 12000);

    return () => clearInterval(interval);
  }, [fetchAuthStatus, fetchStatus, fetchEvents, fetchCompanies]);

  // Handle Login / Logout
  const handleLoginSuccess = () => {
    setAuthStatus({ requiresAuth: true, isAuthenticated: true });
    showToast('관리자 인증이 완료되었습니다!', 'success');
    fetchStatus();
    fetchSettings();
    fetchEvents();
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
        if (res.status === 401 || handlePotentialAuthError(res, data)) {
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
      await fetchEvents();
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
            prev.map((e) => (e.id === id ? { ...e, isSentToTelegram: true, sentAt: new Date().toISOString() } : e))
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
        return;
      }
      const contentType = res.headers.get('content-type');
      if (res.ok && contentType && contentType.includes('application/json')) {
        const saved = await res.json();
        setSettings(saved);
        showToast('설정이 성공적으로 저장되었습니다!');
        await fetchStatus();
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      showToast(errorMsg, 'error');
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
  const filteredEvents = events.filter((e) => {
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

    // 2. Category Filter
    if (selectedCategory !== 'all' && e.category !== selectedCategory) {
      return false;
    }

    // 3. Importance Filter
    // 상세 분석 전 기사는 importance가 0이므로, 간단 평가(잠정) 점수도 함께 반영합니다.
    // 카드에는 "간단 평가 N★"로 잠정 점수임이 표시됩니다.
    if (minImportance > 0) {
      const provisionalScore = e.analysisStatus !== 'completed' ? (e.screening?.score ?? 0) : 0;
      const effectiveImportance = Math.max(e.importance || 0, provisionalScore);
      if (effectiveImportance < minImportance) {
        return false;
      }
    }

    // 4. Impact Filter
    if (selectedImpact !== 'all' && e.impact !== selectedImpact) {
      return false;
    }

    // 5. Telegram Filter
    if (onlyTelegramSent !== null && e.isSentToTelegram !== onlyTelegramSent) {
      return false;
    }

    // 6. Search query
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      const matchTitle = e.title.toLowerCase().includes(q) || e.originalTitle.toLowerCase().includes(q);
      const matchBullets = e.summaryBulletPoints.some((b) => b.toLowerCase().includes(q));
      const matchCompanies = e.relatedCompanies?.some((c) => c.toLowerCase().includes(q));
      const matchImpacts = e.companyImpacts?.some((ci) => ci.companyName.toLowerCase().includes(q) || ci.rationale.toLowerCase().includes(q));
      const matchBiz = e.relatedBusinesses.some((b) => b.toLowerCase().includes(q));
      const matchSource = e.primarySource.name.toLowerCase().includes(q);
      if (!matchTitle && !matchBullets && !matchCompanies && !matchImpacts && !matchBiz && !matchSource) {
        return false;
      }
    }
    return true;
  });

  const sortedAndFilteredEvents = useMemo(() => {
    return [...filteredEvents].sort((a, b) => {
      const timeA = new Date(a.primarySource?.publishedAt || a.firstSeenAt).getTime();
      const timeB = new Date(b.primarySource?.publishedAt || b.firstSeenAt).getTime();
      const safeA = isNaN(timeA) || timeA <= 0 ? new Date(a.updatedAt || 0).getTime() || 0 : timeA;
      const safeB = isNaN(timeB) || timeB <= 0 ? new Date(b.updatedAt || 0).getTime() || 0 : timeB;
      return safeB - safeA;
    });
  }, [filteredEvents]);

  const categoriesList: NewsCategory[] = [
    'IPO / 주식',
    '기업가치 / 자금조달',
    '실적 / 재무',
    'AI 가속기 / 반도체',
    'AI 모델 / Agent',
    '클라우드 / 데이터센터',
    '자율주행 / Robotaxi',
    'Starship / 우주인프라',
    'Starlink / 통신',
    '국방 / 정부계약',
    '규제 / 반독점',
    '에너지 / 배터리',
    '공급망 / CAPEX',
    '경쟁사 / 시장점유율',
    '기타',
  ];

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white font-sans">
      
      {/* Toast Banner */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-5 duration-200">
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
        isPolling={isPolling}
        onManualPoll={handleManualPoll}
        onOpenSettings={() => {
          setIsSettingsOpen(true);
          if (authStatus.isAuthenticated) {
            fetchSettings();
          }
        }}
        onOpenLogin={() => setIsLoginModalOpen(true)}
        onLogout={handleLogout}
        hideManualPoll={mainView !== 'news'}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6">

        <nav className="mb-4 flex gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1" aria-label="주 메뉴">
          {([['news', '뉴스 피드'], ['ceo', 'CEO 발언'], ['youtube', '유튜브 요약']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-current={mainView === key ? 'page' : undefined}
              onClick={() => setMainView(key)}
              className={`flex-1 sm:flex-none min-h-[40px] rounded-lg px-4 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                mainView === key ? 'bg-cyan-700 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </nav>

        {mainView === 'youtube' ? (<YoutubeMenu isAdmin={!!authStatus?.isAuthenticated} onLogin={() => setIsLoginModalOpen(true)} />) : mainView === 'ceo' ? (
          <CeoMenu isAdmin={!!authStatus?.isAuthenticated} />
        ) : (<>
        {/* Multi-Company Tab Bar (Scrollable chips) */}
        <CompanyTabs
          companies={companies}
          selectedCompany={selectedCompany}
          onSelectCompany={setSelectedCompany}
          events={events}
        />

        {/* Filter and Search Bar */}
        <FilterBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          minImportance={minImportance}
          setMinImportance={setMinImportance}
          selectedImpact={selectedImpact}
          setSelectedImpact={setSelectedImpact}
          onlyTelegramSent={onlyTelegramSent}
          setOnlyTelegramSent={setOnlyTelegramSent}
          categories={categoriesList}
          totalResults={sortedAndFilteredEvents.length}
          onResetFilters={() => {
            setSearchQuery('');
            setSelectedCategory('all');
            setMinImportance(0);
            setSelectedImpact('all');
            setOnlyTelegramSent(null);
            setSelectedCompany('all');
          }}
        />

        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-300" role="status">
          현재 불러온 {events.length}건 기준 · 상세 분석 완료 {events.filter(e => e.analysisStatus === 'completed' || (!e.analysisStatus && e.importance > 0)).length}건
          {' · '}간단 평가 완료 {events.filter(e => e.screening && e.analysisStatus !== 'completed').length}건
          {' · '}미평가 {events.filter(e => !e.screening && (e.analysisStatus === 'pending' || e.analysisStatus === 'failed' || (!e.analysisStatus && !e.importance))).length}건
          {' · '}상세 분석 대기 {events.filter(e => e.screening && e.analysisStatus === 'pending').length}건
          {' · '}실패 {events.filter(e => e.analysisStatus === 'failed').length}건
          <p className="mt-1 text-slate-500">간단 평가 점수는 잠정치입니다. 미평가·상세 분석 대기는 낮은 중요도나 분석 제외를 뜻하지 않습니다.</p>
        </div>

        {/* Events Feed */}
        {sortedAndFilteredEvents.length === 0 ? (
          <div className="py-12 text-center bg-slate-900/50 rounded-2xl border border-slate-800 p-6">
            <Newspaper className="w-8 h-8 text-slate-500 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-slate-300">
              선택한 기업 및 조건에 맞는 뉴스가 없습니다.
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
              다른 기업 탭을 선택하거나 [새로고침] 버튼을 눌러 최신 뉴스를 확인해 보세요.
            </p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {sortedAndFilteredEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onSendTelegram={handleSendTelegram}
                onReanalyze={handleReanalyze}
                onPreviewTelegram={(evt) => setPreviewTelegramEvent(evt)}
                onOpenDetail={(evt) => setDetailEvent(evt)}
              />
            ))}
          </div>
        )}
        </>)}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 bg-slate-950/60 py-4 text-xs text-slate-500 text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Investment Intelligence Monitor · Multi-Company AI Intelligence Platform</span>
          <span className="text-[11px] text-slate-400">
            감시 대상: SpaceX · Alphabet/Google · Tesla · Microsoft · NVIDIA & 주요 글로벌 경제지
          </span>
        </div>
      </footer>

      {/* Modals */}
      {detailEvent && (
        <EventDetailModal
          event={detailEvent}
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

      {isSettingsOpen && (
        <SettingsModal
          settings={settings}
          companies={companies}
          onClose={() => setIsSettingsOpen(false)}
          onSave={handleSaveSettings}
          onSaveCompany={handleSaveCompany}
          onDeleteCompany={handleDeleteCompany}
          onCompaniesUpdated={(newCompanies) => setCompanies(newCompanies)}
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
