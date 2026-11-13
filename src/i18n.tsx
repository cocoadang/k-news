import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * 화면 문구 한/영 전환.
 * - 처음 방문: 휴대폰·브라우저 언어가 한국어면 한글, 그 외에는 영어
 * - 우측 상단 전환 버튼으로 바꾸면 이 기기에 기억(localStorage)
 * - 기사·요약·발언 같은 수집 콘텐츠는 번역하지 않습니다(화면 문구만).
 */
export type Lang = 'ko' | 'en';
const STORAGE_KEY = 'knews.lang';

let currentLang: Lang = 'ko';
/** React 밖(날짜 포맷 등)에서 쓰는 현재 언어 */
export const getLang = (): Lang => currentLang;
/** 한/영 문구 고르기 (React 밖에서도 사용 가능) */
export const tr = (ko: string, en: string) => (currentLang === 'ko' ? ko : en);

export function detectLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch { /* 저장소를 못 쓰면 브라우저 언어로 */ }
  if (typeof navigator === 'undefined') return 'ko';
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return String(langs[0] || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

interface LangCtx { lang: Lang; setLang: (l: Lang) => void }
const Ctx = createContext<LangCtx>({ lang: 'ko', setLang: () => {} });

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (currentLang = typeof window === 'undefined' ? 'ko' : detectLang()));
  currentLang = lang;
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((l: Lang) => {
    currentLang = l;
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* 무시 */ }
    setLangState(l);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang() {
  const { lang, setLang } = useContext(Ctx);
  const t = useCallback((ko: string, en: string) => (lang === 'ko' ? ko : en), [lang]);
  return { lang, setLang, t, locale: lang === 'ko' ? 'ko-KR' : 'en-US' };
}

/** 뉴스 카테고리(저장값은 한국어) → 표시 이름 */
const CATEGORY_EN: Record<string, string> = {
  'IPO / 주식': 'IPO / Stock',
  '기업가치 / 자금조달': 'Valuation / Funding',
  '실적 / 재무': 'Earnings / Financials',
  'AI 가속기 / 반도체': 'AI Accelerators / Chips',
  'AI 모델 / Agent': 'AI Models / Agents',
  '클라우드 / 데이터센터': 'Cloud / Data Centers',
  '자율주행 / Robotaxi': 'Autonomy / Robotaxi',
  'Starship / 우주인프라': 'Starship / Space Infra',
  'Starlink / 통신': 'Starlink / Telecom',
  '국방 / 정부계약': 'Defense / Gov Contracts',
  '규제 / 반독점': 'Regulation / Antitrust',
  '에너지 / 배터리': 'Energy / Batteries',
  '공급망 / CAPEX': 'Supply Chain / CAPEX',
  '경쟁사 / 시장점유율': 'Competitors / Market Share',
  '기타': 'Other',
};
export const categoryLabel = (c: string, lang: Lang = currentLang) => (lang === 'ko' ? c : CATEGORY_EN[c] || c);

/** 오른쪽 위 한/영 전환 버튼 */
export function LangToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800 p-0.5 text-xs font-semibold" role="group" aria-label="Language / 언어">
      {(['ko', 'en'] as const).map(l => (
        <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
          className={`rounded-md px-2 py-1 transition-colors cursor-pointer ${lang === l ? 'bg-cyan-700 text-white' : 'text-slate-400 hover:text-white'}`}>
          {l === 'ko' ? '한글' : 'EN'}
        </button>
      ))}
    </div>
  );
}
