import React from 'react';
import { Search, Filter, X, Sparkles, Flame } from 'lucide-react';
import { NewsCategory } from '../types';

interface FilterBarProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: string;
  setSelectedCategory: (cat: string) => void;
  minImportance: number;
  setMinImportance: (min: number) => void;
  selectedImpact: string;
  setSelectedImpact: (impact: string) => void;
  onlyTelegramSent: boolean | null;
  setOnlyTelegramSent: (val: boolean | null) => void;
  categories: NewsCategory[];
  totalResults: number;
  onResetFilters: () => void;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
  minImportance,
  setMinImportance,
  selectedImpact,
  setSelectedImpact,
  onlyTelegramSent,
  setOnlyTelegramSent,
  categories,
  totalResults,
  onResetFilters,
}) => {
  const isFiltered =
    searchQuery !== '' ||
    selectedCategory !== 'all' ||
    minImportance > 0 ||
    selectedImpact !== 'all' ||
    onlyTelegramSent !== null;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 sm:p-3.5 mb-3 sm:mb-4 backdrop-blur-sm">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
        
        {/* Search Input - Compact */}
        <div className="relative flex-1 min-w-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="뉴스 제목, 기업, 키워드 검색..."
            className="w-full pl-8 pr-7 py-1.5 bg-slate-950/70 border border-slate-700/80 rounded-lg text-xs sm:text-sm text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters Row */}
        <div className="flex items-center flex-wrap gap-1.5 sm:gap-2">
          
          {/* Importance Filter: 전체, 4★ 이상, 5★ */}
          <div className="flex items-center bg-slate-950/80 border border-slate-700/80 rounded-lg p-0.5 text-xs font-semibold">
            <button
              onClick={() => setMinImportance(0)}
              className={`px-2 py-1 rounded transition-colors cursor-pointer ${
                minImportance === 0 ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              전체
            </button>
            <button
              onClick={() => setMinImportance(4)}
              className={`px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                minImportance === 4 ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-amber-300'
              }`}
              title="중요도 4★ 이상 필터"
            >
              <Sparkles className="w-3 h-3 text-amber-300" />
              <span>4★ 이상</span>
            </button>
            <button
              onClick={() => setMinImportance(5)}
              className={`px-2 py-1 rounded transition-colors flex items-center gap-1 cursor-pointer ${
                minImportance === 5 ? 'bg-rose-600 text-white' : 'text-slate-400 hover:text-rose-300'
              }`}
              title="긴급 중요도 5★ 필터"
            >
              <Flame className="w-3 h-3 text-rose-300" />
              <span>5★</span>
            </button>
          </div>

          {/* Category Dropdown (Compact) */}
          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="appearance-none bg-slate-950/80 border border-slate-700/80 rounded-lg pl-2.5 pr-6 py-1 text-xs font-medium text-slate-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
            >
              <option value="all">카테고리 전체</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <Filter className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* Reset Filters if active */}
          {isFiltered && (
            <button
              onClick={onResetFilters}
              className="flex items-center px-2 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
              title="필터 초기화"
            >
              <X className="w-3 h-3 mr-0.5" />
              초기화
            </button>
          )}

          {/* Result Count Badge */}
          <span className="text-[11px] text-slate-400 ml-auto hidden sm:inline">
            총 <strong className="text-cyan-400 font-semibold">{totalResults}</strong>건
          </span>

        </div>
      </div>
    </div>
  );
};

