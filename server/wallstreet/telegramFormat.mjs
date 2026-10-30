// Telegram presentation only. The stored summary text (also parsed by the web page) is unchanged;
// this converts it to Telegram HTML: bold title, numbered points, short tappable timestamp links.
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const URL_RE=/^https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})(?:&t=(\d+)s)?$/;
const stamp=sec=>{const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=String(sec%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;};
const LABELS=[[/^•\s*\[방송에서 소개한 내용\]\s*/,'📰'],[/^•\s*\[출연자의 해석·전망\]\s*/,'💬'],[/^•\s*/,'▪️']];

export function telegramHtml(text){
  const lines=String(text).split(/\r?\n/);
  let part='';const m=lines[0]?.match(/^\[(\d+)\/(\d+)\]$/);
  if(m){lines.shift();if(m[2]!=='1')part=`(${m[1]}/${m[2]})`;}
  const out=[];let n=0,titleDone=false,stamps=[];
  const flush=()=>{if(stamps.length){out.push('   ⏱ '+stamps.join('  ·  '));stamps=[];}};
  for(const raw of lines){
    const line=raw.trim();if(!line)continue;
    const u=line.match(URL_RE);
    if(u){
      const href=esc(line);
      if(u[2]===undefined){out.push(`▶️ <a href="${href}">영상 보기</a>`);continue;}
      stamps.push(`<a href="${href}">${stamp(Number(u[2]))}</a>`);continue;
    }
    flush();
    if(!titleDone&&!/^•/.test(line)&&!/^자동 자막 기반/.test(line)){out.push(`📺 <b>${esc(line)}</b>`);titleDone=true;continue;}
    if(/^자동 자막 기반/.test(line)){out.push(`<i>${esc(line)}</i>`,'');continue;}
    const label=LABELS.find(([re])=>re.test(line));
    if(label){n++;if(n>1)out.push('');out.push(`<b>${n}.</b> ${label[1]} ${esc(line.replace(label[0],''))}`);continue;}
    out.push(esc(line));
  }
  flush();
  if(n)out.push('','📰 방송에서 소개한 내용  💬 출연자의 해석·전망');
  if(part)out.push(part);
  return out.join('\n');
}
