import {summaryLibrary,publicSummaryLibrary} from './library.mjs';
import {createVidiqMcpClient} from './mcpClient.mjs';
import {youtubeDiscovery,vidiqCaptions,telegramTransport} from './adapters.mjs';
import {rssDiscovery} from './rssDiscovery.mjs';
import {uploadsDiscovery} from './uploadsDiscovery.mjs';
import {boundedSummarizer} from './summaryClient.mjs';
import {groundedSummarizer} from './groundedSummary.mjs';
import {createWallstreetRuntime} from './runtime.mjs';
import {wallstreetConfig} from './config.mjs';
import {createFreeVideoProvider} from './freeVideo.mjs';
import {createFreeRuntime} from './freeRuntime.mjs';
import {FirestoreWallstreetStore} from './firestoreStore.mjs';
import {PROGRAMMES} from './programmes.mjs';
import {createTextRuntime,TEXT_PROJECT} from './textRuntime.mjs';
import {createSupadataProvider} from './supadata.mjs';
import {ceoVideoDiscovery,createCeoQuoteExtractor} from './ceoVideo.mjs';

// Same stateless Interactions contract used in the completed supervised text trial.
export function createGeminiTextSdkClient({GoogleGenAI,apiKey}){
  const ai=new GoogleGenAI({apiKey,httpOptions:{retryOptions:{attempts:1}}});
  return {
    async countTokens({model,contents}){return ai.models.countTokens({model,contents,config:{httpOptions:{timeout:10000,retryOptions:{attempts:1}}}});},
    async generate({model,contents,maxOutputTokens,timeoutMs}){
      if(model!=='gemini-3.5-flash-lite'||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>2500)throw Error('text_model_or_cap_unverified');
      const result=await ai.interactions.create({model,input:contents,store:false,stream:false,
        generation_config:{thinking_level:'minimal',max_output_tokens:maxOutputTokens}},{maxRetries:0,timeout:timeoutMs});
      const text=typeof result.output_text==='string'?result.output_text:(result.steps||[]).filter(x=>x.type==='model_output').flatMap(x=>x.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('');
      if(result.status!=='completed'||!text)throw Error('summary_incomplete');
      return {text};
    }
  };
}

export function createGeminiSdkClient({GoogleGenAI,apiKey}) {
  const ai=new GoogleGenAI({apiKey,httpOptions:{retryOptions:{attempts:1}}});
  return {
    async countTokens({model,contents}) {
      return ai.models.countTokens({model,contents,config:{httpOptions:{timeout:10000,retryOptions:{attempts:1}}}});
    },
    async generate({model,contents,maxOutputTokens,timeoutMs}) {
      const r=await ai.models.generateContent({model,contents,config:{responseMimeType:'application/json',candidateCount:1,
        temperature:0.2,maxOutputTokens,thinkingConfig:{thinkingLevel:'LOW'},httpOptions:{timeout:timeoutMs,retryOptions:{attempts:1}}}});
      if(r.candidates?.[0]?.finishReason!=='STOP') throw Error('summary_incomplete');
      return {text:r.text};
    }
  };
}
export function classifyVidiqCaptionError(result) {
  const text=(result.content || []).filter(x=>x.type==='text').map(x=>x.text).join('\n');
  // Retry only an explicit provider instruction about caption processing, never
  // arbitrary errors, quota errors, private videos or success transcript text.
  if(result.isError===true && /(?:retry|try again)/i.test(text) &&
    /(?:still generating captions|captions (?:are )?(?:still )?processing)/i.test(text) &&
    !/(?:private|unavailable|no captions|quota|credit|authentication)/i.test(text)) return {status:'processing'};
  return {status:'unavailable'};
}
export async function createProviders({config,env,fetcher=fetch,loadGemini=()=>import('@google/genai')}) {
  if(config.enabled!==true) throw Error('wallstreet_disabled');
  for(const name of ['VIDIQ_API_KEY','YOUTUBE_API_KEY','GEMINI_API_KEY','TELEGRAM_BOT_TOKEN','WALLSTREET_TELEGRAM_CHAT_ID']) {
    if(typeof env[name]!=='string' || !env[name].trim()) throw Error(`wallstreet_missing_${name}`);
  }
  // A positive numeric Telegram chat ID is a private user. Group/channel IDs are negative.
  if(!/^[1-9]\d*$/.test(env.WALLSTREET_TELEGRAM_CHAT_ID)) throw Error('wallstreet_private_recipient_required');
  const mcp=createVidiqMcpClient({apiKey:env.VIDIQ_API_KEY,approved:true,fetcher});
  const {GoogleGenAI}=await loadGemini();
  const captions=vidiqCaptions({callTool:(name,args)=>mcp.callTool(name,args),approved:true,
    typedError:classifyVidiqCaptionError});
  const transport=telegramTransport({token:env.TELEGRAM_BOT_TOKEN,approved:true,fetcher});
  const recipient=env.WALLSTREET_TELEGRAM_CHAT_ID;
  return {discovery:youtubeDiscovery({apiKey:env.YOUTUBE_API_KEY,approved:true,fetcher}),captions,
    summarizer:boundedSummarizer({...config,approved:true,client:createGeminiSdkClient({GoogleGenAI,apiKey:env.GEMINI_API_KEY})}),
    telegram:{send(chatId,text) {
      if(chatId!==recipient) throw Error('wallstreet_recipient_mismatch');
      return transport.send(recipient,text);
    }}};
}
/** @param {{getFirestore?:()=>any,config?:any,env?:any,fetcher?:any,loadGemini?:any,textDependencies?:any}} options */
export function createConfiguredWallstreetRuntime({getFirestore,config=wallstreetConfig,env=process.env,fetcher=fetch,loadGemini,textDependencies={}}={}) {
  let runtime;
  async function textRuntime(){
    if(config.mode!=='caption_text'||config.projectId!==TEXT_PROJECT||config.paidFallback!==false)throw Error('text_configuration');
    const db=getFirestore();if(!db)throw Error('wallstreet_firestore_unavailable');
    const dependencies={...textDependencies};
    if(!dependencies.supadata&&config.supadataApproved===true){
      if(!env.SUPADATA_API_KEY)throw Error('supadata_server_credential_required');
      dependencies.supadata=createSupadataProvider({apiKey:env.SUPADATA_API_KEY,organizationId:config.supadataOrganizationId,approved:true,fetcher});
    }
    if(!dependencies.captions&&config.vidiqApproved===true){
      if(!env.VIDIQ_API_KEY)throw Error('vidiq_server_credential_required');
      const mcp=createVidiqMcpClient({apiKey:env.VIDIQ_API_KEY,approved:true,fetcher});
      dependencies.captions={...vidiqCaptions({callTool:(name,args)=>mcp.callTool(name,args),approved:true,typedError:classifyVidiqCaptionError}),balance:()=>mcp.balance()};
    }
    if(!dependencies.discovery&&config.discoveryApproved===true){
        if(!['official_rss','youtube_uploads_api'].includes(config.discoverySource||'official_rss'))throw Error('discovery_source_invalid');
      dependencies.discovery=config.discoverySource==='youtube_uploads_api'?uploadsDiscovery({approved:true,apiKey:env.YOUTUBE_API_KEY,activatedAt:config.activatedAt,fetcher}):rssDiscovery({approved:true,fetcher});
    }
    if(!dependencies.summarizer&&config.summaryApproved===true&&config.combinedTokenCapVerified===true){
      if(!env.GEMINI_API_KEY)throw Error('text_credentials_not_configured');
      const {GoogleGenAI}=await (loadGemini||(()=>import('@google/genai')))();
      dependencies.summarizer=groundedSummarizer({...config,approved:true,client:createGeminiTextSdkClient({GoogleGenAI,apiKey:env.GEMINI_API_KEY})});
    }
    if(!dependencies.telegram&&config.deliveryApproved===true){
      if(!env.TELEGRAM_BOT_TOKEN||! /^[1-9]\d*$/.test(config.recipient||''))throw Error('private_delivery_configuration_required');
      const transport=telegramTransport({token:env.TELEGRAM_BOT_TOKEN,approved:true,fetcher});
      dependencies.telegram={send(id,text){if(id!==config.recipient)throw Error('recipient_mismatch');return transport.send(id,text);}};
    }
    if(config.ceoVideo?.enabled===true&&dependencies.supadata&&!dependencies.ceoDiscovery){
      try{
        dependencies.ceoDiscovery=ceoVideoDiscovery({apiKey:env.YOUTUBE_API_KEY,fetcher});
        const {GoogleGenAI}=await (loadGemini||(()=>import('@google/genai')))();
        dependencies.ceoExtractor=createCeoQuoteExtractor({client:createGeminiTextSdkClient({GoogleGenAI,apiKey:env.GEMINI_API_KEY})});
      }catch{delete dependencies.ceoDiscovery;delete dependencies.ceoExtractor;}
    }
    return createTextRuntime({...dependencies,store:new FirestoreWallstreetStore(db),config});
  }
  return {
    status:()=>({status:config.enabled===true?'configured_pending_first_run':'disabled',intervalMs:config.dailyCheckTimes?null:600000,dailyCheckTimes:config.dailyCheckTimes||null,timeZone:config.scheduleTimeZone||'Asia/Seoul',mode:config.mode,
      acquisition:config.mode==='caption_text'?'routed_native_captions_and_ui_import':config.mode,
      captionProviders:{wallstreet:config.vidiqApproved===true?'vidiq':'disabled',bullbear:config.supadataApproved===true?'supadata_native':'disabled',crypto:config.supadataApproved===true?'supadata_native':'disabled'},automaticCaptionsReady:false}),
    async library(){const db=getFirestore();if(!db)throw Error("store_unavailable");return summaryLibrary(await new FirestoreWallstreetStore(db).read());},
    async publicLibrary(){const db=getFirestore();if(!db)throw Error('store_unavailable');return publicSummaryLibrary(await new FirestoreWallstreetStore(db).read());},
    async importTranscript(input){if(!config.enabled)return {status:'disabled'};runtime ||= textRuntime();return (await runtime).importTranscript(input);},
    async run(options={}) {
      if(config.enabled!==true) return {status:'disabled'};
      if(config.mode==='caption_text'){runtime ||= textRuntime();return (await runtime).run(options);}
      if(options.manualRunId)throw Error('manual_run_requires_caption_text_mode');
      if(!runtime) {
        // Production entrypoint cannot fall back to the legacy paid transcript path.
        if(config.mode!=='gemini_youtube_free'||config.paidFallback!==false||!config.freeEvidence||config.freeEvidence.tier!=='free'||config.freeEvidence.billingEnabled!==false)throw Error('free_tier_unverified');
        if(!env.GEMINI_API_KEY||!env.YOUTUBE_API_KEY)throw Error('free_credentials_not_configured');
        const db=getFirestore();if(!db)throw Error('wallstreet_firestore_unavailable');
        const provider=createFreeVideoProvider({apiKey:env.GEMINI_API_KEY,projectId:config.projectId,model:config.model,evidence:config.freeEvidence,approved:true,fetcher});
        runtime=createFreeRuntime({store:new FirestoreWallstreetStore(db),config,provider,
          discovery:youtubeDiscovery({apiKey:env.YOUTUBE_API_KEY,approved:true,fetcher,allowedChannels:PROGRAMMES.map(p=>p.channelId)})});
      }
      return runtime.run();
    }
  };
}
