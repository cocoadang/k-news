import { useState } from 'react';
import { useLang } from '../../../i18n';
import { HistoryPanel } from './HistoryPanel';
import { SourcedInvestorEntry } from './InvestorHistory';
import { investorArchive } from './investorArchive';

type Localized = readonly [ko: string, en: string];
type Milestone = {
  date: string;
  kind: 'speech' | 'post' | 'order' | 'release' | 'interview';
  change: Localized;
  summary: Localized;
  url: string;
};
type Topic = { id: string; title: Localized; milestones: Milestone[] };
const truth = (id: string) => 'https://truthsocial.com/@realDonaldTrump/' + id;

const topics: Topic[] = [
  {
    id: 'trade', title: ['관세·무역', 'Tariffs and trade'],
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
    id: 'rates', title: ['금리·연준', 'Rates and the Fed'],
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
    id: 'rivalry', title: ['전쟁·미중 패권', 'War and US–China rivalry'],
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
    id: 'investment', title: ['미국 투자', 'US investment'],
    milestones: [
      { date: '2026-11-23', kind: 'interview', change: ['CNBC에서 엔비디아 이사회를 설득했다고 설명', 'Told CNBC he persuaded Nvidia’s board'],
        summary: ['트럼프는 엔비디아 이사회와 접촉해 복귀를 설득했고, 복귀가 결정된 뒤 젠슨 황과 통화했다고 밝혔습니다. 복귀 후 엔비디아가 좋은 실적을 낼 것으로 기대했습니다.', 'Trump said he spoke with Nvidia’s board and persuaded it to reinstate Huang, then called Huang after the decision. He expected Nvidia to perform well after Huang’s return.'],
        url: 'https://pressroom.versantmedia.com/cnbc/press-releases/cnbc-transcript-president-donald-trump-speaks-cnbcs-eamon-javers-and-squawk' },
      { date: '2026-11-23', kind: 'post', change: ['젠슨 황 복귀 환영·수출통제 조사 지속 요구', 'Welcomed Huang’s return and urged Nvidia to continue its export-control review'],
        summary: ['트럼프는 이사회의 복귀 결정을 환영하며 국가안보 위험을 뒷받침할 근거가 없다는 미 정부 입장을 전했습니다. 엔비디아에는 미국 수출통제 준수 여부에 대한 내부 조사를 계속하라고 요청했습니다.', 'Trump welcomed the decision and said the US government had no reason to believe the return posed a national security risk. He urged Nvidia to continue its internal review of compliance with US export controls.'],
        url: truth('117666141823845971') },
      { date: '2026-11-22', kind: 'post', change: ['이사회에 젠슨 황 재선임 촉구', 'Urged Nvidia’s board to rehire Huang'],
        summary: ['트럼프는 젠슨 황의 복귀가 엔비디아와 미국 모두에 최선이라고 밝혔습니다.', 'Trump said bringing Huang back would be best for Nvidia and the United States.'],
        url: truth('117663497310955803') },
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
  interview: ['CNBC 인터뷰 전문', 'CNBC interview transcript'],
  post: ['Truth Social 게시물', 'Truth Social post'],
  order: ['백악관 정책 문서', 'White House policy document'],
  release: ['백악관 발표', 'White House release'],
};

export function TrumpPolicyHistory() {
  const { t } = useLang();
  const [active, setActive] = useState(topics[0].id);
  const topic = topics.find(entry => entry.id === active) || topics[0];
  const archive = investorArchive['donald-trump'];
  const entries = [
    ...topic.milestones.map(entry => ({
      date: entry.date, headline: entry.change, text: entry.summary,
      source: t(...sourceNames[entry.kind]), url: entry.url,
    })),
    ...archive.filter(entry => entry.topic === topic.id),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return <HistoryPanel
    title={t('트럼프 발언·정책 변화 이력', 'Trump’s statements and policy timeline')}
    topics={topics.map(entry => ({ id: entry.id, label: t(...entry.title) }))}
    activeId={active}
    onSelect={setActive}
  >
    {entries.map(entry => <SourcedInvestorEntry key={entry.url} entry={entry}/>)}
  </HistoryPanel>;
}
