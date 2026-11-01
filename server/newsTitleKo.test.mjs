import test from 'node:test';import assert from 'node:assert/strict';
import {translateTitles,needsTitleKo,parseTitles} from './newsTitleKo.mjs';
const now=Date.parse('2026-11-01T04:00:00Z');
const ev=(id,t,extra={})=>({id,title:t,originalTitle:t,analysisStatus:'screened',firstSeenAt:new Date(now).toISOString(),...extra});
function deps(answer){const saved={},b={month:'2026-11',nano:0};let calls=0;return {saved,b,calls:()=>calls,d:{now:()=>now,deadline:now+120000,generate:async p=>{calls++;const items=JSON.parse(p.slice(p.lastIndexOf('\n')+1)).items;return {text:JSON.stringify({items:items.map(answer)}),usage:{in:500,out:800}};},budget:{read:async()=>b,add:async(m,n)=>{b.month=m;b.nano+=n;}},save:async(id,ko)=>{saved[id]=ko;}}};}
test('untranslated, not-completed English titles are translated in batches; usage settles the budget',async()=>{
 const x=deps(it=>({i:it.i,ko:'번역문'}));
 const events=[...Array.from({length:45},(_,i)=>ev('e'+i,'SpaceX news '+i)),ev('done','Done',{analysisStatus:'completed'}),ev('ko','이미 한국어'),ev('has','X',{titleKo:'있음'})];
 const r=await translateTitles(events,x.d);
 assert.equal(r.pending,45);assert.equal(r.calls,2);assert.equal(Object.keys(x.saved).length,45);assert.equal(r.translated,45);
 assert.equal(x.b.nano,2*(500*300+800*2500));
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
