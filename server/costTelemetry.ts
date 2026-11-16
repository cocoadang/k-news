import type {RequestHandler} from 'express';
/** App response bytes after compression; excludes HTTP/TLS overhead and CDN-served traffic. */
export function costHttpTelemetry(emit:(line:string)=>void=console.log):RequestHandler{return(req,res,next)=>{
 const start=Date.now(),path=req.path;let bytes=0,logged=false;
 const count=(value:any,encoding?:any)=>{if(typeof value==='string')bytes+=Buffer.byteLength(value,typeof encoding==='string'&&Buffer.isEncoding(encoding)?encoding as BufferEncoding:'utf8');else if(value instanceof Uint8Array)bytes+=value.byteLength;};
 const write=res.write.bind(res),end=res.end.bind(res);
 res.write=((chunk:any,...args:any[])=>{count(chunk,args[0]);return (write as any)(chunk,...args);}) as any;
 res.end=((chunk?:any,...args:any[])=>{count(chunk,args[0]);return (end as any)(chunk,...args);}) as any;
 const finish=(complete:boolean)=>{if(logged)return;logged=true;
 const route=path==='/api/ai/analyze'?'ai_analysis':path==='/api/events'?'events':path==='/api/ceo/dataset'?'ceo_dataset':path==='/api/youtube/summaries'?'youtube_summaries':path==='/api/health'||path==='/api/status'?'health':path.startsWith('/assets/')?'assets':path.startsWith('/api/')?'other_api':'page';
 try{emit('[COST_HTTP_V1] '+JSON.stringify({v:1,route,method:['GET','HEAD','POST'].includes(req.method)?req.method:'OTHER',status:res.statusCode,complete,responseBodyBytes:req.method==='HEAD'||res.statusCode===304?0:bytes,conditional:!!req.headers['if-none-match'],durationMs:Date.now()-start}));}catch{/* metrics cannot affect delivery */}
 };
 res.once('finish',()=>finish(true));res.once('close',()=>finish(false));next();
};}
