import test from 'node:test';
import assert from 'node:assert/strict';
import {summaryLibrary} from './library.mjs';
import {registerWallstreetRoutes} from './runtime.mjs';
import {FirestoreWallstreetStore} from './firestoreStore.mjs';
import {readFileSync} from 'node:fs';

const video={id:'abcdefghijk',title:'영상 제목',publishedAt:1};
test('library keeps full approved text but excludes sensitive and unreviewed fields',()=>{
 const text='상세 설명입니다. '.repeat(400);
 const result=summaryLibrary({videos:{a:{video,programmes:['crypto'],stage:'sent',parts:[{text,messageId:'private'}],recipient:'secret',transcript:[{text:'raw'}],summaryCandidate:{raw:'internal'}},b:{video:{...video,id:'12345678901'},stage:'text_review_required',parts:[{text:'rejected'}],summaryCandidate:{text:'unsafe'}}}});
 assert.equal(result.videos[0].summary,text);assert.equal(result.videos[1].summary,null);
 assert.equal(result.videos[1].status,'review_required');
 for(const token of ['secret','raw','internal','rejected','unsafe','messageId'])assert.ok(!JSON.stringify(result).includes(token));
});
test('empty / unknown / invalid records never become completed summaries',()=>{
 assert.deepEqual(summaryLibrary({videos:{}}),{videos:[]});
 assert.equal(summaryLibrary({videos:{a:{video,stage:'sent',parts:[]}}}).videos[0].status,'not_generated');
 assert.deepEqual(summaryLibrary({videos:{a:{video:{id:'<script>'},stage:'sent'}}}),{videos:[]});
});
test('library route is GET behind existing admin guard and never calls run',async()=>{
 const routes=[];const app={get:(...x)=>routes.push(x),post:()=>{}};const guard=()=>{};
 registerWallstreetRoutes(app,{verifyAdmin:guard,runtime:{library:async()=>({videos:[]}),run:()=>assert.fail('worker called')}});
 const route=routes.find(r=>r[0]==='/api/admin/wallstreet/library');assert.equal(route[1],guard);
 await route[2]({}, {setHeader:(k,v)=>assert.equal(v,'no-store'),json:r=>assert.deepEqual(r,{videos:[]})});
});
test('reading absent state performs no writes and uses read-only transaction',async()=>{
 const db={collection:()=>({doc:id=>id}),runTransaction:async(fn,opts)=>{assert.deepEqual(opts,{readOnly:true});return fn({get:async()=>({exists:false}),set:()=>assert.fail('write'),delete:()=>assert.fail('delete')});}};
 assert.deepEqual((await new FirestoreWallstreetStore(db).read()).videos,{});
});
test('menu retains both existing views, hides manual collection in new view, and fetches only library',()=>{
 const app=readFileSync(new URL('../../src/App.tsx',import.meta.url),'utf8');
 assert.match(app,/\['news',/);assert.match(app,/\['ceo',/);assert.match(app,/\['youtube',/);assert.match(app,/\['strategy',/);assert.match(app,/useState<'news' \| 'ceo' \| 'youtube' \| 'strategy'>\('youtube'\)/);assert.ok(app.indexOf("['youtube',")<app.indexOf("['news',"));
 const ui=readFileSync(new URL('../../src/components/YoutubeMenu.tsx',import.meta.url),'utf8');
 assert.equal((ui.match(/fetch\(/g)||[]).length,1);assert.match(ui,/fetch\('\/api\/youtube\/summaries'/);
 assert.ok(!/dangerouslySetInnerHTML|line-clamp|truncate|\/run|\/poll/.test(ui));
 assert.match(ui,/isAdmin&&<WallstreetRunButton/);assert.ok(!/crypto/.test(ui));
});
