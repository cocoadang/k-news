/**
 * CEO 발언 데이터 계약 (스키마 v1). 클라이언트·서버 공용, 외부 의존성 없음.
 *
 * 원칙
 * - 단위는 기사가 아니라 "발언"입니다. 한 기사에 여러 발언이, 한 발언에 여러 기사(근거)가 있을 수 있습니다.
 * - 발언일(spokenAt)과 기사 발행일(articlePublishedAt)은 따로 저장합니다. 기사일을 발언일로 대신 쓰지 않습니다.
 * - 직접 인용(direct_quote)은 근거 원문 한 곳에 그대로 있는 연속 구간일 때만 인정합니다.
 * - 인물은 고유 ID + 회사별 직책·재임 기간으로 구분합니다(동명이인·이직·공동/전직 CEO).
 */

export const CEO_SCHEMA_VERSION = 2; // v2: 날짜 근거 구간, 당시 직책 상태, 미표시(대기·실패) 기사 수

/** 날짜 정확도. range는 start~end 사이 어느 시점, unknown은 발언일을 알 수 없음 */
export type DatePrecision = 'day' | 'month' | 'year' | 'range' | 'unknown';

/** 날짜 근거 유형: 본문에 명시 / 기사 정보로 추정(추정 근거 문장 필수) / 없음 */
export type DateBasisType = 'explicit_in_text' | 'inferred_from_article' | 'none';

export interface PartialDate {
  /** day: YYYY-MM-DD, month: YYYY-MM, year: YYYY, range: 시작(YYYY[-MM[-DD]]), unknown: null */
  value: string | null;
  /** range일 때 끝 (YYYY[-MM[-DD]]) */
  rangeEnd?: string | null;
  precision: DatePrecision;
  basisType: DateBasisType;
  /** 사람이 읽는 추정/명시 근거 설명. 예: '본문 "지난 3일" + 기사 발행 2026-03-04' */
  basis?: string;
  /**
   * 날짜 근거가 된 기사 본문 구간(그대로). 발언 근거 기사 안에 실제로 있어야 하며, 없으면 날짜는 '미상'으로 처리합니다.
   * 주의: 구간이 있다는 것만 확인하며, 구간에서 날짜를 계산한 결과가 맞는지는 검증하지 않습니다(화면에 구간을 함께 표시).
   */
  basisExcerpt?: string;
}

export interface CeoPerson {
  personId: string;
  displayName: string;
  /** 원문 표기 등 이름 변형 (동명이인 구분에는 쓰지 않음, 후보 찾기에만 사용) */
  nameVariants: string[];
  /** 합성(예시) 인물 여부 — true면 화면에 '예시 데이터' 표시 */
  isExample: boolean;
}

export type RoleType = 'ceo' | 'co_ceo' | 'chair' | 'other';

export interface CeoRole {
  personId: string;
  companyId: string;
  companyName: string;
  title: string;
  roleType: RoleType;
  /** 재임 시작 (YYYY[-MM[-DD]]) */
  start: string;
  /** 재임 끝. null이면 현직 */
  end: string | null;
}

export type StatementKind = 'direct_quote' | 'paraphrase' | 'translation' | 'interpretation';

export interface StatementEvidence {
  articleId: string;
  /** 추출 당시 기사 내용 해시. 기사 내용이 바뀌면 근거 재확인 필요 */
  articleContentHash: string;
  sourceName: string;
  url: string;
  /** 기사 발행일 (발언일과 별개) */
  articlePublishedAt: string | null;
  /** 기사 본문에서 그대로 옮긴 구간 */
  excerpt: string;
  /**
   * 원문 게시일(articlePublishedAt)의 본문 근거 (선별 공식 페이지만). 피드 발행 시각처럼 근거 구간이 없으면 생략.
   * written: 본인 작성글의 작성·게시일 / released: 회사 발표문 게시일 / posted: 공식 블로그 게시일. 어느 것도 발언일이 아닙니다.
   */
  publishedAtBasis?: { kind: 'written' | 'released' | 'posted'; excerpt: string; basis: string };
}

/** 선별 공식 페이지의 확인 근거(작성자·귀속·당일 통화 연결 문구 등). 각 구간은 근거 기사 본문에 그대로 있어야 함 */
export interface StatementProvenance {
  label: string;
  excerpt: string;
}

/**
 * 한국어 번역 (발언 원문과 별도 필드, 이력 키·statementId에 영향 없음).
 * reviewed: 검토된 정적 사전에서 원문+근거 해시가 일치 / stale: 같은 인용의 번역이 있으나 원문·근거 해시가 달라 쓰지 않음 /
 * missing: 번역 없음. 빈 번역은 만들지 않습니다.
 */
