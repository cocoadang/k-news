/**
 * 공식 IR 행사 기록(실적 발표 통화 transcript) — 사람이 고른 소수 인용을 원문에서 매번 다시 검증.
 * 모델 호출 없음. 기존 기사·이벤트 DB에 추가하지 않는 CEO 모듈 전용 출처입니다.
 *
 * 검증 규칙 (하나라도 실패하면 그 인용은 보류):
 * - 페이지 본문에 행사 날짜 문구(eventDateExcerpt)와 '실시간 웹캐스트·녹음' 문구(recordingExcerpt)가 있어야 함
 *   → 발언일 = 행사(통화) 날짜. 기사 발행일·dateline이 아니라, 녹음된 통화 기록이라는 페이지 명시가 연결 근거
 * - 인용문이 '화자 라벨(예: SATYA NADELLA:)'로 시작하는 구간 안에 그대로 있어야 함 (다른 화자 구간이면 보류)
 * - 근거 구간 = 인용이 들어 있는 문장 전체 (본문 그대로)
 * 범위 한정(오귀속 방지): 페이지 공통 영역에는 다른 행사 날짜가 있으므로 전체 페이지에서 날짜를 찾지 않습니다.
 *   transcript 제목(h1 텍스트) 위치부터 본문 끝(END 줄 또는 페이지 끝)까지를 transcript 범위로 잡고,
 *   행사 날짜는 제목과 첫 화자 라벨 사이(참가자·날짜 단락)에서만, 화자 구간은 이 범위 안에서만 찾습니다.
 *   화자 구간 끝 = 다음 화자 라벨(대문자 이름 + 콜론, AMY HOOD 외 질문자 포함) 어느 것이든.
 *   HTML 요소 ID(UID)는 페이지마다 달라 쓰지 않습니다.
 * 캐시 hash는 페이지 전체가 아니라 이 transcript 범위 텍스트(정규화)로 계산합니다.
 * 확인: 2026-10-18 웹 읽기 + PC 원문 읽기(HTTP 200, redirect 없음,
 *   FY25 345,322 bytes SHA256 544d3d4e47b690476a8e0125f6e14139ae9daac57f07ceade53785658b21dd34,
 *   FY26 347,999 bytes SHA256 3eba962de8bfef7e6cee03fbcb62fc27e4c2a05a9fbcec2a69aa13a6960ab82d — 수신 증거이며 캐시 키 아님).
 *   본문 날짜 단락 "Wednesday January 29, 2025" / "Wednesday January 28, 2026", 화자 라벨 <p><strong>SATYA NADELLA: </strong>.
 *   FY26 제목 문자열은 FY25와 같은 형식으로 가정했으며 PC 원문 파일로 확인이 필요합니다(불일치 시 인용은 '제목 확인 실패'로 보류).
 */
import { RawStatement, SourceArticle } from './pipeline';
import { shortHash } from '../../src/ceo/text';

export interface CuratedTranscript {
  sourceId: string;
  url: string;
  title: string;
  /** 출처 발행 조직 표시 (화면 출처 이름 앞부분, 회사별) */
  sourceOrg: string;
  /** 페이지 h1의 transcript 제목 (범위 시작점) */
  transcriptTitle: string;
  companyId: string;
  speakerLabel: string;
  speakerName: string;
  eventDate: string;
  eventDateExcerpt: string;
  recordingExcerpt: string;
  topicId: string;
  quotes: string[];
}

