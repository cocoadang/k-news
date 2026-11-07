/**
 * 실제 CEO 등록부 (운영용). 인물·직책·재임 시작은 공식 출처로 확인한 것만 넣습니다.
 * - 대상: 기존 수집기의 공식 본문 피드(OFFICIAL_AND_REGULATORY_FEEDS)가 있는 회사만 (NVIDIA·Microsoft·Google/Alphabet).
 *   테슬라·SpaceX는 공식 본문 피드가 없어(구글 뉴스 요약뿐) 등록하지 않습니다.
 * - 확인 출처(2026-10-18 읽기):
 *   Jensen Huang  https://www.nvidia.com/en-us/about-nvidia/board-of-directors/jensen-huang/  "founded NVIDIA in 1993 and has served since its inception as president, chief executive officer"
 *   Satya Nadella https://microsoft.com/ceo  "named CEO in February 2014" (의장 취임일은 이 페이지에 없어 넣지 않음)
 *   Sundar Pichai https://www.congress.gov/116/meeting/house/110883/witnesses/HHRG-116-JU05-Bio-PichaiS-20200729.pdf
 *                 "became Google's CEO in August 2015", Alphabet CEO December 2019
 *   Elon Musk     https://ir.tesla.com/corporate/elon-musk  "served as our Chief Executive Officer since October 2008 and as a member of the Board since April 2004"
 *                 (2026-10-18 읽기. 2006년 글 바이라인의 'CEO'는 현재 표기라 소급하지 않음 — 2006년은 이사회 멤버·CEO 취임 전)
 *   SpaceX        SEC EDGAR 공식 제출 문서(투자설명서 §9.1.1, 인쇄 200쪽) 이미지 eu_interviewtranscript06215.jpg
 *                 (https://www.sec.gov/Archives/edgar/data/1181412/000162828026041365/ , 이미지 SHA256 59bb13e76010fa565b5190e8d19a70e5e925febf3a118a4118e2d3f9076eb225,
 *                 2026-10-19 PC가 실제 이미지로 확인): CEO·Chief Technical Officer·이사회 의장 재임 May 2002부터 → 시작 '2002-05'(일자는 추정하지 않음).
 *                 이 이미지의 OCR 텍스트층은 Chairman을 'Chaim Ian'으로 오인하므로 OCR에서 역할을 추출·교정하지 않고, 사람이 이미지로 확인한 값만 여기에 둡니다.
 * - Musk는 공식 피드 인용 추출 대상이 아닙니다(Tesla 공식 본문 피드 없음). 선별 공식 페이지(officialPages.ts)·SEC 검증 문서(secExhibits.ts)로만 들어옵니다.
 *   SpaceX 발언은 SpaceX 역할로만 귀속(companyId 'spacex')하고 Tesla 역할을 붙이지 않습니다.
 * - 이름 변형은 전체 이름만 사용합니다(성만으로는 동명이인 위험).
 */
import { CeoPerson, CeoRole, CeoTopic } from '../../src/ceo/types';

export const CEO_PERSONS: CeoPerson[] = [
  { personId: 'jensen-huang', displayName: '젠슨 황', nameVariants: ['Jensen Huang'], isExample: false },
  { personId: 'satya-nadella', displayName: '사티아 나델라', nameVariants: ['Satya Nadella'], isExample: false },
  { personId: 'sundar-pichai', displayName: '순다르 피차이', nameVariants: ['Sundar Pichai'], isExample: false },
  { personId: 'elon-musk', displayName: '일론 머스크', nameVariants: ['Elon Musk'], isExample: false },
  // 투자자(사용자 요청 2026-11-07). 본인 공식 채널(달리오 Substack, 애크먼 주주서한·X)에서만 수집
  { personId: 'ray-dalio', displayName: '레이 달리오', nameVariants: ['Ray Dalio'], isExample: false },
  { personId: 'bill-ackman', displayName: '빌 애크먼', nameVariants: ['Bill Ackman', 'William A. Ackman', 'William Ackman'], isExample: false },
  // AI 기업 CEO(사용자 요청 2026-11-08). 본인 블로그·에세이와 X에서만 수집
  { personId: 'sam-altman', displayName: '샘 올트먼', nameVariants: ['Sam Altman'], isExample: false },
  { personId: 'dario-amodei', displayName: '다리오 아모데이', nameVariants: ['Dario Amodei'], isExample: false },
];

