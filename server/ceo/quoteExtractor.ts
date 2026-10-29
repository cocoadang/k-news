/**
 * 결정적(규칙 기반) 직접 인용 추출기. 모델 호출 없음.
 *
 * 인정하는 경우 (모두 같은 문장 범위 안):
 *   “인용,” said 이름[, 직함]        / “인용,” 이름[, 직함,] said
 *   이름[, 직함,] said[ …]: “인용”
 * - 이름은 등록부의 전체 이름 변형만 비교합니다(성만 일치는 불인정).
 * - 귀속 구간에 등록 인물이 둘 이상이면 건너뜁니다(화자 불명확).
 * - '…라고 불렀다(called it “…”)' 같은 부분 인용, 귀속 동사가 없는 인용은 건너뜁니다.
 *
 * 발언일: 인용 밖 귀속 구간에 "said … on <연도 포함 절대 날짜>"가 있을 때만 그 구간을 근거로 제시합니다.
 *   dateline(도시, 날짜 —), 기사 발행일, 인용문 안의 날짜(출시 예정일 등)는 쓰지 않습니다. 그 외에는 발언일 미상.
 *   (제시한 근거는 이후 validateSpokenDate가 다시 검증)
 */
import { CeoPerson } from '../../src/ceo/types';
import { extractAbsoluteDates } from '../../src/ceo/dates';

import { RawStatement, SourceArticle, StatementExtractor } from './pipeline';

export const QUOTE_EXTRACTOR_NAME = 'deterministic-quote';
/**
 * 1.2: 원문에 실제로 여러 번 나온 인용은 문장·귀속 문구가 같아도 각각 별개 발생으로 추출(텍스트 비교로 지우지 않음).
 *      인용 직전 단락(행사·상황 문맥)을 context 근거로 함께 보존. 이전 캐시는 다시 추출.
 */
export const QUOTE_EXTRACTOR_VERSION = '1.2';

/** 인용이 있는 줄 바로 앞의 비어 있지 않은 줄(단락). 그 줄에 인용부호가 있으면(다른 인용 단락) 문맥으로 쓰지 않음 */
function precedingParagraph(text: string, at: number): string | null {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const before = text.slice(Math.max(0, lineStart - 400), lineStart).split('\n').map(l => l.trim()).filter(Boolean);
  const prev = before[before.length - 1];
  if (!prev || prev.length < 3 || /[“”"]/.test(prev)) return null;
  return prev.length > 300 ? prev.slice(prev.length - 300) : prev;
}

const VERBS = '(?:said|says|added|noted|explained|wrote|told)';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 인용 구간 찾기: “…” 또는 "…" (4단어 이상, 600자 이하) */
function findQuotes(text: string): { start: number; end: number; inner: string }[] {
  const out: { start: number; end: number; inner: string }[] = [];
  const re = /“([^“”]{3,600})”|"([^"\n]{3,600})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const inner = (m[1] ?? m[2]).trim();
    if (inner.split(/\s+/).length < 4) continue;
    out.push({ start: m.index, end: m.index + m[0].length, inner });
  }
  return out;
}

