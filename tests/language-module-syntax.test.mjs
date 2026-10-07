import test from 'node:test';
import assert from 'node:assert/strict';
import {compileModule,compileProject,parseParameters,parseDeclarations} from '../src/language/compiler.js';
import {parseModuleHeader,parseEnumMember} from '../src/language/module-syntax.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../src/language/diagnostics.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileWin32} from '../src/native/compiler.js';

const module=(code,name='M',kind='module')=>({id:name,name,kind,code});
const project=(...modules)=>({schema:1,name:'ModuleSyntax',startup:'Sub Main',modules});
async function run(...modules){const compiled=compileProject(project(...modules));assert.deepEqual(compiled.diagnostics,[]);const output=[];const vm=new VirtualMachine(compiled,{print:s=>output.push(s)});await vm.start();return {output,vm};}
const invalid=code=>assert.throws(()=>compileModule(module(code)),e=>e.number===1002&&e.source==='M'&&e.line>0);

for(const suffix of ['', '()', ' ( )'])test('Declare accepts omitted/empty parameter list '+JSON.stringify(suffix),()=>{
  const m=compileModule(module(`Declare Function Tick Lib "kernel32" Alias "GetTickCount"${suffix} As Long`));
  assert.deepEqual(m.procedures.get('tick').params,[]);assert.equal(m.procedures.get('tick').external.entry,'GetTickCount');
});
for(const name of ['[Then]','Żółć','Count&'])test('Declare preserves identifier and return type '+name,()=>{
  const d=parseModuleHeader(`Private Declare Function ${name} Lib "Api" As Long`);
  assert.equal(d.name,name.replace(/^\[|\]$/g,''));assert.equal(d.returnType,'Long');assert.equal(d.scope,'private');
});
test('Declare type suffix is not included in the default DLL entry name',()=>assert.equal(parseModuleHeader('Declare Function Tick& Lib "Api"').external.entry,'Tick'));
test('Declare quoted metadata is opaque and decoded once',()=>{
  const d=parseModuleHeader('Declare Sub [As] Lib "Some ""As"" Library" Alias "Entry ""Then"""');
  assert.deepEqual(d.external,{library:'Some "As" Library',entry:'Entry "Then"'});
});
test('Declare ordinal aliases and As Any parameters remain available',()=>{
  const d=parseModuleHeader('Private Declare Function Read Lib "Api" Alias "#132" (ByVal n As Long, p As Any) As Long');
  assert.equal(d.external.entry,'#132');assert.equal(d.params[1].type,'Any');assert.equal(d.params[1].byRef,true);
});
for(const source of [
  'Declare Function F Lib ""', 'Declare Function F Lib 1', 'Declare Function F Lib "Api" Alias ""',
  'Declare Function F Lib "Api" Alias "#12x"', 'Declare Sub F Lib "Api" As Long', 'Declare Sub F& Lib "Api"',
  'Declare Function F& Lib "Api" As String', 'Declare Function F Lib "Api" As Any',
  'Declare Function F Lib "Api" (Optional n As Long)', 'Declare Function F Lib "Api" (ParamArray n())',
  'Declare Function F Lib "Api" (ByVal ByRef n)', 'Declare Function F Lib "Api" (n As String * 4)',
  'Declare Function F Lib "Api" (n As Long', 'Declare PtrSafe Function F Lib "Api"',
  'Declare Function F Lib "Api" junk', 'Declare Function F Lib "Api" () As Decimal'
])test('invalid Declare is a located compiler diagnostic: '+source,()=>invalid(source));
test('Any is rejected outside external parameter declarations',()=>{
  for(const source of ['Dim a As Any','Sub F(a As Any)\nEnd Sub','Function F() As Any\nEnd Function','Type R\nx As Any\nEnd Type'])invalid(source);
  assert.throws(()=>parseParameters('a As Any'),/Declare parameter/);assert.throws(()=>parseDeclarations('a As Any'),/Declare parameter/);
});
test('actual VM dispatch accepts a parameterless Declare without parentheses',async()=>{
  const {output,vm}=await run(module('Declare Function Tick Lib "kernel32" Alias "GetTickCount" As Long\nSub Main\nDebug.Print VarType(Tick())\nEnd Sub'));
  assert.deepEqual(output,['3']);vm.stop();
});
test('native scalar Declare syntax boundary remains explicit',()=>{
  const source='Declare Function Tick Lib "kernel32" Alias "GetTickCount" As Long\nSub Main\nDim n As Long\nn = Tick()\nEnd Sub';
  assert.throws(()=>compileWin32(project(module(source))),/Unsupported native Declare syntax/);
  const result=compileWin32(project(module(source.replace('As Long\nSub Main','() As Long\nSub Main'))));
  assert.equal(result.bytes[0],0x4d);assert.equal(result.bytes[1],0x5a);
});
for(const name of ['[Select]','StanŻółci'])test('Enum identifiers and members execute: '+name,async()=>{
  const {output}=await run(module(`Public Enum ${name}\n[Then] = 4\nŻółć\nEnd Enum\nSub Main\nDim n As ${name}\nn = Żółć\nDebug.Print n, [Then], VarType(n)\nEnd Sub`));assert.deepEqual(output,['5 4 3']);
});
test('Enum member expressions keep literal keyword text opaque',()=>assert.equal(parseEnumMember('[Then] = (3 + 4)').initial.kind,'group'));
for(const source of ['Enum E\nEnd Enum','Enum E\n10\nEnd Enum','Enum E\nHere: X\nEnd Enum','Enum E\nName$\nEnd Enum','Enum E\nX =\nEnd Enum','Enum E\nX = 1\nEnd Enum\nEnum e\nY = 2\nEnd Enum','Type E\nX As Long\nEnd Type\nEnum e\nY\nEnd Enum'])
  test('invalid Enum/duplicate type declarations: '+source.split('\n')[0],()=>invalid(source));
