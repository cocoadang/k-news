/**
 * 검토된 한국어 번역 정적 사전 (선택지 1: 운영 번역 API 호출 0회).
 * - 키(sourceHash) = SHA-256( normalizeForMatch(인용 원문) + "\n" + normalizeForMatch(인용이 들어 있는 근거 구간) ).
 *   normalizeForMatch = NFC + 굽은/곧은 따옴표 통일 + 공백 하나로. 연구 패킷의 quoteHash(인용 단독)와는 다른 값입니다.
 * - 조회 응답을 만들 때만 붙입니다(저장 이력·이력 키·statementId·firstVerifiedAt에 영향 없음). 그래서 이미 저장된 발언에도
 *   재수집 없이 적용됩니다.
 * - 해시가 일치할 때만 'reviewed'. 같은 인용의 번역이 있어도 원문·근거 해시가 다르면 'stale'(낡은 번역을 쓰지 않음),
 *   없으면 'missing'. 빈 번역은 만들지 않습니다(사전에 빈 문자열이 있으면 모듈 로드 시 오류).
 * - 의미 검토: 시제·조건·수치·주어(우리/회사)·고유명(Blackwell, tokens per watt per dollar 등)을 보존했는지 검토표(notes)에 남김.
 *   userConfirmed는 사용자가 확인하기 전까지 false입니다.
 */
import crypto from 'node:crypto';
import { CeoStatement, StatementTranslation } from '../../src/ceo/types';
import { normalizeForMatch } from '../../src/ceo/text';

export interface TranslationEntry {
  id: string;
  sourceHash: string;
  quote: string;
  excerpt: string;
  ko: string;
  /** 인용 밖 짧은 맥락(화면에 번역과 구분해 표시). 인용 번역 자체에는 넣지 않음 */
  noteKo?: string;
  notes: string;
  reviewedBy: string;
  reviewedOn: string;
  userConfirmed: boolean;
}

export function translationSourceHash(quote: string, excerpt: string): string {
  return crypto.createHash('sha256').update(`${normalizeForMatch(quote)}\n${normalizeForMatch(excerpt)}`, 'utf8').digest('hex');
}

const REVIEWER = 'Claude (대화 내 의미 검토, 사용자 확인 전)';
const ON = '2026-10-18';

/** sourceHash는 아래 quote·excerpt로 계산한 값을 그대로 적어 두고, 테스트가 다시 계산해 일치를 확인합니다 */
export const TRANSLATIONS: TranslationEntry[] = [
  {
    id: 'msft-fy25-q2-nadella', sourceHash: 'a3bcc0e4ad1d8d8e926d28a92c5477cd4c37a826dd3965e57b376f148c1195b4',
    quote: 'And, as AI becomes more efficient and accessible, we will see exponentially more demand',
    excerpt: 'And, as AI becomes more efficient and accessible, we will see exponentially more demand.',
    ko: '그리고 AI가 더 효율적이고 접근하기 쉬워짐에 따라, 우리는 기하급수적으로 더 많은 수요를 보게 될 것입니다.',
    notes: '조건·연동("as ~": ~함에 따라) 보존, 미래 시제("will see") 보존, "exponentially more"는 확정 수치가 아닌 정도 표현으로 유지.',
    reviewedBy: REVIEWER, reviewedOn: ON, userConfirmed: false,
  },
  {
    id: 'msft-fy26-q2-nadella', sourceHash: '8ff1458b1b41b3042af8c2f18de50d402297e07df539bbbd97368bab6c6b3d0a',
    quote: 'The key metric we are optimizing for is tokens per watt per dollar',
    excerpt: 'The key metric we are optimizing for is tokens per watt per dollar, which comes down to increasing utilization and decreasing TCO using silicon, systems, and software.',
    ko: '우리가 최적화하고 있는 핵심 지표는 와트당·달러당 토큰 수(tokens per watt per dollar)입니다.',
    notes: '현재진행("are optimizing") 보존, 지표 이름은 원어 병기. 근거 문장 뒷부분(활용도·TCO)은 인용 범위 밖이라 번역하지 않음.',
    reviewedBy: REVIEWER, reviewedOn: ON, userConfirmed: false,
  },
  {
    id: 'tsla-master-plan-2006-musk', sourceHash: '05030422e421a6f97bd5c3fcfa489574342078f3629019df7ed40948f074ac1d',
    quote: 'While doing above, also provide zero emission electric power generation options',
    excerpt: 'While doing above, also provide zero emission electric power generation options',
    ko: '위의 일들을 하면서, 무배출 전력 생산 선택지도 함께 제공한다.',
    noteKo: "맥락(인용 밖): '위의 일들'은 같은 2006년 계획 글 목록의 앞 항목(스포츠카 → 더 저렴한 차 개발)을 가리킵니다. 최신 발언이 아닙니다.",
    notes: '2006년 작성 계획 목록의 항목(계획·의도 서술). 실행·달성 사실로 옮기지 않음. "options"=선택지, "zero emission"=무배출.',
    reviewedBy: REVIEWER, reviewedOn: ON, userConfirmed: false,
  },
  {
    id: 'tsla-master-plan-2016-musk', sourceHash: '7b312f44b2791ad3e9306d7ccaf8727a8472c4d716a177647a6ac793132dde62',
    quote: 'Create stunning solar roofs with seamlessly integrated battery storage',
    excerpt: 'Create stunning solar roofs with seamlessly integrated battery storage',
    ko: '배터리 저장장치가 매끄럽게 통합된 멋진 태양광 지붕을 만든다.',
    notes: '2016년 작성 계획 요약 항목(목표 서술). 이후 실제 출시·달성 여부를 뜻하지 않음.',
    reviewedBy: REVIEWER, reviewedOn: ON, userConfirmed: false,
  },
  {
    id: 'googl-q1-2025-pichai', sourceHash: '8a355702e85b878b601b753939b32f20635f14cc35fa11103b253ae80265ff88',
    quote: 'Our differentiated, full stack approach to AI continues to be central to our growth',
    excerpt: 'Our differentiated, full stack approach to AI continues to be central to our growth.',
    ko: '우리의 차별화된 풀스택 AI 접근 방식은 계속해서 우리 성장의 중심에 있습니다.',
    notes: '"continues to be"(계속) 보존, 주어 "우리(Alphabet)" 유지, 평가·과장 표현 추가 없음.',
    reviewedBy: REVIEWER, reviewedOn: ON, userConfirmed: false,
  },
  {
    id: 'googl-q4-2025-pichai', sourceHash: '4c65c91d3890456494eabac97f6fae173864207542b2349fa32b4cd234ad54ab',
    quote: 'Overall, we’re seeing our AI investments and infrastructure drive revenue and growth across the board',
    excerpt: 'Overall, we’re seeing our AI investments and infrastructure drive revenue and growth across the board.',
    ko: '전반적으로, 우리는 AI 투자와 인프라가 전 사업 영역에서 매출과 성장을 견인하고 있는 것을 보고 있습니다.',
    notes: '현재진행 관찰("we’re seeing") 보존, "across the board"=전 사업 영역. 같은 단락의 CapEx 수치는 인용 범위 밖이라 넣지 않음.',
    reviewedBy: REVIEWER, reviewedOn: ON, userConfirmed: false,
  },
  {
    id: 'nvda-q1-fy2026-huang', sourceHash: '39ba57da8c464febadb9b115b013126c2a7fc8b8af3d56d244f326f8852b8663',
    quote: 'Global demand for NVIDIA’s AI infrastructure is incredibly strong',
    excerpt: 'Global demand for NVIDIA’s AI infrastructure is incredibly strong.',
    ko: 'NVIDIA AI 인프라에 대한 전 세계 수요는 놀라울 정도로 강합니다.',
    notes: '현재 시제 보존, "incredibly"는 강조 정도 그대로(수치 아님). 발표문 안 인용이며 실제 발언일 미상.',
    reviewedBy: REVIEWER, reviewedOn: ON, userConfirmed: false,
  },
  {
    id: 'nvda-q2-fy2026-huang', sourceHash: '30d7e4079d027551a386b8041fe35e41f05c795daad787260a41bbb8a7cffc1c',
    quote: 'The AI race is on, and Blackwell is the platform at its center',
    excerpt: 'The AI race is on, and Blackwell is the platform at its center.',
    ko: 'AI 경쟁이 진행 중이며, Blackwell은 그 중심에 있는 플랫폼입니다.',
    notes: '"is on"=(경쟁이) 진행 중(외부 검토 반영: \'이미 시작됐고\'보다 중립), 제품명 Blackwell 원어 유지, 현재 시제 보존. 발표문 안 인용이며 실제 발언일 미상.',
    reviewedBy: REVIEWER, reviewedOn: ON, userConfirmed: false,
  },
];

