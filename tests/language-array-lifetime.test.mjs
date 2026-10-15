import {runtimeBoundaryProgram} from './helpers/runtime-boundary-program.mjs';
import {ArrayLeaseScope} from '../src/runtime/array-lifetime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler-core.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {VBArray,Cell,cloneValue,tagScalar} from '../src/runtime/values.js';

function compile(code,extra=[]){return compileProject({name:'ArrayLifetime',startup:'Sub Main',modules:[{name:'M',kind:'module',code},...extra]});}
async function run(code,expected,extra=[],expectedDiagnostics=null){
 let program=compile(code,extra);if(expectedDiagnostics)program=runtimeBoundaryProgram(program,expectedDiagnostics);else assert.deepEqual(program.diagnostics,[]);
 const output=[],vm=new VirtualMachine(program,{print:s=>output.push(s)});await vm.start();
 assert.notEqual(vm.state,'error',vm.lastError?.message);assert.deepEqual(output,expected);return vm;
}
const byref=operation=>`Option Explicit
Dim a() As Long
Sub Change(ByRef value As Long)
On Error Resume Next
${operation}
Debug.Print Err.Number, UBound(a), a(0)
value = 8
End Sub
Sub Main()
ReDim a(1)
a(0) = 7
Change a(0)
ReDim Preserve a(2)
Debug.Print UBound(a), a(0)
End Sub`;
for(const operation of ['ReDim a(4)','ReDim Preserve a(4)','Erase a'])test('ByRef array element prevents '+operation+' and unlocks after return',()=>run(byref(operation),['10 1 7','2 8']));

test('Variant array replacement while an element is borrowed fails atomically',()=>run(`Dim a As Variant
Sub Change(ByRef value As Variant)
On Error Resume Next
a = 123
Debug.Print Err.Number, IsArray(a), a(0)
value = 8
End Sub
Sub Main()
a = Array(7, 9)
Change a(0)
a = 123
Debug.Print a
End Sub`,['10 True 7','123']));

test('Borrow remains locked during later argument evaluation',()=>run(`Dim a() As Long
Function Later() As Long
ReDim a(4)
End Function
Sub Change(ByRef value As Long, ByVal ignored As Long)
Debug.Print "unexpected call"
End Sub
Sub Main()
ReDim a(1)
a(0) = 7
On Error Resume Next
Change a(0), Later()
Debug.Print Err.Number, UBound(a), a(0)
ReDim a(3)
Debug.Print UBound(a)
End Sub`,['10 1 7','3']));

test('Expression and ByVal arguments do not borrow caller array storage',()=>run(`Dim a() As Long
Sub Change(ByRef value As Long)
ReDim a(3)
value = 9
End Sub
Sub ValueChange(ByVal value As Long)
ReDim a(4)
End Sub
Sub Main()
ReDim a(1)
a(0) = 7
Change (a(0))
Debug.Print UBound(a), a(0)
ValueChange a(0)
Debug.Print UBound(a)
End Sub`,['3 0','4']));

test('Whole-array ByRef parameter remains resizable',()=>run(`Sub Change(ByRef values() As Long)
ReDim Preserve values(3)
values(3) = 17
End Sub
Sub Main()
Dim a() As Long
ReDim a(1)
a(0) = 7
Change a
Debug.Print a(0), a(3), UBound(a)
End Sub`,['7 17 3']));

test('Returning from a call releases its borrow before the next expression',()=>run(`Dim a() As Long
Function First(ByRef value As Long) As Long
First = value
End Function
Function Second() As Long
ReDim a(3)
Second = UBound(a)
End Function
Sub Main()
ReDim a(1)
a(0) = 7
Debug.Print First(a(0)) + Second()
End Sub`,['10']));

test('Nested ByRef forwarding retains the outer borrow',()=>run(`Dim a() As Long
Sub Inner(ByRef value As Long)
value = 9
End Sub
Sub Outer(ByRef value As Long)
Inner value
On Error Resume Next
ReDim a(3)
Debug.Print Err.Number, a(0)
End Sub
Sub Main()
ReDim a(1)
Outer a(0)
ReDim Preserve a(3)
Debug.Print UBound(a), a(0)
End Sub`,['10 9','3 9']));

