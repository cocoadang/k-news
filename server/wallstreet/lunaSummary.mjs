import {aiCacheMetric} from '../costAiTelemetry.mjs';
import {summarizeDigest} from './digestSummary.mjs';
import {createHash} from 'node:crypto';
import {evidenceBlocks,segmentWindows,filterGroundedCandidates,conservativeClassification,acceptVerification} from './groundedSummary.mjs';
import {LUNA_MODEL,LUNA_CACHE_WRITE_RATE,LUNA_OUTPUT_RATE,lunaUsageCost} from './lunaClient.mjs';

export const LUNA_PIPELINE_VERSION=1;
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},kind={type:'string',enum:['reported','outlook']},ids={type:'array',items:str,minItems:1,maxItems:12};
const item=object({title:str,text:str,kind,evidenceIds:ids});
const candidatesSchema=object({items:{type:'array',items:item,maxItems:32}});
const check=object({index:{type:'integer'},supported:{type:'boolean'},classificationCorrect:{type:'boolean'},recommendedKind:kind,
 counterStatus:{type:'string',enum:['clear','qualifies','uncertain']},sourceIds:{type:'array',items:str,maxItems:12},duplicateOf:{type:['integer','null']},reason:str});
const MAX_AUDIT_ITEMS=64;
const auditSchema=object({checks:{type:'array',items:check,maxItems:MAX_AUDIT_ITEMS}});
// Preserve the exact existing schema/cache key for smaller completed audits.
const smallAuditSchema=object({checks:{type:'array',items:check,maxItems:32}});
export const EXTRACT_INSTRUCTION='Extract every distinct important news item in this supplied segment of a briefing about the previous US market session. Keep companies, indicators and policy events separate; do not force a topic count, merge unrelated news or pad with chatter/ads. Write concise Korean titles and 2-4 sentence summaries. kind=reported for what the broadcast reports, outlook for interpretation/prediction. Preserve attribution, conditions, uncertainty and conflicting views. Use only supplied evidenceIds (at most 12, within 12 consecutive IDs); include enough evidence for the actor and caveats. Do not guess unclear names/numbers or add outside facts. Title is a hint, not evidence. Empty items is allowed for chatter. Return the required JSON.';
export const REVIEW_INSTRUCTION='Audit EVERY draft against its coreIds and relatedIds. Read later blocks for corrections, disagreement, missing conditions and attribution changes. A literal name nearby is not proof of attribution. Reject unsupported implications, names/numbers, ads, contextless claims or lost uncertainty. Check reported/outlook classification; recommend outlook for interpretation or forecasts. counterStatus=clear only after checking supplied context, qualifies for a material missing caveat (cite sourceIds), uncertain when evidence is insufficient. This is broadcast-grounding, not external fact checking. Mark a semantic duplicate with duplicateOf=an earlier draft index; otherwise null. Do not rewrite or add facts. Return one check per draft in order; reason at most 40 Korean characters.';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SOURCE_DETAIL_RULES=' Names, Latin words, abbreviations and quantities must use the literal spelling in the cited blocks (whitespace and Latin case may differ). Never convert a Korean phrase into an absent English abbreviation, normalize a corrupted ASR name, or expand an unclear number. If a peripheral detail is unclear, OMIT it and retain the supported core claim with generic attribution. Keep distinct subtopics and presenter views separate; never pad a count. For a supported short broadcast, cover its distinct news, opposing view and conditional outlook where present.';
const compactBlocks=blocks=>blocks.map(({id,text})=>({id,text}));
function reviewPayload(items){
 const blocks=[...new Map(items.flatMap(x=>x.relatedBlocks).map(x=>[x.id,x])).values()].sort((a,b)=>a.start-b.start);
 return {drafts:items.map((x,index)=>({index,title:x.title||'',text:x.text,kind:x.kind,coreIds:x.contextIds,relatedIds:x.relatedBlocks.map(b=>b.id)})),blocks:compactBlocks(blocks)};
}
export function lunaSummarizer({client,approved=false,acceptMinimumItems=3,telegramDigestApproved=false}){
 const floor=Math.max(3,acceptMinimumItems);
 return {async summarize({segments,video,maxCostMicros,checkpoint={},saveCheckpoint=async()=>{}}){
  if(!approved||!Number.isSafeInteger(maxCostMicros)||maxCostMicros<1||maxCostMicros>50000)throw Error('grounded_budget_config');
  const blocks=evidenceBlocks(segments),windows=(blocks.at(-1)?.start>1800)?segmentWindows(blocks):[blocks];
  if(!blocks.length||windows.length>30)throw Error('luna_transcript_limit');
  const identity=digest({version:LUNA_PIPELINE_VERSION,model:LUNA_MODEL,segments,title:video?.title||''});
  if(checkpoint.identity!==identity){for(const k of Object.keys(checkpoint))delete checkpoint[k];Object.assign(checkpoint,{identity,entries:{}});await saveCheckpoint();}
  const journal={protocol:'evidence_ids_v1',provider:'openai',model:LUNA_MODEL,pipelineVersion:LUNA_PIPELINE_VERSION,segments:windows.length,calls:[],cacheHits:0};
  let reserved=0;
  async function call(stage,instruction,payload,schema,cap){
   const generates=stage==='repair'||stage.startsWith('extract_');
   const correction=checkpoint.automaticRetryAttempt===1&&generates?' One corrective pass after a rejected result: reconstruct only source-supported topics, retaining opposing views, attribution and conditions. Omit unclear peripheral details. Never pad the minimum count.':'';
   const args={contents:instruction+(generates?SOURCE_DETAIL_RULES:'')+correction+'\n'+JSON.stringify(payload),schema,name:stage.replace(/\W/g,'_'),maxOutputTokens:cap};
   const key=digest(args),entry=checkpoint.entries[key];
   if(entry?.status==='completed'){aiCacheMetric('youtube_checkpoint','hit');journal.cacheHits++;return entry.result;}
   // A timeout/crash may have incurred a charge. Never repeat it automatically.
   if(entry){aiCacheMetric('youtube_checkpoint','pending');throw Error('luna_previous_call_uncertain');}
   aiCacheMetric('youtube_checkpoint','miss');
   if(journal.calls.length>=windows.length+(telegramDigestApproved?7:4))throw Error('luna_call_limit');
   // Completed stages with older prompts may coexist with their replacements.
   // Keep that history bounded without charging cache hits against this run's call limit.
   if(Object.keys(checkpoint.entries).length>=2*(windows.length+(telegramDigestApproved?7:4)))throw Error('luna_checkpoint_limit');
   const input=client.estimateInputTokens(args);
   if(!Number.isSafeInteger(input)||input<1||input>250000)throw Error('luna_input_limit');
   // A fresh request may be billed at the cache-write rate for its input.
   const ceiling=Math.ceil(input*LUNA_CACHE_WRITE_RATE+cap*LUNA_OUTPUT_RATE);
   if(reserved+ceiling>maxCostMicros)throw Error('grounded_budget_exceeded');
   reserved+=ceiling;
   const record={stage,ceiling,status:'inflight'};journal.calls.push(record);
   checkpoint.entries[key]={status:'inflight',ceiling};await saveCheckpoint();
   try{
    const output=await client.generate(args),spent=lunaUsageCost(output.usage);
    if(spent!==null&&spent<=ceiling){record.spentMicros=spent;record.usage=output.usage;}
    record.status='completed';
    const result=JSON.parse(output.text);
    checkpoint.entries[key]={status:'completed',result};await saveCheckpoint();return result;
   }catch(error){
    const spent=lunaUsageCost(error?.usage);
    if(spent!==null&&spent<=ceiling){record.spentMicros=spent;record.usage=error.usage;record.status='completed';}
    throw error;
   }
  }
  try{
   const candidates=[],rejected=[];
   for(let k=0;k<windows.length;k++){
    const window=windows[k];
    const part=await call('extract_'+k,EXTRACT_INSTRUCTION,{title:video?.title||'',segment:k+1,segments:windows.length,blocks:compactBlocks(window)},candidatesSchema,windows.length>1?2400:4200);
    if(!Array.isArray(part?.items)||part.items.length>32)throw Error('grounded_shape');
    // Reject cross-window IDs before global grounding. Empty segments are valid.
    const allowed=new Set(window.map(b=>b.id));
    for(const x of part.items){
     if(!Array.isArray(x?.evidenceIds)||x.evidenceIds.some(id=>!allowed.has(id)))throw Error('grounded_ids');
     candidates.push(x);
    }
   }
   // No arbitrary three-per-segment cap or dropping short news in favor of long prose.
   const items=[],seen=new Set();
   for(const x of candidates){
    if(seen.has(x.text))continue;seen.add(x.text);
    const s=filterGroundedCandidates({items:[x]},blocks,{minimum:1,contextRadius:1,topicContext:true});
    // A report ABOUT a possible event is not itself a forecast. Keep the
    // draft classification until the semantic auditor checks the full claim.
    if(s.items.length)items.push(...s.items.map(g=>({...g,kind:x.kind})));else rejected.push({item:x,reason:s.rejected[0]?.reason});
   }
   if(rejected.length){
    const selected=new Set();for(const {item:x} of rejected){const indexes=x.evidenceIds.map(id=>blocks.findIndex(b=>b.id===id));for(const i of indexes)for(let j=Math.max(0,i-2);j<=Math.min(blocks.length-1,i+2);j++)selected.add(j);}
    const repair=await call('repair','Repair each rejected draft news item using only supplied evidence. Keep its supported core claim and original topic. If a peripheral name, number, date, interpretation or clause is unsupported, REMOVE THAT DETAIL rather than discarding the supported topic. Especially retain a supported main topic hinted by the video title. Do not guess ASR corrections or add facts. Preserve attribution, uncertainty and financing/forecast conditions. Return at least one concise corrected item for every draft whose core claim is supported, with title,text,kind,evidenceIds. Omit an item only when its core claim cannot be supported.',{title:video?.title||'',rejected,blocks:compactBlocks([...selected].sort((a,b)=>a-b).map(i=>blocks[i]))},candidatesSchema,3000);
    for(const x of repair.items||[]){
     // Repair cannot use evidence outside the supplied repair set.
     if(!Array.isArray(x?.evidenceIds)||x.evidenceIds.some(id=>!selected.has(blocks.findIndex(b=>b.id===id))))continue;
     const s=filterGroundedCandidates({items:[x]},blocks,{minimum:1,contextRadius:1,topicContext:true});
     for(const g of s.items)if(!items.some(m=>m.text===g.text))items.push({...g,kind:x.kind});
    }
   }
   journal.candidateCount=candidates.length;journal.sourceAccepted=items.length;journal.sourceRejected=rejected.map(x=>x.reason);
   if(items.length<floor)throw Error('insufficient_source_grounded_items');
   if(items.length>MAX_AUDIT_ITEMS)throw Error('luna_item_limit');
   items.sort((a,b)=>a.start-b.start);
   let audit=await call('audit',REVIEW_INSTRUCTION,reviewPayload(items),items.length<=32?smallAuditSchema:auditSchema,Math.min(6000,1000+items.length*140));
   if(!Array.isArray(audit?.checks)||audit.checks.length!==items.length||audit.checks.some((x,i)=>x.index!==i))throw Error('semantic_verification_failed');
   let classified,kept=[];
   for(let pass=0;pass<2;pass++){
    classified=conservativeClassification(items,audit);audit=classified.audit;kept=[];
    for(let i=0;i<items.length;i++){
     const c=audit.checks[i],allowed=new Set(items[i].relatedBlocks.map(b=>b.id));
     if(c.supported===true&&c.classificationCorrect===true&&c.counterStatus==='clear'&&c.duplicateOf===null&&typeof c.reason==='string'&&c.reason.trim()&&c.reason.length<=200&&Array.isArray(c.sourceIds)&&c.sourceIds.every(id=>allowed.has(id))&&['reported','outlook'].includes(c.recommendedKind))kept.push({item:classified.items[i],check:c});
    }
    if(kept.length>=floor||pass===1)break;
    // A locally grounded draft can still carry an ambiguous ASR clause. Preserve
    // the supported topic by removing that clause, then require a fresh full
    // semantic audit. Never rescue semantic duplicates or pad the item count.
    const qualified=items.flatMap((x,i)=>{
     const c=audit.checks[i];
     return c?.duplicateOf===null&&(c.supported!==true||['qualifies','uncertain'].includes(c.counterStatus))?[{item:x,check:c}]:[];
    });
    if(!qualified.length)break;
    const supplied=[...new Map(qualified.flatMap(x=>x.item.relatedBlocks).map(b=>[b.id,b])).values()];
    const ambiguous=qualified.some(x=>x.check.supported!==true||x.check.counterStatus==='uncertain');
    const instruction=ambiguous?
     'Repair ONLY the rejected drafts below against their supplied source blocks and auditor reasons. Keep each supported core topic and remove unsupported or ambiguous peripheral clauses, especially unclear ASR names, roles, numbers or objects of an appointment. Do not guess whom an unclear phrase refers to. Preserve attribution, opposing views, caveats, conditions and reported/outlook classification. If the core topic itself lacks evidence, OMIT the draft. Return at most one corrected item per rejected draft with literal evidenceIds; do not split, add topics, outside facts or pad a minimum count. The complete result must pass a new independent semantic audit.':
     'Repair ONLY the drafts below by explicitly preserving the material caveats or opposing views identified by the auditor. Keep their supported core topic, attribution and uncertainty. Do not turn a report of a possibility into a prediction. Use only supplied blocks; omit unclear ASR names/numbers/abbreviations. Return corrected items with literal evidenceIds covering both the claim and its caveat. Do not add topics or outside facts.';
    journal.semanticRepairAttempted=true;
    const repair=await call(ambiguous?'clarify':'qualify',instruction,{drafts:qualified.map(x=>({title:x.item.title,text:x.item.text,kind:x.item.kind,check:x.check})),blocks:compactBlocks(supplied)},candidatesSchema,2000);
    if(!Array.isArray(repair?.items)||repair.items.length>qualified.length)throw Error('semantic_verification_failed');
    const next=kept.map(x=>x.item),allowed=new Set(supplied.map(b=>b.id));
    for(const x of repair.items||[]){
     if(!Array.isArray(x?.evidenceIds)||x.evidenceIds.some(id=>!allowed.has(id)))continue;
     const screened=filterGroundedCandidates({items:[x]},blocks,{minimum:1,contextRadius:1,topicContext:true});
     for(const g of screened.items)if(!next.some(n=>n.text===g.text))next.push({...g,kind:x.kind});
    }
    if(next.length<floor)break;
    items.splice(0,items.length,...next.sort((a,b)=>a.start-b.start));
    audit=await call('audit_qualified',REVIEW_INSTRUCTION,reviewPayload(items),items.length<=32?smallAuditSchema:auditSchema,Math.min(6000,1000+items.length*140));
    if(!Array.isArray(audit?.checks)||audit.checks.length!==items.length||audit.checks.some((x,i)=>x.index!==i))throw Error('semantic_verification_failed');
   }
   if(kept.length<floor)throw Error('insufficient_context_reviewed_items');
   const result=acceptVerification(kept.map(x=>x.item),{checks:kept.map((x,index)=>({...x.check,index}))});
   if(telegramDigestApproved){
    try{result.telegramDigest=await summarizeDigest(result.items,call);}
    catch{result.telegramDigest={verified:false};}
   }
   journal.candidateCount=candidates.length;journal.repairedCount=rejected.length;journal.omittedCount=items.length-kept.length;
   result.validationJournal=journal;return result;
  }catch(error){error.candidate=journal;throw error;}
 }};
}

