/**
 * SEC EDGAR 제출 문서(이미지 + 1pt 흰색 OCR 텍스트층) 안의 편집된 인터뷰 전사 — 사람이 페이지 이미지와 대조해 고정한 인용만.
 * 모델 호출 없음. 일반 OCR 추출은 하지 않습니다(OCR 오자가 실제로 있음). 허용되는 것은 아래 검증된 고정 항목뿐입니다.
 *
 * 실제 구조(PC 확인 2026-10-19): <IMG src="PAGE.jpg" …><DIV><FONT size="1" style="font-size:1pt;color:white">PAGE_TEXT</FONT>
 *   한 FONT에 여러 턴이 들어 있고, 화자 표기는 대문자 'ELON MUSK:' 형식(이름 내부 공백, 콜론 앞 공백 0, 뒤 1).
 *
 * 바이트 단계 (secArticle, 원본 바이트 — 먼저 확인):
 * - 원본 크기·SHA256이 사람이 확인한 고정본과 같아야 함. 다르면 '재검토 필요' 보류(인용 만들지 않음, 이전 확인 기록은 지우지 않음)
 * - UTF-8 엄격 디코딩
 * - <img>(대소문자 무관) 파일명으로 페이지를 나누고, 각 이미지 바로 뒤 텍스트층(다음 이미지 전까지)을 그 페이지 텍스트로 봄
 * - 도입·Exhibit B 시작·인용 이미지가 각각 문서에 정확히 1번, 순서는 도입 ≤ Exhibit B 시작 < 인용 페이지(Exhibit A 범위 제외)
 * - 인용은 문서 전체 텍스트층에서 정확히 1번, 그 1번이 지정 인용 페이지 안
 * 구조 단계 (extractSecQuotes):
 * - 화자 경계(대문자 표기만): 인용 바로 앞 표기 = 지정 화자, 그 앞 = 지정 앞 화자, 인용 뒤 첫 표기 = 지정 뒤 화자
 * - 완결 문장: 인용은 화자 구간 시작 또는 문장 끝 뒤에서 시작하고 문장부호로 끝남(부분 문장 거부)
 * - 직전 질문 문맥(선택, contextTurn): 근거 구간 = '앞 화자 표기 + 질문 + 지정 화자 표기 + 인용'의 원문 연속 구간(600자 이하).
 *   의미 앵커는 앞 화자 구간 안에만 있어야 함(지정 화자 구간이면 질문 오귀속으로 거부). 인용문(quoteText)은 지정 화자 문장만.
 *   → 기존 한국어 요약 입력(인용 + 그 인용이 든 근거 구간 600자)을 그대로 쓰며 프롬프트·캐시 키 규칙 변경 없음.
 * - Exhibit B 시작 페이지: 참여자 이름이 지정 순서로 + 편집 고지 문구 그대로
 * - 날짜: 도입 페이지에서 '날짜 문구 + 의미 앵커(+ 필수 언급)'가 가까이(상한 글자 수 안) 함께 있는 구간이 정확히 하나이고,
 *   그 구간의 절대 날짜가 하나뿐이며 지정값과 같아야 함. 발언일 아님 목록(영상 게시일·투자설명서 날짜)과 같으면 거부.
 *   발언일을 모르면 null(미상). 영상 게시일은 provenance로만 표시(기사 발행일 필드에 넣지 않음)
 * 운영: 이 문서 2개만, SEC 전용 요청기(정직한 User-Agent, 리다이렉트 0, 재시도 0, 3MB·기한 유지). 이미지는 받지 않음(사람 확인 provenance).
 * pcConfirmed=false인 항목은 요청하지 않음(보류). 두 항목은 PC 실원문 통과(2026-10-19) 뒤 true로 고정(ceo7a).
 */
import crypto from 'node:crypto';
import { RawStatement, SourceArticle } from './pipeline';
import { shortHash } from '../../src/ceo/text';
import { extractAbsoluteDates } from '../../src/ceo/dates';
import { htmlToText } from './htmlText';

