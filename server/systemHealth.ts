const economies = ['USA', 'CHN', 'EUU', 'JPN', 'IND', 'KOR', 'WLD'];
const indicators = ['NY.GDP.MKTP.CD', 'NY.GDP.MKTP.KD.ZG', 'SL.GDP.PCAP.EM.KD', 'BX.KLT.DINV.CD.WD', 'BX.PEF.TOTL.CD.WD'];
const debtId = 'GC.DOD.TOTL.GD.ZS';
const fredIds = ['CP', 'NFCI', 'DTWEXBGS', 'A191RL1Q225SBEA'] as const;
type Observation = { date: string; value: number };
type WorldBankRow = { date: string; value: number | null; obs_status?: string; countryiso3code: string; indicator: { id: string } };

async function source(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Economic data source returned ${response.status}`);
  return response;
}

async function latestFred(id: typeof fredIds[number], collectedAt: string): Promise<Observation> {
  const start = Number(collectedAt.slice(0, 4)) - 1;
  const response = await source(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}-01-01`);
  const [header, ...rows] = (await response.text()).trim().split(/\r?\n/);
  if (!header.endsWith(`,${id}`)) throw new Error(`Unexpected FRED header for ${id}`);
  for (const row of rows.reverse()) {
    const [date, raw] = row.split(',');
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= collectedAt && raw?.trim() && Number.isFinite(Number(raw))) {
      return { date, value: Number(raw) };
    }
  }
  throw new Error(`Missing FRED observation for ${id}`);
}

export async function fetchSystemHealth() {
  const collectedAt = new Date().toISOString();
  const currentYear = Number(collectedAt.slice(0, 4));
  const request = `https://api.worldbank.org/v2/country/${economies.join(';')}/indicator/${[...indicators, debtId].join(';')}?source=2&format=json&date=2022:${currentYear}&per_page=500`;
  const [wdiResponse, ...fred] = await Promise.all([source(request), ...fredIds.map(id => latestFred(id, collectedAt))] as const);
  const [metadata, records] = await wdiResponse.json() as [{ lastupdated: string; pages: number }, WorldBankRow[]];
  if (metadata?.pages !== 1 || !metadata.lastupdated || !Array.isArray(records)) throw new Error('Incomplete World Bank response');
  const rows = records.filter(row => typeof row.value === 'number' && Number.isFinite(row.value) && row.obs_status !== 'F');
  const values = new Map(rows.map(row => [`${row.countryiso3code}:${row.indicator.id}:${row.date}`, row.value]));
  const years = [...new Set(rows.filter(row => indicators.includes(row.indicator.id)).map(row => Number(row.date)))].sort((a, b) => a - b);
  const worldBank = Object.fromEntries(economies.map(code => [
    code, years.map(year => indicators.map(id => values.get(`${code}:${id}:${year}`) ?? null)),
  ]));
  const latestYear = [...years].reverse().find(year => economies.every(code => values.has(`${code}:${indicators[0]}:${year}`)));
  if (latestYear === undefined) throw new Error('Missing comparable GDP observations');
  const debt = rows.filter(row => row.countryiso3code === 'USA' && row.indicator.id === debtId).sort((a, b) => b.date.localeCompare(a.date))[0];
  return { collectedAt, updated: metadata.lastupdated, years, latestYear, worldBank,
    us: { profits: fred[0], nfci: fred[1], dollar: fred[2], growth: fred[3], debt: debt ? {date: debt.date, value: debt.value} : null } };
}
