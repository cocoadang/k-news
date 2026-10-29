// Presentation only: retain source text; never infer or generate a summary.
export function parseSummary(text, videoId) {
  const blocks=[];
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
    const heading=line.match(/^(\d{1,2})\.\s+(.+)$/);
    blocks.push(heading?{kind:'heading',text:heading[2],number:heading[1]}:{kind:'paragraph',text:raw});
  }
  return blocks;
}
