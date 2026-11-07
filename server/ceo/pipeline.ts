/**
 * CEO 발언 추출 캐시·데이터셋 조립 (독립 모듈).
 *
 * 현재 상태: fixture 추출기·판정기로만 실행합니다. 모델 호출·운영 DB 읽기/쓰기·수집 파이프라인 연결은 없습니다.
 * 기존 collector/scheduler/일일 완료/dedup/Telegram 경로에 붙이지 않습니다(연결 조건은 별도 문서).
 *
 * 캐시 키: 기사 ID + 기사 내용 해시 + 추출기 이름·버전 + 스키마 버전.
 * 새 기사, 내용이 바뀐 기사, 추출기/스키마가 바뀐 기사, 이전 실패(최대 시도 미만)만 다시 추출합니다.
 */
import crypto from 'node:crypto';
import {
  CEO_SCHEMA_VERSION, CeoComparison, CeoDataset, CeoPerson, CeoRole, CeoStatement, CeoTopic, PartialDate, StatementEvidence, StatementKind,
  StatementProvenance, StatementReferenceDate,
} from '../../src/ceo/types';
import { resolveSpeaker, SpeakerMention } from '../../src/ceo/identity';
import { ArticleText, StatementIssue, validateSpokenDate, validateStatement } from '../../src/ceo/validate';
import { mergeStatements, MergeReport } from '../../src/ceo/merge';
import { tenureRelation } from '../../src/ceo/dates';
import { shortHash, normalizeForMatch, safeHttpUrl } from '../../src/ceo/text';

export interface SourceArticle {
  articleId: string;
  title: string;
  body: string;
  sourceName: string;
  url: string;
  publishedAt: string | null;
  /** 기존 기사 분류(이벤트 category) — 주제 묶음 기준. 의미 판정 아님 */
  topicId?: string;
  /** 이 원문과 연결된 기존 이벤트 ID (기존 기사 재사용 근거) */
  eventId?: string;
  /** feed: 기존 기사와 같은 URL의 공식 피드 본문 / transcript: 선별된 공식 IR 행사 기록 / page: 선별 공식 페이지 */
  sourceKind?: 'feed' | 'transcript' | 'page' | 'sec' | 'discovered';
  discoveryCompanyId?: string;
  discoveryPersonId?: string;
  discoveryTopics?: string[];
  /** 본문과 분리된 공식 바이라인 또는 단일 화자 발언문 확인 근거 */
  discoveryAuthor?: { name: string; excerpt: string };
  /** 본인 채널 글(사이트 전체가 본인 글) */
  discoveryAuthored?: boolean;
  transcriptId?: string;
  pageId?: string;
  /** sec: SEC 제출 문서 검증 항목 ID (secExhibits.ts) */
  secId?: string;
  /** publishedAt의 본문 근거 (선별 공식 페이지에서 확인된 경우만) */
  publishedAtBasis?: StatementEvidence['publishedAtBasis'];
}

/** 추출기가 기사 1건에서 내놓는 발언 (인물은 아직 이름 수준) */
export interface RawStatement {
  speaker: SpeakerMention;
  topicId: string;
  spokenAt: PartialDate;
  kind: StatementKind;
  quoteText?: string;
  quoteLanguage?: string;
  summaryKo: string;
  /** 이 기사 본문에서 그대로 옮긴 근거 구간 */
  excerpts: string[];
  context?: { text: string; excerpts: string[] };
  eventKey?: string;
  /** 선별 공식 페이지 종류와 작성자·귀속·연결 근거 */
  sourceType?: 'call_remarks' | 'authored_post' | 'press_release' | 'filed_transcript';
  provenance?: StatementProvenance[];
  /** 기준일 (서면 공식 발표문 등) */
  referenceDate?: StatementReferenceDate;
}

export interface StatementExtractor {
  name: string;
  version: string;
  extract(article: SourceArticle): Promise<RawStatement[]>;
}

export interface ExtractionCacheEntry {
  articleId: string;
  contentHash: string;
  extractorName: string;
  extractorVersion: string;
  schemaVersion: number;
  status: 'ok' | 'failed';
  raw: RawStatement[];
  error?: string;
  attempts: number;
  extractedAt: string;
}

export interface CeoCacheState {
  entries: Record<string, ExtractionCacheEntry>;
}

