/**
 * 선별 공식 페이지 구조 고정 자료 (합성). 인용 문장·작성자·날짜·편집자 주의 짧은 확인 문구만 실제 공개 페이지에서 확인한 값이고,
 * 그 밖의 본문·목록·탐색 영역 문장은 전부 지어낸 것입니다(실제 원문을 복제하지 않음). 실제 HTML 검증은 PC에서
 * testing/parseLocalPages.ts로 따로 합니다.
 */
import { CuratedPage } from '../officialPages';
import { CuratedTranscript } from '../transcripts';

export interface PageFixtureOpts {
  noTitle?: boolean; otherAuthor?: boolean; dateOnlyInMeta?: boolean; dateFarAway?: boolean; noLink?: boolean; quoteInNote?: boolean;
  otherSpeaker?: boolean; quoteOutsideQuotes?: boolean; quoteAfterBoilerplate?: boolean; quoteInSentence?: boolean; duplicateQuote?: boolean;
  quoteOverride?: string;
  /** ceo7 요약문(abstract) 배치 반례: 날짜·작성자가 인용 뒤(본문·관련 글)에만 / 편집 고지 없음 */
  dateAfterQuote?: boolean; authorAfterQuote?: boolean; noEditedNotice?: boolean;
}

export function pageFixture(p: CuratedPage, o: PageFixtureOpts = {}): string {
  const q = o.quoteOverride ?? p.quotes[0];
  const h1 = o.noTitle ? 'A different page title' : p.pageTitle;
  const head = `<head><title>${p.pageTitle} | ${p.orgName}</title><meta property="article:published_time" content="${p.date}T20:45:00+00:00"></head>`;
  const nav = `<nav>Home · News · Archive · October 1, 2026</nav>`;
  if (p.kind === 'authored_post') {
    const byline = o.dateOnlyInMeta ? `${o.otherAuthor ? 'Jane Example' : p.bylineExcerpt}, Contributor` : `${o.otherAuthor ? 'Jane Example' : p.bylineExcerpt}, Example Title, ${p.dateExcerpt}`;
    const item = o.quoteInSentence ? `<li>We said that ${q} would be nice someday</li>` : `<li>${q}</li>`;
    return `<html>${head}<body>${nav}<main><section class="tcl-rich-text"><h1>${h1}</h1><p class="tds-text--caption">${byline}</p>
<p>Invented opening paragraph about a long-term plan for a fictional reader.</p>
<p>Another invented paragraph that explains the reasoning in general terms.</p>
<ol><li>Invented first step</li><li>Invented second step</li>${item}${o.duplicateQuote ? `<li>${q}</li>` : ''}</ol>
</section></main><footer>Invented legal footer${o.dateFarAway ? ` · ${p.dateExcerpt}` : ''}</footer></body></html>`;
  }
  if (p.kind === 'call_remarks' && p.metaOrder === 'before_quote') {
    // ceo7 합성: blog.google 최신 머리 배치(h1 → 요약문 → 날짜 → 작성자 → 본문 첫 단락). 확인 문구·인용 외 문장은 지어낸 것
    const abs = o.noLink ? 'Sundar Pichai shared invented thoughts with investors.'
      : `On today’s Q2 2026 earnings call, Sundar Pichai shared invented remarks.${o.noEditedNotice ? '' : ' Below is an edited transcript of his remarks.'}`;
    const date = `<div class="uni-article-hero__date">${p.dateExcerpt}</div>`;
    const author = `<div class="author"><p class="author-name">${o.otherAuthor ? 'Jane Example' : p.bylineExcerpt}</p><p class="author-title">${p.bylineTitleExcerpt}</p></div>`;
    return `<html>${head}<body>${nav}<article><div class="uni-article-hero"><h1>${h1}</h1>
<p class="uni-article-hero__abstract">${abs}</p>${o.dateAfterQuote || o.dateOnlyInMeta ? '' : date}${o.authorAfterQuote ? '' : author}</div>
<div class="uni-article-paragraph"><p>${o.quoteInNote ? '' : `Invented greeting to everyone on the call. ${q} Invented sentence that follows the quote.`}</p></div>
${o.dateAfterQuote ? date : ''}${o.authorAfterQuote ? author : ''}
<p>Invented closing paragraph.</p></article>
<aside>Related stories · ${o.dateFarAway ? p.dateExcerpt : 'Apr 23, 2026'} · ${p.pageTitle}</aside></body></html>`;
  }
  if (p.kind === 'call_remarks') {
    const link = o.noLink ? 'Google and Alphabet CEO Sundar Pichai shared some thoughts.'
      : p.sourceId.includes('q1') ? 'On today’s 2025 Q1 earnings call, Google and Alphabet CEO Sundar Pichai shared an invented summary.'
        : 'Here are remarks from today’s 2025 Q4 earnings call, delivered by our CEO.';
    const date = o.dateOnlyInMeta ? '' : `<div class="article-meta__date">${p.dateExcerpt}</div>`;
    const note = `<p><em>Editor’s Note</em>: ${link}${o.quoteInNote ? ` ${q}` : ''} Below is a transcript of his remarks.</p>`;
    return `<html>${head}<body>${nav}<article class="uni-article-wrapper"><h1>${h1}</h1>
<div class="article-author"><p>${o.otherAuthor ? 'Jane Example' : p.bylineExcerpt}</p><p>${p.bylineTitleExcerpt}</p></div>${date}
<div class="rich-text">${note}
${o.quoteInNote ? '' : `<p>${q} Invented sentence that follows the quote in the remarks.</p>`}
<p>Invented closing paragraph thanking the team.</p></div></article>
<aside>Related stories · ${o.dateFarAway ? p.dateExcerpt : 'Mar 01, 2026'}</aside></body></html>`;
  }
  // press_release
  const speaker = o.otherSpeaker
    ? 'said Colette Kress, chief financial officer'
    : p.companyId === 'nvda'
      ? 'said Jensen Huang, founder and CEO of NVIDIA'
      : (p.attribution ? `${p.attribution}, chief engineer` : `said ${p.speakerName}, representative`);
  const bp = (p.bodyEnd && p.bodyEnd[0]) ? p.bodyEnd[0] : 'About NVIDIA';
  const quotePara = o.quoteOutsideQuotes
    ? `<p>${q} Analysts noted this, and the company ${speaker} would comment later.</p>`
    : `<p>“Invented opening sentence for this fictional quote paragraph. ${q}” ${speaker}.</p>`;
  const date = o.dateFarAway ? '' : `<div class="article-date">${p.dateExcerpt}</div>`;
  return `<html>${head}<body>${nav}<div class="related">Related news · ${o.dateFarAway ? `${'Invented related headline text. '.repeat(30)} ${p.dateExcerpt}` : 'September 1, 2025'}</div>
${date}<h1>${h1}</h1>
<div class="article-body"><p>${p.orgName} today reported invented revenue figures for a fictional quarter.</p>
${o.quoteAfterBoilerplate ? '' : quotePara}
<p>Invented outlook paragraph.</p>
<p>${bp}</p><p>Invented boilerplate paragraph.${o.quoteAfterBoilerplate ? ` “${q}” ${speaker}.` : ''}</p></div></body></html>`;
}

/** 운영 판 1과 같은 근거 문장을 내는 MS IR 기록 구조 자료 (인용 문장 외 본문은 지어낸 문장) */
export function prodTranscriptFixture(t: CuratedTranscript, sentence: string): string {
  return `<html><head><title>${t.transcriptTitle}</title></head><body>
<nav>Investor events · Wednesday October 21, 2026 · next call</nav>
<div class="container"><div class="cmp-text"><h1>${t.transcriptTitle}</h1></div>
<div class="cmp-text text-break"><p>${t.speakerName}, Chairman and Chief Executive Officer; fictional participant list</p>
<p>${t.eventDateExcerpt}</p>
<p>This call is being webcast live and recorded.</p>
<p><strong>BRETT IVERSEN: </strong>Good afternoon and thank you for joining us today.</p>
<p><strong>${t.speakerLabel}: </strong>Thank you, Brett. Invented opening remark. ${sentence} Invented closing remark.</p>
<p><strong>KEITH WEISS: </strong>Thanks for taking the question.</p>
<p>END</p></div></div></body></html>`;
}
