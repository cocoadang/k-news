import { annuity } from './driverModel.mjs';
export const comparisonDefaults = {premium:15000, mileage:10000, multiplier:1, eligibility:100, returnRate:13};
// Household annual probabilities at 10,000 combined km: illustrative, not empirical.
export const accidentDefaults = [
 {id:'death',name:'사망',probability:0.0002,cost:10500,limit:10500,deductible:0},
 {id:'serious',name:'중상해',probability:0.004,cost:4300,limit:4300,deductible:0},
 {id:'fine',name:'벌금형 상해',probability:0.003,cost:1323,limit:1323,deductible:0}
];
export function compare(input, accidents, years) {
 const scale=input.mileage/10000*input.multiplier;
 const rows=accidents.map(a=>{const p=a.probability/100*scale;
 const cost=a.cost*10000, cover=Math.min(cost,Math.max(0,a.limit*10000-a.deductible*10000))*input.eligibility/100;
 return {...a,p,cost,cover,expected:p*cover};});
 const probability=rows.reduce((s,a)=>s+a.p,0);
 if(probability>1+1e-12) throw new RangeError('합산 확률이 100%를 넘습니다');
 const expected=rows.reduce((s,a)=>s+a.expected,0);
 const annualCost=rows.reduce((s,a)=>s+a.p*a.cost,0);
 const rate=input.returnRate/100;
 if(!Number.isFinite(rate) || rate<=-1) throw new RangeError('수익률은 -100%보다 커야 합니다');
 const investment=input.premium*annuity(Math.expm1(Math.log1p(rate)/12),years*12);
 const factor=annuity(rate,years);
 const insurance=-(annualCost-expected)*factor, qqq=investment-annualCost*factor;
 return {rows,probability,expected,annualCost,investment,insurance,qqq,difference:qqq-insurance,benefitFV:expected*factor,premiums:input.premium*12*years};
}