export const SEC_USER_AGENT = 'KNewsCEOCollector/1.0 (+https://k-news.ai.studio)';
export const SEC_HOST = 'www.sec.gov';
/** 아직 PC가 확인하지 않은 문자열 표시 (이 표시가 있으면 보류) */
export const PC_TODO = '⟦PC 확인 필요⟧';
export const SEC_MAX_EVIDENCE_CHARS = 600;

/** 도입 페이지 날짜 근거: 날짜 문구와 의미 앵커(+필수 언급)가 maxSpan 글자 안에 함께 있는 구간 */
export interface SecDateAnchor { value: string; dateText: string; anchor: string; mustMention?: string[]; maxSpan: number }

export interface CuratedSecExhibit {
  secId: string;
  url: string;
  /** 화면 출처 이름 (한국어) */
  title: string;
  orgName: string;
  companyId: string;
  speakerName: string;
  topicId: string;
  /** 사람이 받은 원본 크기·SHA256 (고정본) */
  rawBytes: number;
  rawSha256: string;
  /** 직접 재확인한 원본만 추가. 크기와 해시는 같은 항목으로 일치해야 함. */
  reviewedRawVariants?: { rawBytes: number; rawSha256: string; reviewedAt: string }[];
  /** PC가 이 파서로 실제 원본을 통과시켰는지. false면 운영에서 요청하지 않음 */
  pcConfirmed: boolean;
  /** 사람이 대조한 페이지 이미지 (provenance 기록용 — 운영에서 받지 않음) */
  images: { file: string; sha256: string; role: string }[];
  introImage: string;
  exhibitStartImage: string;
  quoteImage: string;
  /** Exhibit B 시작 페이지: 참여자 이름(이 순서로) + 편집 고지 문구(그대로) */
  exhibitParticipants: string[];
  editedNotice: string;
  /** 도입 페이지의 실제 발언(인터뷰)일 근거. 모르면 null */
  spokenDate: SecDateAnchor | null;
  /** 도입 페이지의 영상 게시일 근거 — 발언일이 아님(표시만) */
  videoPosted?: SecDateAnchor;
  /** 발언일로 쓰면 안 되는 날짜 */
  notSpokenDates: { value: string; why: string }[];
  /** 인용 페이지 화자 표기 이름(대문자 표기와 대소문자 무관 비교) */
  speakerLabel: string;
  turns: { before: string; after: string };
  /** 직전 질문 문맥: 앞 화자 구간의 의미 앵커. 근거 구간을 앞 화자 표기부터 인용 끝까지 연속으로 잡음 */
  contextTurn?: { speaker: string; anchor: string };
  quote: string;
}

