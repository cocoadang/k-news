import test from 'node:test';
import assert from 'node:assert/strict';
import { collectXPosts, emptyXState, xPostStatements, X_ACCOUNTS, XState, XPost, recentSinceId } from './xPosts';
import { headlineContents, parseHeadlineOutput } from './koHeadlines';

function memStore() {
  let s: XState = emptyXState(); const writes: XPost[][] = [];
  return { writes, get: () => s, store: { read: async () => JSON.parse(JSON.stringify(s)), write: async (n: XState, added: XPost[]) => { s = JSON.parse(JSON.stringify(n)); writes.push(added); } } };
}
const NOW = Date.parse('2026-11-07T00:00:00Z');
const snowflake=(time:number)=>(BigInt(time-1288834974657)<<22n).toString();

test('recent search omits expired, near-boundary, malformed and future cursors',()=>{
 assert.equal(recentSinceId(snowflake(NOW-86400000),NOW),snowflake(NOW-86400000));
 for(const id of [snowflake(NOW-13*86400000),snowflake(NOW-7*86400000+30000),snowflake(NOW+60000),'not-an-id'])assert.equal(recentSinceId(id,NOW),undefined);
});

test('stale cursor recovers real recent results, deduplicates posts, and advances only to returned ID',async()=>{
 const m=memStore(),account=X_ACCOUNTS[4],old=snowflake(NOW-13*86400000),fresh=snowflake(NOW-3600000);
 m.get().months['2026-11']={usd:3};m.get().accounts[account.username]={newestId:old};
 m.get().posts[fresh]={id:fresh,username:account.username,personId:account.personId,companyId:'googl',text:'Already stored',createdAt:new Date(NOW-3600000).toISOString()};
 let calls=0;
 const fetchImpl:any=async(u:any)=>{calls++;assert.equal(new URL(u).searchParams.has('since_id'),false);return Response.json({data:[{id:fresh,text:'Existing post',created_at:new Date(NOW-3600000).toISOString()}],meta:{newest_id:fresh}});};
 const r=await collectXPosts({token:'t',store:m.store,fetchImpl,now:()=>NOW,deadline:NOW+60000,capUsd:5,accounts:[account]});
 assert.equal(r.status,'x_ok');assert.equal(r.kept,0);assert.equal(calls,1);assert.deepEqual(r.recentCursorResets,[account.username]);assert.equal(m.get().accounts[account.username].newestId,fresh);
 assert.equal(m.get().months['2026-11'].usd,3.005);
});

test('one account HTTP 400 does not prevent subsequent accounts from collecting',async()=>{
 const m=memStore();m.get().months['2026-11']={usd:3};const calls:string[]=[];
 const fetchImpl:any=async(u:any)=>{const q=new URL(u).searchParams.get('query')!;calls.push(q);return q.includes('sundarpichai')?new Response('{}',{status:400}):Response.json({data:[{id:snowflake(NOW-1000),text:'New post',created_at:new Date(NOW-1000).toISOString()}]});};
 const r=await collectXPosts({token:'t',store:m.store,fetchImpl,now:()=>NOW,deadline:NOW+60000,capUsd:5,accounts:[X_ACCOUNTS[4],X_ACCOUNTS[5]]});
 assert.equal(calls.length,2);assert.equal(r.kept,1);assert.equal(m.get().lastRun?.status,'partial');
});

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

test('default collection keeps every current account and stored history without paid archive expansion', async () => {
  const m = memStore(), calls: string[] = [];
  const old: XPost = { id: 'old', username: 'BillAckman', personId: 'bill-ackman', companyId: 'pershing', text: 'Stored history', createdAt: '2025-01-01T00:00:00Z' };
  m.get().posts.old = old;
  m.get().accounts.BillAckman = { backfillUntil: old.createdAt };
  const r = await collectXPosts({ token: 't', store: m.store, fetchImpl: fakeX({}, calls), now: () => NOW, deadline: NOW + 60_000 });
  assert.equal(r.status, 'x_ok');
  assert.equal(calls.length, X_ACCOUNTS.length);
  assert.ok(calls.every(c => c.startsWith('/2/tweets/search/recent?')));
  assert.deepEqual(m.get().posts.old, old);
  assert.equal(m.get().accounts.BillAckman.backfillUntil, old.createdAt);
  assert.equal(m.get().accounts.BillAckman.backfillDone, undefined);
  assert.equal(m.get().months['2026-11'].usd, 0);
});

test('backfill goes back with end_time and stops when empty; archive 403 marks unavailable', async () => {
  const m = memStore(); const calls: string[] = [];
  const pages = { 'recent:BillAckman': [{ id: '10', text: 'Recent', created_at: '2026-11-04T10:00:00Z' }], 'all:BillAckman': [{ id: '5', text: 'Older post', created_at: '2025-01-01T00:00:00Z' }] };
  await collectXPosts({ token: 't', store: m.store, fetchImpl: fakeX(pages, calls), now: () => NOW, deadline: NOW + 60_000, capUsd: 5, accounts: [X_ACCOUNTS[1]], archiveBackfill: true });
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

test('admin token format check (value never echoed)', async () => {
  const { validXToken } = await import('./xPosts');
  assert.ok(validXToken('A'.repeat(50) + '%2F' + 'b'.repeat(40)));
  assert.ok(!validXToken('short'));
  assert.ok(!validXToken('has space ' + 'a'.repeat(60)));
  assert.ok(!validXToken(123));
});
