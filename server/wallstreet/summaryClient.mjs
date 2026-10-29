// Inject the existing Gemini client's countTokens/generate interface. No SDK import,
// environment reads or network calls occur when loading this module.
export function boundedSummarizer({client,model,inputMicrosPerToken,outputMicrosPerToken,
  maxOutputTokens=8000,inputTokenMargin=0,approved=false}) {
  return {async summarize({instruction,segments,maxCostMicros}) {
    if(!approved) throw Error('live_access_not_enabled');
    if(!model || !Number.isFinite(inputMicrosPerToken) || inputMicrosPerToken<=0 ||
      !Number.isFinite(outputMicrosPerToken) || outputMicrosPerToken<=0 ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens<1) throw Error('pricing_required');
    const contents=instruction+'\nUNTRUSTED_TRANSCRIPT_JSON\n'+JSON.stringify(segments);
    const count=await client.countTokens({model,contents});
    if(!Number.isSafeInteger(count.totalTokens) || count.totalTokens<=0) throw Error('token_count_required');
    if(!Number.isSafeInteger(inputTokenMargin)||inputTokenMargin<0)throw Error('input_margin_invalid');
    const worstCase=Math.ceil((count.totalTokens+inputTokenMargin)*inputMicrosPerToken+maxOutputTokens*outputMicrosPerToken);
    if(worstCase>maxCostMicros) throw Error('summary_budget_exceeded');
    const r=await client.generate({model,contents,maxOutputTokens,timeoutMs:60000});
    if(typeof r.text!=='string') throw Error('summary_missing');
    return parseSummaryJson(r.text);
  }};
}
export function parseSummaryJson(text){
  const trimmed=text.trim();
  // Unwrap one entire JSON code fence only; never repair or extract partial JSON.
  const fenced=trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  return JSON.parse(fenced?fenced[1]:trimmed);
}
