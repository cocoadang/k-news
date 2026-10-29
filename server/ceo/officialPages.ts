/**
 * 선별 공식 페이지(실적 통화 발언문·본인 작성글·회사 발표문) — 사람이 고른 소수 인용을 원문에서 매번 다시 검증.
 * 모델 호출 없음. 기존 기사·이벤트 DB에 추가하지 않는 CEO 모듈 전용 출처입니다. 출처당 인용 1개.
 *
 * 범위(오귀속·다른 영역 날짜 혼입 방지):
 * - 머리(header) = 페이지 제목 텍스트 위치부터 headerChars 글자. 작성자·날짜·연결 문구는 머리 안에서만 찾습니다.
 *   제목이 여러 번 나오면(탐색·관련 글 영역) 인용보다 앞에 있는 마지막 제목을 씁니다.
 * - 날짜 구간(dateWindow) = 제목 앞 before 글자 ~ 제목 뒤 after 글자. 이 구간 밖 날짜는 쓰지 않습니다.
 * - 인용은 머리 시작 이후 본문에서만 찾고, 본문 끝 표지(bodyEnd) 뒤(꼬리·법적 고지 등)는 범위 밖입니다.
 * 종류별 규칙 (하나라도 실패하면 그 인용은 보류, 날짜만 실패하면 인용은 남기고 날짜는 미상):
 * - authored_post(본인 작성글): 머리에 작성자 이름 + 작성일 문구(작성자 이름 뒤 80자 이내). 인용 = 목록 항목 한 줄 전체.
 *   발언일은 비움(미상). 작성일은 원문 게시일(written)로만 표시. 바이라인의 현재 직함은 쓰지 않음(당시 직책은 등록부 재임으로 판단).
 * - call_remarks(실적 통화 발언문): 머리에 작성자 이름 + 직함 + 게시일 + '오늘(당일) 실적 통화' 연결 문구 + '발언 기록' 문구.
 *   셋(연결·작성자·게시일)이 모두 확인될 때만 게시일을 행사(발언)일로 씀. 메타데이터 날짜는 쓰지 않음.
 * - press_release(회사 발표문): 인용이 들어 있는 단락(줄)에 귀속 문구('said Jensen Huang')가 있고, 인용이 그 단락의 따옴표 구간 안에 있어야 함.
 *   발언일은 미상. 발표문 게시일(released)을 따로 표시. 분기 종료일·회계연도 이름은 날짜로 쓰지 않음.
 * 근거 구간(evidence) = 원문에서 찾은 인용 구간 그대로(공백만 정리). 귀속·작성자·날짜 문구는 provenance로 보존.
 * 확인: 2026-10-18 웹 읽기(지원 도구의 텍스트 수준 확인, 원본 HTML 바이트·SHA는 PC QA 확인 필요).
 */
import { RawStatement, SourceArticle } from './pipeline';
import { shortHash, normalizeForMatch } from '../../src/ceo/text';
import { extractAbsoluteDates } from '../../src/ceo/dates';

export type OfficialPageKind = 'call_remarks' | 'authored_post' | 'press_release';

export interface CuratedPage {
  sourceId: string;
  url: string;
  /** 화면 출처 이름 (한국어) */
  title: string;
  /** 발행 조직 표시 이름 (Microsoft로 고정하지 않음) */
  orgName: string;
  companyId: string;
  speakerName: string;
  kind: OfficialPageKind;
  topicId: string;
  /** 페이지 제목 텍스트 (범위 시작점) */
  pageTitle: string;
  headerChars: number;
  dateWindow: { before: number; after: number };
  /** 작성자 표지 (머리 안) */
  bylineExcerpt: string;
  /** 작성자 직함 표지 (call_remarks만, 머리 안). 당시 직책 판단에는 쓰지 않음 */
  bylineTitleExcerpt?: string;
  /** 날짜 문구 (날짜 구간 안, 정확히 이 문자열) + 그 값 */
  dateExcerpt: string;
  date: string;
  /** call_remarks: 머리 안에 있어야 하는 연결 문구(정규식 원문, 대소문자 무시)와 사람이 읽는 설명 */
  linkPatterns?: { re: string; label: string }[];
  /** press_release: 인용 단락의 귀속 문구 */
  attribution?: string;
  /** 본문 끝 표지들(먼저 나오는 곳에서 자름) */
  bodyEnd?: string[];
  /**
   * call_remarks 머리 순서 규칙. 기본(before_note): 작성자 줄·날짜 줄이 편집자 주(첫 연결 문구)보다 앞.
   * before_quote: 연결 문구가 제목 아래 요약문(abstract)에 있어 작성자·날짜보다 앞설 수 있는 배치 —
   *   작성자 줄·직함 줄·날짜 단독 줄·연결 문구가 모두 제목 뒤 ~ 인용 앞(머리 영역)에 있어야 하고, 인용은 그 모두의 뒤.
   *   (메타 영역 밖·본문 뒤 관련 글의 날짜·작성자는 쓰지 않음)
   */
  metaOrder?: 'before_note' | 'before_quote';
  /**
   * 일시 보류 출처: refresh에서 요청하지 않음(HTTP 0). 삭제(404/410)·성공으로 보지 않고 보고에 '보류'로 남기며 이력은 지우지 않음.
   * 다시 쓰려면 사람이 원인을 확인한 뒤 이 표시를 지우는 코드 변경이 필요합니다(자동 재시도·우회 없음).
   */
  hold?: { since: string; reason: string };
  quotes: string[];
}

