import {telegramHtml} from './telegramFormat.mjs';

export function telegramDigest(text,video,summary){
  if(!/^[\w-]{11}$/.test(video?.id||''))throw Error('digest_video_required');
  const items=[];let title='',current;
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();
    if(line.startsWith('▌')){title=line.slice(1).trim();continue;}
    const match=line.match(/^•\s*(\[[^\]]+\])?\s*(.+)$/u);
    if(match){current={title,text:match[2],label:match[1]||'',links:[]};items.push(current);title='';continue;}
    if(current&&/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}&t=\d+s$/.test(line))current.links.push(line);
  }
  if(!items.length)return {text:`${String(video.title).slice(0,600)}\n전체 요약은 첨부파일에 보존했습니다.\nhttps://news.dsoom.com/?video=${video.id}`,document:String(text),version:1,itemCount:null};
  const verified=summary?.verified===true&&Array.isArray(summary.items);
  if(verified)items.splice(0,items.length,...summary.items.map(item=>({title:item.title,text:item.text,label:item.kind==='outlook'?'[출연자의 해석·전망]':'[방송에서 소개한 내용]',links:item.starts.map(start=>`https://www.youtube.com/watch?v=${video.id}&t=${Math.floor(start)}s`)})));
  const unique=[];
  for(const item of items){
    const existing=unique.find(x=>x.label===item.label&&x.text.replace(/\s+/g,'')===item.text.replace(/\s+/g,''));
    if(existing)existing.links=[...new Set([...existing.links,...item.links])];else unique.push({...item});
  }
  const detail=`https://news.dsoom.com/?video=${video.id}`;
  const render=compact=>[
    video.title,`https://www.youtube.com/watch?v=${video.id}`,
    ...unique.flatMap(item=>[
      `▌${item.title||'방송 이슈'}`,
      `• ${item.label} ${(compact?item.text.replace(/\s+/g,' ').replace(/습니다\./gu,'음.').replace(/입니다\./gu,'임.'):item.text).replace(/([.!?])\s+(?=\S)/gu,'; ')}`,
      ...item.links]),detail].join('\n');
  for(const compact of [false,true]){
    const candidate=render(compact),html=telegramHtml(candidate,{publishedAt:video.publishedAt});
    const visible=html.replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
    if(summary?.verified!==false&&visible.length<=4096&&candidate.length<=4096)return {text:candidate,version:1,itemCount:unique.length};
  }
  const document=[video.title,detail,...unique.map((item,index)=>`${index+1}. ${item.title||'방송 이슈'}\n${item.label} ${item.text}\n${item.links.join('\n')}`)].join('\n\n');
  return {text:`${String(video.title).slice(0,600)}\n전체 ${unique.length}개 이슈는 첨부파일에 누락 없이 담았습니다.\n${detail}`,document,version:1,itemCount:unique.length};
}
