/** Optional installed Windows system-control probe; never loads a remote page. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {NativeAutomationClient} from './native-automation.mjs';
const client=new NativeAutomationClient({allowNativeCode:true,allowed:['Shell.Explorer.2'],controls:['Shell.Explorer.2'],architecture:process.env.VB6_COM_ARCH||'x86'});
const report={component:'Shell.Explorer.2',architecture:client.architecture,licensedVB6:false,status:'failed',checks:[]};
const started=Date.now();
try{
 await client.start();report.startupMs=Date.now()-started;
 const control=await client.request({op:'create',progId:'Shell.Explorer.2',preview:true});
 assert.equal((await client.request({op:'info'})).windows,1);report.checks.push('real AxHost window created');
 assert.ok(control.metadata.members.length>0);report.checks.push('native dispatch type information inspected');
 // Property operations are metadata-gated; no Navigate call or network content.
 if(control.metadata.members.some(m=>m.name.toLowerCase()==='silent')){await client.request({op:'call',handle:control.id,member:'Silent',mode:4,args:[{t:'boolean',v:true}]});report.checks.push('native control property put');}
 await new Promise(r=>setTimeout(r,100));assert.equal((await client.request({op:'info'})).windows,1);report.checks.push('idle STA message pump remains live');
 await client.request({op:'release',handle:control.id});assert.deepEqual(await client.request({op:'info'}),{objects:0,windows:0});report.checks.push('window and native handle released');report.status='passed';
}catch(error){report.error=error.message;report.hresult=error.hresult;report.code=error.code;report.operation=error.operation;const hr=error.hresult>>>0;if(hr===0x80040154||hr===0x80040112){report.status='skipped-unavailable-or-unlicensed';console.log('System ActiveX control unavailable; no preview certification claimed.');}else process.exitCode=1;
}finally{report.diagnostics=client.diagnostics();report.elapsedMs=Date.now()-started;await client.close();await fs.mkdir('reports/native-interop',{recursive:true});await fs.writeFile(`reports/native-interop/activex-${client.architecture}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
