import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadRuntimeDocument} from '../src/ide/runtime-document.js';
import {createNativeRuntimeDocumentLoader} from '../desktop/runtime-document.mjs';
const url = 'vb6://app/preview/' + 'a'.repeat(32);
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(runtimeDocument) {
  const requests=[],stops=[],messages=[];
  const frame={isConnected:true,src:'',removeAttribute:()=>{},set srcdoc(_) {throw Error('Native preview must never start srcdoc');}};
  const studio={runtimeFrame:frame,stop:capture=>{stops.push(capture);studio.runtimeFrame=null;},status:message=>messages.push(message)};
  studio.runtimeDocumentLoader=createNativeRuntimeDocumentLoader({runtimeDocument:html=>{requests.push(html);return runtimeDocument(html);}});
  const load=(frame,html)=>loadRuntimeDocument(studio,frame,html,{
    isCurrent:()=>studio.runtimeFrame===frame,
    onError:error=>{studio.stop(false);studio.status(error.message);}
  });
  return {studio,frame,load,requests,stops,messages};
}

test('combined native preview adapters register before navigating without a srcdoc attempt',async()=>{
  const request=defer(),s=setup(()=>request.promise),html='<html><script>test()</script></html>';
  const ready=s.load(s.frame,html);
  assert.equal(s.frame.src,'');assert.deepEqual(s.requests,[html]);
  request.resolve(url);await ready;assert.equal(s.frame.src,url);
  assert.deepEqual(s.stops,[]);assert.deepEqual(s.messages,[]);
});
test('combined loader cannot navigate a frame removed while host approval was pending',async()=>{
  const request=defer(),s=setup(()=>request.promise);
  const ready=s.load(s.frame,'old');s.frame.isConnected=false;s.studio.runtimeFrame=null;
  request.resolve(url);await ready;assert.equal(s.frame.src,'');
});
test('old native registration cannot replace a newer run document',async()=>{
  const first=defer(),second=defer(),s=setup(html=>html==='first'?first.promise:second.promise);
  const old=s.load(s.frame,'first');const newer={isConnected:true,src:'',removeAttribute:()=>{}};s.studio.runtimeFrame=newer;
  const next=s.load(newer,'second');second.resolve(url);await next;
  first.resolve('vb6://app/preview/'+'b'.repeat(32));await old;
  assert.equal(s.frame.src,'');assert.equal(newer.src,url);
});
test('rejected old approval cannot stop or report failure against a newer native run',async()=>{
  const request=defer(),s=setup(()=>request.promise);
  const ready=s.load(s.frame,'old');s.studio.runtimeFrame={isConnected:true,src:''};
  request.reject(Error('obsolete'));await ready;assert.deepEqual(s.stops,[]);assert.deepEqual(s.messages,[]);
});
for(const bad of ['https://example.com/', 'vb6://evil/preview/'+'a'.repeat(32), 'vb6://app/index.html', 'vb6://app/preview/'+'a'.repeat(32)+'#x', null])
  test('combined native preview adapters reject unexpected URL '+bad,async()=>{
    const s=setup(()=>bad);await s.load(s.frame,'source');
    assert.equal(s.frame.src,'');assert.deepEqual(s.stops,[false]);assert.match(s.messages[0],/invalid preview URL/i);
  });
test('synchronous native bridge failure is caught without an unhandled rejection',async()=>{
  const s=setup(()=>{throw Error('transport down');});
  await s.load(s.frame,'source');assert.deepEqual(s.stops,[false]);assert.match(s.messages[0],/transport down/);
});
test('asynchronous native rejection reports only while that run remains current',async()=>{
  const request=defer(),s=setup(()=>request.promise);
  const ready=s.load(s.frame,'current');request.reject(Error('registration failed'));
  await ready;assert.deepEqual(s.stops,[false]);assert.match(s.messages[0],/registration failed/);
});
test('retired native sessions do not invoke the host bridge',()=>{
  const s=setup(()=>{throw Error('must not be called');});s.studio.runtimeFrame=null;
  assert.equal(s.load(s.frame,'old'),undefined);assert.deepEqual(s.requests,[]);
});
test('F5 and Immediate use the same approved loader without a transient direct srcdoc assignment',async()=>{
  for(const [path,pattern] of [['../src/ide/main.js',/loadRuntimeDocument\(this,frame,/],['../src/ide/design-immediate.js',/loadRuntimeDocument\(this.ide,frame,/]]) {
    const source=await fs.readFile(new URL(path,import.meta.url),'utf8');
    assert.match(source,pattern);assert.doesNotMatch(source,/this\.(?:runtimeFrame|frame)\.srcdoc\s*=/);
  }
  const desktop=await fs.readFile(new URL('../desktop/studio.mjs',import.meta.url),'utf8');
  assert.match(desktop,/studio\.runtimeDocumentLoader = createNativeRuntimeDocumentLoader/);
  assert.doesNotMatch(desktop,/studio\.run\s*=/);
});
