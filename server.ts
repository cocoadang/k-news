import { resolveOpenAIModel } from './server/openaiClient';
import 'dotenv/config';
import express from 'express';
import path from 'path';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { db } from './server/db';
import { jsonCompression, packedCache, publicCdnHeader, sendPacked, serveBuiltApp } from './server/httpDelivery';
import { runMonitoringCycle, runAnalysisOnlyCycle, startScheduler, restartSchedulerWithNewInterval, getSchedulerStatus, setSchedulerCeoRuntime, getSchedulerCeoRuntime } from './server/scheduler';
import { sendPublicEventToTelegram as sendEventToTelegram, handleTelegramCommand } from './server/telegram';
import { analyzeArticleWithGemini, suggestCompanyKeywords } from './server/geminiAnalyzer';
import { rollbackCompanyKeywords } from './server/companyRenewal';
import { projectEventAnalysisStatus } from './server/newsNoiseFilter';
import { createCeoRouter, createCeoRuntime, translatePendingHeadlines, translatePendingXPosts } from './server/ceo/routes';
import { collectXPosts, firestoreXStore, xPostStatements, xTokenStore, validXToken, X_DEFAULT_CAP_USD } from './server/ceo/xPosts';
import { registerWallstreetRoutes } from './server/wallstreet/runtime.mjs';
import { createConfiguredWallstreetRuntime } from './server/wallstreet/providers.mjs';
import { CeoRuntime } from './server/ceo/runtime';
import { SystemStatus } from './server/types';
import { getIsFirestoreAvailable, initFirestore, firestoreRepo } from './server/firestore';
import {
  SESSION_COOKIE_NAME,
  LEGACY_SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_BELOW_MS,
  sessionExpiry,
  generateSessionToken,
  verifySessionToken,
  SlidingRateLimiter,
  checkAdminAuth,
  isValidCsrfOrigin,
  getCookieOptions,
  verifyCronAuth,
  verifyTelegramWebhookSecret,
  validateTelegramUpdate,
  TelegramReplayTracker,
} from './server/security';

const serverStartTime = Date.now();

// Single container rate limiter instances
// Note: In Cloud Run multi-instance environments, each container maintains its own local memory window.
// Distributed protection across instances requires Cloud Armor or a shared Redis/Valkey rate-limiter.
const loginRateLimiter = new SlidingRateLimiter(15 * 60 * 1000, 5); // 5 login attempts per 15 min
const aiRateLimiter = new SlidingRateLimiter(60 * 1000, 10); // 10 AI operations per min
const manualPollRateLimiter = new SlidingRateLimiter(5 * 60 * 1000, 3); // 3 manual polls per 5 min
const telegramRateLimiter = new SlidingRateLimiter(60 * 1000, 10); // 10 telegram tests/dispatches per min

// Telegram webhook replay defense tracker
const telegramReplayTracker = new TelegramReplayTracker(5000);