export const CURATED_SEC_EXHIBITS: CuratedSecExhibit[] = [
  {
    secId: 'sec-fwp-cfointerview-exb',
    url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026041761/fwp_cfointerview.htm',
    title: 'SEC 제출 문서 fwp_cfointerview Exhibit B · 일론 머스크 인터뷰(편집된 전사)',
    orgName: 'SEC EDGAR', companyId: 'spacex', speakerName: 'Elon Musk', topicId: 'Starship / 우주인프라',
    rawBytes: 84285, rawSha256: '60b8f146ed4a47d496bc1444b12316d45391694fcfb6089026aabf8ad914cae7',
    // 2026-10-20 SEC 직접 재확인: 도입·Exhibit B·인용 이미지 3개 SHA256 기존값 일치.
    reviewedRawVariants: [{ rawBytes: 84272, rawSha256: '4bb134314e5f1bfe740c6d7fd9531cd88ceca7d4719992c8d705d0a7a33eff08', reviewedAt: '2026-10-20' }],
    pcConfirmed: true, // PC 실원문 통과(2026-10-19): ceo7 TGZ 54451d6a… parseLocalSec 2/2, 원본 SHA·이미지 대조 일치
    images: [
      { file: 'fwp_cfointerview001.jpg', sha256: '7202d16c9b79c7b01b48bac7454496d5f638fcacb47f63004d799140a16ca2cf', role: '도입(날짜·직책)' },
      { file: 'fwp_cfointerview017.jpg', sha256: '3dbbde0508112d23e94e1995378cec8c0a3195b90229a9d514fd46206c08c37f', role: 'Exhibit B 시작·편집 고지' },
      { file: 'fwp_cfointerview023.jpg', sha256: '434647142ef19e7cd30d4e04836bce5af2d14b07aab827dd664c48183cef01ee', role: '인용·화자' },
    ],
    introImage: 'fwp_cfointerview001.jpg', exhibitStartImage: 'fwp_cfointerview017.jpg', quoteImage: 'fwp_cfointerview023.jpg',
    exhibitParticipants: ['Elon Musk', 'Dan Huot', 'Ian Dahl'],
    editedNotice: 'Transcript slightly edited for clarity.',
    spokenDate: null,
    // 같은 날짜의 다른 인터뷰 재게시 설명이 있으므로, Elon Musk·Dan Huot·Ian Dahl·Exhibit B가 함께 있는 도입 구간만
    videoPosted: { value: '2026-06-08', dateText: 'June 8, 2026', anchor: 'posted on X', mustMention: ['Elon Musk', 'Dan Huot', 'Ian Dahl', 'Exhibit B'], maxSpan: 400 },
    notSpokenDates: [{ value: '2026-06-08', why: '영상 게시일(실제 발언일 미상)' }],
    speakerLabel: 'Elon Musk', turns: { before: 'Ian Dahl', after: 'Ian Dahl' },
    quote: 'Yeah, now the AI satellite is actually much simpler than a Starlink satellite.',
  },
  {
    secId: 'sec-eu-interviewtranscript06-exb',
    url: 'https://www.sec.gov/Archives/edgar/data/1181412/000162828026041365/eu_interviewtranscript06.htm',
    title: 'SEC 제출 문서 eu_interviewtranscript06 Exhibit B · 일론 머스크 인터뷰(편집된 전사)',
    orgName: 'SEC EDGAR', companyId: 'spacex', speakerName: 'Elon Musk', topicId: 'Starship / 우주인프라',
    rawBytes: 1954229, rawSha256: '4eff68cfb4e55f7db708609f60fe7db035a5e79cb04b2ff8b0ae6dc07d59a8ab',
    // 2026-10-20 SEC 직접 재확인: 도입·Exhibit B·인용 이미지 3개 SHA256 기존값 일치.
    reviewedRawVariants: [{ rawBytes: 1954216, rawSha256: 'c1d903ec55d1a289078da0e8012822163340416ad059f3e6c69a652221584f19', reviewedAt: '2026-10-20' }],
    pcConfirmed: true, // PC 실원문 통과(2026-10-19): ceo7 TGZ 54451d6a… parseLocalSec 2/2, 원본 SHA·이미지 대조 일치
    images: [
      { file: 'eu_interviewtranscript06001.jpg', sha256: '91fc7e9f0764128d6e388097ea51e4507ca23194aa2f51b138ed8e2221b64ad0', role: '도입(인터뷰일 2026-06-04)' },
      { file: 'eu_interviewtranscript06403.jpg', sha256: '1a2290c7725d3f547bbbdae1950083e05a1a21984434d261da66e6335df01e5c', role: 'Exhibit B 시작·편집 고지' },
      { file: 'eu_interviewtranscript06407.jpg', sha256: '396ce55dfa9e9c546a47ebb8d10b09c5fb2043cbe1c527b65a58a65c8c842c76', role: '인용·화자' },
      { file: 'eu_interviewtranscript06215.jpg', sha256: '59bb13e76010fa565b5190e8d19a70e5e925febf3a118a4118e2d3f9076eb225', role: '§9.1.1 재임(May 2002) — 등록부 근거, 운영에서 읽지 않음' },
    ],
    introImage: 'eu_interviewtranscript06001.jpg', exhibitStartImage: 'eu_interviewtranscript06403.jpg', quoteImage: 'eu_interviewtranscript06407.jpg',
    exhibitParticipants: ['Jamie Dimon', 'Elon Musk'],
    editedNotice: 'Transcript slightly edited for clarity.',
    // June 4 + 'conducted a video interview' = 실제 인터뷰 / June 5 + 'published a prospectus' = 별도 자료 발행(발언일 아님)
    spokenDate: { value: '2026-06-04', dateText: 'June 4, 2026', anchor: 'conducted a video interview', maxSpan: 200 },
    notSpokenDates: [{ value: '2026-06-05', why: '별도 투자설명서 발행일(발언일 아님)' }],
    speakerLabel: 'Elon Musk', turns: { before: 'Jamie Dimon', after: 'Jamie Dimon' },
    contextTurn: { speaker: 'Jamie Dimon', anchor: 'AI data centers in space' },
    quote: 'We think it’s easier than building communication satellites.',
  },
];

