// Company-specific comparison questions for CEO statements.
// Classification reads only the stored original quote (never a model summary or headline),
// so each assignment can be checked against the words that triggered it.

/** @typedef {{id:string,label:string,hint:string,re:RegExp}} Question */

/** @type {Record<string, Question[]>} */
export const COMPANY_QUESTIONS = {
  nvda: [
    { id: 'demand', label: 'AI 수요는 얼마나 강하다고 말했나?', hint: '수요 강도·공급 부족 표현', re: /\b(demand|sold out|off the charts|growing exponentially)\b/gi },
    { id: 'platform', label: '주력 제품 세대는 어떻게 바뀌었나?', hint: 'Hopper → Blackwell → Rubin', re: /\b(Hopper|Blackwell|Rubin|Grace|NVLink)\b/gi },
    { id: 'phase', label: 'AI 산업 국면을 어떻게 진단했나?', hint: '산업혁명·변곡점·AI 팩토리', re: /\b(industrial revolution|age of AI|inflection point|AI factor(?:y|ies)|AI race|infrastructure expansion)\b/gi },
    { id: 'profit', label: 'AI의 수익성은 어떻게 설명했나?', hint: '매출·이익·토큰당 비용', re: /\b(revenue|profitab\w*|profitable|cost per token)\b/gi },
  ],
  googl: [
    { id: 'cloud', label: 'Cloud·AI 인프라 성장은 어떻게 달라졌나?', hint: '클라우드 매출·수주잔고·TPU·인프라', re: /\b(Google Cloud|Cloud (?:accelerated|revenues?|growth)|for Cloud growth|TPU|backlog|AI infrastructure|data centers)\b/gi },
    { id: 'search', label: '검색은 AI로 어떻게 변했나?', hint: '검색·쿼리·AI Mode', re: /\b(Search|quer(?:y|ies)|AI Mode|AI Overviews)\b/g },
    { id: 'gemini', label: 'Gemini 사용량과 모델 성과는?', hint: '사용자 수·토큰 처리량', re: /\b(Gemini|tokens|model capabilities|monthly active users|usage|shipping product)\b/gi },
    { id: 'ai-investment', label: 'AI 투자 효과를 어떻게 설명했나?', hint: 'AI 투자·풀스택 전략', re: /\b(AI investments?|investment in AI|full[- ]stack)\b/gi },
    { id: 'vision', label: 'AI의 장기적 의미를 어떻게 말했나?', hint: '기술 비전·낙관론', re: /\b(once[- ]in[- ]a[- ]\w+|foundational enabler|optimistic about AI|next frontiers?|human potential|benefit humanity|AI agents)\b/gi },
    { id: 'results', label: '분기 실적 평가는 어떻게 달라졌나?', hint: '분기 총평·매출 성장률', re: /\b(quarter|revenues? grew|run rate|quarterly revenue)\b/gi },
  ],
  msft: [
    { id: 'demand', label: 'AI 수요·효율을 어떻게 봤나?', hint: '수요 전망·효율 지표', re: /\b(demand|tokens per watt|efficient|accessible)\b/gi },
    { id: 'agents', label: '에이전트·AI 플랫폼 전략은?', hint: 'Agent·Copilot·CoreAI', re: /\b(agent\w*|Copilot|CoreAI|platform shift|model-forward|AI stack)\b/gi },
    { id: 'security', label: '보안 우선 원칙은 어떻게 제시됐나?', hint: '보안·신뢰·SFI', re: /\b(secur\w*|trust\w*|cyber\w*|SFI)\b/gi },
    { id: 'org', label: '조직·인력 운영은 어떻게 설명했나?', hint: '감원·조직 개편', re: /\b(job eliminations|layoffs|headcount|new division|engineering organization|those who have left)\b/gi },
    { id: 'capex', label: 'AI 설비투자에 대한 언급은?', hint: 'CapEx', re: /\b(CapEx|capital expenditures?)\b/gi },
  ],
  spacex: [
    { id: 'space-ai', label: '우주 AI 인프라(AI 위성) 구상은?', hint: 'AI 위성·우주 데이터센터', re: /\b(AI satellites?|satellites?|data cent(?:er|re)s?)\b/gi },
    { id: 'missions', label: '유인 우주비행·NASA 협력은?', hint: 'NASA·JAXA·ESA', re: /\b(NASA|JAXA|ESA|astronauts?|crew|dream come true)\b/gi },
  ],
};

