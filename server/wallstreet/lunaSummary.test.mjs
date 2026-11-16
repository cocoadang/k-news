import test from 'node:test';
import assert from 'node:assert/strict';
import {createLunaClient,lunaUsageCost} from './lunaClient.mjs';
import {lunaSummarizer} from './lunaSummary.mjs';
import {evidenceBlocks,segmentWindows,renderGroundedBrief} from './groundedSummary.mjs';
import {settleReservation} from './textRuntime.mjs';

const video={id:'synthetic01',title:'미국시장 브리핑'};
const segments=n=>Array.from({length:n},(_,i)=>({start:i*16,text:`뉴스 ${i} 관련 조건부 전망입니다.`}));
const point=b=>({title:'조건부 전망',text:`출연자는 뉴스 ${b.text.match(/\d+/)[0]} 관련 조건부 전망을 소개했습니다.`,kind:'outlook',evidenceIds:[b.id]});
const clear=(index)=>({index,supported:true,classificationCorrect:true,recommendedKind:'outlook',counterStatus:'clear',sourceIds:[],duplicateOf:null,reason:'근거 일치'});
test('reports about possible events retain their classification until semantic review',async()=>{
 const f=fake({extract:p=>p.blocks.slice(0,3).map(b=>({...point(b),kind:'reported'})),
  audit:i=>({...clear(i),recommendedKind:'reported'})});
 const result=await lunaSummarizer({client:f.client,approved:true}).summarize({segments:segments(12),video,maxCostMicros:20000});
 const audit=JSON.parse(f.calls.at(-1).contents.split('\n')[1]);
 assert.ok(audit.drafts.every(x=>x.kind==='reported'));
 assert.ok(result.items.every(x=>x.kind==='reported'));
 assert.match(f.calls[0].contents,/OMIT it/);
});
function fake({audit,extract,failStage}={}){
 const calls=[];const client={estimateInputTokens:()=>1000,async generate(args){
  calls.push(args);if(args.name===failStage)throw Error('timeout');
  const payload=JSON.parse(args.contents.slice(args.contents.indexOf('\n')+1));
  const result=args.name==='audit'?{checks:payload.drafts.map((_,i)=>audit?audit(i):clear(i))}:['repair','clarify'].includes(args.name)?{items:[]}:
   {items:extract?extract(payload):payload.blocks.slice(0,4).map(point)};
  return {text:JSON.stringify(result),usage:{input_tokens:1000,output_tokens:300,output_tokens_details:{reasoning_tokens:100}}};
 }};return {client,calls};
}
test('a material caveat gets one bounded repair and a fresh semantic audit before publication',async()=>{
 const calls=[];const client={estimateInputTokens:()=>1000,async generate(args){
  calls.push(args.name);const p=JSON.parse(args.contents.split('\n')[1]);let result;
  if(args.name.startsWith('extract'))result={items:p.blocks.slice(0,3).map(point)};
  else if(args.name==='qualify')result={items:[{title:'조건부 전망',text:'출연자는 뉴스 0 관련 조건부 전망과 반대 의견을 소개했습니다.',kind:'outlook',evidenceIds:['B0000']}]};
  else result={checks:p.drafts.map((_,i)=>({...clear(i),counterStatus:args.name==='audit'&&i===0?'qualifies':'clear',sourceIds:['B0000']}))};
  return {text:JSON.stringify(result),usage:{input_tokens:1000,output_tokens:200}};
 }};
 const seg=segments(12).map(s=>({...s,text:s.text+' 반대 의견도 있습니다.'}));
 const r=await lunaSummarizer({client,approved:true}).summarize({segments:seg,video,maxCostMicros:20000});
 assert.deepEqual(calls,['extract_0','audit','qualify','audit_qualified']);assert.equal(r.items.length,3);
 assert.ok(r.items.some(x=>x.text.includes('반대 의견')));
});
test('45 minute briefing uses five extracts + one combined audit; keeps four news items per segment',async()=>{
 const seg=segments(170),f=fake(),checkpoint={};let saves=0;
 const s=lunaSummarizer({client:f.client,approved:true});
 const result=await s.summarize({segments:seg,video,maxCostMicros:20000,checkpoint,saveCheckpoint:async()=>{saves++;}});
 const windows=segmentWindows(evidenceBlocks(seg));assert.equal(windows.length,5);
 assert.equal(f.calls.length,6);assert.equal(result.items.length,20);assert.equal(result.validationJournal.calls.length,6);assert.ok(saves>=13);
 assert.match(renderGroundedBrief(video,result),/조건부 전망/);
 const audit=JSON.parse(f.calls.at(-1).contents.split('\n')[1]);
 assert.equal(new Set(audit.blocks.map(b=>b.id)).size,audit.blocks.length);
 assert.ok(audit.drafts.every(d=>!('quote'in d)&&!('relatedBlocks'in d)));
 const again=await s.summarize({segments:seg,video,maxCostMicros:20000,checkpoint});
 assert.equal(f.calls.length,6);assert.equal(again.validationJournal.cacheHits,6);assert.deepEqual(again.validationJournal.calls,[]);
});
test('short broadcast uses two calls and rejects qualified, unsupported and duplicate claims',async()=>{
 const f=fake({audit:i=>i===3?{...clear(i),counterStatus:'qualifies',sourceIds:['B0003']}:clear(i)});
 const result=await lunaSummarizer({client:f.client,approved:true}).summarize({segments:segments(35),video,maxCostMicros:10000});
 assert.equal(f.calls.length,2);assert.equal(result.items.length,3);
 for(const bad of [{supported:false},{duplicateOf:0},{counterStatus:'uncertain'},{sourceIds:['B9999']}]){
  const g=fake({audit:i=>i>1?{...clear(i),...bad}:clear(i)});
  await assert.rejects(lunaSummarizer({client:g.client,approved:true}).summarize({segments:segments(35),video,maxCostMicros:10000}),/insufficient_context_reviewed/);
  assert.equal(g.calls.length,['supported','counterStatus'].some(k=>k in bad)?3:2);
 }
});

