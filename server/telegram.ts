import { NewsEvent, TelegramSubscriber, MonitorSettings } from './types';
import { db } from './db';
import { computeEventFingerprint, isFingerprintSpecific } from './dedup';


export function getStarRatingString(stars: number): string {
  const clamped = Math.max(1, Math.min(5, Math.round(stars)));
  return '★'.repeat(clamped) + '☆'.repeat(5 - clamped);
}

export function formatTelegramMessage(event: NewsEvent): { text: string; inlineKeyboard?: Array<Array<{ text: string; url: string }>> } {
  // 1. Stars rating and category
  const stars = getStarRatingString(event.importance);
  const categoryBadge = event.category ? ` [${event.category}]` : '';

  // 2. Verified Facts only (bullet points, concise, no interpretation)
  const factsList = (event.factualPoints && event.factualPoints.length > 0)
    ? event.factualPoints
    : (event.summaryBulletPoints && event.summaryBulletPoints.length > 0)
    ? event.summaryBulletPoints
    : [];

  let bulletPoints = '';
  if (factsList.length > 0) {
    bulletPoints = factsList
      .slice(0, 2)
      .map(p => {
        const trimmed = p.trim();
        return trimmed.startsWith('•') || trimmed.startsWith('-') ? trimmed : `• ${trimmed}`;
      })
      .join('\n');
  } else {
    bulletPoints = `• ${event.title}`;
  }

  // Limit length if overly long
  if (bulletPoints.length > 250) {
    bulletPoints = bulletPoints.slice(0, 240) + '...';
  }

  // 3. Primary source info
  const sourceName = event.primarySource?.name || '공식/외신 출처';
  const primaryUrl = event.primarySource?.url || '';

  // Compact format: [중요도 별점 + 카테고리 + 제목 + 요약 불릿 포인트]
  // Note: 출처 텍스트 라인은 제거하고 하단 인라인 버튼으로 대체
  const text = `${stars}${categoryBadge}

<b>${escapeHtml(event.title)}</b>

${escapeHtml(bulletPoints)}`;

  // Inline keyboard button for direct 1-tap navigation on mobile Telegram
  const buttons: Array<{ text: string; url: string }> = [];
  if (primaryUrl) {
    buttons.push({ text: `🔗 ${sourceName} 원문 기사 ↗`, url: primaryUrl });
  }

  return {
    text,
    inlineKeyboard: buttons.length > 0 ? [buttons] : undefined,
  };
}

