import {compare} from './driverComparison.mjs';
// Official 2025 aggregates: TAAS police injury crashes and TS vehicle-km.
export const exposureStats={year:2025,crashes:193889,fatalCrashes:2482,vehicleKm:339660000000};
// These bounds are sensitivity choices, NOT observed estimates or confidence limits.
export const rangeDefaults={exposureLow:.5,exposureHigh:2,deathLow:25,deathHigh:100,seriousLow:1,seriousHigh:10,fineLow:1,fineHigh:10};
export function riskRange(input,accidents,bounds=rangeDefaults){
 for(const key of ['exposure','death','serious','fine']){
  const lo=bounds[key+'Low'],hi=bounds[key+'High'];
  if(!Number.isFinite(lo)||!Number.isFinite(hi)||lo<0||hi<lo||hi>(key==='exposure'?10:100))throw new RangeError('범위 입력을 확인하세요');
 }
 if(bounds.seriousHigh+bounds.fineHigh>100)throw new RangeError('비사망 사고 분류 합계가 100%를 넘습니다');
 if(!Number.isFinite(input.mileage)||input.mileage<0||!Number.isFinite(input.multiplier)||input.multiplier<0)throw new RangeError('노출량을 확인하세요');
 const {crashes,fatalCrashes,vehicleKm}=exposureStats;
 const exposure=input.mileage*input.multiplier;
 const scenarios=[];
 for(const k of [bounds.exposureLow,bounds.exposureHigh])for(const d of [bounds.deathLow,bounds.deathHigh])for(const s of [bounds.seriousLow,bounds.seriousHigh])for(const f of [bounds.fineLow,bounds.fineHigh]){
  const lambdas=[fatalCrashes*d/100,(crashes-fatalCrashes)*s/100,(crashes-fatalCrashes)*f/100].map(n=>n/vehicleKm*exposure*k);
  const total=lambdas.reduce((x,y)=>x+y,0),pAny=-Math.expm1(-total);
  const ps=lambdas.map(l=>total?l/total*pAny:0);
  const mapped=accidents.map(a=>({...a,probability:ps[['death','serious','fine'].indexOf(a.id)]*100}));
  scenarios.push({ps,lambdas,calculate:years=>compare({...input,mileage:10000,multiplier:1},mapped,years)});
 }
 const envelope=values=>({low:Math.min(...values),high:Math.max(...values)});
 return {raw:{allLambda:crashes/vehicleKm*exposure,fatalLambda:fatalCrashes/vehicleKm*exposure},
  rows:['death','serious','fine'].map((id,i)=>({id,...envelope(scenarios.map(x=>x.ps[i]))})),
  annualExpected:envelope(scenarios.map(x=>x.calculate(1).expected)),
  projections:[10,20,30].map(years=>({years,difference:envelope(scenarios.map(x=>x.calculate(years).difference))}))};
}
