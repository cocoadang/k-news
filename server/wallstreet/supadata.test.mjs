import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupadataProvider,reserveSupadata} from './supadata.mjs';
import {createGeminiTextSdkClient} from './providers.mjs';
import {boundedSummarizer} from './summaryClient.mjs';
const config={supadataOrganizationId:'expected',supadataCycleStart:100,supadataCycleEnd:10000,supadataCycleLimit:2,supadataDailyLimit:2};
const balance={organizationId:'expected',maximum:100,remaining:98};
const response=(data,status=200)=>({status,text:async()=>JSON.stringify(data)});
test('Supadata exact native contract and observed free plan schema',async()=>{
 const calls=[];const provider=createSupadataProvider({apiKey:'SYNTHETIC_TEST_KEY_0',organizationId:'expected',approved:true,fetcher:async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'error');assert.equal(options.method,'GET');assert.equal(options.headers['x-api-key'],'SYNTHETIC_TEST_KEY_0');
  const u=new URL(url);if(u.pathname.endsWith('/me'))return response({organizationId:'expected',plan:'Free (100/mo)',maxCredits:100,usedCredits:2});
  assert.equal(u.searchParams.get('mode'),'native');assert.equal(u.searchParams.get('lang'),'ko');assert.equal(u.searchParams.get('text'),'false');
  return response({lang:'ko',content:[{offset:1230,duration:1000,text:'caption'}]});
 }});
 assert.equal((await provider.balance()).remaining,98);assert.deepEqual((await provider.get('annR-E8m5WQ')).segments,[{start:1.23,text:'caption'}]);assert.equal(calls.length,2);
});
test('paid plan and foreign organization refused',async()=>{
 for(const data of [{organizationId:'expected',plan:'Pro',maxCredits:100,usedCredits:0},{organizationId:'other',plan:'Free',maxCredits:100,usedCredits:0}]){
 const p=createSupadataProvider({apiKey:'x',organizationId:'expected',approved:true,fetcher:async()=>response(data)});await assert.rejects(()=>p.balance());}
});
test('206, 202 and timeout never retry or fall back',async()=>{
 for(const code of [202,206,429]){let calls=0;const p=createSupadataProvider({apiKey:'x',organizationId:'expected',approved:true,fetcher:async()=>{calls++;return response({},code);}});assert.notEqual((await p.get('IggP39LRnT8')).status,'ok');assert.equal(calls,1);}
 let calls=0;const p=createSupadataProvider({apiKey:'x',organizationId:'expected',approved:true,fetcher:async()=>{calls++;throw Error('timeout');}});await assert.rejects(()=>p.get('IggP39LRnT8'));assert.equal(calls,1);
});
test('wrong language and bad timestamp rejected',async()=>{
 for(const data of [{lang:'en',content:[]},{lang:'ko',content:[{offset:-1,duration:1,text:'x'}]}]){const p=createSupadataProvider({apiKey:'x',organizationId:'expected',approved:true,fetcher:async()=>response(data)});await assert.rejects(()=>p.get('IggP39LRnT8'));}
});
test('durable shadow budget refuses stale balance reuse and expires closed',()=>{
 const s={};assert.equal(reserveSupadata(s,{...balance,remaining:1},500,config),true);
 const restored=structuredClone(s);assert.equal(reserveSupadata(restored,balance,500,config),false);
 assert.throws(()=>reserveSupadata(s,balance,10000,config));assert.throws(()=>reserveSupadata(s,balance,500,{...config,supadataCycleStart:200}));
 const t={};assert.equal(reserveSupadata(t,balance,500,config),true);assert.equal(reserveSupadata(t,balance,500,config),true);assert.equal(reserveSupadata(t,balance,500,config),false);
});
test('caption text uses stateless bounded Interactions with retry disabled',async()=>{
 const calls=[];class SDK{constructor(){this.models={countTokens:async()=>({totalTokens:100})};this.interactions={create:async(body,options)=>{calls.push({body,options});return {status:'completed',output_text:'{}'};}};}}
 const client=createGeminiTextSdkClient({GoogleGenAI:SDK,apiKey:'SYNTHETIC_TEST_KEY_0'});
 const s=boundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:0.3,outputMicrosPerToken:2.5,maxOutputTokens:2500,inputTokenMargin:1024,approved:true});
 await assert.rejects(()=>s.summarize({instruction:'SYNTHETIC_TEST_KEY_0',segments:[],maxCostMicros:6500}),/budget/);assert.equal(calls.length,0);
 await s.summarize({instruction:'SYNTHETIC_TEST_KEY_0',segments:[],maxCostMicros:7000});assert.equal(calls.length,1);
 assert.equal(calls[0].body.store,false);assert.equal(calls[0].body.generation_config.max_output_tokens,2500);assert.equal(calls[0].body.tools,undefined);assert.equal(calls[0].options.maxRetries,0);
});
