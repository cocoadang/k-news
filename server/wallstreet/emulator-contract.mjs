// Explicit isolated emulator-only test; contains no application configuration imports.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import net from 'node:net';
import {FirestoreWallstreetStore,COLLECTION} from './firestoreStore.mjs';
import {tick,CHANNEL} from './core.mjs';
if(process.env.WALLSTREET_TEST_EMULATOR!=='1' || !process.env.WALLSTREET_TEST_SDK_ROOT) throw Error('explicit_emulator_test_opt_in_required');
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:18981';
process.env.METADATA_SERVER_DETECTION='none';
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
let loopbackConnections=0,blockedConnections=0;
const originalConnect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args) {
  const a=Array.isArray(args[0])?args[0]:args;
  const o=typeof a[0]==='object'?a[0]:{port:a[0],host:typeof a[1]==='string'?a[1]:'localhost'};
  if(!['127.0.0.1','localhost'].includes(o.host) || Number(o.port)!==18981) {
    blockedConnections++;throw Error('non_emulator_connection_blocked');
  }
  loopbackConnections++;return originalConnect.apply(this,args);
};
globalThis.fetch=async()=>{blockedConnections++;throw Error('fetch_forbidden_in_emulator_test');};
const require=createRequire(resolve(process.env.WALLSTREET_TEST_SDK_ROOT,'package.json'));
const {Firestore}=require('@google-cloud/firestore');
const options={projectId:'demo-knews-wallstreet',host:'127.0.0.1:18981',port:18981,ssl:false,
  credentials:{client_email:'emulator@example.invalid',private_key:'synthetic-unused'}};
const db=new Firestore(options),second=new Firestore(options);
const store=()=>new FirestoreWallstreetStore(db);
const report={endpoint:'127.0.0.1:18981',project:'demo-knews-wallstreet',sdk:'9.0.1',tests:[],externalApiCalls:0};
try {
  // Refuse to modify an existing test run's state. No cleanup/reset of other data.
  assert.equal((await db.collection(COLLECTION).doc('head').get()).exists,false,'emulator must be fresh');
  await store().exclusive(async(s,save)=>{
    s.videos.large={text:'한국어😀'.repeat(70000),parts:[{status:'sent',messageId:'synthetic-id'},{status:'unknown'}]};await save();
  });
  await new FirestoreWallstreetStore(second).exclusive(async s=>{
    assert.equal(s.videos.large.text,'한국어😀'.repeat(70000));assert.equal(s.videos.large.parts[0].messageId,'synthetic-id');assert.equal(s.videos.large.parts[1].status,'unknown');
  });
  assert.ok((await db.collection(COLLECTION).doc('head').get()).data().count>1);
  report.tests.push('multiple chunks, Unicode and sent/unknown outbox survive separate SDK client');

  let entered,release;
  const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
  const first=store().exclusive(async()=>{entered();await hold;});await ready;
  try {await assert.rejects(new FirestoreWallstreetStore(second).exclusive(async()=>{}),/wallstreet_locked/);}
  finally {release();await first;}
  report.tests.push('overlapping independent SDK clients cannot own the lock simultaneously');

  await store().exclusive(async(s,save)=>{delete s.videos.large;await save();});
  const now=Date.now();let captionCalls=0;
  const config={enabled:true,activatedAt:now-1000,recipient:'synthetic-person',dailyCredits:5,monthlyCredits:5};
  const discovery=id=>({list:async()=>[{id,channelId:CHANNEL,title:'합성 월가 뉴스레터',description:'월가 뉴스레터 합성',durationSeconds:600,isShort:false,isRebroadcast:false,status:'completed',publishedAt:now}]});
  const providers={captions:{get:async()=>{captionCalls++;return {status:'unavailable'};}},summarizer:{},telegram:{}};
  await tick({...providers,store:store(),config,now,discovery:discovery('aaaaaaaaaaa')});
  await tick({...providers,store:new FirestoreWallstreetStore(second),config,now,discovery:discovery('bbbbbbbbbbb')});
  assert.equal(captionCalls,1);
  await store().exclusive(async s=>{assert.ok(Object.values(s.budgets).every(v=>v===5));});
  report.tests.push('daily/monthly cost reservation persisted; a second client cannot exceed 5-credit cap');

  await store().exclusive(async(s,save)=>{
    s.videos.delivery={stage:'delivery',recipient:'synthetic-person',parts:[{status:'sent',text:'합성 첫 조각',messageId:'synthetic-id'},{status:'pending',text:'합성 둘째 조각'}]};await save();
  });
  let sends=0;
  const delivery={config,now,discovery:{list:async()=>[]},telegram:{send:async()=>{sends++;throw Error('synthetic transport timeout');}}};
  await tick({...delivery,store:store()});await tick({...delivery,store:new FirestoreWallstreetStore(second)});
  assert.equal(sends,1);
  await store().exclusive(async s=>{assert.equal(s.videos.delivery.parts[0].status,'sent');assert.equal(s.videos.delivery.parts[1].status,'unknown');});
  report.tests.push('partial delivery timeout persisted; next SDK client never resends sent/unknown parts');

  // Inject lost acknowledgement after an actual successful emulator transaction.
  // This is a controlled post-commit failure, not a real network packet-loss test.
  let failNext=false,externalSideEffects=0;
  const wrapped={collection:name=>db.collection(name),runTransaction:async fn=>{
    const result=await db.runTransaction(fn);
    if(failNext){failNext=false;throw Error('synthetic committed acknowledgement lost');}
    return result;
  }};
  await assert.rejects(new FirestoreWallstreetStore(wrapped).exclusive(async(s,save)=>{
    s.budgets.uncertain=5;failNext=true;await save();externalSideEffects++;
  }),/acknowledgement lost/);
  assert.equal(externalSideEffects,0);
  assert.ok((await db.collection(COLLECTION).doc('head').get()).data().owner);
  await assert.rejects(new FirestoreWallstreetStore(second).exclusive(async()=>{}),/wallstreet_locked/);
  report.tests.push('real commit + injected lost acknowledgement retains lock and prevents subsequent external work');
  assert.ok(loopbackConnections>0);assert.equal(blockedConnections,0);
  report.networkGuard={loopbackConnections,blockedConnections,metadataDetection:'none',credentials:'synthetic only'};
  report.status='passed';console.log(JSON.stringify(report,null,2));
} finally {await Promise.all([db.terminate(),second.terminate()]);}
