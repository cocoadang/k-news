/**
 * 예시(합성) 데이터. 모든 인물·회사·매체·기사·발언은 가상입니다. 실존 인물·회사와 무관합니다.
 * 화면에는 '예시 데이터'로 표시됩니다. 운영 데이터·모델 호출을 쓰지 않습니다.
 */
import { CeoPerson, CeoRole, CeoTopic } from '../../src/ceo/types';
import { RawStatement, SourceArticle, StatementExtractor } from './pipeline';

export const EXAMPLE_PERSONS: CeoPerson[] = [
  { personId: 'ex-han-seoyun-mobility', displayName: '한서윤', nameVariants: ['Han Seo-yun', '한 대표'], isExample: true },
  { personId: 'ex-han-seoyun-bio', displayName: '한서윤', nameVariants: [], isExample: true },
  { personId: 'ex-oh-taemin', displayName: '오태민', nameVariants: [], isExample: true },
  { personId: 'ex-mark-rivers', displayName: '마크 리버스', nameVariants: ['Mark Rivers', 'Rivers', '리버스'], isExample: true },
  { personId: 'ex-do-harin', displayName: '도하린', nameVariants: [], isExample: true },
];

export const EXAMPLE_ROLES: CeoRole[] = [
  { personId: 'ex-han-seoyun-mobility', companyId: 'ex-mobility', companyName: '예시모빌리티', title: '대표이사(CEO)', roleType: 'ceo', start: '2021-03', end: null },
  { personId: 'ex-han-seoyun-bio', companyId: 'ex-bio', companyName: '예시바이오', title: '최고재무책임자(CFO)', roleType: 'other', start: '2019-01', end: '2025-06' },
  { personId: 'ex-han-seoyun-bio', companyId: 'ex-bio', companyName: '예시바이오', title: '대표이사(CEO)', roleType: 'ceo', start: '2025-07', end: null },
  { personId: 'ex-oh-taemin', companyId: 'ex-mobility', companyName: '예시모빌리티', title: '대표이사(CEO)', roleType: 'ceo', start: '2015-01', end: '2021-02' },
  { personId: 'ex-oh-taemin', companyId: 'ex-energy', companyName: '예시에너지', title: '대표이사(CEO)', roleType: 'ceo', start: '2022-06', end: null },
  { personId: 'ex-mark-rivers', companyId: 'ex-cloud', companyName: '예시클라우드', title: '공동대표(Co-CEO)', roleType: 'co_ceo', start: '2024-01', end: null },
  { personId: 'ex-do-harin', companyId: 'ex-cloud', companyName: '예시클라우드', title: '공동대표(Co-CEO)', roleType: 'co_ceo', start: '2024-01', end: null },
];

export const EXAMPLE_TOPICS: CeoTopic[] = [
  { topicId: 'autonomy_timeline', label: '자율주행 상용화 일정' },
  { topicId: 'pricing', label: '요금·가격 정책' },
  { topicId: 'rd_investment', label: '연구개발 투자' },
  { topicId: 'capex', label: '설비 투자' },
  { topicId: 'ai_capex', label: '데이터센터·AI 투자' },
];

const art = (articleId: string, sourceName: string, publishedAt: string, title: string, body: string): SourceArticle =>
  ({ articleId, sourceName, publishedAt, title, body, url: `https://example.invalid/articles/${articleId}` });

