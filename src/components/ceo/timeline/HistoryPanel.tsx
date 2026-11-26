import { type ReactNode } from 'react';
import { useLang } from '../../../i18n';

type HistoryTopic = { id: string; label: string; badge?: string };

export function HistoryPanel({ title, topics, activeId, onSelect, metadata, note, children }: {
  title: string;
  topics: HistoryTopic[];
  activeId: string;
  onSelect: (id: string) => void;
  metadata?: string;
  note?: string;
  children: ReactNode;
}) {
  const { t } = useLang();
  return <section aria-label={title} className="tl-history tl-card">
    <div role="group" aria-label={t('비교 주제', 'Comparison topics')} className="tl-scopes tl-history-topics" data-topic-count={topics.length}>
      {topics.map(topic => <button type="button" key={topic.id}
        className={'tl-chip' + (topic.id === activeId ? ' on' : '')}
        aria-pressed={topic.id === activeId} onClick={() => onSelect(topic.id)}>
        {topic.label}{topic.badge && <span className="tl-topic-badge">{topic.badge}</span>}
      </button>)}
    </div>
    {metadata && <p className="tl-muted tl-history-meta">{metadata}</p>}
    {note && <p className="tl-notice">{note}</p>}
    <ol className="tl-list">{children}</ol>
  </section>;
}

export function HistoryEntry({ date, dateLabel, dateBasis, source, children }: {
  date: string | null;
  dateLabel: string;
  dateBasis?: string;
  source?: ReactNode;
  children: ReactNode;
}) {
  return <li>
    <div className="tl-date">
      <strong title={dateBasis}>{date ? <time dateTime={date}>{dateLabel}</time> : dateLabel}</strong>
    </div>
    <div className="tl-card">
      {children}
      {source && <div className="tl-foot">{source}</div>}
    </div>
  </li>;
}
