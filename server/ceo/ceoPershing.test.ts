import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_PROVIDERS, discoveryArticleAllowed, extractDiscoveredQuotes, parseDiscoveryIndex, pershingLetterArticle } from './officialSource';
import { itemsToParagraphs, pdfToText } from './pdfText';

const p = DISCOVERY_PROVIDERS.find(x => x.id === 'pershing-letters')!;
const NOW = Date.parse('2026-11-07T00:00:00Z');
const A = 'https://assets.pershingsquareholdings.com/wp-content/uploads/2026/02/18175039/Pershing-Square-Holdings-Ltd.-2025-Annual-Report.pdf';

/** 손으로 만드는 최소 PDF (Helvetica, 줄 단위 텍스트, 빈 문자열 = 문단 간격) */
function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  let y = 760; const ops: string[] = ['BT', '/F1 10 Tf'];
  for (const l of lines) { if (l === '') { y -= 22; continue; } ops.push(`1 0 0 1 60 ${y} Tm (${esc(l)}) Tj`); y -= 12; }
  ops.push('ET');
  const stream = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n'; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

test('lines with a wider gap become separate paragraphs', () => {
  const it = (s: string, y: number) => ({ str: s, x: 60, y, h: 10, eol: true });
  assert.deepEqual(itemsToParagraphs([it('First line of one', 700), it('paragraph continues.', 688), it('Second para- graph here.', 660)]), ['First line of one paragraph continues.', 'Second paragraph here.']);
});

test('media JSON list: annual/interim letters kept, newest re-upload wins, fact sheets dropped', () => {
  const j = JSON.stringify([
    { date: '2024-03-10T10:00:00', source_url: 'https://assets.pershingsquareholdings.com/wp-content/uploads/2024/03/10/Pershing-Square-Holdings-Ltd.-2023-Annual-Report-1.pdf', title: { rendered: 'Pershing-Square-Holdings-Ltd.-2023-Annual-Report-1' } },
    { date: '2024-03-01T10:00:00', source_url: 'https://assets.pershingsquareholdings.com/wp-content/uploads/2024/03/01/Pershing-Square-Holdings-Ltd.-2023-Annual-Report.pdf', title: { rendered: 'Pershing-Square-Holdings-Ltd.-2023-Annual-Report' } },
    { date: '2026-08-12T10:00:00', source_url: 'https://assets.pershingsquareholdings.com/wp-content/uploads/2026/08/13002306/Pershing-Square-Holdings-Ltd.-June-2026-Interim.pdf', title: { rendered: 'Pershing-Square-Holdings-Ltd.-June-2026-Interim' } },
    { date: '2026-07-23T10:00:00', source_url: 'https://assets.pershingsquareholdings.com/wp-content/uploads/2026/07/23144307/PSH-Fact-Sheet-June-2026-Website.pdf', title: { rendered: 'PSH-Fact-Sheet-June-2026-Website' } },
  ]);
  const r = parseDiscoveryIndex(p, j, p.index).articles;
  assert.deepEqual(r.map(x => x.filedAt).sort(), ['2024-03-10', '2026-08-12'], 'in-period upload kept, newest re-upload wins');
  assert.ok(r.some(x => /Annual-Report-1\.pdf$/.test(x.url)));
});

test('letter dates: in-period upload kept, migration upload replaced by listed date, unknown → null', async () => {
  const { pershingLetterDate } = await import('./officialSource');
  assert.equal(pershingLetterDate('Pershing Square Holdings Ltd. June 2025 Interim', '2025-08-20'), '2025-08-20');
  assert.equal(pershingLetterDate('Pershing Square Holdings Ltd. 2022 Annual Report', '2025-02-20'), '2023-03-29');
  assert.equal(pershingLetterDate('Pershing Square Holdings, Ltd. – 2027 (Annual Report)', '2028-02-20'), '2028-02-20');
  assert.equal(pershingLetterDate('Pershing Square Holdings Ltd. 2018 Annual Report', '2025-02-20'), null);
});

test('materials list: letters and reports kept with their listed date, fact sheets dropped', () => {
  const html = `<div class="item"><span>Feb 18, 2026</span><a href="${A}#page=9">Letter to Shareholders in the 2025 Annual Report</a></div>
  <div class="item"><span>Feb 18, 2026</span><a href="${A}">2025 Annual Report</a></div>
  <div class="item"><span>Oct 14, 2026</span><a href="https://assets.pershingsquareholdings.com/wp-content/uploads/2026/10/14141351/PSH-Fact-Sheet-September-2026-Website.pdf">September 2026 Fact Sheet</a></div>
  <div class="item"><span>Jan 1, 2026</span><a href="https://evil.example/wp-content/uploads/x.pdf">Annual Report</a></div>`;
  const r = parseDiscoveryIndex(p, html, p.index);
  assert.equal(r.articles.length, 1);
  assert.equal(r.articles[0].url, A);
  assert.equal(r.articles[0].filedAt, '2026-02-18');
  assert.ok(discoveryArticleAllowed(p, A));
  assert.ok(!discoveryArticleAllowed(p, 'https://pershingsquareholdings.com/x.pdf'));
});

test('signed letter PDF → Ackman authored paragraphs; unsigned → nothing', async () => {
  const letter = [
    'Pershing Square Holdings, Ltd. 2025 Annual Report', '',
    'To the Shareholders of Pershing Square Holdings, Ltd.:', '',
    'We are pleased to report that our net asset value per share increased this year, and our returns',
    'again outperformed the S&P 500 index thanks to our concentrated portfolio of durable businesses.', '',
    'Our investment in Alphabet benefited from strong cloud growth and we believe the company remains',
    'one of the most attractive long-term investments in our portfolio given its predictable cash flow.', '',
    'We continue to believe that interest rates will remain elevated for longer than the market expects, and',
    'we have structured our hedges to protect the portfolio from a rise in long-term Treasury yields.', '',
    'Sincerely,', 'William A. Ackman',
  ];
  const text = await pdfToText(makePdf(letter));
  assert.match(text, /To the Shareholders of Pershing Square Holdings/);
  const a = pershingLetterArticle(p, { url: A, title: 'Letter to Shareholders in the 2025 Annual Report', filedAt: '2026-02-18' }, text, NOW)!;
  assert.ok(a, 'letter parsed');
  assert.equal(a.publishedAt, '2026-02-18T00:00:00.000Z');
  assert.equal(a.publishedAtBasis?.kind, 'written');
  assert.ok(!/Sincerely/.test(a.body));
  const rows = await extractDiscoveredQuotes(a);
  assert.ok(rows.length >= 2, 'two paragraphs');
  assert.ok(rows.every(r => r.speaker.name === 'Bill Ackman' && r.speaker.companyId === 'pershing' && r.sourceType === 'authored_post'));
  assert.ok(rows.some(r => /Alphabet/.test(r.quoteText || '')));

  const unsigned = await pdfToText(makePdf(letter.slice(0, -2)));
  assert.equal(pershingLetterArticle(p, { url: A, title: 'x', filedAt: '2026-02-18' }, unsigned, NOW), null);
  assert.equal(pershingLetterArticle(p, { url: A, title: 'x' }, text, NOW), null, 'no listed date → skip');
});
