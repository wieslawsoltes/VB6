/** Real HWND/GDI acceptance. Memory HDCs, pixels, resize state and destruction
 * are read back with independent Windows APIs; no browser drawing substitute. */
export function nativeSurfaceFixture(fixture){
  const {control,add,check,finish}=fixture('AotControlSurfaces');
  control('PictureBox','Canvas',{AutoRedraw:-1,ScaleMode:3,BackColor:0xabcdef,Width:1800,Height:1200,BorderStyle:0});
  control('PictureBox','Panels',{Index:3,AutoRedraw:-1,ScaleMode:3,BackColor:0x112233,Left:2400,Width:1200,Height:900,BorderStyle:0});
  control('PictureBox','Panels',{Index:7,AutoRedraw:-1,ScaleMode:1,BackColor:0x445566,Left:3900,Width:1200,Height:900,BorderStyle:0});
  add('Dim dc As Long,other As Long,n As Long,bitmap As Long,copy As Long,old As Long,saved As Long,region As Long,got As Long,point As POINTAPI,bounds As RECTAPI,baseline As Long');
  add('dc=Canvas.hDC');
  check('dc<>0 And dc=Canvas.hDC And GetObjectType(dc)=10','AutoRedraw exposes one stable real memory HDC');
  check('GetPixel(dc,3,3)=&HABCDEF','retained DIB starts with the authored COLORREF background');
  check('Canvas.ScaleWidth=120 And Canvas.ScaleHeight=80','PictureBox client extents use authored pixel units');
  add('n=SetPixelV(dc,3,3,&H336699)\ncopy=CreateCompatibleDC(0)\nbitmap=CreateBitmap(200,160,1,32,0)\nold=SelectObject(copy,bitmap)\nn=SendValue(Canvas.hWnd,&H318,copy,4)');
  check('GetPixel(copy,3,3)=&H336699 And GetPixel(copy,10,10)=&HABCDEF','WM_PRINTCLIENT copies actual retained pixels into an independent target bitmap');
  add('region=CreateRectRgn(1,2,7,8)\nn=SelectClipRgn(dc,region)\nn=SetViewportOrgEx(dc,9,12,point)\nCanvas.Move 150,150,3000,2400\nother=Canvas.hDC\ngot=CreateRectRgn(0,0,0,0)\nn=GetClipRgn(dc,got)');
  check('other=dc And n=1 And EqualRgn(region,got)<>0','backing growth preserves HDC identity and the caller clip region');
  add('n=GetViewportOrgEx(dc,point)');check('point.x=9 And point.y=12','backing growth restores the caller viewport origin');
  add('n=SelectClipRgn(dc,0)\nn=SetViewportOrgEx(dc,0,0,point)\nn=DeleteObject(region)\nn=DeleteObject(got)');
  check('GetPixel(dc,3,3)=&H336699 And GetPixel(dc,199,159)=&HABCDEF','growth retains overlapping pixels and initializes newly exposed backing');
  add('Canvas.Move 150,150,600,600\nother=Canvas.hDC\nCanvas.Move 150,150,3000,2400\nother=Canvas.hDC');
  check('other=dc And GetPixel(dc,3,3)=&H336699','shrink and regrowth retain the original bitmap contents');
  add('Canvas.CurrentX=2.5\nCanvas.CurrentY=7.25');check('Canvas.CurrentX=2.5 And Canvas.CurrentY=7.25','drawing positions preserve fractional source coordinates');
  add('Canvas.Cls');check('Canvas.CurrentX=0 And Canvas.CurrentY=0 And GetPixel(dc,3,3)=&HABCDEF','Cls restores background and resets both drawing coordinates');
  add('Canvas.ScaleMode=1');check('Canvas.ScaleWidth=3000 And Canvas.ScaleHeight=2400','mutable twip ScaleMode changes client extent conversion');
  add('On Error Resume Next\nErr.Clear\nCanvas.ScaleMode=2');check('Err.Number=380 And Canvas.ScaleMode=1','unsupported ScaleMode is rejected before changing state');
  add('Err.Clear\nOn Error GoTo 0\nCanvas.ScaleMode=3\nother=Panels(3).hDC\nn=SetPixelV(other,2,2,&H765432)');
  check('other<>dc And GetPixel(Panels(7).hDC,2,2)=&H445566','indexed PictureBox elements retain independent surfaces');
  add('sequence=0\nWith Panels(Choose())\n .BackColor=&H556677\n .Cls\n other=.hDC\nEnd With');
  check('sequence=1 And GetPixel(other,2,2)=&H556677 And GetPixel(Panels(7).hDC,2,2)=&H445566','With evaluates an indexed surface once and isolates sibling colors');
  add('Panels(3).FontName="Arial"\nPanels(3).FontSize=14\nother=Panels(3).hDC');
  check('GetCurrentObject(other,6)=SendValue(Panels(3).hWnd,&H31,0,0)','mutable VB font replaces the selected surface font before the old HFONT is deleted');
  add('Canvas.AutoRedraw=False\nother=Canvas.hDC');check('GetObjectType(other)=3 And Not Canvas.AutoRedraw','disabling AutoRedraw uses a real window DC rather than memory backing');
  add('Canvas.AutoRedraw=True\ndc=Canvas.hDC');check('GetObjectType(dc)=10 And Canvas.AutoRedraw And GetPixel(dc,1,1)=&HABCDEF','enabling AutoRedraw creates fresh owned backing');
  add('baseline=GetGuiResources(GetCurrentProcess(),0)\nother=Panels(7).hDC\nn=DestroyWindow(Panels(7).hWnd)');
  check('n<>0 And GetObjectType(other)=0 And GetGuiResources(GetCurrentProcess(),0)<=baseline-2','native HWND destruction frees the owned HDC and bitmap immediately');
  add('On Error Resume Next\nErr.Clear\nPanels(3).BackColor=DestroyReceiver()');
  check('Err.Number=91','receiver destruction during an assignment expression cannot mutate stale surface state');
  add('Err.Clear\nOn Error GoTo 0\nn=SelectObject(copy,old)\nn=DeleteObject(bitmap)\nn=DeleteDC(copy)');
  return finish(`Private sequence As Long
Private Type POINTAPI
 x As Long
 y As Long
End Type
Private Type RECTAPI
 left As Long
 top As Long
 right As Long
 bottom As Long
End Type
Private Declare Function GetObjectType Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function GetCurrentObject Lib "gdi32" (ByVal dc As Long,ByVal kind As Long) As Long
Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function SetPixelV Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal color As Long) As Long
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreateBitmap Lib "gdi32" (ByVal w As Long,ByVal h As Long,ByVal planes As Long,ByVal bits As Long,ByVal pixels As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long,ByVal object As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreateRectRgn Lib "gdi32" (ByVal left As Long,ByVal top As Long,ByVal right As Long,ByVal bottom As Long) As Long
Private Declare Function SelectClipRgn Lib "gdi32" (ByVal dc As Long,ByVal region As Long) As Long
Private Declare Function GetClipRgn Lib "gdi32" (ByVal dc As Long,ByVal region As Long) As Long
Private Declare Function EqualRgn Lib "gdi32" (ByVal first As Long,ByVal second As Long) As Long
Private Declare Function GetViewportOrgEx Lib "gdi32" (ByVal dc As Long,point As POINTAPI) As Long
Private Declare Function SetViewportOrgEx Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,point As POINTAPI) As Long
Private Declare Function GetGuiResources Lib "user32" (ByVal process As Long,ByVal kind As Long) As Long
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long
Private Declare Function DestroyWindow Lib "user32" (ByVal hwnd As Long) As Long`,
`Private Function Choose() As Integer
 sequence=sequence+1
 Choose=3
End Function
Private Function DestroyReceiver() As Long
 Dim n As Long
 n=DestroyWindow(Panels(3).hWnd)
 DestroyReceiver=123
End Function`);
}
