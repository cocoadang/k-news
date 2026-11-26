import React, {useEffect, useMemo, useRef, useState} from 'react';
import {chipClass} from './ui';
import {tripodVariants, tripodLiveSeed} from './tripodBacktest';
import {useLang, tr, getLang} from '../i18n';
import {startVisiblePolling} from '../screenPolling';
import type {MarketIndicators} from '../../server/marketIndicators';

// 나스닥 전략 비교 — 자료 출처는 KS Wealth OS(asset.dsoom.com)
//  · 백테스트: https://asset.dsoom.com/strategy-backtest.json (CORS: news.dsoom.com 허용)
//  · 실전 추적: Firestore kswealth_public/strategy (공개 읽기, 금액·계좌 정보 없음)
const BACKTEST_URL = 'https://asset.dsoom.com/strategy-backtest.json';
const LIVE_URL = 'https://firestore.googleapis.com/v1/projects/busan-redevelopment/databases/(default)/documents/kswealth_public/strategy';
const COLORS: Record<string, string> = {old: '#e0a040', b3325: '#4c9be8', mubot: '#e06a70', qqq: '#a07ee6', tripod: '#39c9a0'};
const ORDER = ['old', 'b3325', 'mubot', 'qqq'];
const LABELS = (): Record<string, string> => ({tripod: tr('트라이팟', 'Tripod'), old: '5/10/20', b3325: '3/25', mubot: tr('무한매수 20분할', 'Infinite Buying (20 splits)'), qqq: tr('QQQ 적립', 'QQQ DCA')});
const RULES = (): Record<string, string> => ({
  tripod: tr('250일선 대비 +1% 이상이면 VIX 평균 28 미만 및 52주 낙폭 9% 이내에서 TQQQ 100%, 그 외는 QQQ·QLD 각 50%. −5% 이하에서는 VIX 평균 18 미만이면 QQQ·QLD 각 50%, 그 외는 현금 100%. 중간 구간에서는 직전 신호 유지.', 'At +1% or above vs. the 250-day MA, use 100% TQQQ if average VIX is below 28 and drawdown is at most 9%; otherwise split 50/50 between QQQ and QLD. At −5% or below, split 50/50 between QQQ and QLD if average VIX is below 18; otherwise use 100% cash. In between, retain the previous signal.'),
  b3325: tr('하락폭 3% 미만 SGOV · 3~25% QQQ · 25% 이상 TQQQ(+SGOV를 1/6씩 이동) · 전고점 돌파 시 TQQQ→QQQ', 'Drawdown <3% SGOV · 3–25% QQQ · ≥25% TQQQ (+move SGOV in 1/6 steps) · at a new high TQQQ→QQQ'),
  old: tr('하락폭 5% 미만 SGOV · 5~10% SCHD · 10~20% QQQ · 20% 이상 TQQQ · 전고점 돌파 시 TQQQ→QQQ', 'Drawdown <5% SGOV · 5–10% SCHD · 10–20% QQQ · ≥20% TQQQ · at a new high TQQQ→QQQ'),
  mubot: tr('라오어 무한매수 V4.0(TQQQ 20분할) 근사 이식', 'Approximation of Laoer\'s Infinite Buying V4.0 (TQQQ, 20 splits)'),
  qqq: tr('같은 날 같은 금액을 QQQ에 적립', 'Same amount into QQQ on the same days'),
});
const VARIANT_EN: Record<string, string> = {
  gfc: 'GFC low',
  trade: 'US–China trade war low',
  covid: 'COVID low',
  rate: '2022 rate-hike low',
};
const ASSUMPTIONS_EN = [
  'First contribution on each low date, then a fixed amount on the first trading day of every month; signal from the prior close, trades at the same-day close; 0.25% fee on each buy and sell',
  'USD price returns (FX ignored), dividends reinvested (adjusted close)',
  'After tax: (annual realized gain − ₩2.5M) × 22%, paid the following June, assuming everything is sold at the end',
  'Max drawdown measured on unit value (contribution effect removed)',
  'Before TQQQ listed (2010-02-11), TQQQ is synthesized as 3× daily QQQ (net of fees and rates). Infinite Buying open/high use QQQ open/high change vs prior close × 3 (may differ from the real intraday 3× path) — affects the GFC-start result',
  'Infinite Buying is an approximation: an external check (original bot) gave 12.72% pre-tax and −55.40% max drawdown for a 20-split start in 2011-11',
];

type Live = {asOf: string; start: string; updatedAt: number; order?: string[];
  market: {dd?: number; peak?: number; vix?: {value?: number; label?: string; percentile?: number}; fearGreed?: {score?: number; label?: string}; stale?: boolean};
  virtual: Record<string, {label: string; twr: number | null; mdd: number; series: [string, number][]; bucket: string | null; deployLeft: number | null;
    mubot: {mode: string; T: number; avgUsd: number; closeUsd: number} | null}>};
