import React from 'react';
import { Search, X } from 'lucide-react';
import { useLang } from '../i18n';

interface FilterBarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({ searchQuery, setSearchQuery }) => {
  const { t } = useLang();
  return (
    <div className="relative w-[42%] min-w-24 max-w-sm shrink-0 sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label={t('뉴스 검색', 'Search news')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('뉴스 검색', 'Search news')}
            className="w-full pl-8 pr-7 py-1.5 bg-slate-950/70 border border-slate-700/80 rounded-lg text-xs sm:text-sm text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={t('검색어 지우기', 'Clear search')}
              className="news-search-clear absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
  );
};