/** v3: 자동 비교 판정(입장 변경 등)은 의미를 검증할 수 없어 생산하지 않음. 판정 캐시도 두지 않음 */
export const emptyCeoCache = (): CeoCacheState => ({ entries: {} });
export const MAX_EXTRACTION_ATTEMPTS = 3;

/**
 * 추출 캐시·근거 검증용 본문 해시. 파서가 줄(단락·목록 항목·화자 라벨) 경계에 의존하므로 줄 구조를 보존해 정규화합니다
 * (각 줄 안의 공백·따옴표 모양만 normalizeForMatch로 정리, 빈 줄 제거). 줄 경계가 바뀌면 해시가 바뀌어 다시 추출됩니다.
 * 'L2:' 접두 = 규칙 버전 (이전 규칙 해시와 섞이지 않음 → 배포 뒤 첫 갱신에서 1회 재추출, 모델 호출 없음).
 * 이력 키·statementId·번역 입력 해시는 본문 해시를 쓰지 않으므로 의미가 같으면 그대로입니다.
 */
export function structuralText(s: string): string {
  return (s || '').split(/\r?\n/).map(normalizeForMatch).filter(Boolean).join('\n');
}
export function contentHashOf(a: Pick<SourceArticle, 'title' | 'body'>): string {
  return crypto.createHash('sha256').update(`L2:${structuralText(a.title)}\n\u0000${structuralText(a.body)}`, 'utf8').digest('hex');
}

export type ExtractReason = 'new' | 'content_changed' | 'extractor_changed' | 'schema_changed' | 'retry_failed';

export interface ExtractionPlan {
  toExtract: { articleId: string; reason: ExtractReason }[];
  reuse: string[];
  /** 기사 목록에서 사라진 캐시 (삭제된 기사 → 그 발언·근거 무효) */
  removed: string[];
  /** 최대 시도 횟수에 도달해 내용/버전이 바뀌기 전까지 다시 시도하지 않는 기사 */
  gaveUp: string[];
}

export function planExtraction(articles: SourceArticle[], cache: CeoCacheState, extractor: Pick<StatementExtractor, 'name' | 'version'>): ExtractionPlan {
  const plan: ExtractionPlan = { toExtract: [], reuse: [], removed: [], gaveUp: [] };
  const ids = new Set<string>();
  for (const a of articles) {
    ids.add(a.articleId);
    const e = cache.entries[a.articleId];
    const h = contentHashOf(a);
    if (!e) plan.toExtract.push({ articleId: a.articleId, reason: 'new' });
    else if (e.contentHash !== h) plan.toExtract.push({ articleId: a.articleId, reason: 'content_changed' });
    else if (e.schemaVersion !== CEO_SCHEMA_VERSION) plan.toExtract.push({ articleId: a.articleId, reason: 'schema_changed' });
    else if (e.extractorName !== extractor.name || e.extractorVersion !== extractor.version) plan.toExtract.push({ articleId: a.articleId, reason: 'extractor_changed' });
    else if (e.status === 'failed') {
      if (e.attempts < MAX_EXTRACTION_ATTEMPTS) plan.toExtract.push({ articleId: a.articleId, reason: 'retry_failed' });
      else plan.gaveUp.push(a.articleId);
    } else plan.reuse.push(a.articleId);
  }
  for (const id of Object.keys(cache.entries)) if (!ids.has(id)) plan.removed.push(id);
  return plan;
}

export interface RefreshReport {
  plan: ExtractionPlan;
  extracted: string[];
  failed: { articleId: string; error: string }[];
  /** 호출 상한으로 이번에 미룬 기사 (다음 실행에서 다시 계획됨). 미룬 기사의 옛 결과는 build에서 표시하지 않음 */
  deferred: string[];
  /** 추출 결과 중 형식이 맞지 않아 버린 항목 수 (기사별) */
  droppedMalformed: Record<string, number>;
}

const SOURCE_TYPES = new Set(['call_remarks', 'authored_post', 'press_release', 'filed_transcript']);
const STATEMENT_KINDS = new Set(['direct_quote', 'paraphrase', 'translation', 'interpretation']);
const PRECISIONS = new Set(['day', 'month', 'year', 'range', 'unknown']);
const BASIS_TYPES = new Set(['explicit_in_text', 'inferred_from_article', 'none']);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isOptStr = (v: unknown) => v === undefined || v === null || typeof v === 'string';
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x.trim().length > 0);

