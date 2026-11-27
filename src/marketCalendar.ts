const bls = 'https://www.bls.gov/schedule/2026/12_sched_list.htm';
const fed = 'https://www.federalreserve.gov/newsevents/2026-december.htm';
const bea = 'https://www.bea.gov/news/schedule/';

export type MarketScheduleEvent = {
  names: readonly [string, string];
  at: string;
  source: string;
  result?: string;
};

// Agency-confirmed times. Keep the original Eastern offset so KST and trading dates stay independent.
export const marketSchedule: readonly MarketScheduleEvent[] = [
  {names: ['미국 PCE 물가', 'US PCE inflation'], at: '2026-11-25T08:30:00-05:00', source: bea,
    result: 'https://www.bea.gov/news/2026/personal-income-and-outlays-october-2026'},
  {names: ['미국 고용보고서', 'US jobs report'], at: '2026-12-04T08:30:00-05:00', source: bls},
  {names: ['FOMC 금리 결정', 'FOMC decision'], at: '2026-12-09T14:00:00-05:00', source: fed},
  {names: ['미국 CPI', 'US CPI'], at: '2026-12-10T08:30:00-05:00', source: bls},
  {names: ['미국 PCE 물가', 'US PCE inflation'], at: '2026-12-23T08:30:00-05:00', source: bea},
  {names: ['미국 고용보고서', 'US jobs report'], at: '2027-01-08T08:30:00-05:00', source: 'https://www.bls.gov/schedule/news_release/empsit.htm'},
  {names: ['미국 CPI', 'US CPI'], at: '2027-01-13T08:30:00-05:00', source: 'https://www.bls.gov/schedule/news_release/cpi.htm'},
];

export function upcomingMarketSchedule(now = Date.now()) {
  return marketSchedule.filter(event => Date.parse(event.at) > now);
}

const seoul = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

export function formatKoreanMarketTime(at: string) {
  return `${seoul.format(Date.parse(at)).slice(5)} KST`;
}
