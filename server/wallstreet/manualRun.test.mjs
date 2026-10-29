import test from 'node:test';
import assert from 'node:assert/strict';
import {registerWallstreetRoutes} from './runtime.mjs';
test('only authenticated admin path accepts explicit manual request ID; scheduler remains scheduled',async()=>{
 const routes=new Map(),calls=[],admin=()=>{},job=()=>{};
 const app={get(){},post(path,...handlers){routes.set(path,handlers);}};
 registerWallstreetRoutes(app,{verifyAdmin:admin,verifyJob:job,runtime:{run:async x=>{calls.push(x);return {status:'ok'};}}});
 const res={code:200,setHeader(){},status(x){this.code=x;return this;},json(x){this.body=x;return this;}};
 const a=routes.get('/api/admin/wallstreet/run');assert.equal(a[0],admin);
 await a[1]({get:()=>undefined},res);assert.equal(res.code,400);assert.equal(calls.length,0);
 await a[1]({get:()=> 'diagnostic-request-unique-1'},res);assert.deepEqual(calls[0],{manualRunId:'diagnostic-request-unique-1'});
 const s=routes.get('/api/jobs/youtube-summaries');assert.equal(s[0],job);
 await s[1]({get:()=> 'diagnostic-request-unique-2'},res);assert.equal(calls[1],undefined);
});
