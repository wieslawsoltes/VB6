import {newProject} from '../src/project/model.js';
export function win32StorageFixtures() {
  const p=newProject('AotStorage');p.startup='Sub Main';p.modules=[{id:'storage',name:'Storage',kind:'module',code:`Option Explicit
Option Base 1
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private GlobalText As String
Private FixedText As String * 5
Private Grid(-2 To 2, 3 To 5) As Long
Private Words(2 To 4) As String
Private Function Rewrite(ByRef value As String) As String
    value = "changed"
    Rewrite = "!"
End Function
Private Function RecursiveText(ByVal n As Long) As String
    If n = 0 Then
        RecursiveText = "base"
    Else
        RecursiveText = CStr(n) & RecursiveText(n - 1)
    End If
End Function
Private Sub ByValue(ByVal value As String)
    value = "private copy"
End Sub
Private Sub SetText(ByRef value As String)
    value = "by reference"
End Sub
Private Sub SetLong(ByRef value As Long)
    value = 92
End Sub
Private Function StaticFixed() As String
    Static value As String * 3
    StaticFixed = value
    value = "AB"
End Function
Private Function StaticText() As String
    Static text As String
    text = text & "s"
    StaticText = text
End Function
Public Sub Main()
    Dim text As String, result As String, i As Long, j As Long
    Dim small(2 To 5) As Integer, flags(-1 To 1) As Byte
    Dim localWords(2, -1 To 1) As String, fixedLocal As String * 4
    If Len(text) <> 0 Then ExitProcess 101
    If FixedText <> "     " Then ExitProcess 102
    If fixedLocal <> "    " Then ExitProcess 103
    text = "Żółć 日本語"
    text = text
    ByValue text
    If text <> "Żółć 日本語" Then ExitProcess 104
    text = "original"
    result = text & Rewrite(text)
    If result <> "original!" Or text <> "changed" Then ExitProcess 105
    If RecursiveText(5) <> "54321base" Then ExitProcess 106
    text = "A" & ChrW(0) & "Z"
    If Len(text) <> 3 Or LenB(text) <> 6 Then ExitProcess 107
    If text = "A" Or text = "A" & ChrW(0) & "Y" Then ExitProcess 108
    If AscW(Mid$(text, 2, 1)) <> 0 Then ExitProcess 109
    If AscW(ChrW(-1)) <> -1 Then ExitProcess 110
    If Left$(text, 1) <> "A" Or Right$(text, 1) <> "Z" Then ExitProcess 111
    If Mid$(text, 99) <> "" Then ExitProcess 112
    If Left$("abc", 99) <> "abc" Or Right$("abc", 99) <> "abc" Then ExitProcess 113
    If Mid$("abcde", 2, 3) <> "bcd" Or Mid$("abcde", 3) <> "cde" Then ExitProcess 114
    If Left$("", 3) <> "" Or Right$("", 3) <> "" Then ExitProcess 115
    GlobalText = text
    SetText Words(3)
    If Words(3) <> "by reference" Then ExitProcess 116
    For i = -2 To 2
        For j = 3 To 5
            Grid(i, j) = (i + 3) * 10 + j
        Next j
    Next i
    If Grid(-2, 3) <> 13 Or Grid(2, 5) <> 55 Then ExitProcess 117
    SetLong Grid(1, 4)
    If Grid(1, 4) <> 92 Then ExitProcess 118
    If LBound(Grid) <> -2 Or UBound(Grid, 2) <> 5 Then ExitProcess 119
    If LBound(localWords) <> 1 Or UBound(localWords) <> 2 Then ExitProcess 120
    localWords(1, -1) = "first"
    localWords(2, 1) = "last"
    If localWords(1, -1) <> "first" Or localWords(2, 1) <> "last" Then ExitProcess 121
    small(2) = -32768
    flags(-1) = 255
    If small(2) <> -32768 Or flags(-1) <> 255 Then ExitProcess 122
    Erase Grid, Words, localWords, small, flags
    If Grid(1, 4) <> 0 Or Len(Words(3)) <> 0 Or localWords(1, -1) <> "" Then ExitProcess 123
    If small(2) <> 0 Or flags(-1) <> 0 Then ExitProcess 124
    FixedText = "AB"
    fixedLocal = "123456"
    If FixedText <> "AB   " Or fixedLocal <> "1234" Then ExitProcess 125
    If StaticText() <> "s" Or StaticText() <> "ss" Then ExitProcess 126
    Select Case "beta"
        Case "alpha"
            ExitProcess 127
        Case "b" To "bz"
            result = "range"
        Case Else
            ExitProcess 128
    End Select
    If result <> "range" Then ExitProcess 129
    For i = 1 To 10000
        text = "iteration " & CStr(i)
        ByValue text
        result = Left$(text, 9)
    Next i
    If text <> "iteration 10000" Or GlobalText <> "A" & ChrW(0) & "Z" Then ExitProcess 130
    If StaticFixed() <> "   " Or StaticFixed() <> "AB " Then ExitProcess 131
    If StrPtr(text) <> StrPtr(text) Or StrPtr(text) = 0 Then ExitProcess 132
    If StrPtr(vbNullString) <> 0 Then ExitProcess 133
    ExitProcess 0
End Sub
`}];
  const fault=newProject('AotArrayBounds');fault.startup='Sub Main';fault.modules=[{id:'bounds',name:'Bounds',kind:'module',code:'Public Sub Main()\nDim values(-1 To 1) As Long\nvalues(2) = 10\nEnd Sub'}];
  return [p,fault];
}

