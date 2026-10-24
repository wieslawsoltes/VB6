import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLinuxAOT} from '../packages/linux-native/src/compiler.js';
const project=(code,modules=[])=>({schema:1,name:'LinuxPrinter',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code},...modules]});
const selector=compiled=>compiled.functions.flatMap(f=>f.ops).filter(op=>op.op==='call'&&op.name==='call_member'&&compiled.metadata.names[op.args[1]]==='__selectprinter');
test('Unshadowed Set Printer lowers to an eager host selection call under Option Explicit',()=>{
  for(const architecture of ['x64','arm64']){
    const compiled=compileLinuxAOT(project('Option Explicit\nSub Main()\nSet Printer = Printers(0)\nEnd Sub'),{architecture});
    assert.equal(selector(compiled).length,1);
    const calls=compiled.functions[0].ops.filter(op=>op.op==='call').map(op=>op.name);
    assert.ok(calls.includes('get'));assert.ok(calls.includes('args'));assert.ok(calls.includes('arg_value'));assert.ok(!calls.includes('assign'));
  }
});
test('Set Printer retains scalar and foreign-object values for native type-mismatch diagnostics',()=>{
  for(const rhs of ['42','Nothing','New Collection']){
    const compiled=compileLinuxAOT(project('Option Explicit\nSub Main()\nOn Error Resume Next\nSet Printer = '+rhs+'\nDebug.Assert Err.Number = 13\nEnd Sub'));
    assert.equal(selector(compiled).length,1);
  }
});
for(const [label,code,modules] of [
  ['local','Sub Main()\nDim Printer As Object\nSet Printer = Nothing\nEnd Sub'],
  ['static','Sub Main()\nStatic Printer As Object\nSet Printer = Nothing\nEnd Sub'],
  ['parameter','Sub Assign(ByRef Printer As Object)\nSet Printer = Nothing\nEnd Sub\nSub Main()\nEnd Sub'],
  ['function result','Function Printer() As Object\nSet Printer = Nothing\nEnd Function\nSub Main()\nEnd Sub'],
  ['module field','Private Printer As Object\nSub Main()\nSet Printer = Nothing\nEnd Sub'],
  ['module procedure','Function Printer() As Object\nEnd Function\nSub Main()\nSet Printer = Nothing\nEnd Sub'],
  ['module property','Property Set Printer(ByVal value As Object)\nEnd Property\nSub Main()\nSet Printer = Nothing\nEnd Sub'],
  ['public field','Sub Main()\nSet Printer = Nothing\nEnd Sub',[{name:'Globals',kind:'module',code:'Public Printer As Object'}]],
  ['public procedure','Sub Main()\nSet Printer = Nothing\nEnd Sub',[{name:'Globals',kind:'module',code:'Public Function Printer() As Object\nEnd Function'}]]
])test('A user '+label+' named Printer keeps ordinary Set assignment',()=>{
  const compiled=compileLinuxAOT(project(code,modules));assert.equal(selector(compiled).length,0);assert.ok(compiled.functions.some(f=>f.ops.some(op=>op.op==='call'&&op.name==='assign')));
});
test('A private declaration in another module does not hide the builtin Printer',()=>{
  const compiled=compileLinuxAOT(project('Sub Main()\nSet Printer = Printers(0)\nEnd Sub',[{name:'PrivateModule',kind:'module',code:'Private Printer As Object'}]));assert.equal(selector(compiled).length,1);
});
test('A form control named Printer preserves normal control assignment semantics',()=>{
  const compiled=compileLinuxAOT({schema:1,name:'FormPrinter',startup:'F',modules:[{name:'F',kind:'form',code:'Sub Form_Load()\nSet Printer = Nothing\nEnd Sub',form:{type:'Form',name:'F',properties:{},controls:[{type:'CommandButton',name:'Printer',properties:{}}],menus:[]}}]});assert.equal(selector(compiled).length,0);
});
test('Unshadowed Printers(index) invokes the native collection default Item',()=>{
  for(const architecture of ['x64','arm64']){
    const compiled=compileLinuxAOT(project('Option Explicit\nSub Main()\nDim item As Object\nSet item = Printers(0)\nEnd Sub'),{architecture});
    const calls=compiled.functions.flatMap(f=>f.ops).filter(op=>op.op==='call');
    assert.ok(calls.some(op=>op.name==='get'&&compiled.metadata.names[op.args[0]]==='Printers'));
    assert.ok(calls.some(op=>op.name==='call_value'));assert.ok(!calls.some(op=>op.name==='call'&&compiled.metadata.names[op.args[0]]==='Printers'));
  }
});
for(const [label,code,modules]of [
  ['local array','Sub Main()\nDim Printers(0 To 1) As Object, item As Object\nSet item = Printers(0)\nEnd Sub'],
  ['parameter','Sub ReadPrinter(ByVal Printers As Object)\nDim item As Object\nSet item = Printers(0)\nEnd Sub\nSub Main()\nEnd Sub'],
  ['module function','Function Printers(ByVal index As Long) As Object\nEnd Function\nSub Main()\nDim item As Object\nSet item = Printers(0)\nEnd Sub'],
  ['public field','Sub Main()\nDim item As Object\nSet item = Printers(0)\nEnd Sub',[{name:'Globals',kind:'module',code:'Public Printers(0 To 1) As Object'}]]
])test('Printers(index) respects a shadowing '+label,()=>{
  const compiled=compileLinuxAOT(project(code,modules));assert.ok(!compiled.functions.some(f=>f.ops.some(op=>op.op==='call'&&op.name==='get'&&compiled.metadata.names[op.args[0]]==='Printers')));
});
