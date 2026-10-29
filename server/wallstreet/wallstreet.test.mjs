import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { CHANNEL,DEFAULTS,emptyState,eligible,splitMessage,renderSummary,tick } from './core.mjs';
import { FileStore } from './store.mjs';
import { parseVidiqTranscript,telegramTransport,youtubeDiscovery,vidiqCaptions } from './adapters.mjs';
import { boundedSummarizer } from './summaryClient.mjs';
const now=Date.UTC(2026,9,28);
const video={id:'Idn_d5ArZvA',channelId:CHANNEL,title:'합성 테스트 [월가 뉴스레터]',description:'월가 뉴스레터 합성 설명',
  isShort:false,isRebroadcast:false,status:'completed',durationSeconds:3600,publishedAt:now,broadcastDate:'2026-10-28'};
const segments=[{start:0,text:'시장 상승은 합성 사례입니다.'},{start:120,text:'김 연구원은 금리 하락을 예상했습니다.'}];
const fact={text:'시장 상승은 합성 사례입니다.',quote:segments[0].text,kind:'fact',segment:0};
const outlook={text:'금리 하락을 예상했습니다.',quote:segments[1].text,kind:'outlook',speaker:'김 연구원',segment:1};
const summary=()=>({headline:[fact,fact,outlook],sections:{market:[fact],ratesOil:[outlook],ai:[],earnings:[],watch:[]}});
function harness(extra={}) {
  let state=emptyState(),calls={captions:0,summary:0,sends:0};
  const h={store:{exclusive:async fn=>fn(state,async()=>{})},discovery:{list:async()=>[video]},
    captions:{get:async()=>{calls.captions++;return {status:'ok',segments};}},
    summarizer:{summarize:async()=>{calls.summary++;return summary();}},
    telegram:{send:async()=>({status:'sent',messageId:String(++calls.sends)})},
    config:{enabled:true,activatedAt:now-1,recipient:'mock-person',dailyCredits:15,monthlyCredits:30,
      summaryReservationMicros:100,dailySummaryMicros:200,monthlySummaryMicros:300},now,...extra};
  return {h,state,calls};
}
test('disabled by default makes zero calls',async()=>{
  assert.deepEqual(await tick({}),{status:'disabled'});
});
test('strict channel, metadata, shorts, rebroadcast, other program and cutoff filters',()=>{
  assert.ok(eligible(video,now,now-1,DEFAULTS));
  for(const patch of [{channelId:'other'},{description:'다른 코너'},{title:'뉴스3+'},{title:'월가 뉴스레터 재방송'},
    {isShort:true},{isShort:undefined},{isRebroadcast:true},{status:'live'},{durationSeconds:120},
    {publishedAt:now-999},{publishedAt:now+1}]) assert.equal(eligible({...video,...patch},now,now-1,DEFAULTS),false);
});
test('successful tick, replay and recipient change never duplicate',async()=>{
  const {h,state,calls}=harness();await tick(h);await tick(h);
  assert.deepEqual(calls,{captions:1,summary:1,sends:1});assert.equal(state.videos[video.id].stage,'sent');
  await tick({...h,config:{...h.config,recipient:'other'}});assert.equal(calls.sends,1);
});
test('caption processing waits, charges every attempt and stops at cap',async()=>{
  const {h,state,calls}=harness();h.captions.get=async()=>{calls.captions++;return {status:'processing'};};
  await tick(h);await tick(h);assert.equal(calls.captions,1);
  for(let i=1;i<=3;i++) await tick({...h,now:now+i*1800000});
  assert.equal(calls.captions,3);assert.equal(calls.summary,0);assert.equal(calls.sends,0);
  assert.equal(state.videos[video.id].stage,'caption_expired');
});
test('unavailable captions do not create title-based summary',async()=>{
  const {h,calls,state}=harness();h.captions.get=async()=>({status:'unavailable'});
  await tick(h);await tick(h);assert.equal(calls.summary,0);assert.equal(calls.sends,0);
  assert.equal(state.videos[video.id].stage,'caption_unavailable');
});
test('monthly and daily caps reserve before calls; zero defaults block',async()=>{
  for(const patch of [{dailyCredits:0},{monthlyCredits:4}]) {
    const {h,calls}=harness();await tick({...h,config:{...h.config,...patch}});assert.equal(calls.captions,0);
  }
  const {h,calls}=harness();await tick({...h,config:{...h.config,monthlySummaryMicros:99}});
  assert.equal(calls.captions,1);assert.equal(calls.summary,0);
});
test('summary rejects invented numbers and invalid citations',()=>{
  const s=summary();s.headline=[{...fact,text:'시장이 9% 상승했다'},fact,fact];
  assert.throws(()=>renderSummary(video,segments,s),/unsupported_number/);
  s.headline=[{...fact,quote:'없는 문장'},fact,fact];assert.throws(()=>renderSummary(video,segments,s),/ungrounded/);
});
test('format contains requested sections and exact timestamp links',()=>{
  const text=renderSummary(video,segments,summary());
  for(const label of ['방송일','제목','원문 링크','핵심 3줄','시장 흐름','금리와 유가','AI 산업','기업별 실적','다음 관전 포인트','장면별 시간 링크','전망 · 김 연구원','&t=120s']) assert.ok(text.includes(label));
});
test('split respects UTF-16 headroom and preserves emoji',()=>{
  const input='가😀'.repeat(5000),parts=splitMessage(input);
  assert.ok(parts.every(p=>p.length<3500));assert.equal(parts.map(p=>p.replace(/^\[\d+\/\d+\]\n/,'')).join(''),input);
});
test('partial delivery retries only definitive 429; sent parts retained',async()=>{
  const {h,state}=harness();h.summarizer.summarize=async()=>({...summary(),sections:{...summary().sections,market:Array(30).fill({...fact,text:fact.text.repeat(20)})}});
  let calls=0;h.telegram.send=async()=>{calls++;return calls===2 ? {status:'rate_limited',definitelyNotSent:true,retryAfterMs:60000} : {status:'sent',messageId:String(calls)};};
  await tick(h);assert.equal(calls,2);await tick(h);assert.equal(calls,2);
  await tick({...h,now:now+60000});assert.equal(state.videos[video.id].stage,'sent');
  assert.equal(calls,state.videos[video.id].parts.length+1);
});
test('ambiguous delivery and crashed inflight part never resend',async()=>{
  for(const crashed of [false,true]) {
    const {h,state}=harness();let calls=0;h.telegram.send=async()=>{calls++;throw Error('timeout');};
    await tick(h);if(crashed) state.videos[video.id].parts[0].status='inflight';
    await tick(h);assert.equal(calls,1);
  }
});
test('paid call crash requires review instead of recharging',async()=>{
  const {h,state,calls}=harness();state.videos[video.id]={video,recipient:'mock-person',stage:'caption_inflight'};
  await tick(h);assert.equal(calls.captions,0);assert.equal(state.videos[video.id].stage,'review_required');
});
test('durable state survives reopen; concurrent lock fails closed',async()=>{
  const dir=await mkdtemp(join(process.cwd(),'wallstreet-test-')); const path=join(dir,'state.json');
  try {
    const store=new FileStore(path);
    await store.exclusive(async(s,save)=>{s.budgets.a=5;await save();await assert.rejects(new FileStore(path).exclusive(async()=>{}),{code:'EEXIST'});});
    await new FileStore(path).exclusive(async(s)=>assert.equal(s.budgets.a,5));
    assert.equal(JSON.parse(await readFile(path,'utf8')).budgets.a,5);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('adapters require explicit live gate; no fetch on blocked call',async()=>{
  let calls=0; const fetcher=async()=>{calls++;throw Error('network forbidden');};
  await assert.rejects(telegramTransport({fetcher}).send('x','x'),/not_enabled/);
  await assert.rejects(youtubeDiscovery({fetcher}).list(CHANNEL),/not_enabled/);
  await assert.rejects(vidiqCaptions({callTool:fetcher}).get(video.id),/not_enabled/);
  assert.equal(calls,0);
});
test('vidIQ timestamps and language/identity validation',async()=>{
  assert.deepEqual(parseVidiqTranscript({transcription:'[1:02] 안녕\n[1:02:03] 세계'}),[{start:62,text:'안녕'},{start:3723,text:'세계'}]);
  await assert.rejects(vidiqCaptions({approved:true,callTool:async()=>({structuredContent:{videoId:'other',transcription:'[0:00] 안녕'}})}).get(video.id),/mismatch/);
});
test('Telegram mock timeout, 429 and success classification',async()=>{
  for(const [status,data,expected] of [[200,{ok:true,result:{message_id:7}},'sent'],[429,{ok:false,parameters:{retry_after:2}},'rate_limited'],[500,{ok:false},'unknown']]) {
    const t=telegramTransport({token:'mock',approved:true,fetcher:async()=>({ok:status===200,status,json:async()=>data})});
    assert.equal((await t.send('mock','합성')).status,expected);
  }
});
test('invalid numeric budget configuration fails closed',async()=>{
  const {h}=harness();
  await assert.rejects(tick({...h,config:{...h.config,dailyCredits:NaN}}),/invalid_budget/);
});
test('summary worst-case cost is checked before generation',async()=>{
  let calls=0;
  const client={countTokens:async()=>({totalTokens:100}),generate:async()=>{calls++;return {text:JSON.stringify(summary())};}};
  const s=boundedSummarizer({client,model:'mock',inputMicrosPerToken:1,outputMicrosPerToken:2,maxOutputTokens:100,approved:true});
  await assert.rejects(s.summarize({instruction:'mock',segments,maxCostMicros:299}),/budget_exceeded/);
  assert.equal(calls,0);
  assert.deepEqual(await s.summarize({instruction:'mock',segments,maxCostMicros:300}),summary());assert.equal(calls,1);
});
test('YouTube mock API resolves channel uploads and normalizes metadata',async()=>{
  const requests=[];
  const d=youtubeDiscovery({approved:true,apiKey:'mock',fetcher:async url=>{
    requests.push(url.pathname);
    const data=url.pathname.endsWith('channels') ? {items:[{contentDetails:{relatedPlaylists:{uploads:'mock-playlist'}}}]} :
      url.pathname.endsWith('playlistItems') ? {items:[{contentDetails:{videoId:video.id}}]} :
      {items:[{id:video.id,snippet:{channelId:CHANNEL,title:video.title,description:video.description,publishedAt:new Date(now).toISOString(),liveBroadcastContent:'none'},contentDetails:{duration:'PT1H'}}]};
    return {ok:true,json:async()=>data};
  }});
  const list=await d.list(CHANNEL);assert.equal(requests.length,3);
  assert.ok(eligible(list[0],now,now-1,DEFAULTS));
});