for (const t of TRANSLATIONS) {
  if (!t.ko.trim() || !t.quote.trim() || !t.excerpt.trim()) throw new Error(`빈 번역·원문 항목: ${t.id}`);
  if (!normalizeForMatch(t.excerpt).includes(normalizeForMatch(t.quote))) throw new Error(`근거 구간에 인용이 없음: ${t.id}`);
  if (translationSourceHash(t.quote, t.excerpt) !== t.sourceHash) throw new Error(`번역 사전 해시 불일치(원문·근거가 바뀌었으면 번역도 다시 검토): ${t.id}`);
}

const byHash = new Map(TRANSLATIONS.map(t => [translationSourceHash(t.quote, t.excerpt), t] as const));
const quoteKey = (q: string) => normalizeForMatch(q).replace(/[.,]\s*$/, '');
const byQuote = new Map(TRANSLATIONS.map(t => [quoteKey(t.quote), t] as const));

/** 인용이 실제로 들어 있는 첫 근거 구간 */
function primaryExcerpt(s: CeoStatement): string | null {
  const q = s.quoteText || '';
  return s.evidence.find(e => normalizeForMatch(e.excerpt).includes(normalizeForMatch(q)))?.excerpt ?? null;
}

/** 직접 인용의 번역 상태. 한국어 원문 인용이나 직접 인용이 아니면 undefined(번역 필드 없음) */
export function translationFor(s: CeoStatement): StatementTranslation | undefined {
  if (s.kind !== 'direct_quote' || !s.quoteText || !s.quoteLanguage || s.quoteLanguage === 'ko') return undefined;
  const ex = primaryExcerpt(s);
  if (!ex) return undefined;
  const sourceHash = translationSourceHash(s.quoteText, ex);
  const hit = byHash.get(sourceHash);
  if (hit) return { status: 'reviewed', text: hit.ko, ...(hit.noteKo ? { noteKo: hit.noteKo } : {}), sourceHash, method: 'curated_review', reviewedBy: hit.reviewedBy, reviewedOn: hit.reviewedOn, userConfirmed: hit.userConfirmed };
  if (byQuote.has(quoteKey(s.quoteText))) return { status: 'stale', sourceHash };
  return { status: 'missing', sourceHash };
}

export function withTranslation(s: CeoStatement): CeoStatement {
  const t = translationFor(s);
  return t ? { ...s, translationKo: t } : s;
}
