import {referenceBrowserFixtures} from './reference-browser-fixtures.mjs';
import {parameterFixtures} from './parameter-browser-fixtures.mjs';
import {newProject} from '../src/project/model.js';
import {SETTER_ORDER_FIXTURE,SETTER_ORDER_EXPECTED} from '../tests/migration-setter-order-fixtures.mjs';
const project=code=>({...newProject('LanguageParity'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code}]});
const withClass=(code,extra)=>{const result=project(code);result.modules.push(extra);return result;};
const fixtures=[
 ...referenceBrowserFixtures,
 ...parameterFixtures,
 {name:'Unused recursive records are rejected before startup',project:project(`Private Type Item
Next As Item
End Type
Sub Main()
Debug.Print "must not run"
End Sub`),diagnostics:[{source:'M',line:2,number:1002,message:'Circular user-defined type dependency'}]},
 {name:'Cross-module record-array cycles are diagnosed at both fields',project:withClass(`Public Type A
Items(1) As Other.B
End Type
Sub Main()
Debug.Print "must not run"
End Sub`,{id:'other',name:'Other',kind:'module',code:`Public Type B
Parent As M.A
End Type`}),diagnostics:[{source:'M',line:2,number:1002,message:'Circular user-defined type dependency'},{source:'Other',line:2,number:1002,message:'Circular user-defined type dependency'}]},
 {name:'Class references break inline record dependency cycles',project:withClass(`Public Type Item
Value As Long
Link As Link
End Type
Sub Main()
Dim item As Item, link As New Link
item.Value = 7
Set item.Link = link
Debug.Print item.Value, item.Link Is link
End Sub`,{id:'link',name:'Link',kind:'class',code:'Public Data As Item'}),expected:['7 True'],error:null},
 {name:'Typed record array rejects scalar replacement atomically',project:project(`Private Type Item
Value As Long
End Type
Sub Main()
Dim a() As Item
ReDim a(1)
a(0).Value = 7
On Error Resume Next
a(0) = 42
Debug.Print Err.Number, a(0).Value
Err.Clear
ReDim Preserve a(3)
Debug.Print Err.Number, a(0).Value, a(3).Value
End Sub`),expected:['13 7','0 7 0'],error:13},
 {name:'Variant record payloads can change type in cells and arrays',project:project(`Private Type Item
Value As Long
End Type
Private Type OtherItem
Text As String
End Type
Sub Main()
Dim a As Item, b As OtherItem, payload As Variant, values(1) As Variant
a.Value = 7
b.Text = "next"
payload = a
payload = b
Debug.Print TypeName(payload), payload.Text
payload = CLng(19)
Debug.Print payload, TypeName(payload)
values(0) = a
values(0) = CInt(12)
Debug.Print values(0), TypeName(values(0))
values(0) = b
values(0) = Empty
Debug.Print IsEmpty(values(0)), a.Value
End Sub`),expected:['OtherItem next','19 Long','12 Integer','True 7'],error:null},
 {name:'Aggregate assignment respects nested Variant payload types',project:project(`Private Type Item
Value As Long
End Type
Private Type Envelope
Payload As Variant
End Type
Private Type Outer
Data As Envelope
End Type
Sub Main()
Dim a As Outer, b As Outer, item As Item
item.Value = 7
a.Data.Payload = item
b.Data.Payload = CInt(12)
a = b
Debug.Print a.Data.Payload, TypeName(a.Data.Payload), item.Value
End Sub`),expected:['12 Integer 7'],error:null},
 {name:'Typed ByRef record rejects Variant alias but accepts grouped copy',project:project(`Private Type Item
Value As Long
End Type
Sub Change(ByRef value As Item)
value.Value = 9
Debug.Print value.Value
End Sub
Sub Main()
Dim item As Item, payload As Variant
item.Value = 7
payload = item
On Error Resume Next
Change payload
Debug.Print Err.Number, payload.Value
Err.Clear
Change (payload)
Debug.Print Err.Number, payload.Value
End Sub`),expected:['13 7','9','0 7'],error:13},
 {name:'Grouped records cannot bypass private declaration identity',project:withClass(`Private Type Item
Value As Long
End Type
Sub Main()
Dim value As Item
value.Value = 7
On Error Resume Next
Other.Change (value)
Debug.Print Err.Number, value.Value
End Sub`,{id:'other',name:'Other',kind:'module',code:`Private Type Item
Value As Long
End Type
Public Sub Change(ByRef value As Item)
Debug.Print "wrong procedure entered"
value.Value = 99
End Sub`}),expected:['13 7'],error:13},
 {name:'Source event validates record type even without subscribers',project:withClass(`Private Type Item
Value As Long
End Type
Sub Main()
Dim source As New Emitter, value As Item
value.Value = 7
On Error Resume Next
source.Work value
Debug.Print Err.Number, value.Value
End Sub`,{id:'emitter',name:'Emitter',kind:'class',code:`Private Type Item
Value As Long
End Type
Public Event Changed(ByRef value As Item)
Public Sub Work(ByRef value As Variant)
RaiseEvent Changed(value)
End Sub`}),expected:['13 7'],error:13},
 {name:'Qualified record names and ByRef identity',project:withClass(`Sub Main()
Dim a As Types.Item, b As Item
a.Value = 7
b = a
Change b
Debug.Print a.Value, b.Value, TypeName(b)
End Sub
Sub Change(ByRef a As Types.Item)
a.Value = 9
End Sub`,{id:'types',name:'Types',kind:'module',code:'Public Type Item\nValue As Long\nEnd Type'}),expected:['7 9 Item'],error:null},
 {name:'Private records are rejected before Run',project:withClass(`Sub Main()
Dim a As Types.Item
End Sub`,{id:'types',name:'Types',kind:'module',code:'Private Type Item\nValue As Long\nEnd Type'}),diagnostics:[{source:'M',line:2,number:1002,message:'not accessible'}]},
 {name:'Record As New is rejected before Run',project:withClass(`Sub Main()
Dim a As New Types.Item
End Sub`,{id:'types',name:'Types',kind:'module',code:'Public Type Item\nValue As Long\nEnd Type'}),diagnostics:[{source:'M',line:2,number:1002,message:'requires a class'}]},
 {name:'Distinct private record values cannot overwrite matching-shaped storage',project:withClass(`Private Type Item
Value As Long
End Type
Sub Main()
Dim a As Item
a.Value = 5
On Error Resume Next
a = Types.MakeItem()
Debug.Print Err.Number, a.Value
End Sub`,{id:'types',name:'Types',kind:'module',code:`Private Type Item
Value As Long
End Type
Public Function MakeItem() As Variant
Dim a As Item
a.Value = 9
MakeItem = a
End Function`}),expected:['13 5'],error:13},
 {name:'Nested record type resolves in the provider module',project:withClass(`Private Type Detail
Wrong As String
End Type
Sub Main()
Dim a As Envelope
a.Data(0).Value = 17
Debug.Print a.Data(0).Value, a.Data(1).Value
End Sub`,{id:'types',name:'Types',kind:'module',code:`Private Type Detail
Value As Long
End Type
Public Type Envelope
Data(1) As Detail
End Type`}),expected:['17 0'],error:null},
 {name:'Qualified record arrays retain identity through file IO and Preserve',project:withClass(`Sub Main()
Dim a() As Types.Item, b() As Item
ReDim a(1 To 2)
a(2).Value = 29
Open "items.dat" For Random As #1 Len = 18
Put #1, 1, a
Get #1, 1, b
Close
ReDim Preserve b(1 To 3) As Types.Item
Debug.Print b(2).Value, b(3).Value
End Sub`,{id:'types',name:'Types',kind:'module',code:'Public Type Item\nValue As Long\nEnd Type'}),expected:['29 0'],error:null},
 {name:'Typed record array results retain qualified element metadata',project:withClass(`Function MakeItems() As Types.Item()
Dim a(1) As Item
a(0).Value = 31
MakeItems = a
End Function
Sub Main()
Dim a() As Item
a = MakeItems()
ReDim Preserve a(3)
Debug.Print a(0).Value, a(3).Value
End Sub`,{id:'types',name:'Types',kind:'module',code:'Public Type Item\nValue As Long\nEnd Type'}),expected:['31 0'],error:null},
 {name:'Compile rejection: variable-sized fixed array',project:project(`Sub Main()
Dim size As Long
Dim a(size) As Long
Debug.Print "must not run"
End Sub`),diagnostics:[{source:'M',line:3,number:1002,message:'Constant expression required'}]},
 {name:'Compile rejection: reversed fixed bounds',project:project(`Sub Main()
Dim a(3 To 1) As Long
Debug.Print "must not run"
End Sub`),diagnostics:[{source:'M',line:2,number:1002,message:'lower bound'}]},
 {name:'Compile rejection: undeclared record field bound',project:withClass(`Sub Main()
Debug.Print "must not run"
End Sub`,{id:'types',name:'Types',kind:'module',code:'Type R\nValues(UnknownSize) As Long\nEnd Type'}),diagnostics:[{source:'Types',line:2,number:1002,message:'not defined'}]},
 {name:'Fixed dimensions use Long rounding and forward local constants',project:project(`Option Base 1
Sub Main()
Dim a(-2.5 To Upper) As Long
Const Upper = Later + 1
Const Later = 3
Debug.Print LBound(a), UBound(a)
End Sub`),expected:['-2 4'],error:null},
 {name:'Imported record bounds use the declaration module not the caller',project:withClass(`Option Base 0
Private Const Size = 20
Sub Main()
Const Size = 30
Dim r As RecordType
Debug.Print LBound(r.Values), UBound(r.Values)
End Sub`,{id:'types',name:'Types',kind:'module',code:`Option Base 1
Private Const Size = 4
Public Type RecordType
Values(Size) As Long
End Type`}),expected:['1 4'],error:null},
 {name:'Fixed arrays retain per-call and Static storage ownership',project:project(`Sub Main()
Work
Work
End Sub
Sub Work()
Const Size = 2
Dim a(Size) As Long
Static b(Size) As Long
a(0) = a(0) + 1
b(0) = b(0) + 1
Debug.Print a(0), b(0), UBound(a)
End Sub`),expected:['1 1 2','1 2 2'],error:null},
 {name:'ReDim keeps runtime bound side effects',project:project(`Dim calls As Long
Function Size() As Long
calls = calls + 1
Size = 3
End Function
Sub Main()
Dim a() As Long
ReDim a(1 To Size())
Debug.Print LBound(a), UBound(a), calls
End Sub`),expected:['1 3 1'],error:null},
 {name:'With record storage and Exit Do cleanup',project:project(`Private Type Item
Value As Long
End Type
Sub Main()
Dim a() As Item
ReDim a(1)
a(0).Value = 7
On Error Resume Next
Do
With a(0)
ReDim a(4)
Debug.Print Err.Number, .Value
.Value = 9
Exit Do
End With
Loop
ReDim Preserve a(3)
Debug.Print a(0).Value, UBound(a)
End Sub`),expected:['10 7','9 3'],error:10},
 {name:'Grouped With record uses a value temporary',project:project(`Private Type Item
Value As Long
End Type
Sub Main()
Dim a() As Item
ReDim a(1)
a(0).Value = 7
With (a(0))
.Value = 9
Debug.Print .Value, a(0).Value
ReDim a(3)
Debug.Print .Value, UBound(a)
End With
End Sub`),expected:['9 7','9 3'],error:null},
 {name:'Implicit With arguments remain ByRef across continued calls',project:withClass(`Private Type Item
Value As Long
End Type
Sub Bump(ByRef value As Long)
value = value + 1
End Sub
Sub Main()
Dim item As Item, c As New Bumper
With item
Bump .Value
Call Bump(.Value)
Bump(.Value)
If True Then c _
 .Bump .Value: Bump .Value
Debug.Print .Value
End With
End Sub`,{id:'bumper',name:'Bumper',kind:'class',code:'Public Sub Bump(ByRef value As Long)\nvalue = value + 1\nEnd Sub'}),expected:['4'],error:null},
 {name:'GoSub suspends With ownership and restores receiver',project:project(`Private Type Item
Value As Long
End Type
Sub Main()
Dim a() As Item, other As Item
ReDim a(1)
With a(0)
.Value = 17
GoSub attempt
Debug.Print .Value
End With
ReDim Preserve a(3)
Debug.Print UBound(a)
Exit Sub
attempt:
On Error Resume Next
ReDim a(3)
Debug.Print Err.Number
With other
.Value = 18
Debug.Print .Value
End With
Return
End Sub`),expected:['10','18','17','3'],error:10},
 {name:'Failed nested With cannot fall back to outer receiver',project:project(`Private Type Item
Value As Long
End Type
Sub Main()
Dim a() As Item, item As Item
item.Value = 17
On Error Resume Next
With item
With a(0)
.Value = 19
Debug.Print Err.Number
End With
Debug.Print .Value
End With
Debug.Print item.Value
End Sub`),expected:['91','17','17'],error:91},
 {name:'Resume outside With releases record storage',project:project(`Private Type Item
Value As Long
End Type
Sub Main()
Dim a() As Item
ReDim a(1)
On Error GoTo handler
With a(0)
Err.Raise 5
End With
finished:
ReDim a(3)
Debug.Print UBound(a)
Exit Sub
handler:
Resume finished
End Sub`),expected:['3'],error:5},

 {name:'Like grammar and trapped Error 93',project:project('Sub Main()\nDebug.Print "ab" Like "a[]b"\nDebug.Print "a" & vbLf & "b" Like "a?b"\nDebug.Print "^" Like "[^]"\nOn Error Resume Next\nDebug.Print "a" Like "[z-a]"\nDebug.Print Err.Number\nEnd Sub'),expected:['True','True','True','93'],error:93},
 {name:'Variant element type changes and Preserve',project:project('Sub Main()\nDim a As Variant\nReDim a(1) As Long\na(0) = 9\nReDim a(-1 To 1) As String\na(-1) = "text"\nReDim Preserve a(-1 To 3)\nDebug.Print TypeName(a), a(-1), UBound(a), Len(a(3))\nEnd Sub'),expected:['String() text 3 0'],error:null},
 {name:'Typed array results and owned resizable storage',project:project('Function Values() As Long()\nDim a(1) As Long\na(0) = 17\nValues = a\nEnd Function\nSub Main()\nDim a() As Long\na = Values()\nReDim Preserve a(3)\nDebug.Print a(0), a(3), TypeName(a)\nEnd Sub'),expected:['17 0 Long()'],error:null},
 {name:'Implicit ReDim under Option Explicit',project:project('Option Explicit\nSub Main()\nDebug.Print IsArray(a)\nReDim a(1 To 2) As Integer\na(1) = 9\nReDim Preserve a(1 To 3)\nDebug.Print a(1), a(3), TypeName(a)\nEnd Sub'),expected:['True','9 0 Integer()'],error:null},
 {name:'ByRef array borrowing and release',project:project(`Dim a() As Long
Sub Work(ByRef value As Long)
On Error Resume Next
ReDim Preserve a(4)
Debug.Print Err.Number, UBound(a)
value = 17
End Sub
Sub Main()
ReDim a(1)
Work a(0)
ReDim Preserve a(3)
Debug.Print a(0), UBound(a)
End Sub`),expected:['10 1','17 3'],error:10},
 {name:'For Each locking and Exit For cleanup',project:project(`Sub Main()
Dim a As Variant, item As Variant
a = Array(7, 8)
On Error Resume Next
For Each item In a
a = 12
Debug.Print Err.Number, item
Exit For
Next
a = 19
Debug.Print a
End Sub`),expected:['10 7','19'],error:10},
 {name:'Nested record-field ByRef lifetime',project:project(`Type Point
Value As Long
End Type
Dim a() As Point
Sub Work(ByRef value As Long)
On Error Resume Next
Erase a
Debug.Print Err.Number
value = 23
End Sub
Sub Main()
ReDim a(1)
Work a(0).Value
ReDim Preserve a(3)
Debug.Print a(0).Value, UBound(a)
End Sub`),expected:['10','23 3'],error:10},
 {name:'Multidimensional Variant iteration order and tags',project:project(`Sub Main()
Dim a() As Variant, value As Variant
ReDim a(1 To 2, 3 To 4)
a(1, 3) = CInt(13)
a(2, 3) = CLng(23)
a(1, 4) = CInt(14)
a(2, 4) = CLng(24)
For Each value In a
Debug.Print value, TypeName(value)
Next
End Sub`),expected:['13 Integer','23 Long','14 Integer','24 Long'],error:null},
 {name:'Named indexed Let/Set, ByRef aliases and evaluation order',project:{...newProject('SetterOrder'),...SETTER_ORDER_FIXTURE},expected:SETTER_ORDER_EXPECTED,error:5}
];
console.log(JSON.stringify(fixtures));
