/**
 * SEC 제출 문서 구조 고정 자료 (합성). PC가 확인한 실제 구조만 흉내 냅니다:
 *   <IMG src="PAGE.jpg" title="TITLE" width="1055" height="1365"><DIV><FONT size="1" style="font-size:1pt;color:white">PAGE_TEXT</FONT>
 *   한 FONT 안에 여러 턴, 대문자 화자 표기('ELON MUSK: ').
 * 인용 두 문장·화자 이름·편집 고지·날짜·의미 앵커는 PC가 확인해 준 짧은 값이고, 질문·도입·Exhibit A 나머지 문장은 전부 지어낸 것입니다
 * (실제 SEC 텍스트층을 복제하지 않음). 실제 바이트 검증은 PC에서 testing/parseLocalSec.ts로 따로 합니다.
 * 합성 fixture를 통과했다고 실제 원문 통과가 아닙니다.
 */
import crypto from 'node:crypto';
import { CURATED_SEC_EXHIBITS, CuratedSecExhibit } from '../secExhibits';

export interface SecPage { img: string | null; text: string }

export function secHtml(pages: SecPage[]): string {
  return `<HTML><HEAD><TITLE>fwp</TITLE></HEAD><BODY>\n${pages.map(p => `${p.img ? `<IMG src="${p.img}" title="${p.img}" width="1055" height="1365">` : ''}<DIV><FONT size="1" style="font-size:1pt;color:white">${p.text}</FONT></DIV>`).join('\n')}\n</BODY></HTML>`;
}

export const bytesOf = (html: string) => new TextEncoder().encode(html);
export const sha = (b: Uint8Array) => crypto.createHash('sha256').update(b).digest('hex');

/** 고정본 값(크기·SHA)을 이 바이트로 바꾼 확인 완료 항목 */
export function pinned(e: CuratedSecExhibit, bytes: Uint8Array, over: Partial<CuratedSecExhibit> = {}): CuratedSecExhibit {
  return { ...e, ...over, pcConfirmed: true, rawBytes: bytes.byteLength, rawSha256: sha(bytes) };
}

const NOTICE = 'Transcript slightly edited for clarity.';

// ---------------------------------------------------------------- 문서 B (Jamie Dimon 인터뷰) 합성
export const B_BASE = CURATED_SEC_EXHIBITS.find(e => e.secId === 'sec-eu-interviewtranscript06-exb')!;
export const B_SYN = {
  intro: 'Invented introduction. On June 4, 2026, Jamie Dimon conducted a video interview with Elon Musk, attached as Exhibit B. Separately, on June 5, 2026, the company published a prospectus.',
  cover: 'Invented free writing prospectus legend.',
  question: 'Invented question: why would building AI data centers in space make sense compared with doing it on the ground?',
};
export interface BOpts {
  quoteSpeaker?: string; prevSpeaker?: string; quoteInExhibitA?: boolean; quoteAlsoInExhibitA?: boolean; anchorInMuskTurn?: boolean;
  quotePrefix?: string; introText?: string; noNotice?: boolean; longQuestion?: boolean; participantsReversed?: boolean;
}
export function bPages(o: BOpts = {}): SecPage[] {
  const q = B_BASE.quote;
  const question = o.anchorInMuskTurn ? 'Invented question about launch costs?'
    : o.longQuestion ? `${B_SYN.question} ${'Invented follow-up clause about orbital power and cooling. '.repeat(10)}` : B_SYN.question;
  const muskTurn = `${o.quoteSpeaker ?? 'ELON MUSK'}: ${o.anchorInMuskTurn ? 'Building AI data centers in space is the plan. ' : ''}${o.quotePrefix ?? ''}${q} Invented second sentence about solar power in orbit.`;
  const participants = o.participantsReversed ? 'Elon Musk and Jamie Dimon' : 'Jamie Dimon and Elon Musk';
  return [
    { img: null, text: B_SYN.cover },
    { img: 'eu_interviewtranscript06001.jpg', text: o.introText ?? B_SYN.intro },
    { img: 'eu_interviewtranscript06002.jpg', text: `EXHIBIT A Invented prospectus text.${o.quoteInExhibitA || o.quoteAlsoInExhibitA ? ` ELON MUSK: ${q}` : ''}` },
    { img: 'eu_interviewtranscript06215.jpg', text: 'Invented management section. Chaim Ian of the Board since May 2002.' },
    { img: 'eu_interviewtranscript06403.jpg', text: `EXHIBIT B Interview: ${participants}. ${o.noNotice ? 'Invented heading.' : NOTICE}` },
    { img: 'eu_interviewtranscript06406.jpg', text: 'JAMIE DIMON: Invented earlier question about rockets? ELON MUSK: Invented earlier answer.' },
    { img: 'eu_interviewtranscript06407.jpg', text: o.quoteInExhibitA ? 'JAMIE DIMON: Invented question. ELON MUSK: Invented answer. JAMIE DIMON: Thanks.'
      : `${o.prevSpeaker ?? 'JAMIE DIMON'}: ${question} ${muskTurn} JAMIE DIMON: Invented next question about launch cadence? MARY ERDOES: Invented remark.` },
  ];
}
export function bEntry(html: string, over: Partial<CuratedSecExhibit> = {}): CuratedSecExhibit {
  return pinned(B_BASE, bytesOf(html), over);
}

// ---------------------------------------------------------------- 문서 A (Ian Dahl 인터뷰) 합성
export const A_BASE = CURATED_SEC_EXHIBITS.find(e => e.secId === 'sec-fwp-cfointerview-exb')!;
export const A_SYN = {
  intro: 'Invented introduction. A CFO interview was reposted on June 8, 2026 and is attached as Exhibit A. A video interview of Elon Musk by Dan Huot and Ian Dahl was posted on X on June 8, 2026 and is attached as Exhibit B.',
};
export function aPages(o: { quotePrefix?: string; introText?: string } = {}): SecPage[] {
  return [
    { img: 'fwp_cfointerview001.jpg', text: o.introText ?? A_SYN.intro },
    { img: 'fwp_cfointerview002.jpg', text: 'EXHIBIT A IAN DAHL: Invented question for the CFO? BRET JOHNSEN: Invented CFO answer.' },
    { img: 'fwp_cfointerview017.jpg', text: `EXHIBIT B Participants: Elon Musk, Dan Huot, Ian Dahl. ${NOTICE}` },
    { img: 'fwp_cfointerview023.jpg', text: `IAN DAHL: Invented question comparing satellites? ELON MUSK: ${o.quotePrefix ?? ''}${A_BASE.quote} Invented sentence about radiators. IAN DAHL: Invented follow-up. DAN HUOT: Invented aside.` },
  ];
}
export function aEntry(html: string, over: Partial<CuratedSecExhibit> = {}): CuratedSecExhibit {
  return pinned(A_BASE, bytesOf(html), over);
}
