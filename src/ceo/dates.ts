import { CeoStatement, PartialDate, StatementReferenceDate, StatementEvidence } from './types';

/** SEC Filing Detail에서 확인한 제출일. Accepted 시각·인터뷰일과 구분합니다. */
const SEC_FILING_DATES: Record<string, string> = {
  'https://www.sec.gov/Archives/edgar/data/1181412/000162828026041761/fwp_cfointerview.htm': '2026-06-09',
  'https://www.sec.gov/Archives/edgar/data/1181412/000162828026041365/eu_interviewtranscript06.htm': '2026-06-08',
};

export function secFilingDate(url: string): string | null {
  try { const u = new URL(url); u.hash = ''; u.search = ''; return SEC_FILING_DATES[u.href] || null; }
  catch { return null; }
}

/** 기존 저장 기록도 검증된 제출일을 표시하며 실제 발언일은 바꾸지 않습니다. */
export function documentPublishedAt(e: Pick<StatementEvidence, 'url' | 'articlePublishedAt'>): string | null {
  const filed = secFilingDate(e.url);
  return filed ? `${filed}T00:00:00.000Z` : e.articlePublishedAt;
}

/** YYYY / YYYY-MM / YYYY-MM-DD 를 [시작, 끝) 구간(UTC ms)으로 바꿉니다. 형식이 틀리면 null */
export function partialToInterval(value: string | null | undefined): [number, number] | null {
  if (!value) return null;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  if (m[3]) {
    const mo = Number(m[2]) - 1, d = Number(m[3]);
    const s = Date.UTC(y, mo, d);
    const check = new Date(s);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo || check.getUTCDate() !== d) return null;
    return [s, Date.UTC(y, mo, d + 1)];
  }
  if (m[2]) {
    const mo = Number(m[2]) - 1;
    if (mo < 0 || mo > 11) return null;
    return [Date.UTC(y, mo, 1), Date.UTC(y, mo + 1, 1)];
  }
  return [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)];
}

/** 발언일 구간. unknown이거나 형식 오류면 null (순서를 매길 수 없음) */
export function spokenInterval(d: PartialDate): [number, number] | null {
  if (d.precision === 'unknown') return null;
  const a = partialToInterval(d.value);
  if (!a) return null;
  if (d.precision === 'range') {
    const b = partialToInterval(d.rangeEnd);
    if (!b || b[1] <= a[0]) return null;
    return [a[0], b[1]];
  }
  return a;
}

/**
 * 형식·정밀도·근거가 서로 맞는지. 모든 정밀도(일/월/연/기간)에 같은 근거 기준을 적용합니다:
 * 근거 유형이 있어야 하고(none 불가), 근거 본문 구간(basisExcerpt)이 있어야 합니다. 구간이 실제 기사에 있는지는
 * validateSpokenDate에서 확인합니다.
 */
export function isWellFormedPartialDate(d: PartialDate): boolean {
  if (!d || typeof d !== 'object') return false;
  if (d.precision === 'unknown') return d.value === null || d.value === undefined;
  if (!d.value) return false;
  // v3: 본문에 명시된 절대 날짜만 인정. 기사 정보로 추정한 날짜(inferred_from_article)는 받지 않음
  if (d.basisType !== 'explicit_in_text') return false;
  if (!(typeof d.basisExcerpt === 'string' && d.basisExcerpt.trim())) return false;
  if (d.precision === 'range') return spokenInterval(d) !== null;
  const len = { day: 10, month: 7, year: 4 } as const;
  if (!(d.precision in len) || d.value.length !== len[d.precision as keyof typeof len]) return false;
  return partialToInterval(d.value) !== null;
}

export const UNKNOWN_DATE = (why: string): PartialDate => ({ value: null, precision: 'unknown', basisType: 'none', basis: why });

/**
 * 두 발언의 선후가 확실한지. 구간이 겹치면(예: '2026년' vs '2026-03') 선후를 단정하지 않습니다.
 * 반환: -1 (a가 확실히 먼저), 1 (b가 확실히 먼저), 0 (판단 불가)
 */
