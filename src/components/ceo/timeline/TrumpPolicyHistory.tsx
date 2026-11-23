import { useState } from 'react';
import truthSocialManifest from './truthSocialManifest.json';
import { useLang } from '../../../i18n';
import { HistoryPanel, HistoryEntry } from './HistoryPanel';

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
    title: ['금리·연준', 'Rates and the Fed'],
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
    title: ['전쟁·미중 패권', 'War and US–China rivalry'],
    takeaway: [
      '2025년에는 중국과 희토류·수출통제 등 공급망 현안을 협상했고, 2026년에는 미·중·러 정상 협의에서 핵 위험과 국제 안보를 논의했습니다.',
      'In 2025, talks with China addressed rare earths and export controls. In 2026, US, Chinese and Russian leaders discussed nuclear risk and international security.',
    ],
    milestones: [
      { date: '2025-11-01', kind: 'release', change: ['미중 합의에 희토류 수출통제 유예 포함', 'US–China deal included a pause in rare earth export controls'],
        summary: ['백악관은 중국이 새 희토류 수출통제의 글로벌 시행을 유예하기로 했다고 발표했습니다.', 'The White House said China agreed to suspend global implementation of new rare earth export controls.'],
        url: 'https://www.whitehouse.gov/fact-sheets/2025/11/fact-sheet-president-donald-j.-trump-strikes-deal-on-economic-and-trade-relations-with-china/' },
      { date: '2026-11-19', kind: 'release', change: ['미·중·러 핵 위험 감축 대화 합의', 'US, China and Russia agreed to nuclear risk talks'],
        summary: ['선전 정상회담 공동선언에서 세 나라는 핵 위험 감축과 핵확산 방지를 위한 대화를 추진하기로 했습니다.', 'The Shenzhen summit declaration committed the three countries to talks on reducing nuclear risk and preventing proliferation.'],
        url: 'https://www.whitehouse.gov/briefings-statements/2026/11/u-s-russia-china-heads-of-state-declaration-toward-peace/' },
      { date: '2026-11-20', kind: 'speech', change: ['우크라이나 전쟁 외교 해법 언급', 'Discussed diplomacy on the war in Ukraine'],
        summary: ['트럼프는 백악관 브리핑에서 푸틴이 러시아·우크라이나 전쟁의 외교적 해결을 원한다고 자신에게 밝혔다고 전했습니다.', 'Trump told a White House briefing that Putin had expressed a desire to end Russia’s war in Ukraine through diplomacy.'],
        url: 'https://www.whitehouse.gov/releases/2026/11/at-press-briefing-president-trump-touts-historic-wins-for-americans-signals-deal-making-on-healthcare/' },
    ],
  },
  {
    title: ['미국 투자', 'US investment'],
    takeaway: [
      'TSMC와 애플의 미국 내 생산 투자 계획이 발표됐고, 일부 첨단칩 관세에는 미국 내 공급망을 지원하는 용도의 예외가 명시됐습니다.',
      'TSMC and Apple announced US manufacturing plans. A later proclamation imposed tariffs on some advanced chips with exceptions for uses that support the domestic supply chain.',
    ],
    milestones: [
      { date: '2025-03-03', kind: 'release', change: ['TSMC 미국 투자 1,000억 달러 추가 발표', 'Announced $100 billion in additional TSMC investment'],
        summary: ['백악관은 TSMC의 미국 반도체 제조 투자 확대를 발표했습니다.', 'The White House announced an expansion of TSMC’s investment in US chipmaking.'],
        url: 'https://www.whitehouse.gov/releases/2025/03/another-historic-investment-secured-under-president-trump/' },
      { date: '2025-08-06', kind: 'release', change: ['애플, 4년간 미국 투자 계획 6,000억 달러로 확대', 'Apple raised its four-year US commitment to $600 billion'],
        summary: ['트럼프와 팀 쿡은 애플이 기존 계획에 1,000억 달러를 추가하고 미국 제조 프로그램을 시작한다고 발표했습니다.', 'Trump and Tim Cook announced that Apple would add $100 billion to its prior commitment and launch an American manufacturing program.'],
        url: 'https://www.whitehouse.gov/releases/2025/08/apple-600-billion-commitment-to-boost-u-s-manufacturing/' },
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
  const [active, setActive] = useState(topics[0].title[1]);
  const topic = topics.find(entry => entry.title[1] === active) || topics[0];
  const postCount = truthSocialManifest.reduce((total, year) => total + year.count, 0).toLocaleString();
  const milestoneCount = topics.reduce((total, entry) => total + entry.milestones.length, 0);
  return <HistoryPanel
    title={t('트럼프 발언·정책 변화 이력', 'Trump’s statements and policy timeline')}
    topics={topics.map(entry => ({ id: entry.title[1], label: t(...entry.title) }))}
    activeId={active}
    onSelect={setActive}
    topicTitle={t(...topic.title)}
    summary={t(...topic.takeaway)}
    metadata={t(
      `Truth Social 보관본 ${postCount}건 · 2026-11-22 기준 · 이 화면은 주요 발언·정책 ${milestoneCount}건 선별`,
      `Truth Social archive: ${postCount} posts as of 2026-11-22 · ${milestoneCount} selected statements and policy milestones shown`,
    )}
  >
    {[...topic.milestones].sort((a, b) => b.date.localeCompare(a.date)).map(entry => <HistoryEntry
      key={entry.date}
      date={entry.date}
      dateLabel={entry.date.replace(/-/g, '.')}
      source={<a className="tl-source" href={entry.url} target="_blank" rel="noreferrer">{t(...sourceNames[entry.kind])} ↗</a>}
    >
      <h4 className="tl-milestone">{t(...entry.change)}</h4>
      <p className="tl-text">{t(...entry.summary)}</p>
    </HistoryEntry>)}
  </HistoryPanel>;
}
