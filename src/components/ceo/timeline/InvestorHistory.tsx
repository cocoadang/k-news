import { useState } from 'react';
import { useLang } from '../../../i18n';
import { HistoryEntry, HistoryPanel } from './HistoryPanel';

type Localized = readonly [ko: string, en: string];
type Entry = {
  date: string;
  headline: Localized;
  text: Localized;
  source: string;
  url: string;
};
type Topic = { id: string; label: Localized; entries: Entry[] };
type Stance = { level: -2 | -1 | 0 | 1 | 2; scope: Localized; evidence: Entry };

const fisherOutlook: Entry = {
  date: '2026-11-04',
  headline: ['중간선거 이후 정책 교착을 주식에 우호적으로 평가', 'Saw post-midterm gridlock as supportive for stocks'],
  text: ['중간선거 이후 입법 교착이 정책 불확실성을 낮춰 미국 주식에 우호적이라고 봤습니다.',
    'He argued that post-midterm legislative gridlock reduces policy uncertainty and supports US equities.'],
  source: 'Fox Business',
  url: 'https://www.foxbusiness.com/video/6407909704112',
};

const burryOutlook: Entry = {
  date: '2026-11-23',
  headline: ['나스닥100 하락 베팅을 절반으로 축소', 'Cut his Nasdaq-100 downside position in half'],
  text: ['나스닥100 풋옵션을 절반 줄이고 나머지를 유지했다고 전해졌습니다. 엔비디아 콜옵션도 사들여 개별 종목의 반등에 대비했습니다.',
    'He reportedly cut his Nasdaq-100 puts in half and kept the remainder. He also bought Nvidia calls, positioning for a rebound in that stock.'],
  source: 'Stocktwits · Yahoo Finance',
  url: 'https://finance.yahoo.com/markets/stocks/articles/michael-burry-bought-nvidia-calls-032355083.html',
};

export const investorProfiles = {
  'ken-fisher': {
    name: ['켄 피셔', 'Ken Fisher'],
    company: 'Fisher Investments',
    topics: [
      { id: 'market', label: ['시장 전망', 'Market outlook'], entries: [
        fisherOutlook,
        { date: '2026-10-29', headline: ['중간선거 후 주식시장에 순풍 예상', 'Expected a post-midterm tailwind for stocks'],
          text: ['중간선거 이후 정책 불확실성이 줄어드는 점을 미국과 글로벌 주식의 상승 요인으로 봤습니다.',
            'He expected declining policy uncertainty after the midterms to support US and global stocks.'],
          source: 'Fisher Investments', url: 'https://www.youtube.com/watch?v=JsJik9LmlRE' },
      ] },
      { id: 'regulation', label: ['정책·규제', 'Policy and regulation'], entries: [
        { date: '2026-11-06', headline: ['의회 권력 변화와 AI 규제 가능성 논의', 'Discussed the balance of power in Congress and potential AI regulation'],
          text: ['중간선거 이후 민주당의 의회 장악이 AI 규제와 주식시장 전망에 미칠 영향을 논의했습니다.',
            'He discussed how Democratic control of Congress after the midterms could affect AI regulation and the stock market outlook.'],
          source: 'Fox Business', url: 'https://www.foxbusiness.com/video/6408039572112' },
      ] },
    ],
  },
  'michael-burry': {
    name: ['마이클 버리', 'Michael Burry'],
    company: 'Cassandra Unchained',
    topics: [
      { id: 'market', label: ['시장 전망', 'Market outlook'], entries: [
        burryOutlook,
        { date: '2026-11-12', headline: ['나스닥100 반등 때 풋옵션 확대', 'Increased Nasdaq-100 puts on a rebound'],
          text: ['나스닥100이 반등했을 때 2027년 초 만기 풋옵션 포지션을 두 배로 늘렸다고 공개했습니다.',
            'He disclosed doubling his Nasdaq-100 put position expiring in early 2027 as the index bounced.'],
          source: 'Business Insider · Substack 인용', url: 'https://www.businessinsider.com/michael-burry-bull-trap-nasdaq-ai-nvidia-ndx-smh-2026-11' },
      ] },
      { id: 'strategy', label: ['투자 전략', 'Investment strategy'], entries: [
        { date: '2026-11-23', headline: ['반도체 ETF 풋 청산·엔비디아 콜 매수', 'Exited semiconductor ETF puts and bought Nvidia calls'],
          text: ['반도체 ETF 풋옵션을 모두 팔았고 엔비디아 풋옵션도 줄였습니다. 엔비디아 콜옵션을 사면서도 회사가 젠슨 황 개인에게 과도하게 의존한다고 지적했습니다.',
            'He reportedly exited his semiconductor ETF puts, trimmed Nvidia puts and bought Nvidia calls while criticizing the company’s reliance on Jensen Huang.'],
          source: burryOutlook.source, url: burryOutlook.url },
        { date: '2026-11-20', headline: ['엔비디아·반도체 ETF 풋 일부 차익 실현', 'Took partial profits on Nvidia and semiconductor ETF puts'],
          text: ['엔비디아와 반도체 ETF 풋옵션을 각각 절반 매도했다고 전해졌습니다.',
            'He reportedly sold half of his put positions in Nvidia and the semiconductor ETF.'],
          source: 'Stocktwits · Yahoo Finance', url: 'https://finance.yahoo.com/markets/stocks/articles/michael-burry-locks-gains-nvidia-183241854.html' },
      ] },
    ],
  },
} satisfies Record<string, { name: Localized; company: string; topics: Topic[] }>;

