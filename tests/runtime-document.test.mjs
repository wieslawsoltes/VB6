import test from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntimeDocument} from '../src/ide/runtime-document.js';
import {createNativeRuntimeDocumentLoader} from '../desktop/runtime-document.mjs';

const URL = 'vb6://app/preview/' + '1a'.repeat(16);
function deferred() { let resolve, reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
function fixture(loader) {
  const writes=[],errors=[];let active=true;
  const frame={isConnected:true,removeAttribute:name=>writes.push(['remove',name]),
    set src(value){writes.push(['src',value]);},set srcdoc(value){writes.push(['srcdoc',value]);}};
  const ide=loader?{runtimeDocumentLoader:loader}:{};
  const load=html=>loadRuntimeDocument(ide,frame,html,{isCurrent:()=>active,onError:error=>errors.push(error.message)});
  return {ide,frame,writes,errors,load,retire:()=>{active=false;}};
}
test('browser runtimes retain synchronous srcdoc loading',()=>{
  const f=fixture();assert.equal(f.load('<p>browser</p>'),undefined);
  assert.deepEqual(f.writes,[['srcdoc','<p>browser</p>']]);assert.deepEqual(f.errors,[]);
});
test('native document approval precedes all navigation, without transient srcdoc',async()=>{
  const d=deferred(),calls=[];const f=fixture(html=>{calls.push(html);return d.promise;});
  const loading=f.load('<script>runtime</script>');assert.deepEqual(calls,['<script>runtime</script>']);assert.deepEqual(f.writes,[]);
  d.resolve(URL);await loading;assert.deepEqual(f.writes,[['remove','srcdoc'],['src',URL]]);assert.deepEqual(f.errors,[]);
});
test('synchronous embedding loaders use the same checked completion path',async()=>{
  const f=fixture(()=>URL);await f.load('runtime');assert.deepEqual(f.writes,[['remove','srcdoc'],['src',URL]]);
});
test('retired sessions ignore a late successful native response',async()=>{
  const d=deferred(),f=fixture(()=>d.promise);const loading=f.load('old');f.retire();d.resolve(URL);await loading;
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);
});
test('removed frames ignore native responses even before session fields are cleared',async()=>{
  const d=deferred(),f=fixture(()=>d.promise);const loading=f.load('old');f.frame.isConnected=false;d.resolve(URL);await loading;
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);
});
test('late failed approval cannot reset or report errors against a replacement run',async()=>{
  const d=deferred(),f=fixture(()=>d.promise);const loading=f.load('old');f.retire();d.reject(new Error('old failure'));await loading;
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);
});
test('detached frames ignore a late failed approval',async()=>{
  const d=deferred(),f=fixture(()=>d.promise);const loading=f.load('old');f.frame.isConnected=false;d.reject(new Error('old failure'));await loading;
  assert.deepEqual(f.writes,[]);assert.deepEqual(f.errors,[]);
});
test('disconnected and already-retired sessions do not request native documents',()=>{
  let calls=0;const f=fixture(()=>{calls++;return URL;});f.frame.isConnected=false;f.load('one');f.frame.isConnected=true;f.retire();f.load('two');assert.equal(calls,0);
});
test('active asynchronous approval failure is reported with no srcdoc fallback',async()=>{
  const f=fixture(()=>Promise.reject(new Error('host refused')));await f.load('runtime');assert.deepEqual(f.errors,['host refused']);assert.deepEqual(f.writes,[]);
});
test('active synchronous approval failure is reported with no srcdoc fallback',()=>{
  const f=fixture(()=>{throw new Error('host unavailable');});f.load('runtime');assert.deepEqual(f.errors,['host unavailable']);assert.deepEqual(f.writes,[]);
});
test('malformed successful host responses do not navigate the application',async()=>{
  for(const url of [null,undefined,'',{},42]) { const f=fixture(()=>url);await f.load('runtime');assert.deepEqual(f.errors,['Runtime host returned an invalid document URL']);assert.deepEqual(f.writes,[]); }
});
test('native loader preserves the bridge receiver and original HTML',async()=>{
  const bridge={calls:0,async runtimeDocument(html){this.calls++;assert.equal(html,'<p>π</p>');return URL;}};
  assert.equal(await createNativeRuntimeDocumentLoader(bridge)('<p>π</p>'),URL);assert.equal(bridge.calls,1);
});
test('native loader rejects privileged assets, alternate authorities and untrusted destinations',async()=>{
  for(const url of ['vb6://app/index.html','vb6://app/preview/no','vb6://evil/preview/'+'1a'.repeat(16),
    URL+'?x=1',URL+'#x',URL+'\n','vb6://user@app/preview/'+'1a'.repeat(16),
    'vb6://app:123/preview/'+'1a'.repeat(16),'https://example.test/','data:text/html,evil','about:blank',{},null]) {
    await assert.rejects(createNativeRuntimeDocumentLoader({runtimeDocument:async()=>url})('test'),/invalid preview URL/);
  }
});
test('native bridge refusal is not replaced with a less restrictive document',async()=>{
  await assert.rejects(createNativeRuntimeDocumentLoader({runtimeDocument:async()=>{throw new Error('forbidden');}})('test'),/forbidden/);
});
test('a missing native bridge is diagnosed at installation',()=>{
  for(const bridge of [null,{}, {runtimeDocument:true}])assert.throws(()=>createNativeRuntimeDocumentLoader(bridge),/unavailable/);
});
