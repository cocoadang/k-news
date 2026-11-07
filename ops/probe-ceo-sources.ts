import { createFetchText } from '../server/ceo/fetchText';
const id = process.env.PROBE || '';
const note = (m: string) => console.log(`::notice::${m.replace(/\n/g, ' ').slice(0, 1000)}`);
const clean = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const ft = createFetchText({ allowHosts: ['pershingsquareholdings.com', 'www.economicprinciples.org', 'economicprinciples.org'] });
const get = async (u: string) => { try { return await ft(u, { deadline: Date.now() + 20000 }); } catch (e: any) { note(`${u} ERROR ${e?.message || e}`); return ''; } };
(async () => {
  if (id === 'psh') {
    const t = await get('https://pershingsquareholdings.com/wp-json/wp/v2/types');
    note(`types: ${t ? Object.keys(JSON.parse(t)).join(',') : ''}`);
    const m = await get('https://pershingsquareholdings.com/materials/');
    note(`materials pdf links=${(m.match(/\.pdf/g) || []).length} ajax=${(m.match(/admin-ajax\.php|wp-json\/[\w/-]+|data-[a-z-]*page[a-z-]*=["'][^"']+/gi) || []).slice(0, 8).join(' ')}`);
    note(`year/cat options: ${(m.match(/<option[^>]*value=["'][^"']*["'][^>]*>[^<]{1,40}/gi) || []).slice(0, 30).map(x => x.replace(/<option[^>]*value=/i, '')).join(' ')}`);
    for (const u of ['https://pershingsquareholdings.com/materials/page/2/', 'https://pershingsquareholdings.com/materials/?myear=2021', 'https://pershingsquareholdings.com/wp-json/wp/v2/media?search=Annual%20Report&per_page=50&mime_type=application/pdf']) {
      const x = await get(u); note(`${u} bytes=${x.length} pdfs=${[...new Set(x.match(/[\w.-]+(?:Annual-Report|Interim)[\w.-]*\.pdf/gi) || [])].slice(0, 20).join(' ')}`);
    }
  }
  if (id === 'ep') {
    const s = await get('https://www.economicprinciples.org/sitemap.xml');
    const locs = (s.match(/<loc>[^<]+/g) || []).map(x => x.slice(5)).filter(u => !/\/(?:de|es|fr|it|ja|ko|pt|zh|ru|ar|tr|id|vi|pl|nl|hi|he|uk|th|ms)(?:-[a-z]+)?\//i.test(u));
    note(`en locs=${locs.length} sample=${locs.slice(0, 25).join(' ')}`);
    const pick = locs.find(u => /\/(?:article|insight|blog|post|news|writing)/i.test(u)) || locs[10];
    const a = await get(pick); note(`${pick} bytes=${a.length} title=${/<title>([^<]*)/i.exec(a)?.[1]} time=${(/<time\b[^>]*>/i.exec(a)?.[0] || '')} meta=${(a.match(/<meta[^>]+(?:published|date|author)[^>]*>/gi) || []).slice(0, 3).join(' ')} text=${clean(a).slice(0, 400)}`);
  }
})();
