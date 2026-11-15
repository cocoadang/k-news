const WEEK=7*86400000;
export function renewalStatus(company,enabled=true,now=Date.now()){
 if(!enabled||company.autoWeeklyRenewalEnabled===false)return '자동 갱신 꺼짐';
 if(company.enabled===false)return '수집 중지';
 const last=Date.parse(company.lastKeywordRenewalAttemptAt||'');
 if(!Number.isFinite(last)||last+WEEK<=now)return '다음 정기 실행에서 갱신 확인';
 return '다음 갱신 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric'}).format(last+WEEK)+' 이후';
}
