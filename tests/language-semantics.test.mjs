import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../src/language/diagnostics.js';
import {VirtualMachine} from '../src/runtime/vm.js';
const module=(code,name='M',kind='module')=>({id:name,name,kind,code});
const project=(...modules)=>({name:'Semantics',startup:'Sub Main',modules});
function invalid(code,pattern,...modules){const p=compileProject(project(module(code),...modules));assert.equal(p.valid,false);assert.ok(p.diagnostics.some(d=>pattern.test(d.message)&&d.number===1002&&d.source==='M'&&d.line>0),JSON.stringify(p.diagnostics));return p;}
async function run(code,...modules){const p=compileProject(project(module(code),...modules));assert.deepEqual(p.diagnostics,[]);const output=[];const vm=new VirtualMachine(p,{print:s=>output.push(s)});await vm.start();assert.notEqual(vm.state,'error');return output;}
for(const body of ['Dim Value As Long\nSub Value\nEnd Sub','Const Value = 1\nFunction Value As Long\nEnd Function','Function Value As Long\nEnd Function\nProperty Get Value As Long\nEnd Property','Dim Value As Long\nProperty Get Value As Long\nEnd Property'])test('conflicting module member declarations: '+body.split('\n')[0],()=>invalid(body,/Ambiguous member name/));
test('events conflict with authored variables and methods in the same member namespace',()=>{
  for(const body of ['Public Value As Long','Public Sub Value\nEnd Sub']){
    const p=compileProject(project(module('Public Event Value\n'+body,'C','class')));assert.equal(p.valid,false);assert.match(p.diagnostics[0].message,/Ambiguous member name/);
  }
});
for(const body of ['Function Value As Long\nDim Value As Long\nEnd Function','Function Value(Value As Long) As Long\nEnd Function','Property Get Value As Long\nDim Value As Long\nEnd Property'])test('return variables cannot be redeclared: '+body.split('\n')[0],()=>invalid(body,/return variable/));
for(const accessor of ['Let','Set'])for(const args of ['', 'Optional v As Variant', 'ParamArray v()'])test('Property '+accessor+' requires its final value: '+args,()=>invalid(`Property ${accessor} Item(${args})\nEnd Property`,/final, non-Optional value parameter/));
for(const signature of ['ByVal index As String, ByVal v As Long','ByRef index As Long, ByVal v As Long','ByVal first As Long, ByVal second As Long, ByVal v As Long','ByVal v As Long'])test('property index signature mismatch: '+signature,()=>invalid('Property Get Item(ByVal index As Long) As Long\nEnd Property\nProperty Let Item('+signature+')\nEnd Property',/Inconsistent index parameters/));
test('array/scalar property index mismatches are compile errors',()=>invalid('Property Get Item(index() As Long) As Long\nEnd Property\nProperty Let Item(index As Long, v As Long)\nEnd Property',/Inconsistent index parameters/));
for(const type of ['String','Integer','Variant','Object'])test('Let value must match Get return type: '+type,()=>invalid(`Property Get Item As Long\nEnd Property\nProperty Let Item(v As ${type})\nEnd Property`,/value type must match/));
for(const type of ['String','Integer','Long','Boolean','Date','Double'])test('Property Set rejects scalar reference type '+type,()=>invalid(`Property Set Item(v As ${type})\nEnd Property`,/object reference or Variant/));
test('Property Set rejects record, enum, and array references',()=>{
  for(const [prefix,param] of [['Type R\nx As Long\nEnd Type\n','v As R'],['Enum E\nValue\nEnd Enum\n','v As E'],['','v() As Object']])invalid(prefix+`Property Set Item(${param})\nEnd Property`,/object reference or Variant/);
});
test('enum property types compare resolved nominal identities including module qualification',()=>{
  const p=compileProject(project(module('Enum E\nOne = 1\nEnd Enum\nProperty Get Item As E\nEnd Property\nProperty Let Item(v As M.E)\nEnd Property')));assert.deepEqual(p.diagnostics,[]);
});
test('Property Set type may differ from Get and Let when it is an object reference',()=>{
  const p=compileProject(project(module('Property Get Item As Long\nEnd Property\nProperty Let Item(v As Long)\nEnd Property\nProperty Set Item(v As Object)\nEnd Property')));assert.deepEqual(p.diagnostics,[]);
});
test('valid paired properties and write-only setters retain actual execution',async()=>{
  const c=module('Private stored As Long\nPublic Property Let Item(ByVal index As Long, ByVal value As Long)\nstored = index + value\nEnd Property\nPublic Property Get Item(ByVal index As Long) As Long\nItem = stored + index\nEnd Property\nPublic Property Let Reset(ByVal value As Long)\nstored = value\nEnd Property','Box','class');
  assert.deepEqual(await run('Sub Main\nDim b As New Box\nb.Item(2) = 40\nDebug.Print b.Item(1)\nb.Reset = 5\nDebug.Print b.Item(1)\nEnd Sub',c),['43','6']);
});
for(const type of ['String','Boolean','Object'])test('numeric For rejects statically incompatible '+type,()=>invalid(`Sub Main\nDim n As ${type}\nFor n = 1 To 2\nNext\nEnd Sub`,/must be numeric or Variant/));
for(const declaration of ['Const n = 1','Dim n() As Long'])test('loop control must be a writable scalar: '+declaration,()=>invalid(`Sub Main\n${declaration}\nFor n = 1 To 2\nNext\nEnd Sub`,/writable scalar/));
for(const type of ['String','Boolean','Long','Integer','Date','Single','Double','Currency'])test('For Each rejects scalar '+type,()=>invalid(`Sub Main\nDim n As ${type}\nFor Each n In Array(1)\nNext\nEnd Sub`,/must be Variant or Object/));
test('For Each over a declared array requires a Variant control',()=>invalid('Sub Main\nDim values(1) As Object, n As Object\nFor Each n In values\nNext\nEnd Sub',/Variant when iterating an array/));
test('Option Explicit loop references are checked and Def-type implicit variables are respected',()=>{
  invalid('Option Explicit\nSub Main\nFor n = 1 To 2\nNext\nEnd Sub',/Variable not defined/);
  invalid('DefStr N\nSub Main\nFor n = 1 To 2\nNext\nEnd Sub',/must be numeric or Variant/);
  invalid('DefLng N\nSub Main\nFor Each n In Array(1)\nNext\nEnd Sub',/Variant or Object/);
});
test('public global counters resolve; local shadowing and ambiguous imports are checked',()=>{
  const code='Option Explicit\nSub Main\nFor n = 1 To 2\nNext\nEnd Sub',global=module('Public n As Long','Globals');
  assert.deepEqual(compileProject(project(module(code),global)).diagnostics,[]);
  invalid(code.replace('For n','Dim n As Boolean\nFor n'),/must be numeric or Variant/,global);
  invalid(code,/Ambiguous loop control variable/,global,module('Public n As Long','Other'));
});
test('numeric enum, implicit Variant, and function-return counters still execute',async()=>{
  const code='Enum E\nFirst = 1\nLast = 2\nEnd Enum\nFunction Count As Long\nFor Count = 1 To 2\nNext\nEnd Function\nSub Main\nDim n As E\nFor n = First To Last\nDebug.Print n\nNext\nFor v = 1 To 2\nDebug.Print v\nNext\nDebug.Print Count()\nEnd Sub';
  assert.deepEqual(await run(code),['1','2','1','2','3']);
});
test('For Each object iteration over a Collection remains valid',async()=>{
  const c=module('Public Value As Long','Box','class');
  const code='Sub Main\nDim values As New Collection, item As Object, b As New Box\nb.Value = 7\nvalues.Add b\nFor Each item In values\nDebug.Print item.Value\nNext\nEnd Sub';
  assert.deepEqual(await run(code,c),['7']);
});
test('cached semantic checks rebind a global loop counter type after another module changes',()=>{
  const p=project(module('Option Explicit\nSub Main\nFor n = 1 To 2\nNext\nEnd Sub'),module('Public n As Long','Globals')),cache=new ProjectDiagnosticCache();
  assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);
  p.modules[1].code='Public n As String';const invalid=cache.check(diagnosticSnapshot(p));assert.equal(invalid.valid,false);assert.equal(invalid.stats.cacheHits,1);assert.match(invalid.diagnostics[0].message,/numeric or Variant/);
  p.modules[1].code='Public n As Long';assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);
});
