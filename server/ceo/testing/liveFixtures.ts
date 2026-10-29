/**
 * 실연동 경로 테스트용 고정 자료 (전부 가상 인물·가상 회사·가상 문장). 실존 CEO의 말을 지어내지 않기 위해
 * 운영 등록부 대신 이 등록부를 주입해 씁니다. 운영 코드(추출기·검증·이력·라우터)는 그대로입니다.
 */
import { CeoPerson, CeoRole } from '../../../src/ceo/types';
import { CuratedTranscript } from '../transcripts';
import { CEO_TOPICS } from '../registry';

export const LIVE_PERSONS: CeoPerson[] = [
  { personId: 'ex-mina-park', displayName: '박미나', nameVariants: ['Mina Park'], isExample: true },
  { personId: 'ex-leo-grant', displayName: '레오 그랜트', nameVariants: ['Leo Grant'], isExample: true },
];
export const LIVE_ROLES: CeoRole[] = [
  { personId: 'ex-mina-park', companyId: 'nvda', companyName: '예시칩스(가상)', title: 'CEO', roleType: 'ceo', start: '2015-01', end: null },
  { personId: 'ex-leo-grant', companyId: 'msft', companyName: '예시소프트(가상)', title: 'CEO', roleType: 'ceo', start: '2016-03', end: null },
];
export const LIVE_REGISTRY = { persons: LIVE_PERSONS, roles: LIVE_ROLES, topics: CEO_TOPICS };

export const FEED_URL_NVDA = 'https://blogs.nvidia.com/feed/';
export const FEED_URL_MSFT = 'https://blogs.microsoft.com/feed/';
export const FEED_URL_GOOG = 'https://blog.google/rss/';

export const ARTICLE_1 = 'https://blogs.nvidia.com/blog/example-launch/';
export const ARTICLE_2 = 'https://blogs.nvidia.com/blog/example-roadmap/';

export const BODY_1 = `<p>SANTA CLARA, Calif., Oct. 15, 2026 — Example Chips today introduced a new platform.</p>
<p>“Demand for accelerated computing keeps rising across every industry,” said Mina Park, CEO of Example Chips, on Oct. 14, 2026 at the customer summit.</p>
<p>The platform ships on Dec. 1, 2026. “We will ship the next platform on March 3, 2027 for all customers,” said Mina Park.</p>
<p>Analysts called it “a remarkable year for the whole industry.”</p>
<p>“Partnership matters more than any single product launch,” said Leo Grant and Mina Park in a joint statement.</p>`;

export const BODY_2 = `<p>Example Chips shared its roadmap.</p>
<p>Mina Park said: “Efficiency per watt is now the metric we optimize above all others.”</p>
<p>${'Background paragraph about the product line and partner ecosystem. '.repeat(4)}</p>`;

export function rssFeed(items: { link: string; title: string; html: string; pubDate: string }[]): string {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>t</title>${items
    .map(i => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.pubDate}</pubDate><content:encoded><![CDATA[${i.html}]]></content:encoded></item>`)
    .join('')}</channel></rss>`;
}

export const TRANSCRIPT_URL = 'https://www.microsoft.com/en-us/investor/events/example-call';
export const LIVE_TRANSCRIPT: CuratedTranscript = {
  sourceId: 'example-call', url: TRANSCRIPT_URL, title: '예시소프트 실적 발표 통화 기록(가상)', sourceOrg: 'Microsoft Investor Relations',
  transcriptTitle: 'Example Soft FY26 Second Quarter Earnings Conference Call',
  companyId: 'msft', speakerLabel: 'LEO GRANT', speakerName: 'Leo Grant',
  eventDate: '2026-01-28', eventDateExcerpt: 'Wednesday January 28, 2026', recordingExcerpt: 'webcast live and recorded',
  topicId: '클라우드 / 데이터센터',
  quotes: ['The key metric we are optimizing for is efficiency per dollar', 'We expect demand to keep growing all year'],
};

/** 실제 IR 페이지 구조를 흉내 낸 가상 페이지: 머리 영역의 다른 날짜, 탐색 영역, h1 제목, 참가자·날짜 단락, 화자 단락, Q&A, END */
export function transcriptPage(opts: { dateParagraph?: string | null; recording?: boolean; title?: string; swapSpeaker?: boolean; related?: boolean; bodyDate?: boolean; nextLabel?: string; participants?: string; headerAttack?: string } = {}): string {
  const date = opts.dateParagraph === undefined ? 'Wednesday January 28, 2026' : opts.dateParagraph;
  const leo = opts.swapSpeaker ? 'ANNA LEE' : 'LEO GRANT';
  const anna = opts.swapSpeaker ? 'LEO GRANT' : 'ANNA LEE';
  return `<html><head><title>${opts.title ?? 'Example Soft FY26 Second Quarter Earnings Conference Call'}</title>
<meta name="event" content="Wednesday January 28, 2026"></head><body>
<nav>Investor events · Wednesday October 21, 2026 · FY27 Q1 call</nav>
${opts.related ? '<div class="cmp-text related"><p>Related events</p><p>Example Soft FY26 Second Quarter Earnings Conference Call</p><p>Wednesday January 28, 2026</p></div>' : ''}
<div class="container"><div class="cmp-text"><h1>${opts.title ?? 'Example Soft FY26 Second Quarter Earnings Conference Call'}</h1></div>
<div class="cmp-text text-break">${opts.headerAttack
    // 머리(참가자·날짜 단락) 없이 다른 화자가 다른 행사 날짜를 말하고, 녹음 문구는 OPERATOR 발언 안에만 있는 반례
    ? `<p><strong>${opts.headerAttack}: </strong>A different event was on Wednesday January 28, 2026.</p>\n<p><strong>OPERATOR: </strong>This call is being webcast live and recorded.</p>`
    : `<p>${opts.participants ?? 'Leo Grant, Chief Executive Officer; Anna Lee, Chief Financial Officer'}</p>${date ? `<p>${date}</p>` : ''}
<p>${opts.recording === false ? 'This call is available online.' : 'This call is being webcast live and recorded.'}</p>`}
<p><strong>${leo}: </strong>Thank you all for joining. The key metric we are optimizing for is efficiency per dollar, and we keep improving it.</p>
${opts.nextLabel ? `<p><strong>${opts.nextLabel}: </strong>Thanks, Leo. One more point on that.</p>` : ''}
<p>We expect demand to keep growing all year. That is our plan.</p>
<p><strong>${anna}: </strong>Thanks. Revenue grew, and I will cover the details.</p>
<p><strong>KEITH WRIGHT: </strong>Can you talk about margins?</p>
<p><strong>${leo}: </strong>Sure. Margins depend on mix${opts.bodyDate ? ', as we said on Wednesday January 28, 2026' : ''}.</p>
<p>END</p></div></div>
<footer>Wednesday January 28, 2026 archive</footer></body></html>`;
}
