import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiTextSdkClient} from './providers.mjs';
test('text SDK accepts recorded Interactions model_output steps without a convenience getter',async()=>{
 class SDK {constructor(){this.interactions={create:async()=>({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'{"items":[]}'}]}]})};}}
 const c=createGeminiTextSdkClient({GoogleGenAI:SDK,apiKey:'mock'});
 assert.equal((await c.generate({model:'gemini-3.5-flash-lite',contents:'synthetic',maxOutputTokens:100,timeoutMs:1000})).text,'{"items":[]}');
});
