import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredWallstreetRuntime} from './providers.mjs';
import {FirestoreWallstreetStore,COLLECTION} from './firestoreStore.mjs';
import {wallstreetConfig} from './config.mjs';
import {PROGRAMMES} from './programmes.mjs';

// Real factory, adapters, summarizer, validation, transactional state, schedule,
// cost accounting and outbox. Only external discovery/caption/HTTP are simulated.
class TransactionalDatabase{
 data=new Map();tail=Promise.resolve();maxDay=0;maxMonth=0;
 collection(name){return {doc:id=>({path:name+'/'+id})};}
 async runTransaction(fn){
  const prior=this.tail;let release;this.tail=new Promise(r=>release=r);await prior;
  try{
   const writes=new Map();let writing=false;
   const result=await fn({get:async ref=>{assert.equal(writing,false);const value=this.data.get(ref.path);return {exists:value!==undefined,data:()=>structuredClone(value)};},set:(ref,value)=>{writing=true;writes.set(ref.path,structuredClone(value));},delete:ref=>{writing=true;writes.set(ref.path,undefined);}});
   for(const [key,value] of writes)value===undefined?this.data.delete(key):this.data.set(key,value);
   const head=this.data.get(COLLECTION+'/head');
   if(head){const encoded=Array.from({length:head.count},(_,i)=>this.data.get(COLLECTION+'/state-'+String(i).padStart(3,'0')).base64).join('');const state=JSON.parse(Buffer.from(encoded,'base64').toString());
    for(const [key,value] of Object.entries(state.budgets)){if(/^text:\d{4}-\d{2}-\d{2}$/.test(key)){assert.ok(value<=260000);this.maxDay=Math.max(this.maxDay,value);}else if(/^text:\d{4}-\d{2}$/.test(key)){assert.ok(value<=2000000);this.maxMonth=Math.max(this.maxMonth,value);}}
    for(const r of Object.values(state.videos))if(r.summarySpentMicros!==undefined)assert.ok(r.summarySpentMicros<=30000);
   }return result;
  }finally{release();}
 }
}
const day=Date.parse('2026-11-17T00:00:00Z'); // 09:00 KST
const point=b=>({title:'조건부 전망',text:`출연자는 뉴스 ${b.text.match(/\d+/)[0]} 관련 조건부 전망을 소개했습니다.`,kind:'outlook',evidenceIds:[b.id]});
const check=(index,good)=>({index,supported:good,classificationCorrect:true,recommendedKind:'outlook',counterStatus:good?'clear':'uncertain',sourceIds:[],duplicateOf:null,reason:good?'근거 일치':'외부 선임의 대상 불명확'});
function fixture({repairFirst=false,failAgain=false,unknownDelivery=false}={}){
 const db=new TransactionalDatabase();let now=day,captions=0,extracts=0,telegram=0;const calls=[];
 const video={id:'futureVid01',title:'신규 영상 '+PROGRAMMES[0].name,description:PROGRAMMES[0].name,channelId:PROGRAMMES[0].channelId,publishedAt:day-1000,durationSeconds:600,status:'completed',visibility:'public',isShort:false,isRebroadcast:false};
 const transcript=Array.from({length:36},(_,i)=>({start:i*16,text:`뉴스 ${i} 관련 조건부 전망입니다.`}));
 const config={...wallstreetConfig,enabled:true,activatedAt:day-86400000,summaryApproved:true,deliveryApproved:true,discoveryApproved:true,vidiqApproved:true,supadataApproved:false,ceoVideo:{enabled:false}};
 const fetcher=async(url,opts)=>{
  const body=JSON.parse(opts.body);
  if(url==='https://api.openai.com/v1/responses'){
   const name=body.text.format.name,p=JSON.parse(body.input[1].content.split('\n')[1]);calls.push(name);let result;
   if(name.startsWith('extract_')){
    extracts++;const items=p.blocks.slice(0,3).map(point);
    if(extracts===1||failAgain)items[1].text+=' 외부 선임이 필요하다고 말했습니다.';
    result={items};
   }else if(name==='clarify'){
    assert.match(body.input[1].content,/remove unsupported or ambiguous peripheral clauses/i);
    result={items:repairFirst?[point(p.blocks.find(b=>b.text.includes('뉴스 '+p.drafts[0].text.match(/뉴스 (\d+)/)[1]+' ')))]:[]};
   }else if(name==='audit'||name==='audit_qualified')result={checks:p.drafts.map((x,i)=>check(i,!x.text.includes('외부 선임')))};
   else throw Error('unexpected_stage_'+name);
   return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}],usage:{input_tokens:1000,output_tokens:200}});
  }
  assert.equal(url,'https://api.telegram.org/botmock/sendMessage');assert.equal(body.chat_id,config.recipient);telegram++;
  if(unknownDelivery)throw Error('uncertain_transport');return Response.json({ok:true,result:{message_id:telegram}});
 };
 const runtime=()=>createConfiguredWallstreetRuntime({getFirestore:()=>db,config,env:{OPENAI_API_KEY:'mock',TELEGRAM_BOT_TOKEN:'mock'},fetcher,textDependencies:{clock:()=>now,discovery:{list:async channel=>channel===video.channelId?[video]:[]},captions:{balance:async()=>({type:'limited',renewableCredits:150,maxRenewableCredits:150,renewableResetsAt:'2026-12-01T00:00Z'}),get:async()=>{captions++;return {status:'ok',segments:transcript};}}}});
 return {db,runtime,store:()=>new FirestoreWallstreetStore(db),advance:()=>{now+=6*3600000;},counts:()=>({captions,extracts,telegram,calls:[...calls]}),video};
}

