/** Production host, parser, VM and controls; no control stubs. */
import {RuntimeAPI} from '../../src/runtime/entry.js';
import {newProject,createControl} from '../../src/project/model.js';
export async function setup(){
  globalThis.app?.dispose();document.body.replaceChildren();
  const project=newProject('ControlsCompatibility'),form=project.modules[0];
  Object.assign(form.form.properties,{ClientWidth:12000,ClientHeight:8400,Width:12000,Height:8400,StartUpPosition:0,Left:120,Top:120});
  project.settings.renderer='canvas2d';
  function add(type,name,x,y,width,height,props={}){const c=createControl(type,name,x*15,y*15);Object.assign(c.properties,{Width:width*15,Height:height*15,...props});form.form.controls.push(c);}
  add('TreeView','Tree',20,20,250,220,{CheckBoxes:-1,HideSelection:0,TabIndex:0});
  add('ListView','List',300,20,470,220,{CheckBoxes:-1,MultiSelect:-1,HideSelection:0,TabIndex:1});
  add('ListBox','Tags',20,270,250,170,{Sorted:-1,TabIndex:2});
  add('ComboBox','Combo',300,270,200,28,{Sorted:-1,Style:2,TabIndex:3});
  add('CommandButton','Edit',520,270,120,28,{Caption:'Edit label',TabIndex:4});
  add('Label','Output',300,310,450,90,{Caption:'Ready'});
  add('ImageList','Images',20,490,28,28);
  form.code=`Option Explicit
Private Sub Form_Load()
    Dim n As Object, item As Object
    Set n = Tree.Nodes.Add(, , "root", "Root")
    n.Expanded = True
    Tree.Nodes.Add "root", 4, "alpha", "Alpha"
    Tree.Nodes.Add "root", 4, "beta", "Beta"
    Tree.Nodes.Add "root", 4, "gamma", "Gamma"
    List.ColumnHeaders.Add , "name", "Name", 2400
    List.ColumnHeaders.Add , "detail", "Detail", 2700
    Set item = List.ListItems.Add(, "alpha", "Alpha")
    item.SubItems(1) = "First"
    Set item = List.ListItems.Add(, "beta", "Beta")
    item.SubItems(1) = "Second"
    Set item = List.ListItems.Add(, "gamma", "Gamma")
    item.SubItems(1) = "Third"
    Tags.AddItem "Zulu"
    Tags.ItemData(Tags.NewIndex) = 90
    Tags.AddItem "Alpha"
    Tags.ItemData(Tags.NewIndex) = 10
    Tags.ListIndex = 1
    Combo.AddItem "Zulu"
    Combo.AddItem "Alpha"
End Sub
Private Sub Tree_NodeClick(ByVal Node As Object)
    Output.Caption = "Node:" & Node.Key
End Sub
Private Sub Tree_NodeCheck(ByVal Node As Object)
    Output.Caption = "NodeCheck:" & Node.Key & ":" & CStr(Node.Checked)
End Sub
Private Sub List_ItemClick(ByVal Item As Object)
    Output.Caption = "Item:" & Item.Key
End Sub
Private Sub List_ItemCheck(ByVal Item As Object)
    Output.Caption = "ItemCheck:" & Item.Key & ":" & CStr(Item.Checked)
End Sub
Private Sub List_ColumnClick(ByVal ColumnHeader As Object)
    Output.Caption = "Column:" & ColumnHeader.Key
End Sub
Private Sub Edit_Click()
    List.StartLabelEdit
    Edit.Tag = "Returned"
End Sub
Private Sub List_BeforeLabelEdit(Cancel As Integer)
    If List.Tag = "cancel-before" Then Cancel = True
End Sub
Private Sub List_AfterLabelEdit(Cancel As Integer, NewString As String)
    If NewString = "reject" Then Cancel = True
    If NewString = "mutate" Then List.SelectedItem.Text = "External change"
    If NewString = "remove" Then List.ListItems.Remove List.SelectedItem.Index
    If NewString = "normalize" Then NewString = "Normalized"
    Output.Caption = "Edited:" & NewString
End Sub
`;
  const messages=[],app=new RuntimeAPI.ApplicationHost(project,document.body,{persist:false,rendering:false,onMessage:message=>messages.push(message)});
  globalThis.app=app;globalThis.messages=messages;await app.start();
  if(app.vm.state==='error'||messages.some(m=>m.type==='error'))throw Error(JSON.stringify(messages));
  globalThis.controls=Object.fromEntries(app.forms[0].controls.map(control=>[control.model.name,control]));
  for(const control of app.forms[0].controls)control.refresh();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return {state:app.vm.state,nodes:controls.Tree.Nodes.Count,items:controls.List.ListItems.Count,tags:controls.Tags.items,data:controls.Tags.itemData};
}
export {RuntimeAPI};

