import React, { useState } from 'react';
import { calculate, defaults } from './driverModel.mjs';

const money = (n:number) => `${(n/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})}만 원`;
const pct = (n:number) => `${(100*n).toFixed(3)}%`;
const panel = 'rounded-2xl border border-slate-700 bg-slate-900 p-4 sm:p-6';
type Inputs = typeof defaults;
function Chart({series, years, title}:{series:{name:string;color:string;values:number[]}[];years:number;title:string}) {
  const [focus,setFocus]=useState(years);
  const index=Math.min(focus,years);
  const all=series.flatMap(s=>s.values); const lo=Math.min(0,...all), hi=Math.max(1,...all), span=hi-lo;
  const x=(i:number)=>70+i/years*620, y=(v:number)=>230-(v-lo)/span*200;
  return <div className={panel}><h3 className="font-bold text-white mb-3">{title}</h3>
    <svg viewBox="0 0 720 270" className="w-full" role="img" aria-label={title+'。아래 표에서 정확한 값을 확인할 수 있습니다.'}>
      {[lo,lo+span/2,hi].map((v,i)=><g key={i}><line x1="70" x2="690" y1={y(v)} y2={y(v)} stroke="#334155"/><text x="62" y={y(v)+4} fill="#cbd5e1" textAnchor="end" fontSize="11">{(v/10000).toFixed(0)}만</text></g>)}
      <line x1="70" x2="690" y1={y(0)} y2={y(0)} stroke="#94a3b8" strokeDasharray="4 4"/>
      {series.map(s=><polyline key={s.name} points={s.values.map((v,i)=>`${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="3"/>)}
      {[0,10,20,30].filter(v=>v<=years).map(v=><text key={v} x={x(v)} y="255" fill="#cbd5e1" textAnchor="middle" fontSize="12">{v}년</text>)}
      <line x1={x(index)} x2={x(index)} y1="30" y2="230" stroke="#e2e8f0" strokeDasharray="3 3"/>
    </svg>
    <label className="text-sm text-slate-300">확인 시점: {index}년<input aria-label={title+' 확인 시점'} type="range" min="0" max={years} value={index} onChange={e=>setFocus(+e.target.value)} className="w-full accent-cyan-400"/></label>
    <div className="flex flex-wrap gap-3 text-sm" aria-live="polite">{series.map(s=><span key={s.name} style={{color:s.color}}>{s.name}: {money(s.values[index])}</span>)}</div>
  </div>;
}
export function DriverInsuranceMenu(){
  const [input,setInput]=useState<Inputs>({...defaults});
  const [years,setYears]=useState(30);
  const [mode,setMode]=useState<'normal'|'risk'>('normal');
  const change=(key:keyof Inputs,value:number)=>setInput(prev=>({...prev,[key]:value}));
  const field=(key:keyof Inputs,label:string,min:number,max:number,step=1)=><label key={key} className="block text-sm text-slate-300">{label}<input type="number" min={min} max={max} step={step} value={input[key]} onChange={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v))change(key,Math.max(min,Math.min(max,v)));}} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white"/></label>;
  const multiplier=mode==='normal'?1:input.multiplier;
  const result=calculate(input,years,multiplier);
  const points=Array.from({length:years+1},(_,y)=>calculate(input,y,multiplier));
  const scenarios=[{name:'일반 운전',mult:1,color:'#67e8f9'},{name:`난폭 가상 ${input.multiplier}배`,mult:input.multiplier,color:'#fbbf24'}];
  return <section className="space-y-5 text-slate-200">
    <div className={panel+' border-cyan-800 bg-gradient-to-br from-cyan-950 to-slate-900'}><p className="text-xs font-bold tracking-widest text-cyan-300">연간 30,000 km · 가정 기반 비교</p><h2 className="mt-2 text-2xl sm:text-3xl font-bold text-white">운전자보험 vs QQQ</h2><p className="mt-3 text-sm leading-6 text-slate-300">매월 같은 예산을 보험료 또는 QQQ에 사용하면 10·20·30년 후 기대 순자산은 어떻게 달라질까요? 사고비용과 실제 보전액을 함께 계산합니다. 보험은 큰 손실에 대비하는 수단이며, 기대값만으로 가입 필요성이 결정되지는 않습니다.</p></div>
    <div className={panel}><h3 className="font-bold text-white">실측 통계와 개인 확률은 다릅니다</h3><p className="mt-2 text-sm leading-6">한국도로교통공단 TAAS의 2024년 경찰접수 사고는 196,349건, 사망자는 2,521명입니다. 사망자 수는 사망사고 건수가 아닙니다. 이 수치로 연 3만 km 개인의 가해·형사책임·보험금 지급 확률을 직접 계산할 수 없습니다.</p><p className="mt-2 text-sm text-amber-200">아래 연 0.1%와 위험배율 3배는 분석용 가정입니다. 난폭 운전 실측 통계나 특정 보험의 지급률이 아닙니다. 연 3만 km 조건에서 사용자가 정한 확률이며, 주행거리에 따른 자동 추정은 하지 않습니다.</p></div>
    <div className="grid lg:grid-cols-[320px_1fr] gap-5">
      <aside className={panel+' space-y-4'}><h3 className="font-bold text-white">가정 변경</h3><div className="grid grid-cols-2 gap-3">
        {field('premium','월 예산 / 보험료 (원)',0,1000000,1000)}{field('probability','일반 연간 대상 사고 확률 (%)',0,100,0.01)}{field('multiplier','난폭 가상 위험배율',1,20,0.5)}{field('returnRate','QQQ 연 수익률 (%)',-90,50,0.5)}{field('costGrowth','사고지출 기회비용률 (%)',-50,50,0.5)}{field('eligibility','조건부 지급 비율 (%)',0,100,5)}
      </div><p className="text-xs leading-5 text-slate-400">대상 사고는 아래 법률비용이 발생하는 가상 사고입니다. 조건부 지급 비율은 면책 등을 반영해 보전액을 줄이는 가정이며 실측 지급률이 아닙니다.</p>
      <h4 className="font-semibold">사고당 비용 / 보전액 (만원)</h4><div className="grid grid-cols-2 gap-3">{field('settlement','형사합의금',0,100000)}{field('settlementCover','합의금 보전액',0,100000)}{field('lawyer','변호사비',0,100000)}{field('lawyerCover','변호사비 보전액',0,100000)}{field('fine','벌금',0,100000)}{field('fineCover','벌금 보전액',0,100000)}</div>
      <button type="button" onClick={()=>setInput({...defaults})} className="rounded-lg bg-slate-700 px-4 py-2 text-sm">기본 가정 복원</button></aside>
      <div className="space-y-5"><div className="flex flex-wrap gap-2">{[10,20,30].map(y=><button key={y} aria-pressed={years===y} onClick={()=>setYears(y)} className={`rounded-lg px-4 py-2 ${years===y?'bg-cyan-700':'bg-slate-800'}`}>{y}년</button>)}<select aria-label="자산 비교 운전 유형" value={mode} onChange={e=>setMode(e.target.value as 'normal'|'risk')} className="rounded-lg bg-slate-800 px-3 py-2"><option value="normal">일반 운전</option><option value="risk">난폭 운전 (가상)</option></select></div>
      <div className="grid sm:grid-cols-3 gap-3" aria-live="polite">{[['보험 가입 순자산',money(result.insurance)],['QQQ 순자산',money(result.qqq)],['QQQ − 보험',money(result.difference)]].map(([label,value])=><div key={label} className={panel}><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-xl font-bold text-white">{value}</p></div>)}</div>
      <Chart years={years} title="사고비용 차감 후 기대 순자산" series={[{name:'보험 가입',color:'#a5b4fc',values:points.map(p=>p.insurance)},{name:'QQQ 적립',color:'#67e8f9',values:points.map(p=>p.qqq)}]}/>
      <Chart years={years} title="운전 유형별 QQQ − 보험 기대 순자산 차이" series={scenarios.map(s=>({...s,values:Array.from({length:years+1},(_,y)=>calculate(input,y,s.mult).difference)}))}/>
      </div></div>
    <div className={panel}><h3 className="font-bold text-white">사고 확률 · 가상 시나리오</h3><div className="mt-4 space-y-4">{scenarios.map(s=>{const r=calculate(input,years,s.mult);return <div key={s.name}><div className="flex flex-wrap justify-between gap-2 text-sm"><span>{s.name}</span><span>연간 {pct(r.p)} · {years}년 내 1회 이상 {pct(r.cumulative)}</span></div><div className="h-3 rounded bg-slate-800 mt-2"><div className="h-3 rounded" style={{width:`${r.cumulative*100}%`,background:s.color}}/></div></div>;})}</div><p className="mt-3 text-xs text-slate-400">매년 독립·동일 확률, 연 최대 1회 사고를 가정합니다. 누적 확률 = 1 − (1 − p)^년수. 반복 사고 비용은 각 연도의 기대비용에 반영합니다.</p></div>
    <div className={panel+' overflow-x-auto'}><h3 className="font-bold mb-4 text-white">10 / 20 / 30년 검산표 · {mode==='normal'?'일반 운전':'난폭 운전 (가상)'}</h3><table className="w-full text-sm whitespace-nowrap text-right"><thead><tr className="text-slate-400"><th className="text-left p-2">항목</th>{[10,20,30].map(y=><th key={y} className="p-2">{y}년</th>)}</tr></thead><tbody>{[['납입 예산 누적','premiums'],['QQQ 사고 전 평가액','investment'],['미가입 사고비용 (환산)','uninsuredLoss'],['가입 후 본인부담 (환산)','insuredLoss'],['보험 가입 순자산','insurance'],['QQQ 순자산','qqq'],['QQQ − 보험','difference']].map(([label,key])=><tr key={key} className="border-t border-slate-800"><th className="p-2 text-left font-normal">{label}</th>{[10,20,30].map(y=><td key={y} className="p-2">{money(calculate(input,y,multiplier)[key])}</td>)}</tr>)}</tbody></table></div>
    <div className={panel+' text-sm leading-7'}><h3 className="font-bold text-white">보장·계산 기준</h3><p>사고당 총비용 {money(result.cost)}, 조건을 반영한 보전액 {money(result.cover)}, 가입 후 본인부담 {money(result.cost-result.cover)}. 각 보전액은 해당 비용을 넘지 않게 제한합니다. 기본값 4,000만 / 3,800만 / 200만 원은 가상 사례이며 상품 견적·평균 청구액·약정 한도가 아닙니다.</p><p>형사합의금은 모든 사고에 의무적으로 발생하지 않습니다. 실제 보장은 특약·가입시기·수사단계·자기부담·지급조건에 따라 달라집니다. 음주·무면허·도주·약물 사고 등의 면책을 확인해야 하며, 위험배율을 높였다고 보장이 확대되지 않습니다. 면책 사고를 비교하려면 지급 비율을 0%로 설정하세요.</p>
    <details className="mt-3"><summary className="cursor-pointer text-cyan-300">동일 계산식과 이전 수치 정정 근거</summary><div className="mt-3 space-y-2"><p>시작 자산 0원, 동일한 월 예산 M, 월말 적립입니다. 보험은 예산을 모두 보험료로 사용하므로 별도 적립자산이 없습니다. 보험 순자산에서 보험료를 다시 차감하지 않습니다. 만기환급금은 0원으로 가정합니다.</p><p>월 수익률 i = (1+r)^(1/12)−1, QQQ 평가액 F = M×((1+i)^(12T)−1)/i. 연말 사고지출 환산계수 A = ((1+g)^T−1)/g (금리가 0이면 각각 12T와 T).</p><p>총비용 C, 보전액 B일 때 보험 = −p(C−B)A, QQQ = F−pCA, 차이 = F−pBA. 모든 그래프와 표는 이 계산식을 공유합니다. 기본 g=0%는 지출의 단순 누적이며, g=r로 바꾸면 사고지출의 투자 기회비용까지 같은 수익률로 기간 말에 환산합니다. 음수는 추가 외부자금 부담을 뜻하며 실제 대출잔액 예측은 아닙니다.</p><p>이전 대화의 연 8%를 8%/12로 계산한 값과 연 유효수익률을 혼용한 문제, 단순 누적·복리 환산을 섞은 문제를 제거했습니다. 세금·환율·물가·수수료·보험료 변경·투자 변동성·파산/자금부족은 모형에 포함하지 않습니다. r은 비용 차감 후 원화 기준 일정 수익률 가정이며 QQQ 수익 보장이 아닙니다. 사고가 먼저 발생하면 적립액만으로 비용을 지급하지 못할 수 있습니다.</p></div></details></div>
    <div className={panel+' text-sm leading-7'}><h3 className="font-bold text-white">출처 · 확인일 2026-11-13</h3><ul className="list-disc pl-5 text-cyan-300"><li><a href="https://taas.koroad.or.kr/sta/acs/gus/selectTfcacdOccrrncSttus.do?menuId=WEB_KMP_OVT_TAC_TOS" target="_blank" rel="noreferrer">한국도로교통공단 TAAS · 2024 사고·사망자 통계</a></li><li><a href="https://d.samsungfire.com/html/productInfo/PRD030301.html" target="_blank" rel="noreferrer">삼성화재 다이렉트 · 보장 조건 및 면책 안내 (상품 예시)</a></li><li><a href="https://www.invesco.com/qqq-etf/en/about.html" target="_blank" rel="noreferrer">Invesco QQQ · 상품 및 투자위험 안내</a></li></ul><p className="text-slate-400 mt-2">통계는 참고 배경으로만 사용합니다. 확률·비용·보전액·수익률·위험배율은 모두 변경 가능한 가정이며 실측 통계에서 추정한 값이 아닙니다.</p></div>
  </section>;
}
