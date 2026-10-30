import React from 'react';
import { RefreshCw, Play } from 'lucide-react';

/** 모든 메뉴가 같은 머리말 구조를 씁니다: 제목 · 설명 · 오른쪽 버튼(새로고침 / 관리자 지금 수집) · 상태 문구. */
export function PageHeader({ title, description, actions, status }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; status?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white">{title}</h1>
          {description && <p className="mt-1 text-sm leading-6 text-slate-400">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {status && <p role="status" className="mt-2 text-sm text-cyan-300">{status}</p>}
    </div>
  );
}

const base = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50';
export const buttonClass = {
  secondary: `${base} border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800`,
  primary: `${base} border border-cyan-600 bg-cyan-700 text-white hover:bg-cyan-600`,
};

/** 모든 메뉴 공통: 화면의 저장된 결과를 다시 불러옵니다(누구나). */
export function RefreshButton({ onClick, busy = false }: { onClick: () => void; busy?: boolean }) {
  return <button type="button" className={buttonClass.secondary} onClick={onClick} disabled={busy}>
    <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />새로고침
  </button>;
}

/** 모든 메뉴 공통: 관리자만 보이는 수집 실행 버튼. */
export function CollectButton({ onClick, busy = false, label = '지금 수집' }: { onClick: () => void; busy?: boolean; label?: string }) {
  return <button type="button" className={buttonClass.primary} onClick={onClick} disabled={busy}>
    <Play className="h-4 w-4" aria-hidden="true" />{busy ? '수집 중…' : label}
  </button>;
}

/** 필터·탭 칩 공통 모양. */
export const chipClass = (on: boolean) =>
  `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
    on ? 'border-cyan-500 bg-cyan-950 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white'}`;
export const chipCountClass = 'rounded-full bg-slate-800 px-1.5 text-xs font-medium text-slate-300';
