import test from 'node:test';import assert from 'node:assert/strict';
import {buildStatusReport,statusHasIssue} from './statusReport.mjs';
const now=Date.parse('2026-10-31T22:05:00Z');
test('daily status report summarises news, YouTube, CEO and cost; warns on failures',()=>{
 const youtube={videos:{a:{video:{title:'월가 뉴스레터'},programmes:['wallstreet'],stage:'sent',firstSeen:now-3600_000},b:{video:{title:'불앤베어 <특집>'},programmes:['bullbear'],stage:'text_review_required',summaryFailure:'insufficient_context_reviewed_items',firstSeen:now-7200_000},c:{video:{title:'크립토'},programmes:['crypto'],stage:'text_review_required',firstSeen:now}},budgets:{'text:2026-10-31':40000},supadata:{used:7}};
 const t=buildStatusReport({date:'11/01',now,poll:{articles:143,events:20,elapsed:180,telegram:0},analysis:{screened:48,detailed:3,unassessed:900,awaitingDetail:300,failed:0},ceoStatus:'수집 완료',headline:{translated:27,pending:27},ko:{spentUsd:0.02,limitUsd:1},youtube});
 assert.match(t,/새 기사 143/);assert.match(t,/상세 3/);assert.match(t,/요약 완료 1 · 대기 0 · 실패\/보류 1/);
 assert.match(t,/불앤베어 &lt;특집&gt;/);assert.ok(!t.includes('크립토'));assert.match(t,/⚠️ 유튜브 요약 실패\/보류 1건/);
 assert.match(t,/\$0\.020 \/ \$1\.000/);
});
test('all clear',()=>{
 assert.match(buildStatusReport({date:'11/01',now,poll:{articles:1,events:1,elapsed:10,telegram:0},analysis:{screened:1,detailed:1,unassessed:0,awaitingDetail:0,failed:0}}),/✅ 이상 없음/);
});

test('only reports with a warning are sent',()=>{
 assert.equal(statusHasIssue(buildStatusReport({date:'x',now,poll:{articles:1},analysis:{screened:1,detailed:1,failed:0}})),false);
 assert.equal(statusHasIssue(buildStatusReport({date:'x',now,poll:{error:'boom'}})),true);
});
