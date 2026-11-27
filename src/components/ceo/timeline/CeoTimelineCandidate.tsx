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
  const action = s.kind === 'video_quote' ? tr('영상 보기', 'Watch video') : tr('원문 보기', 'View original');
  const label = `${action} · ${sourceName}`;
  return <a className="tl-source" href={e.url} target="_blank" rel="noreferrer">{label} ↗</a>;
}

const reviewedPostSummaries = [
  {
    personId: 'sundar-pichai', matches: /(?:500\s*billion|오천억|5[,.]?000억)[\s\S]*25\s*%[\s\S]*103\s*%/i,
    ko: '피차이는 알파벳 3분기 매출이 25%, 구글 클라우드 매출이 103% 성장했다고 밝혔습니다. AI 투자가 검색 이용을 늘리고, AI 인프라와 솔루션 수요가 클라우드 성장을 이끌었다고 설명했습니다.',
    en: 'Pichai said Alphabet revenue grew 25% and Google Cloud revenue rose 103%. He credited AI investment with driving search usage and AI infrastructure and solutions demand with boosting Cloud.',
  },
  {
    personId: 'satya-nadella', matches: /MAI Base 2[\s\S]*Rocket/i,
    ko: '나델라는 달러당 AI 성능을 높이는 데 주력한다고 밝혔습니다. 사전학습·강화학습·토큰 효율을 개선하고 모델과 제품을 함께 개발해 고객의 비용 대비 성과를 높이겠다는 설명입니다.',
    en: 'Nadella emphasized improving AI performance per dollar through more efficient training and models. He said building models and products together can deliver better economics for customers.',
  },
  {
    personId: 'bill-ackman', matches: /@nvidia[\s\S]*(?:fiduciary|수탁자)/i,
    ko: '애크먼은 엔비디아 이사회가 젠슨 황의 거취를 결정하기 전에 사실관계와 이해관계자에게 미칠 영향을 충분히 검토하지 않았다고 비판했습니다.',
    en: 'Ackman criticized Nvidia’s board for what he saw as insufficient fact-finding and consideration of stakeholders before its decision on Jensen Huang.',
  },
  {
    personId: 'ray-dalio', matches: /(?:Thanksgiving|추수감사절)[\s\S]*(?:meaningful|의미 있는)/i,
    ko: '달리오는 추수감사절을 맞아 가족, 친구, 공동체에 감사를 전했습니다. 갈등이 있더라도 서로를 대하는 방식이 중요하다고 강조했습니다.',
    en: 'In a Thanksgiving message, Dalio expressed gratitude for family, friends, and community. He emphasized the importance of how people treat one another amid conflict.',
  },
];

function shortExcerpt(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 155) return normalized;
  const opening = normalized.slice(0, 155);
  const sentenceEnd = opening.search(/[.!?。！？](?=\s|$)/u);
  if (sentenceEnd >= 55) return opening.slice(0, sentenceEnd + 1);
  const wordEnd = opening.lastIndexOf(' ');
  return `${opening.slice(0, wordEnd >= 110 ? wordEnd : opening.length)}…`;
}

function Body({ s }: { s: any }) {
  const english = getLang() === 'en';
  const original = String(s.quoteText || '');
  const display = displayText(s);
  const curatedPost = s.kind === 'social_post' && reviewedPostSummaries.find(
    item => item.personId === s.personId && (item.matches.test(original) || item.matches.test(display.text)),
  );
  const saved = s.koSummary?.status === 'ready' && typeof s.koSummary.summary === 'string' ? s.koSummary.summary.trim() : '';
  const editorial = curatedPost ? (english ? curatedPost.en : curatedPost.ko) : '';
  const summary = editorial || (!english ? s.curatedSummaryKo?.trim() || displaySummary(s)?.summary || saved : '');
  const body = english ? original : display.text;
  const excerpt = shortExcerpt(body);
  const text = summary || excerpt;
  const showExcerpt = !summary && excerpt !== body.trim();
  const noSource = !statementSource(s);
  const showStoredText = noSource && original && (original.trim() !== text || showExcerpt);
  const lang = english || (!summary && display.kind === 'original') ? (s.quoteLanguage || 'en') : 'ko';
  return <>
    {text && <p className="tl-text" lang={lang}>{text}</p>}
    {summary && <span className="tl-tag">{tr('요약', 'Summary')}</span>}
    {showExcerpt && <span className="tl-tag">{tr('발췌', 'Excerpt')}</span>}
    {s.kind === 'reported_excerpt' && <span className="tl-tag tl-warn">{tr('기사 요약 속 인용 · 공식 원문 아님', 'Quote inside an article summary · not an official source')}{s.context ? ` · ${tr('기사', 'Article')}: ${s.context}` : ''}</span>}
    {showStoredText && <details className="tl-original">
      <summary>{tr('원문 발췌 보기', 'View original excerpt')}</summary>
      <blockquote lang={s.quoteLanguage || 'en'}>{original}</blockquote>
    </details>}
    {s.kind === 'reported_headline' && Array.isArray(s.relatedHeadlines) && s.relatedHeadlines.length > 0 &&
      <details className="tl-original">
        <summary>{tr(`같은 내용의 다른 헤드라인 ${s.relatedHeadlines.length}건`, `${s.relatedHeadlines.length} other headlines on this`)}</summary>
        <ul className="tl-related">{s.relatedHeadlines.map((headline: string) => <li key={headline} lang="en">{headline}</li>)}</ul>
      </details>}
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
