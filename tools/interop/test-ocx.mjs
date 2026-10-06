/** Real installed OCX validation. No remote navigation, registration, or licensed binaries. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {NativeAutomationClient} from './native-automation.mjs';
import {VirtualMachine} from '../../src/runtime/vm.js';
import {compileProject} from '../../src/language/compiler.js';
import {automationInvoke,automationSubscribe} from '../../src/runtime/automation.js';
import {unbox,tagScalar,readScalar,scalarType} from '../../src/runtime/values.js';
const architecture=process.env.VB6_COM_ARCH||'x86',report={architecture,status:'running',checks:[],licensedThirdPartyCertification:false};
const client=new NativeAutomationClient({allowNativeCode:true,allowed:['Shell.Explorer.2'],controls:['Shell.Explorer.2'],architecture});
let session;
async function verifyCompiledCancellation(){
 const native=new NativeAutomationClient({allowNativeCode:true,allowed:['Shell.Explorer.2'],controls:['Shell.Explorer.2'],architecture});
 const code=`Private WithEvents Browser As Object
Public Sub Exercise()
 Set Browser = CreateObject("Shell.Explorer.2")
 Browser.Navigate2 "about:blank"
End Sub
Private Sub Browser_BeforeNavigate2(ByVal pDisp As Object, ByRef URL As Variant, ByRef Flags As Variant, ByRef TargetFrameName As Variant, ByRef PostData As Variant, ByRef Headers As Variant, ByRef Cancel As Boolean)
 Debug.Print VarType(Cancel)
 Cancel = True
 Debug.Print Cancel
 Debug.Print VarType(Browser.ReadyState)
End Sub`;
 const program=compileProject({name:'NativeOcxEvents',startup:'Sub Main',modules:[{kind:'module',name:'MainModule',code:'Sub Main()\nDim w As Worker\nSet w = New Worker\nw.Exercise\nEnd Sub'},{kind:'class',name:'Worker',code}]});
 assert.deepEqual(program.diagnostics,[]);const output=[],vm=new VirtualMachine(program,{automation:native.registry({hostControls:true}),print:value=>output.push(value)});
 try{
  await vm.start();for(let i=0;i<40&&output.length<3;i++)await new Promise(resolve=>setTimeout(resolve,50));
  assert.notEqual(vm.state,'error',vm.lastError?.message);assert.deepEqual(output,['11','True','3']);
  vm.stop();await vm.automationClose;assert.deepEqual(await native.request({op:'info'}),{objects:0,windows:0});
 }finally{vm.stop();await vm.automationClose;await native.close();}
}
try{
 session=client.registry({hostControls:true}).createSession();const object=await session.create('Shell.Explorer.2'),handle=client.handleOf(object);
 const info=await client.controlInfo(handle);assert.equal(info.visible,true);assert.ok(info.events>0);report.checks.push('real OCX activation, event discovery and connection points');
 assert.deepEqual(await client.setControlBounds(handle,420,310),{width:420,height:310});
 assert.equal((await client.setControlVisible(handle,false)).visible,false);assert.equal((await client.setControlVisible(handle,true)).visible,true);
 assert.equal((await client.setControlEnabled(handle,false)).enabled,false);await client.setControlEnabled(handle,true);report.checks.push('native bounds, visibility and enabled state');
 const activation=await client.controlActivationInfo(handle);report.activation={...activation,status:activation.supported?'available':'interface-unavailable'};
 if(activation.supported){
   try{
     assert.equal((await client.setControlFrameActive(handle,true)).active,true);
     assert.equal((await client.setControlDocumentActive(handle,true)).active,true);
     const key=await client.translateControlAccelerator(handle,{kind:'keyUp',code:0x10,scanCode:0x2a});
     assert.ok(key.hresult===0||key.hresult===1);assert.equal(key.translated,key.hresult===0);
     await client.withControlModal(handle,async()=>{
       assert.equal((await client.controlActivationInfo(handle)).modalDepth,1);
       await client.withControlModal(handle,async()=>assert.equal((await client.controlActivationInfo(handle)).modalDepth,2));
       const suppressed=await client.translateControlAccelerator(handle,{kind:'keyDown',code:9});assert.equal(suppressed.suppressed,true);
     });
     assert.equal((await client.controlActivationInfo(handle)).modalDepth,0);
     report.activation.status='passed';report.checks.push('installed OCX active-object accelerator, activation and nested modeless contracts');
   }catch(error){
     // A registered component may expose IOleInPlaceActiveObject but reject an
     // optional method. Do not report native success or swallow other failures.
     if((error.hresult>>>0)!==0x80004001)throw error;
     report.activation={status:'component-method-not-implemented',hresult:error.hresult,certified:false};
     assert.equal((await client.controlActivationInfo(handle)).modalDepth,0);
   }
 }
 const license=await client.licenseInfo('Shell.Explorer.2');assert.equal(typeof license.supported,'boolean');report.licensing=license;report.checks.push('license capabilities queried without extracting any key');
 let count=0,nested=false;const disconnect=automationSubscribe(object,async(name,args)=>{
   if(name.toLowerCase()!=='beforenavigate2')return;
   count++;assert.equal(args.length,7);assert.ok(args[6]?.ref);assert.equal(scalarType(await readScalar(args[6].ref)),'boolean');await args[6].ref.set(tagScalar(-1,'boolean'));
   // Reenter the same STA while the OCX's outgoing call is waiting for cancellation.
   const ready=await automationInvoke(object,'ReadyState',2,[]);assert.equal(typeof unbox(ready),'number');assert.ok(['integer','long'].includes(scalarType(ready)));nested=true;
 });
 await automationInvoke(object,'Navigate2',1,['about:blank']);
 for(let i=0;i<40&&!count;i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.ok(count>0,'BeforeNavigate2 reached the JS event sink');assert.ok(nested,'event handler reentered IDispatch without deadlocking');
 report.checks.push('native outgoing dispatch event and ByRef cancellation with reentrant property get');
 disconnect();
 const descriptor=client.adapters.get(handle).metadata;
 const beforeNavigate=descriptor.events.find(e=>e.name.toLowerCase()==='beforenavigate2');assert.equal(beforeNavigate.params[6].type,'Boolean');assert.equal(beforeNavigate.params[1].type,'Variant');
 if(descriptor.persistStream||descriptor.persistStreamInit){
   try{const saved=await client.saveControlState(handle);assert.equal(typeof saved.data,'string');const loaded=await client.loadControlState(handle,saved.data);assert.ok(loaded.loadedBytes>=0);report.checks.push('native stream state save/load');report.persistence={status:'round-trip-passed'};}
   catch(error){if((error.hresult>>>0)!==0x80004005)throw error;report.persistence={status:'rejected-by-system-component',hresult:error.hresult,roundTripCertified:false};assert.ok((await client.controlInfo(handle)).events>0);report.checks.push('component E_FAIL persistence result is surfaced; host remains usable');}
 }
 else report.persistence='The installed system control exposes no supported stream-persistence interface.';
 await session.close();assert.deepEqual(await client.request({op:'info'}),{objects:0,windows:0});report.checks.push('event unadvise and window/object teardown');
 await verifyCompiledCancellation();report.checks.push('compiled VB WithEvents with ByRef Cancel As Boolean and reentrant typed IDispatch');report.status='passed';
}catch(error){report.error=error.stack||error.message;report.hresult=error.hresult;const hr=error.hresult>>>0;
 if(hr===0x80040154||hr===0x80040112)report.status='skipped-unavailable-or-unlicensed';else{report.status='failed';process.exitCode=1;}
}finally{try{await session?.close();}catch{}await client.close();await fs.mkdir('reports/native-interop',{recursive:true});await fs.writeFile(`reports/native-interop/ocx-${architecture}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
