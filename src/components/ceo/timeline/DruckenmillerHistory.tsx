import { useState } from 'react';
import { useLang } from '../../../i18n';
import { HistoryEntry, HistoryPanel } from './HistoryPanel';

export const druckenmillerPersonId = 'stanley-druckenmiller';

type Localized = readonly [ko: string, en: string];
type Entry = { date: string; headline: Localized; text: Localized; source: keyof typeof sources };

const sources = {
  tomorrowx: { name: 'TomorrowX Summit', url: 'https://www.youtube.com/watch?v=6r3D-CMJkuI' },
  morgan: { name: 'Morgan Stanley · Hard Lessons', url: 'https://www.morganstanley.com/insights/videos/hard-lessons/duquesne-stan-druckenmiller-iliana-bouzali' },
  cnbc: { name: 'CNBC Television', url: 'https://www.youtube.com/watch?v=eTAdwNnOwZk' },
  bloomberg: { name: 'Bloomberg · Interview transcript', url: 'https://www.bishoprockcap.com/assets/library/stan-druckenmiller/October%202024%20Stan%20Druckenmiller%20on%20Fed%20Policy%2C%20Election%2C%20Bonds%2C%20Nvidia%20%28transcript%29' },
};

const topics: { id: string; label: Localized; summary: Localized; entries: Entry[] }[] = [
  {
    id: 'portfolio',
    label: ['시장 전망·포지션', 'Market outlook and positioning'],
    summary: ['2026년 초 주식과 구리에 매수 포지션을 두었지만, 11월에는 시장 방향의 불확실성을 이유로 자본 보전을 우선한다고 밝혔습니다.', 'Early in 2026 he was long equities and copper. By November, uncertainty about market direction led him to prioritize preserving capital.'],
    entries: [
      { date: '2026-11-18', source: 'tomorrowx',
        headline: ['자본 보전 우선', 'Prioritized capital preservation'],
        text: ['1월에 보유했던 포지션은 거의 남아 있지 않으며, 향후 12개월의 시장 방향을 판단하기 어렵다고 말했습니다.', 'He said little of the January positioning remained and that the market’s direction over the next 12 months was unusually unclear.'] },
      { date: '2026-02-27', source: 'morgan',
        headline: ['주식·구리 매수, 채권 매도로 방어', 'Long equities and copper, short bonds as a hedge'],
        text: ['다양한 종목을 담는 쪽을 선호했고, 매수 포지션을 방어하기 위해 채권을 매도했다고 설명했습니다.', 'He preferred a broad mix of equities and described short bonds as a hedge for his long positions.'] },
      { date: '2025-01-20', source: 'cnbc',
        headline: ['기업 경영진의 낙관론 언급', 'Noted growing optimism among executives'],
        text: ['트럼프 취임 무렵 기업 경영진 사이에서 낙관론과 투자 의욕이 되살아났다고 말했습니다.', 'Around Trump’s inauguration, he described a revival in business confidence among executives.'] },
    ],
  },
  {
    id: 'ai',
    label: ['AI·엔비디아', 'AI and Nvidia'],
    summary: ['AI의 장기 잠재력을 보고도 엔비디아를 매도했습니다. 이후 포트폴리오에서 AI 비중을 줄였고, 새 상승장이 온다면 AI 응용 분야가 주도할 수 있다고 봤습니다.', 'He sold Nvidia while retaining a long-term AI thesis, later reduced AI’s role in the portfolio, and said AI applications could lead another rally.'],
    entries: [
      { date: '2026-11-18', source: 'tomorrowx',
        headline: ['AI 응용 분야에 주목', 'Shifted attention toward AI applications'],
        text: ['주식시장이 크게 다시 오른다면 AI 인프라보다 실제 활용 분야가 상승을 주도할 수 있다고 봤습니다.', 'He said AI use cases could lead another major equity advance and questioned whether infrastructure would deliver the same boost as before.'] },
      { date: '2026-02-27', source: 'morgan',
        headline: ['포트폴리오의 AI 의존도 축소', 'Reduced the portfolio’s reliance on AI'],
        text: ['AI 관련 포지션을 일부 유지하면서도 AI가 포트폴리오를 이끄는 핵심 동력은 아니라고 설명했습니다.', 'He retained some AI exposure but said it was no longer the main driver of his portfolio.'] },
      { date: '2024-10-16', source: 'bloomberg',
        headline: ['엔비디아 전량 매도를 실수로 평가', 'Called his Nvidia exit a mistake'],
        text: ['주가가 빠르게 올라 밸류에이션이 높다고 보고 팔았지만, AI의 장기 전망은 여전히 긍정적으로 평가했습니다.', 'He sold after the shares rose sharply and looked expensive, while remaining positive on AI over the long term.'] },
    ],
  },
  {
    id: 'rates',
    label: ['연준·채권', 'The Fed and bonds'],
    summary: ['2024년에는 금리 인하가 인플레이션을 다시 자극할 가능성을 보고 채권을 매도했고, 2026년 초에는 채권 매도를 위험자산의 헤지로 설명했습니다.', 'In 2024 he shorted bonds on inflation risk after a rate cut. In early 2026 he described the short as a hedge for risk assets.'],
    entries: [
      { date: '2026-02-27', source: 'morgan',
        headline: ['채권 매도를 포트폴리오 헤지로 활용', 'Used short bonds as a portfolio hedge'],
        text: ['성장세가 이어지는 상황에서 연준이 금리를 내리면 인플레이션이 다시 강해질 수 있다고 보고 채권 매도를 헤지로 활용했습니다.', 'He used short bonds as a hedge against the possibility that Fed cuts into strong growth would rekindle inflation.'] },
      { date: '2024-10-16', source: 'bloomberg',
        headline: ['연준 0.50%p 인하를 정책 실수로 판단', 'Viewed the Fed’s half-point rate cut as a mistake'],
        text: ['연준이 기준금리를 0.50%p 내린 날 채권 매도 포지션을 잡았다고 밝혔습니다.', 'He said he went short bonds on the day the Fed cut rates by half a percentage point.'] },
    ],
  },
];

export function DruckenmillerHistory() {
  const { t } = useLang();
  const [active, setActive] = useState(topics[0].id);
  const topic = topics.find(entry => entry.id === active) || topics[0];
  return <HistoryPanel
    title={t('스탠리 드러켄밀러 발언 이력', 'Stanley Druckenmiller statement history')}
    topics={topics.map(entry => ({ id: entry.id, label: t(...entry.label) }))}
    activeId={active}
    onSelect={setActive}
    topicTitle={t(...topic.label)}
    summary={t(...topic.summary)}
    metadata={t('인터뷰·행사 공개일 기준 · 최신순', 'Interview and event publication dates · newest first')}
  >
    {[...topic.entries].sort((a, b) => b.date.localeCompare(a.date)).map(entry => <HistoryEntry
      key={entry.date}
      date={entry.date}
      dateLabel={entry.date.replace(/-/g, '.')}
      source={<a className="tl-source" href={sources[entry.source].url} target="_blank" rel="noreferrer">{sources[entry.source].name} ↗</a>}
    >
      <h4 className="tl-milestone">{t(...entry.headline)}</h4>
      <p className="tl-text">{t(...entry.text)}</p>
    </HistoryEntry>)}
  </HistoryPanel>;
}