/** 이번 갱신에서 요청할 선별 페이지 (보류 출처 제외) */
export const activePages = (pages: CuratedPage[]) => pages.filter(p => !p.hold);

export const CURATED_PAGES: CuratedPage[] = [
  {
    sourceId: 'tsla-master-plan-2006',
    url: 'https://www.tesla.com/secret-master-plan',
    title: 'The Secret Tesla Motors Master Plan (본인 작성글)',
    orgName: 'Tesla 블로그', companyId: 'tsla', speakerName: 'Elon Musk', kind: 'authored_post', topicId: '에너지 / 배터리',
    pageTitle: 'The Secret Tesla Motors Master Plan', headerChars: 600, dateWindow: { before: 0, after: 600 },
    bylineExcerpt: 'Elon Musk', dateExcerpt: 'August 2, 2006', date: '2006-08-02',
    quotes: ['While doing above, also provide zero emission electric power generation options'],
  },
  {
    sourceId: 'tsla-master-plan-2016',
    url: 'https://www.tesla.com/master-plan-part-deux',
    title: 'Master Plan, Part Deux (본인 작성글)',
    orgName: 'Tesla 블로그', companyId: 'tsla', speakerName: 'Elon Musk', kind: 'authored_post', topicId: '에너지 / 배터리',
    pageTitle: 'Master Plan, Part Deux', headerChars: 600, dateWindow: { before: 0, after: 600 },
    bylineExcerpt: 'Elon Musk', dateExcerpt: 'July 20, 2016', date: '2016-07-20',
    quotes: ['Create stunning solar roofs with seamlessly integrated battery storage'],
  },
  {
    sourceId: 'tsla-model-s-autobahn-2012',
    url: 'https://ir.tesla.com/press-release/tesla-motors-brings-model-s-autobahn-first-time',
    title: 'Model S 유럽 출시 공식 발표문 (2012)',
    orgName: 'Tesla Investor Relations', companyId: 'tsla', speakerName: 'Elon Musk', kind: 'press_release', topicId: '경쟁사 / 시장점유율',
    pageTitle: 'Tesla Motors Brings Model S to the Autobahn for the First Time', headerChars: 600, dateWindow: { before: 0, after: 600 },
    bylineExcerpt: 'Tesla', dateExcerpt: 'Nov 1, 2012', date: '2012-11-01', attribution: 'said Elon Musk', bodyEnd: ['About Tesla'],
    quotes: ['Our goal has always been to build the best car in the world and set new standards for safety, range, design and performance.'],
  },
  {
    sourceId: 'tsla-model-s-award-2012',
    url: 'https://ir.tesla.com/press-release/tesla-model-s-wins-one-automotive-industrys-highest-honors-motor',
    title: 'Model S 올해의 차 수상 공식 발표문 (2012)',
    orgName: 'Tesla Investor Relations', companyId: 'tsla', speakerName: 'Elon Musk', kind: 'press_release', topicId: '경쟁사 / 시장점유율',
    pageTitle: "Tesla Model S Wins One of Automotive Industry's Highest Honors: Motor Trend 2013 Car of the Year", headerChars: 600, dateWindow: { before: 0, after: 600 },
    bylineExcerpt: 'Tesla', dateExcerpt: 'Nov 12, 2012', date: '2012-11-12', attribution: 'said Elon Musk', bodyEnd: ['About Model S'],
    quotes: ["Nothing illustrates this more clearly than winning Motor Trend's Car of the Year by unanimous decision against a field of exceptional competitors."],
  },
  {
    sourceId: 'googl-q1-2025-remarks',
    url: 'https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q1-2025/',
    title: '2025년 1분기 실적 발표 통화 CEO 발언문',
    orgName: 'Google 공식 블로그', companyId: 'googl', speakerName: 'Sundar Pichai', kind: 'call_remarks', topicId: '실적 / 재무',
    pageTitle: 'Q1 2025 earnings call: CEO’s remarks', headerChars: 1500, dateWindow: { before: 0, after: 600 },
    bylineExcerpt: 'Sundar Pichai', bylineTitleExcerpt: 'CEO of Google and Alphabet', dateExcerpt: 'Apr 24, 2025', date: '2025-04-24',
    linkPatterns: [
      // 링크 마크업 뒤 공백(" ,")만 허용: 문구·순서·작성자 이름은 그대로 검증
      { re: 'On today[’\']s 2025 Q1 earnings call\\s?, Google and Alphabet CEO Sundar Pichai', label: '편집자 주: 오늘(게시일) 실적 통화' },
      { re: 'Below is a transcript of his remarks', label: '편집자 주: 발언 기록' },
    ],
    quotes: ['Our differentiated, full stack approach to AI continues to be central to our growth.'],
  },
  {
    sourceId: 'googl-q4-2025-remarks',
    url: 'https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q4-2025/',
    title: '2025년 4분기 실적 발표 통화 CEO 발언문',
    orgName: 'Google 공식 블로그', companyId: 'googl', speakerName: 'Sundar Pichai', kind: 'call_remarks', topicId: '실적 / 재무',
    pageTitle: 'Q4 earnings call: Remarks from our CEO', headerChars: 1500, dateWindow: { before: 0, after: 600 },
    bylineExcerpt: 'Sundar Pichai', bylineTitleExcerpt: 'CEO of Google and Alphabet', dateExcerpt: 'Feb 04, 2026', date: '2026-02-04',
    linkPatterns: [
      { re: 'today[’\']s 2025 Q4 earnings call', label: '편집자 주: 오늘(게시일) 실적 통화' },
      { re: 'Below is a transcript of his remarks', label: '편집자 주: 발언 기록' },
    ],
    quotes: ['Overall, we’re seeing our AI investments and infrastructure drive revenue and growth across the board.'],
  },
  {
    // PC 확인(2026-10-19): 989,188 bytes, UTF-8, SHA256 41e9904c59236ecae27ddeee20d161d4b16195d8936621c0fb5769ebb5c4a00f (수신 증거, 캐시 키 아님).
    // article h1 · .uni-article-hero__date "Jul 22, 2026" · author-name/author-title · abstract(당일 Q2 2026 통화 + edited transcript 고지) · 본문 첫 단락의 인용 1회.
    // 연결 문구 최소 패턴은 PC가 abstract에서 확인(2026-10-19): 'On today’s Q2 2026 earnings call' + 'edited transcript of his remarks'. 없으면 발언일 미상.
    sourceId: 'googl-q2-2026-remarks',
    url: 'https://blog.google/company-news/inside-google/message-ceo/alphabet-earnings-q2-2026/',
    title: '2026년 2분기 실적 발표 통화 CEO 발언문',
    orgName: 'Google 공식 블로그', companyId: 'googl', speakerName: 'Sundar Pichai', kind: 'call_remarks', topicId: '실적 / 재무',
    pageTitle: 'Q2 2026 earnings call: Remarks from our CEO', headerChars: 1500, dateWindow: { before: 0, after: 600 },
    bylineExcerpt: 'Sundar Pichai', bylineTitleExcerpt: 'CEO of Google and Alphabet', dateExcerpt: 'Jul 22, 2026', date: '2026-07-22',
    metaOrder: 'before_quote',
    linkPatterns: [
      { re: 'On today[’\']s Q2 2026 earnings call', label: '요약문: 오늘(게시일) 실적 통화' },
      { re: 'edited transcript of his remarks', label: '요약문: 발언 기록(편집된 전사)' },
    ],
    quotes: ['Our AI investments are redefining what’s possible across every part of our business.'],
  },
  {
    sourceId: 'nvda-q1-fy2026-release',
    url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-first-quarter-fiscal-2026',
    title: '2026 회계연도 1분기 실적 발표문',
    orgName: 'NVIDIA 뉴스룸', companyId: 'nvda', speakerName: 'Jensen Huang', kind: 'press_release', topicId: 'AI 가속기 / 반도체',
    pageTitle: 'NVIDIA Announces Financial Results for First Quarter Fiscal 2026', headerChars: 600, dateWindow: { before: 300, after: 600 },
    bylineExcerpt: 'NVIDIA', dateExcerpt: 'May 28, 2025', date: '2025-05-28',
    attribution: 'said Jensen Huang', bodyEnd: ['About NVIDIA'],
    quotes: ['Global demand for NVIDIA’s AI infrastructure is incredibly strong.'],
  },
  {
    sourceId: 'nvda-q2-fy2026-release',
    url: 'https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-second-quarter-fiscal-2026',
    title: '2026 회계연도 2분기 실적 발표문',
    orgName: 'NVIDIA 뉴스룸', companyId: 'nvda', speakerName: 'Jensen Huang', kind: 'press_release', topicId: 'AI 가속기 / 반도체',
    pageTitle: 'NVIDIA Announces Financial Results for Second Quarter Fiscal 2026', headerChars: 600, dateWindow: { before: 300, after: 600 },
    bylineExcerpt: 'NVIDIA', dateExcerpt: 'August 27, 2025', date: '2025-08-27',
    attribution: 'said Jensen Huang', bodyEnd: ['About NVIDIA'],
    quotes: ['The AI race is on, and Blackwell is the platform at its center.'],
  },
  {
    sourceId: 'nasa-demo-2-release',
    url: 'https://www.nasa.gov/news-release/nasa-astronauts-launch-from-america-in-historic-test-flight-of-spacex-crew-dragon/',
    title: 'NASA 데모-2 유인 시험 비행 발사 성공 발표문',
    orgName: 'NASA 공식 발표문',
    companyId: 'spacex',
    speakerName: 'Elon Musk',
    kind: 'press_release',
    topicId: 'Starship / 우주인프라',
    pageTitle: 'NASA Astronauts Launch from America in Historic Test Flight of SpaceX Crew Dragon',
    headerChars: 600,
    dateWindow: { before: 300, after: 600 },
    bylineExcerpt: 'NASA',
    dateExcerpt: 'May 30, 2020',
    date: '2020-05-30',
    attribution: 'said Elon Musk',
    bodyEnd: ['Demo-2 Astronauts'],
    quotes: ['This is a dream come true for me and everyone at SpaceX'],
  },
  {
    sourceId: 'nasa-crew-2-release',
    url: 'https://www.nasa.gov/news-release/nasas-spacex-crew-2-astronauts-headed-to-international-space-station/',
    title: 'NASA Crew-2 우주정거장 발사 공식 발표문',
    orgName: 'NASA 공식 발표문',
    companyId: 'spacex',
    speakerName: 'Elon Musk',
    kind: 'press_release',
    topicId: 'Starship / 우주인프라',
    pageTitle: 'NASA’s SpaceX Crew-2 Astronauts Headed to International Space Station',
    headerChars: 600,
    dateWindow: { before: 300, after: 600 },
    bylineExcerpt: 'NASA',
    dateExcerpt: 'Apr 23, 2021',
    date: '2021-04-23',
    attribution: 'said Elon Musk',
    bodyEnd: ['Crew-2 Astronauts', 'About the Mission'],
    quotes: ['I’m really proud of the SpaceX team and honored to be partnered with NASA and helping JAXA and ESA as well'],
  },
];

