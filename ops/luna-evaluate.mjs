// Read-only production snapshot; evaluation never changes stored summaries or sends messages.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,open,unlink,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createLunaClient,lunaUsageCost,LUNA_CACHE_WRITE_RATE,LUNA_OUTPUT_RATE} from '../server/wallstreet/lunaClient.mjs';
import {lunaSummarizer} from '../server/wallstreet/lunaSummary.mjs';

const project='gen-lang-client-0064554427';
const database='ai-studio-spacexintelligen-5ece8bd2-4283-450c-8ff7-bbc38569174d';
const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents`;
const run=process.argv.includes('--run');
const saved=process.argv.includes('--saved');
const folder=resolve(process.env.LUNA_EVAL_DIR||'/tmp/knews-luna-evaluation');
await mkdir(folder,{recursive:true,mode:0o700});
let state;
if(saved){
 const reports=await Promise.all((await readdir(folder)).filter(f=>f.endsWith('-report.json')).map(async f=>JSON.parse(await readFile(resolve(folder,f),'utf8'))));
 state={videos:Object.fromEntries(reports.map(r=>[r.id,{video:{id:r.id,title:r.title},transcript:r.transcript,summaryCandidate:r.previous}]))};
}else{
const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8'}).trim();
async function rest(url,options={}){
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
 if(!response.ok)throw Error(`firestore_http_${response.status}`);
 return response.json();
}
const {transaction}=await rest(root+':beginTransaction',{method:'POST',body:JSON.stringify({options:{readOnly:{}}})});
try{
 const doc=async name=>(await rest(root+'/wallstreet_newsletter_v1/'+name+'?transaction='+encodeURIComponent(transaction))).fields;
 const head=await doc('head');
 const count=Number(head.count.integerValue),revision=head.revision.integerValue;
 if(!Number.isInteger(count)||count<1||count>24)throw Error('invalid_state_head');
 const parts=[];
 for(let i=0;i<count;i++){
  const chunk=await doc('state-'+String(i).padStart(3,'0'));
  if(chunk.revision.integerValue!==revision||Number(chunk.index.integerValue)!==i)throw Error('state_revision_mismatch');
  parts.push(chunk.base64.stringValue);
 }
 const text=Buffer.from(parts.join(''),'base64').toString('utf8');
 if(createHash('sha256').update(text).digest('hex')!==head.hash.stringValue)throw Error('state_hash_mismatch');
 state=JSON.parse(text);
}finally{await rest(root+':rollback',{method:'POST',body:JSON.stringify({transaction})}).catch(()=>{});}
}
const timestamp=r=>typeof r.video.publishedAt==='string'?Date.parse(r.video.publishedAt):Number(r.video.publishedAt||r.firstSeen||0);
const available=Object.values(state.videos).filter(r=>Array.isArray(r.transcript)&&r.transcript.length&&r.video?.id)
 .sort((a,b)=>timestamp(b)-timestamp(a));
const chosen=saved?available.slice(0,3):[];
for(const predicate of saved?[]:[r=>r.programmes?.includes('wallstreet'),r=>!r.programmes?.includes('wallstreet'),()=>true]){
 const row=available.find(r=>!chosen.includes(r)&&predicate(r));if(row)chosen.push(row);
}
console.log(JSON.stringify({mode:run?'run':'list',selected:chosen.map(r=>({id:r.video.id,title:r.video.title,segments:r.transcript.length,minutes:Math.round(r.transcript.at(-1).start/60)}))}));
if(!run)process.exit(0);
if(chosen.length!==3)throw Error('three_saved_broadcasts_required');
if(process.env.LUNA_EVAL_APPROVED!=='0.15')throw Error('explicit_015_usd_approval_required');
const apiKey=execFileSync('gcloud',['secrets','versions','access','latest','--secret=knews-openai-api-key','--project='+project],{encoding:'utf8'}).trim();
const lockPath=resolve(folder,'evaluation.lock');
const lock=await open(lockPath,'wx',0o600);
try{
const ledgerPath=resolve(folder,'evaluation-budget.json');
let ledger;try{ledger=JSON.parse(await readFile(ledgerPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;ledger={limitMicros:150000,calls:{}};}
if(ledger.limitMicros!==150000)throw Error('evaluation_budget_mismatch');
// Import prior checkpoint reservations conservatively, including completed calls.
for(const row of chosen){
 let cp;try{cp=JSON.parse(await readFile(resolve(folder,row.video.id+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;continue;}
 for(const [key,entry] of Object.entries(cp.entries||{}))ledger.calls[key]??={charge:entry.ceiling,status:'previous_ceiling'};
}
const saveLedger=()=>writeFile(ledgerPath,JSON.stringify(ledger),{mode:0o600});
await saveLedger();
const client=createLunaClient({apiKey});
const originalGenerate=client.generate;
client.generate=async args=>{
 const key=createHash('sha256').update(JSON.stringify(args)).digest('hex');
 if(ledger.calls[key])throw Error('evaluation_call_already_reserved');
 const ceiling=Math.ceil(client.estimateInputTokens(args)*LUNA_CACHE_WRITE_RATE+args.maxOutputTokens*LUNA_OUTPUT_RATE);
 if(Object.values(ledger.calls).reduce((n,c)=>n+c.charge,0)+ceiling>ledger.limitMicros)throw Error('evaluation_total_budget');
 ledger.calls[key]={charge:ceiling,status:'inflight'};await saveLedger();
 try{
  const result=await originalGenerate(args),cost=lunaUsageCost(result.usage);
  if(cost!==null){ledger.calls[key]={charge:cost,status:'completed',usage:result.usage};await saveLedger();}
  return result;
 }catch(e){const cost=lunaUsageCost(e.usage);if(cost!==null){ledger.calls[key]={charge:cost,status:'completed',usage:e.usage};await saveLedger();}throw e;}
};
const summarizer=lunaSummarizer({client,approved:true});
for(const row of chosen){
 const path=resolve(folder,row.video.id+'.json');
 let checkpoint={};try{checkpoint=JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 // Independent $0.05/video ceiling, three videos at most. Existing uncertain calls are not repeated.
 let result,error;
 try{result=await summarizer.summarize({video:row.video,segments:row.transcript,maxCostMicros:row.transcript.at(-1).start>1800?50000:30000,checkpoint,
  saveCheckpoint:()=>writeFile(path,JSON.stringify(checkpoint),{mode:0o600})});}catch(e){error={reason:e.message,journal:e.candidate};}
 const report={id:row.video.id,title:row.video.title,result,error,previous:row.summaryCandidate,transcript:row.transcript};
 await writeFile(resolve(folder,row.video.id+'-report.json'),JSON.stringify(report),{mode:0o600});
 const journal=result?.validationJournal||error?.journal;
 console.log(JSON.stringify({id:row.video.id,status:error?'held':'passed',reason:error?.reason,items:result?.items?.length,journal,report:resolve(folder,row.video.id+'-report.json')}));
}
console.log(JSON.stringify({evaluationBudgetMicros:Object.values(ledger.calls).reduce((n,c)=>n+c.charge,0),limitMicros:ledger.limitMicros}));
}finally{await lock.close();await unlink(lockPath);}
