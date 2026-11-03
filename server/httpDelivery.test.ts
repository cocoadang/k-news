import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { brotliDecompressSync, gunzipSync, brotliCompressSync } from 'node:zlib';
import express from 'express';
import { jsonCompression, pickEncoding, serveBuiltApp } from './httpDelivery';

function raw(port: number, p: string, enc?: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: enc ? { 'accept-encoding': enc } : {} }, res => {
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
