import React from 'react';
import { Newspaper, Flame, Send, Cpu } from 'lucide-react';
import { SystemStatus, NewsEvent } from '../types';

interface StatsOverviewProps {
  status: SystemStatus | null;
  events: NewsEvent[];
  onFilterHighPriority: () => void;
  onFilterTelegramSent: () => void;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({
  events,
  onFilterHighPriority,
  onFilterTelegramSent,
}) => {
  const highPriorityCount = events.filter(e => e.importance >= 4).length;
  const telegramSentCount = events.filter(e => e.isSentToTelegram).length;
  const positiveCount = events.filter(e => e.impact === 'positive').length;
  const negativeCount = events.filter(e => e.impact === 'negative').length;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
      
      {/* 1. Total Clustered Events */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 relative overflow-hidden backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">통합 인텔리전스</span>
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Newspaper className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-white">{events.length}</span>
          <span className="text-xs text-slate-400">건의 사건</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400 truncate">
          복수 매체 교차검증 & 클러스터링
        </p>
      </div>

      {/* 2. High Importance Events (4~5 Stars) */}
      <div 
        onClick={onFilterHighPriority}
        className="bg-slate-900/70 border border-amber-900/40 hover:border-amber-700/60 rounded-xl p-4 relative overflow-hidden backdrop-blur-sm cursor-pointer transition-all hover:bg-slate-800/80 group"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-amber-300 flex items-center gap-1">
            <Flame className="w-3.5 h-3.5 text-amber-400" />
            핵심 중요 뉴스 (4~5★)
          </span>
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:scale-105 transition-transform">
            <span className="text-xs font-bold">🚨 5★</span>
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-amber-400">{highPriorityCount}</span>
          <span className="text-xs text-amber-200/70">건 포착</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400 truncate">
          초대형 수주 · 실적 · FSD · 정부계약
        </p>
      </div>

      {/* 3. Telegram Alerts Sent */}
      <div 
        onClick={onFilterTelegramSent}
        className="bg-slate-900/70 border border-cyan-900/40 hover:border-cyan-700/60 rounded-xl p-4 relative overflow-hidden backdrop-blur-sm cursor-pointer transition-all hover:bg-slate-800/80 group"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-cyan-300 flex items-center gap-1">
            <Send className="w-3.5 h-3.5 text-cyan-400" />
            Telegram 알림 발송
          </span>
          <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 group-hover:scale-105 transition-transform">
            <span className="text-xs font-bold text-rose-300">🚨 5★</span>
          </div>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-cyan-400">{telegramSentCount}</span>
          <span className="text-xs text-slate-400">/ {events.length}</span>
        </div>
        <p className="mt-1 text-[11px] text-slate-400 truncate">
          중요도 5점(★★★★★) 전용 자동 알림
        </p>
      </div>

      {/* 4. AI & Impact Sentiment Ratio */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 relative overflow-hidden backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400 flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            기업가치 영향 분석
          </span>
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
            Gemini
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center gap-1 text-emerald-400 font-bold text-lg">
            <span>+{positiveCount}</span>
            <span className="text-xs font-normal text-emerald-300/80">호재</span>
          </div>
          <div className="text-slate-600">/</div>
          <div className="flex items-center gap-1 text-rose-400 font-bold text-lg">
            <span>-{negativeCount}</span>
            <span className="text-xs font-normal text-rose-300/80">악재</span>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-slate-400 truncate">
          교차 기업별 개별 손익 영향 산출
        </p>
      </div>

    </div>
  );
};
