import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceBlocks,evidenceContext,verificationPrompt,conservativeClassification,groundCandidate,acceptVerification,renderGroundedBrief,groundedSummarizer} from './groundedSummary.mjs';
const segments=Array.from({length:9},(_,i)=>({start:i*3,text:`방송 구간 ${i}의 조건부 전망입니다.`}));
const blocks=evidenceBlocks(segments);
const candidate={items:blocks.map((b,i)=>({text:`출연자는 구간 ${i*3}에 관해 전망했습니다.`,kind:'outlook',evidenceIds:[b.id]}))};
const audit={checks:blocks.map((_,index)=>({index,supported:true,classificationCorrect:true,recommendedKind:'outlook',reason:'조건부 전망과 해당 근거 일치'}))};
test('context is bounded and cannot bridge a caption gap or search distant names',()=>{
 assert.deepEqual(evidenceContext([1],[{start:0},{start:100},{start:105},{start:110}]),[1,2]);
 assert.throws(()=>evidenceContext([0],blocks,2),/context_radius/);
});
test('actual incomplete context-audit pattern cannot become an accepted result',()=>{
 assert.match(verificationPrompt([]),/checks:\[\{index,supported,classificationCorrect,recommendedKind,reason\}\]/);
 const items=groundCandidate(candidate,blocks,{contextRadius:1,topicContext:true});
 const oldStyle={checks:items.map((_,index)=>({index,supported:true,classificationCorrect:true,reason:'선택 근거와 일치'}))};
 assert.throws(()=>acceptVerification(items,oldStyle),/context_audit_incomplete/);
 assert.throws(()=>acceptVerification(items,{checks:oldStyle.checks.slice(0,2)}),/semantic_verification_failed/);
});
test('audit can conservatively relabel a supported interpretation, never rescue unsupported text',()=>{
 const items=[{text:'해석 문장',kind:'reported'},{text:'미확인 문장',kind:'reported'},{text:'전망',kind:'outlook'}];
 const checks=items.map((_,index)=>({index,supported:index!==1,classificationCorrect:false,recommendedKind:index===2?'reported':'outlook',reason:'분류 검토'}));
 const result=conservativeClassification(items,{checks});
 assert.equal(result.items[0].kind,'outlook');assert.equal(result.items[0].text,items[0].text);
 assert.equal(result.audit.checks[0].classificationCorrect,true);
 assert.equal(result.audit.checks[1].supported,false);assert.equal(result.items[1].kind,'reported');
 assert.equal(result.items[2].kind,'outlook');assert.equal(result.audit.checks[2].classificationCorrect,false);
});
test('server copies source and timestamps by stable IDs, rejects invented IDs/numbers',()=>{
 const items=groundCandidate(candidate,blocks);assert.equal(items[1].quote,'[B0001] '+blocks[1].text);assert.equal(items[1].start,9);
 assert.throws(()=>groundCandidate({items:candidate.items.map(x=>({...x,evidenceIds:['B9999']}))},blocks));
 assert.throws(()=>groundCandidate({items:candidate.items.map(x=>({...x,text:'99퍼센트 상승'}))},blocks));
 assert.throws(()=>groundCandidate({items:candidate.items.map(x=>({...x,text:'CTA 펀드의 숏 커버링이 가속화될 수 있습니다.'}))},blocks),/unsupported_source_term/);
});
test('negative semantic audit blocks unsupported conclusions and wrong classification',()=>{
 const items=groundCandidate(candidate,blocks);
 for(const field of ['supported','classificationCorrect'])assert.throws(()=>acceptVerification(items,{checks:audit.checks.map((x,i)=>i===0?{...x,[field]:false}:x)}));
 assert.throws(()=>renderGroundedBrief({id:'test'},{protocol:'evidence_ids_v1',items,audit}));
 const result=acceptVerification(items,audit);assert.match(renderGroundedBrief({id:'test',title:'방송'},result),/출연자의 해석·전망/);
});
test('separate evidence blocks retain individual source links and conservative outlook attribution',()=>{
 const input={items:candidate.items.map((x,i)=>i===0?{...x,text:'출연자는 하락 가능성을 분석했습니다.',kind:'reported',evidenceIds:['B0000','B0002']}:x)};
 const items=groundCandidate(input,blocks);assert.equal(items[0].kind,'outlook');assert.deepEqual(items[0].starts,[0,18]);
 assert.ok(items[0].quote.includes('[B0000]'));assert.ok(items[0].quote.includes('[B0002]'));
 const output=renderGroundedBrief({id:'test',title:'방송'},acceptVerification(items,audit));assert.ok(output.includes('&t=18s'));
 assert.deepEqual(groundCandidate({items:[{...input.items[0],evidenceIds:['B0002','B0000']}]},blocks,{minimum:1})[0].evidenceIds,['B0000','B0002']); // unsorted IDs are normalized
 assert.throws(()=>groundCandidate({items:[{...input.items[0],evidenceIds:['B9999']}]},blocks,{minimum:1}),/grounded_ids/);
});
test('two calls share one ceiling; failed generation is not retried and preserves draft',async()=>{
 let calls=0;const client={countTokens:async()=>({totalTokens:100}),generate:async()=>({text:JSON.stringify(++calls===1?candidate:audit)})};
 const factory=()=>groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:0.3,outputMicrosPerToken:2.5,approved:true});
 await assert.rejects(factory().summarize({segments,maxCostMicros:5000}),/budget/);assert.equal(calls,0);
 const result=await factory().summarize({segments,maxCostMicros:12000});assert.equal(calls,2);assert.equal(result.items.length,3);
 calls=0;client.generate=async()=>{calls++;throw Error('timeout')};
 await assert.rejects(factory().summarize({segments,maxCostMicros:12000}),e=>e.candidate.calls[0].status==='inflight');assert.equal(calls,1);
});
test('one bounded repair followed by fresh audit, no unbounded regeneration',async()=>{
 let calls=0;const failed={checks:audit.checks.map((x,i)=>i===1?{...x,supported:false,reason:'unsupported purpose'}:x)};
 const repaired={items:candidate.items.map((x,i)=>i===1?{...x,text:'조건부 전망을 설명했습니다.'}:x)};
 const answers=[candidate,failed,repaired,audit];
 const client={countTokens:async()=>({totalTokens:100}),generate:async()=>({text:JSON.stringify(answers[calls++])})};
 const result=await groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:0.3,outputMicrosPerToken:2.5,approved:true}).summarize({segments,maxCostMicros:20000});
 assert.equal(calls,4);assert.equal(result.items[0].text,candidate.items[0].text);assert.equal(result.items[1].text,repaired.items[1].text);
});
test('omit rejected candidates only when at least three detailed points pass',async()=>{
 const five={items:[...candidate.items,{...candidate.items[0],text:'추가 해석을 소개했습니다.'},{...candidate.items[1],text:'또 다른 전망을 소개했습니다.'}]};
 const checks={checks:five.items.map((_,index)=>({index,supported:index<3,classificationCorrect:true,recommendedKind:'outlook',reason:index<3?'근거 일치':'추가 해석'}))};
 let calls=0;const client={countTokens:async()=>({totalTokens:100}),generate:async()=>({text:JSON.stringify(++calls===1?five:checks)})};
 const result=await groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:0.3,outputMicrosPerToken:2.5,approved:true}).summarize({segments,maxCostMicros:20000});
 assert.equal(result.items.length,3);assert.deepEqual(result.omittedIndices,[3,4]);assert.equal(calls,2);
});
test('optional one source repair preserves accepted claims and still needs a fresh audit',async()=>{
 const bad={items:candidate.items.map((x,i)=>i===1?{...x,text:'CTA 펀드의 전망입니다.'}:x)};
 let calls=0;const responses=[bad,candidate,audit];
 const client={countTokens:async()=>({totalTokens:100}),generate:async()=>({text:JSON.stringify(responses[calls++])})};
 const result=await groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:.3,outputMicrosPerToken:2.5,approved:true,allowSourceRepair:true}).summarize({segments,maxCostMicros:20000});
 assert.equal(calls,3);assert.equal(result.items.length,3);assert.ok(result.validationJournal.sourceRepair);
 assert.equal(result.items[0].text,candidate.items[0].text);
});

