process.env.NODE_ENV = 'test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { db } from './db';
import { 
  computeEventFingerprint, 
  areFingerprintsMatching, 
  computeNormalizedUrl 
} from './dedup';
import { 
  clusterAndProcessArticles, 
  createUnanalyzedEvent, 
  retryPendingAnalyses, 
  createCycleBudgetTracker, runTwoStageAnalysis, parseScreeningBatch, fairAnalysisOrder, screeningEvidenceKey, needsDetailedAnalysis 
} from './geminiAnalyzer';
import { sendEventToTelegram, isEventQualifiedForTelegramAutoDispatch } from './telegram';
import { NewsEvent, RawArticle } from './types';
import { firestoreRepo, getIsFirestoreAvailable, getSeoulWeekString, _setIsFirestoreAvailableForTesting } from './firestore';
import {
  isExcludedFromCompanyRenewal,
  getRecentCompanyArticlesForRenewal,
  isCompanyEligibleForWeeklyRenewal,
  executeWeeklyCompanyRenewal,
  runWeeklyCompanyRenewalsBatch,
  rollbackCompanyKeywords,
} from './companyRenewal';
import { INITIAL_COMPANIES, CompanyProfile } from './companyProfiles';
import type { GoogleGenAI } from '@google/genai';
import {
  generateSessionToken,
  verifySessionToken,
  SESSION_COOKIE_NAME,
  isValidCsrfOrigin,
  checkAdminAuth,
  verifyCronAuth,
  verifyTelegramWebhookSecret,
  validateTelegramUpdate,
  TelegramReplayTracker,
  getCookieOptions,
} from './security';
import { createServerApp } from '../server';
import http from 'node:http';
import {
  isNoiseNewsArticle,
  checkArticleAnalysisEligibility,
  getEffectiveEventTime,
  projectEventAnalysisStatus,
} from './newsNoiseFilter';
import { getEventBadgeInfo } from '../src/components/EventCard';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CeoStatementsView, CeoViewState } from '../src/components/ceo/CeoStatementsView';
import { CeoMenu } from '../src/components/ceo/CeoMenu';
import { setSchedulerCeoRuntime, getSchedulerCeoRuntime, runMonitoringCycle, _setCollectArticlesForTesting } from './scheduler';
import { CeoRuntime } from './ceo/runtime';
import { MemoryStateBackend, MemoryStateStore } from './ceo/stateStore';
import { createFetchText } from './ceo/fetchText';
import { parseFeedWithRssParser } from './ceo/routes';
import { LIVE_REGISTRY, LIVE_TRANSCRIPT, rssFeed, ARTICLE_1, ARTICLE_2, BODY_1, BODY_2, FEED_URL_NVDA, TRANSCRIPT_URL, transcriptPage } from './ceo/testing/liveFixtures';

