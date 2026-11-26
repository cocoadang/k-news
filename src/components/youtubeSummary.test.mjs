import test from 'node:test';import assert from 'node:assert/strict';
import {parseSummary,summaryPreview,summaryTopics} from './youtubeSummary.mjs';
const id='4eaJ4HserCg',u=t=>`https://www.youtube.com/watch?v=${id}${t===undefined?'':`&t=${t}s`}`;
test('automatic summaries render like reviewed ones: numbered topics, text, timestamp links; header lines dropped',()=>{
 const text=['[1/1]','[홍장원의 불앤베어] 구글',u(),'자동 자막 기반 · 방송의 주장과 해석이며 독립적으로 확인된 사실이 아닙니다.','• [방송에서 소개한 내용] 구글은 검색 광고 성장률 둔화와 함께 마이너스 프리캐시플로우를 기록했습니다. 다만 클라우드는 성장했습니다.',u(129),'• [출연자의 해석·전망] 반도체 투심이 흔들릴 수 있다고 봤습니다.',u(310)].join('\n');
 const b=parseSummary(text,id);
 assert.deepEqual(b.map(x=>x.kind),['heading','paragraph','link','heading','paragraph','link']);
 assert.equal(b[0].number,'1');assert.equal(b[0].badge,'방송에서 소개');assert.ok(b[0].text.length<=42);assert.match(b[0].text,/^구글은 검색 광고/);
 assert.equal(b[2].text,'2:09 근거 장면');assert.equal(b[3].badge,'출연자 해석·전망');
 assert.ok(!b.some(x=>/\[1\/1\]|자동 자막 기반/.test(x.text)));
});
test('reviewed (manual) summaries keep their original parsing',()=>{
 const b=parseSummary(['10월 29일 월가 뉴스레터 상세 요약','1. 알파벳 실적','본문',u(60)].join('\n'),id);
 assert.deepEqual(b.map(x=>x.kind),['paragraph','heading','paragraph','link']);
});

test('model topic titles (▌) become the heading text',()=>{
 const b=parseSummary(['[1/1]','제목',u(),'▌구글 현금흐름 우려','• [방송에서 소개한 내용] 구글은 마이너스 FCF를 기록했습니다.',u(129)].join('\n'),id);
 assert.equal(b[0].text,'구글 현금흐름 우려');assert.equal(b.length,3);
});

test('preview skips editorial notes and keeps the first saved sentence with its qualifiers', () => {
  const saved = ['상세 요약', '자막을 검토했습니다.', '1. 금리 전망',
    '출연자는 금리 동결 가능성이 있다고 봤습니다. 다음 주 지표도 중요하다고 했습니다.', u(125)].join('\n');
  assert.equal(summaryPreview(saved,id),'출연자는 금리 동결 가능성이 있다고 봤습니다.');
  assert.deepEqual(summaryTopics(parseSummary(saved,id),id)[0].time,{text:'2:05',url:u(125)});
});

test('supervised trial topics keep source timestamps without previewing their preamble', () => {
  const saved = ['영상 발언 기준', '• 시장: 나스닥이 1.2% 상승했습니다.', u(0), '• 전망: 성장세가 약해질 수 있습니다.', u()].join('\n');
  assert.equal(summaryPreview(saved,id),'나스닥이 1.2% 상승했습니다.');
  const topics = summaryTopics(parseSummary(saved,id),id);
  assert.deepEqual(topics.map(topic=>[topic.text,topic.time?.text]),[['시장','0:00'],['전망',undefined]]);
});
