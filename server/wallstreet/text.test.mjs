import test from 'node:test';
import assert from 'node:assert/strict';
import {createTextRuntime,renderBrief,parseUiTranscript,TEXT_PROJECT,SUMMARY_FIX_VERSION} from './textRuntime.mjs';
import {PROGRAMMES} from './programmes.mjs';
import {PUBLIC_CHANNEL_ID,isApprovedDeliveryRecipient} from './publicChannel.mjs';
const now=Date.parse('2026-10-28T10:00:00Z');

test('approved public channel delivers once; unrelated channels remain blocked and private backlog is not replayed',async()=>{
 const x=setup({recipient:PUBLIC_CHANNEL_ID,deliveryMode:'immediate'}),r=x.run();
 await r.importTranscript(source(video()));
 await Promise.all([r.run(),r.run()]);await x.run().run();
 assert.equal(x.sent.length,1);assert.equal(x.sent[0].id,PUBLIC_CHANNEL_ID);
 assert.equal(x.store.state.videos[video().id].stage,'sent');
 for(const id of ['-1009999999','@unapproved','0',''])assert.equal(isApprovedDeliveryRecipient(id),false);
 const legacy=setup();await legacy.run().importTranscript(source(video()));
 legacy.deps.config.recipient=PUBLIC_CHANNEL_ID;legacy.deps.config.deliveryMode='immediate';
 await legacy.run().run();assert.equal(legacy.sent.length,0);
});

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
test('unknown Telegram delivery never retries',async()=>{const x=setup();let calls=0;x.deps.telegram.send=async()=>{calls++;throw Error('timeout');};const r=x.run();await r.importTranscript(source(video()));await r.run();await r.run();assert.equal(calls,1);assert.equal(x.store.state.videos.Idn_d5ArZvA.telegramParts[0].status,'unknown');});
test('daily budget atomically holds second video, schedule can hold first',async()=>{const x=setup({dailySummaryMicros:100,deliveryTime:'23:00'}),r=x.run();await r.importTranscript(source(video()));await r.importTranscript(source(video('annR-E8m5WQ')));await Promise.all([r.run(),r.run()]);assert.equal(x.sent.length,0);assert.equal(x.store.state.videos['annR-E8m5WQ'].hold,'text_budget');});
test('discovery without authorized caption collector waits, no title summary',async()=>{const x=setup();x.deps.discovery={list:async c=>Object.assign(c===video().channelId?[video()]:[],{coverageComplete:false})};await x.run().run();assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'text_waiting');assert.equal(x.sent.length,0);});
test('reject transcript mismatch, unsupported number and unverified cap',async()=>{assert.throws(()=>parseUiTranscript(source(video()).text,video('annR-E8m5WQ')));assert.throws(()=>renderBrief(video(),[{start:0,text:'수요 증가'}],{items:result.items.map(x=>({...x,text:'수요 99% 증가'}))}));const x=setup({combinedTokenCapVerified:false}),r=x.run();await r.importTranscript(source(video()));await r.run();assert.equal(x.sent.length,0);assert.equal(x.store.state.videos.Idn_d5ArZvA.stage,'text_summary');});
test('summary timeout keeps its reservation and is never retried',async()=>{const x=setup();let calls=0;x.deps.summarizer.summarize=async()=>{calls++;throw Error('timeout');};const r=x.run();await r.importTranscript(source(video()));await r.run();await r.run();assert.equal(calls,1);assert.equal(Object.values(x.store.state.budgets)[0],100);});

test('Luna retry policy persists checkpoint, disables immediate and later full-video retries',async()=>{
 const x=setup({automaticSummaryRetries:false});let calls=0;
 x.deps.summarizer.summarize=async({checkpoint,saveCheckpoint})=>{calls++;checkpoint.completedWindow={items:[]};await saveCheckpoint();throw Error('timeout');};
 const r=x.run();await r.importTranscript(source(video()));await r.run();await x.run().run();
 assert.equal(calls,1);assert.deepEqual(x.store.state.videos.Idn_d5ArZvA.summaryCheckpoint.completedWindow,{items:[]});
 const held=x.store.state.videos.Idn_d5ArZvA;held.summaryRetried=true;held.summaryFailedAt=now-3600000;held.summaryFailure='insufficient_context_reviewed_items';
 await x.run().run();assert.equal(calls,1);
});