/** 페이지 검증 규칙 버전 (4: NASA 우주인프라 공식 발표문 2건 추가 및 서면 발표일 기준일 채택). 규칙이 바뀌면 캐시를 다시 추출 */
export const PAGE_RULES_VERSION = '6';
/** 선별 목록·규칙이 바뀌면 추출기 버전이 바뀌어 다시 추출되도록 */
export const PAGES_HASH = shortHash(PAGE_RULES_VERSION + JSON.stringify(CURATED_PAGES));

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 텍스트 위치 검색: 공백·따옴표 모양만 정규화(문자 수 보존, 위치가 원문과 같음) */
const canonChars = (s: string) => s.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/\s/g, ' ');
function findAll(text: string, needle: string): number[] {
  const re = new RegExp(canonChars(needle).trim().split(/ +/).map(escRe).join(' +'), 'g');
  return [...canonChars(text).matchAll(re)].map(m => m.index!);
}
function findFirst(text: string, needle: string, from = 0): { at: number; raw: string } | null {
  const re = new RegExp(canonChars(needle).trim().split(/ +/).map(escRe).join(' +'), 'g');
  re.lastIndex = from;
  const m = re.exec(canonChars(text));
  return m ? { at: m.index, raw: text.slice(m.index, m.index + m[0].length) } : null;
}