export function win32ErrorFixtures() {
  const p=newProject('AotErrors');p.startup='Sub Main';p.modules=[{id:'errors',name:'Errors',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Sub Leaf(ByVal owned As String, ByVal other As String)
    Dim words(2) As String
    words(1) = owned & other
70  Error 11
End Sub
Private Sub Middle()
    On Error GoTo Handler
    Leaf "owned", "data"
    Exit Sub
Handler:
    If Err.Number <> 11 Or Erl <> 70 Then ExitProcess 201
    Error 6
End Sub
Private Function FailText(ByVal value As String) As String
    FailText = value & "allocated"
    Error 5
End Function
Private Sub Disabled()
    On Error Resume Next
    On Error GoTo 0
    Error 9
    ExitProcess 202
End Sub
Private Sub ResumeNamed()
    On Error GoTo Handler
    Error 5
    ExitProcess 203
Good:
    If Err.Number <> 0 Then ExitProcess 204
    Exit Sub
Handler:
    Resume Good
End Sub
Private Sub Retry()
    Dim divisor As Long, result As Long
    On Error GoTo Handler
    result = 10 \\ divisor
    If result <> 5 Then ExitProcess 205
    Exit Sub
Handler:
    If Err.Number <> 11 Then ExitProcess 206
    divisor = 2
    Resume
End Sub
Public Sub Main()
    Dim value As Long, small As Integer, n As Long, text As String
    Dim items(-1 To 1) As String
    text = "unchanged"
    On Error Resume Next
    value = 10 \\ 0
    If Err.Number <> 11 Or value <> 0 Then ExitProcess 207
    If Err.Description <> "Division by zero" Or Err.Source <> "Errors" Then ExitProcess 208
    Err.Clear
    If Err.Number <> 0 Or Err.Description <> "" Or Err.Source <> "" Then ExitProcess 209
    small = 32768
    If Err.Number <> 6 Or small <> 0 Then ExitProcess 210
    items(2) = "owned before failed bounds"
    If Err.Number <> 9 Then ExitProcess 211
    value = CLng("12" & ChrW(0) & "bad")
    If Err.Number <> 13 Then ExitProcess 212
    Middle
    If Err.Number <> 6 Then ExitProcess 213
    Disabled
    If Err.Number <> 9 Then ExitProcess 214
    ResumeNamed
    Retry
    For n = 1 To 10000
        text = "prefix" & FailText("owned by callee") & "suffix"
        If Err.Number <> 5 Or text <> "unchanged" Then ExitProcess 215
    Next n
    Err.Raise 65535
    If Err.Number <> 65535 Then ExitProcess 216
    Err.Clear
    On Error GoTo LocalHandler
    Error 13
Recovered:
    If Err.Number <> 0 Then ExitProcess 217
    ExitProcess 0
LocalHandler:
    If Err.Number <> 13 Then ExitProcess 218
    Resume Recovered
End Sub
`}];
  const resume=newProject('AotResumeWithoutError');resume.startup='Sub Main';resume.modules=[{id:'resume',name:'ResumeError',kind:'module',code:'Public Sub Main()\nResume Next\nEnd Sub'}];
  const off=newProject('AotDisabledHandler');off.startup='Sub Main';off.modules=[{id:'off',name:'DisabledError',kind:'module',code:'Public Sub Main()\nOn Error Resume Next\nOn Error GoTo 0\nError 9\nEnd Sub'}];
  return [p,resume,off];
}
