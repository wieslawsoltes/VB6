import {runtimeBoundaryProgram} from './helpers/runtime-boundary-program.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
async function run(code,classes,expected,error=null,expectedDiagnostics=null){
 let p=compileProject({name:'Properties',startup:'Sub Main',modules:[{name:'M',kind:'module',code},...Object.entries(classes).map(([name,code])=>({name,kind:'class',code}))]});
 if(expectedDiagnostics)p=runtimeBoundaryProgram(p,expectedDiagnostics);else assert.deepEqual(p.diagnostics,[]);const out=[],vm=new VirtualMachine(p,{print:s=>out.push(s)});await vm.start();
 assert.deepEqual(out,expected);assert.equal(vm.lastError?.number??null,error);
}
const main=body=>'Sub Main()\n'+body+'\nEnd Sub';
const both=`Public Property Get Value() As Variant
Debug.Print "get"
End Property
Public Property Let Value(ByVal rhs As Variant)
Debug.Print "let", rhs
End Property
Public Property Set Value(ByVal rhs As Variant)
Debug.Print "set", TypeName(rhs)
End Property`;
test('Let and Set select different source property accessors without invoking Get',()=>run(main('Dim b As New Box, c As New Collection\nb.Value = 7\nSet b.Value = c'),{Box:both},['let 7','set Collection']));
test('Write-only indexed property binds named index arguments in source order',()=>run(`Dim trace As String
Function Stamp(s As String) As Long
trace = trace & s
Stamp = Len(trace)
End Function
Sub Main()
Dim b As New Box
b.Value(second:=Stamp("B"), first:=Stamp("A")) = Stamp("R")
Debug.Print trace
End Sub`,{Box:`Public Property Let Value(ByVal first As Long, ByVal second As Long, ByVal rhs As Long)
Debug.Print first, second, rhs
End Property`},['2 1 3','BAR']));
test('Property assignment captures receiver before RHS and never re-evaluates it',()=>run(`Dim calls As Long, box As Box
Function Receiver() As Box
calls = calls + 1
Set Receiver = box
End Function
Sub Main()
Set box = New Box
Receiver().Value(1) = 7
Debug.Print calls
End Sub`,{Box:'Public Property Let Value(ByVal index As Long, ByVal rhs As Long)\nDebug.Print index, rhs\nEnd Property'},['1 7','1']));
test('Unqualified source property assignment uses Set rather than the first available accessor',()=>run(main('Dim b As New Box\nb.Check'),{Box:both+'\nPublic Sub Check()\nDim c As New Collection\nSet Value = c\nValue = 9\nEnd Sub'},['set Collection','let 9']));
test('Indexed property assignment cannot fall back from Set to Let',()=>run(main('Dim b As New Box, c As New Collection\nOn Error Resume Next\nSet b.Value(1) = c\nDebug.Print Err.Number'),{Box:'Public Property Let Value(ByVal index As Long, ByVal rhs As Variant)\nDebug.Print "incorrect"\nEnd Property'},['383'],383,[{"code": "VB_PROPERTY_ACCESS", "source": "M", "line": 4, "message": "Property Value does not have a Set accessor"}]));
test('Property Get array result subscripts do not become property arguments',()=>run(main('Dim b As New Box, a() As Long\na = b.Values\nDebug.Print a(0), b.Values(1)'),{Box:'Public Property Get Values() As Long()\nDim a(1) As Long\na(0) = 3\na(1) = 5\nValues = a\nEnd Property'},['3 5']));
test('Interface property writes bind contract names, not implementation names',()=>run(main('Dim implementation As New Box, contract As IBox\nSet contract = implementation\ncontract.Value(index:=2) = 7'),{
 IBox:'Public Property Let Value(ByVal index As Long, ByVal rhs As Long)\nEnd Property',
 Box:'Implements IBox\nPrivate Property Let IBox_Value(ByVal renamed As Long, ByVal value As Long)\nDebug.Print renamed, value\nEnd Property'
},['2 7']));
test('Private setters stay inaccessible outside their class',()=>run(main('Dim b As New Box\nOn Error Resume Next\nb.Value = 5\nDebug.Print Err.Number'),{Box:'Private Property Let Value(ByVal rhs As Long)\nDebug.Print "incorrect"\nEnd Property'},['438'],438,[{"code": "VB_MEMBER_ACCESS", "source": "M", "line": 4, "message": "Method or data member not accessible: Value"}]));

test('Write-only array Property Let does not call a getter to inspect the old value',()=>run(main('Dim b As New Box, a(1) As Long\na(0) = 8\nb.Values = a'),{Box:'Public Property Let Values(rhs() As Long)\nDebug.Print rhs(0), UBound(rhs)\nEnd Property'},['8 1']));
test('Array property Let can coexist with matching array Property Get',()=>run(main('Dim b As New Box, a(1) As Long\na(0) = 8\nb.Values = a\nDebug.Print b.Values(0)'),{Box:'Private stored() As Long\nPublic Property Let Values(rhs() As Long)\nstored = rhs\nEnd Property\nPublic Property Get Values() As Long()\nValues = stored\nEnd Property'},['8']));
