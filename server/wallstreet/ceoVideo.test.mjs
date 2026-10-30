import test from 'node:test';
import assert from 'node:assert/strict';
import {matchCeoVideo,verifyQuotes,transcriptBlocks,runCeoVideoStep,ceoVideoStatements,createCeoQuoteExtractor} from './ceoVideo.mjs';

// Fictional videos and transcripts only.
const v=(id,title,extra={})=>({id,title,channelId:'UCrp_UI8XtuYfpiqluWLD7Lw',channelTitle:'CNBC Television',publishedAt:Date.parse('2026-10-29T12:00:00Z'),durationSeconds:900,...extra});

test('only CEO-named, non-commentary, long-enough videos match; Musk split by company',()=>{
  assert.equal(matchCeoVideo(v('aaaaaaaaaaa','Nvidia CEO Jensen Huang on AI demand')).companyId,'nvda');
  assert.equal(matchCeoVideo(v('bbbbbbbbbbb','Elon Musk on Tesla robotaxi')).companyId,'tsla');
  assert.equal(matchCeoVideo(v('ccccccccccc','Elon Musk talks Starship')).companyId,'spacex');
  assert.equal(matchCeoVideo(v('ddddddddddd','Elon Musk on politics')),null);
  assert.equal(matchCeoVideo(v('eeeeeeeeeee','Jensen Huang reacts? Analysis of the keynote')),null);
  assert.equal(matchCeoVideo(v('fffffffffff','Satya Nadella clip',{durationSeconds:60})),null);
});

const segments=Array.from({length:12},(_,i)=>({start:i*10,text:i===3?'We are seeing demand for accelerated computing that is far greater than our supply right now, and that will continue next year':'filler words about the market today number '+i}));

test('quotes must exist in the transcript block; invented text is dropped',()=>{
  const blocks=transcriptBlocks(segments);
  const ok=verifyQuotes({items:[
    {blockId:blocks[1].id,quote:'We are seeing demand for accelerated computing that is far greater than our supply right now.',topic:'demand',ko:'수요가 공급보다 훨씬 큽니다.'},
    {blockId:blocks[1].id,quote:'We will triple revenue next year because demand is unlimited and supply is solved.',topic:'invented'},
  ]},blocks);
  assert.equal(ok.length,1);assert.equal(ok[0].topic,'demand');assert.equal(ok[0].start,blocks[1].start);
});

function memoryState(){return {videos:{},supadata:null};}
const cfg={ceoVideo:{enabled:true,dailyVideos:1,monthlyVideos:15,reservationMicros:20000,dailyMicros:40000,monthlyMicros:400000},
  supadataOrganizationId:'org',supadataCycleStart:Date.parse('2026-10-29T00:00:00Z'),supadataCycleEnd:Date.parse('2026-11-27T00:00:00Z'),supadataCycleLimit:90,supadataDailyLimit:4};
const now=Date.parse('2026-10-30T06:00:00Z');

test('one video per day, shares Supadata counters, stores only verified quotes',async()=>{
  const s=memoryState();let gets=0,gens=0;
  const discovery={list:async ch=>ch==='UCrp_UI8XtuYfpiqluWLD7Lw'?[v('aaaaaaaaaaa','Jensen Huang interview'),v('bbbbbbbbbbb','Satya Nadella interview')]:[]};
  const supadata={balance:async()=>({organizationId:'org',maximum:100,remaining:90}),get:async(id,opt)=>{gets++;assert.equal(opt.lang,'en');return {status:'ok',segments};}};
  const blocks=transcriptBlocks(segments);
  const extractor=createCeoQuoteExtractor({client:{countTokens:async()=>({totalTokens:1000}),generate:async()=>{gens++;return {text:JSON.stringify({items:[{blockId:blocks[1].id,quote:'We are seeing demand for accelerated computing that is far greater than our supply right now',topic:'demand',ko:'번역'}]})};}}});
  const save=async()=>{};
  const r1=await runCeoVideoStep({s,save,now,c:cfg,discovery,supadata,extractor});
  assert.match(r1.status,/ceo_video_done/);
  const r2=await runCeoVideoStep({s,save,now:now+3600000,c:cfg,discovery,supadata,extractor});
  assert.equal(r2.status,'ceo_video_cap');assert.equal(gets,1);assert.equal(gens,1);assert.equal(s.supadata.used,1);
  const out=ceoVideoStatements(s);assert.equal(out.length,1);assert.equal(out[0].kind,'video_quote');assert.match(out[0].evidence[0].url,/&t=30s$/);
});

test('definite no-caption with no charge is refunded and retried once',async()=>{
  const s=memoryState();
  const discovery={list:async ch=>ch==='UCrp_UI8XtuYfpiqluWLD7Lw'?[v('aaaaaaaaaaa','Jensen Huang interview')]:[]};
  const supadata={balance:async()=>({organizationId:'org',maximum:100,remaining:90}),get:async()=>({status:'unavailable'})};
  await runCeoVideoStep({s,save:async()=>{},now,c:cfg,discovery,supadata,extractor:{extract:async()=>{throw Error('no')}}});
  assert.equal(s.supadata.used,0);assert.equal(s.ceoVideos.aaaaaaaaaaa.stage,'waiting');
});

test('CEO videos leave the last two daily caption credits for programme summaries',async()=>{
  const s=memoryState();s.supadata={cycle:String(cfg.supadataCycleStart),end:cfg.supadataCycleEnd,used:2,shadowRemaining:90,days:{[new Date(now+9*3600000).toISOString().slice(0,10)]:2}};
  let gets=0;
  const discovery={list:async ch=>ch==='UCrp_UI8XtuYfpiqluWLD7Lw'?[v('aaaaaaaaaaa','Jensen Huang interview')]:[]};
  const supadata={balance:async()=>({organizationId:'org',maximum:100,remaining:88}),get:async()=>{gets++;return {status:'unavailable'};}};
  const r=await runCeoVideoStep({s,save:async()=>{},now,c:cfg,discovery,supadata,extractor:{extract:async()=>({items:[]})}});
  assert.equal(r.status,'ceo_video_supadata_reserved_for_programmes');assert.equal(gets,0);
});
