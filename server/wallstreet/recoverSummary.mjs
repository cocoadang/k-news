import {createHash} from 'node:crypto';
import {renderGroundedBrief} from './groundedSummary.mjs';
import {splitMessage} from './core.mjs';
import {settleReservation,summaryReservation,SUMMARY_FIX_VERSION} from './textRuntime.mjs';

// Supervised recovery uses the same lock, checkpoint, grounding and spending caps
// as the scheduled worker. Publish on the website without sending notifications.
export async function recoverHeldSummary({store,summarizer,config,videoId,now=Date.now()}) {
 return store.exclusive(async(s,save)=>{
  const r=s.videos[videoId];
  if(!r||r.stage!=='text_review_required'||!r.transcript?.length)return {status:'held_summary_required'};
  const spent=r.summarySpentMicros||0;
  const amount=summaryReservation(config,r.transcript)-spent,iso=new Date(now).toISOString();
  if(!Number.isSafeInteger(spent)||spent<0||!Number.isSafeInteger(amount)||amount<=0)return {status:'summary_budget_exceeded'};
  const keys=['text:'+iso.slice(0,10),'text:'+iso.slice(0,7)],limits=[config.dailySummaryMicros,config.monthlySummaryMicros];
  if(keys.some((k,i)=>(s.budgets[k]||0)+amount>limits[i]))return {status:'summary_budget_exceeded'};
  keys.forEach(k=>s.budgets[k]=(s.budgets[k]||0)+amount);
  r.summaryCheckpoint ||= {};r.summaryFixVersion=SUMMARY_FIX_VERSION;await save();
  let result;
  try {result=await summarizer.summarize({video:r.video,segments:r.transcript,maxCostMicros:amount,
    checkpoint:r.summaryCheckpoint,saveCheckpoint:save});}
  catch(error){r.summarySpentMicros=spent+amount-settleReservation(s,{keys,amount},error.candidate);r.summaryFailure=error.message;
    r.summaryCandidate=error.candidate;r.summaryFailedAt=now;await save();return {status:'review_required',failure:error.message};}
  r.summarySpentMicros=spent+amount-settleReservation(s,{keys,amount},result.validationJournal);
  r.parts=splitMessage(renderGroundedBrief(r.video,result)).map(text=>({text,
    hash:createHash('sha256').update(text).digest('hex'),status:'sent',webOnly:true}));
  r.summaryCandidate=result;r.stage='sent';r.recoveredAt=now;r.recoveryDelivery='website_only';
  delete r.summaryFailure;delete r.hold;await save();
  return {status:'recovered',videoId,items:result.items.length,model:result.validationJournal.model,
    calls:result.validationJournal.calls.length,usage:result.validationJournal.calls.map(c=>c.usage),websiteOnly:true};
 });
}