type Strat = {label: string; note: string; irr?: number; irrLiq?: number; mdd?: number; final?: number; invested?: number; curve?: [string, number, number][]; na?: string};
type Variant = {name: string; label: string; period: [string, string]; strategies: Record<string, Strat>};
type Backtest = {monthly: number; dataEnd: string; order?: string[]; variants: Record<string, Variant>; assumptions?: string[];
  startYears: Record<string, any>[]; fiveYear: Record<string, any>[]; startRange: [number, number]; fiveRange: [number, number];
  summary: Record<string, {startAvg: number; startWorstMdd: number; fiveAvg: number; fiveMin: number; fiveBeatQqq: number | null; fiveN: number}>};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const pct = (v: unknown, d = 2) => { const n = num(v); return n === null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(d)}%`; };
const won = (v: unknown) => { const n = num(v); if (n === null) return '—'; const a = Math.abs(n); const sign = n < 0 ? '−' : '';
  if (getLang() === 'en') return sign + (a >= 1e9 ? `₩${(a / 1e9).toFixed(2)}B` : `₩${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`);
  return sign + (a >= 1e8 ? `${(a / 1e8).toFixed(2)}억` : `${Math.round(a / 1e4).toLocaleString('ko-KR')}만`); };
const dot = (d: string) => d.replace(/-/g, '.');
const label = (k: string, fallback?: string) => LABELS()[k] || fallback || k;

function Dot({k}: {k: string}) { return <span className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle" style={{background: COLORS[k]}} aria-hidden="true"/>; }

type Line = {key: string; label: string; color: string; dashed?: boolean; width?: number; points: {t: number; y: number}[]};
function LineChart({lines, yFormat, height = 240, ariaLabel, showHint = true}: {lines: Line[]; yFormat: (v: number) => string; height?: number; ariaLabel: string; showHint?: boolean}) {
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
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block h-auto w-full max-w-full touch-pan-y select-none" role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {ticks.map((v, i) => <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#1e293b"/><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#94a3b8">{yFormat(v)}</text></g>)}
      {xt.map((t, i) => <text key={i} x={x(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle'} fontSize="11" fill="#94a3b8">{fmtT(t)}</text>)}
      {lines.map(l => <polyline key={l.key} fill="none" stroke={l.color} strokeWidth={l.width ?? (l.dashed ? 1 : 2)} strokeDasharray={l.dashed ? (l.width ? '6 5' : '4 4') : undefined} strokeLinejoin="round"
        points={l.points.map(p => `${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ')}/>)}
      {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={T} y2={H - B} stroke="#64748b" strokeDasharray="3 3"/>}
    </svg>
    <p className="mt-1 min-h-[1.25rem] text-xs text-slate-400" aria-live="polite">{hp ? <>{dot(new Date(hp.t).toISOString().slice(0, 10))} · {lines.map(l => `${l.label} ${yFormat(near(l, hp.t).y)}`).join(' · ')}</> : showHint ? tr('그래프 위를 누르거나 움직이면 값이 보입니다.', 'Tap or hover over the chart to see values.') : null}</p>
  </div>;
}

function Table({head, children, mobileHide = [], history = false}: {head: string[]; children: React.ReactNode; mobileHide?: number[]; history?: boolean}) {
  return <div role="region" aria-label={tr('전략 비교 표 · 좌우로 이동', 'Strategy comparison table · scroll horizontally')} tabIndex={0} className="strategy-table -mx-1 overflow-x-auto px-1 focus-visible:outline-2 focus-visible:outline-cyan-400"><table className={`w-full border-collapse text-[13px] sm:text-sm ${history ? 'min-w-[520px] table-fixed' : ''}`}>
    {history && <colgroup><col className="w-[24%]"/><col className="w-[19%]"/><col className="w-[19%]"/><col className="w-[19%]"/><col className="w-[19%]"/></colgroup>}
    <thead><tr>{head.map((h, i) => <th key={h} className={`border-b border-slate-800 px-1.5 sm:px-2 py-2 text-xs font-medium text-slate-400 ${i ? 'text-right' : 'text-left'} ${mobileHide.includes(i) ? 'hidden sm:table-cell' : ''}`}>{h}</th>)}</tr></thead>
    <tbody>{children}</tbody></table></div>;
}
const td = 'border-b border-slate-800/70 px-1.5 sm:px-2 py-2 text-right tabular-nums whitespace-nowrap';
const tdL = 'border-b border-slate-800/70 px-1.5 sm:px-2 py-2 text-left whitespace-nowrap';
const mh = 'hidden sm:table-cell';
const card = 'strategy-card min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5';

function Kpi({title, value, sub, tone}: {title: string; value: string; sub: string; tone?: 'ok' | 'warn' | 'bad'}) {
  const c = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-300' : 'text-white';
  return <div className="strategy-kpi h-full min-w-0 rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 sm:px-3.5 sm:py-3">
    <p className="pr-4 text-xs leading-4 text-slate-400">{title}</p>
    <p className={`mt-1 text-xl font-bold leading-6 tabular-nums ${c}`}>{value}</p>
    <p className="mt-0.5 text-xs leading-4 text-slate-400">{sub}</p>
  </div>;
}

export function StrategyMenu() {
  const {t, lang} = useLang();
  const [live, setLive] = useState<Live | null>(null), [bt, setBt] = useState<Backtest | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [variant, setVariant] = useState<string>('');
  useEffect(() => {
    const c = new AbortController(); setStatus('loading');
    Promise.all([
      fetch(LIVE_URL, {signal: c.signal}).then(r => r.ok ? r.json() : Promise.reject(Error('live'))).then(d => JSON.parse(d.fields.payload.stringValue) as Live).catch(e => { if (e.name === 'AbortError') throw e; return null; }),
      fetch(BACKTEST_URL, {signal: c.signal}).then(r => r.ok ? r.json() as Promise<Backtest> : Promise.reject(Error('backtest'))).catch(e => { if (e.name === 'AbortError') throw e; return null; }),
    ]).then(([l, b]) => { setLive(l); setBt(b); setStatus(l || b ? 'ready' : 'error'); if (b && !variant) setVariant(Object.keys(b.variants)[0]); })
      .catch(e => { if (e.name !== 'AbortError') setStatus('error'); });
    return () => c.abort();
  }, []);

  return <section aria-label={t('나스닥 전략', 'Nasdaq strategy')} className="strategy-menu min-w-0 space-y-4 text-slate-200">
    {status === 'loading' && <p role="status">{t('자료를 불러오는 중입니다.', 'Loading…')}</p>}
    {status === 'error' && <p role="alert">{t('자료를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.', 'Could not load data. Please refresh in a moment.')}</p>}
    <MarketIndicatorCards live={live}/>
    {live && <LiveSection live={live}/>}
    {bt && variant && <BacktestSection key={lang} bt={bt} variant={variant} setVariant={setVariant}/>}
  </section>;
}

// Historical daily-close snapshot. The current market cards update independently.
const indicatorHistory = {
  vix: {
    start: '1990-01-02', end: '2026-11-20', mean: 19.42, close: 35.89,
    rows: [
      ["≥ 20",258,"2026-11-16",15],
      ["≥ 25",171,"2026-11-19",21],
      ["≥ 30",94,"2026-11-20",26],
      ["≥ 40",33,"2025-04-10",21],
    ],
  },
  fear: {
    start: '2021-02-01', end: '2026-11-20', mean: 46.84, close: 9.67,
    rows: [
      ["extreme fear",39,"2026-11-19",21],
      ["fear",88,"2026-11-09",14],
      ["neutral",90,"2026-10-12",14],
      ["greed",60,"2026-08-27",21],
      ["extreme greed",13,"2025-07-23",57],
    ],
  },
  rsi: {
    start: '2016-12-12', end: '2026-11-20', mean: 56.21, close: 26.63,
    rows: [
      ["≤ 20",0,null,null],
      ["≤ 30",18,"2026-11-20",109],
      ["≥ 70",64,"2026-05-21",22],
      ["≥ 80",13,"2026-05-14",150],
    ],
  },
} as const;

type IndicatorHistoryKey = keyof typeof indicatorHistory;

const indicatorRatingKo: Record<string, string> = {
  'extreme fear': '극단적 공포', fear: '공포', neutral: '중립', greed: '탐욕', 'extreme greed': '극단적 탐욕',
};

function annualEntryRate(count: number, start: string, end: string) {
  const years = (Date.parse(end) - Date.parse(start)) / (86_400_000 * 365.2425);
  return (count / years).toFixed(2);
}

function IndicatorHistory({indicator}: {indicator: IndicatorHistoryKey}) {
  const {t, lang} = useLang();
  const history = indicatorHistory[indicator];
  const delta = history.close - history.mean;
  const formattedDelta = `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`;
  return <section id="indicator-history" className={`${card} col-span-full`}>
    <h3 className="text-sm font-semibold text-white">{t('과거 발생 통계', 'Historical threshold entries')} · {indicator === 'vix' ? 'VIX' : indicator === 'fear' ? 'Fear & Greed' : 'QQQ RSI(14)'}</h3>
    <p className="mt-1 text-xs text-slate-400">{history.start}~{history.end} · {t('평균', 'Mean')} {history.mean.toFixed(2)} · {t('마지막 관측값', 'Last observation')} {history.close.toFixed(2)} ({t('평균 대비', 'vs. mean')} {formattedDelta})</p>
    <div className="mt-2 text-xs sm:text-sm"><Table history head={[t('구간', 'Threshold'), t('발생 횟수', 'Entries'), t('발생 빈도', 'Frequency'), t('최근 도달일', 'Last entry'), t('간격 중앙값', 'Median gap')]}>
      {history.rows.map(([threshold, count, date, median]) => <tr key={threshold}>
        <th scope="row" className={`${tdL} font-medium`}>{lang !== 'en' && indicator === 'fear' ? indicatorRatingKo[threshold] : threshold}</th>
        <td className={td}>{count.toLocaleString()}</td>
        <td className={td}>{annualEntryRate(count, history.start, history.end)}{t('회/년', '/year')}</td>
        <td className={td}>{date ?? '—'}</td>
        <td className={td}>{median === null ? '—' : t(`${median}일`, `${median} days`)}</td>
      </tr>)}
    </Table></div>
    <p className="mt-2 text-xs leading-5 text-slate-400">{t('구간에 처음 진입한 날을 집계합니다. 연속 체류는 1회이며, 간격은 달력일 기준입니다.', 'Each entry into a band counts once. Consecutive sessions in the same band count as one entry. Gaps use calendar days.')}</p>
    {indicator === 'fear' && <p className="mt-1 text-xs leading-5 text-slate-400">{t('CNN 일별 기록의 보관본을 사용했습니다. 위 카드의 최신 표시값과 관측 시점이 다를 수 있습니다.', 'Uses archived CNN daily observations. Their observation times can differ from the latest reading above.')}</p>}
  </section>;
}

function IndicatorHistoryButton({label, open, onToggle}: {label: string; open: boolean; onToggle: () => void}) {
  return <button type="button" aria-expanded={open} aria-controls={open ? 'indicator-history' : undefined}
    aria-label={label}
    className="absolute inset-0 cursor-pointer rounded-xl text-slate-400 hover:ring-1 hover:ring-cyan-400/60 focus-visible:outline focus-visible:outline-cyan-400"
    onClick={onToggle}>
    <span aria-hidden="true" className="absolute right-2 top-2 text-xs">{open ? '▴' : '▾'}</span>
  </button>;
}

const quoteDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
function MarketIndicatorCards({live}: {live: Live | null}) {
  const {t} = useLang();
  const [quotes, setQuotes] = useState<MarketIndicators | null>(null);
  const [drawdownsOpen, setDrawdownsOpen] = useState(false);
  const [activeIndicator, setActiveIndicator] = useState<IndicatorHistoryKey | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const response = await fetch('/api/market/indicators', {signal: controller.signal});
        if (!response.ok) throw new Error('Market indicators unavailable');
        const latest: MarketIndicators = await response.json();
        if (!controller.signal.aborted) setQuotes(latest);
      } catch {
        if (!controller.signal.aborted) setQuotes({ndx: null, vix: null, fearGreed: null, rsi: null});
      } finally {
        pending = false;
      }
    };
    const stop = startVisiblePolling(refresh, document, 180_000);
    return () => {
      stop();
      controller.abort();
    };
  }, []);

  const m = live?.market;
  const ndx = quotes?.ndx;
  const usableNdx = ndx && (!live || quoteDate.format(new Date(ndx.asOf)) >= live.asOf) ? ndx : null;
  const peak = usableNdx ? Math.max(num(m?.peak) ?? 0, usableNdx.drawdownAverage?.peak ?? 0, usableNdx.recentClosingPeak, usableNdx.value) : num(m?.peak);
  const dd = usableNdx && peak ? (1 - usableNdx.value / peak) * 100 : num(m?.dd);
  const vixQuote = quotes?.vix && (!live || quoteDate.format(new Date(quotes.vix.asOf)) >= live.asOf) ? quotes.vix : null;
  const vix = vixQuote?.value ?? num(m?.vix?.value);
  const fg = quotes?.fearGreed?.value ?? num(m?.fearGreed?.score);
  const rsi = quotes?.rsi;
  const availability = quotes ? t('데이터를 불러올 수 없음', 'Data unavailable') : t('불러오는 중', 'Loading');
  const drawdownAverage = ndx?.drawdownAverage;
  const compare = (value: number | null, mean?: number, unit = 'p') => {
    if (value === null) return availability;
    if (mean === undefined || !Number.isFinite(mean)) return t('평균 비교 자료 없음', 'Mean comparison unavailable');
    const delta = value - mean;
    return t(`평균 ${mean.toFixed(2)}${unit === '%p' ? '%' : ''} 대비 ${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}${unit}`,
      `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}${unit === '%p' ? ' pp' : ' pts'} vs. mean ${mean.toFixed(2)}${unit === '%p' ? '%' : ''}`);
  };
  const toggleIndicator = (indicator: IndicatorHistoryKey) => {
    setDrawdownsOpen(false);
    setActiveIndicator(current => current === indicator ? null : indicator);
  };
  return <>
    <div className="grid grid-cols-2 gap-2.5">
      <div className="relative min-w-0">
        <Kpi title={t('나스닥100 하락폭', 'Nasdaq-100 drawdown')} value={dd === null ? '—' : dd === 0 ? '0.00%' : `−${dd.toFixed(2)}%`}
          sub={compare(dd === null ? null : -dd, drawdownAverage ? -drawdownAverage.mean : undefined, '%p')}
          tone={dd === null ? undefined : dd < 10 ? 'ok' : dd < 20 ? 'warn' : 'bad'}/>
        <button type="button" aria-expanded={drawdownsOpen} aria-controls="nasdaq-drawdown-history"
          aria-label={t('나스닥100 하락폭 발생 통계', 'Nasdaq-100 drawdown frequency')}
          className="absolute inset-0 cursor-pointer rounded-xl text-slate-400 hover:ring-1 hover:ring-cyan-400/60 focus-visible:outline focus-visible:outline-cyan-400"
          onClick={() => { setActiveIndicator(null); setDrawdownsOpen(open => !open); }}>
          <span aria-hidden="true" className="absolute right-2 top-2 text-xs">{drawdownsOpen ? '▴' : '▾'}</span>
        </button>
      </div>
      <div className="relative min-w-0">
        <Kpi title="VIX" value={vix === null ? '—' : vix.toFixed(2)}
          sub={compare(vix, indicatorHistory.vix.mean)}
          tone={vix === null ? undefined : vix < 20 ? 'ok' : vix < 30 ? 'warn' : 'bad'}/>
        <IndicatorHistoryButton label={t('VIX 과거 발생 통계', 'VIX historical entries')} open={activeIndicator === 'vix'} onToggle={() => toggleIndicator('vix')}/>
      </div>
      <div className="relative min-w-0">
        <Kpi title="Fear & Greed" value={fg === null ? '—' : fg.toFixed(1)}
          sub={compare(fg, indicatorHistory.fear.mean)}
          tone={fg === null ? undefined : fg < 25 || fg > 75 ? 'bad' : fg < 45 || fg > 55 ? 'warn' : undefined}/>
        <IndicatorHistoryButton label={t('Fear & Greed 과거 발생 통계', 'Fear & Greed historical entries')} open={activeIndicator === 'fear'} onToggle={() => toggleIndicator('fear')}/>
      </div>
      <div className="relative min-w-0">
        <Kpi title={t('QQQ RSI(14) · 참고용', 'QQQ RSI(14) · Reference')} value={rsi ? rsi.value.toFixed(1) : '—'}
          sub={compare(rsi?.value ?? null, indicatorHistory.rsi.mean)}/>
        <IndicatorHistoryButton label={t('QQQ RSI 과거 발생 통계', 'QQQ RSI historical entries')} open={activeIndicator === 'rsi'} onToggle={() => toggleIndicator('rsi')}/>
      </div>
      {activeIndicator && <IndicatorHistory indicator={activeIndicator}/>}
      <section id="nasdaq-drawdown-history" hidden={!drawdownsOpen} className={`${card} col-span-full`}>
        <h3 className="text-sm font-semibold text-white">{t('나스닥100 하락폭 발생 통계', 'Nasdaq-100 drawdown frequency')}</h3>
        {drawdownAverage && <p className="mt-1 text-xs text-slate-400">{drawdownAverage.start}~{drawdownAverage.end} · {t('나스닥100 일별 종가의 조회 기간 내 전고점 대비 하락폭 평균', 'Mean drawdown from the running high within the displayed Nasdaq-100 daily series')} −{drawdownAverage.mean.toFixed(2)}%</p>}
        {peak !== null && <p className="mt-1 text-xs text-slate-400">{t('전고점', 'Peak')} {Math.round(peak).toLocaleString('en-US')}</p>}
        <div className="mt-2 text-xs sm:text-sm"><Table history head={[
          t('전고점 대비 하락폭', 'Drawdown from peak'),
          t('발생 횟수', 'Entries'),
          t('발생 빈도', 'Frequency'),
          t('최근 도달일', 'Last entry'),
          t('간격 중앙값', 'Median gap'),
        ]}>
          {([
            [10, 35, '2026-11-02', t('약 7개월', '≈7 months')],
            [20, 8, '2025-04-04', t('약 2.8년', '≈2.8 years')],
            [30, 4, '2022-06-13', t('약 9.5년', '≈9.5 years')],
            [40, 1, '2000-11-20', '—'],
            [50, 1, '2000-12-20', '—'],
          ] as const).map(([threshold, count, date, median]) => <tr key={threshold}>
            <th scope="row" className={`${tdL} font-medium`}>−{threshold}%</th>
            <td className={td}>{count}</td>
            <td className={td}>{annualEntryRate(count, '1986-01-02', '2026-11-20')}{t('회/년', '/year')}</td>
            <td className={td}>{date}</td>
            <td className={td}>{median}</td>
          </tr>)}
        </Table></div>
        <p className="mt-2 text-xs leading-5 text-slate-400">{t(
          '1986.01.02~2026.11.20 나스닥100 일별 종가. 전고점 회복 전에는 각 하락폭의 첫 도달만 집계했습니다. 간격 중앙값은 연속 도달일 사이의 간격으로, 1회 발생 시에는 표시하지 않습니다.',
          'Nasdaq-100 daily closes, Jan 2, 1986–Nov 20, 2026. Each threshold is counted on its first hit before recovery to the previous peak. The median uses gaps between successive hits and is unavailable for a single hit.',
        )}</p>
      </section>
    </div>
  </>;
}

