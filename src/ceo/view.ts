import { CeoDataset, CeoPerson, CeoRole, CeoStatement, CeoTopic } from './types';
import { documentPublishedAt, certainOrder, partialToInterval, statementReferenceDate, statementSortKey, timelineSortKey } from './dates';
import { coCeos, currentOrLatestRole } from './identity';
import { sameQuote } from './validate';

export type SortOrder = 'newest' | 'oldest';

export interface PersonSummary {
  person: CeoPerson;
  companyId: string | null;
  role: CeoRole | null;
  /** 현직이 아니면 true (전직 CEO) */
  isFormer: boolean;
  coCeoNames: string[];
  statementCount: number;
}

export interface TopicSummary { topic: CeoTopic; count: number }

export interface ComparisonPair {
  earlier: CeoStatement;
  later: CeoStatement;
  /** spoken: 발언일 선후가 확실 / released: 공식 발표일 기준 / published: 발언일을 확정할 수 없어 기사 발행일 순서로만 배치 (발언일 미확인) */
  basis: 'spoken' | 'released' | 'written' | 'published';
}

export interface CeoViewModel {
  persons: PersonSummary[];
  selectedPersonId: string | null;
  selectedCompanyId: string | null;
  topics: TopicSummary[];
  selectedTopicId: string | null;
  /** 발언일을 아는 발언 (정렬됨) */
  dated: CeoStatement[];
  /** 발언일 미상 (기사일 순으로만 나열, 비교·선후 판단에는 쓰지 않음) */
  undated: CeoStatement[];
  comparison: ComparisonPair | null;
  /** 비교 카드를 못 만드는 이유 */
  comparisonUnavailableReason: string | null;
}

export function summarizePersons(ds: CeoDataset): PersonSummary[] {
  return ds.persons.flatMap(person => {
    const companyIds = [...new Set([
      ...ds.roles.filter(r => r.personId === person.personId).map(r => r.companyId),
      ...ds.statements.filter(s => s.personId === person.personId).map(s => s.companyId),
    ])];
    return (companyIds.length ? companyIds : [null]).map(companyId => {
      const roles = ds.roles.filter(r => r.companyId === companyId);
      const role = currentOrLatestRole(person.personId, roles);
      return {
        person, companyId, role,
        isFormer: !!role && role.end !== null,
        coCeoNames: coCeos(person.personId, roles).map(id => ds.persons.find(p => p.personId === id)?.displayName || id),
        statementCount: ds.statements.filter(s => s.personId === person.personId && s.companyId === companyId).length,
      };
    });
  }).sort((a, b) => b.statementCount - a.statementCount || a.person.displayName.localeCompare(b.person.displayName, 'ko') || (a.companyId || '').localeCompare(b.companyId || ''));

}

const articleTime = (s: CeoStatement) => {
  const t = Math.max(...s.evidence.map(e => Date.parse(documentPublishedAt(e) || '') || 0));
  return Number.isFinite(t) ? t : 0;
};
/** 화면 정렬은 발언일을 우선하고, 없으면 확인된 작성·발표·게시·제출일을 사용합니다. */
const recordTime = (s: CeoStatement) => statementSortKey(s) ?? (articleTime(s) || null);

/**
 * 비교 쌍 (자동 판정 없음, dataset.comparisons는 쓰지 않음)
 * 1) 발언일 선후가 확실한 가장 이른·가장 늦은 발언 (basis: spoken)
 * 2) 없으면 기사 발행일 순서의 가장 이른·가장 늦은 발언 (basis: published, 화면에 '발언일 미확인' 표시)
 *    단, 같은 기사·같은 인용·같은 날 발행(같은 사건 재전송 가능성)은 비교하지 않음
 */