test('detailed request still delivers when one of five points fails grounding (floor 3)',async()=>{
 const seg=Array.from({length:18},(_,i)=>({start:i*3,text:`방송 구간 ${i}의 조건부 전망입니다.`}));
 const bl=evidenceBlocks(seg);assert.equal(bl.length,6);
 const item=(b,i)=>({text:`출연자는 구간 ${i*3}에 관해 전망했습니다.`,kind:'outlook',evidenceIds:[b.id]});
 const five={items:bl.slice(0,5).map(item)};five.items[4]={...five.items[4],text:'CTA 펀드의 전망입니다.'};
 const findings=n=>({findings:Array.from({length:n},(_,index)=>({index,status:'clear',sourceIds:[],reason:'추가 단서 없음'}))});
 const checks=n=>({checks:Array.from({length:n},(_,index)=>({index,supported:true,classificationCorrect:true,recommendedKind:'outlook',reason:'근거 일치'}))});
 const make=responses=>{let calls=0;const client={countTokens:async()=>({totalTokens:100}),generate:async()=>({text:JSON.stringify(responses[calls++])})};
  return {client,count:()=>calls,s:groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:.3,outputMicrosPerToken:2.5,approved:true,minimumSummaryItems:5,acceptMinimumItems:3,counterEvidenceRequired:true})};};
 const a=make([five,findings(4),checks(4)]);
 const result=await a.s.summarize({segments:seg,maxCostMicros:20000});
 assert.equal(result.items.length,4);assert.equal(a.count(),3);
 const two={items:bl.slice(0,5).map((b,i)=>i<2?item(b,i):{...item(b,i),text:'CTA 펀드의 전망입니다.'})};
 const b=make([two]);
 await assert.rejects(b.s.summarize({segments:seg,maxCostMicros:20000}),/insufficient_source_grounded_items/);
});

