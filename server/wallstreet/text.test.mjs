import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextRuntime,renderBrief,parseUiTranscript,TEXT_PROJECT} from './textRuntime.mjs';
import {PROGRAMMES} from './programmes.mjs';
const now=Date.parse('2026-10-28T10:00:00Z');

test('manual request IDs survive restart and concurrent execution without altering scheduled slot',async()=>{
 const x=setup({dailyCheckTimes:['09:00','15:00'],excludedVideoIds:['Idn_d5ArZvA']});let calls=0;
 x.deps.discovery={list:async()=>{calls++;return [video()];}};
 await x.store.exclusive(async(s,save)=>{s.text={coverage:{},lastScheduledSlot:'2026-10-28:15:00'};await save();});
 const r=x.run(),id='diagnostic-20261029-one';
 const results=await Promise.all([r.run({manualRunId:id}),r.run({manualRunId:id})]);
 assert.equal(calls,2);assert(results.some(r=>r.status==='manual_run_already_recorded'));
 assert.equal(x.store.state.text.lastScheduledSlot,'2026-10-28:15:00');
 assert.equal(x.store.state.text.manualRuns[id].status,'completed');
 assert.equal((await x.run().run({manualRunId:id})).status,'manual_run_already_recorded');
 assert.equal((await r.run({manualRunId:'diagnostic-20261029-two'})).status,'manual_throttled');
 assert.equal(Object.keys(x.store.state.videos).length,0);assert.equal(x.sent.length,0);
 await assert.rejects(r.run({manualRunId:'short'}),/invalid_manual/);
});

test('uncertain manual outcome is never automatically repeated',async()=>{
 const x=setup();let calls=0;x.deps.discovery={list:async()=>{calls++;return [];}};
 await x.store.exclusive(async(s,save)=>{s.text={coverage:{},manualRuns:{'diagnostic-inflight-one':{status:'inflight',startedAt:now-3600000}}};await save();});
 assert.equal((await x.run().run({manualRunId:'diagnostic-inflight-one'})).status,'manual_run_already_recorded');assert.equal(calls,0);
});
function memory(){let state={version:1,videos:{},budgets:{}},tail=Promise.resolve();return {get state(){return state;},async exclusive(fn){const prev=tail;let done;tail=new Promise(r=>done=r);await prev;try{const draft=structuredClone(state);return await fn(draft,async()=>{state=structuredClone(draft);});}finally{done();}}};}
const video=(id='Idn_d5ArZvA')=>({id,title:PROGRAMMES[0].name,description:PROGRAMMES[0].name,channelId:PROGRAMMES[0].channelId,publishedAt:now-1000,durationSeconds:600,visibility:'public',status:'completed',isShort:false,isRebroadcast:false});
const source=v=>({video:v,text:`YouTube transcript\nVideo ID: ${v.id}\n[0:00] 수요 증가\n[1:00] 비용 부담`,provenance:{method:'youtube_ui',videoId:v.id}});
const result={items:Array.from({length:3},()=>({text:'수요 증가',kind:'outlook',speaker:'출연자',segment:0,quote:'수요 증가'}))};
function setup(overrides={}){const store=memory(),sent=[];const config={enabled:true,projectId:TEXT_PROJECT,paidFallback:false,activatedAt:now-86400000,recipient:'123',deliveryTime:'18:00',summaryApproved:true,deliveryApproved:true,combinedTokenCapVerified:true,summaryReservationMicros:100,dailySummaryMicros:300,monthlySummaryMicros:300,...overrides};const deps={store,config,clock:()=>now,summarizer:{summarize:async()=>result},telegram:{send:async(id,text)=>{sent.push({id,text});return {status:'sent',messageId:sent.length};}}};return {store,sent,deps,run:()=>createTextRuntime(deps)};}
test('individual video queues persist and no duplicate send under concurrent ticks',async()=>{const x=setup();const r=x.run();await r.importTranscript(source(video()));await r.importTranscript(source(video('annR-E8m5WQ')));await Promise.all([r.run(),r.run()]);assert.equal(x.sent.length,2);assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'sent');await r.importTranscript(source(video()));await r.run();assert.equal(x.sent.length,2);});
test('unknown Telegram delivery never retries',async()=>{const x=setup();let calls=0;x.deps.telegram.send=async()=>{calls++;throw Error('timeout');};const r=x.run();await r.importTranscript(source(video()));await r.run();await r.run();assert.equal(calls,1);assert.equal(x.store.state.videos.Idn_d5ArZvA.parts[0].status,'unknown');});
test('daily budget atomically holds second video, schedule can hold first',async()=>{const x=setup({dailySummaryMicros:100,deliveryTime:'23:00'}),r=x.run();await r.importTranscript(source(video()));await r.importTranscript(source(video('annR-E8m5WQ')));await Promise.all([r.run(),r.run()]);assert.equal(x.sent.length,0);assert.equal(x.store.state.videos['annR-E8m5WQ'].hold,'text_budget');});
test('discovery without authorized caption collector waits, no title summary',async()=>{const x=setup();x.deps.discovery={list:async c=>Object.assign(c===video().channelId?[video()]:[],{coverageComplete:false})};await x.run().run();assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'text_waiting');assert.equal(x.sent.length,0);});
test('reject transcript mismatch, unsupported number and unverified cap',async()=>{assert.throws(()=>parseUiTranscript(source(video()).text,video('annR-E8m5WQ')));assert.throws(()=>renderBrief(video(),[{start:0,text:'수요 증가'}],{items:result.items.map(x=>({...x,text:'수요 99% 증가'}))}));const x=setup({combinedTokenCapVerified:false}),r=x.run();await r.importTranscript(source(video()));await r.run();assert.equal(x.sent.length,0);assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'text_summary');});
test('summary timeout reserves budget for each attempt and retries only once',async()=>{const x=setup();let calls=0;x.deps.summarizer.summarize=async()=>{calls++;throw Error('timeout');};const r=x.run();await r.importTranscript(source(video()));await r.run();await r.run();assert.equal(calls,2);assert.equal(Object.values(x.store.state.budgets)[0],200);});

