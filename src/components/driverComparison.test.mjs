import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compare,comparisonDefaults as d,accidentDefaults as a} from './driverComparison.mjs';
test('defaults reproduce household assumptions and unrounded annual expectation',()=>{
 const r=compare(d,a,30);assert.equal(d.premium,15000);assert.equal(d.mileage,10000);
 assert.ok(Math.abs(r.expected-2326.9)<1e-8);assert.ok(Math.abs(r.probability-.000072)<1e-12);
 assert.deepEqual(r.rows.map(x=>x.cover),[105000000,43000000,13230000]);
});
test('all horizons match independent monthly deposits and annual cashflow loops',()=>{
 for(const returnRate of [-50,0,8,13,30]) for(const years of [0,1,10,20,30]) for(const mileage of [0,10000,30000]) for(const multiplier of [1,5,40]){
 const input={...d,mileage,multiplier,returnRate};const r=compare(input,a,years);
 let fv=0,cost=0,benefit=0;
 for(let m=0;m<years*12;m++)fv=fv*Math.pow(1+returnRate/100,1/12)+input.premium;
 for(let y=0;y<years;y++){cost=cost*(1+returnRate/100)+r.annualCost;benefit=benefit*(1+returnRate/100)+r.expected;}
 assert.ok(Math.abs(r.investment-fv)<.001);assert.ok(Math.abs(r.qqq-(fv-cost))<.001);
 assert.ok(Math.abs(r.insurance-(-cost+benefit))<.001);assert.ok(Math.abs(r.difference-(fv-benefit))<.001);
 }
});
test('premium, exposure, caps, deductible and exclusions propagate without double household scaling',()=>{
 const r=compare(d,a,10);assert.equal(compare({...d,premium:30000},a,10).investment,2*r.investment);
 assert.equal(compare({...d,mileage:20000},a,10).expected,2*r.expected);
 assert.equal(compare({...d,eligibility:0},a,10).expected,0);
 assert.equal(compare({...d,eligibility:0},a,10).difference,r.investment);
 const changed=a.map(x=>({...x,limit:999999,deductible:999999}));
 assert.equal(compare(d,changed,10).expected,0);
 assert.ok(compare(d,a.map(x=>({...x,limit:999999})),10).rows.every(x=>x.cover<=x.cost));
 assert.equal(compare({...d,mileage:0},a,10).difference,r.investment);
 assert.throws(()=>compare({...d,mileage:100000,multiplier:40},a.map(x=>({...x,probability:1})),10),RangeError);
});

test('zero return preserves principal and uses simple annual expected losses',()=>{
 const r=compare({...d,returnRate:0},a,30);
 assert.equal(r.investment,5400000);
 assert.ok(Math.abs(r.benefitFV-2326.9*30)<1e-8);
 assert.throws(()=>compare({...d,returnRate:-100},a,30),RangeError);
});
