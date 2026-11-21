import React, { useState } from 'react';

const regions = ['미국', '중국', 'EU', '일본', '인도', '한국'];
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
  const [selected, setSelected] = useState('미국');
  return (
    <section className="space-y-5 text-slate-100">
      <header className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h1 className="text-xl font-bold">미국 시스템 건전성</h1>
        <p className="mt-2 text-sm text-slate-300">장기 경쟁력 · 국가별 상대 성장 · 국제 자본 흐름</p>
        <p className="mt-3 rounded-lg bg-slate-800 p-3 text-sm text-amber-200" role="status">
          데이터 연결 준비 중 — 실제 수치·점수·자금 유입 순위는 아직 제공하지 않습니다. 공식 원문에서 확인하세요.
        </p>
      </header>
      <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
        <h2 className="font-semibold">국가 비교 대상</h2>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="국가 선택">
          {regions.map(r => <button key={r} type="button" aria-pressed={selected === r}
            onClick={() => setSelected(r)}
            className={`rounded-lg border px-3 py-2 text-sm ${selected === r ? 'border-cyan-400 bg-cyan-900 text-white' : 'border-slate-700 text-slate-300'}`}>{r}</button>)}
        </div>
        <p className="mt-3 text-sm text-slate-400">{selected} 비교 지표: 실질 GDP 성장률, 세계 명목 GDP 비중, 생산성, FDI, 포트폴리오 자본 흐름. 동일 기준연도·통화·자료 갱신일 확인 후 비교합니다.</p>
      </div>
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
