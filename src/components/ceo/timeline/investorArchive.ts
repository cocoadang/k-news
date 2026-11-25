type Localized = readonly [ko: string, en: string];

export type InvestorEntry = {
  date: string;
  headline: Localized;
  text: Localized;
  source: string;
  url: string;
};

type ArchiveEntry = InvestorEntry & { topic: string };

// Dates refer to the letter, publication or interview, according to the linked source.
export const investorArchive: Record<string, readonly ArchiveEntry[]> = {
  'ken-griffin': [
    {
      topic: 'rates', date: '2023-03-07',
      headline: ['연준에 일관된 물가 대응 메시지를 주문', 'Called for consistent Fed messaging on inflation'],
      text: ['인플레이션을 잡으려면 연준이 일관되게 소통해야 한다고 지적하고, 경기침체로 이어질 조건이 형성되고 있다고 봤습니다.',
        'He called for more consistent Fed communication to contain inflation and said conditions for a recession were developing.'],
      source: 'Reuters',
      url: 'https://www.investing.com/news/economy/citadels-griffin-says-the-fed-needs-more-consistency-to-tame-inflation-3024398',
    },
    {
      topic: 'trade', date: '2019-02-26',
      headline: ['미중·미유럽 무역분쟁의 해결을 관전 요인으로 지목', 'Identified trade resolutions as key developments to watch'],
      text: ['투자자 서한에서 미국과 중국·유럽의 무역분쟁 해결, 브렉시트 합의, 이탈리아의 정치·경제 안정이 중요하다고 밝혔습니다.',
        'His investor letter singled out US trade disputes with China and Europe, a Brexit agreement and stabilization in Italy as important developments.'],
      source: 'Citadel · Investor letter',
      url: 'https://www.citadel.com/news/ken-griffin-current-economic-landscape-firms-2019-areas-focus/',
    },
    {
      topic: 'market', date: '2008-11-13',
      headline: ['파생상품 중앙청산으로 금융위기 전염 위험을 낮추자고 제안', 'Proposed central clearing to reduce financial contagion'],
      text: ['미 하원 청문회에서 장외 신용부도스와프 시장의 불투명성과 금융회사 간 연결성을 지적하고 중앙청산을 제안했습니다.',
        'He told a US House committee that opaque over-the-counter credit default swaps created interconnected risks and proposed central clearing.'],
      source: 'US House Oversight Committee · Written testimony',
      url: 'https://oversightdemocrats.house.gov/imo/media/doc/migrated/20081113120556.pdf',
    },
  ],
  'howard-marks': [
    {
      topic: 'credit', date: '2022-12-13',
      headline: ['금리 환경이 바뀌며 신용 투자 매력이 높아졌다고 평가', 'Saw a new rate regime improving credit opportunities'],
      text: ['장기간 이어진 저금리 환경이 바뀌고 대출기관이 더 높은 수익률을 요구할 수 있게 되면서 신용 투자 매력이 높아졌다고 판단했습니다.',
        'He argued that the end of a long low-rate regime and higher yields for lenders made credit more attractive.'],
      source: 'Oaktree · Sea Change',
      url: 'https://www.oaktreecapital.com/insights/memo/sea-change',
    },
    {
      topic: 'credit', date: '2008-10-15',
      headline: ['금융위기의 극단적 비관 속에서 매수 기회 검토', 'Looked for buying opportunities amid extreme crisis pessimism'],
      text: ['금융위기 상황에서 최악의 전망이 가격에 반영되고 있다면 불확실성이 사라질 때까지 기다리지 않고 투자 기회를 검토해야 한다고 봤습니다.',
        'During the financial crisis, he argued that investors should consider opportunities before uncertainty subsides when prices already reflect dire expectations.'],
      source: 'Oaktree · The Limits to Negativism',
      url: 'https://www.oaktreecapital.com/insights/memo/the-limits-to-negativism',
    },
  ],
  'jamie-dimon': [
    {
      topic: 'rates', date: '2023-04-04',
      headline: ['급격한 금리 상승과 긴축을 위험 요인으로 점검', 'Assessed rapid rate hikes and tightening as risks'],
      text: ['2022년 고물가와 빠른 금리 인상에 이어 양적긴축 및 지정학 위험이 경기와 금융시장에 미칠 영향을 주주서한에서 점검했습니다.',
        'After 2022’s inflation spike and rapid rate hikes, his letter examined the economic and market risks posed by quantitative tightening and geopolitics.'],
      source: 'JPMorganChase · 2022 annual shareholder letter',
      url: 'https://reports.jpmorganchase.com/investor-relations/2022/ar-ceo-letters.htm',
    },
    {
      topic: 'market', date: '2021-04-07',
      headline: ['재정 지원과 백신 보급으로 미국 경기 호황 전망', 'Expected fiscal support and vaccination to fuel a US boom'],
      text: ['재정 지출, 가계 저축과 백신 보급이 맞물리면 미국 경기 호황이 2023년까지 이어질 수 있다고 전망했습니다.',
        'He expected public spending, household savings and vaccine deployment to fuel a US boom that could extend into 2023.'],
      source: 'JPMorganChase · 2020 annual shareholder letter',
      url: 'https://www.jpmorganchase.com/content/dam/jpmc/jpmorgan-chase-and-co/investor-relations/documents/ceo-letter-to-shareholders-2020.pdf',
    },
  ],
  'ken-fisher': [
    {
      topic: 'market', date: '2025-09-15',
      headline: ['상승장의 출발점을 2022년 하반기로 평가', 'Dated the start of the bull market to the second half of 2022'],
      text: ['2025년 9월 팟캐스트에서 당시 상승장이 2022년 여름에서 10월 사이에 시작됐다고 회고했습니다.',
        'In a September 2025 podcast, he dated the prevailing bull market to between summer and October 2022.'],
      source: 'Fisher Investments · September 2025 podcast',
      url: 'https://www.fisherinvestments.com/en-us/insights/podcasts/september-2025-ken-fisher-on-cryptocurrency-investing',
    },
    {
      topic: 'market', date: '2024-03-05',
      headline: ['주가 상승에 금리 인하가 필수는 아니라고 평가', 'Argued stocks could do well without rate cuts'],
      text: ['금리 인상기에도 경기와 주식시장이 버텼으며, 연준 정책에 대한 널리 알려진 기대는 이미 가격에 반영됐다고 봤습니다.',
        'He argued that the economy and equities had held up through rate increases and that widely anticipated Fed moves were already priced in.'],
      source: 'Fisher Investments · Video transcript',
      url: 'https://www.fisherinvestments.com/en-us/insights/videos/fisher-investments-reviews-why-stocks-dont-need-rate-cuts-in-2024',
    },
    {
      topic: 'market', date: '2023-10-03',
      headline: ['하락폭이 컸던 종목의 초기 반등 효과 설명', 'Explained why the hardest-hit stocks can lead an early rebound'],
      text: ['약세장에서 가장 많이 떨어진 종목이 다음 강세장 초기에 상대적으로 크게 반등하는 경향이 있다고 설명했습니다.',
        'He described a tendency for stocks that fell the most in a bear market to rebound the most early in the following bull market.'],
      source: 'Fisher Investments · Video transcript',
      url: 'https://www.fisherinvestments.com/en-us/insights/videos/ken-fisher-gives-an-update-on-the-bounce-effect-in-2023',
    },
    {
      topic: 'market', date: '2022-04-12',
      headline: ['조정장과 약세장의 특성을 비교', 'Distinguished a correction from a conventional bear market'],
      text: ['단기간의 주가 조정과 오래 이어지는 일반적인 약세장의 특징을 비교하고, 두 유형을 구별하는 이유를 설명했습니다.',
        'He contrasted short corrections with longer conventional bear markets and explained why distinguishing them matters.'],
      source: 'Fisher Investments · Video transcript',
      url: 'https://www.fisherinvestments.com/en-us/insights/videos/fisher-investments-founder-identifies-the-difference-between-a-correction-and-a-bear-market',
    },
  ],
  'michael-burry': [
    {
      topic: 'strategy', date: '2019-08-16',
      headline: ['게임스톱 이사회에 자사주 매입 촉구', 'Urged GameStop’s board to complete its buyback'],
      text: ['주가가 4달러 미만일 때 남은 2억 3,760만 달러의 자사주 매입 한도를 집행하면 발행 주식 수를 크게 줄일 수 있다고 주장했습니다.',
        'With shares below $4, he urged GameStop to use the remaining $237.6 million authorization to retire a substantial share of its stock.'],
      source: 'SEC EDGAR · Scion letter, Exhibit D',
      url: 'https://www.sec.gov/Archives/edgar/data/1649339/000090514820000491/efc20-335_sc13d.htm',
    },
    {
      topic: 'market', date: '2010-04-03',
      headline: ['서브프라임 대출 부실 징후를 확인한 과정을 회고', 'Recounted identifying early signs of subprime deterioration'],
      text: ['기고문에서 2004년부터 신용도가 낮은 차주에게 위험한 대출이 확대되는 점을 확인했고, 대출 자료를 분석해 주택금융의 부실 위험을 판단했다고 회고했습니다.',
        'In a retrospective op-ed, he said riskier lending to subprime borrowers expanded from 2004 and that loan-level research helped him identify the danger.'],
      source: 'The New York Times · Michael J. Burry op-ed (archived copy)',
      url: 'https://www.economicsvoodoo.com/wp-content/uploads/2010-04-03-I-Saw-the-Crisis-Coming.-Why-Didn%E2%80%99t-the-Fed-Michael-J-Burry_The-New-York-Times.pdf',
    },
  ],
  'stanley-druckenmiller': [
    {
      topic: 'portfolio', date: '2023-06-07',
      headline: ['미국 경기의 경착륙 가능성 경고', 'Warned of a hard landing for the US economy'],
      text: ['블룸버그 투자 콘퍼런스에서 금리 인상의 충격이 일부 분야에 아직 나타나지 않았으며 미국 경제가 경착륙할 수 있다고 봤습니다.',
        'At a Bloomberg investment conference he said some sectors had yet to feel the effects of rate hikes and expected a US hard landing.'],
      source: 'Reuters · Bloomberg investment conference',
      url: 'https://www.investing.com/news/economy/investor-druckenmiller-expects-hard-landing-for-us-economy-bullish-on-ai-3100205',
    },
    {
      topic: 'ai', date: '2023-06-07',
      headline: ['AI 성장에 주목해 엔비디아 장기 보유 의향 표명', 'Saw Nvidia as a multiyear holding if AI delivered'],
      text: ['AI의 성장 잠재력이 예상대로라면 엔비디아를 2~3년 이상 보유할 의향이 있다고 밝혔습니다.',
        'He said he would want to hold Nvidia for two or three years or longer if AI’s potential matched his expectations.'],
      source: 'Reuters · Bloomberg investment conference',
      url: 'https://www.investing.com/news/economy/investor-druckenmiller-expects-hard-landing-for-us-economy-bullish-on-ai-3100205',
    },
    {
      topic: 'rates', date: '2021-05-11',
      headline: ['연준의 초완화 정책을 비판', 'Criticized the Fed’s very accommodative policy'],
      text: ['CNBC 인터뷰에서 당시 경제 상황에 비해 연준의 초완화적 통화정책이 지나치다고 판단했습니다.',
        'In a CNBC interview he argued that the Fed’s very accommodative stance was inappropriate for the economic conditions.'],
      source: 'CNBC Television · Interview',
      url: 'https://www.youtube.com/watch?v=ScAeHsXIUqI',
    },
    {
      topic: 'portfolio', date: '2016-05-04',
      headline: ['미국 주식 강세장에 피로가 쌓였다고 판단', 'Saw the US equity bull market losing steam'],
      text: ['손 투자 콘퍼런스에서 세계 성장 둔화와 미국·중국 정책의 여파를 근거로 미국 주식에 부정적인 견해를 밝혔습니다.',
        'At the Sohn conference he turned bearish on US equities, citing weaker global growth and the effects of US and Chinese policy.'],
      source: 'Reuters · Sohn Investment Conference',
      url: 'https://finance.yahoo.com/news/sohn-conference-druckenmiller-says-u-212656823.html',
    },
  ],
  'bill-ackman': [
    {
      topic: 'archive', date: '2023-03-29',
      headline: ['2022년 금리 헤지 성과와 배경 설명', 'Explained the performance of the 2022 rate hedge'],
      text: ['퍼싱스퀘어 연차보고서는 금리 상승에 대비한 헤지가 2022년 S&P 500 대비 초과 성과의 주요 요인이었다고 설명했습니다.',
        'Pershing Square’s annual report attributed its 2022 outperformance against the S&P 500 primarily to hedges against rising rates.'],
      source: 'Pershing Square Holdings · 2022 annual report',
      url: 'https://assets.pershingsquareholdings.com/2023/03/29160536/Pershing-Square-Holdings-Ltd.-2022-Annual-Report.pdf',
    },
    {
      topic: 'archive', date: '2020-03-26',
      headline: ['코로나19 헤지 청산 후 주식에 재투자', 'Unwound pandemic hedges and redeployed proceeds into equities'],
      text: ['코로나19로 인한 급락에 대비한 신용 헤지를 청산해 26억 달러를 확보했고, 대부분을 신규 및 기존 주식 투자에 투입했다고 밝혔습니다.',
        'He disclosed realizing $2.6 billion in proceeds from pandemic-related credit hedges and redeploying most of it into new and existing equity investments.'],
      source: 'Pershing Square · Letter to investors',
      url: 'https://pershingsquareholdings.com/wp-content/uploads/2020/03/Pershing-Square-Capital-Management-L.P.-Releases-Letter-to-Investors-March-26-2020.pdf',
    },
  ],
  'ray-dalio': [
    {
      topic: 'archive', date: '2022-09-13',
      headline: ['금리 상승이 자산 가격과 성장을 압박한다고 분석', 'Analyzed how rising rates pressure asset prices and growth'],
      text: ['인플레이션을 억제하기 위한 금리 상승이 자산의 현재가치를 낮추고 실물경제 성장에도 부담을 준다고 설명했습니다.',
        'He explained how higher rates to contain inflation would reduce the present value of assets and weigh on growth.'],
      source: 'Ray Dalio · It Starts With Inflation',
      url: 'https://www.linkedin.com/pulse/starts-inflation-ray-dalio',
    },
    {
      topic: 'archive', date: '2020-01-30',
      headline: ['코로나19 초기 확산 위험에 분산·헤지 강조', 'Emphasized diversification and hedging early in the pandemic'],
      text: ['코로나19의 확산과 시장 영향을 예측하기 어려운 상황에서 과거 팬데믹을 연구하고 포트폴리오를 분산하거나 헤지하겠다고 밝혔습니다.',
        'Facing uncertainty about the virus and its market impact, he said he would study past pandemics and keep portfolios diversified or hedged.'],
      source: 'Ray Dalio · Our Early Thinking on the Coronavirus and Pandemics',
      url: 'https://www.linkedin.com/pulse/our-early-thinking-coronavirus-pandemics-ray-dalio',
    },
    {
      topic: 'archive', date: '2019-07-17',
      headline: ['지속되기 어려운 시장 체제의 전환 가능성 제기', 'Warned that prevailing market dynamics could reverse'],
      text: ['투자자가 오랫동안 이어진 시장 관계를 미래에도 그대로 적용하다 보면 과잉이 생기고, 그 결과 시장이 반대 방향으로 움직일 수 있다고 설명했습니다.',
        'He argued that extrapolating long-running market relationships can create excesses that ultimately lead those relationships to reverse.'],
      source: 'Ray Dalio · Paradigm Shifts',
      url: 'https://www.linkedin.com/pulse/paradigm-shifts-ray-dalio',
    },
  ],
};
