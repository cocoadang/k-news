import {tr} from '../i18n';
import React from 'react';
import {parseSummary,summaryTopics} from './youtubeSummary.mjs';
import './youtubeSummary.css';

export function YoutubeSummaryBody({text,videoId}:{text:string;videoId:string}) {
  const blocks=parseSummary(text,videoId);
  const headings=summaryTopics(blocks,videoId);
  let topic=0;
  return <div className="youtube-reading">
    {headings.length>0&&<nav className="youtube-toc" aria-label={tr('요약 주제 바로가기','Jump to topic')}><details open>
      <summary>{tr('주제와 타임스탬프','Topics and timestamps')}</summary>
      <ol>{headings.map(h=><li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
        <a href={`#${h.id}`}><span>{h.number}</span>{h.text}</a>
        {h.time&&<a href={h.time.url} target="_blank" rel="noopener noreferrer" aria-label={`${h.text} · ${h.time.text}`}>{h.time.text} ↗</a>}
      </li>)}</ol>
    </details></nav>}
    <div className="youtube-prose">{blocks.map((block,i)=>{
      if(block.kind==='heading') return <h3 id={`topic-${videoId}-${topic++}`} key={i}><span>{block.number.padStart(2,'0')}</span><span className="youtube-h3-text">{block.text}{block.badge&&<em className="youtube-badge">{block.badge}</em>}</span></h3>;
      if(block.kind==='link') return <a className="youtube-time" key={i} href={block.url} target="_blank" rel="noopener noreferrer">{block.text} ↗</a>;
      return <p key={i} className={i===0&&/상세 요약$/.test(block.text)?'youtube-source-title':undefined}>{block.text.split(/(https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}(?:&t=\d+s)?)/g).map((part,j)=>new RegExp(`^https://www\\.youtube\\.com/watch\\?v=${videoId}(?:&t=\\d+s)?$`).test(part)?<a key={j} href={part} target="_blank" rel="noopener noreferrer">{part}</a>:part)}</p>;
    })}</div>
  </div>;
}