test('new discovery automatically uses semantic clarification and unchanged checks before a single delivery',async()=>{
 const x=fixture({repairFirst:true});await x.runtime().run();
 const state=await x.store().read(),r=state.videos[x.video.id];
 assert.equal(r.stage,'sent');assert.deepEqual(x.counts().calls,['extract_0','audit','clarify','audit_qualified']);
 assert.equal(r.summaryCandidate.items.length,3);assert.ok(r.summaryCandidate.audit.checks.every(c=>c.supported&&c.counterStatus==='clear'&&c.duplicateOf===null));
 await x.runtime().run();x.advance();await x.runtime().run();assert.equal(x.counts().telegram,1);assert.equal(x.counts().captions,1);assert.equal(x.counts().extracts,1);
});

test('next scheduled slot claims exactly one correction after restart and retains original video/day/month caps',async()=>{
 const x=fixture();await x.store().exclusive(async(s,save)=>{s.budgets={'text:2026-11-17':230000,'text:2026-11':1970000};await save();});
 await x.runtime().run();let r=(await x.store().read()).videos[x.video.id];assert.equal(r.stage,'text_review_required');assert.equal(x.counts().telegram,0);
 await x.runtime().run();assert.equal(x.counts().extracts,1); // same slot is not another attempt
 x.advance();await x.runtime().run();r=(await x.store().read()).videos[x.video.id];assert.equal(r.stage,'sent');assert.equal(r.summaryAutoRetry.attempts,1);assert.equal(r.summaryAutoRetry.status,'recovered');
 const before=x.counts();for(let i=0;i<4;i++){x.advance();await x.runtime().run();}assert.deepEqual(x.counts(),before);
 assert.equal(before.extracts,2);assert.equal(before.captions,1);assert.equal(before.telegram,1);assert.equal(x.db.maxDay,260000);assert.equal(x.db.maxMonth,2000000);
});

test('a second rejected summary stays held across future schedules and never sends',async()=>{
 const x=fixture({failAgain:true});for(let i=0;i<6;i++){await x.runtime().run();x.advance();}
 const r=(await x.store().read()).videos[x.video.id];assert.equal(r.summaryAutoRetry.attempts,1);assert.equal(r.summaryAutoRetry.status,'review_required');assert.equal(r.stage,'text_review_required');
 assert.equal(x.counts().extracts,2);assert.equal(x.counts().captions,1);assert.equal(x.counts().telegram,0);
});

test('an uncertain Telegram response never sends or summarizes again',async()=>{
 const x=fixture({repairFirst:true,unknownDelivery:true});await x.runtime().run();const before=x.counts();
 for(let i=0;i<4;i++){x.advance();await x.runtime().run();}
 const r=(await x.store().read()).videos[x.video.id];assert.equal(r.parts[0].status,'unknown');assert.deepEqual(x.counts(),before);assert.equal(before.telegram,1);
});