export function certainOrder(a: PartialDate, b: PartialDate): -1 | 0 | 1 {
  const ia = spokenInterval(a), ib = spokenInterval(b);
  if (!ia || !ib) return 0;
  if (ia[1] <= ib[0]) return -1;
  if (ib[1] <= ia[0]) return 1;
  return 0;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 화면용 발언일 문구: 정확도를 함께 표시 */
export function formatSpokenDate(d: PartialDate): { text: string; precisionLabel: string } {
  if (d.precision === 'unknown' || !d.value) return { text: '발언일 미상', precisionLabel: '날짜 미상' };
  const fmt = (v: string) => {
    const [y, m, day] = v.split('-');
    if (day) return `${y}.${m}.${day}`;
    if (m) return `${y}.${m}`;
    return `${y}`;
  };
  if (d.precision === 'range') return { text: `${fmt(d.value)} ~ ${fmt(d.rangeEnd || '')}`, precisionLabel: '기간 추정' };
  const label = { day: '일 단위', month: '월 단위', year: '연 단위' }[d.precision];
  return { text: fmt(d.value), precisionLabel: d.basisType === 'inferred_from_article' ? `${label} · 추정` : label };
}

/** 기사 발행일 (ISO) → YYYY.MM.DD (UTC 기준이 아니라 한국 시간 기준) */
export function formatArticleDate(iso: string | null | undefined): string {
  if (!iso) return '발행일 미상';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '발행일 미상';
  const k = new Date(t + 9 * 3600_000);
  return `${k.getUTCFullYear()}.${pad(k.getUTCMonth() + 1)}.${pad(k.getUTCDate())}`;
}

/**
 * 타임라인 정렬 키. 발언일을 알면 구간 중앙, 모르면 null (미상 묶음으로 따로 표시).
 * 기사일로 발언일 자리를 채우지 않습니다.
 */
export function timelineSortKey(d: PartialDate): number | null {
  const i = spokenInterval(d);
  return i ? (i[0] + i[1]) / 2 : null;
}

/**
 * 발언의 유효 기준일 (구두 발언일 또는 서면 발표문 공식 발표일 등).
 * - 발언일(spokenAt)이 확인된 경우: spoken 기준일
 * - 서면 공식 발표문(press_release)이고 발표일 근거가 확인된 경우: released 기준일
 * - 본인 작성글(authored_post)이고 작성일 근거가 확인된 경우: written 기준일
 * - 인터뷰/SEC 제출 문서는 실제 발언일이 아닌 문서/영상 게시일을 기준일로 삼지 않음 (null)
 */
export function statementReferenceDate(s: CeoStatement): StatementReferenceDate | null {
  if (s.referenceDate && s.referenceDate.value && s.referenceDate.precision !== 'unknown') {
    return s.referenceDate;
  }
  if (s.spokenAt && s.spokenAt.precision !== 'unknown' && s.spokenAt.value) {
    return { value: s.spokenAt.value, precision: s.spokenAt.precision, basis: 'spoken' };
  }
  const relEv = s.evidence?.find(e => e.publishedAtBasis?.kind === 'released' && e.articlePublishedAt);
  if (s.sourceType === 'press_release' && relEv) {
    return { value: relEv.articlePublishedAt!.slice(0, 10), precision: 'day', basis: 'released' };
  }
  const wrEv = s.evidence?.find(e => e.publishedAtBasis?.kind === 'written' && e.articlePublishedAt);
  if (s.sourceType === 'authored_post' && wrEv) {
    return { value: wrEv.articlePublishedAt!.slice(0, 10), precision: 'day', basis: 'written' };
  }
  return null;
}

/**
 * 발언의 기준일 정렬 키. 기준일이 있으면 구간 중앙값(UTC ms), 없으면 null.
 * 구두 발언은 발언일, 서면 발표문은 공식 발표일 기준.
 */
export function statementSortKey(s: CeoStatement): number | null {
  const ref = statementReferenceDate(s);
  if (!ref) return null;
  const interval = partialToInterval(ref.value);
  return interval ? (interval[0] + interval[1]) / 2 : null;
}

/** 시점 t(YYYY[-MM[-DD]] 또는 발언일)가 재임 기간 [start, end]와 확실히 겹치는지/확실히 벗어나는지 */
export function tenureRelation(spoken: PartialDate, start: string, end: string | null): 'inside' | 'outside' | 'uncertain' {
  const s = spokenInterval(spoken);
  const rs = partialToInterval(start);
  const re = end ? partialToInterval(end) : null;
  if (!s || !rs) return 'uncertain';
  const tenure: [number, number] = [rs[0], re ? re[1] : Number.POSITIVE_INFINITY];
  if (s[0] >= tenure[0] && s[1] <= tenure[1]) return 'inside';
  if (s[1] <= tenure[0] || s[0] >= tenure[1]) return 'outside';
  return 'uncertain';
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

export interface AbsoluteDate { value: string; precision: 'day' | 'month' | 'year' }

/**
 * 문장 안의 '명확한 절대 날짜'만 결정적으로 읽습니다 (연도가 함께 적힌 것만).
 * 지원: 2026-01-01 / 2026.01.01 / 2026/01/01, 2026년 1월 1일 / 2026년 1월 / 2026년,
 *       January 1, 2026 / Jan. 1, 2026 / 1 January 2026 / January 2026
 * 상대 표현(지난 20일, 14일, 이날, on Monday, last June 등)·연도 없는 날짜는 읽지 않습니다. 시간대는 가정하지 않습니다(날짜 문자열 그대로).
 * 존재하지 않는 날짜(2월 30일 등)는 버립니다.
 */
export function extractAbsoluteDates(text: string): AbsoluteDate[] {
  let t = ` ${text || ''} `;
  const out: AbsoluteDate[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  const push = (y: number, m?: number, d?: number) => {
    const value = d ? `${y}-${pad(m!)}-${pad(d)}` : m ? `${y}-${pad(m)}` : `${y}`;
    if (partialToInterval(value)) out.push({ value, precision: d ? 'day' : m ? 'month' : 'year' });
  };
  const take = (re: RegExp, fn: (m: RegExpExecArray) => void) => {
    t = t.replace(re, (...args: any[]) => { fn(args as unknown as RegExpExecArray); return ' § '; });
  };
  take(/(?<![\d])(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?![\d])/g, m => push(+m[1], +m[2], +m[3]));
  take(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, m => push(+m[1], +m[2], +m[3]));
  take(/(\d{4})\s*년\s*(\d{1,2})\s*월/g, m => push(+m[1], +m[2]));
  take(new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), m => push(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  take(new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi'), m => push(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  take(new RegExp(`\\b${MONTH_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi'), m => push(+m[2], MONTHS[m[1].toLowerCase()]));
  take(/(?<![\d])(\d{4})\s*년/g, m => push(+m[1]));
  return out;
}