test('split outbox persists confirmed prefix and never repeats uncertain suffix',async()=>{
  const x=setup();let calls=0;
  x.deps.summarizer.summarize=async()=>({items:Array.from({length:5},()=>({text:'a'.repeat(690),kind:'fact',speaker:'host',segment:0,quote:'a'.repeat(690)}))});
  x.deps.telegram.send=async()=>{calls++;return calls===1?{status:'sent',messageId:'one'}:{status:'unknown'};};
  const r=x.run(),v=video();await r.importTranscript({video:v,text:`YouTube transcript\nVideo ID: ${v.id}\n[0:00] ${'a'.repeat(690)}`,provenance:{method:'youtube_ui',videoId:v.id}});
  await r.run();await x.run().run();const parts=x.store.state.videos[v.id].parts;
  assert.equal(parts.length,2);assert.ok(parts.every(p=>p.text.length<4096));assert.equal(parts[0].status,'sent');assert.equal(parts[1].status,'unknown');assert.equal(calls,2);
});

test('caption waiting expires without model or delivery side effects',async()=>{
  const x=setup();await x.store.exclusive(async(s,save)=>{s.videos[video().id]={video:video(),recipient:'123',stage:'text_waiting',firstSeen:now-172800000};await save();});
  await x.run().run();assert.equal(x.store.state.videos[video().id].stage,'text_caption_expired');assert.equal(x.sent.length,0);
});

test('immediate preference sends ready video without a daily time',async()=>{
  const x=setup({deliveryMode:'immediate',deliveryTime:null}),r=x.run();await r.importTranscript(source(video()));await r.run();assert.equal(x.sent.length,1);await r.run();assert.equal(x.sent.length,1);
});

