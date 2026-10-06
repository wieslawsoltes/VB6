Option Explicit
Private Type BITMAPINFOHEADER
    biSize As Long
    biWidth As Long
    biHeight As Long
    biPlanes As Integer
    biBitCount As Integer
    biCompression As Long
    biSizeImage As Long
    biXPelsPerMeter As Long
    biYPelsPerMeter As Long
    biClrUsed As Long
    biClrImportant As Long
End Type
Private Declare Function CreateDIBSection Lib "gdi32" (ByVal dc As Long, info As BITMAPINFOHEADER, ByVal usage As Long, bits As Long, ByVal section As Long, ByVal offset As Long) As Long
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long, ByVal obj As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal obj As Long) As Long
Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long) As Long
Private Declare Function BitBlt Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal width As Long, ByVal height As Long, ByVal source As Long, ByVal sx As Long, ByVal sy As Long, ByVal rop As Long) As Long
Private Declare Function AlphaBlend Lib "msimg32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal width As Long, ByVal height As Long, ByVal source As Long, ByVal sx As Long, ByVal sy As Long, ByVal sw As Long, ByVal sh As Long, ByVal blend As Long) As Long
Private Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (destination As Any, source As Any, ByVal count As Long)
Sub Main()
    Dim info As BITMAPINFOHEADER, bits As Long, bitmap As Long, dc As Long, old As Long
    Dim pixels(0 To 3) As Long, copy(0 To 3) As Long
    info.biSize = 40
    info.biWidth = 2
    info.biHeight = -2
    info.biPlanes = 1
    info.biBitCount = 32
    bitmap = CreateDIBSection(0, info, 0, bits, 0, 0)
    If bitmap = 0 Then Err.Raise 5, , "CreateDIBSection failed"
    pixels(0) = &HFF0000
    pixels(1) = &HFF00&
    pixels(2) = &HFF
    pixels(3) = &HFFFFFF
    CopyMemory ByVal bits, pixels(0), 16
    dc = CreateCompatibleDC(0)
    old = SelectObject(dc, bitmap)
    Debug.Print GetPixel(dc, 0, 0), GetPixel(dc, 1, 0), GetPixel(dc, 0, 1), GetPixel(dc, 1, 1)
    Debug.Print BitBlt(dc, 1, 0, 1, 2, dc, 0, 0, &HCC0020)
    CopyMemory copy(0), ByVal bits, 16
    Debug.Print copy(0), copy(1), copy(2), copy(3)
    Debug.Print GetPixel(dc, -1, 0)
    Debug.Print BitBlt(dc, 0, 0, 1, 1, dc, 0, 0, 123), Err.LastDLLError
    SelectObject dc, old
    DeleteObject bitmap
    DeleteDC dc
End Sub