export const CURATED_TRANSCRIPTS: CuratedTranscript[] = [
  {
    sourceId: 'msft-fy25-q2-call',
    url: 'https://www.microsoft.com/en-us/investor/events/fy-2025/earnings-fy-2025-q2',
    title: 'Microsoft FY25 Q2 실적 발표 통화 기록', sourceOrg: 'Microsoft Investor Relations',
    transcriptTitle: 'Microsoft FY25 Second Quarter Earnings Conference Call',
    companyId: 'msft', speakerLabel: 'SATYA NADELLA', speakerName: 'Satya Nadella',
    eventDate: '2025-01-29', eventDateExcerpt: 'Wednesday January 29, 2025', recordingExcerpt: 'webcast live and recorded',
    topicId: '클라우드 / 데이터센터',
    quotes: ['And, as AI becomes more efficient and accessible, we will see exponentially more demand.'],
  },
  {
    sourceId: 'msft-fy26-q2-call',
    url: 'https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q2',
    title: 'Microsoft FY26 Q2 실적 발표 통화 기록', sourceOrg: 'Microsoft Investor Relations',
    transcriptTitle: 'Microsoft FY26 Second Quarter Earnings Conference Call',
    companyId: 'msft', speakerLabel: 'SATYA NADELLA', speakerName: 'Satya Nadella',
    eventDate: '2026-01-28', eventDateExcerpt: 'Wednesday January 28, 2026', recordingExcerpt: 'webcast live and recorded',
    topicId: '클라우드 / 데이터센터',
    quotes: ['The key metric we are optimizing for is tokens per watt per dollar'],
  },
];

/** 선별 목록이 바뀌면 추출기 버전이 바뀌어 다시 추출되도록 */
export const CURATION_HASH = shortHash(JSON.stringify(CURATED_TRANSCRIPTS));

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * 화자 경계(넓게, 기록 머리·화자 구간에 같은 규칙): 줄 시작의 대문자로 시작하는 단어 1~4개 + 선택적 "(직책)" + 콜론.
 * 대문자 라벨뿐 아니라 'Amy Hood:', 'AMY HOOD (CFO):', 모르는 화자 라벨도 경계로 봅니다.
 * 화자 라벨이 아닌 줄이 경계로 잡히면 그 뒤 인용은 '보류'(fail-closed)될 뿐 다른 사람에게 귀속되지 않습니다.
 */
const BOUNDARY_LABEL_RE = /(^|\n)[ \t]*([A-Z][A-Za-z.'\u2019\-]*(?:[ \t]+[A-Z][A-Za-z.'\u2019\-]*){0,3})(?:[ \t]*\([^()\n]{1,60}\))?[ \t]*:/g;
const labelKey = (s: string) => ws(s).toUpperCase();

/**
 * transcript 범위: 제목 위치 ~ END 줄(없으면 끝). header = 제목 ~ 첫 화자 경계 라벨 (참가자·날짜 단락).
 * 화자 경계는 speakerSections와 같은 넓은 규칙 → 'Amy Hood:' 같은 발언 안의 다른 날짜는 머리로 보지 않음.
 */
