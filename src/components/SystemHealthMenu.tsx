import React, { useEffect, useState } from 'react';
import type { fetchSystemHealth } from '../../server/systemHealth';

type SystemHealth = Awaited<ReturnType<typeof fetchSystemHealth>>;

const regions = { USA: '미국', CHN: '중국', EUU: 'EU', JPN: '일본', IND: '인도', KOR: '한국' } as const;
type Region = keyof typeof regions;
const seedYears = [2022, 2023, 2024, 2025];
const seedWorldBank: Record<Region | 'WLD', (number | null)[][]> = {"USA":[[26054614000000,2.52421385073222,148959.870283952,425816000000,2586000000],[27811517000000,2.93436322440155,150827.869327123,349697000000,45460000000],[29298013000000,2.79318715363841,153968.886553244,248584000000,307492000000],[30769700000000,2.16138195623856,156983.22001681,307018000000,748760000000]],"CHN":[[18316765021690.2,3.13385438394069,41490.0973232747,190203789092.51,38464324948.92],[18270356654533.2,5.41600334492955,43341.7549241021,51338076801.59,11291258950.41],[18729668435848,4.95830378788091,45833.8320616544,42646542014.57,-12750703764.9],[19498039388042.6,4.95994886240992,48125.7905914578,79979865650.02,35761944465.28]],"EUU":[[17023620598906.4,3.56455510630462,117042.448043554,242728043991.05,14490790343.2052],[18659279022583.3,0.4380089249495,116309.801735632,-234524788475.055,221993133095.386],[19501078750999.4,1.08657885620458,117217.338596448,196214848196.863,715671268388.609],[21243212570163.3,1.53795434836212,119167.837033365,261971191926.971,973484440541.201]],"JPN":[[4447976207314.78,1.33164750653741,87268.6309096929,48153832744.0586,-8289793060.56092],[4384854269961.93,0.720785304749811,87546.4872756228,20007989122.9042,25135296918.8012],[4190008188358.57,-0.240084236041696,86865.5866268669,18874093729.4008,13566220219.8966],[4435162999976.94,1.19311288444599,87888.272953476,45805721094.5082,57424264211.3909]],"IND":[[3249938492013.47,7.6093649776932,21964.7753232287,49940258404.2659,-16572089325.951],[3500906030644.76,7.210224629335,22582.0964727472,28086193530.3979,21427093556.532],[3760813470500.86,7.09927893176518,23429.8477381713,27139853378.1402,-827439999.99999],[3956067115771.63,7.56666179284244,24842.1119490755,40791693366.9814,-18535150000.0001]],"KOR":[[1799363116866.52,2.72756456708991,96960.0305578976,25044700000,-5096200000],[1844800934391.54,1.58301467403629,97026.6007247124,19042300000,11710200000],[1875388209406.8,2.00361101838986,98258.5741422485,12862500000,2385800000],[1872374961553.15,1.00701840291242,99045.9987724777,15804100000,-5754200000]],"WLD":[[102862471365575,3.44001097265658,47984.6244521612,1956914683172.6,null],[107348614073350,2.85938493335971,48571.1283070888,952073859537.851,null],[111669432109121,2.90001340156711,49572.5987251651,1374130881712.05,null],[118350166039396,2.92127318539153,50671.7228169014,1800206355375.76,null]]};
const format = (value: number | null, unit: string, digits = 1) => value === null ? '—' : `${value.toLocaleString('ko-KR', {maximumFractionDigits: digits})}${unit}`;
const scaled = (value: number | null, divisor: number) => value === null ? null : value / divisor;
const sourceLink = 'text-cyan-300 underline underline-offset-2';
const panel = 'rounded-xl border border-slate-700 bg-slate-900 p-4';
const usMetricInfo = {
  growth: { label: '실질 GDP 성장률', value: 3.4, date: '2026-07-01', unit: '%', digits: 2, scale: 1,
    rule: '0%보다 높으면 실질 GDP가 전분기보다 늘었고, 낮으면 줄었습니다.', url: 'https://fred.stlouisfed.org/series/A191RL1Q225SBEA' },
  profits: { label: '기업 이익 (세전)', value: 4280, date: '2026-04-01', unit: '조 달러', digits: 2, scale: 1000,
    rule: '직전 분기와 비교한 명목 세전 이익의 증감입니다. 물가 변화가 포함됩니다.', url: 'https://fred.stlouisfed.org/series/CP' },
  debt: { label: '중앙정부 부채 / GDP', value: 115.8, date: '2024', unit: '%', digits: 1, scale: 1,
    rule: '비율이 오르면 GDP 대비 중앙정부 부채가 늘었다는 뜻입니다. 재정 위험은 이자 부담과 만기 구조도 함께 봐야 합니다.', url: 'https://data.worldbank.org/indicator/GC.DOD.TOTL.GD.ZS?locations=US' },
  nfci: { label: '미국 금융여건 (NFCI)', value: -0.478, date: '2026-11-13', unit: '', digits: 3, scale: 1,
    rule: '0보다 낮으면 평균보다 완화된 금융여건, 높으면 긴축적인 금융여건을 뜻합니다.', url: 'https://fred.stlouisfed.org/series/NFCI' },
  dollar: { label: '광의 달러 지수', value: 122.65, date: '2026-11-13', unit: '', digits: 2, scale: 1,
    rule: '지수가 오르면 무역 상대국 통화에 비해 달러가 강해졌다는 뜻입니다.', url: 'https://fred.stlouisfed.org/series/DTWEXBGS' },
} as const;
type UsMetricKey = keyof typeof usMetricInfo;
const usKeys = Object.keys(usMetricInfo) as UsMetricKey[];

