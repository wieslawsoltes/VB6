/** Drawing/text kernels compiled to x86. GDI owns rasterization and fonts; all
 * pens/brushes and SaveDC frames are scoped to an invocation, including errors.
 * Pixel conversion uses the surface's documented Twips/Pixels scale contract.
 */
export const SURFACE_DRAWING_KERNEL=String.raw`
Private Type TEXTSIZE
 width As Long
 height As Long
End Type
Private Type TEXTMETRIC
 height As Long
 ascent As Long
 descent As Long
 internalLeading As Long
 externalLeading As Long
 averageWidth As Long
 maximumWidth As Long
 weight As Long
 overhang As Long
 aspectX As Long
 aspectY As Long
 first As Integer
 last As Integer
 defaultChar As Integer
 breakChar As Integer
 italic As Byte
 underline As Byte
 strike As Byte
 pitch As Byte
 charset As Byte
End Type
Private Declare Function CreatePen Lib "gdi32" (ByVal style As Long,ByVal width As Long,ByVal color As Long) As Long
Private Declare Function CreateHatchBrush Lib "gdi32" (ByVal style As Long,ByVal color As Long) As Long
Private Declare Function GetStockObject Lib "gdi32" (ByVal index As Long) As Long
Private Declare Function SetROP2 Lib "gdi32" (ByVal dc As Long,ByVal mode As Long) As Long
Private Declare Function MoveToEx Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal previous As Long) As Long
Private Declare Function LineTo Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function Rectangle Lib "gdi32" (ByVal dc As Long,ByVal left As Long,ByVal top As Long,ByVal right As Long,ByVal bottom As Long) As Long
Private Declare Function Ellipse Lib "gdi32" (ByVal dc As Long,ByVal left As Long,ByVal top As Long,ByVal right As Long,ByVal bottom As Long) As Long
Private Declare Function SetPixelV Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal color As Long) As Long
Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function SetBkMode Lib "gdi32" (ByVal dc As Long,ByVal mode As Long) As Long
Private Declare Function SetBkColor Lib "gdi32" (ByVal dc As Long,ByVal color As Long) As Long
Private Declare Function SetTextColor Lib "gdi32" (ByVal dc As Long,ByVal color As Long) As Long
Private Declare Function SetTextAlign Lib "gdi32" (ByVal dc As Long,ByVal flags As Long) As Long
Private Declare Function TextOutW Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal text As Long,ByVal count As Long) As Long
Private Declare Function GetTextExtentPoint32W Lib "gdi32" (ByVal dc As Long,ByVal text As Long,ByVal count As Long,size As TEXTSIZE) As Long
Private Declare Function GetTextMetricsW Lib "gdi32" (ByVal dc As Long,metrics As TEXTMETRIC) As Long
Private Declare Function SendMessageW Lib "user32" (ByVal hwnd As Long,ByVal message As Long,ByVal wp As Long,ByVal lp As Long) As Long
Private Function SurfacePixel(s As Surface,ByVal value As Double) As Long
 If s.scale=1 Then value=value/15
 ' Avoid overflow in bounding-box endpoint adjustment and pathological GDI input.
 If value< -16777216 Or value>16777216 Then Error 6
 SurfacePixel=CLng(value)
End Function
Private Function SurfaceUnits(s As Surface,ByVal value As Long) As Double
 If s.scale=1 Then
  SurfaceUnits=CDbl(value)*15
 Else
  SurfaceUnits=value
 End If
End Function
Private Sub SurfaceSelect(ByVal dc As Long,ByVal object As Long)
 Dim previous As Long
 If object=0 Then Error 7
 previous=SelectObject(dc,object)
 If previous=0 Or previous=-1 Then Error 7
End Sub
Private Function SurfaceHatch(ByVal style As Long) As Long
 Select Case style
 Case 2: SurfaceHatch=0
 Case 3: SurfaceHatch=1
 Case 4: SurfaceHatch=3
 Case 5: SurfaceHatch=2
 Case 6: SurfaceHatch=4
 Case 7: SurfaceHatch=5
 Case Else: Error 380
 End Select
End Function
Private Function SurfacePixelColor(ByVal pen As Long,ByVal pixel As Long,ByVal mode As Long) As Long
 ' R2_* codes are the sixteen Boolean operations on destination and pen bits.
 Select Case mode
 Case 1: SurfacePixelColor=0
 Case 2: SurfacePixelColor=Not (pixel Or pen)
 Case 3: SurfacePixelColor=pixel And Not pen
 Case 4: SurfacePixelColor=Not pen
 Case 5: SurfacePixelColor=pen And Not pixel
 Case 6: SurfacePixelColor=Not pixel
 Case 7: SurfacePixelColor=pixel Xor pen
 Case 8: SurfacePixelColor=Not (pixel And pen)
 Case 9: SurfacePixelColor=pixel And pen
 Case 10: SurfacePixelColor=Not (pixel Xor pen)
 Case 11: SurfacePixelColor=pixel
 Case 12: SurfacePixelColor=pixel Or Not pen
 Case 13: SurfacePixelColor=pen
 Case 14: SurfacePixelColor=pen Or Not pixel
 Case 15: SurfacePixelColor=pixel Or pen
 Case 16: SurfacePixelColor=&HFFFFFF
 Case Else: Error 380
 End Select
 SurfacePixelColor=SurfacePixelColor And &HFFFFFF
End Function
Private Sub SurfaceDraw(s As Surface,ByVal epoch As Long,ByVal kind As Long,ByVal ax As Double,ByVal ay As Double,ByVal bx As Double,ByVal by As Double,ByVal color As Long)
 Dim dc As Long,saved As Long,pen As Long,brush As Long,n As Long,code As Long
 Dim x1 As Long,y1 As Long,x2 As Long,y2 As Long,radius As Long,swap As Long,pixel As Long
 SurfaceValidate s,epoch
 x1=SurfacePixel(s,ax)
 y1=SurfacePixel(s,ay)
 x2=SurfacePixel(s,bx)
 y2=SurfacePixel(s,by)
 If kind<0 Or kind>4 Then Error 5
 If kind=3 And bx<0 Then Error 5
 color=SurfaceColor(color)
 If kind=3 Then
  radius=x2
  x2=x1+radius
  y2=y1+radius
  x1=x1-radius
  y1=y1-radius
 ElseIf kind=1 Or kind=2 Then
  If x1>x2 Then
   swap=x1:x1=x2:x2=swap
  End If
  If y1>y2 Then
   swap=y1:y1=y2:y2=swap
  End If
 ElseIf kind=4 And s.penWidth>1 Then
  x1=x1-(s.penWidth-1)\2
  y1=y1-(s.penWidth-1)\2
  x2=x1+s.penWidth-1
  y2=y1+s.penWidth-1
 End If
 dc=SurfaceDC(s)
 On Error GoTo Failed
 saved=SaveDC(dc)
 If saved=0 Then Error 7
 n=SetROP2(dc,s.drawMode)
 If n=0 Then Error 5
 If kind=4 And s.penWidth=1 Then
  pixel=GetPixel(dc,x1,y1)
  ' GDI returns CLR_INVALID outside the surface/clip; PSet there is a no-op.
  If pixel<>-1 Then
   pixel=SurfacePixelColor(color,pixel,s.drawMode)
   n=SetPixelV(dc,x1,y1,pixel)
   If n=0 Then Error 5
  End If
 Else
  If kind=2 Or kind=4 Then
   pen=CreatePen(0,1,color)
   brush=CreateSolidBrush(color)
  Else
   pen=CreatePen(s.penStyle,s.penWidth,color)
   If s.fillStyle=0 Then
    brush=CreateSolidBrush(SurfaceColor(s.fillColor))
   ElseIf s.fillStyle<>1 Then
    brush=CreateHatchBrush(SurfaceHatch(s.fillStyle),SurfaceColor(s.fillColor))
   End If
  End If
  SurfaceSelect dc,pen
  If kind<>0 Then
   If brush<>0 Then
    SurfaceSelect dc,brush
   ElseIf s.fillStyle=1 And kind<>2 And kind<>4 Then
    SurfaceSelect dc,GetStockObject(5)
   Else
    Error 7
   End If
   n=SetBkMode(dc,1)
   If n=0 Then Error 5
  End If
  Select Case kind
  Case 0
   n=MoveToEx(dc,x1,y1,0)
   If n=0 Then Error 5
   n=LineTo(dc,x2,y2)
  Case 1,2,4
   ' Inclusive VB endpoints require GDI's exclusive lower/right boundary +1.
   n=Rectangle(dc,x1,y1,x2+1,y2+1)
  Case 3
   n=Ellipse(dc,x1,y1,x2+1,y2+1)
  End Select
  If n=0 Then Error 5
 End If
 If kind=0 Or kind=1 Or kind=2 Then
  s.x=CSng(bx):s.y=CSng(by)
 Else
  s.x=CSng(ax):s.y=CSng(ay)
 End If
 GoTo Cleanup
Failed:
 code=Err.Number
Cleanup:
 If saved<>0 Then n=RestoreDC(dc,saved)
 If brush<>0 Then n=DeleteObject(brush)
 If pen<>0 Then n=DeleteObject(pen)
 If s.redraw<>0 Then n=InvalidateRect(s.hwnd,0,0)
 If code<>0 Then Error code
End Sub
Private Sub SurfaceFont(s As Surface,ByVal dc As Long)
 Dim font As Long
 font=SendMessageW(s.hwnd,&H31,0,0)
 If font=0 Then font=s.font
 If font=0 Then font=GetStockObject(17)
 SurfaceSelect dc,font
End Sub
Private Function SurfaceLineLength(ByVal text As Long,ByVal count As Long) As Long
 ' Replaced by the compiler's bounded UTF-16 scan, not a source/runtime payload.
End Function
Private Function SurfaceColumn(s As Surface,ByVal epoch As Long) As Long
 Dim dc As Long,saved As Long,n As Long,code As Long,metrics As TEXTMETRIC
 SurfaceValidate s,epoch
 dc=SurfaceDC(s)
 On Error GoTo Failed
 saved=SaveDC(dc)
 If saved=0 Then Error 7
 SurfaceFont s,dc
 If GetTextMetricsW(dc,metrics)=0 Then Error 5
 If metrics.averageWidth<1 Then Error 5
 SurfaceColumn=SurfacePixel(s,s.x)\metrics.averageWidth
 If SurfaceColumn<0 Then SurfaceColumn=0
 GoTo Cleanup
Failed:
 code=Err.Number
Cleanup:
 If saved<>0 Then n=RestoreDC(dc,saved)
 If code<>0 Then Error code
End Function
Private Sub SurfaceText(s As Surface,ByVal epoch As Long,ByVal text As String)
 Dim dc As Long,saved As Long,n As Long,code As Long,size As TEXTSIZE,metrics As TEXTMETRIC
 Dim count As Long,offset As Long,length As Long,x As Double,y As Double
 SurfaceValidate s,epoch
 dc=SurfaceDC(s)
 x=s.x:y=s.y:count=Len(text)
 On Error GoTo Failed
 saved=SaveDC(dc)
 If saved=0 Then Error 7
 SurfaceFont s,dc
 n=SetTextAlign(dc,0)
 If n=-1 Then Error 5
 n=SetTextColor(dc,SurfaceColor(s.fore))
 If n=-1 Then Error 5
 If SetBkMode(dc,1)=0 Then Error 5
 If GetTextMetricsW(dc,metrics)=0 Then Error 5
 Do While offset<count
  length=SurfaceLineLength(StrPtr(text)+offset*2,count-offset)
  If length>0 Then
   If GetTextExtentPoint32W(dc,StrPtr(text)+offset*2,length,size)=0 Then Error 5
   If TextOutW(dc,SurfacePixel(s,x),SurfacePixel(s,y),StrPtr(text)+offset*2,length)=0 Then Error 5
   x=x+SurfaceUnits(s,size.width)
  End If
  offset=offset+length
  If offset<count Then
   If Mid$(text,offset+1,2)=vbCrLf Then offset=offset+1
   offset=offset+1
   x=0
   y=y+SurfaceUnits(s,metrics.height+metrics.externalLeading)
  End If
 Loop
 s.x=CSng(x):s.y=CSng(y)
 GoTo Cleanup
Failed:
 code=Err.Number
Cleanup:
 If saved<>0 Then n=RestoreDC(dc,saved)
 If s.redraw<>0 Then n=InvalidateRect(s.hwnd,0,0)
 If code<>0 Then Error code
End Sub
Private Function SurfaceMeasure(s As Surface,ByVal epoch As Long,ByVal text As String,ByVal vertical As Boolean) As Double
 Dim dc As Long,saved As Long,n As Long,code As Long,size As TEXTSIZE,metrics As TEXTMETRIC
 Dim count As Long,offset As Long,length As Long,width As Long,height As Long
 SurfaceValidate s,epoch
 dc=SurfaceDC(s):count=Len(text)
 On Error GoTo Failed
 saved=SaveDC(dc)
 If saved=0 Then Error 7
 SurfaceFont s,dc
 If GetTextMetricsW(dc,metrics)=0 Then Error 5
 height=metrics.height+metrics.externalLeading
 Do While offset<count
  length=SurfaceLineLength(StrPtr(text)+offset*2,count-offset)
  If length>0 Then
   If GetTextExtentPoint32W(dc,StrPtr(text)+offset*2,length,size)=0 Then Error 5
   If size.width>width Then width=size.width
  End If
  offset=offset+length
  If offset<count Then
   If Mid$(text,offset+1,2)=vbCrLf Then offset=offset+1
   offset=offset+1
   height=height+metrics.height+metrics.externalLeading
  End If
 Loop
 If vertical Then
  SurfaceMeasure=SurfaceUnits(s,height)
 Else
  SurfaceMeasure=SurfaceUnits(s,width)
 End If
 GoTo Cleanup
Failed:
 code=Err.Number
Cleanup:
 If saved<>0 Then n=RestoreDC(dc,saved)
 If code<>0 Then Error code
End Function
`;