test('duplicate Enum members are rejected by checked binding',()=>assert.equal(compileProject(project(module('Enum E\nValue = 1\nvalue = 2\nEnd Enum'))).valid,false));
test('UDT escaped names, keyword fields and fixed strings execute',async()=>{
  const {output}=await run(module('Private Type [Select]\nWithEvents As Long\n[Then] As String * 3\nŻółć As Integer\nEnd Type\nSub Main\nDim r As [Select]\nr.WithEvents = 4\nr.[Then] = "abcdef"\nr.Żółć = 7\nDebug.Print r.WithEvents, r.[Then], r.Żółć\nEnd Sub'));
  assert.deepEqual(output,['4 abc 7']);
});
for(const source of ['Type R\nEnd Type','Type R\nx As Long\nX As Long\nEnd Type','Type R\nx\nEnd Type','Type R\nx As Long = 1\nEnd Type','Type R\nx As New C\nEnd Type','Type R\n10 x As Long\nEnd Type','Type R\nhere: x As Long\nEnd Type','Type R\nx As Long\nEnd Type\nType r\ny As Long\nEnd Type'])
  test('invalid UDT is diagnosed: '+source.replace(/\n/g,' / '),()=>invalid(source));
test('prototype-sensitive UDT and Enum names cannot mutate parser dictionaries',()=>{
  const m=compileModule(module('Type __proto__\nconstructor As Long\nEnd Type\nEnum constructor\nValue = 1\nEnd Enum'));
  assert.equal(Object.getPrototypeOf(m.types),null);assert.equal(Object.getPrototypeOf(m.enums),null);
  assert.equal(m.types.__proto__[0].name,'constructor');assert.equal(m.enums.constructor.members[0],'Value');
});
for(const name of ['Done','[Then]','Ukończono'])test('Event permits an omitted argument list: '+name,()=>{
  const m=compileModule(module('Public Event '+name,'Emitter','class'));assert.equal(m.events.size,1);assert.deepEqual([...m.events.values()][0].params,[]);
});
for(const args of ['Optional n As Long','ParamArray n()','ByVal n As Any'])test('Event signature restrictions: '+args,()=>{
  const c=compileProject(project(module(`Public Event Done(${args})`,'Emitter','class')));assert.equal(c.valid,false);assert.equal(c.diagnostics[0].line,1);
});
test('parameterless Unicode event really dispatches to a WithEvents handler',async()=>{
  const emitter=module('Public Event Ukończono\nPublic Sub Fire\nRaiseEvent Ukończono\nEnd Sub','Emitter','class');
  const sink=module('Private WithEvents source As Emitter\nPublic Sub Attach(ByVal value As Emitter)\nSet source = value\nEnd Sub\nPrivate Sub source_Ukończono\nDebug.Print "done"\nEnd Sub','Sink','class');
  const {output}=await run(module('Sub Main\nDim e As New Emitter, s As New Sink\ns.Attach e\ne.Fire\nEnd Sub'),emitter,sink);assert.deepEqual(output,['done']);
});
test('escaped Implements headers resolve actual project class interfaces',async()=>{
  const i=module('Public Function Value As Long\nEnd Function','Żółć','class');
  const c=module('Implements [Żółć]\nPrivate Function Żółć_Value As Long\nŻółć_Value = 9\nEnd Function','C','class');
  const {output}=await run(module('Sub Main\nDim v As Żółć\nSet v = New C\nDebug.Print v.Value\nEnd Sub'),i,c);assert.deepEqual(output,['9']);
});
test('UDT binding errors retain their physical field line in cached diagnostics',()=>{
  const p=project(module('Type R\nName As String * Missing\nEnd Type')),cache=new ProjectDiagnosticCache();
  for(let i=0;i<2;i++){const result=cache.check(diagnosticSnapshot(p));assert.equal(result.valid,false);assert.equal(result.diagnostics[0].line,2);assert.match(result.diagnostics[0].message,/Missing/);}
});
