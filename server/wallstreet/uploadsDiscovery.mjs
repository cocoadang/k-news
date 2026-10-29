import {PROGRAMMES} from './programmes.mjs';
// Official metadata only. No captions, content generation, retry or fallback.
export function uploadsDiscovery({apiKey,approved=false,activatedAt,clock=Date.now,fetcher=fetch,maxAgeMs=172800000}={}){
 const channels=[...new Set(PROGRAMMES.map(p=>p.channelId))];
 return {async list(channelId){
  if(!approved||!apiKey||!channels.includes(channelId)||!Number.isFinite(activatedAt))throw Error('uploads_configuration');
  const now=clock(),cutoff=Math.max(activatedAt,now-maxAgeMs);let requests=0;
  async function get(resource,params){
   if(++requests>7)throw Error('uploads_request_cap');
   const url=new URL('https://www.googleapis.com/youtube/v3/'+resource);for(const [k,v]of Object.entries(params))url.searchParams.set(k,String(v));
   let r;try{r=await fetcher(url,{headers:{'X-Goog-Api-Key':apiKey},signal:AbortSignal.timeout(20000)});}catch{throw Error('uploads_network_no_retry');}
   if(!r.ok)throw Error(`uploads_http_${Number(r.status)||0}`);
   const data=await r.json();if(!Array.isArray(data.items)||data.items.length>50)throw Error('uploads_response_shape');return data;
  }
  const ch=await get('channels',{part:'contentDetails',id:channelId});
  const channel=ch.items.find(x=>x.id===channelId),playlist=channel?.contentDetails?.relatedPlaylists?.uploads;
  if(typeof playlist!=='string'||!/^[\w-]{10,100}$/.test(playlist))throw Error('uploads_channel_identity');
  const ids=new Set();let pageToken='',complete=false;const tokens=new Set();
  for(let page=0;page<3;page++){
   const data=await get('playlistItems',{part:'contentDetails',playlistId:playlist,maxResults:50,...(pageToken?{pageToken}:{})});
   let oldCount=0;
   for(const x of data.items){const id=x.contentDetails?.videoId,published=Date.parse(x.contentDetails?.videoPublishedAt);
    if(Number.isFinite(published)&&published<cutoff){oldCount++;continue;}
    if(/^[\w-]{11}$/.test(id||''))ids.add(id);
   }
   pageToken=data.nextPageToken||'';
   if(!pageToken||(data.items.length>0&&oldCount===data.items.length)){complete=true;break;}
   if(typeof pageToken!=='string'||pageToken.length>4096||tokens.has(pageToken))throw Error('uploads_pagination');tokens.add(pageToken);
  }
  const videos=[],all=[...ids],returned=new Set();
  for(let start=0;start<all.length;start+=50){
   const data=await get('videos',{part:'snippet,contentDetails,liveStreamingDetails,status',id:all.slice(start,start+50).join(',')});
   for(const x of data.items){
    if(!ids.has(x.id)||returned.has(x.id)||x.snippet?.channelId!==channelId)continue;
    const publishedAt=Date.parse(x.snippet.publishedAt),d=x.contentDetails?.duration?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
    if(!d||!Number.isFinite(publishedAt)||publishedAt<cutoff||publishedAt>now)continue;
    const durationSeconds=Number(d[1]||0)*3600+Number(d[2]||0)*60+Number(d[3]||0);
    const live=x.liveStreamingDetails;
    if(x.status?.privacyStatus!=='public'||x.snippet.liveBroadcastContent!=='none'||(live?.actualStartTime&&!live.actualEndTime)||Date.parse(live?.scheduledStartTime)>now||durationSeconds<=180)continue;
    const title=x.snippet.title||'',description=x.snippet.description||'';
    if(/쇼츠|shorts|재방송|다시\s*보기|하이라이트|클립|rebroadcast|replay/iu.test(title))continue;
    returned.add(x.id);videos.push({id:x.id,channelId,title,description,publishedAt,durationSeconds,isShort:false,isRebroadcast:false,visibility:'public',status:'completed',discoveryMethod:'youtube_uploads_api'});
   }
  }
  videos.coverageComplete=complete;videos.coverage={method:'youtube_uploads_api',maxPages:3,maxRequests:7,requests,cutoff,complete};return videos;
 }};
}