export function createServerApp(options?: { isTest?: boolean; ceoRuntime?: CeoRuntime }) {
  const app = express();

  // Trust Cloud Run / Reverse Proxy headers so req.protocol, req.secure, and req.ip accurately reflect client HTTPS
  app.set('trust proxy', 1);

  // Security Headers Middleware
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Protect against clickjacking while ensuring AI Studio iframe preview is not blocked
    if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_IFRAME_EMBED) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    } else {
      // In dev / preview / test environments, use CSP frame-ancestors to permit AI Studio preview framing
      res.setHeader(
        'Content-Security-Policy',
        "frame-ancestors 'self' https://*.google.com https://*.googleusercontent.com https://*.aistudio.google.com;"
      );
    }

    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(express.json({ limit: '512kb' }));
  app.use(cookieParser());
  app.use(jsonCompression());

  // Background Firestore connection check (non-blocking for fast server boot)
  if (!options?.isTest) {
    db.ensureFirestoreReady().catch((err) => {
      console.warn('⚠️ [DB] Initial background sync warning:', err?.message || err);
    });
  }

  // ==========================================
  // Middlewares
  // ==========================================

  // Admin Authorization Middleware (Fail-Closed, HMAC Cookie or Server Secret Bearer/X-Admin-Secret)
  const verifyAdminAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret || adminSecret.trim() === '') {
      db.addLog('System', 'warn', `Admin action blocked on ${req.method} ${req.path}: ADMIN_SECRET is not configured (503 fail-closed)`);
      return res.status(503).json({
        error: 'Service Unavailable: ADMIN_SECRET is not configured on this server environment.',
        requiresAuth: true,
        configured: false,
      });
    }

    const auth = checkAdminAuth(req);
    if (!auth.authenticated) {
      db.addLog('System', 'warn', `Unauthorized Admin API access attempt on ${req.method} ${req.path} from ${req.ip}`);
      return res.status(401).json({
        error: 'Unauthorized: Admin authentication required',
        requiresAuth: true,
        configured: true,
      });
    }

    // CSRF defense for cookie-authenticated mutating requests (POST, PUT, DELETE, PATCH)
    if (auth.authMethod === 'cookie' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      if (!isValidCsrfOrigin(req)) {
        db.addLog('System', 'warn', `CSRF Origin verification failed for ${req.method} ${req.path} from IP ${req.ip}`);
        return res.status(403).json({
          error: 'Forbidden: CSRF validation failed (untrusted Origin/Referer)',
        });
      }
    }

    next();
  };

  // CSRF validation middleware specifically for authentication endpoints (login / logout)
  const verifyCsrfForAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!isValidCsrfOrigin(req)) {
      db.addLog('System', 'warn', `CSRF Origin verification failed on auth route ${req.method} ${req.path} from IP ${req.ip}`);
      return res.status(403).json({
        success: false,
        error: 'Forbidden: CSRF validation failed (untrusted Origin/Referer)',
      });
    }
    next();
  };

  // Rate Limiting Middlewares
  const aiRateLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const check = aiRateLimiter.check(key);
    if (!check.allowed) {
      const retrySec = Math.ceil(check.retryAfterMs / 1000);
      return res.status(429).json({
        error: `AI API 호출 속도 제한을 초과했습니다. ${retrySec}초 후에 다시 시도해주세요.`,
        retryAfter: retrySec,
      });
    }
    next();
  };

  const manualPollRateLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const check = manualPollRateLimiter.check(key);
    if (!check.allowed) {
      const retrySec = Math.ceil(check.retryAfterMs / 1000);
      return res.status(429).json({
        error: `수동 수집 요청이 너무 빈번합니다. ${retrySec}초 후에 다시 시도해주세요.`,
        retryAfter: retrySec,
      });
    }
    next();
  };

  const telegramRateLimitMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const check = telegramRateLimiter.check(key);
    if (!check.allowed) {
      const retrySec = Math.ceil(check.retryAfterMs / 1000);
      return res.status(429).json({
        error: `텔레그램 발송 요청이 너무 빈번합니다. ${retrySec}초 후에 다시 시도해주세요.`,
        retryAfter: retrySec,
      });
    }
    next();
  };

  // ==========================================
  // Auth API Routes
  // ==========================================

  // Check current admin auth status (genuine session verification, zero bypass)
  app.get('/api/auth/status', (req, res) => {
    const adminSecret = process.env.ADMIN_SECRET;
    const isConfigured = Boolean(adminSecret && adminSecret.trim() !== '');
    const auth = checkAdminAuth(req);
    // 쿠키 로그인 상태면 접속할 때마다 30일로 연장(슬라이딩 만료): 자주 쓰는 관리자는 로그아웃되지 않음
    if (auth.authenticated && auth.authMethod === 'cookie' && isConfigured) {
      const exp = sessionExpiry(req.cookies?.[SESSION_COOKIE_NAME]);
      if (exp !== null && exp - Date.now() < SESSION_RENEW_BELOW_MS) {
        res.cookie(SESSION_COOKIE_NAME, generateSessionToken(adminSecret!.trim()), getCookieOptions(req));
      }
    }

    res.json({
      configured: isConfigured,
      requiresAuth: true,
      isAuthenticated: auth.authenticated,
    });
  });

  // Admin login via password (validates against ADMIN_SECRET, applies CSRF Origin check, sets HttpOnly session cookie)
  app.post('/api/auth/login', verifyCsrfForAuth, (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const rateCheck = loginRateLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      const retrySec = Math.ceil(rateCheck.retryAfterMs / 1000);
      db.addLog('System', 'warn', `Login rate limit exceeded from ${clientIp}. Blocked for ${retrySec}s.`);
      return res.status(429).json({
        success: false,
        error: `너무 많은 로그인 시도가 감지되었습니다. ${retrySec}초 후에 다시 시도해주세요.`,
        retryAfter: retrySec,
      });
    }

    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret || adminSecret.trim() === '') {
      return res.status(503).json({
        success: false,
        error: 'Service Unavailable: ADMIN_SECRET이 서버 환경변수에 설정되어 있지 않습니다.',
        configured: false,
      });
    }

    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ success: false, error: 'Password is required' });
    }

    const trimmedSecret = adminSecret.trim();
    let isValid = false;
    if (password.length === trimmedSecret.length) {
      try {
        isValid = crypto.timingSafeEqual(Buffer.from(password), Buffer.from(trimmedSecret));
      } catch {
        isValid = false;
      }
    }

    if (!isValid) {
      db.addLog('System', 'warn', `Failed admin login attempt from ${clientIp}`);
      return res.status(401).json({ success: false, error: 'Invalid admin secret password' });
    }

    // Reset rate limiter on successful authentication
    loginRateLimiter.reset(clientIp);

    const token = generateSessionToken(trimmedSecret);
    const cookieOpts = getCookieOptions(req);

    res.cookie(SESSION_COOKIE_NAME, token, cookieOpts);
    res.clearCookie(LEGACY_SESSION_COOKIE_NAME, { ...cookieOpts, maxAge: undefined });

    db.addLog('System', 'info', `Admin session established successfully from ${clientIp}`);
    res.json({ success: true, message: 'Authenticated successfully' });
  });

  // Admin logout (applies CSRF Origin check, clears HttpOnly session cookie)
  app.post('/api/auth/logout', verifyCsrfForAuth, (req, res) => {
    const cookieOpts = getCookieOptions(req);
    res.clearCookie(SESSION_COOKIE_NAME, { ...cookieOpts, maxAge: undefined });
    res.clearCookie(LEGACY_SESSION_COOKIE_NAME, { ...cookieOpts, maxAge: undefined });
    res.json({ success: true, message: 'Logged out successfully' });
  });

  // ==========================================
  // Public Information API Routes (Zero Secret / PII Exposure)
  // ==========================================

  // 1. Status Overview (Public read, boolean indicators only, zero secret leakage)
  app.get('/api/status', (req, res) => {
    const settings = db.getSettings();
    const events = db.getEvents();
    const companies = db.getCompanies();
    const scheduler = getSchedulerStatus();

    const status: SystemStatus = {
      status: scheduler.isPolling ? 'polling' : 'idle',
      lastPollTime: settings.lastPollTime,
      nextPollTime: settings.nextPollTime,
      totalEvents: events.length,
      highPriorityEvents: events.filter(e => e.importance >= 4).length,
      telegramSentCount: settings.totalTelegramAlertsSent,
      hasGeminiKey: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'MY_GEMINI_API_KEY' && process.env.OPENAI_API_KEY.trim() !== ''),
      hasTelegramConfig: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      isFirestoreConnected: getIsFirestoreAvailable(),
      geminiModel: resolveOpenAIModel(),
      aiProvider: 'openai',
      aiModel: resolveOpenAIModel(),
      hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
      activeKeywordsCount: settings.customKeywords.length,
      activeCompaniesCount: companies.filter(c => c.enabled).length,
      uptimeSeconds: Math.floor((Date.now() - serverStartTime) / 1000),
    };

    res.json(status);
  });

  // 2. Cloud Run Scheduled Cron Job Endpoint
  // Strictly POST only. Requires CRON_SECRET in all environments (timing-safe comparison).
  // Query parameters ?secret and ?adminSecret are strictly rejected.
  // ADMIN_SECRET has zero influence on cron authentication.
  let pollHeadlineHook: ((deadline: number) => Promise<unknown>) | null = null;
  let pollStatusHook: ((result: any, headline: any) => Promise<void>) | null = null;
  let xPostsHook: ((deadline: number) => Promise<unknown>) | null = null;
  app.post('/api/jobs/poll', async (req, res) => {
    const cronAuth = verifyCronAuth(req);

    if (!process.env.CRON_SECRET || !process.env.CRON_SECRET.trim()) {
      console.warn('[POLL] rejected: cron_secret_unconfigured');
      db.addLog('Scheduler', 'warn', `Cloud Scheduler trigger blocked: CRON_SECRET is not configured on the server.`);
      return res.status(503).json({ error: 'Service Unavailable: CRON_SECRET is not configured on the server' });
    }

    if (!cronAuth.authorized) {
      console.warn(`[POLL] rejected: unauthorized_cron_secret (IP: ${req.ip})`);
      db.addLog('Scheduler', 'warn', `Unauthorized Cloud Scheduler trigger attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Unauthorized: Invalid CRON_SECRET' });
    }

    console.log('[POLL] start: Cloud Scheduler trigger authenticated for POST /api/jobs/poll');
    const pollStartedAt = Date.now();

    try {
      // Ensure Firestore is connected and data synchronized
      const isFirestoreReady = await db.ensureFirestoreReady(25000);
      if (!isFirestoreReady || !getIsFirestoreAvailable() || !db.isFirestoreReady()) {
        console.error('[POLL] rejected: firestore_unavailable - Fail-Closed enforced');
        throw new Error('Google Cloud Firestore is unavailable or persistent synchronization failed.');
      }

      console.log('[POLL] executing: Firestore verified ready, starting monitoring cycle...');
      db.addLog('Scheduler', 'info', 'Cloud Scheduler trigger authenticated & executing for /api/jobs/poll.');
      const result = await runMonitoringCycle(false);

      if (result.skipped && result.skipReason === 'already_completed') {
        // 오늘 수집은 이미 끝남 → 같은 호출로 '분석만' 진행 (Cloud Scheduler가 3시간마다 호출)
        // 먼저 본인 X 게시물 수집·번역(최대 45초, 토큰 없으면 즉시 건너뜀)
        if (xPostsHook) { try { const xr = await xPostsHook(Date.now() + 45_000); console.log(`[POLL] x_posts: ${JSON.stringify(xr)}`); } catch (e) { console.warn('[POLL] x_posts_failed', e); } }
        const analysis = await runAnalysisOnlyCycle(120_000);
        console.log(`[POLL] analysis_only: ${JSON.stringify({ skipped: analysis.skipped, screened: analysis.summary?.screened, detailed: analysis.summary?.detailed, telegram: analysis.telegramAlertsSentCount })}`);
        return res.json({ success: true, status: 'analysis_only', date: result.seoulDate, triggeredBy: 'Cloud Scheduler /api/jobs/poll', timestamp: new Date().toISOString(),
          screened: analysis.summary?.screened ?? 0, detailed: analysis.summary?.detailed ?? 0, telegramAlertsSentCount: analysis.telegramAlertsSentCount });
      }
      if (result.skipped) {
        console.log(`[POLL] skipped: daily_guard_active - date=${result.seoulDate}, reason=${result.skipReason}`);
        return res.json({
          success: true,
          status: 'skipped',
          reason: result.skipReason,
          date: result.seoulDate,
          message: `Asia/Seoul ${result.seoulDate} 기준 금일 자동 뉴스 수집은 이미 실행되었거나 진행 중입니다 (하루 1회 정책 준수).`,
          triggeredBy: 'Cloud Scheduler /api/jobs/poll',
          timestamp: new Date().toISOString(),
          ...result,
        });
      }

      console.log(`[POLL] success: new_articles=${result.newArticlesCount}, new_events=${result.newEventsCreated.length}, telegram_alerts=${result.telegramAlertsSentCount}`);
      // 매일 수집 뒤: CEO 화면의 언론 헤드라인 중 아직 번역되지 않은 것을 묶어 AI 번역(호출 최대 1회, 시간이 남을 때만, 실패해도 수집 결과에 영향 없음)
      let headlineReport: any = null;
      if (Date.now() - pollStartedAt < 200_000 && pollHeadlineHook) {
        try { headlineReport = await pollHeadlineHook(Math.min(pollStartedAt + 270_000, Date.now() + 70_000)); console.log(`[POLL] headline_ko: ${JSON.stringify(headlineReport)}`); } catch { /* ignore */ }
      }
      // 관리자에게 하루 1회 상태 보고(실패해도 수집 결과에 영향 없음)
      if (pollStatusHook) { try { await pollStatusHook(result, headlineReport); } catch (e) { console.warn('[POLL] status_report_failed', e); } }
      res.json({
        success: true,
        triggeredBy: 'Cloud Scheduler /api/jobs/poll',
        timestamp: new Date().toISOString(),
        ...result,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[POLL] failed: ${errorMsg}`);
      db.addLog('Scheduler', 'error', `Cloud Scheduler /api/jobs/poll execution failed: ${errorMsg}`);
      if (pollStatusHook) { try { await pollStatusHook({ error: errorMsg.slice(0, 120) }, null); } catch { /* ignore */ } }
      res.status(500).json({
        success: false,
        error: `Execution failed: ${errorMsg}`,
      });
    }
  });

  // Explicitly reject non-POST methods on /api/jobs/poll with 405 Method Not Allowed
  app.all('/api/jobs/poll', (req, res) => {
    res.status(405).json({ error: 'Method Not Allowed: /api/jobs/poll only accepts POST requests' });
  });

  // 3. Companies List (Public read)
  app.get('/api/companies', (req, res) => {
    res.json(db.getCompanies());
  });

  // 3-1. Company Keyword & Business AI Suggestion (Admin only + Rate Limited)
  app.post('/api/companies/suggest-keywords', verifyAdminAuth, aiRateLimitMiddleware, async (req, res) => {
    const { companyName, ticker } = req.body || {};
    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return res.status(400).json({ error: '기업명을 입력해주세요.' });
    }

    try {
      const suggestions = await suggestCompanyKeywords(
        companyName.trim(),
        typeof ticker === 'string' && ticker.trim() ? ticker.trim() : undefined
      );
      res.json(suggestions);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `키워드 추천 생성 중 오류가 발생했습니다: ${errorMsg}` });
    }
  });

  // 3-2. Company Create/Update (Admin only)
  app.post('/api/companies', verifyAdminAuth, async (req, res) => {
    const company = req.body;
    if (!company.id || !company.name) {
      return res.status(400).json({ error: 'Company ID and Name are required.' });
    }
    try {
      const expectedVersion = typeof company.expectedVersion === 'number'
        ? company.expectedVersion
        : (typeof company.version === 'number' ? company.version : undefined);
      await db.saveCompany(company, { incrementVersion: true, expectedVersion });
      db.addLog('System', 'info', `Company profile updated: ${company.name} (${company.id})`);
      res.json(db.getCompanies());
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes('version_conflict')) {
        return res.status(409).json({
          error: '기업 정보가 다른 사용자에 의해 변경되었습니다. 새로고침 후 다시 시도해주세요.',
        });
      }
      res.status(500).json({ error: `기업 저장 실패: ${errorMsg}` });
    }
  });

  // 3-3. Company Delete (Admin only)
  app.delete('/api/companies/:id', verifyAdminAuth, async (req, res) => {
    const id = req.params.id;
    await db.deleteCompany(id);
    db.addLog('System', 'warn', `Company profile deleted: ${id}`);
    res.json(db.getCompanies());
  });

  // 3-4. Company Keywords Rollback (Admin only + CSRF protected, zero Gemini calls)
  app.post('/api/companies/:id/rollback', verifyAdminAuth, async (req, res) => {
    const { id } = req.params;
    const { historyId, expectedVersion } = req.body || {};

    if (!historyId || typeof historyId !== 'string') {
      return res.status(400).json({ error: 'historyId is required for rollback.' });
    }

    try {
      const rollbackResult = await rollbackCompanyKeywords(
        id,
        historyId.trim(),
        typeof expectedVersion === 'number' ? expectedVersion : undefined
      );

      if (!rollbackResult.success) {
        const isConflict = rollbackResult.error?.includes('다른 사용자에 의해 변경');
        return res.status(isConflict ? 409 : 400).json({
          error: rollbackResult.error || '이전 키워드 상태 복원에 실패했습니다.',
        });
      }

      res.json({
        success: true,
        company: rollbackResult.company,
        companies: db.getCompanies(),
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `복원 처리 중 서버 오류가 발생했습니다: ${errorMsg}` });
    }
  });

  // 4. Events List (Public read, filtered)
  // 뉴스 목록: 필터 없는 기본 목록(화면이 12초마다 부름)은 미리 압축한 응답을 10초 보관 + CDN 15초 → 매번 수 MB 직렬화·압축하지 않음
  const listEvents = async (q: Record<string, unknown>) => {
    let events = (await db.getEventsForRead()).map(e => projectEventAnalysisStatus(e));
    const { company, category, minImportance, impact, query, onlyImportant, telegramSent } = q as Record<string, any>;

    if (company && company !== 'all' && typeof company === 'string') {
      const target = company.toLowerCase().trim();
      events = events.filter(e => {
        const inRelated = e.relatedCompanies?.some(c =>
          c.toLowerCase().includes(target) ||
          (target === 'googl' && c.toLowerCase().includes('google')) ||
          (target === 'tsla' && c.toLowerCase().includes('tesla')) ||
          (target === 'msft' && c.toLowerCase().includes('microsoft')) ||
          (target === 'nvda' && c.toLowerCase().includes('nvidia')) ||
          (target === 'spacex' && c.toLowerCase().includes('spacex'))
        );
        const inImpacts = e.companyImpacts?.some(ci =>
          ci.companyId.toLowerCase() === target || ci.companyName.toLowerCase().includes(target) || ci.ticker?.toLowerCase() === target
        );
        return inRelated || inImpacts;
      });
    }

    if (category && category !== 'all') {
      events = events.filter(e => e.category === category);
    }

    if (minImportance) {
      const min = Number(minImportance);
      if (!isNaN(min) && min > 0) {
        events = events.filter(e => e.importance >= min);
      }
    }

    if (impact && impact !== 'all') {
      events = events.filter(e => e.impact === impact);
    }

    if (onlyImportant === 'true') {
      events = events.filter(e => e.importance >= 4);
    }

    if (telegramSent === 'true') {
      events = events.filter(e => e.isSentToTelegram);
    } else if (telegramSent === 'false') {
      events = events.filter(e => !e.isSentToTelegram);
    }

    if (query && typeof query === 'string' && query.trim() !== '') {
      const q = query.toLowerCase().trim();
      events = events.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.originalTitle.toLowerCase().includes(q) ||
        (e.factualPoints && e.factualPoints.some(b => b.toLowerCase().includes(q))) ||
        e.summaryBulletPoints.some(b => b.toLowerCase().includes(q)) ||
        e.relatedCompanies?.some(c => c.toLowerCase().includes(q)) ||
        e.companyImpacts?.some(ci => ci.companyName.toLowerCase().includes(q) || ci.rationale.toLowerCase().includes(q)) ||
        e.relatedBusinesses.some(b => b.toLowerCase().includes(q)) ||
        e.primarySource.name.toLowerCase().includes(q)
      );
    }

    events.sort((a, b) => {
      const timeA = new Date(a.primarySource?.publishedAt || a.firstSeenAt).getTime();
      const timeB = new Date(b.primarySource?.publishedAt || b.firstSeenAt).getTime();
      const safeA = isNaN(timeA) || timeA <= 0 ? new Date(a.updatedAt || 0).getTime() || 0 : timeA;
      const safeB = isNaN(timeB) || timeB <= 0 ? new Date(b.updatedAt || 0).getTime() || 0 : timeB;
      if (safeB !== safeA) {
        return safeB - safeA;
      }
      return b.id.localeCompare(a.id);
    });

    return events;
  };
  const eventsCache = packedCache(() => listEvents({}), process.env.NODE_ENV === 'production' ? 10_000 : 0);
  app.get('/api/events', async (req, res) => {
    const keys = Object.keys(req.query);
    try {
      if (!keys.length || (keys.length === 1 && 'fresh' in req.query)) {
        const t0 = Date.now();
        // fresh=…: 관리자 작업 직후 화면 갱신용(주소가 매번 달라 CDN도 거침없이 새로 받음)
        const r = 'fresh' in req.query ? { packed: await eventsCache.fresh(), hit: false } : await eventsCache.get();
        res.setHeader('Cache-Control', 'fresh' in req.query ? 'no-store' : publicCdnHeader(15, 30));
        res.setHeader('Server-Timing', `events;desc="${r.hit ? 'hit' : 'miss'}";dur=${Date.now() - t0}`);
        return sendPacked(req, res, r.packed);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await listEvents(req.query));
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'events_unavailable' });
    }
  });

  // CEO 발언: 동일 CeoRuntime 인스턴스를 라우터와 스케줄러가 공유 (조회는 저장된 상태 읽기만, 관리자 갱신만 CEO 전용 컬렉션에 저장)
  const wallstreetRuntime = createConfiguredWallstreetRuntime({
    getFirestore: () => getIsFirestoreAvailable() ? initFirestore() : null,
  });
  // 유튜브 요약 목록(공개): 저장 상태 전체를 읽는 데 ~1초 → 서버 60초 보관 + CDN 60초(이후 5분 묵은 본 제공하며 갱신)
  const youtubeCache = packedCache(() => wallstreetRuntime.publicLibrary(), process.env.NODE_ENV === 'production' ? 60_000 : 0);
  registerWallstreetRoutes(app, { verifyAdmin: verifyAdminAuth,
    verifyJob: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (!process.env.CRON_SECRET?.trim()) return res.status(503).json({status:'job_auth_unconfigured'});
      if (!verifyCronAuth(req).authorized) return res.status(401).json({status:'unauthorized'});
      next();
    }, runtime: wallstreetRuntime,
    publicSummaries: async (req: express.Request, res: express.Response) => {
      const t0 = Date.now();
      const r = await youtubeCache.get();
      res.setHeader('Cache-Control', publicCdnHeader(60, 300));
      res.setHeader('Server-Timing', `yt;desc="${r.hit ? 'hit' : 'miss'}";dur=${Date.now() - t0}`);
      sendPacked(req, res, r.packed);
    },
    onRunFinished: () => youtubeCache.invalidate(),
  });
  const ceoRuntime = options?.ceoRuntime || createCeoRuntime(
    () => db.getEvents(),
    () => (getIsFirestoreAvailable() ? initFirestore() : null)
  );
  setSchedulerCeoRuntime(ceoRuntime);

  // Tesla 보조 자료(기사 헤드라인)용 이벤트 목록: 12시간 캐시, 실패 시 메모리의 최근 이벤트로 대신합니다.
  let headlineCache: { at: number; items: any[] } | null = null;
  const cachedEventHeadlines = async () => {
    if (headlineCache && Date.now() - headlineCache.at < 12 * 3600_000) return headlineCache.items;
    try {
      const items = await firestoreRepo.getEventHeadlines(4000);
      if (items.length) { headlineCache = { at: Date.now(), items }; return items; }
    } catch { /* fall through */ }
    return db.getEventsForRead();
  };

  // CEO 발언 영상 인용: 유튜브 요약 상태 문서에서 읽기 (10분 캐시)
  let videoCache: { at: number; items: any[] } | null = null;
  const cachedCeoVideoStatements = async () => {
    if (videoCache && Date.now() - videoCache.at < 10 * 60_000) return videoCache.items;
    const fs = getIsFirestoreAvailable() ? initFirestore() : null;
    if (!fs) return [];
    const { FirestoreWallstreetStore } = await import('./server/wallstreet/firestoreStore.mjs');
    const { ceoVideoStatements } = await import('./server/wallstreet/ceoVideo.mjs');
    const items = ceoVideoStatements(await new FirestoreWallstreetStore(fs as any).read());
    videoCache = { at: Date.now(), items };
    return items;
  };

  pollHeadlineHook = (deadline: number) => translatePendingHeadlines(getSchedulerCeoRuntime() || ceoRuntime, cachedEventHeadlines, deadline);
  // 본인 X 게시물 (X_BEARER_TOKEN 있을 때만, 월 상한 X_MONTHLY_CAP_USD 기본 5달러)
  const xStore = firestoreXStore(() => (getIsFirestoreAvailable() ? initFirestore() : null));
  const xToken = xTokenStore(() => (getIsFirestoreAvailable() ? initFirestore() : null));
  let xCache: { at: number; items: any[] } | null = null;
  const cachedXStatements = async () => {
    if (xCache && Date.now() - xCache.at < 10 * 60_000) return xCache.items;
    const items = xPostStatements(await xStore.read());
    xCache = { at: Date.now(), items };
    return items;
  };
  xPostsHook = async (deadline: number) => {
    const r: any = await collectXPosts({ token: await xToken.get(), store: xStore, now: Date.now, deadline: deadline - 20_000, capUsd: Number(process.env.X_MONTHLY_CAP_USD) || X_DEFAULT_CAP_USD });
    if (r.status === 'x_not_configured') return r;
    xCache = null;
    const statements = await cachedXStatements();
    const tr = await translatePendingXPosts(getSchedulerCeoRuntime() || ceoRuntime, statements, deadline, 2).catch(() => null);
    return { ...r, translate: tr };
  };
  pollStatusHook = async (result: any, headline: any) => {
    const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;
    const { buildStatusReport, statusHasIssue } = await import('./server/statusReport.mjs');
    let youtube: any = null;
    try {
      const fs = getIsFirestoreAvailable() ? initFirestore() : null;
      if (fs) { const { FirestoreWallstreetStore } = await import('./server/wallstreet/firestoreStore.mjs'); youtube = await new FirestoreWallstreetStore(fs as any).read(); }
    } catch { youtube = null; }
    let ko: any = null;
    try { ko = (await (getSchedulerCeoRuntime() || ceoRuntime).snapshot() as any).koSummary || null; } catch { ko = null; }
    const date = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }).format(new Date());
    const text = buildStatusReport({ date, poll: { error: result.error, articles: result.newArticlesCount, events: result.newEventsCreated?.length ?? 0, elapsed: result.elapsedSeconds, telegram: result.telegramAlertsSentCount },
      analysis: result.analysisSummary, ceoStatus: result.ceoStatus, headline, ko, youtube });
    db.addLog('Scheduler', statusHasIssue(text) ? 'warn' : 'info', `[StatusReport] ${text.replace(/<[^>]+>/g, '').replace(/\n+/g, ' | ').slice(0, 600)}`);
    if (!statusHasIssue(text)) return; // 이상 없을 때는 텔레그램을 보내지 않음(로그에만 남김)
    const { sendTelegramMessage } = await import('./server/telegram');
    await sendTelegramMessage(token, chatId, text);
  };

  // 운영 점검용 공개 요약: 숫자/상태만(비밀값·IP·로그 원문 없음). Firestore 읽기를 줄이려고 10분 캐시.
  let opsHealthCache: { at: number; body: any } | null = null;
  app.get('/api/ops/health', async (_req, res) => {
    try {
      if (!opsHealthCache || Date.now() - opsHealthCache.at > 10 * 60_000) {
        const { buildOpsHealth } = await import('./server/opsHealth.mjs');
        const { wallstreetConfig } = await import('./server/wallstreet/config.mjs');
        let logs: any[] = [];
        try { logs = await firestoreRepo.getLogs(200); } catch { logs = []; }
        if (!logs.length) logs = db.getLogs(200);
        let youtube: any = null;
        try {
          const fs = getIsFirestoreAvailable() ? initFirestore() : null;
          if (fs) { const { FirestoreWallstreetStore } = await import('./server/wallstreet/firestoreStore.mjs'); youtube = await new FirestoreWallstreetStore(fs as any).read(); }
        } catch { youtube = null; }
        let ko: any = null;
        try { ko = (await (getSchedulerCeoRuntime() || ceoRuntime).snapshot() as any).koSummary || null; } catch { ko = null; }
        const lastPollTime = db.getSettings().lastPollTime || null;
        // 콜드 스타트 중(설정 미적재)에는 캐시하지 않아 10분간 잘못된 '미실행' 경고가 고정되지 않게 합니다.
        opsHealthCache = { at: lastPollTime ? Date.now() : 0, body: buildOpsHealth({ lastPollTime, logs, youtube, ko, config: wallstreetConfig }) };
      }
      res.set('Cache-Control', 'no-store').json(opsHealthCache.body);
    } catch {
      res.status(500).json({ ok: false, error: 'ops_health_failed' });
    }
  });

  app.use(createCeoRouter({
    runtime: ceoRuntime,
    getRuntime: () => getSchedulerCeoRuntime() || ceoRuntime,
    verifyAdmin: verifyAdminAuth,
    getReportedEvents: cachedEventHeadlines,
    getVideoStatements: cachedCeoVideoStatements,
    getXStatements: cachedXStatements,
  }));

  // X 연동 관리(관리자): 토큰은 넣기·지우기만, 값은 절대 돌려주지 않음
  app.get('/api/admin/x', verifyAdminAuth, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const st = await xStore.read();
      const month = new Date().toISOString().slice(0, 7);
      res.json({ configured: !!(await xToken.get()), fromEnv: !!process.env.X_BEARER_TOKEN, monthUsd: st.months[month]?.usd || 0,
        capUsd: Number(process.env.X_MONTHLY_CAP_USD) || X_DEFAULT_CAP_USD, posts: Object.keys(st.posts).length, lastRun: st.lastRun || null });
    } catch { res.status(500).json({ error: 'x_status_failed' }); }
  });
  app.post('/api/admin/x/token', verifyAdminAuth, async (req, res) => {
    const t = req.body?.token;
    if (t !== null && !validXToken(t)) return res.status(400).json({ error: '토큰 형식이 올바르지 않습니다 (X 개발자 화면의 Bearer Token 전체를 넣어주세요)' });
    try { await xToken.set(t === null ? null : String(t).trim()); db.addLog('System', 'info', t === null ? 'X token removed by admin' : 'X token updated by admin'); res.json({ ok: true, configured: t !== null }); }
    catch { res.status(500).json({ error: '저장 실패' }); }
  });
  app.post('/api/admin/x/run', verifyAdminAuth, async (_req, res) => {
    try { const r = xPostsHook ? await xPostsHook(Date.now() + 60_000) : { status: 'no_hook' }; res.json(r); }
    catch { res.status(500).json({ error: 'x_run_failed' }); }
  });

  // 5. Single Event Detail (Public read)
  app.get('/api/events/:id', (req, res) => {
    const rawEvent = db.getEventById(req.params.id);
    if (!rawEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = projectEventAnalysisStatus(rawEvent);
    res.json(event);
  });

  // 6. Manual Poll Trigger (Admin only + Rate Limited)
  app.post('/api/poll', verifyAdminAuth, manualPollRateLimitMiddleware, async (req, res) => {
    try {
      const result = await runMonitoringCycle(true);
      res.json({
        success: true,
        message: '다중 기업 및 공식 출처(NASA, FAA, SEC, IR) 실시간 수집과 Gemini 분석이 완료되었습니다.',
        ...result,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ success: false, error: errorMsg });
    }
  });

  // 7. Re-analyze Event with Gemini (Admin only + Rate Limited)
  app.post('/api/events/:id/reanalyze', verifyAdminAuth, aiRateLimitMiddleware, async (req, res) => {
    const event = db.getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    try {
      const dummyRaw = {
        id: event.id,
        title: event.originalTitle || event.title,
        link: event.primarySource.url,
        source: event.primarySource.name,
        publishedAt: event.primarySource.publishedAt,
        snippet: (event.factualPoints || event.summaryBulletPoints || []).join(' ') || event.whyItMatters,
        firstSeenAt: event.firstSeenAt,
        sourceType: event.primarySource.sourceType,
      };

      const reanalyzed = await analyzeArticleWithGemini(dummyRaw);
      reanalyzed.id = event.id;
      reanalyzed.firstSeenAt = event.firstSeenAt;
      reanalyzed.relatedSources = event.relatedSources;
      reanalyzed.articleCount = event.articleCount;
      reanalyzed.sourceTier = event.sourceTier || reanalyzed.sourceTier;
      reanalyzed.sourceReliability = event.sourceReliability || reanalyzed.sourceReliability;
      reanalyzed.corroboratedSourceCount = event.corroboratedSourceCount || reanalyzed.corroboratedSourceCount;
      reanalyzed.hasTrustedSource = event.hasTrustedSource || reanalyzed.hasTrustedSource;
      reanalyzed.detectedOriginalSource = event.detectedOriginalSource || reanalyzed.detectedOriginalSource;
      reanalyzed.sourceDomains = event.sourceDomains || reanalyzed.sourceDomains;
      reanalyzed.isSentToTelegram = event.isSentToTelegram;
      reanalyzed.sentAt = event.sentAt;
      reanalyzed.telegramSentAt = event.telegramSentAt;
      reanalyzed.telegramMessageId = event.telegramMessageId;
      reanalyzed.analysisRetryCount = 0;

      await db.saveEvent(reanalyzed);
      db.addLog('Gemini', 'success', `Manually re-analyzed event [${reanalyzed.category}] [${reanalyzed.contentType || 'new_fact'}] "${reanalyzed.title.slice(0, 30)}..." (${reanalyzed.importance}★)`);
      res.json(reanalyzed);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: errorMsg });
    }
  });

  // 8. Send/Resend Event to Telegram (Admin only + Rate Limited)
  app.post('/api/events/:id/send-telegram', verifyAdminAuth, telegramRateLimitMiddleware, async (req, res) => {
    const event = db.getEventById(req.params.id);
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const result = await sendEventToTelegram(event, true);
    if (result.success) {
      res.json({ success: true, message: 'Telegram 알림이 성공적으로 전송되었습니다.' });
    } else {
      res.status(400).json({ success: false, error: result.error || 'Failed to send alert to Telegram' });
    }
  });

  // 9. Settings GET & POST (Strictly Admin Auth Required)
  app.get('/api/settings', verifyAdminAuth, (req, res) => {
    res.json(db.getSettings());
  });

  app.post('/api/settings', verifyAdminAuth, async (req, res) => {
    const updated = await db.updateSettings(req.body);
    if (req.body.pollIntervalMinutes && typeof req.body.pollIntervalMinutes === 'number') {
      restartSchedulerWithNewInterval(req.body.pollIntervalMinutes);
    }
    db.addLog('System', 'info', 'Settings updated by admin.');
    res.json(updated);
  });

  // 10-1. Telegram Webhook Endpoint (Bot Commands: /start, /stop, /status, /help)
  // Strictly verifies TELEGRAM_WEBHOOK_SECRET before any processing (Fail-Closed).
  // Includes timing-safe equality, payload size validation, integer chat.id/update_id validation, and update_id replay defense.
  app.post('/api/telegram/webhook', async (req, res) => {
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    // Fail-Closed: TELEGRAM_WEBHOOK_SECRET must be configured
    if (!expectedSecret || expectedSecret.trim() === '') {
      db.addLog('Telegram', 'warn', `Telegram Webhook rejected: TELEGRAM_WEBHOOK_SECRET is not configured on the server.`);
      return res.status(403).json({ error: 'Forbidden: TELEGRAM_WEBHOOK_SECRET is not configured' });
    }

    if (!verifyTelegramWebhookSecret(req, expectedSecret)) {
      db.addLog('Telegram', 'warn', `Unauthorized Telegram Webhook attempt from IP ${req.ip}`);
      return res.status(403).json({ error: 'Forbidden: Invalid X-Telegram-Bot-Api-Secret-Token' });
    }

    const validation = validateTelegramUpdate(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error || 'Bad Request: Invalid update payload' });
    }

    const updateId = validation.updateId;
    if (updateId === undefined) {
      return res.status(200).json({ ok: true });
    }

    // Replay Attack Defense: check if already successfully processed
    if (telegramReplayTracker.isReplay(updateId)) {
      return res.status(200).json({ ok: true, skipped: 'duplicate_update_id' });
    }

    if (!validation.chatId || !validation.text) {
      // Non-text message or empty update: mark processed and return 200
      telegramReplayTracker.recordSuccess(updateId);
      return res.status(200).json({ ok: true });
    }

    try {
      await handleTelegramCommand(validation.chatId, validation.text, validation.from);
      // ONLY record update_id as processed on successful execution
      telegramReplayTracker.recordSuccess(updateId);
      return res.status(200).json({ ok: true });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('❌ [Telegram Webhook] Error processing command:', errorMsg);
      db.addLog('Telegram', 'error', `Error processing Telegram webhook update: ${errorMsg}`);
      // Respond with 500 so Telegram will retry; failed updateId is NOT cached as completed
      return res.status(500).json({ ok: false, error: errorMsg });
    }
  });

  // Catch-all for undefined API routes so they return JSON, never HTML
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
  });

  return app;
}

