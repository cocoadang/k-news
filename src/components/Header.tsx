import React from 'react';
import { Activity, RefreshCw, Settings, Lock, ShieldCheck } from 'lucide-react';
import { AuthStatus } from '../types';

interface HeaderProps {
  authStatus: AuthStatus | null;
  isPolling: boolean;
  onManualPoll: () => void;
  onOpenSettings: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
  /** CEO 발언 화면 등 뉴스 수집과 무관한 화면에서는 수집 버튼(/api/poll)을 숨김 */
  hideManualPoll?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  authStatus,
  isPolling,
  onManualPoll,
  onOpenSettings,
  onOpenLogin,
  onLogout,
  hideManualPoll = false,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-white">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5">
        <div className="flex items-center justify-between gap-2">
          
          {/* Logo and Brand */}
          <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-cyan-500/20 shrink-0">
              <Activity className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-white truncate flex items-center gap-1.5">
                Investment <span className="text-cyan-400">Intelligence</span>
              </h1>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            
            {/* Admin status (Subtle icon button) */}
            {authStatus?.requiresAuth && (
              authStatus.isAuthenticated ? (
                <button
                  onClick={onLogout}
                  title="관리자 인증됨 (클릭 시 로그아웃)"
                  className="p-1.5 rounded-lg bg-cyan-950/60 hover:bg-rose-950/60 border border-cyan-800/60 hover:border-rose-800/60 text-cyan-400 hover:text-rose-300 transition-colors cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={onOpenLogin}
                  title="관리자 로그인"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-amber-400 transition-colors cursor-pointer"
                >
                  <Lock className="w-4 h-4" />
                </button>
              )
            )}

            {/* Manual Fetch Button (뉴스 피드에서만) */}
            {!hideManualPoll && <button
              onClick={onManualPoll}
              disabled={isPolling}
              className="flex items-center px-2.5 sm:px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-sm disabled:opacity-50 transition-all cursor-pointer"
              title="최신 뉴스 수집 & AI 분석 실행"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''} sm:mr-1`} />
              <span className="hidden sm:inline">{isPolling ? '수집 중...' : '새로고침'}</span>
            </button>}

            {/* Settings Gear Button (⚙️) */}
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="기업 및 알림 필터 설정"
              aria-label="설정"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

        </div>
      </div>
    </header>
  );
};