/**
 * 추출기 출력 경계 검사. 배열이 아니면 null(추출 실패로 처리). 형식이 틀린 항목은 버리고 수를 셉니다.
 * 한 기사의 잘못된 출력이 전체 조립을 깨지 않게 합니다. 주제 ID의 등록 여부는 조립 시(등록부 기준) 확인합니다.
 */
export function parseRawStatements(x: unknown): { items: RawStatement[]; dropped: number } | null {
  if (!Array.isArray(x)) return null;
  const items: RawStatement[] = [];
  let dropped = 0;
  for (const r of x as any[]) {
    const ok = r && typeof r === 'object'
      && r.speaker && typeof r.speaker === 'object' && isStr(r.speaker.name) && r.speaker.name.trim() && isOptStr(r.speaker.companyId)
      && isStr(r.topicId) && r.topicId.trim()
      && r.spokenAt && typeof r.spokenAt === 'object' && PRECISIONS.has(r.spokenAt.precision) && BASIS_TYPES.has(r.spokenAt.basisType)
      && isOptStr(r.spokenAt.value) && isOptStr(r.spokenAt.rangeEnd) && isOptStr(r.spokenAt.basis) && isOptStr(r.spokenAt.basisExcerpt)
      && STATEMENT_KINDS.has(r.kind)
      && (r.kind !== 'direct_quote' || (isStr(r.quoteText) && r.quoteText.trim()))
      && isOptStr(r.quoteText) && (r.quoteLanguage === undefined || (isStr(r.quoteLanguage) && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(r.quoteLanguage)))
      && isStr(r.summaryKo)
      && isStrArr(r.excerpts)
      && (r.context === undefined || (r.context && typeof r.context === 'object' && isStr(r.context.text) && isStrArr(r.context.excerpts)))
      && isOptStr(r.eventKey)
      && (r.sourceType === undefined || SOURCE_TYPES.has(r.sourceType))
      && (r.provenance === undefined || (Array.isArray(r.provenance) && r.provenance.every((x: any) => x && isStr(x.label) && isStr(x.excerpt) && x.excerpt.trim())))
      && (r.referenceDate === undefined || (r.referenceDate && typeof r.referenceDate === 'object' && isStr(r.referenceDate.value) && PRECISIONS.has(r.referenceDate.precision)));
    if (ok) items.push(JSON.parse(JSON.stringify(r))); else dropped++;
  }
  return { items, dropped };
}

/**
 * 계획대로 추출하고 새 캐시를 돌려줍니다(입력 캐시는 바꾸지 않음).
 * 부분 실패: 실패한 기사만 failed로 남고(이전 결과 재사용 안 함), 다른 기사는 영향 없음.
 * 출력 형식이 배열이 아니면 그 기사만 failed('malformed_extractor_output').
 */
export async function refreshCeoCache(
  articles: SourceArticle[], cache: CeoCacheState, extractor: StatementExtractor,
  opts: { maxExtractions?: number; now?: () => Date } = {},
): Promise<{ cache: CeoCacheState; report: RefreshReport }> {
  const now = opts.now || (() => new Date());
  const plan = planExtraction(articles, cache, extractor);
  const next: CeoCacheState = JSON.parse(JSON.stringify(cache));
  for (const id of plan.removed) delete next.entries[id];
  const byId = new Map(articles.map(a => [a.articleId, a]));
  const report: RefreshReport = { plan, extracted: [], failed: [], deferred: [], droppedMalformed: {} };
  const limit = opts.maxExtractions ?? Number.POSITIVE_INFINITY;
  let used = 0;
  for (const item of plan.toExtract) {
    const a = byId.get(item.articleId)!;
    if (used >= limit) { report.deferred.push(a.articleId); continue; }
    used++;
    const prev = cache.entries[a.articleId];
    const sameTarget = prev && prev.contentHash === contentHashOf(a) && prev.extractorName === extractor.name
      && prev.extractorVersion === extractor.version && prev.schemaVersion === CEO_SCHEMA_VERSION;
    const base = {
      articleId: a.articleId, contentHash: contentHashOf(a), extractorName: extractor.name,
      extractorVersion: extractor.version, schemaVersion: CEO_SCHEMA_VERSION, extractedAt: now().toISOString(),
    };
    const attempts = (sameTarget ? prev.attempts : 0) + 1;
    try {
      const parsed = parseRawStatements(await extractor.extract(a));
      if (!parsed) throw new Error('malformed_extractor_output');
      if (parsed.dropped) report.droppedMalformed[a.articleId] = parsed.dropped;
      next.entries[a.articleId] = { ...base, status: 'ok', raw: parsed.items, attempts };
      report.extracted.push(a.articleId);
    } catch (e: any) {
      const error = String(e?.message || e).slice(0, 200);
      next.entries[a.articleId] = { ...base, status: 'failed', raw: [], error, attempts };
      report.failed.push({ articleId: a.articleId, error });
    }
  }
  return { cache: next, report };
}

