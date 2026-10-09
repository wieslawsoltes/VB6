import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeContentBlocks,base64Bytes,contentSummary,UIModelContextStore,prepareDownloads} from '../packages/intelligent-ui/src/content.js';
const text={type:'text',text:'Observed'},image={type:'image',mimeType:'image/png',data:'YWJj'},audio={type:'audio',mimeType:'audio/wav',data:'YWJj'};
test('MCP preserves every supported content kind as inert bounded JSON',()=>{
  const input=[text,image,audio,{type:'resource',resource:{uri:'memory://export/a.txt',text:'hello'}},{type:'resource_link',uri:'file:///safe.txt',name:'Source'}];
  const output=normalizeContentBlocks(input);assert.deepEqual(JSON.parse(JSON.stringify(output)),input);output[0].text='changed';assert.equal(input[0].text,'Observed');assert.match(contentSummary(input),/not fetched/);
});
test('content validation rejects malformed media, accessors, credentials and ambiguous resources',()=>{
  for(const input of [[{...image,data:'!!'}],[{...image,mimeType:'text/html'}],[{type:'resource',resource:{uri:'memory://x',text:'x',blob:'eA=='}}],[{type:'resource',resource:{uri:'javascript:1',text:'x'}}],[{type:'resource_link',uri:'https://user:pass@example.org',name:'x'}],[{type:'text',get text(){throw Error('accessed');}}],[{...text,annotations:{priority:2}}],Array(33).fill(text)])assert.throws(()=>normalizeContentBlocks(input));
  assert.throws(()=>base64Bytes('YR=='),/padding/);assert.throws(()=>normalizeContentBlocks([audio],{types:['text']}));
});
test('context is latest-wins per view, cloned, bounded, removable and does not enqueue messages',()=>{
  const s=new UIModelContextStore();s.set('a',{content:[text]});s.set('a',{structuredContent:{value:2}});assert.equal(s.snapshot().length,1);assert.equal(s.snapshot()[0].structuredContent.value,2);
  const rev=s.revision;s.set('a',{structuredContent:{value:2}});assert.equal(s.revision,rev);s.snapshot()[0].structuredContent.value=4;assert.equal(s.snapshot()[0].structuredContent.value,2);s.delete('a');assert.equal(s.snapshot().length,0);
});
test('downloads stage inline and allowlisted link resources without ambient fetching',async()=>{
  let calls=0;const files=await prepareDownloads([{type:'resource',resource:{uri:'memory://x/a.txt',text:'A'}},{type:'resource_link',uri:'memory://x/b.bin',name:'../bad/name.bin'}],{resourceUris:['memory://x/b.bin'],readResource:async(uri)=>{calls++;return {contents:[{uri,blob:'YWJj'}]};}});
  assert.equal(calls,1);assert.equal(files.length,2);assert.equal(new TextDecoder().decode(files[0].bytes),'A');assert.equal(files[1].name,'_bad_name.bin');assert.equal(files[1].bytes.length,3);
  await assert.rejects(prepareDownloads([{type:'resource_link',uri:'https://example.org',name:'x'}]),/not available/);
});
test('downloads reject cancellation and mismatched resources before any file effects',async()=>{
  const controller=new AbortController();await assert.rejects(prepareDownloads([{type:'resource_link',uri:'memory://a',name:'a'}],{resourceUris:['memory://a'],readResource:async()=>({contents:[{uri:'memory://other',text:'x'}]})}),/does not match/);
  await assert.rejects(prepareDownloads([{type:'resource_link',uri:'memory://a',name:'a'}],{resourceUris:['memory://a'],signal:controller.signal,readResource:async uri=>{controller.abort();return {contents:[{uri,text:'x'}]};}}));
});
