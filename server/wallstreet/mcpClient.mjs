const ENDPOINT='https://mcp.vidiq.com/mcp';
const VERSIONS=['2025-11-25','2025-06-18','2025-03-26'];
const TOOL='vidiq_video_transcript';

// Deliberately restricted Streamable HTTP client: no sampling, roots, prompts,
// arbitrary tools, auto-reconnect, redirects, retries or execution of server instructions.
export function createVidiqMcpClient({apiKey,approved=false,fetcher=fetch,timeoutMs=60000}) {
  let sequence=0,session,version,initialized=false,toolFound=false;
  async function rpc(method,params,notification=false) {
    if(!approved || !apiKey?.trim()) throw Error('vidiq_access_not_enabled');
    const id=notification ? undefined : ++sequence;
    const headers={'Authorization':`Bearer ${apiKey}`,'Content-Type':'application/json','Accept':'application/json, text/event-stream'};
    if(session) headers['Mcp-Session-Id']=session;
    if(version) headers['MCP-Protocol-Version']=version;
    let response;
    try { response=await fetcher(ENDPOINT,{method:'POST',redirect:'error',headers,
      signal:AbortSignal.timeout(timeoutMs),body:JSON.stringify({jsonrpc:'2.0',...(id===undefined?{}:{id}),method,...(params===undefined?{}:{params})})}); }
    catch {throw Error('vidiq_transport_uncertain');}
    if(!response.ok) throw Error(`vidiq_http_${response.status}`);
    if(method==='initialize') {
      session=response.headers.get('mcp-session-id') || undefined;
      if(session && !/^[\x21-\x7e]{1,1024}$/.test(session)) throw Error('vidiq_invalid_session');
    }
    if(notification) {if(response.status!==202) throw Error('vidiq_notification_rejected');return;}
    const type=response.headers.get('content-type') || '';
    if(!response.body || (!type.includes('application/json') && !type.includes('text/event-stream'))) throw Error('vidiq_invalid_content_type');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0;
    const check=message=>{
      if(message.jsonrpc!=='2.0') throw Error('vidiq_invalid_jsonrpc');
      if(message.method) {
        if(message.id!==undefined) throw Error('vidiq_unexpected_server_request');
        return undefined; // progress/log notifications are data, never instructions
      }
      if(message.id!==id) throw Error('vidiq_response_id_mismatch');
      if(message.error) throw Error('vidiq_rpc_error');
      if(!Object.hasOwn(message,'result')) throw Error('vidiq_result_missing');
      return {result:message.result};
    };
    try {
      while(true) {
        const {done,value}=await reader.read();
        if(value) {bytes+=value.byteLength;if(bytes>2000000) throw Error('vidiq_response_too_large');buffer+=decoder.decode(value,{stream:true});}
        if(type.includes('text/event-stream')) {
          buffer=buffer.replace(/\r\n/g,'\n');let end;
          while((end=buffer.indexOf('\n\n'))>=0) {
            const event=buffer.slice(0,end);buffer=buffer.slice(end+2);
            const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');
            if(!data.trim()) continue;
            const got=check(JSON.parse(data));if(got) return got.result;
          }
        }
        if(done) {
          if(type.includes('application/json')) {const got=check(JSON.parse(buffer+decoder.decode()));if(got)return got.result;}
          throw Error('vidiq_stream_incomplete');
        }
      }
    } finally {await reader.cancel().catch(()=>{});}
  }
  async function connect() {
    if(initialized) return;
    const r=await rpc('initialize',{protocolVersion:VERSIONS[0],capabilities:{},clientInfo:{name:'k-news-wallstreet',version:'1.0.0'}});
    if(!VERSIONS.includes(r.protocolVersion) || !r.capabilities?.tools) throw Error('vidiq_protocol_unsupported');
    version=r.protocolVersion;await rpc('notifications/initialized',undefined,true);initialized=true;
    let cursor;
    for(let page=0;page<10;page++) {
      const list=await rpc('tools/list',cursor?{cursor}:{});
      const tool=list.tools?.find(t=>t.name===TOOL);
      if(tool) {
        if(tool.inputSchema?.type!=='object' || tool.inputSchema?.properties?.videoId?.type!=='string') throw Error('vidiq_tool_schema_changed');
        toolFound=true;return;
      }
      cursor=list.nextCursor;if(!cursor) break;
    }
    throw Error('vidiq_transcript_tool_missing');
  }
  return {
    async balance(){
      await connect();const result=await rpc('tools/call',{name:'vidiq_balance',arguments:{}});
      if(result?.isError)throw Error('vidiq_balance_failed');
      if(result.structuredContent)return result.structuredContent;
      try{return JSON.parse(result.content.filter(x=>x.type==='text').map(x=>x.text).join('\n'));}catch{throw Error('vidiq_balance_schema');}
    },
    async callTool(name,args) {
      if(name!==TOOL || !/^[A-Za-z0-9_-]{11}$/.test(args.videoId) || args.language!=='ko') throw Error('vidiq_tool_not_allowed');
      await connect();if(!toolFound) throw Error('vidiq_transcript_tool_missing');
      // One POST only. On 404/auth expiry/disconnect the caller retains the cost reservation.
      const result=await rpc('tools/call',{name:TOOL,arguments:{videoId:args.videoId,language:'ko'}});
      if(!result || typeof result!=='object') throw Error('vidiq_tool_result_invalid');
      if(!result.structuredContent && !result.isError) {
        const text=result.content?.filter(x=>x.type==='text').map(x=>x.text).join('\n');
        try {result.structuredContent=JSON.parse(text);} catch {throw Error('vidiq_transcript_schema_changed');}
      }
      return result;
    }
  };
}
