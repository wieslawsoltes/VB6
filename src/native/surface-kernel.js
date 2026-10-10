/** Compiler-owned surface service. This VB is compiled to IA-32 by the same
 * typed backend; neither the source nor a VB/JavaScript VM is shipped in a PE.
 * Each retained HDC owns one bitmap. Only the temporary allocation is rolled
 * back on resize failure; published pixels and HDC attributes survive.
 * https://learn.microsoft.com/windows/win32/gdi/memory-device-contexts
 */
export const SURFACE_KERNEL = String.raw`Option Explicit
Private Type Surface
 hwnd As Long
 dc As Long
 bitmap As Long
 original As Long
 width As Long
 height As Long
 redraw As Long
 scale As Long
 back As Long
 fore As Long
 x As Double
 y As Double
 penWidth As Long
 penStyle As Long
 drawMode As Long
 fillColor As Long
 fillStyle As Long
 pictureSlot As Long
 font As Long
 epoch As Long
 painting As Long
End Type
Private Type RECT
 left As Long
 top As Long
 right As Long
 bottom As Long
End Type
Private Type BIH
 size As Long
 width As Long
 height As Long
 planes As Integer
 bits As Integer
 compression As Long
 imageSize As Long
 xppm As Long
 yppm As Long
 colors As Long
 important As Long
End Type
Private Declare Function UpdateWindow Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function IsWindow Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function GetDC Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function ReleaseDC Lib "user32" (ByVal hwnd As Long, ByVal dc As Long) As Long
Private Declare Function GetClientRect Lib "user32" (ByVal hwnd As Long, bounds As RECT) As Long
Private Declare Function InvalidateRect Lib "user32" (ByVal hwnd As Long, ByVal bounds As Long, ByVal erase As Long) As Long
Private Declare Function FillRect Lib "user32" (ByVal dc As Long, bounds As RECT, ByVal brush As Long) As Long
Private Declare Function GetSysColor Lib "user32" (ByVal index As Long) As Long
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreateDIBSection Lib "gdi32" (ByVal dc As Long, info As BIH, ByVal use As Long, bits As Long, ByVal section As Long, ByVal offset As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long, ByVal object As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function CreateSolidBrush Lib "gdi32" (ByVal color As Long) As Long
Private Declare Function BitBlt Lib "gdi32" (ByVal dst As Long, ByVal x As Long, ByVal y As Long, ByVal w As Long, ByVal h As Long, ByVal src As Long, ByVal sx As Long, ByVal sy As Long, ByVal rop As Long) As Long
Private Declare Function SaveDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function RestoreDC Lib "gdi32" (ByVal dc As Long, ByVal saved As Long) As Long
Private Declare Function SetMapMode Lib "gdi32" (ByVal dc As Long, ByVal mode As Long) As Long
Private Declare Function SetWindowOrgEx Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal old As Long) As Long
Private Declare Function SetViewportOrgEx Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal old As Long) As Long
Private Declare Function SetGraphicsMode Lib "gdi32" (ByVal dc As Long, ByVal mode As Long) As Long
Private Declare Function ModifyWorldTransform Lib "gdi32" (ByVal dc As Long, ByVal matrix As Long, ByVal mode As Long) As Long
Private Declare Function SelectClipRgn Lib "gdi32" (ByVal dc As Long, ByVal region As Long) As Long
Private Sub SeedPicture(s As Surface, ByVal dc As Long, ByVal width As Long, ByVal height As Long)
End Sub
Private Function SurfaceColor(ByVal value As Long) As Long
 If value<0 Then
  SurfaceColor=GetSysColor(value And 255)
 Else
  SurfaceColor=value And &HFFFFFF
 End If
End Function
Private Sub SurfaceRelease(s As Surface)
 Dim n As Long
 If s.dc<>0 Then
  If s.bitmap<>0 Then
   n=SelectObject(s.dc,s.original)
   n=DeleteObject(s.bitmap)
   n=DeleteDC(s.dc)
  Else
   n=ReleaseDC(s.hwnd,s.dc)
  End If
 End If
 s.dc=0
 s.bitmap=0
 s.original=0
 s.width=0
 s.height=0
End Sub
Private Function PixelState(ByVal dc As Long) As Long
 Dim saved As Long,n As Long,code As Long
 saved=SaveDC(dc)
 If saved=0 Then Error 7
 On Error GoTo Failed
 If SetGraphicsMode(dc,2)=0 Then Error 5
 If ModifyWorldTransform(dc,0,1)=0 Then Error 5
 If SetMapMode(dc,1)=0 Then Error 5
 If SetWindowOrgEx(dc,0,0,0)=0 Then Error 5
 If SetViewportOrgEx(dc,0,0,0)=0 Then Error 5
 If SelectClipRgn(dc,0)=0 Then Error 5
 PixelState=saved
 Exit Function
Failed:
 code=Err.Number
 n=RestoreDC(dc,saved)
 Error code
End Function
Private Sub SurfaceBackground(s As Surface, ByVal dc As Long, ByVal width As Long, ByVal height As Long)
 Dim bounds As RECT,brush As Long,n As Long,saved As Long,code As Long
 On Error GoTo Failed
 saved=PixelState(dc)
 bounds.right=width
 bounds.bottom=height
 brush=CreateSolidBrush(SurfaceColor(s.back))
 If brush=0 Then Error 7
 n=FillRect(dc,bounds,brush)
 If n=0 Then Error 5
 SeedPicture s,dc,width,height
 GoTo Cleanup
Failed:
 code=Err.Number
Cleanup:
 If saved<>0 Then n=RestoreDC(dc,saved)
 If brush<>0 Then n=DeleteObject(brush)
 If code<>0 Then Error code
End Sub
Private Sub SurfaceInstallFont(s As Surface)
 Dim n As Long
 If s.dc<>0 And s.font<>0 Then n=SelectObject(s.dc,s.font)
End Sub
Private Function SurfaceDC(s As Surface) As Long
 Dim bounds As RECT,info As BIH,w As Long,h As Long,bits As Long
 Dim dc As Long,bitmap As Long,original As Long,n As Long,saved As Long,code As Long,created As Boolean
 If s.hwnd=0 Then Error 91
 If IsWindow(s.hwnd)=0 Then Error 91
 If s.redraw=0 Then
  If s.dc=0 Then
   s.dc=GetDC(s.hwnd)
   If s.dc=0 Then Error 7
   SurfaceInstallFont s
  End If
  SurfaceDC=s.dc
  Exit Function
 End If
 If GetClientRect(s.hwnd,bounds)=0 Then Error 5
 w=bounds.right
 h=bounds.bottom
 If w<1 Then w=1
 If h<1 Then h=1
 ' Retain pixels outside a temporary shrink; backing only grows until Cls/reset.
 If w<s.width Then w=s.width
 If h<s.height Then h=s.height
 If w>16384 Or h>16384 Then Error 7
 If w*h>67108864 Then Error 7
 If s.dc<>0 And w=s.width And h=s.height Then
  SurfaceDC=s.dc
  Exit Function
 End If
 On Error GoTo Failed
 dc=CreateCompatibleDC(0)
 If dc=0 Then Error 7
 info.size=40
 info.width=w
 info.height=-h
 info.planes=1
 info.bits=32
 bitmap=CreateDIBSection(dc,info,0,bits,0,0)
 If bitmap=0 Then Error 7
 original=SelectObject(dc,bitmap)
 If original=0 Or original=-1 Then Error 7
 SurfaceBackground s,dc,w,h
 If s.dc<>0 Then
  saved=PixelState(s.dc)
  n=BitBlt(dc,0,0,s.width,s.height,s.dc,0,0,&HCC0020)
  If n=0 Then Error 5
  n=RestoreDC(s.dc,saved)
  saved=0
  n=SelectObject(dc,original)
  If n=0 Or n=-1 Then Error 7
  n=SelectObject(s.dc,bitmap)
  If n=0 Or n=-1 Then Error 7
  n=DeleteObject(s.bitmap)
  n=DeleteDC(dc)
  dc=0
 Else
  s.dc=dc
  s.original=original
  created=True
  dc=0
 End If
 s.bitmap=bitmap
 s.width=w
 s.height=h
 bitmap=0
 If created Then SurfaceInstallFont s
 SurfaceDC=s.dc
 Exit Function
Failed:
 code=Err.Number
 If saved<>0 Then n=RestoreDC(s.dc,saved)
 If dc<>0 And original<>0 And original<>-1 Then n=SelectObject(dc,original)
 If bitmap<>0 Then n=DeleteObject(bitmap)
 If dc<>0 Then n=DeleteDC(dc)
 Error code
End Function
Private Sub SurfaceClear(s As Surface)
 Dim dc As Long,bounds As RECT,n As Long
 dc=SurfaceDC(s)
 If GetClientRect(s.hwnd,bounds)=0 Then Error 5
 If s.redraw<>0 Then
  SurfaceBackground s,dc,s.width,s.height
 Else
  SurfaceBackground s,dc,bounds.right,bounds.bottom
 End If
 s.x=0
 s.y=0
 If s.redraw<>0 Then n=InvalidateRect(s.hwnd,0,0)
End Sub
Private Sub SurfacePaint(s As Surface, ByVal target As Long)
 Dim dc As Long,bounds As RECT,saved As Long,n As Long,code As Long
 If s.hwnd=0 Then Exit Sub
 If GetClientRect(s.hwnd,bounds)=0 Then Exit Sub
 If bounds.right<=0 Or bounds.bottom<=0 Then Exit Sub
 If s.redraw=0 Then
  SurfaceBackground s,target,bounds.right,bounds.bottom
  Exit Sub
 End If
 On Error GoTo Failed
 dc=SurfaceDC(s)
 saved=PixelState(dc)
 n=BitBlt(target,0,0,bounds.right,bounds.bottom,dc,0,0,&HCC0020)
 If n=0 Then Error 5
 GoTo Cleanup
Failed:
 code=Err.Number
Cleanup:
 If saved<>0 Then n=RestoreDC(dc,saved)
 If code<>0 Then Error code
End Sub

Private Type PAINTSTRUCT
 hdc As Long
 erase As Long
 bounds As RECT
 restore As Long
 update As Long
 reserved(0 To 31) As Byte
End Type
Private Declare Function BeginPaint Lib "user32" (ByVal hwnd As Long, paint As PAINTSTRUCT) As Long
Private Declare Function EndPaint Lib "user32" (ByVal hwnd As Long, paint As PAINTSTRUCT) As Long
Private Sub SurfaceValidate(s As Surface, ByVal epoch As Long)
 If s.epoch<>epoch Or s.hwnd=0 Then Error 91
 If IsWindow(s.hwnd)=0 Then Error 91
End Sub
Private Function SurfaceHDC(s As Surface, ByVal epoch As Long) As Long
 Dim n As Long
 SurfaceValidate s,epoch
 SurfaceHDC=SurfaceDC(s)
 If s.redraw<>0 And s.painting=0 Then n=InvalidateRect(s.hwnd,0,0)
End Function
Private Sub SurfaceRefresh(s As Surface, ByVal epoch As Long)
 Dim n As Long
 SurfaceValidate s,epoch
 n=InvalidateRect(s.hwnd,0,0)
 n=UpdateWindow(s.hwnd)
End Sub
Private Sub SurfaceCls(s As Surface, ByVal epoch As Long)
 SurfaceValidate s,epoch
 SurfaceClear s
End Sub
Private Function SurfaceSize(s As Surface, ByVal epoch As Long, ByVal vertical As Boolean) As Double
 Dim bounds As RECT,n As Long
 SurfaceValidate s,epoch
 If GetClientRect(s.hwnd,bounds)=0 Then Error 5
 If vertical Then n=bounds.bottom Else n=bounds.right
 If s.scale=1 Then
  SurfaceSize=n*15
 Else
  SurfaceSize=n
 End If
End Function
Private Sub SurfaceDestroy(s As Surface)
 If s.hwnd=0 Then Exit Sub
 SurfaceRelease s
 s.hwnd=0
 If s.epoch<&H7FFFFFFF Then s.epoch=s.epoch+1
End Sub
Private Sub SurfaceBackgroundChanged(s As Surface)
 Dim bounds As RECT,dc As Long,n As Long
 If s.hwnd=0 Then Exit Sub
 dc=SurfaceDC(s)
 If GetClientRect(s.hwnd,bounds)=0 Then Error 5
 If s.redraw<>0 Then
  SurfaceBackground s,dc,s.width,s.height
 Else
  SurfaceBackground s,dc,bounds.right,bounds.bottom
 End If
 n=InvalidateRect(s.hwnd,0,0)
End Sub
Private Sub SurfaceSet(s As Surface, ByVal epoch As Long, ByVal field As Long, ByVal value As Double)
 Dim n As Long,flag As Long
 SurfaceValidate s,epoch
 Select Case field
 Case 0
  If value<>0 Then flag=-1
  If flag=s.redraw Then Exit Sub
  SurfaceRelease s
  s.redraw=flag
  SurfaceBackgroundChanged s
 Case 1
  n=CLng(value)
  If n<>1 And n<>3 Then Error 380
  s.scale=n
 Case 2
  s.back=CLng(value)
  SurfaceBackgroundChanged s
 Case 3
  s.fore=CLng(value)
 Case 4
  s.x=CSng(value)
 Case 5
  s.y=CSng(value)
 Case 6
  n=CLng(value)
  If n<1 Or n>32767 Then Error 380
  s.penWidth=n
 Case 7
  n=CLng(value)
  If n<0 Or n>6 Then Error 380
  s.penStyle=n
 Case 8
  n=CLng(value)
  If n<1 Or n>16 Then Error 380
  s.drawMode=n
 Case 9
  s.fillColor=CLng(value)
 Case 10
  n=CLng(value)
  If n<0 Or n>7 Then Error 380
  s.fillStyle=n
 Case Else
  Error 438
 End Select
End Sub
Private Sub SurfacePaintWindow(s As Surface)
 Dim paint As PAINTSTRUCT,dc As Long,n As Long,code As Long,hwnd As Long
 hwnd=s.hwnd
 dc=BeginPaint(hwnd,paint)
 If dc=0 Then Exit Sub
 On Error GoTo Failed
 SurfacePaint s,dc
 GoTo Cleanup
Failed:
 code=Err.Number
Cleanup:
 n=EndPaint(hwnd,paint)
 If code<>0 Then Error code
End Sub
`;