test('long single-topic evidence (up to 16 blocks, ~10 min) is accepted; wider spans are rejected per item',async()=>{
 const {relatedContext,sourceRepairPrompt}=await import('./groundedSummary.mjs');
 const blocks=Array.from({length:200},(_,i)=>({id:`B${String(i).padStart(4,'0')}`,start:i*6,text:'방송 내용 '+i}));
 assert.ok(relatedContext([0,50],blocks).length>0); // 300s span
 assert.throws(()=>relatedContext([0,150],blocks),/evidence_topic_span/); // 900s span
 const ids=Array.from({length:12},(_,i)=>blocks[i*2].id);
 const [item]=groundCandidate({items:[{text:'방송 내용을 요약한 문장입니다.',kind:'reported',evidenceIds:ids}]},blocks,{minimum:1});
 assert.equal(item.evidenceIds.length,12);
 const prompt=sourceRepairPrompt({items:[{text:'x',kind:'reported',evidenceIds:[blocks[0].id,blocks[190].id]}]},{items:[],rejected:[]},blocks);
 assert.match(prompt,/B0190/);
});

test('held "qualifies" claims get one grounded rewrite that can restore the floor; the audit still decides',async()=>{
 const seg=Array.from({length:18},(_,i)=>({start:i*3,text:`방송 구간 ${i}의 조건부 전망입니다.`}));
 const bl=evidenceBlocks(seg);
 const item=(b,i)=>({text:`출연자는 구간 ${i*3}에 관해 전망했습니다.`,kind:'outlook',evidenceIds:[b.id]});
 const four={items:bl.slice(0,4).map(item)};
 const findings={findings:[0,1,2,3].map(index=>index<2?{index,status:'clear',sourceIds:[],reason:'추가 단서 없음'}:{index,status:'qualifies',sourceIds:[bl[index].id],reason:'조건이 빠짐'})};
 const fixed={items:[{index:2,text:'출연자는 구간 6에 관해 조건부로 전망했습니다.',kind:'outlook',evidenceIds:[bl[2].id]}]};
 const checks=n=>({checks:Array.from({length:n},(_,index)=>({index,supported:true,classificationCorrect:true,recommendedKind:'outlook',reason:'근거 일치'}))});
 let calls=0;const responses=[four,findings,fixed,checks(3)];
 const client={countTokens:async()=>({totalTokens:100}),generate:async()=>({text:JSON.stringify(responses[calls++])})};
 const s=groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:.3,outputMicrosPerToken:2.5,approved:true,minimumSummaryItems:5,acceptMinimumItems:3,counterEvidenceRequired:true});
 const result=await s.summarize({segments:seg,maxCostMicros:20000});
 assert.equal(calls,4);assert.equal(result.items.length,3);assert.match(result.items[2].text,/조건부로/);
});

