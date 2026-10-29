import test from 'node:test';
import assert from 'node:assert/strict';
import {groundedSummarizer} from './groundedSummary.mjs';
test('today remaining budget cannot reserve detailed pipeline; no external calls',async()=>{
 let calls=0;const client={countTokens:async()=>{calls++;return {totalTokens:1};},generate:async()=>{calls++;}};
 const s=groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:.3,outputMicrosPerToken:2.5,approved:true,minimumSummaryItems:5,counterEvidenceRequired:true});
 await assert.rejects(s.summarize({segments:[],maxCostMicros:8982}),/detailed_budget_below_output_ceiling/);assert.equal(calls,0);
});