export const EXAMPLE_ARTICLES: SourceArticle[] = [
  art('ex-a1', '예시경제', '2024-05-21T01:00:00.000Z', '예시모빌리티 "연내 무인 서비스 가능"',
    '한서윤 예시모빌리티 대표는 2024년 5월 20일 연례 투자자 행사에서 "올해 안에 완전 무인 서비스를 시작할 수 있다고 본다"고 말했다. 회사는 이달 초 도심 시범 운행 허가를 받았다.'),
  art('ex-a2', 'Example Wire', '2024-05-20T23:00:00.000Z', 'Example Mobility eyes driverless launch',
    'Han Seo-yun, chief executive of Example Mobility, said on May 20, 2024 that "we believe we can launch a fully driverless service this year."'),
  art('ex-a3', '예시일보', '2025-02-11T02:00:00.000Z', '예시모빌리티, 무인 서비스 일정 신중론',
    '한서윤 대표는 이달 열린 기자간담회에서 규제 당국의 승인 절차가 길어지면 무인 서비스 일정이 늦어질 수 있다는 취지로 말했다. 앞서 1월 당국은 자율주행 안전 기준 개정안을 발표했다.'),
  art('ex-a4', '예시경제', '2026-03-15T00:30:00.000Z', '예시모빌리티 주총 "상용화 시점 약속 안 해"',
    '한서윤 대표는 2026년 3월 14일 정기 주주총회에서 "상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다"라고 밝혔다. 2024년 5월 투자자 행사에서 "올해 안에 완전 무인 서비스를 시작할 수 있다고 본다"고 했던 것과 달리 이번에는 시점을 제시하지 않았다.'),
  art('ex-a5', '예시일보', '2026-03-14T09:00:00.000Z', '예시모빌리티 주주총회 현장',
    '한서윤 대표는 2026년 3월 14일 열린 주주총회에서 "상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다"라고 말했다. 그는 "올해는 운행 지역을 두 곳 더 늘린다"고 덧붙였다. 요금과 관련해서는 "구독 요금은 당분간 동결한다"고 했다.'),
  art('ex-a6', '예시경제', '2025-09-03T03:00:00.000Z', '[인터뷰] 한서윤 예시모빌리티 대표',
    '한서윤 대표는 최근 인터뷰에서 무인 서비스는 도시별로 단계적으로 확대할 것이라고 설명했다.'),
  art('ex-a7', '예시일보', '2025-12-30T05:00:00.000Z', '[결산] 2025년 예시모빌리티',
    '한 대표는 2025년 한 해 동안 여러 차례 무인 서비스 출시가 내년 이후가 될 것이라는 뜻을 내비쳤다.'),
  art('ex-b1', '예시바이오뉴스', '2025-08-02T01:00:00.000Z', '예시바이오 새 대표 "R&D 유지"',
    '예시바이오의 한서윤 신임 대표는 2025년 8월 1일 취임 후 첫 간담회에서 "연구개발 투자를 줄이지 않겠다"고 말했다.'),
  art('ex-b2', '예시바이오뉴스', '2026-02-10T01:00:00.000Z', '예시바이오, 연구 과제 일부 정리',
    '한서윤 대표는 2026년 2월 9일 실적 발표에서 "비용 효율화를 위해 일부 연구 과제를 정리한다"고 밝혔다. 취임 때 "연구개발 투자를 줄이지 않겠다"고 했던 그는 지난해 4분기 임상 1건이 중단된 뒤 방향을 바꿨다.'),
  art('ex-b3', '예시산업', '2026-04-02T01:00:00.000Z', '업계 행사 기조연설',
    '한서윤 대표가 2026년 4월 1일 업계 행사에서 "협업이 답이다"라고 기조연설을 했다.'),
  art('ex-c1', '예시경제', '2020-11-05T01:00:00.000Z', '예시모빌리티 오태민 대표 인터뷰',
    '오태민 대표는 2020년 11월 4일 "자율주행은 10년 뒤의 이야기"라고 말했다.'),
  art('ex-c2', '예시일보', '2022-03-08T01:00:00.000Z', '모빌리티 포럼 개최',
    '오태민 전 예시모빌리티 대표는 2022년 3월 7일 한 포럼에서 "자율주행 상용화는 생각보다 빨리 온다"고 말했다. 재임 시절 "자율주행은 10년 뒤의 이야기"라고 했던 그는 이번에 개인 자격으로 참석했다.'),
  art('ex-c3', '예시경제', '2023-01-10T01:00:00.000Z', '예시에너지 증설 신중',
    '오태민 예시에너지 대표는 2023년 1월 9일 "배터리 공장 증설은 수요를 확인한 뒤 결정한다"고 말했다.'),
  art('ex-c4', '예시일보', '2022-05-20T01:00:00.000Z', '예시에너지 대표 내정자 첫 메시지',
    '예시에너지 대표로 내정된 오태민 전 예시모빌리티 대표는 2022년 5월 19일 "에너지 저장 사업에 집중하겠다"고 말했다.'),
  art('ex-d1', 'Example Wire', '2025-06-12T01:00:00.000Z', 'Example Cloud to double spending',
    'Example Cloud co-CEO Mark Rivers said on June 11, 2025: "We will double our data center spending next year."'),
  art('ex-d2', '예시경제', '2026-01-20T01:00:00.000Z', '예시클라우드 공동대표 "속도 조절"',
    '도하린 공동대표는 2026년 1월 19일 "데이터센터 투자는 수익성을 보며 속도를 조절하겠다"고 말했다.'),
  art('ex-d3', 'Example Wire', '2026-01-21T01:00:00.000Z', 'Rivers: capacity plans unchanged',
    'Rivers, who said last June "We will double our data center spending next year.", said on Jan. 20, 2026 the company would "stay the course" on capacity plans.'),
  art('ex-d4', '예시일보', '2026-01-19T01:00:00.000Z', '리버스 대표 "수요 강해"',
    '리버스 대표는 2026년 1월 18일 "수요는 강하다"고 말한 뒤 "다만 전력 확보가 관건"이라고 덧붙였다.'),
];

