import test from 'node:test';
import assert from 'node:assert/strict';
import {ownInterviewQuotes} from './interviewTurns.mjs';
test('CNBC sibling interview keeps target speaker and excludes host and Daniela',()=>{
 const text='INTERVIEW\nDARIO AMODEI: We intend to fund our future growth through several different sources of capital.\nDANIELA AMODEI: We are going to triple our revenue over the coming year.\nSORKIN: Are you planning to list the company on the stock market?';
 const q=ownInterviewQuotes(text,['Dario Amodei']);
 assert.equal(q.length,1);assert.match(q[0].quote,/fund/);assert.ok(!q.some(x=>/triple|planning/.test(x.quote)));
});
test('heading and timestamp labels; unknown speakers end the previous turn',()=>{
 for(const tag of ['Dario Amodei','Dario Amodei (00:03:22)']) {
 const q=ownInterviewQuotes(tag+'\nOur research strategy continues to emphasize measurable improvements in safety and reliability.\nGuest Expert\nThis is a different speaker and must never be attributed to Dario.', ['Dario Amodei']);
 assert.equal(q.length,1);assert.match(q[0].quote,/research/);
 }
});
test('no labels fails closed; quoted third party text and long reproductions excluded',()=>{
 assert.deepEqual(ownInterviewQuotes('A host mentions Dario Amodei in ordinary prose.', ['Dario Amodei']),[]);
 const q=ownInterviewQuotes('DARIO AMODEI: '+('We expect continued progress in safety and technology over the next several years. '.repeat(20)),['Dario Amodei']);
 assert.ok(q.reduce((n,x)=>n+x.quote.split(/\s+/).length,0)<=25);
});
