import {randomUUID} from 'node:crypto';
import type {NewsEvent} from './types';

const SAFE = new Set(['screening_missing_results','screening_invalid_results','invalid_json_response','AI_RESPONSE_INCOMPLETE','AI_RESPONSE_EMPTY','AI_HTTP_429']);
export function analysisFailureCode(error: unknown): string {
  const e=error as {message?:string;failureCode?:string};
  if(e?.failureCode && SAFE.has(e.failureCode))return e.failureCode;
  if(error instanceof SyntaxError)return 'invalid_json_response';
  const message=String(e?.message||'');
  for(const code of [...SAFE,'AI_TIMEOUT','AI_NETWORK_ERROR','AI_USAGE_MISSING'])if(message.includes(code))return code;
  return 'review_required';
}
export function mayResumeAnalysis(e:NewsEvent):boolean {
  if(e.analysisAutoRetry?.status==='inflight'||e.analysisAutoRetry?.status==='review_required')return false;
  if(e.analysisStatus!=='failed')return true;
  return !e.analysisAutoRetry && SAFE.has(e.analysisFailureCode||'');
}
type Commit=(expected:NewsEvent,patch:Partial<NewsEvent>)=>Promise<NewsEvent|null>;
/** The optimistic transaction must persist this unique claim before any retry call. */
export async function claimAnalysisRetry(e:NewsEvent,phase:'screen'|'detail',commit:Commit,at:string):Promise<NewsEvent|null> {
  const continuation=e.analysisAutoRetry?.status==='ready' && phase==='detail';
  if(!continuation && !(e.analysisStatus==='failed' && mayResumeAnalysis(e)))return null;
  const token=randomUUID();
  const claim:NonNullable<NewsEvent['analysisAutoRetry']>={attempts:1,status:'inflight',phase,token,at};
  const saved=await commit(e,{analysisAutoRetry:claim});
  return saved?.analysisAutoRetry?.token===token?saved:null;
}
export function retryResult(e:NewsEvent,status:'ready'|'recovered'|'review_required'):Partial<NewsEvent> {
  return e.analysisAutoRetry?{analysisAutoRetry:{...e.analysisAutoRetry,status}}:{};
}