/** 본문에 연·월·일이 모두 적힌 절대 날짜 구간을 근거로 한 일 단위 발언일 (v3: 상대 날짜·기사일 추정은 쓰지 않음) */
const day = (value: string, basisExcerpt: string) => ({
  value, precision: 'day' as const, basisType: 'explicit_in_text' as const,
  basis: `본문 "${basisExcerpt}"`, basisExcerpt,
});

/** 기사별 추출 결과 (가상의 추출기가 냈다고 가정한 고정 값) */
export const EXAMPLE_RAW: Record<string, RawStatement[]> = {
  'ex-a1': [{
    speaker: { name: '한서윤', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
    spokenAt: day('2024-05-20', '2024년 5월 20일 연례 투자자 행사에서'), kind: 'direct_quote',
    quoteText: '올해 안에 완전 무인 서비스를 시작할 수 있다고 본다', quoteLanguage: 'ko',
    summaryKo: '연내 완전 무인 서비스 시작이 가능하다고 전망',
    excerpts: ['"올해 안에 완전 무인 서비스를 시작할 수 있다고 본다"고 말했다'],
    context: { text: '이달 초 도심 시범 운행 허가를 받은 직후', excerpts: ['회사는 이달 초 도심 시범 운행 허가를 받았다'] },
    eventKey: 'han-mob-2024-05-20-investor-day',
  }],
  'ex-a2': [{
    speaker: { name: 'Han Seo-yun', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
    spokenAt: day('2024-05-20', 'said on May 20, 2024'), kind: 'direct_quote',
    quoteText: 'we believe we can launch a fully driverless service this year', quoteLanguage: 'en',
    summaryKo: '연내 완전 무인 서비스 출시가 가능하다고 봄',
    excerpts: ['"we believe we can launch a fully driverless service this year."'],
    eventKey: 'han-mob-2024-05-20-investor-day',
  }],
  'ex-a3': [{
    speaker: { name: '한서윤', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
    spokenAt: { value: '2025-02', precision: 'month', basisType: 'inferred_from_article', basis: '본문 "이달 열린 기자간담회에서" + 기사 발행일(2025-02-11)', basisExcerpt: '이달 열린 기자간담회에서' },
    kind: 'paraphrase', summaryKo: '규제 승인 절차가 길어지면 무인 서비스 일정이 늦어질 수 있다',
    excerpts: ['규제 당국의 승인 절차가 길어지면 무인 서비스 일정이 늦어질 수 있다는 취지로 말했다'],
    context: { text: '1월 당국의 자율주행 안전 기준 개정안 발표 이후', excerpts: ['앞서 1월 당국은 자율주행 안전 기준 개정안을 발표했다'] },
  }],
  'ex-a4': [{
    speaker: { name: '한서윤', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
    spokenAt: day('2026-03-14', '2026년 3월 14일 정기 주주총회에서'), kind: 'direct_quote',
    quoteText: '상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다', quoteLanguage: 'ko',
    summaryKo: '상용화 시점을 약속하지 않고 안전 데이터를 우선하겠다',
    excerpts: ['"상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다"라고 밝혔다'],
    eventKey: 'han-mob-2026-03-14-agm',
  }],
  'ex-a5': [
    {
      speaker: { name: '한서윤', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
      spokenAt: day('2026-03-14', '2026년 3월 14일 열린 주주총회에서'), kind: 'direct_quote',
      quoteText: '상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다', quoteLanguage: 'ko',
      summaryKo: '상용화 시점을 약속하지 않겠다',
      excerpts: ['"상용화 시점을 약속하지 않겠다. 안전 데이터가 먼저다"라고 말했다'],
      eventKey: 'han-mob-2026-03-14-agm',
    },
    {
      speaker: { name: '한서윤', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
      spokenAt: day('2026-03-14', '2026년 3월 14일 열린 주주총회에서'), kind: 'direct_quote',
      quoteText: '올해는 운행 지역을 두 곳 더 늘린다', quoteLanguage: 'ko',
      summaryKo: '올해 운행 지역을 두 곳 추가',
      excerpts: ['"올해는 운행 지역을 두 곳 더 늘린다"고 덧붙였다'],
      eventKey: 'han-mob-2026-03-14-agm',
    },
    {
      speaker: { name: '한서윤', companyId: 'ex-mobility' }, topicId: 'pricing',
      spokenAt: day('2026-03-14', '2026년 3월 14일 열린 주주총회에서'), kind: 'direct_quote',
      quoteText: '구독 요금은 당분간 동결한다', quoteLanguage: 'ko',
      summaryKo: '구독 요금을 당분간 동결',
      excerpts: ['"구독 요금은 당분간 동결한다"고 했다'],
      eventKey: 'han-mob-2026-03-14-agm',
    },
  ],
  'ex-a6': [{
    speaker: { name: '한서윤', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
    spokenAt: { value: null, precision: 'unknown', basisType: 'none', basis: '본문에 발언 시점 없음 ("최근 인터뷰")' },
    kind: 'paraphrase', summaryKo: '무인 서비스는 도시별로 단계적으로 확대',
    excerpts: ['무인 서비스는 도시별로 단계적으로 확대할 것이라고 설명했다'],
  }],
  'ex-a7': [{
    speaker: { name: '한 대표', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
    spokenAt: { value: '2025', precision: 'year', basisType: 'explicit_in_text', basis: '본문 "2025년 한 해 동안 여러 차례"', basisExcerpt: '2025년 한 해 동안 여러 차례' },
    kind: 'interpretation', summaryKo: '무인 서비스 출시가 2026년 이후가 될 것이라는 뜻을 여러 차례 내비침(기사 해석)',
    excerpts: ['무인 서비스 출시가 내년 이후가 될 것이라는 뜻을 내비쳤다'],
  }],
  'ex-b1': [{
    speaker: { name: '한서윤', companyId: 'ex-bio' }, topicId: 'rd_investment',
    spokenAt: day('2025-08-01', '2025년 8월 1일 취임 후 첫 간담회에서'), kind: 'direct_quote',
    quoteText: '연구개발 투자를 줄이지 않겠다', quoteLanguage: 'ko', summaryKo: '연구개발 투자를 줄이지 않겠다',
    excerpts: ['"연구개발 투자를 줄이지 않겠다"고 말했다'],
    context: { text: '대표 취임 직후 첫 간담회', excerpts: ['신임 대표는 2025년 8월 1일 취임 후 첫 간담회에서'] },
  }],
  'ex-b2': [{
    speaker: { name: '한서윤', companyId: 'ex-bio' }, topicId: 'rd_investment',
    spokenAt: day('2026-02-09', '2026년 2월 9일 실적 발표에서'), kind: 'direct_quote',
    quoteText: '비용 효율화를 위해 일부 연구 과제를 정리한다', quoteLanguage: 'ko', summaryKo: '비용 효율화를 위해 일부 연구 과제 정리',
    excerpts: ['"비용 효율화를 위해 일부 연구 과제를 정리한다"고 밝혔다'],
    context: { text: '지난해 4분기 임상 1건 중단 이후', excerpts: ['지난해 4분기 임상 1건이 중단된 뒤 방향을 바꿨다'] },
  }],
  // 회사가 없는 '한서윤' → 동명이인 구분 불가로 보류되어야 함
  'ex-b3': [{
    speaker: { name: '한서윤' }, topicId: 'rd_investment',
    spokenAt: day('2026-04-01', '2026년 4월 1일 업계 행사에서'), kind: 'direct_quote',
    quoteText: '협업이 답이다', quoteLanguage: 'ko', summaryKo: '협업이 답',
    excerpts: ['"협업이 답이다"라고 기조연설을 했다'],
  }],
  'ex-c1': [{
    speaker: { name: '오태민', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
    spokenAt: day('2020-11-04', '오태민 대표는 2020년 11월 4일'), kind: 'direct_quote',
    quoteText: '자율주행은 10년 뒤의 이야기', quoteLanguage: 'ko', summaryKo: '자율주행은 10년 뒤의 일',
    excerpts: ['"자율주행은 10년 뒤의 이야기"라고 말했다'],
  }],
  'ex-c2': [{
    speaker: { name: '오태민', companyId: 'ex-mobility' }, topicId: 'autonomy_timeline',
    spokenAt: day('2022-03-07', '2022년 3월 7일 한 포럼에서'), kind: 'direct_quote',
    quoteText: '자율주행 상용화는 생각보다 빨리 온다', quoteLanguage: 'ko', summaryKo: '자율주행 상용화는 예상보다 빨리 온다',
    excerpts: ['"자율주행 상용화는 생각보다 빨리 온다"고 말했다'],
    context: { text: '대표 퇴임 후 개인 자격으로 참석한 포럼', excerpts: ['이번에 개인 자격으로 참석했다'] },
  }],
  'ex-c3': [{
    speaker: { name: '오태민', companyId: 'ex-energy' }, topicId: 'capex',
    spokenAt: day('2023-01-09', '오태민 예시에너지 대표는 2023년 1월 9일'), kind: 'direct_quote',
    quoteText: '배터리 공장 증설은 수요를 확인한 뒤 결정한다', quoteLanguage: 'ko', summaryKo: '공장 증설은 수요 확인 후 결정',
    excerpts: ['"배터리 공장 증설은 수요를 확인한 뒤 결정한다"고 말했다'],
  }],
  // 취임(2022-06) 전 발언 → 화면에 '취임 전 발언'으로 보존되어야 함
  'ex-c4': [{
    speaker: { name: '오태민', companyId: 'ex-energy' }, topicId: 'capex',
    spokenAt: day('2022-05-19', '오태민 전 예시모빌리티 대표는 2022년 5월 19일'), kind: 'direct_quote',
    quoteText: '에너지 저장 사업에 집중하겠다', quoteLanguage: 'ko', summaryKo: '에너지 저장 사업에 집중',
    excerpts: ['"에너지 저장 사업에 집중하겠다"고 말했다'],
  }],
  'ex-d1': [{
    speaker: { name: 'Mark Rivers', companyId: 'ex-cloud' }, topicId: 'ai_capex',
    spokenAt: day('2025-06-11', 'said on June 11, 2025'), kind: 'direct_quote',
    quoteText: 'We will double our data center spending next year.', quoteLanguage: 'en',
    summaryKo: '내년 데이터센터 투자를 두 배로 늘리겠다',
    excerpts: ['"We will double our data center spending next year."'],
  }],
  'ex-d2': [{
    speaker: { name: '도하린', companyId: 'ex-cloud' }, topicId: 'ai_capex',
    spokenAt: day('2026-01-19', '도하린 공동대표는 2026년 1월 19일'), kind: 'direct_quote',
    quoteText: '데이터센터 투자는 수익성을 보며 속도를 조절하겠다', quoteLanguage: 'ko', summaryKo: '수익성을 보며 투자 속도 조절',
    excerpts: ['"데이터센터 투자는 수익성을 보며 속도를 조절하겠다"고 말했다'],
  }],
  'ex-d3': [{
    speaker: { name: 'Rivers', companyId: 'ex-cloud' }, topicId: 'ai_capex',
    spokenAt: day('2026-01-20', 'said on Jan. 20, 2026'), kind: 'direct_quote',
    quoteText: 'stay the course', quoteLanguage: 'en', summaryKo: '증설 계획을 그대로 유지',
    excerpts: ['the company would "stay the course" on capacity plans'],
  }],
  // 서로 다른 두 말을 말줄임으로 이어 붙인 '인용' → 검증에서 발언 전체가 보류되어야 함 (요약으로 살리지 않음)
  'ex-d4': [{
    speaker: { name: '리버스', companyId: 'ex-cloud' }, topicId: 'ai_capex',
    spokenAt: day('2026-01-18', '리버스 대표는 2026년 1월 18일'), kind: 'direct_quote',
    quoteText: '수요는 강하다… 다만 전력 확보가 관건', quoteLanguage: 'ko', summaryKo: '수요는 강하지만 전력 확보가 관건',
    excerpts: ['"수요는 강하다"고 말한 뒤 "다만 전력 확보가 관건"이라고 덧붙였다'],
  }],
};

export function createFixtureExtractor(opts: { version?: string; failOn?: Set<string>; calls?: string[]; outputs?: Record<string, unknown>; raw?: Record<string, RawStatement[]> } = {}): StatementExtractor {
  return {
    name: 'fixture-extractor',
    version: opts.version || '1.0',
    async extract(article) {
      opts.calls?.push(article.articleId);
      if (opts.failOn?.has(article.articleId)) throw new Error(`fixture failure for ${article.articleId}`);
      // 테스트용: 형식이 틀린 출력 그대로 돌려주기
      if (opts.outputs && article.articleId in opts.outputs) return opts.outputs[article.articleId] as any;
      const raw = (opts.raw || EXAMPLE_RAW)[article.articleId] || [];
      // 내용이 바뀐 기사: 근거 구간이 본문에 남아 있는 항목만 돌려줌 (실제 추출기처럼 현재 본문에서만 뽑음)
      const text = `${article.title}\n${article.body}`;
      return raw.filter(r => r.excerpts.every(e => text.includes(e)));
    },
  };
}
