import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import http from 'node:http';import{gzipSync}from'node:zlib';
import{costHttpTelemetry}from'./costTelemetry';
test('telemetry counts encoded bytes and bodyless 304 once, without URL query or secrets',async()=>{
 const logs:string[]=[];const app=express();app.use(costHttpTelemetry(line=>logs.push(line)));const body=gzipSync('private report '.repeat(200));
 app.get('/api/events',(req,res)=>{res.setHeader('ETag','W/"one"');if(req.headers['if-none-match'])return res.status(304).end();res.setHeader('Content-Encoding','gzip');res.write(body.subarray(0,5));res.end(body.subarray(5));});
 const server=app.listen(0);const base=`http://127.0.0.1:${(server.address()as any).port}`;
 const get=(headers:any={})=>new Promise<void>((resolve,reject)=>http.get(base+'/api/events?token=DO_NOT_LOG',{headers:{Authorization:'Bearer DO_NOT_LOG',...headers}},r=>{r.resume();r.on('end',()=>resolve());}).on('error',reject));
 try{await get();await get({'If-None-Match':'W/"one"'});assert.equal(logs.length,2);const rows=logs.map(l=>JSON.parse(l.slice(l.indexOf('{'))));assert.equal(rows[0].responseBodyBytes,body.length);assert.equal(rows[1].responseBodyBytes,0);assert.equal(rows[1].status,304);assert.equal(rows[1].conditional,true);assert.ok(rows.every(r=>r.complete&&r.route==='events'));assert.ok(logs.every(l=>!l.includes('DO_NOT_LOG')&&!l.includes('private report')));}finally{server.close();}
});
test('telemetry emitter failure cannot break delivery',async()=>{const app=express();app.use(costHttpTelemetry(()=>{throw Error()}));app.get('/',(_q,r)=>r.send('ok'));const s=app.listen(0);try{assert.equal(await(await fetch(`http://127.0.0.1:${(s.address()as any).port}`)).text(),'ok');}finally{s.close();}});
