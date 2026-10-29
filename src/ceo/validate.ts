import { CeoRole, CeoStatement, PartialDate, StatementEvidence } from './types';
import { extractAbsoluteDates, isWellFormedPartialDate, partialToInterval, spokenInterval, UNKNOWN_DATE } from './dates';
import { roleAtTime } from './identity';
import { hasEllipsisJoin, normalizeForMatch, normalizeQuote } from './text';

/** 검증에 쓰는 현재 기사 본문 (내용 해시 포함) */
export interface ArticleText {
  articleId: string;
  contentHash: string;
  text: string;
}

export type StatementIssue =
  | 'evidence_article_missing'
  | 'evidence_hash_changed'
  | 'evidence_excerpt_not_found'
  | 'evidence_duplicate'
  | 'no_valid_evidence'
  | 'quote_not_verbatim'
  | 'quote_ellipsis_join'
  | 'date_malformed'
  | 'date_basis_not_found'
  | 'date_value_unverified'
  | 'context_unsourced'
  | 'published_basis_invalid'
  | 'provenance_unsourced'
  | 'role_not_found';

export interface ValidatedStatement {
  statement: CeoStatement | null;
  issues: StatementIssue[];
}

const contains = (haystack: string, needle: string) =>
  typeof needle === 'string' && needle.trim().length > 0 && normalizeForMatch(haystack).includes(normalizeForMatch(needle));

/**
 * 발언일 근거 확인 (인물 판별보다 먼저 호출). 모든 정밀도에 같은 기준:
 * 1) 근거 유형은 본문 명시(explicit_in_text)만, 형식·정밀도가 맞아야 함
 * 2) 근거 구간(basisExcerpt)이 발언 근거 기사 본문에 실제로 있어야 함
 * 3) 근거 구간에서 결정적으로 읽은 '절대 날짜'가 정확히 하나(기간은 둘)이고, 그 값·정밀도가 주장한 발언일과 같아야 함
 * 하나라도 아니면 '미상'. 상대 표현(지난 20일, 이날 등)·연도 없는 날짜·복수/모순 날짜는 미상이며, 기사 발행일이나
 * 특정 시간대(KST 등)로 보완하지 않습니다.
 */
export function validateSpokenDate(d: PartialDate, evidenceArticleTexts: string[]): { date: PartialDate; issue?: StatementIssue } {
  if (d && d.precision === 'unknown' && (d.value === null || d.value === undefined)) return { date: { ...d, basisType: 'none' } };
  if (!isWellFormedPartialDate(d)) return { date: UNKNOWN_DATE('날짜 형식·정밀도·근거 유형이 맞지 않아 미상으로 처리'), issue: 'date_malformed' };
  if (!evidenceArticleTexts.some(t => contains(t, d.basisExcerpt!))) {
    return { date: UNKNOWN_DATE('날짜 근거 구간이 발언 기사 본문에 없어 미상으로 처리'), issue: 'date_basis_not_found' };
  }
  const found = extractAbsoluteDates(d.basisExcerpt!);
  const distinct = Array.from(new Map(found.map(x => [`${x.precision}:${x.value}`, x])).values());
  const unverified = (why: string) => ({ date: UNKNOWN_DATE(why), issue: 'date_value_unverified' as StatementIssue });
  if (d.precision === 'range') {
    if (distinct.length !== 2) return unverified('근거 구간에서 기간의 시작·끝 절대 날짜를 확인할 수 없어 미상으로 처리');
    const [x, y] = distinct.sort((a, b) => (a.value < b.value ? -1 : 1));
    if (x.precision !== y.precision || x.value !== d.value || y.value !== d.rangeEnd) return unverified('근거 구간의 날짜가 주장한 기간과 달라 미상으로 처리');
    return { date: d };
  }
  if (distinct.length === 0) return unverified('근거 구간에 연도가 적힌 절대 날짜가 없어 미상으로 처리');
  if (distinct.length > 1) return unverified('근거 구간에 날짜가 여럿이라 미상으로 처리');
  if (distinct[0].precision !== d.precision || distinct[0].value !== d.value) return unverified('근거 구간의 날짜와 주장한 발언일이 달라 미상으로 처리');
  return { date: d };
}