const stanceEvidence: Record<string, Stance> = {
  'ken-fisher': { level: 1, scope: ['미국 주식', 'US equities'], evidence: fisherOutlook },
  'michael-burry': { level: -1, scope: ['나스닥100', 'Nasdaq-100'], evidence: burryOutlook },
  'stanley-druckenmiller': {
    level: 0, scope: ['미국 주식', 'US equities'],
    evidence: { date: '2026-11-18', headline: ['자본 보전 우선', 'Prioritized capital preservation'],
      text: ['향후 12개월의 시장 방향을 판단하기 어렵다며 자본 보전을 우선한다고 밝혔습니다.',
        'He said the market’s direction over the next 12 months was unusually unclear and prioritized capital preservation.'],
      source: 'TomorrowX Summit', url: 'https://www.youtube.com/watch?v=6r3D-CMJkuI' },
  },
};

const stanceLabels: Localized[] = [
  ['강한 부정', 'Strongly bearish'], ['부정', 'Bearish'], ['중립·관망', 'Neutral / wait and see'],
  ['긍정', 'Bullish'], ['강한 긍정', 'Strongly bullish'],
];

export function MarketStance({personId, personName, people, onSelect}: {
  personId: string;
  personName: string;
  people: { personId: string; name: string }[];
  onSelect: (id: string) => void;
}) {
  const { t } = useLang();
  const stance = stanceEvidence[personId];
  return <section aria-label={t('시장 스탠스', 'Market stance')} className="tl-card mb-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2>{t('시장 스탠스', 'Market stance')} · {personName}</h2>
      {stance && <strong>{t(...stanceLabels[stance.level + 2])} · {t(...stance.scope)}</strong>}
    </div>
    {stance ? <>
      <div className="mx-2 mt-3" role="meter" aria-label={t('긍정·부정 정도', 'Market stance scale')}
        aria-valuemin={-2} aria-valuemax={2} aria-valuenow={stance.level} aria-valuetext={t(...stanceLabels[stance.level + 2])}>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-rose-500 via-slate-400 to-emerald-500">
          <span className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-950 shadow"
            style={{left: `${(stance.level + 2) * 25}%`}}/>
        </div>
        <div className="mt-2 grid grid-cols-3 text-xs text-slate-300" aria-hidden="true">
          <span>{t('부정', 'Bearish')}</span><span className="text-center">{t('중립', 'Neutral')}</span><span className="text-right">{t('긍정', 'Bullish')}</span>
        </div>
      </div>
      <div className="mt-2 text-sm">
        <p>{t(...stance.evidence.text)}</p>
        <time className="tl-muted" dateTime={stance.evidence.date}>{stance.evidence.date}</time>
        {' · '}<a href={stance.evidence.url} target="_blank" rel="noreferrer">{stance.evidence.source} ↗</a>
      </div>
    </> : <p className="tl-muted">{t('최근 공개 자료에서 주식시장 방향에 대한 판단 근거를 확인하지 못했습니다.', 'No recent public evidence of a directional equity market view.')}</p>}
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
      <span className="tl-muted">{t('공개 근거를 바탕으로 한 수동 5단계 평가', 'Editorial five-level reading of public evidence')}</span>
      {people.filter(person => person.personId !== personId && stanceEvidence[person.personId]).map(person =>
        <button type="button" key={person.personId} className="min-h-9 underline underline-offset-4 hover:text-cyan-300"
          onClick={() => onSelect(person.personId)}>{person.name} · {t(...stanceLabels[stanceEvidence[person.personId].level + 2])}</button>)}
    </div>
  </section>;
}

export function InvestorHistory({ profile }: { profile: typeof investorProfiles[keyof typeof investorProfiles] }) {
  const { t } = useLang();
  const [active, setActive] = useState('market');
  const topics: Topic[] = profile.topics;
  const topic = topics.find(entry => entry.id === active) || topics[0];
  return <HistoryPanel
    title={t(`${profile.name[0]} 발언 이력`, `${profile.name[1]} statement history`)}
    topics={topics.map(entry => ({ id: entry.id, label: t(...entry.label) }))}
    activeId={topic.id}
    onSelect={setActive}
    topicTitle={t(...topic.label)}
    metadata={t('발언일 또는 보도일 기준 · 최신순', 'Statement or publication dates · newest first')}
  >
    {[...topic.entries].sort((a, b) => b.date.localeCompare(a.date)).map(entry => <HistoryEntry
      key={entry.url}
      date={entry.date}
      dateLabel={entry.date.replace(/-/g, '.')}
      source={<a className="tl-source" href={entry.url} target="_blank" rel="noreferrer">{entry.source} ↗</a>}
    >
      <h4 className="tl-milestone">{t(...entry.headline)}</h4>
      <p className="tl-text">{t(...entry.text)}</p>
    </HistoryEntry>)}
  </HistoryPanel>;
}
