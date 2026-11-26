import { UsersRound, X } from 'lucide-react';
import { useId, useRef, useState, type PointerEvent } from 'react';
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
  const list = useRef<HTMLUListElement>(null);
  const directory = useRef<HTMLDialogElement>(null);
  const directoryTitle = useId();
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

  const pickFromDirectory = (id: string) => {
    directory.current?.close();
    onSelect(id);
    const strip = list.current;
    const button = strip?.querySelector<HTMLButtonElement>(`button[data-person="${CSS.escape(id)}"]`);
    if (strip && button) {
      strip.scrollLeft += button.getBoundingClientRect().left - strip.getBoundingClientRect().left - 4;
    }
  };

  return <section className="tl-head tl-person-picker" aria-label={t('인물 선택', 'Select a person')}>
    <ul ref={list} className={dragging ? 'tl-people is-dragging' : 'tl-people'}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
      onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onPointerLeave={event => { if (!drag.current?.moved) endDrag(event); }}>
      {people.map(person => <li key={person.id}>
        <button type="button" className="tl-person" data-person={person.id} disabled={person.disabled}
          aria-label={`${person.name} · ${person.company}`} aria-pressed={selected === person.id}
          onClick={() => onSelect(person.id)}>
          <Portrait person={person}/>
          <span className="tl-person-name">{person.name}</span>
        </button>
      </li>)}
    </ul>
    <button type="button" className="tl-all-people" aria-haspopup="dialog"
      onClick={() => directory.current?.showModal()}>
      <UsersRound size={19} aria-hidden="true"/>
      <span>{t('전체 인물', 'All people')}</span>
    </button>
    <dialog ref={directory} className="tl-directory" aria-labelledby={directoryTitle}>
      <header>
        <h2 id={directoryTitle}>{t('전체 인물', 'All people')}</h2>
        <form method="dialog">
          <button className="tl-directory-close" aria-label={t('닫기', 'Close')} autoFocus>
            <X size={21} aria-hidden="true"/>
          </button>
        </form>
      </header>
      <ul className="tl-directory-list">
        {people.map(person => <li key={person.id}>
          <button type="button" disabled={person.disabled} aria-pressed={selected === person.id}
            onClick={() => pickFromDirectory(person.id)}>
            <Portrait person={person}/>
            <span><strong>{person.name}</strong><small>{person.company}</small></span>
          </button>
        </li>)}
      </ul>
    </dialog>
  </section>;
}