test('long detailed publication sends a single digest and never repeats it',async()=>{
  const x=setup();let calls=0;
  x.deps.summarizer.summarize=async()=>({items:Array.from({length:5},()=>({text:'a'.repeat(690),kind:'fact',speaker:'host',segment:0,quote:'a'.repeat(690)}))});
  x.deps.telegram.send=async()=>{calls++;return calls===1?{status:'sent',messageId:'one'}:{status:'unknown'};};
  const r=x.run(),v=video();await r.importTranscript({video:v,text:`YouTube transcript\nVideo ID: ${v.id}\n[0:00] ${'a'.repeat(690)}`,provenance:{method:'youtube_ui',videoId:v.id}});
  await r.run();await x.run().run();const parts=x.store.state.videos[v.id].parts;
  assert.equal(parts.length,2);assert.ok(parts.every(p=>p.text.length<4096));assert.ok(parts.every(p=>p.status==='sent'));assert.equal(calls,1);assert.equal(x.store.state.videos[v.id].telegramParts.length,1);
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

test('known validation failure retries only on the next run, within the original video cap and exactly once across restart/concurrency',async()=>{
 const x=setup({automaticSummaryRetryOnce:true});let calls=0;const limits=[];
 x.deps.summarizer.summarize=async({maxCostMicros,checkpoint})=>{limits.push(maxCostMicros);calls++;if(calls===1){const e=Error('insufficient_source_grounded_items');e.candidate={calls:[{ceiling:10,status:'completed',costMicros:10}]};throw e;}assert.equal(checkpoint.automaticRetryAttempt,1);return result;};
 await x.run().importTranscript(source(video()));await x.run().run();assert.equal(calls,1);assert.equal(x.sent.length,0);
 await Promise.all([x.run().run(),x.run().run()]);await x.run().run();
 assert.equal(calls,2);assert.deepEqual(limits,[100,90]);assert.equal(x.sent.length,1);
 const v=x.store.state.videos.Idn_d5ArZvA;assert.equal(v.summarySpentMicros,100);assert.equal(v.summaryAutoRetry.attempts,1);assert.equal(v.summaryAutoRetry.status,'recovered');
});

test('second validation failure stays held; unavailable budget does not consume the one retry',async()=>{
 const x=setup({automaticSummaryRetryOnce:true});let calls=0;
 x.deps.summarizer.summarize=async()=>{calls++;const e=Error('insufficient_context_reviewed_items');e.candidate={calls:[{ceiling:10,status:'completed',costMicros:10}]};throw e;};
 await x.run().importTranscript(source(video()));await x.run().run();
 x.deps.config.dailySummaryMicros=50;await x.run().run();assert.equal(calls,1);assert.equal(x.store.state.videos.Idn_d5ArZvA.summaryAutoRetry,undefined);
 x.deps.config.dailySummaryMicros=300;await x.run().run();await x.run().run();
 assert.equal(calls,2);assert.equal(x.store.state.videos.Idn_d5ArZvA.summaryAutoRetry.status,'review_required');assert.equal(x.sent.length,0);
});

test('legacy held records without settled charges are never automatically replayed',async()=>{
 const x=setup({automaticSummaryRetryOnce:true});let calls=0;x.deps.summarizer.summarize=async()=>{calls++;return result;};
 await x.run().importTranscript(source(video()));
 await x.store.exclusive(async(s,save)=>{const v=s.videos.Idn_d5ArZvA;v.stage='text_review_required';v.hold='summary_failed_or_uncertain';v.summaryCandidate={calls:[{status:'completed'}]};await save();});
 await x.run().run();assert.equal(calls,0);assert.equal(x.sent.length,0);
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

test('validator version changes never reset an already consumed allowance',async()=>{
 const x=setup({automaticSummaryRetryOnce:true});let calls=0;x.deps.summarizer.summarize=async()=>{calls++;return result;};
 const r=x.run();await r.importTranscript(source(video()));
 await x.store.exclusive(async(s,save)=>{const v=s.videos.Idn_d5ArZvA;v.stage='text_review_required';v.hold='summary_failed_or_uncertain';v.summaryFailure='evidence_topic_span';v.summaryFailedAt=now-3*3600000;v.summaryRetried=true;await save();});
 await r.run();assert.equal(calls,0);assert.equal(x.sent.length,0);
});

test('web-only supplement reuses the stored result, never re-summarizes or sends Telegram, and waits for new videos',async()=>{
 const x=setup({summaryProtocol:'evidence_ids_v1',resummarize:{version:2,ids:['Idn_d5ArZvA']}});let full=0,sup=0;
 x.deps.summarizer.summarize=async()=>{full++;throw Error('x');};
 x.deps.summarizer.supplement=async()=>{sup++;throw Error('nothing_to_supplement');};
 await x.store.exclusive(async(s,save)=>{s.videos.Idn_d5ArZvA={video:video(),programmes:['wallstreet'],recipient:'123',stage:'sent',transcript:[{start:0,text:'a'}],parts:[{text:'old',status:'sent'}],summaryCandidate:{validationJournal:{}},firstSeen:now};await save();});
 await x.run().run();await x.run().run();
 const r=x.store.state.videos.Idn_d5ArZvA;
 assert.equal(full,0);assert.equal(sup,1);assert.equal(x.sent.length,0);assert.equal(r.parts[0].text,'old');assert.equal(r.supplementFailure,'nothing_to_supplement');
});

test('finished videos drop their transcript and validation journal after 3 days, keeping the summary',async()=>{
 const x=setup();
 await x.store.exclusive(async(s,save)=>{s.videos.Idn_d5ArZvA={video:video(),programmes:['wallstreet'],recipient:'123',stage:'sent',transcript:[{start:0,text:'a'}],parts:[{text:'요약',status:'sent'}],summaryCandidate:{items:[1],validationJournal:{big:'x'}},firstSeen:now-4*86400000};
  s.videos['annR-E8m5WQ']={video:video('annR-E8m5WQ'),programmes:['bullbear'],recipient:'123',stage:'sent',transcript:[{start:0,text:'b'}],parts:[{text:'요약',status:'sent'}],firstSeen:now-86400000};await save();});
 await x.run().run();
 const old=x.store.state.videos.Idn_d5ArZvA,fresh=x.store.state.videos['annR-E8m5WQ'];
 assert.equal(old.transcript,undefined);assert.equal(old.summaryCandidate.validationJournal,undefined);assert.deepEqual(old.summaryCandidate.items,[1]);assert.equal(old.parts[0].text,'요약');
 assert.ok(Array.isArray(fresh.transcript));
});

test('unknown checkpoint outcome, exhausted video cap, delivery uncertainty and claimed crash are held',async()=>{
 for(const mutate of [v=>{v.summaryCheckpoint={entries:{one:{status:'inflight'}}};},v=>{v.summarySpentMicros=100;},v=>{v.parts=[{status:'unknown'}];},v=>{v.summaryAutoRetry={attempts:1,status:'inflight'};}]){
  const x=setup({automaticSummaryRetryOnce:true});let calls=0;x.deps.summarizer.summarize=async()=>{calls++;return result;};
  await x.run().importTranscript(source(video()));await x.store.exclusive(async(s,save)=>{const v=s.videos.Idn_d5ArZvA;Object.assign(v,{stage:'text_review_required',hold:'summary_failed_or_uncertain',summaryFailure:'insufficient_context_reviewed_items',summarySpentMicros:10,summaryCandidate:{calls:[{status:'completed'}]}});mutate(v);await save();});
  await x.run().run();await x.run().run();assert.equal(calls,0);assert.equal(x.sent.length,0);
 }
});

test('vidIQ caption failure retries once at a later run; uncharged call is refunded',async()=>{
 const x=setup({vidiqApproved:true,summaryApproved:false});let calls=0,credits=145;
 x.deps.captions={balance:async()=>({type:'limited',renewableCredits:credits,maxRenewableCredits:150,renewableResetsAt:'2026-11-28T00:00Z'}),get:async()=>{calls++;return {status:'processing'};}};
 await x.store.exclusive(async(s,save)=>{s.videos.Idn_d5ArZvA={video:video(),programmes:['wallstreet'],recipient:'123',stage:'text_waiting',firstSeen:now};await save();});
 await x.run().run();let r=x.store.state.videos.Idn_d5ArZvA;
 assert.equal(r.stage,'text_waiting');assert.equal(r.hold,'vidiq_failed_retry_next_run');assert.equal(r.captionFailure,'vidiq_processing');assert.equal(x.store.state.vidiq.used,0);
 await x.run().run();r=x.store.state.videos.Idn_d5ArZvA;assert.equal(calls,2);
 assert.equal(r.stage,'text_review_required');assert.equal(r.hold,'caption_failed_or_uncertain_no_retry');
 await x.run().run();assert.equal(calls,2);
});

test('long-video reservation is larger; unused reservation is given back from recorded call ceilings only', async () => {
 const { summaryReservation, settleReservation } = await import('./textRuntime.mjs');
 const c = { summaryReservationMicros: 30000, longSummaryReservationMicros: 50000, longSummaryMinutes: 30 };
 assert.equal(summaryReservation(c, [{ start: 0 }, { start: 20 * 60 }]), 30000);
 assert.equal(summaryReservation(c, [{ start: 0 }, { start: 45 * 60 }]), 50000);
 const s = { budgets: { 'text:2026-11-10': 50000, 'text:2026-11': 90000 } }, held = { keys: ['text:2026-11-10', 'text:2026-11'], amount: 50000 };
 assert.equal(settleReservation(s, held, undefined), 0, 'unknown outcome keeps all');
 assert.equal(settleReservation(s, held, { calls: [{ ceiling: 12000 }, { ceiling: 3000 }] }), 35000);
 assert.deepEqual(s.budgets, { 'text:2026-11-10': 15000, 'text:2026-11': 55000 });
});

test('web-only full re-summary: replaces the web view only with more points, never Telegram, once per version', async () => {
 const x = setup({ summaryProtocol: 'evidence_ids_v1', summaryReservationMicros: 100, dailySummaryMicros: 1000, monthlySummaryMicros: 1000, fullResummarize: { version: 1, ids: ['Idn_d5ArZvA', 'annR-E8m5WQ'] } });
 let full = 0;
 const { acceptVerification } = await import('./groundedSummary.mjs');
 const mk = n => { const r = acceptVerification(Array.from({ length: n }, (_, i) => ({ title: `주제 ${i}`, text: `요약 ${i}`, kind: 'outlook', starts: [i * 60] })), { checks: Array.from({ length: n }, (_, index) => ({ index, supported: true, classificationCorrect: true, reason: 'ok' })) }); r.validationJournal = { calls: [{ ceiling: 10 }] }; return r; };
 x.deps.summarizer.summarize = async ({ video }) => { full++; return mk(video.id === 'Idn_d5ArZvA' ? 6 : 2); };
 const old = id => ({ video: video(id), programmes: ['wallstreet'], recipient: '123', stage: 'sent', transcript: [{ start: 0, text: 'a' }], parts: [{ text: 'old', status: 'sent' }], summaryCandidate: { items: [1, 2, 3] }, firstSeen: now });
 await x.store.exclusive(async (s, save) => { s.videos.Idn_d5ArZvA = old('Idn_d5ArZvA'); s.videos['annR-E8m5WQ'] = old('annR-E8m5WQ'); await save(); });
 await x.run().run(); await x.run().run();
 const a = x.store.state.videos.Idn_d5ArZvA, b = x.store.state.videos['annR-E8m5WQ'];
 assert.equal(full, 2, 'once per video'); assert.equal(x.sent.length, 0);
 assert.ok(a.parts.every(p => p.webOnly && p.status === 'sent'), JSON.stringify(a.fullResummary)); assert.match(a.parts.map(p => p.text).join('\n'), /요약 5/);
 assert.equal(a.previousParts[0].text, 'old'); assert.deepEqual(a.fullResummary, { before: 3, after: 6 });
 assert.equal(b.parts[0].text, 'old'); assert.equal(b.fullResummary.kept, 'previous');
});


