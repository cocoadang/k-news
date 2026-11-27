import React from 'react';
import { Activity, Send, Settings } from 'lucide-react';
import { AuthStatus } from '../types';
import { LangToggle, useLang } from '../i18n';

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
  const { t } = useLang();
  const showAdminSettings = authStatus?.isAuthenticated || new URLSearchParams(window.location.search).get('admin') === '1';
  return (
    <header className="sticky top-0 z-30 pt-[env(safe-area-inset-top)] bg-slate-900/95 backdrop-blur-md border-b border-slate-800 text-white">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5">
        <div className="flex items-center justify-between gap-2">
          
          {/* Logo and Brand */}
          <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-cyan-600 via-blue-600 to-indigo-600 flex items-center justify-center shadow-md shadow-cyan-500/20 shrink-0">
              <Activity className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold tracking-tight text-white truncate flex items-center gap-1.5">
                {t('미국주식', 'US Stock')} <span className="text-cyan-400">{t('모니터링', 'Monitor')}</span>
              </h1>
            </div>
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <LangToggle />
            <a
              href="https://t.me/dsoom_news"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('텔레그램 입장', 'Join Telegram')}
              className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-cyan-700 bg-cyan-950 text-cyan-200 transition-colors hover:bg-cyan-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </a>
            {showAdminSettings && (
              <button
                onClick={authStatus?.isAuthenticated ? onOpenSettings : onOpenLogin}
                className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
                title={t('관리자 설정', 'Admin settings')}
                aria-label={t('설정', 'Settings')}
              >
                <Settings className="w-4 h-4" />
              </button>
            )}
          </div>

        </div>
      </div>
    </header>
  );
};