export interface CeoRegistry {
  persons: CeoPerson[];
  roles: CeoRole[];
  topics: CeoTopic[];
}

export interface BuildReport {
  heldBackUnresolved: number;
  heldBackInvalid: number;
  /** 현재 기준(내용 해시·추출기·스키마)과 맞지 않아 쓰지 않은 캐시 항목 (재추출 대기) */
  staleEntries: string[];
  /** 아직 현재 기준 추출 결과가 없는 기사 / 추출 실패 기사 */
  pendingArticles: string[];
  failedArticles: string[];
  issues: Partial<Record<StatementIssue | 'topic_unknown', number>>;
  merge: MergeReport;
}

/** 이 기사 발언의 회사: 기사에 회사가 있으면 그것, 없으면 (검증된) 발언 시점에 재임 중인 유일한 역할 */
function companyFor(personId: string, raw: RawStatement, spokenAt: PartialDate, roles: CeoRole[]): string | null {
  if (raw.speaker.companyId) return raw.speaker.companyId;
  // 등록부상 회사가 하나뿐인 인물은 날짜와 무관하게 그 회사 (직책 상태는 날짜로 따로 판단)
  const all = Array.from(new Set(roles.filter(r => r.personId === personId).map(r => r.companyId)));
  if (all.length === 1) return all[0];
  const inside = roles.filter(r => r.personId === personId && tenureRelation(spokenAt, r.start, r.end) === 'inside');
  const companies = Array.from(new Set(inside.map(r => r.companyId)));
  return companies.length === 1 ? companies[0] : null;
}

/**
 * 캐시 → 화면용 데이터셋.
 * - 현재 기준(내용 해시·추출기 이름/버전·스키마 버전)에 맞는 성공 항목만 씁니다. 재추출 대기·실패 기사는 표시하지 않고 수만 셉니다.
 * - 날짜 근거를 먼저 검증한 뒤 인물을 판별합니다. 동명이인 후보가 둘 이상 가능하면 보류합니다.
 * - 주제 ID가 등록부에 없으면 보류합니다.
 * - 자동 비교 판정은 만들지 않습니다(comparisons는 항상 빈 배열). 화면은 발언을 나란히 보여주기만 합니다.
 */
