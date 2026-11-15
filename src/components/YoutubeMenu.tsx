import React, {useEffect,useState,useRef} from 'react';
import {YoutubeSummaryBody} from './YoutubeSummaryBody';
import {WallstreetRunButton} from './WallstreetRunButton';
import {PageHeader,RefreshButton,chipClass,buttonClass} from './ui';
import {useLang,tr,getLang} from '../i18n';

type Video={id:string;title:string;publishedAt:number|null;programmes:string[];status:string;source:string;url:string;summary:string|null};
const programmesOf=():Record<string,string>=>({wallstreet:tr('월가 뉴스레터','Wall Street Newsletter'),bullbear:tr('홍장원의 불앤베어','Hong Jang-won Bull & Bear')});
const statusesOf=():Record<string,string>=>({ready:tr('요약 완료','Summary ready'),review_required:tr('검증 보류','Held for review'),unavailable:tr('처리 실패 / 이용 불가','Failed / unavailable'),processing:tr('처리 중','Processing'),not_generated:tr('요약 미생성','No summary yet')});
const date=(value:number|null)=>value===null?tr('날짜 정보 없음','Date unknown'):new Intl.DateTimeFormat(getLang()==='ko'?'ko-KR':'en-US',{timeZone:'Asia/Seoul',dateStyle:'long',timeStyle:'short'}).format(value)+(getLang()==='ko'?'':' KST');

