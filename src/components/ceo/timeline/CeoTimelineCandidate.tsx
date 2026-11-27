import { QuarterlyFilings } from './QuarterlyFilings';
import { InvestorHistory, MarketStance, SourcedInvestorEntry, investorProfiles, stanceHistoryEntry } from './InvestorHistory';
import { useMemo, useState } from 'react';
import { DruckenmillerHistory, druckenmillerPersonId } from './DruckenmillerHistory';
import { TrumpPolicyHistory } from './TrumpPolicyHistory';
import { HistoryPanel, HistoryEntry } from './HistoryPanel';
import { groupedCeoTopics, displayText, displaySummary, matchesSourcedEntry } from './companyQuestions.mjs';
import { CeoPersonPicker } from './CeoPersonPicker';
import { investorArchive } from './investorArchive';
import './timeline.css';
import { useLang, tr, getLang } from '../../../i18n';

type Item = { statement: any; date: { value: string | null; basis: string; label: string } };

const fmt = (d: string | null) => (d ? d.replace(/-/g, '.') : tr('날짜 미확인', 'Date unconfirmed'));
const DATE_BASIS_EN: Record<string, string> = { posted: 'Interview published · recording date unknown', spoken: 'Spoken', released: 'Press release', written: 'Posted', reported: 'Reported', video: 'Video posted', unknown: 'Date unconfirmed' };

function statementSource(s: any) {
  return s.evidence?.find((item: { url?: string }) => item?.url);
}

function Source({ s }: { s: any }) {
  const e = statementSource(s);
  if (!e?.url) return null;
  const sourceName = e.sourceName || tr('출처', 'Source');
  const label = s.kind === 'reported_headline' ? `${tr('보도', 'Report')} · ${sourceName}` : sourceName;
  return <a className="tl-source" href={e.url} target="_blank" rel="noreferrer">{label} ↗</a>;
}

