import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.ADMIN_SECRET = 'synthetic-session-test-secret';
process.env.ALLOWED_ORIGINS = '';
delete process.env.ALLOW_PREVIEW_IFRAME_COOKIES;
const { createServerApp } = await import('../server');
const { db } = await import('./db');
const { checkAdminAuth, getCookieOptions, isValidCsrfOrigin } = await import('./security');
// No persistent data, provider, model or notification writes in this suite.
db.addLog = (() => undefined) as typeof db.addLog;
// Native HTTP preserves an explicit Host header for reverse-proxy simulation.
function localRequest(url: string, options: { method?: string; headers?: Record<string,string>; body?: string } = {}) {
  return new Promise<{status:number;headers:{getSetCookie():string[]};json():Promise<any>}>((resolve,reject) => {
    const req=http.request(url,options,res => {
      let body=''; res.setEncoding('utf8'); res.on('data',chunk=>body+=chunk);
      res.on('end',()=>resolve({status:res.statusCode!,headers:{getSetCookie:()=>res.headers['set-cookie']||[]},json:async()=>JSON.parse(body)}));
    });
    req.on('error',reject);req.end(options.body);
  });
}

test('Firebase-compatible session uses existing security policy on both hosts', async () => {
  const server = http.createServer(createServerApp({ isTest: true }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const host of ['news.dsoom.com', 'spacex-intelligence-news-monitor-5he2zcaska-el.a.run.app']) {
      const headers = { host, origin: `https://${host}`, 'x-forwarded-proto': 'https', 'content-type': 'application/json' };
      const login = await localRequest(base + '/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ password: process.env.ADMIN_SECRET }) });
      assert.equal(login.status, 200);
      const cookies = login.headers.getSetCookie();
      const session = cookies.find(x => x.startsWith('__session='))!;
      assert.ok(session);
      for (const attr of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']) assert.ok(session.includes(attr), attr);
      assert.ok(!/Domain=/i.test(session));
      assert.ok(cookies.some(x => x.startsWith('admin_session=;') && /Expires=/i.test(x)));
      const cookie = session.split(';')[0];
      const status = await localRequest(base + '/api/auth/status', { headers: { ...headers, cookie } });
      assert.equal((await status.json()).isAuthenticated, true);
      const legacy = await localRequest(base + '/api/auth/status', { headers: { ...headers, cookie: cookie.replace('__session=', 'admin_session=') } });
      assert.equal((await legacy.json()).isAuthenticated, false);
      const forged = cookie.slice(0,-1) + (cookie.endsWith('0') ? '1' : '0');
      const tampered = await localRequest(base + '/api/auth/status', { headers: { ...headers, cookie: forged } });
      assert.equal((await tampered.json()).isAuthenticated, false);
      const foreign = await localRequest(base + '/api/auth/logout', { method: 'POST', headers: { ...headers, cookie, origin: 'https://untrusted.example' } });
      assert.equal(foreign.status, 403);
      const logout = await localRequest(base + '/api/auth/logout', { method: 'POST', headers: { ...headers, cookie } });
      assert.equal(logout.status, 200);
      for (const name of ['__session', 'admin_session']) assert.ok(logout.headers.getSetCookie().some(x => x.startsWith(name + '=;') && /Expires=/i.test(x)));
      const anonymous = await localRequest(base + '/api/settings', { headers });
      assert.equal(anonymous.status, 401);
    }
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test('expiry, missing origin, exact origin and preview policy remain strict', () => {
  const payload = `${Date.now() - 1000}.synthetic-nonce`;
  const signature = crypto.createHmac('sha256', process.env.ADMIN_SECRET!).update(payload).digest('hex');
  assert.equal(checkAdminAuth({ headers: {}, cookies: { __session: `${payload}.${signature}` } }).authenticated, false);
  assert.equal(isValidCsrfOrigin({ headers: { host: 'news.dsoom.com', 'x-forwarded-proto': 'https' } }), false);
  assert.equal(isValidCsrfOrigin({ headers: { host: 'news.dsoom.com', origin: 'https://news.dsoom.com.evil.example', 'x-forwarded-proto': 'https' } }), false);
  assert.equal(isValidCsrfOrigin({ headers: { host: 'news.dsoom.com', origin: 'https://news.dsoom.com', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(getCookieOptions({ headers: { origin: 'https://news.dsoom.com', 'x-forwarded-proto': 'https' } }).sameSite, 'lax');
  const preview = getCookieOptions({ headers: { origin: 'https://aistudio.google.com', 'x-forwarded-proto': 'https' } });
  assert.equal(preview.sameSite, 'none'); assert.equal(preview.secure, true); assert.equal(preview.httpOnly, true);
});
