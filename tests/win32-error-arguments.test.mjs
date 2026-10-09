import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
const compile=body=>compileWin32({...newProject('RichErrors'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:'Sub Main()\n'+body+'\nEnd Sub'}]});
for(const optimization of [0,1,2])test(`rich error metadata fixture is deterministic native PE32 at O${optimization}`,()=>{
 const {project,checks}=nativeControlFixtures().find(f=>f.project.name==='AotControlRichErrors'),before=JSON.stringify(project);
 const a=compileWin32(project,{optimization}),b=compileWin32(project,{optimization});
 assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(project),before);assert.equal(checks.length,23);
 assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);
 assert.ok(a.bytes.length<100000);
 for(const name of ['SysAllocStringLen','SysFreeString','VariantChangeTypeEx'])assert.ok(a.report.imports.some(i=>i.symbol===name));
});
for(const code of ['Err.Raise 5,"source"','Err.Raise 5,,"description"','Err.Raise number:=5,helpfile:="help.chm",helpcontext:=9','Err.Source="source"\nErr.Description="detail"\nErr.HelpFile="help.chm"\nErr.HelpContext=1\nErr.Number=1'])test('rich Err syntax is lowered: '+code,()=>assert.ok(compile('On Error Resume Next\n'+code).bytes.length));
for(const code of ['Err.Raise','Err.Raise description:="missing number"','Err.Raise 5,unknown:=1','Err.Raise 5,number:=6','Err.Raise number:=5,6','Err.Raise 1,2,3,4,5,6','Err.LastDllError=1','Err.Clear 1'])test('invalid Err call or read-only assignment is diagnosed: '+code,()=>assert.throws(()=>compile(code),/Missing|Unknown|Duplicate|Positional|Too many|read-only|Err supports/i));
test('metadata properties retain String/Long types through conversions and Variant boxing',()=>{
 const r=compile('Dim s As String,n As Long,v As Variant\ns=Err.Source & Err.Description & Err.HelpFile\nn=Err.HelpContext+Err.Number+Err.LastDllError\nv=Err.HelpContext\nv=Err.HelpFile');
 assert.ok(r.bytes.length);
});
