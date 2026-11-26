import React from 'react';
import { ChevronRight } from 'lucide-react';
import { NewsEvent } from '../types';
import { useLang } from '../i18n';

interface EventCardProps {
  event: NewsEvent;
  onOpenDetail: (event: NewsEvent) => void;
}

export function getEventBadgeInfo(stars: number, status?: string): {
  type: 'failed' | 'skipped' | 'pending' | 'unrated' | 'rated';
  label: string;
  starsText?: string;
} {
  // Badges 상태 우선순위: failed -> 분석실패, skipped -> 분석제외, pending -> 분석대기
  if (status === 'failed') {
    return { type: 'failed', label: '분석 실패' };
  }
  if (status === 'skipped') {
    return { type: 'skipped', label: '분석 제외' };
  }
  if (status === 'pending') {
    return { type: 'pending', label: '분석 대기' };
  }
  // completed 0은 미평가/점수없음이지 pending 아님
  if (stars === 0) {
    return { type: 'unrated', label: '미평가 (0★)' };
  }
  if (stars === 5) {
    return { type: 'rated', label: '★★★★★', starsText: '★★★★★' };
  }
  if (stars === 4) {
    return { type: 'rated', label: '★★★★☆', starsText: '★★★★☆' };
  }
  if (stars === 3) {
    return { type: 'rated', label: '★★★☆☆', starsText: '★★★☆☆' };
  }
  if (stars === 2) {
    return { type: 'rated', label: '★★☆☆☆', starsText: '★★☆☆☆' };
  }
  return { type: 'rated', label: '★☆☆☆☆', starsText: '★☆☆☆☆' };
}

export const EventCard: React.FC<EventCardProps> = ({ event, onOpenDetail }) => {
  const { t, lang } = useLang();
  const title = lang === 'en' ? event.originalTitle || event.title : event.titleKo || event.title;
  const companies = (event.relatedCompanies?.length ? event.relatedCompanies : event.companyImpacts?.map(impact => impact.companyName) || []).slice(0, 3).join(' · ');
  const summary = [event.summaryBulletPoints?.[0], event.factualPoints?.[0], event.whyItMatters, event.primarySource.snippet]
    .map(text => text?.trim())
    .find(text => text && text !== event.title && text !== event.originalTitle && text !== event.titleKo);
  return <article>
    <button type="button" onClick={() => onOpenDetail(event)}
      className="group block w-full rounded-xl border border-slate-800 bg-slate-900/90 p-3 text-left hover:border-cyan-800 focus-visible:outline-2 focus-visible:outline-cyan-400 sm:p-4"
      aria-label={`${title} · ${t('자세히', 'Details')}`}>
      {companies && <p className="mb-1 text-xs font-semibold text-cyan-300">{companies}</p>}
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-bold leading-snug text-white group-hover:text-cyan-200 sm:text-base">{title}</h2>
        <ChevronRight className="size-4 shrink-0 text-cyan-300" aria-hidden="true"/>
      </div>
      {summary && <p className="mt-1 line-clamp-1 text-sm leading-relaxed text-slate-300">{summary}</p>}
    </button>
  </article>;
};
