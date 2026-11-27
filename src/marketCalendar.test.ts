import {deepStrictEqual} from 'node:assert';
import {test} from 'node:test';
import {calendarMonth, koreanMarketDateTime} from './marketCalendar';

test('a US afternoon release appears on the following Korean calendar date', () => {
  deepStrictEqual(koreanMarketDateTime('2026-12-09T14:00:00-05:00'), {date: '2026-12-10', time: '04:00'});
});

test('calendar uses Sunday-first padding and correct month lengths', () => {
  deepStrictEqual(calendarMonth('2026-12'), {firstWeekday: 2, days: 31});
  deepStrictEqual(calendarMonth('2028-02'), {firstWeekday: 2, days: 29});
});
