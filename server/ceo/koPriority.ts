import { COMPANY_QUESTIONS, effectiveDate } from '../../src/components/ceo/timeline/companyQuestions.mjs';

/** 번역 우선순위: 질문(예: 'AI 수요 전망은?')에 분류되는 발언 먼저, 그 안에서 최근 날짜 먼저. 날짜 없는 발언은 뒤로 */
export function koPriority<T extends { companyId: string; quoteText?: string }>(statements: T[]): T[] {
  const classified = (s: T) => ((COMPANY_QUESTIONS as any)[s.companyId] || []).some((d: any) => !!String(s.quoteText || '').match(d.re));
  const date = (s: T) => String((effectiveDate as any)(s)?.value || '');
  return statements.map((s, i) => ({ s, i, c: classified(s) ? 0 : 1, d: date(s) }))
    .sort((a, b) => a.c - b.c || (b.d || '0').localeCompare(a.d || '0') || a.i - b.i)
    .map(x => x.s);
}
