// Explicit opt-in local validation only. Never import this from the production app.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {FirestoreWallstreetStore} from './firestoreStore.mjs';
import {createGeminiSdkClient} from './providers.mjs';
if(!process.env.WALLSTREET_TEST_SDK_ROOT) throw Error('test_sdk_root_required');
const require=createRequire(resolve(process.env.WALLSTREET_TEST_SDK_ROOT,'package.json'));
// Forced loopback emulator plus demo project: no fallback to production credentials.
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:18981';
const {Firestore}=require('@google-cloud/firestore');
const db=new Firestore({projectId:'demo-knews-wallstreet',host:'127.0.0.1:18981',port:18981,ssl:false});
try {
  assert.equal(db.collection('wallstreet_newsletter_v1').doc('head').path,'wallstreet_newsletter_v1/head');
  if(process.env.WALLSTREET_TEST_EMULATOR==='1') {
  await new FirestoreWallstreetStore(db).exclusive(async(s,save)=>{
    s.budgets.sdk=5;s.videos.sdk={parts:[{status:'sent',messageId:'mock-1'},{status:'unknown'}],text:'한글😀'.repeat(60000)};await save();
  });
  await new FirestoreWallstreetStore(db).exclusive(async(s)=>{
    assert.equal(s.budgets.sdk,5);assert.equal(s.videos.sdk.parts[1].status,'unknown');assert.equal(s.videos.sdk.text,'한글😀'.repeat(60000));
  });
  await new FirestoreWallstreetStore(db).exclusive(async()=>{
    await assert.rejects(new FirestoreWallstreetStore(db).exclusive(async()=>{}),/locked/);
  });
  console.log('Firestore SDK 9.0.1 + local emulator: transaction/chunks/outbox/lock PASS');
  } else console.log('Firestore SDK 9.0.1 object/reference contract PASS; emulator transactions NOT RUN');
} finally {await db.terminate();}

const {GoogleGenAI}=require('@google/genai');
const originalFetch=globalThis.fetch;const calls=[];
globalThis.fetch=async(url,opts)=>{
  const target=String(url);assert.ok(target.startsWith('https://generativelanguage.googleapis.com/'));
  const payload=JSON.parse(opts.body);calls.push({target,payload});
  const response=target.includes(':countTokens')?{totalTokens:20}:
    {candidates:[{content:{parts:[{text:'{"headline":[]}'}],role:'model'},finishReason:'STOP'}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:10}};
  return new Response(JSON.stringify(response),{headers:{'content-type':'application/json'}});
};
try {
  const c=createGeminiSdkClient({GoogleGenAI,apiKey:'synthetic-test-key'});
  assert.equal((await c.countTokens({model:'gemini-3-flash-preview',contents:'synthetic'})).totalTokens,20);
  assert.equal((await c.generate({model:'gemini-3-flash-preview',contents:'synthetic',maxOutputTokens:100,timeoutMs:1000})).text,'{"headline":[]}');
  assert.equal(calls.length,2);assert.equal(calls[1].payload.generationConfig.maxOutputTokens,100);
  assert.equal(calls[1].payload.tools,undefined);
  console.log('Gemini SDK 2.19.0 real serialization + mocked fetch: PASS (zero network calls)');
} finally {globalThis.fetch=originalFetch;}
