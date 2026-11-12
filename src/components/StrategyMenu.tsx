import React, {useEffect, useMemo, useRef, useState} from 'react';
import {PageHeader, RefreshButton, chipClass} from './ui';

// 나스닥 전략 비교 — 자료 출처는 KS Wealth OS(asset.dsoom.com)
//  · 백테스트: https://asset.dsoom.com/strategy-backtest.json (CORS: news.dsoom.com 허용)
//  · 실전 추적: Firestore kswealth_public/strategy (공개 읽기, 금액·계좌 정보 없음)
const BACKTEST_URL = 'https://asset.dsoom.com/strategy-backtest.json';
const LIVE_URL = 'https://firestore.googleapis.com/v1/projects/busan-redevelopment/databases/(default)/documents/kswealth_public/strategy';
const COLORS: Record<string, string> = {old: '#e0a040', b3325: '#4c9be8', mubot: '#e06a70', qqq: '#a07ee6'};
const ORDER = ['old', 'b3325', 'mubot', 'qqq'];
const LABELS: Record<string, string> = {old: '5/10/20', b3325: '3/25', mubot: '무한매수 20분할', qqq: 'QQQ 적립'};
const RULES: Record<string, string> = {
  b3325: '하락폭 3% 미만 SGOV · 3~25% QQQ · 25% 이상 TQQQ(+SGOV를 1/6씩 이동) · 전고점 돌파 시 TQQQ→QQQ',
  old: '하락폭 5% 미만 SGOV · 5~10% SCHD · 10~20% QQQ · 20% 이상 TQQQ · 전고점 돌파 시 TQQQ→QQQ',
  mubot: '라오어 무한매수 V4.0(TQQQ 20분할) 근사 이식',
  qqq: '같은 날 같은 금액을 QQQ에 적립',
};

type Live = {asOf: string; start: string; updatedAt: number; order?: string[];
  market: {dd?: number; peak?: number; vix?: {value?: number; label?: string; percentile?: number}; fearGreed?: {score?: number; label?: string}; stale?: boolean};
  virtual: Record<string, {label: string; twr: number | null; mdd: number; series: [string, number][]; bucket: string | null; deployLeft: number | null;
    mubot: {mode: string; T: number; avgUsd: number; closeUsd: number} | null}>};
