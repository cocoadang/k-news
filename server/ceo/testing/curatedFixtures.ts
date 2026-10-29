/**
 * 운영 선별 목록(CURATED_TRANSCRIPTS) 대조군용 구조 고정 자료.
 * 실제 IR 페이지 구조(h1 제목 → 참가자 단락 → 날짜 단락 → 화자 단락, 다른 행사 날짜가 있는 탐색 영역)를 흉내 냅니다.
 * 인용 문장 외의 본문·다른 화자 발언은 전부 지어낸 문장이며 실제 원문을 복제하지 않습니다.
 */
import { CuratedTranscript } from '../transcripts';

export function curatedFixturePage(t: CuratedTranscript, opts: { nextLabel?: string; headerAttack?: string } = {}): string {
  const quoteParas = t.quotes.map(q => `<p>${q}${q.endsWith('.') ? '' : '.'} That is what we will keep focusing on.</p>`).join('\n');
  return `<html><head><title>${t.transcriptTitle}</title></head><body>
<nav>Investor events · Wednesday October 21, 2026 · next call</nav>
<div class="cmp-text"><p>Upcoming: Wednesday October 21, 2026</p></div>
<div class="container"><div class="cmp-text"><h1>${t.transcriptTitle}</h1></div>
<div class="cmp-text text-break">${opts.headerAttack
    ? `<p><strong>${opts.headerAttack}: </strong>A different event was on ${t.eventDateExcerpt}.</p>\n<p><strong>OPERATOR: </strong>This call is being webcast live and recorded.</p>`
    : `<p>${t.speakerName}, Chairman and Chief Executive Officer; fictional participant list</p>
<p>${t.eventDateExcerpt}</p>
<p>This call is being webcast live and recorded.</p>
<p><strong>BRETT IVERSEN: </strong>Good afternoon and thank you for joining us today.</p>`}
<p><strong>${t.speakerLabel}: </strong>Thank you, Brett.</p>
${opts.nextLabel ? `<p><strong>${opts.nextLabel}: </strong>Thank you. Let me add one item.</p>` : ''}
${quoteParas}
<p><strong>KEITH WEISS: </strong>Thanks for taking the question.</p>
<p>END</p></div></div></body></html>`;
}
