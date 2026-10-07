/** Install only the produced tarballs outside the checkout; no registry or lifecycle scripts. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {packComOle,runNpm} from './pack-com-ole.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),artifacts=path.join(root,'artifacts/com-ole');
const work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-com-consumer-'));
const script=String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DispatchObject,ComByRef,ComError,HRESULT,IID,OleDataObject,StgMedium,MemoryStream,OleClipboard} from '@vb6/com-ole';
import {AutomationRegistry,registerComClass,automationInvoke,VBArray,Cell,tagScalar,scalarType,VBError,MISSING} from '@vb6/automation';
import {NativeAutomationClient,NativeComOleClient} from '@vb6/native-automation';
const checks=[],check=(name,fn)=>{fn();checks.push(name);};
let object;
const registry=registerComClass(new AutomationRegistry(),'Example.Test',()=>object=new DispatchObject([
  {name:'Value',dispid:1,params:[],get:()=>42},
  {name:'Bump',dispid:2,params:[{name:'value',byRef:true}],method:([value])=>{assert(value instanceof ComByRef);value.value=tagScalar(Number(value.value)+1,'integer');}},
  {name:'Echo',dispid:3,params:[{name:'value'}],method:([value])=>value},
  {name:'Self',dispid:4,params:[],get:()=>object.QueryInterface(IID.IDispatch)},
  {name:'Fail',dispid:5,params:[],method:()=>{throw new ComError(HRESULT.DISP_E_TYPEMISMATCH,'type');}}
]));
const session=registry.createSession();
try{
  const proxy=await session.create('Example.Test');assert.equal(await automationInvoke(proxy,'Value',2),42);checks.push('installed portable COM dispatch');
  const cell=new Cell('Integer',4);await automationInvoke(proxy,'Bump',1,[{ref:cell}]);assert.equal(Number(await cell.get()),5);checks.push('shared ComByRef/Cell identities across installed packages');
  const scalar=await automationInvoke(proxy,'Echo',1,[tagScalar(255,'byte')]);assert.equal(scalarType(scalar),'byte');checks.push('typed scalar preservation across installed packages');
  const array=new VBArray([[-2,-1],[3,4]],'Integer');array.set([-2,3],17);const copy=await automationInvoke(proxy,'Echo',1,[array]);assert(copy instanceof VBArray);assert.deepEqual(copy.bounds,array.bounds);assert.equal(Number(copy.get(-2,3)),17);checks.push('shared typed multidimensional array values');
  assert.equal(await automationInvoke(proxy,'Self',2),proxy);checks.push('shared canonical IUnknown proxy identity');
  await assert.rejects(automationInvoke(proxy,'Fail',1),e=>e instanceof VBError&&e.number===13);checks.push('shared VBError identity');
}finally{await session.close();}
check('session releases owned native-style references',()=>assert(object.disposed));
const data=new OleDataObject(),stream=new MemoryStream(new Uint8Array([1,2,3])),medium=new StgMedium(4,stream),clipboard=new OleClipboard();
try{data.SetData({cfFormat:13,tymed:4},medium,true);clipboard.OleSetClipboard(data);clipboard.OleFlushClipboard();const copy=clipboard.OleGetClipboard();try{const out=copy.GetData({cfFormat:13,tymed:4});try{assert.deepEqual(out.data.toUint8Array(),new Uint8Array([1,2,3]));}finally{out.release();}}finally{copy.Release();}checks.push('installed portable OLE stream and clipboard');}finally{clipboard.close();data.Release();stream.Release();}
check('native import does not imply consent',()=>assert.throws(()=>new NativeComOleClient(),/consent/));
const native=new NativeAutomationClient({allowed:['Example.Test'],allowNativeCode:true});const nativeRegistry=native.registry();
check('native package uses canonical AutomationRegistry',()=>assert(nativeRegistry instanceof AutomationRegistry));
check('native package shares portable COM adapter types',()=>assert.equal(registerComClass(nativeRegistry,'Example.Other',()=>new DispatchObject([{name:'Value',dispid:1,params:[],get:()=>1}])),nativeRegistry));
const nativeRoot=new URL('./',import.meta.resolve('@vb6/native-automation'));
const loader=await fs.readFile(new URL('tools/interop/automation-host.ps1',nativeRoot),'utf8');
const sources=[...loader.matchAll(/'([A-Za-z][A-Za-z0-9]*\.cs)'/g)].map(m=>m[1]);
assert(sources.length>=11);for(const name of sources)await fs.access(new URL('tools/interop/'+name,nativeRoot));checks.push('every production companion source is included');
const autoRoot=new URL('./',import.meta.resolve('@vb6/automation'));assert(!fileURLToPath(autoRoot).startsWith(process.env.VB6_SOURCE_ROOT));checks.push('consumer resolves outside source checkout');
let nativeExecuted=false;
if(process.platform==='win32'){
  const client=new NativeComOleClient({allowed:[],allowNativeCode:true,architecture:process.env.VB6_COM_ARCH||'x86'});
  try{
    const info=await client.start();assert.equal(info.apartment,'STA');
    const format={cfFormat:13,tymed:4},wire=await client.createDataObject([{format,data:new Uint8Array([65,0,0,0])}]);
    assert.deepEqual((await client.getData(wire,format)).data,new Uint8Array([65,0,0,0]));await client.releaseHandle(wire.id);
    const image=await client.writeCompoundFile({entries:[{name:'Test',type:'stream',data:new Uint8Array([7,8])}]});
    const restored=await client.readCompoundFile(image);assert.deepEqual(restored.entries[0].data,new Uint8Array([7,8]));
    checks.push('installed package starts real Windows companion and uses native IDataObject/IStorage');nativeExecuted=true;
  }finally{await client.close();}
}
console.log(JSON.stringify({status:'passed',checks,nativeExecuted,architecture:process.env.VB6_COM_ARCH||null}));
`;
try{
  const manifest=await packComOle(artifacts);await fs.writeFile(path.join(work,'package.json'),JSON.stringify({name:'vb6-com-package-consumer',version:'1.0.0',private:true,type:'module'}));
  await runNpm(['install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',...manifest.packages.map(p=>path.join(artifacts,p.file))],work);
  const testDir=path.join(work,'node_modules/@vb6/com-ole/test');
  const testFiles=(await fs.readdir(testDir)).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>path.join(testDir,n));
  if(!testFiles.length)throw Error('Portable package must contain its runnable tests');
  const portable=spawnSync(process.execPath,['--test','--test-reporter=tap',...testFiles],{cwd:work,encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
  if(portable.error||portable.status!==0)throw Error(portable.error?.message||portable.stderr||portable.stdout);
  const portableCount=Number(portable.stdout.match(/^# tests (\d+)$/m)?.[1]);
  if(!portableCount)throw Error('Missing installed portable test results');
  await fs.writeFile(path.join(work,'test.mjs'),script);
  const result=spawnSync(process.execPath,['test.mjs'],{cwd:work,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024,env:{...process.env,VB6_SOURCE_ROOT:root}});
  if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr||result.stdout);
  const report={...JSON.parse(result.stdout.trim()),portableTests:portableCount};await fs.mkdir(path.join(root,'reports/native-interop'),{recursive:true});
  await fs.writeFile(path.join(root,'reports/native-interop',`packages-${process.platform}-${process.env.VB6_COM_ARCH||process.arch}.json`),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await fs.rm(work,{recursive:true,force:true});}
