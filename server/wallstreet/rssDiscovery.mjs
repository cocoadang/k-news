import {PROGRAMMES} from './programmes.mjs';
import {discoveryError} from './discoveryError.mjs';
const channels=[...new Set(PROGRAMMES.map(p=>p.channelId))];
export function publicVideoMetadata(html,id,now=Date.now()) {
  const nodes=[];
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {const x=JSON.parse(m[1]);nodes.push(...(Array.isArray(x)?x:[x]),...(x['@graph']||[]));}catch{}
  }
  const x=nodes.find(x=>x['@type']==='VideoObject' && [x.url,x.embedUrl,x.contentUrl].some(u=>typeof u==='string'&&new RegExp(`(?:v=|embed/)${id}(?:[?&#/]|$)`).test(u)));
  if(!x)throw Error('public_metadata_unavailable');
  const d=x.duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  const durationSeconds=d?Number(d[1]||0)*3600+Number(d[2]||0)*60+Number(d[3]||0):NaN;
  if(!Number.isFinite(durationSeconds)||durationSeconds<=0)throw Error('public_duration_unavailable');
  const broadcasts=(Array.isArray(x.publication)?x.publication:[x.publication]).filter(Boolean);
  if(broadcasts.some(b=>Date.parse(b.startDate)>now || (b.isLiveBroadcast===true&&(!Number.isFinite(Date.parse(b.endDate))||Date.parse(b.endDate)>now))))throw Error('live_or_scheduled_video');
  return {durationSeconds,isShort:durationSeconds<=180,status:'completed',visibility:'public'};
}
export function rssDiscovery({approved=false,fetcher=fetch,parseFeed,clock=Date.now}={}) {
  async function read(url){
    let r;try{r=await fetcher(url,{signal:AbortSignal.timeout(20000)});}catch(e){throw discoveryError(e?.name==='TimeoutError'?'timeout':'network');}
    if(!r.ok)throw discoveryError('http',r);
    let s;try{s=await r.text();}catch{throw discoveryError('body_read',r);}
    if(s.length>6000000)throw discoveryError('document_too_large',r);return {xml:s,response:r};
  }
  return {async list(channelId){
    if(!approved)throw Error('live_access_not_enabled');if(!channels.includes(channelId))throw Error('unapproved_channel');
    const {xml,response}=await read(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    let parse=parseFeed;
    if(!parse){let Parser;try{Parser=(await import('rss-parser')).default;}catch{throw discoveryError('dependency',response);}
      parse=xml=>new Parser({customFields:{item:['yt:videoId','yt:channelId',['media:group','mediaGroup']]}}).parseString(xml);}
    let feed;try{feed=await parse(xml);}catch{throw discoveryError('parse',response);}
    if(!feed||!Array.isArray(feed.items))throw discoveryError('feed_shape',response);
    const videos=[],held=[];
    const items=(feed.items||[]).slice(0,15);
    for(const item of items){
      const id=item['yt:videoId'];if(!/^[\w-]{11}$/.test(id||'')||item['yt:channelId']!==channelId)continue;
      const title=item.title||'',description=item.mediaGroup?.['media:description']?.[0]||item.content||'';
      if(!PROGRAMMES.some(p=>p.channelId===channelId&&p.pattern.test(title)))continue;
      if(/쇼츠|shorts|재방송|다시\s*보기|하이라이트|몰아보기|클립|rebroadcast|replay/iu.test(title))continue;
      if(/\blive\b|라이브|생방송|방송\s*예정|공개\s*예정/iu.test(title)){held.push({id,reason:'live_or_scheduled_title'});continue;}
      videos.push({id,channelId,title,description,publishedAt:Date.parse(item.isoDate||item.pubDate),isRebroadcast:false,visibility:'public',discoveryMethod:'official_rss',status:'awaiting_native_captions',isShort:null,durationSeconds:null});
    }
    // RSS is a recent window, never a proof that every upload since the last run was seen.
    const dates=items.map(x=>Date.parse(x.isoDate||x.pubDate)).filter(Number.isFinite);
    videos.coverageComplete=false;videos.coverage={method:'official_rss',recentWindow:15,oldestPublishedAt:dates.length?Math.min(...dates):null,held};return videos;
  }};
}
