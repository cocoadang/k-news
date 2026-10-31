import crypto from 'crypto';
import express from 'express';

export const SESSION_COOKIE_NAME = '__session';
export const LEGACY_SESSION_COOKIE_NAME = 'admin_session';
// 30일. 관리자가 사이트를 열 때마다(/api/auth/status) 새 30일로 연장되므로, 30일 넘게 접속하지 않을 때만 다시 로그인
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** 남은 기간이 이보다 짧으면 새 토큰으로 연장 */
export const SESSION_RENEW_BELOW_MS = 29 * 24 * 60 * 60 * 1000;
export function sessionExpiry(token: string): number | null { const n = parseInt(String(token || '').split('.')[0], 10); return Number.isFinite(n) ? n : null; }

// ==========================================
// Session Token (HMAC-SHA256) Generation & Verification
// ==========================================
export function generateSessionToken(secret: string): string {
  const expiry = Date.now() + SESSION_MAX_AGE_MS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = `${expiry}.${nonce}`;
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string, secret: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [expiryStr, nonce, receivedSig] = parts;
  const expiry = parseInt(expiryStr, 10);
  if (isNaN(expiry) || Date.now() > expiry) return false;

  const payload = `${expiryStr}.${nonce}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  try {
    const receivedBuf = Buffer.from(receivedSig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (receivedBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(receivedBuf, expectedBuf);
  } catch {
    return false;
  }
}

// ==========================================
// In-Memory Rate Limiter with Automatic Cleanup
// ==========================================
export class SlidingRateLimiter {
  private windowMs: number;
  private maxAttempts: number;
  private requests = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(windowMs: number, maxAttempts: number) {
    this.windowMs = windowMs;
    this.maxAttempts = maxAttempts;

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.requests.entries()) {
        if (now >= data.resetAt) {
          this.requests.delete(key);
        }
      }
    }, Math.max(30000, Math.floor(windowMs / 2)));
    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  public check(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    const existing = this.requests.get(key);
    if (!existing || now >= existing.resetAt) {
      this.requests.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.maxAttempts - 1, retryAfterMs: 0 };
    }
    if (existing.count >= this.maxAttempts) {
      return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
    }
    existing.count++;
    return { allowed: true, remaining: this.maxAttempts - existing.count, retryAfterMs: 0 };
  }

  public reset(key: string) {
    this.requests.delete(key);
  }

  public stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// ==========================================
// Admin Authentication Checker
// ==========================================
export interface AdminAuthResult {
  authenticated: boolean;
  authMethod?: 'cookie' | 'token';
}

export type RequestLike = {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, any>;
  get?(header: string): string | undefined;
  protocol?: string;
  secure?: boolean;
};

export function checkAdminAuth(req: RequestLike, overrideSecret?: string): AdminAuthResult {
  const adminSecret = overrideSecret !== undefined ? overrideSecret : process.env.ADMIN_SECRET;
  if (!adminSecret || adminSecret.trim() === '') {
    // Fail-Closed: unconfigured secret means NO admin auth
    return { authenticated: false };
  }
  const trimmedSecret = adminSecret.trim();
  const secretBuf = Buffer.from(trimmedSecret);

  // Method 1: HttpOnly Session Cookie
  const sessionCookie = req.cookies?.[SESSION_COOKIE_NAME];
  if (sessionCookie && typeof sessionCookie === 'string' && verifySessionToken(sessionCookie, trimmedSecret)) {
    return { authenticated: true, authMethod: 'cookie' };
  }

  // Method 2: Explicit Authorization Bearer header or X-Admin-Secret header
  const authHeader = (req.headers['authorization'] as string) || (req.get ? req.get('authorization') : '') || '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const customHeader = (((req.headers['x-admin-secret'] as string) || (req.get ? req.get('x-admin-secret') : '')) || '').trim();

  const incomingToken = bearer || customHeader;
  if (incomingToken && incomingToken.length === secretBuf.length) {
    try {
      if (crypto.timingSafeEqual(Buffer.from(incomingToken), secretBuf)) {
        return { authenticated: true, authMethod: 'token' };
      }
    } catch {
      // timingSafeEqual failure handled
    }
  }

  return { authenticated: false };
}

// ==========================================
// Strict CSRF Origin Validation
// ==========================================
export interface CsrfOriginOptions {
  allowedOriginsEnv?: string;
  serverPort?: number;
}

/**
 * Validates request Origin/Referer against the server's expected origin and configured whitelist.
 * Requirements:
 * - Scheme, host, and port must match EXACTLY via URL.origin.
 * - Missing Origin/Referer on mutating requests (and cookie changes) fails closed (no bypass via sec-fetch-site:none).
 * - ALLOWED_ORIGINS must contain full http(s) origins (no host-only or substring matching).
 * - Non-production localhost only allows the exact matching server/dev port.
 */
export function isValidCsrfOrigin(req: RequestLike, options?: CsrfOriginOptions): boolean {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const rawOrigin = (req.headers['origin'] || req.headers['referer'] || (req.get ? req.get('origin') || req.get('referer') : '')) as string;
  if (!rawOrigin || typeof rawOrigin !== 'string' || !rawOrigin.trim()) {
    // Fail-closed for mutating/cookie requests when origin cannot be determined
    return false;
  }

  let parsedIncoming: URL;
  try {
    parsedIncoming = new URL(rawOrigin.trim());
  } catch {
    return false;
  }

  // Only http and https protocols are permitted
  if (parsedIncoming.protocol !== 'http:' && parsedIncoming.protocol !== 'https:') {
    return false;
  }

  const incomingOrigin = parsedIncoming.origin.toLowerCase();

  // 1. Calculate current expected origin considering reverse proxy and HTTPS Cloud Run
  const rawProto = (req.headers['x-forwarded-proto'] || (typeof req.get === 'function' ? req.get('x-forwarded-proto') : undefined) || (req.secure ? 'https' : req.protocol) || 'http') as string;
  const proto = String(rawProto).split(',')[0].trim().toLowerCase();

  const rawHost = ((typeof req.get === 'function' ? req.get('host') : undefined) || req.headers['host'] || '') as string;
  const host = String(rawHost).split(',')[0].trim().toLowerCase();

  if (host) {
    const expectedOrigin = `${proto}://${host}`.toLowerCase();
    if (incomingOrigin === expectedOrigin) {
      return true;
    }
  }

  // 2. Configured ALLOWED_ORIGINS whitelist (exact URL.origin matching)
  const allowedOriginsEnv = options?.allowedOriginsEnv !== undefined ? options.allowedOriginsEnv : (process.env.ALLOWED_ORIGINS || '');
  if (allowedOriginsEnv.trim()) {
    const rawTokens = allowedOriginsEnv.split(',').map(s => s.trim()).filter(Boolean);
    for (const token of rawTokens) {
      try {
        const allowedUrl = new URL(token);
        if ((allowedUrl.protocol === 'http:' || allowedUrl.protocol === 'https:') && allowedUrl.origin.toLowerCase() === incomingOrigin) {
          return true;
        }
      } catch {
        // invalid URL token ignored
      }
    }
  }

  // 3. Localhost in non-production: strictly allow exact server port or vite default port (5173)
  if (process.env.NODE_ENV !== 'production') {
    const port = options?.serverPort || Number(process.env.PORT) || 3000;
    const allowedLocalOrigins = new Set([
      `http://localhost:${port}`.toLowerCase(),
      `http://127.0.0.1:${port}`.toLowerCase(),
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
    if (allowedLocalOrigins.has(incomingOrigin)) {
      return true;
    }
  }

  return false;
}

// ==========================================
// Cookie Options Helper
// Default sameSite: 'lax' for robust CSRF defense.
// 'none' is only used if explicitly verified preview context over HTTPS.
// ==========================================
export function getCookieOptions(req: RequestLike): express.CookieOptions {
  const isHttps = Boolean(
    req.secure || 
    (req.headers['x-forwarded-proto'] && String(req.headers['x-forwarded-proto']).toLowerCase().includes('https')) ||
    process.env.NODE_ENV === 'production'
  );

  // Check if this is an explicitly verified cross-origin preview context (e.g. AI Studio iframe)
  const originHeader = ((req.headers['origin'] || req.headers['referer'] || (req.get ? req.get('origin') : '')) as string || '').toLowerCase();
  let verifiedPreviewOrigin = false;
  try {
    const previewUrl = new URL(originHeader);
    const hostname = previewUrl.hostname.toLowerCase();
    verifiedPreviewOrigin = previewUrl.protocol === 'https:' && (hostname === 'aistudio.google.com' || hostname.endsWith('.aistudio.google.com') || hostname.endsWith('.usercontent.goog'));
  } catch { /* invalid origin is not a preview */ }
  const isExplicitPreview = process.env.ALLOW_PREVIEW_IFRAME_COOKIES === 'true' || verifiedPreviewOrigin;

  const useNone = isExplicitPreview && isHttps;

  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: useNone ? 'none' : 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    path: '/',
  };
}