test('ambiguous peripheral clause is removed once and the entire result must pass a fresh audit',async()=>{
 for(const accepted of [true,false]){
  const calls=[],client={estimateInputTokens:()=>1000,async generate(args){
   calls.push(args.name);const p=JSON.parse(args.contents.split('\n')[1]);
   const result=args.name.startsWith('extract_')?{items:p.blocks.slice(0,3).map(point)}:
    args.name==='clarify'?{items:[point(p.blocks.find(b=>b.text.includes('뉴스 '+p.drafts[0].text.match(/뉴스 (\d+)/)[1]+' ')))]}:
    {checks:p.drafts.map((_,i)=>({...clear(i),supported:args.name==='audit_qualified'?accepted:i!==1,counterStatus:(args.name==='audit_qualified'?accepted:i!==1)?'clear':'uncertain'}))};
   return {text:JSON.stringify(result),usage:{input_tokens:1000,output_tokens:200}};
  }};
  const run=lunaSummarizer({client,approved:true}).summarize({segments:segments(35),video,maxCostMicros:10000});
  if(accepted)assert.equal((await run).items.length,3);else await assert.rejects(run,/insufficient_context_reviewed/);
  assert.deepEqual(calls,['extract_0','audit','clarify','audit_qualified']);
 }
});
test('one repair receives only rejected claims and limited evidence; no full draft replay',async()=>{
 const f=fake({extract:p=>[...p.blocks.slice(0,3).map(point),{...point(p.blocks[3]),text:'뉴스 99999 전망입니다.'}]});
 const result=await lunaSummarizer({client:f.client,approved:true}).summarize({segments:segments(35),video,maxCostMicros:10000});
 assert.equal(result.items.length,3);assert.deepEqual(f.calls.map(c=>c.name),['extract_0','repair','audit']);
 const p=JSON.parse(f.calls[1].contents.split('\n')[1]);assert.equal(p.rejected.length,1);assert.ok(!('candidate'in p));assert.ok(p.blocks.length<evidenceBlocks(segments(35)).length);
});
test('completed windows survive restart; uncertain paid requests never repeat',async()=>{
 const seg=segments(170),checkpoint={},f=fake({failStage:'extract_2'}),s=lunaSummarizer({client:f.client,approved:true});
 await assert.rejects(s.summarize({segments:seg,video,maxCostMicros:20000,checkpoint}),/timeout/);assert.equal(f.calls.length,3);
 await assert.rejects(s.summarize({segments:seg,video,maxCostMicros:20000,checkpoint}),/previous_call_uncertain/);assert.equal(f.calls.length,3);
 assert.equal(Object.values(checkpoint.entries).filter(x=>x.status==='completed').length,2);
});
test('budget rejection happens before paid calls; cross-window evidence cannot pass',async()=>{
 const f=fake();await assert.rejects(lunaSummarizer({client:f.client,approved:true}).summarize({segments:segments(35),video,maxCostMicros:1}),/budget_exceeded/);assert.equal(f.calls.length,0);
 const g=fake({extract:()=>[{title:'다른 구간',text:'전망',kind:'outlook',evidenceIds:['B0050']}]});
 await assert.rejects(lunaSummarizer({client:g.client,approved:true}).summarize({segments:segments(170),video,maxCostMicros:20000}),/grounded_ids/);
});
test('Responses request is low reasoning, strict JSON, stateless and has no tools or token-count call',async()=>{
 let calls=0;const client=createLunaClient({apiKey:'mock',fetcher:async(url,opts)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');const b=JSON.parse(opts.body);
  assert.equal(b.model,'gpt-6-luna');assert.deepEqual(b.reasoning,{effort:'low'});assert.equal(b.store,false);assert.deepEqual(b.tools,[]);assert.equal(b.text.format.strict,true);assert.equal(opts.redirect,'error');
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"items":[]}'}]}],usage:{input_tokens:100,output_tokens:50}});
 }});
 const args={contents:'한글 자막',schema:{type:'object'},name:'extract',maxOutputTokens:2400};
 assert.ok(client.estimateInputTokens(args)>Buffer.byteLength(args.contents));assert.equal(calls,0);
 assert.equal((await client.generate(args)).text,'{"items":[]}');assert.equal(calls,1);
});
test('incomplete/refusal/HTTP outcomes are held without automatic HTTP retry',async()=>{
 for(const body of [{status:'incomplete',usage:{input_tokens:100,output_tokens:200}},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]}]){
  let calls=0;const client=createLunaClient({apiKey:'mock',fetcher:async()=>{calls++;return Response.json(body);}});
  await assert.rejects(client.generate({contents:'x',schema:{},name:'test',maxOutputTokens:1000}),/incomplete/);assert.equal(calls,1);
 }
 let calls=0;const client=createLunaClient({apiKey:'mock',fetcher:async()=>{calls++;return new Response('private provider body',{status:429});}});
 await assert.rejects(client.generate({contents:'x',schema:{},name:'test',maxOutputTokens:1000}),/luna_rate_limited/);assert.equal(calls,1);
});
test('actual usage includes cached input discount and counts reasoning once; unknown keeps ceiling',()=>{
 assert.equal(lunaUsageCost({input_tokens:1000,input_tokens_details:{cached_tokens:500},output_tokens:300,output_tokens_details:{reasoning_tokens:100}}),205);
 assert.equal(lunaUsageCost({input_tokens:1}),null);
 assert.equal(lunaUsageCost({input_tokens:1000,input_tokens_details:{cache_write_tokens:800,cached_tokens:100},output_tokens:300}),261);
 assert.equal(lunaUsageCost({input_tokens:100,input_tokens_details:{cache_write_tokens:101},output_tokens:1}),null);
 const s={budgets:{day:10000}},held={keys:['day'],amount:10000};
 assert.equal(settleReservation(s,held,{calls:[{ceiling:2000,status:'completed',spentMicros:205},{ceiling:3000,status:'inflight',spentMicros:0}]}),6795);assert.equal(s.budgets.day,3205);
});

