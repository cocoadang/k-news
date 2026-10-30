const ORIGIN='https://api.supadata.ai/v1/';
export function createSupadataProvider({apiKey,organizationId,approved=false,fetcher=fetch}){
  async function get(path,query){
    if(!approved||!apiKey||!organizationId)throw Error('supadata_not_configured');
    const url=new URL(path,ORIGIN);if(query)url.search=new URLSearchParams(query);
    let r;try{r=await fetcher(url.toString(),{method:'GET',redirect:'error',headers:{'x-api-key':apiKey},signal:AbortSignal.timeout(60000)});}catch{throw Error('supadata_transport_uncertain');}
    if(r.status!==200)return {status:r.status};
    const text=await r.text();if(text.length>2000000)throw Error('supadata_response_too_large');
    return {status:200,data:JSON.parse(text)};
  }
  return {
    async balance(){
      const r=await get('me'),b=r.data;
      if(r.status!==200||b?.organizationId!==organizationId||!['free','free (100/mo)'].includes(b.plan?.trim().toLowerCase())||
         b.maxCredits!==100||!Number.isSafeInteger(b.usedCredits)||b.usedCredits<0||b.usedCredits>100)throw Error('supadata_free_balance_unverified');
      return {organizationId,maximum:100,remaining:100-b.usedCredits,used:b.usedCredits};
    },
    async get(videoId,{lang='ko'}={}){
      if(!/^[A-Za-z0-9_-]{11}$/.test(videoId))throw Error('supadata_video_id');
      if(!['ko','en'].includes(lang))throw Error('supadata_lang');
      const r=await get('transcript',{url:`https://www.youtube.com/watch?v=${videoId}`,mode:'native',lang,text:'false'});
      if(r.status!==200)return {status:r.status===202?'pending':'unavailable',httpStatus:r.status};
      const b=r.data;if(!String(b?.lang||'').toLowerCase().startsWith(lang)||!Array.isArray(b.content)||!b.content.length||b.content.length>20000)throw Error('supadata_korean_required');
      let last=-1;const segments=b.content.map(s=>{
        if(!Number.isFinite(s.offset)||s.offset<last||s.offset<0||!Number.isFinite(s.duration)||s.duration<0||
          (s.lang!==undefined&&!String(s.lang).toLowerCase().startsWith(lang))||typeof s.text!=='string'||!s.text.trim())throw Error('supadata_segment_invalid');
        last=s.offset;return {start:s.offset/1000,text:s.text};
      });return {status:'ok',segments};
    }
  };
}

// Must run under the runtime's durable Firestore ownership lock before the request.
// Billing-cycle dates are explicit verified settings; expiry holds instead of assuming a reset.
export function reserveSupadata(state,balance,now,c){
  if(balance?.organizationId!==c.supadataOrganizationId||balance.maximum!==100||!Number.isSafeInteger(balance.remaining)||balance.remaining<0||balance.remaining>100||
    !Number.isFinite(c.supadataCycleStart)||!Number.isFinite(c.supadataCycleEnd)||now<c.supadataCycleStart||now>=c.supadataCycleEnd||
    !Number.isSafeInteger(c.supadataCycleLimit)||c.supadataCycleLimit<1||c.supadataCycleLimit>98||
    !Number.isSafeInteger(c.supadataDailyLimit)||c.supadataDailyLimit<1||c.supadataDailyLimit>c.supadataCycleLimit)throw Error('supadata_free_budget_unverified');
  const cycle=String(c.supadataCycleStart),day=new Date(now+9*3600000).toISOString().slice(0,10);
  state.supadata ||= {cycle,end:c.supadataCycleEnd,used:0,shadowRemaining:balance.remaining,days:{}};
  if(state.supadata.cycle!==cycle){if(state.supadata.end>now)throw Error('supadata_cycle_changed_early');state.supadata={cycle,end:c.supadataCycleEnd,used:0,shadowRemaining:balance.remaining,days:{}};}
  const budget=state.supadata;budget.shadowRemaining=Math.min(budget.shadowRemaining,balance.remaining);
  if(budget.used+1>c.supadataCycleLimit||(budget.days[day]||0)+1>c.supadataDailyLimit||budget.shadowRemaining<1)return false;
  budget.used++;budget.days[day]=(budget.days[day]||0)+1;budget.shadowRemaining--;return true;
}

// Undo one reservation when the provider balance proves the failed request was not charged.
export function refundSupadata(state,now){
  const b=state.supadata;if(!b)return;const day=new Date(now+9*3600000).toISOString().slice(0,10);
  if(b.used>0)b.used--;if((b.days?.[day]||0)>0)b.days[day]--;b.shadowRemaining++;
}
