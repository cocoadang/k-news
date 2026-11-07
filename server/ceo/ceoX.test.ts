import test from 'node:test';
import assert from 'node:assert/strict';
import { collectXPosts, emptyXState, xPostStatements, X_ACCOUNTS, XState, XPost } from './xPosts';
import { headlineContents, parseHeadlineOutput } from './koHeadlines';

function memStore() {
  let s: XState = emptyXState(); const writes: XPost[][] = [];
  return { writes, get: () => s, store: { read: async () => JSON.parse(JSON.stringify(s)), write: async (n: XState, added: XPost[]) => { s = JSON.parse(JSON.stringify(n)); writes.push(added); } } };
}
const NOW = Date.parse('2026-11-07T00:00:00Z');

function fakeX(pages: Record<string, any[]>, calls: string[], status = 200) {
  return (async (u: any) => {
    const url = new URL(String(u)); calls.push(url.pathname + '?' + url.searchParams.get('query'));
    if (status !== 200) return new Response('{}', { status });
    const user = /from:(\w+)/.exec(url.searchParams.get('query') || '')![1];
    const key = `${url.pathname.endsWith('/all') ? 'all' : 'recent'}:${user}`;
    const data = pages[key] || [];
    return new Response(JSON.stringify({ data, meta: { newest_id: data[0]?.id } }), { status: 200 });
  }) as typeof fetch;
}

test('no token → nothing requested', async () => {
  const m = memStore();
  assert.deepEqual(await collectXPosts({ store: m.store, now: () => NOW, deadline: NOW + 60_000 }), { status: 'x_not_configured' });
  assert.equal(m.writes.length, 0);
});

test('collects own posts, Musk attributed by company words, cost tracked, query excludes replies/retweets', async () => {
  const m = memStore(); const calls: string[] = [];
  const pages = {
    'recent:elonmusk': [{ id: '3', text: 'Starship flight 12 is go next week', created_at: '2026-11-06T10:00:00Z' }, { id: '2', text: 'Tesla FSD v14 rolling out', created_at: '2026-11-05T10:00:00Z' }, { id: '1', text: 'Tesla and SpaceX both great', created_at: '2026-11-05T09:00:00Z' }],
    'recent:BillAckman': [{ id: '10', text: 'Rates will stay higher for longer.', created_at: '2026-11-04T10:00:00Z' }],
  };
  const r: any = await collectXPosts({ token: 't', store: m.store, fetchImpl: fakeX(pages, calls), now: () => NOW, deadline: NOW + 60_000, capUsd: 5, accounts: X_ACCOUNTS.slice(0, 2) });
  assert.equal(r.status, 'x_ok');
  const posts = m.get().posts;
  assert.equal(posts['3'].companyId, 'spacex'); assert.equal(posts['2'].companyId, 'tsla');
  assert.ok(!posts['1'], 'both companies → not attributed');
  assert.equal(posts['10'].companyId, 'pershing');
  assert.ok(calls.every(c => /-is:retweet -is:reply/.test(c)));
  assert.ok(calls.some(c => /from:elonmusk .*Tesla OR SpaceX/.test(c)));
  assert.equal(m.get().months['2026-11'].usd, 0.02, '4 posts × $0.005');
  const st = xPostStatements(m.get());
  const sx = st.find(x => x.evidence[0].url.endsWith('/status/3'))!;
  assert.equal(sx.kind, 'social_post'); assert.equal(sx.referenceDate.value, '2026-11-06'); assert.equal(sx.referenceDate.basis, 'written');
});

test('monthly cap: requests stop before exceeding it', async () => {
  const m = memStore(); const calls: string[] = [];
  m.get().months['2026-11'] = { usd: 4.8 };
  const r: any = await collectXPosts({ token: 't', store: m.store, fetchImpl: fakeX({}, calls), now: () => NOW, deadline: NOW + 60_000, capUsd: 5, accounts: X_ACCOUNTS.slice(0, 1) });
  assert.equal(calls.length, 0);
  assert.match(r.notes.join(','), /cap/);
});

test('backfill goes back with end_time and stops when empty; archive 403 marks unavailable', async () => {
  const m = memStore(); const calls: string[] = [];
  const pages = { 'recent:BillAckman': [{ id: '10', text: 'Recent', created_at: '2026-11-04T10:00:00Z' }], 'all:BillAckman': [{ id: '5', text: 'Older post', created_at: '2025-01-01T00:00:00Z' }] };
  await collectXPosts({ token: 't', store: m.store, fetchImpl: fakeX(pages, calls), now: () => NOW, deadline: NOW + 60_000, capUsd: 5, accounts: [X_ACCOUNTS[1]] });
  assert.ok(m.get().posts['5']);
  assert.equal(m.get().accounts.BillAckman.backfillUntil, '2025-01-01T00:00:00Z');
  const m2 = memStore();
  await collectXPosts({ token: 't', store: m2.store, fetchImpl: fakeX({}, [], 403), now: () => NOW, deadline: NOW + 60_000, capUsd: 5, accounts: [X_ACCOUNTS[1]] });
  assert.ok(!m2.get().accounts.BillAckman?.archiveUnavailable, 'recent 403 stops before archive');
});

test('post translation prompt and longer outputs allowed', () => {
  assert.match(headlineContents([{ i: 0, text: 'x' }], true), /SNS 게시물/);
  const long = '가'.repeat(800);
  assert.equal(parseHeadlineOutput(JSON.stringify({ items: [{ i: 0, ko: long }] }), [{ i: 0, text: 'x' }], 1500).get(0), long);
  assert.equal(parseHeadlineOutput(JSON.stringify({ items: [{ i: 0, ko: long }] }), [{ i: 0, text: 'x' }]).size, 0);
});