test('a caveat-held claim is rewritten even when enough other points remain (kept in time order)',async()=>{
 const seg=Array.from({length:18},(_,i)=>({start:i*3,text:`방송 구간 ${i}의 조건부 전망입니다.`}));
 const bl=evidenceBlocks(seg);
 const item=(b,i)=>({text:`출연자는 구간 ${i*3}에 관해 전망했습니다.`,kind:'outlook',evidenceIds:[b.id]});
 const five={items:bl.slice(0,5).map(item)};
 const findings={findings:[0,1,2,3,4].map(index=>index===1?{index,status:'qualifies',sourceIds:[bl[1].id],reason:'피해 미확인'}:{index,status:'clear',sourceIds:[],reason:'추가 단서 없음'})};
 const fixed={items:[{index:1,text:'출연자는 구간 3에 관해 조건부로 전망했습니다.',kind:'outlook',evidenceIds:[bl[1].id]}]};
 const checks=n=>({checks:Array.from({length:n},(_,index)=>({index,supported:true,classificationCorrect:true,recommendedKind:'outlook',reason:'근거 일치'}))});
 let calls=0;const responses=[five,findings,fixed,checks(5)];
 const client={countTokens:async()=>({totalTokens:100}),generate:async()=>({text:JSON.stringify(responses[calls++])})};
 const s=groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:.3,outputMicrosPerToken:2.5,approved:true,minimumSummaryItems:5,acceptMinimumItems:3,counterEvidenceRequired:true});
 const result=await s.summarize({segments:seg,maxCostMicros:20000});
 assert.equal(calls,4);assert.equal(result.items.length,5);assert.match(result.items[1].text,/조건부로/);
});

