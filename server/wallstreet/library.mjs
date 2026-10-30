import {PROGRAMMES} from './programmes.mjs';
// Programmes the user removed from the site; their past summaries are hidden from the public screen.
export const HIDDEN_PROGRAMMES=Object.freeze(['crypto']);
// Public publication is independent of worker state, receipts and cost accounting.
export function publicSummaryLibrary(state) {
  return {videos:Object.values(state.videos||{}).flatMap(r=>{
    const id=r.video?.id,p=r.publication;
    if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))return [];
    const manual=p?.reviewStatus==='approved' && ['transcript_review','supervised_trial'].includes(p.source) && typeof p.summary==='string' && p.summary.trim();
    const automatic=['sent','text_delivery'].includes(r.stage) && Array.isArray(r.parts) && r.parts.length>0 && r.parts.every(x=>typeof x.text==='string' && x.text.trim());
    if(!manual&&!automatic)return [];
    const programmes=(r.programmes||[]).filter(x=>PROGRAMMES.some(p=>p.id===x)&&!HIDDEN_PROGRAMMES.includes(x));
    if((r.programmes||[]).some(x=>HIDDEN_PROGRAMMES.includes(x))&&!programmes.length)return [];
    return [{id,title:typeof r.video.title==='string'?r.video.title:'영상 제목 미확인',publishedAt:Number.isFinite(r.video.publishedAt)?r.video.publishedAt:null,
      programmes,status:'ready',source:manual?p.source:'automatic',url:`https://www.youtube.com/watch?v=${id}`,
      summary:manual?p.summary:r.parts.map(x=>x.text).join('\n')}];
  }).sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0))};
}
// Explicit view model: never serialize transcripts, candidates, logs or recipients.
export function summaryLibrary(state) {
  return {videos:Object.values(state.videos||{}).flatMap(r=>{
    const id=r.video?.id;
    if(!/^[A-Za-z0-9_-]{11}$/.test(id||''))return [];
    const complete=['sent','text_delivery'].includes(r.stage) && Array.isArray(r.parts) && r.parts.length>0 && r.parts.every(p=>typeof p.text==='string');
    const status=complete?'ready':r.stage==='text_review_required'?'review_required':/expired|failed|unavailable/.test(r.stage||'')?'unavailable':/inflight/.test(r.stage||'')?'processing':'not_generated';
    return [{id,title:typeof r.video.title==='string'?r.video.title:'제목 정보 없음',publishedAt:Number.isFinite(r.video.publishedAt)?r.video.publishedAt:null,
      programmes:(r.programmes||[]).filter(p=>PROGRAMMES.some(x=>x.id===p)),status,source:complete?'automatic':'none',url:`https://www.youtube.com/watch?v=${id}`,
      summary:complete?r.parts.map(p=>p.text).join('\n'):null}];
  }).sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0))};
}