type Strat = {label: string; note: string; irr?: number; irrLiq?: number; mdd?: number; final?: number; invested?: number; curve?: [string, number, number][]; na?: string};
type Variant = {name: string; label: string; desc: string; period: [string, string]; strategies: Record<string, Strat>};
type Backtest = {monthly: number; dataEnd: string; order?: string[]; variants: Record<string, Variant>; assumptions?: string[];
  startYears: Record<string, any>[]; fiveYear: Record<string, any>[]; startRange: [number, number]; fiveRange: [number, number];
  summary: Record<string, {startAvg: number; startWorstMdd: number; fiveAvg: number; fiveMin: number; fiveBeatQqq: number | null; fiveN: number}>};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v: unknown, d = 2) => { const n = num(v); return n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(d)}%`; };
const won = (v: unknown) => { const n = num(v); if (n === null) return '—'; const a = Math.abs(n); return (n < 0 ? '−' : '') + (a >= 1e8 ? `${(a / 1e8).toFixed(2)}억` : `${Math.round(a / 1e4).toLocaleString('ko-KR')}만`); };
const dot = (d: string) => d.replace(/-/g, '.');
const label = (k: string, fallback?: string) => LABELS[k] || fallback || k;
const bucketName = (b?: string | null) => (b === 'QQQM' ? 'QQQ' : b || null); // QQQM·QQQ는 같은 지수라 QQQ로 통일

function Dot({k}: {k: string}) { return <span className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle" style={{background: COLORS[k]}} aria-hidden="true"/>; }

type Line = {key: string; label: string; color: string; dashed?: boolean; width?: number; points: {t: number; y: number}[]};
function LineChart({lines, yFormat, height = 240, ariaLabel}: {lines: Line[]; yFormat: (v: number) => string; height?: number; ariaLabel: string}) {
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null), [W, setW] = useState(720);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(e => setW(Math.max(300, Math.round(e[0].contentRect.width)))); ro.observe(el); return () => ro.disconnect(); }, []);
  const narrow = W < 520, H = narrow ? Math.round(height * 0.85) : height, L = narrow ? 48 : 56, R = 8, T = 10, B = 24;
  const all = lines.flatMap(l => l.points);
  if (!all.length) return null;
  const t0 = Math.min(...all.map(p => p.t)), t1 = Math.max(...all.map(p => p.t));
  let y0 = Math.min(...all.map(p => p.y)), y1 = Math.max(...all.map(p => p.y));
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.06; const nonNeg = y0 >= 0; y0 -= pad; y1 += pad; if (nonNeg && y0 < 0) y0 = 0;
  const x = (t: number) => L + (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * (W - L - R));
  const y = (v: number) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const ticks = [0, 1, 2, 3, 4].map(i => y0 + ((y1 - y0) * i) / 4);
  const short = t1 - t0 < 150 * 86400000;
  const fmtT = (t: number) => { const d = new Date(t); return short ? `${d.getMonth() + 1}.${d.getDate()}` : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const xt = (narrow ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map(f => t0 + (t1 - t0) * f);
  const base = lines[0].points;
  const hp = hover === null ? null : base[hover];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity; base.forEach((p, i) => { const d = Math.abs(x(p.t) - px); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  const near = (l: Line, t: number) => { let b = l.points[0], bd = Infinity; for (const p of l.points) { const d = Math.abs(p.t - t); if (d < bd) { bd = d; b = p; } } return b; };
  return <div className="min-w-0" ref={box}>
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">{lines.map(l => <span key={l.key} className="inline-flex items-center">
      <span className="mr-1.5 inline-block w-4" style={{borderTop: `2px ${l.dashed ? 'dashed' : 'solid'} ${l.color}`, opacity: l.dashed && !l.width ? 0.6 : 1}}/>{l.label}</span>)}</div>
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block h-auto w-full max-w-full touch-none select-none" role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#1e293b"/><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{yFormat(v)}</text></g>)}
      {xt.map((t, i) => <text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#94a3b8">{fmtT(t)}</text>)}
      {lines.map(l => <polyline key={l.key} fill="none" stroke={l.color} strokeWidth={l.width ?? (l.dashed ? 1 : 2)} strokeDasharray={l.dashed ? (l.width ? '6 5' : '4 4') : undefined} strokeLinejoin="round"
        points={l.points.map(p => `${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')}/>)}
      {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={T} y2={H - B} stroke="#64748b" strokeDasharray="3 3"/>}
    </svg>
    <p className="mt-1 min-h-[1.25rem] text-xs text-slate-400" aria-live="polite">{hp ? <>{dot(new Date(hp.t).toISOString().slice(0, 10))} · {lines.map(l => `${l.label} ${yFormat(near(l, hp.t).y)}`).join(' · ')}</> : '그래프 위를 누르거나 움직이면 값이 보입니다.'}</p>
  </div>;
}

function Table({head, children, mobileHide = []}: {head: string[]; children: React.ReactNode; mobileHide?: number[]}) {
  return <div className="-mx-1 overflow-x-auto px-1"><table className="w-full border-collapse text-[13px] sm:text-sm">
    <thead><tr>{head.map((h, i) => <th key={h} className={`border-b border-slate-800 px-1.5 sm:px-2 py-2 text-xs font-medium text-slate-400 ${i ? 'text-right' : 'text-left'} ${mobileHide.includes(i) ? 'hidden sm:table-cell' : ''}`}>{h}</th>)}</tr></thead>
    <tbody>{children}</tbody></table></div>;
}
const td = 'border-b border-slate-800/70 px-1.5 sm:px-2 py-2 text-right tabular-nums whitespace-nowrap';
const tdL = 'border-b border-slate-800/70 px-1.5 sm:px-2 py-2 text-left whitespace-nowrap';
const mh = 'hidden sm:table-cell';
const card = 'min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5';

