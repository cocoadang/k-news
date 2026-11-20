import {splitMessage} from './core.mjs';
import {kstDate} from './telegramFormat.mjs';

const TELEGRAM_MESSAGE_LIMIT=4096;

export function telegramDigest(text,video,summary){
  if(!/^[\w-]{11}$/.test(video?.id||''))throw Error('digest_video_required');
  const items=[];let title='',current;
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();
    if(line.startsWith('▌')){title=line.slice(1).trim();continue;}
    const match=line.match(/^•\s*(\[[^\]]+\])?\s*(.+)$/u);
    if(match){current={title,text:match[2],label:match[1]||'',links:[]};items.push(current);title='';continue;}
    if(current&&/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}&t=\d+s$/.test(line))current.links.push(line);
    else if(current&&line&&!/^\[\d+\/\d+\]$/.test(line))current.text+='\n'+line;
  }
  const verified=summary?.verified===true&&Array.isArray(summary.items)&&summary.items.length>0;
  if(verified)items.splice(0,items.length,...summary.items.map(item=>({title:item.title,text:item.text,label:item.kind==='outlook'?'[출연자의 해석·전망]':'[방송에서 소개한 내용]',links:item.starts.map(start=>`https://www.youtube.com/watch?v=${video.id}&t=${Math.floor(start)}s`)})));
  const unique=[];
  for(const item of items){
    const existing=unique.find(x=>x.label===item.label&&x.text.replace(/\s+/g,'')===item.text.replace(/\s+/g,''));
    if(existing)existing.links=[...new Set([...existing.links,...item.links])];else unique.push({...item});
  }
  const detail=`https://news.dsoom.com/?video=${video.id}`;
  const day=kstDate(video.publishedAt);
  const header=['📺 '+video.title,day&&'🗓 '+day+' 방송',`https://www.youtube.com/watch?v=${video.id}`].filter(Boolean).join('\n');
  const issues=unique.length?unique.map((item,index)=>[
    `${index+1}. ${item.title||'방송 이슈'}`,
    [item.label,item.text].filter(Boolean).join(' '),
    ...item.links,
  ].join('\n')):[String(text).replace(/^\[\d+\/\d+\]\r?\n/gmu,'').trim()];
  const blocks=[header,...issues,detail].filter(Boolean);
  const body=blocks.join('\n\n');
  if(body.length<=TELEGRAM_MESSAGE_LIMIT)return {parts:[body],itemCount:unique.length||null};
  const limit=TELEGRAM_MESSAGE_LIMIT-32;
  if(!unique.length)return {parts:splitMessage(body,limit),itemCount:null};
  const chunks=[];
  let chunkText='';
  for(const block of blocks){
    if(chunkText&&chunkText.length+2+block.length>limit){
      chunks.push(chunkText);
      chunkText='';
    }
    if(block.length>limit){
      // Reuse the line- and Unicode-aware splitter for an oversized issue.
      chunks.push(...splitMessage(block,limit).map(part=>part.slice(part.indexOf('\n')+1)));
    }else{
      chunkText=chunkText?chunkText+'\n\n'+block:block;
    }
  }
  if(chunkText)chunks.push(chunkText);
  const parts=chunks.map((chunk,index)=>`[${index+1}/${chunks.length}]\n${chunk}`);
  return {parts,itemCount:unique.length||null};
}

export function telegramOutbox(text,video,summary){
  return telegramDigest(text,video,summary).parts.map(text=>({text,plainText:true,status:'pending'}));
}