/** 고정 항목이 바뀌면 추출기 버전이 바뀌어 다시 추출 */
export const SEC_HASH = shortHash('sec-2' + JSON.stringify(CURATED_SEC_EXHIBITS));

/** 운영 요청 가능 여부: PC 실원문 통과 확인 + 미확인 표시 없음 */
export function secReady(e: CuratedSecExhibit): { ok: true } | { ok: false; reason: string } {
  if (!e.pcConfirmed || JSON.stringify(e).includes(PC_TODO)) return { ok: false, reason: 'PC 실제 원본 파일로 이 파서를 통과시키기 전 — 요청하지 않음(보류)' };
  return { ok: true };
}

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const canonChars = (s: string) => s.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/\s/g, ' ');
function findAll(text: string, needle: string, ci = false): { at: number; raw: string }[] {
  const n = canonChars(needle).trim();
  if (!n) return [];
  const re = new RegExp(n.split(/ +/).map(escRe).join('\\s+'), ci ? 'gi' : 'g');
  return [...canonChars(text).matchAll(re)].map(m => ({ at: m.index!, raw: text.slice(m.index!, m.index! + m[0].length) }));
}

const PAGE_MARK = (file: string) => `[[SEC 페이지 ${file}]]`;
const imgName = (src: string) => src.split(/[?#]/)[0].split('/').pop()!.toLowerCase();

/** 원본 HTML → 이미지별 텍스트층 (앞 이미지 없는 머리 부분은 file=''). 태그·속성 대소문자 무관 */
export function secPages(html: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)[^>]*>/gi;
  let last = 0; let file = '';
  for (let m = re.exec(html); m; m = re.exec(html)) {
    out.push({ file, text: htmlToText(html.slice(last, m.index)) });
    file = imgName(m[1]); last = m.index + m[0].length;
  }
  out.push({ file, text: htmlToText(html.slice(last)) });
  return out;
}

export type SecArticleResult = { ok: true; article: SourceArticle; sha256: string } | { ok: false; reason: string; sha256?: string };

/** 바이트 단계 검증 → 기사(도입·Exhibit B 시작·인용 페이지 텍스트층만). 실패하면 보류 사유 */
export function secArticle(e: CuratedSecExhibit, bytes: Uint8Array): SecArticleResult {
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const reviewedRaw = [{ rawBytes: e.rawBytes, rawSha256: e.rawSha256 }, ...(e.reviewedRawVariants || [])];
  if (!reviewedRaw.some(v => bytes.byteLength === v.rawBytes && sha256 === v.rawSha256)) {
    return { ok: false, sha256, reason: `원문 바이트가 사람이 확인한 고정본과 다름(크기 ${bytes.byteLength}/${e.rawBytes}, SHA256 ${sha256.slice(0, 12)}…≠${e.rawSha256.slice(0, 12)}…) — 재검토 필요, 인용을 만들지 않음` };
  }
  let html: string;
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return { ok: false, sha256, reason: 'UTF-8 엄격 디코딩 실패 — 재검토 필요' }; }
  const pages = secPages(html);
  const idx = (f: string) => pages.map((p, i) => (p.file === f.toLowerCase() ? i : -1)).filter(i => i >= 0);
  const [intro, start, quote] = [e.introImage, e.exhibitStartImage, e.quoteImage].map(idx);
  if (intro.length !== 1 || start.length !== 1 || quote.length !== 1) return { ok: false, sha256, reason: '도입·Exhibit B 시작·인용 페이지 이미지가 문서에 각각 정확히 1번 있지 않음' };
  if (!(intro[0] <= start[0] && start[0] < quote[0])) return { ok: false, sha256, reason: '인용 페이지가 Exhibit B 시작 뒤가 아님(Exhibit A 범위 제외)' };
  const hits = pages.map((p, i) => ({ i, n: findAll(p.text, e.quote).length })).filter(x => x.n > 0);
  const total = hits.reduce((a, x) => a + x.n, 0);
  if (total !== 1) return { ok: false, sha256, reason: total ? `인용이 문서 텍스트층에 ${total}번 있어 위치를 하나로 정할 수 없음` : '문서 텍스트층에서 인용을 찾지 못함' };
  if (hits[0].i !== quote[0]) return { ok: false, sha256, reason: `인용이 지정 이미지(${e.quoteImage}) 페이지 텍스트층에 있지 않음` };
  const sections = [...new Set([intro[0], start[0], quote[0]])].map(i => `${PAGE_MARK(pages[i].file)}\n${pages[i].text}`);
  const body = [`SEC EDGAR 제출 문서 · 원본 SHA256 ${sha256}`, ...sections].join('\n');
  return { ok: true, sha256, article: {
    articleId: '', title: e.title, body, sourceName: `${e.orgName} · ${e.title}`, url: e.url, publishedAt: null,
    topicId: e.topicId, sourceKind: 'sec', secId: e.secId,
  } };
}

