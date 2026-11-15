import React, {useEffect,useState} from 'react';
import {CollectButton,RefreshButton,buttonClass} from './ui';
import {WallstreetRunButton} from './WallstreetRunButton';
import {CeoMenu} from './ceo/CeoMenu';
import {XConnectPanel} from './XConnectPanel';
import {NewsEvent} from '../types';

export function AdminOperations({onPoll,polling,onRefresh,onLogout,events,onSendNews,onReanalyze}:{onPoll:()=>void;polling:boolean;onRefresh:()=>void;onLogout:()=>void;events:NewsEvent[];onSendNews:(id:string)=>Promise<void>;onReanalyze:(id:string)=>Promise<void>}){
  const [videos,setVideos]=useState<Array<{id:string;title:string}>>([]),[selected,setSelected]=useState('');
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [newsId,setNewsId]=useState(events[0]?.id||'');
  const newsAction=async(action:(id:string)=>Promise<void>)=>{if(busy||!newsId)return;setBusy(true);try{await action(newsId);}finally{setBusy(false);}};
  useEffect(()=>{const c=new AbortController();fetch('/api/youtube/summaries',{credentials:'include',signal:c.signal}).then(r=>r.ok?r.json():Promise.reject()).then(b=>{setVideos(b.videos||[]);setSelected(b.videos?.[0]?.id||'');}).catch(()=>{});return()=>c.abort();},[]);
  const send=async()=>{if(busy||!selected)return;setBusy(true);setMessage('전송 중…');try{const r=await fetch('/api/admin/wallstreet/channel-test',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoId:selected})});const b=await r.json();setMessage(b.status==='sent'?'채널 전송 완료':b.status==='already_sent'?'이미 테스트 발송한 요약입니다.':'채널에서 수신 여부를 확인하세요. 반복 전송은 중지했습니다.');}catch{setMessage('응답을 확인하지 못했습니다. 채널을 먼저 확인하세요.');}finally{setBusy(false);}};
  return <div className="space-y-4">
    <section className="admin-card"><h3>화면 업데이트</h3><p>저장된 최신 결과를 다시 불러옵니다.</p><RefreshButton onClick={onRefresh}/></section>
    <section className="admin-card"><h3>뉴스 수집</h3><p>정기 수집 외에 추가 수집이 필요할 때만 실행하세요.</p><CollectButton onClick={onPoll} busy={polling}/><details className="mt-4"><summary className="cursor-pointer text-sm text-slate-400">개별 뉴스 관리</summary><select className="admin-input mt-3" aria-label="관리할 뉴스" value={newsId} onChange={e=>setNewsId(e.target.value)}>{events.slice(0,100).map(e=><option key={e.id} value={e.id}>{e.titleKo||e.title}</option>)}</select><div className="mt-3 flex flex-wrap gap-2"><button className={buttonClass.secondary} disabled={busy||!newsId} onClick={()=>newsAction(onSendNews)}>채널로 발송</button><button className={buttonClass.secondary} disabled={busy||!newsId} onClick={()=>newsAction(onReanalyze)}>다시 분석</button></div></details></section>
    <section className="admin-card"><h3>유튜브 요약</h3><p>새 영상 수집과 요약은 정기적으로 실행됩니다.</p><WallstreetRunButton onStatus={setMessage} onDone={onRefresh}/><details className="mt-4"><summary className="cursor-pointer text-sm text-slate-400">텔레그램 테스트 발송</summary><label className="mt-3 block text-sm">저장된 요약<select aria-label="테스트할 유튜브 요약" value={selected} onChange={e=>setSelected(e.target.value)} className="admin-input mt-2">{videos.map(v=><option key={v.id} value={v.id}>{v.title}</option>)}</select></label><button className={buttonClass.secondary+' mt-3'} disabled={busy||!selected} onClick={send}>새 채널로 테스트 발송</button></details></section>
    {message&&<p role="status" className="text-sm text-cyan-300">{message}</p>}
    <section className="admin-card"><h3>CEO 발언</h3><CeoMenu isAdmin adminToolsOnly/></section>
    <details className="admin-card"><summary className="cursor-pointer text-sm font-semibold text-slate-200">외부 서비스 연결</summary><div className="mt-3"><XConnectPanel/></div></details>
    <button className={buttonClass.secondary} onClick={onLogout}>관리자 로그아웃</button>
  </div>;
}
