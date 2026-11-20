// Deterministic speaker boundaries. Unknown speakers always end the preceding turn.
const key=s=>s.replace(/\s+/g,' ').trim().toUpperCase();
export function interviewTurns(text) {
  const re=/(^|\n)[ \t]*([A-Z][A-Za-z.'’\-]*(?:[ \t]+[A-Z][A-Za-z.'’\-]*){0,4})(?:[ \t]*\(\d{1,2}:\d{2}(?::\d{2})?\))?[ \t]*(?::[ \t]*|(?=\n))/g;
  const marks=[...text.matchAll(re)].map(m=>({label:key(m[2]),at:m.index,start:m.index+m[0].length}));
  return marks.map((m,i)=>({label:m.label,body:text.slice(m.start,marks[i+1]?.at??text.length).trim(),labelText:text.slice(m.at,m.start).trim()}));
}
export function ownInterviewQuotes(text,names,{maxQuotes=6,maxWords=25}={}) {
  const labels=new Set(names.map(key)),out=[],seen=new Set();let words=0;
  for(const t of interviewTurns(text)) {
    if(!labels.has(t.label))continue;
    const sentences=t.body.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)||[];
    for(const raw of sentences) {
      const q=raw.trim(),n=q.split(/\s+/).length;
      if(n<8||n>maxWords-words||q.length>600||/[“”"]/.test(q)||seen.has(q))continue;
      out.push({quote:q,excerpt:q,label:t.labelText});seen.add(q);words+=n;
      if(out.length>=maxQuotes||words>=maxWords)return out;
    }
  }
  return out;
}