/** 기사 본문에서 페이지 텍스트층 꺼내기 */
function pageText(body: string, file: string): string | null {
  const mark = PAGE_MARK(file.toLowerCase());
  const i = body.indexOf(mark);
  if (i < 0) return null;
  const from = i + mark.length + 1;
  const next = body.indexOf('\n[[SEC 페이지 ', from);
  return body.slice(from, next < 0 ? body.length : next);
}

/** PC가 두 문서 텍스트층에서 확인한 화자 표기 (대문자, 이름 내부 공백 1, 콜론 앞 공백 0) */
export const SEC_KNOWN_LABELS = ['ELON MUSK', 'DAN HUOT', 'IAN DAHL', 'JAMIE DIMON', 'MARY ERDOES', 'MAYE MUSK'];
/**
 * 화자 표기: 대문자 단어 1~4개 + 콜론. 본문의 'Note:' 같은 혼합 대소문자는 표기로 보지 않음.
 * 앞 문장 끝의 대문자 단어가 붙어 잡히면(예: 'NASA. ELON MUSK:') 알려진 표기로 끝나는 경우 그 표기만 씀.
 * 모르는 대문자 표기도 경계로 남김 → 경계가 늘면 보류될 뿐 다른 사람에게 귀속하지 않음(fail-closed).
 */
const LABEL_RE = /(^|[^A-Za-z])([A-Z][A-Z.'’\-]*(?: [A-Z][A-Z.'’\-]*){0,3}):/g;
function labels(text: string): { name: string; at: number; end: number; raw: string }[] {
  return [...text.matchAll(LABEL_RE)].map(m => {
    let at = m.index! + m[1].length; let name = m[2];
    const k = SEC_KNOWN_LABELS.find(l => name === l || name.endsWith(' ' + l));
    if (k && name !== k) { at += name.length - k.length; name = k; }
    const end = m.index! + m[0].length;
    return { name: ws(name), at, end, raw: text.slice(at, end) };
  });
}
const same = (a: string, b: string) => ws(canonChars(a)).toLowerCase() === ws(canonChars(b)).toLowerCase();