export type StatementTranslation =
  | { status: 'reviewed'; text: string; noteKo?: string; sourceHash: string; method: 'curated_review'; reviewedBy: string; reviewedOn: string; userConfirmed: boolean }
  | { status: 'stale'; sourceHash: string }
  | { status: 'missing'; sourceHash: string };

export interface StatementContext {
  /** 추출기가 쓴 상황 설명 (의미 검증 안 됨 — 화면은 이 문장 대신 아래 기사 구간을 보여줌) */
  text: string;
  /** 발언과 같은 기사 안의 근거 구간. 다른 기사 구간은 허용하지 않음 */
  sources: { articleId: string; excerpt: string }[];
}

export interface CeoStatement {
  statementId: string;
  personId: string;
  /** 발언 당시 회사·직책 */
  companyId: string;
  roleTitleAtTime: string;
  /** current: 재임 중 / former: 퇴임 후 / before: 취임 전 / unknown: 날짜가 불확실해 판단 불가 */
  roleStatusAtTime: 'current' | 'former' | 'before' | 'unknown';
  topicId: string;
  spokenAt: PartialDate;
  kind: StatementKind;
  /** direct_quote일 때 원문 그대로 (원어) */
  quoteText?: string;
  quoteLanguage?: string;
  /** 한국어 핵심 요지 (짧게). direct_quote가 아니면 이것이 '기사 요약/번역/해석' 본문 */
  summaryKo: string;
  context?: StatementContext;
  evidence: StatementEvidence[];
  /**
   * 기준일(비교·정렬·타임라인용).
   * 구두 발언은 발언일(spoken), 서면 공식 발표문(press_release)은 검증된 공식 발표일(released),
   * 본인 작성글(authored_post)은 작성일(written).
   * 실제 구두 발언일(spokenAt)과 원문 발행일(evidence[].articlePublishedAt)은 별도로 보존됩니다.
   */
  referenceDate?: StatementReferenceDate;
  /** 선별 공식 페이지 종류: 실적 통화 발언문 / 본인 작성글 / 회사 발표문 안 인용 / SEC 제출 문서 속 편집된 인터뷰 전사. 피드·IR 기록은 생략 */
  sourceType?: 'call_remarks' | 'authored_post' | 'press_release' | 'filed_transcript';
  /** 작성자·귀속·연결 문구 근거 (선별 공식 페이지) */
  provenance?: StatementProvenance[];
  /** 당시 직책 판단에 쓴 날짜: 발언일(기본) / 발언일 미상일 때 본문 근거가 확인된 작성일·발표일 */
  roleDateBasis?: 'spoken' | 'written' | 'released';
  /** 당시 직책 보충 (예: 'CEO 취임(2008-10) 전') */
  roleNoteAtTime?: string;
  /** 한국어 번역 (조회 응답에서 정적 사전으로 붙임, 저장 이력에는 넣지 않음) */
  translationKo?: StatementTranslation;
  /** AI 한국어 제목·요약 (조회 응답에서 원장 결과 캐시로 붙임, 저장 이력에는 넣지 않음). 원문 대조 필요 */
  koSummary?: StatementKoSummary;
  /** 같은 발언을 보도한 기사 묶음 키 (병합용, 추출기가 제시) */
  eventKey?: string;
  extractor: { name: string; version: string; schemaVersion: number };
  isExample: boolean;
  /**
   * 이력 상태: verified = 이번 갱신에서 원문으로 다시 확인 / not_rechecked = 이번에 원문을 다시 읽지 못함(피드 범위 밖·피드 실패),
   * 마지막 확인 시각 표시. 원문에서 사라졌거나 출처가 삭제(404/410)된 발언은 데이터셋에 넣지 않음
   */
  verification?: { status: 'verified' | 'not_rechecked'; firstVerifiedAt: string; lastVerifiedAt: string };
}

export interface StatementReferenceDate {
  value: string;
  precision: DatePrecision;
  /** spoken: 발언일 / released: 서면 공식 발표문 발표일 / written: 본인 작성글 작성일 */
  basis: 'spoken' | 'released' | 'written';
}

export type ComparisonVerdict =
  | 'stance_change'      // 입장 변경 (엄격 조건 충족 시에만)
  | 'condition_change'   // 조건(외부 상황) 변화에 따른 발언 차이
  | 'context_difference' // 맥락(청중·질문) 차이
  | 'same_position'      // 같은 입장 유지
  | 'insufficient';      // 비교 불가 / 근거 부족

