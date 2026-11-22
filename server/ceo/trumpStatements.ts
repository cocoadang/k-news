/** Selected public remarks with publication dates and links to primary sources. */
const truthPosts = [
  ["117644175826027343","2026-11-19T12:01:00-05:00","Also, will be discussing the Trade Deals with Thailand, the Philippines, and others.","태국, 필리핀 등과의 무역 합의를 논의할 예정이라고 밝혔다.","https://www.trumpstruth.org/statuses/43630","규제 / 반독점"],
  ["117636323928351024","2026-11-18T02:44:00-05:00","I am pleased to announce that we made a new and completely different Trade Deal with the Philippines","필리핀과 기존과 다른 새로운 무역 합의를 맺었다고 밝혔다.","https://www.presidency.ucsb.edu/documents/truth-social-posts-november-17-2026","규제 / 반독점"],
  ["117629011695762969","2026-11-16T19:44:00-05:00","I am working to END the Left's War on Energy Affordability and Energy Security","에너지 비용 부담 완화와 에너지 안보 강화를 추진 중이라고 밝혔다.","https://www.presidency.ucsb.edu/documents/truth-social-posts-november-16-2026","에너지 / 배터리"],
  ["117616010798312169","2026-11-14T12:38:00-05:00","Hopefully Republicans and Democrats will get together and finalize this already very actively negotiated Legislation.","협상 중인 영화·TV·엔터테인먼트 산업 활성화 법안을 양당이 함께 마무리하길 바란다고 밝혔다.","https://www.presidency.ucsb.edu/documents/truth-social-posts-november-14-2026","규제 / 반독점"],
  ["117603372250841698","2026-11-12T07:04:00-05:00","the Tariffs on Mexico will be IMMEDIATELY DOUBLED.","멕시코가 미국으로 향하는 이주 행렬을 막지 않으면 대멕시코 관세를 즉시 두 배로 올리겠다고 밝혔다.","https://www.presidency.ucsb.edu/documents/truth-social-posts-november-12-2026","규제 / 반독점"],
] as const;

export function curatedTrumpStatements() {
  const posts = truthPosts.map(([id, postedAt, quoteText, curatedSummaryKo, archiveUrl, topicId]) => ({
    statementId: 'truth_' + id,
    personId: 'donald-trump',
    companyId: 'white-house',
    topicId,
    kind: 'social_post',
    sourceType: 'social_post',
    socialPlatform: 'Truth Social',
    quoteText,
    quoteLanguage: 'en',
    curatedSummaryKo,
    referenceDate: { value: new Date(Date.parse(postedAt) + 9 * 3_600_000).toISOString().slice(0, 10), basis: 'written', precision: 'day' },
    evidence: [{
      articleId: 'truth_' + id,
      url: 'https://truthsocial.com/@realDonaldTrump/' + id,
      sourceName: 'Truth Social @realDonaldTrump',
      articlePublishedAt: new Date(postedAt).toISOString(),
    }, { articleId: 'truth_archive_' + id, url: archiveUrl, sourceName: 'Truth Social archive' }],
    isExample: false,
  }));
  return [...posts, {
    statementId: 'white_house_2026_11_20_thailand_trade',
    personId: 'donald-trump',
    companyId: 'white-house',
    topicId: '규제 / 반독점',
    kind: 'direct_quote',
    quoteText: 'Thailand signed an agreement to eliminate all tariffs on American products',
    quoteLanguage: 'en',
    curatedSummaryKo: '트럼프는 백악관 브리핑에서 태국이 미국산 제품 관세를 철폐하는 합의에 서명했다고 밝혔다.',
    referenceDate: { value: '2026-11-20', basis: 'spoken', precision: 'day' },
    evidence: [{
      articleId: 'white_house_2026_11_20_press_briefing',
      url: 'https://www.whitehouse.gov/releases/2026/11/at-press-briefing-president-trump-touts-historic-wins-for-americans-signals-deal-making-on-healthcare/',
      sourceName: 'The White House · Press Briefing',
    }],
    isExample: false,
  }];
}
