import { useState } from 'react';
import { useLang } from '../../../i18n';

type Localized = readonly [ko: string, en: string];
type Milestone = {
  date: string;
  kind: 'speech' | 'post' | 'order' | 'release';
  change: Localized;
  summary: Localized;
  url: string;
};
type Topic = { title: Localized; takeaway: Localized; milestones: Milestone[] };
const truth = (id: string) => 'https://truthsocial.com/@realDonaldTrump/' + id;

const topics: Topic[] = [
  {
    title: ['관세·무역', 'Tariffs and trade'],
    takeaway: [
      '무역제도 개편 방침을 기본관세 10%와 국가별 추가 관세로 구체화한 뒤, 양자 협상에서 나라별로 인상과 인하를 모두 제시했습니다.',
      'A pledge to overhaul trade became a 10% tariff baseline with higher country rates. Bilateral bargaining then produced announcements of both increases and reductions.',
    ],
    milestones: [
      { date: '2025-01-20', kind: 'speech', change: ['무역제도 개편 예고', 'Pledged a trade overhaul'],
        summary: ['취임 연설에서 미국의 노동자와 가계를 보호하기 위해 무역제도를 개편하겠다고 밝혔습니다.', 'In his inaugural address, Trump pledged to overhaul trade policy to protect American workers and families.'],
        url: 'https://www.whitehouse.gov/remarks/2025/01/the-inaugural-address/' },
      { date: '2025-04-02', kind: 'order', change: ['기본 10%와 국가별 세율 명시', 'Set a 10% baseline and country rates'],
        summary: ['행정명령은 예외 품목을 두고 기본 10%의 추가 관세와 일부 교역국에 대한 더 높은 세율을 명시했습니다.', 'An executive order set an additional 10% baseline and higher rates for certain trading partners, subject to exclusions.'],
        url: 'https://www.whitehouse.gov/presidential-actions/2025/04/regulating-imports-with-a-reciprocal-tariff-to-rectify-trade-practices-that-contribute-to-large-and-persistent-annual-united-states-goods-trade-deficits/' },
      { date: '2026-01-27', kind: 'post', change: ['한국 관세 15% → 25% 인상 발표', 'Announced a South Korea tariff increase from 15% to 25%'],
        summary: ['한국 국회의 무역합의 관련 입법 지연을 이유로 자동차 등 한국산 품목에 대한 관세를 인상하겠다고 밝혔습니다.', 'Trump cited South Korea’s legislative delay on the trade deal when announcing higher tariffs on goods including automobiles.'],
        url: truth('115963633972056786') },
      { date: '2026-02-03', kind: 'post', change: ['인도 관세 25% → 18% 인하 합의 발표', 'Announced a deal to cut India’s rate from 25% to 18%'],
        summary: ['모디 총리와 무역 합의를 맺었으며, 미국의 대인도 상호관세율을 낮추기로 했다고 밝혔습니다.', 'Trump said he reached a trade deal with Prime Minister Modi under which the US would lower its reciprocal tariff on India.'],
        url: truth('116002095109616255') },
      { date: '2026-11-20', kind: 'speech', change: ['태국·필리핀 무역 합의 설명', 'Described trade deals with Thailand and the Philippines'],
        summary: ['백악관 브리핑에서 태국의 미국산 제품 관세 철폐와 필리핀항공의 보잉 항공기 구매 계획을 언급했습니다.', 'At a White House briefing, Trump cited tariff removal on US goods by Thailand and a planned Boeing order by Philippine Airlines.'],
        url: 'https://www.whitehouse.gov/releases/2026/11/at-press-briefing-president-trump-touts-historic-wins-for-americans-signals-deal-making-on-healthcare/' },
    ],
  },
  {
    title: ['연준·금리', 'Fed and interest rates'],
    takeaway: [
      '금리 인하 요구는 이어졌습니다. 초기 게시물에서는 주택시장 개선을 강조했고, 이후 물가와 이자 부담을 근거로 들다가 구체적인 금리 수준을 제시했습니다.',
      'The call for rate cuts persisted. Trump first emphasized housing, then cited inflation and interest costs, and eventually named a specific rate.',
    ],
    milestones: [
      { date: '2025-09-15', kind: 'post', change: ['즉시 더 큰 폭의 인하 요구', 'Called for a bigger, immediate cut'],
        summary: ['파월 의장에게 예상보다 큰 폭의 금리 인하를 요구하며 주택시장이 살아날 것이라고 주장했습니다.', 'Trump urged Chair Powell to cut rates more than planned, saying housing would benefit.'],
        url: truth('115208353139528932') },
      { date: '2026-01-29', kind: 'post', change: ['동결 비판과 이자 부담 강조', 'Criticized holding rates and emphasized interest costs'],
        summary: ['금리를 유지한 연준을 비판하며 물가 압력이 약해졌고 높은 금리가 정부 이자 부담을 키운다고 주장했습니다.', 'Trump criticized the Fed for holding rates, arguing that inflation was no longer a threat and high rates increased government interest costs.'],
        url: truth('115978487020569325') },
      { date: '2026-09-17', kind: 'post', change: ['금리 1% 이하를 요구', 'Called for rates of 1% or less'],
        summary: ['미국의 신용도와 신규 투자를 근거로 미국 금리가 1% 이하여야 한다고 주장했습니다.', 'Citing US creditworthiness and new investment, Trump said US interest rates should be at or below 1%.'],
        url: truth('117282643318690567') },
    ],
  },
  {
    title: ['반도체·미국 투자', 'Chips and US investment'],
    takeaway: [
      '초기에는 미국 내 생산 투자를 강조했습니다. 이후 일부 첨단칩 수입에 관세를 적용하면서 미국 내 공급망 관련 용도에는 예외를 두었습니다.',
      'The early emphasis was on US manufacturing investment. A later proclamation imposed tariffs on some advanced chips with exceptions for uses that support the domestic supply chain.',
    ],
    milestones: [
      { date: '2025-03-03', kind: 'release', change: ['TSMC 미국 투자 1,000억 달러 추가 발표', 'Announced $100 billion in additional TSMC investment'],
        summary: ['백악관은 TSMC의 미국 반도체 제조 투자 확대를 발표했습니다.', 'The White House announced an expansion of TSMC’s investment in US chipmaking.'],
        url: 'https://www.whitehouse.gov/releases/2025/03/another-historic-investment-secured-under-president-trump/' },
      { date: '2026-01-14', kind: 'order', change: ['일부 첨단칩 25% 관세와 예외 명시', 'Specified 25% tariffs and exceptions for certain chips'],
        summary: ['대통령 포고문은 일부 첨단 컴퓨팅 칩에 25% 관세를 정하고 미국 내 데이터센터·연구개발 등에는 예외를 두었습니다.', 'A presidential proclamation set a 25% rate on some advanced computing chips, with exceptions including US data-center and R&D use.'],
        url: 'https://www.whitehouse.gov/presidential-actions/2026/01/adjusting-imports-of-semiconductors-semiconductor-manufacturing-equipment-and-their-derivative-products-into-the-united-states/' },
      { date: '2026-07-18', kind: 'post', change: ['TSMC 애리조나 추가 투자 언급', 'Cited further TSMC investment in Arizona'],
        summary: ['TSMC가 애리조나 공장에 1,000억 달러를 더 투자한다고 밝히며, 미국 내 생산을 늘리는 것이 관세 정책의 목적이라고 강조했습니다.', 'Trump said TSMC would invest another $100 billion in Arizona and linked his tariffs to expanding production in the United States.'],
        url: truth('116936972968744613') },
    ],
  },
];

