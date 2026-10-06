VERSION 5.00
Begin VB.UserControl Gauge
   ClientWidth     =   4500
   ClientHeight    =   1500
   Begin VB.Label Readout
      Caption         =   "25%"
      Left            =   150
      Top             =   150
      Width           =   1200
      Height          =   300
   End
End
Attribute VB_Name = "Gauge"
Attribute VB_Exposed = True
Option Explicit
Private mValue As Long
Public PaintCount As Long
Public Event Changing(ByVal Proposed As Long, ByRef Cancel As Boolean)
Public Event Changed()

Private Sub UserControl_InitProperties()
    mValue = 25
    UpdateReadout
End Sub

Private Sub UserControl_ReadProperties(PropBag As PropertyBag)
    mValue = PropBag.ReadProperty("Value", 25&)
    If mValue < 0 Or mValue > 100 Then Err.Raise 380
    UpdateReadout
End Sub

Private Sub UserControl_WriteProperties(PropBag As PropertyBag)
    PropBag.WriteProperty "Value", mValue, 25&
End Sub

Private Sub UserControl_Paint()
    PaintCount = PaintCount + 1
End Sub

Private Sub UserControl_MouseDown(Button As Integer, Shift As Integer, X As Single, Y As Single)
    If Button = 1 And UserControl.ScaleWidth > 0 Then
        Value = CLng(X * 100 / UserControl.ScaleWidth)
    End If
End Sub

Private Sub UserControl_KeyPress(KeyAscii As Integer)
    If KeyAscii = 13 Then KeyAscii = 0
End Sub

Public Property Get Value() As Long
    Value = mValue
End Property

Public Property Let Value(ByVal Proposed As Long)
    Dim Cancel As Boolean
    RaiseEvent Changing(Proposed, Cancel)
    If Cancel Then Exit Property
    If Proposed < 0 Or Proposed > 100 Then Err.Raise 380
    If Proposed = mValue Then Exit Property
    mValue = Proposed
    UserControl.PropertyChanged "Value"
    UpdateReadout
    RaiseEvent Changed
End Property

Public Sub StepUp()
    If mValue < 100 Then Value = mValue + 1
End Sub

Private Sub UpdateReadout()
    Readout.Caption = CStr(mValue) & "%"
End Sub
