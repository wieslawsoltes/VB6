Option Explicit
Public SourceText As String
Public ResultText As String
Public Fields() As String
Public UnitCount As Long
Public FixedCode As String * 8
Public Runs As Long

Public Sub Main()
    Runs = Runs + 1&
    SourceText = "Zażółć" & ChrW(0&) & ChrW(55357&) & ChrW(56832&)
    ReDim Fields(1 To 3)
    Fields(1) = Left$(SourceText, 6)
    Fields(2) = StrReverse("UPG")
    Fields(3) = "Run " & CStr(Runs)
    ResultText = Join(Fields, " | ")
    FixedCode = "VB6"
    UnitCount = Len(SourceText)
    ComputeClear RGB(24, 28, 40)
    ' Bars visualize the low seven bits of UTF-16 units, not shaped text.
    ' The playground's diagnostic readback shows the String values themselves.
    Dim i As Long
    For i = 1& To Len(ResultText)
        ComputeRect CSng(i * 12&), 60!, 8!, CSng(AscW(Mid$(ResultText, i, 1)) And 127&), RGB(80, 160, 230)
    Next i
End Sub