test('supplement reuses a stored result: only the caveat-held claim is rewritten and audited, existing points unchanged',async()=>{
 const seg=Array.from({length:18},(_,i)=>({start:i*3,text:`방송 구간 ${i}의 조건부 전망입니다.`}));
 const bl=evidenceBlocks(seg);
 const item=(b,i)=>({text:`출연자는 구간 ${i*3}에 관해 전망했습니다.`,kind:'outlook',evidenceIds:[b.id]});
 const four={items:bl.slice(0,4).map(item)};
 const findings={findings:[0,1,2,3].map(index=>index===1?{index,status:'qualifies',sourceIds:[bl[1].id],reason:'피해 미확인'}:{index,status:'clear',sourceIds:[],reason:'추가 단서 없음'})};
 const checks=n=>({checks:Array.from({length:n},(_,index)=>({index,supported:true,classificationCorrect:true,recommendedKind:'outlook',reason:'근거 일치'}))});
 // Original run where the rewrite was not available (rewrite returns nothing).
 let calls=0;let responses=[four,findings,{items:[]},checks(3)];
 const client={countTokens:async()=>({totalTokens:100}),generate:async()=>({text:JSON.stringify(responses[calls++])})};
 const s=groundedSummarizer({client,model:'gemini-3.5-flash-lite',inputMicrosPerToken:.3,outputMicrosPerToken:2.5,approved:true,minimumSummaryItems:5,acceptMinimumItems:3,counterEvidenceRequired:true});
 const first=await s.summarize({segments:seg,maxCostMicros:20000});assert.equal(first.items.length,3);
 calls=0;responses=[{items:[{index:1,text:'출연자는 구간 3에 관해 조건부로 전망했습니다.',kind:'outlook',evidenceIds:[bl[1].id]}]},checks(1)];
 const next=await s.supplement({result:first,segments:seg,maxCostMicros:20000});
 assert.equal(calls,2);assert.equal(next.items.length,4);assert.match(next.items[1].text,/조건부로/);assert.equal(next.items[0].text,first.items[0].text);
 assert.ok(renderGroundedBrief({id:'Idn_d5ArZvA',title:'t'},next).includes('조건부로'));
});

test('optional topic title is kept only when grounded; a bad title is dropped without losing the point',()=>{
 const seg=Array.from({length:6},(_,i)=>({start:i*3,text:`구글 클라우드 매출이 늘었습니다 ${i}`}));const bl=evidenceBlocks(seg);
 const [ok]=groundCandidate({items:[{title:'구글 클라우드 성장',text:'구글 클라우드 매출이 늘었습니다.',kind:'reported',evidenceIds:[bl[0].id]}]},bl,{minimum:1});
 assert.equal(ok.title,'구글 클라우드 성장');
 const [bad]=groundCandidate({items:[{title:'매출 99% 급증',text:'구글 클라우드 매출이 늘었습니다.',kind:'reported',evidenceIds:[bl[0].id]}]},bl,{minimum:1});
 assert.equal(bad.title,undefined);assert.equal(bad.text,'구글 클라우드 매출이 늘었습니다.');
});

test('evidence IDs are normalized: short form, unsorted, repeated and unknown IDs', async () => {
 const { normalizeEvidenceIds } = await import('./groundedSummary.mjs');
 const bl = Array.from({ length: 20 }, (_, i) => ({ id: `B${String(i).padStart(4, '0')}`, start: i * 9, text: 't' }));
 assert.deepEqual(normalizeEvidenceIds(['B12', 'b0003', 'B0003', 'B9999', 'x', 5], bl), [3, 12]);
 assert.deepEqual(normalizeEvidenceIds(['B9999'], bl), []);
});

test('short source repair keeps the already-grounded claims and adds new ones', async () => {
 const seg = Array.from({ length: 18 }, (_, i) => ({ start: i * 3, text: `방송 구간 ${i}의 조건부 전망입니다.` }));
 const bl = evidenceBlocks(seg);
 const item = (b, i) => ({ text: `출연자는 구간 ${i * 3}에 관해 전망했습니다.`, kind: 'outlook', evidenceIds: [b.id] });
 const bad = { text: 'CTA 펀드의 전망입니다.', kind: 'outlook', evidenceIds: ['B0001'] };
 const first = { items: [item(bl[0], 0), bad, bad, { ...bad, evidenceIds: ['B0002'] }, { ...bad, evidenceIds: ['B0003'] }] };
 const repair = { items: [item(bl[1], 1), item(bl[2], 2)] }; // only two points: previously aborted with grounded_item_count
 const findings = n => ({ findings: Array.from({ length: n }, (_, index) => ({ index, status: 'clear', sourceIds: [], reason: '추가 단서 없음' })) });
 const checks = n => ({ checks: Array.from({ length: n }, (_, index) => ({ index, supported: true, classificationCorrect: true, recommendedKind: 'outlook', reason: '근거 일치' })) });
 const responses = [first, repair, findings(3), checks(3)]; let calls = 0;
 const client = { countTokens: async () => ({ totalTokens: 100 }), generate: async () => ({ text: JSON.stringify(responses[calls++]) }) };
 const s = groundedSummarizer({ client, model: 'gemini-3.5-flash-lite', inputMicrosPerToken: .3, outputMicrosPerToken: 2.5, approved: true, allowSourceRepair: true, minimumSummaryItems: 5, acceptMinimumItems: 3, counterEvidenceRequired: true });
 const result = await s.summarize({ segments: seg, maxCostMicros: 30000 });
 assert.equal(result.items.length, 3); assert.equal(result.items[0].text, first.items[0].text); assert.equal(calls, 4);
});

