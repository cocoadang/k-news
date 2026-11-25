import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLang } from '../../../i18n';
import portraits from './portraits.json';

type Person = { id: string; name: string; company: string; disabled: boolean };
const portraitIds = new Set(portraits);

function Portrait({ person }: { person: Person }) {
  const [failed, setFailed] = useState(false);
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('');
  return <span className="tl-person-avatar" aria-hidden="true">
    <span>{initials}</span>
    {portraitIds.has(person.id) && !failed && <img
      src={`/ceo-portraits/${person.id}.webp`}
      alt=""
      width={112}
      height={112}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />}
  </span>;
}

export function CeoPersonPicker({ people, selected, onSelect }: {
  people: Person[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { t } = useLang();
  const rail = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  useEffect(() => {
    const list = rail.current;
    if (!list) return;
    const update = () => {
      const start = list.scrollLeft < 2;
      const end = list.scrollWidth - list.clientWidth - list.scrollLeft < 2;
      setEdges(old => old.start === start && old.end === end ? old : { start, end });
    };
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      list.removeEventListener('scroll', update);
    };
  }, [people.length]);

  const move = (direction: number) => {
    const list = rail.current;
    if (!list) return;
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    list.scrollBy({ left: direction * list.clientWidth * 0.8, behavior });
  };

  return <section className="tl-head tl-person-picker" aria-label={t('인물 선택', 'Select a person')}>
    <div className="tl-person-picker-head">
      <a className="tl-photo-credits" href="/ceo-portraits/credits.html" target="_blank" rel="noreferrer">
        {t('사진 출처', 'Photo credits')}
      </a>
      <div className="tl-person-arrows">
        <button type="button" aria-label={t('앞 인물 목록', 'Previous people')} disabled={edges.start} onClick={() => move(-1)}>
          <ChevronLeft size={18} aria-hidden="true"/>
        </button>
        <button type="button" aria-label={t('뒤 인물 목록', 'Next people')} disabled={edges.end} onClick={() => move(1)}>
          <ChevronRight size={18} aria-hidden="true"/>
        </button>
      </div>
    </div>
    <ul className="tl-people" ref={rail}>
      {people.map(person => <li key={person.id}>
        <button type="button" className="tl-person" disabled={person.disabled}
          aria-label={`${person.name} · ${person.company}`} aria-pressed={selected === person.id}
          onClick={() => onSelect(person.id)}>
          <Portrait person={person}/>
          <span className="tl-person-name">{person.name}</span>
        </button>
      </li>)}
    </ul>
  </section>;
}