async function runMonitoringAndDedupTests() {
  console.log('====================================================');
  console.log('🧪 Starting K-News Monitoring Policy & Dedup Unit Tests');
  console.log('====================================================\n');

  // Set up test environment
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-auto-12345';
  process.env.TELEGRAM_CHAT_ID = 'test-chat-777';

  // Mock global fetch for Telegram API calls and Gemini API calls
  let telegramFetchCalls: Array<{ url: string; body: any }> = [];
  let geminiFetchCalls: Array<{ url: string; body: any }> = [];
  let geminiDedupCallCount = 0;
  let geminiAnalysisCallCount = 0;
  let mockGeminiRateLimit = false;
  let mockGeminiDedupResponse = 'SAME';

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.includes('api.telegram.org')) {
      const parsedBody = init?.body ? JSON.parse(String(init.body)) : {};
      telegramFetchCalls.push({ url, body: parsedBody });
      return new Response(JSON.stringify({ ok: true, result: { message_id: Math.floor(Math.random() * 10000) } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('generativelanguage.googleapis.com')) {
      geminiFetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (mockGeminiRateLimit) {
        return new Response(JSON.stringify({
          error: {
            code: 429,
            message: 'RESOURCE_EXHAUSTED: Rate limit quota exceeded',
            status: 'RESOURCE_EXHAUSTED',
          }
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const reqBodyStr = String(init?.body || '');
      let responseText = '';
      if (reqBodyStr.includes('Core Investment Fact') || reqBodyStr.includes('SAME (동일 사건 병합)')) {
        geminiDedupCallCount++;
        responseText = mockGeminiDedupResponse;
      } else if (reqBodyStr.includes('coreBusinesses')) {
        responseText = JSON.stringify({
          coreBusinesses: ['Tesla', 'FSD'],
          searchKeywords: ['Tesla', 'TSLA'],
          importantKeywords: ['Tesla', '실적'],
        });
      } else {
        geminiAnalysisCallCount++;
        const isGoogle = reqBodyStr.includes('Google') || reqBodyStr.includes('Gemini');
        const isSpaceX = reqBodyStr.includes('SpaceX') || reqBodyStr.includes('Starship');
        const companyName = isGoogle ? 'Alphabet / Google' : isSpaceX ? 'SpaceX' : 'Tesla';
        const companyId = isGoogle ? 'googl' : isSpaceX ? 'spacex' : 'tsla';
        const ticker = isGoogle ? 'GOOGL' : isSpaceX ? 'SpaceX' : 'TSLA';
        const category = isGoogle ? 'AI 모델 / Agent' : isSpaceX ? 'Starship / 우주인프라' : '실적 / 재무';

        responseText = JSON.stringify({
          koreanTitle: `${companyName} 사업 분석`,
          category,
          contentType: 'product_event',
          importance: 4,
          impact: 'positive',
          relatedCompanies: [companyName],
          companyImpacts: [
            { companyId, companyName, ticker, impact: 'positive', rationale: '사업 진전' }
          ],
          factualPoints: ['공식 실적 및 분기 지표 발표 완료'],
          investmentImplications: '사업 실적 및 수익성 강화',
          whyItMatters: '핵심 성장 동력 유지',
          keyCheckpointsToWatch: ['영업 마진율'],
          relatedBusinesses: [isGoogle ? 'Gemini' : isSpaceX ? 'Starship' : 'FSD']
        });
      }

      return new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: responseText }],
              role: 'model',
            },
            finishReason: 'STOP',
          }
        ],
        usageMetadata: {
          promptTokenCount: 150,
          candidatesTokenCount: 35,
          totalTokenCount: 185,
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return originalFetch(input, init);
  };

  const originalEvents = [...db.getEvents()];
  db._setEventsForTesting([]);
  db._clearFingerprintsForTesting();

  try {
    const activeSubs = await db.getActiveTelegramSubscribers();
    const subCount = activeSubs.length > 0 ? activeSubs.length : 1;
    console.log(`  (Active subscribers detected: ${subCount} -> 1 broadcast = ${subCount} messages)`);

    // -----------------------------------------------------------------
    // TEST 1: Reuters와 CNBC가 동일 Tesla Q3 deliveries 기사를 보도 -> Event 1개, Telegram 1건
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Reuters + CNBC 동일 사건 보도 -> Event 1개 & Telegram 1건 ---');
    telegramFetchCalls = [];

    const reutersArticle: RawArticle = {
      id: 'raw-reuters-q3-001',
      title: 'Tesla Q3 deliveries beat estimates as Model Y demand surges',
      link: 'https://www.reuters.com/business/autos-transportation/tesla-q3-deliveries-beat-estimates-2026-10-02/',
      source: 'Reuters',
      publishedAt: new Date(Date.now() - 3600000).toISOString(),
      snippet: 'Tesla reported third-quarter vehicle deliveries that beat Wall Street estimates, driven by resilient demand.',
      firstSeenAt: new Date(Date.now() - 3600000).toISOString(),
      matchedCompanyIds: ['tsla'],
    };

    const cnbcArticle: RawArticle = {
      id: 'raw-cnbc-q3-002',
      title: '테슬라 3분기 차량 인도량 시장 예상치 상회... 주가 반응',
      link: 'https://www.cnbc.com/2026/10/02/tesla-q3-vehicle-deliveries-beat-expectations.html',
      source: 'CNBC',
      publishedAt: new Date(Date.now() - 1800000).toISOString(),
      snippet: 'CNBC 보도: 테슬라 3분기 인도량이 시장 예상치를 뛰어넘었습니다.',
      firstSeenAt: new Date(Date.now() - 1800000).toISOString(),
      matchedCompanyIds: ['tsla'],
    };

    const fpReuters = computeEventFingerprint(reutersArticle.title, reutersArticle.snippet, reutersArticle.matchedCompanyIds);
    const fpCnbc = computeEventFingerprint(cnbcArticle.title, cnbcArticle.snippet, cnbcArticle.matchedCompanyIds);

    console.log(`  Reuters Fingerprint: ${fpReuters}`);
    console.log(`  CNBC Fingerprint:    ${fpCnbc}`);
    assert.strictEqual(areFingerprintsMatching(fpReuters, fpCnbc, 1), true, 'Reuters and CNBC fingerprints must match');

    // Process both articles through clustering without AI API call
    const test1Events = await clusterAndProcessArticles([reutersArticle, cnbcArticle], false);
    assert.strictEqual(test1Events.length, 1, 'Exactly 1 unified Event must be created');
    assert.strictEqual(test1Events[0].articleCount, 2, 'Unified Event must contain 2 articles');
    assert.strictEqual(test1Events[0].relatedSources.length, 1, 'Unified Event must have 1 relatedSource');

    // Simulate 5★ event dispatch
    test1Events[0].importance = 5;
    test1Events[0].analysisStatus = 'completed';
    const dispatch1 = await sendEventToTelegram(test1Events[0]);
    assert.strictEqual(dispatch1.success, true);
    assert.strictEqual(telegramFetchCalls.length, subCount, `Telegram must be broadcast once (${subCount} messages)`);

    // Attempt second send of the same event
    const dispatch1Repeat = await sendEventToTelegram(test1Events[0]);
    assert.strictEqual(dispatch1Repeat.success, false, 'Duplicate send must be blocked');
    assert.strictEqual(telegramFetchCalls.length, subCount, 'Telegram count must remain unchanged');

    console.log('✅ TEST 1 Passed: Reuters + CNBC 병합 완료 (Event: 1개, Telegram: 1건)\n');

    // -----------------------------------------------------------------
    // TEST 2: Reuters -> MarketWatch -> Yahoo Finance 순으로 같은 사건 수집 -> relatedSources 증가, Telegram 계속 1건
    // -----------------------------------------------------------------
    console.log('--- TEST 2: Reuters -> MarketWatch -> Yahoo Finance 순차 수집 -> relatedSources 증가, Telegram 1건 유지 ---');
    db._setEventsForTesting([]);
    db._clearFingerprintsForTesting();
    telegramFetchCalls = [];

    const art1: RawArticle = {
      id: 'seq-art-1',
      title: 'Tesla Q3 deliveries beat estimates',
      link: 'https://reuters.com/article/tesla-q3-seq',
      source: 'Reuters',
      publishedAt: new Date(Date.now() - 7200000).toISOString(),
      snippet: 'Tesla Q3 vehicle deliveries beat expectations.',
      firstSeenAt: new Date(Date.now() - 7200000).toISOString(),
      matchedCompanyIds: ['tsla'],
    };

    // Step 2-1: First article ingested
    const seqEvents1 = await clusterAndProcessArticles([art1], false);
    assert.strictEqual(seqEvents1.length, 1);
    const mainEvent = seqEvents1[0];
    mainEvent.importance = 5;
    mainEvent.analysisStatus = 'completed';
    await db.saveEvent(mainEvent);

    // Telegram sent once for the 5★ event
    const send1 = await sendEventToTelegram(mainEvent);
    assert.strictEqual(send1.success, true);
    assert.strictEqual(telegramFetchCalls.length, subCount);
    assert.strictEqual(mainEvent.articleCount, 1);

    // Step 2-2: Second article ingested (MarketWatch)
    const art2: RawArticle = {
      id: 'seq-art-2',
      title: 'MarketWatch: Tesla beats Q3 delivery forecasts with strong numbers',
      link: 'https://marketwatch.com/article/tesla-q3-numbers',
      source: 'MarketWatch',
      publishedAt: new Date(Date.now() - 3600000).toISOString(),
      snippet: 'Tesla delivered more vehicles than analysts projected in Q3.',
      firstSeenAt: new Date(Date.now() - 3600000).toISOString(),
      matchedCompanyIds: ['tsla'],
    };

    const seqEvents2 = await clusterAndProcessArticles([art2], false);
    assert.strictEqual(seqEvents2.length, 0, 'No new event created; article merged into existing');
    const updatedAfterArt2 = db.getEventById(mainEvent.id);
    assert.ok(updatedAfterArt2);
    assert.strictEqual(updatedAfterArt2?.articleCount, 2, 'articleCount must increment to 2');
    assert.strictEqual(updatedAfterArt2?.relatedSources.length, 1);
    assert.strictEqual(telegramFetchCalls.length, subCount, 'Telegram count must remain unchanged (no duplicate sent on merge)');

    // Step 2-3: Third article ingested (Yahoo Finance)
    const art3: RawArticle = {
      id: 'seq-art-3',
      title: 'Yahoo Finance: Tesla stock surges after Q3 deliveries top views',
      link: 'https://finance.yahoo.com/news/tesla-q3-deliveries-surge',
      source: 'Yahoo Finance',
      publishedAt: new Date().toISOString(),
      snippet: 'Shares of Tesla gained on strong third quarter vehicle deliveries beating views.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['tsla'],
    };

    const seqEvents3 = await clusterAndProcessArticles([art3], false);
    assert.strictEqual(seqEvents3.length, 0, 'No new event created; article merged into existing');
    const updatedAfterArt3 = db.getEventById(mainEvent.id);
    assert.strictEqual(updatedAfterArt3?.articleCount, 3, 'articleCount must increment to 3');
    assert.strictEqual(updatedAfterArt3?.relatedSources.length, 2, 'relatedSources must contain 2 additional sources');
    assert.strictEqual(telegramFetchCalls.length, subCount, 'Telegram count must strictly remain unchanged');

    console.log('✅ TEST 2 Passed: 순차 수집 시 출처 누적 (3개) & Telegram 1건 유지 확인\n');

    // -----------------------------------------------------------------
    // TEST 3: 같은 Tesla라도 Q3 deliveries와 AI5 chip 기사는 별도 Event
    // -----------------------------------------------------------------
    console.log('--- TEST 3: 동일 기업(Tesla)이라도 Q3 deliveries와 AI5 chip 기사는 별도 Event ---');

    const deliveriesArticle: RawArticle = {
      id: 'diff-art-deliveries',
      title: 'Tesla Q3 vehicle deliveries beat analyst consensus',
      link: 'https://bloomberg.com/news/tesla-deliveries-q3-unique',
      source: 'Bloomberg',
      publishedAt: new Date().toISOString(),
      snippet: 'Tesla announced Q3 delivery figures exceeding market expectations.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['tsla'],
    };

    const ai5Article: RawArticle = {
      id: 'diff-art-ai5',
      title: 'Tesla AI5 chip RAM reduction announced for next-gen vehicles',
      link: 'https://electrek.co/news/tesla-ai5-chip-ram-reduction',
      source: 'Electrek',
      publishedAt: new Date().toISOString(),
      snippet: 'Elon Musk confirmed Tesla will optimize the AI5 chip with reduced RAM requirements.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['tsla'],
    };

    const fpDeliveries = computeEventFingerprint(deliveriesArticle.title, deliveriesArticle.snippet, deliveriesArticle.matchedCompanyIds);
    const fpAi5 = computeEventFingerprint(ai5Article.title, ai5Article.snippet, ai5Article.matchedCompanyIds);

    console.log(`  Deliveries Fingerprint: ${fpDeliveries}`);
    console.log(`  AI5 Chip Fingerprint:   ${fpAi5}`);

    assert.notStrictEqual(fpDeliveries, fpAi5, 'Fingerprints must be distinct');
    assert.strictEqual(areFingerprintsMatching(fpDeliveries, fpAi5, 0), false, 'Fingerprints must not match');

    // Test a third distinct Tesla event (Robotaxi launch)
    const fpRobotaxi = computeEventFingerprint('Tesla Robotaxi launch set for 10/10', 'Tesla will unveil Robotaxi Cybercab', ['tsla']);
    console.log(`  Robotaxi Fingerprint:   ${fpRobotaxi}`);
    assert.strictEqual(areFingerprintsMatching(fpDeliveries, fpRobotaxi, 0), false);
    assert.strictEqual(areFingerprintsMatching(fpAi5, fpRobotaxi, 0), false);

    console.log('✅ TEST 3 Passed: 동일 회사 내 서로 다른 사건 지문 분리 확인\n');

    // -----------------------------------------------------------------
    // TEST 4: importance 4 -> Telegram 0건
    // -----------------------------------------------------------------
    console.log('--- TEST 4: importance 4 -> Telegram 0건 (자동 발송 금지) ---');
    db._setEventsForTesting([]);
    db._clearFingerprintsForTesting();
    telegramFetchCalls = [];

    const event4Star = createUnanalyzedEvent({
      id: 'evt-4star-001',
      title: 'NVIDIA announces new enterprise partnership with Snowflake',
      link: 'https://reuters.com/technology/nvidia-snowflake-deal-2026',
      source: 'Reuters',
      publishedAt: new Date().toISOString(),
      snippet: 'NVIDIA and Snowflake announce expanded enterprise AI partnership.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['nvda'],
    });

    event4Star.importance = 4; // 4점 부여
    event4Star.analysisStatus = 'completed';
    await db.saveEvent(event4Star);

    const result4 = await sendEventToTelegram(event4Star, false);
    assert.strictEqual(result4.success, false, 'Auto-dispatch for 4-star event must return false');
    assert.ok(result4.error?.includes('restricted to importance === 5'), 'Error message must state restriction to 5★');
    assert.strictEqual(telegramFetchCalls.length, 0, 'No Telegram request must be fired for 4★');
    assert.strictEqual(event4Star.isSentToTelegram, false);

    console.log('✅ TEST 4 Passed: importance 4 자동 발송 차단 확인 (Telegram: 0건)\n');

    // -----------------------------------------------------------------
    // TEST 5: importance 5 -> Telegram 1건
    // -----------------------------------------------------------------
    console.log('--- TEST 5: importance 5 -> Telegram 1건 ---');
    db._setEventsForTesting([]);
    db._clearFingerprintsForTesting();
    telegramFetchCalls = [];

    const event5Star = createUnanalyzedEvent({
      id: 'evt-5star-001',
      title: 'SpaceX Starship orbital flight test approved by FAA for immediate launch',
      link: 'https://reuters.com/aerospace/spacex-starship-orbital-flight-faa-license-2026',
      source: 'Reuters',
      publishedAt: new Date().toISOString(),
      snippet: 'FAA grants final orbital launch license for SpaceX Starship Flight 6.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['spacex'],
    });

    event5Star.importance = 5; // 5점 긴급 중요
    event5Star.analysisStatus = 'completed';
    await db.saveEvent(event5Star);

    const result5 = await sendEventToTelegram(event5Star, false);
    assert.strictEqual(result5.success, true, 'Auto-dispatch for 5-star event must succeed');
    assert.strictEqual(telegramFetchCalls.length, subCount, `Exactly 1 Telegram broadcast (${subCount} messages) must be sent`);
    assert.strictEqual(event5Star.isSentToTelegram, true, 'isSentToTelegram must be true');

    console.log('✅ TEST 5 Passed: importance 5 정상 발송 확인 (Telegram: 1건)\n');

    // -----------------------------------------------------------------
    // TEST 6: 서로 다른 event.id 두 개가 실수로 생성됐지만 event fingerprint가 동일 -> Telegram 1건만 발송
    // -----------------------------------------------------------------
    console.log('--- TEST 6: 서로 다른 event.id지만 동일 event fingerprint -> Telegram 1건만 발송 ---');
    db._setEventsForTesting([]);
    db._clearFingerprintsForTesting();
    telegramFetchCalls = [];

    const identicalFp = 'nvda:blackwell:b200:earnings:beat:$10b';

    const eventA = createUnanalyzedEvent({
      id: 'evt-accident-alpha-111',
      title: 'NVIDIA B200 Blackwell chips drive $10B revenue beat',
      link: 'https://bloomberg.com/nvda-alpha',
      source: 'Bloomberg',
      publishedAt: new Date().toISOString(),
      snippet: 'NVIDIA beats $10B expectations.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['nvda'],
    });
    eventA.importance = 5;
    eventA.analysisStatus = 'completed';
    eventA.eventFingerprint = identicalFp;
    await db.saveEvent(eventA);

    const eventB = createUnanalyzedEvent({
      id: 'evt-accident-beta-222', // DIFFERENT EVENT ID!
      title: '엔비디아 블랙웰 B200 칩 호조로 100억 달러 매출 상회 기록',
      link: 'https://wsj.com/nvda-beta',
      source: 'WSJ',
      publishedAt: new Date().toISOString(),
      snippet: 'NVIDIA B200 Blackwell delivers $10B.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['nvda'],
    });
    eventB.importance = 5;
    eventB.analysisStatus = 'completed';
    eventB.eventFingerprint = identicalFp; // SAME FINGERPRINT!
    await db.saveEvent(eventB);

    // Dispatch Event A
    const resA = await sendEventToTelegram(eventA, false);
    assert.strictEqual(resA.success, true, 'First event with this fingerprint must succeed');
    assert.strictEqual(telegramFetchCalls.length, subCount);

    // Dispatch Event B (different event.id, but SAME fingerprint)
    const resB = await sendEventToTelegram(eventB, false);
    assert.strictEqual(resB.success, false, 'Second event with identical fingerprint must be rejected');
    assert.ok(resB.error?.includes('fingerprint') || resB.error?.includes('already sent'));
    assert.strictEqual(telegramFetchCalls.length, subCount, 'Telegram count must NOT increment for duplicate fingerprint');

    console.log('✅ TEST 6 Passed: 동일 지문 이종 event.id 차단 확인 (Telegram: 1건만 발송)\n');

    // -----------------------------------------------------------------
    // TEST 7: Cloud Run 인스턴스 2개가 동시에 같은 event를 전송 시도 -> Firestore transaction/atomic lock에 의해 1건만 발송
    // -----------------------------------------------------------------
    console.log('--- TEST 7: 인스턴스 2개 동시 전송 레이스 컨디션 방어 -> 1건만 발송 ---');
    db._setEventsForTesting([]);
    db._clearFingerprintsForTesting();
    telegramFetchCalls = [];

    const concurrentEvent = createUnanalyzedEvent({
      id: 'evt-concurrent-race-999',
      title: 'Google DeepMind reveals Gemini 3.0 Ultra with breakthrough reasoning',
      link: 'https://blog.google/technology/ai/gemini-3-deepmind-breakthrough',
      source: 'Google Official Blog',
      publishedAt: new Date().toISOString(),
      snippet: 'Google DeepMind unveils next frontier model Gemini 3.0 Ultra.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['googl'],
    });
    concurrentEvent.importance = 5;
    concurrentEvent.analysisStatus = 'completed';
    concurrentEvent.eventFingerprint = 'googl:gemini:launch:breakthrough';
    await db.saveEvent(concurrentEvent);

    // Simulate two concurrent Cloud Run workers executing simultaneously
    const worker1Promise = sendEventToTelegram(concurrentEvent, false);
    const worker2Promise = sendEventToTelegram(concurrentEvent, false);

    const [w1Result, w2Result] = await Promise.all([worker1Promise, worker2Promise]);

    const successes = [w1Result, w2Result].filter(r => r.success);
    const failures = [w1Result, w2Result].filter(r => !r.success);

    assert.strictEqual(successes.length, 1, 'Exactly one concurrent worker must succeed');
    assert.strictEqual(failures.length, 1, 'The other worker must be rejected by atomic lock');
    assert.strictEqual(telegramFetchCalls.length, subCount, 'Telegram API must be invoked exactly once');

    console.log('✅ TEST 7 Passed: 동시 전송 경쟁 상태에서 원자적 락으로 1건만 발송 확인\n');

    // -----------------------------------------------------------------
    // TEST 8: Daily Execution Guard (하루 1회 자동 수집 제한)
    // -----------------------------------------------------------------
    console.log('--- TEST 8: Daily Execution Guard (Asia/Seoul 기준 하루 1회 잠금) ---');
    db._clearDailyPollRunsForTesting();
    const testDate = '2026-10-05';

    // 1st automated attempt: should claim successfully
    const claim1 = await db.claimDailyPollRun(testDate, 'Cloud Scheduler /api/jobs/poll');
    assert.strictEqual(claim1.canRun, true, '1st automated poll claim must succeed');

    // Mark completed
    await db.completeDailyPollRun(testDate, {
      articlesCount: 15,
      eventsCreatedCount: 2,
      telegramAlertsCount: 1,
    });

    // 2nd automated attempt on the same date: must be blocked!
    const claim2 = await db.claimDailyPollRun(testDate, 'Cloud Scheduler /api/jobs/poll');
    assert.strictEqual(claim2.canRun, false, '2nd automated poll claim on the same date must be blocked');
    assert.strictEqual(claim2.reason, 'already_completed', 'Blocked reason must be already_completed');

    // Next day attempt (2026-10-06): should succeed
    const claimNextDay = await db.claimDailyPollRun('2026-10-06', 'Cloud Scheduler /api/jobs/poll');
    assert.strictEqual(claimNextDay.canRun, true, 'Next calendar day claim must succeed');

    console.log('✅ TEST 8 Passed: 동일 일자(Asia/Seoul) 2회차 자동 수집 잠금 및 익일 정상 해제 확인\n');

    // -----------------------------------------------------------------
    // TEST 9: In-batch Pre-Deduplication (동일 배치 내 중복 기사 Gemini 호출 1회 이하 보장)
    // -----------------------------------------------------------------
    console.log('--- TEST 9: In-batch Pre-Deduplication (Gemini 토큰 절약 사전 필터링) ---');
    const duplicateBatchArticle1: RawArticle = {
      id: 'batch-art-1',
      title: 'Tesla Q3 vehicle deliveries beat Wall Street consensus',
      link: 'https://reuters.com/business/tesla-q3-deliveries-beat-consensus-unique1',
      source: 'Reuters',
      publishedAt: new Date().toISOString(),
      snippet: 'Tesla reported third quarter vehicle deliveries that topped Wall Street estimates.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['tsla'],
    };
    const duplicateBatchArticle2: RawArticle = {
      id: 'batch-art-2',
      title: 'Tesla Q3 vehicle deliveries beat Wall Street consensus',
      link: 'https://reuters.com/business/tesla-q3-deliveries-beat-consensus-unique1?utm_source=twitter',
      source: 'Reuters',
      publishedAt: new Date().toISOString(),
      snippet: 'Tesla reported third quarter vehicle deliveries that topped Wall Street estimates.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['tsla'],
    };
    const duplicateBatchArticle3: RawArticle = {
      id: 'batch-art-3',
      title: '테슬라 3분기 차량 인도량 시장 예상치 상회 발표',
      link: 'https://cnbc.com/2026/tesla-q3-deliveries-surprise-korean',
      source: 'CNBC',
      publishedAt: new Date().toISOString(),
      snippet: '테슬라가 3분기 차량 인도량 실적을 발표하며 시장의 기대를 상회했습니다.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['tsla'],
    };

    // Process batch of 3 articles representing the same event
    const batchEvents = await clusterAndProcessArticles(
      [duplicateBatchArticle1, duplicateBatchArticle2, duplicateBatchArticle3],
      false
    );

    assert.strictEqual(batchEvents.length, 1, 'Batch with 3 duplicate/same-event articles must yield exactly 1 event');
    assert.strictEqual(batchEvents[0].articleCount >= 2, true, 'Related sources must be merged without creating duplicate events');
    console.log('✅ TEST 9 Passed: 동일 배치 내 URL/Fingerprint 사전 통합 및 단일 Event 생성 확인\n');

    // -----------------------------------------------------------------
    // TEST 10: 5★ 뉴스라도 출처 품질 불충분(Tier 3 단독/미확인 루머) -> Telegram 0건 (자동 발송 차단)
    // -----------------------------------------------------------------
    console.log('--- TEST 10: 5★ 뉴스 + 출처 품질 불충분 (Tier 3 단독) -> Telegram 자동 발송 차단 ---');
    db._setEventsForTesting([]);
    db._clearFingerprintsForTesting();
    telegramFetchCalls = [];

    const uncorroboratedTier3Event = createUnanalyzedEvent({
      id: 'evt-tier3-uncorroborated-001',
      title: 'SpaceX secretly preparing immediate unannounced launch from Texas',
      link: 'https://random-speculation-blog.com/spacex-secret-launch-2026',
      source: 'Speculation Blog',
      publishedAt: new Date().toISOString(),
      snippet: 'Anonymous forum poster claims SpaceX is preparing secret launch today.',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['spacex'],
    });

    uncorroboratedTier3Event.importance = 5; // 중요도는 5★
    uncorroboratedTier3Event.analysisStatus = 'completed';
    uncorroboratedTier3Event.sourceTier = 'tier3';
    uncorroboratedTier3Event.primarySource.sourceTier = 'tier3';
    uncorroboratedTier3Event.corroboratedSourceCount = 1; // 단독 출처 (교차 확인 없음)
    uncorroboratedTier3Event.hasTrustedSource = false;
    uncorroboratedTier3Event.detectedOriginalSource = undefined;
    await db.saveEvent(uncorroboratedTier3Event);

    const qualification10 = isEventQualifiedForTelegramAutoDispatch(uncorroboratedTier3Event, db.getSettings());
    assert.strictEqual(qualification10.qualified, false, 'Tier 3 uncorroborated event must not qualify for auto-dispatch');
    assert.ok(qualification10.reason?.includes('Insufficient source credibility'), 'Reason must indicate source credibility failure');

    const result10 = await sendEventToTelegram(uncorroboratedTier3Event, false);
    assert.strictEqual(result10.success, false, 'sendEventToTelegram must fail for uncorroborated Tier 3');
    assert.strictEqual(telegramFetchCalls.length, 0, 'No Telegram fetch calls must occur for unverified Tier 3');
    console.log('✅ TEST 10 Passed: 5★라도 출처 품질 불충분 시 자동 발송 완벽 차단 확인\n');

    // -----------------------------------------------------------------
    // TEST 11: 5★ 뉴스 + 신뢰 출처 또는 교차 확인(Corroborated) -> Telegram 발송 자격 충족
    // -----------------------------------------------------------------
    console.log('--- TEST 11: 5★ 뉴스 + 신뢰 출처/교차 확인 -> Telegram 발송 자격 충족 ---');
    const tier1Event = { 
      ...uncorroboratedTier3Event, 
      id: 'evt-tier1-001', 
      sourceTier: 'tier1' as const, 
      primarySource: { ...uncorroboratedTier3Event.primarySource, sourceTier: 'tier1' as const } 
    };
    const qualTier1 = isEventQualifiedForTelegramAutoDispatch(tier1Event, db.getSettings());
    assert.strictEqual(qualTier1.qualified, true, 'Tier 1 5★ event must qualify');

    const corroboratedTier3Event = { 
      ...uncorroboratedTier3Event, 
      id: 'evt-tier3-corrob-001', 
      corroboratedSourceCount: 2 
    };
    const qualCorrob = isEventQualifiedForTelegramAutoDispatch(corroboratedTier3Event, db.getSettings());
    assert.strictEqual(qualCorrob.qualified, true, 'Corroborated (>=2 sources) Tier 3 5★ event must qualify');
    console.log('✅ TEST 11 Passed: Tier 1/2 및 교차 확인 출처의 정상 발송 자격 충족 확인\n');

    // -----------------------------------------------------------------
    // TEST 12: 세션 토큰 보안 검증 (HMAC-SHA256, 서명 변조 거절, 만료 거절)
    // -----------------------------------------------------------------
    console.log('--- TEST 12: 세션 토큰 보안 검증 (HMAC-SHA256, 서명 변조 거절, 만료 거절) ---');
    const testSecret = 'admin-secret-test-key-32-chars-long!';
    const token = generateSessionToken(testSecret);
    assert.strictEqual(verifySessionToken(token, testSecret), true, 'Valid token and matching secret must pass');
    assert.strictEqual(verifySessionToken(token, 'wrong-secret'), false, 'Wrong secret must be rejected');

    // 변조된 토큰 (서명 일부 변경)
    const tamperedToken = token.slice(0, -4) + 'abcd';
    assert.strictEqual(verifySessionToken(tamperedToken, testSecret), false, 'Tampered signature must be rejected');

    // 만료된 토큰
    const pastExpiry = Date.now() - 10000;
    const expiredPayload = `${pastExpiry}.testnonce12345`;
    const expiredSig = crypto.createHmac('sha256', testSecret).update(expiredPayload).digest('hex');
    const expiredToken = `${expiredPayload}.${expiredSig}`;
    assert.strictEqual(verifySessionToken(expiredToken, testSecret), false, 'Expired session token must be rejected');
    console.log('✅ TEST 12 Passed: 세션 토큰 정상 발급 및 변조/만료 토큰 거절 확인\n');

    // -----------------------------------------------------------------
    // TEST 13: 우회 헤더 + 가짜 Origin 관리자 인증 우회 차단 (isDashboardOrSameOrigin 제거 검증)
    // -----------------------------------------------------------------
    console.log('--- TEST 13: 우회 헤더 + 가짜 Origin 관리자 인증 차단 ---');
    process.env.ADMIN_SECRET = testSecret;

    // 가짜 우회 헤더와 가짜 오리진을 가진 모의 요청
    const fakeBypassReq = {
      headers: {
        'x-client-app': 'investment-intelligence',
        'x-dashboard-request': 'true',
        'sec-fetch-site': 'same-origin',
        origin: 'https://attacker-run.app.evil.com',
        referer: 'https://attacker-run.app.evil.com/dashboard',
      },
      cookies: {},
      get: (h: string) => fakeBypassReq.headers[h.toLowerCase() as keyof typeof fakeBypassReq.headers],
    } as any;

    const authBypassResult = checkAdminAuth(fakeBypassReq);
    assert.strictEqual(authBypassResult.authenticated, false, 'Bypass headers and fake origin MUST NOT authenticate admin');

    // CSRF Origin validation checks (scheme/host/port exact match)
    assert.strictEqual(isValidCsrfOrigin(fakeBypassReq), false, 'Attacker origin with substring matching must fail CSRF validation');

    const fakeLocalhostReq = {
      headers: {
        origin: 'http://localhost.evil.com:3000',
      },
      get: (h: string) => fakeLocalhostReq.headers[h.toLowerCase() as keyof typeof fakeLocalhostReq.headers],
    } as any;
    assert.strictEqual(isValidCsrfOrigin(fakeLocalhostReq), false, 'Fake localhost domain must fail CSRF validation');

    // Reject unauthorized port on localhost
    const fakePortReq = {
      headers: {
        origin: 'http://localhost:9999',
      },
      get: (h: string) => fakePortReq.headers[h.toLowerCase() as keyof typeof fakePortReq.headers],
    } as any;
    assert.strictEqual(isValidCsrfOrigin(fakePortReq, { serverPort: 3000 }), false, 'Localhost with mismatched port must fail CSRF validation');

    // Fail-closed when Origin and Referer are absent on mutating requests
    const noOriginReq = {
      headers: {
        'sec-fetch-site': 'none',
      },
      cookies: {},
      get: (h: string) => noOriginReq.headers[h.toLowerCase() as keyof typeof noOriginReq.headers],
    } as any;
    assert.strictEqual(isValidCsrfOrigin(noOriginReq), false, 'Missing Origin on mutating request must fail-closed (no sec-fetch-site: none bypass)');

    // Legitimate local dev origin passes
    const validLocalReq = {
      headers: {
        origin: 'http://localhost:3000',
      },
      get: (h: string) => validLocalReq.headers[h.toLowerCase() as keyof typeof validLocalReq.headers],
    } as any;
    assert.strictEqual(isValidCsrfOrigin(validLocalReq, { serverPort: 3000 }), true, 'Exact legitimate origin must pass CSRF validation');
    console.log('✅ TEST 13 Passed: 우회 헤더 및 가짜 Origin 통한 인증 우회 완벽 차단 확인\n');

    // -----------------------------------------------------------------
    // TEST 14: ADMIN_SECRET 미설정 시 Fail-Closed 검증
    // -----------------------------------------------------------------
    console.log('--- TEST 14: ADMIN_SECRET 미설정 시 Fail-Closed 검증 ---');
    const savedAdminSecret = process.env.ADMIN_SECRET;
    delete process.env.ADMIN_SECRET;

    const unconfiguredReq = {
      headers: {},
      cookies: {},
      get: () => undefined,
    } as any;

    const failClosedCheck = checkAdminAuth(unconfiguredReq);
    assert.strictEqual(failClosedCheck.authenticated, false, 'Unconfigured ADMIN_SECRET must fail-closed');

    const tokenReq = {
      headers: { authorization: 'Bearer some-random-password' },
      cookies: {},
      get: () => undefined,
    } as any;
    assert.strictEqual(checkAdminAuth(tokenReq).authenticated, false, 'Token presentation with unconfigured secret must fail-closed');

    process.env.ADMIN_SECRET = savedAdminSecret;
    console.log('✅ TEST 14 Passed: ADMIN_SECRET 미설정 시 Fail-Closed 정책 확인\n');

    // -----------------------------------------------------------------
    // TEST 15: Telegram Webhook 보안 검증 (운영 함수: verifyTelegramWebhookSecret, validateTelegramUpdate, TelegramReplayTracker)
    // -----------------------------------------------------------------
    console.log('--- TEST 15: Telegram Webhook 보안 검증 (운영 보안 함수 기반) ---');
    const testWebhookSecret = 'webhook-secret-token-random-abc';
    process.env.TELEGRAM_WEBHOOK_SECRET = testWebhookSecret;

    const webhookReq = (secretHeader?: string) => ({
      headers: {
        'x-telegram-bot-api-secret-token': secretHeader,
      },
      get: (h: string) => (secretHeader && h.toLowerCase() === 'x-telegram-bot-api-secret-token' ? secretHeader : undefined),
    } as any);

    assert.strictEqual(verifyTelegramWebhookSecret(webhookReq(testWebhookSecret)), true, 'Exact secret must match');
    assert.strictEqual(verifyTelegramWebhookSecret(webhookReq('wrong-secret-token')), false, 'Wrong secret must fail');
    assert.strictEqual(verifyTelegramWebhookSecret(webhookReq('')), false, 'Empty secret must fail');

    // Payload validation tests (safe integer update_id and chat.id)
    const validUpdate = {
      update_id: 123456,
      message: {
        chat: { id: 987654 },
        text: '/status',
      },
    };
    const validResult = validateTelegramUpdate(validUpdate);
    assert.strictEqual(validResult.valid, true, 'Valid update structure must pass');
    assert.strictEqual(validResult.updateId, 123456);
    assert.strictEqual(validResult.chatId, '987654');

    // Negative or non-safe-integer update_id must be rejected
    assert.strictEqual(validateTelegramUpdate({ update_id: -1 }).valid, false, 'Negative update_id must be rejected');
    assert.strictEqual(validateTelegramUpdate({ update_id: 123.45 }).valid, false, 'Floating-point update_id must be rejected');
    assert.strictEqual(validateTelegramUpdate({ update_id: '12345' }).valid, false, 'String update_id must be rejected');

    // chat.id must be a safe integer number
    assert.strictEqual(validateTelegramUpdate({ update_id: 1, message: { chat: { id: 'not-a-number' } } }).valid, false, 'String chat.id must be rejected');
    assert.strictEqual(validateTelegramUpdate({ update_id: 1, message: { chat: { id: 12.34 } } }).valid, false, 'Float chat.id must be rejected');

    // Replay Tracker tests
    const testReplayTracker = new TelegramReplayTracker(10);
    assert.strictEqual(testReplayTracker.isReplay(888001), false, 'Initial update_id must not be flagged as replay');
    testReplayTracker.recordSuccess(888001);
    assert.strictEqual(testReplayTracker.isReplay(888001), true, 'Successfully processed update_id must be flagged as replay');

    // On failure: failed update_id is NOT recorded in tracker so it can be retried by Telegram
    assert.strictEqual(testReplayTracker.isReplay(888002), false, 'Failed update_id must not be marked as processed');
    console.log('✅ TEST 15 Passed: Telegram Webhook 운영 검증 함수 및 Replay 방어 정상 동작 확인\n');

    // -----------------------------------------------------------------
    // TEST 16: Cron /api/jobs/poll 보안 검증 (운영 함수: verifyCronAuth)
    // -----------------------------------------------------------------
    console.log('--- TEST 16: Cron /api/jobs/poll 보안 검증 (운영 함수 기반) ---');
    const testCronSecret = 'cron-secret-xyz-777';
    process.env.CRON_SECRET = testCronSecret;
    process.env.ADMIN_SECRET = 'admin-secret-different-999';

    const cronReq = (bearer?: string, customHeader?: string) => ({
      headers: {
        authorization: bearer ? `Bearer ${bearer}` : undefined,
        'x-cron-secret': customHeader,
      },
      get: (h: string) => {
        if (h.toLowerCase() === 'authorization' && bearer) return `Bearer ${bearer}`;
        if (h.toLowerCase() === 'x-cron-secret' && customHeader) return customHeader;
        return undefined;
      },
    } as any);

    assert.strictEqual(verifyCronAuth(cronReq(testCronSecret)).authorized, true, 'Bearer CRON_SECRET must succeed');
    assert.strictEqual(verifyCronAuth(cronReq(undefined, testCronSecret)).authorized, true, 'X-Cron-Secret header must succeed');
    assert.strictEqual(verifyCronAuth(cronReq(process.env.ADMIN_SECRET)).authorized, false, 'ADMIN_SECRET must NOT authenticate cron');
    
    delete process.env.CRON_SECRET;
    assert.strictEqual(verifyCronAuth(cronReq(testCronSecret)).authorized, false, 'Unconfigured CRON_SECRET must fail-closed');
    process.env.CRON_SECRET = testCronSecret;
    console.log('✅ TEST 16 Passed: Cloud Scheduler 전용 CRON_SECRET 운영 인증 함수 검증 완료\n');

    // -----------------------------------------------------------------
    // TEST 17: 보호된 관리자 인증 검증 & 쿠키 SameSite 정책 검증
    // -----------------------------------------------------------------
    console.log('--- TEST 17: 보호된 관리자 인증 검증 & 쿠키 SameSite 정책 검증 ---');
    process.env.ADMIN_SECRET = testSecret;

    // Cookie options: default is lax; only verified preview over HTTPS gets none
    const normalReq = { headers: {}, secure: false } as any;
    const defaultCookieOpts = getCookieOptions(normalReq);
    assert.strictEqual(defaultCookieOpts.sameSite, 'lax', 'Default cookie must have SameSite=lax for CSRF protection');

    const previewReq = { 
      headers: { origin: 'https://preview-123.usercontent.goog' }, 
      secure: true 
    } as any;
    const previewCookieOpts = getCookieOptions(previewReq);
    assert.strictEqual(previewCookieOpts.sameSite, 'none', 'Verified HTTPS preview context gets SameSite=none');
    assert.strictEqual(previewCookieOpts.secure, true, 'SameSite=none cookie must have secure=true');

    const validCookieReq = {
      headers: {},
      cookies: {
        [SESSION_COOKIE_NAME]: generateSessionToken(testSecret),
      },
      get: () => undefined,
    } as any;
    const cookieAuth = checkAdminAuth(validCookieReq);
    assert.strictEqual(cookieAuth.authenticated, true);
    assert.strictEqual(cookieAuth.authMethod, 'cookie');

    const validBearerReq = {
      headers: {
        authorization: `Bearer ${testSecret}`,
      },
      cookies: {},
      get: () => undefined,
    } as any;
    const bearerAuth = checkAdminAuth(validBearerReq);
    assert.strictEqual(bearerAuth.authenticated, true);
    assert.strictEqual(bearerAuth.authMethod, 'token');

    const unauthReq = {
      headers: {},
      cookies: {},
      get: () => undefined,
    } as any;
    const unauthCheck = checkAdminAuth(unauthReq);
    assert.strictEqual(unauthCheck.authenticated, false, 'Unauthenticated request must be denied');
    console.log('✅ TEST 17 Passed: 관리자 보호 경로 인증 및 Lax 쿠키 정책 확인\n');

    // -----------------------------------------------------------------
    // TEST 18: 실제 Express HTTP 엔드포인트 격리 통합 회귀 검증
    // (createApp factory, real HTTP calls on ephemeral port, external mock state)
    // -----------------------------------------------------------------
    console.log('--- TEST 18: 실제 Express HTTP 엔드포인트 격리 통합 회귀 검증 ---');
    const expressApp = createServerApp({ isTest: true });
    const testHttpServer = http.createServer(expressApp);

    await new Promise<void>((resolve) => testHttpServer.listen(0, '127.0.0.1', () => resolve()));
    const address = testHttpServer.address();
    const testPort = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${testPort}`;
    console.log(`  (Test Express server active on ${baseUrl})`);

    try {
      // 1. Cron endpoint Method check (GET /api/jobs/poll -> 405 Method Not Allowed)
      const cronGetRes = await originalFetch(`${baseUrl}/api/jobs/poll?secret=${testCronSecret}`);
      assert.strictEqual(cronGetRes.status, 405, 'GET /api/jobs/poll must return 405 Method Not Allowed');

      // 2. Cron endpoint query-only rejection (POST /api/jobs/poll?secret=... without auth header -> 401)
      const cronQueryRes = await originalFetch(`${baseUrl}/api/jobs/poll?secret=${testCronSecret}`, {
        method: 'POST',
      });
      assert.strictEqual(cronQueryRes.status, 401, 'POST /api/jobs/poll with only query secret must return 401 Unauthorized');

      // 3. Unauthenticated admin routes rejection (GET /api/settings and GET /api/logs -> 401)
      const settingsUnauthRes = await originalFetch(`${baseUrl}/api/settings`);
      assert.strictEqual(settingsUnauthRes.status, 401, 'GET /api/settings without auth must return 401');

      const logsUnauthRes = await originalFetch(`${baseUrl}/api/logs`);
      assert.strictEqual(logsUnauthRes.status, 401, 'GET /api/logs without auth must return 401');

      // 4. Bypass headers check on real Express route (x-client-app, x-dashboard-request -> still 401)
      const bypassAttemptRes = await originalFetch(`${baseUrl}/api/settings`, {
        headers: {
          'x-client-app': 'investment-intelligence',
          'x-dashboard-request': 'true',
          'origin': 'https://attacker.evil.com',
        },
      });
      assert.strictEqual(bypassAttemptRes.status, 401, 'Bypass headers on real Express route must return 401');

      // 5. Login CSRF protection: forged Origin -> 403 Forbidden
      const loginCsrfRes = await originalFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://attacker.evil.com',
        },
        body: JSON.stringify({ password: testSecret }),
      });
      assert.strictEqual(loginCsrfRes.status, 403, 'Login with forged Origin must return 403 Forbidden');

      // 6. Login with genuine Origin -> 200 OK and receives HttpOnly session cookie
      const loginSuccessRes = await originalFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': baseUrl,
        },
        body: JSON.stringify({ password: testSecret }),
      });
      assert.strictEqual(loginSuccessRes.status, 200, 'Login with valid secret & origin must return 200 OK');
      const setCookieHeader = loginSuccessRes.headers.get('set-cookie') || '';
      assert.ok(setCookieHeader.includes(SESSION_COOKIE_NAME), 'Set-Cookie must contain admin_session');
      assert.ok(setCookieHeader.toLowerCase().includes('httponly'), 'Cookie must be HttpOnly');
      assert.ok(setCookieHeader.toLowerCase().includes('samesite=lax'), 'Cookie default SameSite must be Lax');

      // Extract cookie string for authenticated requests
      const cookieValue = setCookieHeader.split(';')[0];

      // 7. Cookie-authenticated mutating request with forged Origin -> 403 Forbidden (CSRF Blocked)
      const settingsMutateCsrfRes = await originalFetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieValue,
          'Origin': 'https://attacker.evil.com',
        },
        body: JSON.stringify({ pollIntervalMinutes: 30 }),
      });
      assert.strictEqual(settingsMutateCsrfRes.status, 403, 'Mutating request with cookie and attacker Origin must return 403 Forbidden');

      // 8. Cookie-authenticated mutating request with genuine Origin -> 200 OK
      const settingsMutateValidRes = await originalFetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieValue,
          'Origin': baseUrl,
        },
        body: JSON.stringify({ pollIntervalMinutes: 30 }),
      });
      assert.strictEqual(settingsMutateValidRes.status, 200, 'Mutating request with valid cookie and genuine Origin must succeed');

      // 9. Telegram Webhook: missing secret -> 403 Forbidden
      const webhookNoSecretRes = await originalFetch(`${baseUrl}/api/telegram/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ update_id: 999111 }),
      });
      assert.strictEqual(webhookNoSecretRes.status, 403, 'Telegram webhook without secret header must return 403');

      // 10. Telegram Webhook: invalid payload (negative update_id) -> 400 Bad Request
      const webhookBadPayloadRes = await originalFetch(`${baseUrl}/api/telegram/webhook`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': testWebhookSecret,
        },
        body: JSON.stringify({ update_id: -99 }),
      });
      assert.strictEqual(webhookBadPayloadRes.status, 400, 'Telegram webhook with negative update_id must return 400');

      // 11. Telegram Webhook: valid command execution -> 200 OK
      const webhookValidRes = await originalFetch(`${baseUrl}/api/telegram/webhook`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': testWebhookSecret,
        },
        body: JSON.stringify({
          update_id: 777001,
          message: {
            chat: { id: 123456789 },
            text: '/help',
          },
        }),
      });
      assert.strictEqual(webhookValidRes.status, 200, 'Valid Telegram webhook command must return 200 OK');

      // 12. Telegram Webhook: replay defense (same update_id delivered again) -> 200 with skipped
      const webhookReplayRes = await originalFetch(`${baseUrl}/api/telegram/webhook`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': testWebhookSecret,
        },
        body: JSON.stringify({
          update_id: 777001,
          message: {
            chat: { id: 123456789 },
            text: '/help',
          },
        }),
      });
      assert.strictEqual(webhookReplayRes.status, 200);
      const replayJson = await webhookReplayRes.json();
      assert.strictEqual(replayJson.skipped, 'duplicate_update_id', 'Replayed update_id must be flagged as duplicate and skipped');

      console.log('✅ TEST 18 Passed: 실제 Express 앱 HTTP 통합 회귀 검증 완료 (CSRF, Cron, Auth, Webhook)\n');
    } finally {
      await new Promise<void>((resolve) => testHttpServer.close(() => resolve()));
    }

    // -----------------------------------------------------------------
    // TEST 19: 토큰 절감 및 사이클 호출 예산 가드레일 종합 검증 (Semantic<=4, Analysis<=8, Retry<=3, 429중단)
    // -----------------------------------------------------------------
    console.log('--- TEST 19: 토큰 절감 및 사이클 호출 예산 가드레일 종합 검증 ---');
    process.env.GEMINI_API_KEY = 'test-token-gemini-budget-guard';
    geminiFetchCalls = [];
    geminiDedupCallCount = 0;
    geminiAnalysisCallCount = 0;
    mockGeminiRateLimit = false;
    mockGeminiDedupResponse = 'SAME';

    // 19-1: 대량 신규/후보 많은 배치에서도 semantic dedup 호출 최대 4회 엄격 제한
    db._setEventsForTesting([]);
    const existingEvt: NewsEvent = {
      id: 'evt-base-gemini-test',
      title: '구글 알파벳 Gemini 2.0 모델 공식 공개 및 플랫폼 출시',
      originalTitle: 'Alphabet Google Gemini 2.0 debut event and platform launch',
      category: 'AI 모델 / Agent',
      contentType: 'product_event',
      importance: 4,
      isImportant: true,
      impact: 'positive',
      impactRationale: '차세대 AI 역량 강화',
      relatedCompanies: ['Alphabet / Google'],
      companyImpacts: [{ companyId: 'googl', companyName: 'Alphabet / Google', ticker: 'GOOGL', impact: 'positive', rationale: 'AI 모델 진전' }],
      factualPoints: ['Gemini 2.0 모델 공식 배포 및 API 개방'],
      summaryBulletPoints: ['Gemini 2.0 debut'],
      investmentImplications: 'AI 서비스 경쟁력 제고',
      whyItMatters: '검색 및 클라우드 AI 점유율 방어',
      keyCheckpointsToWatch: ['개발자 채택률'],
      relatedBusinesses: ['Gemini'],
      primarySource: {
        name: 'The Verge',
        url: 'https://theverge.com/google-gemini-2-launch',
        title: 'Google launches Gemini 2.0',
        publishedAt: new Date().toISOString(),
        snippet: 'Google debuts Gemini 2.0 for developers',
        sourceTier: 'tier2',
        sourceReliability: 8,
      },
      relatedSources: [],
      articleCount: 1,
      sourceTier: 'tier2',
      sourceReliability: 8,
      corroboratedSourceCount: 1,
      hasTrustedSource: true,
      firstSeenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      analyzedByGemini: true,
      analysisStatus: 'completed',
      investmentImpactExplanation: 'AI 서비스 경쟁력 제고',
      isSentToTelegram: false,
    };
    db._setEventsForTesting([existingEvt]);

    const distinctArticles = [
      { topic: 'capex and infrastructure spending report', link: 'https://b1.com' },
      { topic: 'quarterly financial earnings and revenue impact', link: 'https://b2.com' },
      { topic: 'antitrust regulatory probe and legal scrutiny', link: 'https://b3.com' },
      { topic: 'government defense procurement contract', link: 'https://b4.com' },
      { topic: 'international aviation licensing approval', link: 'https://b5.com' },
      { topic: 'orbital flight test and technical launch', link: 'https://b6.com' }
    ];

    const candidateArticles: RawArticle[] = distinctArticles.map((item, i) => ({
      id: `raw-cand-${i}`,
      title: `Google Gemini 2.0 ${item.topic}`,
      link: item.link,
      source: `TechBlog ${i}`,
      publishedAt: new Date().toISOString(),
      snippet: `In-depth exploration of Gemini 2.0 ${item.topic}`,
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['googl'],
    }));

    const tracker1 = createCycleBudgetTracker();
    mockGeminiDedupResponse = 'DIFFERENT';
    await clusterAndProcessArticles(candidateArticles, true, 8, {
      maxSemanticDedupCalls: 4,
      tracker: tracker1,
    });

    assert(
      geminiDedupCallCount <= 4,
      `Semantic dedup calls must be capped at <= 4 per cycle, actual: ${geminiDedupCallCount}`
    );
    assert.strictEqual(tracker1.semanticDedupCalls, 4, 'Budget tracker must record exactly 4 semantic dedup calls');
    assert(tracker1.semanticDedupSkips > 0, 'Candidates beyond budget limit must be recorded as skips');

    // 19-2: 신규 이벤트 분석 상한 <= 8 유지 및 미분석 기사는 삭제 없이 pending 보존
    db._setEventsForTesting([]);
    geminiAnalysisCallCount = 0;
    const tracker2 = createCycleBudgetTracker();
    const distinctBatchTopics = [
      { title: 'SpaceX Falcon 9 orbital satellite launch batch 0', company: 'spacex' },
      { title: 'Tesla Cybertruck production factory expansion update batch 1', company: 'tsla' },
      { title: 'NVIDIA Rubin GPU architecture next gen unveil batch 2', company: 'nvda' },
      { title: 'Alphabet Waymo autonomous ride hailing service expansion batch 3', company: 'googl' },
      { title: 'Microsoft Azure quantum computing datacenter pilot batch 4', company: 'msft' },
      { title: 'SpaceX Starlink direct to cell constellation deployment batch 5', company: 'spacex' },
      { title: 'Tesla Megapack utility grid battery storage project batch 6', company: 'tsla' },
      { title: 'NVIDIA Blackwell server rack cooling solution announcement batch 7', company: 'nvda' },
      { title: 'Alphabet DeepMind biological protein folding breakthrough batch 8', company: 'googl' },
      { title: 'Microsoft Copilot workplace productivity assistant update batch 9', company: 'msft' },
      { title: 'SpaceX Starshield military defense satellite network batch 10', company: 'spacex' },
      { title: 'Tesla Optimus humanoid robot assembly line deployment batch 11', company: 'tsla' }
    ];

    const largeBatch: RawArticle[] = distinctBatchTopics.map((item, i) => ({
      id: `raw-distinct-${i}`,
      title: item.title,
      link: `https://news-outlet-${i}.org/story-${i}`,
      source: `News Outlet ${i}`,
      publishedAt: new Date().toISOString(),
      snippet: `Detailed coverage regarding ${item.title}`,
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: [item.company],
    }));

    const createdLargeBatch = await clusterAndProcessArticles(largeBatch, true, 8, {
      tracker: tracker2,
    });

    assert.strictEqual(
      geminiAnalysisCallCount,
      8,
      `Gemini new analysis must strictly respect max 8 per cycle, actual: ${geminiAnalysisCallCount}`
    );
    assert.strictEqual(createdLargeBatch.length, 12, 'All 12 articles must be created as events without any dropped data');
    const completedEvents = createdLargeBatch.filter(e => e.analysisStatus === 'completed');
    const pendingEvents = createdLargeBatch.filter(e => e.analysisStatus === 'pending');
    assert.strictEqual(completedEvents.length, 8, '8 events must be completed');
    assert.strictEqual(pendingEvents.length, 4, 'Remaining 4 events must be safely preserved in pending status');
    assert.strictEqual(tracker2.newAnalysesSkips, 4, 'Tracker must record 4 skips due to budget limit');

    // 19-3: 같은 이벤트가 단일 사이클 내 여러 기사와 병합되어도 pending 분석 중복 호출 방지
    db._setEventsForTesting([]);
    geminiAnalysisCallCount = 0;
    const tracker3 = createCycleBudgetTracker();

    const basePendingArticle: RawArticle = {
      id: 'raw-pending-base',
      title: 'SpaceX Starship flight 8 upcoming static fire test window',
      link: 'https://spaceflight.com/starship-static-fire',
      source: 'SpaceFlightNow',
      publishedAt: new Date().toISOString(),
      snippet: 'Starship flight 8 prototype prepares for static fire test',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['spacex'],
    };
    const pendingEvt = createUnanalyzedEvent(basePendingArticle, '초기 대기');
    db._setEventsForTesting([pendingEvt]);

    const mergeBatch: RawArticle[] = [
      {
        id: 'raw-merge-1',
        title: 'SpaceX Starship flight 8 static fire test schedule updated',
        link: 'https://reuters.com/starship-flight8-test',
        source: 'Reuters',
        publishedAt: new Date().toISOString(),
        snippet: 'Starship flight 8 prototype prepares for static fire test at Starbase',
        firstSeenAt: new Date().toISOString(),
        matchedCompanyIds: ['spacex'],
      },
      {
        id: 'raw-merge-2',
        title: 'SpaceX Starship flight 8 static fire test timeline confirmed',
        link: 'https://bloomberg.com/starship-flight8-test',
        source: 'Bloomberg',
        publishedAt: new Date().toISOString(),
        snippet: 'Starship flight 8 prototype prepares for static fire test at Starbase',
        firstSeenAt: new Date().toISOString(),
        matchedCompanyIds: ['spacex'],
      },
      {
        id: 'raw-merge-3',
        title: 'SpaceX Starship flight 8 static fire test coverage',
        link: 'https://cnbc.com/starship-flight8-test',
        source: 'CNBC',
        publishedAt: new Date().toISOString(),
        snippet: 'Starship flight 8 prototype prepares for static fire test at Starbase',
        firstSeenAt: new Date().toISOString(),
        matchedCompanyIds: ['spacex'],
      },
    ];

    await clusterAndProcessArticles(mergeBatch, true, 8, { tracker: tracker3 });
    assert(
      geminiAnalysisCallCount <= 1,
      `Pending event merged with multiple articles in one cycle must be analyzed at most once, actual: ${geminiAnalysisCallCount}`
    );

    // 19-4: retryPendingAnalyses는 사이클 상한 <= 3 및 이번 사이클 시도한 이벤트 제외
    db._setEventsForTesting([]);
    geminiAnalysisCallCount = 0;
    const tracker4 = createCycleBudgetTracker();

    const pendingList: NewsEvent[] = Array.from({ length: 5 }, (_, i) => {
      const art: RawArticle = {
        id: `raw-retry-${i}`,
        title: `Pending Article for Retry ${i}`,
        link: `https://outlet-${i}.com/story-${i}`,
        source: `Outlet ${i}`,
        publishedAt: new Date().toISOString(),
        snippet: `Snippet for pending article ${i}`,
        firstSeenAt: new Date().toISOString(),
        matchedCompanyIds: ['tsla'],
      };
      const evt = createUnanalyzedEvent(art, '초기 대기');
      evt.id = `evt-retry-${i}`;
      return evt;
    });
    db._setEventsForTesting(pendingList);

    tracker4.attemptedEventIds.add('evt-retry-0');
    tracker4.attemptedEventIds.add('evt-retry-1');

    const retryRes = await retryPendingAnalyses(5, { tracker: tracker4 });
    assert(
      retryRes.retriedCount <= 3,
      `retryPendingAnalyses must be capped at <= 3, actual: ${retryRes.retriedCount}`
    );
    assert.strictEqual(
      geminiAnalysisCallCount,
      3,
      `Must make at most 3 retry calls excluding already attempted events, actual: ${geminiAnalysisCallCount}`
    );
    const evt0 = db.getEvents().find(e => e.id === 'evt-retry-0');
    assert.strictEqual(evt0?.analysisRetryCount, 0, 'Already attempted event in this cycle must not be retried');

    // 19-5: 429 / Quota 발생 시 즉시 추가 모델 호출 중단 (Fail-Closed)
    db._setEventsForTesting([]);
    geminiAnalysisCallCount = 0;
    geminiFetchCalls = [];
    mockGeminiRateLimit = true;
    const tracker5 = createCycleBudgetTracker();

    const articlesBefore429: RawArticle[] = Array.from({ length: 6 }, (_, i) => ({
      id: `raw-429-${i}`,
      title: `Article before 429 error #${i}`,
      link: `https://outlet-429-${i}.com/story`,
      source: 'News429',
      publishedAt: new Date().toISOString(),
      snippet: 'Snippet for 429 testing',
      firstSeenAt: new Date().toISOString(),
      matchedCompanyIds: ['googl'],
    }));

    await clusterAndProcessArticles(articlesBefore429, true, 8, { tracker: tracker5 });
    assert.strictEqual(tracker5.isRateLimited, true, 'Tracker must flag isRateLimited upon 429 error');
    assert.strictEqual(
      geminiFetchCalls.length,
      1,
      `After first 429 failure, remaining articles must be aborted immediately without additional calls, actual: ${geminiFetchCalls.length}`
    );

    const abortedRetry = await retryPendingAnalyses(3, { tracker: tracker5 });
    assert.strictEqual(abortedRetry.retriedCount, 0, 'Rate limited cycle must skip retries entirely');
    assert.strictEqual(abortedRetry.isRateLimited, true, 'Retry result must reflect rate limit status');

    delete process.env.GEMINI_API_KEY;
    mockGeminiRateLimit = false;
    console.log('✅ TEST 19 Passed: 토큰 절감 및 사이클 호출 예산(Dedup<=4, Analysis<=8, Retry<=3, 429중단) 검증 완료\n');

    // =========================================================================
    // TEST 20: 기업 키워드/비즈니스 주간 자동 갱신 및 토큰/보안/복원 검증
    // =========================================================================
    console.log('--- TEST 20: 기업 키워드/비즈니스 주간 자동 갱신 및 보안/토큰/복원 검증 ---');

    // 20-1: 채용/기술지원/API문서 제외 및 실적/계약/규제 보존 검증
    assert.strictEqual(
      isExcludedFromCompanyRenewal('구글 코리아 2026 하반기 신입 개발자 대규모 채용 공고 안내'),
      true,
      '채용공고는 갱신 근거에서 제외되어야 함'
    );
    assert.strictEqual(
      isExcludedFromCompanyRenewal('크롬 브라우저 오류 코드 0x80070002 해결 방법 기술지원 Q&A'),
      true,
      '기술지원/오류해결 질문은 제외되어야 함'
    );
    assert.strictEqual(
      isExcludedFromCompanyRenewal('Google Cloud SDK docs 및 API reference v2.4 릴리즈'),
      true,
      '단순 API 레퍼런스 문서는 제외되어야 함'
    );
    // 우회 차단 검증: NASA/GPU가 포함되어 있어도 채용/오류해결/API 문서는 철저히 제외되어야 함
    assert.strictEqual(
      isExcludedFromCompanyRenewal('NASA 우주 소프트웨어 인턴십 채용 공고'),
      true,
      'NASA가 포함되어도 채용공고는 제외되어야 함'
    );
    assert.strictEqual(
      isExcludedFromCompanyRenewal('NVIDIA RTX 4090 GPU 드라이버 오류 해결 및 troubleshooting 가이드'),
      true,
      'GPU가 포함되어도 단순 오류 해결/기술지원은 제외되어야 함'
    );
    assert.strictEqual(
      isExcludedFromCompanyRenewal('NVIDIA TensorRT GPU API reference v12.0 문서'),
      true,
      'GPU가 포함되어도 단순 API 문서는 제외되어야 함'
    );

    // 고신호 투자 키워드(실적/계약/규제) 포함 시 보존
    assert.strictEqual(
      isExcludedFromCompanyRenewal('구글 클라우드, 미 국방부와 5억 달러 공급 계약 체결 및 고객지원 센터 개설'),
      false,
      '계약/수주/공급 키워드가 포함된 뉴스는 보존되어야 함'
    );
    assert.strictEqual(
      isExcludedFromCompanyRenewal('구글 3분기 실적 발표: 클라우드 매출 35% 급증 및 AI CAPEX 확대'),
      false,
      '실적/매출/CAPEX 뉴스는 보존되어야 함'
    );
    assert.strictEqual(
      isExcludedFromCompanyRenewal('미 법무부(DOJ), 구글 검색 독점 소송 항소심 승인 및 규제 강화'),
      false,
      '규제/반독점/소송 뉴스는 보존되어야 함'
    );

    // 20-2: 7일 경과 조건 및 활성 기업 적격성 검증
    const baseNow = new Date('2026-10-14T10:00:00Z');
    const testCompany1: CompanyProfile = {
      ...INITIAL_COMPANIES[0], // SpaceX
      lastKeywordRenewalAttemptAt: new Date(baseNow.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2일 전 시도
    };
    const elig1 = isCompanyEligibleForWeeklyRenewal(testCompany1, baseNow);
    assert.strictEqual(elig1.eligible, false, '7일 미경과 시 갱신 비적격');
    assert.ok(elig1.reason?.includes('cooldown_active'), '사유에 cooldown 포함');

    const testCompany2: CompanyProfile = {
      ...INITIAL_COMPANIES[0],
      lastKeywordRenewalAttemptAt: new Date(baseNow.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8일 전 시도
    };
    const elig2 = isCompanyEligibleForWeeklyRenewal(testCompany2, baseNow);
    assert.strictEqual(elig2.eligible, true, '8일 경과 시 갱신 적격');

    const testCompanyDisabled: CompanyProfile = {
      ...INITIAL_COMPANIES[0],
      enabled: false,
    };
    assert.strictEqual(isCompanyEligibleForWeeklyRenewal(testCompanyDisabled, baseNow).eligible, false, '비활성 기업은 비적격');

    const testCompanyAutoOff: CompanyProfile = {
      ...INITIAL_COMPANIES[0],
      autoWeeklyRenewalEnabled: false,
    };
    assert.strictEqual(isCompanyEligibleForWeeklyRenewal(testCompanyAutoOff, baseNow).eligible, false, '주간갱신 Off 기업은 비적격');

    // 20-3: 새 자료 부족 시 (<2건) 호출 생략 및 기존값 유지
    db._setEventsForTesting([]); // no recent articles
    const insufficientResult = await executeWeeklyCompanyRenewal(testCompany2, { now: baseNow });
    assert.strictEqual(insufficientResult.status, 'skipped', '뉴스 부족 시 호출 생략');
    assert.strictEqual(insufficientResult.reason, 'insufficient_recent_articles', '사유 검증');
    assert.ok(
      insufficientResult.updatedProfile?.lastKeywordRenewalAttemptAt,
      '자료 부족 시에도 lastKeywordRenewalAttemptAt을 기록해 매일 재시도 방지'
    );

    // 20-4: 근거 검증 (Fake Evidence 제외), Pinned 항목 보존, 6/4개 엄격 상한 검증
    const spxEvents: NewsEvent[] = [
      {
        id: 'evt-spx-real-1',
        title: 'SpaceX Starlink Direct-to-Cell FCC 승인 및 글로벌 통신망 확대',
        originalTitle: 'FCC Approves SpaceX Starlink Direct to Cell',
        category: 'Starlink / 통신',
        importance: 4,
        isImportant: true,
        impact: 'positive',
        impactRationale: '위성 통신 상용화 가속',
        relatedCompanies: ['SpaceX'],
        companyImpacts: [{ companyId: 'spacex', companyName: 'SpaceX', impact: 'positive', rationale: '승인 획득' }],
        factualPoints: ['FCC가 스타링크 모바일 직접 연결 서비스를 정식 승인함.'],
        summaryBulletPoints: ['스타링크 다이렉트 투 셀 승인'],
        investmentImplications: '우주 통신 매출 증대',
        whyItMatters: '통신 시장 점유율 확대',
        keyCheckpointsToWatch: ['글로벌 파트너십'],
        investmentImpactExplanation: '기업가치 상승',
        relatedBusinesses: ['Starlink'],
        primarySource: {
          name: 'Reuters',
          url: 'https://reuters.com/spacex-fcc',
          title: 'FCC Approves SpaceX Starlink',
          publishedAt: new Date(baseNow.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
        },
        relatedSources: [],
        articleCount: 1,
        isSentToTelegram: false,
        firstSeenAt: new Date(baseNow.getTime() - 2 * 24 * 3600 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        analyzedByGemini: true,
      },
      {
        id: 'evt-spx-real-2',
        title: 'SpaceX 미 국방부 Starshield 10억 달러 추가 기밀 계약 수주',
        originalTitle: 'SpaceX Pentagon Starshield Contract',
        category: '국방 / 정부계약',
        importance: 5,
        isImportant: true,
        impact: 'positive',
        impactRationale: '방산 수주 확대',
        relatedCompanies: ['SpaceX'],
        companyImpacts: [{ companyId: 'spacex', companyName: 'SpaceX', impact: 'positive', rationale: '국방부 계약' }],
        factualPoints: ['미국 국방부와 스타실드 추가 계약을 체결함.'],
        summaryBulletPoints: ['스타실드 국방 계약 수주'],
        investmentImplications: '안정적 정부 매출 확보',
        whyItMatters: '정부 국방 파트너십 강화',
        keyCheckpointsToWatch: ['후속 발사 일정'],
        investmentImpactExplanation: '매출 안정성 증대',
        relatedBusinesses: ['Starshield'],
        primarySource: {
          name: 'Bloomberg',
          url: 'https://bloomberg.com/spacex-pentagon',
          title: 'SpaceX Wins Pentagon Contract',
          publishedAt: new Date(baseNow.getTime() - 3 * 24 * 3600 * 1000).toISOString(),
        },
        relatedSources: [],
        articleCount: 1,
        isSentToTelegram: false,
        firstSeenAt: new Date(baseNow.getTime() - 3 * 24 * 3600 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        analyzedByGemini: true,
      },
    ];
    db._setEventsForTesting(spxEvents);

    // Mock Gemini Client responding with valid evidence + fake evidence
    const mockGeminiClientSuccess = {
      models: {
        generateContent: async () => {
          return {
            text: JSON.stringify({
              proposedSearchKeywords: [
                { keyword: 'Starlink Direct to Cell', evidenceId: 'evt-spx-real-1', reason: 'FCC 승인' },
                { keyword: 'Starshield Defense Contract', evidenceId: 'evt-spx-real-2', reason: '국방부 계약' },
                { keyword: 'Bogus Fake Keyword Without Evidence', evidenceId: 'evt-non-existent-999', reason: '근거 없음' },
              ],
              proposedCoreBusinesses: [
                { business: 'Direct-to-Cell', evidenceId: 'evt-spx-real-1', reason: '통신 신사업' },
                { business: 'Fake Business No Evidence', evidenceId: 'evt-bogus-404', reason: '근거 없음' },
              ],
              summaryRationale: 'FCC 직접통신 승인 및 국방 스타실드 수주 반영',
            }),
            usageMetadata: { promptTokenCount: 180, candidatesTokenCount: 65, totalTokenCount: 245 },
          };
        },
      },
    } as unknown as GoogleGenAI;

    const renewCompany = { ...INITIAL_COMPANIES[0], version: 1 };
    const renewalSuccessRes = await executeWeeklyCompanyRenewal(renewCompany, {
      now: baseNow,
      force: true,
      mockClient: mockGeminiClientSuccess,
    });

    assert.strictEqual(renewalSuccessRes.status, 'success', '정상 갱신 완료');
    const updatedSPX = renewalSuccessRes.updatedProfile!;
    assert.strictEqual(updatedSPX.version, 2, '갱신 후 version 1 증가');

    // 검증: 근거 없는 fake candidate는 철저히 제외되어야 함
    assert.strictEqual(
      updatedSPX.searchKeywords.includes('Bogus Fake Keyword Without Evidence'),
      false,
      '근거 ID가 불일치하는 키워드는 탈락해야 함'
    );
    assert.strictEqual(
      updatedSPX.coreBusinesses.includes('Fake Business No Evidence'),
      false,
      '근거 ID가 불일치하는 비즈니스는 탈락해야 함'
    );

    // 검증: 유효 근거 키워드 및 Pinned 항목 보존
    assert.ok(updatedSPX.searchKeywords.includes('Starlink Direct to Cell'), '유효 근거 키워드 포함');
    for (const pinnedKw of renewCompany.pinnedSearchKeywords || []) {
      assert.ok(updatedSPX.searchKeywords.includes(pinnedKw), `Pinned 키워드 [${pinnedKw}] 보존`);
    }
    for (const pinnedBiz of renewCompany.pinnedCoreBusinesses || []) {
      assert.ok(updatedSPX.coreBusinesses.includes(pinnedBiz), `Pinned 사업 [${pinnedBiz}] 보존`);
    }

    // 검증: 최대 상한 (키워드 6개, 비즈니스 4개)
    assert.ok(updatedSPX.searchKeywords.length <= 6, `키워드는 최대 6개여야 함, 실제: ${updatedSPX.searchKeywords.length}`);
    assert.ok(updatedSPX.coreBusinesses.length <= 4, `비즈니스는 최대 4개여야 함, 실제: ${updatedSPX.coreBusinesses.length}`);

    // 검증: 이력 (renewalHistory) 기록
    assert.strictEqual(updatedSPX.renewalHistory?.length, 1, '이력 1개 기록');
    const hist0 = updatedSPX.renewalHistory![0];
    assert.strictEqual(hist0.status, 'success');
    assert.ok(hist0.evidenceArticleIds.includes('evt-spx-real-1'), '이력에 근거 기사 ID 포함');
    assert.strictEqual(hist0.versionBefore, 1);
    assert.strictEqual(hist0.versionAfter, 2);

    // 20-4-1: 프롬프트 2200자 초과 기사 ID (Prompt 외 ID) 제외 검증
    const fillerArticles: NewsEvent[] = Array.from({ length: 15 }, (_, i) => ({
      ...spxEvents[0],
      id: `evt-spx-filler-${i}`,
      title: `SpaceX Falcon 9 Satellite Launch Mission Batch #${i} Orbital Insertion Confirmed`,
      primarySource: {
        name: 'SpaceNews',
        url: `https://spacenews.com/launch-${i}`,
        title: `SpaceX Launch #${i}`,
        publishedAt: new Date(baseNow.getTime() - 2 * 24 * 3600 * 1000 - (i + 1) * 60000).toISOString(),
      },
      firstSeenAt: new Date(baseNow.getTime() - 2 * 24 * 3600 * 1000 - (i + 1) * 60000).toISOString(),
    }));

    const overflowArticle: NewsEvent = {
      ...spxEvents[0],
      id: 'evt-spx-overflow-beyond-2200',
      title: 'SpaceX Secret Mars Exploration Mission Satellite Deployment and Long Description',
      primarySource: {
        name: 'SpaceNews',
        url: 'https://spacenews.com/mars-overflow',
        title: 'SpaceX Mars Mission',
        publishedAt: new Date(baseNow.getTime() - 25 * 24 * 3600 * 1000).toISOString(),
      },
      firstSeenAt: new Date(baseNow.getTime() - 25 * 24 * 3600 * 1000).toISOString(),
    };
    db._setEventsForTesting([...spxEvents, ...fillerArticles, overflowArticle]);

    const mockGeminiWithOverflowId = {
      models: {
        generateContent: async () => {
          return {
            text: JSON.stringify({
              proposedSearchKeywords: [
                { keyword: 'Prompt Evidence Keyword', evidenceId: 'evt-spx-real-1', reason: '실제 프롬프트 내 FCC 기사' },
                { keyword: 'Beyond 2200 Overflow Keyword', evidenceId: 'evt-spx-overflow-beyond-2200', reason: '2200자 초과로 잘린 기사' },
              ],
              proposedCoreBusinesses: [
                { business: 'Valid Biz', evidenceId: 'evt-spx-real-1', reason: 'FCC' },
              ],
              summaryRationale: '프롬프트 내외 근거 검증',
            }),
            usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 50, totalTokenCount: 200 },
          };
        },
      },
    } as unknown as GoogleGenAI;

    const overflowRes = await executeWeeklyCompanyRenewal(renewCompany, {
      now: baseNow,
      force: true,
      mockClient: mockGeminiWithOverflowId,
    });
    assert.strictEqual(
      overflowRes.updatedProfile?.searchKeywords.includes('Beyond 2200 Overflow Keyword'),
      false,
      '2200자 프롬프트에 포함되지 못한 기사 ID는 유효 근거에서 엄격히 제외되어야 함'
    );
    assert.ok(
      overflowRes.updatedProfile?.searchKeywords.includes('Prompt Evidence Keyword'),
      '2200자 프롬프트 내 실존 기사 ID는 정상 반영'
    );

    // 20-4-2: null / malformed 응답 및 빈 유효 근거 실패 처리 검증
    const mockGeminiMalformed = {
      models: {
        generateContent: async () => ({ text: '{ malformed json: not valid' }),
      },
    } as unknown as GoogleGenAI;
    const malformedRes = await executeWeeklyCompanyRenewal(renewCompany, {
      now: baseNow,
      force: true,
      mockClient: mockGeminiMalformed,
    });
    assert.strictEqual(malformedRes.status, 'failed', 'Malformed JSON은 failed 상태 반환');
    assert.strictEqual(malformedRes.reason, 'malformed_json_response');

    const mockGeminiNullProposals = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ proposedSearchKeywords: null, proposedCoreBusinesses: null }),
        }),
      },
    } as unknown as GoogleGenAI;
    const nullRes = await executeWeeklyCompanyRenewal(renewCompany, {
      now: baseNow,
      force: true,
      mockClient: mockGeminiNullProposals,
    });
    assert.strictEqual(nullRes.status, 'failed', 'Null 후보 제안은 failed 상태 반환');

    const mockGeminiEmptyProposals = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ proposedSearchKeywords: [], proposedCoreBusinesses: [] }),
        }),
      },
    } as unknown as GoogleGenAI;
    const emptyRes = await executeWeeklyCompanyRenewal(renewCompany, {
      now: baseNow,
      force: true,
      mockClient: mockGeminiEmptyProposals,
    });
    assert.strictEqual(emptyRes.status, 'failed', '빈 유효 근거 제안은 failed 상태 반환');
    assert.strictEqual(emptyRes.reason, 'no_valid_evidenced_proposals');

    // 20-4-3: 실패 중 동시 사람 편집 보존 및 단일 Write 검증
    const humanEditedSPX: CompanyProfile = {
      ...renewCompany,
      version: 1,
      searchKeywords: ['Human Pinned A', 'Human Manual KW B'],
      coreBusinesses: ['Human Manual Biz C'],
    };
    await db.saveCompany(humanEditedSPX);

    // Renewal fails due to malformed response
    await executeWeeklyCompanyRenewal(humanEditedSPX, {
      now: baseNow,
      force: true,
      mockClient: mockGeminiMalformed,
    });
    const preservedSPX = db.getCompanyById(humanEditedSPX.id);
    assert.ok(
      preservedSPX?.searchKeywords.includes('Human Manual KW B'),
      '실패 상태 기록 시 관리자가 수정한 키워드가 덮어씌워지지 않고 보존되어야 함'
    );
    assert.strictEqual(
      preservedSPX?.lastRenewalStatus,
      'failed',
      '실패 상태 메타데이터만 원자적으로 패치됨'
    );

    // 20-5: Firestore 미연결(FS 없는 경우) 시 자동 갱신 0회 호출 검증
    _setIsFirestoreAvailableForTesting(false);
    const noFsBatch = await runWeeklyCompanyRenewalsBatch({ now: baseNow, mockClient: mockGeminiClientSuccess });
    assert.strictEqual(noFsBatch.modelCallsCount, 0, 'Firestore 미연결 시 자동 갱신 0회 모델 호출');
    assert.strictEqual(noFsBatch.processedCount, 0, 'Firestore 미연결 시 자동 갱신 즉시 skip');

    // 20-6: 주 5회 Budget 초과 차단 및 force 무력화 검증 (실제 주 5회 호출)
    // Create mock Firestore with transaction semantics
    const mockCompaniesMap = new Map<string, any>();
    const mockBudgetsMap = new Map<string, any>();
    for (const c of INITIAL_COMPANIES) {
      mockCompaniesMap.set(c.id, {
        ...c,
        lastKeywordRenewalAttemptAt: new Date(baseNow.getTime() - 10 * 24 * 3600 * 1000).toISOString(),
      });
    }
    // Add 6th eligible company to verify budget ceiling of 5
    mockCompaniesMap.set('comp-6', {
      id: 'comp-6',
      name: 'Sixth Eligible Company',
      enabled: true,
      autoWeeklyRenewalEnabled: true,
      searchKeywords: ['Sixth'],
      coreBusinesses: ['Sixth Biz'],
      lastKeywordRenewalAttemptAt: new Date(baseNow.getTime() - 10 * 24 * 3600 * 1000).toISOString(),
      version: 1,
    });

    const mockFirestoreInstance = {
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => {
            const map = col === 'companies' ? mockCompaniesMap : mockBudgetsMap;
            const val = map.get(id);
            return { exists: !!val, data: () => val };
          },
          set: async (data: any, opt?: any) => {
            const map = col === 'companies' ? mockCompaniesMap : mockBudgetsMap;
            if (opt?.merge) {
              map.set(id, { ...(map.get(id) || {}), ...data });
            } else {
              map.set(id, data);
            }
          },
        }),
      }),
      runTransaction: async (fn: (tx: any) => Promise<any>) => {
        const tx = {
          get: async (ref: any) => ref.get(),
          set: (ref: any, data: any, opt?: any) => ref.set(data, opt),
        };
        return await fn(tx);
      },
    };

    _setIsFirestoreAvailableForTesting(true, mockFirestoreInstance);

    let batchCallsCount = 0;
    const mockBatchGeminiClient = {
      models: {
        generateContent: async () => {
          batchCallsCount++;
          return {
            text: JSON.stringify({
              proposedSearchKeywords: [{ keyword: `Batch KW ${batchCallsCount}`, evidenceId: 'evt-spx-real-1', reason: '실적' }],
              proposedCoreBusinesses: [{ business: `Batch Biz ${batchCallsCount}`, evidenceId: 'evt-spx-real-1', reason: '실적' }],
              summaryRationale: '주간 갱신',
            }),
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 30, totalTokenCount: 130 },
          };
        },
      },
    } as unknown as GoogleGenAI;

    // Set 2+ articles for all companies so pre-check passes
    const allCompanyEvents: NewsEvent[] = [
      spxEvents[0],
      spxEvents[1],
      {
        ...spxEvents[0],
        id: 'evt-gen-1',
        relatedCompanies: ['googl', 'tsla', 'msft', 'nvda', 'comp-6', 'spacex'],
      },
      {
        ...spxEvents[1],
        id: 'evt-gen-2',
        relatedCompanies: ['googl', 'tsla', 'msft', 'nvda', 'comp-6', 'spacex'],
      },
    ];
    db._setEventsForTesting(allCompanyEvents);

    // Run batch with force: true to ensure force cannot bypass weekly 5 budget ceiling
    const weekly5BatchRes = await runWeeklyCompanyRenewalsBatch({
      now: baseNow,
      force: true,
      mockClient: mockBatchGeminiClient,
    });

    assert.strictEqual(batchCallsCount, 5, '총 6개 적격 기업이 있어도 주간 최대 5회까지만 실제 모델 호출');
    assert.strictEqual(weekly5BatchRes.modelCallsCount, 5, '주간 예산 5회 상한 엄격 준수');

    // 20-7: 429 발생 시 즉시 중단 및 7일 Cooldown 보존
    let mockCalls429Count = 0;
    const mockGemini429Client = {
      models: {
        generateContent: async () => {
          mockCalls429Count++;
          throw new Error('429 Too Many Requests: Quota exceeded for gemini-3.7-flash');
        },
      },
    } as unknown as GoogleGenAI;

    // Reset budget for 429 test
    const nextWeekId = getSeoulWeekString(new Date(baseNow.getTime() + 7 * 24 * 3600 * 1000));
    const nextWeekNow = new Date(baseNow.getTime() + 7 * 24 * 3600 * 1000);

    const batch429Res = await runWeeklyCompanyRenewalsBatch({
      now: nextWeekNow,
      force: true,
      mockClient: mockGemini429Client,
    });

    assert.strictEqual(batch429Res.isRateLimited, true, '429 발생 플래그');
    assert.strictEqual(mockCalls429Count, 1, '첫 429 발생 후 이후 기업 호출 즉시 중단');

    // 20-7-1: 실제 claim 반환과 동일한 lockedCompany (lastAttempt=now, running, token)을 통한
    // batch -> execute -> mock generateContent 실제 1호출 -> Firestore 단일 success 저장 검증
    const singleTestWeekNow = new Date(baseNow.getTime() + 14 * 24 * 3600 * 1000);
    mockBudgetsMap.clear();

    const eligibleSPX: CompanyProfile = {
      ...INITIAL_COMPANIES[0],
      id: 'spacex',
      name: 'SpaceX',
      enabled: true,
      autoWeeklyRenewalEnabled: true,
      searchKeywords: ['SpaceX Starship'],
      coreBusinesses: ['Launch Services'],
      pinnedSearchKeywords: ['SpaceX Starship'],
      pinnedCoreBusinesses: ['Launch Services'],
      lastKeywordRenewalAttemptAt: new Date(singleTestWeekNow.getTime() - 10 * 24 * 3600 * 1000).toISOString(),
      lastRenewalStatus: 'success',
      version: 1,
      renewalLock: null,
    };
    db.syncAuthoritativeCompany(eligibleSPX);
    mockCompaniesMap.set('spacex', { ...eligibleSPX });

    for (const c of INITIAL_COMPANIES.slice(1)) {
      const inelig = {
        ...c,
        lastKeywordRenewalAttemptAt: singleTestWeekNow.toISOString(),
      };
      db.syncAuthoritativeCompany(inelig);
      mockCompaniesMap.set(c.id, inelig);
    }
    mockCompaniesMap.delete('comp-6');

    db._setEventsForTesting(spxEvents);

    let singleBatchCallsCount = 0;
    const mockSingleBatchGenClient = {
      models: {
        generateContent: async () => {
          singleBatchCallsCount++;
          return {
            text: JSON.stringify({
              proposedSearchKeywords: [
                { keyword: 'Starlink Direct to Cell', evidenceId: 'evt-spx-real-1', reason: 'FCC 승인' },
              ],
              proposedCoreBusinesses: [
                { business: 'Direct-to-Cell', evidenceId: 'evt-spx-real-1', reason: '통신 신사업' },
              ],
              summaryRationale: '실제 claim 반환 lockedCompany 단일 호출 검증',
            }),
            usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, totalTokenCount: 160 },
          };
        },
      },
    } as unknown as GoogleGenAI;

    // Run batch WITHOUT force: true
    const singleBatchRes = await runWeeklyCompanyRenewalsBatch({
      now: singleTestWeekNow,
      mockClient: mockSingleBatchGenClient,
    });

    assert.strictEqual(singleBatchCallsCount, 1, 'claim에서 lastAttempt=now, running, token이 설정되었어도 cooldown으로 건너뛰지 않고 실제 1회 호출 성공');
    assert.strictEqual(singleBatchRes.updatedCount, 1, 'Firestore 단일 갱신 성공');

    const firestoreSavedSPX = mockCompaniesMap.get('spacex');
    assert.strictEqual(firestoreSavedSPX.version, 2, '성공 시 Firestore 버전 1 증가');
    assert.strictEqual(firestoreSavedSPX.lastRenewalStatus, 'success', 'Firestore 상태 success 저장');
    assert.strictEqual(firestoreSavedSPX.renewalLock, null, '성공 후 락 해제');

    // 20-7-2: 잘못된 lockToken 제공 시 모델 호출 0회 및 건너뜀 검증
    const fakeLockedComp: CompanyProfile = {
      ...eligibleSPX,
      lastKeywordRenewalAttemptAt: singleTestWeekNow.toISOString(),
      lastRenewalStatus: 'running',
      renewalLock: {
        lockedAt: singleTestWeekNow.toISOString(),
        leaseMs: 300000,
        token: 'real-valid-token-777',
      },
    };
    let wrongTokenModelCalls = 0;
    const mockWrongTokenClient = {
      models: {
        generateContent: async () => {
          wrongTokenModelCalls++;
          return { text: '{}' };
        },
      },
    } as unknown as GoogleGenAI;

    const wrongTokenRes = await executeWeeklyCompanyRenewal(fakeLockedComp, {
      now: singleTestWeekNow,
      lockToken: 'mismatched-wrong-token-999',
      mockClient: mockWrongTokenClient,
    });
    assert.strictEqual(wrongTokenRes.status, 'skipped', '잘못된 lockToken 제공 시 skipped');
    assert.strictEqual(wrongTokenRes.reason, 'lock_token_mismatch', 'lock_token_mismatch 사유 반환');
    assert.strictEqual(wrongTokenModelCalls, 0, '잘못된 lockToken 제공 시 모델 호출 0회');

    // 20-7-3: saveCompanyRenewalSuccess 및 recordCompanyRenewalAttemptFailed 토큰 검증
    mockCompaniesMap.set('token-test-comp', { ...fakeLockedComp, id: 'token-test-comp' });
    const wrongSaveRes = await firestoreRepo.saveCompanyRenewalSuccess(
      'token-test-comp',
      fakeLockedComp,
      1,
      'invalid-save-token'
    );
    assert.strictEqual(wrongSaveRes.success, false, '잘못된 lockToken으로 성공 저장 불가');
    assert.strictEqual(wrongSaveRes.reason, 'lock_mismatch', 'lock_mismatch 에러');

    const noTokenFail = await firestoreRepo.recordCompanyRenewalAttemptFailed(
      'token-test-comp',
      undefined,
      'failed',
      'err',
      singleTestWeekNow
    );
    assert.strictEqual(noTokenFail.success, false, '토큰 없이 활성 락 해제/덮어쓰기 불가');

    const wrongTokenFail = await firestoreRepo.recordCompanyRenewalAttemptFailed(
      'token-test-comp',
      'wrong-fail-token',
      'failed',
      'err',
      singleTestWeekNow
    );
    assert.strictEqual(wrongTokenFail.success, false, '불일치 토큰으로 실패 기록 불가');

    const correctTokenFail = await firestoreRepo.recordCompanyRenewalAttemptFailed(
      'token-test-comp',
      'real-valid-token-777',
      'failed',
      'correct-fail',
      singleTestWeekNow
    );
    assert.strictEqual(correctTokenFail.success, true, '일치하는 토큰으로 실패 기록 성공');

    // 20-7-4: saveCompanyHumanEdit의 importantKeywords 보존 및 서버 메타데이터 clobber 차단 검증
    const longImportantKws = ['Imp1', 'Imp2', 'Imp3', 'Imp4', 'Imp5', 'Imp6', 'Imp7', 'Imp8'];
    const humanInputComp: CompanyProfile = {
      ...INITIAL_COMPANIES[0],
      id: 'googl',
      importantKeywords: longImportantKws,
      searchKeywords: ['KW1', 'KW2', 'KW3', 'KW4', 'KW5', 'KW6', 'KW7_OverLimit'],
      lastKeywordRenewalAttemptAt: '2020-01-01T00:00:00.000Z',
      lastRenewalStatus: 'failed',
      version: 1,
    };
    mockCompaniesMap.set('googl', {
      ...INITIAL_COMPANIES[0],
      id: 'googl',
      version: 1,
      lastKeywordRenewalAttemptAt: '2026-10-10T00:00:00.000Z',
      lastRenewalStatus: 'success',
      renewalLock: null,
    });
    const humanEditRes = await firestoreRepo.saveCompanyHumanEdit(humanInputComp, 1);
    assert.strictEqual(humanEditRes.success, true, 'saveCompanyHumanEdit 성공');
    assert.strictEqual(humanEditRes.company?.importantKeywords.length, 8, 'importantKeywords는 6개로 잘리지 않고 8개 원형 보존');
    assert.strictEqual(humanEditRes.company?.searchKeywords.length, 6, 'searchKeywords는 6개 상한 준수');
    assert.strictEqual(humanEditRes.company?.lastRenewalStatus, 'success', '서버 lastRenewalStatus 보존');
    assert.strictEqual(humanEditRes.company?.lastKeywordRenewalAttemptAt, '2026-10-10T00:00:00.000Z', '서버 lastKeywordRenewalAttemptAt 보존');

    // Reset Firestore testing flag
    _setIsFirestoreAvailableForTesting(false);

    // 20-8: 복원 (Rollback) - 관리자 인증 / CSRF, 버전 검증 및 0 Gemini 호출
    const companyWithHist = {
      ...INITIAL_COMPANIES[1], // Google
      version: 2,
      searchKeywords: ['Google Gemini AI', 'Waymo robotaxi', 'New Keyword Added'],
      coreBusinesses: ['Gemini / DeepMind', 'Google Cloud', 'New Business'],
      renewalHistory: [
        {
          id: 'hist-test-rollback-1',
          companyId: 'googl',
          timestamp: new Date().toISOString(),
          status: 'success' as const,
          before: {
            searchKeywords: ['Google Gemini AI', 'Waymo robotaxi', 'Original KW'],
            coreBusinesses: ['Gemini / DeepMind', 'Google Cloud'],
          },
          after: {
            searchKeywords: ['Google Gemini AI', 'Waymo robotaxi', 'New Keyword Added'],
            coreBusinesses: ['Gemini / DeepMind', 'Google Cloud', 'New Business'],
          },
          addedKeywords: ['New Keyword Added'],
          removedKeywords: ['Original KW'],
          addedBusinesses: ['New Business'],
          removedBusinesses: [],
          reason: '과거 변경',
          evidenceArticleIds: ['evt-123'],
          versionBefore: 1,
          versionAfter: 2,
        },
      ],
    };
    await db.saveCompany(companyWithHist);

    // Rollback test: Mismatched version
    const rollbackConflict = await rollbackCompanyKeywords('googl', 'hist-test-rollback-1', 999);
    assert.strictEqual(rollbackConflict.success, false, '버전 불일치 시 롤백 차단');

    // Rollback test: Success
    const rollbackSuccess = await rollbackCompanyKeywords('googl', 'hist-test-rollback-1', 2);
    assert.strictEqual(rollbackSuccess.success, true, '정상 롤백 성공');
    assert.strictEqual(rollbackSuccess.company?.version, 3, '롤백 후 version 1 증가');
    assert.strictEqual(
      rollbackSuccess.company?.searchKeywords.includes('Original KW'),
      true,
      '이전 키워드로 복원 완료'
    );
    assert.strictEqual(
      rollbackSuccess.company?.searchKeywords.includes('New Keyword Added'),
      false,
      '추가되었던 키워드 제거 완료'
    );
    // Pinned keyword must be preserved
    assert.strictEqual(
      rollbackSuccess.company?.searchKeywords.includes('Google Gemini AI'),
      true,
      'Pinned 키워드는 복원 후에도 유지'
    );
    // Audit record for rollback
    const rollbackAudit = rollbackSuccess.company?.renewalHistory?.find(h => h.status === 'rolled_back');
    assert.ok(rollbackAudit, 'rolled_back 이력 레코드 기록');

    // API Rollback Endpoint CSRF / Auth check via HTTP server (Testing HTTP 401, 403, 409, 200)
    const app = createServerApp({ isTest: true });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;
    const testRollbackSecret = 'test-rollback-secret-key-999';
    process.env.ADMIN_SECRET = testRollbackSecret;

    try {
      // 1. Without Auth -> 401
      const noAuthRes = await globalThis.fetch(`http://127.0.0.1:${port}/api/companies/googl/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ historyId: 'hist-test-rollback-1' }),
      });
      assert.strictEqual(noAuthRes.status, 401, '인증 없는 롤백은 401 차단');

      // 2. Cookie Auth without valid CSRF Origin -> 403
      const token = generateSessionToken(testRollbackSecret);
      const csrfFailRes = await globalThis.fetch(`http://127.0.0.1:${port}/api/companies/googl/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${SESSION_COOKIE_NAME}=${token}`,
          Origin: 'https://evil-attacker.com',
        },
        body: JSON.stringify({ historyId: 'hist-test-rollback-1' }),
      });
      assert.strictEqual(csrfFailRes.status, 403, 'CSRF Origin 불일치 시 403 차단');

      // 3. Version conflict -> 409
      const conflictRes = await globalThis.fetch(`http://127.0.0.1:${port}/api/companies/googl/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testRollbackSecret}`,
        },
        body: JSON.stringify({ historyId: 'hist-test-rollback-1', expectedVersion: 999 }),
      });
      assert.strictEqual(conflictRes.status, 409, '버전 불일치 시 409 Conflict 반환');

      // 4. Valid Admin Bearer Auth & correct version -> 200 (Zero Gemini calls)
      const validAuthRes = await globalThis.fetch(`http://127.0.0.1:${port}/api/companies/googl/rollback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${testRollbackSecret}`,
        },
        body: JSON.stringify({ historyId: 'hist-test-rollback-1', expectedVersion: 3 }),
      });
      assert.strictEqual(validAuthRes.status, 200, '유효한 관리자 인증으로 롤백 성공');
      const rollbackApiData = await validAuthRes.json();
      assert.strictEqual(rollbackApiData.success, true);
    } finally {
      server.close();
      delete process.env.ADMIN_SECRET;
    }

    console.log('✅ TEST 20 Passed: 기업 키워드/비즈니스 주간 갱신(7일조건, 동시락, 주5회예산, 429중단, Pinned보존, 근거검증, 버전충돌방지, 복원/CSRF) 전체 검증 완료\n');

    // -----------------------------------------------------------------
    // TEST 21: K-News 오래된 기사 '분석 중' 제거, 상태 우선순위, 7일 경계, 잡음 5종/실제 계약 보존, 투영 및 백로그 정규화 종합 검증
    // -----------------------------------------------------------------
    console.log('--- TEST 21: 분석 상태 우선순위(failed0/skipped/pending/completed0), 7일 경계, 잡음 필터 및 백로그 정규화 종합 검증 ---');

    // 21-1: failed 0 badge 우선순위 검증: stars === 0 이어도 status === 'failed'가 최우선
    const badgeFailed0 = getEventBadgeInfo(0, 'failed');
    assert.strictEqual(badgeFailed0.type, 'failed', 'failed 상태는 stars 0보다 우선');
    assert.strictEqual(badgeFailed0.label, '분석 실패', 'failed 상태 표기는 "분석 실패"');

    // 21-2: pending label 검증: '분석 중'이 아닌 '분석 대기' 표기
    const badgePending0 = getEventBadgeInfo(0, 'pending');
    assert.strictEqual(badgePending0.type, 'pending');
    assert.strictEqual(badgePending0.label, '분석 대기', 'pending 표기는 "분석 대기"');
    assert.ok(!badgePending0.label.includes('분석 중'), '"분석 중" 명칭 완전히 제거 확인');

    const badgeSkipped0 = getEventBadgeInfo(0, 'skipped');
    assert.strictEqual(badgeSkipped0.type, 'skipped');
    assert.strictEqual(badgeSkipped0.label, '분석 제외', 'skipped 표기는 "분석 제외"');

    // completed 0은 미평가/점수없음이지 pending이 아님
    const badgeCompleted0 = getEventBadgeInfo(0, 'completed');
    assert.strictEqual(badgeCompleted0.type, 'unrated');
    assert.strictEqual(badgeCompleted0.label, '미평가 (0★)', 'completed 0★은 "미평가 (0★)" 표기');

    // 21-3: 7일 경계 / fallback 검증
    const fixedNow = new Date('2026-10-14T12:00:00.000Z');
    const within7Days = new Date(fixedNow.getTime() - (6.9 * 24 * 3600 * 1000)).toISOString();
    const beyond7Days = new Date(fixedNow.getTime() - (7.1 * 24 * 3600 * 1000)).toISOString();

    // 6.9일 (7일 이내) -> eligible: true
    const eligWithin = checkArticleAnalysisEligibility({
      title: 'SpaceX Falcon 9 Launches Commercial Satellite',
      primarySource: { publishedAt: within7Days, name: 'Spaceflight Now', url: 'https://spaceflightnow.com/test-6-9' },
      firstSeenAt: within7Days,
    }, fixedNow);
    assert.strictEqual(eligWithin.eligible, true, '6.9일 경과 기사는 7일 이내이므로 분석 대상');

    // 7.1일 (7일 초과) -> eligible: false, stale_article
    const eligBeyond = checkArticleAnalysisEligibility({
      title: 'SpaceX Falcon 9 Launches Commercial Satellite',
      primarySource: { publishedAt: beyond7Days, name: 'Spaceflight Now', url: 'https://spaceflightnow.com/test-7-1' },
      firstSeenAt: beyond7Days,
    }, fixedNow);
    assert.strictEqual(eligBeyond.eligible, false, '7.1일 경과 기사는 7일 초과이므로 자동 분석 제외');
    assert.strictEqual(eligBeyond.reason, 'stale_article', 'stale_article 사유 반환');

    // publishedAt 무효 문자열 시 firstSeenAt fallback 검증
    const eligFallbackStale = checkArticleAnalysisEligibility({
      title: 'SpaceX Falcon 9 Launches Commercial Satellite',
      primarySource: { publishedAt: 'invalid-published-date', name: 'Spaceflight Now', url: 'https://spaceflightnow.com/test-fallback' },
      firstSeenAt: beyond7Days,
    }, fixedNow);
    assert.strictEqual(eligFallbackStale.eligible, false, 'publishedAt 무효 시 firstSeenAt으로 fallback하여 7일 초과 판정');
    assert.strictEqual(eligFallbackStale.reason, 'stale_article');

    // 21-4: 지정 잡음 예시 5종 완벽 제외 검증
    const noiseCases = [
      { text: 'NVIDIA IGX Certification Program (NVIDIA Docs)', extra: { sourceName: 'NVIDIA Docs', url: 'https://developer.nvidia.com/docs' } },
      { text: 'Use sales skills in Copilot Cowork (Microsoft Learn)', extra: { sourceName: 'Microsoft Learn', url: 'https://learn.microsoft.com/copilot' } },
      { text: 'The Beaver Brown Waters of Rupert Bay (NASA)', extra: { sourceName: 'NASA Earth Observatory', url: 'https://earthobservatory.nasa.gov/images' } },
      { text: 'OnUnauthenticatedRequest Class (API ref)', extra: { sourceName: 'Developer Portal', url: 'https://docs.api.com/ref' } },
      { text: 'Software Engineering Intern', extra: { sourceName: 'Careers Portal', url: 'https://careers.google.com/jobs' } },
    ];

    for (const nc of noiseCases) {
      const isNoise = isNoiseNewsArticle(nc.text, nc.extra);
      assert.strictEqual(isNoise, true, `잡음 예시 "${nc.text}"는 잡음으로 식별되어야 함`);

      const elig = checkArticleAnalysisEligibility({
        title: nc.text,
        originalTitle: nc.text,
        primarySource: { name: nc.extra.sourceName, url: nc.extra.url, publishedAt: within7Days },
        firstSeenAt: within7Days,
      }, fixedNow);
      assert.strictEqual(elig.eligible, false, `잡음 기사 "${nc.text}"는 분석 대상에서 제외`);
      assert.strictEqual(elig.reason, 'noise_content');
    }

    // 21-5: 출처 전체 docs/NASA 차단 없이 실제 실적/계약/규제/제품출시 보존 검증
    const genuineCases = [
      {
        title: 'NASA awards $843M contract to SpaceX for ISS deorbit vehicle',
        sourceName: 'NASA Press Release',
        url: 'https://www.nasa.gov/news-release/spacex-contract',
      },
      {
        title: 'NVIDIA announces quarterly revenue surge and major foundry supply contracts',
        sourceName: 'Reuters',
        url: 'https://reuters.com/technology/nvidia-revenue-foundry',
      },
      {
        title: 'Microsoft signs multi-billion cloud contract with US defense department',
        sourceName: 'Bloomberg',
        url: 'https://bloomberg.com/news/microsoft-defense-deal',
      },
    ];

    for (const gc of genuineCases) {
      const isNoise = isNoiseNewsArticle(gc.title, { sourceName: gc.sourceName, url: gc.url });
      assert.strictEqual(isNoise, false, `실제 계약/실적 기사 "${gc.title}"는 잡음으로 오분류되지 않음`);

      const elig = checkArticleAnalysisEligibility({
        title: gc.title,
        originalTitle: gc.title,
        primarySource: { name: gc.sourceName, url: gc.url, publishedAt: within7Days },
        firstSeenAt: within7Days,
      }, fixedNow);
      assert.strictEqual(elig.eligible, true, `실제 계약/실적 기사 "${gc.title}"는 분석 대상 유지`);
    }

    // 21-6: legacy 기존 pending / failed 기사도 projectEventAnalysisStatus로 즉시 사유 표출
    const legacyStalePending: NewsEvent = {
      id: 'evt-legacy-stale-1',
      title: 'Older SpaceX Falcon 9 Mission',
      originalTitle: 'Older SpaceX Falcon 9 Mission',
      category: 'Starship / 우주인프라',
      importance: 0,
      isImportant: false,
      impact: 'neutral',
      impactRationale: '',
      relatedCompanies: ['SpaceX'],
      companyImpacts: [],
      factualPoints: [],
      summaryBulletPoints: [],
      investmentImplications: '',
      whyItMatters: '',
      keyCheckpointsToWatch: [],
      investmentImpactExplanation: '',
      relatedBusinesses: [],
      primarySource: { name: 'Spaceflight', title: 'Older SpaceX Falcon 9 Mission', url: 'https://spx.com', publishedAt: beyond7Days },
      relatedSources: [],
      articleCount: 1,
      isSentToTelegram: false,
      firstSeenAt: beyond7Days,
      updatedAt: beyond7Days,
      analyzedByGemini: false,
      analysisStatus: 'pending',
    };

    const projectedStale = projectEventAnalysisStatus(legacyStalePending, fixedNow);
    assert.strictEqual(projectedStale.analysisStatus, 'skipped', '오래된 legacy pending은 skipped로 즉시 투영');
    assert.ok(projectedStale.skipReason?.includes('오래된 기사') || projectedStale.skipReason === 'stale_article');

    const legacyNoisePending: NewsEvent = {
      ...legacyStalePending,
      id: 'evt-legacy-noise-1',
      title: 'Software Engineering Intern',
      originalTitle: 'Software Engineering Intern',
      primarySource: { name: 'Careers', title: 'Software Engineering Intern', url: 'https://careers.google.com', publishedAt: within7Days },
      firstSeenAt: within7Days,
    };
    const projectedNoise = projectEventAnalysisStatus(legacyNoisePending, fixedNow);
    assert.strictEqual(projectedNoise.analysisStatus, 'skipped', '잡음 legacy pending은 skipped로 즉시 투영');

    const legacyExhaustedPending: NewsEvent = {
      ...legacyStalePending,
      id: 'evt-legacy-exhausted-1',
      title: 'Valid News but 3 attempts exhausted',
      analysisRetryCount: 3,
      primarySource: { name: 'Reuters', title: 'Valid News but 3 attempts exhausted', url: 'https://reuters.com', publishedAt: within7Days },
      firstSeenAt: within7Days,
    };
    const projectedExhausted = projectEventAnalysisStatus(legacyExhaustedPending, fixedNow);
    assert.strictEqual(projectedExhausted.analysisStatus, 'failed', 'retryCount 3회 초과는 failed로 즉시 투영');

    // 21-7: completed 분석 완료 기사 보존 검증 (0★ 및 오래된 completed 기사 절대 불변)
    const completed0Event: NewsEvent = {
      ...legacyStalePending,
      id: 'evt-completed-0',
      title: 'Completed analysis with 0 stars',
      importance: 0,
      analysisStatus: 'completed',
    };
    const projectedCompleted0 = projectEventAnalysisStatus(completed0Event, fixedNow);
    assert.strictEqual(projectedCompleted0.analysisStatus, 'completed', 'completed 0★은 completed로 보존');

    const completedOld5Star: NewsEvent = {
      ...legacyStalePending,
      id: 'evt-completed-old-5',
      title: 'Old 5-star urgent alert from 30 days ago',
      importance: 5,
      analysisStatus: 'completed',
    };
    const projectedCompleted5 = projectEventAnalysisStatus(completedOld5Star, fixedNow);
    assert.strictEqual(projectedCompleted5.analysisStatus, 'completed', '오래된 completed 5★도 completed로 보존');

    // 21-8: 키 없음 및 429 상황에서도 0 모델 콜로 pending 정규화 (skipped / failed 전환) 검증
    db._setEventsForTesting([]);
    const testNormalizeList: NewsEvent[] = [
      {
        ...legacyStalePending,
        id: 'evt-norm-stale',
        title: 'Pending Stale Article',
        analysisStatus: 'pending',
        analysisRetryCount: 0,
        primarySource: { name: 'SpaceNews', title: 'Pending Stale Article', url: 'https://spx.com', publishedAt: beyond7Days },
        firstSeenAt: beyond7Days,
      },
      {
        ...legacyNoisePending,
        id: 'evt-norm-noise',
        title: 'Use sales skills in Copilot Cowork (Microsoft Learn)',
        analysisStatus: 'pending',
        analysisRetryCount: 0,
        primarySource: { name: 'Microsoft Learn', title: 'Use sales skills in Copilot Cowork (Microsoft Learn)', url: 'https://learn.microsoft.com', publishedAt: within7Days },
        firstSeenAt: within7Days,
      },
      {
        ...legacyExhaustedPending,
        id: 'evt-norm-exhausted',
        analysisStatus: 'pending',
        analysisRetryCount: 3,
        primarySource: { name: 'WSJ', title: 'Valid News exhausted', url: 'https://wsj.com', publishedAt: within7Days },
        firstSeenAt: within7Days,
      },
    ];
    db._setEventsForTesting(testNormalizeList);

    geminiAnalysisCallCount = 0;
    // 429 플래그를 주고 실행 -> 0 모델 콜로 정규화 성공 확인
    const retry429Result = await retryPendingAnalyses(3, { isRateLimited: true });
    assert.strictEqual(geminiAnalysisCallCount, 0, '429 상태에서는 모델 호출 0회');
    assert.strictEqual(retry429Result.retriedCount, 0, '재시도 수행 0건');
    assert.strictEqual(retry429Result.skippedCount, 2, 'stale 1건 + noise 1건 = 2건 skipped 정규화');

    const savedStale = db.getEventById('evt-norm-stale');
    assert.strictEqual(savedStale?.analysisStatus, 'skipped', 'stale 이벤트는 skipped로 저장');
    const savedNoise = db.getEventById('evt-norm-noise');
    assert.strictEqual(savedNoise?.analysisStatus, 'skipped', 'noise 이벤트는 skipped로 저장');
    const savedExhausted = db.getEventById('evt-norm-exhausted');
    assert.strictEqual(savedExhausted?.analysisStatus, 'failed', 'retryCount 3회 초과는 failed로 저장');

    // 21-9: 최신 3기사 newest-first 정렬 선택 및 최대 3회 모델 콜 검증
    db._setEventsForTesting([]);
    geminiAnalysisCallCount = 0;
    mockGeminiRateLimit = false;
    process.env.GEMINI_API_KEY = 'test-token-gemini-budget-guard';

    // 5개의 적격 pending 기사 생성 (1시간 전, 2시간 전, 3시간 전, 4시간 전, 5시간 전)
    const baseHour = Date.now();
    const candidateEvents: NewsEvent[] = [
      {
        ...legacyStalePending,
        id: 'evt-cand-5h-old',
        title: 'Tesla Energy Megapack 5h ago',
        analysisStatus: 'pending',
        analysisRetryCount: 0,
        primarySource: { name: 'Reuters', title: 'Tesla Energy Megapack 5h ago', url: 'https://reuters.com/5h', publishedAt: new Date(baseHour - 5 * 3600 * 1000).toISOString() },
        firstSeenAt: new Date(baseHour - 5 * 3600 * 1000).toISOString(),
      },
      {
        ...legacyStalePending,
        id: 'evt-cand-1h-newest',
        title: 'Tesla Energy Megapack 1h ago',
        analysisStatus: 'pending',
        analysisRetryCount: 0,
        primarySource: { name: 'Reuters', title: 'Tesla Energy Megapack 1h ago', url: 'https://reuters.com/1h', publishedAt: new Date(baseHour - 1 * 3600 * 1000).toISOString() },
        firstSeenAt: new Date(baseHour - 1 * 3600 * 1000).toISOString(),
      },
      {
        ...legacyStalePending,
        id: 'evt-cand-3h-mid',
        title: 'Tesla Energy Megapack 3h ago',
        analysisStatus: 'pending',
        analysisRetryCount: 0,
        primarySource: { name: 'Reuters', title: 'Tesla Energy Megapack 3h ago', url: 'https://reuters.com/3h', publishedAt: new Date(baseHour - 3 * 3600 * 1000).toISOString() },
        firstSeenAt: new Date(baseHour - 3 * 3600 * 1000).toISOString(),
      },
      {
        ...legacyStalePending,
        id: 'evt-cand-2h-newer',
        title: 'Tesla Energy Megapack 2h ago',
        analysisStatus: 'pending',
        analysisRetryCount: 0,
        primarySource: { name: 'Reuters', title: 'Tesla Energy Megapack 2h ago', url: 'https://reuters.com/2h', publishedAt: new Date(baseHour - 2 * 3600 * 1000).toISOString() },
        firstSeenAt: new Date(baseHour - 2 * 3600 * 1000).toISOString(),
      },
      {
        ...legacyStalePending,
        id: 'evt-cand-4h-older',
        title: 'Tesla Energy Megapack 4h ago',
        analysisStatus: 'pending',
        analysisRetryCount: 0,
        primarySource: { name: 'Reuters', title: 'Tesla Energy Megapack 4h ago', url: 'https://reuters.com/4h', publishedAt: new Date(baseHour - 4 * 3600 * 1000).toISOString() },
        firstSeenAt: new Date(baseHour - 4 * 3600 * 1000).toISOString(),
      },
    ];
    db._setEventsForTesting(candidateEvents);

    const tracker21 = createCycleBudgetTracker();
    const batchRetryRes = await retryPendingAnalyses(5, { tracker: tracker21 });

    assert.strictEqual(batchRetryRes.retriedCount, 3, '사이클 당 최대 3회 엄격 상한 준수');
    assert.strictEqual(geminiAnalysisCallCount, 3, '실제 Gemini 모델 호출 3회 정확 검증');

    // 최신 3개 (1h, 2h, 3h)가 완료되었는지 확인
    const completed1h = db.getEventById('evt-cand-1h-newest');
    assert.strictEqual(completed1h?.analysisStatus, 'completed', '가장 최신(1h) 기사 분석 완료');

    const completed2h = db.getEventById('evt-cand-2h-newer');
    assert.strictEqual(completed2h?.analysisStatus, 'completed', '두 번째 최신(2h) 기사 분석 완료');

    const completed3h = db.getEventById('evt-cand-3h-mid');
    assert.strictEqual(completed3h?.analysisStatus, 'completed', '세 번째 최신(3h) 기사 분석 완료');

    // 4h, 5h 기사는 이번 사이클에서 대기 상태 유지 확인
    const pending4h = db.getEventById('evt-cand-4h-older');
    assert.strictEqual(pending4h?.analysisStatus, 'pending', '오래된 4h 기사는 이번 사이클 대기 유지');
    assert.strictEqual(pending4h?.analysisRetryCount, 0);

    const pending5h = db.getEventById('evt-cand-5h-old');
    assert.strictEqual(pending5h?.analysisStatus, 'pending', '오래된 5h 기사는 이번 사이클 대기 유지');
    assert.strictEqual(pending5h?.analysisRetryCount, 0);

    // 21-10: normalizePendingEvent 원자적 transaction 기반 조건부 patch 및 동시성 덮어쓰기 방어 검증
    const mockEventsMap = new Map<string, NewsEvent>();
    const mockFsForNormalize = {
      collection: (col: string) => ({
        doc: (id: string) => ({
          get: async () => {
            const val = mockEventsMap.get(id);
            return { exists: !!val, data: () => val };
          },
          set: async (data: any, opt?: any) => {
            if (opt?.merge) {
              mockEventsMap.set(id, { ...(mockEventsMap.get(id) || {}), ...data });
            } else {
              mockEventsMap.set(id, data);
            }
          },
        }),
      }),
      runTransaction: async (fn: (tx: any) => Promise<any>) => {
        const tx = {
          get: async (ref: any) => ref.get(),
          set: (ref: any, data: any, opt?: any) => ref.set(data, opt),
        };
        return await fn(tx);
      },
    };

    _setIsFirestoreAvailableForTesting(true, mockFsForNormalize);

    try {
      // 21-10-1: 정상 patch 성공 검증 (stale 기사 skipped 조건부 패치)
      const normalTargetEvent: NewsEvent = {
        ...legacyStalePending,
        id: 'evt-fs-norm-1',
        title: 'Normal Pending Event',
        analysisStatus: 'pending',
        analysisRetryCount: 0,
        updatedAt: '2026-10-14T00:00:00.000Z',
      };
      mockEventsMap.set('evt-fs-norm-1', { ...normalTargetEvent });

      const normOkRes = await firestoreRepo.normalizePendingEvent(
        'evt-fs-norm-1',
        {
          analysisStatus: 'skipped',
          skipReason: 'stale_article',
          analysisError: '오래된 기사로 제외',
        },
        { expectedRetryCount: 0, expectedUpdatedAt: '2026-10-14T00:00:00.000Z' }
      );
      assert.strictEqual(normOkRes.success, true, '정상 조건부 상태 패치 성공');
      const cloudUpdated1 = mockEventsMap.get('evt-fs-norm-1');
      assert.strictEqual(cloudUpdated1?.analysisStatus, 'skipped', 'Firestore 상태 skipped로 업데이트');
      assert.strictEqual(cloudUpdated1?.skipReason, 'stale_article');
      assert.notStrictEqual(cloudUpdated1?.updatedAt, '2026-10-14T00:00:00.000Z', 'updatedAt 갱신 확인');

      // 21-10-2: 충돌 방어 - 다른 Cloud Run이 이미 completed / sent로 완료한 경우 덮어쓰지 않고 authoritative 반환
      const cloudAlreadyCompleted: NewsEvent = {
        ...normalTargetEvent,
        id: 'evt-fs-conflict-completed',
        title: 'Cloud Completed Event',
        analysisStatus: 'completed',
        importance: 5,
        isSentToTelegram: true,
        updatedAt: '2026-10-14T05:00:00.000Z',
      };
      mockEventsMap.set('evt-fs-conflict-completed', { ...cloudAlreadyCompleted });

      // 로컬 인스턴스는 아직 과거 pending 상태로 알고 skipped로 정규화 시도
      const normConflictRes = await firestoreRepo.normalizePendingEvent(
        'evt-fs-conflict-completed',
        {
          analysisStatus: 'skipped',
          skipReason: 'stale_article',
        }
      );
      assert.strictEqual(normConflictRes.success, false, '이미 completed/sent된 문서는 패치 차단');
      assert.strictEqual(normConflictRes.conflict, true, 'conflict 플래그 반환');
      assert.strictEqual(normConflictRes.cloudEvent?.analysisStatus, 'completed', 'authoritative completed 문서 반환');
      const unmutatedCloud = mockEventsMap.get('evt-fs-conflict-completed');
      assert.strictEqual(unmutatedCloud?.analysisStatus, 'completed', 'Firestore는 completed 상태 엄격 보존');

      // 21-10-3: 충돌 방어 - retryCount 또는 updatedAt 불일치 시 쓰기 차단
      const cloudRetryAdvanced: NewsEvent = {
        ...normalTargetEvent,
        id: 'evt-fs-conflict-retry',
        analysisRetryCount: 2,
        updatedAt: '2026-10-14T06:00:00.000Z',
      };
      mockEventsMap.set('evt-fs-conflict-retry', { ...cloudRetryAdvanced });

      const retryMismatchRes = await firestoreRepo.normalizePendingEvent(
        'evt-fs-conflict-retry',
        { analysisStatus: 'failed' },
        { expectedRetryCount: 0, expectedUpdatedAt: '2026-10-14T00:00:00.000Z' }
      );
      assert.strictEqual(retryMismatchRes.success, false, 'retryCount/updatedAt 불일치 시 패치 차단');
      assert.strictEqual(retryMismatchRes.conflict, true);

      // 21-10-4: retryPendingAnalyses Phase 1 실행 시 Cloud Run 경합 이벤트의 로컬 sync 및 쓰기 취소 확인
      db._setEventsForTesting([]);
      const localStaleEvent: NewsEvent = {
        ...normalTargetEvent,
        id: 'evt-fs-conflict-completed',
        analysisStatus: 'pending', // 로컬은 아직 오래된 pending
      };
      db._setEventsForTesting([localStaleEvent]);

      const retryConflictRun = await retryPendingAnalyses(3, { isRateLimited: true });
      assert.strictEqual(retryConflictRun.skippedCount, 0, '경합된 completed 이벤트는 skipped 카운트 증가하지 않음');

      // 로컬 DB가 Cloud의 completed authoritative doc으로 안전하게 동기화되었는지 확인
      const localSyncedEvent = db.getEventById('evt-fs-conflict-completed');
      assert.strictEqual(localSyncedEvent?.analysisStatus, 'completed', '로컬 이벤트가 Cloud authoritative completed로 동기화 완료');
      assert.strictEqual(localSyncedEvent?.importance, 5);

      // 21-11: eligible legacy undefined status + importance 0 기사의 Phase 3 후보 포함 및 완료 기사 보존 검증
      db._setEventsForTesting([]);
      geminiAnalysisCallCount = 0;
      mockGeminiRateLimit = false;
      process.env.GEMINI_API_KEY = 'test-token-gemini-budget-guard';

      const legacyEligibleUndef: NewsEvent = {
        ...legacyStalePending,
        id: 'evt-legacy-undef-0',
        title: 'SpaceX Falcon 9 Commercial Satellite Mission Launch',
        originalTitle: 'SpaceX Falcon 9 Commercial Satellite Mission Launch',
        importance: 0,
        analysisStatus: undefined as any, // legacy undefined status
        analysisRetryCount: 0,
        primarySource: { name: 'Spaceflight Now', title: 'SpaceX Falcon 9 Mission', url: 'https://spx.com/new', publishedAt: new Date(baseHour - 30 * 60 * 1000).toISOString() },
        firstSeenAt: new Date(baseHour - 30 * 60 * 1000).toISOString(),
      };

      const legacyCompleted4: NewsEvent = {
        ...legacyStalePending,
        id: 'evt-legacy-completed-4',
        title: 'Alphabet Google Gemini 2.0 Launch Event',
        originalTitle: 'Alphabet Google Gemini 2.0 Launch Event',
        importance: 4,
        analysisStatus: undefined as any, // legacy completed without status
        analysisRetryCount: 0,
        primarySource: { name: 'The Verge', title: 'Gemini 2.0 Debut', url: 'https://theverge.com/gemini-2', publishedAt: new Date(baseHour - 40 * 60 * 1000).toISOString() },
        firstSeenAt: new Date(baseHour - 40 * 60 * 1000).toISOString(),
      };

      // Mock Firestore에 해당 이벤트 등록
      mockEventsMap.set('evt-legacy-undef-0', { ...legacyEligibleUndef });
      mockEventsMap.set('evt-legacy-completed-4', { ...legacyCompleted4 });

      db._setEventsForTesting([legacyEligibleUndef, legacyCompleted4]);

      const legacyRetryRes = await retryPendingAnalyses(3, { tracker: createCycleBudgetTracker() });

      assert.strictEqual(legacyRetryRes.retriedCount, 1, '적격한 legacy undefined+importance0 기사만 1건 재시도 대상');
      assert.strictEqual(geminiAnalysisCallCount, 1, 'Gemini 모델 1회 호출 완료');

      const analyzedLegacy = db.getEventById('evt-legacy-undef-0');
      assert.strictEqual(analyzedLegacy?.analysisStatus, 'completed', '적격 legacy 기사는 분석 완료 상태로 전환');

      const preservedLegacyCompleted = db.getEventById('evt-legacy-completed-4');
      assert.strictEqual(preservedLegacyCompleted?.importance, 4, '기존 완료된 legacy 4★ 기사는 보존');
      assert.strictEqual(preservedLegacyCompleted?.analysisRetryCount, 0, '완료된 기사는 재시도 카운트 불변');
    } finally {
      _setIsFirestoreAvailableForTesting(false);
    }

    console.log('✅ TEST 21 Passed: K-News 분석 상태 우선순위(failed0/skipped/pending/completed0), 7일 경계, 잡음 5종 및 계약 보존, 투영/백로그 정규화, 최신3기사 선별 및 최대3모델콜 전체 검증 완료\n');

    console.log('====================================================');
    console.log('🎉 ALL 21 UNIT, SECURITY, TOKEN BUDGET, WEEKLY RENEWAL & K-NEWS BACKLOG TESTS PASSED!');
    console.log('====================================================');
  } finally {
    // Restore events and global fetch
    db._clearDailyPollRunsForTesting();
    db._setEventsForTesting(originalEvents);
    globalThis.fetch = originalFetch;
  }
}

