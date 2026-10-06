import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {run,main,invalid,module,project} from './helpers/compiler-runtime.mjs';
test('Forward module and local constants bind before their source declarations',async()=>assert.deepEqual((await run(`Const First = Second + 1
Const Second = 40
Sub Main()
Debug.Print First, Local
Const Local = Later + First
Const Later = 1
End Sub`)).output,['41 42']));
test('Qualified, imported and intrinsic constants share exact binding',async()=>assert.deepEqual((await run('Const Total = Other.Base + vbMonday\nSub Main()\nDebug.Print Total, Base, Other.Base\nEnd Sub',[module('Other','Public Const Base = 40')])).output,['42 40 40']));
test('Constant private visibility and local shadowing are respected',async()=>assert.deepEqual((await run('Private Const N = 1\nSub Main()\nConst N = 2\nDebug.Print N\nEnd Sub',[module('Other','Public Const N = 3')])).output,['2']));
test('Enum implicit members follow the preceding evaluated expression',async()=>assert.deepEqual((await run(`Const Origin = 39
Public Enum State
First = Origin + 1
Second
Last = -2
Following
End Enum
Sub Main()
Dim x As State
x = State.Second
Debug.Print First, State.Second, State.Following, x
End Sub`)).output,['40 41 -1 41']));
test('Imported enum members and enum-typed parameters return checked Long values',async()=>assert.deepEqual((await run(`Sub Main()
Dim x As Kind
x = GetKind(41)
Debug.Print Kind.Answer, Answer, x
End Sub
Function GetKind(ByVal x As Kind) As Kind
GetKind = x + 1
End Function`,[module('Types','Public Enum Kind\nAnswer = 42\nEnd Enum')])).output,['42 42 42']));
test('Enum storage supports dynamic arrays and user-defined record fields',async()=>assert.deepEqual((await run(`Enum E
A
End Enum
Type R
Field As E
End Type
Sub Main()
Dim x() As E, r As R
ReDim x(1 To 2)
x(1) = 2.5
r.Field = 3.5
Debug.Print x(1), r.Field
On Error Resume Next
x(2) = 2147483648#
Debug.Print Err.Number
End Sub`)).output,['2 4','6']));
test('Optional default constants bind in declaring module not caller locals',async()=>assert.deepEqual((await run('Const Size = 99\nSub Main()\nDebug.Print Other.F()\nEnd Sub',[module('Other','Private Const Size = 42\nPublic Function F(Optional ByVal n As Long = Size) As Long\nF = n\nEnd Function')])).output,['42']));
test('Const declarations never execute user functions while compiling',()=>invalid('Const N = SideEffect()\nFunction SideEffect()\nDebug.Print "bad"\nEnd Function',/cannot invoke/));
for(const [code,re] of [
 ['Const A = B\nConst B = A',/Circular/],
 ['Const N = MissingName',/not defined/],
 ['Dim V\nConst N = V',/Constant expression required/],
 ['Const N = 1\nConst N = 2',/Ambiguous name/],
 ['Sub Main()\nDim n\nConst n = 1\nEnd Sub',/Duplicate declaration/],
 ['Const N As Integer = 40000',/Overflow/],
 ['Const N As Long = 1 / 0',/Division by zero/],
 ['Const N As Object = 1',/constant type/i],
 ['Enum E\nA = 2147483647\nB\nEnd Enum',/Overflow/],
 ['Enum E\nA = 1\nA = 2\nEnd Enum',/Ambiguous|Duplicate/],
 ['Sub F(Optional n As Long = Unknown)\nEnd Sub',/not defined/],
])test('Constant binding diagnosis: '+code.split('\n')[0],()=>invalid(code,re));
test('Private imported constants cannot be referenced by qualification',()=>invalid('Const X = Other.Hidden',/not accessible/,[module('Other','Private Const Hidden = 2')]));
test('Ambiguous public constants cannot select one arbitrarily',()=>invalid('Const X = N',/Ambiguous/,[module('A','Public Const N = 1'),module('B','Public Const N = 2')]));
test('Public constants in class modules are rejected',()=>invalid(main(''),/Public constants.*object modules/,[module('C','Public Const N = 1','class')]));
test('Qualified constants reject assignment even before declaration executes',async()=>assert.deepEqual((await run('Const N = 1\nSub Main()\nOn Error Resume Next\nN = 2\nDebug.Print Err.Number, N\nEnd Sub')).output,['500 1']));
test('Local constant ByRef arguments bind a temporary without mutating the constant',async()=>assert.deepEqual((await run('Sub Main()\nConst N = 1\nOn Error Resume Next\nChange N\nDebug.Print Err.Number, N\nEnd Sub\nSub Change(ByRef x)\nx = 2\nEnd Sub')).output,['0 1']));
test('Enum parameters cannot accept unchecked values',async()=>assert.deepEqual((await run('Enum E\nA\nEnd Enum\nSub Main()\nOn Error Resume Next\nF 2147483648#\nDebug.Print Err.Number\nEnd Sub\nSub F(ByVal n As E)\nDebug.Print "bad"\nEnd Sub')).output,['6']));
test('Recompiling a project rebinds forward dependencies',async()=>{const p=project('Const X = Other.N + 1\nSub Main()\nDebug.Print X\nEnd Sub',[module('Other','Public Const N = 1')]);assert.equal(compileProject(p).modules.get('m').constantBindings.get('x'),2);p.modules[1].code='Public Const N = 2';assert.equal(compileProject(p).modules.get('m').constantBindings.get('x'),3);});
test('Constant dependency depth is bounded and diagnosed',()=>invalid(Array.from({length:300},(_,i)=>`Const N${i} = ${i===299?1:'N'+(i+1)}`).join('\n'),/depth limit/));
test('Enum ByRef requires compatible Long storage and keeps caller aliases',async()=>assert.deepEqual((await run('Enum E\nA\nEnd Enum\nSub Main()\nDim x As E, y As Variant\nx = 1\nF x\nDebug.Print x\ny = 1\nOn Error Resume Next\nF y\nDebug.Print Err.Number, y\nEnd Sub\nSub F(ByRef x As E)\nx = x + 1\nEnd Sub')).output,['2','13 1']));
test('Enum optional defaults are validated for Long overflow at compile time',()=>invalid('Enum E\nA\nEnd Enum\nSub F(Optional x As E = 2147483648#)\nEnd Sub',/Overflow/));
test('Imported constants initialize array bounds independently of module order',async()=>assert.deepEqual((await run('Dim a(1 To Count) As Long\nSub Main()\nDebug.Print UBound(a)\nEnd Sub',[module('Other','Public Const Count = 3')])).output,['3']));
test('Ambiguous public constant use cannot select an arbitrary initialized field',async()=>assert.deepEqual((await run(main('On Error Resume Next\nDim x\nx = N\nDebug.Print Err.Number'),[module('A','Public Const N = 1'),module('B','Public Const N = 2')])).output,['1002']));
test('Enum members and public constants share the same ambiguity boundary',async()=>assert.deepEqual((await run(main('On Error Resume Next\nDim x\nx = N\nDebug.Print Err.Number'),[module('A','Public Const N = 1'),module('B','Public Enum E\nN\nEnd Enum')])).output,['1002']));
