import test from 'node:test';
import assert from 'node:assert/strict';
import {rssDiscovery} from './rssDiscovery.mjs';
import {safeDiscoveryFailure} from './discoveryError.mjs';
import {createTextRuntime,TEXT_PROJECT} from './textRuntime.mjs';
const channel='UChlv4GSd7OQl3js-jkLOnFA';
const response=(status=200,type='application/atom+xml')=>({ok:status===200,status,headers:new Headers({'content-type':type}),text:async()=>'<feed/>'});
test('404/403/429 stop before parsing or reading body, with no retry or alternate URL',async()=>{
  for(const status of [404,403,429]){let calls=0,parsed=0,body=0;
    const d=rssDiscovery({approved:true,fetcher:async()=>{calls++;return {...response(status,'text/html; charset=UTF-8'),text:async()=>{body++;return 'secret body';}};},parseFeed:async()=>{parsed++;}});
    await assert.rejects(d.list(channel),e=>{assert.deepEqual(safeDiscoveryFailure(e),{source:'official_youtube_rss',category:'http',httpStatus:status,contentType:'text/html'});return true;});
    assert.equal(calls,1);assert.equal(parsed,0);assert.equal(body,0);
  }
});
test('network, timeout, malformed XML and feed shape are distinct without error/body leakage',async()=>{
  for(const name of ['TypeError','TimeoutError']){const d=rssDiscovery({approved:true,fetcher:async()=>{throw Object.assign(Error('token=secret'),{name});}});
    await assert.rejects(d.list(channel),e=>{assert.equal(safeDiscoveryFailure(e).category,name==='TimeoutError'?'timeout':'network');assert.ok(!JSON.stringify(e).includes('secret'));return true;});}
  for(const [parseFeed,category] of [[async()=>{throw Error('raw feed secret');},'parse'],[async()=>({items:{}}),'feed_shape']]){
    await assert.rejects(rssDiscovery({approved:true,fetcher:async()=>response(),parseFeed}).list(channel),e=>{assert.equal(safeDiscoveryFailure(e).category,category);return true;});
  }
});
test('real rss-parser parses an empty Atom feed without acquisition calls',async()=>{
  const rows=await rssDiscovery({approved:true,fetcher:async()=>({...response(),text:async()=>'<feed xmlns="http://www.w3.org/2005/Atom"><title>Channel</title></feed>'})}).list(channel);
  assert.equal(rows.length,0);assert.equal(rows.coverage.method,'official_rss');
});
test('runtime persists only whitelisted discovery diagnostics and performs no downstream work',async()=>{
  let state={version:1,videos:{},budgets:{}},downstream=0;
  const store={exclusive:async fn=>fn(state,async()=>{})};
  const runtime=createTextRuntime({store,config:{enabled:true,projectId:TEXT_PROJECT,paidFallback:false,activatedAt:0},clock:()=>1793253601137,
    discovery:{list:async()=>{throw {message:'token=secret',stack:'secret',discovery:{category:'http',httpStatus:404,contentType:'text/html',body:'secret',headers:'secret'}};}},
    summarizer:{summarize:()=>downstream++},captions:{get:()=>downstream++},supadata:{get:()=>downstream++},telegram:{send:()=>downstream++}});
  await runtime.run();assert.equal(Object.keys(state.text.coverage).length,2);
  for(const c of Object.values(state.text.coverage))assert.deepEqual(c.failure,{source:'official_youtube_rss',category:'http',httpStatus:404,contentType:'text/html'});
  assert.equal(downstream,0);assert.deepEqual(state.videos,{});assert.deepEqual(state.budgets,{});assert.ok(!JSON.stringify(state).includes('secret'));
  assert.deepEqual(safeDiscoveryFailure({discovery:{category:'secret',httpStatus:999,contentType:'token=secret'}}),{source:'official_youtube_rss',category:'unexpected',contentType:'other'});
});
