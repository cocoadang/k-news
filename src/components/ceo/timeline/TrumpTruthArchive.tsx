import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../../../i18n';
import manifest from './truthSocialManifest.json';

const PAGE_SIZE = 25;
type Post = [id: string, timestamp: number, kind: 'p' | 'q' | 'r' | 'u', media: 0 | 1, archiveId: string];

function formatTime(timestamp: number) {
  return new Date((timestamp + 9 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

export function TrumpTruthArchive() {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(manifest[0].year);
  const [month, setMonth] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(0);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    setPosts(null);
    setFailed(false);
    async function load() {
      const response = await fetch('/truth-social/' + year + '.txt', { signal: request.signal });
      if (!response.ok) throw new Error('Archive request failed');
      const encoded = await response.text();
      const compressed = Uint8Array.from(atob(encoded.trim()), char => char.charCodeAt(0));
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
      const data = await new Response(stream).json() as Post[];
      if (!Array.isArray(data) || data.length !== manifest.find(entry => entry.year === year)?.count) {
        throw new Error('Unexpected archive size');
      }
      if (!request.signal.aborted) setPosts(data);
    }
    load().catch(() => { if (!request.signal.aborted) setFailed(true); });
    return () => request.abort();
  }, [open, year, attempt]);

  const matches = useMemo(() => (posts || []).filter(post =>
    (!kind || post[2] === kind) && (!month || formatTime(post[1]).slice(5, 7) === month)
  ), [posts, kind, month]);
  const total = manifest.reduce((sum, entry) => sum + entry.count, 0).toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR');
  const types = { p: t('본인 글', 'Original'), q: t('인용 게시물', 'Quote'), r: t('재게시', 'Repost'), u: t('유형 미확인', 'Unclassified') };
  const pages = Math.ceil(matches.length / PAGE_SIZE);

  return <details className="tl-card mb-4" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">{t('Truth Social 과거 게시물', 'Truth Social archive')} · {total}{t('건', ' posts')}</summary>
    {open && <div className="mt-3">
      <p className="tl-muted mb-3">{manifest.at(-1)?.first} ~ {manifest[0].last} (KST) · {t('공개 아카이브 기준', 'Public archive coverage')}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="flex items-center gap-1">{t('연도', 'Year')}
          <select className="rounded bg-slate-800 p-2 text-slate-100" value={year} onChange={event => { setPosts(null); setYear(Number(event.target.value)); setMonth(''); setPage(0); }}>
            {manifest.map(entry => <option key={entry.year} value={entry.year}>{entry.year} ({entry.count.toLocaleString()})</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">{t('월', 'Month')}
          <select className="rounded bg-slate-800 p-2 text-slate-100" value={month} onChange={event => { setMonth(event.target.value); setPage(0); }}>
            <option value="">{t('전체', 'All')}</option>
            {Array.from({ length: 12 }, (_, index) => index + 1).map(value => <option key={value} value={String(value).padStart(2, '0')}>{value}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">{t('유형', 'Type')}
          <select className="rounded bg-slate-800 p-2 text-slate-100" value={kind} onChange={event => { setKind(event.target.value); setPage(0); }}>
            <option value="">{t('전체', 'All')}</option>
            {Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      {failed ? <p role="alert">{t('게시물 목록을 불러오지 못했습니다.', 'Could not load the archive.')} <button type="button" className="tl-chip" onClick={() => setAttempt(value => value + 1)}>{t('다시 시도', 'Retry')}</button></p>
        : !posts ? <p role="status">{t('불러오는 중…', 'Loading…')}</p>
        : <>
          <p className="tl-muted" role="status">{matches.length.toLocaleString()}{t('건', ' posts')}</p>
          <ul className="divide-y divide-slate-800">
            {matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(([id, time, postKind, media, archiveId]) =>
              <li key={id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span><time dateTime={new Date(time * 1000).toISOString()}>{formatTime(time)}</time> · {types[postKind]}{media ? t(' · 첨부 미디어', ' · Media attached') : ''}</span>
                <span className="flex gap-3">
                  <a className="tl-source" href={'https://truthsocial.com/@realDonaldTrump/' + id} aria-label={t('Truth Social 원문 ', 'Original Truth Social post ') + id} target="_blank" rel="noreferrer">{t('원문', 'Original')} ↗</a>
                  {archiveId && <a className="tl-source" href={'https://trumpstruth.org/statuses/' + archiveId} target="_blank" rel="noreferrer">{t('보관본', 'Archived copy')} ↗</a>}
                </span>
              </li>
            )}
          </ul>
          {pages > 1 && <nav aria-label={t('게시물 페이지', 'Archive pages')} className="mt-3 flex items-center justify-center gap-3">
            <button type="button" disabled={page === 0} className="tl-chip" onClick={() => setPage(page - 1)}>{t('이전', 'Previous')}</button>
            <span>{page + 1} / {pages}</span>
            <button type="button" disabled={page === pages - 1} className="tl-chip" onClick={() => setPage(page + 1)}>{t('다음', 'Next')}</button>
          </nav>}
        </>}
    </div>}
  </details>;
}
