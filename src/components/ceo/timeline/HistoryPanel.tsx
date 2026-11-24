import { useId, type ReactNode } from 'react';
import { useLang } from '../../../i18n';

type HistoryTopic = { id: string; label: string; badge?: string };

export function HistoryPanel({ title, topics, activeId, onSelect, topicTitle, summary, metadata, note, evidence, children }: {
  title: string;
  topics: HistoryTopic[];
  activeId: string;
  onSelect: (id: string) => void;
  topicTitle: string;
  summary?: string;
  metadata?: string;
  note?: string;
  evidence?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  const { t } = useLang();
  return <section aria-labelledby={id} className="tl-history tl-card">
    <h2 id={id}>{title}</h2>
    <div role="group" aria-label={t('비교 주제', 'Comparison topics')} className="tl-scopes tl-history-topics">
      {topics.map(topic => <button type="button" key={topic.id}
        className={'tl-chip' + (topic.id === activeId ? ' on' : '')}
        aria-pressed={topic.id === activeId} onClick={() => onSelect(topic.id)}>
        {topic.label}{topic.badge && <span className="tl-topic-badge">{topic.badge}</span>}
      </button>)}
    </div>
    <div className="tl-history-heading">
      <h3>{topicTitle}</h3>
      {summary && <p>{summary}</p>}
      {metadata && <p className="tl-muted">{metadata}</p>}
    </div>
    {note && <p className="tl-notice">{note}</p>}
    {evidence}
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
      <strong>{date ? <time dateTime={date}>{dateLabel}</time> : dateLabel}</strong>
      {dateBasis && <small>{dateBasis}</small>}
    </div>
    <div className="tl-card">
      {children}
      {source && <div className="tl-foot">{source}</div>}
    </div>
  </li>;
}
