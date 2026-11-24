import { fetchQqqRsi, fetchYahooChart, readRegularQuote } from './qqqRsi';

type TimedValue = { value: number; asOf: string };
export type MarketIndicators = {
  ndx: (TimedValue & { recentClosingPeak: number }) | null;
  vix: TimedValue | null;
  fearGreed: (TimedValue & { label: string }) | null;
  rsi: Awaited<ReturnType<typeof fetchQqqRsi>> | null;
};

async function fetchNasdaq(): Promise<NonNullable<MarketIndicators['ndx']>> {
  const chart = await fetchYahooChart('^NDX', '1y');
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
  return { ...quote, recentClosingPeak: peak };
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
