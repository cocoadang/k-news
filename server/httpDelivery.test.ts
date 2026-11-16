import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { brotliDecompressSync, gunzipSync, brotliCompressSync } from 'node:zlib';
import express from 'express';
import { jsonCompression, packedCache, pickEncoding, publicCdnHeader, sendPacked, serveBuiltApp } from './httpDelivery';

function raw(port: number, p: string, enc?: string, etag?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { ...(enc ? { 'accept-encoding': enc } : {}), ...(etag ? { 'if-none-match': etag } : {}) } }, res => {
      const chunks: Buffer[] = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('pickEncoding prefers br, honours q=0', () => {
  assert.equal(pickEncoding('gzip, deflate, br'), 'br');
  assert.equal(pickEncoding('gzip'), 'gzip');
  assert.equal(pickEncoding('br;q=0, gzip'), 'gzip');
  assert.equal(pickEncoding(''), null);
  assert.equal(pickEncoding(undefined), null);
});

test('large JSON is compressed when accepted; small JSON and no-accept are untouched; status kept', async () => {
  const app = express(); app.use(jsonCompression());
  const big = Array.from({ length: 500 }, (_, i) => ({ id: i, title: '테스트 제목 ' + i }));
  app.get('/big', (_q, r) => r.json(big));
  app.get('/small', (_q, r) => r.json({ ok: true }));
  app.get('/err', (_q, r) => r.status(503).json({ error: 'x'.repeat(5000) }));
  const srv = app.listen(0); const port = (srv.address() as any).port;
  try {
    const br = await raw(port, '/big', 'gzip, br');
    assert.equal(br.headers['content-encoding'], 'br');
    assert.match(String(br.headers.vary), /Accept-Encoding/i);
    assert.deepEqual(JSON.parse(brotliDecompressSync(br.body).toString()), big);
    const gz = await raw(port, '/big', 'gzip');
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.deepEqual(JSON.parse(gunzipSync(gz.body).toString()), big);
    const plain = await raw(port, '/big');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.deepEqual(JSON.parse(plain.body.toString()), big);
    const small = await raw(port, '/small', 'br');
    assert.equal(small.headers['content-encoding'], undefined);
    const err = await raw(port, '/err', 'br');
    assert.equal(err.status, 503); assert.equal(err.headers['content-encoding'], 'br');
  } finally { srv.close(); }
});

test('built app: precompressed hashed assets with long cache, index.html no-cache, SPA fallback', async () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'knews-dist-'));
  fs.mkdirSync(path.join(dist, 'assets'));
  const js = 'console.log("hello");'.repeat(200);
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc.js'), js);
  fs.writeFileSync(path.join(dist, 'assets', 'index-abc.js.br'), brotliCompressSync(js));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
  const app = express(); serveBuiltApp(app, dist);
  const srv = app.listen(0); const port = (srv.address() as any).port;
  try {
    const a = await raw(port, '/assets/index-abc.js', 'br, gzip');
    assert.equal(a.headers['content-encoding'], 'br');
    assert.match(String(a.headers['cache-control']), /immutable/);
    assert.match(String(a.headers['content-type']), /javascript/);
    assert.equal(brotliDecompressSync(a.body).toString(), js);
    const g = await raw(port, '/assets/index-abc.js', 'gzip'); // .gz missing → plain file, still cached
    assert.equal(g.headers['content-encoding'], undefined);
    assert.equal(g.body.toString(), js);
    assert.match(String(g.headers['cache-control']), /max-age=31536000/);
    const t = await raw(port, '/assets/..%2Findex.html', 'br');
    assert.notEqual(t.headers['content-encoding'], 'br');
    const i = await raw(port, '/some/page');
    assert.equal(i.status, 200); assert.match(i.body.toString(), /doctype/);
    assert.equal(i.headers['cache-control'], 'no-cache');
  } finally { srv.close(); fs.rmSync(dist, { recursive: true, force: true }); }
});