test('long briefing audits more than 32 grounded drafts together without truncating topics',async()=>{
 const f=fake({extract:p=>p.blocks.slice(0,7).map(point)});
 const result=await lunaSummarizer({client:f.client,approved:true}).summarize({segments:segments(170),video,maxCostMicros:30000});
 assert.equal(result.items.length,35);
 assert.equal(f.calls.filter(c=>c.name==='audit').length,1);
 assert.equal(f.calls.at(-1).schema.properties.checks.maxItems,64);
});

test('completed stages from an older prompt do not exhaust the new run call allowance',async()=>{
 const checkpoint={},seg=segments(35),f=fake();
 const s=lunaSummarizer({client:f.client,approved:true});
 await s.summarize({segments:seg,video,maxCostMicros:10000,checkpoint});
 for(const key of Object.keys(checkpoint.entries))checkpoint.entries['old_'+key]=checkpoint.entries[key];
 // Invalidate only the audit: extraction remains reusable and no unknown call is removed.
 const auditKey=Object.keys(checkpoint.entries).find(k=>checkpoint.entries[k].result?.checks&&!k.startsWith('old_'));
 delete checkpoint.entries[auditKey];
 const before=f.calls.length;
 await s.summarize({segments:seg,video,maxCostMicros:10000,checkpoint});
 assert.equal(f.calls.length-before,1);
});

test('one corrective pass changes generation only and still requires the full semantic audit',async()=>{
 const checkpoint={},seg=segments(35),f=fake(),s=lunaSummarizer({client:f.client,approved:true});
 await s.summarize({segments:seg,video,maxCostMicros:10000,checkpoint});
 const before=f.calls.length,oldKeys=Object.keys(checkpoint.entries);checkpoint.automaticRetryAttempt=1;
 await s.summarize({segments:seg,video,maxCostMicros:10000,checkpoint});
 const correction=f.calls.slice(before);
 assert.ok(correction.some(c=>c.name.startsWith('extract_')&&c.contents.includes('One corrective pass')));
 assert.ok(oldKeys.every(k=>checkpoint.entries[k]?.status==='completed'));
 // If the exact same claims recur, the completed audit is reusable; every claim
 // still has to pass the existing audit rather than gaining a retry exemption.
 assert.ok(f.calls.some(c=>c.name==='audit'));
 assert.ok(correction.filter(c=>c.name==='audit').every(c=>!c.contents.includes('One corrective pass')));
});