function LiveSection({live}: {live: Live}) {
  const {t, lang} = useLang();
  const order = (live.order || ORDER).filter(k => live.virtual[k]);
  const [activeRule, setActiveRule] = useState<string | null>(null);
  const [tripod, setTripod] = useState<typeof tripodLiveSeed | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => {
      fetch('/api/market/tripod-portfolio', {signal: controller.signal})
        .then(response => response.ok ? response.json() : null)
        .then(result => { if (result && !controller.signal.aborted) setTripod(result); })
        .catch(() => {});
    };
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 600_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  const tracked = tripod?.start === live.start && tripod.asOf >= tripodLiveSeed.asOf ? tripod : tripodLiveSeed.start === live.start ? tripodLiveSeed : null;
  const lines: Line[] = order.map(k => ({key: k, label: label(k, live.virtual[k].label), color: COLORS[k],
    dashed: k === 'qqq', width: k === 'qqq' ? 2 : undefined,
    points: live.virtual[k].series.map(([d, u]) => ({t: Date.parse(d), y: u * 100}))}));
  if (tracked) lines.push({key: 'tripod', label: label('tripod'), color: COLORS.tripod, points: tracked.series.map(([d, u]) => ({t: Date.parse(d), y: u * 100}))});
  const strategyButton = (key: string, name: React.ReactNode) => {
    if (!RULES()[key]) return <><Dot k={key}/>{name}</>;
    const expanded = activeRule === key;
    return <button type="button" aria-expanded={expanded} aria-controls={`live-rule-${key} mobile-live-rule-${key}`}
      className="inline-flex min-h-11 sm:min-h-7 max-w-full cursor-pointer select-none items-center rounded text-left hover:text-cyan-300 focus-visible:outline focus-visible:outline-cyan-400"
      onClick={() => setActiveRule(expanded ? null : key)}>
      <Dot k={key}/>{name}
      <span aria-hidden="true" className="ml-1 text-xs text-slate-400">{expanded ? '▴' : '▾'}</span>
    </button>;
  };
  const ruleRow = (key: string) => <tr id={`live-rule-${key}`} hidden={activeRule !== key}>
    <td colSpan={3} className="border-b border-slate-800/70 bg-slate-900 px-3 py-2 text-left text-xs leading-5 text-slate-300">
      {RULES()[key]}
    </td>
  </tr>;
  return <>
    <div className={card}>
      <h2 className="text-base font-semibold text-white">{t('실전 추적', 'Live tracking')}</h2>
      <p className="mt-1 text-sm text-slate-400">{lang === 'en' ? <>Virtual accounts adding the same amount on the first trading day of each month since {dot(live.start)} · as of {dot(live.asOf)}</> : <>{dot(live.start)}부터 매달 첫 거래일에 같은 금액을 넣은 가상 계좌 · 기준 {dot(live.asOf)}</>}</p>
      <div className="mt-3 space-y-2 sm:hidden" aria-label={t('모바일 전략별 실전 추적', 'Mobile strategy tracking')}>
        {[...order, 'tripod'].map(k => {
          const v = k === 'tripod' ? null : live.virtual[k];
          return <div key={k} className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-x-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2">
              <div className="min-w-0 text-sm font-semibold leading-5 break-keep">{strategyButton(k, label(k, v?.label))}</div>
            <div><div className="text-xs text-slate-400">{t('수익률', 'Return')}</div><div className="text-sm font-semibold tabular-nums">{pct(k === 'tripod' ? tracked?.twr : v?.twr)}</div></div>
            <div><div className="text-xs text-slate-400">{t('최대낙폭', 'Max DD')}</div><div className="text-sm font-semibold tabular-nums">{pct(k === 'tripod' ? tracked?.mdd : v?.mdd)}</div></div>
            {activeRule === k && <p id={`mobile-live-rule-${k}`} className="col-span-full border-t border-slate-800 py-2 text-xs leading-5 text-slate-300">{RULES()[k]}</p>}
            {k === 'tripod' && tracked && tracked.asOf !== live.asOf && <p className="col-span-full pb-2 text-xs text-slate-400">{t('평가 기준', 'Valued through')} {dot(tracked.asOf)}</p>}
          </div>;
        })}
      </div>
      <div className="mt-3 hidden sm:block"><Table head={[t('전략', 'Strategy'), t('수익률', 'Return'), t('최대낙폭', 'Max DD')]}>

        {order.map(k => { const v = live.virtual[k]; return <React.Fragment key={k}><tr><td className={tdL}>{strategyButton(k, k === 'mubot' ? <>{t('무한매수', 'Infinite Buying')}<span className="hidden sm:inline">{t(' 20분할', ' (20)')}</span></> : label(k, v.label))}</td><td className={td}>{pct(v.twr)}</td><td className={td}>{pct(v.mdd)}</td>
          </tr>{ruleRow(k)}</React.Fragment>; })}
        <tr>
          <td className={tdL}>{strategyButton('tripod', label('tripod'))}
            {tracked && tracked.asOf !== live.asOf && <span className="block text-xs font-normal text-slate-400">{t('평가 기준', 'Valued through')} {dot(tracked.asOf)}</span>}
          </td>
          <td className={td}>{pct(tracked?.twr)}</td>
          <td className={td}>{pct(tracked?.mdd)}</td>
        </tr>
        {ruleRow('tripod')}
      </Table></div>
      <div className="mt-4"><LineChart lines={lines} yFormat={v => v.toFixed(1)} height={220} showHint={false} ariaLabel={t('실전 추적 가상 계좌 단위가치', 'Live tracking unit value')}/></div>

    </div>
  </>;
}

