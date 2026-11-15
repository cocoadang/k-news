import { tick } from './core.mjs';
import { FirestoreWallstreetStore } from './firestoreStore.mjs';

export function createWallstreetRuntime({getFirestore,config={enabled:false},providers=null}) {
  return {
    status:()=>({status:config.enabled===true ? 'requires_provider_readiness' : 'disabled',intervalMs:600000}),
    async run() {
      if(config.enabled!==true) return {status:'disabled'};
      if(!providers?.discovery || !providers?.captions || !providers?.summarizer || !providers?.telegram) throw Error('wallstreet_providers_not_configured');
      const db=getFirestore();
      if(!db) throw Error('wallstreet_firestore_unavailable');
      const store=new FirestoreWallstreetStore(db);
      // Enforce scheduler cadence in the same distributed lock as budget and outbox.
      const throttledStore={exclusive:fn=>store.exclusive(async(state,save)=>{
        const now=Date.now();
        if(state.lastStartedAt && now-state.lastStartedAt<600000) return {status:'throttled'};
        state.lastStartedAt=now; await save();
        return fn(state,save);
      })};
      return tick({...providers,store:throttledStore,config});
    }
  };
}
// Register against the existing Express app without importing its startup side effects.
export function registerWallstreetRoutes(app,{runtime,verifyAdmin,verifyJob,publicSummaries,onRunFinished}) {
  app.post('/api/admin/wallstreet/channel-test',verifyAdmin,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{const result=await runtime.sendChannelTest(req.body?.videoId);res.status(['sent','already_sent'].includes(result.status)?200:409).json(result);}
    catch{res.status(503).json({status:'review_required'});}
  });
  // publicSummaries: 서버가 넘겨주는 캐시·압축 응답기(없으면 매번 저장 상태를 읽음)
  app.get('/api/youtube/summaries',async(req,res)=>{
    try{if(publicSummaries)return await publicSummaries(req,res);res.setHeader('Cache-Control','no-store');res.json(await runtime.publicLibrary());}
    catch{res.setHeader('Cache-Control','no-store');res.status(503).json({status:'unavailable'});}
  });
  app.get('/api/admin/wallstreet/library',verifyAdmin,async(_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{res.json(await runtime.library());}catch{res.status(503).json({status:'unavailable'});}
  });
  // Dedicated authenticated job, independent of existing news polling and admin endpoints.
  if(verifyJob)app.post('/api/jobs/youtube-summaries',verifyJob,async(_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{res.json(await runtime.run());}catch{res.status(503).json({status:'unavailable',message:'Review durable state before retry.'});}finally{onRunFinished?.();}
  });
  app.post('/api/admin/wallstreet/transcript',verifyAdmin,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try {res.json(await runtime.importTranscript(req.body));}
    catch {res.status(400).json({status:'import_rejected'});}
  });
  app.get('/api/admin/wallstreet/status',verifyAdmin,(_req,res)=>{
    res.setHeader('Cache-Control','no-store');res.json(runtime.status());
  });
  app.post('/api/admin/wallstreet/run',verifyAdmin,async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const manualRunId=req.get('X-Knews-Run-Id');
    if(typeof manualRunId!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{15,79}$/.test(manualRunId))return res.status(400).json({status:'manual_run_id_required'});
    try {res.json(await runtime.run({manualRunId}));onRunFinished?.();}
    catch {res.status(503).json({status:'unavailable',message:'Wallstreet job unavailable; inspect durable state before retry.'});}
  });
}