/** 공식 피드 인용 추출기(이름 매칭) 대상 — 기존 3인 그대로 (Musk 제외: 피드에서 새 인용이 늘지 않게) */
export const FEED_EXTRACTOR_PERSON_IDS = ['jensen-huang', 'satya-nadella', 'sundar-pichai'];
/**
 * CEO 공식 피드를 읽는 회사 = 피드 추출 대상 3인의 회사만 (nvda·msft·googl).
 * 등록부에 SpaceX·Tesla 역할이 있어도 피드 목록이 늘지 않게 고정합니다
 * (기존 수집기 목록의 SpaceX 항목은 Google News 검색 피드라 CEO 원문 출처가 아님).
 */
export const FEED_COMPANY_IDS = ['nvda', 'msft', 'googl'];

export const CEO_ROLES: CeoRole[] = [
  { personId: 'jensen-huang', companyId: 'nvda', companyName: 'NVIDIA', title: '공동창업자·사장·CEO', roleType: 'ceo', start: '1993', end: null },
  { personId: 'satya-nadella', companyId: 'msft', companyName: 'Microsoft', title: 'CEO', roleType: 'ceo', start: '2014-02', end: null },
  { personId: 'sundar-pichai', companyId: 'googl', companyName: 'Google', title: 'Google CEO', roleType: 'ceo', start: '2015-08', end: null },
  { personId: 'sundar-pichai', companyId: 'googl', companyName: 'Alphabet', title: 'Alphabet CEO', roleType: 'ceo', start: '2019-12', end: null },
  { personId: 'elon-musk', companyId: 'tsla', companyName: 'Tesla', title: '이사회 멤버', roleType: 'other', start: '2004-04', end: null },
  { personId: 'elon-musk', companyId: 'tsla', companyName: 'Tesla', title: 'CEO', roleType: 'ceo', start: '2008-10', end: null },
  { personId: 'elon-musk', companyId: 'spacex', companyName: 'SpaceX', title: 'SpaceX CEO·최고기술책임자(CTO)·이사회 의장', roleType: 'ceo', start: '2002-05', end: null },
  // 달리오: 1975년 Bridgewater 창업(공식 사이트 'Our Founder'), 2022년 CIO 등 경영 역할에서 물러나 창업자로 남음 → 6년 범위에서는 '창업자'로만 표시
  { personId: 'ray-dalio', companyId: 'bridgewater', companyName: 'Bridgewater', title: '창업자', roleType: 'other', start: '1975', end: null },
  // 애크먼: Pershing Square 창업자·CEO (펀드 운용 개시 2004년)
  { personId: 'bill-ackman', companyId: 'pershing', companyName: 'Pershing Square', title: '창업자·CEO', roleType: 'ceo', start: '2004', end: null },
  // 올트먼: 2019년 OpenAI CEO 취임(2023년 11월 며칠간 해임 후 복귀 — 6년 범위 표시에는 재임으로 둠)
  { personId: 'sam-altman', companyId: 'openai', companyName: 'OpenAI', title: 'OpenAI CEO', roleType: 'ceo', start: '2019', end: null },
  // 아모데이: 2021년 Anthropic 공동 창업·CEO
  { personId: 'dario-amodei', companyId: 'anthropic', companyName: 'Anthropic', title: 'Anthropic 공동창업자·CEO', roleType: 'ceo', start: '2021', end: null },
];

/** 주제 = 기존 기사 분류(이벤트 category). 의미 판정이 아니라 기존 분류를 그대로 묶음 기준으로 씀 */
export const CEO_TOPICS: CeoTopic[] = [
  'IPO / 주식', '기업가치 / 자금조달', '실적 / 재무', 'AI 가속기 / 반도체', 'AI 모델 / Agent', '클라우드 / 데이터센터',
  '자율주행 / Robotaxi', 'Starship / 우주인프라', 'Starlink / 통신', '국방 / 정부계약', '규제 / 반독점', '에너지 / 배터리',
  '공급망 / CAPEX', '경쟁사 / 시장점유율', '기타',
].map(label => ({ topicId: label, label }));

export const UNCATEGORIZED_TOPIC = '기타';
