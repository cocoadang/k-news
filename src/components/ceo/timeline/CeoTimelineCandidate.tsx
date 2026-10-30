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
  if (s.kind === 'reported_headline') {
    return <><p className="tl-text tl-en" lang="en">{t.text}</p><span className="tl-tag tl-warn">언론 보도 헤드라인 · 직접 인용 아님{s.reportedSourceCount > 1 ? ` · ${s.reportedSourceCount}개 매체` : ''}</span></>;
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
  const scopes = useMemo(() => {
    const seen = new Map<string, any>();
    for (const r of dataset.roles || []) {
      const key = r.personId + '|' + r.companyId;
      if (seen.has(key)) continue;
      const person = (dataset.persons || []).find((p: any) => p.personId === r.personId);
      const count = (dataset.statements || []).filter((s: any) => s.personId === r.personId && s.companyId === r.companyId).length;
      seen.set(key, { key, personId: r.personId, companyId: r.companyId, name: person?.displayName || r.personId, company: r.companyName, count });
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [dataset]);

  const [scopeKey, setScopeKey] = useState(scopes.find(s => s.count)?.key || scopes[0]?.key || '');
  const scope = scopes.find(s => s.key === scopeKey);
  const result = useMemo(() => scope ? companyQuestions(dataset.statements, scope.personId, scope.companyId) : { questions: [], other: [], excludedCount: 0, total: 0 }, [dataset, scope]);
  const [questionId, setQuestionId] = useState<string>('');
  const q = result.questions.find((x: any) => x.id === questionId) || result.questions[0];
  const [pair, setPair] = useState<string[]>([]);

  const items: Item[] = q?.items || [];
  const dated = items.filter(x => x.date.value);
  const first = dated[0], latest = dated[dated.length - 1];
  const selected = pair.map(id => items.find(x => x.statement.statementId === id)).filter(Boolean)
    .sort((a: any, b: any) => (a.date.value || '').localeCompare(b.date.value || '')) as Item[];

  const pickScope = (k: string) => { setScopeKey(k); setQuestionId(''); setPair([]); };
  const pickQuestion = (id: string) => { setQuestionId(id); setPair([]); };
  const toggle = (id: string) => setPair(p => p.includes(id) ? p.filter(x => x !== id) : p.length < 2 ? [...p, id] : [p[1], id]);

  return <section className="ceo-tl">
    <header className="tl-head">
      <h1>CEO 발언의 변화</h1>
      <p className="tl-muted">같은 질문에 대한 CEO의 발언을 날짜순으로 보여줍니다. 입장 변화는 자동으로 판단하지 않고, 원문과 수치를 나란히 비교할 수 있게 합니다.</p>
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
        <div className="tl-qhead"><h2>{q.label}</h2><p className="tl-muted">{q.hint} · 원문 단어로 분류 · {items.length}건</p></div>

        {q.comparable && first && latest && <section className="tl-span" aria-label="처음과 최근 비교">
          {[['처음', first], ['최근', latest]].map(([label, x]: any) => <article key={label}>
            <span className="tl-span-label">{label} · {fmt(x.date.value)}</span>
            <p>{displayText(x.statement).text}</p>
            <Metrics values={x.metrics} />
          </article>)}
        </section>}
        {!q.comparable && <p className="tl-notice">날짜가 다른 발언이 2건 이상 있어야 변화를 비교할 수 있습니다.</p>}

        <ol className="tl-list">
          {items.map(x => {
            const s = x.statement, on = pair.includes(s.statementId);
            return <li key={s.statementId} className={on ? 'on' : ''}>
              <div className="tl-date"><strong>{fmt(x.date.value)}</strong><small>{x.date.label}</small></div>
              <div className="tl-card">
                <Body s={s} />
                <Metrics values={x.metrics} />
                <div className="tl-foot">
                  <Source s={s} />
                  <button className={'tl-pick' + (on ? ' on' : '')} onClick={() => toggle(s.statementId)} aria-pressed={on}>{on ? '비교 해제' : '비교에 추가'}</button>
                </div>
              </div>
            </li>;
          })}
        </ol>

        <section className="tl-compare" aria-live="polite">
          <h3>두 발언 나란히 보기 <span className="tl-muted">{selected.length}/2</span></h3>
          {selected.length < 2 ? <p className="tl-muted">위 목록에서 ‘비교에 추가’를 두 번 누르세요.</p> :
          <div className="tl-cols">{selected.map(x => <article key={x.statement.statementId}>
            <span className="tl-span-label">{fmt(x.date.value)} · {x.date.label}</span>
            <Body s={x.statement} open />
            <Metrics values={x.metrics} />
            <p className="tl-muted">분류 단어: {x.matchedTerms.join(', ')}</p>
            <Source s={x.statement} />
          </article>)}</div>}
          {selected.length === 2 && <p className="tl-muted">조건·수치·기간이 같은지 원문에서 함께 확인하세요. 표현이 달라졌다고 입장이 바뀐 것은 아닙니다.</p>}
        </section>

        {(result.other.length > 0 || result.excludedCount > 0) && <details className="tl-other">
          <summary>질문에 분류되지 않은 발언 {result.other.length}건{result.excludedCount ? ` · 인사말·편집자 주 ${result.excludedCount}건 제외` : ''}</summary>
          <ul>{result.other.map((s: any) => <li key={s.statementId}><span className="tl-muted">{fmt(s.referenceDate?.value || s.spokenAt?.value || null)}</span> {displayText(s).text}</li>)}</ul>
        </details>}
      </main>
    </div>}
  </section>;
}
