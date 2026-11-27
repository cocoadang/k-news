export type MarketScheduleEvent = {
  names: readonly [string, string];
  at: string;
};

// Agency-confirmed times with the original Eastern offset.
export const marketSchedule: readonly MarketScheduleEvent[] = [
  {names: ['미국 PCE 물가', 'US PCE inflation'], at: '2026-11-25T08:30:00-05:00'},
  {names: ['미국 고용보고서', 'US jobs report'], at: '2026-12-04T08:30:00-05:00'},
  {names: ['FOMC 금리 결정', 'FOMC decision'], at: '2026-12-09T14:00:00-05:00'},
  {names: ['미국 CPI', 'US CPI'], at: '2026-12-10T08:30:00-05:00'},
  {names: ['미국 PCE 물가', 'US PCE inflation'], at: '2026-12-23T08:30:00-05:00'},
  {names: ['미국 고용보고서', 'US jobs report'], at: '2027-01-08T08:30:00-05:00'},
  {names: ['미국 CPI', 'US CPI'], at: '2027-01-13T08:30:00-05:00'},
];

const seoul = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function koreanMarketDateTime(at: number | string) {
  const [date, time] = seoul.format(new Date(at)).split(' ');
  return {date, time};
}

export function calendarMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  return {
    firstWeekday: new Date(Date.UTC(year, number - 1, 1)).getUTCDay(),
    days: new Date(Date.UTC(year, number, 0)).getUTCDate(),
  };
}
