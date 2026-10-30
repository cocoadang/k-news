import {telegramHtml} from './telegramFormat.mjs';
import { CHANNEL } from './core.mjs';
function required(approved) { if (approved !== true) throw Error('live_access_not_enabled'); }
export function parseVidiqTranscript(data) {
  if (!data || typeof data.transcription !== 'string') throw Error('invalid_vidiq_response');
  const lines=data.transcription.split(/\r?\n/).filter(x=>x.trim());
  return lines.map(line=>{
    const m=line.match(/^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s*(.+)$/u);
    if (!m || Number(m[3])>=60 || (m[1] && Number(m[2])>=60)) throw Error('invalid_caption_timestamp');
    return { start:Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3]),text:m[4] };
  });
}
// Authenticated MCP client must be provided by the host; ChatGPT auth is never reused.
// typedError maps provider-documented retryable errors, never guesses from arbitrary text.
export function vidiqCaptions({ callTool, typedError=()=>({status:'unavailable'}), approved=false }) {
  return { async get(videoId) {
    required(approved);
    const r=await callTool('vidiq_video_transcript',{videoId,language:'ko'});
    if (r.isError) return typedError(r);
    const data=r.structuredContent;
    if (data?.videoId !== videoId || (data.language && !/^ko(?:-|$)/i.test(data.language))) throw Error('caption_identity_mismatch');
    return {status:'ok',segments:parseVidiqTranscript(data)};
  }};
}
export function youtubeDiscovery({ apiKey, approved=false, fetcher=fetch,allowedChannels=[CHANNEL] }) {
  async function get(resource,params) {
    required(approved);
    const url=new URL('https://www.googleapis.com/youtube/v3/'+resource);
    Object.entries({...params,key:apiKey}).forEach(([k,v])=>url.searchParams.set(k,String(v)));
    const r=await fetcher(url,{signal:AbortSignal.timeout(20000)});
    if(!r.ok) throw Error('youtube_request_failed');
    return r.json();
  }
  return { async list(channelId) {
    if(!allowedChannels.includes(channelId)) throw Error('unapproved_channel');
    const channel=await get('channels',{part:'contentDetails',id:channelId});
    const playlist=channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if(!playlist) throw Error('uploads_playlist_missing');
    const ids=[]; let pageToken='';
    // Bounded catch-up: 150 uploads; no historical backfill outside activation cutoff.
    for(let i=0;i<3;i++) {
      const page=await get('playlistItems',{part:'contentDetails',playlistId:playlist,maxResults:50,...(pageToken?{pageToken}:{})});
      ids.push(...(page.items||[]).map(x=>x.contentDetails.videoId));
      pageToken=page.nextPageToken;
      if(!pageToken) break;
    }
    const videos=[];
    for(let i=0;i<ids.length;i+=50) {
      const r=await get('videos',{part:'snippet,contentDetails,liveStreamingDetails,status',id:ids.slice(i,i+50).join(',')});
      for(const x of r.items||[]) {
        const d=x.contentDetails.duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
        const durationSeconds=d ? Number(d[1]||0)*3600+Number(d[2]||0)*60+Number(d[3]||0) : NaN;
        videos.push({id:x.id,channelId:x.snippet.channelId,title:x.snippet.title,description:x.snippet.description,visibility:x.status?.privacyStatus,
          publishedAt:Date.parse(x.snippet.publishedAt),durationSeconds,isShort:durationSeconds<=180,
          isRebroadcast:/재방송|다시\s*보기|rebroadcast|replay/iu.test(x.snippet.title),
          status:x.snippet.liveBroadcastContent==='none' ? 'completed' : x.snippet.liveBroadcastContent });
      }
    }
    videos.coverageComplete=!pageToken;
    return videos;
  }};
}
export function telegramTransport({token,approved=false,fetcher=fetch}) {
  return {async send(chatId,text,meta={}) {
    required(approved);
    if(!token || !chatId || text.length>3500) throw Error('invalid_telegram_request');
    try {
      const post=body=>fetcher(`https://api.telegram.org/bot${token}/sendMessage`,{
        method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20000),
        body:JSON.stringify({chat_id:chatId,link_preview_options:{is_disabled:true},...body})});
      let r=await post({text:telegramHtml(text,meta),parse_mode:'HTML'});
      let data=await r.json();
      // A 400 means Telegram rejected the formatted message (nothing was sent); retry once as plain text.
      if(r.status===400&&data.ok===false){r=await post({text});data=await r.json();}
      if(r.ok && data.ok && data.result?.message_id) return {status:'sent',messageId:String(data.result.message_id)};
      if(r.status===429 && data.ok===false) return {status:'rate_limited',definitelyNotSent:true,retryAfterMs:Math.max(60,Number(data.parameters?.retry_after)||60)*1000};
      if(r.status>=400 && r.status<500 && data.ok===false) return {status:'rejected'};
      return {status:'unknown'};
    } catch {return {status:'unknown'};} // Never log a URL containing the bot token.
  }};
}
