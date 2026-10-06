/** Host-transport tests; actual COM ABI/behavior is validated by Windows CI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeAutomationClient} from '../tools/interop/native-automation.mjs';
function setup(){
  const client=new NativeAutomationClient({allowNativeCode:true,allowed:['Fixture.Control'],controls:['Fixture.Control']}),requests=[];
  client.request=async request=>{requests.push(request);return {ok:true};};
  return {client,requests};
}
test('active-object messages preserve all eight keyboard kinds without accepting a window handle',async()=>{
  const {client,requests}=setup();
  for(const kind of ['keyDown','keyUp','character','deadCharacter','systemKeyDown','systemKeyUp','systemCharacter','systemDeadCharacter'])await client.translateControlAccelerator('o1',{kind,code:65});
  assert.equal(requests.length,8);assert.equal(requests[0].repeatCount,1);assert.equal(requests[0].scanCode,0);
  assert.ok(requests.every(r=>r.op==='controlTranslateAccelerator'&&r.handle==='o1'&&!('window' in r)));
});
test('active-object message data is detached and explicitly bounded',async()=>{
  const {client,requests}=setup(),message={kind:'systemCharacter',code:65535,repeatCount:65535,scanCode:255,extended:true,altContext:true,wasDown:true};
  await client.translateControlAccelerator('o1',message);message.code=1;
  assert.equal(requests[0].code,65535);assert.equal(requests[0].altContext,true);
  for(const bad of [{code:0},{code:65536},{code:1.5},{kind:'keyDown',code:256},{repeatCount:0},{repeatCount:65536},{scanCode:-1},{scanCode:256},{extended:1},{altContext:null},{wasDown:'yes'}])assert.throws(()=>client.translateControlAccelerator('o1',{kind:'character',code:65,...bad}));
  assert.equal(requests.length,1);
});
test('native accelerator transport rejects pointers, raw messages and fabricated modifier state',()=>{
  const {client,requests}=setup();
  for(const bad of [{window:123},{lParam:0},{wParam:65},{message:0x100},{ctrlKey:true},{shiftKey:true},{kind:'mousemove'},[],null,'keyDown',Object.assign(Object.create({window:5}),{kind:'keyDown',code:65})])assert.throws(()=>client.translateControlAccelerator('o1',Array.isArray(bad)||bad===null||typeof bad!=='object'||Object.getPrototypeOf(bad)!==Object.prototype?bad:{kind:'keyDown',code:65,...bad}));
  assert.equal(requests.length,0);
});
test('frame and document activation are strict Booleans and preserve target identity',async()=>{
  const {client,requests}=setup();await client.controlActivationInfo('o1');await client.setControlFrameActive('o1',true);await client.setControlDocumentActive('o1',false);
  assert.deepEqual(requests,[{op:'controlActivationInfo',handle:'o1'},{op:'controlFrameActivate',handle:'o1',active:true},{op:'controlDocumentActivate',handle:'o1',active:false}]);
  for(const bad of [1,0,'true',null,undefined]){assert.throws(()=>client.setControlFrameActive('o1',bad));assert.throws(()=>client.setControlDocumentActive('o1',bad));}
  assert.equal(requests.length,3);
});
test('accelerator return values and native HRESULT failures are never treated as success implicitly',async()=>{
  const {client}=setup(),reply={translated:false,suppressed:false,hresult:1};client.request=async()=>reply;
  assert.equal(await client.translateControlAccelerator('o1',{kind:'keyDown',code:9}),reply);
  const error=Object.assign(Error('native component failure'),{hresult:-2147467259});client.request=async()=>{throw error;};
  await assert.rejects(client.translateControlAccelerator('o1',{kind:'keyDown',code:9}),e=>e===error);
});
test('modal scope acquires before executing the callback and restores before returning its result',async()=>{
  const {client,requests}=setup();const result=await client.withControlModal('o1',async()=>{assert.equal(requests.length,1);assert.equal(requests[0].enter,true);return 42;});
  assert.equal(result,42);assert.deepEqual(requests,[{op:'controlModalScope',handle:'o1',enter:true},{op:'controlModalScope',handle:'o1',enter:false}]);
});
test('nested modal scopes stay balanced in the native host rather than enabling modeless UI too early',async()=>{
  const {client,requests}=setup();await client.withControlModal('o1',()=>client.withControlModal('o1',()=>5));
  assert.deepEqual(requests.map(r=>r.enter),[true,true,false,false]);
});
test('failed modal acquisition never invokes callback or performs a spurious release',async()=>{
  const {client,requests}=setup(),error=Error('disabled failed');client.request=async r=>{requests.push(r);throw error;};let called=false;
  await assert.rejects(client.withControlModal('o1',()=>called=true),e=>e===error);assert.equal(called,false);assert.equal(requests.length,1);
});
test('failed modal callback restores modeless state and rethrows its original value',async()=>{
  for(const error of [Error('body failed'),null,undefined,0]){const {client,requests}=setup();let caught=false;try{await client.withControlModal('o1',()=>{throw error;});}catch(actual){caught=true;assert.equal(actual,error);}assert.equal(caught,true);assert.deepEqual(requests.map(r=>r.enter),[true,false]);}
});
test('modal callback and restoration failures are both retained in order',async()=>{
  const {client}=setup(),body=Error('body'),restore=Error('restore');client.request=async r=>{if(!r.enter)throw restore;return {};};
  await assert.rejects(client.withControlModal('o1',()=>{throw body;}),error=>error instanceof AggregateError&&error.errors[0]===body&&error.errors[1]===restore);
  await assert.rejects(client.withControlModal('o1',()=>10),error=>error===restore);
});
test('invalid modal callback is rejected before native code is invoked',async()=>{
  const {client,requests}=setup();for(const callback of [null,1,{},false])await assert.rejects(client.withControlModal('o1',callback),/callback/);assert.equal(requests.length,0);
});
