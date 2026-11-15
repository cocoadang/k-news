import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAITextClient, responseSchema } from './openaiClient.ts';

test('strict schema retains enums and allows absent evidence as null', () => {
  const s = responseSchema({type:'OBJECT',properties:{status:{type:'STRING',enum:['relevant','irrelevant']},evidence:{type:'STRING'}},required:['status']});
  assert.equal(s.additionalProperties,false);
  assert.deepEqual(s.required,['status','evidence']);
  assert.deepEqual(s.properties.status.enum,['relevant','irrelevant']);
  assert.deepEqual(s.properties.evidence.anyOf[1],{type:'null'});
});
test('one Responses request, no storage/tools/retries, reasoning counted once',async()=>{
  let sent:any,calls=0;
  const fetcher:any=async (_url:any,options:any)=>{
    calls++; sent=JSON.parse(options.body);
    return new Response(JSON.stringify({status:'completed',model:'gpt-6-luna',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}],usage:{input_tokens:100,output_tokens:25,output_tokens_details:{reasoning_tokens:5},input_tokens_details:{cached_tokens:10}}}));
  };
  const c=new OpenAITextClient({apiKey:'synthetic',fetcher});
  const r=await c.models.generateContent({contents:'Return JSON',config:{responseMimeType:'application/json',maxOutputTokens:512,systemInstruction:'trusted instruction'}});
  assert.equal(calls,1);assert.equal(sent.model,'gpt-6-luna');assert.equal(sent.store,false);assert.equal(sent.stream,false);assert.equal(sent.tools,undefined);assert.equal(sent.reasoning.effort,'none');assert.equal(sent.max_output_tokens,512);
  assert.equal(r.usageMetadata.candidatesTokenCount,20);assert.equal(r.usageMetadata.thoughtsTokenCount,5);assert.equal(r.usageMetadata.totalTokenCount,125);
  assert.equal((await c.models.countTokens({contents:'한글 😀'})).totalTokens,Buffer.byteLength('한글 😀','utf8')+256);assert.equal(calls,1);
});
test('errors/refusals/truncated output/unknown usage never become successful analysis',async()=>{
  for(const mode of ['429','500','refusal','incomplete','usage']){
    let calls=0;
    const fetcher:any=async()=>{calls++;return ['429','500'].includes(mode)?new Response('{}',{status:Number(mode)}):new Response(JSON.stringify({status:mode==='incomplete'?'incomplete':'completed',output:[{type:'message',content:[{type:mode==='refusal'?'refusal':'output_text',text:'{}'}]}],usage:mode==='usage'?undefined:{input_tokens:1,output_tokens:2}}));};
    const c=new OpenAITextClient({apiKey:'synthetic',fetcher});
    await assert.rejects(c.models.generateContent({contents:'test'}));assert.equal(calls,1);
  }
});
