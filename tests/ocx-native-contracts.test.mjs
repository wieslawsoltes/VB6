/** Portable transport contract tests. These do not substitute for Windows COM tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeAutomationClient} from '../tools/interop/native-automation.mjs';
import {OcxEventHub} from '../src/controls/ocx-events.js';
import {OcxPropertyBag} from '../src/controls/ocx-site.js';
import {decodeAutomationValue,encodeAutomationValue} from '../src/runtime/automation-wire.js';
import {tagScalar,scalarType,unbox,VBArray} from '../src/runtime/values.js';
const defaultId='11111111-1234-1234-1234-123456789abc',secondId='22222222-1234-1234-1234-123456789abc',unsupportedId='33333333-1234-1234-1234-123456789abc';
const interfaces=[{iid:defaultId,isDefault:true,supported:true,events:[{name:'Changing',params:[{name:'Cancel',type:'Boolean',byRef:true}]}]},{iid:secondId,isDefault:false,supported:true,events:[{name:'Changed',params:[{name:'Value',type:'Byte',byRef:true}]}]},{iid:unsupportedId,isDefault:false,supported:false,events:[],reason:'vtable'}];
function setup(){
  const client=new NativeAutomationClient({allowNativeCode:true,allowed:['Test.Control'],controls:['Test.Control'],lcid:1045}),requests=[],replies=[];
  client.request=async m=>{requests.push(m);return m.op==='eventInterfaces'?structuredClone(interfaces):{ok:true};};
  client.send=async m=>{replies.push(m);return {returned:true};};return {client,requests,replies};
}
let sequence=0;
const incoming=(values={})=>({token:'e'+(++sequence),handle:'o1',kind:'event',iid:secondId,name:'Changed',args:[{t:'number',vt:17,v:7}],...values});
test('native persistence format selection is explicit and unsupported options never cross transport',async()=>{
  const {client,requests}=setup();for(const format of ['auto','stream','storage','propertyBag','propertyBag2'])await client.saveControlState('o1',{format,saveAll:false});
  assert.deepEqual(requests.map(r=>r.format),['auto','stream','storage','propertyBag','propertyBag2']);for(const format of ['raw',null,1])assert.throws(()=>client.saveControlState('o1',{format}),/Invalid/);assert.equal(requests.length,5);
});
test('native binary persistence preserves legacy stream API and explicit storage envelopes',async()=>{
  const {client,requests}=setup();await client.loadControlState('o1','AAEC');await client.loadControlState('o1',{format:'storage',data:'AAEC'});assert.deepEqual(requests.map(r=>[r.format,r.data]),[['stream','AAEC'],['storage','AAEC']]);
  for(const data of ['!', 'abc', 'ab==', ' aA==','aA==\n','A'.repeat(699056)])assert.throws(()=>client.loadControlState('o1',{format:'storage',data}));assert.equal(requests.length,2);
});
test('native property persistence preserves typed values and array bounds, and detaches caller state',async()=>{
  const {client,requests}=setup(),bag=new OcxPropertyBag();bag.WriteProperty('Cancel',tagScalar(-1,'boolean'));const array=new VBArray([[-2,-1]],'Byte');array.set([-2],4);array.set([-1],5);bag.WriteProperty('Items',array);const state={format:'propertyBag2',properties:bag.Contents.properties};await client.loadControlState('o1',state);state.properties[0].value.v=0;
  const sent=requests[0];assert.equal(sent.format,'propertyBag2');assert.deepEqual(sent.properties[0].value,{t:'boolean',v:true});const restored=decodeAutomationValue(sent.properties[1].value);assert.deepEqual(restored.bounds,[[-2,-1]]);assert.deepEqual(restored.data,[4,5]);
});
test('native property persistence rejects duplicate names, embedded object handles and oversized payloads before IPC',()=>{
  const {client,requests}=setup();for(const properties of [[{name:'X',value:{t:'object',id:'o2'}}],[{name:'X',value:{t:'number',v:1}},{name:'x',value:{t:'number',v:2}}],[{name:'Bad\0Name',value:{t:'empty'}}],[{name:'Text',value:{t:'string',v:'x'.repeat(530000)}}]])assert.throws(()=>client.loadControlState('o1',{format:'propertyBag',properties}));assert.deepEqual(requests,[]);
});
test('native persistence rejection is propagated and never retried in another format',async()=>{
  const {client}=setup(),calls=[];client.request=async m=>{calls.push(m);throw Object.assign(Error('native partial write'),{hresult:-2147467259});};await assert.rejects(client.saveControlState('o1'),/partial write/);assert.equal(calls.length,1);assert.equal(calls[0].format,'auto');
});
test('native host flags and mnemonic inputs reject truthy strings, NUL, and surrogate pairs',async()=>{
  const {client,requests}=setup();await client.setControlDesignMode('o1',true);await client.freezeControlEvents('o1',false);await client.sendControlMnemonic('o1','Ź');await client.controlKeyboardInfo('o1');
  for(const value of [1,-1,'true',null]){assert.throws(()=>client.setControlDesignMode('o1',value));assert.throws(()=>client.freezeControlEvents('o1',value));}for(const value of ['', '\0', 'ab','😀'])assert.throws(()=>client.sendControlMnemonic('o1',value));assert.deepEqual(requests.map(r=>r.op),['controlDesignMode','controlFreezeEvents','controlMnemonic','controlKeyboardInfo']);assert.equal(requests[2].character,377);
});
test('native ambient payload uses validated OLE values and normalized detached font data',async()=>{
  const {client,requests}=setup(),font={Name:'Arial',Size:11,Bold:true};await client.setControlAmbient('o1',{BackColor:0x8000000f,Font:font});font.Name='Changed';assert.equal(requests[0].properties.Font.Name,'Arial');assert.equal(requests[0].properties.Font.Bold,-1);assert.equal(requests[0].properties.Font.Weight,700);
  for(const properties of [{LocaleID:1033},{Font:{Size:-1}},{BackColor:2**32},{UserMode:0}])assert.throws(()=>client.setControlAmbient('o1',properties));assert.equal(requests.length,1);
});
test('outgoing interface metadata rejects unsupported ABI sinks without sending an advise',async()=>{
  const {client,requests}=setup();await assert.rejects(client.subscribeInterface('o1',unsupportedId,()=>{}),/unsupported/);await assert.rejects(client.subscribeInterface('o1','bad',()=>{}),/IID/);assert.equal(requests.filter(r=>r.op==='adviseInterface').length,0);
});
test('multiple IID subscribers share typed copyback and only the last disconnect retires the native IID',async()=>{
  const {client,requests,replies}=setup(),log=[];const first=await client.subscribeInterface('o1',secondId,(name,args)=>{log.push(name);assert.equal(scalarType(args[0].ref.getScalar()),'byte');args[0].ref.set(12);});const second=await client.subscribeInterface('o1','{'+secondId+'}',(name,args)=>{log.push(args[0].ref.get());});
  await client.receiveEvent(incoming());assert.deepEqual(log,['Changed',12]);assert.deepEqual(replies[0].args,[{t:'number',vt:17,v:12}]);await first();assert.equal(requests.filter(r=>r.op==='unadviseInterface').length,0);await second();await second();assert.equal(requests.filter(r=>r.op==='unadviseInterface').length,1);assert.equal(client.activeEvents.size,0);
});
test('unsubscribing default-interface helper does not tear down the VM subscription',async()=>{
  const {client,requests}=setup();const disconnect=await client.subscribeInterface('o1',defaultId,()=>{});await disconnect();assert.equal(requests.filter(r=>r.op==='unadviseInterface').length,0);
});
test('failed advise rolls back just its cookie, retaining older live subscriptions',async()=>{
  const {client,replies}=setup();let calls=0,fired=0;const original=client.request;client.request=async m=>{if(m.op==='adviseInterface'&&++calls===2)throw Error('advise failure');return original(m);};await client.subscribeInterface('o1',secondId,()=>fired++);await assert.rejects(client.subscribeInterface('o1',secondId,()=>{throw Error('leaked');}),/advise failure/);await client.receiveEvent(incoming());assert.equal(fired,1);assert.equal(replies[0].error,undefined);
});
test('secondary IID events do not enter the default WithEvents sink',async()=>{
  const {client,replies}=setup();let defaults=0,secondary=0;client.adapters.set('o1',{metadata:{events:[{iid:defaultId}]}});client.eventHandlers.set('o1',{decode:w=>decodeAutomationValue(w,{preserveScalars:true}),handler:(name,args)=>{defaults++;return {args};}});await client.subscribeInterface('o1',secondId,()=>secondary++);await client.receiveEvent(incoming());assert.equal(defaults,0);assert.equal(secondary,1);assert.equal(replies[0].error,undefined);
});
test('default WithEvents and host IID subscriptions share ordered typed cancellation',async()=>{
  const {client,replies}=setup(),log=[];client.adapters.set('o1',{metadata:{events:[{iid:defaultId}]}});client.eventHandlers.set('o1',{decode:w=>decodeAutomationValue(w,{preserveScalars:true}),handler:(name,args)=>{log.push('vm');return {args:[tagScalar(-1,'boolean')]};}});
  await client.subscribeInterface('o1',defaultId,(name,args)=>{log.push('host');assert.equal(args[0].ref.get(),-1);});await client.receiveEvent(incoming({iid:defaultId,name:'Changing',args:[{t:'boolean',v:false}]}));assert.deepEqual(log,['vm','host']);assert.deepEqual(replies[0].args,[{t:'boolean',v:true}]);
});
test('native copyback error is returned to the waiting host instead of aborting other subscriptions',async()=>{
  const {client,replies}=setup();await client.subscribeInterface('o1',secondId,(_,args)=>args[0].ref.set(300));await client.receiveEvent(incoming());assert.match(replies[0].error,/Overflow/);assert.deepEqual(replies[0].args,[{t:'number',vt:17,v:7}]);assert.equal(client.closed,false);assert.equal(client.activeEvents.size,0);
});
test('native property notifications aggregate veto decisions and retire the last observer exactly once',async()=>{
  const {client,requests,replies}=setup(),log=[];const first=await client.observeControlProperties('o1',{requestEdit:async id=>{log.push(id);return true;},changed:id=>log.push('changed:'+id)});const second=await client.observeControlProperties('o1',{requestEdit:()=>false});
  await client.receiveEvent(incoming({kind:'property',iid:null,name:'RequestEdit',args:[{t:'number',vt:3,v:7},{t:'boolean',v:true}]}));assert.deepEqual(replies[0].args,[{t:'number',vt:3,v:7},{t:'boolean',v:false}]);await client.receiveEvent(incoming({kind:'property',iid:null,name:'Changed',args:[{t:'number',vt:3,v:7}]}));assert.deepEqual(log,[7,'changed:7']);
  await first();assert.equal(requests.filter(r=>r.op==='stopObservingProperties').length,0);await second();await second();assert.equal(requests.filter(r=>r.op==='stopObservingProperties').length,1);
});
test('property observer failures travel as errors and aborted registration leaves no live observer',async()=>{
  const {client,replies}=setup();client.request=async()=>{throw Error('no property connection point');};await assert.rejects(client.observeControlProperties('o1',{changed(){throw Error('retired');}}),/connection/);assert.equal(client.propertyObservers.get('o1').size,0);
  client.request=async()=>({});await client.observeControlProperties('o1',{requestEdit:()=>{throw Error('validate');}});await client.receiveEvent(incoming({kind:'property',name:'RequestEdit',args:[{t:'number',vt:3,v:1},{t:'boolean',v:true}]}));assert.match(replies[0].error,/validate/);assert.equal(client.closed,false);
});
test('native reentrant interface handlers preserve the incoming event token on nested host calls',async()=>{
  const {client,replies}=setup();await client.subscribeInterface('o1',secondId,async()=>{await NativeAutomationClient.prototype.request.call(client,{op:'controlInfo',handle:'o1'});});const e=incoming();await client.receiveEvent(e);assert.equal(replies[0].op,'controlInfo');assert.equal(replies[0].eventToken,e.token);assert.equal(replies[1].op,'eventReturn');assert.equal(replies[1].eventToken,e.token);
});
test('abort clears host-side event subscriptions, observers and supplied license data',async()=>{
  const {client}=setup();await client.subscribeInterface('o1',secondId,()=>{});await client.observeControlProperties('o1',{changed:()=>{}});client.eventHandlers.set('o1',{});client.licenseKeys.set('test.control','private');let killed=0;client.child={kill(){killed++;}};client.abort(Error('closed'));assert.equal(killed,1);assert.equal(client.closed,true);assert.equal(client.interfaceHubs.size,0);assert.equal(client.eventHandlers.size,0);assert.equal(client.propertyObservers.size,0);assert.equal(client.licenseKeys.size,0);
});
test('malformed native event identity aborts rather than invoking a subscriber',()=>{
  for(const value of [incoming({token:'bad'}),incoming({handle:'other'}),incoming({kind:'unknown'}),incoming({args:new Array(65).fill({t:'empty'})})]){const {client}=setup();client.receiveEvent(value);assert.equal(client.closed,true);}
});

test('native persistent data names may contain dots/spaces and never mutate JavaScript prototypes',async()=>{
 const {client,requests}=setup();const properties=[{name:'Font.Name',value:{t:'string',v:'Arial'}},{name:'Custom value',value:{t:'number',vt:3,v:12}},{name:'__proto__',value:{t:'string',v:'data-only'}}];
 await client.loadControlState('o1',{format:'propertyBag2',properties});assert.deepEqual(requests[0].properties,properties);assert.equal(Object.prototype['data-only'],undefined);assert.equal(requests[0].lcid,1045);
});


test('host exit cleanup retires maps without killing an already exited child',async()=>{
 const {client}=setup();await client.subscribeInterface('o1',secondId,()=>{});await client.observeControlProperties('o1',{changed(){}});client.adapters.set('o1',{});client.session={};client.licenseKeys.set('fixture','key');client.activeEvents.add('e1');let killed=0,rejected;client.child={kill(){killed++;}};
 client.pending.set(1,{timer:setTimeout(()=>{},10000),reject:e=>rejected=e});const error=Error('process exited');client.abort(error,false);
 assert.equal(killed,0);assert.equal(rejected,error);assert.equal(client.pending.size,0);assert.equal(client.adapters.size,0);assert.equal(client.interfaceHubs.size,0);assert.equal(client.propertyObservers.size,0);assert.equal(client.activeEvents.size,0);assert.equal(client.licenseKeys.size,0);assert.equal(client.session,null);
});


test('native font weights fail explicitly rather than silently mapping unsupported weights',async()=>{
  const {client,requests}=setup();
  for(const Font of [{Weight:600},{Weight:900},{Weight:700,Bold:false},{Weight:400,Bold:true}])assert.throws(()=>client.setControlAmbient('o1',{Font}),/font weights/);
  assert.equal(requests.length,0);
  await client.setControlAmbient('o1',{Font:{Weight:700}});assert.equal(requests[0].properties.Font.Bold,-1);
  await client.setControlAmbient('o1',{Font:{Weight:400}});assert.equal(requests[1].properties.Font.Bold,0);
});
