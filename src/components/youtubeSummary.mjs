// Presentation only: retain source text; never infer or generate a summary.
const KINDS=[[/^•\s*\[방송에서 소개한 내용\]\s*/,'방송에서 소개'],[/^•\s*\[출연자의 해석·전망\]\s*/,'출연자 해석·전망']];
// Short topic line for an automatic point: its first clause, so automatic and reviewed summaries read the same way.
export function shortTitle(text){
  const first=String(text).split(/(?<=[.!?。])\s|(?<=다\.)\s/)[0].replace(/[.。]$/,'');
  const cut=first.split(/,\s|하면서\s|면서\s|으며\s|며\s/)[0];
  const t=(cut.length>=12?cut:first).trim();
  return t.length>42?t.slice(0,41)+'…':t;
}
// Automatic (evidence_ids_v1) text uses Telegram-style lines; present it like the reviewed summaries:
// numbered topic headings, the point text, then its timestamp links. Header lines already shown above are dropped.
function parseAutomatic(text, videoId){
  const blocks=[];let n=0,seenPoint=false,pending='';
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();if(!line)continue;
    if(/^\[\d+\/\d+\]$/.test(line)||/^자동 자막 기반/.test(line))continue;
    const url=line.match(/^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})(?:&t=(\d+)s)?$/);
    if(url&&url[1]===videoId){
      if(!url[2])continue;
      const sec=Number(url[2]),stamp=`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;
      blocks.push({kind:'link',text:`${stamp} 근거 장면`,url:line});continue;
    }
    if(line.startsWith('▌')){pending=line.slice(1).trim();seenPoint=true;continue;}
    const k=KINDS.find(([re])=>re.test(line));
    if(k){const body=line.replace(k[0],'');n++;seenPoint=true;
      blocks.push({kind:'heading',number:String(n),text:pending||shortTitle(body),badge:k[1]},{kind:'paragraph',text:body});pending='';continue;}
    if(!seenPoint)continue; // title line before the first point (shown in the page header)
    blocks.push({kind:'paragraph',text:raw});
  }
  return blocks;
}
export function parseSummary(text, videoId) {
  if(/^•\s*\[(?:방송에서 소개한 내용|출연자의 해석·전망)\]/m.test(text))return parseAutomatic(text,videoId);
  const blocks=[];
  let legacyTopic = 0;
  for(const raw of text.split(/\r?\n/)) {
    const line=raw.trim(); if(!line) continue;
    const url=line.match(/^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})(?:&t=(\d+)s)?$/);
    if(url && url[1]===videoId) {
      const prior=blocks.at(-1);
      const seconds=Number(url[2]||0);
      const stamp=`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
      const paired=prior?.kind==='paragraph' && /^\d{1,3}:\d{2}(?:\s|$)/.test(prior.text);
      const label=paired?blocks.pop().text:(url[2]?`${stamp} 근거 장면`:'원문 영상');
      blocks.push({kind:'link',text:label,url:line}); continue;
    }
    const legacy = line.match(/^•\s*(.{2,42}?):\s+(.+)$/);
    if (legacy) {
      blocks.push({kind:'heading', text:legacy[1], number:String(++legacyTopic)}, {kind:'paragraph', text:legacy[2]});
      continue;
    }
    const heading=line.match(/^(\d{1,2})\.\s+(.+)$/);
    blocks.push(heading?{kind:'heading',text:heading[2],number:heading[1]}:{kind:'paragraph',text:raw});
  }
  return blocks;
}

// Select actual saved content. A numbered/topic section takes precedence over introductory notes.
export function summaryPreview(text, videoId) {
  const blocks = parseSummary(text, videoId);
  const start = blocks.findIndex(block => block.kind === 'heading');
  const body = blocks.slice(start + 1).find(block => block.kind === 'paragraph'
    && (start >= 0 || /^\s*•/.test(block.text)))?.text.trim().replace(/^•\s*/, '');
  return body?.split(/(?<=[.!?。])\s+/, 1)[0] ?? '';
}

export function summaryTopics(blocks, videoId) {
  const topics = [];
  for (const block of blocks) {
    if (block.kind === 'heading') topics.push({ ...block, id: `topic-${videoId}-${topics.length}`, time: null });
    const active = topics.at(-1);
    if (active && !active.time && block.kind === 'link') {
      const seconds = new URL(block.url).searchParams.get('t');
      if (seconds) active.time = { url: block.url, text: block.text.split(/\s/, 1)[0] };
    }
  }
  return topics;
}
