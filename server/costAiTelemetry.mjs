// Fixed scopes/outcomes only: never include prompts, URLs, article IDs or responses.
export function aiCacheMetric(scope,outcome,count=1){try{console.log('[COST_AI_CACHE_V1]',JSON.stringify({v:1,scope,outcome,count}));}catch{}}
export function aiUsageMetric(scope,usage,status='completed',model='gpt-6-luna'){
 const n=v=>Number.isSafeInteger(v)&&v>=0?v:0;
 try{console.log('[COST_AI_USAGE_V1]',JSON.stringify({v:1,scope,provider:'openai',model:/^[a-z0-9._-]{1,80}$/i.test(model)?model:'other',status:status==='completed'?'completed':'other',usagePresent:Number.isSafeInteger(usage?.input_tokens)&&Number.isSafeInteger(usage?.output_tokens),inputTokens:n(usage?.input_tokens),outputTokens:n(usage?.output_tokens),cachedInputTokens:n(usage?.input_tokens_details?.cached_tokens),cacheWriteTokens:n(usage?.input_tokens_details?.cache_write_tokens)}));}catch{}
}

export function aiAttemptMetric(scope){try{console.log('[COST_AI_ATTEMPT_V1]',JSON.stringify({v:1,scope,count:1}));}catch{}}
