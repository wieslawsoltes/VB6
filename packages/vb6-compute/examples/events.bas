Option Explicit
Public Clicks As Long
Public CursorX As Single
Public CursorY As Single

Public Sub Main()
    Clicks = 0&
    CursorX = 120!
    CursorY = 100!
    DrawScene
End Sub

Public Sub OnPointer()
    Clicks = Clicks + 1&
    CursorX = ComputeInput.PointerX
    CursorY = ComputeInput.PointerY
    DrawScene
End Sub

Public Sub OnKey()
    Clicks = ComputeInput.Character
    DrawScene
End Sub

Private Sub DrawScene()
    ComputeClear RGB(24, 28, 40)
    ComputeRect 16!, 16!, 608!, 32!, RGB(0, 70, 140)
    ComputeCircle CursorX, CursorY, 20!, RGB(240, 150, 50)
    ComputeLine 16!, 290!, 624!, 290!, 2!, RGB(200, 210, 230)
End Sub
