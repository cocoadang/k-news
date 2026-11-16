import test from 'node:test';import assert from 'node:assert/strict';
import {parseScreeningBatch,screeningResponseSchema} from './geminiAnalyzer';
import {responseSchema} from './openaiClient';
const events=['one','two'].map(id=>({id,primarySource:{snippet:'x'.repeat(60)},originalTitle:id,title:id})) as any;
test('strict schema binds all article IDs and prevents omissions, duplicate IDs and invalid scores',()=>{
 const schema=responseSchema(screeningResponseSchema(events));
 assert.deepEqual(schema.properties.items.required,['one','two']);
 assert.equal(schema.properties.items.additionalProperties,false);
 assert.deepEqual(schema.properties.items.properties.one.properties.score.enum,[1,2,3,4,5]);
 assert.equal(schema.properties.items.properties.one.properties.reason.maxLength,240);
 const score={score:4,reason:'자료 확인 필요',uncertain:true};
 assert.equal(parseScreeningBatch(JSON.stringify({items:{one:score,two:score}}),events).size,2);
 assert.throws(()=>parseScreeningBatch(JSON.stringify({items:{one:score,alien:score}}),events));
 assert.throws(()=>parseScreeningBatch(JSON.stringify({items:{one:score}}),events));
 assert.throws(()=>parseScreeningBatch(JSON.stringify({items:{one:{...score,score:6},two:score}}),events));
});