export interface CeoComparison {
  comparisonId: string;
  personId: string;
  topicId: string;
  earlierStatementId: string;
  laterStatementId: string;
  verdict: ComparisonVerdict;
  /** 판정 이유 (짧게) */
  rationale: string;
  /**
   * 판정의 연결 근거 (기사 구간). 비교 판정(근거 부족 제외)은 필수이며, 두 발언 중 한쪽의 근거 기사 안에 있고
   * 다른 쪽 발언의 직접 인용을 그대로 포함해야 합니다(기사 스스로 두 발언을 나란히 언급). 판정의 의미는 검증하지 않습니다.
   */
  rationaleEvidence: { articleId: string; excerpt: string }[];
  /** 검증에서 판정을 낮춘 경우 그 이유 */
  downgradedFrom?: ComparisonVerdict;
  downgradeReason?: string;
}

export interface CeoTopic {
  topicId: string;
  label: string;
}

export type StatementKoSummary =
  | { status: 'ready'; title: string; summary: string; model: string; generatedAt: string }
  | { status: 'pending' | 'failed' };

/** CEO 한국어 요약 기능 상태·이번 달(UTC) 예산 (조회 응답, 읽기만) */
export interface KoSummaryInfo {
  state: 'off' | 'on' | 'limit_reached' | 'halted' | 'config_unverified' | 'unknown';
  enabled: boolean;
  month: string;
  spentUsd: number | null;
  outstandingUsd: number | null;
  limitUsd: number | null;
  message?: string;
}

/** 화면이 받는 데이터 묶음 */
export interface CeoDataset {
  schemaVersion: number;
  isExample: boolean;
  persons: CeoPerson[];
  roles: CeoRole[];
  topics: CeoTopic[];
  statements: CeoStatement[];
  /** v3: 사용하지 않음(항상 빈 배열). 의미를 검증할 수 없는 자동 판정을 만들지도 화면에 표시하지도 않음 */
  comparisons: CeoComparison[];
  /** 신원 확인 실패·검증 실패로 보류된 발언 수 (화면에 숫자만 표시) */
  heldBackCount: number;
  /** 아직 현재 기준으로 추출되지 않았거나(재추출 대기) 추출에 실패해 표시하지 않은 기사 수 */
  unavailableArticles: { pending: number; failed: number };
}

/** 읽기 전용 조회 API(GET /api/ceo/dataset) 응답 */
export interface CeoSourceReport {
  feedName: string;
  feedUrl: string;
  ok: boolean;
  error?: string;
  itemsInFeed: number;
  /** 이미 수집된 기사와 URL이 일치한 항목 */
  matchedExisting: number;
  /** 그중 전체 본문이 있는 항목 */
  withBody: number;
  /** feed: 공식 피드(기존 기사와 같은 URL만) / transcript: 선별된 IR 행사 기록 / page: 선별 공식 페이지(발언문·작성글·발표문) / sec: SEC 제출 문서(해시 고정·검증 인용) */
  kind?: 'feed' | 'transcript' | 'page' | 'sec' | 'discovery';
  /** 일시 보류(이번 갱신에서 요청하지 않음 또는 내용 재검토 필요). 삭제·성공이 아님 — 이전 확인 기록은 지우지 않음 */
  held?: { reason: string; since?: string };
  /** 선별 인용 중 원문 검증에 실패해 보류된 것과 사유 */
  rejectedQuotes?: { quote: string; reason: string }[];
}

export interface CeoApiResponse {
  /** not_loaded: 아직 원문을 불러온 적 없음 / ready / partial: 일부 출처 실패 / error: 모든 출처 실패·처리 오류 */
  status: 'not_loaded' | 'ready' | 'partial' | 'error';
  refreshedAt: string | null;
  dataset: CeoDataset | null;
  sources: CeoSourceReport[];
  message?: string;
  /** 이력 저장소가 재시작 후에도 유지되는지 (Firestore 저장소 → true, 테스트용 메모리 대역 → false) */
  historyDurable?: boolean;
  /** 표시 중인 저장 판 번호 */
  storeRevision?: number;
  /** 저장소 읽기 실패 코드(unavailable·permission_denied·timeout 등). 있으면 화면은 저장소 확인 실패를 표시 */
  storeError?: string;
  /** 원문에서 사라짐·출처 삭제로 숨긴 발언 수 */
  withdrawnCount?: number;
  /** AI 한국어 요약 기능 상태·예산 (원장이 연결된 경우) */
  koSummary?: KoSummaryInfo;
}
