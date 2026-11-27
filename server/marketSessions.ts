import {fetchYahooChart} from './qqqRsi';

const easternDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});

type Chart = Awaited<ReturnType<typeof fetchYahooChart>>;

export type MarketSession = {
  date: string;
  closes: {symbol: string; value: number; change: number}[];
};

export function completedCloses(chart: Chart, now = Date.now()) {
  const today = easternDate.format(now);
  const end = chart.meta?.currentTradingPeriod?.regular?.end;
  const currentSessionClosed = typeof end === 'number' && easternDate.format(end * 1000) === today && now >= end * 1000;
  const prices = chart.indicators?.quote?.[0]?.close ?? [];
  const byDate = new Map<string, number>();
  chart.timestamp?.forEach((seconds, index) => {
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > now) return;
    const price = prices[index];
    const date = easternDate.format(seconds * 1000);
    if (!Number.isFinite(price) || price <= 0 || date > today || (date === today && !currentSessionClosed)) return;
    byDate.set(date, price);
  });
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export async function fetchMarketSessions(): Promise<MarketSession[]> {
  const indices = [{symbol: 'NASDAQ 100', ticker: '^NDX'}, {symbol: 'S&P 500', ticker: '^GSPC'}];
  const charts = await Promise.allSettled(indices.map(({ticker}) => fetchYahooChart(ticker, '5d')));
  const sessions = new Map<string, MarketSession['closes']>();
  charts.forEach((chart, index) => {
    if (chart.status !== 'fulfilled') return;
    const prices = completedCloses(chart.value);
    prices.slice(1).forEach(([date, value], i) => {
      const previous = prices[i][1];
      const items = sessions.get(date) ?? [];
      items.push({symbol: indices[index].symbol, value, change: (value / previous - 1) * 100});
      sessions.set(date, items);
    });
  });
  if (!sessions.size) throw new Error('Market closes unavailable');
  return [...sessions].sort(([a], [b]) => b.localeCompare(a)).map(([date, closes]) => ({date, closes}));
}

export type PublicCommentary = {id: string; title: string; publishedAt: string};

const wisdomChannel = 'UCiAM9aJjVTmhtYgj0cyTPzA';

// Verified public link used if the channel feed is temporarily unavailable.
const publicWisdomVideo: PublicCommentary = {
  id: 'TIHjg_z9hNk', title: "닷컴버블 2년 전과 닮은 나스닥, 하락장 끝낼 반등 조건 '3가지'", publishedAt: '2026-11-23',
};

export async function fetchPublicCommentary(): Promise<PublicCommentary[]> {
  try {
    const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${wisdomChannel}`, {signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('Public video feed unavailable');
    const xml = await response.text();
    if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Invalid video feed');
    const {default: Parser} = await import('rss-parser');
    const feed = await new Parser({customFields: {item: ['yt:videoId', 'yt:channelId']}}).parseString(xml);
    return feed.items.flatMap(item => {
      const id = item['yt:videoId'];
      const title = item.title;
      const publishedAt = item.isoDate;
      if (item['yt:channelId'] !== wisdomChannel || typeof id !== 'string' || !/^[\w-]{11}$/.test(id)
        || !title || !/나스닥|뉴욕\s*증시|미국\s*증시|주말\s*시황/.test(title)
        || /라이브|생방송|쇼츠|다시\s*보기|하이라이트/.test(title)
        || !publishedAt || !Number.isFinite(Date.parse(publishedAt)) || Date.parse(publishedAt) > Date.now()) return [];
      return [{id, title, publishedAt}];
    }).slice(0, 12);
  } catch {
    return [publicWisdomVideo];
  }
}

export async function fetchMarketRecap() {
  const [sessions, commentary] = await Promise.all([fetchMarketSessions(), fetchPublicCommentary()]);
  return {sessions, commentary};
}
