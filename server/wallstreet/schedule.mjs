export function twiceDailySlot(now,times){
  if(!Array.isArray(times)||times.length!==2||times[0]>=times[1]||times.some(x=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(x)))throw Error('twice_daily_schedule_required');
  const p=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  const [date,time]=p.split(' ');const selected=times.filter(x=>x<=time).at(-1);
  return selected?`${date}T${selected}+09:00`:null;
}
