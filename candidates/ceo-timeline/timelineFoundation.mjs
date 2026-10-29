// Local read-only projection. Does not infer dates, speakers, translations or stance.
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const day=v=>typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
export function timelineRecord(s){
 const evidence=s.evidence||[],quote=s.kind==='direct_quote'?s.quoteText:null;
 const supported=!!norm(quote)&&evidence.some(e=>norm(e.excerpt).includes(norm(quote)));
 const explicit=s.spokenAt?.precision==='day'&&s.spokenAt.basisType==='explicit_in_text'&&day(s.spokenAt.value)&&!!s.spokenAt.basisExcerpt;
 return {id:s.statementId,personId:s.personId,companyId:s.companyId,topicId:s.topicId,
  spokenDate:explicit?s.spokenAt.value:null,spokenDateEvidence:s.spokenAt||null,
  referenceDate:s.referenceDate||null,publicationDates:evidence.map(e=>({url:e.url,date:e.articlePublishedAt||null,basis:e.publishedAtBasis||null})),
  filingDate:s.filingDate||null,sourceType:s.sourceType||'unclassified',
  originalQuote:supported?quote:null,originalQuoteStatus:supported?'matches_stored_excerpt':'not_supported_as_direct_quote',
  translation:s.translationKo||null,summary:s.koSummary||null,context:s.context||null,provenance:s.provenance||[],
  verification:s.verification||null,evidence,
  lane:explicit?'spoken_date_confirmed':'spoken_date_unknown',
  // Textual match verifies the stored excerpt only, not the remote document or speaker attribution.
  remoteSourceRevalidated:false};
}
export function selectComparison(statements,firstId,secondId){
 const a=statements.find(s=>s.statementId===firstId),b=statements.find(s=>s.statementId===secondId);
 if(!a||!b)return {eligible:false,reason:'missing_statement'};
 if(a.personId!==b.personId||a.companyId!==b.companyId||a.topicId!==b.topicId)return {eligible:false,reason:'different_person_company_or_topic'};
 const x=timelineRecord(a),y=timelineRecord(b);
 if(!x.spokenDate||!y.spokenDate)return {eligible:false,reason:'spoken_date_unconfirmed',records:[x,y]};
 if(x.spokenDate===y.spokenDate)return {eligible:false,reason:'same_day_order_unknown',records:[x,y]};
 if(!x.originalQuote||!y.originalQuote)return {eligible:false,reason:'unsupported_quote',records:[x,y]};
 return {eligible:true,records:[x,y].sort((a,b)=>a.spokenDate.localeCompare(b.spokenDate)),verdict:'not_assessed',conditionAndMetricReview:'required'};
}
export function reCitationGroups(statements){
 const groups=new Map();
 for(const s of statements){const r=timelineRecord(s);
  // A quote match alone cannot identify an event. Preserve repetitions on different dates.
  const key=s.eventKey&&r.spokenDate&&r.originalQuote?JSON.stringify([s.personId,s.companyId,s.topicId,s.eventKey,r.spokenDate,norm(r.originalQuote),s.quoteLanguage,s.context||null]):s.statementId;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(s.statementId);
 }return [...groups.values()];
}
