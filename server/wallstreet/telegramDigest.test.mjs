import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramDigest,telegramOutbox} from './telegramDigest.mjs';
import {telegramTransport} from './adapters.mjs';
import {publicSummaryLibrary} from './library.mjs';
const video={id:'Idn_d5ArZvA',title:'테스트 방송'};
const point=(index,text='핵심 내용입니다.')=>`▌이슈 ${index}\n• [방송에서 소개한 내용] ${index} ${text}\nhttps://www.youtube.com/watch?v=${video.id}&t=${index}s`;
test('all topics, continuous numbering, timestamp and detail links, original publication preserved',()=>{
  const text=Array.from({length:18},(_,index)=>point(index)).join('\n'),before=structuredClone(text);
  const digest=telegramDigest(text,video);
  assert.equal(digest.itemCount,18);assert.equal(digest.parts.length,1);assert.ok(digest.parts[0].length<=4096);
  assert.ok(digest.parts[0].includes('&t=17s'));assert.ok(digest.parts[0].includes(`?video=${video.id}`));
  assert.equal(text,before);
  const state={videos:{[video.id]:{video,stage:'text_delivery',parts:[{text}],telegramParts:[digest]}}};
  assert.equal(publicSummaryLibrary(state).videos[0].summary,text);
});
test('only equivalent statements merge; opposite claims and outlook stay separate',()=>{
  const text=[point(1),point(1),point(1,'다른 내용입니다.'),point(1).replace('방송에서 소개한 내용','출연자의 해석·전망')].join('\n');
  assert.equal(telegramDigest(text,video).itemCount,3);
});
test('overflow and failed digest audit deliver every numbered issue as sequential text',async()=>{
  const text=Array.from({length:150},(_,index)=>point(index,'긴 설명 😃 '.repeat(30))).join('\n');
  const digest=telegramDigest(text,video,{verified:false});
  assert.equal(digest.itemCount,150);
  assert.ok(digest.parts.length>1);
  const outbox=telegramOutbox(text,video,{verified:false});
  const received=[];
  const transport=telegramTransport({token:'mock',approved:true,fetcher:async(url,options)=>{
    assert.ok(url.endsWith('/sendMessage'));
    const body=JSON.parse(options.body);
    assert.equal(body.parse_mode,undefined);
    received.push(body.text);
    return {ok:true,json:async()=>({ok:true,result:{message_id:received.length}})};
  }});
  for(const part of outbox)assert.equal((await transport.send('123',part.text,part)).status,'sent');
  assert.deepEqual(received,digest.parts);
  const joined=received.join('\n');
  assert.ok(received.every((part,index)=>part.length<=4096&&part.startsWith(`[${index+1}/${received.length}]\n`)));
  for(let index=0;index<150;index++){
    assert.ok(joined.includes(`\n${index+1}. 이슈 ${index}\n`));
    assert.ok(joined.includes(`&t=${index}s\n`));
  }
});
test('an oversized unstructured summary keeps supplementary-plane characters intact',()=>{
  const original='😀'.repeat(4100);
  const {parts}=telegramDigest(original,video);
  const sent=parts.join('');
  assert.equal([...sent].filter(character=>character==='😀').length,4100);
  assert.ok(parts.every(part=>part.length<=4096&&part.isWellFormed()));
});
