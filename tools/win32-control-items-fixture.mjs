/** Real common controls: queued native input, WM_NOTIFY, live Unicode text,
 * indexed ByRef callbacks, nesting and invalidation. No JS rendering substitute. */
export function commonItemControlFixture(fixture){
  const {control,add,check,finish}=fixture('AotControlItemObjects');
  control('TreeView','Tree',{Width:3600,Height:2100,Nodes:[{Key:'child',Text:'Child',Parent:'root'},{Key:'root',Text:'Root'},{Key:'second',Text:'Second'}]});
  control('ListView','Rows',{Index:3,Left:3900,Width:4200,Height:1800,View:3,Columns:[{Text:'Name',Width:3000}],Items:[{Key:'outer',Text:'Ω'+'x'.repeat(3500)+'中'},{Key:'other',Text:'Other'}]});
  control('ListView','Rows',{Index:7,Top:2400,Width:3600,Height:1800,View:3,Columns:[{Text:'Name',Width:3000}],Items:[{Key:'a',Text:'A'},{Key:'inner',Text:'Inner'}]});
  control('TabStrip','Pages',{Left:3900,Top:2400,Width:4200,Height:1200,Tabs:[{Key:'first',Caption:'First'},{Key:'second',Caption:'Second'}]});
  add('Dim n As Long, root As Long, second As Long, s As String, before As String, after As String, notice As ITEMNOTICE, treeItem As TVITEM, tabItem As TCITEM');
  add('root=SendValue(Tree.hWnd,&H110A,0,0)\nsecond=SendValue(Tree.hWnd,&H110A,1,root)\nn=SendValue(Tree.hWnd,&H110B,9,root)');
  check('root<>0 And second<>0 And Tree.SelectedItem.Text="Root" And Tree.SelectedItem.Key="root" And Tree.SelectedItem.Index=2','Tree.SelectedItem resolves the live native HTREEITEM while retaining authored collection identity');
  add('s="Changed " & ChrW$(937) & String$(3000,"z")\ntreeItem.mask=1\ntreeItem.item=root\ntreeItem.text=StrPtr(s)\nn=SendRecord(Tree.hWnd,&H113F,0,treeItem)');
  check('n<>0 And Tree.SelectedItem.Text=s','Tree text is read from TVM_GETITEMW and grows beyond the initial buffer');
  add('tabItem.mask=1\ntabItem.text=StrPtr(s)\nn=SendRecord(Pages.hWnd,&H133D,0,tabItem)');
  check('n<>0 And Pages.SelectedItem.Caption=s','Tab SelectedItem.Caption reads current UTF-16 text rather than saved captions');
  add('With Pages.SelectedItem\n n=SendValue(Pages.hWnd,&H130C,1,0)\n before=.Caption\nEnd With\nafter=Pages.SelectedItem.Caption');
  check('before=s And after="Second"','With SelectedItem snapshots the item before a later native selection change');
  add('notice.hwnd=Rows(3).hWnd\nnotice.id=GetDlgCtrlID(Rows(3).hWnd)\nnotice.code=-2\nnotice.item=0\nn=SendRecord(Me.hWnd,&H4E,notice.id,notice)');
  check('listCalls=2 And beforeNested=ChrW$(937) & String$(3500,"x") & ChrW$(20013) And afterNested=beforeNested And insideNested="Inner"','nested indexed ItemClick callbacks preserve independent descriptor frames and long UTF-16 BSTRs');
  check('outerIndex=1 And outerKey="outer" And seenControlIndex=3','ByRef ListItem descriptor is separate from the ByRef control-array Index');
  add('notice.item=-1\nnotice.x=10000\nnotice.y=10000\nn=SendRecord(Me.hWnd,&H4E,notice.id,notice)');
  check('listCalls=2','blank report-view space does not synthesize an ItemClick on the current selection');
  add('clearNested=True\nnotice.hwnd=Rows(7).hWnd\nnotice.id=GetDlgCtrlID(Rows(7).hWnd)\nnotice.item=1\nn=SendRecord(Me.hWnd,&H4E,notice.id,notice)');
  check('staleError=91 And Rows(7).ListItems.Count=0','Clear invalidates existing borrowed items before their descriptor can be read again');
  add('Me.Show\nn=PulseTree(second)');
  check('n=1 And treeCalls=1 And treeText="Second" And treeKey="second"','queued native tree mouse input dispatches the hit-tested Node, not the previous selection');
  add('Tree.Nodes.Clear\nOn Error Resume Next\nErr.Clear\ns=Tree.SelectedItem.Text');
  check('Err.Number=91','missing Tree.SelectedItem raises object-not-set instead of reading an HWND caption');
  add('Err.Clear\nOn Error GoTo 0');
  return finish(`Private Type ITEMNOTICE
 hwnd As Long
 id As Long
 code As Long
 item As Long
 subitem As Long
 newState As Long
 oldState As Long
 changed As Long
 x As Long
 y As Long
 data As Long
 keys As Long
End Type
Private Type TVITEM
 mask As Long
 item As Long
 state As Long
 stateMask As Long
 text As Long
 maxText As Long
 image As Long
 selectedImage As Long
 children As Long
 data As Long
End Type
Private Type TCITEM
 mask As Long
 state As Long
 stateMask As Long
 text As Long
 maxText As Long
 image As Long
 data As Long
End Type
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
Private Type MSGAPI
 hwnd As Long
 message As Long
 wp As Long
 lp As Long
 time As Long
 point As POINTAPI
 private As Long
End Type
Private Declare Function GetCursorPos Lib "user32" (point As POINTAPI) As Long
Private Declare Function ClientToScreen Lib "user32" (ByVal hwnd As Long, point As POINTAPI) As Long
Private Declare Function SetCursorPos Lib "user32" (ByVal x As Long, ByVal y As Long) As Long
Private Type INPUT32
 kind As Long
 dx As Long
 dy As Long
 data As Long
 flags As Long
 time As Long
 extra As Long
End Type
Private Type INPUTPAIR
 down As INPUT32
 up As INPUT32
End Type
Private Declare Function SendInput Lib "user32" (ByVal count As Long, inputs As INPUTPAIR, ByVal size As Long) As Long
Private Declare Function SetForegroundWindow Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function GetForegroundWindow Lib "user32" () As Long
Private Declare Function GetMessageW Lib "user32" (message As MSGAPI, ByVal hwnd As Long, ByVal first As Long, ByVal last As Long) As Long
Private Declare Function DispatchMessageW Lib "user32" (message As MSGAPI) As Long
Private Declare Function PeekMessageW Lib "user32" (message As MSGAPI, ByVal hwnd As Long, ByVal first As Long, ByVal last As Long, ByVal remove As Long) As Long
Private listCalls As Long, treeCalls As Long, outerIndex As Long, seenControlIndex As Integer
Private beforeNested As String, afterNested As String, insideNested As String, outerKey As String, treeText As String, treeKey As String
Private clearNested As Boolean, staleError As Long`,
`Private Sub Rows_ItemClick(Index As Integer, Item As MSComctlLib.ListItem)
 Dim n As Long, nested As ITEMNOTICE, s As String
 listCalls=listCalls+1
 If Index=3 Then
  seenControlIndex=Index
  beforeNested=Item.Text
  nested.hwnd=Rows(7).hWnd
  nested.id=GetDlgCtrlID(Rows(7).hWnd)
  nested.code=-2
  nested.item=1
  n=SendRecord(Me.hWnd,&H4E,nested.id,nested)
  afterNested=Item.Text
  outerIndex=Item.Index
  outerKey=Item.Key
 Else
  insideNested=Item.Text
  If clearNested Then
   Rows(7).ListItems.Clear
   On Error Resume Next
   Err.Clear
   s=Item.Text
   staleError=Err.Number
   Err.Clear
   On Error GoTo 0
  End If
 End If
End Sub
Private Sub Tree_NodeClick(ByVal Node As Node)
 treeCalls=treeCalls+1
 treeText=Node.Text
 treeKey=Node.Key
End Sub
Private Function PulseTree(ByVal item As Long) As Long
 Dim old As POINTAPI, point As POINTAPI, bounds As RECTAPI, message As MSGAPI, n As Long, packed As Long, clicks As INPUTPAIR
 If GetCursorPos(old)=0 Then Exit Function
 n=SetForegroundWindow(Me.hWnd)
 If GetForegroundWindow()<>Me.hWnd Then Exit Function
 On Error GoTo RestoreCursor
 n=SendValue(Tree.hWnd,&H1114,0,item)
 bounds.left=item
 If SendRecord(Tree.hWnd,&H1104,1,bounds)=0 Then GoTo RestoreCursor
 point.x=bounds.left+2
 point.y=bounds.top+2
 packed=point.x+point.y*65536
 If ClientToScreen(Tree.hWnd,point)=0 Then GoTo RestoreCursor
 If SetCursorPos(point.x,point.y)=0 Then GoTo RestoreCursor
 ' SendInput populates the actual input queue and its screen-coordinate MSG.pt.
 ' PostMessage mouse lParam alone is not a physical-input queue record.
 ' Insert the complete pair before COMCTL32 can enter a nested input loop.
 clicks.down.flags=2
 clicks.up.flags=4
 If SendInput(2,clicks,28)<>2 Then GoTo RestoreCursor
 n=GetMessageW(message,Tree.hWnd,&H201,&H201)
 If n<=0 Then GoTo RestoreCursor
 n=DispatchMessageW(message)
 n=PeekMessageW(message,Tree.hWnd,&H202,&H202,1)
 If n<>0 Then n=DispatchMessageW(message)
 PulseTree=1
RestoreCursor:
 n=SetCursorPos(old.x,old.y)
End Function`);
}
