import React from 'react';
import { CompanyProfile, NewsEvent } from '../types';
import { Globe } from 'lucide-react';

interface CompanyTabsProps {
  companies: CompanyProfile[];
  selectedCompany: string; // 'all' or company id
  onSelectCompany: (companyId: string) => void;
  events: NewsEvent[];
}

export const CompanyTabs: React.FC<CompanyTabsProps> = ({
  companies,
  selectedCompany,
  onSelectCompany,
  events,
}) => {
  // Count events for each company
  const getEventCount = (companyId: string) => {
    if (companyId === 'all') return events.length;
    const target = companyId.toLowerCase();
    return events.filter(e => {
      const inRelated = e.relatedCompanies?.some(c =>
        c.toLowerCase().includes(target) ||
        (target === 'googl' && c.toLowerCase().includes('google')) ||
        (target === 'tsla' && c.toLowerCase().includes('tesla')) ||
        (target === 'msft' && c.toLowerCase().includes('microsoft')) ||
        (target === 'nvda' && c.toLowerCase().includes('nvidia')) ||
        (target === 'spacex' && c.toLowerCase().includes('spacex'))
      );
      const inImpacts = e.companyImpacts?.some(ci =>
        ci.companyId.toLowerCase() === target || ci.companyName.toLowerCase().includes(target)
      );
      return inRelated || inImpacts;
    }).length;
  };

  const enabledCompanies = companies.filter(c => c.enabled);

  return (
    <div className="mb-3 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 scrollbar-none">
      <div className="flex items-center gap-1.5 sm:gap-2 min-w-max">
        {/* ALL Tab */}
        <button
          onClick={() => onSelectCompany('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            selectedCompany === 'all'
              ? 'bg-cyan-600 text-white shadow-sm border border-cyan-500'
              : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-800'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>전체</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              selectedCompany === 'all'
                ? 'bg-cyan-800/80 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {getEventCount('all')}
          </span>
        </button>

        {/* Company specific tabs */}
        {enabledCompanies.map(comp => {
          const isSelected = selectedCompany === comp.id;
          const count = getEventCount(comp.id);

          return (
            <button
              key={comp.id}
              onClick={() => onSelectCompany(comp.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                isSelected
                  ? 'bg-slate-800 text-white border-2 shadow-sm'
                  : 'bg-slate-900/90 text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-800'
              }`}
              style={{
                borderColor: isSelected ? comp.color : undefined,
              }}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: comp.color }}
              />
              <span>{comp.name}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  isSelected
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