test('packedCache: hit within ttl without background reads, single-flight, fresh after admin action', async () => {
  let t = 0, builds = 0;
  const c = packedCache(async () => { builds++; await new Promise(r => setTimeout(r, 5)); return { n: builds }; }, 10_000, () => t);
  const [a, b] = await Promise.all([c.get(), c.get()]);
  assert.equal(builds, 1); assert.equal(a.hit, false); assert.equal(b.hit, false);
  t = 3000; assert.equal((await c.get()).hit, true); assert.equal(builds, 1);
  t = 6000; const stale = await c.get(); assert.equal(stale.hit, true); assert.deepEqual(JSON.parse(stale.packed.json.toString()), { n: 1 });
  await new Promise(r => setTimeout(r, 20)); assert.equal(builds, 1, 'no reads outside the request');
  t=10001; await c.get(); assert.equal(builds,2,'expired cache rebuilt in request');
  const f = await c.fresh(); assert.deepEqual(JSON.parse(f.json.toString()), { n: 3 });
  const none = packedCache(async () => ({ x: ++builds }), 0);
  await none.get(); await none.get(); assert.equal(builds, 5, 'ttl 0 never caches');
  assert.equal(publicCdnHeader(15, 30), 'public, max-age=0, s-maxage=15, stale-while-revalidate=30');
});

test('sendPacked serves the precompressed body for br, gzip and identity', async () => {
  const app = express();
  const c = packedCache(async () => Array.from({ length: 300 }, (_, i) => ({ id: i, t: '뉴스 ' + i })), 60_000);
  app.get('/x', async (req, res) => sendPacked(req, res, (await c.get()).packed));
  const srv = app.listen(0); const port = (srv.address() as any).port;
  try {
    const br = await raw(port, '/x', 'br');
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(JSON.parse(brotliDecompressSync(br.body).toString()).length, 300);
    const gz = await raw(port, '/x', 'gzip');
    assert.equal(JSON.parse(gunzipSync(gz.body).toString())[5].t, '뉴스 5');
    const plain = await raw(port, '/x');
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(JSON.parse(plain.body.toString()).length, 300);
  } finally { srv.close(); }
});

test('unchanged packed JSON returns bodyless 304; changed data and admin fresh return complete bodies', async () => {
  const app = express(); let version = 1;
  const c = packedCache(async () => ({ version, text: '뉴스'.repeat(300) }), 0);
  app.get('/x', async (req, res) => {
    res.setHeader('Cache-Control', req.query.fresh ? 'no-store' : publicCdnHeader(15, 30));
    sendPacked(req, res, (await c.get()).packed);
  });
  const srv = app.listen(0), port = (srv.address() as any).port;
  try {
    const first = await raw(port, '/x', 'br');
    const etag = String(first.headers.etag);
    assert.match(etag, /^W\/"/);
    for (const encoding of ['br', 'gzip', undefined]) {
      const same = await raw(port, '/x', encoding, etag);
      assert.equal(same.status, 304); assert.equal(same.body.length, 0);
      assert.equal(same.headers.etag, etag);
      assert.match(String(same.headers.vary), /Accept-Encoding/);
    }
    const fresh = await raw(port, '/x?fresh=1', 'br', etag);
    assert.equal(fresh.status, 200); assert.equal(fresh.headers['cache-control'], 'no-store');
    assert.equal(JSON.parse(brotliDecompressSync(fresh.body).toString()).version, 1);
    version = 2;
    const changed = await raw(port, '/x', undefined, etag);
    assert.equal(changed.status, 200); assert.notEqual(changed.headers.etag, etag);
    assert.equal(JSON.parse(changed.body.toString()).version, 2);
  } finally { srv.close(); }
});

test('cache reads do not rebuild at half TTL; expiry coalesces refresh', async()=>{
 let time=0,calls=0;const c=packedCache(async()=>({version:++calls}),100,()=>time);
 await c.get();time=70;await c.get();await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 time=101;await Promise.all([c.get(),c.get(),c.get()]);assert.equal(calls,2);
});