export interface PageScope {
  /** 제목 위치 */
  start: number;
  header: string;
  dateZone: string;
  /** 본문 (제목부터 본문 끝 표지 전까지) — 인용·작성자·연결 문구 위치 기준 */
  body: string;
  /** 기사로 저장하는 범위 (날짜 구간 시작 ~ 본문 끝). 캐시 해시·근거 재검증 대상 */
  full: string;
}

/** 제목·머리·날짜 구간·본문 범위. 제목이 없으면 null */
/** 제목 위치: 그 줄 전체가 제목인 곳(제목 요소) 우선. 없을 때만 줄 일부 일치(본문 문장 속 제목 문자열은 제목 줄이 있으면 쓰지 않음) */
function titlePositions(text: string, title: string): number[] {
  const all = findAll(text, title);
  const whole = all.filter(i => ws(canonChars(lineAround(text, i).line)) === ws(canonChars(title)));
  return whole.length ? whole : all;
}

export function pageScope(text: string, p: CuratedPage): PageScope | null {
  const titles = titlePositions(text, p.pageTitle);
  if (!titles.length) return null;
  const firstQuote = p.quotes.map(q => findAll(text, q)).flat().sort((a, b) => a - b)[0];
  const start = firstQuote === undefined ? titles[0] : (titles.filter(i => i < firstQuote).pop() ?? titles[0]);
  let end = text.length;
  for (const m of p.bodyEnd || []) {
    const e = findFirst(text, m, start + p.pageTitle.length);
    if (e && e.at < end) end = e.at;
  }
  return {
    start,
    header: text.slice(start, Math.min(end, start + p.headerChars)),
    dateZone: text.slice(Math.max(0, start - p.dateWindow.before), Math.min(end, start + p.dateWindow.after)),
    body: text.slice(start, end),
    full: text.slice(Math.max(0, start - p.dateWindow.before), end),
  };
}

