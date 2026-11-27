import {useEffect, useState} from 'react';
import type {MarketSession, PublicCommentary} from '../../server/marketSessions';
import {useLang} from '../i18n';
import {summaryPreview, parseSummary, summaryTopics} from './youtubeSummary.mjs';
import {upcomingMarketSchedule} from '../marketCalendar';

type RecentVideo = {id: string; title: string; publishedAt: number | null; status: string; programmes: string[]; summary: string | null};
const eastern = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});
const koreanTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function sessionVideos(videos: RecentVideo[], date: string) {
  return videos.filter(video => {
    if (video.status !== 'ready' || !video.summary || !video.publishedAt) return false;
    const [day, time] = eastern.format(video.publishedAt).split(' ');
    if (day !== date || time < '16:00') return false;
    return /(?:미국\s*(?:장|증시)|뉴욕\s*증시|(?:장|증시)\s*마감|나스닥|S\s*&\s*P\s*500)/i.test(video.summary.slice(0, 1200));
  });
}

export function MarketSessionCard({videos, programmes, onVideo}: {
  videos: RecentVideo[]; programmes: Record<string, string>; onVideo: (id: string) => void;
}) {
  const {t, lang} = useLang();
  const [data, setData] = useState<{sessions: MarketSession[]; commentary: PublicCommentary[]}>();
  const requested = new URLSearchParams(window.location.search).get('session');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/market/sessions', {signal: controller.signal}).then(async response => {
      if (response.ok) setData(await response.json());
    }).catch(() => {});
    return () => controller.abort();
  }, []);

  if (!data?.sessions.length) return null;
  const session = requested ? data.sessions.find(item => item.date === requested) : data.sessions[0];
  if (!session) return <p className="text-sm text-slate-300">{t('선택한 거래일의 시장 요약이 없습니다.', 'No market recap for this date.')}</p>;
  const matchedVideos = sessionVideos(videos, session.date);
  const leadVideo = matchedVideos[0];
  const next = upcomingMarketSchedule()[0];
  const related = data.commentary.find(video => {
    const age = Date.parse(session.date) - Date.parse(video.publishedAt.slice(0, 10));
    return age >= -86400_000 && age <= 7 * 86400_000;
  });

  return <details className="rounded-xl border border-slate-700 bg-slate-900/75 px-4" open={requested ? true : undefined}>
    <summary className="cursor-pointer py-3 focus-visible:outline-cyan-400">
      <span className="font-semibold text-white">{t('지난 미국장', 'US market recap')}</span>
      <span className="ml-2 text-xs text-slate-400">{session.date} ET</span>
      <span className="mt-1 block text-sm font-medium tabular-nums text-slate-200">
        {session.closes.map(quote => `${quote.symbol} ${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}%`).join(' · ')}
      </span>
      {leadVideo?.summary && <span className="mt-1 line-clamp-1 text-sm text-slate-300">{summaryPreview(leadVideo.summary, leadVideo.id)}</span>}
    </summary>
    <div className="space-y-3 border-t border-slate-800 py-3">
      <a className="text-xs text-slate-300 underline underline-offset-4" href="https://finance.yahoo.com/quote/%5ENDX/history/" target="_blank" rel="noopener noreferrer">{t('종가 출처 · Yahoo Finance', 'Closing data · Yahoo Finance')} ↗</a>
      {matchedVideos.map(video => {
        const firstTopic = summaryTopics(parseSummary(video.summary || '', video.id), video.id).find(topic => topic.time);
        return <div key={video.id} className="rounded-lg border border-slate-800 p-3">
          <p className="text-xs text-cyan-300">{video.programmes.map(id => programmes[id]).filter(Boolean).join(' · ')}</p>
          <button type="button" className="mt-1 block min-h-11 text-left text-sm font-semibold text-slate-100 hover:underline" onClick={() => onVideo(video.id)}>
            {video.title}
          </button>
          {firstTopic?.time && <a className="inline-flex min-h-11 items-center text-sm text-cyan-300" href={firstTopic.time.url} target="_blank" rel="noopener noreferrer">{firstTopic.time.text} {t('영상에서 보기', 'Watch segment')} ↗</a>}
        </div>;
      })}
      {related && <div className="rounded-lg border border-slate-800 p-3">
        <p className="text-xs text-cyan-300">{t('관련 공개 영상 · 위즈덤투스', 'Related public video · Wisdomtooth')} · {related.publishedAt.slice(0, 10)}</p>
        <a className="mt-1 inline-flex min-h-11 items-center text-sm text-slate-100 hover:underline" href={`https://www.youtube.com/watch?v=${related.id}`} target="_blank" rel="noopener noreferrer">{related.title} ↗</a>
      </div>}
      {next && <a className="inline-flex min-h-11 items-center text-sm text-cyan-300" href={next.source} target="_blank" rel="noopener noreferrer">
        {t('다음 발표', 'Next release')} · {next.names[lang === 'en' ? 1 : 0]} · {koreanTime.format(Date.parse(next.at))} KST ↗
      </a>}
    </div>
  </details>;
}
