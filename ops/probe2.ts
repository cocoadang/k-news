import { createFetchText } from '../server/ceo/fetchText';
const note = (m: string) => console.log(`::notice::${m.replace(/\n/g, ' ').slice(0, 1000)}`);
const ft = createFetchText({ allowHosts: ['pershingsquareholdings.com'] });
(async () => {
  for (const u of ['https://pershingsquareholdings.com/wp-json/wp/v2/materials?per_page=100&page=1', 'https://pershingsquareholdings.com/wp-json/wp/v2/media?search=Annual&mime_type=application%2Fpdf&per_page=100', 'https://pershingsquareholdings.com/wp-json/wp/v2/media?search=Interim&mime_type=application%2Fpdf&per_page=100']) {
    try {
      const t = await ft(u, { deadline: Date.now() + 20000 }); const j = JSON.parse(t);
      note(`${u.slice(45)} n=${j.length} keys=${Object.keys(j[0] || {}).slice(0, 25).join(',')}`);
      note(`items: ${j.map((x: any) => (x.title?.rendered || '').slice(0, 50) + '@' + String(x.date).slice(0, 10)).join(' | ').slice(0, 950)}`);
      if (j[0]?.acf || j[0]?.meta) note(`acf/meta sample: ${JSON.stringify(j[0].acf || j[0].meta).slice(0, 600)}`);
      if (/materials/.test(u)) note(`content sample: ${JSON.stringify(j.find((x: any) => /annual|interim|letter/i.test(x.title?.rendered || '')) || j[0]).slice(0, 900)}`);
    } catch (e: any) { note(`${u} ERROR ${e?.message || e}`); }
  }
})();
