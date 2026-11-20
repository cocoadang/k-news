import {publicSummaryLibrary} from './library.mjs';
import {telegramOutbox} from './telegramDigest.mjs';
import {PUBLIC_CHANNEL_ID} from './publicChannel.mjs';

// Explicit admin request only. Reuse published text; never acquire captions or run a model.
export async function sendStoredChannelTest({store,telegram,videoId,clock=Date.now}) {
  if(!/^[A-Za-z0-9_-]{11}$/.test(videoId||''))return {status:'invalid_video'};
  return store.exclusive(async(state,save)=>{
    const video=publicSummaryLibrary(state).videos.find(v=>v.id===videoId);
    if(!video?.summary)return {status:'summary_not_ready'};
    const record=state.videos[videoId];
    if(record.recipient===PUBLIC_CHANNEL_ID&&record.telegramParts?.some(part=>part.status!=='pending'))return {status:record.telegramParts.every(part=>part.status==='sent')?'already_sent':'review_required'};
    if(record.channelTest)return {status:record.channelTest.status==='sent'?'already_sent':'review_required'};
    let parts;try{parts=telegramOutbox(video.summary,video,record.summaryCandidate?.telegramDigest);}catch{return {status:'summary_not_ready'};}
    const outbox={recipient:PUBLIC_CHANNEL_ID,createdAt:clock(),status:'inflight',parts};
    record.channelTest=outbox;await save();
    for(const part of outbox.parts){
      part.status='inflight';await save();
      let result;try{result=await telegram.send(PUBLIC_CHANNEL_ID,part.text,{publishedAt:video.publishedAt,plainText:part.plainText});}catch{result={status:'unknown'};}
      if(result.status==='sent'&&result.messageId){part.status='sent';part.messageId=String(result.messageId);await save();}
      else{part.status=result.status==='rejected'?'rejected':'unknown';outbox.status='review_required';await save();return {status:'review_required'};}
    }
    outbox.status='sent';await save();return {status:'sent',parts:outbox.parts.length};
  });
}
