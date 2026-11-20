export type TripodSignal = {asOf: string; state: '3x' | '1.5x' | 'cash'; distance: number; drawdown: number; vix: number};

function tripodHistory(csv: string): TripodSignal[] {
  const closes: number[] = [], volatility: number[] = [];
  let state: TripodSignal['state'] = 'cash';
  const signals: TripodSignal[] = [];
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [asOf, ndxCell, vixCell] = line.split(',');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) continue;
    const ndx = Number(ndxCell), vix = Number(vixCell);
    if (ndx > 0) closes.push(ndx);
    if (vix > 0) volatility.push(vix);
    if (!(ndx > 0 && vix > 0) || closes.length < 252 || volatility.length < 10) continue;
    const distance = (ndx / (closes.slice(-250).reduce((a, b) => a + b, 0) / 250) - 1) * 100;
    const drawdown = (1 - ndx / Math.max(...closes.slice(-252))) * 100;
    const mean = volatility.slice(-10).reduce((a, b) => a + b, 0) / 10;
    if (distance >= 1) state = mean < 28 && drawdown <= 9 ? '3x' : '1.5x';
    else if (distance <= -5) state = mean < 18 ? '1.5x' : 'cash';
    signals.push({asOf, state, distance, drawdown, vix: mean});
  }
  if (!signals.length) throw new Error('Insufficient Tripod history');
  return signals;
}

export function calculateTripod(csv: string): TripodSignal {
  return tripodHistory(csv).at(-1)!;
}

async function fetchHistory(): Promise<TripodSignal[]> {
  const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQ100,VIXCLS&cosd=1989-01-01';
  const response = await fetch(url, {signal: AbortSignal.timeout(9000)});
  if (!response.ok) throw new Error('Tripod market history unavailable');
  return tripodHistory(await response.text());
}

export async function fetchTripod(): Promise<TripodSignal> {
  return (await fetchHistory()).at(-1)!;
}

const holdingsByState = {'3x': [0, 0, 1, 0], '1.5x': [.5, .5, 0, 0], cash: [0, 0, 0, 1]};
const eastern = new Intl.DateTimeFormat('sv-SE', {timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'});
const start = '2026-11-02';

async function adjustedCloses(symbol: string) {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`, {
    headers: {'User-Agent': 'Mozilla/5.0'}, signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error('ETF history unavailable');
  const result = (await response.json()).chart?.result?.[0];
  const times: number[] = result?.timestamp;
  const closes: number[] = result?.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(times) || !Array.isArray(closes) || times.length !== closes.length) throw new Error('ETF data incomplete');
  const today = eastern.format(new Date());
  const regularEnd = result?.meta?.currentTradingPeriod?.regular?.end;
  return new Map(times.flatMap((time, i) => {
    const day = eastern.format(new Date(time * 1000));
    const close = closes[i];
    const complete = day < today || (day === today && Number.isFinite(regularEnd) && Date.now() >= regularEnd * 1000 && eastern.format(new Date(regularEnd * 1000)) === today);
    return complete && Number.isFinite(close) && close > 0 ? [[day, close] as const] : [];
  }));
}

export async function fetchTripodPortfolio() {
  const stable = await Promise.all([fetchHistory(), adjustedCloses('QQQ'), adjustedCloses('QLD'), adjustedCloses('TQQQ')] as const);
  const [signals, qqq, qld, tqqq] = stable;
  const days = [...qqq.keys()].sort();
  const first = days.indexOf(start);
  if (first < 1) throw new Error('Tripod tracking start unavailable');
  let priorIndex = 0, previousState: TripodSignal['state'] | undefined, previousValue = 1, unit = 1, peak = 1, mdd = 0;
  let previousMonth = '';
  const holdings = [0, 0, 0, 0];
  const series: [string, number][] = [];
  for (let i = first; i < days.length; i++) {
    const day = days[i];
    while (priorIndex + 1 < signals.length && signals[priorIndex + 1].asOf < day) priorIndex++;
    if (signals[priorIndex].asOf !== days[i - 1]) break;
    const prices = [qqq.get(day), qld.get(day), tqqq.get(day), 1];
    if (prices.some(price => price === undefined)) break;
    const price = prices as number[];
    const before = holdings.reduce((sum, count, i) => sum + count * price[i], 0);
    const month = day.slice(0, 7);
    const deposit = month !== previousMonth ? 1 : 0;
    previousMonth = month;
    const state = signals[priorIndex].state;
    const switched = previousState !== state;
    const available = switched ? holdings.reduce((sum, count, i) => sum + count * price[i] * (i === 3 ? 1 : .9975), deposit) : deposit;
    holdingsByState[state].forEach((weight, i) => {
      holdings[i] = (switched ? 0 : holdings[i]) + available * weight * (i === 3 ? 1 : .9975) / price[i];
    });
    previousState = state;
    const after = holdings.reduce((sum, count, i) => sum + count * price[i], 0);
    unit *= series.length ? before / previousValue * after / (before + deposit) : after;
    previousValue = after;
    peak = Math.max(peak, unit);
    mdd = Math.min(mdd, (unit / peak - 1) * 100);
    series.push([day, unit]);
  }
  if (!series.length) throw new Error('Tripod tracking history unavailable');
  return {start, asOf: series.at(-1)![0], series, twr: (unit - 1) * 100, mdd};
}
