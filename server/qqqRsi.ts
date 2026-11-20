const chartUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/QQQ?range=1y&interval=1d';
const eastern = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const dateAt = (seconds: number) => eastern.format(new Date(seconds * 1000));

export type QqqRsi = { value: number; asOf: string };

export async function fetchQqqRsi(): Promise<QqqRsi> {
  const response = await fetch(chartUrl, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('QQQ price source unavailable');
  const result = (await response.json()).chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.adjclose?.[0]?.adjclose;
  const closeTime = result?.meta?.currentTradingPeriod?.regular?.end;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length ||
      !Number.isFinite(closeTime)) throw new Error('Invalid QQQ daily history');

  const now = Date.now() / 1000;
  const today = dateAt(now);
  const todayClosed = dateAt(closeTime) === today && now >= closeTime;
  const sessions = new Map<string, number>();
  timestamps.forEach((timestamp, i) => {
    if (!Number.isFinite(timestamp) || timestamp > now) return;
    const date = dateAt(timestamp);
    if (date === today && !todayClosed) return;
    const close = closes[i];
    if (typeof close === 'number' && Number.isFinite(close) && close > 0) sessions.set(date, close);
  });

  const history = [...sessions].sort(([a], [b]) => a.localeCompare(b));
  const period = 14;
  if (history.length <= period) throw new Error('Insufficient QQQ daily history');
  let gain = 0, loss = 0;
  for (let i = 1; i < history.length; i++) {
    const change = history[i][1] - history[i - 1][1];
    const up = Math.max(change, 0), down = Math.max(-change, 0);
    if (i <= period) {
      gain += up / period;
      loss += down / period;
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
    }
  }
  return { value: gain + loss ? 100 * gain / (gain + loss) : 50, asOf: history[history.length - 1][0] };
}
