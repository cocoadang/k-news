import {isCompanyEligibleForWeeklyRenewal,runWeeklyCompanyRenewalsBatch} from './companyRenewal';
import {db} from './db';
import {getIsFirestoreAvailable} from './firestore';
import type {CompanyProfile,MonitorSettings} from './types';

// Check on each scheduled cycle, but retain the existing seven-day cooldown,
// evidence requirements, transactional locks and five-call weekly ceiling.
export async function maintainCompanyKeywords({settings=db.getSettings(),companies=db.getCompanies(),available=getIsFirestoreAvailable(),now=new Date(),runBatch=runWeeklyCompanyRenewalsBatch}: {
 settings?:MonitorSettings;companies?:CompanyProfile[];available?:boolean;now?:Date;runBatch?:typeof runWeeklyCompanyRenewalsBatch
}={}){
 if(settings.weeklyCompanyRenewalEnabled===false||!available)return {status:'disabled'};
 if(!companies.some(c=>isCompanyEligibleForWeeklyRenewal(c,now).eligible))return {status:'not_due'};
 try{const result=await runBatch({now});return {status:'checked',...result};}
 catch{db.addLog('Scheduler','warn','[Weekly Renewal] 키워드 갱신 실패. 기존 키워드를 유지하고 다음 정기 실행에서 확인합니다.');return {status:'failed'};}
}
