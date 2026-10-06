import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {installNativePreview} from '../desktop/studio.mjs';
const url = 'vb6://app/preview/' + 'a'.repeat(32);
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(runtimeDocument) {
  const requests=[],stops=[],messages=[];
  const frame={isConnected:true,src:'',set srcdoc(_) {throw Error('Native preview must never start srcdoc');}};
  const studio={runtimeFrame:frame,stop:async capture=>{stops.push(capture);studio.runtimeFrame=null;},status:message=>messages.push(message)};
  installNativePreview(studio,{runtimeDocument:html=>{requests.push(html);return runtimeDocument(html);}});
  return {studio,frame,requests,stops,messages};
}

test('native preview is registered first and navigates once without a srcdoc attempt',async()=>{
  const request=defer(),s=setup(()=>request.promise),html='<html><script>test()</script></html>';
  const ready=s.studio.loadRuntimeDocument(s.frame,html);
  assert.equal(s.frame.src,'');assert.equal(s.studio.nativePreviewReady,ready);
  await Promise.resolve();assert.deepEqual(s.requests,[html]);
  request.resolve(url);assert.equal(await ready,true);assert.equal(s.frame.src,url);
  assert.deepEqual(s.stops,[]);assert.deepEqual(s.messages,[]);
});
test('stopping before document registration resolves cannot navigate the removed frame',async()=>{
  const request=defer(),s=setup(()=>request.promise);
  const ready=s.studio.loadRuntimeDocument(s.frame,'old');s.frame.isConnected=false;s.studio.runtimeFrame=null;
  request.resolve(url);assert.equal(await ready,false);assert.equal(s.frame.src,'');
});
test('old registration cannot replace a newer run document',async()=>{
  const first=defer(),second=defer(),s=setup(html=>html==='first'?first.promise:second.promise);
  const old=s.studio.loadRuntimeDocument(s.frame,'first');const newer={isConnected:true,src:''};s.studio.runtimeFrame=newer;
  const next=s.studio.loadRuntimeDocument(newer,'second');second.resolve(url);assert.equal(await next,true);
  first.resolve('vb6://app/preview/'+'b'.repeat(32));assert.equal(await old,false);
  assert.equal(s.frame.src,'');assert.equal(newer.src,url);assert.equal(s.studio.nativePreviewReady,next);
});
test('rejected old registration cannot stop or report failure against a newer run',async()=>{
  const request=defer(),s=setup(()=>request.promise);
  const ready=s.studio.loadRuntimeDocument(s.frame,'old');s.studio.runtimeFrame={isConnected:true,src:''};
  request.reject(Error('obsolete'));assert.equal(await ready,false);assert.deepEqual(s.stops,[]);assert.deepEqual(s.messages,[]);
});
for(const bad of ['https://example.com/', 'vb6://evil/preview/'+'a'.repeat(32), 'vb6://app/index.html', 'vb6://app/preview/'+'a'.repeat(32)+'#x', null])
  test('native preview rejects unexpected URL '+bad,async()=>{
    const s=setup(()=>bad);assert.equal(await s.studio.loadRuntimeDocument(s.frame,'source'),false);
    assert.equal(s.frame.src,'');assert.deepEqual(s.stops,[false]);assert.match(s.messages[0],/Invalid native preview document URL/);
  });
test('synchronous bridge failure is reported without an unhandled rejection or dead snapshot wait',async()=>{
  const s=setup(()=>{throw Error('transport down');});
  assert.equal(await s.studio.loadRuntimeDocument(s.frame,'source'),false);assert.deepEqual(s.stops,[false]);
  assert.match(s.messages[0],/transport down/);
});
test('asynchronous registration failure reports only while that run remains current',async()=>{
  const request=defer(),s=setup(()=>request.promise);
  const ready=s.studio.loadRuntimeDocument(s.frame,'current');request.reject(Error('registration failed'));
  assert.equal(await ready,false);assert.deepEqual(s.stops,[false]);assert.match(s.messages[0],/registration failed/);
});
test('a new run started during stop is not overwritten by an old status message',async()=>{
  const s=setup(()=>{throw Error('old');});
  s.studio.stop=async()=>{s.studio.runtimeFrame={isConnected:true};};
  assert.equal(await s.studio.loadRuntimeDocument(s.frame,'old'),false);assert.deepEqual(s.messages,[]);
});
test('the IDE chooses its preview loader before setting any srcdoc and retains a browser default',async()=>{
  const source=await fs.readFile(new URL('../src/ide/main.js',import.meta.url),'utf8');
  const run=source.slice(source.indexOf('  run(breakOnEntry='),source.indexOf('  requestRuntime('));
  assert.match(run,/this\.loadRuntimeDocument\(this\.runtimeFrame,exportApplication\(/);
  assert.doesNotMatch(run,/this\.runtimeFrame\.srcdoc\s*=/);
  assert.match(run,/loadRuntimeDocument\(frame,html\)\{frame\.srcdoc=html;\}/);
});
