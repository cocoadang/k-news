import test from 'node:test';
import assert from 'node:assert/strict';
import {publicVideoMetadata,rssDiscovery} from './rssDiscovery.mjs';
import {matchProgrammes} from './programmes.mjs';
const id='LtT_k6wCOek',channel='UChlv4GSd7OQl3js-jkLOnFA';
const html=x=>`<script type="application/ld+json">${JSON.stringify({'@type':'VideoObject',embedUrl:`https://www.youtube.com/embed/${id}`,duration:'PT45M20S',...x})}</script>`;

test('official programme title survives advertisement-only RSS description, unsafe titles remain excluded',async()=>{
 const now=Date.parse('2026-10-29T08:00:00Z');
 const item=(title,c=channel)=>({'yt:videoId':'npCgb7sMj_0','yt:channelId':c,title,mediaGroup:{'media:description':['광고 안내']},isoDate:'2026-10-29T01:00:00Z'});
 const d=rssDiscovery({approved:true,fetcher:async()=>({ok:true,text:async()=>''}),parseFeed:async()=>({items:[item('비트코인 시장 [크립토 PLUS]'),item('다른 코너'),item('크립토 PLUS 쇼츠'),item('크립토 PLUS 라이브'),item('크립토 PLUS 재방송'),item('크립토 PLUS','wrong-channel')]})});
 const rows=await d.list(channel);assert.equal(rows.length,1);assert.deepEqual(matchProgrammes(rows[0],{activatedAt:now-86400000,now,allowProviderVerification:true}),['crypto']);
 assert.equal(rows.coverageComplete,false);assert.equal(rows.coverage.held.length,1);
 assert.deepEqual(matchProgrammes({...rows[0],channelId:'wrong-channel'},{activatedAt:now-86400000,now,allowProviderVerification:true}),[]);
});
test('public metadata requires identity and known duration; live remains held',()=>{
 assert.equal(publicVideoMetadata(html({}),id).durationSeconds,2720);
 assert.throws(()=>publicVideoMetadata(html({}), 'Idn_d5ArZvA'),/unavailable/);
 assert.throws(()=>publicVideoMetadata(html({publication:{isLiveBroadcast:true}}),id),/live/);
 assert.throws(()=>publicVideoMetadata('<html>Sign in</html>',id),/unavailable/);
});
test('RSS uses no API credential and retains incomplete coverage and metadata holds',async()=>{
 const urls=[];const d=rssDiscovery({approved:true,parseFeed:async()=>({items:[{'yt:videoId':id,'yt:channelId':channel,title:'월가 뉴스레터',content:'월가 뉴스레터',isoDate:'2026-10-28T22:10:48Z'}]}),fetcher:async u=>{urls.push(u);return {ok:true,text:async()=>u.includes('/feeds/')?'feed':'no metadata'};}});
 const rows=await d.list(channel);assert.equal(rows.length,1);assert.equal(rows.coverageComplete,false);assert.equal(rows[0].status,'awaiting_native_captions');assert.equal(urls.length,1);assert.ok(urls.every(x=>!x.includes('key=')));await assert.rejects(d.list('other'),/unapproved/);
});