/** 도입 페이지 날짜 근거 구간: 앵커마다 가장 가까운 날짜·필수 언급을 묶은 구간이 상한 안인 것이 정확히 하나 */
function dateSpan(text: string, d: SecDateAnchor): { ok: true; raw: string } | { ok: false; reason: string } {
  const spans: string[] = [];
  for (const a of findAll(text, d.anchor, true)) {
    let lo = a.at, hi = a.at + a.raw.length, ok = true;
    for (const t of [d.dateText, ...(d.mustMention || [])]) {
      const occ = findAll(text, t, true);
      if (!occ.length) { ok = false; break; }
      const near = occ.reduce((b, o) => (Math.abs(o.at - a.at) < Math.abs(b.at - a.at) ? o : b));
      lo = Math.min(lo, near.at); hi = Math.max(hi, near.at + near.raw.length);
    }
    if (ok && hi - lo <= d.maxSpan) spans.push(text.slice(lo, hi));
  }
  if (spans.length !== 1) return { ok: false, reason: spans.length ? '날짜 근거 구간이 여럿이라 하나로 정할 수 없음' : '날짜 문구·의미 앵커가 함께 있는 구간을 찾지 못함' };
  const ds = extractAbsoluteDates(spans[0]);
  if (ds.length !== 1 || ds[0].precision !== 'day' || ds[0].value !== d.value) return { ok: false, reason: '날짜 근거 구간의 날짜가 하나가 아니거나 지정값과 다름' };
  return { ok: true, raw: ws(spans[0]) };
}

