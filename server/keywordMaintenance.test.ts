import test from 'node:test';
import assert from 'node:assert/strict';
import {maintainCompanyKeywords} from './keywordMaintenance';
import {db} from './db';
import {renewalStatus} from '../src/components/renewalStatus.mjs';
const now=new Date('2026-11-15T11:00:00Z');
const base={...db.getCompanies()[0],enabled:true,autoWeeklyRenewalEnabled:true,lastKeywordRenewalAttemptAt:'2026-11-08T11:00:00Z'};
test('maintenance honors seven-day boundary, disabled flags and storage guard without extra model calls',async()=>{
 let calls=0;const runBatch=async()=>{calls++;return {processedCount:1,updatedCount:1,skippedCount:0,failedCount:0,modelCallsCount:1,isRateLimited:false,results:[]};};
 const args={settings:{...db.getSettings(),weeklyCompanyRenewalEnabled:true},companies:[base],available:true,now,runBatch};
 assert.equal((await maintainCompanyKeywords({...args,companies:[{...base,lastKeywordRenewalAttemptAt:'2026-11-08T11:00:01Z'}]})).status,'not_due');
 assert.equal((await maintainCompanyKeywords({...args,available:false})).status,'disabled');
 assert.equal((await maintainCompanyKeywords({...args,settings:{...args.settings,weeklyCompanyRenewalEnabled:false}})).status,'disabled');
 assert.equal((await maintainCompanyKeywords({...args,companies:[{...base,enabled:false}]})).status,'not_due');
 assert.equal((await maintainCompanyKeywords({...args,companies:[{...base,autoWeeklyRenewalEnabled:false}]})).status,'not_due');
 assert.equal(calls,0);assert.equal((await maintainCompanyKeywords(args)).status,'checked');assert.equal(calls,1);
 assert.equal((await maintainCompanyKeywords({...args,runBatch:async()=>{throw Error('synthetic failure');}})).status,'failed');
});
test('renewal display agrees with the actual eligibility period and switches',()=>{
 assert.match(renewalStatus(base,true,now.getTime()),/다음 정기 실행/);
 assert.match(renewalStatus({...base,lastKeywordRenewalAttemptAt:'2026-11-14T11:00:00Z'},true,now.getTime()),/11월 21일/);
 assert.equal(renewalStatus(base,false,now.getTime()),'자동 갱신 꺼짐');
 assert.equal(renewalStatus({...base,enabled:false},true,now.getTime()),'수집 중지');
});