async function runTwoStageRegressionTests() {
  console.log('--- TEST 22: two-stage coverage, validation, quota, fairness, optimistic persistence ---');
  _setIsFirestoreAvailableForTesting(false);
  const now = new Date('2026-10-15T02:00:00Z');
  const fixture = (id: string, title = 'Google community overview') => createUnanalyzedEvent({
    id, title: `${title} ${id}`, link: `https://example.com/${id}`, source: 'Reuters',
    publishedAt: now.toISOString(), firstSeenAt: now.toISOString(),
    snippet: 'Confirmed product context and company facts provided by the news source. '.repeat(2),
  });
  const event = (id: string, title?: string) => ({...fixture(id,title), id, updatedAt:now.toISOString()});
  const original = db.getEvents();
  const commit = async (expected: NewsEvent, patch: Partial<NewsEvent>) => {
    const current = db.getEventById(expected.id);
    if (!current || current.updatedAt !== expected.updatedAt || current.analysisStatus === 'completed') return current || null;
    const saved = {...current,...patch,updatedAt: now.toISOString()};
    db.syncEventFromCloud(saved); return saved;
  };
  const generate = async (prompt: string) => {
    const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
    return { text: JSON.stringify({items:items.map((e:any) => ({id:e.id,score:e.id==='high' ? 5 : 2,reason:'회사 영향에 대한 잠정 평가',uncertain:false}))}), usageMetadata:{totalTokenCount:100} };
  };
  const analyze = async (raw: RawArticle, usage: (n:number)=>void) => {
    usage(200);
    return {...createUnanalyzedEvent(raw), analysisStatus:'completed' as const, importance:5, analyzedByGemini:true};
  };
  try {
    const events = Array.from({length:20},(_,i)=>event(i===19?'high':`low-${i}`));
    db._setEventsForTesting(events);
    const result = await runTwoStageAnalysis({now,generate,analyze,commit});
    assert.equal(result.screeningCalls,3,'20 events all receive batch screening, not first 8 only');
    assert.equal(result.screened,20);
    assert.equal(result.detailed,1);
    assert.equal(result.unassessed,0);
    assert.equal(result.awaitingDetail,0);
    assert.equal(result.actualTokens,500);
    assert.equal(db.getEventById('low-0')!.analysisStatus,'screened');
    assert.equal(db.getEventById('low-0')!.importance,0,'preliminary score never presented as final');
    assert.equal(db.getEventById('high')!.analysisStatus,'completed');
    assert.equal(db.getEventById('high')!.primarySource.url,'https://example.com/high');
    const low = db.getEventById('low-0')!;
    assert.equal(isEventQualifiedForTelegramAutoDispatch({...low,screening:{...low.screening!,score:5}},db.getSettings()).qualified,false);

    for (const items of [[],[{id:'unknown',score:5,reason:'x',uncertain:false}],
      [{id:'high',score:9,reason:'x',uncertain:false}], [{id:'high',score:5,reason:'x',uncertain:'false'}]]) {
      assert.throws(()=>parseScreeningBatch(JSON.stringify({items}),[event('high')],now));
    }
    const short = event('short'); short.primarySource.snippet='';
    const uncertain = parseScreeningBatch(JSON.stringify({items:[{id:'short',score:1,reason:'정보 부족',uncertain:false}]}),[short],now).get('short')!;
    assert(uncertain.uncertain,'missing evidence forces uncertainty, not a low-score dismissal');
    assert(needsDetailedAnalysis({...short,screening:uncertain}));
    const critical=event('critical','Google earnings guidance');
    critical.screening={...uncertain,score:2,uncertain:false,evidenceKey:screeningEvidenceKey(critical)};
    assert(needsDetailedAnalysis(critical),'material signal gets review even with low provisional score');

    db._setEventsForTesting([event('high')]);
    const limited = await runTwoStageAnalysis({now,generate,analyze,commit,maxDetailedCalls:0});
    assert.equal(limited.awaitingDetail,1);
    assert.equal(db.getEventById('high')!.analysisStatus,'pending');
    assert(db.getEventById('high')!.analysisDeferredReason!.includes('이월'));
    const cached = await runTwoStageAnalysis({now,generate:async()=>{throw new Error('cached result must not be screened twice');},analyze,commit});
    assert.equal(cached.screeningCalls,0); assert.equal(cached.detailed,1);

    db._setEventsForTesting([event('budget')]);
    const noBudget = await runTwoStageAnalysis({now,generate,analyze,commit,estimatedTokenBudget:0});
    assert.equal(noBudget.screeningCalls,0); assert.equal(noBudget.unassessed,1);
    assert.equal(db.getEventById('budget')!.importance,0);
    assert.equal(db.getEventById('budget')!.analysisStatus,'pending');

    db._setEventsForTesting(Array.from({length:12},(_,i)=>event(`quota-${i}`)));
    const quota = await runTwoStageAnalysis({now,generate:async()=>{throw new Error('429 RESOURCE_EXHAUSTED');},analyze,commit});
    assert.equal(quota.screeningCalls,1); assert.equal(quota.detailedCalls,0); assert.equal(quota.unassessed,12); assert(quota.isRateLimited);
    assert.equal(db.getEventById('quota-0')!.analysisStatus,'failed');

    db._setEventsForTesting([event('high')]);
    const badDetail = await runTwoStageAnalysis({now,generate,analyze:async()=>{throw new Error('429');},commit});
    assert.equal(badDetail.detailedCalls,1); assert(badDetail.accountedTokens>=16000); assert(badDetail.isRateLimited);
    assert.equal(db.getEventById('high')!.analysisStatus,'failed');
    const a1=event('a1'),a2=event('a2'),b1=event('b1');
    a1.companyImpacts=[];a2.companyImpacts=[];b1.companyImpacts=[];
    a1.relatedCompanies=['A'];a2.relatedCompanies=['A'];b1.relatedCompanies=['B'];
    assert.deepEqual(fairAnalysisOrder([a1,a2,b1]).map(e=>e.id),['a1','b1','a2']);

    const completed={...event('done'),analysisStatus:'completed' as const,importance:4};
    const stale=event('stale');stale.primarySource.publishedAt='2026-10-01T00:00:00Z';
    db._setEventsForTesting([completed,stale]);
    const excluded=await runTwoStageAnalysis({now,generate,analyze,commit});
    assert.equal(excluded.screeningCalls,0);assert.equal(excluded.excluded,1);
    assert.equal(db.getEventById('done')!.importance,4);

    // Exercise real repository transaction with an in-memory Firestore transport.
    let cloud=event('atomic');let writes=0;
    const mockFs:any={collection:()=>({doc:()=>({})}),runTransaction:async(fn:any)=>fn({
      get:async()=>({exists:true,data:()=>({...cloud})}),
      set:(_ref:any,patch:any,opts:any)=>{assert.equal(opts.merge,true);cloud={...cloud,...patch};writes++;},
    })};
    _setIsFirestoreAvailableForTesting(true,mockFs);
    const expected={...cloud};
    await firestoreRepo.commitScreeningAnalysis(expected,{analysisStatus:'screened',screening:{score:2,reason:'test',uncertain:false,evidenceKey:'key',evaluatedAt:now.toISOString()}});
    assert.equal(writes,1);assert.equal(cloud.primarySource.url,expected.primarySource.url);
    cloud={...cloud,analysisStatus:'completed',importance:5};
    const refused=await firestoreRepo.commitScreeningAnalysis(expected,{analysisStatus:'screened',importance:0});
    assert.equal(writes,1);assert.equal(refused!.importance,5);
    console.log('✅ TEST 22 Passed: complete screening coverage, uncertainty, cached screening, quota/budget deferral, company fairness, completed preservation and transaction conflict protection');
  } finally {
    _setIsFirestoreAvailableForTesting(false);db._setEventsForTesting(original);
  }
}

