import React, { useState } from 'react';
import { X, Send, Copy, Check, Smartphone, ExternalLink } from 'lucide-react';
import { NewsEvent } from '../types';

interface TelegramPreviewModalProps {
  event: NewsEvent | null;
  onClose: () => void;
  onSend: (id: string) => Promise<void>;
}

export const TelegramPreviewModal: React.FC<TelegramPreviewModalProps> = ({
  event,
  onClose,
  onSend,
}) => {
  const [copied, setCopied] = useState(false);
  const [isSending, setIsSending] = useState(false);

  if (!event) return null;

  const stars = '★'.repeat(event.importance) + '☆'.repeat(5 - event.importance);
  const categoryBadge = event.category ? ` [${event.category}]` : '';

  // Verified Facts bullet points
  const factsList = (event.factualPoints && event.factualPoints.length > 0)
    ? event.factualPoints
    : (event.summaryBulletPoints && event.summaryBulletPoints.length > 0)
    ? event.summaryBulletPoints
    : [];

  let bulletPoints = '';
  if (factsList.length > 0) {
    bulletPoints = factsList
      .slice(0, 2)
      .map(p => {
        const trimmed = p.trim();
        return trimmed.startsWith('•') || trimmed.startsWith('-') ? trimmed : `• ${trimmed}`;
      })
      .join('\n');
  } else {
    bulletPoints = `• ${event.title}`;
  }

  if (bulletPoints.length > 250) {
    bulletPoints = bulletPoints.slice(0, 240) + '...';
  }

  const sourceName = event.primarySource?.name || '공식/외신 출처';
  const primaryUrl = event.primarySource?.url || '';

  const rawMessageText = `${stars}${categoryBadge}

${event.title}

${bulletPoints}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(rawMessageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendNow = async () => {
    setIsSending(true);
    try {
      await onSend(event.id);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-2">
            <Smartphone className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-bold text-white">
              Telegram 알림 서식 미리보기
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Telegram Chat Simulation Window */}
        <div className="p-5 bg-gradient-to-b from-[#0f172a] to-[#0b0f19] max-h-[70vh] overflow-y-auto">
          
          <div className="flex items-center justify-center mb-3">
            <span className="text-[11px] font-medium text-slate-400 bg-slate-800/80 px-2.5 py-0.5 rounded-full border border-slate-700">
              오늘, {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Telegram Chat Bubble */}
          <div className="bg-[#1e293b] border border-cyan-900/30 rounded-2xl rounded-tl-sm p-4 text-slate-100 shadow-xl space-y-3 font-sans text-[13px] leading-relaxed">
            
            {/* Stars Rating & Category */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-amber-400 font-bold text-sm tracking-wide">
                {stars}
              </span>
              {event.category && (
                <span className="text-cyan-400 font-semibold text-xs bg-cyan-950/60 border border-cyan-800/40 px-1.5 py-0.5 rounded">
                  [{event.category}]
                </span>
              )}
            </div>

            {/* Title */}
            <div className="text-sm font-bold text-white leading-snug">
              {event.title}
            </div>

            {/* Summary Bullet Points (Direct, no '팩트' label header) */}
            <div className="text-slate-200 text-xs leading-relaxed whitespace-pre-line">
              {bulletPoints}
            </div>

            {/* Inline Buttons Preview (Source navigation via button, no '출처' text line) */}
            {primaryUrl && (
              <div className="pt-2">
                <a
                  href={primaryUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-[#334155] hover:bg-[#475569] text-cyan-300 text-xs font-semibold transition-colors"
                >
                  <span>🔗 {sourceName} 원문 기사 ↗</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

          </div>

        </div>

        {/* Modal Footer Controls */}
        <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-900 flex items-center justify-between gap-3">
          
          <button
            onClick={handleCopy}
            className="flex items-center px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
                <span>복사 완료!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                <span>텍스트 복사</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white cursor-pointer"
            >
              닫기
            </button>
            <button
              onClick={handleSendNow}
              disabled={isSending}
              className="flex items-center px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md shadow-cyan-600/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Send className={`w-3.5 h-3.5 mr-1.5 ${isSending ? 'animate-spin' : ''}`} />
              <span>{isSending ? '전송중...' : '텔레그램으로 바로 보내기'}</span>
            </button>
          </div>

        </div>

      </div>
    </div>
  );
};
