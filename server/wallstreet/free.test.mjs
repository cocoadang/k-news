import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PROGRAMMES,TRIAL_IDS,matchProgrammes} from './programmes.mjs';
import {createFreeVideoProvider,freePreflight,validateVideoSummary} from './freeVideo.mjs';
import {createFreeRuntime} from './freeRuntime.mjs';
import {createConfiguredWallstreetRuntime} from './providers.mjs';
const now=Date.parse('2026-10-28T00:00:00Z'),key='synthetic-key';
const config={enabled:true,mode:'gemini_youtube_free',paidFallback:false,activatedAt:now-86400000};
const evidence={tier:'free',billingEnabled:false,projectId:'synthetic-free',model:'gemini-3.8-flash',checkedAt:now,previewFree:true,exclusiveQuotaUse:true,
  credentialSha256:createHash('sha256').update(key).digest('hex'),remainingRequests:3,remainingVideoSeconds:28800,remainingInputTokens:900000,remainingMinuteTokens:900000,maxOutputTokens:8000};
const video=(i=0,id=TRIAL_IDS[i])=>({id,channelId:PROGRAMMES[i].channelId,title:PROGRAMMES[i].name,description:PROGRAMMES[i].name,durationSeconds:600,
  isShort:false,isRebroadcast:false,status:'completed',visibility:'public',publishedAt:now-1000});