for(const operation of ['ReDim Preserve a(4)','Erase a','a = Array(4, 5)','a = 123'])test('For Each array prevents '+operation+' then releases at normal termination',()=>run(`Sub Main()
Dim a As Variant, item As Variant
a = Array(1, 2)
On Error Resume Next
For Each item In a
${operation}
Debug.Print item, Err.Number, UBound(a)
Next
a = 123
Debug.Print a
End Sub`,['1 10 1','2 10 1','123']));

for(const exit of ['Exit For','GoTo finished'])test('For Each releases storage on '+exit,()=>run(`Sub Main()
Dim a As Variant, item As Variant
a = Array(1, 2)
For Each item In a
${exit}
Next
finished:
a = 123
Debug.Print a
End Sub`,['123']));

test('GoSub outside a loop retains its array until Return',()=>run(`Sub Main()
Dim a As Variant, item As Variant
a = Array(1, 2)
For Each item In a
GoSub attempt
Next
a = 123
Debug.Print a
Exit Sub
attempt:
On Error Resume Next
a = 456
Debug.Print item, Err.Number
Return
End Sub`,['1 10','2 10','123']));

test('For Each storage is released on an unhandled callee error',()=>run(`Dim a As Variant
Sub F()
Dim item As Variant
For Each item In a
Err.Raise 5
Next
End Sub
Sub Main()
a = Array(1, 2)
On Error Resume Next
F
a = 123
Debug.Print a
End Sub`,['123']));

test('A copied array can be resized while its source is being enumerated',()=>run(`Sub Main()
Dim a As Variant, b As Variant, item As Variant
a = Array(7, 8)
For Each item In a
b = a
ReDim Preserve b(3)
Debug.Print item, UBound(b)
Next
End Sub`,['7 3','8 3']));

test('Nested enumeration keeps the outer lock after the inner Exit For',()=>run(`Sub Main()
Dim a As Variant, x As Variant, y As Variant
a = Array(1, 2)
On Error Resume Next
For Each x In a
For Each y In a
Exit For
Next
a = 12
Debug.Print Err.Number, x
Next
a = 17
Debug.Print a
End Sub`,['10 1','10 2','17']));

test('Multidimensional iteration follows first-subscript-fastest order without per-element coordinates',()=>{
 const a=new VBArray([[-1,1],[4,5],[7,8]],'Variant');
 // Independent, explicit expected source order; not the new offset iterator.
 const expected=[];let ordinal=0;
 for(let third=7;third<=8;third++)for(let second=4;second<=5;second++)for(let first=-1;first<=1;first++){
  const value=tagScalar(++ordinal,ordinal%2?'integer':'long',true);a.set([first,second,third],value);expected.push(a.getScalar(first,second,third));
 }
 a.indices=()=>{throw new Error('Coordinate allocation on hot iteration path');};
 a.offset=()=>{throw new Error('Repeated subscript conversion on hot iteration path');};
 assert.deepEqual([...a],expected.map(x=>x.value));
 const actual=[...a.scalarIterator()];assert.deepEqual(actual,expected);
 for(let i=0;i<actual.length;i++)assert.equal(actual[i],expected[i]);
});

test('Array iteration covers rank-60, singleton dimensions, empty arrays and uninitialized arrays',()=>{
 const high=new VBArray(Array.from({length:60},(_,i)=>[i,i]),'Long');high.set(high.bounds.map(b=>b[0]),17);
 assert.deepEqual([...high],[17]);assert.deepEqual([...VBArray.from([])],[]);assert.deepEqual([...new VBArray([], 'Long')],[]);
 const a=new VBArray([[2,2],[-1,1],[7,7]],'Long');a.set([2,-1,7],3);a.set([2,0,7],5);a.set([2,1,7],8);assert.deepEqual([...a],[3,5,8]);
});

test('Optimized iterator preserves order after multidimensional Preserve growth and shrink',()=>{
 const a=new VBArray([[1,2],[3,4]],'Long');a.dynamic=true;
 a.set([1,3],13);a.set([2,3],23);a.set([1,4],14);a.set([2,4],24);
 a.redim([[1,2],[3,5]],true);assert.deepEqual([...a],[13,23,14,24,0,0]);
 a.redim([[1,2],[3,3]],true);assert.deepEqual([...a],[13,23]);
});

test('ByRef UDT fields retain their containing array',()=>run(`Type Point
Value As Long
End Type
Dim a() As Point
Sub Change(ByRef value As Long)
On Error Resume Next
ReDim a(4)
Debug.Print Err.Number, UBound(a)
value = 17
End Sub
Sub Main()
ReDim a(1)
Change a(0).Value
ReDim Preserve a(2)
Debug.Print a(0).Value, UBound(a)
End Sub`,['10 1','17 2']));

