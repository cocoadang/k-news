import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDiscoveredArticles, DISCOVERY_PROVIDERS, DISCOVERY_YEARS, DiscoveryProvider, discoveredArticle, extractDiscoveredQuotes, parseDiscoveryIndex } from './officialSource';
import { availableNano, emptyKoState, KO_HARD_LIMIT_NANO } from './koLedger';
import { koPriority } from './koPriority';
import { CEO_PERSONS, CEO_ROLES } from './registry';

// 본인 채널 형태 시험용(Substack은 클라우드 IP에 403이라 운영 출처에서는 뺌 — 달리오는 X로 수집)
const dalio: DiscoveryProvider = { id: 'test-authored', companyId: 'bridgewater', personId: 'ray-dalio', name: '레이 달리오 공식 Substack', index: 'https://raydalio.substack.com/sitemap.xml', mode: 'sitemap', host: 'raydalio.substack.com', articlePath: /^\/p\/[a-z0-9-]+$/, authored: true };
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
  assert.ok(DISCOVERY_PROVIDERS.filter(p => p.authored).every(p => p.years === 10), 'authored sources 10 years');
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

test('AI CEOs: providers registered; authored date fallback from <time> or one date under the title', async () => {
  for (const [id, person] of [['altman-blog-v2', 'sam-altman'], ['amodei-essays-v2', 'dario-amodei']]) {
    const p = DISCOVERY_PROVIDERS.find(x => x.id === id)!;
    assert.ok(p && p.authored && p.personId === person);
    assert.ok(CEO_PERSONS.some(x => x.personId === person) && CEO_ROLES.some(r => r.personId === person));
  }
  const alt = DISCOVERY_PROVIDERS.find(x => x.id === 'altman-blog-v2')!;
  const page = `<html><body><article><h1>The Gentle Singularity</h1><div>June 10, 2025</div>
  <p>We are past the event horizon; the takeoff has started. Humanity is close to building digital superintelligence, and at least so far it is much less weird than it seems like it should be.</p>
  <p>Data center production will get automated and the cost of compute will converge to near the cost of electricity, which makes abundant intelligence possible for everyone in the world.</p></article></body></html>`;
  const a = discoveredArticle(alt, 'https://blog.samaltman.com/the-gentle-singularity', page, NOW)!;
  assert.ok(a, 'parsed without meta date');
  assert.equal(a.publishedAt, '2025-06-10T00:00:00.000Z');
  const rows = await extractDiscoveredQuotes(a);
  assert.ok(rows.length >= 2 && rows.every(r => r.speaker.name === 'Sam Altman' && r.speaker.companyId === 'openai'));
  assert.equal(discoveredArticle(alt, 'https://blog.samaltman.com/x', page.replace('June 10, 2025', 'June 10, 2025 and May 1, 2024'), NOW), null, 'two dates → no guess');
  assert.ok(parseDiscoveryIndex(alt, '<a href="/?page=2">Older</a><a href="/the-gentle-singularity">x</a><a href="/tagged/ai">t</a>', alt.index).indexes.includes('https://blog.samaltman.com/?page=2'));
});

test('authored blog post passes the full pipeline (date and channel provenance verifiable in text)', async () => {
  const { createCompositeExtractor } = await import('./runtime');
  const { CURATED_TRANSCRIPTS } = await import('./transcripts');
  const { CURATED_PAGES } = await import('./officialPages');
  const { CEO_TOPICS } = await import('./registry');
  const { buildCeoDataset, emptyCeoCache, refreshCeoCache } = await import('./pipeline');
  const { ceoUrlHash } = await import('./urlHash');
  const alt = DISCOVERY_PROVIDERS.find(x => x.id === 'altman-blog-v2')!;
  const page = `<html><head><meta property="og:title" content="The Gentle Singularity"></head><body><article><h2>The Gentle Singularity</h2><span class="posthaven-formatted-date" data-unix-time="1749571200"></span>
  <p>We are past the event horizon; the takeoff has started. Humanity is close to building digital superintelligence, and at least so far it is much less weird than it seems like it should be.</p>
  <p>Data center production will get automated and the cost of compute will converge to near the cost of electricity, which makes abundant intelligence possible for everyone in the world.</p></article></body></html>`;
  const a0 = discoveredArticle(alt, 'https://blog.samaltman.com/the-gentle-singularity', page, NOW)!;
  const a = { ...a0, articleId: ceoUrlHash(a0.url) };
  const ex = createCompositeExtractor(CEO_PERSONS, CURATED_TRANSCRIPTS, CURATED_PAGES);
  const { cache } = await refreshCeoCache([a], emptyCeoCache(), ex);
  const built: any = await buildCeoDataset([a], cache, { persons: CEO_PERSONS, roles: CEO_ROLES, topics: CEO_TOPICS }, { extractor: ex });
  assert.equal(built.dataset.heldBackCount, 0, JSON.stringify(built.report?.issues));
  assert.equal(built.dataset.statements.length, 2);
  assert.ok(built.dataset.statements.every((s: any) => s.personId === 'sam-altman' && s.companyId === 'openai' && s.evidence[0].articlePublishedAt?.startsWith('2025-06-10')));
});

