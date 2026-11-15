import {randomUUID} from 'node:crypto';
export const APPROVED_TEST_ID='spacex-20261115';
export const APPROVED_TEST_END=Date.parse('2026-11-15T15:00:00Z'); // Ends at midnight KST.
const view=c=>({searchKeywords:c.searchKeywords||[],coreBusinesses:c.coreBusinesses||[],pinnedSearchKeywords:c.pinnedSearchKeywords||[],lastKeywordRenewalAttemptAt:c.lastKeywordRenewalAttemptAt||null,version:c.version||1});

// Owner approved one extra call for this one company/date. The normal weekly
// budget collection is neither read as an allowance nor modified here.
export async function runApprovedKeywordTest({firestore,execute,getArticles,sync,now=new Date(),ready=true}){
 if(!ready||!firestore)return {status:'unavailable'};
 const at=now.getTime();if(at>=APPROVED_TEST_END||at<Date.parse('2026-11-15T00:00:00+09:00'))return {status:'approval_expired'};
 const articles=getArticles('spacex',30,20,at);if(articles.length<2)return {status:'insufficient_evidence'};
 const ref=firestore.collection('companies').doc('spacex');
 const ledger=firestore.collection('approved_keyword_tests').doc(APPROVED_TEST_ID);
 const claim=await firestore.runTransaction(async tx=>{
  const [previous,snap]=await Promise.all([tx.get(ledger),tx.get(ref)]);
  if(previous.exists)return {status:'already_attempted'};
  if(!snap.exists)return {status:'not_found'};
  const c=snap.data();if(c.enabled===false||c.autoWeeklyRenewalEnabled===false)return {status:'disabled'};
  if(c.renewalLock?.lockedAt&&at-Date.parse(c.renewalLock.lockedAt)<(c.renewalLock.leaseMs||300000))return {status:'locked'};
  const token=randomUUID(),locked={...c,lastRenewalStatus:'running',renewalLock:{token,lockedAt:now.toISOString(),leaseMs:300000}};
  tx.set(ledger,{status:'reserved',allowance:1,callsReserved:1,startedAt:now.toISOString(),before:view(c)});
  tx.set(ref,locked,{merge:true});
  return {status:'claimed',company:locked,token,before:view(c)};
 });
 if(claim.status!=='claimed')return claim;
 // Reservation is durable before any model call. Unknown outcomes consume the
 // single allowance; the same approval can never start a second call.
 let result;
 try{result=await execute(claim.company,{now,expectedVersion:claim.company.version||1,lockToken:claim.token,preFilteredArticles:articles,preserveScheduledAttemptAt:claim.company.lastKeywordRenewalAttemptAt});}
 catch{await ledger.set({status:'review_required',finishedAt:new Date().toISOString()},{merge:true});return {status:'review_required'};}
 const after=result.updatedProfile?view(result.updatedProfile):null;
 const report={status:result.status,companyId:'spacex',before:claim.before,after,reason:result.reason||null,evidenceArticleIds:result.historyEntry?.evidenceArticleIds||[],usedTokens:result.usedTokens||null,finishedAt:new Date().toISOString()};
 await ledger.set(report,{merge:true});
 if(result.updatedProfile)sync(result.updatedProfile);
 return report;
}