function observationPeriod(key: UsMetricKey, date: string) {
  if (key === 'growth' || key === 'profits') return `${date.slice(0, 4)}년 ${Math.ceil(Number(date.slice(5, 7)) / 3)}분기`;
  return key === 'debt' ? `${date}년` : date;
}

function UsMetrics({ snapshot }: { snapshot?: SystemHealth }) {
  const [selected, setSelected] = useState<UsMetricKey | null>(null);
  const active = selected ? usMetricInfo[selected] : null;
  const history = selected ? snapshot?.usHistory?.[selected] ?? [] : [];
  return <section className={panel}>
    <h2 className="font-semibold">미국 경제·금융 지표</h2>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {usKeys.map(key => {
        const info = usMetricInfo[key];
        const reading = snapshot ? snapshot.us[key] : info;
        return <button key={key} type="button" aria-expanded={selected === key}
          aria-controls={selected === key ? 'us-metric-detail' : undefined}
          className={`min-w-0 rounded-lg border bg-slate-800/70 p-2.5 text-left focus-visible:outline-2 focus-visible:outline-cyan-400 ${selected === key ? 'border-cyan-400' : 'border-transparent hover:border-slate-500'}`}
          onClick={() => setSelected(current => current === key ? null : key)}>
          <span className="block text-xs text-cyan-300">{info.label}</span>
          <strong className="mt-1 block tabular-nums">{format(scaled(reading?.value ?? null, info.scale), info.unit, info.digits)}</strong>
          <span className="mt-1 block text-xs text-slate-400">{reading ? observationPeriod(key, reading.date) : '관측값 없음'}{!snapshot && ' · 저장값'}</span>
        </button>;
      })}
    </div>
    {selected && active && <section id="us-metric-detail" className="mt-3 rounded-lg border border-slate-700 p-3" aria-label={active.label + ' 추이 및 해석'}>
      <h3 className="text-sm font-semibold">{active.label} 추이</h3>
      <p className="mt-1 text-sm leading-6 text-slate-300">{active.rule}</p>
      {history.length > 1 ? <table className="mt-2 w-full text-sm">
        <thead><tr className="border-b border-slate-700 text-slate-400"><th scope="col" className="py-1 text-left">관측 시기</th><th scope="col" className="py-1 text-right">관측값</th></tr></thead>
        <tbody>{[...history].reverse().map(({date, value}) => <tr key={date} className="border-b border-slate-800">
          <th scope="row" className="py-1 text-left font-normal">{observationPeriod(selected, date)}</th>
          <td className="py-1 text-right tabular-nums">{format(scaled(value, active.scale), active.unit, active.digits)}</td>
        </tr>)}</tbody>
      </table> : <p className="mt-2 text-xs text-slate-400">비교할 이전 관측값이 없습니다.</p>}
      <a href={active.url} className={`mt-3 inline-flex min-h-11 items-center text-sm ${sourceLink}`} target="_blank" rel="noopener noreferrer">공식 출처 ↗ {selected === 'debt' ? '세계은행' : 'FRED'}</a>
    </section>}
  </section>;
}
const sections = [
  { title: 'A. 미국 내부 시스템 건전성', rows: [
    ['기업 이익·생산성', 'BEA', 'https://www.bea.gov/'],
    ['주주환원·자본시장', 'SEC EDGAR', 'https://www.sec.gov/edgar/search/'],
    ['재정·국채 신뢰', 'Fiscal Data', 'https://fiscaldata.treasury.gov/'],
    ['달러·통화 신뢰', 'IMF COFER', 'https://data.imf.org/'],
    ['금융시장 스트레스', 'OFR', 'https://www.financialresearch.gov/financial-stress-index/'],
  ] },
  { title: 'B. 국가별 상대 경쟁력', rows: [
    ['실질 GDP 성장률·명목 GDP 점유율', 'IMF WEO', 'https://www.imf.org/en/Publications/WEO/weo-database'],
    ['노동생산성·R&D', 'OECD', 'https://data-explorer.oecd.org/'],
    ['FDI 및 국제수지', 'IMF', 'https://data.imf.org/'],
  ] },
  { title: 'C. 글로벌 자본 이동', rows: [
    ['외국인의 미국 주식·채권 거래', '미국 재무부 TIC', 'https://home.treasury.gov/data/treasury-international-capital-tic-system'],
    ['국가 간 증권 보유잔액', 'IMF PIP', 'https://data.imf.org/'],
    ['미국 MMF 잔액', 'ICI', 'https://www.ici.org/research/stats/mmf'],
  ] },
] as const;

