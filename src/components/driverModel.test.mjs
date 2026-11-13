import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, defaults, annuity } from './driverModel.mjs';
test('monthly deposits and annual losses match independent cashflow loops', () => {
  for (const years of [10,20,30]) for (const rate of [-10,0,8]) for (const mult of [1,3,5]) {
    const d = {...defaults, returnRate:rate, costGrowth:rate};
    let fv=0, loss=0;
    for(let m=0;m<years*12;m++) fv=fv*Math.pow(1+rate/100,1/12)+d.premium;
    for(let y=0;y<years;y++) loss=loss*(1+rate/100)+d.probability/100*mult*40000000;
    const r=calculate(d,years,mult);
    assert.ok(Math.abs(r.investment-fv)<0.001);
    assert.ok(Math.abs(r.uninsuredLoss-loss)<0.001);
    assert.ok(Math.abs(r.difference-(r.investment-d.probability/100*mult*r.cover*annuity(rate/100,years)))<0.001);
  }
});
test('no double premium charge, capped cover, zero risk and zero payout',()=>{
  assert.equal(calculate({...defaults,returnRate:0,probability:0},10).qqq,1200000);
  assert.equal(calculate({...defaults,returnRate:0},30).insurance,-60000);
  assert.equal(calculate({...defaults,eligibility:0},30).cover,0);
  assert.equal(calculate({...defaults,lawyerCover:999999},10).cover,40000000);
  assert.equal(calculate({...defaults,probability:100},30,5).cumulative,1);
});
