import React, { useEffect, useState } from 'react';
import type { fetchSystemHealth } from '../../server/systemHealth';

type SystemHealth = Awaited<ReturnType<typeof fetchSystemHealth>>;

const regions = { USA: '미국', CHN: '중국', EUU: 'EU', JPN: '일본', IND: '인도', KOR: '한국' } as const;
type Region = keyof typeof regions;
const seedYears = [2022, 2023, 2024, 2025];
const seedWorldBank: Record<Region | 'WLD', (number | null)[][]> = {"USA":[[26054614000000,2.52421385073222,148959.870283952,425816000000,2586000000],[27811517000000,2.93436322440155,150827.869327123,349697000000,45460000000],[29298013000000,2.79318715363841,153968.886553244,248584000000,307492000000],[30769700000000,2.16138195623856,156983.22001681,307018000000,748760000000]],"CHN":[[18316765021690.2,3.13385438394069,41490.0973232747,190203789092.51,38464324948.92],[18270356654533.2,5.41600334492955,43341.7549241021,51338076801.59,11291258950.41],[18729668435848,4.95830378788091,45833.8320616544,42646542014.57,-12750703764.9],[19498039388042.6,4.95994886240992,48125.7905914578,79979865650.02,35761944465.28]],"EUU":[[17023620598906.4,3.56455510630462,117042.448043554,242728043991.05,14490790343.2052],[18659279022583.3,0.4380089249495,116309.801735632,-234524788475.055,221993133095.386],[19501078750999.4,1.08657885620458,117217.338596448,196214848196.863,715671268388.609],[21243212570163.3,1.53795434836212,119167.837033365,261971191926.971,973484440541.201]],"JPN":[[4447976207314.78,1.33164750653741,87268.6309096929,48153832744.0586,-8289793060.56092],[4384854269961.93,0.720785304749811,87546.4872756228,20007989122.9042,25135296918.8012],[4190008188358.57,-0.240084236041696,86865.5866268669,18874093729.4008,13566220219.8966],[4435162999976.94,1.19311288444599,87888.272953476,45805721094.5082,57424264211.3909]],"IND":[[3249938492013.47,7.6093649776932,21964.7753232287,49940258404.2659,-16572089325.951],[3500906030644.76,7.210224629335,22582.0964727472,28086193530.3979,21427093556.532],[3760813470500.86,7.09927893176518,23429.8477381713,27139853378.1402,-827439999.99999],[3956067115771.63,7.56666179284244,24842.1119490755,40791693366.9814,-18535150000.0001]],"KOR":[[1799363116866.52,2.72756456708991,96960.0305578976,25044700000,-5096200000],[1844800934391.54,1.58301467403629,97026.6007247124,19042300000,11710200000],[1875388209406.8,2.00361101838986,98258.5741422485,12862500000,2385800000],[1872374961553.15,1.00701840291242,99045.9987724777,15804100000,-5754200000]],"WLD":[[102862471365575,3.44001097265658,47984.6244521612,1956914683172.6,null],[107348614073350,2.85938493335971,48571.1283070888,952073859537.851,null],[111669432109121,2.90001340156711,49572.5987251651,1374130881712.05,null],[118350166039396,2.92127318539153,50671.7228169014,1800206355375.76,null]]};
const seedUpdated = '2026-11-11';
const format = (value: number | null, unit: string, digits = 1) => value === null ? '—' : `${value.toLocaleString('ko-KR', {maximumFractionDigits: digits})}${unit}`;
const scaled = (value: number | null, divisor: number) => value === null ? null : value / divisor;
const sourceLink = 'text-cyan-300 underline underline-offset-2';
const panel = 'rounded-xl border border-slate-700 bg-slate-900 p-4';
const seedUsMetrics = [
  ['실질 GDP 성장률', '3.4%', '2026년 3분기 · 전분기 대비 연율', 'https://fred.stlouisfed.org/series/A191RL1Q225SBEA'],
  ['기업 이익 (세전)', '4.28조 달러', '2026년 2분기 · 연율', 'https://fred.stlouisfed.org/series/CP'],
  ['중앙정부 부채 / GDP', '115.8%', '2024년', 'https://data.worldbank.org/indicator/GC.DOD.TOTL.GD.ZS?locations=US'],
  ['미국 금융여건 (NFCI)', '-0.478', '2026-11-13 · 0은 장기 평균', 'https://fred.stlouisfed.org/series/NFCI'],
  ['광의 달러 지수', '122.65', '2026-11-13 · 2006년 1월=100', 'https://fred.stlouisfed.org/series/DTWEXBGS'],
] as const;
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
  const updated = snapshot?.updated ?? seedUpdated;
  const year = yearChoice !== undefined && years.includes(yearChoice) ? yearChoice : snapshot?.latestYear ?? 2025;
  const quarter = (date: string) => `${date.slice(0, 4)}년 ${Math.ceil(Number(date.slice(5, 7)) / 3)}분기`;
  const us = snapshot?.us;
  const usMetrics = us ? [
    ['실질 GDP 성장률', format(us.growth.value, '%', 2), `${quarter(us.growth.date)} · 전분기 대비 연율`, seedUsMetrics[0][3]],
    ['기업 이익 (세전)', format(us.profits.value / 1000, '조 달러', 2), `${quarter(us.profits.date)} · 연율`, seedUsMetrics[1][3]],
    ['중앙정부 부채 / GDP', format(us.debt?.value ?? null, '%'), us.debt ? `${us.debt.date}년` : '자료 없음', seedUsMetrics[2][3]],
    ['미국 금융여건 (NFCI)', format(us.nfci.value, '', 3), `${us.nfci.date} · 0은 장기 평균`, seedUsMetrics[3][3]],
    ['광의 달러 지수', format(us.dollar.value, '', 2), `${us.dollar.date} · 2006년 1월=100`, seedUsMetrics[4][3]],
  ] : seedUsMetrics;
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
    <section className="space-y-5 text-slate-100">
      <header className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h1 className="text-xl font-bold">미국 시스템 건전성</h1>
        <p className="mt-2 text-sm text-slate-300">장기 경쟁력 · 국가별 상대 성장 · 국제 자본 흐름</p>
        <p className="mt-2 text-xs text-slate-400">최근 수집 {snapshot ? new Date(snapshot.collectedAt).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}) : '2026-11-21'} · 세계은행 WDI 갱신일 {updated}{refreshFailed ? ' · 갱신 지연' : ''}</p>
      </header>
      <section className={panel}>
        <h2 className="font-semibold">미국 경제·금융 지표</h2>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {usMetrics.map(([label, value, period, url]) => <div key={label} className="min-w-0 rounded-lg bg-slate-800/70 p-2.5">
            <dt className="text-xs"><a href={url} className={sourceLink}>{label}</a></dt>
            <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
            <dd className="mt-1 text-xs text-slate-400">{period}</dd>
          </div>)}
        </dl>
      </section>
      <section className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">국가 비교</h2>
          <label className="flex items-center gap-2 text-xs text-slate-300">기준연도
            <select className="rounded border border-slate-600 bg-slate-900 p-1.5" value={year} onChange={event => setYear(Number(event.target.value))}>
              {years.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="국가 선택">
          {(Object.keys(regions) as Region[]).map(r => <button key={r} type="button" aria-pressed={selected === r}
            onClick={() => setSelected(r)}
            className={`rounded-lg border px-3 py-2 text-sm ${selected === r ? 'border-cyan-400 bg-cyan-900 text-white' : 'border-slate-700 text-slate-300'}`}>{regions[r]}</button>)}
        </div>
        <p className="mt-3 text-xs text-slate-400">세계은행 연간 관측치 기준입니다. 최신 연도는 경제권별로 공개 시점이 다를 수 있습니다.</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label={regions[selected] + ' 경제 지표'}>
          {metrics.map(([label, value, id]) => <div key={label} className="min-w-0 rounded-lg bg-slate-800/70 p-2.5">
            <dt className="text-xs"><a className={sourceLink} href={`https://data.worldbank.org/indicator/${id}?locations=${selected}`}>{label}</a></dt>
            <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
          </div>)}
        </dl>
        <p className="mt-2 text-xs text-slate-400">취업자 1인당 GDP는 2021년 불변 구매력 기준입니다. —는 해당 연도 자료 미제공입니다.</p>
      </section>
      <section className={panel}>
        <h2 className="font-semibold">{year}년 자본 유입 순위</h2>
        <p className="mt-1 text-xs text-slate-400">비교 대상 6개 경제권 중 자료가 있는 곳의 순위 · 십억 달러</p>
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
      <p className="text-xs leading-relaxed text-slate-400">해석 주의: 펀드 유출입에는 개인·기관 자금이 함께 포함될 수 있으며 전체 국가 간 자본 이동을 뜻하지 않습니다. 보유잔액 변동은 환율·가격 효과를 포함합니다. 공식 국제수지 흐름과 펀드 흐름은 합산하지 않습니다.</p>
    </section>
  );
}
