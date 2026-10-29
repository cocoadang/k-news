import {createHash} from 'node:crypto';
import {PROGRAMMES,TRIAL_IDS,matchProgrammes} from './programmes.mjs';
import {splitMessage} from './core.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
// Uses the existing durable exclusive/save contract; never creates a transport.
export function createFreeRuntime({store,discovery,provider,config,clock=Date.now}) {
  return {status:()=>({status:config.enabled?'free_review_only':'disabled',deliveryEnabled:false,intervalMs:600000}),
    async run() {
      if(!config.enabled)return {status:'disabled'};
      if(config.mode!=='gemini_youtube_free'||config.paidFallback!==false||!Number.isFinite(config.activatedAt)) throw Error('free_configuration_required');
      if(!discovery||!provider)throw Error('free_providers_unavailable');
      return store.exclusive(async(state,save)=>{
        const now=clock();state.free ||= {events:[],coverage:{},digests:{}};
        // Recover before cadence check: an interrupted request is never auto-replayed.
        for(const r of Object.values(state.videos))if(r.stage==='video_inflight')r.stage='review_required';
        if(state.free.lastCollectionAt && now-state.free.lastCollectionAt<600000){await save();return {status:'throttled'};}
        for(const channelId of [...new Set(PROGRAMMES.map(p=>p.channelId))]) {
          try {
            const batch=await discovery.list(channelId);
            for(const v of batch) {
              const programmes=matchProgrammes(v,{activatedAt:config.activatedAt,now,maxAgeMs:config.maxAgeMs});
              if(!programmes.length)continue;
              if(!state.videos[v.id])state.videos[v.id]={video:v,programmes,stage:'video_pending',firstSeen:now};
            }
            // A 15-item RSS response cannot claim completeness. Source must explicitly report it.
            state.free.coverage[channelId]={checkedAt:now,complete:batch.coverageComplete===true,
              ...(batch.coverageComplete===true?{watermark:now}:{gap:'catch_up_required'})};
          } catch {state.free.coverage[channelId]={checkedAt:now,complete:false,gap:'collection_failed'};}
        }
        state.free.lastCollectionAt=now;await save();
        for(const r of Object.values(state.videos)) {
          if(r.stage!=='video_pending'||!TRIAL_IDS.includes(r.video.id))continue;
          if(state.free.quotaReview){r.hold='usage_requires_review';continue;}
          let limits,e;try {limits=provider.preflight(r.video,now);e=provider.evidence();}
          catch {r.hold='free_readiness_or_quota';continue;}
          // Rolling 24h is conservative at provider reset boundaries. Never refund uncertainty.
          const recent=state.free.events.filter(x=>now-x.at<86400000);
          const snapshot=state.free.events.filter(x=>x.at>=e.checkedAt);
          const sum=(xs,k)=>xs.reduce((n,x)=>n+x[k],0);
          if(state.free.events.some(x=>x.id===r.video.id)||state.free.events.length>=3||
            snapshot.length>=e.remainingRequests||sum(snapshot,'seconds')+limits.seconds>e.remainingVideoSeconds||
            sum(recent,'seconds')+limits.seconds>28800||sum(snapshot,'estimatedInput')+limits.estimatedInput>e.remainingInputTokens||
            sum(recent.filter(x=>now-x.at<60000),'estimatedInput')+limits.estimatedInput>e.remainingMinuteTokens) {r.hold='free_quota';continue;}
          // Conservatively one request per minute, even if the account permits more.
          if(state.free.events.some(x=>now-x.at<60000)){r.hold='request_spacing';continue;}
          r.stage='video_inflight';delete r.hold;
          state.free.events.push({id:r.video.id,at:now,...limits});await save();
          try {const result=await provider.summarize(r.video,now);r.videoSummary=result;r.stage='video_review';
            if(result.usage.total_input_tokens>limits.estimatedInput || result.usage.total_output_tokens+result.usage.total_thought_tokens>limits.output || result.usage.total_tool_use_tokens>0)state.free.quotaReview=true;
          }
          catch {r.stage='review_required';}
          await save();
        }
        await save();return {status:'review_only',stages:Object.fromEntries(Object.entries(state.videos).map(([id,r])=>[id,r.stage])),coverage:state.free.coverage};
      });
    },
    // Explicit review artifact, not a schedule or a send operation. Immutable on repeat.
    async freezeDigest({recipient,cutoff,startAt,edition='review'}) {
      if(typeof recipient!=='string'||!recipient||!Number.isFinite(cutoff)||!Number.isFinite(startAt)||startAt>=cutoff||cutoff>clock()||edition!=='review')throw Error('invalid_digest');
      return store.exclusive(async(state,save)=>{
        state.free ||= {events:[],coverage:{},digests:{}};
        const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(cutoff);
        const key=hash(JSON.stringify([recipient,date,startAt,cutoff,edition]));
        if(state.free.digests[key])return state.free.digests[key];
        const rows=Object.values(state.videos).filter(r=>r.programmes&&r.video.publishedAt>=startAt&&r.video.publishedAt<cutoff).sort((a,b)=>a.video.publishedAt-b.video.publishedAt||a.video.id.localeCompare(b.video.id));
        const text=[`종합요약 검토본 · ${date} (한국시간)`, '자동 발송 안 됨 · 독립 자막 검증 미실시'];
        for(const p of PROGRAMMES) {
          text.push('',p.name);const matches=rows.filter(r=>r.programmes.includes(p.id));
          if(!matches.length)text.push('수집된 적격 영상 없음 — 업로드 없음으로 단정하지 않음');
          for(const r of matches)text.push(r.stage==='video_review'?r.videoSummary.rendered:`${r.video.title}: 요약 대기/검토 필요 (${r.stage})`);
        }
        text.push('','공통·상이한 전망: 추가 모델 호출 없이 자동 합의/상충 판정하지 않음. 영상별 근거 대조 필요.');
        if(Object.values(state.free.coverage).some(c=>!c.complete)||Object.keys(state.free.coverage).length<2)text.push('수집 범위 누락 가능 — 재수집 확인 필요');
        const digest={key,date,recipient,startAt,cutoff,edition,videoIds:rows.map(r=>r.video.id),status:'review_only',
          parts:splitMessage(text.join('\n')).map(text=>({text,hash:hash(text),status:'pending'}))};
        state.free.digests[key]=digest;await save();return digest;
      });
    }
  };
}