/** 문장 경계까지의 앞·뒤 구간 (마침표·물음표·느낌표 + 공백 기준, 인용 바깥) */
function windowAfter(text: string, end: number): string {
  const rest = text.slice(end, end + 200);
  // 문장 끝 = 마침표 뒤 공백+대문자/인용부호 또는 끝 ("Oct. 14" 같은 약어 뒤 숫자는 문장 끝 아님)
  const stop = rest.search(/[.!?](?=\s+[A-Z“"]|\s*$)|[“"\n]/);
  return stop >= 0 ? rest.slice(0, stop + 1) : rest;
}
function windowBefore(text: string, start: number): string {
  const prev = text.slice(Math.max(0, start - 200), start);
  const cut = Math.max(prev.lastIndexOf('. '), prev.lastIndexOf('? '), prev.lastIndexOf('! '), prev.lastIndexOf('”'), prev.lastIndexOf('"'), prev.lastIndexOf('\n'));
  return cut >= 0 ? prev.slice(cut + 1) : prev;
}

export function createQuoteExtractor(persons: CeoPerson[]): StatementExtractor {
  const names = persons.flatMap(p => [p.displayName, ...p.nameVariants].filter(n => /[A-Za-z]/.test(n)).map(n => ({ name: n, personId: p.personId })));
  const nameAlt = names.map(n => esc(n.name)).join('|') || '(?!x)x';
  const anyName = new RegExp(`\\b(?:${nameAlt})\\b`, 'g');
  const afterSaidName = new RegExp(`^\\s*,?\\s*${VERBS}\\s+(${nameAlt})\\b`);
  const afterNameSaid = new RegExp(`^\\s*,?\\s*(${nameAlt})\\b(?:,[^,“”"]{1,100},)?\\s+${VERBS}\\b`);
  const beforeNameSaid = new RegExp(`(?:^|[\\s(])(${nameAlt})\\b(?:,[^,“”"]{1,100},)?\\s+${VERBS}\\b[^“”"]{0,40}?[:,]?\\s*$`);
  const datePhrase = new RegExp(`\\b${VERBS}\\b[^“”".]{0,60}?\\bon\\s+((?:[A-Z][a-z]{2,8}\\.?\\s+\\d{1,2},?\\s+\\d{4})|(?:\\d{1,2}\\s+[A-Z][a-z]{2,8}\\.?,?\\s+\\d{4}))`);

  return {
    name: QUOTE_EXTRACTOR_NAME,
    version: QUOTE_EXTRACTOR_VERSION,
    async extract(article: SourceArticle): Promise<RawStatement[]> {
      const text = article.body || '';
      const out: RawStatement[] = [];
      // 원문 인용 구간(물리적 발생) 하나당 최대 1건. 같은 구간을 두 번 추출하는 경로는 없으므로 텍스트 비교 중복 제거는 하지 않음
      for (const q of findQuotes(text)) {
        const after = windowAfter(text, q.end);
        const before = windowBefore(text, q.start);
        let speaker: string | null = null;
        let attribution = '';
        let m = afterSaidName.exec(after) || afterNameSaid.exec(after);
        if (m) { speaker = m[1]; attribution = after; }
        else if ((m = beforeNameSaid.exec(before))) { speaker = m[1]; attribution = before; }
        if (!speaker) continue;
        // 귀속 구간에 다른 등록 인물이 함께 있으면 화자 불명확 → 건너뜀
        const mentioned = new Set((attribution.match(anyName) || []).map(n => names.find(x => x.name === n)?.personId));
        if (mentioned.size !== 1) continue;
        const excerpt = attribution === after ? text.slice(q.start, q.end) + after : before + text.slice(q.start, q.end);
        const quoteText = q.inner.replace(/[,]\s*$/, '').trim();
        const ctx = precedingParagraph(text, Math.min(q.start, attribution === after ? q.start : q.start - before.length));
        // 발언일: 인용 밖 귀속 구간의 "said … on 날짜"만
        const d = datePhrase.exec(attribution);
        const dates = d ? extractAbsoluteDates(d[0]) : [];
        const spokenAt = d && dates.length === 1 && dates[0].precision === 'day'
          ? { value: dates[0].value, precision: 'day' as const, basisType: 'explicit_in_text' as const, basis: `귀속 문구 "${d[0].trim()}"`, basisExcerpt: d[0].trim() }
          : { value: null, precision: 'unknown' as const, basisType: 'none' as const, basis: '인용 귀속 문구에 발언 날짜 없음 (기사 발행일·dateline은 발언일로 쓰지 않음)' };
        out.push({
          speaker: { name: speaker },
          topicId: article.topicId || '기타',
          spokenAt,
          kind: 'direct_quote',
          quoteText,
          quoteLanguage: /[가-힣]/.test(quoteText) ? 'ko' : 'en',
          summaryKo: '',
          excerpts: [excerpt.trim()],
          ...(ctx ? { context: { text: '인용 직전 기사 단락(행사·상황 문맥, 의미는 검증하지 않음)', excerpts: [ctx] } } : {}),
        });
      }
      return out;
    },
  };
}
