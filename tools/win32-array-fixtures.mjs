import {newProject} from '../src/project/model.js';

/** Every assertion runs in an emitted PE on Windows; exit codes identify failures. */
export function win32ArrayFixtures() {
  const project=newProject('AotDynamicArrays');project.startup='Sub Main';
  project.modules=[{id:'arrays',name:'DynamicArrays',kind:'module',code:`Option Explicit
Option Base 1
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private values() As Long
Private strings() As String
Private steps As Long
Private Function Bound(ByVal n As Long) As Long
    steps = steps + 1
    Bound = n
End Function
Private Sub ResizeInts(ByRef a() As Long)
    ReDim Preserve a(-2 To 4)
    a(4) = 42
End Sub
Private Sub FillFixed(ByRef a() As Long)
    a(LBound(a)) = 123
    On Error Resume Next
    ReDim a(2)
    If Err.Number <> 10 Then ExitProcess 301
    Err.Clear
    Erase a
    If Err.Number <> 0 Or a(LBound(a)) <> 0 Then ExitProcess 302
End Sub
Private Sub ResizeStrings(ByRef a() As String)
    ReDim Preserve a(1 To 4)
    a(4) = "grown"
End Sub
Private Function PinValue(ByRef element As Long) As Long
    On Error Resume Next
    ReDim values(100)
    If Err.Number <> 10 Then ExitProcess 303
    Err.Clear
    Erase values
    If Err.Number <> 10 Then ExitProcess 304
    element = element + 1
    PinValue = element
End Function
Private Function ResizeAfterCall() As Long
    ReDim Preserve values(-2 To 4)
    ResizeAfterCall = UBound(values)
End Function
Private Sub FailPinned(ByRef element As Long)
    element = 99
    Error 13
End Sub
Private Sub TwoRefs(ByRef first As Long, ByRef second As Long)
    ExitProcess 305
End Sub
Private Sub TouchString(ByRef element As String)
    On Error Resume Next
    Erase strings
    If Err.Number <> 10 Then ExitProcess 306
    element = element & "!"
End Sub
Private Function SubscriptResize() As Long
    ReDim Preserve values(-2 To 5)
    SubscriptResize = 5
End Function
Private Function RecursiveArray(ByVal depth As Long) As String
    Dim local() As String
    ReDim local(-1 To 1)
    local(0) = CStr(depth)
    If depth > 0 Then local(0) = local(0) & RecursiveArray(depth - 1)
    RecursiveArray = local(0)
End Function
Private Function StaticArray() As Long
    Static persistent() As Long
    On Error Resume Next
    Dim n As Long
    Err.Clear
    n = UBound(persistent)
    If Err.Number = 9 Then ReDim persistent(1 To 1)
    persistent(1) = persistent(1) + 1
    StaticArray = persistent(1)
End Function
Public Sub Main()
    Dim copy() As Long, vacant() As Long, fixed(-2 To 1) As Long
    Dim cube() As Integer, bytes() As Byte, flags() As Boolean
    Dim words() As String, fixedWords(1 To 2) As String
    Dim padded() As String * 3
    Dim i As Long, result As Long, n As Long
    On Error Resume Next
    n = UBound(values)
    If Err.Number <> 9 Then ExitProcess 307
    Err.Clear
    ReDim values(Bound(-2) To Bound(1))
    If Err.Number <> 0 Or steps <> 2 Then ExitProcess 308
    If LBound(values) <> -2 Or UBound(values) <> 1 Then ExitProcess 309
    For i = -2 To 1
        values(i) = i + 20
    Next i
    ResizeInts values
    If values(-2) <> 18 Or values(1) <> 21 Or values(4) <> 42 Or values(3) <> 0 Then ExitProcess 310
    ReDim Preserve values(-2 To 0)
    If UBound(values) <> 0 Or values(0) <> 20 Then ExitProcess 311
    ReDim Preserve values(-1 To 8)
    If Err.Number <> 9 Or LBound(values) <> -2 Or UBound(values) <> 0 Then ExitProcess 312
    Err.Clear
    ReDim Preserve values(-2 To 0, 1 To 2)
    If Err.Number <> 9 Or values(-2) <> 18 Then ExitProcess 313
    Err.Clear
    ReDim values(0 To 1048576)
    If Err.Number <> 7 Or values(0) <> 20 Then ExitProcess 314
    Err.Clear
    ReDim values(4 To 3)
    If Err.Number <> 9 Or UBound(values) <> 0 Then ExitProcess 315
    Err.Clear
    copy = values
    copy(0) = 77
    If values(0) <> 20 Or copy(0) <> 77 Then ExitProcess 316
    copy = copy
    If copy(0) <> 77 Then ExitProcess 317
    copy = fixed
    ReDim Preserve copy(-2 To 2)
    If Err.Number <> 0 Or UBound(copy) <> 2 Then ExitProcess 318
    FillFixed fixed
    If LBound(fixed) <> -2 Or UBound(fixed) <> 1 Then ExitProcess 319
    result = PinValue(values(0)) + ResizeAfterCall()
    If result <> 25 Or values(0) <> 21 Or UBound(values) <> 4 Then ExitProcess 320
    Err.Clear
    FailPinned values(0)
    If Err.Number <> 13 Or values(0) <> 99 Then ExitProcess 321
    Err.Clear
    ReDim Preserve values(-2 To 6)
    If Err.Number <> 0 Then ExitProcess 322
    TwoRefs values(0), values(1000)
    If Err.Number <> 9 Then ExitProcess 323
    Err.Clear
    ReDim Preserve values(-2 To 4)
    If Err.Number <> 0 Then ExitProcess 324
    values(SubscriptResize()) = 55
    If values(5) <> 55 Or UBound(values) <> 5 Then ExitProcess 325
    ReDim cube(-2 To 0, 4 To 5, 8 To 9)
    cube(-2,4,8) = -123
    cube(0,5,9) = 12345
    ReDim Preserve cube(-2 To 0, 4 To 5, 8 To 11)
    If cube(-2,4,8) <> -123 Or cube(0,5,9) <> 12345 Or cube(0,5,11) <> 0 Then ExitProcess 326
    If LBound(cube,2) <> 4 Or UBound(cube,3) <> 11 Then ExitProcess 327
    ReDim Preserve cube(-2 To 1, 4 To 5, 8 To 11)
    If Err.Number <> 9 Or UBound(cube,1) <> 0 Then ExitProcess 328
    Err.Clear
    n = cube(1)
    If Err.Number <> 9 Then ExitProcess 329
    Err.Clear
    ReDim cube(3)
    If LBound(cube) <> 1 Or UBound(cube) <> 3 Or cube(2) <> 0 Then ExitProcess 330
    ReDim bytes(2)
    bytes(1) = 255
    ReDim Preserve bytes(4)
    If bytes(1) <> 255 Or bytes(2) <> 0 Or bytes(4) <> 0 Then ExitProcess 331
    ReDim flags(2)
    flags(1) = True
    ReDim Preserve flags(4)
    If flags(1) <> True Or flags(4) <> False Then ExitProcess 332
    ReDim strings(2)
    strings(1) = "A" & ChrW(0) & "Z"
    strings(2) = "Unicode " & ChrW(321)
    ResizeStrings strings()
    TouchString strings(2)
    words = strings
    strings(1) = "replacement"
    If Len(words(1)) <> 3 Or Mid$(words(1),2,1) <> ChrW(0) Or words(4) <> "grown" Then ExitProcess 333
    If words(2) <> "Unicode " & ChrW(321) & "!" Then ExitProcess 334
    fixedWords(1) = "fixed source"
    words = fixedWords
    fixedWords(1) = "changed"
    ReDim Preserve words(1 To 4)
    If words(1) <> "fixed source" Or Len(words(4)) <> 0 Then ExitProcess 335
    ReDim padded(2)
    If padded(1) <> "   " Then ExitProcess 336
    padded(1) = "ABCDE"
    ReDim Preserve padded(4)
    If padded(1) <> "ABC" Or padded(4) <> "   " Then ExitProcess 337
    ReDim Preserve padded(1)
    If padded(1) <> "ABC" Then ExitProcess 338
    If RecursiveArray(4) <> "43210" Then ExitProcess 339
    If StaticArray() <> 1 Or StaticArray() <> 2 Then ExitProcess 340
    For i = 1 To 2000
        ReDim strings(8)
        strings(1) = "iteration " & CStr(i)
        words = strings
        ReDim Preserve strings(1 To 1)
        Erase words
    Next i
    If strings(1) <> "iteration 2000" Then ExitProcess 341
    copy = vacant
    n = UBound(copy)
    If Err.Number <> 9 Then ExitProcess 342
    Err.Clear
    Erase strings, values, cube, bytes, flags, padded
    n = LBound(strings)
    If Err.Number <> 9 Then ExitProcess 343
    Err.Clear
    ReDim Preserve strings(2)
    If Err.Number <> 0 Or strings(1) <> "" Then ExitProcess 344
    ExitProcess 0
End Sub
`}];
  return [project];
}
