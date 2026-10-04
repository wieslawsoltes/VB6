Attribute VB_Name = "MainModule"
Option Explicit

Public Sub Main()
    If Command$ = "/smoke" Then
        If 6 * 7 <> 42 Then Err.Raise 5
        Open App.Path & "\classic-smoke.txt" For Output As #1
        Print #1, "VB6 runtime OK"
        Close #1
    Else
        Form1.Show
    End If
End Sub
