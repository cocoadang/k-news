// Called only within the same Firestore ownership lock as the video state.
// Live account balance is required each time; never use bonus/purchased credits.
export function reserveVidiq(state,balance,now){
 const end=Date.parse(balance?.renewableResetsAt);
 if(balance?.type!=='limited'||balance.maxRenewableCredits!==150||!Number.isSafeInteger(balance.renewableCredits)||balance.renewableCredits<0||balance.renewableCredits>150||!Number.isFinite(end)||end<=now)throw Error('free_account_balance_unverified');
 const cycle=balance.renewableResetsAt,day=new Date(now+9*3600000).toISOString().slice(0,10);
 state.vidiq ||= {cycle,used:0,shadowRemaining:balance.renewableCredits,days:{}};
 const b=state.vidiq;
 if(b.cycle!==cycle){if(Date.parse(b.cycle)>now)throw Error('credit_cycle_changed_early');state.vidiq={cycle,used:0,shadowRemaining:balance.renewableCredits,days:{}};}
 const current=state.vidiq;current.shadowRemaining=Math.min(current.shadowRemaining,balance.renewableCredits);
 // 22 weekday issues / cycle; any manual retry also consumes these limits.
 if(current.used+5>110||(current.days[day]||0)+5>5||current.shadowRemaining<5)return false;
 current.used+=5;current.days[day]=(current.days[day]||0)+5;current.shadowRemaining-=5;return true;
}
