import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKoLedger } from './koLedger';
import { translateHeadlines, headlineKey, parseHeadlineOutput } from './koHeadlines';

const now = Date.parse('2026-10-31T00:00:00Z');
const usage = { promptTokenCount: 200, candidatesTokenCount: 100, thoughtsTokenCount: 0, totalTokenCount: 300 };
function setup(answer: (contents: string) => string) {
  const ledger = new MemoryKoLedger();
  let calls = 0;
  const client = {
    countTokens: async () => ({ totalTokens: 200 }),
    generate: async ({ contents }: any) => { calls++; return { text: answer(contents), modelVersion: 'gemini-3.8-flash-001', usageMetadata: usage }; },
  };
  return { ledger, client, calls: () => calls };
}

test('headlines are translated in one batched call, cached by text, never re-translated', async () => {
  const x = setup(() => JSON.stringify({ items: [{ i: 0, ko: '머스크 "테슬라 메가팩 거의 매진"' }, { i: 1, ko: '젠슨 황, 블랙웰 수요 강해' }] }));
  await x.ledger.configure({ enabled: true, now });
  const texts = ['Elon Musk Says Tesla Megapacks Are Nearly Sold Out', 'Jensen Huang says Blackwell demand is strong', 'Elon Musk Says Tesla Megapacks Are Nearly Sold Out'];
  const r = await translateHeadlines(texts, { ledger: x.ledger, client: x.client, now: () => now, deadline: now + 120_000 });
  assert.equal(r.translated, 2); assert.equal(x.calls(), 1);
  const st = await x.ledger.read();
  assert.equal(st.results[headlineKey(texts[0])].title, '머스크 "테슬라 메가팩 거의 매진"');
  const again = await translateHeadlines(texts, { ledger: x.ledger, client: x.client, now: () => now, deadline: now + 120_000 });
  assert.equal(again.pending, 0); assert.equal(x.calls(), 1);
});

test('a translation with a number not in the source, or without Korean, is dropped', () => {
  const items = [{ i: 0, text: 'Nvidia sales rise 40%' }, { i: 1, text: 'Musk on robotaxi' }];
  const m = parseHeadlineOutput(JSON.stringify({ items: [{ i: 0, ko: '엔비디아 매출 45% 증가' }, { i: 1, ko: 'Musk on robotaxi' }] }), items);
  assert.equal(m.size, 0);
  assert.equal(parseHeadlineOutput(JSON.stringify({ items: [{ i: 0, ko: '엔비디아 매출 40% 증가' }] }), items).get(0), '엔비디아 매출 40% 증가');
});

test('disabled ledger makes no call', async () => {
  const x = setup(() => '{}');
  const r = await translateHeadlines(['Musk says X'], { ledger: x.ledger, client: x.client, now: () => now, deadline: now + 120_000 });
  assert.equal(r.stoppedReason, '꺼짐'); assert.equal(x.calls(), 0);
});

test('rejected items are marked tried (empty title) so the same batch is not re-sent', async () => {
  const x = setup(() => JSON.stringify({ items: [{ i: 0, ko: '엔비디아 매출 45% 증가' }, { i: 1, ko: '머스크, 로보택시 언급' }] }));
  await x.ledger.configure({ enabled: true, now });
  const texts = ['Nvidia sales rise 40%', 'Musk on robotaxi'];
  const r = await translateHeadlines(texts, { ledger: x.ledger, client: x.client, now: () => now, deadline: now + 120_000 });
  assert.equal(r.translated, 1);
  const st = await x.ledger.read();
  assert.equal(st.results[headlineKey(texts[0])].title, '');
  const again = await translateHeadlines(texts, { ledger: x.ledger, client: x.client, now: () => now, deadline: now + 120_000 });
  assert.equal(again.pending, 0); assert.equal(again.stoppedReason, null); assert.equal(x.calls(), 1);
});

test('a batch already settled (legacy, nothing marked) is retried once with a new key, then skipped quietly', async () => {
  const x = setup(() => 'not json');
  await x.ledger.configure({ enabled: true, now });
  const texts = ['Musk says A', 'Huang says B'];
  const o = { ledger: x.ledger, client: x.client, now: () => now, deadline: now + 120_000 };
  const r1 = await translateHeadlines(texts, o);
  assert.equal(r1.stoppedReason, null); assert.equal(x.calls(), 1);
  const r2 = await translateHeadlines(texts, o);
  assert.equal(r2.stoppedReason, null); assert.equal(x.calls(), 2);
  const r3 = await translateHeadlines(texts, o);
  assert.equal(r3.stoppedReason, null); assert.equal(r3.sent, 0); assert.equal(x.calls(), 2);
});