function Body({ s }: { s: any }) {
  const t = displayText(s);
  const sourceExcerpt = !statementSource(s) && s.quoteText && (s.quoteText !== t.text || s.curatedSummaryKo)
    ? <details className="tl-original">
        <summary>{tr('원문 발췌', 'Original excerpt')}</summary>
        <blockquote lang={s.quoteLanguage || 'en'}>{s.quoteText}</blockquote>
      </details>
    : null;
  if (getLang() === 'en' && s.kind !== 'reported_excerpt') {
    // 영어 화면: 번역 대신 영어 원문을 그대로 보여 줍니다(추가 비용 없음)
    const warn = s.kind === 'reported_headline';
    return <><p className={'tl-text tl-en' + (warn ? ' tl-milestone' : '')} lang="en">{warn ? s.quoteText : <>“{s.quoteText}”</>}</p>
      {warn && Array.isArray(s.relatedHeadlines) && s.relatedHeadlines.length > 0 && <details className="tl-original"><summary>{s.relatedHeadlines.length} other headlines on this</summary><ul className="tl-related">{s.relatedHeadlines.map((h: string) => <li key={h} lang="en">{h}</li>)}</ul></details>}</>;
  }
  if (s.kind === 'video_quote') {
    return <>
      <p className="tl-text">{t.kind === 'ai_translation' ? t.text : <span lang="en">{t.text}</span>}</p>
      {sourceExcerpt}
    </>;
  }
  if (s.curatedSummaryKo) {
    return <>
      <p className="tl-text">{s.curatedSummaryKo}</p>
      <span className="tl-tag">발언 요약</span>
      {sourceExcerpt}
    </>;
  }
  if (s.kind === 'social_post') {
    const ko = t.kind === 'ai_translation';
    return <>
      <p className="tl-text">{ko ? t.text : <span lang="en">{t.text}</span>}</p>
      {ko && sourceExcerpt}
    </>;
  }
  if (s.kind === 'reported_excerpt') {
    return <><p className="tl-text tl-en" lang={s.quoteLanguage || 'en'}>“{t.text}”</p><span className="tl-tag tl-warn">{tr('기사 요약 속 인용 · 공식 원문 아님', 'Quote inside an article summary · not an official source')}{s.context ? ` · ${tr('기사', 'Article')}: ${s.context}` : ''}</span></>;
  }
  if (s.kind === 'reported_headline') {
    const ko = t.kind === 'ai_translation';
    return <><p className={'tl-text tl-milestone' + (ko ? '' : ' tl-en')} lang={ko ? 'ko' : 'en'}>{t.text}</p>
      {ko && sourceExcerpt}
      {Array.isArray(s.relatedHeadlines) && s.relatedHeadlines.length > 0 && <details className="tl-original"><summary>같은 내용의 다른 헤드라인 {s.relatedHeadlines.length}건</summary><ul className="tl-related">{s.relatedHeadlines.map((h: string) => <li key={h} lang="en">{h}</li>)}</ul></details>}</>;
  }
  const summary = displaySummary(s);
  if (summary) {
    return <>
      <h4 className="tl-milestone">{summary.title}</h4>
      <p className="tl-text">{summary.summary}</p>
      {s.sourceType !== 'authored_post' && <span className="tl-tag">{summary.reviewed ? '원문 검토 요약' : 'AI 발언 요약'}</span>}
      {sourceExcerpt}
    </>;
  }
  if (t.kind === 'original') {
    return <p className="tl-text tl-en" lang="en">{t.text}</p>;
  }
  return <>
    <p className="tl-text">{t.text}</p>
    {t.kind !== 'translation' && <span className="tl-tag">AI 요약 제목</span>}
    {sourceExcerpt}
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
  const people = [
    ...scopes.filter(s => s.personId !== 'donald-trump' && !financePeople.has(s.personId)),
    ...scopes.filter(s => financePeople.has(s.personId)),
    ...scopes.filter(s => s.personId === 'donald-trump'),
  ].map(s => ({
    id: s.personId,
    name: s.name,
    company: s.company,
    disabled: !s.count && !curatedHistories.has(s.personId) && !investorArchive[s.personId]?.length,
  }));
  const scope = scopes.find(s => s.key === scopeKey);
  const CuratedHistory = curatedHistories.get(scope?.personId);
  const investor = investorProfiles[scope?.personId as keyof typeof investorProfiles];
  const supplemental = useMemo(() => {
    const archive = investorArchive[scopeKey] ?? [];
    const evidence = stanceHistoryEntry(scopeKey);
    return evidence ? [...archive, evidence] : archive;
  }, [scopeKey]);
  const topics = useMemo(() => scope && !CuratedHistory && !investor
    ? groupedCeoTopics(dataset.statements, scope.personId, scope.companyIds, undefined, supplemental)
    : [], [dataset, scope, CuratedHistory, investor, supplemental]);
  const [questionId, setQuestionId] = useState<string>('');
  const q = topics.find((x: any) => x.id === questionId) || topics[0];

  const items: Item[] = q?.items ?? [];
  const added = supplemental.filter(entry => entry.topic === q?.id);
  const entries = [
    ...items.filter(({ statement }) => !added.some(entry => matchesSourcedEntry(statement, entry)))
      .map(item => ({ date: item.date.value ?? '', key: item.statement.statementId, item, entry: null })),
    ...added.map(entry => ({ date: entry.date, key: entry.url + entry.headline[1], item: null, entry })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const dates = [...new Set(entries.map(entry => entry.date).filter(Boolean))];
  const pickScope = (k: string) => {
    if (k === scopeKey) return;
    setScopeKey(k);
    setQuestionId('');
  };
  const pickQuestion = (id: string) => setQuestionId(id);

  return <section className="ceo-tl">
    {people.length > 0 && <CeoPersonPicker people={people} selected={scopeKey} onSelect={pickScope} />}

    {scope && <MarketStance personId={scope.personId} personName={scope.name}/>}
    <QuarterlyFilings key={`filings:${scopeKey}`} personId={scopeKey}/>
    {investor ? <InvestorHistory key={`history:${scopeKey}`} personId={scopeKey} profile={investor}/> : CuratedHistory ? <CuratedHistory /> : !q ? (
      <p className="tl-empty">{t('이 인물의 주제별 발언을 준비 중입니다.', 'Topic timelines are not available for this person yet.')}</p>
    ) : <HistoryPanel
      title={t('발언 변화 이력', 'Statement history')}
      topics={topics.map((entry: any) => ({
        id: entry.id,
        label: qLabel(entry),
      }))}
      activeId={q.id}
      onSelect={pickQuestion}
      note={dates.length >= 2 ? undefined : t('날짜가 다른 발언이 2건 이상 있어야 변화를 비교할 수 있습니다.', 'At least two statements on different dates are needed to compare change.')}
    >
      {entries.map(({ key, item, entry }) => entry ? <SourcedInvestorEntry key={key} entry={entry}/> : item && <HistoryEntry
        key={key}
        date={item.date.value}
        dateLabel={fmt(item.date.value)}
        dateBasis={lang === 'en' ? DATE_BASIS_EN[item.date.basis] || item.date.label : item.date.label}
        source={<Source s={item.statement} />}
      >
        <Body s={item.statement} />
      </HistoryEntry>)}
    </HistoryPanel>}
  </section>;
}
