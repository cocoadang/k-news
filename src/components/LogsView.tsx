import React from 'react';
import { Terminal, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Info, AlertOctagon } from 'lucide-react';
import { MonitorLog } from '../types';

interface LogsViewProps {
  logs: MonitorLog[];
  onRefresh: () => void;
  onClear: () => void;
}

export const LogsView: React.FC<LogsViewProps> = ({ logs, onRefresh, onClear }) => {
  const getLevelBadge = (level: MonitorLog['level']) => {
    switch (level) {
      case 'success':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
            <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
            SUCCESS
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
            <AlertOctagon className="w-2.5 h-2.5 mr-1" />
            ERROR
          </span>
        );
      case 'warn':
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800">
            <AlertTriangle className="w-2.5 h-2.5 mr-1" />
            WARN
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
            <Info className="w-2.5 h-2.5 mr-1" />
            INFO
          </span>
        );
    }
  };

  const getModuleBadge = (mod: MonitorLog['module']) => {
    const colors: Record<string, string> = {
      Collector: 'text-cyan-400 bg-cyan-950/70 border-cyan-800',
      Gemini: 'text-purple-400 bg-purple-950/70 border-purple-800',
      Telegram: 'text-blue-400 bg-blue-950/70 border-blue-800',
      Scheduler: 'text-amber-400 bg-amber-950/70 border-amber-800',
      System: 'text-slate-400 bg-slate-800 border-slate-700',
    };
    const c = colors[mod] || colors.System;
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border ${c}`}>
        {mod}
      </span>
    );
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      {/* Log Console Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/70">
        <div className="flex items-center space-x-2">
          <Terminal className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-bold text-white">
            실시간 시스템 & 수집·AI 분석 로그 ({logs.length})
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors text-xs flex items-center gap-1"
            title="새로고침"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>새로고침</span>
          </button>
          <button
            onClick={onClear}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-800 transition-colors text-xs flex items-center gap-1"
            title="로그 비우기"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>로그 삭제</span>
          </button>
        </div>
      </div>

      {/* Log Feed Console */}
      <div className="p-4 bg-slate-950/90 font-mono text-xs max-h-[600px] overflow-y-auto space-y-2">
        {logs.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            기록된 로그가 없습니다.
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-2.5 p-2 rounded hover:bg-slate-900/80 transition-colors border border-transparent hover:border-slate-800"
            >
              <span className="text-slate-500 shrink-0 select-none">
                {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <div className="shrink-0">{getLevelBadge(log.level)}</div>
              <div className="shrink-0">{getModuleBadge(log.module)}</div>
              <span className="text-slate-300 break-all leading-relaxed flex-1">
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