/** 머리의 줄 목록 (머리 안 위치 포함) */
function headerLines(sc: PageScope): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  let at = 0;
  for (const raw of sc.header.split('\n')) { if (raw.trim()) out.push({ at, text: raw }); at += raw.length + 1; }
  return out;
}

/** 작성글 바이라인: 제목 줄 다음 첫 비어 있지 않은 줄 전체 = '작성자[, 직함 1개], 날짜' (줄 일부가 아닌 전체 일치) */
function bylineLine(p: CuratedPage, sc: PageScope): { at: number; text: string } | null {
  const lines = headerLines(sc);
  // 제목 줄 = 머리 첫 줄(pageScope가 제목 위치에서 시작). 제목과 바이라인 사이에는 괄호로 감싼 짧은 부제 1줄만 허용
  const ti = lines.findIndex(l => findFirst(l.text, p.pageTitle));
  let ni = ti >= 0 ? ti + 1 : -1;
  if (ni > 0 && lines[ni] && /^\([^()]{1,60}\)$/.test(ws(lines[ni].text))) ni++;
  const next = ni > 0 ? lines[ni] : undefined;
  if (!next) return null;
  const re = new RegExp(`^${escRe(canonChars(p.bylineExcerpt))}(?:, [^,]{1,80})?, ${escRe(canonChars(p.dateExcerpt))}$`);
  return re.test(ws(canonChars(next.text))) ? { at: next.at, text: ws(next.text) } : null;
}

/** 통화 발언문 작성자: 편집자 주(첫 연결 문구)보다 앞 머리에서 작성자 이름 단독 줄 + 바로 다음 줄이 직함 단독 줄 */
function authorBlock(p: CuratedPage, sc: PageScope): { at: number; name: string; title: string } | null {
  const lines = headerLines(sc);
  const firstLink = p.metaOrder === 'before_quote' ? firstQuoteAt(p, sc.header) : Math.min(...(p.linkPatterns || []).map(l => {
    const m = new RegExp(l.re, 'i').exec(canonChars(sc.header));
    return m ? m.index : Number.POSITIVE_INFINITY;
  }));
  for (let i = 0; i + 1 < lines.length; i++) {
    if (lines[i].at >= firstLink) break;
    if (ws(canonChars(lines[i].text)) === ws(canonChars(p.bylineExcerpt)) && ws(canonChars(lines[i + 1].text)) === ws(canonChars(p.bylineTitleExcerpt || ''))) {
      return { at: lines[i].at, name: ws(lines[i].text), title: ws(lines[i + 1].text) };
    }
  }
  return null;
}

/** before_quote 배치의 머리 영역 끝 = 영역(text) 안 첫 인용 위치(제목 문자열 뒤). 없으면 영역 끝까지 */
function firstQuoteAt(p: CuratedPage, text: string): number {
  const hits = p.quotes.flatMap(q => findAll(text, q)).filter(i => i >= p.pageTitle.length);
  return hits.length ? Math.min(...hits) : Number.POSITIVE_INFINITY;
}

export interface PageDate { ok: boolean; reason?: string; excerpt?: string; linkExcerpts?: { label: string; excerpt: string }[] }

/**
 * 날짜 문구 확인: 날짜 구간 안에 정확한 문구가 있고, 그 문구에서 읽은 절대 날짜가 하나이며 설정값과 같아야 함.
 * - 발표문·통화 발언문: 날짜가 '그 줄 전체'(날짜 요소 단독)여야 함 → 관련 글 목록의 '제목 · 날짜' 줄은 쓰지 않음.
 *   통화 발언문은 추가로 편집자 주(첫 연결 문구)보다 앞(제목·작성자 영역)에 있어야 함.
 * - 작성글: 작성자 이름 바로 뒤(80자 이내) 바이라인 날짜만.
 */
