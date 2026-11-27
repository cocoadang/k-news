import {useLang} from '../i18n';
import {marketSchedule, upcomingMarketSchedule} from '../marketCalendar';

const seoul = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function MarketScheduleStrip() {
  const {t, lang} = useLang();
  const now = Date.now();
  const upcoming = upcomingMarketSchedule(now);
  const next = upcoming[0];
  if (!next) return null;
  const recent = marketSchedule.filter(event => Date.parse(event.at) <= now && now - Date.parse(event.at) < 7 * 86400_000).at(-1);
  const name = (event: typeof next) => event.names[lang === 'en' ? 1 : 0];
  const format = (at: string) => `${seoul.format(Date.parse(at))} KST`;
  return <details className="rounded-lg border border-slate-800 bg-slate-900/60 px-3">
    <summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-300 focus-visible:outline-cyan-400">
      <span className="font-semibold text-slate-100">{t('다음 주요 발표', 'Next major release')}</span> · {name(next)} · {format(next.at)}
    </summary>
    <ul className="divide-y divide-slate-800 border-t border-slate-800 text-sm">
      {upcoming.filter(event => Date.parse(event.at) - Date.parse(next.at) <= 7 * 86400_000).slice(0, 3).map(event => (
        <li key={event.at}>
          <a className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 py-2 text-cyan-200 hover:underline" href={event.source} target="_blank" rel="noopener noreferrer">
            <span>{name(event)} ↗</span><span className="text-xs text-slate-300">{format(event.at)}</span>
          </a>
        </li>
      ))}
      {recent && <li className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 py-2">
        <a className="text-cyan-200 hover:underline" href={recent.source} target="_blank" rel="noopener noreferrer">
          {name(recent)} · {t('공식 일정', 'Official schedule')} ↗
        </a>
        <a className="text-cyan-200 hover:underline" href={`/?session=${recent.at.slice(0, 10)}`}>
          {t('거래일 복기', 'Session recap')} →
        </a>
      </li>}
    </ul>
  </details>;
}