export function transcriptScope(text: string, title: string): { scope: string; header: string } | null {
  const titleRe = new RegExp(ws(title).split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'), 'g');
  const titles = [...text.matchAll(titleRe)].map(m => m.index!);
  if (!titles.length) return null;
  // 제목은 탐색·관련 행사 영역에도 나올 수 있으므로, 첫 제목 이후 처음 나오는 화자 경계 라벨 바로 앞의(가장 가까운) 제목을 시작으로 씀
  const lb = new RegExp(BOUNDARY_LABEL_RE.source, 'g');
  lb.lastIndex = titles[0];
  const labelAt = lb.exec(text);
  const limit = labelAt ? labelAt.index : text.length;
  const start = titles.filter(i => i < limit).pop() ?? titles[0];
  let scope = text.slice(start);
  const end = /\n\s*END\.?\s*(\n|$)/.exec(scope);
  if (end) scope = scope.slice(0, end.index);
  const first = new RegExp(BOUNDARY_LABEL_RE.source, 'g').exec(scope);
  return { scope, header: first ? scope.slice(0, first.index) : scope };
}

/** 화자 라벨(넓은 경계 규칙)로 나눈 구간. label은 직책 괄호를 뺀 대문자 정규화 이름 */
export function speakerSections(text: string): { label: string; body: string }[] {
  const re = new RegExp(BOUNDARY_LABEL_RE.source, 'g');
  const marks: { label: string; at: number; bodyAt: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) marks.push({ label: labelKey(m[2]), at: m.index, bodyAt: m.index + m[0].length });
  return marks.map((k, i) => ({ label: k.label, body: text.slice(k.bodyAt, i + 1 < marks.length ? marks[i + 1].at : text.length) }));
}

/** 인용이 들어 있는 문장 (본문 그대로, 공백만 정리) */
function sentenceAround(section: string, quote: string): string | null {
  const flat = ws(section);
  const i = flat.indexOf(ws(quote));
  if (i < 0) return null;
  const startCut = Math.max(flat.lastIndexOf('. ', i), flat.lastIndexOf('? ', i), flat.lastIndexOf('! ', i));
  const start = startCut >= 0 ? startCut + 2 : 0;
  const endMatch = /[.!?](\s|$)/.exec(flat.slice(i + ws(quote).length - 1));
  const end = endMatch ? i + ws(quote).length - 1 + endMatch.index + 1 : flat.length;
  return flat.slice(start, end).trim();
}

/** 원문(평문)에서 transcript 범위만 잘라 기사로 (캐시 hash는 이 범위로 계산). 제목을 못 찾으면 null */
export function transcriptArticle(t: CuratedTranscript, pageText: string): SourceArticle | null {
  const sc = transcriptScope(pageText, t.transcriptTitle);
  if (!sc) return null;
  return { articleId: '', title: t.title, body: sc.scope, sourceName: `${t.sourceOrg} · ${t.title}`, url: t.url, publishedAt: null, topicId: t.topicId, sourceKind: 'transcript', transcriptId: t.sourceId };
}

/** 선별 인용 검증 → RawStatement (실패한 인용은 사유와 함께 제외) */
export function extractCuratedQuotes(t: CuratedTranscript, text: string): { items: RawStatement[]; rejected: { quote: string; reason: string }[] } {
  const rejected: { quote: string; reason: string }[] = [];
  const sc = transcriptScope(text, t.transcriptTitle);
  if (!sc) return { items: [], rejected: t.quotes.map(q => ({ quote: q, reason: 'transcript 제목 확인 실패(범위를 정할 수 없음)' })) };
  if (!ws(sc.header).includes(ws(t.eventDateExcerpt))) {
    return { items: [], rejected: t.quotes.map(q => ({ quote: q, reason: 'transcript 머리(제목~첫 화자) 안에서 행사 날짜를 확인하지 못함' })) };
  }
  if (!ws(sc.scope).includes(ws(t.recordingExcerpt))) {
    return { items: [], rejected: t.quotes.map(q => ({ quote: q, reason: 'transcript 범위 안에서 녹음된 통화 문구를 확인하지 못함' })) };
  }
  const sections = speakerSections(sc.scope);
  const items: RawStatement[] = [];
  for (const q of t.quotes) {
    const own = sections.filter(s => s.label === labelKey(t.speakerLabel)).map(s => sentenceAround(s.body, q)).find(Boolean);
    if (!own) {
      const elsewhere = sections.some(s => s.label !== labelKey(t.speakerLabel) && ws(s.body).includes(ws(q)));
      rejected.push({ quote: q, reason: elsewhere ? '다른 화자 구간에 있음(화자 귀속 불일치)' : '원문 화자 구간에서 인용을 찾지 못함' });
      continue;
    }
    items.push({
      speaker: { name: t.speakerName, companyId: t.companyId },
      topicId: t.topicId,
      spokenAt: { value: t.eventDate, precision: 'day', basisType: 'explicit_in_text', basis: `녹음된 실적 발표 통화의 행사 날짜 ("${t.eventDateExcerpt}")`, basisExcerpt: t.eventDateExcerpt },
      kind: 'direct_quote',
      quoteText: q.replace(/[.,]\s*$/, ''),
      quoteLanguage: 'en',
      summaryKo: '',
      excerpts: [own],
    });
  }
  return { items, rejected };
}
