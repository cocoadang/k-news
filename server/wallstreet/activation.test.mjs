import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {PUBLIC_CHANNEL_ID} from './publicChannel.mjs';
const url=new URL('./config.mjs',import.meta.url).href;
function config(extra={}){return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`import {wallstreetConfig as c} from '${url}';console.log(JSON.stringify(c));`],{encoding:'utf8',env:{SystemRoot:process.env.SystemRoot||'',...extra}}));}
test('deployment switch enables approved nonzero limits and preserves exclusions; default stays disabled',()=>{
 assert.equal(config().enabled,false);
 const c=config({KNEWS_YOUTUBE_ENABLED:'true',KNEWS_YOUTUBE_ACTIVATED_AT:'2026-10-29T00:00:00Z',KNEWS_SUPADATA_WINDOW_START:'2026-10-29T00:00:00Z',KNEWS_SUPADATA_WINDOW_END:'2026-11-27T00:00:00Z',TELEGRAM_CHAT_ID:'123'});
 assert.equal(c.enabled,true);assert.equal(c.summaryReservationMicros,30000);assert.equal(c.dailySummaryMicros,260000);assert.equal(c.monthlySummaryMicros,2000000);
 assert.equal(c.model,'gpt-6-luna');assert.equal(c.automaticSummaryRetries,false);
 assert.equal(c.supadataDailyLimit,6);assert.equal(c.supadataCycleLimit,90);assert.equal(c.paidFallback,false);assert.equal(c.counterEvidenceRequired,true);
 assert.ok(c.vidiqApproved&&c.supadataApproved&&c.discoveryApproved&&c.summaryApproved&&c.deliveryApproved);
 assert.deepEqual(c.dailyCheckTimes,['09:00','15:00']);assert.equal(c.recipient,PUBLIC_CHANNEL_ID);assert.equal(c.excludedVideoIds.length,4);
});


test('activation floor lets collection look back to 10/29 00:00 KST, never later than configured',async()=>{
 const {activationFloor,DISCOVERY_BACKFILL_FROM}=await import('./config.mjs');
 assert.equal(activationFloor('2026-10-29T02:21:23.473Z'),DISCOVERY_BACKFILL_FROM);
 assert.equal(activationFloor('2026-10-20T00:00:00Z'),Date.parse('2026-10-20T00:00:00Z'));
 assert.equal(activationFloor(undefined),null);
});


