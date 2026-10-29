import React, { useState } from 'react';
import { 
  X, 
  ExternalLink, 
  Send, 
  RefreshCw, 
  Layers, 
  Sparkles, 
  CheckSquare, 
  Eye, 
  CheckCircle2, 
  Clock, 
  AlertTriangle 
} from 'lucide-react';
import { NewsEvent } from '../types';

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
  const [isSending, setIsSending] = useState(false);
  const [isReanalyzing, setIsReanalyzing] = useState(false);

  if (!event) return null;

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
    if (event.screening && status === 'screened') return <span className="text-cyan-300 text-xs">간단 평가 {event.screening.score}★ 완료</span>;
    if (status === 'failed') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-800">
          <AlertTriangle className="w-3 h-3 mr-1 text-rose-400" />
          AI 분석 실패 (Failed)
        </span>
      );
    }
    if (status === 'skipped') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
          <Clock className="w-3 h-3 mr-1 text-slate-400" />
          AI 분석 제외 (Skipped)
        </span>
      );
    }
    if (status === 'pending') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-800 animate-pulse">
          <Clock className="w-3 h-3 mr-1 text-amber-400" />
          AI 분석 대기 (Pending)
        </span>
      );
    }
    if (stars === 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
          미평가 / 점수 없음 (0★)
        </span>
      );
    }
    if (stars === 5) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold bg-rose-950 text-rose-200 border border-rose-700 shadow-sm">
          <span className="font-mono text-rose-400 mr-1.5">★★★★★</span>
          🚨 긴급 중요 뉴스 (5★)
        </span>
      );
    }
    if (stars === 4) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-bold bg-amber-950 text-amber-300 border border-amber-700">
          <span className="font-mono text-amber-400 mr-1.5">★★★★☆</span>
          주요 뉴스 (4★)
        </span>
      );
    }
    if (stars === 3) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-950 text-blue-300 border border-blue-800">
          <span className="font-mono text-cyan-400 mr-1.5">★★★☆☆</span>
          일반 알림 (3★)
        </span>
      );
    }
    if (stars === 2) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
          <span className="font-mono mr-1.5">★★☆☆☆</span>
          참고/의견 (2★)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
        <span className="font-mono mr-1.5">★☆☆☆☆</span>
        단순 노이즈 (1★)
      </span>
    );
  };

  const getSourceTierBadge = (tier?: string) => {
    if (tier === 'tier1') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-950/80 text-amber-300 border border-amber-700">
          Tier 1 주요통신/공식
        </span>
      );
    }
    if (tier === 'tier2') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-950/80 text-blue-300 border border-blue-700">
          Tier 2 전문지
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
        Tier 3 일반매체
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-800 flex items-start justify-between bg-slate-950/80">
          <div className="space-y-1.5 pr-3 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5">
              {/* Companies */}
              {event.relatedCompanies && event.relatedCompanies.map((c, idx) => (
                <span key={idx} className="px-2 py-0.5 rounded text-xs font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                  #{c}
                </span>
              ))}

              {/* Category */}
              <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                {event.category}
              </span>

              {/* Content Type */}
              {event.contentType && (
                <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-950 text-blue-300 border border-blue-800">
                  {event.contentType === 'official_announcement' ? '공식 1차 발표' :
                   event.contentType === 'financial_result' ? '실적·재무' :
                   event.contentType === 'regulatory_event' ? '규제·인허가' :
                   event.contentType === 'contract' ? '수주·계약' :
                   event.contentType === 'product_event' ? '신제품·기술' :
                   event.contentType === 'analyst_opinion' ? '애널리스트 의견' :
                   event.contentType === 'market_commentary' ? '시장 논평' :
                   event.contentType === 'rumor' ? '미확인 루머' :
                   event.contentType === 'recap' ? '단순 요약' : '취재 사실'}
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
                  Telegram 전송완료
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
                  Telegram 미전송
                </span>
              )}
            </div>

            <h2 className="text-sm sm:text-lg font-bold text-white leading-snug pt-1">
              {event.title}
            </h2>
            {event.originalTitle && event.originalTitle !== event.title && (
              <p className="text-xs text-slate-400 italic">
                원문: {event.originalTitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-sm text-slate-200">
          
          {event.screening && event.analysisStatus !== 'completed' && (
            <div className="bg-cyan-950/40 p-4 rounded-xl border border-cyan-900">
              <p className="font-bold text-cyan-300">간단 평가 {event.screening.score}★ (최종 점수 아님)</p>
              <p>{event.screening.reason}</p>
              <p>{event.screening.uncertain ? '정보 부족 또는 판단 불확실: 상세 확인 대상' : ''}</p>
              <p>{event.analysisDeferredReason}</p>
            </div>
          )}
          {/* Analysis Status Details (Failed, Skipped, Pending reasons) */}
          {event.analysisStatus === 'failed' && (
            <div className="bg-rose-950/60 p-3.5 sm:p-4 rounded-xl border border-rose-800/80">
              <div className="text-xs font-bold text-rose-300 mb-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                분석 실패 사유
              </div>
              <p className="text-xs sm:text-sm text-rose-200 leading-relaxed">
                {event.analysisError || '최대 자동 재시도 횟수 초과 또는 모델 분석 실패'}
              </p>
              <div className="mt-2 text-[11px] text-rose-300/80">
                하단의 [AI 재분석] 버튼을 통해 관리자 권한으로 수동 재시도할 수 있습니다.
              </div>
            </div>
          )}

          {event.analysisStatus === 'skipped' && (
            <div className="bg-slate-950/80 p-3.5 sm:p-4 rounded-xl border border-slate-700">
              <div className="text-xs font-bold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-400" />
                분석 제외 사유 (Skipped)
              </div>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {event.skipReason || event.analysisError || '투자 무관 잡음 문서 또는 7일 초과 기사로 자동 분석에서 제외되었습니다.'}
              </p>
            </div>
          )}

          {event.analysisStatus === 'pending' && (
            <div className="bg-amber-950/60 p-3.5 sm:p-4 rounded-xl border border-amber-800/80">
              <div className="text-xs font-bold text-amber-300 mb-1.5 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                미평가 / 상세 분석 대기
              </div>
              <p className="text-xs sm:text-sm text-amber-200 leading-relaxed">
                {event.analysisDeferredReason || '다음 수집 실행에서 처리할 예정입니다.'} (재시도 횟수: {event.analysisRetryCount || 0}/3)
              </p>
            </div>
          )}

          {/* Factual Summary */}
          {event.summaryBulletPoints && event.summaryBulletPoints.length > 0 && (
            <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
              <div className="text-xs font-bold text-cyan-400 mb-2 flex items-center gap-1.5 uppercase">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                📌 [핵심내용] 언론 보도 확인 사실
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
          <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
            <div className="text-xs font-bold text-purple-300 mb-2.5 uppercase">
              📊 [기업별 영향] 개별 영향 및 분석
            </div>
            <div className="space-y-2">
              {event.companyImpacts && event.companyImpacts.length > 0 ? (
                event.companyImpacts.map((ci, idx) => {
                  const isPos = ci.impact === 'positive';
                  const isNeg = ci.impact === 'negative';
                  const badgeText = isPos ? '🟢 긍정적' : isNeg ? '🔴 부정적' : '🟡 중립적';
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

          {/* Why it Matters */}
          {event.whyItMatters && (
            <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
              <div className="text-xs font-bold text-amber-300 mb-1.5 uppercase">
                💡 [왜 중요한가] 장기 기업가치 및 비즈니스 해자
              </div>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {event.whyItMatters}
              </p>
            </div>
          )}

          {/* Key Checkpoints to watch */}
          {event.keyCheckpointsToWatch && event.keyCheckpointsToWatch.length > 0 && (
            <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
              <div className="text-xs font-bold text-emerald-300 mb-2 flex items-center gap-1.5 uppercase">
                <CheckSquare className="w-4 h-4 text-emerald-400" />
                🔎 [향후 확인할 것] 핵심 점검 지표 & 다음 일정
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

          {/* Clustered Media Sources Section */}
          <div className="bg-slate-950/70 p-3.5 sm:p-4 rounded-xl border border-slate-800">
            <div className="text-xs font-bold text-purple-300 mb-2 flex items-center gap-1.5 uppercase">
              <Layers className="w-4 h-4 text-purple-400" />
              함께 묶인 기사 ({1 + event.relatedSources.length}건)
            </div>
            <p className="text-[11px] text-slate-500 mb-2">
              자동으로 같은 사건으로 분류된 기사입니다. 기사 수가 사실 확인 여부나 신뢰도를 뜻하지는 않습니다.
            </p>
            <div className="space-y-2">
              {/* Primary Source */}
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900 border border-cyan-800/40">
                <div className="min-w-0 pr-2">
                  <div className="flex items-center flex-wrap gap-1.5">
                    <span className="font-semibold text-white text-xs">{event.primarySource.name}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">대표 출처</span>
                    <span className="text-[10px] text-slate-400">신뢰도 {event.primarySource.credibilityScore || 10}/10</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{event.primarySource.title}</div>
                </div>
                <a
                  href={event.primarySource.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-white transition-colors shrink-0"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              {/* Detected original source citation */}
              {event.detectedOriginalSource && (
                <div className="p-2 rounded bg-cyan-950/40 border border-cyan-800/40 text-xs text-cyan-300">
                  <span className="font-semibold">원출처 인용 감지:</span> {event.detectedOriginalSource}
                </div>
              )}

              {/* Related Sources */}
              {event.relatedSources.map((rel, idx) => (
                <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-slate-800">
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center flex-wrap gap-1.5">
                      <span className="font-medium text-slate-200 text-xs">{rel.name}</span>
                      <span className="text-[10px] text-slate-400">신뢰도 {rel.credibilityScore || 8}/10</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 line-clamp-1">{rel.title}</div>
                  </div>
                  <a
                    href={rel.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors shrink-0"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* Model info metadata */}
          <div className="text-xs text-slate-400 flex items-center justify-between border-t border-slate-800 pt-3">
            <span>최초 발견: {new Date(event.firstSeenAt).toLocaleString('ko-KR')}</span>
            <span>분석 모델: {event.geminiModelUsed || 'gemini-3.7-flash'}</span>
          </div>

        </div>

        {/* Footer Actions (Admin Controls) */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center flex-wrap gap-1">
            {event.relatedBusinesses.slice(0, 3).map((b, idx) => (
              <span key={idx} className="text-xs text-cyan-400">#{b}</span>
            ))}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Preview Telegram */}
            {onPreviewTelegram && (
              <button
                onClick={() => onPreviewTelegram(event)}
                className="flex items-center px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                title="텔레그램 메시지 서식 미리보기"
              >
                <Eye className="w-3.5 h-3.5 mr-1 text-slate-400" />
                <span className="hidden sm:inline">미리보기</span>
              </button>
            )}

            {/* AI Reanalyze */}
            <button
              onClick={handleReanalyze}
              disabled={isReanalyzing}
              className="flex items-center px-2.5 sm:px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 hover:text-purple-200 text-xs font-semibold border border-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
              title="Gemini 모델로 다시 분석합니다"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReanalyzing ? 'animate-spin' : 'mr-1'}`} />
              <span>{isReanalyzing ? '분석중...' : 'AI 재분석'}</span>
            </button>

            {/* Send Telegram */}
            <button
              onClick={handleSend}
              disabled={isSending}
              className={`flex items-center px-3 sm:px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50 cursor-pointer ${
                event.isSentToTelegram
                  ? 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-800/60'
                  : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-600/30'
              }`}
              title="개인 Telegram으로 이 알림을 발송합니다"
            >
              <Send className={`w-3.5 h-3.5 ${isSending ? 'animate-bounce' : 'mr-1.5'}`} />
              <span>{isSending ? '전송중...' : event.isSentToTelegram ? '재전송' : '텔레그램 전송'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
