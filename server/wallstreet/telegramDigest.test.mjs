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
  assert.equal(digest.itemCount,18);assert.equal(digest.parts.length,1);assert.ok(digest.parts[0].text.length<=4096);
  assert.ok(digest.parts[0].entities.some(e=>e.url?.endsWith('&t=17s')));assert.ok(digest.parts[0].entities.some(e=>e.url?.endsWith(`?video=${video.id}`)));
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
    received.push({text:body.text,entities:body.entities});
    return {ok:true,json:async()=>({ok:true,result:{message_id:received.length}})};
  }});
  for(const part of outbox)assert.equal((await transport.send('123',part.text,part)).status,'sent');
  assert.deepEqual(received,digest.parts);
  const joined=received.map(part=>part.text).join('\n');
  assert.ok(received.every((part,index)=>part.text.length<=4096&&part.text.startsWith(`[${index+1}/${received.length}]\n`)));
  for(let index=0;index<150;index++){
    assert.ok(joined.includes(`\n${index+1}. 이슈 ${index}\n`));
    assert.ok(received.some(part=>part.entities.some(entity=>entity.url?.endsWith(`&t=${index}s`))));
  }
});
test('bold labels and hidden links use UTF-16 offsets and the summary stays on one line',()=>{
  const [part]=telegramDigest(point(59,'😀 첫 문장입니다. 다음 문장은 제외합니다.'),video).parts;
  const labels=part.entities.map(e=>[e.type,part.text.slice(e.offset,e.offset+e.length),e.url]);
  assert.deepEqual(labels.slice(0,4),[
    ['bold','테스트 방송',undefined],
    ['text_link','영상 보기',`https://www.youtube.com/watch?v=${video.id}`],
    ['bold','1. 이슈 59',undefined],
    ['text_link','0:59',`https://www.youtube.com/watch?v=${video.id}&t=59s`],
  ]);
  assert.match(part.text,/😀 첫 문장입니다\. · 0:59/);
  assert.doesNotMatch(part.text,/https:|다음 문장/);
});
