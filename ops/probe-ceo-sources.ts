// 임시 점검 v2: 페이지 구조 확인 (단계별 ::notice 10개 제한 → PROBE 단계별 실행)
import { createFetchText } from '../server/ceo/fetchText';
const step = process.env.PROBE || '';
const ft = createFetchText({ allowHosts: ['blog.samaltman.com', 'darioamodei.com', 'www.darioamodei.com', 'raydalio.substack.com', 'substack.com'] });
const note = (m: string) => console.log(`::notice::${m.replace(/\n/g, ' ').slice(0, 1000)}`);
const clean = (s: string) => s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/\s+/g, ' ');
const get = async (u: string) => { try { const t = await ft(u, { deadline: Date.now() + 20000 }); return t; } catch (e: any) { note(`${u} ERROR ${e?.message || e}`); return ''; } };
(async () => {
  if (step === 'altman') {
    const h = await get('https://blog.samaltman.com/abundant-intelligence');
    note(`h1/h2: ${[...h.matchAll(/<(h[12])\b([^>]*)>([\s\S]*?)<\/h[12]>/gi)].map(m => m[1] + m[2].slice(0, 40) + '=' + clean(m[3]).slice(0, 60)).join(' || ')}`);
    note(`date-ish classes: ${[...h.matchAll(/<[^>]*class=["'][^"']*(?:date|time|posted)[^"']*["'][^>]*>[\s\S]{0,160}/gi)].map(m => clean(m[0]).slice(0, 160)).slice(0, 4).join(' || ')}`);
    note(`months: ${(clean(h).match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4}\b/g) || []).slice(0, 6).join(' | ')} article=${(h.match(/<article\b/gi) || []).length} meta=${(h.match(/<meta[^>]+(?:published|date)[^>]*>/gi) || []).slice(0, 3).join(' ')}`);
    const i = clean(h).indexOf('Abundant'); note(`around title: ${clean(h).slice(Math.max(0, i - 200), i + 700)}`);
  }
  if (step === 'amodei') {
    const s = await get('https://darioamodei.com/sitemap.xml');
    note(`sitemap bytes=${s.length} locs=${(s.match(/<loc>[^<]+/g) || []).slice(0, 12).join(' ')}`);
    const e = await get('https://darioamodei.com/essay/machines-of-loving-grace');
    note(`essay bytes=${e.length} h1=${(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(e)?.[1] || '').replace(/<[^>]+>/g, '').slice(0, 80)} meta=${(e.match(/<meta[^>]+(?:published|date)[^>]*>/gi) || []).slice(0, 3).join(' ')} ldjson=${/application\/ld\+json/.test(e)}`);
    note(`months: ${(clean(e).match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d{1,2},? \d{4}\b/g) || []).slice(0, 6).join(' | ')} time=${(/<time\b[^>]*>/i.exec(e)?.[0] || '')}`);
    const t = clean(e); const i = t.indexOf('Machines of Loving Grace'); note(`around: ${t.slice(Math.max(0, i - 200), i + 600)}`);
  }
  if (step === 'dalio') {
    for (const u of ['https://raydalio.substack.com/feed', 'https://raydalio.substack.com/api/v1/archive?sort=new&offset=0&limit=12', 'https://raydalio.substack.com/sitemap.xml', 'https://raydalio.substack.com/archive']) {
      const t = await get(u); note(`${u} bytes=${t.length} head=${clean(t).slice(0, 300)}`);
    }
  }
})();
