import test from 'node:test';import assert from 'node:assert/strict';
import {uploadsDiscovery} from './uploadsDiscovery.mjs';
const channel='UChlv4GSd7OQl3js-jkLOnFA',now=Date.parse('2026-10-29T09:00:00Z'),id='npCgb7sMj_0';
const video=(patch={})=>({id,snippet:{channelId:channel,title:'크립토 PLUS',description:'광고',publishedAt:'2026-10-29T01:00:00Z',liveBroadcastContent:'none'},contentDetails:{duration:'PT45M'},status:{privacyStatus:'public'},...patch});
const config={approved:true,apiKey:'SYNTHETIC_TEST_KEY_1',activatedAt:now-86400000,clock:()=>now};
test('official upload pagination finds beyond RSS15, deduplicates and passes key only in header',async()=>{
 const calls=[];let pages=0;
 const d=uploadsDiscovery({...config,fetcher:async(url,opts)=>{calls.push(url.pathname);assert(!url.searchParams.has('key'));assert.equal(opts.headers['X-Goog-Api-Key'],'SYNTHETIC_TEST_KEY_1');let data;
 if(url.pathname.endsWith('/channels'))data={items:[{id:channel,contentDetails:{relatedPlaylists:{uploads:'UUhlv4GSd7OQl3js-jkLOnFA'}}}]};
 else if(url.pathname.endsWith('/playlistItems'))data=++pages===1?{items:[],nextPageToken:'SYNTHETIC_TEST_KEY_0'}:{items:[{contentDetails:{videoId:id}},{contentDetails:{videoId:id}}]};
 else{assert.equal(url.searchParams.get('id'),id);data={items:[video(),video()]};}return Response.json(data);}});
 const rows=await d.list(channel);assert.equal(rows.length,1);assert.equal(rows.coverageComplete,true);assert.equal(calls.length,4);
});
test('API errors stop without retry; wrong channel or missing credential never calls HTTP',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response('',{status:403});};
 await assert.rejects(uploadsDiscovery({...config,fetcher}).list(channel),/403/);assert.equal(calls,1);
 await assert.rejects(uploadsDiscovery({...config,fetcher}).list('wrong'),/configuration/);
 await assert.rejects(uploadsDiscovery({...config,apiKey:'',fetcher}).list(channel),/configuration/);assert.equal(calls,1);
});
test('metadata rejects active live, scheduled, short and foreign channel results',async()=>{
 const variants=[video({liveStreamingDetails:{actualStartTime:'2026-10-29T00:00:00Z'}}),video({liveStreamingDetails:{scheduledStartTime:'2026-10-30T00:00:00Z'}}),video({contentDetails:{duration:'PT60S'}}),video({snippet:{...video().snippet,channelId:'other'}})];
 const d=uploadsDiscovery({...config,fetcher:async url=>Response.json(url.pathname.endsWith('/channels')?{items:[{id:channel,contentDetails:{relatedPlaylists:{uploads:'UUhlv4GSd7OQl3js-jkLOnFA'}}}]}:url.pathname.endsWith('/playlistItems')?{items:[{contentDetails:{videoId:id}}]}:{items:variants})});assert.equal((await d.list(channel)).length,0);
});
test('maximum three playlist pages leaves coverage incomplete rather than claiming no gaps',async()=>{
 let pages=0,calls=0;const d=uploadsDiscovery({...config,fetcher:async url=>{calls++;return Response.json(url.pathname.endsWith('/channels')?{items:[{id:channel,contentDetails:{relatedPlaylists:{uploads:'UUhlv4GSd7OQl3js-jkLOnFA'}}}]}:{items:[],nextPageToken:'page'+(++pages)});}});
 const rows=await d.list(channel);assert.equal(pages,3);assert.equal(calls,4);assert.equal(rows.coverageComplete,false);
});
