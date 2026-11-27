import {useLang} from '../i18n';
import type {IssueFlow} from '../newsFeed';
import type {NewsEvent} from '../types';

export function NewsIssueOverview({flows, events, onOpenDetail}: {
  flows: Map<string, IssueFlow>;
  events: NewsEvent[];
  onOpenDetail: (event: NewsEvent) => void;
}) {
  const {t, lang, locale} = useLang();
  const topics = [...new Set(events.flatMap(event => {
    const flow = flows.get(event.id);
    return flow ? [flow] : [];
  }))];
  if (!topics.length) return null;
  const date = new Intl.DateTimeFormat(locale, {timeZone: 'Asia/Seoul', month: 'short', day: 'numeric'});
  const language = lang === 'en' ? 1 : 0;

  return <section aria-labelledby="news-issue-overview" className="mb-3 space-y-2 rounded-xl border border-slate-700 bg-slate-900/90 p-3 sm:mb-4 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <h2 id="news-issue-overview" className="text-sm font-semibold text-white">{t('이슈 흐름', 'Issue timeline')}</h2>
      <span className="text-xs text-slate-400">{t('기사 보도일 기준', 'By publication date')}</span>
    </div>
    {topics.map((flow, index) => <details key={flow.title[1]} open={index === 0 || undefined} className="rounded-lg border border-slate-800">
      <summary className="min-h-11 cursor-pointer px-3 py-2.5 text-sm font-semibold text-cyan-200 focus-visible:outline-cyan-400">{flow.title[language]}</summary>
      <ol className="flex items-stretch gap-2 overflow-x-auto px-3 pb-3">
        {flow.entries.map((step, i) => <li key={step.id} className="flex shrink-0 items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="text-xs text-slate-400">→</span>}
          <button type="button" onClick={() => onOpenDetail(step.event)}
            className="h-full min-h-11 w-27 rounded-lg border border-slate-700 bg-slate-950/55 px-2 py-2 text-left hover:border-cyan-500 focus-visible:outline-2 focus-visible:outline-cyan-400 sm:w-36"
            aria-label={`${date.format(step.date)} · ${step.label[language]} · ${t('기사 보기', 'Read article')}`}>
            <time dateTime={new Date(step.date).toISOString()} className="block text-xs text-slate-400">{date.format(step.date)}</time>
            <span className="mt-0.5 block break-keep text-xs font-semibold text-slate-100 sm:text-sm">{step.label[language]}</span>
          </button>
        </li>)}
      </ol>
    </details>)}
  </section>;
}
