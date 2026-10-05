import {newProject,createForm,createControl} from './model.js';
/** Ordinary Declare statements; the exporter embeds the same reusable package. */
export function win32Example(){
  const p=newProject('Win32Workbench'),form=createForm('frmWin32','Win32 API Workbench');p.modules=[form];p.startup='frmWin32';p.description='Browser Win32 Declare APIs: handles, INI files, GDI drawing, writable DIBs, memory DC bitmap blitting and complex region clipping, affine paths and memory-DC font drawing.';
  Object.assign(form.form.properties,{ClientWidth:7800,ClientHeight:5520});
  const c=(type,name,x,y,w,h,properties)=>{const control=createControl(type,name,x*15,y*15);Object.assign(control.properties,{Width:w*15,Height:h*15,...properties});return control;};
  form.form.controls=[c('Label','lblTitle',16,16,488,24,{Caption:'Win32 APIs in a browser',FontBold:-1,FontSize:12}),c('TextBox','txtValue',16,56,488,24,{Text:'',BackColor:16777215}),c('CommandButton','cmdText',16,96,152,28,{Caption:'SetWindowText'}),c('CommandButton','cmdToggle',184,96,152,28,{Caption:'EnableWindow'}),c('CommandButton','cmdDraw',352,96,152,28,{Caption:'GDI drawing'}),c('PictureBox','picCanvas',16,144,488,104,{BackColor:16777215}),c('CommandButton','cmdBitmap',16,264,152,28,{Caption:'Bitmap blitting'}),c('CommandButton','cmdRegions',184,264,152,28,{Caption:'Region clipping'}),c('CommandButton','cmdAdvanced',352,264,152,28,{Caption:'Paths and text'}),c('Label','lblStatus',16,304,488,36,{Caption:'Starting compatibility process...',WordWrap:-1})];
  form.code=`Option Explicit
Private Type XFORM
    eM11 As Single
    eM12 As Single
    eM21 As Single
    eM22 As Single
    eDx As Single
    eDy As Single
End Type
Private Type POINTAPI
    x As Long
    y As Long
End Type
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
Private Declare Function GetTickCount Lib "kernel32" () As Long
Private Declare Function IsWindow Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function EnableWindow Lib "user32" (ByVal hwnd As Long, ByVal enabled As Long) As Long
Private Declare Function IsWindowEnabled Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function SetWindowText Lib "user32" Alias "SetWindowTextA" (ByVal hwnd As Long, ByVal value As String) As Long
Private Declare Function WriteIni Lib "kernel32" Alias "WritePrivateProfileStringA" (ByVal section As String, ByVal key As String, ByVal value As String, ByVal file As String) As Long
Private Declare Function ReadIni Lib "kernel32" Alias "GetPrivateProfileStringA" (ByVal section As String, ByVal key As String, ByVal def As String, ByVal buffer As String, ByVal size As Long, ByVal file As String) As Long
Private Declare Function GetDC Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function ReleaseDC Lib "user32" (ByVal hwnd As Long, ByVal dc As Long) As Long
Private Declare Function CreateSolidBrush Lib "gdi32" (ByVal color As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long, ByVal object As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function Rectangle Lib "gdi32" (ByVal dc As Long, ByVal left As Long, ByVal top As Long, ByVal right As Long, ByVal bottom As Long) As Long
Private Declare Function CreateDIBSection Lib "gdi32" (ByVal dc As Long, info As BITMAPINFOHEADER, ByVal usage As Long, bits As Long, ByVal section As Long, ByVal offset As Long) As Long
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (destination As Any, source As Any, ByVal count As Long)
Private Declare Function StretchBlt Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal width As Long, ByVal height As Long, ByVal source As Long, ByVal sx As Long, ByVal sy As Long, ByVal sw As Long, ByVal sh As Long, ByVal rop As Long) As Long
Private Declare Function SetStretchBltMode Lib "gdi32" (ByVal dc As Long, ByVal mode As Long) As Long
Private Declare Function SaveDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function RestoreDC Lib "gdi32" (ByVal dc As Long, ByVal saved As Long) As Long
Private Declare Function CreateRectRgn Lib "gdi32" (ByVal left As Long, ByVal top As Long, ByVal right As Long, ByVal bottom As Long) As Long
Private Declare Function CombineRgn Lib "gdi32" (ByVal destination As Long, ByVal first As Long, ByVal second As Long, ByVal mode As Long) As Long
Private Declare Function SelectClipRgn Lib "gdi32" (ByVal dc As Long, ByVal region As Long) As Long
Private Declare Function GetRegionData Lib "gdi32" (ByVal region As Long, ByVal count As Long, ByVal buffer As Long) As Long
Private Declare Function PatBlt Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal width As Long, ByVal height As Long, ByVal rop As Long) As Long
Private Declare Function CreateCompatibleBitmap Lib "gdi32" (ByVal dc As Long, ByVal width As Long, ByVal height As Long) As Long
Private Declare Function CreateBitmap Lib "gdi32" (ByVal width As Long, ByVal height As Long, ByVal planes As Long, ByVal bitsPerPixel As Long, ByVal bits As Long) As Long
Private Declare Function SetGraphicsMode Lib "gdi32" (ByVal dc As Long, ByVal mode As Long) As Long
Private Declare Function SetWorldTransform Lib "gdi32" (ByVal dc As Long, transform As XFORM) As Long
Private Declare Function BeginPath Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function EndPath Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CloseFigure Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function MoveToEx Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal old As Long) As Long
Private Declare Function LineTo Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long) As Long
Private Declare Function SelectClipPath Lib "gdi32" (ByVal dc As Long, ByVal mode As Long) As Long
Private Declare Function CreateFont Lib "gdi32" Alias "CreateFontA" (ByVal height As Long, ByVal width As Long, ByVal angle As Long, ByVal orientation As Long, ByVal weight As Long, ByVal italic As Long, ByVal underline As Long, ByVal strikeout As Long, ByVal charset As Long, ByVal precision As Long, ByVal clip As Long, ByVal quality As Long, ByVal pitch As Long, ByVal name As String) As Long
Private Declare Function TextOut Lib "gdi32" Alias "TextOutA" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal text As String, ByVal length As Long) As Long
Private Declare Function SetTextColor Lib "gdi32" (ByVal dc As Long, ByVal color As Long) As Long
Private Declare Function SetBkMode Lib "gdi32" (ByVal dc As Long, ByVal mode As Long) As Long
Private Sub Form_Load()
    Dim buffer As String, count As Long
    WriteIni "Demo", "Message", "Hello from kernel32 and user32!", "win32-demo.ini"
    buffer = String$(128, 0)
    count = ReadIni("Demo", "Message", "", buffer, Len(buffer), "win32-demo.ini")
    txtValue.Text = Left$(buffer, count)
    lblStatus.Caption = "Ready. hWnd=" & CStr(Me.hWnd) & " | Valid=" & CStr(IsWindow(Me.hWnd)) & " | Tick=" & CStr(GetTickCount())
    Debug.Print "Win32 Workbench ready"
End Sub
Private Sub cmdText_Click()
    SetWindowText txtValue.hWnd, "Text changed by user32.SetWindowTextA"
End Sub
Private Sub cmdToggle_Click()
    EnableWindow txtValue.hWnd, 1 - IsWindowEnabled(txtValue.hWnd)
End Sub
Private Sub cmdDraw_Click()
    Dim dc As Long, brush As Long, oldBrush As Long
    dc = GetDC(picCanvas.hWnd)
    brush = CreateSolidBrush(RGB(70, 130, 180))
    oldBrush = SelectObject(dc, brush)
    Rectangle dc, 12, 12, 476, 92
    SelectObject dc, oldBrush
    DeleteObject brush
    ReleaseDC picCanvas.hWnd, dc
    lblStatus.Caption = "GDI drawing uses the existing WebGPU / Canvas2D surface."
End Sub
Private Sub cmdBitmap_Click()
    Dim info As BITMAPINFOHEADER, bits As Long, bitmap As Long, memoryDC As Long
    Dim target As Long, oldBitmap As Long, saved As Long, pixels(0 To 3) As Long
    On Error GoTo Failed
    info.biSize = 40
    info.biWidth = 2
    info.biHeight = -2
    info.biPlanes = 1
    info.biBitCount = 32
    bitmap = CreateDIBSection(0, info, 0, bits, 0, 0)
    If bitmap = 0 Then Err.Raise 5, , "CreateDIBSection failed"
    pixels(0) = &HFF0000
    pixels(1) = &HFF00
    pixels(2) = &HFF
    pixels(3) = &HFFFFFF
    CopyMemory ByVal bits, pixels(0), 16
    memoryDC = CreateCompatibleDC(0)
    oldBitmap = SelectObject(memoryDC, bitmap)
    target = picCanvas.hDC
    saved = SaveDC(target)
    SetStretchBltMode target, 3
    If StretchBlt(target, 8, 8, 464, 88, memoryDC, 0, 0, 2, 2, &HCC0020) = 0 Then Err.Raise 5, , "StretchBlt failed"
    lblStatus.Caption = "Writable DIB + memory DC + StretchBlt. WebGPU texture / Canvas2D presentation."
    GoTo Cleanup
Failed:
    lblStatus.Caption = "Bitmap error: " & Err.Description & " / " & CStr(Err.LastDLLError)
Cleanup:
    If saved <> 0 Then RestoreDC target, saved
    If target <> 0 Then ReleaseDC picCanvas.hWnd, target
    If oldBitmap <> 0 Then SelectObject memoryDC, oldBitmap
    If bitmap <> 0 Then DeleteObject bitmap
    If memoryDC <> 0 Then DeleteDC memoryDC
End Sub
Private Sub cmdRegions_Click()
    Dim target As Long, outer As Long, hole As Long, brush As Long, saved As Long, size As Long
    On Error GoTo Failed
    picCanvas.Cls
    target = picCanvas.hDC
    saved = SaveDC(target)
    outer = CreateRectRgn(8, 8, 472, 96)
    hole = CreateRectRgn(152, 24, 328, 80)
    If outer = 0 Or hole = 0 Then Err.Raise 5, , "Region allocation failed"
    If CombineRgn(outer, outer, hole, 4) = 0 Then Err.Raise 5, , "CombineRgn failed"
    size = GetRegionData(outer, 0, 0)
    If SelectClipRgn(target, outer) = 0 Then Err.Raise 5, , "SelectClipRgn failed"
    DeleteObject outer
    outer = 0
    brush = CreateSolidBrush(RGB(32, 128, 192))
    SelectObject target, brush
    If PatBlt(target, 0, 0, 488, 104, &HF00021) = 0 Then Err.Raise 5, , "PatBlt failed"
    lblStatus.Caption = "Complex region: copied clip survives DeleteObject. RGNDATA=" & CStr(size) & " bytes."
    GoTo Cleanup
Failed:
    lblStatus.Caption = "Region error: " & Err.Description & " / " & CStr(Err.LastDLLError)
Cleanup:
    If saved <> 0 Then RestoreDC target, saved
    If brush <> 0 Then DeleteObject brush
    If outer <> 0 Then DeleteObject outer
    If hole <> 0 Then DeleteObject hole
    If target <> 0 Then ReleaseDC picCanvas.hWnd, target
End Sub
Private Sub cmdAdvanced_Click()
    Dim target As Long, memoryDC As Long, bitmap As Long, oldBitmap As Long
    Dim saved As Long, font As Long, oldFont As Long, brush As Long, oldBrush As Long
    Dim transform As XFORM
    On Error GoTo Failed
    picCanvas.Cls
    memoryDC = CreateCompatibleDC(0)
    bitmap = CreateBitmap(232, 44, 1, 32, 0)
    oldBitmap = SelectObject(memoryDC, bitmap)
    brush = CreateSolidBrush(RGB(224, 240, 255))
    oldBrush = SelectObject(memoryDC, brush)
    PatBlt memoryDC, 0, 0, 232, 44, &HF00021
    font = CreateFont(-22, 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 0, 0, "Arial")
    oldFont = SelectObject(memoryDC, font)
    SetBkMode memoryDC, 1
    SetTextColor memoryDC, RGB(24, 56, 104)
    If TextOut(memoryDC, 10, 8, "Win32 paths + fonts", 19) = 0 Then Err.Raise 5, , "TextOut failed"
    target = picCanvas.hDC
    saved = SaveDC(target)
    SetGraphicsMode target, 2
    transform.eM11 = 1
    transform.eM22 = 1
    transform.eM21 = 0.2
    transform.eDx = 12
    transform.eDy = 8
    If SetWorldTransform(target, transform) = 0 Then Err.Raise 5, , "SetWorldTransform failed"
    BeginPath target
    MoveToEx target, 0, 0, 0
    LineTo target, 440, 0
    LineTo target, 440, 76
    LineTo target, 0, 76
    CloseFigure target
    EndPath target
    If SelectClipPath(target, 5) = 0 Then Err.Raise 5, , "SelectClipPath failed"
    SetStretchBltMode target, 3
    If StretchBlt(target, 0, 0, 440, 76, memoryDC, 0, 0, 232, 44, &HCC0020) = 0 Then Err.Raise 5, , "Affine blit failed"
    lblStatus.Caption = "Affine path clip + real fonts in a memory DC. Shared browser/HTML runtime."
    GoTo Cleanup
Failed:
    lblStatus.Caption = "Advanced GDI error: " & Err.Description & " / " & CStr(Err.LastDLLError)
Cleanup:
    If saved <> 0 Then RestoreDC target, saved
    If target <> 0 Then ReleaseDC picCanvas.hWnd, target
    If oldFont <> 0 Then SelectObject memoryDC, oldFont
    If font <> 0 Then DeleteObject font
    If oldBrush <> 0 Then SelectObject memoryDC, oldBrush
    If brush <> 0 Then DeleteObject brush
    If oldBitmap <> 0 Then SelectObject memoryDC, oldBitmap
    If bitmap <> 0 Then DeleteObject bitmap
    If memoryDC <> 0 Then DeleteDC memoryDC
End Sub
`;
  return p;
}
