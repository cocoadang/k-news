// Explicit server deployment switch. Credentials remain environment/Secret Manager bindings.
const enabled=process.env.KNEWS_YOUTUBE_ENABLED==='true';
export const wallstreetConfig=Object.freeze({enabled,intervalMs:null,activatedAt:process.env.KNEWS_YOUTUBE_ACTIVATED_AT?Date.parse(process.env.KNEWS_YOUTUBE_ACTIVATED_AT):null,
  summaryProtocol:'evidence_ids_v1',
  minimumSummaryItems:5,
  allowSourceRepair:true,
  counterEvidenceRequired:true,
  dailyCheckTimes:Object.freeze(['09:00','15:00']),scheduleTimeZone:'Asia/Seoul',
  excludedVideoIds:Object.freeze(['Idn_d5ArZvA','annR-E8m5WQ','IggP39LRnT8','LtT_k6wCOek']),
  mode:'caption_text',vidiqApproved:enabled,paidFallback:false,freeEvidence:null,projectId:'gen-lang-client-0064554427',
  supadataApproved:enabled,supadataOrganizationId:'febfd73e-8c82-4621-8c32-fbae9b021859',supadataCycleStart:process.env.KNEWS_SUPADATA_WINDOW_START?Date.parse(process.env.KNEWS_SUPADATA_WINDOW_START):null,supadataCycleEnd:process.env.KNEWS_SUPADATA_WINDOW_END?Date.parse(process.env.KNEWS_SUPADATA_WINDOW_END):null,supadataCycleLimit:90,supadataDailyLimit:2,
  discoverySource:process.env.KNEWS_YOUTUBE_DISCOVERY_SOURCE||'official_rss',
  discoveryApproved:enabled,summaryApproved:enabled,deliveryApproved:enabled,combinedTokenCapVerified:true,deliveryMode:'immediate',deliveryTime:null,recipient:process.env.TELEGRAM_CHAT_ID||null,
  dailyCredits:5,monthlyCredits:110,dailySummaryMicros:100000,monthlySummaryMicros:2000000,
  summaryReservationMicros:20000,model:'gemini-3.5-flash-lite',inputMicrosPerToken:.3,outputMicrosPerToken:2.5,maxOutputTokens:2500});
