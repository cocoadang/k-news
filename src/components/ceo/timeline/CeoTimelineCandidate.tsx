import { InvestorArchive, InvestorHistory, MarketStance, StanceEvidence, investorProfiles } from './InvestorHistory';
import React, { useMemo, useState } from 'react';
import { DruckenmillerHistory, druckenmillerPersonId } from './DruckenmillerHistory';
import { TrumpPolicyHistory } from './TrumpPolicyHistory';
import { HistoryPanel, HistoryEntry } from './HistoryPanel';
import { groupedCeoTopics, displayText, displaySummary } from './companyQuestions.mjs';
import { investorArchive } from './investorArchive';
import './timeline.css';
import { useLang, tr, getLang } from '../../../i18n';

type Item = { statement: any; matchedTerms: string[]; date: { value: string | null; basis: string; label: string }; metrics: string[] };

const fmt = (d: string | null) => (d ? d.replace(/-/g, '.') : tr('날짜 미확인', 'Date unconfirmed'));
const DATE_BASIS_EN: Record<string, string> = { posted: 'Interview published · recording date unknown', spoken: 'Spoken', released: 'Press release', written: 'Posted', reported: 'Reported', video: 'Video posted', unknown: 'Date unconfirmed' };
const month = (d: string) => d.slice(0, 7).replace('-', '.');

function Metrics({ values }: { values: string[] }) {
  if (!values.length) return null;
  return <div className="tl-metrics">{values.map(m => <span key={m}>{m}</span>)}</div>;
}

function Source({ s }: { s: any }) {
  const e = (s.evidence || [])[0];
  return e?.url ? <a className="tl-source" href={e.url} target="_blank" rel="noreferrer">{e.sourceName || tr('출처', 'Source')} ↗</a> : null;
}

