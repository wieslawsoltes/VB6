import {createWin32ServiceExample} from './win32-service-examples.js';

export const WIN32_SYSTEM_SAMPLES=[
{id:'win32-calendar',name:'Win32 Calendar and Counters',description:'FILETIME round trips, explicit Gregorian date/time pictures and interlocked LONG values',expected:['Date: Thursday, 29 February 2024','Time: 13:05:09','Round trip: 0','Counter: 42'],code:`Option Explicit
Private Type SYSTEMTIME
    Year As Integer
    Month As Integer
    DayOfWeek As Integer
    Day As Integer
    Hour As Integer
    Minute As Integer
    Second As Integer
    Milliseconds As Integer
End Type
Private Type FILETIME
    Low As Long
    High As Long
End Type
Private Declare Function SystemTimeToFileTime Lib "kernel32" (source As SYSTEMTIME, target As FILETIME) As Long
Private Declare Function FileTimeToSystemTime Lib "kernel32" (source As FILETIME, target As SYSTEMTIME) As Long
Private Declare Function CompareFileTime Lib "kernel32" (first As FILETIME, second As FILETIME) As Long
Private Declare Function GetDateFormat Lib "kernel32" Alias "GetDateFormatA" (ByVal locale As Long, ByVal flags As Long, value As SYSTEMTIME, ByVal picture As String, ByVal output As String, ByVal capacity As Long) As Long
Private Declare Function GetTimeFormat Lib "kernel32" Alias "GetTimeFormatA" (ByVal locale As Long, ByVal flags As Long, value As SYSTEMTIME, ByVal picture As String, ByVal output As String, ByVal capacity As Long) As Long
Private Declare Function InterlockedIncrement Lib "kernel32" (value As Long) As Long
Public Function RunService(ByVal target As Long) As String
    Dim value As SYSTEMTIME, restored As SYSTEMTIME, first As FILETIME, second As FILETIME
    Dim text As String, dateText As String, timeText As String, n As Long, count As Long
    value.Year = 2024
    value.Month = 2
    value.Day = 29
    value.Hour = 13
    value.Minute = 5
    value.Second = 9
    value.Milliseconds = 123
    If SystemTimeToFileTime(value, first) = 0 Then Err.Raise 5
    If FileTimeToSystemTime(first, restored) = 0 Then Err.Raise 5
    If SystemTimeToFileTime(restored, second) = 0 Then Err.Raise 5
    text = String$(128, 0)
    n = GetDateFormat(&H409, 0, value, "dddd, dd MMMM yyyy", text, Len(text))
    If n = 0 Then Err.Raise 5
    dateText = Left$(text, n - 1)
    n = GetTimeFormat(&H409, 0, value, "HH:mm:ss", text, Len(text))
    If n = 0 Then Err.Raise 5
    timeText = Left$(text, n - 1)
    count = 41
    n = InterlockedIncrement(count)
    If n <> count Then Err.Raise 5
    RunService = "Date: " & dateText & vbCrLf & "Time: " & timeText & vbCrLf & "Round trip: " & CStr(CompareFileTime(first, second)) & vbCrLf & "Counter: " & CStr(count)
End Function
`},
{id:'win32-settings',name:'Win32 INI Sections and Messages',description:'Complete INI sections, NUL-separated buffers, error text and LocalFree ownership',expected:['Section: Theme=Classic;Count=42;','Count: 42','Message: Access is denied.','Local memory: released'],code:`Option Explicit
Private Declare Function WritePrivateProfileSection Lib "kernel32" Alias "WritePrivateProfileSectionA" (ByVal section As String, ByVal entries As String, ByVal file As String) As Long
Private Declare Function GetPrivateProfileSection Lib "kernel32" Alias "GetPrivateProfileSectionA" (ByVal section As String, ByVal output As String, ByVal capacity As Long, ByVal file As String) As Long
Private Declare Function GetPrivateProfileInt Lib "kernel32" Alias "GetPrivateProfileIntA" (ByVal section As String, ByVal key As String, ByVal fallback As Long, ByVal file As String) As Long
Private Declare Function FormatMessage Lib "kernel32" Alias "FormatMessageA" (ByVal flags As Long, ByVal source As Long, ByVal message As Long, ByVal language As Long, output As Long, ByVal capacity As Long, ByVal arguments As Long) As Long
Private Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (target As Any, source As Any, ByVal length As Long)
Private Declare Function LocalFree Lib "kernel32" (ByVal memory As Long) As Long
Public Function RunService(ByVal target As Long) As String
    Dim entries As String, output As String, section As String, message As String
    Dim n As Long, pointer As Long, i As Long, data() As Byte, count As Long
    entries = "Theme=Classic" & Chr$(0) & "Count=42" & Chr$(0) & Chr$(0)
    If WritePrivateProfileSection("Demo", entries, "system-demo.ini") = 0 Then Err.Raise 5
    output = String$(128, 0)
    n = GetPrivateProfileSection("Demo", output, Len(output), "system-demo.ini")
    If n = 0 Then Err.Raise 5
    section = Replace(Left$(output, n), Chr$(0), ";")
    count = GetPrivateProfileInt("Demo", "Count", 0, "system-demo.ini")
    n = FormatMessage(&H1300, 0, 5, &H409, pointer, 0, 0)
    If n = 0 Then Err.Raise 5
    ReDim data(0 To n - 1)
    CopyMemory data(0), ByVal pointer, n
    If LocalFree(pointer) <> 0 Then Err.Raise 5
    For i = 0 To n - 1
        message = message & Chr$(data(i))
    Next i
    RunService = "Section: " & section & vbCrLf & "Count: " & CStr(count) & vbCrLf & "Message: " & message & "Local memory: released"
End Function
`}];
export const WIN32_SYSTEM_EXAMPLES=WIN32_SYSTEM_SAMPLES.map(sample=>({id:sample.id,name:sample.name,description:sample.description,create:()=>createWin32ServiceExample(sample)}));