/**
 * 발언 1건을 현재 기사 본문 기준으로 다시 검증합니다. 원본을 바꾸지 않고 정리된 사본을 돌려줍니다(보류 시 null).
 * - 근거: 기사 존재·내용 해시 일치·구간이 본문에 실제로 있음. 같은 근거 중복 제거. 남은 근거가 없으면 보류
 * - 직접 인용: 말줄임 이어붙이기 금지, 근거 구간 한 곳에 그대로 있어야 함. 아니면 발언 전체 보류
 *   (요약으로 살리지 않음: 인용이 틀렸으면 함께 온 요약도 믿을 수 없음)
 * - 요약·번역·해석 문장(summaryKo)과 상황 설명(context.text)은 의미를 검증하지 않습니다. 화면은 기사 구간을 함께 보여줍니다.
 * - 발언일: validateSpokenDate 기준
 * - 당시 상황 근거: 발언 근거와 같은 기사 안의 구간만 인정
 * - 당시 직책: 재임 중/퇴임 후/취임 전/미상 상태를 함께 저장. 회사 역할이 없으면 보류
 */
export function validateStatement(input: CeoStatement, articles: Map<string, ArticleText>, roles: CeoRole[]): ValidatedStatement {
  const issues: StatementIssue[] = [];
  const s: CeoStatement = JSON.parse(JSON.stringify(input));

  const seen = new Set<string>();
  const valid: StatementEvidence[] = [];
  for (const ev of s.evidence || []) {
    const art = articles.get(ev.articleId);
    if (!art) { issues.push('evidence_article_missing'); continue; }
    if (art.contentHash !== ev.articleContentHash) { issues.push('evidence_hash_changed'); continue; }
    if (!contains(art.text, ev.excerpt)) { issues.push('evidence_excerpt_not_found'); continue; }
    const k = `${ev.articleId}::${normalizeForMatch(ev.excerpt)}`;
    if (seen.has(k)) { issues.push('evidence_duplicate'); continue; }
    seen.add(k);
    valid.push(ev);
  }
  if (valid.length === 0) return { statement: null, issues: [...issues, 'no_valid_evidence'] };
  s.evidence = valid;

  if (s.kind === 'direct_quote') {
    const q = s.quoteText || '';
    if (!q.trim() || hasEllipsisJoin(q)) return { statement: null, issues: [...issues, 'quote_ellipsis_join'] };
    if (!valid.some(ev => contains(ev.excerpt, q))) return { statement: null, issues: [...issues, 'quote_not_verbatim'] };
  } else {
    delete s.quoteText; delete s.quoteLanguage;
  }

  const evidenceIds = new Set(valid.map(e => e.articleId));
  const evidenceTexts = [...evidenceIds].map(id => articles.get(id)!.text);
  const d = validateSpokenDate(s.spokenAt, evidenceTexts);
  if (d.issue) issues.push(d.issue);
  s.spokenAt = d.date;

  if (s.context) {
    const srcOk = (s.context.sources || []).filter(src => evidenceIds.has(src.articleId) && contains(articles.get(src.articleId)!.text, src.excerpt));
    if (srcOk.length === 0) { issues.push('context_unsourced'); delete s.context; }
    else s.context.sources = srcOk;
  }

  // 원문 게시일 근거(선별 공식 페이지): 근거 구간이 본문에 있고, 거기서 읽은 날짜 하나가 게시일과 같아야 함. 아니면 게시일·근거 모두 버림
  for (const ev of s.evidence) {
    if (!ev.publishedAtBasis) continue;
    const text = articles.get(ev.articleId)!.text;
    const ds = extractAbsoluteDates(ev.publishedAtBasis.excerpt);
    const day = (ev.articlePublishedAt || '').slice(0, 10);
    if (!contains(text, ev.publishedAtBasis.excerpt) || ds.length !== 1 || ds[0].precision !== 'day' || ds[0].value !== day) {
      issues.push('published_basis_invalid');
      delete ev.publishedAtBasis;
      ev.articlePublishedAt = null;
    }
  }

  if (s.provenance) {
    const ok = s.provenance.filter(x => [...evidenceIds].some(id => contains(articles.get(id)!.text, x.excerpt)));
    if (ok.length !== s.provenance.length) issues.push('provenance_unsourced');
    // 선별 페이지 인용의 작성자·귀속 근거가 하나라도 본문에 없으면 발언 전체 보류(화자 귀속을 확인할 수 없음)
    if (ok.length !== s.provenance.length) return { statement: null, issues };
  }

  // 당시 직책: 발언일 기준. 발언일 미상이고 본인 작성글·발표문의 작성·게시일 근거가 확인되면 그 날짜 기준(화면에 '작성 당시'·'발표 당시'로 표시)
  let roleDate: PartialDate = s.spokenAt;
  let roleDateBasis: CeoStatement['roleDateBasis'] = 'spoken';
  const docEv = s.evidence.find(e => e.publishedAtBasis && e.articlePublishedAt);
  if (s.spokenAt.precision === 'unknown' && docEv && (s.sourceType === 'authored_post' || s.sourceType === 'press_release')) {
    roleDate = { value: docEv.articlePublishedAt!.slice(0, 10), precision: 'day', basisType: 'explicit_in_text', basisExcerpt: docEv.publishedAtBasis!.excerpt };
    roleDateBasis = s.sourceType === 'authored_post' ? 'written' : 'released';
  }
  const role = roleAtTime(s.personId, s.companyId, roleDate, roles);
  if (!role) return { statement: null, issues: [...issues, 'role_not_found'] };
  s.roleTitleAtTime = role.title;
  s.roleStatusAtTime = role.status;
  if (roleDateBasis !== 'spoken') s.roleDateBasis = roleDateBasis; else delete s.roleDateBasis;
  delete s.roleNoteAtTime;

  // 기준일(referenceDate): 발언일이 있으면 발언일(spoken),
  // 발언일 미상인 서면 공식 발표문(press_release)은 검증된 발표일(released),
  // 본인 작성글(authored_post)은 작성일(written).
  // 인터뷰/SEC 제출 문서는 실제 발언일이 확인되지 않으면 기준일로 삼지 않음.
  let refDate: CeoStatement['referenceDate'] | undefined;
  if (s.spokenAt && s.spokenAt.precision !== 'unknown' && s.spokenAt.value) {
    refDate = { value: s.spokenAt.value, precision: s.spokenAt.precision, basis: 'spoken' };
  } else if (docEv && s.sourceType === 'press_release' && docEv.publishedAtBasis?.kind === 'released' && docEv.articlePublishedAt) {
    refDate = { value: docEv.articlePublishedAt.slice(0, 10), precision: 'day', basis: 'released' };
  } else if (docEv && s.sourceType === 'authored_post' && docEv.publishedAtBasis?.kind === 'written' && docEv.articlePublishedAt) {
    refDate = { value: docEv.articlePublishedAt.slice(0, 10), precision: 'day', basis: 'written' };
  }
  if (refDate) s.referenceDate = refDate; else delete s.referenceDate;
  // CEO가 아닌 역할로 재임 중이고 같은 회사 CEO 역할이 그 뒤에 시작하면 'CEO 취임 전'을 덧붙임 (현재 직함 소급 금지)
  const ri = spokenInterval(roleDate);
  const sameCompany = roles.filter(r => r.personId === s.personId && r.companyId === s.companyId);
  const chosen = sameCompany.find(r => r.title === role.title);
  if (ri && role.status === 'current' && chosen && chosen.roleType !== 'ceo' && chosen.roleType !== 'co_ceo') {
    const laterCeo = sameCompany.filter(r => (r.roleType === 'ceo' || r.roleType === 'co_ceo') && (partialToInterval(r.start)?.[0] ?? -Infinity) >= ri[1])
      .sort((a, b) => (a.start < b.start ? -1 : 1))[0];
    if (laterCeo) s.roleNoteAtTime = `CEO 취임(${laterCeo.start}) 전`;
  }

  return { statement: s, issues };
}

/* v3: 자동 비교 판정 보호(guardComparison)와 판정 문구(VERDICT_LABEL)는 판정 기능 제거로 삭제 */

export const KIND_LABEL: Record<CeoStatement['kind'], string> = {
  direct_quote: '직접 인용',
  paraphrase: '기사 요약',
  translation: '번역 보도',
  interpretation: '기사 해석',
};

/** 같은 인용인지 (병합 판단용) */
export const sameQuote = (a?: string, b?: string) => !!a && !!b && normalizeQuote(a) === normalizeQuote(b);
