/**
 * CEO 발언 이력 (검증된 발언의 확인 이력). 최신 피드 창에서 빠진 기사를 '삭제'로 보지 않기 위한 최소 계약.
 *
 * 상태 전이 (갱신 1회 기준):
 * - 원문을 이번에 읽었고 같은 발언이 다시 확인됨 → verified (lastVerifiedAt 갱신)
 * - 원문을 이번에 읽었는데 발언이 더 이상 확인되지 않음(본문 변경·인용 삭제) → withdrawn (표시 안 함)
 * - 출처를 직접 요청했는데 404/410 → source_removed (표시 안 함)
 * - 원문을 이번에 읽지 못함(피드 창 밖으로 밀림, 피드 실패, 이벤트 목록에서 빠짐) → not_rechecked (마지막 확인 시각과 함께 표시)
 *
 * 저장: stateStore.ts(CeoStateStore)가 이 기록과 추출 캐시를 함께 한 판으로 원자적으로 저장합니다(Firestore 'ceo_statement_history').
 */
import { CeoStatement } from '../../src/ceo/types';
import { normalizeForMatch, normalizeQuote, shortHash } from '../../src/ceo/text';

export type HistoryStatus = 'verified' | 'not_rechecked' | 'withdrawn' | 'source_removed';

export interface HistoryRecord {
  key: string;
  articleId: string;
  statement: CeoStatement;
  status: HistoryStatus;
  firstVerifiedAt: string;
  lastVerifiedAt: string;
  lastCheckedAt: string;
  reason?: string;
}

/**
 * 발언 식별: 원문(기사 ID) + 인물 + 정규화 인용(없으면 요약) + 발언일(값·정밀도) + 근거 구간(귀속 문구 포함, 정규화).
 * - 다른 인물·다른 날짜·다른 귀속 구간의 같은 문장은 다른 발언(서로 덮지 않음)
 * - 근거 구간은 발언 주변 문장뿐이라, 기사 다른 부분(앞머리 등)이 바뀌어도 키는 그대로(불필요한 새 발언·철회 없음)
 * - 저장된 기록의 키는 항상 기록 안의 발언 내용으로 다시 계산 → 키 규칙이 바뀌어도 이전 기록과 이어짐(별도 이전 작업 없음)
 */
export const statementKey = (s: CeoStatement) =>
  shortHash([
    s.evidence.map(e => e.articleId).sort().join(','),
    s.personId,
    normalizeQuote(s.quoteText || s.summaryKo),
    `${s.spokenAt.precision}:${s.spokenAt.value ?? ''}:${s.spokenAt.rangeEnd ?? ''}`,
    s.evidence.map(e => normalizeForMatch(e.excerpt)).sort().join('||'),
    (s.context?.sources || []).map(c => normalizeForMatch(c.excerpt)).sort().join('||'),
  ].join('|'));

/**
 * 같은 기본 키가 여러 번 나오면(원문에 문장·귀속·문맥까지 똑같은 발생이 실제로 여러 번) 등장 순서 번호를 붙여 각각 보존.
 * 기본 키가 하나뿐이면 번호 없음(기존 키와 같음).
 */
function occurrenceKeys<T>(items: T[], baseOf: (x: T) => string): string[] {
  const seen = new Map<string, number>();
  return items.map(x => {
    const b = baseOf(x);
    const n = (seen.get(b) || 0) + 1;
    seen.set(b, n);
    return n === 1 ? b : `${b}#${n}`;
  });
}

export interface ReconcileInput {
  previous: HistoryRecord[];
  /** 이번 갱신에서 원문으로 검증된 발언 */
  current: CeoStatement[];
  /** 이번 갱신에서 실제로 본문을 읽은 기사 ID */
  readArticleIds: Set<string>;
  /** 이번 갱신에서 404/410으로 확인된 기사 ID */
  removedArticleIds: Set<string>;
  now: string;
}

export function reconcileHistory(input: ReconcileInput): HistoryRecord[] {
  const out = new Map<string, HistoryRecord>();
  // 저장된 기록의 키를 현재 규칙으로 다시 계산(키 규칙 변경 전 기록도 같은 발언이면 이어짐)
  const prevKeys = occurrenceKeys(input.previous, r => statementKey(r.statement));
  const previous = input.previous.map((r, i) => ({ ...r, key: prevKeys[i] }));
  const prevByKey = new Map(previous.map(r => [r.key, r] as const));
  const curKeys = occurrenceKeys(input.current, statementKey);
  for (const [i, s] of input.current.entries()) {
    const key = curKeys[i];
    const prev = prevByKey.get(key);
    out.set(key, {
      key, articleId: s.evidence[0].articleId, statement: s, status: 'verified',
      firstVerifiedAt: prev && prev.status !== 'withdrawn' && prev.status !== 'source_removed' ? prev.firstVerifiedAt : input.now,
      lastVerifiedAt: input.now, lastCheckedAt: input.now,
    });
  }
  for (const r of previous) {
    if (out.has(r.key)) continue;
    if (r.status === 'withdrawn' || r.status === 'source_removed') { out.set(r.key, r); continue; }
    const ids = r.statement.evidence.map(e => e.articleId);
    if (ids.some(id => input.removedArticleIds.has(id))) {
      out.set(r.key, { ...r, status: 'source_removed', lastCheckedAt: input.now, reason: '출처가 404/410으로 삭제 확인' });
    } else if (ids.some(id => input.readArticleIds.has(id))) {
      out.set(r.key, { ...r, status: 'withdrawn', lastCheckedAt: input.now, reason: '원문을 다시 읽었으나 발언이 확인되지 않음(본문 변경·인용 삭제)' });
    } else {
      out.set(r.key, { ...r, status: 'not_rechecked', reason: '이번 갱신에서 원문을 다시 읽지 못함(피드 범위 밖·피드 실패)' });
    }
  }
  return [...out.values()];
}

/** 화면에 보일 발언: verified + not_rechecked (확인 이력 포함) */
export function visibleStatements(records: HistoryRecord[]): CeoStatement[] {
  return records.filter(r => r.status === 'verified' || r.status === 'not_rechecked').map(r => ({
    ...r.statement,
    verification: { status: r.status as 'verified' | 'not_rechecked', firstVerifiedAt: r.firstVerifiedAt, lastVerifiedAt: r.lastVerifiedAt },
  }));
}