function BacktestSection({bt, variant, setVariant}: {bt: Backtest; variant: string; setVariant: (v: string) => void}) {
  const {t, lang} = useLang();
  const vName = (k: string, v: Variant) => (lang === 'en' ? VARIANT_EN[k] ?? v.name : v.name);
  const order = bt.order || ORDER, V = bt.variants[variant] || Object.values(bt.variants)[0];
  const comparison = tripodVariants[variant];
  const includeTripod = comparison && comparison.start === V.period[0] && comparison.end === V.period[1]
    && V.strategies.qqq?.invested === comparison.invested && bt.monthly === 1_000_000;
  const primaryOrder = includeTripod ? [...order, 'tripod'] : order;
  const S: Record<string, Strat> = includeTripod ? {...V.strategies, tripod: {...comparison, label: 'Tripod', note: ''}} : V.strategies;
  const ok = primaryOrder.filter(k => S[k] && !S[k].na);
  const best = (f: (k: string) => number | undefined) => Math.max(...ok.map(f).filter((v): v is number => num(v) !== null));
  const bI = best(k => S[k].irr), bL = best(k => S[k].irrLiq), bM = best(k => S[k].mdd);
  const cls = (v: number | undefined, b: number) => `${td} ${v === b ? 'font-bold text-white' : ''}`;
  const lines: Line[] = useMemo(() => {
    const ls: Line[] = ok.map(k => ({key: k, label: label(k, S[k].label), color: COLORS[k], dashed: k === 'qqq', width: k === 'qqq' ? 2 : undefined, points: (S[k].curve || []).map(p => ({t: Date.parse(p[0].length > 7 ? p[0] : `${p[0]}-15`), y: p[1]}))}));
    const inv = S[ok[0]]?.curve || [];
    ls.push({key: 'inv', label: t('넣은 돈', 'Contributed'), color: '#94a3b8', dashed: true, points: inv.map(p => ({t: Date.parse(p[0].length > 7 ? p[0] : `${p[0]}-15`), y: p[2]}))});
    return ls;
  }, [bt, variant, lang]);
  const M = bt.summary;
  return <div className={card}>
    <h2 className="text-base font-semibold text-white">{lang === 'en' ? `Backtest — start at a crisis low, add ${won(bt.monthly)} every month` : `백테스트 — 위기 저점에서 시작해 매달 ${Math.round(bt.monthly / 1e4)}만 원 적립`}</h2>
    <div className="mt-3 flex flex-wrap gap-2" aria-label={t('시작 시점', 'Start point')}>{Object.entries(bt.variants).map(([k, v]) =>
      <button key={k} type="button" className={chipClass(k === variant)} aria-pressed={k === variant} onClick={() => setVariant(k)}>{vName(k, v)}</button>)}</div>
    <p className="mt-2 text-sm leading-6 text-slate-400"><span className="font-semibold text-slate-200">{dot(V.period[0])} ~ {dot(V.period[1])}</span></p>
    <div className="mt-3"><Table head={[t('전략', 'Strategy'), t('세전 IRR', 'IRR pre-tax'), t('세후 IRR', 'IRR after tax'), t('최대낙폭', 'Max DD'), t('최종 (넣은 돈)', 'Final (contributed)')]} mobileHide={[4]}>
      {primaryOrder.map(k => { const s = S[k]; if (!s) return null; return s.na
        ? <tr key={k}><td className={tdL}><Dot k={k}/>{label(k, s.label)}</td><td className={`${tdL} text-slate-400`} colSpan={3}>{s.na}</td></tr>
        : <tr key={k}><td className={tdL}><Dot k={k}/>{label(k, s.label)}</td><td className={cls(s.irr, bI)}>{pct(s.irr)}</td><td className={cls(s.irrLiq, bL)}>{pct(s.irrLiq)}</td><td className={cls(s.mdd, bM)}>{pct(s.mdd)}</td><td className={`${td} ${mh}`}>{won(s.final)} ({won(s.invested)})</td></tr>; })}
    </Table></div>
    <div className="mt-4"><LineChart lines={lines} yFormat={v => won(v)} ariaLabel={t('백테스트 자산 곡선', 'Backtest equity curve')}/></div>
    <details className="mt-3 rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-200">{t('매년 1월 시작 결과', 'Starting each January')} ({bt.startRange[0]}–{bt.startRange[1]})</summary>
      <div className="mt-3"><Table head={[t('전략', 'Strategy'), t('시작연도 평균', 'Avg by start yr'), t('최악 낙폭', 'Worst DD'), t('5년 평균', '5-yr avg'), t('5년 최저', '5-yr min'), t('5년 QQQ 이김', 'Beat QQQ (5-yr)')]} mobileHide={[2, 4]}>
        {order.map(k => <tr key={k}><td className={tdL}><Dot k={k}/>{label(k)}</td><td className={td}>{pct(M[k]?.startAvg)}</td><td className={`${td} ${mh}`}>{pct(M[k]?.startWorstMdd)}</td><td className={td}>{pct(M[k]?.fiveAvg)}</td><td className={`${td} ${mh}`}>{pct(M[k]?.fiveMin)}</td><td className={td}>{M[k]?.fiveBeatQqq == null ? '—' : `${M[k].fiveBeatQqq} / ${M[k].fiveN}`}</td></tr>)}
      </Table></div>
      <div className="mt-3"><Table head={[t('시작', 'Start'), ...order.map(k => label(k))]}>
        {bt.startYears.map(r => <tr key={r.year}><td className={tdL}>{r.year}</td>{order.map(k => <td key={k} className={td}>{r[k]?.[0] == null ? '—' : <>{pct(r[k][0])}<span className="block text-xs text-slate-500 sm:ml-1 sm:inline sm:text-sm">{pct(r[k][1], 0)}</span></>}</td>)}</tr>)}
      </Table></div>
      <p className="mt-2 text-xs text-slate-400">{t('IRR · (최대낙폭), 각 연도 1월 시작 ~ 현재.', 'IRR · (max drawdown), from January of each year to today.')}</p>
    </details>
    <details className="mt-2 rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-200">{t('5년 보유 구간별 결과', '5-year holding windows')} ({lang === 'en' ? `starts ${bt.fiveRange[0]}–${bt.fiveRange[1]}` : `${bt.fiveRange[0]}~${bt.fiveRange[1]}년 시작`})</summary>
      <div className="mt-3"><Table head={[t('구간', 'Window'), ...order.map(k => label(k))]}>
        {bt.fiveYear.map(r => <tr key={r.year}><td className={tdL}>{r.year}~{r.year + 5}</td>{order.map(k => <td key={k} className={`${td} ${k !== 'qqq' && r[k] != null && r[k] < r.qqq ? 'text-rose-300' : ''}`}>{pct(r[k])}{r.mdd?.[k] != null && <span className="block text-xs text-slate-500 sm:ml-1 sm:inline sm:text-sm">{pct(r.mdd[k], 0)}</span>}</td>)}</tr>)}
      </Table></div>
      <p className="mt-2 text-xs text-slate-400">{t('IRR · (최대낙폭). 빨간색: 같은 기간 QQQ 적립보다 IRR이 낮음. 구간이 겹치므로 독립 표본이 아닙니다.', 'IRR · (max drawdown). Red: lower IRR than QQQ DCA over the same window. Windows overlap, so they are not independent samples.')}</p>
    </details>
    <details className="mt-2 rounded-lg border border-slate-800 p-3"><summary className="cursor-pointer text-sm font-semibold text-slate-200">{t('계산 기준', 'Method')}</summary>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-slate-400">
        {primaryOrder.map(k => <li key={k}><Dot k={k}/>{label(k)}: {RULES()[k]}</li>)}
        {(lang === 'en' ? ASSUMPTIONS_EN : bt.assumptions || []).map((a, i) => <li key={i}>· {a}</li>)}
      </ul>
    </details>
  </div>;
}