export function YoutubeMenu({isAdmin,onLogin}:{isAdmin:boolean;onLogin:()=>void}){
  const {t}=useLang();const programmes=programmesOf(),statuses=statusesOf();
  const [videos,setVideos]=useState<Video[]>([]),[selected,setSelected]=useState<string|null>(null),[filter,setFilter]=useState('all');
  const [status,setStatus]=useState<'loading'|'ready'|'error'|'auth'>('loading');
  const [version,setVersion]=useState(0);
  const [runStatus,setRunStatus]=useState('');
  const [sendingTest,setSendingTest]=useState(false);
  const [testResult,setTestResult]=useState('');
  const sendChannelTest=async(id:string)=>{
    if(sendingTest)return;setSendingTest(true);setTestResult('');
    try{
      const r=await fetch('/api/admin/wallstreet/channel-test',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoId:id})});
      const b=await r.json();setTestResult(b.status==='sent'?t('새 채널로 요약 전송 완료','Summary sent to the new channel'):b.status==='already_sent'?t('이 요약은 이미 채널 테스트로 전송했습니다.','This summary was already sent as a channel test.'):t('전송 결과 확인이 필요합니다. 반복 전송하지 말고 채널을 확인하세요.','Check the channel before retrying; delivery needs review.'));
    }catch{setTestResult(t('전송 결과 확인이 필요합니다. 채널을 먼저 확인하세요.','Check the channel before retrying.'));}finally{setSendingTest(false);}
  };
  const listPosition=useRef(0);
  const openVideo=(id:string)=>{listPosition.current=window.scrollY;setTestResult('');setSelected(id);window.scrollTo(0,0);};
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
  return <section aria-label={t('유튜브 요약','YouTube summaries')} className="min-w-0 space-y-4 text-slate-200">
    <PageHeader title={t('유튜브 요약','YouTube Summaries')} description={t('영상별 상세 요약과 근거 장면을 확인하세요. 날짜는 한국시간 기준입니다.','Detailed per-video summaries with timestamped evidence. Summaries are in Korean; times are KST.')} status={runStatus||undefined}
      actions={<>{isAdmin&&<WallstreetRunButton onStatus={setRunStatus} onDone={()=>setVersion(v=>v+1)}/>}<RefreshButton onClick={()=>setVersion(v=>v+1)}/></>}/>
    {     status==='loading'?<p role="status">{t('저장된 요약을 불러오는 중입니다.','Loading saved summaries…')}</p>:
     status==='error'?<p role="alert">{t('저장 결과를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.','Could not load saved results. Please refresh in a moment.')}</p>:
     video?<article className="youtube-detail min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-6">
       <div className="youtube-detail-header"><button className={button} onClick={closeVideo}>← {t('영상 목록','Video list')}</button>
       <p className="mt-5 text-sm text-cyan-300">{video.programmes.map(p=>programmes[p]).join(' · ')||t('코너 정보 없음','No programme info')}</p>
       <h2 className="mt-3 break-words text-xl font-bold leading-relaxed text-white">{video.title}</h2>
       <p className="mt-2 text-sm text-slate-400">{date(video.publishedAt)} · {statuses[video.status]||t('상태 확인 필요','Status unknown')}</p>
       <a className="mt-3 inline-block break-all text-cyan-300 underline" href={video.url} target="_blank" rel="noopener noreferrer">{t('YouTube 원문 보기','Watch on YouTube')} ↗</a>
       {isAdmin&&video.status==='ready'&&<div className="mt-4"><button className={button} disabled={sendingTest} onClick={()=>sendChannelTest(video.id)}>{sendingTest?t('전송 중…','Sending…'):t('새 채널로 테스트 발송','Send channel test')}</button>{testResult&&<p role="status" className="mt-2 text-sm text-cyan-300">{testResult}</p>}</div>}
       </div>{video.status==='ready'&&video.summary?<><p className="mx-auto mt-5 max-w-[760px] border-l-2 border-slate-600 pl-3 text-xs leading-6 text-slate-400">{video.source==='transcript_review'?t('자막 직접 검토 요약 · 외부 공식 자료 대조 미실시','Summary from a reviewed transcript · not cross-checked against official sources'):video.source==='supervised_trial'?t('기존 시험의 자막 검토·교정본 · 무인 자동 검증 결과가 아닙니다. 외부 공식 자료 대조 미실시','Reviewed/corrected transcript from an earlier trial · not an automated verification · not cross-checked against official sources'):t('자동 자막 기반 요약 · 근거 대조·점검을 통과한 항목만 표시 · 외부 공식 자료 대조 미실시','Summary from auto-captions · only items that passed evidence checks are shown · not cross-checked against official sources')}</p>
       <YoutubeSummaryBody text={video.summary} videoId={video.id}/></>:<div className="mt-5 rounded-lg bg-amber-950/30 p-4 leading-7 text-amber-200">{t('아직 표시할 완료 요약이 없습니다. 검증 보류·미생성·처리 실패 결과를 완료 요약으로 표시하지 않습니다. 채팅에서 직접 검토해 전달한 요약은 이 저장소에 자동으로 등록되지 않습니다.','No finished summary to show yet. Held, missing or failed results are not shown as summaries.')}</div>}
     </article>:<>
       <div className="flex flex-wrap gap-2" aria-label={t('프로그램 필터','Programme filter')}>{Object.entries({all:t('전체','All'),...programmes}).map(([key,label])=><button key={key} className={chipClass(filter===key)} aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
       <div className="grid min-w-0 gap-3 md:grid-cols-2">{videos.filter(v=>filter==='all'||v.programmes.includes(filter)).map(v=><button key={v.id} id={`video-${v.id}`} onClick={()=>openVideo(v.id)} className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-5 text-left hover:border-cyan-700 focus-visible:ring-2 focus-visible:ring-cyan-400">
         <span className="text-sm text-cyan-300">{v.programmes.map(p=>programmes[p]).join(' · ')||t('코너 정보 없음','No programme info')}</span><h2 className="my-2 break-words font-semibold leading-7 text-white">{v.title}</h2><p className="text-sm text-slate-400">{date(v.publishedAt)}</p><p className="mt-3 text-sm">{statuses[v.status]||t('상태 확인 필요','Status unknown')} · {t('상세 보기','View details')} →</p>
       </button>)}</div>
       {!videos.some(v=>filter==='all'||v.programmes.includes(filter))&&<p className="rounded-xl border border-dashed border-slate-700 p-6 text-slate-400">{t('이 코너에 저장된 영상이 없습니다. 새 결과가 저장되면 여기에 표시됩니다.','No saved videos for this programme yet.')}</p>}
     </>}
  </section>;
}