export function pickComparison(statements: CeoStatement[]): { pair: ComparisonPair | null; reason: string | null } {
  if (statements.length < 2) return { pair: null, reason: '이 주제의 발언이 2건 미만이라 비교할 수 없습니다.' };
  // 같은 시점이 여럿이면 근거 기사가 많은 쪽 → 한국어 인용 → ID 순 (표시 우선순위일 뿐, 같은 발언으로 보지 않음)
  const koFirst = (x: CeoStatement) => (x.quoteLanguage && x.quoteLanguage !== 'ko' ? 1 : 0);
  const dated = statements.filter(s => statementSortKey(s) !== null).sort((a, b) => statementSortKey(a)! - statementSortKey(b)!
    || b.evidence.length - a.evidence.length || koFirst(a) - koFirst(b) || a.statementId.localeCompare(b.statementId));
  for (let i = 0; i < dated.length; i++) {
    const earlier = dated[i];
    const earlierRef = statementReferenceDate(earlier)!;
    const earlierInterval = partialToInterval(earlierRef.value);
    if (!earlierInterval) continue;

    const later = dated.filter(l => {
      const lRef = statementReferenceDate(l);
      if (!lRef) return false;
      const lInterval = partialToInterval(lRef.value);
      if (!lInterval) return false;
      return earlierInterval[1] <= lInterval[0];
    }).sort((a, b) => statementSortKey(b)! - statementSortKey(a)!
      || b.evidence.length - a.evidence.length || a.statementId.localeCompare(b.statementId))[0];

    if (later) {
      const laterRef = statementReferenceDate(later)!;
      const basis = (earlierRef.basis === 'spoken' && laterRef.basis === 'spoken') ? 'spoken' : (earlierRef.basis === 'written' && laterRef.basis === 'written') ? 'written' : 'released';
      return { pair: { earlier, later, basis }, reason: null };
    }
  }
  const DAY = 86_400_000;
  const byPub = statements.filter(s => articleTime(s) > 0).sort((a, b) => articleTime(a) - articleTime(b) || a.statementId.localeCompare(b.statementId));
  const articlesOf = (s: CeoStatement) => new Set(s.evidence.map(e => e.articleId));
  for (let i = 0; i < byPub.length; i++) {
    const earlier = byPub[i];
    const later = [...byPub].reverse().find(l => l !== earlier && articleTime(l) - articleTime(earlier) >= DAY
      && ![...articlesOf(l)].some(id => articlesOf(earlier).has(id)) && !sameQuote(l.quoteText, earlier.quoteText));
    if (later) return { pair: { earlier, later, basis: 'published' }, reason: null };
  }
  return { pair: null, reason: '서로 다른 날 발행된 기사의 서로 다른 발언이 2건 미만이라 비교할 수 없습니다.' };
}

export function buildCeoView(ds: CeoDataset, sel: { personId?: string | null; companyId?: string | null; topicId?: string | null; sort: SortOrder }): CeoViewModel {
  const persons = summarizePersons(ds);
  const selected = persons.find(p => p.person.personId === sel.personId && p.companyId === sel.companyId)
    || persons.find(p => p.person.personId === sel.personId) || persons[0];
  const selectedPersonId = selected?.person.personId ?? null;
  const selectedCompanyId = selected?.companyId ?? null;
  const mine = ds.statements.filter(s => s.personId === selectedPersonId && s.companyId === selectedCompanyId);
  const topics = ds.topics
    .map(topic => ({ topic, count: mine.filter(s => s.topicId === topic.topicId).length }))
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count);
  const selectedTopicId = sel.topicId && topics.some(t => t.topic.topicId === sel.topicId) ? sel.topicId : topics[0]?.topic.topicId ?? null;
  const inTopic = mine.filter(s => s.topicId === selectedTopicId);
  const dir = sel.sort === 'newest' ? -1 : 1;
  const dated = inTopic.filter(s => recordTime(s) !== null)
    .sort((a, b) => dir * (recordTime(a)! - recordTime(b)!) || dir * a.statementId.localeCompare(b.statementId));
  const undated = inTopic.filter(s => recordTime(s) === null)
    .sort((a, b) => dir * (articleTime(a) - articleTime(b)) || dir * a.statementId.localeCompare(b.statementId));
  const { pair, reason } = selectedTopicId ? pickComparison(inTopic) : { pair: null, reason: null };
  return { persons, selectedPersonId, selectedCompanyId, topics, selectedTopicId, dated, undated, comparison: pair, comparisonUnavailableReason: reason };
}