export function escapeHtml(text: string = ''): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export interface TelegramSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  statusCode?: number;
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  htmlText: string,
  inlineKeyboard?: Array<Array<{ text: string; url: string }>>
): Promise<TelegramSendResult> {
  if (!token || !chatId) {
    return { success: false, error: 'Telegram Bot Token 또는 Chat ID가 설정되지 않았습니다.' };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    };

    if (inlineKeyboard && inlineKeyboard.length > 0) {
      body.reply_markup = {
        inline_keyboard: inlineKeyboard,
      };
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      return {
        success: false,
        statusCode: res.status,
        error: data.description || `HTTP ${res.status}: ${res.statusText}`,
      };
    }

    return {
      success: true,
      statusCode: res.status,
      messageId: String(data.result?.message_id || ''),
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Executes async tasks over an array with bounded concurrency.
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));

  const workers = Array.from({ length: limit }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Checks if a Telegram error signifies that the bot was blocked or the chat is unreachable.
 */
export function isBotBlockedError(statusCode?: number, errorMsg?: string): boolean {
  if (statusCode === 403) return true;
  if (!errorMsg) return false;
  const lower = errorMsg.toLowerCase();
  return (
    lower.includes('blocked by the user') ||
    lower.includes('bot was blocked') ||
    lower.includes('user is deactivated') ||
    lower.includes('chat not found') ||
    lower.includes('bot was kicked') ||
    lower.includes('forbidden')
  );
}

/**
 * Handles Telegram Bot commands received via Webhook.
 */
export async function handleTelegramCommand(
  chatId: string,
  commandText: string,
  from?: { username?: string; first_name?: string }
): Promise<{ handled: boolean; replyText: string }> {
  const trimmed = (commandText || '').trim();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const cleanCmd = trimmed.split(/\s+/)[0].toLowerCase().split('@')[0];

  let replyText = '';

  if (cleanCmd === '/start') {
    const existing = db.getTelegramSubscriber(chatId);
    const now = new Date().toISOString();
    const subscriber: TelegramSubscriber = {
      chatId: String(chatId),
      username: from?.username || existing?.username,
      firstName: from?.first_name || existing?.firstName,
      active: true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await db.saveTelegramSubscriber(subscriber);
    db.addLog('Telegram', 'info', `Telegram subscriber registered/activated: ${chatId} (@${subscriber.username || subscriber.firstName || 'user'})`);

    replyText = `K-news 구독이 시작되었습니다.
중요 뉴스가 발생하면 이 채팅으로 보내드리겠습니다.`;
  } else if (cleanCmd === '/stop') {
    await db.setTelegramSubscriberActive(chatId, false);
    db.addLog('Telegram', 'info', `Telegram subscriber paused: ${chatId}`);

    replyText = `K-news 구독이 중지되었습니다.
다시 구독하려면 /start를 입력해주세요.`;
  } else if (cleanCmd === '/status') {
    const sub = db.getTelegramSubscriber(chatId);
    const isActive = sub ? sub.active : false;
    replyText = `K-news 구독 상태: ${isActive ? '활성' : '비활성 (구독 중지됨)'}`;
  } else if (cleanCmd === '/help') {
    replyText = `[K-news 텔레그램 봇 명령어]
• /start : K-news 중요 뉴스 실시간 구독 시작
• /stop : 뉴스 알림 수신 일시 중지
• /status : 현재 내 구독 상태 확인
• /help : 사용 가능한 명령어 목록 안내`;
  } else {
    replyText = `안녕하세요! K-news 투자 인텔리전스 봇입니다.
명령어를 확인하시려면 /help 를 입력해주세요.`;
  }

  if (token) {
    await sendTelegramMessage(token, String(chatId), escapeHtml(replyText));
  }

  return { handled: true, replyText };
}

export interface EventTelegramQualificationResult {
  qualified: boolean;
  reason?: string;
}

/**
 * Common Qualification Check for Telegram Auto-Dispatch
 * Unified policy across all automated cycles and background retry paths:
 * 1. Strictly importance === 5
 * 2. Gemini analysis completed
 * 3. Event category enabled in settings
 * 4. Verified Source Quality (Tier 1, Tier 2, or Corroborated Tier 3) - NO bypass for 5★
 * 5. Not already dispatched
 */
export function isEventQualifiedForTelegramAutoDispatch(
  event: NewsEvent,
  settings: MonitorSettings
): EventTelegramQualificationResult {
  // 0. 기사 묶음 정리로 분리된 과거 기사는 새 뉴스가 아니므로 자동 발송하지 않음
  if (event.telegramSuppressed) {
    return {
      qualified: false,
      reason: 'Telegram auto-dispatch suppressed: event was split out during cluster cleanup (manual send only)',
    };
  }

  // 1. [Rule 1: Telegram 5★ Only] Auto-dispatch strictly limited to 5★
  if (event.importance !== 5) {
    return {
      qualified: false,
      reason: `Telegram auto-dispatch is strictly restricted to importance === 5 (current: ${event.importance}★)`,
    };
  }

  // 2. Analysis must be completed
  const isAnalysisCompleted = event.analysisStatus === 'completed' || (!event.analysisStatus && event.importance > 0);
  if (!isAnalysisCompleted) {
    return {
      qualified: false,
      reason: 'Gemini AI analysis is not completed (pending or failed analyses cannot be auto-dispatched)',
    };
  }

  // 3. Category must be active/enabled in monitor settings
  if (settings.enabledCategories && !settings.enabledCategories.includes(event.category)) {
    return {
      qualified: false,
      reason: `Category [${event.category}] is disabled in monitor settings`,
    };
  }

  // 4. Source Quality Check: Tier 1, Tier 2, or Corroborated Tier 3 (>=2 sources, detected original source, or trusted source)
  // CRITICAL: || event.importance === 5 is intentionally REMOVED so unverified rumours never trigger 5★ alerts
  const isTier1 = event.sourceTier === 'tier1' || event.primarySource?.sourceTier === 'tier1';
  const isTier2 = event.sourceTier === 'tier2' || event.primarySource?.sourceTier === 'tier2';
  const isCorroboratedTier3 =
    (event.corroboratedSourceCount || 1) >= 2 ||
    Boolean(event.detectedOriginalSource) ||
    Boolean(event.hasTrustedSource);

  const passesSourceQuality = isTier1 || isTier2 || isCorroboratedTier3;
  if (!passesSourceQuality) {
    return {
      qualified: false,
      reason: 'Insufficient source credibility: Tier 3 single uncorroborated source (requires Tier 1, Tier 2, or cross-source corroboration)',
    };
  }

  // 5. Pre-dispatch duplicate check
  if (event.isSentToTelegram || event.telegramDispatchStatus === 'sent') {
    return {
      qualified: false,
      reason: 'Event was already dispatched to Telegram',
    };
  }

  return { qualified: true };
}

export async function sendEventToTelegram(event: NewsEvent, forceResend: boolean = false): Promise<{ success: boolean; error?: string }> {
  // 1. Qualification Check for auto-dispatch (bypassed only when manually forced by admin)
  if (!forceResend) {
    const settings = db.getSettings();
    const qualification = isEventQualifiedForTelegramAutoDispatch(event, settings);
    if (!qualification.qualified) {
      db.addLog(
        'Telegram',
        'info',
        `[Telegram Filter] Auto-dispatch blocked: "${event.title.slice(0, 30)}..." - ${qualification.reason}`
      );
      return { success: false, error: qualification.reason };
    }
  }

  // 2. Pre-dispatch defense: check if already sent
  if (!forceResend && (event.isSentToTelegram || event.telegramDispatchStatus === 'sent')) {
    return { success: false, error: 'Event was already sent to Telegram.' };
  }

  // 3. Compute deterministic event fingerprint
  const rawFingerprint = event.eventFingerprint || computeEventFingerprint(
    event.originalTitle || event.title,
    (event.factualPoints || event.summaryBulletPoints || []).join(' '),
    event.relatedCompanies
  );

  // 너무 일반적인 지문(예: "googl:gemini")으로 잠그면 서로 다른 사건의 알림까지 영구 차단되므로,
  // 구체적인 지문이 아니면 이벤트 ID 기준으로만 중복 발송을 막습니다.
  const fingerprint = isFingerprintSpecific(rawFingerprint) ? rawFingerprint : `event:${event.id}`;

  // 4. Atomic claim to guarantee exactly-once delivery across concurrent Cloud Run instances
  // and prevent duplicate alerts for the same event fingerprint even if assigned different event IDs
  if (!forceResend) {
    const claimed = await db.claimEventForTelegram(event.id, fingerprint);
    if (!claimed) {
      return { success: false, error: 'Event (or same event fingerprint) was already sent or is being actively processed by another instance.' };
    }
  }


  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    await db.updateEventTelegramStatus(event.id, false, undefined, 'TELEGRAM_BOT_TOKEN missing in server environment', fingerprint);
    db.addLog('Telegram', 'warn', `Cannot send alert for "${event.title.slice(0, 30)}": TELEGRAM_BOT_TOKEN not configured in server environment.`);
    return { success: false, error: 'TELEGRAM_BOT_TOKEN missing in server environment variables' };
  }

  const activeSubscribers = await db.getActiveTelegramSubscribers();
  const formatted = formatTelegramMessage(event);

  // Dispatch Strategy:
  // If active subscribers exist (>= 1) -> send to all active subscribers with concurrency limit 5
  // If active subscribers === 0 -> fallback to TELEGRAM_CHAT_ID
  if (activeSubscribers.length > 0) {
    let successCount = 0;
    let firstSuccessMessageId: string | undefined;
    const errors: string[] = [];

    // Bounded concurrency dispatch (max 5 simultaneous requests)
    await mapConcurrent(activeSubscribers, 5, async (subscriber) => {
      const result = await sendTelegramMessage(token, subscriber.chatId, formatted.text, formatted.inlineKeyboard);
      if (result.success) {
        successCount++;
        if (!firstSuccessMessageId) {
          firstSuccessMessageId = result.messageId;
        }
        console.log(`✅ [Telegram] Alert delivered to subscriber ${subscriber.chatId} (${subscriber.username || subscriber.firstName || 'user'})`);
      } else {
        errors.push(`[${subscriber.chatId}]: ${result.error}`);
        console.warn(`⚠️ [Telegram] Delivery failed to subscriber ${subscriber.chatId}: ${result.error}`);

        if (isBotBlockedError(result.statusCode, result.error)) {
          await db.setTelegramSubscriberActive(subscriber.chatId, false);
          db.addLog('Telegram', 'warn', `구독자 (${subscriber.chatId}) 봇 차단/비활성화 감지 -> active=false 처리 완료`);
        }
      }
    });

    if (successCount > 0) {
      await db.updateEventTelegramStatus(event.id, true, firstSuccessMessageId, undefined, fingerprint);
      db.addLog(
        'Telegram',
        'success',
        `Alert sent to ${successCount}/${activeSubscribers.length} Telegram subscribers for [${event.category}] "${event.title.slice(0, 35)}..." (${event.importance}★)`
      );
      return { success: true };
    } else {
      const aggregateError = `All ${activeSubscribers.length} subscriber dispatches failed: ${errors.join('; ')}`;
      await db.updateEventTelegramStatus(event.id, false, undefined, aggregateError, fingerprint);
      db.addLog('Telegram', 'error', `Failed to send Telegram alert: ${aggregateError}`);
      return { success: false, error: aggregateError };
    }
  } else {
    // Fallback to TELEGRAM_CHAT_ID when no subscribers registered
    const fallbackChatId = process.env.TELEGRAM_CHAT_ID;
    if (!fallbackChatId) {
      const noTargetMsg = 'No active subscribers in telegramSubscribers and TELEGRAM_CHAT_ID fallback is not configured.';
      await db.updateEventTelegramStatus(event.id, false, undefined, noTargetMsg, fingerprint);
      db.addLog('Telegram', 'warn', `Cannot send alert for "${event.title.slice(0, 30)}": ${noTargetMsg}`);
      return { success: false, error: noTargetMsg };
    }

    const result = await sendTelegramMessage(token, fallbackChatId, formatted.text, formatted.inlineKeyboard);
    if (result.success) {
      await db.updateEventTelegramStatus(event.id, true, result.messageId, undefined, fingerprint);
      db.addLog(
        'Telegram',
        'success',
        `Alert sent to fallback Telegram chat (${fallbackChatId}) for [${event.category}] "${event.title.slice(0, 35)}..." (${event.importance}★)`
      );
      return { success: true };
    } else {
      await db.updateEventTelegramStatus(event.id, false, undefined, result.error, fingerprint);
      db.addLog('Telegram', 'error', `Failed to send Telegram alert to fallback chat: ${result.error}`);
      return { success: false, error: result.error };
    }
  }
}

export async function sendTestMessage(): Promise<{ success: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return {
      success: false,
      error: '서버 환경변수에 TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID가 설정되어 있지 않습니다. 배포 환경 설정이나 Secret을 확인해주세요.',
    };
  }

  const testText = `🚨 <b>Investment Intelligence Monitor 연동 완료</b>

시스템과 텔레그램 봇의 실시간 알림 채널이 성공적으로 활성화되었습니다!

• <b>감시 대상 기업</b>: SpaceX, Alphabet/Google, Tesla, Microsoft, NVIDIA
• <b>분석 엔진</b>: Gemini 다중 기업 교차 영향 & 팩트 검증 분석
• <b>알림 기준</b>: 투자 중요도 ★★★ 이상 및 🚨 긴급 5★ 속보

글로벌 주요 경제지와 공식 출처(NASA, FAA, SEC, IR 등)를 24시간 실시간 모니터링하여, 투자 가치가 있는 핵심 인텔리전스만 선별하여 전달해 드립니다.`;

  return sendTelegramMessage(token, chatId, testText);
}
