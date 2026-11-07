import React, { useMemo, useState } from 'react';
import { companyQuestions, displayText } from './companyQuestions.mjs';
import './timeline.css';

type Item = { statement: any; matchedTerms: string[]; date: { value: string | null; basis: string; label: string }; metrics: string[] };

const fmt = (d: string | null) => (d ? d.replace(/-/g, '.') : '날짜 미확인');
const month = (d: string) => d.slice(0, 7).replace('-', '.');

function Metrics({ values }: { values: string[] }) {
  if (!values.length) return null;
  return <div className="tl-metrics">{values.map(m => <span key={m}>{m}</span>)}</div>;
}

function Source({ s }: { s: any }) {
  const e = (s.evidence || [])[0];
  return e?.url ? <a className="tl-source" href={e.url} target="_blank" rel="noreferrer">{e.sourceName || '출처'} ↗</a> : null;
}

function Body({ s, open = false }: { s: any; open?: boolean }) {
  const t = displayText(s);
  if (s.kind === 'video_quote') {
    return <>
      <p className="tl-text">{t.kind === 'ai_translation' ? t.text : <span lang="en">{t.text}</span>}</p>
      <span className="tl-tag">영상 자막에서 확인한 발언{t.kind === 'ai_translation' ? ' · AI 번역' : ''}{s.videoTitle ? ` · ${s.videoTitle}` : ''}</span>
      <details className="tl-original" open={open}><summary>원문 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>
    </>;
  }
  if (s.kind === 'social_post') {
    const ko = t.kind === 'ai_translation';
    return <>
      <p className="tl-text">{ko ? t.text : <span lang="en">{t.text}</span>}</p>
      <span className="tl-tag">본인 X 게시물{ko ? ' · AI 번역' : ' · 원문'}</span>
      {ko && <details className="tl-original" open={open}><summary>원문 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>}
    </>;
  }
  if (s.kind === 'reported_excerpt') {
    return <><p className="tl-text tl-en" lang={s.quoteLanguage || 'en'}>“{t.text}”</p><span className="tl-tag tl-warn">기사 요약 속 인용 · 공식 원문 아님{s.context ? ` · 기사: ${s.context}` : ''}</span></>;
  }
  if (s.kind === 'reported_headline') {
    const ko = t.kind === 'ai_translation';
    return <><p className={'tl-text' + (ko ? '' : ' tl-en')} lang={ko ? 'ko' : 'en'}>{t.text}</p><span className="tl-tag tl-warn">{ko ? 'AI 번역 · ' : ''}언론 보도 헤드라인 · 직접 인용 아님{s.reportedSourceCount > 1 ? ` · ${s.reportedSourceCount}개 매체` : ''}</span>
      {ko && <details className="tl-original" open={open}><summary>원문 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>}
      {Array.isArray(s.relatedHeadlines) && s.relatedHeadlines.length > 0 && <details className="tl-original"><summary>같은 내용의 다른 헤드라인 {s.relatedHeadlines.length}건</summary><ul className="tl-related">{s.relatedHeadlines.map((h: string) => <li key={h} lang="en">{h}</li>)}</ul></details>}</>;
  }
  if (t.kind === 'original') {
    return <><p className="tl-text tl-en" lang="en">{t.text}</p><span className="tl-tag">원문 · 한국어 번역 없음</span></>;
  }
  return <>
    <p className="tl-text">{t.text}</p>
    <span className="tl-tag">{t.kind === 'translation' ? '검토된 번역' : 'AI 요약 제목'}</span>
    <details className="tl-original" open={open}><summary>원문 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>
  </>;
}

