/** Independent Windows GDI/typography oracles for compiled VB drawing. These are
 * actual PE execution fixtures; JavaScript does not rasterize their output. */
export function nativeSurfaceDrawingFixtures(fixture){return [graphics(fixture),text(fixture)];}
function graphics(fixture){
 const {control,add,check,finish}=fixture('AotControlSurfaceGraphics');
 control('PictureBox','Canvas',{Width:3600,Height:3600,AutoRedraw:-1,ScaleMode:3,BackColor:0xffffff});
 add('Dim dc As Long,n As Long,before As Long,after As Long,pen As Long,brush As Long,point As POINTAPI\ndc=Canvas.hDC\nCanvas.DrawMode=13\nCanvas.DrawWidth=1\nCanvas.FillStyle=1');
 add('Canvas.Line (5,7)-(20,7),&H123456');check('GetPixel(dc,10,7)=&H123456 And Canvas.CurrentX=20 And Canvas.CurrentY=7','Line draws into the retained HDC and stores its authored endpoint');
 add('Canvas.Line (30,30)-(20,20),&H334455,BF');check('GetPixel(dc,25,25)=&H334455 And GetPixel(dc,20,20)=&H334455 And GetPixel(dc,30,30)=&H334455','BF normalizes reversed bounds and includes both authored corner pixels');
 add('Canvas.Line (40,20)-(60,40),&H667788,B');check('GetPixel(dc,40,25)=&H667788 And GetPixel(dc,50,30)=&HFFFFFF','B uses a hollow brush when FillStyle is transparent');
 add('Canvas.FillStyle=0\nCanvas.FillColor=&H224466\nCanvas.Circle (100,60),20,&H113355');check('GetPixel(dc,100,60)=&H224466 And Canvas.CurrentX=100 And Canvas.CurrentY=60','Circle uses its own fill color and stores the center, not its bounding-box corner');
 add('Canvas.PSet (10,50),&H987654');check('GetPixel(dc,10,50)=&H987654 And Canvas.CurrentX=10 And Canvas.CurrentY=50','PSet modifies one pixel and records its location');
 add('Canvas.DrawMode=7\nCanvas.PSet (10,50),&H123456');check('GetPixel(dc,10,50)=(&H987654 Xor &H123456)','PSet XOR mode combines source and destination color bits');
 add('Canvas.PSet (10,50),&H123456');check('GetPixel(dc,10,50)=&H987654','repeating XOR restores the exact previous color');
 add('Canvas.DrawMode=13\nCanvas.DrawWidth=4\nCanvas.PSet (15,60),&H102030');check('GetPixel(dc,14,59)=&H102030 And GetPixel(dc,17,62)=&H102030 And GetPixel(dc,13,59)=&HFFFFFF','wider PSet covers the bounded pen-width square without touching its neighboring pixel');
 add('Canvas.DrawWidth=1\nCanvas.ScaleMode=1\nCanvas.PSet (450,750),&HAA5500');check('GetPixel(dc,30,50)=&HAA5500 And Canvas.CurrentX=450 And Canvas.CurrentY=750','twip drawing converts coordinates without converting the stored logical cursor');
 add('Canvas.ScaleMode=3\npen=GetCurrentObject(dc,1)\nbrush=GetCurrentObject(dc,2)\nn=SetViewportOrgEx(dc,3,4,0)\nCanvas.Line (70,70)-(80,80),&H336699,BF\nn=GetViewportOrgEx(dc,point)');check('GetCurrentObject(dc,1)=pen And GetCurrentObject(dc,2)=brush And point.x=3 And point.y=4 And GetPixel(dc,75,75)=&H336699','drawing restores the caller pen, brush and viewport while honoring its coordinate transform');
 add('n=SetViewportOrgEx(dc,0,0,0)\nOn Error Resume Next\nErr.Clear\nCanvas.Circle (1,2),-3');check('Err.Number=5 And Canvas.CurrentX=80 And Canvas.CurrentY=80','invalid circle radius is rejected before painting or moving the cursor');
 add('Err.Clear\nCanvas.DrawWidth=0');check('Err.Number=380 And Canvas.DrawWidth=1','invalid pen width leaves the previous drawing state intact');
 add('Err.Clear\nOn Error GoTo 0\nbefore=GetGuiResources(GetCurrentProcess(),0)\nFor n=1 To 100\n Canvas.Line (140,140)-(150,150),&H443322,BF\n Canvas.Circle (120,120),8,&H443322\nNext\nafter=GetGuiResources(GetCurrentProcess(),0)');check('after=before','repeated allocated pens and brushes are deselected and destroyed on real GDI');
 add('Canvas.Cls');check('GetPixel(dc,25,25)=&HFFFFFF And Canvas.CurrentX=0 And Canvas.CurrentY=0','Cls removes accumulated primitive output and resets its cursor');
 return finish(`Private Type POINTAPI
 x As Long
 y As Long
End Type
Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function GetCurrentObject Lib "gdi32" (ByVal dc As Long,ByVal kind As Long) As Long
Private Declare Function SetViewportOrgEx Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal previous As Long) As Long
Private Declare Function GetViewportOrgEx Lib "gdi32" (ByVal dc As Long,point As POINTAPI) As Long
Private Declare Function GetGuiResources Lib "user32" (ByVal process As Long,ByVal kind As Long) As Long
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long`);
}
function text(fixture){
 const {control,add,check,finish}=fixture('AotControlSurfaceText');
 control('PictureBox','Canvas',{Width:3600,Height:2400,AutoRedraw:-1,ScaleMode:3,BackColor:0xffffff,ForeColor:0x123456,FontName:'Consolas',FontSize:10});
 add('Dim dc As Long,target As Long,bitmap As Long,old As Long,font As Long,oldFont As Long,n As Long,x As Long,y As Long,before As Long,after As Long,brush As Long,s As String,size As TEXTSIZE,metrics As TEXTMETRIC,bounds As RECTAPI,matches As Boolean\ndc=Canvas.hDC\nfont=SendValue(Canvas.hWnd,&H31,0,0)\noldFont=SelectObject(dc,font)\nn=GetTextMetricsW(dc,metrics)\ns="Native " & ChrW$(937) & ChrW$(20013)\nn=GetTextExtentPoint32W(dc,StrPtr(s),Len(s),size)\nn=SelectObject(dc,oldFont)');
 check('font<>0 And Canvas.TextWidth(s)=size.width And Canvas.TextHeight(s)=metrics.height+metrics.externalLeading And VarType(Canvas.TextWidth(s))=vbSingle','TextWidth/TextHeight use the actual HWND font and preserve Single result types');
 add('Canvas.CurrentX=20\nCanvas.CurrentY=18\nCanvas.Print s');check('Canvas.CurrentX=0 And Canvas.CurrentY=18+metrics.height+metrics.externalLeading','Print renders at the cursor then advances one native text line');
 add('target=CreateCompatibleDC(0)\nbitmap=CreateBitmap(200,70,1,32,0)\nold=SelectObject(target,bitmap)\noldFont=SelectObject(target,font)\nbrush=CreateSolidBrush(&HFFFFFF)\nbounds.right=200\nbounds.bottom=70\nn=FillRect(target,bounds,brush)\nn=SetTextColor(target,&H123456)\nn=SetBkMode(target,1)\nn=TextOutW(target,20,18,StrPtr(s),Len(s))\nmatches=n<>0\nFor y=0 To 69\n For x=0 To 199\n  If GetPixel(dc,x,y)<>GetPixel(target,x,y) Then matches=False\n Next\nNext');
 check('target<>0 And bitmap<>0 And matches','Print pixels equal an independently drawn GDI TextOutW image using the same authored font');
 add('n=SelectObject(target,oldFont)\nn=SelectObject(target,old)\nn=DeleteObject(bitmap)\nn=DeleteObject(brush)\nn=DeleteDC(target)');
 add('s="A" & ChrW$(0) & "B"\noldFont=SelectObject(dc,font)\nn=GetTextExtentPoint32W(dc,StrPtr(s),Len(s),size)\nn=SelectObject(dc,oldFont)');check('Canvas.TextWidth(s)=size.width','text measurement retains counted characters after an embedded NUL');
 add('Canvas.CurrentX=9\nCanvas.CurrentY=5\nCanvas.Print "first" & vbCrLf & "second"');check('Canvas.CurrentX=0 And Canvas.CurrentY=5+2*(metrics.height+metrics.externalLeading)','embedded CRLF and the Print terminator each advance one line');
 add('Canvas.CurrentY=0\nCanvas.Print');check('Canvas.CurrentY=metrics.height+metrics.externalLeading','an empty Print statement emits one native blank line');
 add('s=String$(8192,"x")\noldFont=SelectObject(dc,font)\nn=GetTextExtentPoint32W(dc,StrPtr(s),Len(s),size)\nn=SelectObject(dc,oldFont)');check('Canvas.TextWidth(s)=size.width','long text measurement is not truncated to the old 4096-character window scratch buffer');
 add('Canvas.ScaleMode=1');check('Canvas.TextWidth(s)=size.width*15 And Canvas.TextHeight("")=(metrics.height+metrics.externalLeading)*15','text metric results follow the current twip scale');
 add('Canvas.ScaleMode=3\nCanvas.FontSize=16\nfont=SendValue(Canvas.hWnd,&H31,0,0)\noldFont=SelectObject(dc,font)\nn=GetTextExtentPoint32W(dc,StrPtr("new font"),8,size)\nn=SelectObject(dc,oldFont)');check('Canvas.TextWidth("new font")=size.width','a changed HWND font is used without retaining a stale deleted HFONT');
 add('before=GetGuiResources(GetCurrentProcess(),0)\nFor n=1 To 50\n Canvas.CurrentY=0\n Canvas.Print "owned text"\nNext\nafter=GetGuiResources(GetCurrentProcess(),0)');check('after=before','repeated native text rendering restores borrowed font objects without GDI handle growth');
 return finish(`Private Type TEXTSIZE
 width As Long
 height As Long
End Type
Private Type RECTAPI
 left As Long
 top As Long
 right As Long
 bottom As Long
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
Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreateBitmap Lib "gdi32" (ByVal w As Long,ByVal h As Long,ByVal planes As Long,ByVal bits As Long,ByVal data As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long,ByVal object As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal object As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreateSolidBrush Lib "gdi32" (ByVal color As Long) As Long
Private Declare Function FillRect Lib "user32" (ByVal dc As Long,bounds As RECTAPI,ByVal brush As Long) As Long
Private Declare Function GetTextExtentPoint32W Lib "gdi32" (ByVal dc As Long,ByVal text As Long,ByVal count As Long,size As TEXTSIZE) As Long
Private Declare Function GetTextMetricsW Lib "gdi32" (ByVal dc As Long,metrics As TEXTMETRIC) As Long
Private Declare Function TextOutW Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal text As Long,ByVal count As Long) As Long
Private Declare Function SetTextColor Lib "gdi32" (ByVal dc As Long,ByVal color As Long) As Long
Private Declare Function SetBkMode Lib "gdi32" (ByVal dc As Long,ByVal mode As Long) As Long
Private Declare Function GetGuiResources Lib "user32" (ByVal process As Long,ByVal kind As Long) As Long
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long`);
}
