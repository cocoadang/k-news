import React from 'react';
import { RefreshCw, Play } from 'lucide-react';
import { useLang } from '../i18n';

/** 콘텐츠 머리말: 제목 · 설명 · 상태 문구. 운영 도구는 관리자 설정에 둡니다. */
export function PageHeader({ title, description, actions, status }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; status?: React.ReactNode }) {
  return (
    <div className="page-header mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="min-w-0 text-xl font-bold text-white">{title}</h1>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {description && <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>}
      {status && <p role="status" className="mt-2 text-sm text-cyan-300">{status}</p>}
    </div>
  );
}

export function TelegramSubscribeButton() {
  const { t } = useLang();
  return <a href="https://t.me/dsoom_news" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] sm:min-h-[40px] shrink-0 items-center rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400">
    {t('텔레그램으로 받기 ↗', 'Join Telegram ↗')}
  </a>;
}

const base = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonClass = {
  secondary: `${base} border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800`,
  primary: `${base} border border-cyan-600 bg-cyan-700 text-white hover:bg-cyan-600`,
};

/** 관리자 설정에서 저장된 결과를 다시 불러옵니다. */
export function RefreshButton({ onClick, busy = false }: { onClick: () => void; busy?: boolean }) {
  const { t } = useLang();
  return <button type="button" className={buttonClass.secondary} onClick={onClick} disabled={busy}>
    <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />{t('새로고침', 'Refresh')}
  </button>;
}

/** 모든 메뉴 공통: 관리자만 보이는 수집 실행 버튼. */
export function CollectButton({ onClick, busy = false, label }: { onClick: () => void; busy?: boolean; label?: string }) {
  const { t } = useLang();
  return <button type="button" className={buttonClass.primary} onClick={onClick} disabled={busy}>
    <Play className="h-4 w-4" aria-hidden="true" />{busy ? t('수집 중…', 'Collecting…') : label ?? t('지금 수집', 'Collect now')}
  </button>;
}

/** 필터·탭 칩 공통 모양. */
export const chipClass = (on: boolean) =>
  `inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
    on ? 'border-cyan-500 bg-cyan-950 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white'}`;
export const chipCountClass = 'rounded-full bg-slate-800 px-1.5 text-xs font-medium text-slate-300';