const sourceNames: Record<Milestone['kind'], Localized> = {
  speech: ['백악관 연설', 'White House speech'],
  post: ['Truth Social 게시물', 'Truth Social post'],
  order: ['백악관 정책 문서', 'White House policy document'],
  release: ['백악관 발표', 'White House release'],
};

export function TrumpPolicyHistory() {
  const { t } = useLang();
  const [active, setActive] = useState(0);
  const topic = topics[active];
  return <section aria-labelledby="trump-history-title" className="tl-card">
    <h2 id="trump-history-title" className="mb-3 text-lg font-semibold">{t('트럼프 발언·정책 변화 이력', 'Trump’s statements and policy timeline')}</h2>
    <div aria-label={t('비교 주제', 'Topics')} role="group" className="tl-scopes mb-3">
      {topics.map((entry, index) => <button type="button" key={entry.title[1]} aria-pressed={active === index}
        className={'tl-chip' + (active === index ? ' on' : '')} onClick={() => setActive(index)}>{t(...entry.title)}</button>)}
    </div>
    <p className="mb-3 text-sm font-medium">{t(...topic.takeaway)}</p>
    <p className="tl-muted mb-3">{t('주요 시점만 선별했습니다. SNS 날짜는 한국시간, 백악관 자료는 문서에 표시된 날짜입니다.', 'Selected milestones. Social posts use Korea time. White House sources use their published dates.')}</p>
    <ol className="tl-list">
      {topic.milestones.map(entry => <li key={entry.date}>
        <div className="tl-date"><strong><time dateTime={entry.date}>{entry.date.replace(/-/g, '.')}</time></strong></div>
        <div className="tl-card">
          <h3 className="mb-1 text-sm font-semibold">{t(...entry.change)}</h3>
          <p className="tl-text">{t(...entry.summary)}</p>
          <a className="tl-source" href={entry.url} target="_blank" rel="noreferrer">{t(...sourceNames[entry.kind])} ↗</a>
        </div>
      </li>)}
    </ol>
  </section>;
}