export function checkPageDate(p: CuratedPage, sc: PageScope): PageDate {
  let hit: { at: number; raw: string } | null = null;
  if (p.kind === 'authored_post') hit = findFirst(sc.dateZone, p.dateExcerpt);
  else {
    let from = 0;
    for (let h = findFirst(sc.dateZone, p.dateExcerpt, from); h; h = findFirst(sc.dateZone, p.dateExcerpt, from)) {
      const { line } = lineAround(sc.dateZone, h.at);
      if (ws(line) === ws(h.raw)) { hit = h; break; }
      from = h.at + h.raw.length;
    }
    if (hit && p.kind === 'call_remarks' && p.metaOrder === 'before_quote') {
      // 요약문 배치: 날짜 단독 줄이 제목 뒤 ~ 첫 인용 앞(머리 영역)에 있어야 함
      if (p.dateWindow.before !== 0 || hit.at > firstQuoteAt(p, sc.dateZone)) hit = null;
    } else if (hit && p.kind === 'call_remarks') {
      // dateZone 시작 = 제목 위치(before 0) 전제. 첫 연결 문구(편집자 주)보다 앞이어야 함
      const firstLink = Math.min(...(p.linkPatterns || []).map(l => {
        const m = new RegExp(l.re, 'i').exec(canonChars(sc.dateZone));
        return m ? m.index : Number.POSITIVE_INFINITY;
      }));
      if (p.dateWindow.before !== 0 || hit.at > firstLink) hit = null;
    }
  }
  if (!hit) return { ok: false, reason: '제목 주변 날짜 영역에서 게시·작성일 문구(단독 줄)를 찾지 못함' };
  const ds = extractAbsoluteDates(hit.raw);
  if (ds.length !== 1 || ds[0].precision !== 'day' || ds[0].value !== p.date) return { ok: false, reason: '날짜 문구에서 읽은 날짜가 설정값과 다름' };
  if (p.kind === 'authored_post') {
    // 제목 다음 첫 줄(바이라인 줄) 전체가 '작성자[, 직함], 날짜' 형식이어야 함. 본문의 이름 언급은 바이라인이 아님
    const b = bylineLine(p, sc);
    if (!b) return { ok: false, reason: '제목 바로 아래 바이라인 줄(작성자, 작성일)을 확인하지 못함' };
    return { ok: true, excerpt: b.text };
  }
  return { ok: true, excerpt: ws(hit.raw) };
}

/** 원문(평문)에서 페이지 범위만 잘라 기사로 (캐시 hash는 이 범위로 계산). 날짜는 근거가 확인될 때만 */
export function pageArticle(p: CuratedPage, pageText: string): SourceArticle | null {
  const sc = pageScope(pageText, p);
  if (!sc) return null;
  const d = checkPageDate(p, sc);
  const kind = p.kind === 'authored_post' ? 'written' : p.kind === 'press_release' ? 'released' : 'posted';
  const label = kind === 'written' ? '본인 작성글 바이라인의 작성일' : kind === 'released' ? '발표문에 표시된 게시일' : '공식 블로그 게시일';
  return {
    articleId: '', title: p.title, body: sc.full, sourceName: `${p.orgName} · ${p.title}`, url: p.url,
    publishedAt: d.ok ? `${p.date}T00:00:00.000Z` : null,
    ...(d.ok ? { publishedAtBasis: { kind, excerpt: d.excerpt!, basis: `${label} ("${d.excerpt}")` } } : {}),
    topicId: p.topicId, sourceKind: 'page', pageId: p.sourceId,
  } as SourceArticle;
}

/** 인용이 들어 있는 줄(단락) */
function lineAround(text: string, at: number): { line: string; offset: number } {
  const s = text.lastIndexOf('\n', at - 1) + 1;
  const e = text.indexOf('\n', at);
  return { line: text.slice(s, e < 0 ? text.length : e), offset: at - s };
}

/**
 * 발표문 단락(한 줄) 안의 따옴표 구간과 귀속 문구 연결.
 * - 따옴표(굽은·곧은)는 순서대로 짝을 지음. 개수가 홀수면(짝이 맞지 않음) 모호 → 보류
 * - 인용은 정확히 한 따옴표 구간 안에 있어야 함
 * - 직접 귀속: 그 구간 바로 뒤 텍스트(다음 구간 전까지)가 '[,] said|says 이름 …' 귀속 문장 하나뿐이고 이름이 지정 화자와 같음
 * - 이어지는 인용: 그 구간 뒤에 아무 텍스트도 없고(단락 끝 또는 문장부호만), 바로 앞 구간이 지정 화자에게 직접 귀속되며
 *   두 구간 사이가 그 귀속 문장 하나뿐(다른 화자·다른 서술 없음)일 때만 같은 화자로 인정
 * - 그 밖(다른 화자 귀속, 귀속 아닌 서술, 미상 화자, 앞 구간도 이어짐뿐인 사슬, 단락 경계)은 보류
 */
