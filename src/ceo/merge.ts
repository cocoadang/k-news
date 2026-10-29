import { CeoStatement, PartialDate } from './types';
import { normalizeForMatch } from './text';
import { sameQuote } from './validate';

export interface MergeReport {
  merged: number;
  /** eventKey는 같지만 같은 발언이라는 조건(인용·언어·날짜·회사·맥락)이 맞지 않아 별개로 남긴 수 */
  keptSeparate: number;
}

/** 날짜 동일성: 둘 다 알려져 있고 정밀도·값이 같을 때만 같은 날짜로 봄 (미상끼리·포함 관계는 불확실 → 다름) */
function sameDate(a: PartialDate, b: PartialDate): boolean {
  if (a.precision === 'unknown' || b.precision === 'unknown') return false;
  return a.precision === b.precision && a.value === b.value && (a.rangeEnd || null) === (b.rangeEnd || null);
}

const contextKey = (s: CeoStatement) =>
  s.context ? s.context.sources.map(x => normalizeForMatch(x.excerpt)).sort().join('|') : '';

/**
 * 같은 사건의 같은 발언을 여러 매체가 보도한 경우에만 근거를 합칩니다. 모든 조건을 만족해야 합니다:
 * 같은 인물·주제·회사, 추출기가 준 같은 eventKey(없으면 합치지 않음), 둘 다 검증된 직접 인용,
 * 같은 언어의 같은 인용문(다른 언어는 번역 동일성을 확인할 수 없어 합치지 않음),
 * 같은 발언일(둘 다 알려져 있고 정밀도·값 동일), 당시 상황 근거가 서로 다르지 않음.
 * 반복된 같은 말, 다른 회의, 같은 제목·주제는 합치지 않습니다.
 */
export function mergeStatements(list: CeoStatement[]): { statements: CeoStatement[]; report: MergeReport } {
  const report: MergeReport = { merged: 0, keptSeparate: 0 };
  const out: CeoStatement[] = [];
  const sorted = [...list].sort((a, b) => (a.statementId < b.statementId ? -1 : a.statementId > b.statementId ? 1 : 0));
  for (const s of sorted) {
    let target: CeoStatement | undefined;
    let sameEventSeen = false;
    if (s.eventKey && s.kind === 'direct_quote') {
      for (const t of out) {
        if (t.personId !== s.personId || t.topicId !== s.topicId || t.companyId !== s.companyId || t.eventKey !== s.eventKey) continue;
        sameEventSeen = true;
        if (t.kind !== 'direct_quote') continue;
        if ((t.quoteLanguage || 'ko') !== (s.quoteLanguage || 'ko') || !sameQuote(t.quoteText, s.quoteText)) continue;
        if (!sameDate(t.spokenAt, s.spokenAt)) continue;
        if (t.context && s.context && contextKey(t) !== contextKey(s)) continue;
        target = t; break;
      }
    }
    if (!target) {
      if (sameEventSeen) report.keptSeparate++;
      out.push(JSON.parse(JSON.stringify(s)));
      continue;
    }
    report.merged++;
    const keys = new Set(target.evidence.map(e => `${e.articleId}::${normalizeForMatch(e.excerpt)}`));
    for (const e of s.evidence) {
      const k = `${e.articleId}::${normalizeForMatch(e.excerpt)}`;
      if (!keys.has(k)) { keys.add(k); target.evidence.push(e); }
    }
    if (!target.context && s.context) target.context = JSON.parse(JSON.stringify(s.context));
  }
  return { statements: out, report };
}
