import {createControl,createForm} from '../../../src/project/model.js';

/** Compiled VB drives real GTK objects; the GLib timer must deliver the exit. */
export function linuxGtkProject() {
  const module=createForm('GtkControls','Linux native GTK acceptance');
  module.id='linux-gtk-module';module.form.id='linux-gtk-form';
  Object.assign(module.form.properties,{ClientWidth:15000,ClientHeight:11250});
  const controls=module.form.controls;
  const add=(type,name,properties={},parent=null)=>{
    const index=controls.length,control=createControl(type,name,150+(index%6)*2400,150+Math.floor(index/6)*1650);
    control.id='linux-gtk-'+name+'-'+index;control.parent=parent;
    Object.assign(control.properties,{Width:2100,Height:1200},properties);controls.push(control);return control;
  };
  // A child preceding its container tests parent resolution independently of order.
  add('TextBox','NestedText',{Left:150,Top:360,Height:330},'Frame1');
  add('Frame','Frame1');
  add('TextBox','Text1',{Height:330});
  add('RichTextBox','Rich1');
  add('Label','Label1',{Height:330});
  add('CommandButton','Button1',{Height:450});
  add('ListBox','List1',{MultiSelect:1});
  add('ComboBox','Combo1',{Height:330});
  add('CheckBox','Check1',{Height:330});
  add('OptionButton','Option1',{Height:330});
  add('OptionButton','Option2',{Height:330});
  add('HScrollBar','Scroll1',{Height:300});
  add('VScrollBar','Scroll2',{Width:300});
  add('Slider','Slider1',{Height:450});
  add('UpDown','Spin1',{Width:450,Height:600});
  add('ProgressBar','Progress1',{Height:330});
  add('TreeView','Tree1');
  add('ListView','View1');
  add('MSFlexGrid','Grid1');
  add('MSHFlexGrid','Grid2');
  add('DataGrid','Grid3');
  add('TabStrip','Tabs1');
  add('SSTab','Tabs2');
  add('Toolbar','Tools1',{Height:450});
  add('StatusBar','Status1',{Height:330});
  add('PictureBox','Picture1');
  add('Image','Image1',{Visible:0});
  add('Shape','Shape1');
  add('Line','Line1',{Height:30});
  add('DTPicker','Date1');
  add('MonthView','Calendar1');
  add('ImageList','Images1',{Visible:0});
  add('CommonDialog','Dialog1',{Visible:0});
  add('Timer','Clock1',{Interval:0,Enabled:0,Visible:0});
  add('CommandButton','Buttons',{Index:0,Height:330});
  add('CommandButton','Buttons',{Index:2,Height:330});
  module.code=`Option Explicit
Private TextChanges As Long
Private CheckClicks As Long
Private ComboClicks As Long
Private TimerTicks As Long
Private ArrayClicks As Long

Private Sub Form_Load()
    TextChanges = 0
    CheckClicks = 0
    ComboClicks = 0
    Me.Caption = "GTK: native VB6 — Zażółć"
    Debug.Assert Me.Caption = "GTK: native VB6 — Zażółć"
    Label1.Caption = "&Ready"
    Debug.Assert Label1.Caption = "&Ready"
    Debug.Assert NestedText.Container Is Frame1
    NestedText.Text = "Nested container"
    Text1.Text = "A😀ŻZ"
    Debug.Assert Len(Text1.Text) = 5
    Text1.SelStart = 1
    Text1.SelLength = 2
    Debug.Assert Text1.SelText = "😀"
    Text1.SelText = "Ω"
    Debug.Assert Text1.Text = "AΩŻZ"
    Debug.Assert Text1.SelStart = 2
    Debug.Assert Text1.SelLength = 0
    Text1.Font.Name = "Sans"
    Text1.Font.Size = 12
    Text1.Font.Bold = True
    Debug.Assert Text1.Font.Bold
    Debug.Assert Text1.Font.Size = 12
    Rich1.Text = "First" & vbCrLf & "Żółw"
    Debug.Assert Rich1.Text = "First" & vbCrLf & "Żółw"
    Rich1.SaveFile "linux-gtk-text.txt", 1
    Rich1.Text = ""
    Rich1.LoadFile "linux-gtk-text.txt", 1
    Debug.Assert Rich1.Text = "First" & vbCrLf & "Żółw"
    Debug.Print "LINUX_GTK_TEXT_OK"

    List1.AddItem "Alpha"
    List1.AddItem "Gamma"
    List1.AddItem "Beta", 1
    Debug.Assert List1.ListCount = 3
    Debug.Assert List1.List(1) = "Beta"
    List1.ItemData(1) = 2147483647
    Debug.Assert List1.ItemData(1) = 2147483647
    List1.ListIndex = 1
    List1.Selected(0) = True
    Debug.Assert List1.SelCount = 2
    List1.RemoveItem 0
    Debug.Assert List1.List(0) = "Beta"
    Debug.Assert List1.ItemData(0) = 2147483647
    Combo1.AddItem "Red"
    Combo1.AddItem "Green"
    Combo1.ListIndex = 1
    Debug.Assert Combo1.Text = "Green"
    Check1.Value = 1
    Debug.Assert Check1.Value = 1
    Option1.Value = 1
    Option2.Value = 1
    Debug.Assert Option1.Value = 0
    Debug.Assert Option2.Value = 1
    Scroll1.Value = 123
    Scroll2.Value = 456
    Slider1.Value = 7
    Spin1.Value = 42
    Progress1.Value = 75
    Debug.Assert Scroll1.Value = 123
    Debug.Assert Scroll2.Value = 456
    Debug.Assert Slider1.Value = 7
    Debug.Assert Spin1.Value = 42
    Debug.Assert Progress1.Value = 75
    Date1.Value = #10/16/2026#
    Calendar1.Value = #12/25/2026#
    Debug.Assert Year(Date1.Value) = 2026
    Debug.Assert Month(Calendar1.Value) = 12
    Debug.Assert Day(Calendar1.Value) = 25
    Debug.Print "LINUX_GTK_VALUES_OK"

    Dim rootNode As Object, childNode As Object, item As Object, header As Object
    Set rootNode = Tree1.Nodes.Add(, , "root", "Root")
    Set childNode = Tree1.Nodes.Add("root", 4, "child", "Child")
    Debug.Assert Tree1.Nodes.Count = 2
    Debug.Assert rootNode.Children = 1
    Debug.Assert childNode.Parent Is rootNode
    Debug.Assert childNode.FullPath = "Root\\Child"
    Debug.Assert Tree1.Nodes("CHILD") Is childNode
    rootNode.Expanded = True
    Set Tree1.SelectedItem = childNode
    Debug.Assert Tree1.SelectedItem Is childNode
    Set header = View1.ColumnHeaders.Add(, "name", "Name", 1200)
    Set header = View1.ColumnHeaders.Add(, "value", "Value", 1200)
    Set item = View1.ListItems.Add(, "first", "Item one")
    item.SubItems(1) = "Detail"
    Debug.Assert View1.ListItems("FIRST") Is item
    Debug.Assert item.SubItems(1) = "Detail"
    Set View1.SelectedItem = item
    Debug.Assert View1.SelectedItem Is item
    Grid1.Rows = 3
    Grid1.Cols = 2
    Grid1.TextMatrix(1, 1) = "Cell"
    Debug.Assert Grid1.TextArray(3) = "Cell"
    Grid1.Row = 1
    Grid1.Col = 1
    Debug.Assert Grid1.Text = "Cell"
    Grid1.ColWidth(1) = 900
    Debug.Assert Grid1.ColWidth(1) = 900
    Grid2.TextMatrix(1, 1) = "Hierarchy cell"
    Grid3.TextMatrix(1, 1) = "Data cell"
    Debug.Assert Grid2.TextMatrix(1, 1) = "Hierarchy cell"
    Debug.Assert Grid3.TextMatrix(1, 1) = "Data cell"
    Tabs1.Tabs.Clear
    Set item = Tabs1.Tabs.Add(, "one", "One")
    Set item = Tabs1.Tabs.Add(, "two", "Two")
    Set Tabs1.SelectedItem = item
    Debug.Assert Tabs1.Tabs.Count = 2
    Debug.Assert Tabs1.SelectedItem Is item
    Tabs2.Tab = 2
    Debug.Assert Tabs2.Tab = 2
    Set item = Tools1.Buttons.Add(, "open", "Open")
    Debug.Assert Tools1.Buttons("open").Caption = "Open"
    Set item = Status1.Panels.Add(, "ready", "Ready")
    item.Text = "Running"
    Debug.Assert Status1.Panels("ready").Text = "Running"
    Debug.Print "LINUX_GTK_COLLECTIONS_OK"

    Debug.Assert Buttons.Count = 2
    Debug.Assert Buttons.LBound = 0
    Debug.Assert Buttons.UBound = 2
    Load Buttons(3)
    Buttons(3).Caption = "Dynamic"
    Buttons(3).Visible = True
    Buttons(3).Click
    Debug.Assert ArrayClicks = 3
    Debug.Assert Buttons.Count = 3
    Unload Buttons(3)
    Debug.Assert Buttons.Count = 2
    Picture1.Cls
    Picture1.PSet (10, 10), vbRed
    Picture1.Line (0, 0)-(30, 30), vbBlue
    Picture1.Circle (40, 40), 10, vbGreen
    Picture1.Print "GTK / Cairo"
    Debug.Assert Picture1.TextWidth("Wide text") > Picture1.TextWidth("i")
    Debug.Assert Picture1.TextHeight("GTK") > 0
    Debug.Assert Picture1.ScaleX(1440, 1, 3) = 96
    Debug.Assert Screen.Width > 0
    Debug.Assert Screen.Height > 0
    Debug.Assert Screen.TwipsPerPixelX = 15
    Clipboard.SetText "Linux clipboard Żółw"
    Debug.Assert Clipboard.GetText() = "Linux clipboard Żółw"
    Debug.Assert Forms.Count = 1
    Debug.Assert TextChanges >= 2
    Debug.Assert CheckClicks = 1
    Debug.Assert ComboClicks >= 1
    Debug.Print "LINUX_GTK_GRAPHICS_OK"
    Clock1.Interval = 30
    Clock1.Enabled = True
End Sub

Private Sub Text1_Change()
    TextChanges = TextChanges + 1
End Sub
Private Sub Check1_Click()
    CheckClicks = CheckClicks + 1
End Sub
Private Sub Combo1_Click()
    ComboClicks = ComboClicks + 1
End Sub
Private Sub Buttons_Click(Index As Integer)
    ArrayClicks = Index
End Sub
Private Sub Clock1_Timer()
    Clock1.Enabled = False
    TimerTicks = TimerTicks + 1
    Debug.Assert TimerTicks = 1
    Debug.Print "LINUX_GTK_CONTROLS_OK"
    Unload Me
End Sub`;
  return {schema:1,id:'linux-gtk-project',name:'LinuxGtkControls',startup:module.name,modules:[module]};
}
