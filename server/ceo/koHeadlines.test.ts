import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryKoLedger } from './koLedger';
import { translateHeadlines, headlineKey, parseHeadlineOutput } from './koHeadlines';

const now = Date.parse('2026-10-31T00:00:00Z');
const usage = { promptTokenCount: 200, candidatesTokenCount: 100, thoughtsTokenCount: 0, totalTokenCount: 300 };
function setup(answer: (contents: string) => string) {
  const ledger = new MemoryKoLedger();
  let calls = 0, counts = 0;
  const client = {
    countTokens: async (_req: {contents:string}) => { counts++; return { totalTokens: 200 }; },
    generate: async ({ contents }: any) => { calls++; return { text: answer(contents), modelVersion: 'gpt-6-luna-001', usageMetadata: usage }; },
  };
  return { ledger, client, calls: () => calls, counts: () => counts };
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

test('long posts shrink before reservation instead of blocking the entire queue',async()=>{
 const x=setup(contents=>JSON.stringify({items:JSON.parse(contents.slice(contents.lastIndexOf('\n')+1)).items.map((it:any)=>({i:it.i,ko:'원문 게시물 번역'}))}));
 await x.ledger.configure({enabled:true,now});
 const sizes:number[]=[];
 x.client.countTokens=async({contents}:any)=>{sizes.push(Buffer.byteLength(contents)+256);return {totalTokens:sizes.at(-1)!};};
 const texts=Array.from({length:12},(_,i)=>`${i} `+'Long English post. '.repeat(70));
 const r=await translateHeadlines(texts,{ledger:x.ledger,client:x.client,now:()=>now,deadline:now+120000,posts:true});
 assert.equal(r.stoppedReason,null);assert.ok(r.sent>0&&r.sent<12);assert.equal(r.translated,r.sent);
 assert.ok(sizes[0]>6000);assert.ok(sizes.at(-1)!<=6000);assert.equal(x.calls(),1);
});

test('same monetary value and standalone month pass headline validation',()=>{
 const items=[{i:0,text:'$7 billion merger in December'}];
 assert.equal(parseHeadlineOutput('{"items":[{"i":0,"ko":"12월 70억 달러 합병"}]}',items).size,1);
 assert.equal(parseHeadlineOutput('{"items":[{"i":0,"ko":"12월 80억 달러 합병"}]}',items).size,0);
});

test('a corrected translation replaces a legacy empty cache result and is not billed again',async()=>{
 const x=setup(()=>JSON.stringify({items:[{i:0,ko:'12월 합병'}]}));await x.ledger.configure({enabled:true,now});
 const text='Merger in December',key=headlineKey(text);
 await x.ledger.reserve({jobKey:'legacy',statementId:'headline-batch',costNano:1000,now,attemptId:'old'});
 await x.ledger.settle({jobKey:'legacy',attemptId:'old',costNano:100,now,usage:{prompt:1,candidates:0,thoughts:0},result:null,extraResults:{[key]:{title:'',summary:'',generatedAt:new Date(now).toISOString(),model:'legacy'}}});
 const opts={ledger:x.ledger,client:x.client,now:()=>now,deadline:now+120000};
 assert.equal((await translateHeadlines([text],opts)).translated,1);
 assert.equal((await x.ledger.read()).results[key].title,'12월 합병');
 assert.equal((await translateHeadlines([text],opts)).pending,0);assert.equal(x.calls(),1);
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
  assert.equal(x.counts(), 2);
});

test('a reserved batch skips token counting before generation', async () => {
  const x = setup(() => '{}'); await x.ledger.configure({ enabled:true, now });
  const crypto = await import('node:crypto');
  const text = 'Musk says A', key = 'hlb:' + crypto.createHash('sha256').update(headlineKey(text)).digest('hex');
  await x.ledger.reserve({jobKey:key,statementId:'headline-batch',costNano:1000,now,attemptId:'pending'});
  await translateHeadlines([text], {ledger:x.ledger,client:x.client,now:()=>now,deadline:now+120_000});
  assert.equal(x.counts(),0); assert.equal(x.calls(),0);
});
