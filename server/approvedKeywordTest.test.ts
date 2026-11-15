import test from 'node:test';
import assert from 'node:assert/strict';
import {runApprovedKeywordTest,APPROVED_TEST_ID,APPROVED_NVIDIA_TEST_ID} from './approvedKeywordTest.mjs';
import {executeWeeklyCompanyRenewal} from './companyRenewal';
import {db} from './db';
import {_setIsFirestoreAvailableForTesting} from './firestore';
const now=new Date('2026-11-15T12:00:00Z'),scheduled='2026-11-13T22:02:31.931Z';
const company={...db.getCompanies()[0],id:'spacex',enabled:true,autoWeeklyRenewalEnabled:true,version:5,lastKeywordRenewalAttemptAt:scheduled,renewalLock:null,pinnedSearchKeywords:['SpaceX Starship']};
function memory(){const data=new Map<string,any>([['companies/spacex',structuredClone(company)],['weekly_renewal_budgets/current',{callsCount:5}]]);let tail=Promise.resolve();const ref=(key:string)=>({key,set:async(value:any,options?:any)=>data.set(key,options?.merge?{...data.get(key),...value}:value)});const firestore={collection:(c:string)=>({doc:(id:string)=>ref(c+'/'+id)}),runTransaction(fn:any){const task=tail.then(()=>fn({get:async(r:any)=>({exists:data.has(r.key),data:()=>structuredClone(data.get(r.key))}),set:(r:any,v:any,o:any)=>data.set(r.key,o?.merge?{...data.get(r.key),...structuredClone(v)}:structuredClone(v))}));tail=task.catch(()=>{});return task;}};return {data,firestore};}
const articles=[{id:'e1',title:'SpaceX satellite contract',snippet:'New satellite contract announced'},{id:'e2',title:'SpaceX Starship launch',snippet:'Launch update'}];
test('single approval is atomic under concurrency and never changes the weekly budget',async()=>{
 const x=memory();let calls=0;const execute=async(c:any,o:any)=>{calls++;assert.equal(o.preserveScheduledAttemptAt,scheduled);assert.equal(o.lockToken,c.renewalLock.token);return {status:'success',updatedProfile:{...c,renewalLock:null,lastRenewalStatus:'success',searchKeywords:['SpaceX Starship','SpaceX satellite contracts']},usedTokens:{total:20}};};
 const options={...x,execute,getArticles:()=>articles,sync:()=>{},now};
 const results=await Promise.all([runApprovedKeywordTest(options),runApprovedKeywordTest(options)]);
 assert.equal(calls,1);assert.deepEqual(results.map(r=>r.status).sort(),['already_attempted','success']);
 assert.equal(x.data.get('weekly_renewal_budgets/current').callsCount,5);assert.equal(x.data.get('approved_keyword_tests/'+APPROVED_TEST_ID).callsReserved,1);
});
test('unknown execution consumes approval; expiry, disabled and insufficient evidence make no calls',async()=>{
 const x=memory();let calls=0;const options={...x,execute:async()=>{calls++;throw Error('timeout');},getArticles:()=>articles,sync:()=>{},now};
 assert.equal((await runApprovedKeywordTest({...options,now:new Date('2026-11-16T00:00:00Z')})).status,'approval_expired');
 assert.equal((await runApprovedKeywordTest({...options,ready:false})).status,'unavailable');
 assert.equal((await runApprovedKeywordTest({...options,getArticles:()=>[]})).status,'insufficient_evidence');
 assert.equal(calls,0);assert.equal((await runApprovedKeywordTest(options)).status,'review_required');assert.equal((await runApprovedKeywordTest(options)).status,'already_attempted');assert.equal(calls,1);
});
test('real renewal merge preserves pins and scheduled attempt time on a successful test',async()=>{
 _setIsFirestoreAvailableForTesting(false);
 const c={...company,lastRenewalStatus:'running' as const,renewalLock:{token:'approved-test-lock',lockedAt:now.toISOString(),leaseMs:300000}};
 const mockClient:any={models:{generateContent:async()=>({text:JSON.stringify({proposedSearchKeywords:[{keyword:'SpaceX satellite contracts',evidenceId:'e1',reason:'Confirmed contract'}],proposedCoreBusinesses:[{business:'Satellite Services',evidenceId:'e1',reason:'Contract'}],summaryRationale:'Synthetic test evidence'}),usageMetadata:{promptTokenCount:10,candidatesTokenCount:20,totalTokenCount:30}})}};
 const result=await executeWeeklyCompanyRenewal(c,{now,lockToken:'approved-test-lock',preserveScheduledAttemptAt:scheduled,preFilteredArticles:articles,mockClient});
 assert.equal(result.status,'success');assert.equal(result.updatedProfile?.lastKeywordRenewalAttemptAt,scheduled);assert.ok(result.updatedProfile?.searchKeywords.includes('SpaceX Starship'));assert.ok(result.updatedProfile?.searchKeywords.includes('SpaceX satellite contracts'));assert.equal(result.historyEntry?.timestamp,now.toISOString());
});

test('NVIDIA has one separate approval; no other company can bypass the weekly guard',async()=>{
 const x=memory();x.data.set('companies/nvda',{...company,id:'nvda',lastRenewalStatus:'failed'});let calls=0;
 const opts={...x,companyId:'nvda',now,getArticles:()=>articles,sync:()=>{},execute:async(c:any,o:any)=>{calls++;assert.equal(c.id,'nvda');assert.equal(o.preserveScheduledAttemptAt,scheduled);return {status:'success',updatedProfile:{...c,lastRenewalStatus:'success',renewalLock:null}};}};
 assert.equal((await runApprovedKeywordTest({...opts,companyId:'tsla'})).status,'not_approved');
 const results=await Promise.all([runApprovedKeywordTest(opts),runApprovedKeywordTest(opts)]);
 assert.deepEqual(results.map(x=>x.status).sort(),['already_attempted','success']);assert.equal(calls,1);
 assert.equal(x.data.get('approved_keyword_tests/'+APPROVED_NVIDIA_TEST_ID).callsReserved,1);
 assert.equal(x.data.get('weekly_renewal_budgets/current').callsCount,5);
 assert.equal(x.data.get('companies/spacex').version,company.version);
});

test('valid-looking but truncated or wrong-shape renewal output is never saved',async()=>{
 _setIsFirestoreAvailableForTesting(false);
 for(const [text,finishReason] of [['[]','STOP'],['{}','STOP'],[JSON.stringify({proposedSearchKeywords:[],proposedCoreBusinesses:[]}),'MAX_TOKENS']]){
  let calls=0;
  const result=await executeWeeklyCompanyRenewal(company,{now,force:true,preFilteredArticles:articles,mockClient:{models:{generateContent:async()=>{calls++;return {text,candidates:[{finishReason}]};}}} as any});
  assert.equal(result.status,'failed');assert.equal(result.reason,'malformed_json_response');assert.equal(calls,1);
 }
});