export function SystemHealthMenu() {
  const [selected, setSelected] = useState<Region>('USA');
  const [yearChoice, setYear] = useState<number>();
  const [snapshot, setSnapshot] = useState<SystemHealth>();
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState !== 'visible') return;
      refreshing = true;
      try {
        const response = await fetch('/api/market/system-health', {signal: controller.signal});
        if (!response.ok) throw new Error('System health data unavailable');
        const result: SystemHealth = await response.json();
        if (!controller.signal.aborted) {
          setSnapshot(result);
          setRefreshFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setRefreshFailed(true);
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 300_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const years = snapshot?.years ?? seedYears;
  const worldBank = snapshot?.worldBank ?? seedWorldBank;
  const year = yearChoice !== undefined && years.includes(yearChoice) ? yearChoice : snapshot?.latestYear ?? 2025;
  const index = years.indexOf(year);
  const [gdp, growth, productivity, fdi, equity] = worldBank[selected][index];
  const worldGdp = worldBank.WLD[index][0];
  const metrics = [
    ['실질 GDP 성장률', format(growth, '%', 2), 'NY.GDP.MKTP.KD.ZG'],
    ['명목 GDP', format(scaled(gdp, 1e12), '조 달러', 2), 'NY.GDP.MKTP.CD'],
    ['세계 명목 GDP 비중', format(gdp !== null && worldGdp ? gdp / worldGdp * 100 : null, '%', 2), 'NY.GDP.MKTP.CD'],
    ['취업자 1인당 GDP', format(productivity, ' 국제달러', 0), 'SL.GDP.PCAP.EM.KD'],
    ['외국인 직접투자 순유입', format(scaled(fdi, 1e9), '십억 달러'), 'BX.KLT.DINV.CD.WD'],
    ['포트폴리오 주식 순유입', format(scaled(equity, 1e9), '십억 달러'), 'BX.PEF.TOTL.CD.WD'],
  ];
  const rankings = (column: number) => (Object.keys(regions) as Region[])
    .map(region => ({region, value: worldBank[region][index][column]}))
    .filter((row): row is {region: Region; value: number} => row.value !== null)
    .sort((a, b) => b.value - a.value);
  return (
    <section className="space-y-5 text-slate-100" aria-label="미국 시스템">
      {refreshFailed && <p role="status" className="text-xs text-slate-400">갱신 지연</p>}
      <UsMetrics snapshot={snapshot}/>
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">국가 비교</h2>
          <select aria-label="기준연도" className="rounded border border-slate-600 bg-slate-900 p-1.5 text-xs text-slate-300" value={year} onChange={event => setYear(Number(event.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="국가 선택">
          {(Object.keys(regions) as Region[]).map(r => <button key={r} type="button" aria-pressed={selected === r}
            onClick={() => setSelected(r)}
            className={`rounded-lg border px-3 py-2 text-sm ${selected === r ? 'border-cyan-400 bg-cyan-900 text-white' : 'border-slate-700 text-slate-300'}`}>{regions[r]}</button>)}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={regions[selected] + ' 경제 지표'}>
          {metrics.map(([label, value, id]) => <div key={label} className="min-w-0 rounded-lg bg-slate-800/70 p-2.5">
            <dt className="text-xs"><a className={sourceLink} href={`https://data.worldbank.org/indicator/${id}?locations=${selected}`}>{label}</a></dt>
            <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
          </div>)}
        </dl>
      </section>
      <section className={panel}>
        <h2 className="font-semibold">{year}년 자본 유입 순위</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {([[3, '외국인 직접투자 순유입'], [4, '포트폴리오 주식 순유입']] as const).map(([column, label]) =>
            <div key={column}>
              <h3 className="text-sm font-semibold">{label}</h3>
              <ol className="mt-1 list-decimal pl-6 text-sm">
                {rankings(column).map(({region, value}) => <li key={region} className="border-b border-slate-800 py-1.5">
                  <div className="flex justify-between gap-2"><span>{regions[region]}</span><span className="tabular-nums">{format(value, '')}</span></div>
                </li>)}
              </ol>
            </div>)}
        </div>
      </section>
      {sections.map(section => <section key={section.title} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="mb-3 font-semibold">{section.title}</h2>
        <div className="divide-y divide-slate-800">
          {section.rows.map(([metric, provider, url]) => <div key={metric} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <span>{metric}</span>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline underline-offset-2">{provider} 원문</a>
          </div>)}
        </div>
      </section>)}
    </section>
  );
}
