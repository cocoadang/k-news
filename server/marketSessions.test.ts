import {deepStrictEqual, strictEqual} from 'node:assert';
import {test} from 'node:test';
import {completedCloses} from './marketSessions';
import {formatKoreanMarketTime, upcomingMarketSchedule} from '../src/marketCalendar';
import {sessionVideos} from '../src/components/MarketSessionCard';

const stamp = (iso: string) => Date.parse(iso) / 1000;

test('daily market recap excludes an unfinished US session, including an early close', () => {
  const chart = {
    meta: {currentTradingPeriod: {regular: {start: stamp('2026-11-27T14:30:00Z'), end: stamp('2026-11-27T18:00:00Z')}}},
    timestamp: [stamp('2026-11-25T14:30:00Z'), stamp('2026-11-27T14:30:00Z')],
    indicators: {quote: [{close: [21000, 21300]}]},
  };
  deepStrictEqual(completedCloses(chart, Date.parse('2026-11-27T17:59:59Z')), [['2026-11-25', 21000]]);
  deepStrictEqual(completedCloses(chart, Date.parse('2026-11-27T18:00:00Z')), [['2026-11-25', 21000], ['2026-11-27', 21300]]);
});

test('only completed market wrap videos posted after the ET close are associated', () => {
  const video = {id: 'example0001', title: '미국장 복기', publishedAt: Date.parse('2026-11-26T00:00:00Z'), status: 'ready', programmes: ['wallstreet'], summary: '뉴욕 증시 장 마감'};
  deepStrictEqual(sessionVideos([video], '2026-11-25'), [video]);
  deepStrictEqual(sessionVideos([video], '2026-11-26'), []);
  deepStrictEqual(sessionVideos([{...video, publishedAt: Date.parse('2026-11-25T19:00:00Z')}, {...video, status: 'review_required'}], '2026-11-25'), []);
});

test('schedule rolls forward at US release instant and FOMC KST is the next date', () => {
  strictEqual(upcomingMarketSchedule(Date.parse('2026-12-04T13:30:00Z'))[0].names[1], 'FOMC decision');
  strictEqual(new Date(upcomingMarketSchedule(Date.parse('2026-12-04T13:30:00Z'))[0].at).toISOString(), '2026-12-09T19:00:00.000Z');
  strictEqual(formatKoreanMarketTime('2026-12-09T14:00:00-05:00'), '12-10 04:00 KST');
});
