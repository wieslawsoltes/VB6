import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {NativeAutomationClient} from './native-automation.mjs';
import {VirtualMachine} from '../../src/runtime/vm.js';
import {compileProject} from '../../src/language/compiler.js';
const client=new NativeAutomationClient({allowed:['Scripting.Dictionary','Msxml2.DOMDocument.6.0'],allowNativeCode:true,architecture:process.env.VB6_COM_ARCH||'x86'});
const checks=[],report={architecture:client.architecture,status:'failed',checks,licensedVB6:false,activeXPreviewTested:false},check=(name,fn)=>{fn();checks.push(name);};
const started=Date.now();
try{
  const info=await client.start();report.startupMs=Date.now()-started;report.info=info;check('STA bitness',()=>{assert.equal(info.bitness,process.env.VB6_COM_ARCH==='x64'?64:32);assert.equal(info.apartment,'STA');});
  const output=report.output=[],program=compileProject({name:'NativeInterop',startup:'Sub Main',modules:[{name:'M',kind:'module',code:`Option Explicit
Sub Main()
Dim d As Object, other As Object, doc As Object, n As Variant, values As Variant
Set d = CreateObject("Scripting.Dictionary")
d.Add "key", "Zażółć 日本語"
Debug.Print d.Count, d("key")
d.Item("key") = "updated"
Debug.Print CallByName(d, "Item", vbGet, "key")
Set other = CreateObject("Scripting.Dictionary")
other.Add "nested", 7
Set d.Item("object") = other
Dim same As Object
Set same = d("object")
Debug.Print same Is other, CInt(same Is other), VarType(same Is other)
values = d.Keys
Debug.Print UBound(values), values(0)
Dim k As Variant
For Each k In d
Debug.Print k
Next k
Set doc = CreateObject("Msxml2.DOMDocument.6.0")
doc.async = False
n = doc.loadXML("<root>Unicode Żółć</root>")
Debug.Print n, CInt(n), VarType(n)
Debug.Print doc.documentElement.text
Set same = Nothing
Set other = Nothing
Set d = Nothing
Set doc = Nothing
End Sub`}]});
  check('VB compiler',()=>assert.deepEqual(program.diagnostics,[]));
  const vm=new VirtualMachine(program,{automation:client.registry(),print:s=>output.push(s)});
  await vm.start();check('JavaScript VB runtime invokes real Windows components',()=>assert.deepEqual(output,['1 Zażółć 日本語','updated','True -1 11','1 key','key','object','True -1 11','Unicode Żółć']));
  // A real system Dictionary stores the native VARIANT exactly; inspect both
  // the source VM type and the independent native wire descriptor on return.
  const scalarProgram=compileProject({name:'NativeScalars',startup:'Sub Main',modules:[{name:'M',kind:'module',code:`Sub Main()
Dim d As Object, v As Variant
Set d = CreateObject("Scripting.Dictionary")
d.Add "byte", CByte(255)
d.Add "integer", CInt(-32768)
d.Add "long", CLng(2147483647)
d.Add "single", CSng(1.6)
d.Add "double", CDbl(1.6)
d.Add "boolean", CBool(True)
d.Add "currency", CCur("922337203685477.5807")
d.Add "decimal", CDec("1.0000000000000000000000000001")
d.Add "date", CDate(2.75)
Debug.Print VarType(d("byte")), VarType(d("integer")), VarType(d("long")), VarType(d("single")), VarType(d("double"))
Debug.Print d("boolean"), VarType(d("boolean")), VarType(d("currency")), VarType(d("decimal")), VarType(d("date"))
Debug.Print CStr(d("currency")), CStr(d("decimal"))
End Sub`}]});
  // The same native client deliberately cannot be shared between VM sessions.
  // This program is exercised below using a fresh explicitly granted client.
  check('scalar fixture compiler',()=>assert.deepEqual(scalarProgram.diagnostics,[]));
  check('objects allocated',()=>assert.ok(client.adapters.size>=4));vm.stop();await vm.automationClose;
  const status=await client.request({op:'info'});check('native objects released at stop',()=>assert.equal(status.objects,0));
  await assert.rejects(()=>client.request({op:'create',progId:'WScript.Shell'}),/not allowed/);checks.push('ungranted ProgID denied');
  const d=await client.request({op:'create',progId:'Scripting.Dictionary'});
  await client.request({op:'call',handle:d.id,member:'Add',mode:1,args:[{t:'string',v:'currency'},{t:'currency',v:'123.4567'}]});
  const r=await client.request({op:'call',handle:d.id,member:'Item',mode:2,args:[{t:'string',v:'currency'}]});check('exact native currency value',()=>assert.equal(String(r.value.v),'123.4567'));
  await client.request({op:'release',handle:d.id});await assert.rejects(()=>client.request({op:'call',handle:d.id,member:'Count',mode:2}),e=>e.number===91);checks.push('released handle rejected');
  const scalarClient=new NativeAutomationClient({allowed:['Scripting.Dictionary'],allowNativeCode:true,architecture:client.architecture});
  try{
    const scalarOutput=[],scalarVM=new VirtualMachine(scalarProgram,{automation:scalarClient.registry(),print:s=>scalarOutput.push(s)});
    try{await scalarVM.start();check('native VARIANT types survive compiled calls',()=>assert.deepEqual(scalarOutput,['17 2 3 4 5','True 11 6 14 7','922337203685477.5807 1.0000000000000000000000000001']));}
    finally{scalarVM.stop();await scalarVM.automationClose;}
    const scalarStatus=await scalarClient.request({op:'info'});check('typed session releases native objects',()=>assert.equal(scalarStatus.objects,0));
    const handle=await scalarClient.request({op:'create',progId:'Scripting.Dictionary'});
    for(const [vt,kind,values] of [[2,'number',[-32768,32767]],[3,'number',[-2147483648,2147483647]],[4,'number',[Math.fround(1.6),Math.fround(0.2)]],[5,'number',[1.6,0.2]],[6,'currency',['-922337203685477.5808','0.0001']],[14,'decimal',['79228162514264337593543950335','0.0000000000000000000000000001']],[11,'boolean',[true,false]],[17,'number',[0,255]],[8,'string',['Zażółć 日本語','x\u0000y']]]){
      const array={t:'array',elementType:vt,bounds:[[-2,-1],[3,5]],v:Array.from({length:6},(_,i)=>({t:kind,...(kind==='number'?{vt}:{}),v:values[i%2]}))};
      await scalarClient.request({op:'call',handle:handle.id,member:'Add',mode:1,args:[{t:'string',v:String(vt)},array]});
      const got=await scalarClient.request({op:'call',handle:handle.id,member:'Item',mode:2,args:[{t:'string',v:String(vt)}]});
      check('native multidimensional SAFEARRAY '+vt,()=>assert.deepEqual(got.value,array));
    }
    // Check an independently created native array's coordinates (not only a
    // symmetric serializer round trip) using Dictionary.Keys.
    const keys=await scalarClient.request({op:'call',handle:handle.id,member:'Keys',mode:1,args:[]});
    check('native-created SAFEARRAY coordinates',()=>{assert.equal(keys.value.elementType,12);assert.deepEqual(keys.value.bounds,[[0,8]]);assert.deepEqual(keys.value.v.map(v=>v.v),['2','3','4','5','6','14','11','17','8']);});
    await scalarClient.request({op:'release',handle:handle.id});
    const enumeration=await scalarClient.request({op:'create',progId:'Scripting.Dictionary'});
    const enumKeys=[{t:'currency',v:'1.2345'},{t:'decimal',v:'2.0000000000000000000000000001'},{t:'number',vt:2,v:7},{t:'number',vt:4,v:Math.fround(1.6)},{t:'boolean',v:true}];
    for(const key of enumKeys)await scalarClient.request({op:'call',handle:enumeration.id,member:'Add',mode:1,args:[key,{t:'empty'}]});
    const nativeKeys=(await scalarClient.request({op:'call',handle:enumeration.id,member:'Keys',mode:1,args:[]})).value.v;
    check('independent SAFEARRAY retains typed Dictionary keys',()=>assert.deepEqual(nativeKeys,enumKeys));
    for(let i=0;i<25;i++)assert.deepEqual(await scalarClient.request({op:'enumerate',handle:enumeration.id,lcid:1033}),nativeKeys);
    check('IEnumVARIANT preserves Currency, Decimal and scalar types over repeated lifetimes',()=>assert.equal(nativeKeys[0].t,'currency'));
    await scalarClient.request({op:'release',handle:enumeration.id});
    const afterEnumeration=await scalarClient.request({op:'info'});
    check('enumeration releases handles',()=>assert.deepEqual(afterEnumeration,{objects:0,windows:0}));

  }finally{await scalarClient.close();}
  report.status='passed';
}catch(error){
  report.error={message:error.message,code:error.code,hresult:error.hresult,operation:error.operation,timeoutMs:error.timeoutMs};
  throw error;
}finally{
  report.diagnostics=client.diagnostics();report.elapsedMs=Date.now()-started;
  try{await client.close();}finally{
    await fs.mkdir('reports/native-interop',{recursive:true});
    await fs.writeFile(`reports/native-interop/${client.architecture}.json`,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  }
}
