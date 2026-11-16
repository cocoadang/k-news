const VALIDATION_FAILURES=new Set(['insufficient_source_grounded_items','insufficient_context_reviewed_items','semantic_verification_failed','grounded_shape','grounded_ids','grounded_item_count','grounded_number','unsupported_source_term']);
/** Only known validation failures with fully settled requests may retry. */
export function summaryRetryEligible(r,c,now){
 if(c.automaticSummaryRetryOnce!==true||r.stage!=='text_review_required'||r.hold!=='summary_failed_or_uncertain'||r.summaryAutoRetry||r.summaryRetried||r.summaryLaterRunRetried)return false;
 if(!VALIDATION_FAILURES.has(r.summaryFailure)||!r.transcript?.length||now-(r.firstSeen||0)>=3*86400000||!Number.isSafeInteger(r.summarySpentMicros))return false;
 if(r.parts?.some(p=>['sent','unknown','inflight'].includes(p.status)))return false;
 const journal=r.summaryCandidate?.validationJournal||r.summaryCandidate,entries=Object.values(r.summaryCheckpoint?.entries||{});
 return Array.isArray(journal?.calls)&&(journal.calls.length>0||entries.length>0)&&journal.calls.every(x=>x.status==='completed')&&entries.every(x=>x.status==='completed');
}
