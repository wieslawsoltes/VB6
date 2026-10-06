import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadRuntimeDocument} from '../src/ide/runtime-document.js';
import {installNativePreview} from '../desktop/studio.mjs';

const url = 'vb6://app/preview/' + '1'.repeat(32);
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
function fixture(prepare) {
  const writes=[],stops=[],messages=[];
  const frame={isConnected:true,sandbox:'allow-scripts allow-downloads allow-modals',referrerPolicy:'no-referrer',set src(value){writes.push(['src',value]);},set srcdoc(value){writes.push(['srcdoc',value]);}};
  const studio={runtimeFrame:frame,async stop(capture){stops.push(capture);this.runtimeFrame=null;},status(message){messages.push(message);}};
  installNativePreview(studio,{runtimeDocument:prepare});
  return {studio,frame,writes,stops,messages};
}
test('ordinary browser preview retains its srcdoc transport',()=>{
  const frame={};loadRuntimeDocument({},frame,'<html>browser</html>');assert.equal(frame.srcdoc,'<html>browser</html>');assert.equal(frame.src,undefined);
});
test('native preview prepares first, navigates once, and leaves sandbox attributes unchanged',async()=>{
  const reply=deferred(),calls=[],s=fixture(html=>{calls.push(html);return reply.promise;});
  const pending=loadRuntimeDocument(s.studio,s.frame,'<html>native</html>');await Promise.resolve();
  assert.deepEqual(calls,['<html>native</html>']);assert.deepEqual(s.writes,[]);
  reply.resolve(url);assert.equal(await pending,true);assert.deepEqual(s.writes,[['src',url]]);
  assert.equal(s.frame.sandbox,'allow-scripts allow-downloads allow-modals');assert.equal(s.frame.referrerPolicy,'no-referrer');assert.deepEqual(s.stops,[]);
});
test('stopped and detached native preview requests cannot navigate',async()=>{
  for (const detach of [false,true]) {
    const reply=deferred(),s=fixture(()=>reply.promise),pending=loadRuntimeDocument(s.studio,s.frame,'document');
    if(detach)s.frame.isConnected=false;else s.studio.runtimeFrame=null;
    reply.resolve(url);assert.equal(await pending,false);assert.deepEqual(s.writes,[]);assert.deepEqual(s.stops,[]);
  }
});
test('a late native response cannot replace a restarted preview or a newer request for the same frame',async()=>{
  for (const sameFrame of [false,true]) {
    const replies=[deferred(),deferred()];let index=0;const s=fixture(()=>replies[index++].promise);
    const first=loadRuntimeDocument(s.studio,s.frame,'first');await Promise.resolve();
    const next=sameFrame?s.frame:{...s.frame,set src(value){s.writes.push(['next',value]);}};s.studio.runtimeFrame=next;
    const second=loadRuntimeDocument(s.studio,next,'second');await Promise.resolve();
    replies[1].resolve(url);assert.equal(await second,true);replies[0].resolve('vb6://app/preview/'+'2'.repeat(32));
    assert.equal(await first,false);assert.deepEqual(s.writes,[[sameFrame?'src':'next',url]]);
  }
});
test('late native errors cannot stop a restarted preview',async()=>{
  const replies=[deferred(),deferred()];let index=0;const s=fixture(()=>replies[index++].promise);
  const first=loadRuntimeDocument(s.studio,s.frame,'first');await Promise.resolve();
  s.studio.runtimeFrame={isConnected:true};const second=loadRuntimeDocument(s.studio,s.studio.runtimeFrame,'second');await Promise.resolve();
  replies[0].reject(new Error('old failure'));assert.equal(await first,false);assert.deepEqual(s.stops,[]);assert.deepEqual(s.messages,[]);
  replies[1].resolve(url);assert.equal(await second,true);
});
test('native preparation failures and invalid URLs fail closed without snapshot waits or srcdoc fallback',async()=>{
  const invalid=['https://example.test','vb6://evil/preview/'+'1'.repeat(32),'vb6://app/index.html',url+'?x',null];
  for (const prepare of [()=>{throw new Error('bridge failure');},...invalid.map(value=>()=>value)]) {
    const s=fixture(prepare);assert.equal(await loadRuntimeDocument(s.studio,s.frame,'document'),false);
    assert.deepEqual(s.writes,[]);assert.deepEqual(s.stops,[false]);assert.match(s.messages[0],/^Native preview failed: /);
    assert.equal(s.frame.sandbox,'allow-scripts allow-downloads allow-modals');
  }
});
test('the actual IDE run path selects its transport before assigning a document',async()=>{
  const source=await fs.readFile(new URL('../src/ide/main.js',import.meta.url),'utf8');
  assert.match(source,/loadRuntimeDocument\(this,this\.runtimeFrame,exportApplication\(this\.project,/);
  assert.doesNotMatch(source,/this\.runtimeFrame\.srcdoc\s*=/);
  const native=await fs.readFile(new URL('../desktop/studio.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(native,/removeAttribute\(['"]srcdoc/);assert.doesNotMatch(native,/studio\.run\s*=/);
});