async function startServer() {
  const app = createServerApp();
  const PORT = Number(process.env.PORT) || 3000;

  // ==========================================
  // Vite Integration (Dev vs Prod)
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite'); // 개발 전용(운영 이미지에는 vite 없음)
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    serveBuiltApp(app, path.join(process.cwd(), 'dist'));
  }

  // Start background monitoring scheduler (fallback interval)
  if (process.env.KNEWS_CANDIDATE_MODE !== 'true') startScheduler();

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Investment Intelligence Monitor server running on http://0.0.0.0:${PORT}`);
  });

  return { app, server };
}

export {
  startServer,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_BELOW_MS,
  sessionExpiry,
  generateSessionToken,
  verifySessionToken,
  checkAdminAuth,
  isValidCsrfOrigin,
  getCookieOptions,
  verifyCronAuth,
  verifyTelegramWebhookSecret,
  validateTelegramUpdate,
  TelegramReplayTracker,
  loginRateLimiter,
  aiRateLimiter,
  manualPollRateLimiter,
  telegramRateLimiter,
  telegramReplayTracker,
};

const isMain = typeof process !== 'undefined' && process.argv[1] && (
  process.argv[1].endsWith('server.ts') || 
  process.argv[1].endsWith('server.cjs') || 
  process.argv[1].endsWith('server.js')
);

if (isMain && process.env.NODE_ENV !== 'test') {
  startServer();
}
