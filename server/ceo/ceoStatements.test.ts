/**
 * CEO 발언 모듈 테스트 (부분 검증: fixture 추출기·판정기, 모델·네트워크·DB 없음).
 * 실행: npx tsx server/ceo/ceoStatements.test.ts
 *
 * ceo3: 날짜 값 검증(N-D5)·직책 선택 수정(N-P7)·자동 판정 제거(N-J1)를 추가하고, 판정 관련 테스트(C1·C2·N-C4·K8·N-K9·N-K10·N-B2)는
 * 판정 기능 삭제로 폐기했습니다(대체: N-J1, UI N-U12).
 * ceo1 대비: 기존 28건의 ID를 유지하되 1차 검토에서 잘못된 기대값으로 지적된 항목(Q1·C1·M4 등)은 기대값을 고쳤고,
 * 검토 반례·정상 대조군은 N으로 시작하는 새 항목으로 추가했습니다.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CeoDataset, CeoPerson, CeoRole, CeoStatement, PartialDate } from '../../src/ceo/types';
import { certainOrder, extractAbsoluteDates, formatSpokenDate, isWellFormedPartialDate, partialToInterval, spokenInterval, statementReferenceDate, statementSortKey } from '../../src/ceo/dates';
import { coCeos, formatRoleAtTime, resolveSpeaker, roleAtTime } from '../../src/ceo/identity';
import { ArticleText, validateSpokenDate, validateStatement } from '../../src/ceo/validate';
import { mergeStatements } from '../../src/ceo/merge';
import { buildCeoView, pickComparison } from '../../src/ceo/view';
import { safeHttpUrl } from '../../src/ceo/text';
import {
  buildCeoDataset, CeoCacheState, contentHashOf, emptyCeoCache, MAX_EXTRACTION_ATTEMPTS,
  parseRawStatements, planExtraction, RawStatement, refreshCeoCache, SourceArticle,
} from './pipeline';
import {
  createFixtureExtractor, EXAMPLE_ARTICLES, EXAMPLE_PERSONS, EXAMPLE_RAW, EXAMPLE_ROLES, EXAMPLE_TOPICS,
} from './fixtures';
import { buildExampleDataset, renderExampleModule } from './generateExample';

const results: { name: string; ok: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e: any) { results.push({ name, ok: false, error: e?.stack || String(e) }); console.log(`FAIL ${name}\n  ${e?.message || e}`); }
}
const registry = { persons: EXAMPLE_PERSONS, roles: EXAMPLE_ROLES, topics: EXAMPLE_TOPICS };
/** 테스트 기사들에 들어 있는 절대 날짜 문구를 근거 구간으로 사용 (v3: 값이 근거 구간의 절대 날짜와 같아야 인정) */
const ko = (v: string) => { const [y, m, d] = v.split('-').map(Number); return d ? `${y}년 ${m}월 ${d}일` : m ? `${y}년 ${m}월` : `${y}년`; };
const EX = '2026년 3월 3일';
const day = (v: string, basisExcerpt = ko(v)): PartialDate => ({ value: v, precision: 'day', basisType: 'explicit_in_text', basis: 't', basisExcerpt });
const month = (v: string): PartialDate => ({ value: v, precision: 'month', basisType: 'explicit_in_text', basis: 't', basisExcerpt: EX });
const year = (v: string): PartialDate => ({ value: v, precision: 'year', basisType: 'explicit_in_text', basis: 't', basisExcerpt: EX });
const unknown: PartialDate = { value: null, precision: 'unknown', basisType: 'none' };

const DATE_LINE = ' 일정: 2024년 3월 3일. 2025년 1월 10일. 2026년 4월 1일.';
const ART: ArticleText = { articleId: 'x1', contentHash: 'h1', text: '홍길동 대표는 2026년 3월 3일 "가격을 올리지 않겠다"고 말했다. 그는 "공장은 내년에 짓는다"고 덧붙였다. 원자재 값이 올랐다. The weather was sunny.' + DATE_LINE };
const ART2: ArticleText = { articleId: 'x2', contentHash: 'h2', text: '홍길동 대표는 2026년 1월 10일 "가격을 올린다"고 밝혔다. 지난해 "가격을 올리지 않겠다"고 했던 것과 달라졌다. 날씨는 맑았다.' };
const ART3: ArticleText = { articleId: 'x3', contentHash: 'h3', text: '무관한 기사. The weather was sunny.' };
const ARTS = new Map([[ART.articleId, ART], [ART2.articleId, ART2], [ART3.articleId, ART3]]);
const ev = (articleId: string, excerpt: string) => ({ articleId, articleContentHash: ARTS.get(articleId)!.contentHash, sourceName: 'S', url: 'https://example.invalid/x', articlePublishedAt: '2026-03-04T00:00:00Z', excerpt });
function stmt(over: Partial<CeoStatement> = {}): CeoStatement {
  return {
    statementId: 's1', personId: 'ex-han-seoyun-mobility', companyId: 'ex-mobility', roleTitleAtTime: '', roleStatusAtTime: 'unknown', topicId: 't',
    spokenAt: day('2026-03-03'), kind: 'direct_quote', quoteText: '가격을 올리지 않겠다', quoteLanguage: 'ko', summaryKo: '가격 동결',
    evidence: [ev('x1', '"가격을 올리지 않겠다"고 말했다')],
    extractor: { name: 'f', version: '1', schemaVersion: 2 }, isExample: true, ...over,
  };
}
const fx = () => createFixtureExtractor();