test('Nested record fields retain every containing array owner',()=>run(`Type Inner
Value As Long
End Type
Type Outer
Nested As Inner
End Type
Dim a() As Outer
Sub Change(ByRef value As Long)
On Error Resume Next
Erase a
Debug.Print Err.Number
value = 19
End Sub
Sub Main()
ReDim a(1)
Change a(0).Nested.Value
Debug.Print a(0).Nested.Value
End Sub`,['10','19']));

test('Object instance fields are not dependent on the array storing their references',()=>run(`Dim a() As Box
Sub Change(ByRef value As Long)
ReDim a(3)
value = 17
End Sub
Sub Main()
ReDim a(1)
Set a(0) = New Box
Dim keep As Box
Set keep = a(0)
Change a(0).Value
Debug.Print keep.Value, UBound(a)
End Sub`,['17 3'],[{kind:'class',name:'Box',code:'Public Value As Long'}]));

test('Array assignment target stays valid over RHS evaluation and unlocks on failure',()=>run(`Dim a() As Long
Function RHS() As Long
ReDim a(4)
RHS = 8
End Function
Sub Main()
ReDim a(1)
a(0) = 7
On Error Resume Next
a(0) = RHS()
Debug.Print Err.Number, a(0), UBound(a)
ReDim Preserve a(3)
Debug.Print a(0), UBound(a)
End Sub`,['10 7 1','7 3']));

test('Indexed property ByRef arguments stay locked during RHS evaluation',()=>run(`Public a() As Long
Function RHS() As Long
ReDim a(4)
RHS = 8
End Function
Sub Main()
Dim box As New Box
ReDim a(1)
a(0) = 7
On Error Resume Next
box.Item(index:=a(0)) = RHS()
Debug.Print Err.Number, a(0), UBound(a), box.Writes
ReDim Preserve a(3)
Debug.Print a(0), UBound(a)
End Sub`,['10 7 1 0','7 3'],[{kind:'class',name:'Box',code:`Public Writes As Long
Property Let Item(ByRef index As Long, ByVal value As Long)
Writes = Writes + 1
End Property`} ]));

test('Missing later arguments release already acquired element borrows',()=>run(`Dim a() As Long
Sub F(ByRef value As Long, ByVal required As Long)
Debug.Print "unexpected"
End Sub
Sub Main()
ReDim a(1)
On Error Resume Next
F a(0)
Debug.Print Err.Number
ReDim a(3)
Debug.Print UBound(a)
End Sub`,['449','3'],[],[{"code": "VB_ARGUMENT_REQUIRED", "source": "M", "line": 8, "message": "Argument not optional (required): F"}]));

test('Unhandled callee error releases its borrowed array before caller resumes',()=>run(`Dim a() As Long
Sub F(ByRef value As Long)
Err.Raise 5
End Sub
Sub Main()
ReDim a(1)
On Error Resume Next
F a(0)
Debug.Print Err.Number
ReDim a(3)
Debug.Print UBound(a)
End Sub`,['5','3']));

test('Resume Next from an outside handler retains the suspended For Each array',()=>run(`Sub Main()
Dim a As Variant, item As Variant, errors As Long
a = Array(1, 2)
On Error GoTo handler
For Each item In a
Err.Raise 5
ReDim a(3)
Debug.Print item, errors
Next
a = 9
Debug.Print a
Exit Sub
handler:
errors = errors + 1
Resume Next
End Sub`,['1 2','2 4','9']));

test('Resume to a label outside a For Each releases the array',()=>run(`Sub Main()
Dim a As Variant, item As Variant
a = Array(1, 2)
On Error GoTo handler
For Each item In a
Err.Raise 5
Next
finished:
a = 9
Debug.Print a
Exit Sub
handler:
Resume finished
End Sub`,['9']));

test('Nested Variant-array element borrowing retains its parent descriptor',()=>run(`Dim a As Variant
Sub F(ByRef value As Variant)
On Error Resume Next
ReDim a(3)
Debug.Print Err.Number, UBound(a)
value = 17
End Sub
Sub Main()
a = Array(Array(7, 8))
F a(0)(0)
Debug.Print a(0)(0)
ReDim Preserve a(2)
Debug.Print UBound(a)
End Sub`,['10 0','17','2']));

