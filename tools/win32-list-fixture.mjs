/** Indexed list properties exercised by actual LISTBOX/COMBOBOX HWNDs. */
export function nativeListControlFixture(fixture){
  const {control,add,check,finish}=fixture('AotControlLists');
  control('ListBox','Plain',{List:['alpha','omega'],ItemData:[-1,2147483647]});
  control('ListBox','SortedList',{Sorted:true,List:['zeta','alpha'],ItemData:[23,-1],Top:750});
  control('ComboBox','Combo',{List:['first','last'],ItemData:[-2147483648,7],Top:1350});
  control('ComboBox','SortedCombo',{Sorted:true,List:['zeta','alpha'],ItemData:[23,-1],Top:1950});
  control('ListBox','Lists',{Index:3,List:['one','two','three'],MultiSelect:0,Left:2400});
  control('ListBox','Lists',{Index:7,List:['one','two','three'],MultiSelect:2,Left:2400,Top:750});
  control('ListBox','Seeded',{List:['zero','one','two'],MultiSelect:1,ListIndex:1,Left:4800,Top:750});
  control('ListBox','Dead',{Top:2550});
  add('Dim n As Long, s As String, value As String');
  check('Lists(7).SelCount=0 And Not Lists(7).Selected(0) And Not Lists(7).Selected(1) And Not Lists(7).Selected(2) And Seeded.SelCount=1 And Seeded.Selected(1) And Not Seeded.Selected(0)','initial multi-selection maps ListIndex=-1 to no selection and a nonnegative index to one selected item');
  check('Plain.ListCount=2 And Plain.List(0)="alpha" And Plain.List(index:=1)="omega"','List reads saved strings using zero-based and named indices');
  check('Plain.ItemData(0)=-1 And Plain.ItemData(1)=2147483647 And Combo.ItemData(0)=-2147483648','all signed LONG item values, including -1, are distinct from an invalid index');
  check('Plain.NewIndex=-1 And SortedList.NewIndex=-1 And Combo.NewIndex=-1','initial saved entries do not masquerade as AddItem calls');
  check('SortedList.List(0)="alpha" And SortedList.ItemData(0)=-1 And SortedList.List(1)="zeta" And SortedList.ItemData(1)=23','sorted ListBox insertion preserves each design-time ItemData association');
  check('SortedCombo.List(0)="alpha" And SortedCombo.ItemData(0)=-1 And SortedCombo.List(1)="zeta" And SortedCombo.ItemData(1)=23','sorted ComboBox insertion preserves each design-time ItemData association');
  add('Plain.AddItem "middle",1\nPlain.ItemData(Plain.NewIndex)=321');
  check('Plain.NewIndex=1 And Plain.List(1)="middle" And Plain.ItemData(1)=321 And Plain.ItemData(2)=2147483647','AddItem inserts at an explicit position and retains adjacent item data');
  add('Combo.AddItem item:="middle",index:=1\nCombo.ItemData(Combo.NewIndex)=-1');
  check('Combo.NewIndex=1 And Combo.List(1)="middle" And Combo.ItemData(1)=-1 And Combo.ItemData(2)=7','ComboBox indexed insertion and signed ItemData writes use native messages');
  add('SortedList.AddItem "beta",0\nSortedList.ItemData(SortedList.NewIndex)=9\nSortedCombo.AddItem "beta",0\nSortedCombo.ItemData(SortedCombo.NewIndex)=8');
  check('SortedList.NewIndex=1 And SortedList.List(1)="beta" And SortedList.ItemData(1)=9 And SortedList.ItemData(2)=23','Sorted ListBox reports the actual insertion index rather than the supplied position');
  check('SortedCombo.NewIndex=1 And SortedCombo.List(1)="beta" And SortedCombo.ItemData(1)=8 And SortedCombo.ItemData(2)=23','Sorted ComboBox reports the actual insertion index rather than the supplied position');
  add('sequence=0\nPlain.AddItem index:=MarkIndex(1),item:=MarkText("named")');
  check('sequence=12 And Plain.List(1)="named" And Plain.NewIndex=1','named AddItem arguments execute in authored order while retaining formal ABI positions');
  add('value="original"\nPlain.AddItem item:=value,index:=MutateText(value)');
  check('value="changed" And Plain.List(0)="original"','AddItem snapshots text before a later ByRef argument mutates the source BSTR');
  add('sequence=0\nLists(Choose()).ItemData(MarkIndex(1))=MarkIndex(57)');
  check('sequence=311 And Lists(3).ItemData(1)=57','indexed receiver, item index and assigned value each execute once in source order');
  add('sequence=0\nWith Lists(Choose())\n .AddItem "with"\n .ItemData(.NewIndex)=101\n s=.List(.NewIndex)\nEnd With');
  check('sequence=3 And s="with" And Lists(3).ItemData(3)=101','With captures a control-array receiver once across list operations');
  add('Lists(3).Selected(1)=True');check('Lists(3).Selected(1) And Not Lists(3).Selected(0) And Lists(3).ListIndex=1','single-selection ListBox uses LB_SETCURSEL rather than unsupported LB_SETSEL');
  add('Lists(3).Selected(0)=False');check('Lists(3).Selected(1) And Lists(3).ListIndex=1','clearing an unselected single-select item leaves the selected item unchanged');
  add('Lists(3).Selected(1)=False');check('Not Lists(3).Selected(1) And Lists(3).ListIndex=-1','clearing the selected single-select item removes the selection');
  add('Lists(7).Selected(0)=True\nLists(7).Selected(2)=True');check('Lists(7).Selected(0) And Lists(7).Selected(2) And Not Lists(7).Selected(1) And Lists(7).SelCount=2','multi-select members of the same control array retain independent selections');
  add('Lists(7).Selected(0)=False');check('Not Lists(7).Selected(0) And Lists(7).Selected(2) And Lists(7).SelCount=1','clearing one multi-select item preserves the other selection');
  add('s=ChrW$(937) & String$(8192,"x") & ChrW$(20013) & ChrW$(-10179) & ChrW$(-8576)\nPlain.AddItem s\nCombo.AddItem s');
  check('Plain.List(Plain.NewIndex)=s And Combo.List(Combo.NewIndex)=s And Len(Plain.List(Plain.NewIndex))=8196','List retrieval allocates counted BSTRs beyond the old 4096-unit scratch buffer and retains supplementary Unicode');
  add('Plain.AddItem ""\nCombo.AddItem ""');check('Len(Plain.List(Plain.NewIndex))=0 And Len(Combo.List(Combo.NewIndex))=0','empty native list strings return valid empty String values');
  add('Plain.RemoveItem 0\nCombo.RemoveItem index:=0');check('Plain.List(0)="alpha" And Combo.List(0)="middle" And Combo.ItemData(0)=-1','RemoveItem shifts text and item data together');
  add('On Error Resume Next\nErr.Clear\nn=99\nn=Plain.ItemData(-1)');check('Err.Number=381 And n=99','negative ItemData index raises 381 without overwriting the destination');
  add('Err.Clear\nPlain.ItemData(Plain.ListCount)=17');check('Err.Number=381','one-past-end ItemData write raises 381');
  add('Err.Clear\ns="untouched"\ns=Combo.List(Combo.ListCount)');check('Err.Number=381 And s="untouched"','one-past-end List read raises 381 without assigning a partial BSTR');
  add('Err.Clear\nLists(7).Selected(-1)=True');check('Err.Number=381 And Lists(7).SelCount=1','negative Selected index does not turn into the Win32 select-all sentinel');
  add('Err.Clear\nPlain.AddItem "invalid",-1');check('Err.Number=380','negative insertion position is rejected instead of Win32 append semantics');
  add('Err.Clear\nCombo.AddItem "invalid",Combo.ListCount+1');check('Err.Number=380','insertion beyond the count raises 380');
  add('Err.Clear\nPlain.RemoveItem Plain.ListCount');check('Err.Number=381','RemoveItem validates the complete native index range');
  add('Err.Clear\nOn Error GoTo 0\nFor n=1 To 1000\n value=Plain.List(0) & Combo.List(0)\nNext');
  check('value="alphamiddle"','repeated nested List results retain statement-scoped BSTR ownership');
  add('Plain.Clear\nCombo.Clear()\nLists(7).Clear');check('Plain.ListCount=0 And Combo.ListCount=0 And Lists(7).ListCount=0 And Plain.NewIndex=-1 And Combo.NewIndex=-1','Clear resets native content and NewIndex in statement and call forms');
  add('Plain.AddItem "restart"');check('Plain.NewIndex=0 And Plain.ItemData(0)=0','AddItem after Clear starts at zero with default item data');
  add('On Error Resume Next\nErr.Clear\nDead.AddItem DestroyReceiver()');check('Err.Number=91','an argument that destroys the receiver cannot target a stale or recycled HWND');
  add('Err.Clear\nOn Error GoTo 0');
  return finish(`Private sequence As Long
Private Declare Function DestroyWindow Lib "user32" (ByVal hwnd As Long) As Long`,
`Private Function MarkIndex(ByVal n As Long) As Long
 sequence=sequence*10+1
 MarkIndex=n
End Function
Private Function MarkText(ByVal s As String) As String
 sequence=sequence*10+2
 MarkText=s
End Function
Private Function Choose() As Integer
 sequence=sequence*10+3
 Choose=3
End Function
Private Function MutateText(ByRef s As String) As Long
 s="changed"
 MutateText=0
End Function
Private Function DestroyReceiver() As String
 Dim n As Long
 n=DestroyWindow(Dead.hWnd)
 DestroyReceiver="unreachable"
End Function`);
}
