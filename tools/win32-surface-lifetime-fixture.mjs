/** Real HWND/memory-DC acceptance. Pixel and GDI-state observations use directly
 * declared Windows APIs, never the compiler's private state or a browser VM. */
export function nativeSurfaceLifetimeFixture(fixture){
 const {project,control,add,check,finish}=fixture('AotControlSurfaceLifetime');
 control('Frame','Group',{Width:6000,Height:4000});
 control('PictureBox','Canvas',{Width:1800,Height:1800,AutoRedraw:-1,ScaleMode:3,BackColor:0xa0b0c0},'Group');
 control('PictureBox','Canvases',{Index:2,Width:1800,Height:1200,AutoRedraw:-1,ScaleMode:3,Left:2100},'Group');
 control('PictureBox','Canvases',{Index:7,Width:1800,Height:1200,AutoRedraw:-1,ScaleMode:3,Left:2100,Top:1500},'Group');
 add('Dim dc As Long,other As Long,n As Long,bitmap As Long,old As Long,before As Long,after As Long,saved As Long,point As POINTAPI,bounds As RECTAPI');
 add('dc=Canvas.hDC');check('dc<>0 And GetObjectType(dc)=10 And GetParent(Canvas.hWnd)=Group.hWnd','AutoRedraw PictureBox exposes an owned native memory DC inside its authored parent');
 check('Canvas.hDC=dc And GetPixel(dc,5,5)=&HA0B0C0','initial backing is filled and repeated hDC reads preserve identity');
 add('n=SetPixelV(dc,5,5,&H123456)\nCanvas.Refresh');check('GetPixel(Canvas.hDC,5,5)=&H123456','native GDI edits remain in the retained surface after Refresh');
 add('other=CreateCompatibleDC(0)\nbitmap=CreateBitmap(200,200,1,32,0)\nold=SelectObject(other,bitmap)\nn=SendValue(Canvas.hWnd,&H318,other,4)');
 check('other<>0 And bitmap<>0 And GetPixel(other,5,5)=&H123456','WM_PRINTCLIENT copies retained pixels into an independent GDI bitmap');
 add('n=SelectObject(other,old)\nn=DeleteObject(bitmap)\nn=DeleteDC(other)');
 add('n=SetViewportOrgEx(dc,3,4,0)\nCanvas.Width=3000\nCanvas.Height=2400\nother=Canvas.hDC\nn=GetViewportOrgEx(other,point)');
 check('other=dc And point.x=3 And point.y=4','surface growth preserves the published HDC and caller viewport state');
 add('n=SetViewportOrgEx(dc,0,0,0)');check('GetPixel(dc,5,5)=&H123456 And GetPixel(dc,180,140)=&HA0B0C0','growth preserves overlap and initializes only the newly exposed background');
 add('Canvas.Width=900\nCanvas.Height=900\nother=Canvas.hDC\nCanvas.Width=3000\nCanvas.Height=2400');
 check('Canvas.hDC=dc And GetPixel(dc,5,5)=&H123456','temporary shrinking and regrowth retain the backing and pixel identity');
 add('n=GetClientRect(Canvas.hWnd,bounds)');check('Canvas.ScaleWidth=bounds.right And Canvas.ScaleHeight=bounds.bottom','pixel ScaleWidth/ScaleHeight reflect the real native client rectangle');
 add('Canvas.ScaleMode=1');check('Canvas.ScaleWidth=bounds.right*15 And Canvas.ScaleHeight=bounds.bottom*15','twip scaling is distinct from the HWND pixel size');
 add('Canvas.CurrentX=23.5\nCanvas.CurrentY=31.25');check('Canvas.CurrentX=23.5 And Canvas.CurrentY=31.25 And VarType(Canvas.CurrentX)=vbSingle','drawing cursor coordinates retain fractional values and Single property types');
 add('Canvas.Cls');check('Canvas.CurrentX=0 And Canvas.CurrentY=0 And GetPixel(Canvas.hDC,5,5)=&HA0B0C0','Cls restores the authored background and resets the drawing cursor');
 add('sequence=0\nCanvases(Choose()).CurrentX=12.5');check('sequence=1 And Canvases(2).CurrentX=12.5 And Canvases(7).CurrentX=0','indexed surface assignments resolve their receiver exactly once');
 add('sequence=0\nWith Canvases(Choose())\n .CurrentY=8.25\n dc=.hDC\n .Cls\nEnd With');check('sequence=1 And Canvases(2).CurrentY=0 And dc=Canvases(2).hDC','With captures one surface receiver across repeated reads, writes and methods');
 add('On Error Resume Next\nErr.Clear\nCanvas.ScaleMode=7');check('Err.Number=380 And Canvas.ScaleMode=1','unsupported scale modes raise an explicit error without mutating the prior mode');
 add('Err.Clear\nOn Error GoTo 0\nMe.AutoRedraw=True\ndc=Me.hDC\nn=SetPixelV(dc,5,5,&H334455)');check('GetObjectType(dc)=10 And GetPixel(Me.hDC,5,5)=&H334455','Form AutoRedraw uses an independent retained GDI surface');
 add('Me.AutoRedraw=False\ndc=Me.hDC\nn=ReleaseDC(Me.hWnd,dc)');check('dc=Me.hDC And GetObjectType(dc)=3','non-retained Form uses its private display DC, not a recycled common cache entry');
 // Warm the HWND-owned display DC before the leak baseline: its first
 // acquisition is a legitimate one-time allocation retained until HWND death.
 add('Canvas.AutoRedraw=False\nother=Canvas.hDC\nCanvas.AutoRedraw=True\nother=Canvas.hDC');
 add('before=GetGuiResources(GetCurrentProcess(),0)\nFor n=1 To 40\n Canvas.AutoRedraw=False\n Canvas.AutoRedraw=True\n other=Canvas.hDC\nNext\nafter=GetGuiResources(GetCurrentProcess(),0)');
 check('after=before','repeated retained/non-retained transitions do not leak GDI handles');
 add('On Error Resume Next\nErr.Clear\nCanvases(2).CurrentX=DestroyReceiver()');check('Err.Number=91','an operand that destroys its own receiver is rejected before publishing state');
 add('Err.Clear\nOn Error GoTo 0');
 return finish(`Private Type POINTAPI
 x As Long
 y As Long
End Type
Private Type RECTAPI
 left As Long
 top As Long
 right As Long
 bottom As Long
End Type
Private sequence As Long
Private Declare Function GetObjectType Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function SetPixelV Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal color As Long) As Long
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreateBitmap Lib "gdi32" (ByVal w As Long,ByVal h As Long,ByVal planes As Long,ByVal bits As Long,ByVal data As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long,ByVal object As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function ReleaseDC Lib "user32" (ByVal hwnd As Long,ByVal dc As Long) As Long
Private Declare Function SetViewportOrgEx Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal previous As Long) As Long
Private Declare Function GetViewportOrgEx Lib "gdi32" (ByVal dc As Long,point As POINTAPI) As Long
Private Declare Function GetClientRect Lib "user32" (ByVal hwnd As Long,bounds As RECTAPI) As Long
Private Declare Function GetGuiResources Lib "user32" (ByVal process As Long,ByVal kind As Long) As Long
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long
Private Declare Function DestroyWindow Lib "user32" (ByVal hwnd As Long) As Long`,
`Private Function Choose() As Integer
 sequence=sequence+1
 Choose=2
End Function
Private Function DestroyReceiver() As Double
 Dim n As Long
 n=DestroyWindow(Canvases(2).hWnd)
 DestroyReceiver=999
End Function`);
}