/** Separate large grid/bar scene, using the same public host and VB event loop. */
export async function setupPanels(){
  globalThis.app?.dispose();document.body.replaceChildren();
  const project=newProject('GridBarCompatibility'),form=project.modules[0];
  Object.assign(form.form.properties,{ClientWidth:13200,ClientHeight:9300,Width:13200,Height:9300,StartUpPosition:0,Left:120,Top:120});project.settings.renderer='canvas2d';
  function add(type,name,x,y,width,height,props={}){const c=createControl(type,name,x*15,y*15);Object.assign(c.properties,{Width:width*15,Height:height*15,...props});form.form.controls.push(c);}
  add('MSFlexGrid','Grid',20,70,500,270,{Rows:10000,Cols:100,Row:1,Col:1,RowSel:1,ColSel:1,AllowUserResizing:3,TabIndex:0});
  add('MSHFlexGrid','OtherGrid',540,70,300,270,{Rows:5,Cols:4,Row:1,Col:1,TabIndex:1});
  add('Toolbar','Tools',20,20,820,34,{TabIndex:2});
  add('StatusBar','Status',20,450,820,32,{Style:0});
  add('Label','Output',20,370,780,54,{Caption:'Ready'});
  form.code=`Option Explicit
Private Sub Form_Load()
    Dim b As Object, panel As Object
    Set b = Tools.Buttons.Add(, "normal", "&Open", 0)
    Set b = Tools.Buttons.Add(, "check", "&Check", 1)
    Tools.Buttons.Add , "a", "&A", 2
    Tools.Buttons.Add , "b", "&B", 2
    Tools.Buttons.Add , "separator", "", 3
    Set b = Tools.Buttons.Add(, "placeholder", "", 4)
    b.Width = 300
    Set b = Tools.Buttons.Add(, "drop", "&Menu", 5)
    b.ButtonMenus.Add , "first", "&First"
    b.ButtonMenus.Add , "divider", "-"
    b.ButtonMenus.Add , "second", "&Second"
    Set panel = Status.Panels.Add(, "one", "One")
    panel.AutoSize = 1
    Set panel = Status.Panels.Add(, "two", "Two")
    panel.Width = 2400
    panel.Alignment = 2
    Grid.RowHeight(2) = 630
    Grid.RowHeight(3) = 0
    Grid.ColWidth(0) = 750
    Grid.ColWidth(2) = 1800
    Grid.ColWidth(3) = 0
    Grid.TextMatrix(1, 1) = "First"
    Grid.TextMatrix(2, 1) = "Tall"
    Grid.TextMatrix(9999, 99) = "Last"
    OtherGrid.TextMatrix(1, 1) = "Original"
End Sub
Private Sub Tools_ButtonClick(ByVal Button As Object)
    Output.Caption = "Button:" & Button.Key & ":" & CStr(Button.Value)
End Sub
Private Sub Tools_ButtonDropDown(ByVal Button As Object)
    Output.Caption = "Drop:" & Button.Key
End Sub
Private Sub Tools_ButtonMenuClick(ByVal ButtonMenu As Object)
    Output.Caption = "Menu:" & ButtonMenu.Key
End Sub
Private Sub Status_PanelClick(ByVal Panel As Object)
    Output.Caption = "Panel:" & Panel.Key
End Sub
Private Sub Status_PanelDblClick(ByVal Panel As Object)
    Output.Caption = "DoublePanel:" & Panel.Key
End Sub
Private Sub Grid_RowColChange()
    Output.Caption = "Cell:" & CStr(Grid.Row) & ":" & CStr(Grid.Col)
End Sub
Private Sub Grid_SelChange()
    Grid.Tag = CStr(Grid.RowSel) & ":" & CStr(Grid.ColSel)
End Sub
`;
  const messages=[],app=new RuntimeAPI.ApplicationHost(project,document.body,{persist:false,rendering:false,onMessage:message=>messages.push(message)});
  globalThis.app=app;globalThis.messages=messages;await app.start();if(app.vm.state==='error'||messages.some(m=>m.type==='error'))throw Error(JSON.stringify(messages));
  globalThis.controls=Object.fromEntries(app.forms[0].controls.map(control=>[control.model.name,control]));for(const control of app.forms[0].controls)control.refresh();
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  return {state:app.vm.state,buttons:controls.Tools.Buttons.Count,panels:controls.Status.Panels.Count,rows:controls.Grid.Rows,cols:controls.Grid.Cols};
}