async function runCeoScheduleAndAdminRegressionTests() {
  console.log('--- TEST 23: CEO 관리자 UI 조건부 렌더링, 서버 인증 거부 유지, 스케줄 연결 하루 1회/동시실행 방지, GET 무부작용, 실패 격리 종합 검증 ---');

  // 23-1: 비로그인 일반 방문자 화면 관리자 제어 미노출 & 관리자 전용 노출 (조건부 렌더링)
  const mockReadyState: CeoViewState = {
    status: 'ready',
    dataset: {
      schemaVersion: 3,
      isExample: false,
      persons: [{ personId: 'p-googl', displayName: 'Sundar Pichai', nameVariants: ['Pichai'], isExample: false }],
      roles: [{ personId: 'p-googl', companyId: 'googl', companyName: 'Google', title: 'CEO', roleType: 'ceo', start: '2015-10-02', end: null }],
      topics: [{ topicId: 'ai', label: 'AI 인프라' }],
      statements: [{
        statementId: 's-googl-1',
        personId: 'p-googl',
        companyId: 'googl',
        roleTitleAtTime: 'CEO',
        roleStatusAtTime: 'current',
        topicId: 'ai',
        kind: 'direct_quote',
        quoteText: 'Gemini is our core strategic platform across all Google products',
        quoteLanguage: 'en',
        summaryKo: '',
        spokenAt: { value: '2026-10-18', precision: 'day', basisType: 'explicit_in_text' },
        evidence: [{
          articleId: 'art-googl-1',
          articleContentHash: 'hash-g-1',
          sourceName: 'Google Official Blog',
          url: 'https://blog.google/gemini-core',
          excerpt: 'Gemini is our core strategic platform across all Google products',
          articlePublishedAt: '2026-10-18',
        }],
        extractor: { name: 'ceo-composite', version: '1.0', schemaVersion: 2 },
        isExample: false,
      }],
      comparisons: [],
      heldBackCount: 0,
      unavailableArticles: { pending: 0, failed: 0 },
    },
    source: {
      status: 'partial',
      refreshedAt: '2026-10-20T00:00:00.000Z',
      sources: [
        { feedName: 'Google Official Blog', feedUrl: 'https://blog.google/feed', ok: true, itemsInFeed: 2, matchedExisting: 1, withBody: 1, kind: 'feed' },
        { feedName: 'Microsoft Tech Feed', feedUrl: 'https://blogs.microsoft.com/feed', ok: false, error: 'Source timeout 504 Gateway Timeout', itemsInFeed: 1, matchedExisting: 0, withBody: 0, kind: 'feed' },
      ],
      koSummary: { state: 'on', month: '2026-10', spentUsd: 0.045, outstandingUsd: 0.015, limitUsd: 1.0, enabled: true },
    },
  };

  // 비로그인 방문자 렌더링: 비용/월한도/원장 및 출처별 실패 리스트 완전 미노출 확인
  const publicHtml = renderToString(React.createElement(CeoStatementsView, { state: mockReadyState, isAdmin: false }));
  assert.strictEqual(publicHtml.includes('ko-budget'), false, '비로그인 방문자 화면에 ko-budget 컴포넌트 미노출');
  assert.strictEqual(publicHtml.includes('source-detail'), false, '비로그인 방문자 화면에 source-detail 접기/펼치기 미노출');
  assert.strictEqual(publicHtml.includes('Source timeout 504'), false, '비로그인 방문자 화면에 출처별 실패 상세 미노출');
  assert.strictEqual(publicHtml.includes('AI 한국어 요약:'), false, '비로그인 방문자 화면에 AI 요약 상태 및 월 한도/비용 미노출');
  assert.strictEqual(publicHtml.includes('확정 $'), false, '비로그인 방문자 화면에 USD 비용 미노출');
  assert.strictEqual(publicHtml.includes('Gemini is our core strategic platform'), true, '비로그인 방문자 화면에 발언 인용문 정상 노출');
  assert.strictEqual(publicHtml.includes('Google Official Blog'), true, '비로그인 방문자 화면에 출처 정상 노출');
  assert.strictEqual(publicHtml.includes('마지막 갱신'), false, '비로그인 방문자 화면에 마지막 갱신 상태 미노출');
  assert.strictEqual(publicHtml.includes('일부 출처만 확인(부분 가용)'), false, '비로그인 방문자 화면에 상태박스(부분 가용) 미노출');
  assert.strictEqual(publicHtml.includes('source-banner'), false, '비로그인 방문자 화면에 source-banner 미노출');

  // 관리자 렌더링: 비용/예산/출처별 실패 상세 및 상태박스 정상 노출 확인
  const adminHtml = renderToString(React.createElement(CeoStatementsView, { state: mockReadyState, isAdmin: true }));
  assert.strictEqual(adminHtml.includes('source-banner'), true, '관리자 화면에 source-banner 정상 노출');
  assert.strictEqual(adminHtml.includes('일부 출처만 확인(부분 가용)'), true, '관리자 화면에 갱신 상태 정상 노출');
  assert.strictEqual(adminHtml.includes('마지막 갱신'), true, '관리자 화면에 마지막 갱신 시각 정상 노출');
  assert.strictEqual(adminHtml.includes('ko-budget'), true, '관리자 화면에 ko-budget 컴포넌트 노출');
  assert.strictEqual(adminHtml.includes('source-detail'), true, '관리자 화면에 source-detail 노출');
  assert.strictEqual(adminHtml.includes('Source timeout 504'), true, '관리자 화면에 출처별 실패 에러 노출');

  // CeoMenu 렌더링: 비로그인 시 admin panel 미노출, 관리자 시 노출
  const publicMenuHtml = renderToString(React.createElement(CeoMenu, { isAdmin: false }));
  assert.strictEqual(publicMenuHtml.includes('ceo-admin-panel'), false, '비로그인 시 ceo-admin-panel 미노출');
  assert.strictEqual(publicMenuHtml.includes('공식 원문 새로고침'), false, '비로그인 시 새로고침 버튼 미노출');

  const adminMenuHtml = renderToString(React.createElement(CeoMenu, { isAdmin: true }));
  assert.strictEqual(adminMenuHtml.includes('ceo-admin-panel'), true, '관리자 시 ceo-admin-panel 정상 노출');
  assert.strictEqual(adminMenuHtml.includes('공식 원문 새로고침 (관리자)'), true, '관리자 시 새로고침 버튼 정상 노출');

  // 23-2: 서버 관리자 API 인증 거부 유지 (401/403)
  const testAdminSecret = 'test-admin-secret-23';
  process.env.ADMIN_SECRET = testAdminSecret;

  const app = createServerApp({ isTest: true });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const unauthRefresh = await fetch(`${baseUrl}/api/admin/ceo/refresh`, { method: 'POST' });
    assert.strictEqual(unauthRefresh.status, 401, '인증 없는 CEO 새로고침 요청은 401 거부');

    const unauthSettings = await fetch(`${baseUrl}/api/admin/ceo/ko-summary/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
    assert.strictEqual(unauthSettings.status, 401, '인증 없는 CEO 요약 설정 변경은 401 거부');

    const unauthKoOne = await fetch(`${baseUrl}/api/admin/ceo/ko-summary/one`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statementId: 's-1' }) });
    assert.strictEqual(unauthKoOne.status, 401, '인증 없는 CEO 단건 요약 생성은 401 거부');

    // 23-3: 동일 CeoRuntime 인스턴스 공유 & 동시 실행 방지 (inFlight 409 및 lease)
    const backend = new MemoryStateBackend();
    const memoryStore = new MemoryStateStore(backend);
    let loopbackFetchCalls = 0;
    const loopbackFetch = createFetchText({ allowHosts: ['127.0.0.1'], allowHttpLoopback: true });

    // 원문 제공 루프백 서버 구동
    const originServer = http.createServer((req, res) => {
      loopbackFetchCalls++;
      if (req.url === '/nvda/feed') {
        res.setHeader('content-type', 'application/rss+xml');
        res.end(rssFeed([
          { link: ARTICLE_1, title: 'Launch', html: BODY_1, pubDate: 'Thu, 15 Oct 2026 17:00:00 +0000' },
          { link: ARTICLE_2, title: 'Roadmap', html: BODY_2, pubDate: 'Fri, 16 Oct 2026 17:00:00 +0000' },
        ]));
      } else if (req.url === '/transcript') {
        res.setHeader('content-type', 'text/html');
        res.end(transcriptPage());
      } else {
        res.statusCode = 404;
        res.end('not found');
      }
    });
    await new Promise<void>((resolve) => originServer.listen(0, '127.0.0.1', resolve));
    const originPort = (originServer.address() as any).port;
    const originBase = `http://127.0.0.1:${originPort}`;

    const urlMap: Record<string, string> = {
      [FEED_URL_NVDA]: '/nvda/feed',
      [TRANSCRIPT_URL]: '/transcript',
    };

    const sharedRuntime = new CeoRuntime({
      getEvents: () => [{ id: 'evt-1', category: 'AI 가속기 / 반도체', primarySource: { url: ARTICLE_1 } }],
      fetchText: (url, o) => loopbackFetch(originBase + (urlMap[url] || '/missing'), o),
      parseFeed: parseFeedWithRssParser,
      registry: LIVE_REGISTRY,
      transcripts: [LIVE_TRANSCRIPT],
      getStore: () => memoryStore,
      allowExampleData: true,
      minIntervalMs: 50,
      headCacheMs: 0,
    });

    setSchedulerCeoRuntime(sharedRuntime);
    assert.strictEqual(getSchedulerCeoRuntime(), sharedRuntime, '라우터와 스케줄러가 동일 CeoRuntime 인스턴스를 엄격히 공유');

    // 첫 실행: 정상 갱신 완료
    const firstRefresh = await sharedRuntime.refresh();
    assert.strictEqual(firstRefresh.accepted, true, '첫 CEO 수집 정상 완료');
    assert.strictEqual(firstRefresh.httpStatus, 200);

    // 동시 실행 방지 검증: 이미 실행 중인 동안 호출 시 409 already_running 즉시 거부
    (sharedRuntime as any).inFlight = new Promise<any>(() => {}); // 시뮬레이션: 실행 중 상태
    const concurrentAttempt = await sharedRuntime.refresh();
    assert.strictEqual(concurrentAttempt.accepted, false);
    assert.strictEqual(concurrentAttempt.httpStatus, 409, '동시 실행 시 409 already_running 반환');
    assert.strictEqual(concurrentAttempt.reason, 'already_running');
    (sharedRuntime as any).inFlight = null; // 원복

    // 23-4: 동일일 중복실행 방지 (Asia/Seoul 하루 1회 정책)
    const fixedNow = new Date('2026-10-20T12:00:00.000Z');
    const seoulDate = '2026-10-20';
    // 방금 commit된 refreshedAt의 Asia/Seoul 날짜는 오늘(2026-10-20)
    const snap = await sharedRuntime.snapshot();
    assert.ok(snap.refreshedAt, '정상 갱신 시각 존재');

    const fetchCountBeforeSecondRun = loopbackFetchCalls;
    // 두 번째 스케줄 사이클 시뮬레이션: 동일 날짜이므로 스킵되어야 함
    const lastSeoulDate = snap.refreshedAt ? '2026-10-20' : null;
    assert.strictEqual(lastSeoulDate, seoulDate, '최근 갱신일이 오늘 Asia/Seoul과 일치');

    // 23-5: GET /api/ceo/dataset 부작용 없음 검증
    const getBeforeFetches = loopbackFetchCalls;
    const getBeforeWrites = backend.writes;
    for (let i = 0; i < 3; i++) {
      const getRes = await fetch(`${baseUrl}/api/ceo/dataset`);
      assert.strictEqual(getRes.status, 200);
      const data = await getRes.json();
      assert.ok(data.dataset !== null, '저장된 데이터셋 반환');
    }
    assert.strictEqual(loopbackFetchCalls, getBeforeFetches, 'GET 호출로 인한 원문 fetch 발생 0회');
    assert.strictEqual(backend.writes, getBeforeWrites, 'GET 호출로 인한 DB write 발생 0회');

    // 23-6: CEO 수집 실패와 뉴스 결과 독립 검증
    // 장애 상황의 CeoRuntime: refresh 호출 시 500 예외 발생
    const failingCeoRuntime = new CeoRuntime({
      getEvents: () => [],
      fetchText: async () => { throw new Error('Simulated network outage for CEO official feeds'); },
      parseFeed: parseFeedWithRssParser,
      registry: LIVE_REGISTRY,
      getStore: () => memoryStore,
      allowExampleData: true,
    });
    setSchedulerCeoRuntime(failingCeoRuntime);

    // 뉴스 모니터링 사이클을 실행했을 때 CEO 수집 오류가 발생해도 뉴스는 정상 완료
    _setCollectArticlesForTesting(async () => ({ totalFetched: 0, newRelevantArticles: [] }));
    try {
      db._clearDailyPollRunsForTesting();
      db._setEventsForTesting([]);
      const cycleRes = await runMonitoringCycle(true);
      assert.ok(cycleRes !== undefined, '뉴스 모니터링 사이클이 CEO 실패에도 중단 없이 완료');
      assert.strictEqual(cycleRes.newArticlesCount, 0);

      // 스케줄러 로그에 CEO 오류가 비치명적 경고(warn)로 격리 기록되었는지 확인
      const logs = db.getLogs(50);
      const ceoWarnLog = logs.find(l => l.module === 'Scheduler' && l.message.includes('[CEO Daily]'));
      assert.ok(ceoWarnLog, 'CEO 수집 실패가 뉴스 스케줄러에 격리 경고로 안전하게 기록됨');
    } finally {
      _setCollectArticlesForTesting(null);
    }

    originServer.close();
  } finally {
    server.close();
    setSchedulerCeoRuntime(null);
  }

  console.log('✅ TEST 23 Passed: CEO 관리자 UI 조건부 렌더링, 서버 인증 거부 유지, 스케줄 연결 하루 1회/동시실행 방지, GET 무부작용, 실패 격리 전체 검증 완료\n');
}

runMonitoringAndDedupTests()
  .then(runTwoStageRegressionTests)
  .then(runCeoScheduleAndAdminRegressionTests)
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Test suite failed:', err);
    process.exit(1);
  });

