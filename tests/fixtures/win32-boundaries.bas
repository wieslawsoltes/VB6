Option Explicit
Private Type POINTAPI
  x As Long
  y As Long
End Type
Private Type XFORM
  a As Single
  b As Single
  c As Single
  d As Single
  tx As Single
  ty As Single
End Type
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreatePolygonRgn Lib "gdi32" (first As POINTAPI, ByVal count As Long, ByVal mode As Long) As Long
Private Declare Function CreateEllipticRgn Lib "gdi32" (ByVal l As Long, ByVal t As Long, ByVal r As Long, ByVal b As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function PtInRegion Lib "gdi32" (ByVal region As Long, ByVal x As Long, ByVal y As Long) As Long
Private Declare Function SetGraphicsMode Lib "gdi32" (ByVal dc As Long, ByVal mode As Long) As Long
Private Declare Function SetWorldTransform Lib "gdi32" (ByVal dc As Long, matrix As XFORM) As Long
Private Declare Function LPtoDP Lib "gdi32" (ByVal dc As Long, point As POINTAPI, ByVal count As Long) As Long
Private Declare Function BeginPath Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function EndPath Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CloseFigure Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function MoveToEx Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal old As Long) As Long
Private Declare Function LineTo Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long) As Long
Private Declare Function PathToRegion Lib "gdi32" (ByVal dc As Long) As Long
Sub Main()
  Dim dc As Long, region As Long, matrix As XFORM, p As POINTAPI
  dc = CreateCompatibleDC(0)
  matrix.a = 2: matrix.d = 3: matrix.tx = 4: matrix.ty = 5
  Debug.Print SetGraphicsMode(dc, 2), SetWorldTransform(dc, matrix)
  p.x = 6: p.y = 7
  Debug.Print LPtoDP(dc, p, 1), p.x, p.y
  BeginPath dc
  MoveToEx dc, 0, 0, 0
  LineTo dc, 10, 0
  LineTo dc, 0, 10
  CloseFigure dc
  EndPath dc
  region = PathToRegion(dc)
  Debug.Print PtInRegion(region, 5, 6), PtInRegion(region, 1, 1)
  DeleteObject region
  region = CreateEllipticRgn(0, 0, 24, 18)
  Debug.Print PtInRegion(region, 12, 9), PtInRegion(region, 0, 0)
  DeleteObject region
  Debug.Print DeleteDC(dc)
End Sub
