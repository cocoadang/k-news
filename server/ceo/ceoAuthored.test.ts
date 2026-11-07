import test from 'node:test';
import assert from 'node:assert/strict';
import { DISCOVERY_PROVIDERS, DISCOVERY_YEARS, discoveredArticle, extractDiscoveredQuotes, parseDiscoveryIndex } from './officialSource';
import { availableNano, emptyKoState, KO_HARD_LIMIT_NANO } from './koLedger';
import { koPriority } from './koPriority';
import { CEO_PERSONS, CEO_ROLES } from './registry';

const dalio = DISCOVERY_PROVIDERS.find(p => p.id === 'dalio-substack')!;
const NOW = Date.parse('2026-11-07T00:00:00Z');

const para = (t: string) => `<p>${t}</p>`;
const html = `<html><head><meta property="article:published_time" content="2026-10-20T12:00:00.000Z"></head><body>
<article><h1 class="post-title">The Big Debt Cycle Is Late</h1><div>Oct 20, 2026</div>
${para('This is a long introductory paragraph about my background and why I am writing this post today for all of you who asked.')}
${para('The United States is running large deficits and its debt is rising faster than incomes, which is a classic late stage of the long-term debt cycle.')}
${para('In such times central banks tend to print money, which devalues currencies relative to gold, so holding some gold in a diversified portfolio makes sense.')}
${para('“Short quote”, said someone else in a meeting that I attended, which should not be used as my own words.')}
</article></body></html>`;

test('six-year window and new investors registered', () => {
  assert.equal(DISCOVERY_YEARS, 6);
  for (const id of ['ray-dalio', 'bill-ackman']) {
    assert.ok(CEO_PERSONS.some(p => p.personId === id));
    assert.ok(CEO_ROLES.some(r => r.personId === id));
  }
  assert.ok(dalio && dalio.authored && dalio.personId === 'ray-dalio' && dalio.companyId === 'bridgewater');
});

test('substack sitemap: posts and yearly sub-sitemaps accepted, other paths ignored', () => {
  const xml = `<urlset><url><loc>https://raydalio.substack.com/p/the-big-debt-cycle</loc><lastmod>2026-10-20</lastmod></url>
  <url><loc>https://raydalio.substack.com/about</loc></url><url><loc>https://evil.example/p/x</loc></url></urlset>`;
  const r = parseDiscoveryIndex(dalio, xml, dalio.index);
  assert.deepEqual(r.articles.map(a => a.url), ['https://raydalio.substack.com/p/the-big-debt-cycle']);
  const idx = parseDiscoveryIndex(dalio, `<sitemapindex><sitemap><loc>https://raydalio.substack.com/sitemap/2025</loc></sitemap></sitemapindex>`, dalio.index);
  assert.deepEqual(idx.indexes, ['https://raydalio.substack.com/sitemap/2025']);
});

test('authored channel post: author = channel, written date, relevant paragraphs first, no third-party quotes', async () => {
  const a = discoveredArticle(dalio, 'https://raydalio.substack.com/p/the-big-debt-cycle', html, NOW)!;
  assert.ok(a, 'article parsed');
  assert.equal(a.discoveryAuthor?.name, 'Ray Dalio');
  assert.equal(a.publishedAt, '2026-10-20T00:00:00.000Z');
  assert.equal(a.publishedAtBasis?.kind, 'written');
  const rows = await extractDiscoveredQuotes(a);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every(r => r.sourceType === 'authored_post' && r.speaker.companyId === 'bridgewater'));
  assert.ok(rows.some(r => /deficits/.test(r.quoteText || '')));
  assert.ok(rows.some(r => /gold/.test(r.quoteText || '')));
  assert.ok(!rows.some(r => /Short quote/.test(r.quoteText || '')), 'quoted third-party text excluded');
});

test('Korean summary: monthly cap stays USD 1; question-matched and newer statements are translated first', () => {
  const s = { ...emptyKoState(), enabled: true };
  assert.equal(availableNano(s, '2026-12'), KO_HARD_LIMIT_NANO);
  const st = (id: string, text: string, date: string | null) => ({ statementId: id, companyId: 'bridgewater', quoteText: text, kind: 'direct_quote', spokenAt: { value: date, precision: date ? 'day' : 'unknown' } } as any);
  const order = koPriority([st('a', 'I like cooking dinner with my family on weekends.', '2026-10-01'), st('b', 'Gold is a good diversifier.', '2021-01-01'), st('c', 'The debt cycle is late.', '2025-05-01'), st('d', 'Nothing classified here at all.', null)]).map(x => x.statementId);
  assert.deepEqual(order, ['c', 'b', 'a', 'd']);
});
