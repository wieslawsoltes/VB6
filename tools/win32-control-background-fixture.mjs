/** Real Win32 background acceptance. Each target starts with sentinel pixels;
 * the actual STATIC/BS_GROUPBOX and parent window procedures must replace them.
 * No desktop readback, API hooks, or JavaScript painting participates. */
export function nativeControlBackgroundFixture(fixture){
  const {control,add,check,finish}=fixture('AotControlBackgroundPixels');
  control('Label','Title',{Left:600,Top:600,Width:2700,Height:600,Caption:'Northwind Traders',BackStyle:0});
  control('Frame','Group',{Left:450,Top:1650,Width:3150,Height:1800,Caption:'Customer information',BackColor:0x556677});
  control('Label','Nested',{Left:300,Top:450,Width:1800,Height:600,Caption:'Order total',BackStyle:0},'Group');
  add('Dim dc As Long,bitmap As Long,old As Long,n As Long,i As Long,baseline As Long,origin As POINT');
  add('dc=CreateCompatibleDC(0)\nbitmap=CreateBitmap(256,128,1,32,0)\nold=SelectObject(dc,bitmap)');
  check('dc<>0 And bitmap<>0 And old<>0','the independent bitmap oracle is allocated');
  add('PaintControl Title.hWnd,dc');
  check('GetPixel(dc,100,25)=GetSysColor(15)','transparent title first paint replaces sentinel pixels with its real parent background');
  check('GetPixel(dc,210,80)=&HFF00FF','transparent child composition does not paint outside its client bounds');
  add('Me.BackColor=&H224466\nPaintControl Title.hWnd,dc');
  check('GetPixel(dc,100,25)=&H224466','transparent title follows a changed nonretained Form background');
  add('PaintControl Group.hWnd,dc');
  check('GetPixel(dc,100,80)=&H556677','native Frame erases its interior even with WS_CLIPCHILDREN');
  add('PaintControl Nested.hWnd,dc');
  check('GetPixel(dc,70,25)=&H556677','nested transparent label composes its immediate Frame rather than the desktop');
  add('Group.BackColor=&H113355\nPaintControl Nested.hWnd,dc');
  check('GetPixel(dc,70,25)=&H113355','nested label repaint uses the current container color');
  add('Me.AutoRedraw=True\nMe.ScaleMode=3\nMe.Cls\nMe.Line (50,30)-(200,100),&H887766,BF\nPaintControl Title.hWnd,dc');
  check('GetPixel(dc,100,25)=&H887766 And GetPixel(dc,0,25)=&H224466','parent retained pixels use child-to-parent coordinates and preserve the surrounding background');
  check('GetPixel(dc,210,80)=&HFF00FF','retained parent composition retains child clipping');
  add('Title.Move 3150,600\nPaintControl Title.hWnd,dc');
  check('GetPixel(dc,100,25)=&H224466','moving a transparent label recomputes the parent origin instead of retaining captured pixels');
  add('baseline=GetGuiResources(GetCurrentProcess(),0)\nFor i=1 To 100\n PaintControl Nested.hWnd,dc\n PaintControl Title.hWnd,dc\nNext\nn=GetViewportOrgEx(dc,origin)');
  check('origin.x=0 And origin.y=0','nested composition restores the supplied HDC viewport origin');
  check('GetGuiResources(GetCurrentProcess(),0)<=baseline+1','repeated parent composition does not leak GDI objects');
  add('n=SelectObject(dc,old)\nn=DeleteObject(bitmap)\nn=DeleteDC(dc)');
  return finish(`Private Type RECT
 left As Long
 top As Long
 right As Long
 bottom As Long
End Type
Private Type POINT
 x As Long
 y As Long
End Type
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreateBitmap Lib "gdi32" (ByVal width As Long,ByVal height As Long,ByVal planes As Long,ByVal bits As Long,ByVal pixels As Long) As Long
Private Declare Function CreateSolidBrush Lib "gdi32" (ByVal color As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long,ByVal object As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function FillRect Lib "user32" (ByVal dc As Long,bounds As RECT,ByVal brush As Long) As Long
Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function GetSysColor Lib "user32" (ByVal index As Long) As Long
Private Declare Function GetGuiResources Lib "user32" (ByVal process As Long,ByVal flags As Long) As Long
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long
Private Declare Function GetViewportOrgEx Lib "gdi32" (ByVal dc As Long,origin As POINT) As Long`,
`Private Sub PaintControl(ByVal hwnd As Long,ByVal dc As Long)
 Dim bounds As RECT,brush As Long,n As Long
 bounds.right=256
 bounds.bottom=128
 brush=CreateSolidBrush(&HFF00FF)
 If brush=0 Then ExitProcess 100
 n=FillRect(dc,bounds,brush)
 n=DeleteObject(brush)
 n=SendValue(hwnd,&H14,dc,0)
 n=SendValue(hwnd,&H318,dc,4)
End Sub`);
}