// Fallback for companies without curated questions (e.g. Tesla once data exists).
export const GENERIC_QUESTIONS = [
  { id: 'investment', label: 'AI 투자 방향은 어떻게 달라졌나?', hint: '투자·설비', re: /\b(capex|capital expenditures?|investments?)\b/gi },
  { id: 'demand', label: '수요·공급 판단은 어떻게 달라졌나?', hint: '수요·공급·사용량', re: /\b(demand|supply|capacity|usage|adoption)\b/gi },
  { id: 'revenue', label: '매출·수익화 근거는 어떻게 달라졌나?', hint: '매출·이익', re: /\b(revenue|monetiz\w*|profit\w*)\b/gi },
  { id: 'strategy', label: '경쟁·제휴 방향은 어떻게 달라졌나?', hint: '제휴·경쟁', re: /\b(partner\w*|compet\w*|strategy)\b/gi },
];

// Text that is not the CEO's own substantive claim: editor notes, greetings, ceremonial remarks.
const NOT_A_CLAIM = [
  /^editor[’']?s note/i,
  /^(?:mr\.|ms\.|madam\b|president\b|provost\b|excellencies\b|ladies and gentlemen\b)/i,
  /thank you for the invitation/i,
  /commencement speech/i,
  /\bhaircut\b/i,
];

export function isComparableClaim(statement) {
  const q = statement?.kind === 'direct_quote' ? String(statement.quoteText || '').trim() : '';
  return !!q && !NOT_A_CLAIM.some(re => re.test(q));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const valid = v => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

/**
 * Best date to place a statement on the timeline, with an explicit basis.
 * spoken: date stated in the source text; released: press release date; written: post date.
 */
export function effectiveDate(statement) {
  const sp = statement?.spokenAt;
  if (sp?.precision === 'day' && valid(sp.value)) return { value: sp.value, basis: 'spoken', label: '발언일' };
  const rd = statement?.referenceDate;
  if (rd?.precision === 'day' && valid(rd.value)) {
    if (rd.basis === 'spoken') return { value: rd.value, basis: 'spoken', label: '발언일' };
    if (rd.basis === 'released') return { value: rd.value, basis: 'released', label: '보도자료 발표일' };
    if (rd.basis === 'written') return { value: rd.value, basis: 'written', label: '게시일' };
  }
  return { value: null, basis: 'unknown', label: '날짜 미확인' };
}

// Numbers that appear literally in the quote (e.g. 63%, $460 billion, 7 billion, 3x).
export function literalMetrics(text) {
  const out = String(text || '').match(/\$?\d[\d,.]*\s?(?:%|percent|(?:half-)?(?:trillion|billion|million)(?:-dollar)?|x\b)|\b(?:half-trillion|first-ever \$\d+ billion)\b/gi) || [];
  return [...new Set(out.map(s => s.replace(/\s+/g, ' ').trim()))].slice(0, 4);
}

/** Korean display text: reviewed translation > ready AI summary title > original quote. */
export function displayText(s) {
  if (s?.translationKo?.status === 'reviewed' && s.translationKo.text) return { text: s.translationKo.text, kind: 'translation' };
  if (s?.koSummary?.status === 'ready' && s.koSummary.title) return { text: s.koSummary.title, kind: 'ai_title' };
  return { text: String(s?.quoteText || ''), kind: 'original' };
}

/**
 * Questions for one person+company. Each statement may answer more than one question.
 * Returns only questions with at least one statement, oldest-first items, plus excluded counts.
 */
export function companyQuestions(statements, personId, companyId) {
  const scoped = (statements || []).filter(s => s.personId === personId && s.companyId === companyId);
  const claims = scoped.filter(isComparableClaim);
  const defs = COMPANY_QUESTIONS[companyId] || GENERIC_QUESTIONS;
  const assigned = new Set();
  const questions = defs.map(def => {
    const items = claims.flatMap(s => {
      const terms = [...new Set((String(s.quoteText).match(def.re) || []).map(t => t.trim()))];
      if (!terms.length) return [];
      assigned.add(s.statementId);
      return [{ statement: s, matchedTerms: terms, date: effectiveDate(s), metrics: literalMetrics(s.quoteText) }];
    }).sort((a, b) => (a.date.value || '9999').localeCompare(b.date.value || '9999'));
    const dated = items.filter(x => x.date.value);
    return {
      id: def.id, label: def.label, hint: def.hint, items,
      range: dated.length ? [dated[0].date.value, dated[dated.length - 1].date.value] : null,
      comparable: new Set(dated.map(x => x.date.value)).size >= 2,
    };
  }).filter(q => q.items.length);
  const other = claims.filter(s => !assigned.has(s.statementId));
  return { questions, other, excludedCount: scoped.length - claims.length, total: scoped.length };
}