const item={text:'실적 10% 성장',quote:'실적 10% 성장',kind:'fact',speaker:'진행자',start:10};
const summary=v=>({videoId:v.id,headline:[item,item,{...item,kind:'outlook'}],sections:{market:[item],ratesOil:[],ai:[],earnings:[],watch:[]},missing:['독립 자막 없음']});
function memory(){let s={version:1,videos:{},budgets:{}},tail=Promise.resolve();return {get state(){return s;},exclusive:async fn=>{let done;const p=tail;tail=new Promise(r=>done=r);await p;try {const draft=structuredClone(s);return await fn(draft,async()=>{s=structuredClone(draft);});}finally{done();}}};}
const batch=vs=>Object.assign(vs,{coverageComplete:true});
const discovery=vs=>({list:async c=>batch(vs.filter(v=>v.channelId===c))});
function provider(fetcher){return createFreeVideoProvider({apiKey:key,projectId:evidence.projectId,model:evidence.model,evidence,approved:true,fetcher});}
function response(v){return new Response(JSON.stringify({id:'synthetic',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(summary(v))}]}],usage:{total_input_tokens:100,total_output_tokens:100,total_thought_tokens:10,total_tokens:210,total_tool_use_tokens:0}}));}
test('three programmes enforce channel plus programme title and exclude clips',()=>{
  for(let i=0;i<3;i++){assert.deepEqual(matchProgrammes(video(i),{activatedAt:config.activatedAt,now}),[PROGRAMMES[i].id]);
    for(const patch of [{channelId:'wrong'},{title:'other programme'},{visibility:'unlisted'},{title:video(i).title+' 쇼츠'},{status:'live'},{durationSeconds:60}])assert.deepEqual(matchProgrammes({...video(i),...patch},{activatedAt:config.activatedAt,now}),[]);}
});
test('free preflight rejects paid/stale/unbound/unknown quota and unapproved videos before HTTP',()=>{
  const args={apiKey:key,projectId:evidence.projectId,model:evidence.model,evidence,video:video(),now};
  assert.ok(freePreflight(args).estimatedInput>192000);
  for(const patch of [{tier:'Tier 2'},{billingEnabled:true},{checkedAt:now-900001},{credentialSha256:'wrong'},{remainingRequests:0},{remainingMinuteTokens:1},{exclusiveQuotaUse:false}])assert.throws(()=>freePreflight({...args,evidence:{...evidence,...patch}}));
  assert.throws(()=>freePreflight({...args,video:video(0,'xxxxxxxxxxx')}));
});
test('official interactions contract uses URL video content and no tools/storage/redirect/retry',async()=>{
  let calls=0;const p=provider(async(url,o)=>{calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');assert.equal(o.redirect,'error');
    const b=JSON.parse(o.body);assert.equal(b.input[0].type,'video');assert.equal(b.input[0].uri,'https://www.youtube.com/watch?v=Idn_d5ArZvA');assert.equal(b.store,false);assert.equal(b.generation_config.tool_choice,'none');assert.equal(b.tools,undefined);return response(video());});
  const r=await p.summarize(video(),now);assert.equal(calls,1);assert.equal(r.independentlyVerified,false);assert.match(r.rendered,/독립 자막 대조 미실시/);
});
test('numbers, timestamps, missing sections and video identity fail closed',()=>{
  for(const mutate of [r=>r.videoId='wrong',r=>r.headline[0]={...item,text:'실적 99%'},r=>r.headline[0]={...item,start:601},r=>delete r.sections.ai,r=>r.missing=null]) {const r=summary(video());mutate(r);assert.throws(()=>validateVideoSummary(video(),r));}
});
test('durable reservation and overlap prevent duplicate requests; paid path never used',async()=>{
  const store=memory();let calls=0;const p=provider(async()=>{calls++;assert.equal(store.state.videos[TRIAL_IDS[0]].stage,'video_inflight');assert.equal(store.state.free.events.length,1);return response(video());});
  const runtime=createFreeRuntime({store,discovery:discovery([video(),video()]),provider:p,config,clock:()=>now});
  await Promise.all([runtime.run(),runtime.run()]);assert.equal(calls,1);assert.equal(store.state.videos[TRIAL_IDS[0]].stage,'video_review');
});
test('429 and timeout survive a new runtime without re-request or fallback',async()=>{
  for(const mode of ['429','timeout']){const store=memory();let calls=0;
    const p=provider(async()=>{calls++;if(mode==='timeout')throw Error('synthetic timeout');return new Response('',{status:429});});
    await createFreeRuntime({store,discovery:discovery([video()]),provider:p,config,clock:()=>now}).run();
    await createFreeRuntime({store,discovery:discovery([video()]),provider:p,config,clock:()=>now+600001}).run();
    assert.equal(calls,1);assert.equal(store.state.videos[TRIAL_IDS[0]].stage,'review_required');}
});
test('stale quota evidence holds the third request; non-trial uploads collect without generation',async()=>{
  const store=memory();let calls=0,t=now;
  const vs=[video(),video(1),video(2),video(2,'nyt2YVE9uZ0')];
  const p=provider(async(_u,o)=>{calls++;const id=JSON.parse(o.body).input[0].uri.split('=')[1];return response(vs.find(v=>v.id===id));});
  const r=createFreeRuntime({store,discovery:discovery(vs),provider:p,config,clock:()=>t});
  await r.run();t+=600001;await r.run();
  // Evidence must be refreshed by an operator before a third run >15m; no fabricated refresh.
  t+=600001;await r.run();assert.equal(calls,2);assert.equal(store.state.videos.nyt2YVE9uZ0.stage,'video_pending');
  assert.equal(store.state.videos[TRIAL_IDS[1]].hold,'free_readiness_or_quota');
});
test('partial feed reports gaps; digest is immutable, multi-upload and review only',async()=>{
  const store=memory();const vs=[video(2),video(2,'nyt2YVE9uZ0')];
  const r=createFreeRuntime({store,discovery:{list:async()=>vs},provider:provider(()=>{throw Error('must not call');}),config,clock:()=>now});
  await r.run();const args={recipient:'synthetic',startAt:now-10000,cutoff:now};
  const a=await r.freezeDigest(args);assert.equal(a.videoIds.length,2);assert.equal(a.status,'review_only');assert.ok(a.parts.every(p=>p.text.length<3500));assert.match(a.parts.map(p=>p.text).join(''),/누락 가능/);
  await store.exclusive(async(s,save)=>{s.videos.extra={video:video(0,'xxxxxxxxxxx'),programmes:['wallstreet'],stage:'video_pending'};await save();});
  assert.deepEqual(await r.freezeDigest(args),a);
});
test('application entrypoint blocks paid project before reading secrets or touching DB',async()=>{
  const env=new Proxy({},{get(){throw Error('secret access forbidden');}});
  const r=createConfiguredWallstreetRuntime({env,config:{...config,freeEvidence:{tier:'Tier 2',billingEnabled:true}},getFirestore:()=>{throw Error('db forbidden');}});
  await assert.rejects(r.run(),/free_tier_unverified/);
});