async function main() {
  // ================================================================ 날짜
  await test('D1 부분 날짜 형식·근거: 잘못된 날짜 거부, 모든 정밀도(기간 포함)에 근거 유형·근거 구간 필수', () => {
    assert.deepStrictEqual(partialToInterval('2026-02'), [Date.UTC(2026, 1, 1), Date.UTC(2026, 2, 1)]);
    assert.strictEqual(partialToInterval('2026-02-30'), null);
    assert.strictEqual(partialToInterval('2026-13'), null);
    assert.ok(spokenInterval({ value: '2025-01', rangeEnd: '2025-03', precision: 'range', basisType: 'explicit_in_text' }));
    assert.strictEqual(isWellFormedPartialDate(unknown), true);
    assert.strictEqual(isWellFormedPartialDate({ value: '2026-03', precision: 'day', basisType: 'explicit_in_text', basisExcerpt: EX }), false, 'precision/format mismatch');
    assert.strictEqual(isWellFormedPartialDate({ value: '2026-03-03', precision: 'day', basisType: 'none', basisExcerpt: EX }), false, 'basis type none');
    assert.strictEqual(isWellFormedPartialDate({ value: '2020', rangeEnd: '2021', precision: 'range', basisType: 'none' }), false, 'range without basis (reviewer case)');
    assert.strictEqual(isWellFormedPartialDate({ value: '2024-01-01', precision: 'day', basisType: 'explicit_in_text' }), false, 'explicit claim without excerpt (reviewer case)');
    assert.strictEqual(isWellFormedPartialDate({ value: '2026-03-03', precision: 'day', basisType: 'inferred_from_article', basis: 'b', basisExcerpt: EX }), false, 'v3: inferred dates rejected');
    assert.strictEqual(isWellFormedPartialDate(day('2026-03-03')), true, 'positive control');
  });
  await test('D2 불확실한 날짜로 선후를 단정하지 않음 (연 단위 vs 같은 해 월 단위, 미상)', () => {
    assert.strictEqual(certainOrder(year('2025'), month('2025-02')), 0);
    assert.strictEqual(certainOrder(month('2025-02'), day('2025-03-01')), -1);
    assert.strictEqual(certainOrder(day('2025-03-01'), month('2025-02')), 1);
    assert.strictEqual(certainOrder(unknown, day('2025-03-01')), 0);
    assert.strictEqual(formatSpokenDate(unknown).text, '발언일 미상');
    assert.strictEqual(formatSpokenDate({ value: '2025-02', precision: 'month', basisType: 'inferred_from_article', basis: 'b', basisExcerpt: 'x' }).precisionLabel, '월 단위 · 추정');
  });
  await test('D3 기사일로 발언일을 채우지 않음: 발언일은 미상 유지, 확인된 게시일로 타임라인에 배치', () => {
    const v = validateStatement(stmt({ spokenAt: { value: '2026-03-04', precision: 'day', basisType: 'inferred_from_article', basis: '' } }), ARTS, EXAMPLE_ROLES);
    assert.ok(v.issues.includes('date_malformed'));
    assert.strictEqual(v.statement!.spokenAt.precision, 'unknown'); assert.strictEqual(v.statement!.spokenAt.value, null);
    assert.strictEqual(v.statement!.evidence[0].articlePublishedAt, '2026-03-04T00:00:00Z', 'article date kept separately');
    const ds = { schemaVersion: 2, isExample: true, persons: EXAMPLE_PERSONS, roles: EXAMPLE_ROLES, topics: [{ topicId: 't', label: 'T' }], statements: [v.statement!], comparisons: [], heldBackCount: 0, unavailableArticles: { pending: 0, failed: 0 } };
    const view = buildCeoView(ds, { personId: 'ex-han-seoyun-mobility', topicId: 't', sort: 'newest' });
    assert.strictEqual(view.dated.length, 1); assert.strictEqual(view.undated.length, 0);
    assert.strictEqual(view.dated[0].spokenAt.precision, 'unknown');
  });
  await test('N-D4 날짜 근거 구간이 발언 기사 본문에 없으면 미상 (다른 기사에만 있는 구간도 불인정), 있으면 유지(대조군)', () => {
    assert.strictEqual(validateSpokenDate(day('2026-03-03', '지난 20일'), [ART.text]).issue, 'date_basis_not_found');
    assert.strictEqual(validateSpokenDate(day('2026-01-10'), [ART.text]).date.precision, 'unknown', 'excerpt only in another article');
    assert.strictEqual(validateSpokenDate(day('2026-03-03'), [ART.text]).date.value, '2026-03-03');
    const r = validateSpokenDate({ value: '2025-01', rangeEnd: '2025-03', precision: 'range', basisType: 'explicit_in_text', basisExcerpt: '원자재 값이 올랐다' }, [ART.text]);
    assert.strictEqual(r.date.precision, 'unknown', 'v3: range excerpt without two absolute dates is unknown (ceo2 kept it)');
  });

  await test('N-D5 날짜 값 검증: 근거 구간의 절대 날짜가 정확히 하나이고 값·정밀도가 같을 때만 인정 (검토 반례 1970, 상대·불완전·복수·모순·존재하지 않는 날짜 → 미상), 정상 대조군', () => {
    const v = (d: PartialDate, ex: string) => validateSpokenDate(d, [`본문 ${ex} 끝`]).date;
    const D = (value: string, basisExcerpt: string): PartialDate => ({ value, precision: 'day', basisType: 'explicit_in_text', basisExcerpt });
    assert.strictEqual(v(D('1970-01-01', '2026-01-01 행사에서'), '2026-01-01 행사에서').precision, 'unknown', 'reviewer case: 2026 text vs 1970 value');
    assert.strictEqual(v(D('2026-01-01', '2026-01-01 행사에서'), '2026-01-01 행사에서').value, '2026-01-01', 'control ISO');
    assert.strictEqual(v(D('2026-03-14', '2026년 3월 14일 정기 주주총회에서'), '2026년 3월 14일 정기 주주총회에서').value, '2026-03-14', 'control Korean');
    assert.strictEqual(v(D('2026-01-20', 'said on Jan. 20, 2026'), 'said on Jan. 20, 2026').value, '2026-01-20', 'control English abbr');
    assert.strictEqual(v(D('2025-06-11', '11 June 2025'), '11 June 2025').value, '2025-06-11', 'control D Month YYYY');
    assert.strictEqual(v({ value: '2025-02', precision: 'month', basisType: 'explicit_in_text', basisExcerpt: '2025년 2월 간담회' }, '2025년 2월 간담회').value, '2025-02', 'control month');
    assert.strictEqual(v(D('2024-05-20', '지난 20일 행사에서'), '지난 20일 행사에서').precision, 'unknown', 'relative day');
    assert.strictEqual(v({ value: '2024-05-20', precision: 'day', basisType: 'inferred_from_article', basis: '+기사일', basisExcerpt: '지난 20일 행사에서' }, '지난 20일 행사에서').precision, 'unknown', 'inferred via article date');
    assert.strictEqual(v(D('2026-03-03', '3월 3일 행사에서'), '3월 3일 행사에서').precision, 'unknown', 'no year (incomplete)');
    assert.strictEqual(v(D('2026-03-03', '2026년 3월 3일과 2026년 3월 4일 행사'), '2026년 3월 3일과 2026년 3월 4일 행사').precision, 'unknown', 'multiple dates');
    assert.strictEqual(v(D('2026-03-03', '2026년 3월 행사'), '2026년 3월 행사').precision, 'unknown', 'precision mismatch');
    assert.strictEqual(v(D('2026-02-28', '2026년 2월 30일 행사'), '2026년 2월 30일 행사').precision, 'unknown', 'nonexistent date');
    assert.strictEqual(v(D('2026-01-01', 'on Monday'), 'on Monday').precision, 'unknown', 'weekday only');
    assert.strictEqual(v({ value: '2025-01', rangeEnd: '2025-03', precision: 'range', basisType: 'explicit_in_text', basisExcerpt: '2025년 1월부터 2025년 3월까지' }, '2025년 1월부터 2025년 3월까지').precision, 'range', 'control range');
    assert.strictEqual(v({ value: '2025-01', rangeEnd: '2025-04', precision: 'range', basisType: 'explicit_in_text', basisExcerpt: '2025년 1월부터 2025년 3월까지' }, '2025년 1월부터 2025년 3월까지').precision, 'unknown', 'range mismatch');
    assert.deepStrictEqual(extractAbsoluteDates('2026-01-01T23:30:00-08:00 기준'), [{ value: '2026-01-01', precision: 'day' }], 'date string as written (no timezone conversion)');
    assert.deepStrictEqual(extractAbsoluteDates('2026년 1월 1일').map(x => x.value), ['2026-01-01'], 'not double-counted as month/year');
  });

  // ================================================================ 인용·근거
  await test('Q1 직접 인용은 한 근거 구간에 그대로 있을 때만. 없는 말·말줄임 이어붙이기·두 구간 합치기는 발언 전체 보류 (요약으로 살리지 않음)', () => {
    assert.strictEqual(validateStatement(stmt(), ARTS, EXAMPLE_ROLES).statement!.kind, 'direct_quote', 'positive control');
    const fabricated = validateStatement(stmt({ quoteText: '가격을 절대 올리지 않겠다' }), ARTS, EXAMPLE_ROLES);
    assert.strictEqual(fabricated.statement, null); assert.ok(fabricated.issues.includes('quote_not_verbatim'));
    const joined = validateStatement(stmt({ quoteText: '가격을 올리지 않겠다… 공장은 내년에 짓는다' }), ARTS, EXAMPLE_ROLES);
    assert.strictEqual(joined.statement, null); assert.ok(joined.issues.includes('quote_ellipsis_join'));
    const twoExcerpts = stmt({ quoteText: '가격을 올리지 않겠다 공장은 내년에 짓는다', evidence: [ev('x1', '"가격을 올리지 않겠다"고 말했다'), ev('x1', '"공장은 내년에 짓는다"고 덧붙였다')] });
    assert.strictEqual(validateStatement(twoExcerpts, ARTS, EXAMPLE_ROLES).statement, null);
  });
  await test('N-Q4 틀린 인용 + 같은 허위 요약("가격 인상")은 보류되어 화면·비교에 남지 않음', () => {
    const v = validateStatement(stmt({ quoteText: '가격을 인상하겠다', summaryKo: '가격 인상' }), ARTS, EXAMPLE_ROLES);
    assert.strictEqual(v.statement, null);
  });
  await test('Q2 근거 재검증: 기사 없음·내용 해시 변경·본문에 없는 구간 제거, 중복 제거, 근거가 모두 없으면 보류', () => {
    const e = ev('x1', '"가격을 올리지 않겠다"고 말했다');
    const v = validateStatement(stmt({ evidence: [e, { ...e }, { ...e, articleId: 'gone' }, { ...e, articleContentHash: 'old' }, { ...e, excerpt: '지어낸 문장' }] }), ARTS, EXAMPLE_ROLES);
    assert.strictEqual(v.statement!.evidence.length, 1);
    for (const i of ['evidence_duplicate', 'evidence_article_missing', 'evidence_hash_changed', 'evidence_excerpt_not_found'] as const) assert.ok(v.issues.includes(i), i);
    const none = validateStatement(stmt({ evidence: [{ ...e, excerpt: '없는 문장' }] }), ARTS, EXAMPLE_ROLES);
    assert.strictEqual(none.statement, null); assert.ok(none.issues.includes('no_valid_evidence'));
  });
  await test('Q3 당시 상황 근거는 발언과 같은 기사 안의 실제 구간만 인정 (다른 기사·없는 문장 제거), 대조군 유지', () => {
    const ok = validateStatement(stmt({ context: { text: '원자재 가격 상승기', sources: [{ articleId: 'x1', excerpt: '원자재 값이 올랐다' }] } }), ARTS, EXAMPLE_ROLES);
    assert.ok(ok.statement!.context);
    const other = validateStatement(stmt({ context: { text: 'x', sources: [{ articleId: 'x3', excerpt: '무관한 기사' }] } }), ARTS, EXAMPLE_ROLES);
    assert.strictEqual(other.statement!.context, undefined); assert.ok(other.issues.includes('context_unsourced'));
    const bad = validateStatement(stmt({ context: { text: '경쟁사 인상 직후', sources: [{ articleId: 'x1', excerpt: '경쟁사가 값을 올렸다' }] } }), ARTS, EXAMPLE_ROLES);
    assert.strictEqual(bad.statement!.context, undefined);
  });

  // ================================================================ 인물
  await test('P1 동명이인: 회사로 구분, 회사 없으면 보류, 모르는 이름 보류', () => {
    assert.deepStrictEqual(resolveSpeaker({ name: '한서윤', companyId: 'ex-bio' }, day('2026-01-01'), EXAMPLE_PERSONS, EXAMPLE_ROLES), { status: 'resolved', personId: 'ex-han-seoyun-bio' });
    assert.deepStrictEqual(resolveSpeaker({ name: '한서윤', companyId: 'ex-mobility' }, day('2026-01-01'), EXAMPLE_PERSONS, EXAMPLE_ROLES), { status: 'resolved', personId: 'ex-han-seoyun-mobility' });
    assert.strictEqual(resolveSpeaker({ name: '한서윤' }, day('2026-01-01'), EXAMPLE_PERSONS, EXAMPLE_ROLES).status, 'unresolved');
    assert.strictEqual(resolveSpeaker({ name: '김없음', companyId: 'ex-bio' }, day('2026-01-01'), EXAMPLE_PERSONS, EXAMPLE_ROLES).status, 'unresolved');
    assert.strictEqual(resolveSpeaker({ name: '한서윤', companyId: 'ex-energy' }, day('2026-01-01'), EXAMPLE_PERSONS, EXAMPLE_ROLES).status, 'unresolved');
  });
  const kim = (rolesA: [string, string | null], rolesB: [string, string | null], typeB: CeoRole['roleType'] = 'ceo') => ({
    persons: [...EXAMPLE_PERSONS, { personId: 'ex-kim-a', displayName: '김예시', nameVariants: [], isExample: true }, { personId: 'ex-kim-b', displayName: '김예시', nameVariants: [], isExample: true }] as CeoPerson[],
    roles: [...EXAMPLE_ROLES,
      { personId: 'ex-kim-a', companyId: 'ex-x', companyName: 'X', title: 'CEO', roleType: 'ceo' as const, start: rolesA[0], end: rolesA[1] },
      { personId: 'ex-kim-b', companyId: 'ex-x', companyName: 'X', title: typeB === 'co_ceo' ? '공동대표' : 'CEO', roleType: typeB, start: rolesB[0], end: rolesB[1] }] as CeoRole[],
  });
  await test('P2 같은 회사의 같은 이름 두 사람: 발언 시점에 가능한 후보가 하나일 때만 확정, 미상이면 보류', () => {
    const r = kim(['2010-01', '2015-12'], ['2020-01', null]);
    assert.deepStrictEqual(resolveSpeaker({ name: '김예시', companyId: 'ex-x' }, day('2012-05-01'), r.persons, r.roles), { status: 'resolved', personId: 'ex-kim-a' });
    assert.deepStrictEqual(resolveSpeaker({ name: '김예시', companyId: 'ex-x' }, day('2022-05-01'), r.persons, r.roles), { status: 'resolved', personId: 'ex-kim-b' });
    assert.strictEqual(resolveSpeaker({ name: '김예시', companyId: 'ex-x' }, unknown, r.persons, r.roles).status, 'unresolved');
  });
  await test('N-P4 검토 반례: 근거 없는 날짜(basisType none)로 동명이인을 먼저 확정하지 않음 → 날짜 미상 → 인물 보류 (파이프라인 끝까지)', async () => {
    const r = kim(['2020-01', '2021-12'], ['2025-01', null]);
    const art: SourceArticle = { articleId: 'k1', title: '김예시 대표 발언', body: '김예시 대표는 2026년 1월 1일 "확장한다"고 말했다.', sourceName: 'S', url: 'https://example.invalid/k1', publishedAt: '2026-01-02T00:00:00Z' };
    const raw: RawStatement[] = [{ speaker: { name: '김예시', companyId: 'ex-x' }, topicId: 'capex', spokenAt: { value: '2026-01-01', precision: 'day', basisType: 'none' },
      kind: 'direct_quote', quoteText: '확장한다', quoteLanguage: 'ko', summaryKo: '확장', excerpts: ['"확장한다"고 말했다'] }];
    const ext = createFixtureExtractor({ raw: { k1: raw } });
    const { cache } = await refreshCeoCache([art], emptyCeoCache(), ext);
    const { dataset, report } = await buildCeoDataset([art], cache, { persons: r.persons, roles: r.roles, topics: EXAMPLE_TOPICS }, { extractor: ext });
    assert.strictEqual(dataset.statements.length, 0); assert.strictEqual(report.heldBackUnresolved, 1); assert.strictEqual(dataset.heldBackCount, 1);
    // 대조군: 근거 있는 날짜면 p2로 확정
    const rawOk: RawStatement[] = [{ ...raw[0], spokenAt: { value: '2026-01-01', precision: 'day', basisType: 'explicit_in_text', basis: 'b', basisExcerpt: '김예시 대표는 2026년 1월 1일' } }];
    const ext2 = createFixtureExtractor({ raw: { k1: rawOk }, version: '1.1' });
    const c2 = (await refreshCeoCache([art], cache, ext2)).cache;
    const d2 = (await buildCeoDataset([art], c2, { persons: r.persons, roles: r.roles, topics: EXAMPLE_TOPICS }, { extractor: ext2 })).dataset;
    assert.strictEqual(d2.statements[0]?.personId, 'ex-kim-b');
  });
  await test('N-P5 검토 반례: 연 단위 2026 발언, p1(2020~현재)·p2(2026-06~ 공동대표) 둘 다 가능 → 보류', () => {
    const r = kim(['2020-01', null], ['2026-06', null], 'co_ceo');
    const y: PartialDate = { value: '2026', precision: 'year', basisType: 'explicit_in_text', basis: 'b', basisExcerpt: 'x' };
    const res = resolveSpeaker({ name: '김예시', companyId: 'ex-x' }, y, r.persons, r.roles);
    assert.strictEqual(res.status, 'unresolved');
    assert.deepStrictEqual(resolveSpeaker({ name: '김예시', companyId: 'ex-x' }, day('2026-03-01'), r.persons, r.roles), { status: 'resolved', personId: 'ex-kim-a' }, 'day before p2 start → only p1 possible');
  });
  await test('P3 이직·퇴임 후·취임 전·시점 미확인 상태 보존과 화면 문구, 공동 CEO', () => {
    assert.strictEqual(roleAtTime('ex-oh-taemin', 'ex-mobility', day('2020-11-04'), EXAMPLE_ROLES)!.status, 'current');
    const former = roleAtTime('ex-oh-taemin', 'ex-mobility', day('2022-03-07'), EXAMPLE_ROLES)!;
    assert.strictEqual(former.status, 'former'); assert.strictEqual(formatRoleAtTime(former.status, former.title), '퇴임 후 발언 (전 대표이사(CEO))');
    assert.strictEqual(roleAtTime('ex-oh-taemin', 'ex-energy', day('2023-01-09'), EXAMPLE_ROLES)!.status, 'current');
    const before = roleAtTime('ex-oh-taemin', 'ex-energy', day('2021-01-09'), EXAMPLE_ROLES)!;
    assert.strictEqual(before.status, 'before'); assert.strictEqual(formatRoleAtTime(before.status, before.title), '취임 전 발언 (이후 대표이사(CEO))');
    assert.strictEqual(roleAtTime('ex-han-seoyun-bio', 'ex-bio', day('2024-03-01'), EXAMPLE_ROLES)!.title, '최고재무책임자(CFO)');
    assert.strictEqual(roleAtTime('ex-oh-taemin', 'ex-mobility', unknown, EXAMPLE_ROLES)!.status, 'unknown');
    assert.deepStrictEqual(coCeos('ex-mark-rivers', EXAMPLE_ROLES), ['ex-do-harin']);
  });
  await test('N-P6 검토 반례: CEO 취임 2025, 발언 2024 → 검증 후 statement에 before 보존 ("당시 CEO" 아님)', () => {
    const roles: CeoRole[] = [{ personId: 'ex-han-seoyun-mobility', companyId: 'ex-mobility', companyName: 'M', title: 'CEO', roleType: 'ceo', start: '2025-01', end: null }];
    const v = validateStatement(stmt({ spokenAt: day('2024-03-03') }), ARTS, roles).statement!;
    assert.strictEqual(v.roleStatusAtTime, 'before'); assert.strictEqual(v.roleTitleAtTime, 'CEO');
    assert.ok(!formatRoleAtTime(v.roleStatusAtTime, v.roleTitleAtTime).startsWith('당시'));
  });

  await test('N-P7 검토 반례 P2: 미래 역할을 과거 직책으로 고르지 않음 (CEO 2010–2015 / 의장 2020–2022), 재임 공백·취임 전·퇴임 후·겸직·불완전 날짜', () => {
    const roles: CeoRole[] = [
      { personId: 'p', companyId: 'c', companyName: 'C', title: 'CEO', roleType: 'ceo', start: '2010-01-01', end: '2015-12-31' },
      { personId: 'p', companyId: 'c', companyName: 'C', title: '의장', roleType: 'chair', start: '2020-01-01', end: '2022-12-31' },
    ];
    const at = (d: PartialDate) => { const r = roleAtTime('p', 'c', d, roles)!; return `${r.status}:${r.title}`; };
    assert.strictEqual(at(day('2018-01-01')), 'former:CEO', 'reviewer case (ceo2: former:의장)');
    assert.strictEqual(at(day('2021-06-01')), 'current:의장', 'control');
    assert.strictEqual(at(day('2009-06-01')), 'before:CEO');
    assert.strictEqual(at(day('2023-06-01')), 'former:의장');
    assert.strictEqual(at(day('2012-06-01')), 'current:CEO');
    assert.strictEqual(formatRoleAtTime('former', 'CEO'), '퇴임 후 발언 (전 CEO)');
    const overlap: CeoRole[] = [
      { personId: 'p', companyId: 'c', companyName: 'C', title: '의장', roleType: 'chair', start: '2015-01-01', end: '2025-12-31' },
      { personId: 'p', companyId: 'c', companyName: 'C', title: 'CEO', roleType: 'ceo', start: '2010-01-01', end: '2020-12-31' },
    ];
    assert.strictEqual(roleAtTime('p', 'c', day('2017-06-01'), overlap)!.title, 'CEO', 'concurrent roles: CEO first');
    const fuzzy: CeoRole[] = [{ personId: 'p', companyId: 'c', companyName: 'C', title: 'CEO', roleType: 'ceo', start: '2010', end: '2015' }];
    assert.strictEqual(roleAtTime('p', 'c', { value: '2015', precision: 'year', basisType: 'explicit_in_text', basisExcerpt: '2015년' }, fuzzy)!.status, 'current', 'year inside year-precision tenure');
    assert.strictEqual(roleAtTime('p', 'c', { value: '2015-06', precision: 'month', basisType: 'explicit_in_text', basisExcerpt: 'x' }, [{ ...fuzzy[0], end: '2015-06-15' }])!.status, 'unknown', 'month overlaps end day → unknown');
    assert.strictEqual(roleAtTime('p', 'c', unknown, roles)!.status, 'unknown');
  });

  // ================================================================ 병합
  const base = (id: string, over: Partial<CeoStatement>) => stmt({ statementId: id, ...over });
  await test('M1 같은 사건(eventKey)·같은 인용·같은 날짜·같은 회사의 다매체 보도만 근거를 합침, 근거 중복 제거 (대조군)', () => {
    const a = base('a', { eventKey: 'e1' });
    const b = base('b', { eventKey: 'e1', evidence: [ev('x2', '"가격을 올린다"고 밝혔다'), ev('x1', '"가격을 올리지 않겠다"고 말했다')] });
    const { statements, report } = mergeStatements([a, b]);
    assert.strictEqual(statements.length, 1); assert.strictEqual(statements[0].evidence.length, 2); assert.strictEqual(report.merged, 1);
  });
  await test('M2 같은 eventKey라도 다른 인용·다른 날짜·다른 회사·서로 다른 맥락이면 별개 발언', () => {
    const a = base('a', { eventKey: 'e1' });
    const b = base('b', { eventKey: 'e1', quoteText: '공장은 내년에 짓는다' });
    const c = base('c', { eventKey: 'e1', spokenAt: day('2026-04-01') });
    const d = base('d', { eventKey: 'e1', companyId: 'ex-other' });
    const e = base('e', { eventKey: 'e1', context: { text: 'x', sources: [{ articleId: 'x1', excerpt: '원자재 값이 올랐다' }] } });
    const f = base('f', { eventKey: 'e1', context: { text: 'y', sources: [{ articleId: 'x1', excerpt: 'The weather was sunny.' }] } });
    const { statements } = mergeStatements([a, b, c, d, e, f]);
    // e는 a에 합쳐짐(a는 맥락 없음 → e의 맥락을 가짐). f는 그 맥락과 달라 별개.
    assert.strictEqual(statements.length, 5, String(statements.length));
    assert.strictEqual(statements.find(s => s.statementId === 'a')!.context!.sources[0].excerpt, '원자재 값이 올랐다');
    assert.ok(statements.some(s => s.statementId === 'f'));
    for (const id of ['b', 'c', 'd']) assert.ok(statements.some(s => s.statementId === id), id);
  });
  await test('M3 eventKey 없으면 같은 인용이라도 합치지 않음 (검토 반례: 날짜 미상 서로 다른 회의의 "We will expand." 2건 → 2건, 각자 맥락 유지)', () => {
    const w = (id: string, ctx: string) => base(id, { quoteText: 'We will expand.', quoteLanguage: 'en', spokenAt: unknown,
      context: { text: ctx, sources: [{ articleId: 'x1', excerpt: ctx }] } });
    const { statements } = mergeStatements([w('a', '원자재 값이 올랐다'), w('b', 'The weather was sunny.')]);
    assert.strictEqual(statements.length, 2);
    assert.deepStrictEqual(statements.map(s => s.context!.sources[0].excerpt).sort(), ['The weather was sunny.', '원자재 값이 올랐다']);
    const para = mergeStatements([base('p', { kind: 'paraphrase', quoteText: undefined, eventKey: 'e9' }), base('q', { kind: 'paraphrase', quoteText: undefined, eventKey: 'e9' })]);
    assert.strictEqual(para.statements.length, 2, 'paraphrases are never merged (identity not verifiable)');
    // 날짜가 같고 인용도 같아도 eventKey가 없으면 (같은 날 다른 자리에서 반복했을 수 있으므로) 합치지 않음
    const sameDay = mergeStatements([base('r1', {}), base('r2', { evidence: [ev('x2', '"가격을 올린다"고 밝혔다')] })]);
    assert.strictEqual(sameDay.statements.length, 2);
  });
  await test('M4 같은 행사의 다른 언어 인용은 번역 동일성을 가정하지 않고 별개 발언 (ceo1 기대값 변경)', () => {
    const en = base('a', { eventKey: 'e1', quoteText: 'we will not raise prices', quoteLanguage: 'en' });
    const ko = base('b', { eventKey: 'e1' });
    assert.strictEqual(mergeStatements([en, ko]).statements.length, 2);
    const unk = mergeStatements([base('u1', { eventKey: 'e1', spokenAt: unknown }), base('u2', { eventKey: 'e1', spokenAt: unknown })]);
    assert.strictEqual(unk.statements.length, 2, 'both dates unknown → equivalence uncertain');
  });

  // ================================================================ 비교 판정
  const A = base('early', { topicId: 't', spokenAt: day('2025-01-10') });
  const B = base('late', { topicId: 't', spokenAt: day('2026-01-10'), quoteText: '가격을 올린다', evidence: [ev('x2', '"가격을 올린다"고 밝혔다')] });
  await test('C3 비교 쌍 선택 (ceo4 기대값 변경: 발언일로 못 정하면 발행일 기준 쌍을 쓰되 같은 날 발행·같은 기사·같은 인용은 비교 안 함)', () => {
    assert.ok(pickComparison([A]).reason!.includes('2건 미만'));
    // A·B 근거 기사의 발행일이 같은 날 → 발행일 기준 쌍도 만들지 않음 (같은 사건 재전송 가능성)
    assert.ok(pickComparison([A, { ...B, spokenAt: unknown }]).reason!.includes('서로 다른 날 발행된'));
    assert.ok(pickComparison([{ ...A, spokenAt: year('2026') }, B]).reason!.includes('서로 다른 날 발행된'));
    const spoken = pickComparison([B, A]).pair!;
    assert.strictEqual(spoken.earlier.statementId, 'early'); assert.strictEqual(spoken.basis, 'spoken');
    // 발언일 미상 + 서로 다른 날 발행된 다른 기사의 다른 인용 → 발행일 기준 쌍
    const pubA = { ...A, spokenAt: unknown, evidence: [{ ...A.evidence[0], articlePublishedAt: '2025-01-01T00:00:00Z' }] };
    const pubB = { ...B, spokenAt: unknown, evidence: [{ ...B.evidence[0], articlePublishedAt: '2026-01-01T00:00:00Z' }] };
    const pub = pickComparison([pubB, pubA]).pair!;
    assert.strictEqual(pub.basis, 'published'); assert.strictEqual(pub.earlier.statementId, 'early');
    // 같은 인용(재전송)은 서로 다른 날이어도 비교 안 함
    assert.strictEqual(pickComparison([pubA, { ...pubB, quoteText: A.quoteText }]).pair, null);
  });
  await test('C4 서면 공식 실적발표문 직접 인용(NVIDIA Q1/Q2 등): 발표일을 기준일(basis: released)로 사용하여 비교 쌍 형성 및 타임라인 배치, 실제 구두 발언일과 발표일은 별도 보존, 인터뷰 게시일은 발언일로 둔갑시키지 않음', () => {
    // 1) 서면 공식 발표문 인용 생성 (Q1 2025-05-28, Q2 2025-08-27)
    const artQ1: ArticleText = { articleId: 'nv-q1', contentHash: 'hq1', text: 'May 28, 2025\nNVIDIA Announces Financial Results for First Quarter Fiscal 2026\n"Global demand for AI infrastructure is incredibly strong," said Jensen Huang.\nAbout NVIDIA' };
    const artQ2: ArticleText = { articleId: 'nv-q2', contentHash: 'hq2', text: 'August 27, 2025\nNVIDIA Announces Financial Results for Second Quarter Fiscal 2026\n"The AI race is on, and Blackwell is the platform at its center," said Jensen Huang.\nAbout NVIDIA' };
    const artsMap = new Map([['nv-q1', artQ1], ['nv-q2', artQ2]]);
    const nvdaRoles: CeoRole[] = [{ personId: 'jensen-huang', companyId: 'nvda', companyName: 'NVIDIA', title: 'CEO', roleType: 'ceo', start: '1993', end: null }];

    const rawQ1: CeoStatement = {
      statementId: 'st_q1', personId: 'jensen-huang', companyId: 'nvda', roleTitleAtTime: '', roleStatusAtTime: 'unknown', topicId: 'AI 가속기 / 반도체',
      spokenAt: { value: null, precision: 'unknown', basisType: 'none', basis: '회사 발표문 안 인용 — 실제 발언일 미상' },
      kind: 'direct_quote', quoteText: 'Global demand for AI infrastructure is incredibly strong', quoteLanguage: 'en', summaryKo: '',
      evidence: [{
        articleId: 'nv-q1', articleContentHash: 'hq1', sourceName: 'NVIDIA 뉴스룸', url: 'https://nvidianews.nvidia.com/q1',
        articlePublishedAt: '2025-05-28T00:00:00.000Z', excerpt: '"Global demand for AI infrastructure is incredibly strong," said Jensen Huang',
        publishedAtBasis: { kind: 'released', excerpt: 'May 28, 2025', basis: '발표문에 표시된 게시일 ("May 28, 2025")' },
      }],
      sourceType: 'press_release', extractor: { name: 'f', version: '1', schemaVersion: 2 }, isExample: false,
    };
    const rawQ2: CeoStatement = {
      statementId: 'st_q2', personId: 'jensen-huang', companyId: 'nvda', roleTitleAtTime: '', roleStatusAtTime: 'unknown', topicId: 'AI 가속기 / 반도체',
      spokenAt: { value: null, precision: 'unknown', basisType: 'none', basis: '회사 발표문 안 인용 — 실제 발언일 미상' },
      kind: 'direct_quote', quoteText: 'The AI race is on, and Blackwell is the platform at its center', quoteLanguage: 'en', summaryKo: '',
      evidence: [{
        articleId: 'nv-q2', articleContentHash: 'hq2', sourceName: 'NVIDIA 뉴스룸', url: 'https://nvidianews.nvidia.com/q2',
        articlePublishedAt: '2025-08-27T00:00:00.000Z', excerpt: '"The AI race is on, and Blackwell is the platform at its center," said Jensen Huang',
        publishedAtBasis: { kind: 'released', excerpt: 'August 27, 2025', basis: '발표문에 표시된 게시일 ("August 27, 2025")' },
      }],
      sourceType: 'press_release', extractor: { name: 'f', version: '1', schemaVersion: 2 }, isExample: false,
    };

    const vQ1 = validateStatement(rawQ1, artsMap, nvdaRoles).statement!;
    const vQ2 = validateStatement(rawQ2, artsMap, nvdaRoles).statement!;
    assert.ok(vQ1 && vQ2);

    // 실제 구두 발언일은 unknown으로 보존
    assert.strictEqual(vQ1.spokenAt.precision, 'unknown');
    assert.strictEqual(vQ2.spokenAt.precision, 'unknown');
    // 검증된 발표일이 referenceDate로 설정됨
    assert.deepStrictEqual(vQ1.referenceDate, { value: '2025-05-28', precision: 'day', basis: 'released' });
    assert.deepStrictEqual(vQ2.referenceDate, { value: '2025-08-27', precision: 'day', basis: 'released' });
    assert.strictEqual(vQ1.roleDateBasis, 'released');

    // statementSortKey가 정상 산출되어 dated로 분류
    assert.ok(statementSortKey(vQ1) !== null);
    assert.ok(statementSortKey(vQ2) !== null);
    assert.ok(statementSortKey(vQ1)! < statementSortKey(vQ2)!);

    // pickComparison: basis 'released'로 두 발표문 직접 비교 쌍 형성
    const comp = pickComparison([vQ2, vQ1]);
    assert.strictEqual(comp.reason, null);
    assert.ok(comp.pair !== null);
    assert.strictEqual(comp.pair!.basis, 'released');
    assert.strictEqual(comp.pair!.earlier.statementId, 'st_q1');
    assert.strictEqual(comp.pair!.later.statementId, 'st_q2');

    // buildCeoView: dated에 2건 모두 포함, undated는 0건
    const mockDataset: CeoDataset = {
      schemaVersion: 2, isExample: false,
      persons: [{ personId: 'jensen-huang', displayName: '젠슨 황', nameVariants: ['Jensen Huang'], isExample: false }],
      roles: nvdaRoles, topics: [{ topicId: 'AI 가속기 / 반도체', label: 'AI 가속기 / 반도체' }],
      statements: [vQ1, vQ2], comparisons: [], heldBackCount: 0, unavailableArticles: { pending: 0, failed: 0 },
    };
    const view = buildCeoView(mockDataset, { personId: 'jensen-huang', topicId: 'AI 가속기 / 반도체', sort: 'oldest' });
    assert.strictEqual(view.dated.length, 2);
    assert.strictEqual(view.undated.length, 0);
    assert.strictEqual(view.dated[0].statementId, 'st_q1');
    assert.strictEqual(view.dated[1].statementId, 'st_q2');
    assert.strictEqual(view.comparison?.basis, 'released');

    // 2) 인터뷰/SEC 제출 문서는 게시일/제출일을 발언일이나 기준일로 둔갑시키지 않음
    const interviewStatement: CeoStatement = {
      statementId: 'st_interview', personId: 'elon-musk', companyId: 'spacex', roleTitleAtTime: 'CEO', roleStatusAtTime: 'current',
      topicId: 'Starship / 우주인프라',
      spokenAt: { value: null, precision: 'unknown', basisType: 'none', basis: '영상 게시일은 확인되었으나 실제 발언일 미상' },
      kind: 'direct_quote', quoteText: 'Yeah, now the AI satellite is actually much simpler than a Starlink satellite', quoteLanguage: 'en', summaryKo: '',
      evidence: [{
        articleId: 'sec-fwp', articleContentHash: 'hsec', sourceName: 'SEC EDGAR', url: 'https://www.sec.gov/fwp',
        articlePublishedAt: '2026-06-08T00:00:00.000Z', excerpt: 'interview transcript',
      }],
      sourceType: 'filed_transcript', extractor: { name: 'f', version: '1', schemaVersion: 2 }, isExample: false,
    };
    assert.strictEqual(statementReferenceDate(interviewStatement), null, '인터뷰는 게시일을 기준일로 삼지 않음');
    assert.strictEqual(statementSortKey(interviewStatement), null);
  });

  // ================================================================ 캐시
  const extractorCalls: string[] = [];
  const run = async (articles: SourceArticle[], cache = emptyCeoCache(), opts: Parameters<typeof createFixtureExtractor>[0] = {}, max?: number) =>
    refreshCeoCache(articles, cache, createFixtureExtractor({ calls: extractorCalls, ...opts }), { maxExtractions: max });

  await test('K1 처음엔 전부 추출, 다시 실행하면 0건 (같은 내용·같은 추출기·같은 스키마)', async () => {
    extractorCalls.length = 0;
    const r1 = await run(EXAMPLE_ARTICLES);
    assert.strictEqual(r1.report.extracted.length, EXAMPLE_ARTICLES.length);
    extractorCalls.length = 0;
    const r2 = await run(EXAMPLE_ARTICLES, r1.cache);
    assert.strictEqual(extractorCalls.length, 0); assert.strictEqual(r2.report.plan.reuse.length, EXAMPLE_ARTICLES.length);
  });
  await test('K2 수정된 기사만 다시 추출, 사라진 근거 구간의 발언은 빠짐', async () => {
    const { cache } = await run(EXAMPLE_ARTICLES);
    const edited = EXAMPLE_ARTICLES.map(a => a.articleId === 'ex-a5' ? { ...a, body: a.body.replace(' 요금과 관련해서는 "구독 요금은 당분간 동결한다"고 했다.', '') } : a);
    extractorCalls.length = 0;
    const r = await run(edited, cache);
    assert.deepStrictEqual(extractorCalls, ['ex-a5']);
    const { dataset } = await buildCeoDataset(edited, r.cache, registry, { extractor: fx() });
    assert.ok(!dataset.statements.some(s => s.topicId === 'pricing'));
    assert.ok(dataset.statements.some(s => s.quoteText === '올해는 운행 지역을 두 곳 더 늘린다'));
  });
  await test('K3 추출기·스키마 버전 변경은 재추출 계획 + (검토 반례) 상한 0으로 미뤄져도 옛 결과를 표시하지 않고 대기 수로 표시', async () => {
    const { cache } = await run(EXAMPLE_ARTICLES);
    const p = planExtraction(EXAMPLE_ARTICLES, cache, { name: 'fixture-extractor', version: '2.0' });
    assert.ok(p.toExtract.every(x => x.reason === 'extractor_changed'));
    const v2 = createFixtureExtractor({ version: '2.0' });
    const deferred = await refreshCeoCache(EXAMPLE_ARTICLES, cache, v2, { maxExtractions: 0 });
    assert.strictEqual(deferred.report.deferred.length, EXAMPLE_ARTICLES.length);
    const b = await buildCeoDataset(EXAMPLE_ARTICLES, deferred.cache, registry, { extractor: v2 });
    assert.strictEqual(b.dataset.statements.length, 0);
    assert.strictEqual(b.report.staleEntries.length, EXAMPLE_ARTICLES.length);
    assert.deepStrictEqual(b.dataset.unavailableArticles, { pending: EXAMPLE_ARTICLES.length, failed: 0 });
    const old: CeoCacheState = JSON.parse(JSON.stringify(cache)); old.entries['ex-a1'].schemaVersion = 0;
    assert.deepStrictEqual(planExtraction(EXAMPLE_ARTICLES, old, fx()).toExtract, [{ articleId: 'ex-a1', reason: 'schema_changed' }]);
    const b0 = await buildCeoDataset(EXAMPLE_ARTICLES, old, registry, { extractor: fx() });
    assert.ok(!b0.dataset.statements.some(s => s.evidence.some(e => e.articleId === 'ex-a1')), 'schema 0 entry not shown');
    assert.strictEqual(b0.dataset.unavailableArticles.pending, 1);
    const ok = await buildCeoDataset(EXAMPLE_ARTICLES, cache, registry, { extractor: fx() });
    assert.ok(ok.dataset.statements.length > 0, 'positive control: unchanged inputs reused');
  });
  await test('K4 삭제된 기사: 캐시에서 제거, 그 기사만 근거였던 발언은 사라지고 합쳐진 발언은 근거 1건 줄어듦', async () => {
    const { cache } = await run(EXAMPLE_ARTICLES);
    const full = (await buildCeoDataset(EXAMPLE_ARTICLES, cache, registry, { extractor: fx() })).dataset;
    assert.strictEqual(full.statements.find(s => s.quoteText?.startsWith('상용화 시점'))!.evidence.length, 2);
    const without = EXAMPLE_ARTICLES.filter(a => a.articleId !== 'ex-a5' && a.articleId !== 'ex-c3');
    const r = await run(without, cache);
    assert.deepStrictEqual(r.report.plan.removed.sort(), ['ex-a5', 'ex-c3']);
    const ds = (await buildCeoDataset(without, r.cache, registry, { extractor: fx() })).dataset;
    assert.strictEqual(ds.statements.find(s => s.quoteText?.startsWith('상용화 시점'))!.evidence.length, 1);
    assert.ok(!ds.statements.some(s => s.quoteText === '배터리 공장 증설은 수요를 확인한 뒤 결정한다'));
  });
  await test('K5 부분 실패: 실패한 기사만 failed(표시 안 함·수만 표시), 나머지 정상. 재시도, 최대 횟수 후 중단, 내용이 바뀌면 다시 시도', async () => {
    const fail = new Set(['ex-a4']);
    let r = await run(EXAMPLE_ARTICLES, emptyCeoCache(), { failOn: fail });
    assert.deepStrictEqual(r.report.failed.map(f => f.articleId), ['ex-a4']);
    const b = await buildCeoDataset(EXAMPLE_ARTICLES, r.cache, registry, { extractor: fx() });
    assert.strictEqual(b.dataset.unavailableArticles.failed, 1);
    assert.strictEqual(b.dataset.statements.find(s => s.quoteText?.startsWith('상용화 시점'))!.evidence.length, 1, 'still shown via ex-a5');
    for (let i = 1; i < MAX_EXTRACTION_ATTEMPTS; i++) r = await run(EXAMPLE_ARTICLES, r.cache, { failOn: fail });
    assert.strictEqual(r.cache.entries['ex-a4'].attempts, MAX_EXTRACTION_ATTEMPTS);
    extractorCalls.length = 0;
    r = await run(EXAMPLE_ARTICLES, r.cache, { failOn: fail });
    assert.deepStrictEqual(r.report.plan.gaveUp, ['ex-a4']); assert.strictEqual(extractorCalls.length, 0);
    const changed = EXAMPLE_ARTICLES.map(a => a.articleId === 'ex-a4' ? { ...a, body: a.body + ' (수정)' } : a);
    r = await run(changed, r.cache);
    assert.strictEqual(r.cache.entries['ex-a4'].status, 'ok'); assert.strictEqual(r.cache.entries['ex-a4'].attempts, 1);
  });
  await test('K6 호출 상한: 넘는 기사는 미루고(표시 안 함·대기 수) 다음 실행에서 처리', async () => {
    const r1 = await run(EXAMPLE_ARTICLES, emptyCeoCache(), {}, 5);
    assert.strictEqual(r1.report.extracted.length, 5);
    const b = await buildCeoDataset(EXAMPLE_ARTICLES, r1.cache, registry, { extractor: fx() });
    assert.strictEqual(b.dataset.unavailableArticles.pending, EXAMPLE_ARTICLES.length - 5);
    const r2 = await run(EXAMPLE_ARTICLES, r1.cache);
    assert.strictEqual(r2.report.extracted.length, EXAMPLE_ARTICLES.length - 5);
  });
  await test('K7 캐시가 현재 기사와 어긋나면(재추출 전) 그 결과를 쓰지 않음', async () => {
    const { cache } = await run(EXAMPLE_ARTICLES);
    const edited = EXAMPLE_ARTICLES.map(a => a.articleId === 'ex-c1' ? { ...a, body: '오태민 대표는 4일 별다른 언급을 하지 않았다.' } : a);
    const { report, dataset } = await buildCeoDataset(edited, cache, registry, { extractor: fx() });
    assert.deepStrictEqual(report.staleEntries, ['ex-c1']);
    assert.ok(!dataset.statements.some(s => s.quoteText === '자율주행은 10년 뒤의 이야기'));
  });

  await test('N-J1 자동 비교 판정 미생산: build는 comparisons를 항상 빈 배열로, 이전 버전 캐시의 판정 캐시도 버림', async () => {
    const { cache } = await run(EXAMPLE_ARTICLES);
    const legacy: any = { ...JSON.parse(JSON.stringify(cache)), comparisons: { k: { judgeName: 'j', judgeVersion: '1', status: 'ok', result: { verdict: 'stance_change', rationale: 'r', rationaleEvidence: [] } } } };
    const b = await buildCeoDataset(EXAMPLE_ARTICLES, legacy, registry, { extractor: fx() });
    assert.deepStrictEqual(b.dataset.comparisons, []);
    assert.strictEqual((b.cache as any).comparisons, undefined);
    assert.ok(b.dataset.statements.length > 0);
  });

  // ================================================================ 입력 경계
  await test('N-B1 추출기 출력 경계: 배열 아님 → 그 기사만 실패, 형식 틀린 항목만 버림, 등록 안 된 주제 보류, 전체 조립은 정상', async () => {
    assert.strictEqual(parseRawStatements({ not: 'array' }), null);
    const good = EXAMPLE_RAW['ex-c1'][0];
    const parsed = parseRawStatements([good, { ...good, kind: 'shout' }, { ...good, excerpts: [] }, { ...good, spokenAt: { precision: 'week', basisType: 'none' } }, null, 3, { ...good, speaker: { name: 5 } }])!;
    assert.strictEqual(parsed.items.length, 1); assert.strictEqual(parsed.dropped, 6);
    const ext = createFixtureExtractor({ outputs: { 'ex-c1': { oops: true }, 'ex-c3': [{ ...EXAMPLE_RAW['ex-c3'][0], topicId: 'no-such-topic' }], 'ex-d2': [EXAMPLE_RAW['ex-d2'][0], { bad: 1 }] } });
    const r = await refreshCeoCache(EXAMPLE_ARTICLES, emptyCeoCache(), ext);
    assert.deepStrictEqual(r.report.failed.map(f => f.articleId), ['ex-c1']);
    assert.strictEqual(r.report.droppedMalformed['ex-d2'], 1);
    const b = await buildCeoDataset(EXAMPLE_ARTICLES, r.cache, registry, { extractor: ext });
    assert.strictEqual(b.dataset.unavailableArticles.failed, 1); assert.strictEqual(b.report.issues.topic_unknown, 1);
    assert.ok(b.dataset.statements.length > 10, 'rest of build intact');
    // 캐시가 손상돼 raw가 배열이 아니어도 조립이 깨지지 않음
    const broken: CeoCacheState = JSON.parse(JSON.stringify(r.cache)); (broken.entries['ex-a1'] as any).raw = 'corrupt';
    const bb = await buildCeoDataset(EXAMPLE_ARTICLES, broken, registry, { extractor: ext });
    assert.ok(bb.dataset.statements.length > 0); assert.strictEqual(bb.dataset.unavailableArticles.failed, 2);
  });
  await test('N-B3 원문 URL은 http/https만: javascript:·data:·상대경로는 빈 값(링크 없음)', async () => {
    assert.strictEqual(safeHttpUrl('javascript:alert(1)'), null); assert.strictEqual(safeHttpUrl('data:text/html,x'), null);
    assert.strictEqual(safeHttpUrl('/relative'), null); assert.strictEqual(safeHttpUrl('https://a.example/x'), 'https://a.example/x');
    const arts = EXAMPLE_ARTICLES.map(a => a.articleId === 'ex-c1' ? { ...a, url: 'javascript:alert(1)' } : a);
    const { cache } = await refreshCeoCache(arts, emptyCeoCache(), fx());
    const ds = (await buildCeoDataset(arts, cache, registry, { extractor: fx() })).dataset;
    assert.strictEqual(ds.statements.find(s => s.quoteText === '자율주행은 10년 뒤의 이야기')!.evidence[0].url, '');
  });

  // ================================================================ 예시 데이터
  await test('X1 예시 데이터셋: 보류 2건(동명이인 미구분, 이어붙인 인용), 자동 판정 0건, 상대 날짜 발언은 미상, 퇴임 후·취임 전 상태 보존', async () => {
    const ds = await buildExampleDataset();
    assert.strictEqual(ds.heldBackCount, 2);
    assert.ok(!ds.statements.some(s => s.quoteText?.includes('협업이 답')));
    assert.ok(!ds.statements.some(s => s.summaryKo.includes('전력 확보')), 'joined quote held, not shown as summary');
    assert.strictEqual(ds.comparisons.length, 0);
    assert.strictEqual(ds.statements.find(s => s.summaryKo.startsWith('규제 승인'))!.spokenAt.precision, 'unknown', '"이달 열린" relative date stays unknown');
    assert.strictEqual(ds.statements.find(s => s.quoteText === '자율주행 상용화는 생각보다 빨리 온다')!.roleStatusAtTime, 'former');
    assert.strictEqual(ds.statements.find(s => s.quoteText === '에너지 저장 사업에 집중하겠다')!.roleStatusAtTime, 'before');
    assert.strictEqual(ds.statements.filter(s => s.spokenAt.value === '2024-05-20').length, 2, 'ko/en reports of the same event kept separate');
  });
  await test('X2 예시 데이터는 전부 가상으로 표시(isExample), 링크는 연결 안 되는 example.invalid만', async () => {
    const ds = await buildExampleDataset();
    assert.strictEqual(ds.isExample, true);
    assert.ok(ds.persons.every(p => p.isExample)); assert.ok(ds.statements.every(s => s.isExample));
    assert.ok(ds.statements.every(s => s.evidence.every(e => e.url.startsWith('https://example.invalid/'))));
  });
  await test('X3 화면용 예시 파일(src/ceo/exampleDataset.ts)이 생성기 출력과 같음', async () => {
    const file = fs.readFileSync(path.join(process.env.CEO_SRC_ROOT || process.cwd(), 'src/ceo/exampleDataset.ts'), 'utf8');
    assert.strictEqual(file, renderExampleModule(await buildExampleDataset()));
  });
  await test('X4 내용 해시: 공백 차이는 같은 내용, 글자 변경은 다른 내용', () => {
    const a = EXAMPLE_ARTICLES[0];
    assert.strictEqual(contentHashOf(a), contentHashOf({ ...a, body: a.body.replace(/ /g, '  ') }));
    assert.notStrictEqual(contentHashOf(a), contentHashOf({ ...a, body: a.body + '.' }));
  });

  // 새 독립 수집 검증: 아래 원문과 인용은 모두 합성입니다. 외부 요청·모델·DB 호출 없음.
  const D = await import('./officialSource');
  const R = await import('./registry');
  const RT = await import('./runtime');
  const ST = await import('./stateStore');
  const dnow = Date.parse('2026-10-22T00:00:00Z');
  const dp = D.DISCOVERY_PROVIDERS.find(p => p.id === 'tesla')!;
  const np = D.DISCOVERY_PROVIDERS.find(p => p.id === 'nvidia')!;
  const synthetic = (name = 'Elon Musk', date = '2025-01-10', extra = '') => `<html><head><meta property="article:published_time" content="${date}T12:00:00Z"></head><body><article><h1>Fictional energy announcement</h1><p>${date}</p><p>Fictional company statement describing an imagined product for a deterministic unit test.</p><p>“Battery storage will transform the entire energy system,” said ${name}, chief executive officer.</p><p>“Solar power can support growing sustainable energy demand,” said ${name}, chief executive officer.</p>${extra}</article></body></html>`;
  const durl = 'https://ir.tesla.com/press-release/fictional-unit-test';
  const darticle = () => D.discoveredArticle(dp, durl, synthetic(), dnow)!;
  await test('DISC1 등록된 공식 호스트·경로만 허용: 외부 링크·userinfo·포트·PDF·회사 혼입 거부', () => {
    assert.ok(D.discoveryArticleAllowed(dp, durl));
    for (const u of ['https://evil.invalid/press-release/x','https://ir.tesla.com.evil.invalid/press-release/x','https://fixture@example.invalid/press-release/x','https://ir.tesla.com:444/press-release/x','https://ir.tesla.com/press-release/x.pdf','https://ir.tesla.com/corporate/elon-musk']) assert.ok(!D.discoveryArticleAllowed(dp,u),u);
    const index = D.parseDiscoveryIndex(dp, `<a href="${durl}">real path</a><a href="https://evil.invalid/press-release/x">bad</a><a href="?page=1">next</a>`,dp.index);
    assert.strictEqual(index.articles.length,1); assert.deepStrictEqual(index.indexes,[dp.index+'?page=1']);
  });
  await test('DISC2 사이트맵 lastmod를 발행일로 쓰지 않음, 수정일만·상충 게시일·미래 게시일 거부', () => {
    assert.strictEqual(D.discoveryPublishedAt('<meta property="article:modified_time" content="2025-01-10">'),null);
    assert.strictEqual(D.discoveryPublishedAt('<script type="application/ld+json">{"@type":"NewsArticle","dateModified":"2025-01-10"}</script>'),null);
    assert.strictEqual(D.discoveryPublishedAt('<meta property="article:published_time" content="2025-01-10"><script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2025-02-10"}</script>'),null);
    assert.strictEqual(D.discoveredArticle(dp,durl,synthetic('Elon Musk','2028-01-10'),dnow),null);
  });
  await test('DISC3 기존 뉴스·지정 인용 없이 Tesla 원문 1개에서 복수 직접 인용, 회사 분리·원문 검증·날짜 근거 유지',async()=>{
    const a=darticle(); assert.ok(a);
    const rows=await D.extractDiscoveredQuotes(a); assert.strictEqual(rows.length,2);assert.ok(rows.every(r=>r.speaker.companyId==='tsla'&&r.spokenAt.precision==='unknown'));
    const ex=RT.createCompositeExtractor(R.CEO_PERSONS,[],[]);const c=await refreshCeoCache([a],emptyCeoCache(),ex);const built=await buildCeoDataset([a],c.cache,{persons:R.CEO_PERSONS,roles:R.CEO_ROLES,topics:R.CEO_TOPICS},{extractor:ex});
    assert.strictEqual(built.dataset.statements.length,2);assert.ok(built.dataset.statements.every(s=>s.companyId==='tsla'&&s.referenceDate?.basis==='released'));
    assert.strictEqual(buildCeoView(built.dataset,{personId:'elon-musk',companyId:'spacex',sort:'newest'}).dated.length,0);
  });
  await test('DISC4 전체 이름 귀속 없으면 0건, 타사 SpaceX 문맥을 Tesla에 넣지 않음',async()=>{
    assert.strictEqual((await D.extractDiscoveredQuotes({...darticle(),body:darticle().body.replaceAll('Elon Musk','Jane Example')})).length,0);
    assert.strictEqual((await D.extractDiscoveredQuotes({...darticle(),body:darticle().body.replaceAll('Battery storage','SpaceX battery storage').replaceAll('Solar power','SpaceX solar power')})).length,0);
  });
  await test('DISC5 3년 기본·비교 부족 주제만 5년 확장, 같은 날 두 인용은 비교 자료 두 개로 세지 않음',async()=>{
    const make=(date:string)=>({fetchText:async(u:string)=>u===dp.index?`<a href="${durl}">doc</a>`:synthetic('Elon Musk',date),parseFeed:async()=>[],now:()=>dnow,deadline:dnow+120000,existing:[] as CeoStatement[],providers:[dp]});
    assert.strictEqual((await D.loadDiscoveredArticles(make('2022-01-10'))).articles.length,1);
    assert.strictEqual((await D.loadDiscoveredArticles(make('2020-01-10'))).articles.length,0);
    const evidence=(date:string)=>({...stmt(),companyId:'tsla',topicId:'에너지 / 배터리',spokenAt:unknown,evidence:[{...ev('x1','a'),articlePublishedAt:date+'T00:00:00Z'}]});
    const one=make('2022-01-10');one.existing=[evidence('2025-01-01'),evidence('2025-01-01')];assert.strictEqual((await D.loadDiscoveredArticles(one)).articles.length,1);
    const two=make('2022-01-10');two.existing=[evidence('2025-01-01'),evidence('2025-02-01')];assert.strictEqual((await D.loadDiscoveredArticles(two)).articles.length,0);
  });
  await test('DISC6 처리 위치를 저장하여 다음 갱신에서 나머지를 읽고, 성공 원문을 다시 요청하지 않음',async()=>{
    const urls=Array.from({length:4},(_,i)=>durl+i),calls:string[]=[];
    const opts={fetchText:async(u:string)=>{calls.push(u);return u===dp.index?urls.map(u=>`<a href="${u}">doc</a>`).join(''):synthetic();},parseFeed:async()=>[],now:()=>dnow,deadline:dnow+120000,existing:[],providers:[dp]};
    const first=await D.loadDiscoveredArticles(opts);assert.strictEqual(first.articles.length,3);assert.strictEqual(first.state.streams.tesla.pending.length,1);
    calls.length=0;const second=await D.loadDiscoveredArticles({...opts,previous:first.state});assert.strictEqual(second.articles.length,1);assert.deepStrictEqual(calls,[urls[3]]);assert.strictEqual(first.state.streams.tesla.pending.length,1,'input checkpoint is immutable');
  });
  await test('DISC7 403이면 해당 스트림 중단·자동 재시도 없음, 다른 회사 수집은 계속',async()=>{
    const calls:string[]=[];const r=await D.loadDiscoveredArticles({fetchText:async(u:string)=>{calls.push(u);if(u===dp.index)return `<a href="${durl}">doc</a><a href="${durl}2">doc2</a>`;if(u.startsWith('https://ir.tesla.com/press-release/'))throw Object.assign(new Error('HTTP 403'),{httpStatus:403});if(u===np.index)return '<urlset><url><loc>https://nvidianews.nvidia.com/news/fictional-test</loc></url></urlset>';return synthetic('Jensen Huang');},parseFeed:async()=>[],now:()=>dnow,deadline:dnow+120000,existing:[],providers:[dp,np]});
    assert.strictEqual(calls.filter(u=>u.startsWith(durl)).length,1);assert.ok(r.reports.find(x=>x.feedUrl===dp.index)?.error?.includes('403'));assert.strictEqual(r.articles.length,1);assert.strictEqual(r.articles[0].discoveryCompanyId,'nvda');
  });
  await test('DISC8 전체 기한의 저장 여유를 침범하지 않음',async()=>{
    let calls=0;await D.loadDiscoveredArticles({fetchText:async()=>{calls++;throw Error('unexpected');},parseFeed:async()=>[],now:()=>dnow,deadline:dnow+10000,existing:[],providers:[dp]});assert.strictEqual(calls,0);
  });
  await test('DISC9 공시 목록의 time과 같은 행 단일 HTML 링크를 대조해 SEC 제출일 확보, 이미지 전사는 범용 추출 거부',()=>{
    const sp=D.DISCOVERY_PROVIDERS.find(p=>p.id==='tesla-sec')!;
    const u='https://www.sec.gov/Archives/edgar/data/1318605/000000000026000001/doc.htm';
    const index=`<div class="quarterly-disclosures__quarterly-disclosure row"><time datetime="2025-01-10T12:00:00Z">Jan 10</time><a href="${u}">HTML</a></div>`;
    assert.strictEqual(D.parseDiscoveryIndex(sp,index,sp.index).articles[0].filedAt,'2025-01-10');
    assert.strictEqual(D.discoveredArticle(sp,u,synthetic()+'<img src="page.jpg"><font style="font-size:1pt;color:white">OCR</font>',dnow,'2025-01-10'),null);
    assert.strictEqual(D.discoveredArticle(sp,u,synthetic().replace('2025-01-10T12:00:00Z','bad'),dnow,'2025-01-10')?.publishedAt,'2025-01-10T00:00:00.000Z');
  });
  await test('DISC10 공식 본인 작성글은 작성자 확인 후 복수 문단, 다른 CEO의 혼합 발언문은 보류',async()=>{
    const mp=D.DISCOVERY_PROVIDERS.find(p=>p.id==='microsoft')!,url='https://blogs.microsoft.com/blog/2025/01/10/fictional-test/';
    const paragraph='We are building an imagined platform that enables every developer to create reliable artificial intelligence applications with clear control and accountability.';
    const html=`<meta property="article:published_time" content="2025-01-10"><article><h1>Fictional written communication</h1><p>Jan 10, 2025</p><p>Satya Nadella, Chairman and CEO, shared the below communication with Microsoft employees this morning.</p><p>${paragraph}</p><p>${paragraph.replace('building','designing')}</p></article>`;
    const a=D.discoveredArticle(mp,url,html,dnow)!;assert.strictEqual((await D.extractDiscoveredQuotes(a)).length,2);
    const mixed={...a,body:a.body+'\nJENSEN HUANG MESSAGE\n'+paragraph};assert.strictEqual((await D.extractDiscoveredQuotes(mixed)).length,0);
  });
  await test('DISC11 영속 payload에 탐색 checkpoint 저장·복원, 기존 payload와도 호환',()=>{
    const discovery={version:1 as const,streams:{tesla:{pending:[{url:durl}],indexes:[],checked:{},updatedAt:dnow}}};
    const encoded=ST.encodePayload({records:[],cache:emptyCeoCache(),discovery},1);const head={...ST.emptyHead(),revision:1,chunkIds:encoded.chunks.map(c=>ST.chunkId(1,c.index)),totalBytes:encoded.totalBytes,payloadSha256:encoded.sha256};
    assert.deepStrictEqual(ST.decodePayload(head,encoded.chunks)?.discovery,discovery);
  });
  await test('DISC12 SEC 제출일 기준으로 일반 날짜순 목록에 배치하되 실제 발언일은 미상 유지',()=>{
    const s={...stmt(),spokenAt:unknown,sourceType:'filed_transcript' as const,evidence:[{...ev('x1','a'),url:'https://www.sec.gov/Archives/edgar/data/1181412/000162828026041761/fwp_cfointerview.htm',articlePublishedAt:null}]};
    const ds={schemaVersion:2,isExample:true,persons:EXAMPLE_PERSONS,roles:EXAMPLE_ROLES,topics:[{topicId:'t',label:'T'}],statements:[s],comparisons:[],heldBackCount:0,unavailableArticles:{pending:0,failed:0}};
    const v=buildCeoView(ds,{personId:s.personId,companyId:s.companyId,sort:'newest'});assert.strictEqual(v.dated.length,1);assert.strictEqual(v.undated.length,0);assert.strictEqual(v.dated[0].spokenAt.precision,'unknown');
  });

  await test('DISC13 뉴스룸 추천 카드가 본문보다 앞에 있어도 실제 h1 본문·날짜 요소를 선택',async()=>{
    const h=synthetic('Jensen Huang').replace('<meta property="article:published_time" content="2025-01-10T12:00:00Z">','').replace('<article>','<div class="article-date">January 10, 2025</div><article>').replace('<body>','<body><article><p>Unrelated recommended article</p></article>');
    const a=D.discoveredArticle(np,'https://nvidianews.nvidia.com/news/fictional-test',h,dnow)!;assert.ok(a);assert.strictEqual(a.publishedAt,'2025-01-10T00:00:00.000Z');assert.strictEqual((await D.extractDiscoveredQuotes(a)).length,2);
  });
  await test('DISC14 제한 시간에 도달하면 다음 회사부터 재개하여 특정 회사 독점 방지',async()=>{
    let t=dnow;const calls:string[]=[];const opts={fetchText:async(u:string)=>{calls.push(u);t+=10000;if(u===dp.index)return Array.from({length:4},(_,i)=>`<a href="${durl+i}">doc</a>`).join('');if(u===np.index)return '<urlset><url><loc>https://nvidianews.nvidia.com/news/fictional-test</loc></url></urlset>';return synthetic(u.includes('nvidia')?'Jensen Huang':'Elon Musk');},parseFeed:async()=>[],now:()=>t,deadline:t+120000,existing:[],providers:[dp,np]};
    const first=await D.loadDiscoveredArticles(opts);assert.strictEqual(first.state.nextProvider,1);calls.length=0;await D.loadDiscoveredArticles({...opts,previous:first.state,deadline:t+120000});assert.ok(calls[0].startsWith('https://nvidianews.nvidia.com/'));
  });
  await test('DISC15 손상·외부 URL checkpoint는 요청하지 않음',async()=>{
    const calls:string[]=[];await D.loadDiscoveredArticles({fetchText:async(u:string)=>{calls.push(u);return '';},parseFeed:async()=>[],now:()=>dnow,deadline:dnow+120000,existing:[],providers:[dp],previous:{version:1,streams:{tesla:{pending:[{url:'http://127.0.0.1/private'}],indexes:['https://evil.invalid/x'],checked:{},updatedAt:dnow}}}});assert.deepStrictEqual(calls,[]);
  });
  await test('DISC16 실제 runtime→추출→이력→checkpoint 저장·재시작 GET, 기존 뉴스가 없어도 신규 발언 저장',async()=>{
    const backend=new ST.MemoryStateBackend(),store=new ST.MemoryStateStore(backend);let calls=0;
    const fetchText=async(u:string)=>{calls++;if(u===np.index)return '<urlset><url><loc>https://nvidianews.nvidia.com/news/fictional-test</loc></url></urlset>';if(u==='https://nvidianews.nvidia.com/news/fictional-test')return synthetic('Jensen Huang');throw Error('synthetic unavailable');};
    const mk=()=>new RT.CeoRuntime({getEvents:()=>[],getStore:()=>store,fetchText,parseFeed:async()=>[],transcripts:[],pages:[],discovery:true,now:()=>dnow,minIntervalMs:0,headCacheMs:0});
    const first=await mk().refresh();assert.ok(first.accepted);assert.strictEqual(first.response.dataset!.statements.length,2);assert.ok((await store.readState())!.payload.discovery?.streams.nvidia);
    const before=calls;const snapshot=await mk().snapshot();assert.strictEqual(calls,before);assert.strictEqual(snapshot.dataset!.statements.length,2);assert.ok(snapshot.dataset!.statements.every(s=>s.companyId==='nvda'));
  });

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  for (const f of failed) console.log(`--- ${f.name}\n${f.error}`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