export function extractSecQuotes(e: CuratedSecExhibit, body: string): { items: RawStatement[]; rejected: { quote: string; reason: string }[] } {
  const reject = (reason: string) => ({ items: [], rejected: [{ quote: e.quote, reason }] });
  const intro = pageText(body, e.introImage), start = pageText(body, e.exhibitStartImage), qp = pageText(body, e.quoteImage);
  if (intro === null || start === null || qp === null) return reject('검증된 페이지 텍스트층이 없음');
  // Exhibit B 시작 페이지: 참여자 순서·편집 고지
  let from = -1;
  for (const n of e.exhibitParticipants) {
    const at = findAll(start, n, true).map(x => x.at).find(i => i > from);
    if (at === undefined) return reject(`Exhibit B 시작 페이지에서 참여자 표기(${e.exhibitParticipants.join(' → ')}) 순서를 확인하지 못함`);
    from = at;
  }
  const notice = findAll(start, e.editedNotice);
  if (notice.length !== 1) return reject('Exhibit B 시작 페이지에서 편집된 전사 고지를 확인하지 못함');
  // 인용 위치·화자 경계
  const q = findAll(qp, e.quote);
  if (q.length !== 1) return reject(q.length ? '인용 페이지에 같은 인용이 여러 번 있음' : '인용 페이지 텍스트층에서 인용을 찾지 못함');
  const at = q[0].at, end = at + q[0].raw.length;
  const ls = labels(qp);
  const before = ls.filter(l => l.end <= at), after = ls.filter(l => l.at >= end);
  const own = before[before.length - 1], prev = before[before.length - 2], next = after[0];
  if (!own || !same(own.name, e.speakerLabel)) return reject(`인용 바로 앞 화자 표기가 지정 화자(${e.speakerName})가 아님${own ? `(${own.name})` : ''} — 다른 화자 발언`);
  if (!prev || !same(prev.name, e.turns.before)) return reject(`지정 화자 앞 화자 경계(${e.turns.before})를 확인하지 못함`);
  if (!next || !same(next.name, e.turns.after)) return reject(`인용 뒤 화자 경계(${e.turns.after})를 확인하지 못함`);
  if (ls.some(l => l.at < end && l.end > at)) return reject('인용 안에 화자 표기가 있음');
  // 완결 문장
  const turnHead = qp.slice(own.end, at);
  if (turnHead.trim() && !/[.!?]["”’']?\s*$/.test(turnHead)) return reject('인용이 문장 중간에서 시작함(부분 문장)');
  if (!/[.!?]["”’']?$/.test(ws(q[0].raw))) return reject('인용이 문장 끝에서 끝나지 않음(부분 문장)');
  const tail = qp.slice(end, next.at);
  if (tail && !/^\s/.test(tail) && !/^["”’']/.test(tail)) return reject('인용 뒤에 같은 문장이 이어짐(부분 문장)');
  if (!/^[A-Z"“]/.test(ws(q[0].raw))) return reject('인용이 문장 첫머리가 아님(부분 문장)');
  // 근거 구간: 기본 = 인용 문장. 직전 질문 문맥이 있으면 '앞 화자 표기 + 질문 + 지정 화자 표기 + 인용' 원문 연속 구간
  let excerpt = ws(q[0].raw);
  if (e.contextTurn) {
    if (!same(e.contextTurn.speaker, e.turns.before)) return reject('질문자가 앞 화자 경계와 다름');
    const inPrev = findAll(qp.slice(prev.end, own.at), e.contextTurn.anchor, true).length;
    const inOwn = findAll(qp.slice(own.end, next.at), e.contextTurn.anchor, true).length;
    if (inOwn) return reject('질문 문맥 앵커가 지정 화자 구간에 있음(질문 오귀속)');
    if (inPrev !== 1) return reject('직전 질문(앞 화자 구간)에서 문맥 앵커를 확인하지 못함');
    excerpt = ws(qp.slice(prev.at, end));
    if (excerpt.length > SEC_MAX_EVIDENCE_CHARS) return reject(`질문+인용 근거 구간이 ${SEC_MAX_EVIDENCE_CHARS}자를 넘음(요약 입력에서 잘리지 않도록 보류)`);
  }
  const provenance: { label: string; excerpt: string }[] = [
    { label: '편집된 전사 고지(Exhibit B 첫 쪽, 무편집 녹취 아님)', excerpt: ws(notice[0].raw) },
    { label: `화자 표기(인용 페이지 ${e.quoteImage})`, excerpt: ws(own.raw) },
  ];
  // 날짜
  let spokenAt: RawStatement['spokenAt'] = { value: null, precision: 'unknown', basisType: 'none', basis: 'SEC 제출 문서의 편집된 인터뷰 전사 — 실제 발언일 미상' };
  if (e.videoPosted) {
    const v = dateSpan(intro, e.videoPosted);
    if (v.ok === false) return reject(`도입 페이지 영상 게시일: ${v.reason}`);
    provenance.push({ label: '영상 게시일(문서 도입부 표기) — 실제 발언일 아님', excerpt: v.raw });
    spokenAt = { ...spokenAt, basis: `SEC 제출 문서의 편집된 인터뷰 전사 — 실제 발언일 미상(영상 게시일 ${e.videoPosted.value}은 발언일이 아님)` };
  }
  if (e.spokenDate) {
    const bad = [...e.notSpokenDates, ...(e.videoPosted ? [{ value: e.videoPosted.value, why: '영상 게시일' }] : [])].find(x => x.value === e.spokenDate!.value);
    if (bad) return reject(`발언일로 지정한 ${e.spokenDate.value}은 ${bad.why} — 발언일로 쓰지 않음`);
    const d = dateSpan(intro, e.spokenDate);
    if (d.ok === false) return reject(`도입 페이지 인터뷰 날짜: ${d.reason}`);
    spokenAt = { value: e.spokenDate.value, precision: 'day', basisType: 'explicit_in_text', basis: `SEC 제출 문서 도입부의 인터뷰 날짜 ("${d.raw}")`, basisExcerpt: d.raw };
  }
  return { items: [{
    speaker: { name: e.speakerName, companyId: e.companyId },
    topicId: e.topicId,
    spokenAt,
    kind: 'direct_quote',
    quoteText: ws(q[0].raw).replace(/[.,]\s*$/, ''),
    quoteLanguage: 'en',
    summaryKo: '',
    excerpts: [excerpt],
    sourceType: 'filed_transcript',
    provenance,
  }], rejected: [] };
}
