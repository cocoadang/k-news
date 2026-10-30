import test from 'node:test';import assert from 'node:assert/strict';
import {telegramHtml} from './telegramFormat.mjs';
import {splitMessage} from './core.mjs';
const id='4eaJ4HserCg',u=t=>`https://www.youtube.com/watch?v=${id}${t===undefined?'':`&t=${t}s`}`;
test('summary becomes readable Telegram HTML: bold title, numbered labelled points, short timestamp links',()=>{
 const text=['[1/1]','[홍장원의 불앤베어] 구글 <실적> & 반도체',u(),'자동 자막 기반 · 방송의 주장과 해석이며 독립적으로 확인된 사실이 아닙니다.','• [방송에서 소개한 내용] 구글 클라우드는 103% 성장했습니다.',u(129),u(3724),'• [출연자의 해석·전망] 반도체 투심이 흔들릴 수 있습니다.',u(310)].join('\n');
 const h=telegramHtml(text,{publishedAt:Date.parse('2026-10-28T22:38:09Z')});
 assert.match(h,/\n🗓 2026\.10\.29 \(목\) 오전 7:38 방송\n/);assert.ok(!h.includes('자동 자막 기반'));
 assert.match(h,/^📺 <b>\[홍장원의 불앤베어\] 구글 &lt;실적&gt; &amp; 반도체<\/b>/);
 assert.match(h,/<b>1\.<\/b> 📰 구글 클라우드는 103%/);assert.match(h,/<b>2\.<\/b> 💬 반도체/);
 assert.match(h,/⏱ <a href="https:\/\/www\.youtube\.com\/watch\?v=4eaJ4HserCg&amp;t=129s">2:09<\/a>  ·  <a[^>]+>1:02:04<\/a>/);
 assert.ok(!h.includes('[1/1]'));assert.ok(!/\nhttps:/.test(h));
});
test('multi-part marker kept; split never cuts a link line',()=>{
 const long=Array.from({length:120},(_,i)=>`• [방송에서 소개한 내용] 항목 ${i} 설명입니다.\n${u(i)}`).join('\n');
 const parts=splitMessage(long);assert.ok(parts.length>1);
 for(const p of parts)for(const line of p.split('\n').slice(1))assert.ok(!/^https/.test(line)||/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}&t=\d+s$/.test(line));
 assert.match(telegramHtml(parts[1]),/\(2\/\d\)$/);
});

test('topic title line becomes the bold numbered heading in Telegram',()=>{
 const h=telegramHtml(['[1/1]','제목',u(),'▌구글 현금흐름 우려','• [방송에서 소개한 내용] 구글은 마이너스 FCF를 기록했습니다.',u(129)].join('\n'));
 assert.match(h,/<b>1\. 구글 현금흐름 우려<\/b>\n📰 구글은/);assert.match(h,/^📺 <b>제목<\/b>/);
});
