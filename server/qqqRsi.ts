const eastern = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const dateAt = (seconds: number) => eastern.format(new Date(seconds * 1000));

export type QqqRsi = { value: number; asOf: string; intraday?: true };

type YahooChart = {
  meta?: {
    regularMarketTime?: number;
    regularMarketPrice?: number;
    currentTradingPeriod?: { regular?: { start: number; end: number } };
  };
  timestamp?: number[];
  indicators?: { adjclose?: { adjclose?: number[] }[]; quote?: { close?: number[] }[] };
};

export async function fetchYahooChart(symbol: string, range: '1y' | '5d' | 'max'): Promise<YahooChart> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Market price source unavailable');
  const chart = (await response.json()).chart?.result?.[0];
  if (!chart) throw new Error('Market chart unavailable');
  return chart;
}

const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function readRegularQuote(chart: YahooChart) {
  const time = chart.meta?.regularMarketTime;
  const value = chart.meta?.regularMarketPrice;
  if (!positive(time) || time * 1000 > Date.now() || !positive(value)) throw new Error('Invalid market quote');
  return { value, asOf: new Date(time * 1000).toISOString() };
}

export async function fetchQqqRsi(includeIntraday = false): Promise<QqqRsi> {
  return calculateQqqRsi(await fetchYahooChart('QQQ', '1y'), includeIntraday);
}

export function calculateQqqRsi(result: YahooChart, includeIntraday: boolean, now = Date.now() / 1000): QqqRsi {
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.adjclose?.[0]?.adjclose;
  const regular = result.meta?.currentTradingPeriod?.regular;
  const closeTime = regular?.end;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length !== closes.length ||
      !Number.isFinite(closeTime)) throw new Error('Invalid QQQ daily history');

  const today = dateAt(now);
  const todayClosed = typeof closeTime === 'number' && dateAt(closeTime) === today && now >= closeTime;
  const sessions = new Map<string, number>();
  const rawCloses = result.indicators?.quote?.[0]?.close;
  let priorReference = -1, currentReference = -1;
  timestamps.forEach((timestamp, i) => {
    if (!Number.isFinite(timestamp) || timestamp > now) return;
    const date = dateAt(timestamp);
    const close = closes[i];
    if (!positive(close)) return;
    if (positive(rawCloses?.[i])) {
      if (date === today) currentReference = i;
      else priorReference = i;
    }
    if (date !== today || todayClosed) sessions.set(date, close);
  });

  const quoteTime = result.meta?.regularMarketTime;
  const price = result.meta?.regularMarketPrice;
  let intradayAsOf: string | undefined;
  if (includeIntraday && !todayClosed && regular && positive(quoteTime) && positive(price) &&
      quoteTime <= now && quoteTime >= regular.start && dateAt(quoteTime) === today) {
    // Keep the current quote on the same adjusted scale as the previous sessions.
    const referenceIndex = currentReference >= 0 ? currentReference : priorReference;
    const raw = rawCloses?.[referenceIndex];
    if (positive(raw) && positive(closes[referenceIndex])) {
      sessions.set(today, price * closes[referenceIndex] / raw);
      intradayAsOf = new Date(quoteTime * 1000).toISOString();
    }
  }
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
  const value = gain + loss ? 100 * gain / (gain + loss) : 50;
  return intradayAsOf ? { value, asOf: intradayAsOf, intraday: true } : { value, asOf: history[history.length - 1][0] };
}
