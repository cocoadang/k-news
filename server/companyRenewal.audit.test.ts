import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {db} from './db';
import {_setIsFirestoreAvailableForTesting} from './firestore';
import {executeWeeklyCompanyRenewal,getRecentCompanyArticlesForRenewal,isCompanyEligibleForWeeklyRenewal} from './companyRenewal';
import {responseSchema} from './openaiClient';

// Synthetic per-company checks: never contact a provider or production storage.
_setIsFirestoreAvailableForTesting(false);
const originals=structuredClone(db.getCompanies()),events=structuredClone(db.getEvents());
const now=new Date('2026-11-16T00:00:00Z');
after(()=>{originals.forEach(c=>db.syncAuthoritativeCompany(c));db._setEventsForTesting(events);});
for(const id of ['spacex','tsla','nvda','googl','msft']){
 const original=originals.find(c=>c.id===id)!;
 const fixture=()=>({...structuredClone(original),enabled:true,autoWeeklyRenewalEnabled:true,version:10,lastKeywordRenewalAttemptAt:'2026-11-01T00:00:00Z',renewalLock:null,searchKeywords:[`${id} fixed`,`${id} existing`],coreBusinesses:['Existing business'],pinnedSearchKeywords:[`${id} fixed`],pinnedCoreBusinesses:['Existing business'],renewalHistory:[]});
 const articles=[{id:`${id}-e1`,title:`${id} synthetic supply contract`,snippet:'Synthetic confirmed investment contract'},{id:`${id}-e2`,title:`${id} synthetic product launch`,snippet:'Synthetic product evidence'}];
 const valid=()=>({proposedSearchKeywords:[{keyword:`${id} supply contract`,evidenceId:articles[0].id,reason:'Synthetic contract evidence'}],proposedCoreBusinesses:[{business:'Supply services',evidenceId:articles[1].id,reason:'Synthetic product evidence'}],summaryRationale:'Synthetic audit'});
 test(`${id}: strict response bounds, evidence, pins and versioned history`,async()=>{
  const c=fixture();db.syncAuthoritativeCompany(c);let calls=0;
  const mockClient:any={models:{generateContent:async(args:any)=>{calls++;const s=responseSchema(args.config.responseSchema);assert.equal(s.properties.proposedSearchKeywords.maxItems,3);assert.equal(s.properties.proposedCoreBusinesses.maxItems,2);assert.equal(s.properties.proposedSearchKeywords.items.properties.reason.maxLength,80);assert.equal(s.properties.summaryRationale.anyOf[0].maxLength,160);assert.equal(args.config.maxOutputTokens,2048);return {text:JSON.stringify(valid()),candidates:[{finishReason:'STOP'}]};}}};
  const r=await executeWeeklyCompanyRenewal(c,{now,preFilteredArticles:articles,mockClient});
  assert.equal(calls,1);assert.equal(r.status,'success');assert.equal(r.updatedProfile?.version,11);assert.ok(r.updatedProfile?.searchKeywords.includes(`${id} fixed`));assert.ok(r.updatedProfile?.coreBusinesses.includes('Existing business'));assert.deepEqual(r.historyEntry?.evidenceArticleIds,articles.map(a=>a.id));assert.equal(r.updatedProfile?.searchKeywords.length!<=6,true);assert.equal(r.updatedProfile?.coreBusinesses.length!<=4,true);
 });
 for(const mode of ['malformed','wrong_shape','truncated','fake_evidence','timeout','rate_limit'])test(`${id}: ${mode} preserves the profile and never retries`,async()=>{
  const c=fixture();db.syncAuthoritativeCompany(c);let calls=0;
  const mockClient:any={models:{generateContent:async()=>{calls++;if(mode==='timeout'||mode==='rate_limit')throw Error(mode==='timeout'?'AI_TIMEOUT':'AI_HTTP_429');const body=valid();if(mode==='fake_evidence'){body.proposedSearchKeywords[0].evidenceId='absent';body.proposedCoreBusinesses[0].evidenceId='absent';}return {text:mode==='malformed'?'{ broken':mode==='wrong_shape'?'[]':JSON.stringify(body),candidates:[{finishReason:mode==='truncated'?'MAX_TOKENS':'STOP'}]};}}};
  const r=await executeWeeklyCompanyRenewal(c,{now,preFilteredArticles:articles,mockClient});const stored=db.getCompanyById(id)!;
  assert.equal(calls,1);assert.notEqual(r.status,'success');assert.deepEqual(stored.searchKeywords,c.searchKeywords);assert.deepEqual(stored.coreBusinesses,c.coreBusinesses);assert.deepEqual(stored.pinnedSearchKeywords,c.pinnedSearchKeywords);assert.equal(stored.version,10);assert.deepEqual(stored.renewalHistory,[]);
 });
 test(`${id}: cooldown and insufficient evidence make zero calls`,async()=>{
  const c=fixture();let calls=0;const mockClient:any={models:{generateContent:async()=>{calls++;throw Error('must_not_call');}}};
  const cooling={...c,lastKeywordRenewalAttemptAt:new Date(now.getTime()-7*86400000+1).toISOString()};assert.equal(isCompanyEligibleForWeeklyRenewal(cooling,now).eligible,false);
  assert.equal((await executeWeeklyCompanyRenewal(cooling,{now,preFilteredArticles:articles,mockClient})).status,'skipped');
  db.syncAuthoritativeCompany(c);assert.equal((await executeWeeklyCompanyRenewal(c,{now,preFilteredArticles:articles.slice(0,1),mockClient})).status,'skipped');assert.equal(calls,0);
 });
}

test('recent evidence excludes invalid/future/stale dates and other companies',()=>{
 const base:any={id:'valid',title:'Synthetic NVIDIA chip supply contract',relatedCompanies:['NVIDIA'],companyImpacts:[],firstSeenAt:now.toISOString(),primarySource:{publishedAt:now.toISOString(),snippet:'Synthetic evidence'}};
 db._setEventsForTesting([base,{...base,id:'invalid',firstSeenAt:'invalid',primarySource:{...base.primarySource,publishedAt:'invalid'}},{...base,id:'future',primarySource:{...base.primarySource,publishedAt:new Date(now.getTime()+86400000).toISOString()}},{...base,id:'stale',primarySource:{...base.primarySource,publishedAt:new Date(now.getTime()-31*86400000).toISOString()}},{...base,id:'other',relatedCompanies:['Tesla']}]);
 assert.deepEqual(getRecentCompanyArticlesForRenewal('nvda',30,20,now.getTime()).map(a=>a.id),['valid']);
});

