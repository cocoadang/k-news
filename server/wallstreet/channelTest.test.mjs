import test from 'node:test';
import assert from 'node:assert/strict';
import {sendStoredChannelTest} from './channelTest.mjs';
import {PUBLIC_CHANNEL_ID} from './publicChannel.mjs';
function setup(){
  const state={videos:{abcdefghijk:{video:{id:'abcdefghijk',title:'Synthetic video',publishedAt:1},stage:'sent',recipient:'123',programmes:['bullbear'],parts:[{text:'📺 Synthetic video\n'+('저장된 검증 요약\n'.repeat(400)),status:'sent',messageId:'private-old'}]}},budgets:{fixed:123}};
  let tail=Promise.resolve();const store={exclusive(fn){const next=tail.then(()=>fn(state,async()=>{}));tail=next.catch(()=>{});return next;}};
  return {state,store};
}
test('published summary sends to fixed channel once under concurrency, retaining private receipts and budgets',async()=>{
 const x=setup(),sent=[];const original=structuredClone(x.state.videos.abcdefghijk.parts);
 const opts={...x,videoId:'abcdefghijk',telegram:{async send(id,text){sent.push({id,text});assert.ok(text.length<=4096);return {status:'sent',messageId:String(sent.length)};}}};
 const results=await Promise.all([sendStoredChannelTest(opts),sendStoredChannelTest(opts)]);
 assert.equal(results[0].status,'sent');assert.equal(results[1].status,'already_sent');
 assert.ok(sent.length>1);assert.ok(sent.every(x=>x.id===PUBLIC_CHANNEL_ID));assert.match(sent[0].text,/저장된 검증 요약/);assert.ok(x.state.videos.abcdefghijk.channelTest.parts.every(p=>p.plainText&&!p.document));
 assert.deepEqual(x.state.videos.abcdefghijk.parts,original);assert.equal(x.state.videos.abcdefghijk.recipient,'123');assert.deepEqual(x.state.budgets,{fixed:123});
});
test('uncertain or rejected delivery cannot be repeated; invalid/unpublished videos never send',async()=>{
 for(const outcome of ['unknown','rejected']){
  const x=setup();let calls=0;const opts={...x,videoId:'abcdefghijk',telegram:{async send(){calls++;return {status:outcome};}}};
  assert.equal((await sendStoredChannelTest(opts)).status,'review_required');assert.equal((await sendStoredChannelTest(opts)).status,'review_required');assert.equal(calls,1);
 }
 const x=setup(),telegram={send(){throw Error('must not send');}};
 assert.equal((await sendStoredChannelTest({...x,telegram,videoId:'bad'})).status,'invalid_video');
 x.state.videos.abcdefghijk.stage='text_review_required';
 assert.equal((await sendStoredChannelTest({...x,telegram,videoId:'abcdefghijk'})).status,'summary_not_ready');
});
