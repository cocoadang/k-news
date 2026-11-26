import { useRef, useState, type PointerEvent } from 'react';
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
      draggable={false}
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
  const drag = useRef<{ pointer: number; x: number; scroll: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const startDrag = (event: PointerEvent<HTMLUListElement>) => {
    const list = event.currentTarget;
    if (event.pointerType !== 'mouse' || event.button !== 0 || list.scrollWidth <= list.clientWidth) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, scroll: list.scrollLeft, moved: false };
  };
  const moveDrag = (event: PointerEvent<HTMLUListElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    const distance = event.clientX - start.x;
    if (!start.moved) {
      if (Math.abs(distance) < 6) return;
      start.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    event.currentTarget.scrollLeft = start.scroll - distance;
  };
  const endDrag = (event: PointerEvent<HTMLUListElement>) => {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  return <section className="tl-head tl-person-picker" aria-label={t('인물 선택', 'Select a person')}>
    <ul className={dragging ? 'tl-people is-dragging' : 'tl-people'}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
      onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onPointerLeave={event => { if (!drag.current?.moved) endDrag(event); }}>
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
