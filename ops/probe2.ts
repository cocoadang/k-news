import { createFetchText } from '../server/ceo/fetchText';
const note = (m: string) => console.log(`::notice::${m.replace(/\n/g, ' ').slice(0, 1000)}`);
const ft = createFetchText({ allowHosts: ['pershingsquareholdings.com'] });
const J = async (u: string) => JSON.parse(await ft(u, { deadline: Date.now() + 20000 }));
(async () => {
  const j = await J('https://pershingsquareholdings.com/wp-json/wp/v2/materials?materials_category=68&per_page=100');
  const picks = j.filter((x: any) => /2019 Annual|2017 Annual|2020$/.test(x.title.rendered));
  for (const x of picks.slice(0, 3)) {
    const m = await J(`https://pershingsquareholdings.com/wp-json/wp/v2/media?parent=${x.id}&per_page=20`).catch(() => []);
    note(`${x.title.rendered} id=${x.id} media=${m.map((y: any) => y.source_url).join(' ')}`);
  }
  let all: any[] = [];
  for (let page = 1; page <= 6; page++) { try { const m = await J(`https://pershingsquareholdings.com/wp-json/wp/v2/media?mime_type=application%2Fpdf&per_page=100&page=${page}`); all = all.concat(m); if (m.length < 100) break; } catch { break; } }
  const rep = all.filter((y: any) => /annual|interim|semi|report|ar[-_]?\d|20(1[4-9]|2[01])/i.test(y.source_url) && !/fact|presentation|statement|transparency|performance|notice|portfolio|nav|dividend/i.test(y.source_url));
  note(`pdf media total=${all.length} report-like=${rep.length}: ${rep.map((y: any) => y.source_url.split('/').pop() + '@' + y.date.slice(0, 10)).join(' | ').slice(0, 900)}`);
})();
