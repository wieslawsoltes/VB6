import test from 'node:test';
import assert from 'node:assert/strict';
import {richUserMessage,withReviewedUIContext} from '../src/agents/content.js';
import {UIModelContextStore} from '../packages/intelligent-ui/src/content.js';
const image={type:'image',mimeType:'image/png',data:'AQID'};
const pdf={type:'resource',resource:{uri:'file:///drawing.pdf',mimeType:'application/pdf',blob:'AQID'}};
test('rich provider messages preserve bytes in native image and PDF formats',()=>{
  const a=richUserMessage('openai','Review',[image,pdf]);assert.equal(a.content[1].image_url,'data:image/png;base64,AQID');assert.equal(a.content[2].file_data,'data:application/pdf;base64,AQID');
  const b=richUserMessage('anthropic','Review',[image,pdf]);assert.equal(b.content[1].source.data,'AQID');assert.equal(b.content[2].type,'document');
  const c=richUserMessage('google','Review',[image,{type:'audio',mimeType:'audio/wav',data:'AQID'}]);assert.equal(c.parts[1].inlineData.data,'AQID');assert.equal(c.parts[2].inlineData.mimeType,'audio/wav');
});
test('unsupported media is rejected rather than silently discarded',()=>{
  for(const provider of ['openai','anthropic'])assert.throws(()=>richUserMessage(provider,'Review',[{type:'audio',mimeType:'audio/wav',data:'AQID'}]),/nothing was sent/);
  assert.throws(()=>richUserMessage('google','Review',[{...image,mimeType:'image/svg+xml'}]),/Image format/);
  assert.throws(()=>richUserMessage('openai','Review',[{...image,data:'not-base64'}]));
});
test('resource links are described but never fetched and text resources stay text',()=>{
  const result=richUserMessage('google','Review',[{type:'resource_link',name:'source',uri:'https://example.com/data'},{type:'resource',resource:{uri:'file:///code.bas',text:'Option Explicit'}}]);
  assert.match(result.parts[1].text,/not fetched/);assert.match(result.parts[2].text,/Option Explicit/);assert.ok(result.parts.every(p=>Object.keys(p).length===1));
});
test('latest context replaces rather than appending to signed native history',()=>{
  const store=new UIModelContextStore(),history=[{type:'reasoning',encrypted_content:'opaque'}];
  store.set('view',{structuredContent:{selection:'old'}});store.set('view',{structuredContent:{selection:'new'}});
  const first=withReviewedUIContext('openai',history,store.snapshot());assert.equal(first.length,2);assert.equal(first[0],history[0]);assert.match(JSON.stringify(first),/new/);assert.doesNotMatch(JSON.stringify(first),/old/);
  store.delete('view');assert.equal(withReviewedUIContext('openai',history,store.snapshot()),history);assert.equal(history.length,1);
});

test('compaction projects rich user text and media descriptions without binary data',async()=>{
 const {publicHistory}=await import('../src/agents/context.js');
 for(const provider of ['openai','anthropic','google']){
   const history=[richUserMessage(provider,'Keep this task',[image,pdf])],before=JSON.stringify(history);
   const projection=publicHistory(provider,history);assert.match(JSON.stringify(projection),/Keep this task/);assert.match(JSON.stringify(projection),/attachment/);assert.doesNotMatch(JSON.stringify(projection),/AQID/);assert.equal(JSON.stringify(history),before);
 }
});
