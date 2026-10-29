import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptNativeCaption} from './textRuntime.mjs';
test('native completion requires validated long captions, not mere caption existence',()=>{
 const v={status:'awaiting_native_captions'};
 assert.throws(()=>acceptNativeCaption([{start:0,text:'x'},{start:170,text:'y'}],v),/long_form/);assert.equal(v.status,'awaiting_native_captions');
 assert.throws(()=>acceptNativeCaption([{start:200,text:'x'},{start:1,text:'y'}],v),/invalid/);
 acceptNativeCaption([{start:0,text:'x'},{start:300,text:'y'}],v);assert.equal(v.status,'completed');assert.equal(v.durationEvidence,'last_caption_start_lower_bound');
});
