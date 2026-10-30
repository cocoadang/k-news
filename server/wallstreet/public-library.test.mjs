import test from 'node:test';import assert from 'node:assert/strict';
import {publicSummaryLibrary} from './library.mjs';
test('public projection includes reviewed publication while preserving automatic hold',()=>{
 const record={video:{id:'LtT_k6wCOek',title:'title',publishedAt:1},programmes:['wallstreet','private'],stage:'text_review_required',transcript:'PRIVATE',recipient:'PRIVATE',cost:'PRIVATE',publication:{source:'transcript_review',reviewStatus:'approved',summary:'Eight detailed topics',reviewHash:'PRIVATE'}};
 const before=JSON.stringify(record),result=publicSummaryLibrary({videos:{x:record},budgets:{private:1}});
 assert.equal(result.videos.length,1);assert.equal(result.videos[0].source,'transcript_review');assert.equal(JSON.stringify(record),before);assert(!JSON.stringify(result).includes('PRIVATE'));
 assert.deepEqual(Object.keys(result.videos[0]).sort(),['id','title','publishedAt','programmes','status','source','url','summary'].sort());
});
test('unapproved candidate and failed/inflight states never appear publicly',()=>{
 for(const stage of ['text_review_required','failed','text_inflight','not_generated'])assert.equal(publicSummaryLibrary({videos:{x:{video:{id:'abcdefghijk'},stage,summaryCandidate:'PRIVATE',publication:{source:'transcript_review',reviewStatus:'pending',summary:'PRIVATE'}}}}).videos.length,0);
});
test('supervised trial remains labelled separately from automatic summaries',()=>{
 const r=publicSummaryLibrary({videos:{x:{video:{id:'abcdefghijk'},stage:'historical_complete',publication:{source:'supervised_trial',reviewStatus:'approved',summary:'reviewed'}}}});
 assert.equal(r.videos[0].source,'supervised_trial');assert.equal(r.videos[0].publishedAt,null);
});
test('unrecognized publication provenance cannot bypass held state',()=>{
 assert.equal(publicSummaryLibrary({videos:{x:{video:{id:'abcdefghijk'},publication:{source:'user_authored',reviewStatus:'approved',summary:'x'}}}}).videos.length,0);
});

test('hidden programmes (crypto) never appear in the public library',()=>{
  const v=(id,programmes)=>({video:{id,title:'t',publishedAt:1},programmes,stage:'sent',parts:[{text:'요약'}]});
  const r=publicSummaryLibrary({videos:{a:v('aaaaaaaaaaa',['crypto']),b:v('bbbbbbbbbbb',['bullbear']),c:v('ccccccccccc',['crypto','bullbear'])}});
  assert.deepEqual(r.videos.map(x=>x.id).sort(),['bbbbbbbbbbb','ccccccccccc']);
  assert.deepEqual(r.videos.find(x=>x.id==='ccccccccccc').programmes,['bullbear']);
});
