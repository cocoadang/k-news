export const PROGRAMMES=Object.freeze([
  Object.freeze({id:'wallstreet',name:'월가 뉴스레터',channelId:'UChlv4GSd7OQl3js-jkLOnFA',pattern:/월가\s*뉴스레터/iu}),
  Object.freeze({id:'bullbear',name:'홍장원의 불앤베어',channelId:'UCPTy0BNqiv-0SdAvFgrXvXg',pattern:/홍장원[의\s]*불\s*앤\s*베어/iu}),
  Object.freeze({id:'crypto',name:'크립토 PLUS',channelId:'UChlv4GSd7OQl3js-jkLOnFA',pattern:/크립토\s*(?:PLUS|플러스)/iu})
]);
export const TRIAL_IDS=Object.freeze(['Idn_d5ArZvA','annR-E8m5WQ','IggP39LRnT8']);
export function matchProgrammes(v,{activatedAt,now,maxAgeMs=172800000,allowProviderVerification=false}) {
  const pending=allowProviderVerification&&v?.discoveryMethod==='official_rss'&&v.status==='awaiting_native_captions';
  if(!v || !/^[\w-]{11}$/.test(v.id) || typeof v.title!=='string' || typeof v.description!=='string' ||
    v.visibility!=='public' || (!pending&&(v.isShort!==false||v.status!=='completed'||!Number.isFinite(v.durationSeconds)||v.durationSeconds<=180)) || v.isRebroadcast!==false || !Number.isFinite(v.publishedAt) ||
    v.publishedAt<activatedAt || v.publishedAt>now || now-v.publishedAt>maxAgeMs ||
    /쇼츠|shorts|재방송|다시\s*보기|하이라이트|몰아보기|클립|rebroadcast|replay/iu.test(v.title)) return [];
  return PROGRAMMES.filter(p=>p.channelId===v.channelId && p.pattern.test(v.title)).map(p=>p.id);
}
