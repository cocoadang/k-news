import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCeoRouter } from './routes';

test('public CEO dataset is cached (one assembly for repeated views) and invalidated by admin refresh', async () => {
  let snaps = 0, koReads = 0;
  const runtime: any = {
    snapshot: async () => { snaps++; return { status: 'ready', refreshedAt: 'x', sources: [], dataset: { statements: [{ statementId: 's1', quoteText: 'a' }] } }; },
    koResults: async () => { koReads++; return {}; },
    refresh: async () => ({ httpStatus: 200, response: { ok: true } }),
  };
  const app = express();
  app.use(createCeoRouter({ runtime, verifyAdmin: (_q, _r, n) => n(), datasetCacheMs: 60_000, getXStatements: () => [{ statementId: 'x1', quoteText: 'post' }] }));
  const srv = app.listen(0); const base = `http://127.0.0.1:${(srv.address() as any).port}`;
  try {
    const a = await (await fetch(base + '/api/ceo/dataset')).json();
    const b = await (await fetch(base + '/api/ceo/dataset')).json();
    assert.deepEqual(a, b);
    const raw = await fetch(base + '/api/ceo/dataset', { headers: { 'Accept-Encoding': 'identity' } });
    assert.deepEqual(await raw.json(), a, 'uncompressed cached copy');
    assert.equal(a.dataset.statements.length, 2);
    assert.equal(snaps, 1, 'second view served from cache');
    assert.equal(koReads, 1, 'translations read once per assembly');
    await fetch(base + '/api/admin/ceo/refresh', { method: 'POST' });
    await fetch(base + '/api/ceo/dataset');
    assert.equal(snaps, 2, 'refresh invalidates');
  } finally { srv.close(); }
});