export async function buildCeoDataset(
  articles: SourceArticle[], cache: CeoCacheState, registry: CeoRegistry,
  opts: { extractor: Pick<StatementExtractor, 'name' | 'version'> },
): Promise<{ dataset: CeoDataset; cache: CeoCacheState; report: BuildReport }> {
  const next: CeoCacheState = JSON.parse(JSON.stringify(cache));
  const report: BuildReport = { heldBackUnresolved: 0, heldBackInvalid: 0, staleEntries: [], pendingArticles: [], failedArticles: [], issues: {}, merge: { merged: 0, keptSeparate: 0 } };
  const texts = new Map<string, ArticleText>();
  const meta = new Map<string, SourceArticle>();
  for (const a of articles) { texts.set(a.articleId, { articleId: a.articleId, contentHash: contentHashOf(a), text: `${a.title}\n${a.body}` }); meta.set(a.articleId, a); }
  const topicIds = new Set(registry.topics.map(t => t.topicId));

  const candidates: CeoStatement[] = [];
  for (const art of articles) {
    const entry = cache.entries[art.articleId];
    const current = !!entry && entry.contentHash === texts.get(art.articleId)!.contentHash && entry.extractorName === opts.extractor.name
      && entry.extractorVersion === opts.extractor.version && entry.schemaVersion === CEO_SCHEMA_VERSION;
    if (!entry) { report.pendingArticles.push(art.articleId); continue; }
    if (!current) { report.staleEntries.push(art.articleId); report.pendingArticles.push(art.articleId); continue; }
    if (entry.status !== 'ok') { report.failedArticles.push(art.articleId); continue; }
    const items = parseRawStatements(entry.raw);
    if (!items) { report.failedArticles.push(art.articleId); continue; }
    const articleText = texts.get(art.articleId)!.text;
    items.items.forEach((raw, idx) => {
      if (!topicIds.has(raw.topicId)) { report.issues.topic_unknown = (report.issues.topic_unknown || 0) + 1; report.heldBackInvalid++; return; }
      // 날짜 근거 검증이 인물 판별보다 먼저 (검증 안 된 날짜로 동명이인을 가르지 않음)
      const date = validateSpokenDate(raw.spokenAt, [articleText]);
      if (date.issue) report.issues[date.issue] = (report.issues[date.issue] || 0) + 1;
      const r = resolveSpeaker(raw.speaker, date.date, registry.persons, registry.roles);
      if (r.status !== 'resolved') { report.heldBackUnresolved++; return; }
      const companyId = companyFor(r.personId, raw, date.date, registry.roles);
      if (!companyId) { report.heldBackUnresolved++; return; }
      const person = registry.persons.find(p => p.personId === r.personId)!;
      candidates.push({
        statementId: `st_${shortHash(`${art.articleId}#${idx}#${CEO_SCHEMA_VERSION}`)}`,
        personId: r.personId,
        companyId,
        roleTitleAtTime: '',
        roleStatusAtTime: 'unknown',
        topicId: raw.topicId,
        spokenAt: date.date,
        kind: raw.kind,
        quoteText: raw.quoteText ?? undefined,
        quoteLanguage: raw.quoteLanguage,
        summaryKo: raw.summaryKo,
        context: raw.context ? { text: raw.context.text, sources: raw.context.excerpts.map(excerpt => ({ articleId: art.articleId, excerpt })) } : undefined,
        evidence: raw.excerpts.map(excerpt => ({
          articleId: art.articleId, articleContentHash: entry.contentHash, sourceName: art.sourceName, url: safeHttpUrl(art.url) || '',
          articlePublishedAt: art.publishedAt, excerpt,
          ...(art.publishedAtBasis ? { publishedAtBasis: art.publishedAtBasis } : {}),
        })),
        eventKey: raw.eventKey ?? undefined,
        ...(raw.sourceType ? { sourceType: raw.sourceType } : {}),
        ...(raw.provenance ? { provenance: raw.provenance.map(x => ({ label: x.label, excerpt: x.excerpt })) } : {}),
        ...(raw.referenceDate ? { referenceDate: raw.referenceDate } : {}),
        extractor: { name: entry.extractorName, version: entry.extractorVersion, schemaVersion: entry.schemaVersion },
        isExample: person.isExample,
      });
    });
  }

  const validated: CeoStatement[] = [];
  for (const c of candidates) {
    const v = validateStatement(c, texts, registry.roles);
    for (const i of v.issues) if (i !== 'date_malformed' && i !== 'date_basis_not_found' && i !== 'date_value_unverified') report.issues[i] = (report.issues[i] || 0) + 1;
    if (v.statement) validated.push(v.statement); else report.heldBackInvalid++;
  }
  const { statements, report: mergeReport } = mergeStatements(validated);
  report.merge = mergeReport;

  // 이전 버전 캐시에 남은 판정 캐시가 있어도 쓰지 않고 버림
  delete (next as any).comparisons;
  const comparisons: CeoComparison[] = [];

  const persons = registry.persons.filter(p => statements.some(s => s.personId === p.personId) || registry.roles.some(r => r.personId === p.personId));
  return {
    dataset: {
      schemaVersion: CEO_SCHEMA_VERSION,
      isExample: persons.length > 0 && persons.every(p => p.isExample),
      persons, roles: registry.roles, topics: registry.topics, statements, comparisons,
      heldBackCount: report.heldBackUnresolved + report.heldBackInvalid,
      unavailableArticles: { pending: report.pendingArticles.length, failed: report.failedArticles.length },
    },
    cache: next,
    report,
  };
}
