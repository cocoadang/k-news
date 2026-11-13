import React,{useState} from 'react';
import {riskRange,rangeDefaults,exposureStats} from './exposureRiskModel.mjs';
import {compare,comparisonDefaults,accidentDefaults} from './driverComparison.mjs';
const pct=(p:number)=>(p*100).toLocaleString('ko-KR',{maximumFractionDigits:6})+'%';
const won=(n:number)=>Math.round(n).toLocaleString('ko-KR')+'원';
type Bounds=typeof rangeDefaults;
export function DriverRiskRange({input,accidents}:{input:typeof comparisonDefaults;accidents:typeof accidentDefaults}){
 const [bounds,setBounds]=useState<Bounds>({...rangeDefaults});
 const result=riskRange(input,accidents,bounds),old=compare(input,accidents,1);
 const update=(key:keyof Bounds,value:number)=>{
  const next={...bounds};const low=key.endsWith('Low'),base=key.replace(/Low|High/g,'');
  const otherKey=(base+(low?'High':'Low')) as keyof Bounds;
  let max=base==='exposure'?10:100;
  if(base==='serious'||base==='fine')max=100-next[(base==='serious'?'fineHigh':'seriousHigh') as keyof Bounds];
  next[key]=Math.min(max,Math.max(0,value));
  if(low&&next[key]>next[otherKey])next[otherKey]=next[key];
  if(!low&&next[key]<next[otherKey])next[otherKey]=next[key];
  setBounds(next);
 };
 const names={exposure:'전국 평균과 운전 조건 차이 (배)',death:'사망사고 중 가해·보장 대상 비율 (%)',serious:'비사망 사고 중 중상해 보장 대상 비율 (%)',fine:'비사망 사고 중 벌금형만 분류할 비율 (%)'};
 const span=(r:{low:number;high:number},format=pct)=>format(r.low)+' ~ '+format(r.high);
 return <div className="rounded-xl border border-emerald-700 bg-emerald-950/20 p-4 mt-5 space-y-4 text-sm leading-6">
 <h4 className="font-bold text-lg text-emerald-200">주행거리 기반 추정 범위 · 공식 통계 + 추가 가정</h4>
 <p>2025년 TAAS 사고 {exposureStats.crashes.toLocaleString('ko-KR')}건(사망사고 {exposureStats.fatalCrashes.toLocaleString('ko-KR')}건) ÷ TS 총주행거리 <strong>3,396.6억 km</strong>. 같은 연도 자료를 결합했습니다. 사망자·중상자 수를 사고 건수로 바꾸지 않습니다.</p>
 <p><a className="text-cyan-300 underline" target="_blank" rel="noreferrer" href="https://main.kotsa.or.kr/portal/bbs/report_view.do?bbscCode=report&bbscSeqn=18886&menuCode=05010200">TS 2025년 자동차주행거리 원자료 · 2026-06-29 발표</a></p>
 <p>현재 부부 합산 {input.mileage.toLocaleString('ko-KR')}km, 위험배율 {input.multiplier}배 기준의 단순 노출 빈도: 전체 인적피해 사고 <strong>{result.raw.allLambda.toFixed(6)}건/년</strong>, 사망사고 <strong>{result.raw.fatalLambda.toFixed(8)}건/년</strong>. 빈도는 확률·보험금 지급률이 아닙니다. 각자 실제 운전한 거리만 합산하며 같은 차의 동승 거리는 중복 집계하지 않습니다. 이미 합산 거리이므로 2인이라고 다시 2배 하지 않습니다.</p>
 <p className="text-amber-200"><strong>범위 폭도 가정입니다.</strong> 아래 기본값은 결과가 얼마나 달라지는지 살피는 넓은 민감도 시나리오로, 연구로 검증된 개인 위험 범위나 95% 신뢰구간이 아닙니다. 실제 확률은 범위 밖일 수 있고, 보장 대상 비율은 0%일 수도 있습니다.</p>
 <div className="grid sm:grid-cols-2 gap-4">{(['exposure','death','serious','fine'] as const).map(base=><fieldset key={base} className="border border-slate-700 rounded-lg p-3"><legend>{names[base]} · 추가 가정</legend><div className="grid grid-cols-2 gap-3">{(['Low','High'] as const).map(side=>{const key=(base+side) as keyof Bounds;return <label key={side}>{side==='Low'?'하한':'상한'}<input aria-label={names[base]+' '+(side==='Low'?'하한':'상한')} type="number" min="0" max={base==='exposure'?10:100} step={base==='exposure'?.1:1} value={bounds[key]} className="block mt-1 w-full bg-slate-950 border border-slate-600 rounded p-2" onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))update(key,e.target.valueAsNumber);}}/></label>;})}</div></fieldset>)}</div>
 <button className="rounded bg-slate-700 px-3 py-2" onClick={()=>setBounds({...rangeDefaults})}>추정 범위 가정 복원</button>
 <p>조건 차이 0.5~2배는 차종·지역·도로·운전 습관과 통계 범위 차이를 한 계수로 단순화한 가정입니다. TAAS에는 TS 자동차 주행거리 분모와 정확히 일치하지 않는 차종 등이 포함될 수 있습니다. 이 계수가 그 차이를 검증해 보정했다는 뜻은 아닙니다. 운전 조건이 바뀌어도 km당 빈도가 일정하다고 가정합니다.</p>
 <p>사망사고 25~100%는 가해 책임·보장 요건 충족 비율, 비사망 사고의 중상해·벌금형 각 1~10%는 통계로 확인하지 못한 분류 비율입니다. 중상해와 벌금형만인 사고는 서로 겹치지 않게 배분하고, 사망·중상해에 동반된 벌금은 해당 사고 총비용에 포함한다는 가정입니다. 두 비사망 분류의 상한 합계는 100% 이하로 제한합니다.</p>
 <div className="overflow-x-auto"><table className="min-w-[600px] w-full text-left"><caption className="text-left text-slate-400">추정 연간 확률과 현재 원래 가정 비교 · 입력 거리/위험배율에 동기화</caption><thead><tr><th className="p-2">유형</th><th className="p-2">원래 가정 (현재값)</th><th className="p-2">추정 시나리오 범위</th><th className="p-2">위치</th></tr></thead><tbody>{result.rows.map(r=>{const a=old.rows.find(x=>x.id===r.id)!;return <tr key={r.id} className="border-t border-slate-700"><th className="p-2">{a.name}</th><td className="p-2">{pct(a.p)}</td><td className="p-2">{span(r)}</td><td className="p-2">{a.p<r.low?'범위보다 낮음':a.p>r.high?'범위보다 높음':'범위 안'}</td></tr>;})}</tbody></table></div>
 <p>λ유형 = 공식 사고건수 ÷ 공식 총주행거리 × 합산 주행거리 × 위험배율 × 조건 차이 × 대상 비율. 포아송 발생과 세 유형의 경쟁을 가정해 연간 첫 보장 대상 사고 확률 p유형 = (λ유형/Σλ) × (1−exp(−Σλ))로 환산합니다. 연간 최대 한 번만 비용을 반영하며 반복 사고는 제외합니다. 16개 가정 조합을 모두 계산해 유형별 최솟값·최댓값을 표시하므로 각 유형의 끝값이 같은 조합을 뜻하지 않을 수 있습니다.</p>
 <div className="overflow-x-auto"><table className="min-w-[600px] w-full text-left"><caption className="text-left text-slate-400">추정 범위로 본 경제적 영향 · 현재 비용·한도·자기부담·지급 비율·QQQ 수익률 사용</caption><thead><tr><th className="p-2">항목</th><th className="p-2">원래 가정</th><th className="p-2">16개 시나리오의 범위</th></tr></thead><tbody><tr className="border-t border-slate-700"><th className="p-2">연간 기대 보험금</th><td className="p-2">{won(old.expected)}</td><td className="p-2">{span(result.annualExpected,won)}</td></tr>{result.projections.map(r=><tr key={r.years} className="border-t border-slate-700"><th className="p-2">{r.years}년 QQQ − 보험 기대 순자산 차이</th><td className="p-2">{won(compare(input,accidents,r.years).difference)}</td><td className="p-2">{span(r.difference,won)}</td></tr>)}</tbody></table></div>
 <p>아래 기존 그래프는 원래 가정을 계속 사용합니다. 이 추정 범위 표는 별도 비교이며 자동으로 원래 확률을 덮어쓰지 않습니다. 추정 범위를 적용해도 사고비용과 보험금 자체는 여전히 가정입니다.</p>
 </div>;
}