// ==========================================
// Cron Authentication (timing-safe, headers only)
// ==========================================
export function verifyCronAuth(req: RequestLike, expectedSecretOverride?: string): { authorized: boolean; reason?: string } {
  const expected = expectedSecretOverride !== undefined ? expectedSecretOverride : process.env.CRON_SECRET;
  if (!expected || !expected.trim()) {
    return { authorized: false, reason: 'CRON_SECRET is not configured on the server (503 fail-closed)' };
  }

  const trimmed = expected.trim();
  const secretBuf = Buffer.from(trimmed);

  const authHeader = (req.headers['authorization'] as string) || (req.get ? req.get('authorization') : '') || '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  const customHeader = (((req.headers['x-cron-secret'] as string) || (req.get ? req.get('x-cron-secret') : '')) || '').trim();

  const incoming = bearer || customHeader;
  if (!incoming || incoming.length !== secretBuf.length) {
    return { authorized: false, reason: 'Invalid or missing cron credentials' };
  }

  try {
    const isMatch = crypto.timingSafeEqual(Buffer.from(incoming), secretBuf);
    return { authorized: isMatch, reason: isMatch ? undefined : 'Secret mismatch' };
  } catch {
    return { authorized: false, reason: 'Comparison error' };
  }
}

// ==========================================
// Telegram Webhook Secret Verification
// ==========================================
export function verifyTelegramWebhookSecret(req: RequestLike, expectedSecretOverride?: string): boolean {
  const expected = expectedSecretOverride !== undefined ? expectedSecretOverride : process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || !expected.trim()) {
    return false;
  }

  const trimmed = expected.trim();
  const secretBuf = Buffer.from(trimmed);
  const incoming = (((req.headers['x-telegram-bot-api-secret-token'] as string) || (req.get ? req.get('x-telegram-bot-api-secret-token') : '')) || '').trim();

  if (!incoming || incoming.length !== secretBuf.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(incoming), secretBuf);
  } catch {
    return false;
  }
}

