import test from 'node:test';import assert from 'node:assert/strict';
import {translateTitles,needsTitleKo,parseTitles,titleKey} from './newsTitleKo.mjs';
import {createTitleKoStore,TITLE_RETRY_MS} from './newsTitleKoStore.mjs';
const now=Date.parse('2026-11-01T04:00:00Z');
const ev=(id,t,extra={})=>({id,title:t,originalTitle:t,analysisStatus:'screened',firstSeenAt:new Date(now).toISOString(),...extra});
function memoryDb(b){
 const docs=new Map([['news_title_ko_budget/state',b]]);let serial=Promise.resolve();
 const snap=r=>({exists:docs.has(r.path),data:()=>docs.get(r.path)?structuredClone(docs.get(r.path)):undefined});
 return {collection:c=>({doc:k=>({path:c+'/'+k})}),getAll:async(...refs)=>refs.map(snap),runTransaction:fn=>{
  const result=serial.then(()=>fn({get:async r=>snap(r),set:(r,v)=>{if(r.path==='news_title_ko_budget/state')Object.assign(b,v);else docs.set(r.path,structuredClone(v));}}));
  serial=result.catch(()=>{});return result;
 }};
}
function deps(answer){const saved={},b={month:'2026-11',nano:0};let calls=0;return {saved,b,calls:()=>calls,d:{now:()=>now,deadline:now+120000,generate:async p=>{calls++;const items=JSON.parse(p.slice(p.lastIndexOf('\n')+1)).items;return {text:JSON.stringify({items:items.map(answer)}),usage:{in:500,out:800}};},store:createTitleKoStore(memoryDb(b)),save:async(id,ko)=>{saved[id]=ko;return true;}}};}

test('untranslated, not-completed English titles are translated in batches; usage settles the budget',async()=>{
 const x=deps(it=>({i:it.i,ko:'번역문'}));
 const events=[...Array.from({length:45},(_,i)=>ev('e'+i,'SpaceX news '+i)),ev('done','Done',{analysisStatus:'completed'}),ev('ko','이미 한국어'),ev('has','X',{titleKo:'있음'})];
 const r=await translateTitles(events,x.d);
 assert.equal(r.pending,45);assert.equal(r.calls,2);assert.equal(Object.keys(x.saved).length,45);assert.equal(r.translated,45);
 assert.equal(x.b.nano,2*(500*125+800*500));
 assert.ok(!('done' in x.saved)&&!('ko' in x.saved)&&!('has' in x.saved));
});
test('numbers not in the source drop that translation',()=>{
 const items=[{i:0,t:'Nvidia rises 4%'}];
 assert.equal(parseTitles(JSON.stringify({items:[{i:0,ko:'엔비디아 5% 상승'}]}),items).size,0);
 assert.equal(parseTitles(JSON.stringify({items:[{i:0,ko:'엔비디아 4% 상승'}]}),items).get(0),'엔비디아 4% 상승');
});
test('monthly cap stops before calling',async()=>{
 const x=deps(it=>({i:it.i,ko:'번역'}));x.b.nano=999_999_000;
 const r=await translateTitles([ev('a','A news')],x.d);assert.equal(r.stopped,'month_cap');assert.equal(x.calls(),0);
 assert.equal(needsTitleKo(ev('s','Skip',{analysisStatus:'skipped'})),false);
});

test('same source title is generated once and a persisted result repairs event-save failure without a new call',async()=>{
 const x=deps(it=>({i:it.i,ko:'회사 성장'}));let first=true;
 x.d.save=async(id,ko)=>{if(first)return false;x.saved[id]=ko;return true;};
 const es=[ev('a','Company growth'),ev('b','Company growth')];
 const r=await translateTitles(es,x.d);assert.equal(r.translated,0);assert.equal(x.calls(),1);
 first=false;const again=await translateTitles(es,x.d);assert.equal(again.translated,2);assert.equal(x.calls(),1);
});
test('rejected output has a cooldown and at most one validation retry',async()=>{
 const x=deps(it=>({i:it.i,ko:'Company English'})),es=[ev('a','Company growth')];
 await translateTitles(es,x.d);await translateTitles(es,x.d);assert.equal(x.calls(),1);
 x.d.now=()=>now+TITLE_RETRY_MS+1;x.d.deadline=now+TITLE_RETRY_MS+120000;
 await translateTitles(es,x.d);assert.equal(x.calls(),2);
 x.d.now=()=>now+2*TITLE_RETRY_MS+2;x.d.deadline=now+2*TITLE_RETRY_MS+120000;
 await translateTitles(es,x.d);assert.equal(x.calls(),2);
});
test('ambiguous response and missing usage are not automatically sent again',async()=>{
 for(const mode of ['timeout','usage']){
  const x=deps(it=>({i:it.i,ko:'회사 성장'}));let calls=0;
  x.d.generate=async()=>{calls++;if(mode==='timeout')throw Error('timeout');return {text:'{}'};};
  await translateTitles([ev('a','Company growth')],x.d);const reserved=x.b.nano;
  await translateTitles([ev('a','Company growth')],x.d);assert.equal(calls,1);assert.equal(x.b.nano,reserved);assert.ok(reserved>0);
 }
});
test('two workers cannot reserve or generate the same title twice',async()=>{
 const x=deps(it=>({i:it.i,ko:'회사 성장'}));
 await Promise.all([translateTitles([ev('a','Company growth')],x.d),translateTitles([ev('a','Company growth')],x.d)]);
 assert.equal(x.calls(),1);assert.equal(x.b.nano,500*125+800*500);
});

test('invalid reservations fail closed and a late settlement never refunds into a new month',async()=>{
 const b={month:'2026-11',nano:0},store=createTitleKoStore(memoryDb(b)),keys=[titleKey('Example')];
 const request={keys,month:'2026-11',reserveNano:1000,capNano:1e9,now};
 await assert.rejects(store.reserve({...request,capNano:NaN}));
 assert.equal(b.nano,0);
 const claim=await store.reserve(request);assert.equal(claim.ok,true);assert.equal(b.nano,1000);
 Object.assign(b,{month:'2026-12',nano:2000});
 await store.settle({...request,attemptId:claim.attemptId,actualNano:100,results:{[keys[0]]:'cached'},now:now+1});
 assert.deepEqual(b,{month:'2026-12',nano:2000});
 assert.equal((await store.read(keys))[keys[0]].status,'ready');
 await assert.rejects(store.settle({...request,attemptId:claim.attemptId,actualNano:100,results:{},now:now+2}));
});