test('long broadcasts request more points spread over the timeline; short ones keep 5-8', async () => {
 const { summaryTargets, summaryInstruction, SUMMARY_ID_INSTRUCTION, MAX_SUMMARY_ITEMS } = await import('./groundedSummary.mjs');
 const at = min => [{ id: 'B0000', start: 0, text: 'a' }, { id: 'B0001', start: min * 60, text: 'b' }];
 assert.deepEqual([summaryTargets(at(18)).lo, summaryTargets(at(18)).hi, summaryTargets(at(18)).generationCap], [5, 8, 2500]);
 assert.equal(summaryInstruction(at(18)), SUMMARY_ID_INSTRUCTION);
 assert.match(SUMMARY_ID_INSTRUCTION, /Cover the whole broadcast/);
 const t40 = summaryTargets(at(40)); assert.deepEqual([t40.lo, t40.hi], [9, 11]);
 assert.match(summaryInstruction(at(40)), /Write 9 to 11 distinct/);
 const t90 = summaryTargets(at(90)); assert.deepEqual([t90.lo, t90.hi], [12, MAX_SUMMARY_ITEMS]);
 assert.ok(t90.generationCap <= 4500 && t90.reviewCap(14) <= 1400 && t90.reviewCap(5) === 700);
});

test('a 45-minute video can deliver more than eight grounded points', async () => {
 const seg = Array.from({ length: 900 }, (_, i) => ({ start: i * 3, text: `방송 구간 ${i}의 조건부 전망입니다.` }));
 const bl = evidenceBlocks(seg);
 const pick = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 299];
 const first = { items: pick.map(i => ({ title: `구간 ${i}`, text: `출연자는 방송 구간 ${i * 3}에 관해 조건부로 전망했습니다.`, kind: 'outlook', evidenceIds: [bl[i].id] })) };
 const findings = n => ({ findings: Array.from({ length: n }, (_, index) => ({ index, status: 'clear', sourceIds: [], reason: '추가 단서 없음' })) });
 const checks = n => ({ checks: Array.from({ length: n }, (_, index) => ({ index, supported: true, classificationCorrect: true, recommendedKind: 'outlook', reason: '근거 일치' })) });
 const responses = [first, findings(11), checks(11)]; const caps = []; let calls = 0;
 const client = { countTokens: async () => ({ totalTokens: 100 }), generate: async ({ maxOutputTokens, contents }) => { caps.push(maxOutputTokens); if (!calls) assert.match(contents, /Write 10 to 12 distinct/); return { text: JSON.stringify(responses[calls++]) }; } };
 const s = groundedSummarizer({ client, model: 'gemini-3.5-flash-lite', inputMicrosPerToken: .3, outputMicrosPerToken: 2.5, approved: true, allowSourceRepair: true, minimumSummaryItems: 5, acceptMinimumItems: 3, counterEvidenceRequired: true });
 const result = await s.summarize({ segments: seg, maxCostMicros: 50000 });
 assert.equal(result.items.length, 11);
 assert.ok(caps[0] > 2500 && caps[1] > 700 && caps[2] > 700, JSON.stringify(caps));
 assert.deepEqual(result.validationJournal.targets, { lo: 10, hi: 12, minutes: 45 });
});