// ==========================================
// Telegram Webhook Payload & Chat ID Validation
// ==========================================
export interface ValidatedTelegramUpdate {
  valid: boolean;
  error?: string;
  updateId?: number;
  chatId?: string;
  text?: string;
  from?: { username?: string; first_name?: string };
}

export function validateTelegramUpdate(body: any): ValidatedTelegramUpdate {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Bad Request: Invalid update payload structure' };
  }

  const updateId = body.update_id;
  if (typeof updateId !== 'number' || !Number.isSafeInteger(updateId) || updateId < 0) {
    return { valid: false, error: 'Bad Request: update_id must be a non-negative safe integer' };
  }

  const message = body.message || body.edited_message;
  if (!message || typeof message !== 'object') {
    return { valid: true, updateId }; // Non-message updates (e.g. status) are valid but ignored
  }

  if (!message.chat || typeof message.chat !== 'object') {
    return { valid: false, error: 'Bad Request: message missing chat object' };
  }

  const rawChatId = message.chat.id;
  if (typeof rawChatId !== 'number' || !Number.isSafeInteger(rawChatId)) {
    return { valid: false, error: 'Bad Request: chat.id must be a safe integer number' };
  }

  const rawText = typeof message.text === 'string' ? message.text : '';
  const text = rawText.length > 4096 ? rawText.slice(0, 4096) : rawText;

  const from = message.from && typeof message.from === 'object' ? {
    username: typeof message.from.username === 'string' ? message.from.username.slice(0, 64) : undefined,
    first_name: typeof message.from.first_name === 'string' ? message.from.first_name.slice(0, 64) : undefined,
  } : undefined;

  return {
    valid: true,
    updateId,
    chatId: String(rawChatId),
    text,
    from,
  };
}

// ==========================================
// Telegram Webhook Replay Tracker
// Only records update_id upon SUCCESSFUL execution.
// Failed updates can be retried without being poisoned.
// ==========================================
export class TelegramReplayTracker {
  private recentUpdateIds = new Set<number>();
  private updateIdQueue: number[] = [];
  private readonly maxQueueSize: number;

  constructor(maxSize = 5000) {
    this.maxQueueSize = maxSize;
  }

  public isReplay(updateId: number): boolean {
    return this.recentUpdateIds.has(updateId);
  }

  public recordSuccess(updateId: number): void {
    if (this.recentUpdateIds.has(updateId)) return;
    this.recentUpdateIds.add(updateId);
    this.updateIdQueue.push(updateId);
    if (this.updateIdQueue.length > this.maxQueueSize) {
      const evicted = this.updateIdQueue.shift();
      if (evicted !== undefined) {
        this.recentUpdateIds.delete(evicted);
      }
    }
  }

  public clear(): void {
    this.recentUpdateIds.clear();
    this.updateIdQueue = [];
  }

  public size(): number {
    return this.recentUpdateIds.size;
  }
}
