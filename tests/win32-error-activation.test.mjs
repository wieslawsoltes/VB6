/** Whole authored procedures execute in the checked IA-32 machine, including
 * real argument lowering and error-frame transfers. Foreign APIs are test
 * hooks, not actual Windows execution. No private rich-error helper is invoked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {PE32Image} from '../src/native/pe32.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';
function project(code){return {...newProject('ErrorDetails'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:'Sub Main()\n'+code+'\nEnd Sub'}]};}
const E='native:error:';
const read=(vm,property)=>vm.memory.read(vm.symbol(E+property));
const allocated=vm=>vm.memory.regions.filter(r=>r.label==='BSTR').length;

for(const optimization of [0,1,2])test(`authored Raise calls execute real IA-32 argument, error-frame and cleanup paths O${optimization}`,t=>{
 const p=project('');
 p.modules[0].code=`Option Explicit
Private savedNumber As Long, savedHelp As Long, savedLine As Long, sequence As Long
Private savedSource As String, savedDescription As String, savedFile As String
Private text As String
Private Sub Main()
 Dim i As Long
 On Error Resume Next
 Err.Raise description:=MarkText(3,"details"), number:=MarkNumber(1,517), source:=MarkText(2,"source"), helpcontext:=MarkNumber(5,42), helpfile:=MarkText(4,"help")
 savedNumber=Err.Number
 savedHelp=Err.HelpContext
 savedSource=Err.Source
 savedDescription=Err.Description
 savedFile=Err.HelpFile
 Err.Clear
 For i=1 To 250
  Err.Raise 518,"loop","replacement"
 Next
 Err.Clear
 text="original"
 Err.Raise 519,text,Mutate(text)
 snapshotSource=Err.Source
 snapshotDescription=Err.Description
 Err.Clear
 Leaf
 leafNumber=Err.Number
 leafSource=Err.Source
 leafDescription=Err.Description
 Err.Clear
100 Err.Raise -2147220991,"numbered","negative"
 objectNumber=Err.Number
 savedLine=Erl
 Err.Clear
 Err.Raise 0,"unpublished","invalid"
 invalidNumber=Err.Number
 invalidDescription=Err.Description
 Err.Clear
End Sub
Private Function MarkText(ByVal digit As Long,ByVal value As String) As String
 sequence=sequence*10+digit
 MarkText=value
End Function
Private Function MarkNumber(ByVal digit As Long,ByVal value As Long) As Long
 sequence=sequence*10+digit
 MarkNumber=value
End Function
Private Function Mutate(ByRef value As String) As String
 value="changed"
 Mutate="after mutation"
End Function
Private Sub Leaf()
 Err.Raise 520,"callee" & ChrW$(0) & "source","${'x'.repeat(5000)}Ω"
End Sub
Private snapshotSource As String, snapshotDescription As String
Private leafNumber As Long, leafSource As String, leafDescription As String
Private objectNumber As Long, invalidNumber As Long, invalidDescription As String`;
 let linked;const finish=PE32Image.prototype.finish;t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});
 compileWin32(p,{optimization});const vm=new NativeX86Machine(linked);
 vm.hooks.delete(vm.symbol(E+'raise')); // Include real On Error/Resume Next and raising-callee unwinding.
 vm.invoke('proc:M:Main',[]);
 const global=name=>vm.memory.read(vm.symbol('global:M:'+name));
 assert.equal(global('sequence'),31254);assert.equal(global('savedNumber'),517);assert.equal(global('savedHelp'),42);
 for(const [name,value]of [['savedSource','source'],['savedDescription','details'],['savedFile','help'],['snapshotSource','original'],['snapshotDescription','after mutation'],['text','changed'],['leafSource','callee\0source'],['leafDescription','x'.repeat(5000)+'Ω'],['invalidDescription','Invalid procedure call or argument']])assert.equal(vm.memory.bstr(global(name)),value,name);
 assert.equal(global('leafNumber'),520);assert.equal(global('objectNumber')|0,-2147220991);assert.equal(global('savedLine'),100);assert.equal(global('invalidNumber'),5);
 assert.equal(read(vm,'frame'),0);assert.equal(read(vm,'pending'),0);assert.equal(read(vm,'number'),0);
 // Only these nine deliberately retained global String values own allocations.
 // A leaking argument, loop temporary, moved metadata value or unwound local
 // would increase the count even when all displayed strings looked correct.
 assert.equal(allocated(vm),9);
});
