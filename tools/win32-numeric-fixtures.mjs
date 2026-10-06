import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {createHash} from 'node:crypto';
export function numericFixture(){
  const p=newProject('AotNumbers');p.startup='Sub Main';p.modules=[{id:'numeric',name:'Numbers',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function VarR8FromI4 Lib "oleaut32" (ByVal n As Long, ByRef result As Double) As Long
Private Declare Function VarR4FromR8 Lib "oleaut32" (ByVal n As Double, ByRef result As Single) As Long
Private Declare Function VarR8Pow Lib "oleaut32" (ByVal a As Double, ByVal b As Double, ByRef result As Double) As Long
Private shared As Double
Private values() As Double
Private Function Mixed(ByVal a As Long, ByVal b As Double, ByVal c As Single, ByVal d As Integer, ByVal text As String) As Double
    If text <> "ABI" Then ExitProcess 1
    Mixed = a + b + c + d
End Function
Private Function Recursive(ByVal n As Long, ByVal value As Double) As Double
    If n = 0 Then
        Recursive = value
    Else
        Recursive = Recursive(n - 1, value / 2)
    End If
End Function
Private Function Mutate(ByRef n As Double) As Double
    n = 99.5
    Mutate = 0.25
End Function
Private Sub SetSingle(ByRef n As Single)
    n = 1.25
End Sub
Private Function StaticFloat() As Double
    Static count As Double
    count = count + 0.5
    StaticFloat = count
End Function
Private Sub ChangeArray(ByRef element As Double)
    On Error Resume Next
    ReDim values(9)
    If Err.Number <> 10 Then ExitProcess 2
    element = 6.25
End Sub
Private Function Failed(ByVal d As Double) As Double
    Dim text As String
    text = "owned"
    Failed = d / 0
End Function
Public Sub Main()
    Dim d As Double, s As Single, n As Long, answer As Double, loops As Long
    Dim fixed(-1 To 1) As Double, small() As Single, copied() As Double
    If d <> 0 Or s <> 0 Then ExitProcess 3
    d = 12.5
    If d + 0.25 <> 12.75 Then ExitProcess 4
    If d - 0.25 <> 12.25 Then ExitProcess 5
    If d * 0.5 <> 6.25 Then ExitProcess 6
    If d / 2 <> 6.25 Then ExitProcess 7
    If 1 / 2 <> 0.5 Then ExitProcess 8
    If -d <> -12.5 Or Abs(-d) <> 12.5 Then ExitProcess 9
    If Sgn(d) <> 1 Or Sgn(-d) <> -1 Or Sgn(CDbl(0)) <> 0 Then ExitProcess 10
    If Not (0.25 > 0 And -0.25 < 0 And 0.5 = 0.5) Then ExitProcess 11
    If 1.25 <= 1 Or 1.25 >= 2 Or 0.5 <> 0.5 Then ExitProcess 12
    If Not CBool(0.25) Or CBool(CDbl(0)) Then ExitProcess 13
    If 0.25 Then
        n = 1
    End If
    If n <> 1 Then ExitProcess 14
    n = 2.5
    If n <> 2 Or CInt(3.5) <> 4 Or CLng(-2.5) <> -2 Or CByte(0.5) <> 0 Then ExitProcess 15
    If Fix(-1.75) <> -1 Or Int(-1.75) <> -2 Then ExitProcess 16
    If Sqr(6.25) <> 2.5 Or 2 ^ 3 <> 8 Or Round(2.5) <> 2 Then ExitProcess 17
    s = 16777217
    If s <> 16777216 Then ExitProcess 18
    SetSingle s
    If s <> 1.25 Or CSng(0.5) <> 0.5 Then ExitProcess 19
    If Len(d) <> 8 Or LenB(s) <> 4 Then ExitProcess 20
    If Mixed(1, 2.5, 3.25, 4, "ABI") <> 10.75 Then ExitProcess 21
    If Recursive(8, 256.5) <> 1.001953125 Then ExitProcess 22
    shared = 1.5
    answer = shared + Mutate(shared)
    If answer <> 1.75 Or shared <> 99.5 Then ExitProcess 23
    If StaticFloat() <> 0.5 Or StaticFloat() <> 1 Then ExitProcess 24
    fixed(-1) = 0.125
    If fixed(-1) <> 0.125 Then ExitProcess 25
    Erase fixed
    If fixed(-1) <> 0 Then ExitProcess 26
    ReDim values(-2 To 1, 3 To 4)
    values(-2, 4) = 0.75
    ReDim Preserve values(-2 To 1, 3 To 6)
    If values(-2, 4) <> 0.75 Or values(-2, 6) <> 0 Then ExitProcess 27
    copied = values
    copied(-2, 4) = 1.25
    If values(-2, 4) <> 0.75 Then ExitProcess 28
    ChangeArray values(-2, 4)
    If values(-2, 4) <> 6.25 Then ExitProcess 29
    Erase values
    ReDim small(1 To 3)
    small(1) = 0.5
    SetSingle small(3)
    If small(1) <> 0.5 Or small(3) <> 1.25 Then ExitProcess 30
    For d = 0.25 To 1 Step 0.25
        loops = loops + 1
    Next d
    For s = 0.5 To 0 Step -0.25
        loops = loops + 1
    Next s
    If loops <> 7 Then ExitProcess 31
    Select Case CDbl(0.5)
        Case 0.5
            n = 42
        Case Else
            ExitProcess 32
    End Select
    If n <> 42 Then ExitProcess 33
    If VarR8FromI4(123, d) <> 0 Or d <> 123 Then ExitProcess 34
    If VarR4FromR8(1.25, s) <> 0 Or s <> 1.25 Then ExitProcess 35
    If VarR8Pow(2.5, 2, d) <> 0 Or d <> 6.25 Then ExitProcess 36
    If CDbl("12.5") <> 12.5 Or CStr(CDbl(12.5)) <> "12.5" Then ExitProcess 37
    If CStr(CSng(1.25)) <> "1.25" Then ExitProcess 38
    If Val(" 1 2. 5 units") <> 12.5 Then ExitProcess 39
    If Val("-2.5E2rest") <> -250 Or Val("1D-2") <> 0.01 Then ExitProcess 40
    If Val("abc") <> 0 Or Val("") <> 0 Or Val("1,234") <> 1 Then ExitProcess 41
    If Val("&HFFFF") <> -1 Or Val("&HFFFF&") <> 65535 Or Val("&HFFFFFFFF") <> -1 Then ExitProcess 42
    If Val("&O10") <> 8 Or Val("-&H10") <> -16 Then ExitProcess 43
    If Val("1e+") <> 1 Or Val(".") <> 0 Or Val("50%") <> 50 Then ExitProcess 44
    If Val("1" & ChrW(0) & "2") <> 1 Then ExitProcess 45
    If Val("0.5!") <> 0.5 Or Val("1.23456@") <> 1.2346 Then ExitProcess 46
    If InStr("12.5", ".") <> 3 Or InStr(4,"ababa","ba") <> 4 Then ExitProcess 47
    If InStr("ABC","b") <> 0 Or InStr(1,"ABC","b",1) <> 2 Then ExitProcess 48
    If InStr("a" & ChrW(0) & "b", ChrW(0) & "b") <> 2 Then ExitProcess 49
    If InStr("", "") <> 0 Or InStr("abc", "") <> 1 Or InStr(9,"abc","z") <> 0 Then ExitProcess 50
    On Error Resume Next
    d = 1 / 0
    If Err.Number <> 11 Then ExitProcess 51
    Err.Clear
    d = Sqr(-1)
    If Err.Number <> 5 Then ExitProcess 52
    Err.Clear
    d = 1E308 * 10
    If Err.Number <> 6 Then ExitProcess 53
    Err.Clear
    s = 1E100
    If Err.Number <> 6 Then ExitProcess 54
    Err.Clear
    n = CDbl(2147483648)
    If Err.Number <> 6 Then ExitProcess 55
    Err.Clear
    d = CDbl("1" & ChrW(0) & "2")
    If Err.Number <> 13 Then ExitProcess 56
    Err.Clear
    d = Val("50.5%")
    If Err.Number <> 13 Then ExitProcess 57
    Err.Clear
    n = InStr(0,"a","a")
    If Err.Number <> 5 Then ExitProcess 58
    Err.Clear
    d = Failed(0.5)
    If Err.Number <> 11 Then ExitProcess 59
    Err.Clear
    ' The old one-MiB quota is gone; 200001 Doubles must now fit.
    ReDim values(200000)
    If Err.Number <> 0 Or UBound(values) <> 200000 Then ExitProcess 63
    values(200000) = 1.25
    ' This count requires 2147483648 bytes: reject before attempting allocation.
    ReDim Preserve values(268435455)
    If Err.Number <> 7 Then ExitProcess 60
    Err.Clear
    If UBound(values) <> 200000 Or values(200000) <> 1.25 Then ExitProcess 64
    For n = 1 To 2000
        d = Recursive(4, 128.5) + Mixed(1, 2.5, 3.25, 4, "ABI")
        If d <> 18.78125 Then ExitProcess 61
    Next n
    d = 0.5
    If d + 1 <> 1.5 Then ExitProcess 62
    ExitProcess 0
End Sub`}];return p;
}
export function controlArrayFixture(){
  const p=JSON.parse(fs.readFileSync(new URL('../examples/calculator.vb6web',import.meta.url),'utf8'));
  p.name='AotIndexedControls';
  p.modules[0].code=`Option Explicit
Private Sub Form_Load()
    On Error GoTo Broken
    Dim i As Integer
    If cmdDigit.Count <> 10 Or cmdDigit.LBound <> 0 Or cmdDigit.UBound <> 9 Then GoTo Broken
    For i = 0 To 9
        If cmdDigit(i).Index <> i Then GoTo Broken
        cmdDigit(i).Caption = "D" & CStr(i)
    Next i
    On Error Resume Next
    cmdDigit(20).Caption = "missing"
    If Err.Number <> 340 Then GoTo Broken
    txtDisplay.Text = "INDEXED OK"
    Exit Sub
Broken:
    txtDisplay.Text = "INDEXED FAILED"
End Sub
Private Sub cmdDigit_Click(Index As Integer)
    txtDisplay.Text = cmdDigit(Index).Caption
End Sub`;return p;
}
export function writeNumericFixtures(directory='validation/numeric'){
  fs.mkdirSync(directory,{recursive:true});
  const calculator=JSON.parse(fs.readFileSync(new URL('../examples/calculator.vb6web',import.meta.url),'utf8'));
  for(const p of [calculator,numericFixture(),controlArrayFixture()]){
    const result=compileWin32(p);fs.writeFileSync(path.join(directory,p.name+'.exe'),result.bytes);fs.writeFileSync(path.join(directory,p.name+'.vb6web'),JSON.stringify(p,null,2));
    fs.writeFileSync(path.join(directory,p.name+'.build.json'),JSON.stringify({...result.report,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeNumericFixtures(process.argv[2]);