test('Independent lease scopes compose and release idempotently',()=>{
 const a=new VBArray([[0,1]],'Long');a.dynamic=true;
 const first=new ArrayLeaseScope(),second=new ArrayLeaseScope();first.retain(a);first.retain(a);second.retain(a);
 first.release();first.release();assert.throws(()=>a.redim([[0,2]]),e=>e.number===10);
 second.release();assert.doesNotThrow(()=>a.redim([[0,2]]));
 first.retain(a);assert.throws(()=>a.erase(),e=>e.number===10);first.release();assert.doesNotThrow(()=>a.erase());
});

test('Locked Variant replacement preserves descriptor and tag identity; its copy is independently resizable',()=>{
 const cell=new Cell('Variant',VBArray.from([tagScalar(7,'long',true)])),a=cell.get(),data=a.data,tags=a.scalarData;
 const leases=new ArrayLeaseScope();leases.retain(a);
 try {
  assert.throws(()=>cell.set(12),e=>e.number===10);assert.equal(cell.get(),a);assert.equal(a.data,data);assert.equal(a.scalarData,tags);
  const copy=cloneValue(a);copy.redim([[0,3]],true);assert.equal(copy.get(0),7);assert.equal(copy.getScalar(0).type,'long');assert.equal(a.bounds[0][1],0);
 }finally{leases.release();}
 cell.set(12);assert.equal(cell.get(),12);
});

test('A Variant array cannot change element type while one element is borrowed',()=>run(`Dim a As Variant
Sub F(ByRef value As Long)
On Error Resume Next
ReDim a(3) As String
Debug.Print Err.Number, TypeName(a), UBound(a)
End Sub
Sub Main()
ReDim a(1) As Long
F a(0)
ReDim a(3) As String
Debug.Print TypeName(a), UBound(a)
End Sub`,['10 Long() 1','String() 3']));

const arrayEventEmitter={name:'Emitter',kind:'class',code:`Public Event Changing(ByRef value As Long)
Public Sub Fire()
RaiseEvent Changing(a(0))
End Sub`};
test('Source events retain element storage across two sinks and an asynchronous host callback',async()=>{
 const listener={name:'Listener',kind:'class',code:`Private WithEvents Source As Emitter
Public Sub Attach(ByVal value As Emitter)
Set Source = value
End Sub
Private Sub Source_Changing(ByRef value As Long)
On Error Resume Next
ReDim Preserve a(3)
Debug.Print Err.Number, value
value = value + 1
End Sub`};
 const program=compile(`Public a() As Long
Sub Main()
Dim e As Emitter, first As Listener, second As Listener
Set e = New Emitter
Set first = New Listener
Set second = New Listener
first.Attach e
second.Attach e
ReDim a(1)
a(0) = 7
e.Fire
ReDim Preserve a(3)
Debug.Print a(0), UBound(a)
End Sub`,[arrayEventEmitter,listener]);assert.deepEqual(program.diagnostics,[]);
 const output=[];let calls=0;
 const vm=new VirtualMachine(program,{print:s=>output.push(s),sourceEvent:async(instance,name,args)=>{
  await Promise.resolve();calls++;assert.equal(name,'Changing');
  assert.throws(()=>vm.instances.get('m').fields.get('a').get().redim([[0,3]],true),e=>e.number===10);
  assert.equal(await args[0].ref.get(),9);await args[0].ref.set(14);
 }});
 try{await vm.start();assert.equal(calls,1);assert.deepEqual(output,['10 7','10 8','14 3']);assert.equal(vm.stack.length,0);}finally{vm.stop();}
});

test('An asynchronous source-event host exception releases the element lease before caller recovery',async()=>{
 const program=compile(`Public a() As Long
Sub Main()
Dim e As Emitter
Set e = New Emitter
ReDim a(1)
a(0) = 7
On Error Resume Next
e.Fire
Debug.Print Err.Number
ReDim Preserve a(3)
Debug.Print a(0), UBound(a)
End Sub`,[arrayEventEmitter]);assert.deepEqual(program.diagnostics,[]);
 const output=[];let calls=0;
 const vm=new VirtualMachine(program,{print:s=>output.push(s),sourceEvent:async()=>{
  await Promise.resolve();calls++;
  assert.throws(()=>vm.instances.get('m').fields.get('a').get().erase(),e=>e.number===10);
  throw new Error('intentional host failure');
 }});
 try{await vm.start();assert.equal(calls,1);assert.deepEqual(output,['5','7 3']);assert.equal(vm.stack.length,0);}finally{vm.stop();}
});
