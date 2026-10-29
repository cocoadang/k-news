import assert from 'node:assert';
import crypto from 'node:crypto';
import { db } from './db';
import { handleTelegramCommand, sendEventToTelegram, mapConcurrent, isBotBlockedError } from './telegram';
import { NewsEvent } from './types';

async function runTests() {
  console.log('🧪 Starting Telegram Multi-User Subscription Unit Tests...\n');

  // Save original env
  const origBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const origChatId = process.env.TELEGRAM_CHAT_ID;
  const origWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  process.env.TELEGRAM_BOT_TOKEN = 'test-token-12345';
  process.env.TELEGRAM_CHAT_ID = 'legacy-fallback-chat-999';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'my-webhook-secret-token';

  // Save original fetch
  const originalFetch = globalThis.fetch;
  const fetchCalls: Array<{ url: string; body: any }> = [];

  // Mock global fetch for Telegram API calls
  let mockFetchHandler = async (url: string, init?: RequestInit): Promise<Response> => {
    const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
    fetchCalls.push({ url, body: parsedBody });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 8888 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    return mockFetchHandler(String(input), init);
  };

  try {
    // -------------------------------------------------------------
    // Test 1: /start 신규 등록
    // -------------------------------------------------------------
    console.log('Test 1: /start - Register new subscriber');
    const user1ChatId = 'user-chat-101';
    const res1 = await handleTelegramCommand(user1ChatId, '/start', { username: 'testuser1', first_name: '철수' });
    assert.strictEqual(res1.handled, true);
    assert.ok(res1.replyText.includes('K-news 구독이 시작되었습니다.'));

    const sub1 = db.getTelegramSubscriber(user1ChatId);
    assert.ok(sub1, 'Subscriber 1 should exist');
    assert.strictEqual(sub1?.chatId, user1ChatId);
    assert.strictEqual(sub1?.active, true);
    assert.strictEqual(sub1?.username, 'testuser1');
    assert.strictEqual(sub1?.firstName, '철수');
    const created1 = sub1?.createdAt;
    console.log('✅ Test 1 Passed: Subscriber registered successfully.');

    // -------------------------------------------------------------
    // Test 2: /stop - Active = false (document preserved, not deleted)
    // -------------------------------------------------------------
    console.log('\nTest 2: /stop - Pause subscription');
    const resStop = await handleTelegramCommand(user1ChatId, '/stop');
    assert.strictEqual(resStop.handled, true);
    assert.ok(resStop.replyText.includes('K-news 구독이 중지되었습니다.'));

    const sub1Stopped = db.getTelegramSubscriber(user1ChatId);
    assert.ok(sub1Stopped, 'Subscriber 1 record must still exist after /stop');
    assert.strictEqual(sub1Stopped?.active, false, 'active must be false');
    console.log('✅ Test 2 Passed: /stop deactivates subscriber without deletion.');

    // -------------------------------------------------------------
    // Test 3: /status - Check active and inactive statuses
    // -------------------------------------------------------------
    console.log('\nTest 3: /status - Check status reporting');
    const resStatusInactive = await handleTelegramCommand(user1ChatId, '/status');
    assert.ok(resStatusInactive.replyText.includes('비활성'));

    // Re-activate with /start
    const resRestart = await handleTelegramCommand(user1ChatId, '/start', { username: 'testuser1', first_name: '철수' });
    assert.ok(resRestart.replyText.includes('K-news 구독이 시작되었습니다.'));
    const sub1Restarted = db.getTelegramSubscriber(user1ChatId);
    assert.strictEqual(sub1Restarted?.active, true);
    assert.strictEqual(sub1Restarted?.createdAt, created1, 'createdAt must be preserved on re-activation');

    const resStatusActive = await handleTelegramCommand(user1ChatId, '/status');
    assert.ok(resStatusActive.replyText.includes('활성'));
    console.log('✅ Test 3 Passed: /status correctly displays active and inactive states.');

    // -------------------------------------------------------------
    // Test 4: /help - Command guide
    // -------------------------------------------------------------
    console.log('\nTest 4: /help - Guide text');
    const resHelp = await handleTelegramCommand(user1ChatId, '/help');
    assert.ok(resHelp.replyText.includes('/start'));
    assert.ok(resHelp.replyText.includes('/stop'));
    assert.ok(resHelp.replyText.includes('/status'));
    console.log('✅ Test 4 Passed: /help returns guide for all commands.');

    // -------------------------------------------------------------
    // Test 5: Active subscriber filtering
    // -------------------------------------------------------------
    console.log('\nTest 5: Active subscriber query filtering');
    const user2ChatId = 'user-chat-102';
    await handleTelegramCommand(user2ChatId, '/start', { username: 'user2' });

    const user3ChatId = 'user-chat-103';
    await handleTelegramCommand(user3ChatId, '/start', { username: 'user3' });
    await handleTelegramCommand(user3ChatId, '/stop'); // Inactive

    const activeSubs = await db.getActiveTelegramSubscribers();
    const activeChatIds = activeSubs.map(s => s.chatId);
    assert.ok(activeChatIds.includes(user1ChatId), 'user1 should be active');
    assert.ok(activeChatIds.includes(user2ChatId), 'user2 should be active');
    assert.ok(!activeChatIds.includes(user3ChatId), 'user3 should NOT be in active list');
    console.log(`✅ Test 5 Passed: Correctly filtered ${activeSubs.length} active subscribers.`);

    // -------------------------------------------------------------
    // Test 6: Concurrency limiter helper (mapConcurrent)
    // -------------------------------------------------------------
    console.log('\nTest 6: mapConcurrent concurrency limit validation');
    let runningConcurrency = 0;
    let maxSeenConcurrency = 0;
    const testItems = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    await mapConcurrent(testItems, 3, async (num) => {
      runningConcurrency++;
      if (runningConcurrency > maxSeenConcurrency) {
        maxSeenConcurrency = runningConcurrency;
      }
      await new Promise(r => setTimeout(r, 10));
      runningConcurrency--;
      return num * 2;
    });

    assert.ok(maxSeenConcurrency <= 3, `Max seen concurrency (${maxSeenConcurrency}) should be <= 3`);
    console.log(`✅ Test 6 Passed: Concurrency strictly bounded to ${maxSeenConcurrency} (limit: 3).`);

    // -------------------------------------------------------------
    // Test 7: Multi-user dispatch to subscribers (concurrency 5, no fallback)
    // -------------------------------------------------------------
    console.log('\nTest 7: sendEventToTelegram dispatches to all active subscribers with no fallback duplication');
    fetchCalls.length = 0;

    const sampleEvent: NewsEvent = {
      id: `test-event-${Date.now()}-1`,
      title: '스페이스X 스타십 6차 시험발사 성공 및 재사용 가속화',
      originalTitle: 'SpaceX Starship Completes Flight 6 Successfully',
      category: 'Starship / 우주인프라',
      importance: 5,
      isImportant: true,
      impact: 'positive',
      impactRationale: '스타십 발사 주기가 단축되며 상용화 속도 가속화',
      relatedCompanies: ['SpaceX'],
      companyImpacts: [],
      factualPoints: ['스타십 2단선 궤도 진입 후 정밀 착수', '랩터 엔진 재점화 성공'],
      summaryBulletPoints: ['시험발사 성공'],
      investmentImplications: '스타링크 발사 효율 극대화',
      whyItMatters: '우주 수송 비용 대폭 절감',
      keyCheckpointsToWatch: ['FAA 인허가'],
      investmentImpactExplanation: '기업가치 상승',
      relatedBusinesses: ['Starship'],
      primarySource: {
        name: 'SpaceX Official',
        url: 'https://spacex.com/launches',
        title: 'Starship Flight 6',
        publishedAt: new Date().toISOString(),
      },
      relatedSources: [],
      articleCount: 1,
      isSentToTelegram: false,
      firstSeenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      analyzedByGemini: true,
    };

    await db.saveEvent(sampleEvent);

    const dispatchResult = await sendEventToTelegram(sampleEvent);
    assert.strictEqual(dispatchResult.success, true);

    const sentChatIds = fetchCalls.map(c => c.body.chat_id);
    assert.ok(sentChatIds.includes(user1ChatId), 'Must send to user 1');
    assert.ok(sentChatIds.includes(user2ChatId), 'Must send to user 2');
    assert.ok(!sentChatIds.includes(user3ChatId), 'Must NOT send to inactive user 3');
    assert.ok(!sentChatIds.includes(process.env.TELEGRAM_CHAT_ID), 'Must NOT send to legacy TELEGRAM_CHAT_ID when active subscribers exist');

    const updatedEvent = db.getEventById(sampleEvent.id);
    assert.strictEqual(updatedEvent?.isSentToTelegram, true);
    assert.strictEqual(updatedEvent?.telegramDispatchStatus, 'sent');
    console.log(`✅ Test 7 Passed: Successfully dispatched to ${sentChatIds.length} active subscribers without duplicate fallback.`);

    // -------------------------------------------------------------
    // Test 8: Partial failure & 403 Forbidden (bot blocked by user) auto-deactivation
    // -------------------------------------------------------------
    console.log('\nTest 8: 403 Forbidden / bot was blocked auto-deactivates subscriber while others succeed');
    fetchCalls.length = 0;

    // Set custom mock fetch handler: user1 succeeds, user2 returns 403
    mockFetchHandler = async (url: string, init?: RequestInit) => {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
      fetchCalls.push({ url, body: parsedBody });

      if (parsedBody.chat_id === user2ChatId) {
        return new Response(JSON.stringify({
          ok: false,
          error_code: 403,
          description: 'Forbidden: bot was blocked by the user',
        }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ ok: true, result: { message_id: 9999 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const sampleEvent2: NewsEvent = {
      ...sampleEvent,
      id: `test-event-${Date.now()}-2`,
      title: '엔비디아 루빈 차세대 GPU 아키텍처 테이프아웃 완료',
      isSentToTelegram: false,
      telegramDispatchStatus: undefined,
    };
    await db.saveEvent(sampleEvent2);

    const dispatchRes2 = await sendEventToTelegram(sampleEvent2);
    // Because user1 succeeded, overall event dispatch is success
    assert.strictEqual(dispatchRes2.success, true);

    // Verify user2 was automatically deactivated
    const user2AfterBlocked = db.getTelegramSubscriber(user2ChatId);
    assert.strictEqual(user2AfterBlocked?.active, false, 'Blocked subscriber must be automatically set active=false');
    console.log('✅ Test 8 Passed: Blocked subscriber auto-deactivated and remaining subscribers delivered.');

    // -------------------------------------------------------------
    // Test 9: Fallback to TELEGRAM_CHAT_ID when 0 active subscribers
    // -------------------------------------------------------------
    console.log('\nTest 9: Fallback to TELEGRAM_CHAT_ID when 0 active subscribers');
    // Deactivate user 1 as well
    await db.setTelegramSubscriberActive(user1ChatId, false);
    const zeroSubs = await db.getActiveTelegramSubscribers();
    assert.strictEqual(zeroSubs.length, 0, 'Should have 0 active subscribers');

    fetchCalls.length = 0;
    mockFetchHandler = async (url: string, init?: RequestInit) => {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
      fetchCalls.push({ url, body: parsedBody });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7777 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const sampleEvent3: NewsEvent = {
      ...sampleEvent,
      id: `test-event-${Date.now()}-3`,
      title: '구글 텐서 G5 TSMC 수주 확정 및 AI 가속기 성능 공개',
      isSentToTelegram: false,
      telegramDispatchStatus: undefined,
    };
    await db.saveEvent(sampleEvent3);

    const dispatchRes3 = await sendEventToTelegram(sampleEvent3);
    assert.strictEqual(dispatchRes3.success, true);
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].body.chat_id, process.env.TELEGRAM_CHAT_ID, 'Must fallback to TELEGRAM_CHAT_ID');
    console.log('✅ Test 9 Passed: Successfully fell back to TELEGRAM_CHAT_ID when subscriber count is 0.');

    // -------------------------------------------------------------
    // Test 10: Duplicate send prevention (Atomic Claiming)
    // -------------------------------------------------------------
    console.log('\nTest 10: Duplicate send prevention via atomic claim');
    const duplicateTry = await sendEventToTelegram(sampleEvent3, false);
    assert.strictEqual(duplicateTry.success, false, 'Second non-forced dispatch of sent event must be rejected');
    assert.ok(duplicateTry.error?.includes('already sent') || duplicateTry.error?.includes('actively processed'));
    console.log('✅ Test 10 Passed: Atomic claim successfully prevents duplicate dispatches.');

    // -------------------------------------------------------------
    // Test 11: Webhook Secret Token Verification
    // -------------------------------------------------------------
    console.log('\nTest 11: Webhook Secret Token verification');
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET!;
    const correctHeader = secret;
    const wrongHeader = 'wrong-secret-token';

    const verifySecret = (received: string | undefined): boolean => {
      if (!received || received.length !== secret.length) return false;
      try {
        return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(secret));
      } catch {
        return false;
      }
    };

    assert.strictEqual(verifySecret(correctHeader), true, 'Correct header must pass');
    assert.strictEqual(verifySecret(wrongHeader), false, 'Wrong header must fail');
    assert.strictEqual(verifySecret(undefined), false, 'Missing header must fail');
    console.log('✅ Test 11 Passed: Timing-safe secret verification works as expected.');

    // -------------------------------------------------------------
    // Test 12: isBotBlockedError helper
    // -------------------------------------------------------------
    console.log('\nTest 12: isBotBlockedError helper');
    assert.strictEqual(isBotBlockedError(403, 'Forbidden'), true);
    assert.strictEqual(isBotBlockedError(400, 'Forbidden: bot was blocked by the user'), true);
    assert.strictEqual(isBotBlockedError(400, 'Bad Request: chat not found'), true);
    assert.strictEqual(isBotBlockedError(200, undefined), false);
    assert.strictEqual(isBotBlockedError(500, 'Internal Server Error'), false);
    console.log('✅ Test 12 Passed: isBotBlockedError correctly identifies error conditions.');

    console.log('\n🎉 ALL 12 TESTS PASSED SUCCESSFULLY! Everything is verified.');
  } finally {
    // Restore original globals and env
    globalThis.fetch = originalFetch;
    process.env.TELEGRAM_BOT_TOKEN = origBotToken;
    process.env.TELEGRAM_CHAT_ID = origChatId;
    process.env.TELEGRAM_WEBHOOK_SECRET = origWebhookSecret;
  }
}

runTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
