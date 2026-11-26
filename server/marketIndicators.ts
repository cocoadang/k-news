import { fetchQqqRsi, fetchYahooChart, readRegularQuote } from './qqqRsi';

type DrawdownAverage = { mean: number; start: string; end: string; peak: number };
type TimedValue = { value: number; asOf: string };
export type MarketIndicators = {
  ndx: (TimedValue & { recentClosingPeak: number; drawdownAverage?: DrawdownAverage }) | null;
  vix: TimedValue | null;
  fearGreed: (TimedValue & { label: string }) | null;
  rsi: Awaited<ReturnType<typeof fetchQqqRsi>> | null;
};

// The full daily series feeds only the historical average. Reuse it across quote refreshes.
let savedDrawdown: { data?: DrawdownAverage; expiresAt: number } | undefined;
let pendingDrawdown: Promise<DrawdownAverage | undefined> | undefined;

function fetchDrawdownAverage() {
  if (savedDrawdown && savedDrawdown.expiresAt > Date.now()) return Promise.resolve(savedDrawdown.data);
  return pendingDrawdown ??= fetchYahooChart('^NDX', 'max').then(chart => {
    const prices = chart.indicators?.quote?.[0]?.close ?? [];
    const time = chart.timestamp ?? [];
    const beforeToday = new Date().toISOString().slice(0, 10);
    const closes = time.flatMap((stamp, index) => {
      if (!Number.isFinite(stamp) || stamp <= 0 || stamp >= Date.now() / 1000 ||
          !Number.isFinite(prices[index]) || prices[index] <= 0) return [];
      const date = new Date(stamp * 1000).toISOString().slice(0, 10);
      return date < beforeToday ? [{ date, value: prices[index] }] : [];
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (closes.length < 252) throw new Error('Insufficient drawdown history');
    let peak = 0, total = 0;
    for (const { value } of closes) {
      peak = Math.max(peak, value);
      total += (1 - value / peak) * 100;
    }
    const data = { mean: total / closes.length, start: closes[0].date, end: closes[closes.length - 1].date, peak };
    savedDrawdown = { data, expiresAt: Date.now() + 24 * 60 * 60_000 };
    return data;
  }).catch(() => {
    const data = savedDrawdown?.data;
    savedDrawdown = { data, expiresAt: Date.now() + 60 * 60_000 };
    return data;
  }).finally(() => { pendingDrawdown = undefined; });
}

async function fetchNasdaq(): Promise<NonNullable<MarketIndicators['ndx']>> {
  const [chart, drawdownAverage] = await Promise.all([fetchYahooChart('^NDX', '1y'), fetchDrawdownAverage()]);
  const quote = readRegularQuote(chart);
  const closingPrices = chart.indicators?.quote?.[0]?.close;
  if (!Array.isArray(chart.timestamp) || !Array.isArray(closingPrices)) throw new Error('NDX history unavailable');
  const tradingPeriod = chart.meta?.currentTradingPeriod?.regular;
  const cutoff = tradingPeriod && Date.now() < tradingPeriod.end * 1000
    ? Math.min(tradingPeriod.start, Date.parse(quote.asOf) / 1000)
    : Date.parse(quote.asOf) / 1000;
  const peak = Math.max(0, ...closingPrices.filter((price, i) =>
    Number.isFinite(price) && Number.isFinite(chart.timestamp![i]) && chart.timestamp![i] < cutoff));
  if (!peak) throw new Error('No NDX closing peak');
  return { ...quote, recentClosingPeak: peak, drawdownAverage };
}

async function requestFearGreed(): Promise<NonNullable<MarketIndicators['fearGreed']>> {
  const response = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('CNN index unavailable');
  const index = (await response.json()).fear_and_greed;
  const score = index?.score;
  const time = typeof index?.timestamp === 'string' ? Date.parse(index.timestamp) : NaN;
  if (!Number.isFinite(score) || score < 0 || score > 100 || !Number.isFinite(time) || time > Date.now()
      || typeof index?.rating !== 'string' || !index.rating.trim()) {
    throw new Error('Invalid CNN index reading');
  }
  return { value: score, asOf: new Date(time).toISOString(), label: index.rating };
}

// CNN updates on its own cadence. Back off when the source rejects requests.
let cnn: { reading: MarketIndicators['fearGreed']; expiresAt: number } | undefined;
let cnnPending: Promise<MarketIndicators['fearGreed']> | undefined;

function fetchFearGreed(): Promise<MarketIndicators['fearGreed']> {
  if (cnn && Date.now() < cnn.expiresAt) return Promise.resolve(cnn.reading);
  return cnnPending ??= requestFearGreed().catch(() => null).then(reading => {
    cnn = { reading, expiresAt: Date.now() + (reading ? 15 : 60) * 60_000 };
    return reading;
  }).finally(() => { cnnPending = undefined; });
}

export async function fetchMarketIndicators(): Promise<MarketIndicators> {
  const [ndx, vix, fearGreed, rsi] = await Promise.all([
    fetchNasdaq().catch(() => null),
    fetchYahooChart('^VIX', '5d').then(readRegularQuote).catch(() => null),
    fetchFearGreed(),
    fetchQqqRsi(true).catch(() => null),
  ]);
  return { ndx, vix, fearGreed, rsi };
}