function Kpi({title, value, sub, tone}: {title: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad'}) {
  const c = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : 'text-white';
  return <div className="min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
    <p className="text-xs text-slate-400">{title}</p><p className={`mt-1 text-xl font-bold tabular-nums ${c}`}>{value}</p>{sub && <p className="mt-0.5 text-xs leading-5 text-slate-400">{sub}</p>}
  </div>;
}

export function StrategyMenu() {
  const [live, setLive] = useState<Live | null>(null), [bt, setBt] = useState<Backtest | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [version, setVersion] = useState(0);
  const [variant, setVariant] = useState<string>('');
  useEffect(() => {
    const c = new AbortController(); setStatus('loading');
    Promise.all([
      fetch(LIVE_URL, {signal: c.signal}).then(r => r.ok ? r.json() : Promise.reject(Error('live'))).then(d => JSON.parse(d.fields.payload.stringValue) as Live).catch(e => { if (e.name === 'AbortError') throw e; return null; }),
      fetch(BACKTEST_URL, {signal: c.signal}).then(r => r.ok ? r.json() as Promise<Backtest> : Promise.reject(Error('backtest'))).catch(e => { if (e.name === 'AbortError') throw e; return null; }),
    ]).then(([l, b]) => { setLive(l); setBt(b); setStatus(l || b ? 'ready' : 'error'); if (b && !variant) setVariant(Object.keys(b.variants)[0]); })
      .catch(e => { if (e.name !== 'AbortError') setStatus('error'); });
    return () => c.abort();
  }, [version]);

  return <section aria-label="나스닥 전략" className="min-w-0 space-y-4 text-slate-200">
    <PageHeader title="나스닥 전략" description="나스닥100 하락폭에 따라 매수처를 바꾸는 규칙(3/25·5/10/20)을 무한매수·QQQ 적립과 비교합니다. 투자 권유가 아닌 기록용 계산입니다."
      actions={<RefreshButton onClick={() => setVersion(v => v + 1)} busy={status === 'loading'}/>}/>
    {status === 'loading' && <p role="status">자료를 불러오는 중입니다.</p>}
    {status === 'error' && <p role="alert">자료를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.</p>}
    {live && <LiveSection live={live}/>}
    {bt && variant && <BacktestSection bt={bt} variant={variant} setVariant={setVariant}/>}
  </section>;
}

function LiveSection({live}: {live: Live}) {
  const m = live.market || {}, dd = num(m.dd), vix = num(m.vix?.value), fg = num(m.fearGreed?.score);
  const order = (live.order || ORDER).filter(k => live.virtual[k]);
  const same = (a?: [string, number][], b?: [string, number][]) => !!a && !!b && a.length === b.length && a.every((p, i) => p[0] === b[i][0] && Math.abs(p[1] - b[i][1]) < 1e-9);
  const sameAsQqq = same(live.virtual.b3325?.series, live.virtual.qqq?.series);
  const lines: Line[] = order.map(k => ({key: k, label: label(k, live.virtual[k].label) + (k === 'qqq' && sameAsQqq ? ' (지금은 3/25와 같음)' : ''), color: COLORS[k],
    dashed: k === 'qqq', width: k === 'qqq' ? 2 : undefined,
    points: live.virtual[k].series.map(([d, u]) => ({t: Date.parse(d), y: u * 100}))}));
  const nb = live.virtual.b3325, no = live.virtual.old, mu = live.virtual.mubot?.mubot;
  return <>
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      <Kpi title="나스닥100 하락폭" value={dd === null ? '—' : `−${dd.toFixed(2)}%`} sub={`전고점 ${num(m.peak) ? Math.round(m.peak as number).toLocaleString('en-US') : '—'}`} tone={dd === null ? undefined : dd < 10 ? 'ok' : dd < 20 ? 'warn' : 'bad'}/>
      <Kpi title="VIX" value={vix === null ? '—' : vix.toFixed(2)} sub={[m.vix?.label, num(m.vix?.percentile) !== null ? `역사 ${Math.round(m.vix!.percentile!)}%` : ''].filter(Boolean).join(' · ')} tone={vix === null ? undefined : vix < 20 ? 'ok' : vix < 30 ? 'warn' : 'bad'}/>
      <Kpi title="Fear & Greed" value={fg === null ? '—' : fg.toFixed(1)} sub={m.fearGreed?.label} tone={fg === null ? undefined : fg < 25 || fg > 75 ? 'bad' : fg < 45 || fg > 55 ? 'warn' : undefined}/>
      <Kpi title="3/25 구간" value={bucketName(nb?.bucket) || '—'} sub={nb?.deployLeft ? `SGOV 이동 남은 횟수 ${nb.deployLeft}회` : '3% 미만 SGOV · 3~25% QQQ · 25%↑ TQQQ'}/>
      <Kpi title="5/10/20 구간" value={bucketName(no?.bucket) || '—'} sub="5% 미만 SGOV · 5~10% SCHD · 10~20% QQQ · 20%↑ TQQQ"/>
    </div>
    <div className={card}>
      <h2 className="text-base font-semibold text-white">실전 추적</h2>
      <p className="mt-1 text-sm text-slate-400">{dot(live.start)}부터 매달 첫 거래일에 같은 금액을 넣은 가상 계좌 · 기준 {dot(live.asOf)}{m.stale ? ' · 지표 갱신 지연' : ''}</p>
      <div className="mt-3"><Table head={['전략', '수익률', '최대낙폭', '다음 매수']}>
        {order.map(k => { const v = live.virtual[k]; return <tr key={k}><td className={tdL}><Dot k={k}/>{k === 'mubot' ? <>무한매수<span className="hidden sm:inline"> 20분할</span></> : label(k, v.label)}</td><td className={td}>{pct(v.twr)}</td><td className={td}>{pct(v.mdd)}</td>
          <td className={td}>{k === 'mubot' && v.mubot ? <>{v.mubot.mode === 'R' ? '리버스 ' : ''}T {v.mubot.T}<span className="hidden sm:inline">/20</span></> : bucketName(v.bucket) || (k === 'qqq' ? 'QQQ' : '—')}</td></tr>; })}
      </Table></div>
      <div className="mt-4"><LineChart lines={lines} yFormat={v => v.toFixed(1)} height={220} ariaLabel="실전 추적 가상 계좌 단위가치"/></div>
      <p className="mt-2 text-xs leading-5 text-slate-400">수익률·그래프는 넣은 돈 효과를 뺀 시간가중 기준(시작=100)입니다.{sameAsQqq ? ' 3/25는 하락폭 3~25% 구간이라 지금까지 QQQ만 사서 QQQ 적립과 결과가 같고, 그래프에서는 QQQ 점선 사이로 3/25 선이 보입니다.' : ''} 전일 종가로 판단해 당일 종가에 매매하고 수수료 0.25%를 반영합니다.{mu ? ` 무한매수 평단 $${mu.avgUsd?.toFixed(2)} · 현재 $${mu.closeUsd?.toFixed(2)}.` : ''} 처음 몇 달은 차이가 작고 우연이 크게 작용합니다.</p>
    </div>
  </>;
}

function BacktestSection({bt, variant, setVariant}: {bt: Backtest; variant: string; setVariant: (v: string) => void}) {
  const order = bt.order || ORDER, V = bt.variants[variant] || Object.values(bt.variants)[0], S = V.strategies;
  const ok = order.filter(k => S[k] && !S[k].na);
  const best = (f: (k: string) => number | undefined) => Math.max(...ok.map(f).filter((v): v is number => num(v) !== null));
  const bI = best(k => S[k].irr), bL = best(k => S[k].irrLiq), bM = best(k => S[k].mdd);
  const cls = (v: number | undefined, b: number) => `${td} ${v === b ? 'font-bold text-white' : ''}`;
  const lines: Line[] = useMemo(() => {
    const ls: Line[] = ok.map(k => ({key: k, label: label(k, S[k].label), color: COLORS[k], dashed: k === 'qqq', width: k === 'qqq' ? 2 : undefined, points: (S[k].curve || []).map(p => ({t: Date.parse(p[0].length > 7 ? p[0] : `${p[0]}-15`), y: p[1]}))}));
    const inv = S[ok[0]]?.curve || [];
    ls.push({key: 'inv', label: '넣은 돈', color: '#94a3b8', dashed: true, points: inv.map(p => ({t: Date.parse(p[0].length > 7 ? p[0] : `${p[0]}-15`), y: p[2]}))});
    return ls;
  }, [variant]);
  const M = bt.summary;
  return <div className={card}>
    <h2 className="text-base font-semibold text-white">백테스트 — 위기 저점에서 시작해 매달 {Math.round(bt.monthly / 1e4)}만 원 적립</h2>
    <div className="mt-3 flex flex-wrap gap-2" aria-label="시작 시점">{Object.entries(bt.variants).map(([k, v]) =>
      <button key={k} type="button" className={chipClass(k === variant)} aria-pressed={k === variant} onClick={() => setVariant(k)}>{v.name}</button>)}</div>
    <p className="mt-2 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-200">{dot(V.period[0])} ~ {dot(V.period[1])}</span> · {V.desc.trim()}</p>
    <div className="mt-3"><Table head={['전략', '세전 IRR', '세후 IRR', '최대낙폭', '최종 (넣은 돈)']} mobileHide={[4]}>
      {order.map(k => { const s = S[k]; if (!s) return null; return s.na
        ? <tr key={k}><td className={tdL}><Dot k={k}/>{label(k, s.label)}</td><td className={`${tdL} text-slate-400`} colSpan={3}>{s.na}</td></tr>
        : <tr key={k}><td className={tdL}><Dot k={k}/>{label(k, s.label)}</td><td className={cls(s.irr, bI)}>{pct(s.irr)}</td><td className={cls(s.irrLiq, bL)}>{pct(s.irrLiq)}</td><td className={cls(s.mdd, bM)}>{pct(s.mdd)}</td><td className={`${td} ${mh}`}>{won(s.final)} ({won(s.invested)})</td></tr>; })}
    </Table></div>
    <div className="mt-4"><LineChart lines={lines} yFormat={v => won(v)} ariaLabel="백테스트 자산 곡선"/></div>
    <details className="mt-3 rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-200">매년 1월 시작 결과 ({bt.startRange[0]}~{bt.startRange[1]}년)</summary>
      <div className="mt-3"><Table head={['전략', '시작연도 평균', '최악 낙폭', '5년 평균', '5년 최저', '5년 QQQ 이김']} mobileHide={[2, 4]}>
        {order.map(k => <tr key={k}><td className={tdL}><Dot k={k}/>{label(k)}</td><td className={td}>{pct(M[k]?.startAvg)}</td><td className={`${td} ${mh}`}>{pct(M[k]?.startWorstMdd)}</td><td className={td}>{pct(M[k]?.fiveAvg)}</td><td className={`${td} ${mh}`}>{pct(M[k]?.fiveMin)}</td><td className={td}>{M[k]?.fiveBeatQqq == null ? '—' : `${M[k].fiveBeatQqq} / ${M[k].fiveN}`}</td></tr>)}
      </Table></div>
      <div className="mt-3"><Table head={['시작', ...order.map(k => label(k))]}>
        {bt.startYears.map(r => <tr key={r.year}><td className={tdL}>{r.year}</td>{order.map(k => <td key={k} className={td}>{r[k]?.[0] == null ? '—' : <>{pct(r[k][0])}<span className="block text-xs text-slate-500 sm:ml-1 sm:inline sm:text-sm">{pct(r[k][1], 0)}</span></>}</td>)}</tr>)}
      </Table></div>
      <p className="mt-2 text-xs text-slate-400">IRR · (최대낙폭), 각 연도 1월 시작 ~ 현재.</p>
    </details>
    <details className="mt-2 rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-200">5년 보유 구간별 결과 ({bt.fiveRange[0]}~{bt.fiveRange[1]}년 시작)</summary>
      <div className="mt-3"><Table head={['구간', ...order.map(k => label(k))]}>
        {bt.fiveYear.map(r => <tr key={r.year}><td className={tdL}>{r.year}~{r.year + 5}</td>{order.map(k => <td key={k} className={`${td} ${k !== 'qqq' && r[k] != null && r[k] < r.qqq ? 'text-rose-300' : ''}`}>{pct(r[k])}{r.mdd?.[k] != null && <span className="block text-xs text-slate-500 sm:ml-1 sm:inline sm:text-sm">{pct(r.mdd[k], 0)}</span>}</td>)}</tr>)}
      </Table></div>
      <p className="mt-2 text-xs text-slate-400">IRR · (최대낙폭). 빨간색: 같은 기간 QQQ 적립보다 IRR이 낮음. 구간이 겹치므로 독립 표본이 아닙니다.</p>
    </details>
    <details className="mt-2 rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-200">계산 기준</summary>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
        {order.map(k => <li key={k}><Dot k={k}/>{label(k)}: {RULES[k]}</li>)}
        {(bt.assumptions || []).map((a, i) => <li key={i}>· {a}</li>)}
      </ul>
    </details>
  </div>;
}