export async function setupDates(){
  globalThis.app?.dispose();document.body.replaceChildren();const project=newProject('DateCompatibility'),form=project.modules[0];
  Object.assign(form.form.properties,{ClientWidth:12600,ClientHeight:8100,Width:12600,Height:8100,StartUpPosition:0,Left:120,Top:120});project.settings.renderer='canvas2d';
  function add(type,name,x,y,width,height,props={}){const c=createControl(type,name,x*15,y*15);Object.assign(c.properties,{Width:width*15,Height:height*15,...props});form.form.controls.push(c);}
  add('DTPicker','Picker',20,20,340,28,{Value:'2024-02-29 13:07:09',Format:3,CustomFormat:"yyyy-MM-dd 'at' HH:mm:ss",CheckBox:-1,TabIndex:0});
  add('DTPicker','Callback',400,20,390,28,{Value:'2024-02-29 13:07:09',Format:3,CustomFormat:'dd/MM/yyyy XX',TabIndex:1});
  add('MonthView','Calendar',20,80,570,210,{Value:'2024-02-29',MultiSelect:-1,MonthColumns:2,MaxSelCount:7,StartOfWeek:2,ShowWeekNumbers:-1,TabIndex:2});
  add('CommandButton','SetDate',620,80,165,28,{Caption:'Set date from VB',TabIndex:3});
  add('Label','Output',20,320,750,65,{Caption:'Ready'});
  form.code=`Option Explicit
Private Sub Picker_Change()
    If IsNull(Picker.Value) Then
        Output.Caption = "Null date"
    Else
        Output.Caption = "Date:" & CStr(Picker.Year) & ":" & CStr(Picker.Month) & ":" & CStr(Picker.Day)
    End If
End Sub
Private Sub Callback_FormatSize(ByVal CallbackField As String, Size As Long)
    Size = 120
End Sub
Private Sub Callback_Format(ByVal CallbackField As String, FormattedString As String)
    FormattedString = "Day " & CStr(Callback.Day)
End Sub
Private Sub Calendar_GetDayBold(ByVal StartDate As Date, ByVal Count As Integer, State() As Boolean)
    Dim i As Integer
    For i = 0 To Count - 1
        State(i) = Weekday(DateAdd("d", i, StartDate)) = 1
    Next i
    Calendar.Tag = CStr(Count)
End Sub
Private Sub Calendar_DateClick(ByVal DateClicked As Date)
    Output.Caption = "Clicked:" & CStr(Day(DateClicked))
End Sub
Private Sub Calendar_DateDblClick(ByVal DateClicked As Date)
    Output.Caption = "Double:" & CStr(Day(DateClicked))
End Sub
Private Sub Calendar_SelChange(ByVal StartDate As Date, ByVal EndDate As Date)
    Output.Tag = CStr(DateDiff("d", StartDate, EndDate) + 1)
End Sub
Private Sub SetDate_Click()
    Picker.Year = 2025
    Calendar.SelStart = #3/1/2024#
    Calendar.SelEnd = #3/4/2024#
    Calendar.DayBold(Calendar.VisibleDays(1)) = True
    SetDate.Tag = "Returned"
End Sub
`;
  const messages=[],app=new RuntimeAPI.ApplicationHost(project,document.body,{persist:false,rendering:false,onMessage:message=>messages.push(message)});globalThis.app=app;globalThis.messages=messages;await app.start();
  if(app.vm.state==='error'||messages.some(m=>m.type==='error'))throw Error(JSON.stringify(messages));globalThis.controls=Object.fromEntries(app.forms[0].controls.map(control=>[control.model.name,control]));for(const control of app.forms[0].controls)control.refresh();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {state:app.vm.state,year:controls.Picker.Year,month:controls.Picker.Month,panels:controls.Calendar.dateView.state.panels().length};
}

export async function setupDialogs(){
  globalThis.app?.dispose();document.body.replaceChildren();const project=newProject('DialogCompatibility'),form=project.modules[0];
  Object.assign(form.form.properties,{ClientWidth:10500,ClientHeight:7500,Width:10500,Height:7500,StartUpPosition:0,Left:120,Top:120});project.settings.renderer='canvas2d';
  for(const [type,name,x,y,w,h,props]of [
    ['CommandButton','ColorButton',20,20,140,30,{Caption:'Choose color'}],['CommandButton','FontButton',180,20,140,30,{Caption:'Choose font'}],
    ['CommonDialog','Dialog',20,420,28,28,{DialogTitle:'Choose',Color:255,FontName:'Arial',FontSize:10}],['Label','Output',20,100,600,80,{Caption:'Ready'}]
  ]){const c=createControl(type,name,x*15,y*15);Object.assign(c.properties,{Width:w*15,Height:h*15,...props});form.form.controls.push(c);}
  form.code=`Option Explicit
Private Sub ColorButton_Click()
    On Error GoTo Failed
    Dialog.ShowColor
    Output.Caption = "Color:" & CStr(Dialog.Color)
    Exit Sub
Failed:
    Output.Caption = "Error:" & CStr(Err.Number)
End Sub
Private Sub FontButton_Click()
    On Error GoTo Failed
    Dialog.ShowFont
    Output.Caption = "Font:" & Dialog.FontName & ":" & CStr(Dialog.FontSize) & ":" & CStr(Dialog.FontBold)
    Exit Sub
Failed:
    Output.Caption = "Error:" & CStr(Err.Number)
End Sub
`;
  const messages=[],app=new RuntimeAPI.ApplicationHost(project,document.body,{persist:false,rendering:false,onMessage:message=>messages.push(message)});globalThis.app=app;globalThis.messages=messages;await app.start();
  if(app.vm.state==='error'||messages.some(m=>m.type==='error'))throw Error(JSON.stringify(messages));globalThis.controls=Object.fromEntries(app.forms[0].controls.map(control=>[control.model.name,control]));for(const control of app.forms[0].controls)control.refresh();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {state:app.vm.state};
}
