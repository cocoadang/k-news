import React, {useEffect,useState,useRef} from 'react';
import {YoutubeSummaryBody} from './YoutubeSummaryBody';
import {WallstreetRunButton} from './WallstreetRunButton';
import {PageHeader,RefreshButton,chipClass,buttonClass} from './ui';

type Video={id:string;title:string;publishedAt:number|null;programmes:string[];status:string;source:string;url:string;summary:string|null};
const programmes:Record<string,string>={wallstreet:'월가 뉴스레터',bullbear:'홍장원의 불앤베어'};
const statuses:Record<string,string>={ready:'요약 완료',review_required:'검증 보류',unavailable:'처리 실패 / 이용 불가',processing:'처리 중',not_generated:'요약 미생성'};
const date=(value:number|null)=>value===null?'날짜 정보 없음':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'long',timeStyle:'short'}).format(value);

export function YoutubeMenu({isAdmin,onLogin}:{isAdmin:boolean;onLogin:()=>void}){
  const [videos,setVideos]=useState<Video[]>([]),[selected,setSelected]=useState<string|null>(null),[filter,setFilter]=useState('all');
  const [status,setStatus]=useState<'loading'|'ready'|'error'|'auth'>('loading');
  const [version,setVersion]=useState(0);
  const [runStatus,setRunStatus]=useState('');
  const listPosition=useRef(0);
  const openVideo=(id:string)=>{listPosition.current=window.scrollY;setSelected(id);window.scrollTo(0,0);};
  const closeVideo=()=>{setSelected(null);requestAnimationFrame(()=>{window.scrollTo(0,listPosition.current);document.getElementById(`video-${selected}`)?.focus({preventScroll:true});});};
  useEffect(()=>{
    setVideos([]);setSelected(null);
    const controller=new AbortController();setStatus('loading');
    fetch('/api/youtube/summaries',{credentials:'include',signal:controller.signal}).then(async r=>{
      if(r.status===401||r.status===403){setStatus('error');return;}
      if(!r.ok)throw Error('read_failed');
      const body=await r.json();if(!Array.isArray(body.videos))throw Error('invalid_response');
      setVideos(body.videos);setStatus('ready');
    }).catch(e=>{if(e.name!=='AbortError')setStatus('error');});
    return ()=>controller.abort();
  },[isAdmin,version]);
  const video=videos.find(v=>v.id===selected);
  const button=buttonClass.secondary;
  return <section aria-label="유튜브 요약" className="min-w-0 space-y-4 text-slate-200">
    <PageHeader title="유튜브 요약" description="영상별 상세 요약과 근거 장면을 확인하세요. 날짜는 한국시간 기준입니다." status={runStatus||undefined}
      actions={<>{isAdmin&&<WallstreetRunButton onStatus={setRunStatus} onDone={()=>setVersion(v=>v+1)}/>}<RefreshButton onClick={()=>setVersion(v=>v+1)}/></>}/>
    {     status==='loading'?<p role="status">저장된 요약을 불러오는 중입니다.</p>:
     status==='error'?<p role="alert">저장 결과를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>:
     video?<article className="youtube-detail min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
       <div className="youtube-detail-header"><button className={button} onClick={closeVideo}>← 영상 목록</button>
       <p className="mt-5 text-sm text-cyan-300">{video.programmes.map(p=>programmes[p]).join(' · ')||'코너 정보 없음'}</p>
       <h2 className="mt-3 break-words text-xl font-bold leading-relaxed text-white">{video.title}</h2>
       <p className="mt-2 text-sm text-slate-400">{date(video.publishedAt)} · {statuses[video.status]||'상태 확인 필요'}</p>
       <a className="mt-3 inline-block break-all text-cyan-300 underline" href={video.url} target="_blank" rel="noopener noreferrer">YouTube 원문 보기 ↗</a>
       </div>{video.status==='ready'&&video.summary?<><p className="mx-auto mt-5 max-w-[760px] border-l-2 border-slate-600 pl-3 text-xs leading-6 text-slate-400">{video.source==='transcript_review'?'자막 직접 검토 요약 · 외부 공식 자료 대조 미실시':video.source==='supervised_trial'?'기존 시험의 자막 검토·교정본 · 무인 자동 검증 결과가 아닙니다. 외부 공식 자료 대조 미실시':'자동 생성 후 프로그램 검사를 통과한 결과입니다. 외부 공식 자료 대조를 의미하지 않습니다.'}</p>
       <YoutubeSummaryBody text={video.summary} videoId={video.id}/></>:<div className="mt-5 rounded-lg bg-amber-950/30 p-4 leading-7 text-amber-200">아직 표시할 완료 요약이 없습니다. 검증 보류·미생성·처리 실패 결과를 완료 요약으로 표시하지 않습니다. 채팅에서 직접 검토해 전달한 요약은 이 저장소에 자동으로 등록되지 않습니다.</div>}
     </article>:<>
       <div className="flex flex-wrap gap-2" aria-label="프로그램 필터">{Object.entries({all:'전체',...programmes}).map(([key,label])=><button key={key} className={chipClass(filter===key)} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
       <div className="grid min-w-0 gap-3 md:grid-cols-2">{videos.filter(v=>filter==='all'||v.programmes.includes(filter)).map(v=><button key={v.id} id={`video-${v.id}`} onClick={()=>openVideo(v.id)} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-left hover:border-cyan-700 focus-visible:ring-2 focus-visible:ring-cyan-400">
         <span className="text-sm text-cyan-300">{v.programmes.map(p=>programmes[p]).join(' · ')||'코너 정보 없음'}</span><h2 className="my-2 break-words font-semibold leading-7 text-white">{v.title}</h2><p className="text-sm text-slate-400">{date(v.publishedAt)}</p><p className="mt-3 text-sm">{statuses[v.status]||'상태 확인 필요'} · 상세 보기 →</p>
       </button>)}</div>
       {!videos.some(v=>filter==='all'||v.programmes.includes(filter))&&<p className="rounded-xl border border-dashed border-slate-700 p-6 text-slate-400">이 코너에 저장된 영상이 없습니다. 새 결과가 저장되면 여기에 표시됩니다.</p>}
     </>}
  </section>;
}
