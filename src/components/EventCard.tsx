import React from 'react';
import { 
  ExternalLink, 
  ChevronRight,
  Clock,
  AlertTriangle
} from 'lucide-react';
import { NewsEvent } from '../types';
import { useLang, categoryLabel } from '../i18n';

interface EventCardProps {
  event: NewsEvent;
  onSendTelegram: (id: string) => Promise<void>;
  onReanalyze: (id: string) => Promise<void>;
  onPreviewTelegram: (event: NewsEvent) => void;
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

export const EventCard: React.FC<EventCardProps> = ({
  event,
  onOpenDetail,
}) => {
  const { t, lang, locale } = useLang();
  // Importance rating styling - concise format
  const getImportanceBadge = (stars: number, status?: string) => {
    if ((status === 'screened' || status === 'pending' || status === 'failed') && event.screening) return (
      <span className="text-[11px] text-cyan-300 border border-cyan-900 rounded px-1.5 py-0.5">
        {t('간단 평가', 'Quick score')} {event.screening.score}★ · {status === 'screened' ? t('평가 완료', 'scored') : status === 'failed' ? t('상세 분석 실패', 'analysis failed') : t('상세 분석 대기', 'analysis pending')}
      </span>
    );
    if (status === 'failed') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-rose-950/70 text-rose-300 border border-rose-700/60">
          <AlertTriangle className="w-3 h-3 mr-1 text-rose-400" />
          {t('분석 실패', 'Analysis failed')}
        </span>
      );
    }
    if (status === 'skipped') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
          <Clock className="w-3 h-3 mr-1 text-slate-400" />
          {t('분석 제외', 'Skipped')}
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-amber-950/70 text-amber-300 border border-amber-700/60 animate-pulse">
          <Clock className="w-3 h-3 mr-1 text-amber-400" />
          {t('미평가', 'Unscored')}
        </span>
      );
    }
    if (stars === 0) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-800/80 text-slate-400 border border-slate-700">
          {t('미평가 (0★)', 'Unscored (0★)')}
        </span>
      );
    }
    if (stars === 5) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-rose-950/90 text-rose-300 border border-rose-700/80 font-mono tracking-tighter">
          ★★★★★
        </span>
      );
    }
    if (stars === 4) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold bg-amber-950/80 text-amber-300 border border-amber-700/70 font-mono tracking-tighter">
          ★★★★☆
        </span>
      );
    }
    if (stars === 3) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-blue-950/70 text-cyan-300 border border-cyan-800/60 font-mono tracking-tighter">
          ★★★☆☆
        </span>
      );
    }
    if (stars === 2) {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700 font-mono tracking-tighter">
          ★★☆☆☆
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-800/80 text-slate-500 border border-slate-700 font-mono tracking-tighter">
        ★☆☆☆☆
      </span>
    );
  };

  // Company color mapper helper
  const getCompanyBadgeColor = (name: string) => {
    const n = name.toLowerCase();
    if (n.includes('spacex')) return 'bg-sky-950 text-sky-300 border-sky-800';
    if (n.includes('google') || n.includes('alphabet')) return 'bg-blue-950 text-blue-300 border-blue-800';
    if (n.includes('tesla')) return 'bg-red-950 text-red-300 border-red-800';
    if (n.includes('microsoft')) return 'bg-emerald-950 text-emerald-300 border-emerald-800';
    if (n.includes('nvidia')) return 'bg-lime-950 text-lime-300 border-lime-800';
    return 'bg-purple-950 text-purple-300 border-purple-800';
  };

  const borderClass = event.importance === 5
    ? 'border-rose-700/60 hover:border-rose-500/80 shadow-md shadow-rose-950/20'
    : event.importance === 4
    ? 'border-amber-700/50 hover:border-amber-500/70 shadow-sm'
    : 'border-slate-800 hover:border-slate-700';

  const formatRelativeTime = (timeStr: string) => {
    try {
      const d = new Date(timeStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      if (diffMins < 1) return t('방금 전', 'just now');
      if (diffMins < 60) return lang === 'ko' ? `${diffMins}분 전` : `${diffMins}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return lang === 'ko' ? `${diffHours}시간 전` : `${diffHours}h ago`;
      return d.toLocaleDateString(locale, { month: lang === 'ko' ? 'numeric' : 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const timeDisplay = formatRelativeTime(event.primarySource.publishedAt || event.firstSeenAt);

  // Pick summary snippet
  const summarySnippet = event.summaryBulletPoints && event.summaryBulletPoints.length > 0
    ? event.summaryBulletPoints[0]
    : (event.whyItMatters || event.investmentImpactExplanation || '');

  return (
    <div className={`bg-slate-900/90 rounded-xl border ${borderClass} transition-all overflow-hidden mb-2.5 sm:mb-3 backdrop-blur-sm`}>
      <div className="p-3 sm:p-4">
        
        {/* Top Meta Line: Company badges, Importance Stars, and Relative Time */}
        <div className="flex items-center justify-between gap-1.5 mb-2">
          <div className="flex items-center flex-wrap gap-1.5 min-w-0">
            {/* Related Companies Tags */}
            {event.relatedCompanies && event.relatedCompanies.slice(0, 3).map((c, idx) => (
              <span
                key={idx}
                className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold border ${getCompanyBadgeColor(c)}`}
              >
                #{c}
              </span>
            ))}

            {/* Importance Rating Badge */}
            {getImportanceBadge(event.importance, event.analysisStatus)}

            {/* Category Pill (Desktop / Tablet) */}
            <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
              {categoryLabel(event.category, lang)}
            </span>
          </div>

          {/* Timestamp */}
          <div className="text-[11px] text-slate-400 shrink-0 font-medium">
            {timeDisplay}
          </div>
        </div>

        {/* Headlines */}
        <div className="mb-2">
          <h2 
            onClick={() => onOpenDetail(event)}
            className="text-sm sm:text-base font-bold text-white leading-snug cursor-pointer hover:text-cyan-300 transition-colors"
          >
            {lang === 'en' ? (event.originalTitle || event.title) : (event.titleKo || event.title)}
          </h2>
        </div>

        {/* Quick Summary / Key Impact on main card */}
        {summarySnippet && (
          <div 
            onClick={() => onOpenDetail(event)}
            className="mb-2.5 bg-slate-950/60 rounded-lg p-2 sm:p-2.5 border border-slate-800/80 cursor-pointer hover:border-slate-700 transition-colors"
          >
            <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
              💡 {summarySnippet}
            </p>
          </div>
        )}

        {/* Source & Single Action Row */}
        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
          
          {/* Primary Source Name */}
          <div className="flex items-center gap-1.5 min-w-0">
            <a
              href={event.primarySource.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700 text-cyan-300 hover:text-cyan-200 border border-slate-700/80 text-[11px] font-medium truncate transition-colors"
              title={t('원문 기사 열기', 'Open original article')}
            >
              <span className="truncate">{event.primarySource.name}</span>
              <ExternalLink className="w-2.5 h-2.5 ml-1 opacity-70 shrink-0" />
            </a>

            {event.relatedSources && event.relatedSources.length > 0 && (
              <span 
                onClick={() => onOpenDetail(event)}
                className="text-[10px] text-slate-400 hover:text-cyan-300 cursor-pointer hidden sm:inline"
              >
                +{event.relatedSources.length}{t('개 매체', ' more sources')}
              </span>
            )}
          </div>

          {/* Unified Detail Action */}
          <button
            onClick={() => onOpenDetail(event)}
            className="flex items-center gap-0.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-cyan-200 border border-slate-700 text-xs font-semibold transition-colors cursor-pointer"
          >
            <span>{t('자세히', 'Details')}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

        </div>
      </div>
    </div>
  );
};
