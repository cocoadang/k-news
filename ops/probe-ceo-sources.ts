// 임시 점검: 실제 사이트를 운영과 같은 요청기·파서로 열어 결과를 GitHub 주석(::notice)으로 출력
import { createFetchText, createFetchBytes } from '../server/ceo/fetchText';
import { DISCOVERY_PROVIDERS, discoveryAllowedHosts, discoveryPdfHosts, parseDiscoveryIndex, discoveredArticle, extractDiscoveredQuotes, pershingLetterArticle } from '../server/ceo/officialSource';
import { pdfToText } from '../server/ceo/pdfText';

const ids = (process.env.PROBE_IDS || 'altman-blog,amodei-essays,dalio-substack,pershing-letters').split(',');
const ft = createFetchText({ allowHosts: discoveryAllowedHosts() });
const fb = createFetchBytes({ allowHosts: discoveryPdfHosts(), maxBytes: 20_000_000, timeoutMs: 25_000 });
const note = (m: string) => console.log(`::notice::${m.replace(/\n/g, ' ').slice(0, 900)}`);
const clean = (s: string) => s.replace(/\s+/g, ' ').slice(0, 160);

(async () => {
  const now = Date.now();
  for (const id of ids) {
    const p = DISCOVERY_PROVIDERS.find(x => x.id === id)!;
    try {
      const html = await ft(p.index, { deadline: Date.now() + 20000 });
      const r = parseDiscoveryIndex(p, html, p.index);
      note(`[${id}] index ${p.index} bytes=${html.length} articles=${r.articles.length} indexes=${r.indexes.length} first=${r.articles.slice(0, 4).map(a => a.url + (a.filedAt ? '@' + a.filedAt : '')).join(' | ')} nextIdx=${r.indexes.slice(0, 3).join(' | ')}`);
      if (!r.articles.length) note(`[${id}] index sample: ${clean(html.slice(0, 900))}`);
      for (const c of r.articles.slice(0, 3)) {
        try {
          if (p.mode === 'pdf-list') {
            const text = await pdfToText(await fb(c.url, { deadline: Date.now() + 25000 }), { maxPages: 60 });
            const a = pershingLetterArticle(p, c, text, now);
            const start = text.search(/To the Shareholders|Dear (?:Fellow )?(?:Shareholders|Investors)/i);
            note(`[${id}] pdf ${c.url} text=${text.length} start=${start} sign=${/Sincerely,?\s*(William A\. Ackman|Bill Ackman)/i.test(text)} article=${!!a} date=${a?.publishedAt}`);
            if (a) { const rows = await extractDiscoveredQuotes(a); note(`[${id}] quotes=${rows.length} e.g. ${clean(rows[0]?.quoteText || '')}`); }
            else note(`[${id}] pdf head: ${clean(text.slice(Math.max(0, start), Math.max(0, start) + 300))}`);
          } else {
            const ah = await ft(c.url, { deadline: Date.now() + 20000 });
            const a = discoveredArticle(p, c.url, ah, now);
            note(`[${id}] article ${c.url} bytes=${ah.length} parsed=${!!a} title=${clean(a?.title || '')} date=${a?.publishedAt} h1=${/<h1\b/i.test(ah)} time=${(/<time\b[^>]*>/i.exec(ah)?.[0] || '').slice(0, 80)} meta=${/article:published_time|datePublished/i.test(ah)}`);
            if (a) { const rows = await extractDiscoveredQuotes(a); note(`[${id}] quotes=${rows.length} e.g. ${clean(rows[0]?.quoteText || '')}`); }
            else note(`[${id}] article head: ${clean(ah.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').slice(0, 1500))}`);
          }
        } catch (e: any) { note(`[${id}] article error ${c.url}: ${e?.message || e}`); }
      }
    } catch (e: any) { note(`[${id}] index error: ${e?.message || e}`); }
  }
})();
