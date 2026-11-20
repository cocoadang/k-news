import {kstDate} from './telegramFormat.mjs';

const TELEGRAM_MESSAGE_LIMIT=4096;
const TELEGRAM_ENTITY_LIMIT=100;

const sentenceSegmenter=new Intl.Segmenter('ko',{granularity:'sentence'});
const timestampPattern=/^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})&t=(\d+)s$/u;

function block(){
  return {text:'',entities:[]};
}
function append(target,text,entity){
  if(!text)return;
  if(entity)target.entities.push({...entity,offset:target.text.length,length:text.length});
  target.text+=text;
}
function joinBlocks(blocks){
  const joined=block();
  for(const part of blocks){
    if(joined.text)joined.text+='\n\n';
    const offset=joined.text.length;
    joined.text+=part.text;
    joined.entities.push(...part.entities.map(entity=>({...entity,offset:entity.offset+offset})));
  }
  return joined;
}
function oneLine(value,max){
  const clean=String(value).replace(/\s+/gu,' ').trim();
  for(const {segment} of sentenceSegmenter.segment(clean)){
    const sentence=segment.trim();
    if(!sentence||/^(?:확보한 .*자막|(?:영상|방송|자막)(?:을|를| 전체를).*검토)|(?:요약|정리)(?:했|하였)습니다[.!]?$/u.test(sentence))continue;
    return boundedLine(sentence,max);
  }
  return '';
}
function boundedLine(value,max){
  const clean=String(value).replace(/\s+/gu,' ').trim();
  return clean.length<=max?clean:clean.slice(0,max-1).toWellFormed()+'…';
}
function timestamp(seconds){
  const hours=Math.floor(seconds/3600);
  const minutes=String(Math.floor(seconds/60)%60);
  const rest=String(seconds%60).padStart(2,'0');
  return hours?`${hours}:${minutes.padStart(2,'0')}:${rest}`:`${minutes}:${rest}`;
}
export function telegramDigest(text,video,summary){
  if(!/^[\w-]{11}$/.test(video?.id||''))throw Error('digest_video_required');
  const items=[];let title='',current;
  for(const raw of String(text).split(/\r?\n/)){
    const line=raw.trim();
    const numbered=line.match(/^\d+[.)]\s+(.+)$/u);
    if(numbered){
      current={title:numbered[1],text:'',label:'',links:[]};
      items.push(current);
      continue;
    }
    if(line.startsWith('▌')){title=line.slice(1).trim();continue;}
    const match=line.match(/^•\s*(\[[^\]]+\])?\s*(.+)$/u);
    if(match){current={title,text:match[2],label:match[1]||'',links:[]};items.push(current);title='';continue;}
    if(!current||!line)continue;
    if(timestampPattern.test(line)){current.links.push(line);continue;}
    if(/^(?:\[\d+\/\d+\]$|(?:\d{1,2}:)?\d{1,2}:\d{2}(?:\s|$)|https?:\/\/)/u.test(line))continue;
    current.text+=(current.text?'\n':'')+line;
  }
  const verified=summary?.verified===true&&Array.isArray(summary.items)&&summary.items.length>0;
  if(verified)items.splice(0,items.length,...summary.items.map(item=>({title:item.title,text:item.text,label:item.kind==='outlook'?'[출연자의 해석·전망]':'[방송에서 소개한 내용]',links:item.starts.map(start=>`https://www.youtube.com/watch?v=${video.id}&t=${Math.floor(start)}s`)})));
  const unique=[];
  for(const item of items){
    const existing=unique.find(x=>x.label===item.label&&x.text.replace(/\s+/g,'')===item.text.replace(/\s+/g,''));
    if(existing)existing.links=[...new Set([...existing.links,...item.links])];else unique.push({...item});
  }
  const watch=`https://www.youtube.com/watch?v=${video.id}`;
  const header=block();
  append(header,boundedLine(video.title,600),{type:'bold'});
  const day=kstDate(video.publishedAt);
  if(day)append(header,'\n'+day+' 방송');
  append(header,'\n');
  append(header,'영상 보기',{type:'text_link',url:watch});

  const topics=unique.map(item=>{
    // Older summaries store their topic label at the start of the bullet.
    const inlineTitle=!item.title&&item.text.match(/^([\p{L}][\p{L}\p{N}\p{Zs}·/&()‘’'–-]{0,39})[:：]\s+(.+)$/su);
    const title=inlineTitle?inlineTitle[1].trim():item.title;
    const sentence=oneLine(inlineTitle?inlineTitle[2]:item.text,1400);
    return {...item,title,sentence};
  }).filter(item=>item.sentence);
  if(!topics.length)throw Error('digest_topics_required');
  const issues=topics.map((item,index)=>{
    const issue=block();
    append(issue,`${index+1}. ${boundedLine(item.title||'방송 이슈',300)}`,{type:'bold'});
    append(issue,'\n'+item.sentence);
    // The first available timestamp provides a direct jump for each topic.
    const stamp=item.links.map(link=>link.match(timestampPattern)).find(link=>link?.[1]===video.id);
    if(stamp){
      append(issue,' · ');
      append(issue,timestamp(Number(stamp[2])),{type:'text_link',url:stamp[0]});
    }
    return issue;
  });
  const detail=block();
  append(detail,'Dsoom 상세 요약 보기',{type:'text_link',url:`https://news.dsoom.com/?video=${video.id}`});
  const blocks=[header,...issues,detail];
  const body=joinBlocks(blocks);
  if(body.text.length<=TELEGRAM_MESSAGE_LIMIT&&body.entities.length<=TELEGRAM_ENTITY_LIMIT)return {parts:[body],itemCount:topics.length};
  const pages=[];
  let page=[],size=0,entityCount=0;
  for(const item of blocks){
    if(size+2+item.text.length>TELEGRAM_MESSAGE_LIMIT-32||entityCount+item.entities.length>TELEGRAM_ENTITY_LIMIT){
      pages.push(joinBlocks(page));
      page=[];size=0;entityCount=0;
    }
    size+=item.text.length+(page.length?2:0);
    page.push(item);
    entityCount+=item.entities.length;
  }
  pages.push(joinBlocks(page));
  const parts=pages.map((part,index)=>{
    const prefix=`[${index+1}/${pages.length}]\n`;
    return {text:prefix+part.text,entities:part.entities.map(entity=>({...entity,offset:entity.offset+prefix.length}))};
  });
  return {parts,itemCount:topics.length};
}

export function telegramOutbox(text,video,summary){
  return telegramDigest(text,video,summary).parts.map(part=>({...part,status:'pending'}));
}
