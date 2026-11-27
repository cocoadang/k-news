import {useState} from 'react';
import {ChevronLeft, ChevronRight} from 'lucide-react';
import {useLang} from '../i18n';
import {calendarMonth, koreanMarketDateTime, marketSchedule} from '../marketCalendar';

const schedule = marketSchedule.map(event => ({...event, ...koreanMarketDateTime(event.at)}));
const months = [...new Set(schedule.map(event => event.date.slice(0, 7)))];
const buttonClass = 'inline-flex size-11 items-center justify-center rounded-lg border border-slate-700 text-slate-100 enabled:hover:bg-slate-800 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-cyan-400';

export function MarketScheduleCalendar() {
  const {t, lang, locale} = useLang();
  const today = koreanMarketDateTime(Date.now()).date;
  const next = schedule.find(event => Date.parse(event.at) > Date.now());
  const [date, setDate] = useState(next?.date ?? schedule.at(-1)!.date);
  const [month, setMonth] = useState(date.slice(0, 7));
  const monthIndex = months.indexOf(month);
  const {firstWeekday, days} = calendarMonth(month);
  const weekdayLabels = lang === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['일', '월', '화', '수', '목', '금', '토'];
  const monthLabel = new Intl.DateTimeFormat(locale, {timeZone: 'UTC', year: 'numeric', month: 'long'}).format(new Date(`${month}-01T00:00:00Z`));

  function moveMonth(change: number) {
    const target = months[monthIndex + change];
    if (!target) return;
    setMonth(target);
    setDate(schedule.find(event => event.date.startsWith(target))?.date ?? `${target}-01`);
  }

  return <section aria-label={t('주요 발표 달력', 'Major releases calendar')} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-white">{t('주요 발표 달력', 'Major releases calendar')} <span className="ml-1 text-xs font-normal text-slate-400">KST</span></h2>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={t('이전 달', 'Previous month')} className={buttonClass} disabled={monthIndex === 0} onClick={() => moveMonth(-1)}><ChevronLeft className="size-4" aria-hidden="true"/></button>
        <p aria-live="polite" className="min-w-24 text-center text-sm font-semibold tabular-nums">{monthLabel}</p>
        <button type="button" aria-label={t('다음 달', 'Next month')} className={buttonClass} disabled={monthIndex === months.length - 1} onClick={() => moveMonth(1)}><ChevronRight className="size-4" aria-hidden="true"/></button>
      </div>
    </div>
    <div className="mt-2 grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-800 bg-slate-800 text-center">
      {weekdayLabels.map(label => <span key={label} className="bg-slate-900 py-1.5 text-xs text-slate-400">{label}</span>)}
      {Array.from({length: Math.ceil((firstWeekday + days) / 7) * 7}, (_, i) => {
        const day = i - firstWeekday + 1;
        if (day < 1 || day > days) return <span key={i} className="bg-slate-950/60" aria-hidden="true"/>;
        const candidate = `${month}-${String(day).padStart(2, '0')}`;
        const events = schedule.filter(event => event.date === candidate);
        if (!events.length) return <span key={i} aria-current={candidate === today ? 'date' : undefined} className="flex min-h-11 items-center justify-center bg-slate-900/85 text-xs text-slate-400">{day}</span>;
        const label = events.map(event => event.names[lang === 'en' ? 1 : 0]).join(' · ');
        return <button type="button" key={i} aria-label={`${candidate} · ${label}`} aria-pressed={date === candidate} aria-current={candidate === today ? 'date' : undefined}
          className={`flex min-h-11 flex-col items-center justify-center gap-1 px-1 text-xs font-semibold focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-cyan-400 ${date === candidate ? 'bg-cyan-950 text-cyan-100' : 'bg-slate-900 text-cyan-200 hover:bg-slate-800'}`}
          onClick={() => setDate(candidate)}>
          {day}<span className="size-1 rounded-full bg-cyan-300 sm:hidden" aria-hidden="true"/>
          <span className="hidden w-full truncate sm:block" aria-hidden="true">{label}</span>
        </button>;
      })}
    </div>
    <ul aria-live="polite" className="mt-2 divide-y divide-slate-800 text-sm text-slate-200">
      {schedule.filter(event => event.date === date).map(event => <li key={event.at} className="flex flex-wrap items-center justify-between gap-x-3 py-1.5">
        <span>{event.names[lang === 'en' ? 1 : 0]}</span>
        <time dateTime={event.at} className="text-xs tabular-nums text-slate-300">{event.date} {event.time} KST</time>
      </li>)}
    </ul>
  </section>;
}
