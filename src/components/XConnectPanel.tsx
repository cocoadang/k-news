import React, { useEffect, useState } from 'react';

type Status = { configured: boolean; fromEnv: boolean; monthUsd: number; capUsd: number; posts: number; lastRun: { at: string; status: string; fetched: number; kept: number } | null };

/** 관리자 설정: X(트위터) 개발자 토큰 넣기 — 휴대폰에서도 입력 가능. 저장된 토큰 값은 다시 보여주지 않습니다. */
export function XConnectPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { try { const r = await fetch('/api/admin/x', { credentials: 'include' }); if (r.ok) setSt(await r.json()); } catch { /* 표시만 생략 */ } };
  useEffect(() => { load(); }, []);
  const post = async (url: string, body?: unknown) => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(j.error || `실패 (${r.status})`);
      return j;
    } finally { setBusy(false); }
  };
  const save = async () => { const j = await post('/api/admin/x/token', { token: token.trim() }); if (j?.ok) { setToken(''); setMsg('저장했습니다. 다음 3시간 분석 때부터 수집합니다.'); load(); } };
  const remove = async () => { const j = await post('/api/admin/x/token', { token: null }); if (j?.ok) { setMsg('토큰을 지웠습니다.'); load(); } };
  const run = async () => { const j = await post('/api/admin/x/run'); if (j?.status) { setMsg(`수집 결과: ${j.status} · 새 글 ${j.kept ?? 0}건 · 이번 달 $${(j.monthUsd ?? 0).toFixed(2)}`); load(); } };

  return <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-3" data-testid="x-connect">
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-white">X(트위터) 연동 · CEO 발언</span>
      <span className={'text-[11px] px-2 py-0.5 rounded-full ' + (st?.configured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400')}>{st ? (st.configured ? '연결됨' : '토큰 없음') : '확인 중'}</span>
    </div>
    {st && <p className="text-[11px] text-slate-400">이번 달 사용 ${st.monthUsd.toFixed(2)} / 상한 ${st.capUsd} · 저장된 글 {st.posts}건{st.lastRun ? ` · 마지막 수집 ${new Date(st.lastRun.at).toLocaleString('ko-KR')} (${st.lastRun.status})` : ''}</p>}
    {!st?.fromEnv && <div className="flex gap-2">
      <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="X 개발자 Bearer Token 붙여넣기"
        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" />
      <button disabled={busy || !token.trim()} onClick={save} className="px-3 py-2 rounded-lg bg-cyan-600 text-white text-xs font-bold disabled:opacity-40">저장</button>
    </div>}
    <div className="flex gap-2">
      <button disabled={busy || !st?.configured} onClick={run} className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-200 disabled:opacity-40">지금 수집</button>
      {st?.configured && !st.fromEnv && <button disabled={busy} onClick={remove} className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs text-slate-400">토큰 지우기</button>}
    </div>
    {msg && <p className="text-[11px] text-cyan-300">{msg}</p>}
    <p className="text-[11px] text-slate-500">저장한 토큰은 서버에만 보관되고 화면에 다시 표시되지 않습니다. 게시물 1건 읽기 $0.005, 월 상한을 넘으면 자동으로 멈춥니다.</p>
  </div>;
}