test('all eight people have a publisher transcript route; corporate prose is not authored',()=>{
 for(const p of CEO_PERSONS) assert.ok(DISCOVERY_PROVIDERS.some(s=>s.personId===p.personId&&s.interview),p.personId);
 for(const id of ['openai-news','anthropic-news']) assert.equal(!!DISCOVERY_PROVIDERS.find(p=>p.id===id)?.authored,false);
});
test('publisher sibling interview retains Dario and distinguishes publication from speaking date',async()=>{
 const p=DISCOVERY_PROVIDERS.find(p=>p.id==='cnbc-interviews-v2-dario-amodei')!;
 const url='https://pressroom.versantmedia.com/cnbc/press-releases/dario-amodei-interview';
 const a=discoveredArticle(p,url,'<meta property="article:published_time" content="2026-11-19"><h1>Fictional interview test</h1><p>November 19, 2026</p><p>DARIO AMODEI: We intend to fund future growth through several different sources of capital.</p><p>DANIELA AMODEI: We intend to triple revenue over the coming year.</p><p>SORKIN: What is your plan for the next round of funding?</p>',Date.parse('2026-11-20'))!;
 assert.ok(a);const rows=await extractDiscoveredQuotes(a);
 assert.equal(rows.length,1);assert.match(rows[0].quoteText!,/capital/);
 assert.equal(rows[0].spokenAt.value,null);assert.equal(rows[0].referenceDate?.value,'2026-11-19');
});

test('verified interview seeds share three company reads before generic corporate backlog',async()=>{
 const ids=['anthropic-news','amodei-dwarkesh-interviews','amodei-lex-interviews','cnbc-interviews-v2-dario-amodei'];
 const providers=ids.map(id=>DISCOVERY_PROVIDERS.find(p=>p.id===id)!);
 const seeds=new Set(providers.flatMap(p=>p.seedUrls||[])),calls:string[]=[];
 const page='<meta property="article:published_time" content="2026-11-19"><h1>Fictional capital interview</h1><p>DARIO AMODEI: We intend to fund future growth through several different sources of capital.</p><p>HOST: What will happen in the coming year as new products enter the market?</p>';
 const now=Date.parse('2026-11-20T00:00:00Z');
 const r=await loadDiscoveredArticles({providers,existing:[],now:()=>now,deadline:now+120000,parseFeed:async()=>[],fetchText:async url=>{
   calls.push(url);if(seeds.has(url))return page;
   return '<urlset><url><loc>https://www.anthropic.com/news/fictional-corporate-backlog</loc></url></urlset>';
 }});
 assert.equal(r.articles.length,3,JSON.stringify(r.reports));
 assert.ok([...seeds].every(url=>r.articles.some(a=>a.url===url)));
 assert.ok(!calls.includes('https://www.anthropic.com/news/fictional-corporate-backlog'));
 assert.equal(r.reports.reduce((n,p)=>n+p.matchedExisting,0),3);
});

test('publisher date survives markup padding beyond the old 4000-byte header window',()=>{
 const p=DISCOVERY_PROVIDERS.find(p=>p.id==='cnbc-interviews-v2-dario-amodei')!;
 const html='<h1>Fictional transcript with a large layout</h1><div data-layout="'+('x'.repeat(5000))+'"></div><p>November 19, 2026</p><p>DARIO AMODEI: Our investment strategy emphasizes sustainable business growth and reliable service for customers.</p><p>HOST: What will you be doing next year as the market changes?</p>';
 const a=discoveredArticle(p,'https://pressroom.versantmedia.com/cnbc/press-releases/dario-amodei-test',html,Date.parse('2026-11-20'));
 assert.ok(a);assert.equal(a.publishedAt,'2026-11-19T00:00:00.000Z');
});
