import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeDigest} from './digestSummary.mjs';
const source=[{title:'실적',text:'매출이 증가했지만 비용도 늘었다.',kind:'reported',starts:[10]},{title:'전망',text:'출연자는 수요가 줄 수 있다고 전망했다.',kind:'outlook',starts:[20]}];
const draft={items:source.map((item,index)=>({...item,sourceIndexes:[index]}))};
const pass={complete:true,faithful:true,classificationCorrect:true,onlySameIssuesMerged:true};
test('digest covers all source issues with independent semantic audit and original timestamps',async()=>{
  const stages=[];const result=await summarizeDigest(source,async(stage)=>{stages.push(stage);return stage==='telegram_digest'?draft:pass;});
  assert.equal(result.verified,true);assert.deepEqual(result.items.map(item=>item.starts),[[10],[20]]);assert.deepEqual(stages,['telegram_digest','telegram_digest_audit']);
});
test('missing issues, duplicated indexes, classification changes and semantic loss fail closed',async()=>{
  for(const candidate of [{items:draft.items.slice(0,1)},{items:[draft.items[0],draft.items[0]]},{items:draft.items.map(item=>({...item,kind:'reported'}))}])await assert.rejects(summarizeDigest(source,async()=>candidate));
  for(const field of Object.keys(pass))await assert.rejects(summarizeDigest(source,async(stage)=>stage==='telegram_digest'?draft:{...pass,[field]:false}),/digest_audit/);
});
test('same issue can merge only with exhaustive index mapping and affirmative semantic audit',async()=>{
  const result=await summarizeDigest([source[0],source[0]],async(stage)=>stage==='telegram_digest'?{items:[{title:'실적',text:source[0].text,kind:'reported',sourceIndexes:[0,1]}]}:pass);
  assert.equal(result.items.length,1);assert.deepEqual(result.items[0].sourceIndexes,[0,1]);
});