test('vidIQ is restricted to Wallstreet and existing UI captions do not refetch',async()=>{
 const x=setup({vidiqApproved:true,summaryApproved:false});let calls=0;
 x.deps.captions={balance:async()=>({type:'limited',renewableCredits:145,maxRenewableCredits:150,renewableResetsAt:'2026-11-28T00:00Z'}),get:async()=>{calls++;return {status:'ok',segments:[{start:0,text:'a'}]};}};
 await x.store.exclusive(async(s,save)=>{for(const [id,p] of [['Idn_d5ArZvA','wallstreet'],['annR-E8m5WQ','bullbear'],['IggP39LRnT8','crypto']])s.videos[id]={video:video(id),programmes:[p],recipient:'123',stage:'text_waiting',firstSeen:now};await save();});
 await x.run().run();await x.run().run();assert.equal(calls,1);assert.equal(x.store.state.videos['annR-E8m5WQ'].stage,'text_waiting');assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'text_summary');
 const y=setup({vidiqApproved:true,summaryApproved:false});y.deps.captions=x.deps.captions;await y.run().importTranscript(source(video()));await y.run().run();assert.equal(calls,1);
});

test('Supadata routes only other two programmes and persists once under concurrent ticks',async()=>{
 const x=setup({summaryApproved:false,supadataApproved:true,supadataOrganizationId:'expected',supadataCycleStart:now-1000,supadataCycleEnd:now+86400000,supadataCycleLimit:90,supadataDailyLimit:4});let calls=[];
 x.deps.supadata={balance:async()=>({organizationId:'expected',maximum:100,remaining:98}),get:async id=>{calls.push(id);return {status:'ok',segments:[{start:0,text:'a'}]};}};
 await x.store.exclusive(async(s,save)=>{for(const [id,p] of [['Idn_d5ArZvA','wallstreet'],['annR-E8m5WQ','bullbear'],['IggP39LRnT8','crypto']])s.videos[id]={video:video(id),programmes:[p],recipient:'123',stage:'text_waiting',firstSeen:now};await save();});
 await Promise.all([x.run().run(),x.run().run()]);assert.deepEqual(calls,['annR-E8m5WQ','IggP39LRnT8']);assert.equal(x.store.state.supadata.used,2);assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'text_waiting');
 await x.run().run();assert.equal(calls.length,2);
});
test('Supadata uncertain call keeps reservation and cannot repeat after restart',async()=>{
 const x=setup({summaryApproved:false,supadataApproved:true,supadataOrganizationId:'expected',supadataCycleStart:now-1000,supadataCycleEnd:now+86400000,supadataCycleLimit:90,supadataDailyLimit:4});let calls=0;
 x.deps.supadata={balance:async()=>({organizationId:'expected',maximum:100,remaining:98}),get:async()=>{calls++;throw Error('timeout');}};
 await x.store.exclusive(async(s,save)=>{s.videos['annR-E8m5WQ']={video:video('annR-E8m5WQ'),programmes:['bullbear'],recipient:'123',stage:'text_waiting',firstSeen:now};await save();});
 await x.run().run();await x.run().run();assert.equal(calls,1);assert.equal(x.store.state.supadata.used,1);assert.equal(x.store.state.videos['annR-E8m5WQ'].stage,'text_review_required');
});
test('twice-daily runtime admits at most two slots and excludes prior trial video IDs',async()=>{
 const x=setup({dailyCheckTimes:['09:00','15:00'],excludedVideoIds:['Idn_d5ArZvA','annR-E8m5WQ','IggP39LRnT8']});
 let collection=0;let instant=Date.parse('2026-10-28T09:00:00+09:00');x.deps.clock=()=>instant;
 x.deps.discovery={list:async()=>{collection++;return [video()];}};
 await x.run().run();await x.run().run();assert.equal(collection,2); // two channels, one collection slot
 instant=Date.parse('2026-10-28T15:00:00+09:00');await x.run().run();await x.run().run();assert.equal(collection,4);
 assert.deepEqual(Object.keys(x.store.state.videos),[]);assert.equal(x.sent.length,0);
 assert.equal((await x.run().importTranscript(source(video()))).status,'previously_delivered_excluded');
});

