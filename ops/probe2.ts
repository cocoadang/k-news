import { createFetchText } from '../server/ceo/fetchText';
const note = (m: string) => console.log(`::notice::${m.replace(/\n/g, ' ').slice(0, 1000)}`);
const ft = createFetchText({ allowHosts: ['pershingsquareholdings.com'] });
(async () => {
  const t = await ft('https://pershingsquareholdings.com/wp-json/wp/v2/materials?materials_category=68&per_page=100', { deadline: Date.now() + 20000 });
  const j = JSON.parse(t);
  note(`cat68 n=${j.length}: ${j.map((x: any) => x.title.rendered.replace(/Financial Statements|Including|Investment Manager.s Report/g, '').slice(0, 30) + '@' + x.date.slice(0, 10)).join(' | ').slice(0, 950)}`);
  const old = j.filter((x: any) => /Investment Manager|Annual Report/i.test(x.title.rendered)).slice(-2);
  for (const x of [j[0], ...old]) {
    const h = await ft(x.link, { deadline: Date.now() + 20000 }).catch((e: any) => 'ERR ' + e.message);
    note(`${x.link} bytes=${h.length} pdfs=${[...new Set(h.match(/https?:\/\/[^"' ]+\.pdf/gi) || [])].slice(0, 4).join(' ')}`);
  }
})();
