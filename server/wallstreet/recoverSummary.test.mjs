import test from 'node:test';import assert from 'node:assert/strict';
import {recoverHeldSummary} from './recoverSummary.mjs';
const config={summaryReservationMicros:30000,dailySummaryMicros:260000,monthlySummaryMicros:2000000};

test('supervised repair retains the original video cap and charges only new work',async()=>{
 const s={videos:{v:{stage:'text_review_required',transcript:[{start:0,text:'x'}],summarySpentMicros:1233}},budgets:{}};
 const store={exclusive:fn=>fn(s,async()=>{})};let allowed;
 await recoverHeldSummary({store,config,videoId:'v',summarizer:{summarize:async({maxCostMicros})=>{
  allowed=maxCostMicros;throw Object.assign(Error('insufficient_context_reviewed_items'),{candidate:{calls:[{ceiling:1000,spentMicros:500,status:'completed'}]}});
 }}});
 assert.equal(allowed,28767);assert.equal(s.videos.v.summarySpentMicros,1733);
 assert.ok(Object.values(s.budgets).every(v=>v===500));
 s.videos.v.summarySpentMicros=30000;
 assert.equal((await recoverHeldSummary({store,config,videoId:'v',summarizer:{summarize:async()=>{throw Error('must_not_call');}}})).status,'summary_budget_exceeded');
});
test('recovery never starts a paid call over budget or for a completed video',async()=>{
 let calls=0;const summarizer={summarize:async()=>{calls++;}};
 const s={videos:{v:{stage:'sent',transcript:[{start:0,text:'x'}]}},budgets:{}};
 const store={exclusive:fn=>fn(s,async()=>{})};
 assert.equal((await recoverHeldSummary({store,summarizer,config,videoId:'v'})).status,'held_summary_required');
 s.videos.v.stage='text_review_required';s.budgets['text:2026-11-16']=260000;
 assert.equal((await recoverHeldSummary({store,summarizer,config,videoId:'v',now:Date.parse('2026-11-16')})).status,'summary_budget_exceeded');
 assert.equal(calls,0);
});
test('known validation failure is saved and returns normally so the durable lock releases',async()=>{
 const s={videos:{v:{stage:'text_review_required',transcript:[{start:0,text:'x'}]}},budgets:{}};
 let released=false,saves=0;const store={exclusive:async fn=>{const out=await fn(s,async()=>{saves++;});released=true;return out;}};
 const result=await recoverHeldSummary({store,config,videoId:'v',summarizer:{summarize:async()=>{throw Object.assign(Error('insufficient_source_grounded_items'),{candidate:{calls:[]}});}}});
 assert.equal(result.status,'review_required');assert.equal(s.videos.v.stage,'text_review_required');
 assert.ok(released);assert.equal(saves,2);assert.ok(Object.values(s.budgets).every(v=>v===0));
});