export function CeoTimeline({ dataset }: { dataset: any }) {
  // 인물 단위로 묶음(머스크: Tesla·SpaceX를 한 화면에). 질문은 회사별로 나뉘어 표시됨
  const scopes = useMemo(() => {
    const seen = new Map<string, any>();
    for (const r of dataset.roles || []) {
      const person = (dataset.persons || []).find((p: any) => p.personId === r.personId);
      const cur = seen.get(r.personId) || { key: r.personId, personId: r.personId, companyIds: [] as string[], companies: [] as string[], name: person?.displayName || r.personId, count: 0 };
      if (!cur.companyIds.includes(r.companyId)) { cur.companyIds.push(r.companyId); cur.companies.push(r.companyName); }
      seen.set(r.personId, cur);
    }
    for (const s of seen.values()) {
      s.company = [...new Set(s.companies)].join('·');
      s.count = (dataset.statements || []).filter((x: any) => x.personId === s.personId && s.companyIds.includes(x.companyId)).length;
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [dataset]);

  const [scopeKey, setScopeKey] = useState(scopes.find(s => s.count)?.key || scopes[0]?.key || '');
  const scope = scopes.find(s => s.key === scopeKey);
  const result = useMemo(() => scope ? companyQuestions(dataset.statements, scope.personId, scope.companyIds) : { questions: [], other: [], excludedCount: 0, total: 0 }, [dataset, scope]);
  const [questionId, setQuestionId] = useState<string>('');
  const q = result.questions.find((x: any) => x.id === questionId) || result.questions[0];

  const items: Item[] = q?.items || [];
  // 목록은 최신순(날짜 미확인은 맨 아래). 분류·비교 로직은 그대로 오래된 순 데이터를 씁니다.
  const newestFirst = [...items].sort((a, b) => (b.date.value || '').localeCompare(a.date.value || ''));

  const pickScope = (k: string) => { setScopeKey(k); setQuestionId(''); };
  const pickQuestion = (id: string) => setQuestionId(id);

  return <section className="ceo-tl">
    <header className="tl-head">
      <div className="tl-scopes" role="tablist" aria-label="인물 · 회사">
        {scopes.map(s => <button key={s.key} role="tab" aria-selected={s.key === scopeKey} className={'tl-chip' + (s.key === scopeKey ? ' on' : '')} onClick={() => pickScope(s.key)} disabled={!s.count}>
          {s.name} · {s.company}<span>{s.count ? s.count + '건' : '자료 없음'}</span>
        </button>)}
      </div>
    </header>

    {!result.questions.length ? <p className="tl-empty">이 인물·회사로 분류할 수 있는 발언이 아직 없습니다. 다른 회사의 발언으로 채우지 않습니다.</p> :
    <div className="tl-layout">
      <nav className="tl-questions" aria-label="비교할 질문">
        <h2>질문</h2>
        {result.questions.map((x: any) => <button key={x.id} className={'tl-q' + (x.id === q?.id ? ' on' : '')} onClick={() => pickQuestion(x.id)} aria-pressed={x.id === q?.id}>
          <strong>{x.label}</strong>
          <small>{x.items.length}건{x.range ? ' · ' + month(x.range[0]) + (x.range[1] !== x.range[0] ? ' → ' + month(x.range[1]) : '') : ''}</small>
          {!x.comparable && <em>변화 비교 자료 부족</em>}
        </button>)}
      </nav>

      <main className="tl-main">
        <div className="tl-qhead"><h2>{q.label}</h2><p className="tl-muted">{q.hint} · 원문 단어로 분류 · {items.length}건 · 최신순</p></div>

        {!q.comparable && <p className="tl-notice">날짜가 다른 발언이 2건 이상 있어야 변화를 비교할 수 있습니다.</p>}

        <ol className="tl-list">
          {newestFirst.map(x => {
            const s = x.statement;
            return <li key={s.statementId}>
              <div className="tl-date"><strong>{fmt(x.date.value)}</strong><small>{x.date.label}</small></div>
              <div className="tl-card">
                <Body s={s} />
                <Metrics values={x.metrics} />
                <div className="tl-foot">
                  <Source s={s} />
                </div>
              </div>
            </li>;
          })}
        </ol>


        {(result.other.length > 0 || result.excludedCount > 0) && <details className="tl-other">
          <summary>질문에 분류되지 않은 발언 {result.other.length}건{result.excludedCount ? ` · 인사말·편집자 주 ${result.excludedCount}건 제외` : ''}</summary>
          <ul>{result.other.map((s: any) => <li key={s.statementId}><span className="tl-muted">{fmt(s.referenceDate?.value || s.spokenAt?.value || null)}</span> {displayText(s).text}</li>)}</ul>
        </details>}
      </main>
    </div>}
  </section>;
}
