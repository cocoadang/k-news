import {randomUUID} from 'node:crypto';

export const TITLE_RETRY_MS=3600000;
export const canTranslate=(job,now)=>!job || (job.status==='rejected'&&job.attempts<2&&job.retryAt<=now);

// Claiming titles and reserving their worst-case cost share one transaction.
// Unknown outcomes keep both their claim and reservation; successful translations survive event-save failures.
export function createTitleKoStore(db){
 const budget=db.collection('news_title_ko_budget').doc('state');
 const ref=key=>db.collection('news_title_ko_jobs').doc(key);
 return {
  async read(keys){const snaps=await db.getAll(...keys.map(ref));return Object.fromEntries(snaps.map((s,i)=>[keys[i],s.exists?s.data():null]));},
  async reserve({keys,month,reserveNano,capNano,now}){
   if(!Array.isArray(keys)||!keys.length||keys.length>40||new Set(keys).size!==keys.length||keys.some(k=>typeof k!=='string'||!/^[a-f0-9]{64}$/.test(k))||!/^\d{4}-\d{2}$/.test(month)||!Number.isSafeInteger(reserveNano)||reserveNano<=0||!Number.isSafeInteger(capNano)||capNano<0||capNano>1e9||!Number.isSafeInteger(now))throw Error('invalid_title_reservation');
   const attemptId=randomUUID();
   return db.runTransaction(async tx=>{
    const b=await tx.get(budget),snaps=[];
    for(const key of keys)snaps.push(await tx.get(ref(key)));
    const state=b.exists?b.data():{},spent=state.month===month?state.nano:0;
    if(snaps.some(s=>!canTranslate(s.exists?s.data():null,now)))return {ok:false,reason:'claimed'};
    if(!Number.isSafeInteger(spent)||spent<0)throw Error('invalid_title_budget');
    if(spent+reserveNano>capNano)return {ok:false,reason:'month_cap'};
    keys.forEach((key,i)=>tx.set(ref(key),{status:'reserved',attemptId,attempts:(snaps[i].data()?.attempts||0)+1,at:now}));
    tx.set(budget,{month,nano:spent+reserveNano});
    return {ok:true,attemptId};
   });
  },
  async settle({keys,attemptId,month,reserveNano,actualNano,results,now}){
   return db.runTransaction(async tx=>{
    const b=await tx.get(budget),snaps=[];
    for(const key of keys)snaps.push(await tx.get(ref(key)));
    if(snaps.some(s=>!s.exists||s.data().attemptId!==attemptId||s.data().status!=='reserved'))throw Error('title_claim_lost');
    const state=b.exists?b.data():{};
    // A request can cross a month boundary. Do not refund into a different month's budget.
    if(state.month===month)tx.set(budget,{month,nano:state.nano+actualNano-reserveNano});
    keys.forEach((key,i)=>tx.set(ref(key),{...snaps[i].data(),status:results[key]?'ready':'rejected',ko:results[key]||'',retryAt:now+TITLE_RETRY_MS,at:now}));
   });
  },
  async uncertain({keys,attemptId,now}){
   await db.runTransaction(async tx=>{
    const snaps=[];for(const key of keys)snaps.push(await tx.get(ref(key)));
    keys.forEach((key,i)=>{if(snaps[i].exists&&snaps[i].data().attemptId===attemptId&&snaps[i].data().status==='reserved')tx.set(ref(key),{...snaps[i].data(),status:'uncertain',at:now});});
   });
  },
 };
}
