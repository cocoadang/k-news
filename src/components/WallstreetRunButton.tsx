import React, {useState} from 'react';
import {CollectButton} from './ui';

// Admin-only: starts one manual YouTube summary + CEO video run (server throttles to once per 10 minutes).
export function WallstreetRunButton({onDone,onStatus}:{onDone:()=>void;onStatus:(text:string)=>void}){
  const [busy,setBusy]=useState(false);
  const run=async()=>{
    const id='m'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
    setBusy(true);onStatus('수집 중입니다. 몇 분 걸릴 수 있습니다…');
    try{
      const r=await fetch('/api/admin/wallstreet/run',{method:'POST',credentials:'include',headers:{'X-Knews-Run-Id':id}});
      const b=await r.json().catch(()=>({}));
      if(r.status===401||r.status===403){onStatus('관리자 로그인이 필요합니다.');return;}
      const text:Record<string,string>={processed:'수집 완료',manual_throttled:'10분 이내 재실행은 막혀 있습니다. 잠시 후 다시 눌러주세요.',disabled:'자동 요약이 꺼져 있습니다.'};
      onStatus((text[b.status]||`결과: ${b.status||r.status}`)+(b.ceoVideo?.status?` · CEO 영상: ${b.ceoVideo.status}`:''));
      onDone();
    }catch{onStatus('응답을 받지 못했습니다. 서버에서는 계속 실행될 수 있으니 잠시 후 새로고침하세요.');}
    finally{setBusy(false);}
  };
  return <CollectButton onClick={run} busy={busy}/>;
}
