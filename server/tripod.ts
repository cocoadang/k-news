export type TripodSignal = {asOf: string; state: '3x' | '1.5x' | 'cash'; distance: number; drawdown: number; vix: number};

export function calculateTripod(csv: string): TripodSignal {
  const closes: number[] = [], volatility: number[] = [];
  let state: TripodSignal['state'] = 'cash';
  let signal: TripodSignal | undefined;
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
    signal = {asOf, state, distance, drawdown, vix: mean};
  }
  if (!signal) throw new Error('Insufficient Tripod history');
  return signal;
}

export async function fetchTripod(): Promise<TripodSignal> {
  const url = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=NASDAQ100,VIXCLS&cosd=1989-01-01';
  const response = await fetch(url, {signal: AbortSignal.timeout(9000)});
  if (!response.ok) throw new Error('Tripod market history unavailable');
  return calculateTripod(await response.text());
}