const ATTR_RE = /^\s*,?\s*(?:said|says)\s+([A-Z][A-Za-z.'\u2019\-]*(?:\s+[A-Z][A-Za-z.'\u2019\-]*){0,3})\b([^"]*)$/;
export function linkQuoteAttribution(line: string, at: number, len: number, speaker: string):
  { ok: true; attribution: string; continuation?: string } | { ok: false; reason: string } {
  const c = canonChars(line);
  const marks: number[] = [];
  for (let i = 0; i < c.length; i++) if (c[i] === '"') marks.push(i);
  if (marks.length % 2 === 1) return { ok: false, reason: '단락의 따옴표 짝이 맞지 않아 인용 구간이 모호함' };
  const spans = [] as { open: number; close: number }[];
  for (let i = 0; i < marks.length; i += 2) spans.push({ open: marks[i], close: marks[i + 1] });
  const idx = spans.findIndex(sp => sp.open < at && at + len <= sp.close);
  if (idx < 0) return { ok: false, reason: '인용이 따옴표 구간 안에 있지 않음' };
  const after = (i: number) => line.slice(spans[i].close + 1, i + 1 < spans.length ? spans[i + 1].open : line.length);
  /** 구간 뒤 텍스트가 귀속 문장 하나뿐이면 그 이름, 귀속 문장이 아니면 null */
  const attributedTo = (i: number): { name: string; text: string } | null => {
    const t = after(i).replace(/\s+/g, ' ');
    const m = ATTR_RE.exec(t);
    if (!m) return null;
    // 귀속 문장 뒤에 다른 서술이 이어지면(문장 끝 뒤 추가 텍스트) 귀속 하나로 보지 않음
    const rest = m[2];
    const end = rest.search(/[.!?](\s|$)/);
    if (end >= 0 && rest.slice(end + 1).trim()) return null;
    return { name: m[1].replace(/[.,]$/, ''), text: ws(t).replace(/^,\s*/, '') };
  };
  const nameOk = (n: string) => ws(n).toLowerCase() === ws(speaker).toLowerCase();
  const own = attributedTo(idx);
  if (own) {
    if (!nameOk(own.name)) return { ok: false, reason: `인용이 다른 사람(${own.name})에게 귀속됨` };
    return { ok: true, attribution: own.text };
  }
  if (after(idx).replace(/[\s.,;:!?]/g, '')) return { ok: false, reason: '인용 뒤 문구가 지정 인물 귀속 문장이 아님(미상 화자)' };
  if (idx === 0) return { ok: false, reason: '인용에 귀속 문구가 없음' };
  const prev = attributedTo(idx - 1);
  if (!prev) return { ok: false, reason: '앞 인용의 귀속이 확인되지 않아 이어지는 인용으로 볼 수 없음' };
  if (!nameOk(prev.name)) return { ok: false, reason: `앞 인용이 다른 사람(${prev.name})에게 귀속되어 이어지는 인용으로 볼 수 없음` };
  return { ok: true, attribution: prev.text, continuation: '바로 앞 인용의 귀속 문장 뒤에 다른 서술 없이 이어지는 인용' };
}

/** 선별 인용 검증 → RawStatement (실패한 인용은 사유와 함께 제외). text = 페이지 평문 또는 pageArticle 본문 */
export function extractPageQuotes(p: CuratedPage, text: string): { items: RawStatement[]; rejected: { quote: string; reason: string }[] } {
  const rejectAll = (reason: string) => ({ items: [], rejected: p.quotes.map(q => ({ quote: q, reason })) });
  const sc = pageScope(text, p);
  if (!sc) return rejectAll('페이지 제목 확인 실패(범위를 정할 수 없음)');
  // 작성자·날짜 귀속을 확인하지 못하면 날짜만 낮추지 않고 인용 자체를 보류
  const date = checkPageDate(p, sc);
  if (!date.ok) return rejectAll(date.reason!);
  const provenanceBase: { label: string; excerpt: string }[] = [];
  let by: { at: number; raw: string };
  if (p.kind === 'authored_post') {
    const b = bylineLine(p, sc)!;
    by = { at: b.at, raw: b.text };
    provenanceBase.push({ label: '작성자 바이라인(제목 바로 아래 줄, 작성일 포함)', excerpt: b.text });
  } else if (p.kind === 'call_remarks') {
    const a = authorBlock(p, sc);
    if (!a) return rejectAll('편집자 주 앞 머리에서 작성자 줄·직함 줄을 확인하지 못함(본문 이름 언급은 작성자로 보지 않음)');
    by = { at: a.at, raw: a.name };
    provenanceBase.push({ label: '작성자(바이라인)', excerpt: a.name }, { label: '작성자 직함(바이라인, 게시 당시 표기)', excerpt: a.title });
  } else {
    const t = findFirst(sc.header, p.pageTitle);
    if (!t) return rejectAll('제목 확인 실패');
    by = t;
  }
  let linked = false;
  if (p.kind === 'call_remarks') {
    const links = (p.linkPatterns || []).map(l => ({ l, m: new RegExp(l.re, 'i').exec(canonChars(sc.header)) }));
    linked = links.length > 0 && links.every(x => x.m);
    for (const x of links) if (x.m) provenanceBase.push({ label: x.l.label, excerpt: ws(sc.header.slice(x.m.index, x.m.index + x.m[0].length)) });
  }
  const items: RawStatement[] = [];
  const rejected: { quote: string; reason: string }[] = [];
  for (const q of p.quotes) {
    const hits = findAll(sc.body, q).filter(i => i >= p.pageTitle.length);
    if (hits.length !== 1) { rejected.push({ quote: q, reason: hits.length ? '본문에 같은 인용이 여러 번 있어 위치를 하나로 정할 수 없음' : '본문 범위에서 인용을 찾지 못함' }); continue; }
    const at = hits[0];
    const found = findFirst(sc.body, q, at)!;
    const { line, offset } = lineAround(sc.body, at);
    const provenance = [...provenanceBase];
    if (p.kind === 'authored_post') {
      // 작성자 표지 뒤 본문의 목록 항목 한 줄 전체여야 함 (앞 번호만 허용)
      if (at < by.at + by.raw.length) { rejected.push({ quote: q, reason: '인용이 작성자 표지보다 앞에 있음' }); continue; }
      if (ws(line.replace(/^\s*\d+[.)]\s*/, '')) !== ws(found.raw)) { rejected.push({ quote: q, reason: '인용이 목록 항목 한 줄 전체가 아님' }); continue; }
    } else if (p.kind === 'press_release') {
      // 인용 구간 ↔ 귀속을 명시적으로 연결 (단락=한 줄 안에서만). 먼 귀속 문구를 가져오지 않음
      const link = linkQuoteAttribution(line, offset, found.raw.length, p.speakerName);
      if (link.ok === false) { rejected.push({ quote: q, reason: link.reason }); continue; }
      provenance.push({ label: link.continuation ? '발표문 안 귀속 문구(바로 앞 인용에 붙은 같은 화자 귀속 · 이어지는 인용)' : '발표문 안 인용 귀속 문구', excerpt: link.attribution });
    } else if (p.kind === 'call_remarks') {
      // 인용은 작성자 표지 뒤, 그리고 (연결 문구가 있으면) 마지막 연결 문구('발언 기록') 뒤 = 발언 기록 본문에 있어야 함
      const lastLinkEnd = Math.max(by.at + by.raw.length, ...(p.linkPatterns || []).map(l => {
        const m = new RegExp(l.re, 'i').exec(canonChars(sc.header));
        return m ? m.index + m[0].length : -1;
      }));
      if (at < lastLinkEnd) { rejected.push({ quote: q, reason: '인용이 작성자·편집자 주 영역 안에 있음(발언 기록 본문이 아님)' }); continue; }
    } else if (at < by.at + by.raw.length) {
      rejected.push({ quote: q, reason: '인용이 작성자 표지보다 앞에 있음' }); continue;
    }
    const spokenOk = p.kind === 'call_remarks' && linked && date.ok;
    items.push({
      speaker: { name: p.speakerName, companyId: p.companyId },
      topicId: p.topicId,
      spokenAt: spokenOk
        ? { value: p.date, precision: 'day', basisType: 'explicit_in_text', basis: `편집자 주가 이 글을 게시일 당일 실적 통화의 발언 기록이라고 밝힘 + 게시일 ("${date.excerpt}")`, basisExcerpt: date.excerpt! }
        : { value: null, precision: 'unknown', basisType: 'none', basis: p.kind === 'authored_post'
          ? '본인 작성글 — 발언일 없음(작성일은 원문 게시일로 따로 표시)'
          : p.kind === 'press_release' ? '공식 발표문 안 인용 — 실제 발언일 미상(발표문 게시일은 따로 표시)' : '당일 통화 연결 문구·작성자·게시일을 모두 확인하지 못해 발언일 미상' },
      kind: 'direct_quote',
      quoteText: ws(found.raw).replace(/[.,]\s*$/, ''),
      quoteLanguage: 'en',
      summaryKo: '',
      excerpts: [ws(found.raw)],
      sourceType: p.kind,
      provenance,
      referenceDate: p.kind === 'press_release' && date.ok ? { value: p.date, precision: 'day', basis: 'released' } : undefined,
    });
  }
  return { items, rejected };
}
