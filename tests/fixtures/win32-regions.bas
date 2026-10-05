Option Explicit
Private Type RECT
    Left As Long
    Top As Long
    Right As Long
    Bottom As Long
End Type
Private Declare Function CreateRectRgn Lib "gdi32" (ByVal l As Long, ByVal t As Long, ByVal r As Long, ByVal b As Long) As Long
Private Declare Function CombineRgn Lib "gdi32" (ByVal d As Long, ByVal a As Long, ByVal b As Long, ByVal mode As Long) As Long
Private Declare Function PtInRegion Lib "gdi32" (ByVal region As Long, ByVal x As Long, ByVal y As Long) As Long
Private Declare Function GetRgnBox Lib "gdi32" (ByVal region As Long, result As RECT) As Long
Private Declare Function GetRegionData Lib "gdi32" (ByVal region As Long, ByVal count As Long, buffer As Any) As Long
Private Declare Function ExtCreateRegion Lib "gdi32" (ByVal transform As Long, ByVal count As Long, data As Any) As Long
Private Declare Function EqualRgn Lib "gdi32" (ByVal a As Long, ByVal b As Long) As Long
Private Declare Function OffsetRgn Lib "gdi32" (ByVal region As Long, ByVal x As Long, ByVal y As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Sub Main()
    Dim a As Long, b As Long, copy As Long, size As Long, data(0 To 95) As Byte, box As RECT
    a = CreateRectRgn(0, 0, 8, 8)
    b = CreateRectRgn(2, 2, 6, 6)
    Debug.Print CombineRgn(a, a, b, 4)
    Debug.Print PtInRegion(a, 3, 3); PtInRegion(a, 7, 7)
    size = GetRegionData(a, 0, ByVal 0&)
    Debug.Print size; GetRegionData(a, size, data(0))
    copy = ExtCreateRegion(0, size, data(0))
    Debug.Print EqualRgn(a, copy)
    Debug.Print OffsetRgn(copy, -10, 20)
    Debug.Print GetRgnBox(copy, box); box.Left; box.Top; box.Right; box.Bottom
    DeleteObject a
    DeleteObject b
    DeleteObject copy
End Sub
