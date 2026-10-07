/** Real Windows COM/OLE contracts; a non-Windows invocation fails, never passes/skips. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {NativeComOleClient} from './native-com-ole.mjs';
import {IID,HRESULT} from '../../packages/com-ole/src/contracts.js';
import {VirtualMachine} from '../../src/runtime/vm.js';
import {compileProject} from '../../src/language/compiler.js';
const architecture=process.env.VB6_COM_ARCH||'x86';
if(process.platform!=='win32')throw Error('Real COM/OLE validation requires Windows; this host has not passed.');
const checks=[],report={architecture,status:'failed',checks,thirdPartyCertification:false};
const client=new NativeComOleClient({allowed:[],allowNativeCode:true,architecture});
const check=(name,fn)=>{fn();checks.push(name);},f=(cfFormat,tymed=1,extra={})=>({cfFormat,tymed,...extra});
try{
  const info=await client.start();check('real Windows STA and requested bitness',()=>{assert.equal(info.bitness,architecture==='x86'?32:64);assert.equal(info.apartment,'STA');});
  for(const request of [{op:'create',progId:'Scripting.Dictionary'},{op:'com.getActive',progId:'Scripting.Dictionary'},{op:'ole.clipboardGet'},{op:'ole.clipboardSet',handle:null},{op:'ole.clipboardFlush'}]){await assert.rejects(client.request(request));checks.push('server-side default denial: '+request.op);}
  const {cfFormat}=await client.registerClipboardFormat('VB6 COM/OLE test '+process.pid);
  check('real registered clipboard-format name',()=>assert.equal(typeof cfFormat,'number'));assert.equal((await client.clipboardFormatName(cfFormat)).name,'VB6 COM/OLE test '+process.pid);
  const data=await client.createDataObject();
  const qi=await client.queryInterfaces(data,[IID.IUnknown,IID.IDataObject,'33333333-3333-3333-3333-333333333333']);check('real QI identity and unsupported IID HRESULT',()=>{assert(qi[0].supported&&qi[0].sameIdentity);assert(qi[1].supported&&qi[1].sameIdentity);assert.equal(qi[2].hresult,HRESULT.E_NOINTERFACE);});
  const bytes=new Uint8Array(Array.from({length:16},(_,i)=>i));
  for(const tymed of [1,4]){
    const format=f(cfFormat,tymed);await client.setData(data,format,bytes);const out=await client.getData(data,format);check('native medium round trip '+tymed,()=>assert.deepEqual(out.data.slice(0,bytes.length),bytes));
    const here=await client.getDataHere(data,format,new Uint8Array(32).fill(99));check('native GetDataHere '+tymed,()=>{assert.deepEqual(here.data.slice(0,16),bytes);assert(here.data.slice(16,32).every(x=>x===99));});
    assert.equal((await client.queryData(data,format)).hresult,0);
  }
  const formats=await client.dataFormats(data);check('native FORMATETC enumeration',()=>{assert.equal(formats.length,2);assert(formats.every(x=>x.cfFormat===cfFormat&&x.ptd==null));});
  for(const [request,expected]of [[f(1),HRESULT.DV_E_FORMATETC],[f(cfFormat,1,{dwAspect:4}),HRESULT.DV_E_DVASPECT],[f(cfFormat,1,{lindex:1}),HRESULT.DV_E_LINDEX]]){const result=await client.queryData(data,request);check('precise data negotiation '+expected,()=>assert.equal(result.hresult,expected));}
  const once=await client.adviseData(data,f(cfFormat,4),2|4);const first=await client.drainEvents();check('native IDataAdviseHolder PRIMEFIRST/ONLYONCE',()=>{assert.equal(first.notifications.filter(x=>x.connection===once.connection).length,1);assert.deepEqual(first.notifications.find(x=>x.connection===once.connection).data,bytes);});await client.unadviseData(once.connection);
  const nodata=await client.adviseData(data,f(cfFormat),1);await client.setData(data,f(cfFormat),bytes);const change=await client.drainEvents();check('native NODATA advisory snapshot',()=>{const row=change.notifications.find(x=>x.connection===nodata.connection);assert(row);assert.equal(row.tymed,0);});await client.unadviseData(nodata.connection);
  const stop=await client.adviseData(data,f(cfFormat,4),64);await client.releaseHandle(data.id);const final=await client.drainEvents();check('native DATAONSTOP and deterministic advisory cleanup',()=>assert(final.notifications.some(x=>x.connection===stop.connection)));
  const tree={classId:'11111111-1111-1111-1111-111111111111',entries:[{name:'\u0001CompObj',type:'stream',data:bytes},{name:'日本語',type:'storage',entries:[{name:'Child',type:'stream',data:new Uint8Array([7,8,9])},{name:'Empty',type:'stream',data:new Uint8Array()}]}]};
  const image=await client.writeCompoundFile(tree);check('native compound-file signature',()=>assert.deepEqual([...image.slice(0,8)],[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]));const restored=await client.readCompoundFile(image);check('real IStorage Unicode nested streams and class ID',()=>{assert.equal(restored.classId,tree.classId);assert.deepEqual(restored.entries.find(x=>x.name==='\u0001CompObj').data,bytes);assert.deepEqual(restored.entries.find(x=>x.name==='日本語').entries.find(x=>x.name==='Child').data,new Uint8Array([7,8,9]));});
  await assert.rejects(client.readCompoundFile(new Uint8Array([1,2,3])));checks.push('malformed compound file rejected by Windows storage');
  const remaining=await client.request({op:'info'});check('data-only operations leave no live Automation handles',()=>assert.equal(remaining.objects,0));
  const active=new NativeComOleClient({allowed:['Scripting.Dictionary'],activeObjects:['Scripting.Dictionary'],publishActiveObjects:['Scripting.Dictionary'],allowNativeCode:true,architecture});
  try{
    const object=await active.request({op:'create',progId:'Scripting.Dictionary'});await active.request({op:'call',handle:object.id,member:'Add',mode:1,args:[{t:'string',v:'key'},{t:'string',v:'active object'}]});
    const publication=await active.publishActiveObject(object,'Scripting.Dictionary');for(let i=0;i<20;i++)assert.equal((await active.getActiveObject('Scripting.Dictionary')).id,object.id);checks.push('native active object lookup preserves canonical identity over 20 acquisitions');
    const output=[],program=compileProject({name:'Active',startup:'Sub Main',modules:[{name:'M',kind:'module',code:'Sub Main()\nDim a As Object, b As Object\nSet a = GetObject(, "Scripting.Dictionary")\nSet b = GetObject(class:="Scripting.Dictionary")\nDebug.Print a Is b, a("key")\nEnd Sub'}]});assert.deepEqual(program.diagnostics,[]);
    const vm=new VirtualMachine(program,{automation:active.registry(),print:s=>output.push(s)});try{await vm.start();check('compiled VB GetObject invokes real active COM server',()=>assert.deepEqual(output,['True active object']));}finally{vm.stop();await vm.automationClose;}
    assert.equal((await active.request({op:'info'})).objects,0);await assert.rejects(active.getActiveObject('Scripting.Dictionary'),e=>e.number===429);checks.push('Stop revokes owned active registration and releases native object');
  }finally{await active.close();}
  report.status='passed';
}catch(error){report.error=error.stack||error.message;report.diagnostics=client.diagnostics();process.exitCode=1;}
finally{await client.close().catch(error=>{report.cleanupError=error.message;report.status='failed';process.exitCode=1;});await fs.mkdir('reports/native-interop',{recursive:true});await fs.writeFile(`reports/native-interop/com-ole-${architecture}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
