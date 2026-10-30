import React from 'react';
import { Activity, Settings, Lock, ShieldCheck } from 'lucide-react';
import { AuthStatus } from '../types';

interface HeaderProps {
  authStatus: AuthStatus | null;
  onOpenSettings: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  authStatus,
  onOpenSettings,
  onOpenLogin,
  onLogout,
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
                미국주식 <span className="text-cyan-400">모니터링</span>
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

            {/* 수집 실행·새로고침 버튼은 각 메뉴 머리말(PageHeader)로 옮겼습니다. */}

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


