import React, { useEffect, useState } from 'react';
import { 
  X, 
  ExternalLink, 
  Send, 
  RefreshCw, 
  Layers, 
  Sparkles, 
  CheckSquare, 
  CheckCircle2, 
  Clock, 
  AlertTriangle 
} from 'lucide-react';
import { NewsEvent } from '../types';
import { useLang, categoryLabel } from '../i18n';

interface EventDetailModalProps {
  event: NewsEvent | null;
  onClose: () => void;
  onSendTelegram: (id: string) => Promise<void>;
  onReanalyze: (id: string) => Promise<void>;
  onPreviewTelegram?: (event: NewsEvent) => void;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({
  event,
  onClose,
  onSendTelegram,
  onReanalyze,
  onPreviewTelegram,
}) => {
  const { t, lang, locale } = useLang();
  const [isSending, setIsSending] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  useEffect(() => {
    if (!event) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', escape); };
  }, [event?.id, onClose]);

  if (!event) return null;

  const hasAnalysis = event.analysisStatus === 'completed' || (!event.analysisStatus && event.importance > 0);
  const hasRelatedSources = event.relatedSources.length > 0;
  const sources = [event.primarySource, ...event.relatedSources];

  const handleSend = async () => {
    setIsSending(true);
    try {
      await onSendTelegram(event.id);
    } finally {
      setIsSending(false);
    }
  };

  const handleReanalyze = async () => {
    setIsReanalyzing(true);
    try {
      await onReanalyze(event.id);
    } finally {
      setIsReanalyzing(false);
    }
  };

  // Importance label with full detail in modal
  const getImportanceBadge = (stars: number, status?: string) => {
    if (event.screening && status === 'screened') return <span className="text-cyan-300 text-xs">{t('간단 평가', 'Quick score')} {event.screening.score}★ {t('완료', '')}</span>;
    if (status === 'failed') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
          <AlertTriangle className="w-3 h-3 mr-1 text-rose-400" />
          {t('AI 분석 실패 (Failed)', 'AI analysis failed')}
        </span>
      );
    }
    if (status === 'skipped') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
          <Clock className="w-3 h-3 mr-1 text-slate-400" />
          {t('AI 분석 제외 (Skipped)', 'AI analysis skipped')}
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800 animate-pulse">
          <Clock className="w-3 h-3 mr-1 text-amber-400" />
          {t('AI 분석 대기 (Pending)', 'AI analysis pending')}
        </span>
      );
    }
    if (stars === 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
          {t('미평가 / 점수 없음 (0★)', 'Unscored (0★)')}
        </span>
      );
    }
    if (stars === 5) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold bg-rose-950 text-rose-200 border border-rose-700 shadow-sm">
          <span className="font-mono text-rose-400 mr-1.5">★★★★★</span>
          {t('🚨 긴급 중요 뉴스 (5★)', '🚨 Urgent (5★)')}
        </span>
      );
    }
    if (stars === 4) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold bg-amber-950 text-amber-300 border border-amber-700">
          <span className="font-mono text-amber-400 mr-1.5">★★★★☆</span>
          {t('주요 뉴스 (4★)', 'Major (4★)')}
        </span>
      );
    }
    if (stars === 3) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-950 text-blue-300 border border-blue-800">
          <span className="font-mono text-cyan-400 mr-1.5">★★★☆☆</span>
          {t('일반 알림 (3★)', 'Notable (3★)')}
        </span>
      );
    }
    if (stars === 2) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
          <span className="font-mono mr-1.5">★★☆☆☆</span>
          {t('참고/의견 (2★)', 'Reference / opinion (2★)')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
        <span className="font-mono mr-1.5">★☆☆☆☆</span>
        {t('단순 노이즈 (1★)', 'Noise (1★)')}
      </span>
    );
  };

  const getSourceTierBadge = (tier?: string) => {
    if (tier === 'tier1') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-700">
          {t('Tier 1 주요통신/공식', 'Tier 1 wire / official')}
        </span>
      );
    }
    if (tier === 'tier2') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-950/80 text-blue-300 border border-blue-700">
          {t('Tier 2 전문지', 'Tier 2 trade press')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
        {t('Tier 3 일반매체', 'Tier 3 general media')}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4 bg-black/80 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="news-detail-title" className="news-detail bg-slate-900 border border-slate-700/80 sm:rounded-2xl max-w-2xl w-full h-[100dvh] sm:h-auto sm:max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="news-detail-toolbar flex shrink-0 items-center justify-between border-b border-slate-800 px-3 py-2 sm:px-6 bg-slate-950/80">
          <span className="text-sm font-semibold text-slate-200">{t('뉴스 상세', 'News details')}</span>
          <button autoFocus onClick={onClose} aria-label={t('뉴스 상세 닫기', 'Close news details')} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="news-detail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        
        {/* Header */}
        <div className="news-detail-heading px-3 sm:px-6 py-3 sm:py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5">
              {/* Companies */}
              {event.relatedCompanies && event.relatedCompanies.map((c, idx) => (
                <span key={idx} className="px-2 py-0.5 rounded text-xs font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                  #{c}
                </span>
              ))}

              {/* Category */}
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                {categoryLabel(event.category, lang)}
              </span>

              {/* Content Type */}
              {event.contentType && (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-950 text-blue-300 border border-blue-800">
                  {event.contentType === 'official_announcement' ? t('공식 1차 발표', 'Official announcement') :
                   event.contentType === 'financial_result' ? t('실적·재무', 'Financial results') :
                   event.contentType === 'regulatory_event' ? t('규제·인허가', 'Regulatory') :
                   event.contentType === 'contract' ? t('수주·계약', 'Contract') :
                   event.contentType === 'product_event' ? t('신제품·기술', 'Product / tech') :
                   event.contentType === 'analyst_opinion' ? t('애널리스트 의견', 'Analyst opinion') :
                   event.contentType === 'market_commentary' ? t('시장 논평', 'Market commentary') :
                   event.contentType === 'rumor' ? t('미확인 루머', 'Unconfirmed rumor') :
                   event.contentType === 'recap' ? t('단순 요약', 'Recap') : t('취재 사실', 'Reported fact')}
                </span>
              )}

              {/* Importance */}
              {getImportanceBadge(event.importance, event.analysisStatus)}

              {/* Source Tier */}
              {getSourceTierBadge(event.sourceTier)}

              {/* Telegram Status */}
              {event.isSentToTelegram ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800">
                  <CheckCircle2 className="w-3 h-3 mr-1 text-cyan-400" />
                  {t('Telegram 전송완료', 'Sent to Telegram')}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
                  {t('Telegram 미전송', 'Not sent to Telegram')}
                </span>
              )}
            </div>

            <h2 id="news-detail-title" className="text-base sm:text-lg font-bold text-white leading-relaxed pt-1 break-words">
              {lang === 'en' ? (event.originalTitle || event.title) : (event.titleKo || event.title)}
            </h2>
          </div>
        </div>

        {/* Content Body */}
        <div className="news-detail-sections p-3 sm:p-6 space-y-3 sm:space-y-4 text-sm text-slate-200">
          
          {/* Analysis Status Details (Failed, Skipped, Pending reasons) */}
          {event.analysisStatus === 'failed' && (
            <div className="bg-rose-950/60 p-3.5 sm:p-4 rounded-xl border border-rose-800/80">
              <div className="text-xs font-bold text-rose-300 mb-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                {t('분석 실패 사유', 'Why analysis failed')}
              </div>
              <p className="text-xs sm:text-sm text-rose-200 leading-relaxed">
                {event.analysisError || t('최대 자동 재시도 횟수 초과 또는 모델 분석 실패', 'Retry limit reached or model analysis failed')}
              </p>
              <div className="mt-2 text-[11px] text-rose-300/80">
                {t('하단의 [AI 재분석] 버튼을 통해 관리자 권한으로 수동 재시도할 수 있습니다.', 'An admin can retry with the [AI re-analyze] button below.')}
              </div>
            </div>
          )}

          {event.analysisStatus === 'skipped' && (
            <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-xl border border-slate-700">
              <div className="text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-400" />
                {t('분석 제외 사유 (Skipped)', 'Why it was skipped')}
              </div>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {event.skipReason || event.analysisError || t('투자 무관 잡음 문서 또는 7일 초과 기사로 자동 분석에서 제외되었습니다.', 'Excluded as non-investment noise or older than 7 days.')}
              </p>
            </div>
          )}

          {event.analysisStatus === 'pending' && (
            <div className="bg-amber-950/60 p-3.5 sm:p-4 rounded-xl border border-amber-800/80">
              <div className="text-xs font-bold text-amber-300 mb-1.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                {t('미평가 / 상세 분석 대기', 'Unscored / awaiting analysis')}
              </div>
              <p className="text-xs sm:text-sm text-amber-200 leading-relaxed">
                {event.analysisDeferredReason || t('다음 수집 실행에서 처리할 예정입니다.', 'Will be processed in the next collection run.')} ({t('재시도 횟수', 'retries')}: {event.analysisRetryCount || 0}/3)
              </p>
            </div>
          )}

          {/* Factual Summary */}
          {event.summaryBulletPoints && event.summaryBulletPoints.length > 0 && (
            <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
              <div className="text-xs font-bold text-cyan-400 mb-2 flex items-center gap-1.5 uppercase">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                {t('📌 [핵심내용] 언론 보도 확인 사실', '📌 Key facts reported')}
              </div>
              <ul className="space-y-1.5 text-xs sm:text-sm text-slate-300">
                {event.summaryBulletPoints.map((bullet, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="text-cyan-400 font-bold mr-2 select-none">•</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Multi-Company Impacts */}
          {hasAnalysis && (
            <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
              <div className="text-xs font-bold text-purple-300 mb-2.5 uppercase">
                {t('📊 [기업별 영향] 개별 영향 및 분석', '📊 Impact by company')}
              </div>
              <div className="space-y-2">
                {event.companyImpacts && event.companyImpacts.length > 0 ? (
                  event.companyImpacts.map((ci, idx) => {
                    const isPos = ci.impact === 'positive';
                    const isNeg = ci.impact === 'negative';
                    const badgeText = isPos ? t('🟢 긍정적', '🟢 Positive') : isNeg ? t('🔴 부정적', '🔴 Negative') : t('🟡 중립적', '🟡 Neutral');
                    const badgeColor = isPos ? 'text-emerald-400' : isNeg ? 'text-rose-400' : 'text-amber-400';

                    return (
                      <div key={idx} className="p-3 rounded-lg bg-slate-900 border border-slate-800">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-white text-xs">{ci.companyName} {ci.ticker && `(${ci.ticker})`}</span>
                          <span className={`text-xs font-semibold ${badgeColor}`}>{badgeText}</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">→ {ci.rationale}</p>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-300">{event.investmentImpactExplanation || event.impactRationale}</p>
                )}
              </div>
            </div>
          )}

          {/* Why it Matters */}
          {hasAnalysis && event.whyItMatters && (
            <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
              <div className="text-xs font-bold text-amber-300 mb-1.5 uppercase">
                {t('💡 [왜 중요한가] 장기 기업가치 및 비즈니스 해자', '💡 Why it matters: long-term value & moat')}
              </div>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {event.whyItMatters}
              </p>
            </div>
          )}

          {/* Key Checkpoints to watch */}
          {hasAnalysis && event.keyCheckpointsToWatch && event.keyCheckpointsToWatch.length > 0 && (
            <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
              <div className="text-xs font-bold text-emerald-300 mb-2 flex items-center gap-1.5 uppercase">
                <CheckSquare className="w-4 h-4 text-emerald-400" />
                {t('🔎 [향후 확인할 것] 핵심 점검 지표 & 다음 일정', '🔎 What to watch next')}
              </div>
              <ul className="space-y-1.5 text-xs sm:text-sm text-slate-300">
                {event.keyCheckpointsToWatch.map((chk, idx) => (
                  <li key={idx} className="flex items-start">
                    <span className="text-emerald-400 font-bold mr-2 select-none">✔</span>
                    <span>{chk}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hasRelatedSources && (
            <div className="flex items-center gap-1.5 text-xs font-bold text-purple-300">
              <Layers className="h-4 w-4 text-purple-400" />
              {t('함께 묶인 기사', 'Grouped articles')} ({sources.length})
            </div>
          )}
          <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label={t('기사 출처', 'Article sources')}>
            {sources.map((source) => (
              <li key={source.url}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={t(`${source.name} 원문 보기`, `Read ${source.name} source`)}
                  className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-cyan-300 hover:underline"
                >
                  {source.name}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
          {event.detectedOriginalSource && (
            <p className="text-xs text-slate-400">
              {t('원출처 인용 감지', 'Original source detected')}: {event.detectedOriginalSource}
            </p>
          )}

          <div className="text-xs text-slate-400 border-t border-slate-800 pt-3">
            <span>{t('최초 발견', 'First seen')}: {new Date(event.firstSeenAt).toLocaleString(locale)}</span>
          </div>

        </div>
        </div>

        <div className="news-detail-footer flex shrink-0 justify-end border-t border-slate-800 px-3 py-2 sm:px-6"><button onClick={onClose} className="min-h-[44px] w-full sm:w-auto rounded-lg border border-slate-700 px-4 text-sm text-slate-300 focus-visible:ring-2 focus-visible:ring-cyan-400">{t('닫기','Close')}</button></div>

      </div>
    </div>
  );
};
