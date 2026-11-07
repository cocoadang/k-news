import { XConnectPanel } from './XConnectPanel';
import React, { useState, useEffect } from 'react';
import { 
  X, 
  Save, 
  Plus, 
  Trash2, 
  Sliders, 
  Shield, 
  Building2,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Pin,
  RotateCcw,
  History,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { MonitorSettings, NewsCategory, CompanyProfile } from '../types';

interface SettingsModalProps {
  settings: MonitorSettings | null;
  companies: CompanyProfile[];
  onClose: () => void;
  onSave: (updated: Partial<MonitorSettings>) => Promise<void>;
  onSaveCompany: (company: CompanyProfile) => Promise<void>;
  onDeleteCompany: (companyId: string) => Promise<void>;
  onCompaniesUpdated?: (companies: CompanyProfile[]) => void;
}

const ALL_CATEGORIES: NewsCategory[] = [
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

const cleanTag = (tag: string, maxLen = 20): string => {
  if (!tag || typeof tag !== 'string') return '';
  const clean = tag.trim().replace(/^[-•*#\d.]+\s*/, '').replace(/[.:;]+$/, '').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen).trim() : clean;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  companies,
  onClose,
  onSave,
  onSaveCompany,
  onDeleteCompany,
  onCompaniesUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'companies' | 'filters'>('companies');
  
  // Local form states
  const [minImportance, setMinImportance] = useState(settings?.minImportance ?? 3);
  const [autoSendTelegram, setAutoSendTelegram] = useState(settings?.autoSendTelegram ?? true);
  const [autoAnalyzeWithGemini, setAutoAnalyzeWithGemini] = useState(settings?.autoAnalyzeWithGemini ?? true);
  const [weeklyCompanyRenewalEnabled, setWeeklyCompanyRenewalEnabled] = useState(settings?.weeklyCompanyRenewalEnabled ?? true);
  const [enabledCategories, setEnabledCategories] = useState<NewsCategory[]>(settings?.enabledCategories || ALL_CATEGORIES);

  // Company management state
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(companies[0]?.id || 'nvda');
  const [deletingCompanyId, setDeletingCompanyId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAddingCompany, setIsAddingCompany] = useState(false);
  const [newCompany, setNewCompany] = useState<Partial<CompanyProfile>>({
    id: '',
    name: '',
    ticker: '',
    color: '#06b6d4',
    searchKeywords: [],
    coreBusinesses: [],
    importantKeywords: [],
    lowImportanceKeywords: [],
    enabled: true,
  });
  const [newKeywordInput, setNewKeywordInput] = useState('');
  const [newFocusInput, setNewFocusInput] = useState('');

  const [isSaving, setIsSaving] = useState(false);
  const [isSuggestingNew, setIsSuggestingNew] = useState(false);
  const [isRefreshingExisting, setIsRefreshingExisting] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Keep selectedCompanyId pointing to a valid company
  useEffect(() => {
    if (companies.length > 0 && !companies.some(c => c.id === selectedCompanyId)) {
      setSelectedCompanyId(companies[0].id);
      setDeletingCompanyId(null);
    }
  }, [companies, selectedCompanyId]);

  const activeCompany = companies.find(c => c.id === selectedCompanyId);

  const jsonHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };


  // AI Keyword Suggestion for New Company
  const handleSuggestForNewCompany = async () => {
    if (!newCompany.name?.trim()) return;
    setIsSuggestingNew(true);
    setAiFeedback(null);
    try {
      const companyName = newCompany.name.trim();
      const ticker = newCompany.ticker?.trim() || undefined;

      const res = await fetch('/api/companies/suggest-keywords', {
        method: 'POST',
        headers: jsonHeaders,
        credentials: 'include',
        body: JSON.stringify({ companyName, ticker }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '키워드 추천 요청에 실패했습니다.');
      }

      const data = await res.json();
      const generatedId = (ticker || companyName).toLowerCase().replace(/[^a-z0-9]/g, '');

      const cleanSuggestedBusinesses = (Array.isArray(data.coreBusinesses) ? data.coreBusinesses : [])
        .map((b: string) => cleanTag(String(b), 20))
        .filter(Boolean)
        .slice(0, 4);

      const cleanSuggestedKeywords = (Array.isArray(data.searchKeywords) ? data.searchKeywords : [])
        .map((k: string) => cleanTag(String(k), 30))
        .filter(Boolean)
        .slice(0, 6);

      const cleanSuggestedImportant = (Array.isArray(data.importantKeywords) ? data.importantKeywords : [])
        .map((k: string) => cleanTag(String(k), 20))
        .filter(Boolean)
        .slice(0, 6);

      setNewCompany(prev => ({
        ...prev,
        id: prev.id?.trim() ? prev.id : generatedId,
        searchKeywords: cleanSuggestedKeywords.length > 0 
          ? cleanSuggestedKeywords 
          : (prev.searchKeywords || [companyName]).slice(0, 6),
        coreBusinesses: cleanSuggestedBusinesses.length > 0 
          ? cleanSuggestedBusinesses 
          : (prev.coreBusinesses || []).slice(0, 4),
        importantKeywords: cleanSuggestedImportant.length > 0 
          ? cleanSuggestedImportant 
          : [companyName, ticker || '실적', 'CAPEX', 'M&A', '투자'].slice(0, 6),
      }));

      setAiFeedback({
        type: 'success',
        text: `[${companyName}] Gemini AI 추천 완료: 검색 키워드 ${cleanSuggestedKeywords.length}/6개, 핵심 사업 ${cleanSuggestedBusinesses.length}/4개가 자동 반영되었습니다.`
      });
      setTimeout(() => setAiFeedback(null), 5000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setAiFeedback({ type: 'error', text: `AI 키워드 추천 실패: ${errorMsg}` });
      setTimeout(() => setAiFeedback(null), 5000);
    } finally {
      setIsSuggestingNew(false);
    }
  };

  // AI Keyword Refresh for Existing Company
  const handleRefreshKeywords = async (comp: CompanyProfile) => {
    if (!comp) return;
    setIsRefreshingExisting(true);
    setAiFeedback(null);
    try {
      const res = await fetch('/api/companies/suggest-keywords', {
        method: 'POST',
        headers: jsonHeaders,
        credentials: 'include',
        body: JSON.stringify({
          companyName: comp.name.trim(),
          ticker: comp.ticker?.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '키워드 최신화 요청에 실패했습니다.');
      }

      const data = await res.json();
      
      // Clean up any historical dummy placeholders and clamp to max lengths
      const existingBusinesses = (comp.coreBusinesses || [])
        .filter(b => b !== '주요 비즈니스' && b !== '전략 사업' && b.trim() !== '')
        .map(b => cleanTag(b, 20))
        .filter(Boolean);
      const existingKeywords = (comp.searchKeywords || [])
        .filter(k => k.trim() !== '')
        .map(k => cleanTag(k, 30))
        .filter(Boolean);

      const freshBusinesses = (Array.isArray(data.coreBusinesses) ? data.coreBusinesses : [])
        .map((b: string) => cleanTag(String(b), 20))
        .filter(Boolean)
        .slice(0, 4);

      const freshSearchKeywords = (Array.isArray(data.searchKeywords) ? data.searchKeywords : [])
        .map((k: string) => cleanTag(String(k), 30))
        .filter(Boolean)
        .slice(0, 6);

      const freshImportant = (Array.isArray(data.importantKeywords) ? data.importantKeywords : [])
        .map((k: string) => cleanTag(String(k), 20))
        .filter(Boolean)
        .slice(0, 6);

      // Smart Replacement: Prioritize fresh AI recommendations first,
      // and only fill remaining capacity with unique previous keywords up to strict limits.
      const mergedSearchKeywords = Array.from(new Set([
        ...freshSearchKeywords,
        ...existingKeywords,
      ])).slice(0, 6);

      const mergedBusinesses = Array.from(new Set([
        ...freshBusinesses,
        ...existingBusinesses,
      ])).slice(0, 4);

      const mergedImportant = Array.from(new Set([
        ...freshImportant,
        ...(comp.importantKeywords || []),
      ])).slice(0, 6);

      const updatedProfile: CompanyProfile = {
        ...comp,
        searchKeywords: mergedSearchKeywords,
        coreBusinesses: mergedBusinesses,
        importantKeywords: mergedImportant,
      };

      await onSaveCompany(updatedProfile);

      setAiFeedback({
        type: 'success',
        text: `[${comp.name}] 최신 트렌드 키워드 갱신 완료! (수집 키워드 ${mergedSearchKeywords.length}/6개, 핵심 사업 ${mergedBusinesses.length}/4개)`
      });
      setTimeout(() => setAiFeedback(null), 5000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setAiFeedback({ type: 'error', text: `AI 키워드 최신화 실패: ${errorMsg}` });
      setTimeout(() => setAiFeedback(null), 5000);
    } finally {
      setIsRefreshingExisting(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      await onSave({
        minImportance,
        autoSendTelegram,
        autoAnalyzeWithGemini,
        weeklyCompanyRenewalEnabled,
        enabledCategories,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleCompany = async (comp: CompanyProfile) => {
    const updated = { ...comp, enabled: !comp.enabled };
    await onSaveCompany(updated);
  };

  const handleToggleWeeklyRenewal = async (comp: CompanyProfile) => {
    const currentVal = comp.autoWeeklyRenewalEnabled !== false;
    await onSaveCompany({ ...comp, autoWeeklyRenewalEnabled: !currentVal });
  };

  const handleTogglePinKeyword = async (comp: CompanyProfile, kw: string) => {
    const currentPins = comp.pinnedSearchKeywords || [];
    const isPinned = currentPins.includes(kw);
    const updatedPins = isPinned
      ? currentPins.filter(k => k !== kw)
      : [...currentPins, kw].slice(0, 6);
    await onSaveCompany({ ...comp, pinnedSearchKeywords: updatedPins });
  };

  const handleTogglePinBusiness = async (comp: CompanyProfile, biz: string) => {
    const currentPins = comp.pinnedCoreBusinesses || [];
    const isPinned = currentPins.includes(biz);
    const updatedPins = isPinned
      ? currentPins.filter(b => b !== biz)
      : [...currentPins, biz].slice(0, 4);
    await onSaveCompany({ ...comp, pinnedCoreBusinesses: updatedPins });
  };

  const handleRollback = async (comp: CompanyProfile, historyId: string) => {
    setIsRollingBack(historyId);
    setAiFeedback(null);
    try {
      const res = await fetch(`/api/companies/${comp.id}/rollback`, {
        method: 'POST',
        headers: jsonHeaders,
        credentials: 'include',
        body: JSON.stringify({
          historyId,
          expectedVersion: comp.version,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || '이전 상태 복원에 실패했습니다.');
      }

      const data = await res.json();
      if (data.companies && typeof onCompaniesUpdated === 'function') {
        onCompaniesUpdated(data.companies);
      }
      setAiFeedback({
        type: 'success',
        text: `[${comp.name}] 선택한 과거 시점의 키워드/비즈니스 상태로 복원되었습니다. (v${data.company?.version || ''})`,
      });
      setTimeout(() => setAiFeedback(null), 5000);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setAiFeedback({
        type: 'error',
        text: `복원 실패: ${errorMsg}`,
      });
      setTimeout(() => setAiFeedback(null), 5000);
    } finally {
      setIsRollingBack(null);
    }
  };

  const handleCreateCompany = async () => {
    if (!newCompany.name?.trim()) return;
    
    const rawId = newCompany.id?.trim() 
      || newCompany.ticker?.trim() 
      || newCompany.name.trim();
    const finalId = rawId.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!finalId) return;

    let searchKeywords = newCompany.searchKeywords && newCompany.searchKeywords.length > 0
      ? newCompany.searchKeywords
      : [];
    let coreBusinesses = newCompany.coreBusinesses && newCompany.coreBusinesses.length > 0
      ? newCompany.coreBusinesses
      : [];
    let importantKeywords = newCompany.importantKeywords && newCompany.importantKeywords.length > 0
      ? newCompany.importantKeywords
      : [];

    // If keywords haven't been generated yet, perform automatic on-the-fly AI fetch
    if (searchKeywords.length === 0 && newCompany.name.trim()) {
      setIsSuggestingNew(true);
      try {
        const res = await fetch('/api/companies/suggest-keywords', {
          method: 'POST',
          headers: jsonHeaders,
          credentials: 'include',
          body: JSON.stringify({
            companyName: newCompany.name.trim(),
            ticker: newCompany.ticker?.trim() || undefined,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.searchKeywords) && data.searchKeywords.length > 0) {
            searchKeywords = data.searchKeywords;
          }
          if (Array.isArray(data.coreBusinesses) && data.coreBusinesses.length > 0) {
            coreBusinesses = data.coreBusinesses;
          }
          if (Array.isArray(data.importantKeywords) && data.importantKeywords.length > 0) {
            importantKeywords = data.importantKeywords;
          }
        }
      } catch {
        // use minimal fallback
        searchKeywords = [newCompany.name.trim()];
        coreBusinesses = [`${newCompany.name.trim()} 주요 사업`];
      } finally {
        setIsSuggestingNew(false);
      }
    }

    if (searchKeywords.length === 0) {
      searchKeywords = [newCompany.name.trim()];
    }
    if (coreBusinesses.length === 0) {
      coreBusinesses = [`${newCompany.name.trim()} 핵심 비즈니스`];
    }
    if (importantKeywords.length === 0) {
      importantKeywords = [newCompany.name.trim(), newCompany.ticker?.trim() || '실적', 'CAPEX', 'M&A', '투자'].filter(Boolean);
    }

    // Sanitize lengths and enforce strict caps
    coreBusinesses = coreBusinesses.map((b: string) => cleanTag(String(b), 20)).filter(Boolean).slice(0, 4);
    searchKeywords = searchKeywords.map((k: string) => cleanTag(String(k), 30)).filter(Boolean).slice(0, 6);
    importantKeywords = importantKeywords.map((k: string) => cleanTag(String(k), 20)).filter(Boolean).slice(0, 6);

    const profile: CompanyProfile = {
      id: finalId,
      name: newCompany.name.trim(),
      ticker: newCompany.ticker?.trim() || '',
      color: newCompany.color || '#06b6d4',
      searchKeywords,
      coreBusinesses,
      importantKeywords,
      lowImportanceKeywords: ['단순 패치', '일상 소식'],
      enabled: true,
    };

    await onSaveCompany(profile);
    setIsAddingCompany(false);
    setSelectedCompanyId(profile.id);
    setNewCompany({
      id: '',
      name: '',
      ticker: '',
      color: '#06b6d4',
      searchKeywords: [],
      coreBusinesses: [],
      importantKeywords: [],
      lowImportanceKeywords: [],
      enabled: true,
    });
  };

  const toggleCategory = (cat: NewsCategory) => {
    if (enabledCategories.includes(cat)) {
      setEnabledCategories(enabledCategories.filter(c => c !== cat));
    } else {
      setEnabledCategories([...enabledCategories, cat]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Sliders className="w-5 h-5 text-cyan-400" />
              모니터링 설정
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              감시 기업 목록, 텔레그램 알림 기준 및 수집 카테고리를 설정합니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation (2 Tabs) */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 gap-3 pt-2">
          <button
            onClick={() => setActiveTab('companies')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'companies'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="w-4 h-4" />
            1. 기업 관리 ({companies.filter(c => c.enabled).length}/{companies.length})
          </button>

          <button
            onClick={() => setActiveTab('filters')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'filters'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4" />
            2. 알림 & 필터 기준
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-sm text-slate-200 flex-1">
          
          {/* TAB 1: COMPANY MANAGEMENT */}
          {activeTab === 'companies' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-400">
                  기업별 On/Off 활성화 및 검색 키워드, 감시 분야를 편집합니다.
                </p>
                <button
                  onClick={() => setIsAddingCompany(!isAddingCompany)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>기업 추가</span>
                </button>
              </div>

              {/* AI Operation Feedback Alert */}
              {aiFeedback && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-center gap-2.5 animate-in fade-in slide-in-from-top-1 duration-200 shadow-lg ${
                    aiFeedback.type === 'success'
                      ? 'bg-cyan-950/90 border-cyan-500/50 text-cyan-200'
                      : 'bg-rose-950/90 border-rose-500/50 text-rose-200'
                  }`}
                >
                  {aiFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span className="flex-1 font-medium leading-relaxed">{aiFeedback.text}</span>
                  <button
                    onClick={() => setAiFeedback(null)}
                    className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Add New Company Form */}
              {isAddingCompany && (
                <div className="bg-slate-950 p-4 rounded-xl border border-cyan-800/60 space-y-3.5 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <div className="font-bold text-xs text-cyan-300 flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5 text-cyan-400" />
                      <span>신규 모니터링 기업 등록</span>
                    </div>

                    {/* AI Auto-Complete Button */}
                    <button
                      type="button"
                      onClick={handleSuggestForNewCompany}
                      disabled={!newCompany.name?.trim() || isSuggestingNew}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold shadow-md transition-all cursor-pointer"
                      title="입력한 기업명과 티커를 분석하여 Gemini AI가 최신 비즈니스 및 고수율 검색 키워드를 자동 추천합니다"
                    >
                      {isSuggestingNew ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-200" />
                          <span>AI 추천 생성 중...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-cyan-200" />
                          <span>AI 추천 생성</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">
                        기업 ID (영문 고유키)
                      </label>
                      <input
                        type="text"
                        placeholder="예: aapl, skhynix"
                        value={newCompany.id || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewCompany((prev) => ({ ...prev, id: val }));
                        }}
                        className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">
                        기업명 <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        placeholder="예: Apple, SK하이닉스"
                        value={newCompany.name || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewCompany((prev) => ({
                            ...prev,
                            name: val,
                            id: (!prev.id || prev.id === prev.name?.toLowerCase().replace(/[^a-z0-9]/g, ''))
                              ? val.toLowerCase().replace(/[^a-z0-9]/g, '')
                              : prev.id,
                          }));
                        }}
                        className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-400 block mb-1">티커 (선택)</label>
                      <input
                        type="text"
                        placeholder="예: AAPL, 000660"
                        value={newCompany.ticker || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNewCompany((prev) => ({ ...prev, ticker: val }));
                        }}
                        className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white font-mono placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* AI Generated Preview (if populated) */}
                  {((newCompany.searchKeywords?.length || 0) > 0 || (newCompany.coreBusinesses?.length || 0) > 0) && (
                    <div className="p-3 bg-slate-900/90 rounded-lg border border-cyan-800/50 space-y-2.5 text-xs animate-in fade-in duration-200">
                      <div className="flex items-center justify-between">
                        <span className="text-cyan-300 font-bold flex items-center gap-1.5 text-[11px]">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                          Gemini AI 추천 키워드 및 비즈니스 (저장 대상)
                        </span>
                        <span className="text-[10px] text-slate-400">
                          검색 {newCompany.searchKeywords?.length || 0}/6개 · 핵심사업 {newCompany.coreBusinesses?.length || 0}/4개
                        </span>
                      </div>
                      {newCompany.searchKeywords && newCompany.searchKeywords.length > 0 && (
                        <div>
                          <span className="text-[10px] text-slate-400 block mb-1">뉴스 검색 키워드 ({newCompany.searchKeywords.length}/6):</span>
                          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                            {newCompany.searchKeywords.map((kw, i) => (
                              <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-800/70 text-cyan-200 text-[10px]">
                                <span>{kw}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewCompany(prev => ({
                                      ...prev,
                                      searchKeywords: (prev.searchKeywords || []).filter((_, idx) => idx !== i)
                                    }));
                                  }}
                                  className="text-cyan-400/60 hover:text-rose-400 cursor-pointer"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {newCompany.coreBusinesses && newCompany.coreBusinesses.length > 0 && (
                        <div>
                          <span className="text-[10px] text-slate-400 block mb-1">핵심 사업/모니터링 분야 ({newCompany.coreBusinesses.length}/4):</span>
                          <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pr-1">
                            {newCompany.coreBusinesses.map((fa, i) => {
                              const displayFa = fa.length > 20 ? fa.slice(0, 20) : fa;
                              return (
                                <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/70 text-emerald-200 text-[10px] max-w-[200px]" title={fa}>
                                  <span className="truncate">{displayFa}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNewCompany(prev => ({
                                        ...prev,
                                        coreBusinesses: (prev.coreBusinesses || []).filter((_, idx) => idx !== i)
                                      }));
                                    }}
                                    className="text-emerald-400/60 hover:text-rose-400 cursor-pointer shrink-0"
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => {
                        setIsAddingCompany(false);
                        setNewCompany({
                          id: '',
                          name: '',
                          ticker: '',
                          color: '#06b6d4',
                          searchKeywords: [],
                          coreBusinesses: [],
                          importantKeywords: [],
                          lowImportanceKeywords: [],
                          enabled: true,
                        });
                      }}
                      className="px-3 py-1.5 text-xs text-slate-400 hover:text-white cursor-pointer"
                    >
                      취소
                    </button>
                    <button
                      onClick={handleCreateCompany}
                      disabled={!newCompany.name?.trim() || isSuggestingNew}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold shadow transition-all cursor-pointer"
                    >
                      {isSuggestingNew && <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />}
                      <span>{isSuggestingNew ? 'AI 추천 분석 중...' : '등록 완료'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Company Selector Pills */}
              <div className="flex flex-wrap gap-2">
                {companies.map((comp) => (
                  <button
                    key={comp.id}
                    onClick={() => {
                      setSelectedCompanyId(comp.id);
                      setDeletingCompanyId(null);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                      selectedCompanyId === comp.id
                        ? 'bg-cyan-950 border-cyan-500 text-cyan-200'
                        : comp.enabled
                        ? 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        : 'bg-slate-950/40 border-slate-800/40 text-slate-500 line-through'
                    }`}
                  >
                    <span 
                      className="w-2 h-2 rounded-full" 
                      style={{ backgroundColor: comp.color || '#3b82f6' }}
                    />
                    <span>{comp.name}</span>
                    <span className={`text-[10px] px-1 rounded ${
                      comp.enabled ? 'bg-slate-800 text-slate-300' : 'bg-rose-950/80 text-rose-300'
                    }`}>
                      {comp.enabled ? 'ON' : 'OFF'}
                    </span>
                  </button>
                ))}
              </div>

              {/* Selected Company Editor Card */}
              {activeCompany && (
                <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: activeCompany.color || '#3b82f6' }}
                      />
                      <span className="font-bold text-white text-sm">{activeCompany.name}</span>
                      {activeCompany.ticker && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono text-cyan-400">
                          {activeCompany.ticker}
                        </span>
                      )}
                      <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400">
                        v{activeCompany.version || 1}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                      {/* AI Keyword Refresh Button */}
                      <button
                        type="button"
                        onClick={() => handleRefreshKeywords(activeCompany)}
                        disabled={isRefreshingExisting}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700/60 hover:border-cyan-400 text-cyan-300 hover:text-cyan-100 text-xs font-semibold shadow-sm transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        title="최신 트렌드와 기업 동향을 바탕으로 검색 키워드 및 주요 비즈니스를 Gemini AI로 재조회하여 최신화합니다"
                      >
                        {isRefreshingExisting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                            <span>AI 최신화 중...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                            <span>AI 키워드 최신화</span>
                          </>
                        )}
                      </button>

                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={activeCompany.enabled}
                          onChange={() => handleToggleCompany(activeCompany)}
                          className="w-4 h-4 accent-cyan-500 rounded"
                        />
                        <span className={activeCompany.enabled ? 'text-cyan-300 font-semibold' : 'text-slate-500'}>
                          {activeCompany.enabled ? '수집 활성화' : '수집 일시정지'}
                        </span>
                      </label>
                      {companies.length > 1 && (
                        deletingCompanyId === activeCompany.id ? (
                          <div className="inline-flex items-center gap-1.5 bg-rose-950/95 border border-rose-800 rounded-lg px-2.5 py-1 text-xs animate-in fade-in duration-150">
                            <span className="text-rose-200 text-[11px] font-medium whitespace-nowrap">정말 삭제할까요?</span>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={async () => {
                                setIsDeleting(true);
                                try {
                                  const targetId = activeCompany.id;
                                  const remaining = companies.filter(c => c.id !== targetId);
                                  if (remaining.length > 0) {
                                    setSelectedCompanyId(remaining[0].id);
                                  }
                                  setDeletingCompanyId(null);
                                  await onDeleteCompany(targetId);
                                } finally {
                                  setIsDeleting(false);
                                }
                              }}
                              className="px-2 py-0.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {isDeleting ? '삭제 중...' : '확인'}
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => setDeletingCompanyId(null)}
                              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] transition-colors cursor-pointer"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeletingCompanyId(activeCompany.id)}
                            className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-900 transition-colors cursor-pointer"
                            title="기업 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Weekly Auto-Renewal Status Bar */}
                  <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={activeCompany.autoWeeklyRenewalEnabled !== false}
                          onChange={() => handleToggleWeeklyRenewal(activeCompany)}
                          className="w-3.5 h-3.5 accent-cyan-500 rounded"
                        />
                        <span className="font-semibold text-slate-200">
                          주간 자동 키워드 갱신 (7일 주기, 주 5회 예산)
                        </span>
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-bold ${
                          activeCompany.autoWeeklyRenewalEnabled !== false
                            ? 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {activeCompany.autoWeeklyRenewalEnabled !== false ? 'ON' : 'OFF'}
                        </span>
                      </label>
                      <div className="flex items-center gap-2 text-[11px] text-slate-400">
                        <span>최근 상태:</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          activeCompany.lastRenewalStatus === 'success'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : activeCompany.lastRenewalStatus === 'rate_limited'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : activeCompany.lastRenewalStatus === 'failed'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : activeCompany.lastRenewalStatus === 'skipped'
                            ? 'bg-slate-800 text-slate-300 border border-slate-700'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {activeCompany.lastRenewalStatus === 'success' ? '정상 갱신' :
                           activeCompany.lastRenewalStatus === 'rate_limited' ? '할당량 제한' :
                           activeCompany.lastRenewalStatus === 'failed' ? '갱신 실패' :
                           activeCompany.lastRenewalStatus === 'skipped' ? '자료부족 유지' : '대기중'}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-500" />
                        <span>마지막 시도: {activeCompany.lastKeywordRenewalAttemptAt ? new Date(activeCompany.lastKeywordRenewalAttemptAt).toLocaleString('ko-KR') : '시도 이력 없음'}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        <span>마지막 성공: {activeCompany.lastKeywordRenewalSuccessAt ? new Date(activeCompany.lastKeywordRenewalSuccessAt).toLocaleString('ko-KR') : '성공 이력 없음'}</span>
                      </div>
                    </div>
                    {activeCompany.lastRenewalReason && (
                      <div className="text-[10px] text-slate-400 bg-slate-950/60 p-1.5 rounded border border-slate-800/40 truncate" title={activeCompany.lastRenewalReason}>
                        ※ 사유: {activeCompany.lastRenewalReason}
                      </div>
                    )}
                  </div>

                  {/* Keywords Tag Editor with Pin Toggle */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[11px] text-slate-400 font-medium">
                          수집 키워드 ({activeCompany.searchKeywords?.length || 0}/6)
                        </label>
                        <span className="text-[10px] text-slate-500">
                          (고정 PIN: {activeCompany.pinnedSearchKeywords?.length || 0}개)
                        </span>
                      </div>
                      {(activeCompany.searchKeywords?.length || 0) >= 6 && (
                        <span className="text-[10px] text-amber-400 font-medium">
                          최대 6개 도달 (기존 태그 삭제 후 추가 가능)
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(activeCompany.searchKeywords || []).map((kw, idx) => {
                        const isPinned = (activeCompany.pinnedSearchKeywords || []).includes(kw);
                        return (
                          <span
                            key={idx}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border transition-colors ${
                              isPinned
                                ? 'bg-amber-950/60 border-amber-600/70 text-amber-200'
                                : 'bg-slate-900 border-slate-800 text-cyan-300'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => handleTogglePinKeyword(activeCompany, kw)}
                              className={`p-0.5 rounded hover:bg-slate-800 cursor-pointer ${
                                isPinned ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'
                              }`}
                              title={isPinned ? '고정 해제 (주간 자동갱신 시 교체 가능)' : '핵심 키워드로 고정 (주간 자동갱신 시 항상 보존)'}
                            >
                              <Pin className={`w-3 h-3 ${isPinned ? 'fill-amber-400 rotate-45' : ''}`} />
                            </button>
                            <span>{kw}</span>
                            {isPinned && <span className="text-[9px] font-bold text-amber-400 bg-amber-950 px-1 rounded">PIN</span>}
                            <button
                              onClick={async () => {
                                const updatedKw = activeCompany.searchKeywords.filter((k) => k !== kw);
                                const updatedPins = (activeCompany.pinnedSearchKeywords || []).filter((k) => k !== kw);
                                await onSaveCompany({
                                  ...activeCompany,
                                  searchKeywords: updatedKw,
                                  pinnedSearchKeywords: updatedPins,
                                });
                              }}
                              className="text-slate-500 hover:text-rose-400 cursor-pointer"
                              title="키워드 삭제"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder={
                          (activeCompany.searchKeywords?.length || 0) >= 6
                            ? "최대 6개까지 등록되었습니다 (기존 태그 삭제 필요)"
                            : "새 검색 키워드 입력 후 Enter..."
                        }
                        value={newKeywordInput}
                        disabled={(activeCompany.searchKeywords?.length || 0) >= 6}
                        onChange={(e) => setNewKeywordInput(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && newKeywordInput.trim()) {
                            if ((activeCompany.searchKeywords?.length || 0) >= 6) {
                              setAiFeedback({
                                type: 'error',
                                text: '수집 키워드는 최대 6개까지만 등록할 수 있습니다.',
                              });
                              setTimeout(() => setAiFeedback(null), 4000);
                              return;
                            }
                            const cleanedKw = cleanTag(newKeywordInput, 30);
                            if (cleanedKw) {
                              if ((activeCompany.searchKeywords || []).includes(cleanedKw)) {
                                setNewKeywordInput('');
                                return;
                              }
                              const updatedKw = [...(activeCompany.searchKeywords || []), cleanedKw].slice(0, 6);
                              await onSaveCompany({ ...activeCompany, searchKeywords: updatedKw });
                            }
                            setNewKeywordInput('');
                          }
                        }}
                        className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      <button
                        disabled={(activeCompany.searchKeywords?.length || 0) >= 6}
                        onClick={async () => {
                          if (newKeywordInput.trim()) {
                            if ((activeCompany.searchKeywords?.length || 0) >= 6) {
                              setAiFeedback({
                                type: 'error',
                                text: '수집 키워드는 최대 6개까지만 등록할 수 있습니다.',
                              });
                              setTimeout(() => setAiFeedback(null), 4000);
                              return;
                            }
                            const cleanedKw = cleanTag(newKeywordInput, 30);
                            if (cleanedKw) {
                              if ((activeCompany.searchKeywords || []).includes(cleanedKw)) {
                                setNewKeywordInput('');
                                return;
                              }
                              const updatedKw = [...(activeCompany.searchKeywords || []), cleanedKw].slice(0, 6);
                              await onSaveCompany({ ...activeCompany, searchKeywords: updatedKw });
                            }
                            setNewKeywordInput('');
                          }
                        }}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded text-slate-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        추가
                      </button>
                    </div>
                  </div>

                  {/* Core Businesses Editor with Pin Toggle */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <label className="text-[11px] text-slate-400 font-medium">
                          주요 감시 비즈니스 분야 ({activeCompany.coreBusinesses?.length || 0}/4)
                        </label>
                        <span className="text-[10px] text-slate-500">
                          (고정 PIN: {activeCompany.pinnedCoreBusinesses?.length || 0}개)
                        </span>
                      </div>
                      {(activeCompany.coreBusinesses?.length || 0) >= 4 && (
                        <span className="text-[10px] text-amber-400 font-medium">
                          최대 4개 도달 (기존 항목 삭제 후 추가 가능)
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(activeCompany.coreBusinesses || []).map((fa, idx) => {
                        const isPinned = (activeCompany.pinnedCoreBusinesses || []).includes(fa);
                        const displayFa = fa.length > 20 ? fa.slice(0, 20) : fa;
                        return (
                          <span
                            key={idx}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border max-w-[240px] transition-colors ${
                              isPinned
                                ? 'bg-amber-950/60 border-amber-600/70 text-amber-200'
                                : 'bg-slate-900 border-slate-800 text-emerald-300'
                            }`}
                            title={fa}
                          >
                            <button
                              type="button"
                              onClick={() => handleTogglePinBusiness(activeCompany, fa)}
                              className={`p-0.5 rounded hover:bg-slate-800 cursor-pointer shrink-0 ${
                                isPinned ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300'
                              }`}
                              title={isPinned ? '고정 해제 (주간 자동갱신 시 교체 가능)' : '핵심 사업으로 고정 (주간 자동갱신 시 항상 보존)'}
                            >
                              <Pin className={`w-3 h-3 ${isPinned ? 'fill-amber-400 rotate-45' : ''}`} />
                            </button>
                            <span className="truncate">{displayFa}</span>
                            {isPinned && <span className="text-[9px] font-bold text-amber-400 bg-amber-950 px-1 rounded shrink-0">PIN</span>}
                            <button
                              onClick={async () => {
                                const updatedFa = activeCompany.coreBusinesses.filter((f) => f !== fa);
                                const updatedPins = (activeCompany.pinnedCoreBusinesses || []).filter((b) => b !== fa);
                                await onSaveCompany({
                                  ...activeCompany,
                                  coreBusinesses: updatedFa,
                                  pinnedCoreBusinesses: updatedPins,
                                });
                              }}
                              className="text-slate-500 hover:text-rose-400 cursor-pointer shrink-0"
                              title="항목 삭제"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        placeholder={
                          (activeCompany.coreBusinesses?.length || 0) >= 4
                            ? "최대 4개까지 등록되었습니다 (기존 항목 삭제 필요)"
                            : "새 감시 분야 입력 (예: Blackwell, Cybercab, Gemini)..."
                        }
                        value={newFocusInput}
                        disabled={(activeCompany.coreBusinesses?.length || 0) >= 4}
                        onChange={(e) => setNewFocusInput(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && newFocusInput.trim()) {
                            if ((activeCompany.coreBusinesses?.length || 0) >= 4) {
                              setAiFeedback({
                                type: 'error',
                                text: '주요 감시 비즈니스 분야는 최대 4개까지만 등록할 수 있습니다.',
                              });
                              setTimeout(() => setAiFeedback(null), 4000);
                              return;
                            }
                            const cleanedFa = cleanTag(newFocusInput, 20);
                            if (cleanedFa && !(activeCompany.coreBusinesses || []).includes(cleanedFa)) {
                              const updatedFa = [...(activeCompany.coreBusinesses || []), cleanedFa].slice(0, 4);
                              await onSaveCompany({ ...activeCompany, coreBusinesses: updatedFa });
                            }
                            setNewFocusInput('');
                          }
                        }}
                        className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-xs text-white disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      <button
                        disabled={(activeCompany.coreBusinesses?.length || 0) >= 4}
                        onClick={async () => {
                          if (newFocusInput.trim()) {
                            if ((activeCompany.coreBusinesses?.length || 0) >= 4) {
                              setAiFeedback({
                                type: 'error',
                                text: '주요 감시 비즈니스 분야는 최대 4개까지만 등록할 수 있습니다.',
                              });
                              setTimeout(() => setAiFeedback(null), 4000);
                              return;
                            }
                            const cleanedFa = cleanTag(newFocusInput, 20);
                            if (cleanedFa && !(activeCompany.coreBusinesses || []).includes(cleanedFa)) {
                              const updatedFa = [...(activeCompany.coreBusinesses || []), cleanedFa].slice(0, 4);
                              await onSaveCompany({ ...activeCompany, coreBusinesses: updatedFa });
                            }
                            setNewFocusInput('');
                          }
                        }}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded text-slate-200 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        추가
                      </button>
                    </div>
                  </div>

                  {/* Weekly Renewal History & Rollback Section */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => setShowHistory(!showHistory)}
                      className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 text-xs text-slate-300 font-semibold border border-slate-800 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <History className="w-3.5 h-3.5 text-cyan-400" />
                        <span>주간 갱신 이력 & 이전값 복원 ({activeCompany.renewalHistory?.length || 0}/10개)</span>
                      </div>
                      {showHistory ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </button>

                    {showHistory && (
                      <div className="mt-2 space-y-2 max-h-60 overflow-y-auto pr-1">
                        {(!activeCompany.renewalHistory || activeCompany.renewalHistory.length === 0) ? (
                          <div className="p-3 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-slate-800/40">
                            아직 주간 갱신 이력이 없습니다. (마지막 시도 후 7일 경과 시 자동 갱신됩니다)
                          </div>
                        ) : (
                          activeCompany.renewalHistory.map((hist) => (
                            <div key={hist.id} className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                    hist.status === 'rolled_back'
                                      ? 'bg-purple-950 text-purple-300 border border-purple-800'
                                      : hist.status === 'success'
                                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                      : 'bg-rose-950 text-rose-300 border border-rose-800'
                                  }`}>
                                    {hist.status === 'rolled_back' ? '복원됨' : hist.status === 'success' ? '갱신 성공' : '실패'}
                                  </span>
                                  <span className="text-[11px] text-slate-400">
                                    {new Date(hist.timestamp).toLocaleString('ko-KR')}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  disabled={isRollingBack === hist.id}
                                  onClick={() => handleRollback(activeCompany, hist.id)}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-cyan-200 text-[10px] font-semibold border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                                  title="이 갱신 이전 상태로 키워드와 비즈니스를 복원합니다 (AI 호출 없음)"
                                >
                                  {isRollingBack === hist.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
                                  ) : (
                                    <RotateCcw className="w-3 h-3 text-cyan-400" />
                                  )}
                                  <span>이전값 복원</span>
                                </button>
                              </div>
                              <p className="text-[11px] text-slate-300 leading-tight">
                                {hist.reason}
                              </p>
                              {(hist.addedKeywords?.length > 0 || hist.removedKeywords?.length > 0 || hist.addedBusinesses?.length > 0 || hist.removedBusinesses?.length > 0) && (
                                <div className="flex flex-wrap gap-1 text-[10px]">
                                  {hist.addedKeywords?.map((k, i) => (
                                    <span key={`+k-${i}`} className="px-1 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">+키워드: {k}</span>
                                  ))}
                                  {hist.removedKeywords?.map((k, i) => (
                                    <span key={`-k-${i}`} className="px-1 py-0.2 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60">-키워드: {k}</span>
                                  ))}
                                  {hist.addedBusinesses?.map((b, i) => (
                                    <span key={`+b-${i}`} className="px-1 py-0.2 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">+사업: {b}</span>
                                  ))}
                                  {hist.removedBusinesses?.map((b, i) => (
                                    <span key={`-b-${i}`} className="px-1 py-0.2 rounded bg-rose-950/80 text-rose-300 border border-rose-800/60">-사업: {b}</span>
                                  ))}
                                </div>
                              )}
                              {hist.evidenceArticleIds?.length > 0 && (
                                <div className="text-[10px] text-slate-500">
                                  근거 뉴스: {hist.evidenceArticleIds.length}건 ({hist.evidenceArticleIds.slice(0, 3).join(', ')}{hist.evidenceArticleIds.length > 3 ? '...' : ''})
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: IMPORTANCE & CATEGORIES */}
          {activeTab === 'filters' && (
            <div className="space-y-5">
              <XConnectPanel />
              {/* Monitoring Frequency Display */}
              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-white uppercase flex items-center gap-1.5">
                    <span>모니터링 주기: 하루 1회</span>
                  </label>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60">
                    1440분 (24시간 주기)
                  </span>
                </div>
                <div className="text-[11px] text-amber-400/90 leading-relaxed font-medium bg-amber-950/20 p-2.5 rounded-lg border border-amber-800/30">
                  ※ Cloud Run 운영환경에서는 Cloud Scheduler 실행 주기를 하루 1회로 설정해야 합니다.
                </div>
                <div className="text-[10px] text-slate-400 mt-1.5">
                  내부 타이머는 ENABLE_INTERNAL_SCHEDULER=true 환경에서만 1440분 주기로 동작합니다.
                </div>
              </div>

              {/* Telegram 5★ Only Policy Banner */}
              <div className="bg-slate-950/70 p-4 rounded-xl border border-rose-900/40">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-white uppercase flex items-center gap-1.5">
                    <span className="text-rose-400">🚨 Telegram 자동 발송 정책</span>
                  </label>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">
                    5★ (★★★★★) 전용
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Telegram 자동 알림은 <b>중요도 5점(★★★★★) 뉴스만 자동 발송</b>됩니다. 1~4점 뉴스는 DB 및 대시보드에 안전하게 보관되며, 필요시 개별 기사에서 수동으로 즉시 발송할 수 있습니다.
                </p>
                <div className="mt-2 text-[10px] text-slate-400 bg-slate-900/60 p-2 rounded border border-slate-800">
                  • 동일 사건/뉴스는 서로 다른 언론사(Reuters, CNBC, Yahoo Finance 등)가 보도해도 사건 지문(Fingerprint) 검증으로 Telegram에 단 1번만 발송됩니다.
                </div>
              </div>

              {/* Telegram Minimum Importance Rating */}
              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-white uppercase">
                    대시보드 주요 뉴스 기준 중요도
                  </label>
                  <span className="text-xs sm:text-sm font-bold text-cyan-400">
                    {minImportance}★ 이상 ({minImportance === 5 ? '5★ 긴급 속보만' : minImportance === 4 ? '4~5★ 주요 뉴스' : minImportance === 3 ? '3~5★ 일반 알림 포함' : '모든 소식'})
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="1"
                  value={minImportance}
                  onChange={(e) => setMinImportance(Number(e.target.value))}
                  className="w-full accent-cyan-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                  <span>1★ (전체)</span>
                  <span>2★</span>
                  <span className="text-cyan-400 font-semibold">3★ (추천 기본값)</span>
                  <span>4★ (주요 뉴스)</span>
                  <span>5★ (🚨긴급 속보)</span>
                </div>
              </div>

              {/* Automation Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center justify-between p-3.5 bg-slate-950/70 rounded-xl border border-slate-800">
                  <div>
                    <div className="text-xs font-bold text-white">자동 텔레그램 발송</div>
                    <div className="text-[11px] text-slate-400">새 중요 뉴스 수집 시 즉시 알림</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoSendTelegram}
                    onChange={(e) => setAutoSendTelegram(e.target.checked)}
                    className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-950/70 rounded-xl border border-slate-800">
                  <div>
                    <div className="text-xs font-bold text-white">Gemini 심층 분석</div>
                    <div className="text-[11px] text-slate-400">다중 기업 교차 영향 자동 도출</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoAnalyzeWithGemini}
                    onChange={(e) => setAutoAnalyzeWithGemini(e.target.checked)}
                    className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-950/70 rounded-xl border border-slate-800 sm:col-span-2">
                  <div>
                    <div className="text-xs font-bold text-white">기업 키워드/비즈니스 주간 자동 갱신</div>
                    <div className="text-[11px] text-slate-400">7일 경과 활성기업 대상 주 5회 한도 자동 갱신 (기본 ON)</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={weeklyCompanyRenewalEnabled}
                    onChange={(e) => setWeeklyCompanyRenewalEnabled(e.target.checked)}
                    className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
                  />
                </div>
              </div>

              {/* News Categories Filter */}
              <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-3">
                  <label className="text-xs font-bold text-white uppercase">
                    수집 대상 카테고리 ({enabledCategories.length}/{ALL_CATEGORIES.length})
                  </label>
                  <div className="flex gap-2 text-[11px]">
                    <button
                      onClick={() => setEnabledCategories([...ALL_CATEGORIES])}
                      className="text-cyan-400 hover:underline cursor-pointer"
                    >
                      모두 선택
                    </button>
                    <span className="text-slate-600">|</span>
                    <button
                      onClick={() => setEnabledCategories(['IPO / 주식', '실적 / 재무', 'AI 가속기 / 반도체', 'AI 모델 / Agent', '자율주행 / Robotaxi', '국방 / 정부계약'])}
                      className="text-slate-400 hover:underline cursor-pointer"
                    >
                      핵심만
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ALL_CATEGORIES.map((cat) => {
                    const isChecked = enabledCategories.includes(cat);
                    return (
                      <label
                        key={cat}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-slate-900 border-cyan-800/70 text-cyan-200'
                            : 'bg-slate-950/40 border-slate-800 text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCategory(cat)}
                          className="w-3.5 h-3.5 accent-cyan-500 rounded"
                        />
                        <span>{cat}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            설정은 저장 즉시 시스템에 반영됩니다.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
            >
              닫기
            </button>
            <button
              onClick={handleSaveSettings}
              disabled={isSaving}
              className="flex items-center px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5 mr-1.5" />
              <span>{isSaving ? '저장 중...' : '설정 저장'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
