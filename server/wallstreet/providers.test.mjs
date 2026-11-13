import test from 'node:test';
import assert from 'node:assert/strict';
import {createVidiqMcpClient} from './mcpClient.mjs';
import {createProviders,createConfiguredWallstreetRuntime,createGeminiSdkClient,classifyVidiqCaptionError} from './providers.mjs';
const id='Idn_d5ArZvA';
function mockMcp({sse=false,fail=false}={}) {
  const calls=[];
  const fetcher=async(url,opts)=>{
    const b=JSON.parse(opts.body);calls.push(b);
    assert.equal(url,'https://mcp.vidiq.com/mcp');assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,'Bearer mock');
    if(b.method==='notifications/initialized') return new Response(null,{status:202});
    if(b.method!=='initialize') {assert.equal(opts.headers['Mcp-Session-Id'],'mock-session');assert.equal(opts.headers['MCP-Protocol-Version'],'2025-11-25');}
    const result=b.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}}}:
      b.method==='tools/list'?{tools:[{name:'vidiq_video_transcript',inputSchema:{type:'object',properties:{videoId:{type:'string'}}}}]}:
      {structuredContent:{videoId:id,language:'ko',transcription:'[0:00] 합성 자막'}};
    if(fail && b.method==='tools/call') throw Error('connection reset');
    const message={jsonrpc:'2.0',id:b.id,result};
    return new Response(sse?`event: message\ndata: ${JSON.stringify(message)}\n\n`:JSON.stringify(message),
      {headers:{'content-type':sse?'text/event-stream':'application/json','mcp-session-id':'mock-session'}});
  };return {fetcher,calls};
}
test('MCP JSON and SSE negotiate session, discover then call transcript only',async()=>{
  for(const sse of [false,true]) {
    const {fetcher,calls}=mockMcp({sse});const c=createVidiqMcpClient({apiKey:'mock',approved:true,fetcher});
    assert.equal((await c.callTool('vidiq_video_transcript',{videoId:id,language:'ko'})).structuredContent.videoId,id);
    assert.deepEqual(calls.map(c=>c.method),['initialize','notifications/initialized','tools/list','tools/call']);
    await assert.rejects(c.callTool('vidiq_update_video',{videoId:id,language:'ko'}),/not_allowed/);
    assert.equal(calls.length,4);
  }
});
test('MCP paid POST uncertainty is never retried',async()=>{
  const {fetcher,calls}=mockMcp({fail:true});
  await assert.rejects(createVidiqMcpClient({apiKey:'mock',approved:true,fetcher}).callTool('vidiq_video_transcript',{videoId:id,language:'ko'}),/uncertain/);
  assert.equal(calls.filter(c=>c.method==='tools/call').length,1);
});
test('disabled configured runtime does not read keys, load SDK or touch Firestore',async()=>{
  const env=new Proxy({},{get(){throw Error('secret read forbidden');}});
  const r=createConfiguredWallstreetRuntime({env,getFirestore:()=>{throw Error('db forbidden');},loadGemini:()=>{throw Error('SDK forbidden');}});
  assert.deepEqual(await r.run(),{status:'disabled'});
});
test('factory enforces explicit private recipient and all credential names',async()=>{
  const env={VIDIQ_API_KEY:'mock',YOUTUBE_API_KEY:'mock',GEMINI_API_KEY:'mock',TELEGRAM_BOT_TOKEN:'mock',WALLSTREET_TELEGRAM_CHAT_ID:'-123'};
  await assert.rejects(createProviders({config:{enabled:true},env}),/private_recipient/);
  await assert.rejects(createProviders({config:{enabled:true},env:{}}),/missing_VIDIQ_API_KEY/);
});

test('Luna wiring requires OpenAI server secret, exposes readiness without reading/loading Gemini',async()=>{
 const config={enabled:true,mode:'caption_text',projectId:'gen-lang-client-0064554427',paidFallback:false,model:'gpt-6-luna',summaryApproved:true,combinedTokenCapVerified:true};
 const runtime=createConfiguredWallstreetRuntime({config,env:{},getFirestore:()=>({}),loadGemini:()=>{throw Error('must_not_load_Gemini');}});
 assert.equal(runtime.status().summaryCredentialReady,false);assert.equal(runtime.status().summaryModel,'gpt-6-luna');
 await assert.rejects(runtime.run(),/openai_server_credential_required/);
});
test('Gemini request contract forbids retries/tools and rejects truncation',async()=>{
  const seen=[];
  class SDK {constructor(opts){seen.push(opts);this.models={countTokens:async args=>{seen.push(args);return {totalTokens:12};},generateContent:async args=>{seen.push(args);return {text:'{}',candidates:[{finishReason:'MAX_TOKENS'}]};}};}}
  const c=createGeminiSdkClient({GoogleGenAI:SDK,apiKey:'mock'});
  await c.countTokens({model:'mock',contents:'synthetic'});
  await assert.rejects(c.generate({model:'mock',contents:'synthetic',maxOutputTokens:100,timeoutMs:1000}),/incomplete/);
  assert.equal(seen[0].httpOptions.retryOptions.attempts,1);assert.equal(seen[2].config.candidateCount,1);
  assert.equal(seen[2].config.tools,undefined);assert.equal(seen[2].config.maxOutputTokens,100);
});
test('fully wired providers execute transcript and Telegram with mocked HTTP only',async()=>{
  const {fetcher,calls}=mockMcp();const env={VIDIQ_API_KEY:'mock',YOUTUBE_API_KEY:'mock',GEMINI_API_KEY:'mock',TELEGRAM_BOT_TOKEN:'mock',WALLSTREET_TELEGRAM_CHAT_ID:'123'};
  class SDK {constructor(){this.models={};}}
  const p=await createProviders({config:{enabled:true},env,loadGemini:async()=>({GoogleGenAI:SDK}),fetcher:async(url,opts)=>{
    if(String(url).startsWith('https://api.telegram.org/')) {const b=JSON.parse(opts.body);assert.equal(b.chat_id,'123');return new Response(JSON.stringify({ok:true,result:{message_id:9}}),{status:200});}
    return fetcher(url,opts);
  }});
  assert.deepEqual(await p.captions.get(id),{status:'ok',segments:[{start:0,text:'합성 자막'}]});
  assert.equal((await p.telegram.send('123','합성')).status,'sent');assert.equal(calls.length,4);
  assert.throws(()=>p.telegram.send('456','합성'),/recipient_mismatch/);
});
test('caption retry requires explicit provider processing and retry instruction',()=>{
  const error=text=>({isError:true,content:[{type:'text',text}]});
  assert.equal(classifyVidiqCaptionError(error('YouTube is still generating captions. Please retry in a few minutes.')).status,'processing');
  for(const text of ['No captions; retry later','Insufficient credits','Video private','Captions are processing']) assert.equal(classifyVidiqCaptionError(error(text)).status,'unavailable');
});