function Body({ s, open = false }: { s: any; open?: boolean }) {
  const t = displayText(s);
  const socialPlatform = s.socialPlatform || 'X';
  if (getLang() === 'en' && s.kind !== 'reported_excerpt') {
    // 영어 화면: 번역 대신 영어 원문을 그대로 보여 줍니다(추가 비용 없음)
    const kind = s.kind === 'video_quote' ? `From video captions${s.videoTitle ? ` · ${s.videoTitle}` : ''}`
      : s.kind === 'social_post' ? `Own post on ${socialPlatform}${s.curatedSummaryKo ? ' · excerpt' : ''}`
      : s.kind === 'reported_headline' ? `Press headline · not a direct quote${s.reportedSourceCount > 1 ? ` · ${s.reportedSourceCount} outlets` : ''}`
      : 'Original quote';
    const warn = s.kind === 'reported_headline';
    return <><p className="tl-text tl-en" lang="en">{s.kind === 'reported_headline' ? s.quoteText : <>“{s.quoteText}”</>}</p><span className={'tl-tag' + (warn ? ' tl-warn' : '')}>{kind}</span>
      {warn && Array.isArray(s.relatedHeadlines) && s.relatedHeadlines.length > 0 && <details className="tl-original"><summary>{s.relatedHeadlines.length} other headlines on this</summary><ul className="tl-related">{s.relatedHeadlines.map((h: string) => <li key={h} lang="en">{h}</li>)}</ul></details>}</>;
  }
  if (s.kind === 'video_quote') {
    return <>
      <p className="tl-text">{t.kind === 'ai_translation' ? t.text : <span lang="en">{t.text}</span>}</p>
      <span className="tl-tag">영상 자막에서 확인한 발언{t.kind === 'ai_translation' ? ' · AI 번역' : ''}{s.videoTitle ? ` · ${s.videoTitle}` : ''}</span>
      <details className="tl-original" open={open}><summary>원문 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>
    </>;
  }
  if (s.curatedSummaryKo) {
    return <>
      <p className="tl-text">{s.curatedSummaryKo}</p>
      <span className="tl-tag">{s.kind === 'social_post' ? `${socialPlatform} 본인 게시물` : '백악관 공식 발언'} · 요약</span>
      <details className="tl-original" open={open}><summary>원문 발췌 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>
    </>;
  }
  if (s.kind === 'social_post') {
    const ko = t.kind === 'ai_translation';
    return <>
      <p className="tl-text">{ko ? t.text : <span lang="en">{t.text}</span>}</p>
      <span className="tl-tag">본인 {socialPlatform} 게시물{ko ? ' · AI 번역' : ' · 원문'}</span>
      {ko && <details className="tl-original" open={open}><summary>원문 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>}
    </>;
  }
  if (s.kind === 'reported_excerpt') {
    return <><p className="tl-text tl-en" lang={s.quoteLanguage || 'en'}>“{t.text}”</p><span className="tl-tag tl-warn">{tr('기사 요약 속 인용 · 공식 원문 아님', 'Quote inside an article summary · not an official source')}{s.context ? ` · ${tr('기사', 'Article')}: ${s.context}` : ''}</span></>;
  }
  if (s.kind === 'reported_headline') {
    const ko = t.kind === 'ai_translation';
    return <><p className={'tl-text' + (ko ? '' : ' tl-en')} lang={ko ? 'ko' : 'en'}>{t.text}</p><span className="tl-tag tl-warn">{ko ? 'AI 번역 · ' : ''}언론 보도 헤드라인 · 직접 인용 아님{s.reportedSourceCount > 1 ? ` · ${s.reportedSourceCount}개 매체` : ''}</span>
      {ko && <details className="tl-original" open={open}><summary>원문 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>}
      {Array.isArray(s.relatedHeadlines) && s.relatedHeadlines.length > 0 && <details className="tl-original"><summary>같은 내용의 다른 헤드라인 {s.relatedHeadlines.length}건</summary><ul className="tl-related">{s.relatedHeadlines.map((h: string) => <li key={h} lang="en">{h}</li>)}</ul></details>}</>;
  }
  const summary = displaySummary(s);
  if (summary) {
    return <>
      <h4 className="tl-milestone">{summary.title}</h4>
      <p className="tl-text">{summary.summary}</p>
      <span className="tl-tag">{summary.reviewed ? '원문 검토 요약' : s.sourceType === 'authored_post' ? '블로그 발췌 요약' : 'AI 발언 요약'}</span>
      <details className="tl-original" open={open}><summary>원문 발췌 보기</summary><blockquote lang="en">{s.quoteText}</blockquote></details>
    </>;
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

const curatedHistories = new Map([
  ['donald-trump', TrumpPolicyHistory],
  [druckenmillerPersonId, DruckenmillerHistory],
]);

const financePeople = new Set(['bill-ackman', 'ray-dalio', druckenmillerPersonId, ...Object.keys(investorProfiles)]);

export function CeoTimeline({ dataset }: { dataset: any }) {
  const { t, lang } = useLang();
  const qLabel = (x: any) => (lang === 'en' && x.labelEn ? x.labelEn : x.label);
  // 인물 단위로 묶음(머스크: Tesla·SpaceX를 한 화면에). 질문은 회사별로 나뉘어 표시됨
  const scopes = useMemo(() => {
    const seen = new Map<string, any>();
    for (const r of dataset.roles || []) {
      const person = (dataset.persons || []).find((p: any) => p.personId === r.personId);
      const cur = seen.get(r.personId) || { key: r.personId, personId: r.personId, companyIds: [] as string[], companies: [] as string[], name: (lang === 'en' ? person?.nameVariants?.[0] : null) || person?.displayName || r.personId, count: 0 };
      if (!cur.companyIds.includes(r.companyId)) { cur.companyIds.push(r.companyId); cur.companies.push(r.companyName); }
      seen.set(r.personId, cur);
    }
    for (const s of seen.values()) {
      s.company = [...new Set(s.companies)].join('·');
      s.count = (dataset.statements || []).filter((x: any) => x.personId === s.personId && s.companyIds.includes(x.companyId)).length;
    }
    seen.set(druckenmillerPersonId, {
      key: druckenmillerPersonId,
      personId: druckenmillerPersonId,
      name: lang === 'en' ? 'Stanley Druckenmiller' : '스탠리 드러켄밀러',
      company: 'Duquesne Family Office',
      count: 0,
    });
    for (const [personId, profile] of Object.entries(investorProfiles)) {
      seen.set(personId, { key: personId, personId, name: lang === 'en' ? profile.name[1] : profile.name[0],
        company: profile.company, count: profile.topics.reduce((sum, topic) => sum + topic.entries.length, 0) });
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [dataset, lang]);

  const [scopeKey, setScopeKey] = useState(scopes.find(s => s.count)?.key || scopes[0]?.key || '');
  const scopeGroups = [
    { id: 'business', label: t('기술·기업', 'Technology and business'), scopes: scopes.filter(s => s.personId !== 'donald-trump' && !financePeople.has(s.personId)) },
    { id: 'finance', label: t('투자·금융', 'Investing and finance'), scopes: scopes.filter(s => financePeople.has(s.personId)) },
    { id: 'policy', label: t('정책', 'Policy'), scopes: scopes.filter(s => s.personId === 'donald-trump') },
  ];
  const scope = scopes.find(s => s.key === scopeKey);
  const CuratedHistory = curatedHistories.get(scope?.personId);
  const investor = investorProfiles[scope?.personId as keyof typeof investorProfiles];
  const topics = useMemo(() => scope && !CuratedHistory && !investor
    ? groupedCeoTopics(dataset.statements, scope.personId, scope.companyIds) : [], [dataset, scope, CuratedHistory, investor]);
  const [questionId, setQuestionId] = useState<string>('');
  const q = topics.find((x: any) => x.id === questionId) || topics[0];

  const items: Item[] = (q?.items || []).slice().sort((a: Item, b: Item) => (b.date.value || '').localeCompare(a.date.value || ''));
  const pickScope = (k: string) => { setScopeKey(k); setQuestionId(''); };
  const pickQuestion = (id: string) => setQuestionId(id);

  return <section className="ceo-tl">
    {scopes.length > 0 && <div className="tl-head">
      <label className="tl-person-picker">
        <span>{t('인물 선택', 'Select a person')}</span>
        <select value={scopeKey} onChange={event => pickScope(event.target.value)}>
          {scopeGroups.filter(group => group.scopes.length > 0).map(group => (
            <optgroup key={group.id} label={group.label}>
              {group.scopes.map(s => <option key={s.key} value={s.key} disabled={!s.count && !curatedHistories.has(s.personId) && !investorArchive[s.personId]?.length}>
                {s.name} · {s.company}
              </option>)}
            </optgroup>
          ))}
        </select>
      </label>
    </div>}

    {scope && <MarketStance personId={scope.personId} personName={scope.name}/>}
    {investor ? <InvestorHistory key={scopeKey} personId={scopeKey} profile={investor}/> : CuratedHistory ? <CuratedHistory /> : !q ? (
      investorArchive[scopeKey]?.length
        ? <InvestorArchive key={scopeKey} personId={scopeKey}/>
        : <p className="tl-empty">{t('이 인물의 주제별 발언을 준비 중입니다.', 'Topic timelines are not available for this person yet.')}</p>
    ) : <HistoryPanel
      title={t('발언 변화 이력', 'Statement history')}
      evidence={<React.Fragment key={scopeKey}>
        <StanceEvidence personId={scopeKey}/>
        <InvestorArchive personId={scopeKey}/>
      </React.Fragment>}
      topics={topics.map((entry: any) => ({
        id: entry.id,
        label: qLabel(entry),
      }))}
      activeId={q.id}
      onSelect={pickQuestion}
      topicTitle={qLabel(q)}
      metadata={[
        t(`${items.length}건`, `${items.length} ${items.length === 1 ? 'item' : 'items'}`),
        q.range ? month(q.range[0]) + (q.range[1] === q.range[0] ? '' : ' ~ ' + month(q.range[1])) : null,
      ].filter(Boolean).join(' · ')}
      note={q.comparable ? undefined : t('날짜가 다른 발언이 2건 이상 있어야 변화를 비교할 수 있습니다.', 'At least two statements on different dates are needed to compare change.')}
    >
      {items.map(({ statement, date, metrics }) => <HistoryEntry
        key={statement.statementId}
        date={date.value}
        dateLabel={fmt(date.value)}
        dateBasis={lang === 'en' ? DATE_BASIS_EN[date.basis] || date.label : date.label}
        source={<Source s={statement} />}
      >
        <Body s={statement} />
        <Metrics values={metrics} />
      </HistoryEntry>)}
    </HistoryPanel>}
  </section>;
}
