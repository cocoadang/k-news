// 임시 점검 v3: 운영 파서로 실제 사이트 끝까지 (출처별 단계)
import { createFetchText, createFetchBytes } from '../server/ceo/fetchText';
import { DISCOVERY_PROVIDERS, discoveryAllowedHosts, discoveryPdfHosts, parseDiscoveryIndex, discoveredArticle, extractDiscoveredQuotes, pershingLetterArticle } from '../server/ceo/officialSource';
import { pdfToText } from '../server/ceo/pdfText';
const id = process.env.PROBE || '';
const note = (m: string) => console.log(`::notice::${m.replace(/\n/g, ' ').slice(0, 900)}`);
const clean = (s: string) => s.replace(/\s+/g, ' ').slice(0, 200);
(async () => {
  if (id === 'dalio-alt') {
    const ft = createFetchText({ allowHosts: ['www.economicprinciples.org', 'economicprinciples.org', 'www.principles.com', 'principles.com', 'www.linkedin.com'] });
    for (const u of ['https://www.economicprinciples.org/sitemap.xml', 'https://www.economicprinciples.org/', 'https://www.principles.com/sitemap.xml', 'https://www.linkedin.com/in/raydalio/recent-activity/articles/']) {
      try { const t = await ft(u, { deadline: Date.now() + 15000 }); note(`${u} bytes=${t.length} locs=${(t.match(/<loc>[^<]+/g) || []).length} sample=${clean((t.match(/<loc>[^<]+/g) || []).slice(0, 8).join(' ') || t.replace(/<[^>]+>/g, ' ').slice(0, 300))}`); }
      catch (e: any) { note(`${u} ERROR ${e?.message || e}`); }
    }
    return;
  }
  const p = DISCOVERY_PROVIDERS.find(x => x.id === id)!;
  const ft = createFetchText({ allowHosts: discoveryAllowedHosts() });
  const fb = createFetchBytes({ allowHosts: discoveryPdfHosts(), maxBytes: 20_000_000, timeoutMs: 25_000 });
  const now = Date.now();
  const html = await ft(p.index, { deadline: Date.now() + 20000 });
  const r = parseDiscoveryIndex(p, html, p.index);
  note(`[${id}] articles=${r.articles.length} indexes=${r.indexes.length}: ${r.articles.map(a => a.url.replace(/^https:\/\/[^/]+/, '') + (a.filedAt ? '@' + a.filedAt : '')).slice(0, 8).join(' | ')}`);
  for (const c of r.articles.slice(0, 4)) {
    try {
      if (p.mode === 'pdf-list') {
        const text = await pdfToText(await fb(c.url, { deadline: Date.now() + 25000 }), { maxPages: 60 });
        const a = pershingLetterArticle(p, c, text, now);
        const start = text.search(/To the Shareholders of Pershing|Dear (?:Fellow )?(?:Shareholders|Investors)/i);
        const sg = /Sincerely,?\s*(?:\n\s*)?(William A\. Ackman|Bill Ackman)/i.exec(text);
        note(`[${id}] ${c.title} len=${text.length} start=${start} sign=${sg?.index ?? -1} article=${!!a} ${a ? '' : 'near-start=' + clean(text.slice(Math.max(0, start), start + 200)) + ' near-sincerely=' + clean(text.slice(Math.max(0, text.search(/Sincerely/i) - 50), text.search(/Sincerely/i) + 120))}`);
        if (a) { const rows = await extractDiscoveredQuotes(a); note(`[${id}] quotes=${rows.length} date=${a.publishedAt} e.g. ${clean(rows[0]?.quoteText || '')} || ${clean(rows[1]?.quoteText || '')}`); }
      } else {
        const ah = await ft(c.url, { deadline: Date.now() + 20000 });
        const a = discoveredArticle(p, c.url, ah, now);
        if (!a) { note(`[${id}] FAIL ${c.url}`); continue; }
        const rows = await extractDiscoveredQuotes(a);
        note(`[${id}] OK ${a.title} @${a.publishedAt?.slice(0, 10)} quotes=${rows.length} e.g. ${clean(rows[0]?.quoteText || '')}`);
      }
    } catch (e: any) { note(`[${id}] error ${c.url}: ${e?.message || e}`); }
  }
  if (r.indexes[0]) { const h2 = await ft(r.indexes[0], { deadline: Date.now() + 20000 }); const r2 = parseDiscoveryIndex(p, h2, r.indexes[0]); note(`[${id}] page2 ${r.indexes[0]} articles=${r2.articles.length}`); }
})();
