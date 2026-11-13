import {test} from 'node:test';
import assert from 'node:assert/strict';
import {riskRange,rangeDefaults as b,exposureStats as st} from './exposureRiskModel.mjs';
import {comparisonDefaults as d,accidentDefaults as a,compare} from './driverComparison.mjs';
test('official exposure rate uses event counts, correct km units and combined mileage once',()=>{
 const r=riskRange(d,a);assert.equal(st.vehicleKm,3396.6*1e8);
 assert.equal(r.raw.fatalLambda,2482/339660000000*10000);
 assert.equal(r.raw.allLambda,193889/339660000000*10000);
 assert.equal(riskRange({...d,mileage:20000},a).raw.allLambda,2*r.raw.allLambda);
 assert.equal(riskRange({...d,multiplier:2},a).raw.allLambda,2*r.raw.allLambda);
 assert.ok(compare(d,a,1).rows[0].p<r.rows[0].low);
 assert.ok(r.rows[1].low<.00004&&r.rows[1].high>.00004);
});
test('single corner matches independent competing Poisson probabilities and unchanged finance model',()=>{
 const fixed={exposureLow:1,exposureHigh:1,deathLow:50,deathHigh:50,seriousLow:5,seriousHigh:5,fineLow:3,fineHigh:3};
 const r=riskRange(d,a,fixed);const ls=[2482*.5,191407*.05,191407*.03].map(x=>x/st.vehicleKm*10000);
 const sum=ls.reduce((s,x)=>s+x,0);const ps=ls.map(x=>x/sum*(1-Math.exp(-sum)));
 r.rows.forEach((x,i)=>{assert.ok(Math.abs(x.low-ps[i])<1e-15);assert.equal(x.low,x.high);});
 const direct=compare({...d,mileage:10000,multiplier:1},a.map((x,i)=>({...x,probability:ps[i]*100})),30);
 assert.ok(Math.abs(r.projections[2].difference.low-direct.difference)<.001);
 assert.ok(Math.abs(r.annualExpected.low-ps.reduce((s,p,i)=>s+p*a[i].cost*10000,0))<1e-8);
});
test('zero exposure, zero payout, high exposure and ordered range limits',()=>{
 for(const mileage of [0,10000,100000])for(const multiplier of [1,40]){
 const r=riskRange({...d,mileage,multiplier},a);
 for(const x of r.rows)assert.ok(x.low>=0&&x.high<=1&&x.low<=x.high);
 assert.ok(r.annualExpected.low<=r.annualExpected.high);
 }
 const z=riskRange({...d,mileage:0},a);assert.ok(z.rows.every(x=>x.low===0&&x.high===0));
 assert.deepEqual(riskRange({...d,eligibility:0},a).annualExpected,{low:0,high:0});
 assert.throws(()=>riskRange(d,a,{...b,exposureLow:3}),RangeError);
 assert.throws(()=>riskRange(d,a,{...b,seriousHigh:95}),RangeError);
 assert.throws(()=>riskRange({...d,mileage:NaN},a),RangeError);
});
