/** Real installed OCX validation. No remote navigation, registration, or licensed binaries. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {NativeAutomationClient} from './native-automation.mjs';
import {automationInvoke,automationSubscribe} from '../../src/runtime/automation.js';
const architecture=process.env.VB6_COM_ARCH||'x86',report={architecture,status:'running',checks:[],licensedThirdPartyCertification:false};
const client=new NativeAutomationClient({allowNativeCode:true,allowed:['Shell.Explorer.2'],controls:['Shell.Explorer.2'],architecture});
let session;
try{
 session=client.registry({hostControls:true}).createSession();const object=await session.create('Shell.Explorer.2'),handle=client.handleOf(object);
 const info=await client.controlInfo(handle);assert.equal(info.visible,true);assert.ok(info.events>0);report.checks.push('real OCX activation, event discovery and connection points');
 assert.deepEqual(await client.setControlBounds(handle,420,310),{width:420,height:310});
 assert.equal((await client.setControlVisible(handle,false)).visible,false);assert.equal((await client.setControlVisible(handle,true)).visible,true);
 assert.equal((await client.setControlEnabled(handle,false)).enabled,false);await client.setControlEnabled(handle,true);report.checks.push('native bounds, visibility and enabled state');
 const license=await client.licenseInfo('Shell.Explorer.2');assert.equal(typeof license.supported,'boolean');report.licensing=license;report.checks.push('license capabilities queried without extracting any key');
 let count=0,nested=false;const disconnect=automationSubscribe(object,async(name,args)=>{
   if(name.toLowerCase()!=='beforenavigate2')return;
   count++;assert.equal(args.length,7);assert.ok(args[6]?.ref);await args[6].ref.set(-1);
   // Reenter the same STA while the OCX's outgoing call is waiting for cancellation.
   const ready=await automationInvoke(object,'ReadyState',2,[]);assert.equal(typeof ready,'number');nested=true;
 });
 await automationInvoke(object,'Navigate2',1,['about:blank']);
 for(let i=0;i<40&&!count;i++)await new Promise(resolve=>setTimeout(resolve,50));
 assert.ok(count>0,'BeforeNavigate2 reached the JS event sink');assert.ok(nested,'event handler reentered IDispatch without deadlocking');
 report.checks.push('native outgoing dispatch event and ByRef cancellation with reentrant property get');
 disconnect();
 const descriptor=client.adapters.get(handle).metadata;
 if(descriptor.persistStream||descriptor.persistStreamInit){
   try{const saved=await client.saveControlState(handle);assert.equal(typeof saved.data,'string');const loaded=await client.loadControlState(handle,saved.data);assert.ok(loaded.loadedBytes>=0);report.checks.push('native stream state save/load');report.persistence={status:'round-trip-passed'};}
   catch(error){if((error.hresult>>>0)!==0x80004005)throw error;report.persistence={status:'rejected-by-system-component',hresult:error.hresult,roundTripCertified:false};assert.ok((await client.controlInfo(handle)).events>0);report.checks.push('component E_FAIL persistence result is surfaced; host remains usable');}
 }
 else report.persistence='The installed system control exposes no supported stream-persistence interface.';
 await session.close();assert.deepEqual(await client.request({op:'info'}),{objects:0,windows:0});report.checks.push('event unadvise and window/object teardown');report.status='passed';
}catch(error){report.error=error.stack||error.message;report.hresult=error.hresult;const hr=error.hresult>>>0;
 if(hr===0x80040154||hr===0x80040112)report.status='skipped-unavailable-or-unlicensed';else{report.status='failed';process.exitCode=1;}
}finally{try{await session?.close();}catch{}await client.close();await fs.mkdir('reports/native-interop',{recursive:true});await fs.writeFile(`reports/native-interop/ocx-${architecture}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