test('failed summary (validation or timeout) is retried once immediately, never more',async()=>{
 const x=setup();let calls=0;
 x.deps.summarizer.summarize=async()=>{calls++;if(calls===1){const e=Error('insufficient_source_grounded_items');e.candidate={protocol:'evidence_ids_v1',calls:[{ceiling:1,status:'completed',raw:'{}'}]};throw e;}return result;};
 const r=x.run();await r.importTranscript(source(video()));
 await r.run();assert.equal(calls,2);assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'sent');assert.equal(x.sent.length,1);
 const y=setup();let ycalls=0;
 y.deps.summarizer.summarize=async()=>{ycalls++;const e=Error('insufficient_source_grounded_items');e.candidate={calls:[{ceiling:1,status:'completed'}]};throw e;};
 const ry=y.run();await ry.importTranscript(source(video()));await ry.run();await ry.run();await ry.run();assert.equal(ycalls,2);
 assert.equal(y.store.state.videos.Idn_d5ArZvA.summaryFailure,'insufficient_source_grounded_items');
 const z=setup();let zcalls=0;
 z.deps.summarizer.summarize=async()=>{zcalls++;const e=Error('timeout');e.candidate={calls:[{ceiling:1,status:'inflight'}]};throw e;};
 const rz=z.run();await rz.importTranscript(source(video()));await rz.run();await rz.run();assert.equal(zcalls,2);assert.equal(z.sent.length,0);
});

test('records held before the immediate-retry change get one retry at the next run',async()=>{
 const x=setup();let calls=0;x.deps.summarizer.summarize=async()=>{calls++;return result;};
 const r=x.run();await r.importTranscript(source(video()));
 await x.store.exclusive(async(s,save)=>{const v=s.videos.Idn_d5ArZvA;v.stage='text_review_required';v.hold='summary_failed_or_uncertain';v.summaryCandidate={calls:[{status:'completed'}]};await save();});
 await r.run();assert.equal(calls,1);assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'sent');
});

test('Supadata definite no-caption answer with no charge is refunded and retried next run',async()=>{
 const x=setup({summaryApproved:false,supadataApproved:true,supadataOrganizationId:'expected',supadataCycleStart:now-1000,supadataCycleEnd:now+86400000,supadataCycleLimit:90,supadataDailyLimit:4});let calls=0;
 x.deps.supadata={balance:async()=>({organizationId:'expected',maximum:100,remaining:98}),get:async()=>{calls++;return {status:'pending',httpStatus:202};}};
 await x.store.exclusive(async(s,save)=>{s.videos['annR-E8m5WQ']={video:video('annR-E8m5WQ'),programmes:['bullbear'],recipient:'123',stage:'text_waiting',firstSeen:now};await save();});
 await x.run().run();assert.equal(x.store.state.supadata.used,0);assert.equal(x.store.state.videos['annR-E8m5WQ'].stage,'text_waiting');
 await x.run().run();await x.run().run();await x.run().run();assert.equal(calls,3);assert.equal(x.store.state.videos['annR-E8m5WQ'].stage,'text_review_required');
});

test('user-disabled programme is not collected and pending records stop',async()=>{
 const x=setup({disabledProgrammes:['crypto']});
 const crypto={id:'cryptoVid01',title:'코인 전망 [크립토 PLUS]',description:'크립토 PLUS',channelId:PROGRAMMES[2].channelId,publishedAt:now-1000,durationSeconds:600,visibility:'public',status:'completed',isShort:false,isRebroadcast:false};
 x.deps.discovery={list:async c=>c===crypto.channelId?[crypto]:[]};
 await x.run().run();assert.equal(x.store.state.videos.cryptoVid01,undefined);
 await x.store.exclusive(async(s,save)=>{s.videos.old00000001={video:{...crypto,id:'old00000001'},programmes:['crypto'],recipient:'123',stage:'text_summary',transcript:[{start:0,text:'x'}],firstSeen:now};await save();});
 await x.run().run();assert.equal(x.store.state.videos.old00000001.hold,'programme_disabled_by_user');assert.equal(x.sent.length,0);
});
