import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analysisFailureCode,claimAnalysisRetry,mayResumeAnalysis} from './analysisAutoRetry';
import type {NewsEvent} from './types';

// The database module writes a local development cache: isolate all integration fixtures.
const cwd=process.cwd(),dir=mkdtempSync(join(tmpdir(),'news-retry-'));
process.chdir(dir);
const {db}=await import('./db');
const {runTwoStageAnalysis,createUnanalyzedEvent}=await import('./geminiAnalyzer');
const {_setIsFirestoreAvailableForTesting}=await import('./firestore');
_setIsFirestoreAvailableForTesting(false);
process.on('exit',()=>{process.chdir(cwd);rmSync(dir,{recursive:true,force:true});});
const now=new Date();
const fixture=()=>({...createUnanalyzedEvent({id:'retry',title:'Google product announcement',link:'https://example.com/retry',source:'Reuters',publishedAt:now.toISOString(),firstSeenAt:now.toISOString(),snippet:'Confirmed company facts and product context from the primary source. '.repeat(3)}),id:'retry',updatedAt:now.toISOString()});
const commit=async(expected:NewsEvent,patch:Partial<NewsEvent>)=>{
 const current=db.getEventById(expected.id);
 if(!current||current.analysisStatus!==expected.analysisStatus||current.updatedAt!==expected.updatedAt||current.analysisAutoRetry?.token!==expected.analysisAutoRetry?.token||current.analysisAutoRetry?.status!==expected.analysisAutoRetry?.status)return current||null;
 const saved={...current,...patch};db.syncEventFromCloud(saved);return saved;
};
test('screening error is detected, budget waits without claiming, then exactly one correction survives restart',async()=>{
 db._setEventsForTesting([fixture()]);let calls=0;
 const generate=async()=>{calls++;return {text:calls===1?'{}':JSON.stringify({items:{retry:{score:2,reason:'잠정 평가',uncertain:false}}}),usageMetadata:{totalTokenCount:100}};};
 await runTwoStageAnalysis({now,generate,commit});assert.equal(calls,1);assert.equal(db.getEventById('retry')?.analysisStatus,'failed');
 await runTwoStageAnalysis({now,generate,commit,estimatedTokenBudget:0});assert.equal(db.getEventById('retry')?.analysisAutoRetry,undefined);
 await runTwoStageAnalysis({now,generate,commit});await runTwoStageAnalysis({now,generate,commit});
 assert.equal(calls,2);assert.equal(db.getEventById('retry')?.analysisAutoRetry?.status,'recovered');
});
test('second rejected response stops automatically; unknown timeout never retries',async()=>{
 db._setEventsForTesting([fixture()]);let calls=0;
 const generate=async()=>{calls++;return {text:'{}',usageMetadata:{totalTokenCount:100}};};
 for(let i=0;i<4;i++)await runTwoStageAnalysis({now,generate,commit});
 assert.equal(calls,2);assert.equal(db.getEventById('retry')?.analysisAutoRetry?.status,'review_required');
 const e={...fixture(),analysisStatus:'failed',analysisFailureCode:'AI_TIMEOUT'} as NewsEvent;
 db._setEventsForTesting([e]);await runTwoStageAnalysis({now,generate,commit});assert.equal(calls,2);
 assert.equal(analysisFailureCode(new SyntaxError('malformed')),'invalid_json_response');
 assert.equal(analysisFailureCode(Error('unrecognized')),'review_required');
});
test('optimistic claim has one owner even with equal timestamps; interrupted owner cannot retry',async()=>{
 const e={...fixture(),analysisStatus:'failed',analysisFailureCode:'screening_missing_results'} as NewsEvent;
 db._setEventsForTesting([e]);
 const claimed=await Promise.all([claimAnalysisRetry(e,'screen',commit,now.toISOString()),claimAnalysisRetry(e,'screen',commit,now.toISOString())]);
 assert.equal(claimed.filter(Boolean).length,1);assert.equal(mayResumeAnalysis(db.getEventById('retry')!),false);
 assert.equal(await claimAnalysisRetry(e,'screen',async()=>null,now.toISOString()),null);
});
test('screen correction and subsequent detailed analysis share a single allowance and strict status validation',async()=>{
 db._setEventsForTesting([{...fixture(),analysisStatus:'failed',analysisFailureCode:'screening_missing_results'}]);let detail=0;
 const generate=async()=>({text:JSON.stringify({items:{retry:{score:5,reason:'확인 필요',uncertain:true}}}),usageMetadata:{totalTokenCount:100}});
 await runTwoStageAnalysis({now,generate,commit,maxDetailedCalls:0});
 assert.equal(db.getEventById('retry')?.analysisAutoRetry?.status,'ready');
 const analyze=async()=>{detail++;return {...fixture(),analysisStatus:'failed',analysisFailureCode:'invalid_json_response'} as NewsEvent;};
 await runTwoStageAnalysis({now,generate,commit,analyze});await runTwoStageAnalysis({now,generate,commit,analyze});
 assert.equal(detail,1);assert.equal(db.getEventById('retry')?.analysisStatus,'failed');assert.equal(db.getEventById('retry')?.analysisAutoRetry?.status,'review_required');
});
