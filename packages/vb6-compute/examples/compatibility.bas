Option Explicit
Public Runs As Long
Public Quotient As Double
Public ExactSum As Double
Public Ledger As Currency
Public NextDate As Date
Public DayOfYear As Long
Public Names() As String
Public Selected() As String
Public PatternMatch As Boolean

Public Sub Main()
    Runs = Runs + 1&
    Quotient = 1# / 3#
    ExactSum = 9007199254740991# + 1#
    Ledger = 922337203685477.5806@ + 0.0001@
    NextDate = DateAdd("m", 1, DateSerial(2024, 1, 31))
    DayOfYear = DatePart("y", NextDate)
    Names = Split("alpha,beta,alphabet", ",")
    Selected = Filter(Names, "alpha")
    PatternMatch = "Item42" Like "[A-Z]*##"
    ComputeClear RGB(24, 28, 40)
    ComputeRect 20!, 30!, CSng(Quotient * 600#), 45!, RGB(45, 120, 210)
    ComputeRect 20!, 95!, CSng(DayOfYear * 5&), 45!, RGB(240, 150, 50)
    ComputeRect 20!, 160!, 100!, 45!, RGB(60, 180, 120)
End Sub
