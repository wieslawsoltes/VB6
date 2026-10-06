/** Private native layout kernel, independently lowered by our existing VB-to-x86
 * compiler. Geometry remains Double until the final HWND pixel conversion.
 * No Microsoft compiler, JavaScript engine or VB runtime is embedded. */
export const NATIVE_LAYOUT_COLUMNS=41;
export const NATIVE_LAYOUT_FIELDS=Object.freeze({Left:6,Top:7,Width:8,Height:9,Anchor:10,Dock:11,LayoutMode:12,MinimumWidth:13,MinimumHeight:14,MaximumWidth:15,MaximumHeight:16,LayoutPadding:17,LayoutMargin:18,LayoutGap:19,LayoutGrow:20,LayoutShrink:21,LayoutAlign:22,LayoutJustify:23,Visible:24});
export function nativeLayoutCoreSource(count) {
  if(!Number.isInteger(count)||count<1||count>20000)throw new RangeError('Native layout node limit exceeded');
  return `Option Explicit
Private Const BX = 0, BY = 1, BW = 2, BH = 3, PW = 4, PH = 5
Private Const CX = 6, CY = 7, CW = 8, CH = 9, AN = 10, DK = 11, MD = 12
Private Const MNW = 13, MNH = 14, MXW = 15, MXH = 16, PD = 17, MG = 18, GP = 19
Private Const GR = 20, SH = 21, AL = 22, JU = 23, VS = 24, PA = 25, OW = 26, FC = 27, NS = 28, KD = 29, HW = 30
Private Const SZ = 31, WT = 32, FR = 33, OX = 34, OY = 35, OWI = 36, OHI = 37
Private Const FIRST = 38, LAST = 39, DIRTY = 40
Private D(0 To 40, 0 To ${count}) As Double
Private Flow(0 To ${count}) As Long
Private Busy(0 To ${count}) As Long
Private Suspended(0 To ${count}) As Long
Private Function Seed(ByVal node As Long, ByVal field As Long) As Double
End Function
Private Function HostApply(ByVal hwnd As Long, ByVal x As Double, ByVal y As Double, ByVal w As Double, ByVal h As Double, ByVal kind As Long) As Long
End Function
Private Function HostShow(ByVal hwnd As Long, ByVal visible As Long) As Long
End Function
Private Function HostResize(ByVal hwnd As Long, ByVal w As Double, ByVal h As Double) As Long
End Function
Private Function HostClient(ByVal hwnd As Long, ByVal axis As Long) As Double
End Function
Private Function Clamp(ByVal value As Double, ByVal minimum As Double, ByVal maximum As Double) As Double
 If value < minimum Then value = minimum
 If maximum > 0 And value > maximum Then value = maximum
 Clamp = value
End Function
Private Function Min(ByVal a As Double, ByVal b As Double) As Double
 Min = a
 If b < a Then Min = b
End Function
Private Function Max(ByVal a As Double, ByVal b As Double) As Double
 Max = a
 If b > a Then Max = b
End Function
Private Sub Initialize(ByVal firstNode As Long, ByVal lastNode As Long)
 Dim i As Long, k As Long
 For i = firstNode To lastNode
  For k = 0 To 40
   D(k,i) = Seed(i,k)
  Next
  D(OX,i) = -2147483648#: D(OY,i) = -2147483648#: D(OWI,i) = -2147483648#: D(OHI,i) = -2147483648#
 Next
 D(FIRST,firstNode) = firstNode: D(LAST,firstNode) = lastNode: D(DIRTY,firstNode) = 1
 Busy(firstNode) = 0: Suspended(firstNode) = 0
End Sub
Private Sub Attach(ByVal node As Long, ByVal hwnd As Long)
 D(HW,node) = hwnd
End Sub
Private Function GetValue(ByVal node As Long, ByVal field As Long) As Double
 GetValue = D(field,node)
End Function
Private Sub Rebase(ByVal node As Long)
 Dim p As Long
 p = CLng(D(PA,node))
 D(BX,node) = D(CX,node): D(BY,node) = D(CY,node): D(BW,node) = D(CW,node): D(BH,node) = D(CH,node)
 If p > 0 Then
  D(PW,node) = Max(0,D(CW,p)-2*D(PD,p)): D(PH,node) = Max(0,D(CH,p)-2*D(PD,p))
 End If
End Sub
Private Sub ApplyOne(ByVal node As Long)
 If D(KD,node) < 1 Or D(HW,node) = 0 Then Exit Sub
 If D(OX,node) = D(CX,node) And D(OY,node) = D(CY,node) And D(OWI,node) = D(CW,node) And D(OHI,node) = D(CH,node) Then Exit Sub
 HostApply CLng(D(HW,node)), D(CX,node), D(CY,node), D(CW,node), D(CH,node), CLng(D(KD,node))
 D(OX,node) = D(CX,node): D(OY,node) = D(CY,node): D(OWI,node) = D(CW,node): D(OHI,node) = D(CH,node)
End Sub
Private Sub SetValue(ByVal node As Long, ByVal field As Long, ByVal value As Double)
 Dim root As Long, errNumber As Long
 root = CLng(D(OW,node))
 If field < 6 Or field > 24 Then Err.Raise 438
 If field <> VS Then
  If value < -300000 Or value > 300000 Then Err.Raise 380
  If field > CY And value < 0 Then Err.Raise 380
 End If
 If field = AN And (value <> Fix(value) Or value > 15) Then Err.Raise 380
 If field = DK And (value <> Fix(value) Or value > 5) Then Err.Raise 380
 If field = MD And (value <> Fix(value) Or value > 3) Then Err.Raise 380
 If field = AL And (value <> Fix(value) Or value > 5 Or value = 4) Then Err.Raise 380
 If field = JU And (value <> Fix(value) Or value > 5) Then Err.Raise 380
 If field = MNW And D(MXW,node) > 0 And value > D(MXW,node) Then Err.Raise 380
 If field = MNH And D(MXH,node) > 0 And value > D(MXH,node) Then Err.Raise 380
 If field = MXW And value > 0 And value < D(MNW,node) Then Err.Raise 380
 If field = MXH And value > 0 And value < D(MNH,node) Then Err.Raise 380
 If field = VS Then
  value = 0 + (value <> 0)
  HostShow CLng(D(HW,node)),CLng(value)
 End If
 D(field,node) = value
 If field = AN Then D(DK,node) = 0
 If field = DK Then D(AN,node) = 5
 If field <= DK Then Rebase node
 D(DIRTY,root) = 1
 If node = root And (field = CW Or field = CH) Then
  On Error GoTo Failed
  Busy(root) = 1
  HostResize CLng(D(HW,root)), D(CW,root), D(CH,root)
  Busy(root) = 0
 ElseIf field <= CH Then
  ApplyOne node
 End If
 Perform root
 Exit Sub
Failed:
 errNumber = Err.Number: Busy(root) = 0: Err.Raise errNumber
End Sub
Private Sub MoveNode(ByVal node As Long, ByVal x As Double, ByVal y As Double, ByVal w As Double, ByVal h As Double)
 Dim root As Long
 If x < -300000 Or x > 300000 Or y < -300000 Or y > 300000 Or w < 0 Or w > 300000 Or h < 0 Or h > 300000 Then Err.Raise 380
 root = CLng(D(OW,node))
 D(CX,node) = x: D(CY,node) = y: D(CW,node) = w: D(CH,node) = h
 Rebase node: ApplyOne node: D(DIRTY,root) = 1: Perform root
End Sub
Private Sub Suspend(ByVal root As Long)
 Suspended(root) = Suspended(root) + 1
End Sub
Private Sub ResumeLayout(ByVal root As Long, ByVal performNow As Long)
 If Suspended(root) > 0 Then Suspended(root) = Suspended(root) - 1
 If performNow <> 0 Then Perform root
End Sub
Private Sub Perform(ByVal root As Long)
 If D(HW,root) = 0 Then Exit Sub
 Run root, HostClient(CLng(D(HW,root)),0), HostClient(CLng(D(HW,root)),1)
End Sub
Private Sub Run(ByVal root As Long, ByVal width As Double, ByVal height As Double)
 Dim i As Long, errNumber As Long
 If Busy(root) <> 0 Then Exit Sub
 If Suspended(root) <> 0 Then
  D(CW,root)=Max(0,width): D(CH,root)=Max(0,height): D(DIRTY,root)=1
  Exit Sub
 End If
 If width = D(CW,root) And height = D(CH,root) And D(DIRTY,root) = 0 Then Exit Sub
 On Error GoTo Failed
 Busy(root) = 1
 D(CW,root) = Max(0,width): D(CH,root) = Max(0,height)
 For i = CLng(D(FIRST,root)) To CLng(D(LAST,root))
  If D(FC,i) > 0 Then Children i
  If i <> root Then ApplyOne i
 Next
 Busy(root) = 0: D(DIRTY,root) = 0
 Exit Sub
Failed:
 errNumber = Err.Number: Busy(root) = 0: Err.Raise errNumber
End Sub
Private Sub Children(ByVal parent As Long)
 Dim i As Long, a As Long, dock As Long, countFlow As Long
 Dim left As Double, top As Double, right As Double, bottom As Double, width As Double, height As Double
 Dim x As Double, y As Double, w As Double, h As Double, dx As Double, dy As Double, aw As Double, ah As Double
 left = D(PD,parent): top = left
 width = Max(0,D(CW,parent)-2*left): height = Max(0,D(CH,parent)-2*top)
 right = left+width: bottom = top+height
 i = CLng(D(FC,parent)): countFlow = 0
 Do While i > 0
  a = CLng(D(AN,i)): dock = CLng(D(DK,i))
  x = D(BX,i): y = D(BY,i): w = Clamp(D(BW,i),D(MNW,i),D(MXW,i)): h = Clamp(D(BH,i),D(MNH,i),D(MXH,i))
  If D(KD,i) < 0 Then
   D(CX,i)=x: D(CY,i)=y: D(CW,i)=w: D(CH,i)=h
  ElseIf dock <> 0 And D(VS,i) <> 0 Then
   aw = Max(0,right-left): ah = Max(0,bottom-top)
   If dock = 1 Or dock = 2 Or dock = 5 Then w = Clamp(aw,D(MNW,i),D(MXW,i))
   If dock = 3 Or dock = 4 Or dock = 5 Then h = Clamp(ah,D(MNH,i),D(MXH,i))
   x = left: y = top
   Select Case dock
    Case 1: top = Min(bottom,top+h)
    Case 2: y = bottom-h: bottom = Max(top,bottom-h)
    Case 3: left = Min(right,left+w)
    Case 4: x = right-w: right = Max(left,right-w)
   End Select
   D(CX,i)=x: D(CY,i)=y: D(CW,i)=w: D(CH,i)=h
  ElseIf D(MD,parent) <> 0 And D(VS,i) <> 0 And dock = 0 Then
   Flow(countFlow)=i: countFlow=countFlow+1
  Else
   dx = width-D(PW,i): dy = height-D(PH,i)
   w = D(BW,i): h = D(BH,i)
   If (a And 12) = 12 Then w = w+dx
   If (a And 3) = 3 Then h = h+dy
   w = Clamp(w,D(MNW,i),D(MXW,i)): h = Clamp(h,D(MNH,i),D(MXH,i))
   If (a And 4) = 0 Then
    If (a And 8) <> 0 Then
     x = x+dx+D(BW,i)-w
    Else
     x = x+(dx+D(BW,i)-w)/2
    End If
   End If
   If (a And 1) = 0 Then
    If (a And 2) <> 0 Then
     y = y+dy+D(BH,i)-h
    Else
     y = y+(dy+D(BH,i)-h)/2
    End If
   End If
   D(CX,i)=x: D(CY,i)=y: D(CW,i)=w: D(CH,i)=h
  End If
  i = CLng(D(NS,i))
 Loop
 If countFlow > 0 Then FlowLayout parent,countFlow,left,top,Max(0,right-left),Max(0,bottom-top)
End Sub
Private Sub FlowLayout(ByVal parent As Long, ByVal count As Long, ByVal x As Double, ByVal y As Double, ByVal width As Double, ByVal height As Double)
 Dim vertical As Long, wrap As Long, j As Long, i As Long, begin As Long
 Dim main As Double, cross As Double, gap As Double, used As Double, lineCross As Double, crossOffset As Double, size As Double, c As Double
 vertical = 0: wrap = 0
 If D(MD,parent) = 2 Then vertical = 1
 If D(MD,parent) = 3 Then wrap = 1
 main=width: cross=height: gap=D(GP,parent)
 If vertical <> 0 Then main=height: cross=width
 For j = 0 To count-1
  i=Flow(j)
  If vertical <> 0 Then
   size=Clamp(D(BH,i),D(MNH,i),D(MXH,i)): c=Clamp(D(BW,i),D(MNW,i),D(MXW,i))+2*D(MG,i)
  Else
   size=Clamp(D(BW,i),D(MNW,i),D(MXW,i)): c=Clamp(D(BH,i),D(MNH,i),D(MXH,i))+2*D(MG,i)
  End If
  If wrap <> 0 And j > begin And used+gap+size+2*D(MG,i) > main Then
   LineLayout parent,begin,j,x,y+crossOffset,main,lineCross,0
   crossOffset=crossOffset+lineCross+gap: begin=j: used=0: lineCross=0
  End If
  If j > begin Then used=used+gap
  used=used+size+2*D(MG,i): lineCross=Max(lineCross,c)
 Next
 If wrap <> 0 Then cross=lineCross
 LineLayout parent,begin,count,x,y+crossOffset,main,cross,vertical
End Sub
Private Sub LineLayout(ByVal parent As Long, ByVal begin As Long, ByVal finish As Long, ByVal x As Double, ByVal y As Double, ByVal main As Double, ByVal cross As Double, ByVal vertical As Long)
 Dim i As Long,j As Long,pass As Long,count As Long,justify As Long,align As Long,clamped As Long,growing As Long
 Dim gap As Double,occupied As Double,free As Double,total As Double,delta As Double,value As Double,nextValue As Double,minimum As Double,maximum As Double
 Dim used As Double,remaining As Double,stepSize As Double,pos As Double,available As Double,cs As Double,cp As Double
 count=finish-begin: gap=D(GP,parent): occupied=gap*Max(0,count-1)
 For j=begin To finish-1
  i=Flow(j)
  If vertical <> 0 Then
   D(SZ,i)=Clamp(D(BH,i),D(MNH,i),D(MXH,i))
  Else
   D(SZ,i)=Clamp(D(BW,i),D(MNW,i),D(MXW,i))
  End If
  occupied=occupied+D(SZ,i)+2*D(MG,i): D(FR,i)=0
 Next
 free=main-occupied: growing=0
 If free >= 0 Then growing=1
 For j=begin To finish-1
  i=Flow(j): D(WT,i)=D(SH,i)*D(SZ,i)
  If growing <> 0 Then D(WT,i)=D(GR,i)
 Next
 For pass=0 To count
  If Abs(free) < 0.000000001 Then Exit For
  total=0
  For j=begin To finish-1
   i=Flow(j): If D(FR,i)=0 Then total=total+D(WT,i)
  Next
  If total=0 Then Exit For
  clamped=0: delta=0
  For j=begin To finish-1
   i=Flow(j)
   If D(FR,i)=0 And D(WT,i)<>0 Then
    value=D(SZ,i)+free*D(WT,i)/total
    If vertical<>0 Then
     minimum=D(MNH,i): maximum=D(MXH,i)
    Else
     minimum=D(MNW,i): maximum=D(MXW,i)
    End If
    nextValue=Clamp(value,minimum,maximum)
    If nextValue<>value Then
     delta=delta+nextValue-D(SZ,i): D(SZ,i)=nextValue: D(FR,i)=1: clamped=1
    End If
   End If
  Next
  If clamped<>0 Then
   free=free-delta
  Else
   For j=begin To finish-1
    i=Flow(j): If D(FR,i)=0 Then D(SZ,i)=D(SZ,i)+free*D(WT,i)/total
   Next
   free=0
  End If
 Next
 used=gap*Max(0,count-1)
 For j=begin To finish-1
  i=Flow(j): used=used+D(SZ,i)+2*D(MG,i)
 Next
 remaining=Max(0,main-used): justify=CLng(D(JU,parent)): stepSize=gap: pos=0
 Select Case justify
  Case 1: pos=remaining/2
  Case 2: pos=remaining
  Case 3: If count>1 Then stepSize=stepSize+remaining/(count-1)
  Case 4: stepSize=stepSize+remaining/count: pos=remaining/count/2
  Case 5: stepSize=stepSize+remaining/(count+1): pos=remaining/(count+1)
 End Select
 For j=begin To finish-1
  i=Flow(j): available=Max(0,cross-2*D(MG,i)): align=CLng(D(AL,i))
  If vertical<>0 Then
   cs=D(BW,i): minimum=D(MNW,i): maximum=D(MXW,i)
  Else
   cs=D(BH,i): minimum=D(MNH,i): maximum=D(MXH,i)
  End If
  If align=3 Then cs=available
  cs=Clamp(cs,minimum,maximum): cp=D(MG,i)
  If align=1 Then cp=cp+(available-cs)/2
  If align=2 Then cp=cp+available-cs
  pos=pos+D(MG,i)
  If vertical<>0 Then
   D(CX,i)=x+cp: D(CY,i)=y+pos: D(CW,i)=cs: D(CH,i)=D(SZ,i)
  Else
   D(CX,i)=x+pos: D(CY,i)=y+cp: D(CW,i)=D(SZ,i): D(CH,i)=cs
  End If
  pos=pos+D(SZ,i)+D(MG,i)+stepSize
 Next
End Sub
`;
}
