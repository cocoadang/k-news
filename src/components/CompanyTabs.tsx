import { chipClass, chipCountClass } from './ui';
import React from 'react';
import { CompanyProfile, NewsEvent } from '../types';
import { Globe } from 'lucide-react';
import { useLang } from '../i18n';

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
  const { t } = useLang();
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
          className={chipClass(selectedCompany === 'all')}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{t('전체', 'All')}</span>
          <span
            className={chipCountClass}
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
              className={chipClass(isSelected)}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: comp.color }}
              />
              <span>{comp.name}</span>
              <span
                className={chipCountClass}
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

