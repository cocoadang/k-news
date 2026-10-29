import test from 'node:test';
import assert from 'node:assert/strict';
import {twiceDailySlot} from './schedule.mjs';
import {resolveEvidence,renderBrief} from './textRuntime.mjs';
test('two Seoul slots only, midnight and duplicate windows stable',()=>{
 const times=['09:00','15:00'];
 assert.equal(twiceDailySlot(Date.parse('2026-10-29T08:59:00+09:00'),times),null);
 assert.equal(twiceDailySlot(Date.parse('2026-10-29T09:00:00+09:00'),times),'2026-10-29T09:00+09:00');
 assert.equal(twiceDailySlot(Date.parse('2026-10-29T14:59:00+09:00'),times),'2026-10-29T09:00+09:00');
 assert.equal(twiceDailySlot(Date.parse('2026-10-29T15:00:00+09:00'),times),'2026-10-29T15:00+09:00');
 assert.equal(twiceDailySlot(Date.parse('2026-10-30T00:01:00+09:00'),times),null);
});
test('quote across segments resolves source start instead of invalid model timestamp',()=>{
 const t=[{start:12,text:'이것은 시장 전망의'},{start:14,text:'근거가 되는 문장입니다.'},{start:19,text:'그 다음 이야기'}];
 assert.equal(resolveEvidence(t,{segment:'12:99',quote:'시장 전망의 근거가 되는 문장입니다.'}).start,12);
 const r={items:Array.from({length:3},()=>({segment:'garbled',quote:'시장 전망의 근거가 되는 문장입니다.',kind:'outlook',speaker:'출연자',text:'시장 전망을 제시했습니다.'}))};
 r.items.forEach(x=>x.text=x.quote);
 assert.ok(renderBrief({id:'annR-E8m5WQ',title:'test'},t,r).includes('&t=12s'));
 assert.throws(()=>resolveEvidence(t,{segment:0,quote:'없는 인용문은 허용하지 않습니다.'}));
 assert.throws(()=>resolveEvidence([{start:0,text:'반복되는 인용문입니다.'},{start:1,text:'반복되는 인용문입니다.'}],{segment:'bad',quote:'반복되는 인용문입니다.'}));
});
