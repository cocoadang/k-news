// Explicit server deployment switch. Credentials remain environment/Secret Manager bindings.
const enabled=process.env.KNEWS_YOUTUBE_ENABLED==='true';
// The deployment activation time (10/29 11:21 KST) is later than that morning's episodes, which were then never collected.
// Collection may look back to 10/29 00:00 KST; the 48-hour discovery window still bounds how old a video can be.
export const DISCOVERY_BACKFILL_FROM=Date.parse('2026-10-28T15:00:00Z');
export function activationFloor(value){const t=value?Date.parse(value):NaN;return Number.isFinite(t)?Math.min(t,DISCOVERY_BACKFILL_FROM):null;}
export const wallstreetConfig=Object.freeze({enabled,intervalMs:null,activatedAt:activationFloor(process.env.KNEWS_YOUTUBE_ACTIVATED_AT),
  summaryProtocol:'evidence_ids_v1',
  minimumSummaryItems:5,
  acceptMinimumItems:3,
  allowSourceRepair:true,
  counterEvidenceRequired:true,
  // Luna combines counter-evidence and semantic review in one call; do not rerun whole videos on rejection/timeouts.
  automaticSummaryRetries:false,
  dailyCheckTimes:Object.freeze(['09:00','15:00']),scheduleTimeZone:'Asia/Seoul',
  // 사용자 요청(2026-10-30): 크립토 PLUS 수집 제외
  disabledProgrammes:Object.freeze(['crypto']),
  // Supplement these already-sent summaries once per version bump, web only (no Telegram), reusing the stored result.
  resummarize:Object.freeze({version:2,ids:Object.freeze([])}),
  // 사용자 요청(2026-11-10): 긴 영상 주제 수 확대 → 자막이 아직 남아 있는 최근 영상만 웹 전용 전체 재요약(텔레그램 없음, 주제가 늘 때만 교체)
  fullResummarize:Object.freeze({version:3,ids:Object.freeze(['eScBBegrUtM','Sa7ZwiJc2jY'])}), // Luna migration: existing targets once, web only, only if more points survive.
  // CEO 발언 영상(Supadata 무료 한도 공유): 하루 1편·월 15편, Gemini 영상당 2센트·하루 4센트·월 40센트 상한
  ceoVideo:Object.freeze({enabled,dailyVideos:1,monthlyVideos:15,reservationMicros:20000,dailyMicros:40000,monthlyMicros:400000}),
  excludedVideoIds:Object.freeze(['Idn_d5ArZvA','annR-E8m5WQ','IggP39LRnT8','LtT_k6wCOek']),
  mode:'caption_text',vidiqApproved:enabled,paidFallback:false,freeEvidence:null,projectId:'gen-lang-client-0064554427',
  supadataApproved:enabled,supadataOrganizationId:'febfd73e-8c82-4621-8c32-fbae9b021859',supadataCycleStart:process.env.KNEWS_SUPADATA_WINDOW_START?Date.parse(process.env.KNEWS_SUPADATA_WINDOW_START):null,supadataCycleEnd:process.env.KNEWS_SUPADATA_WINDOW_END?Date.parse(process.env.KNEWS_SUPADATA_WINDOW_END):null,supadataCycleLimit:90,supadataDailyLimit:6,
  discoverySource:process.env.KNEWS_YOUTUBE_DISCOVERY_SOURCE||'official_rss',
  discoveryApproved:enabled,summaryApproved:enabled,deliveryApproved:enabled,combinedTokenCapVerified:true,deliveryMode:'immediate',deliveryTime:null,recipient:process.env.TELEGRAM_CHAT_ID||null,
  dailyCredits:5,monthlyCredits:110,dailySummaryMicros:260000,monthlySummaryMicros:2000000,
  summaryReservationMicros:30000,longSummaryReservationMicros:50000,longSummaryMinutes:30,model:'gpt-6-luna',inputMicrosPerToken:.1,outputMicrosPerToken:.5,maxOutputTokens:4200});


