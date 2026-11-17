import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramDigest} from './telegramDigest.mjs';
import {telegramTransport} from './adapters.mjs';
import {publicSummaryLibrary} from './library.mjs';
const video={id:'Idn_d5ArZvA',title:'테스트 방송'};
const point=(index,text='핵심 내용입니다.')=>`▌이슈 ${index}\n• [방송에서 소개한 내용] ${index} ${text}\nhttps://www.youtube.com/watch?v=${video.id}&t=${index}s`;
test('all topics, continuous numbering, timestamp and detail links, original publication preserved',()=>{
  const text=Array.from({length:18},(_,index)=>point(index)).join('\n'),before=structuredClone(text);
  const digest=telegramDigest(text,video);
  assert.equal(digest.itemCount,18);assert.ok(!digest.document);assert.ok(digest.text.length<=4096);
  assert.ok(digest.text.includes('&t=17s'));assert.ok(digest.text.includes(`?video=${video.id}`));
  assert.equal(text,before);
  const state={videos:{[video.id]:{video,stage:'text_delivery',parts:[{text}],telegramParts:[digest]}}};
  assert.equal(publicSummaryLibrary(state).videos[0].summary,text);
});
test('only equivalent statements merge; opposite claims and outlook stay separate',()=>{
  const text=[point(1),point(1),point(1,'다른 내용입니다.'),point(1).replace('방송에서 소개한 내용','출연자의 해석·전망')].join('\n');
  assert.equal(telegramDigest(text,video).itemCount,3);
});
test('extreme overflow retains every issue in a single document delivery',async()=>{
  const text=Array.from({length:150},(_,index)=>point(index,'긴 설명 '.repeat(30))).join('\n');
  const digest=telegramDigest(text,video);assert.equal(digest.itemCount,150);
  assert.ok(digest.document.includes('150. 이슈 149'));let calls=0;
  const transport=telegramTransport({token:'mock',approved:true,fetcher:async(url,options)=>{
    calls++;assert.ok(url.endsWith('/sendDocument'));assert.equal(await options.body.get('document').text(),digest.document);
    return {ok:true,json:async()=>({ok:true,result:{message_id:123}})};
  }});
  assert.equal((await transport.send('123',digest.text,digest)).status,'sent');assert.equal(calls,1);
});
