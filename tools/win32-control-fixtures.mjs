import {nativeSurfaceLifetimeFixture} from './win32-surface-lifetime-fixture.mjs';
import {nativeSurfacePictureFixture} from './win32-surface-picture-fixture.mjs';
import {nativeSurfaceDrawingFixtures} from './win32-surface-drawing-fixtures.mjs';
import {nativeSurfaceFixture} from './win32-surface-fixture.mjs';
import {nativeErrorArgumentFixture} from './win32-error-arguments-fixture.mjs';
import {nativeMathControlFixture} from './win32-math-fixture.mjs';
import {nativeRecordStringFixture} from './win32-record-string-fixture.mjs';
import {nativeFileControlFixture} from './win32-file-fixture.mjs';
import {nativeListControlFixture} from './win32-list-fixture.mjs';
import {commonItemControlFixture} from './win32-control-items-fixture.mjs';
import {gridEditControlFixtures} from './win32-grid-edit-fixtures.mjs';
import {tabControlFixtures} from './win32-tab-fixtures.mjs';
/** Self-checking, freestanding Win32 control fixtures. No DOM, VM or user input. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {extendNativeMetadataFixture} from './win32-control-metadata-fixture.mjs';
import {chartControlFixture} from './win32-chart-fixtures.mjs';
import {gridControlFixtures} from './win32-grid-fixtures.mjs';
import {advancedNativeControlFixtures} from './win32-advanced-control-fixtures.mjs';
const api=`Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function SendValue Lib "user32" Alias "SendMessageW" (ByVal hwnd As Long, ByVal message As Long, ByVal wp As Long, ByVal lp As Long) As Long
Private Declare Function SendRecord Lib "user32" Alias "SendMessageW" (ByVal hwnd As Long, ByVal message As Long, ByVal wp As Long, lp As Any) As Long
Private Declare Function GetParent Lib "user32" (ByVal hwnd As Long) As Long
Private Declare Function GetDlgCtrlID Lib "user32" (ByVal hwnd As Long) As Long`;
function fixture(name){
  const project=newProject(name),form=project.modules[0],checks=[],body=[];
  form.form.controls=[];
  const add=source=>body.push(source),check=(expression,label)=>{checks.push(label);add(`If Not (${expression}) Then ExitProcess ${checks.length}`);};
  const control=(type,name,properties={},parent=null)=>{const c=createControl(type,name);Object.assign(c.properties,{Left:150,Top:150,Width:1800,Height:450},properties);if(parent)c.parent=parent;form.form.controls.push(c);return c;};
  const finish=(declarations='',handlers='')=>{form.code=`Option Explicit\n${api}\n${declarations}\nPrivate Sub Form_Load()\n${body.join('\n')}\nExitProcess 0\nEnd Sub\n${handlers}`;return {project,checks};};
  return {project,form,control,add,check,finish};
}
export function rangeControlFixture(){
  const f=fixture('AotControlRanges'),{control,add,check,finish}=f;
  control('Frame','Group',{Width:6000,Height:4000});
  control('HScrollBar','Bar',{Min:-200000,Max:200000,Value:100000,SmallChange:7,LargeChange:700},'Group');
  control('VScrollBar','Vertical',{Min:-100,Max:100,Value:0},'Group');
  control('Slider','Track',{Min:0,Max:200000,Value:50000},'Group');
  control('ProgressBar','Progress',{Min:0,Max:200000,Value:0},'Group');
  control('UpDown','Spin',{Min:0,Max:200000,Value:170000},'Group');
  add('Dim n As Long, notice As NMUPDOWN');
  check('GetParent(Bar.hWnd)=Group.hWnd','scrollbar is an actual nested child HWND');
  check('Bar.Min=-200000 And Bar.Max=200000 And Bar.Value=100000','initial signed 32-bit scrollbar range and position');
  add('Bar.Value=150000');check('Bar.Value=150000 And barChanges=1','programmatic Value preserves more than sixteen bits and fires Change once');
  add('Bar.Value=150000');check('barChanges=1','unchanged Value does not duplicate Change');
  add('n=SendValue(Group.hWnd, &H114, 1, Bar.hWnd)');check('Bar.Value=150007 And barChanges=2','nested WM_HSCROLL line increment uses SmallChange');
  add('n=SendValue(Group.hWnd, &H114, 2, Bar.hWnd)');check('Bar.Value=149307','page decrement uses full-range LargeChange');
  add('Bar.Max=100000');check('Bar.Value=100000 And Bar.Max=100000','shrinking range clamps the native position');
  add('Progress.Value=180000\nTrack.Value=160000');check('Progress.Value=180000 And Track.Value=160000','progress and trackbar positions remain signed 32-bit');
  add('trackChanges=0\nn=SendValue(Track.hWnd, &H405, 1, 190000)\nn=SendValue(Group.hWnd, &H114, 5, Track.hWnd)');
  check('Track.Value=190000 And trackChanges=1 And trackScrolls=1','native trackbar notification reads actual position and dispatches Scroll');
  add('notice.hwnd=Spin.hWnd\nnotice.id=GetDlgCtrlID(Spin.hWnd)\nnotice.code=-722\nnotice.position=170000\nnotice.delta=11\nn=SendRecord(Group.hWnd, &H4E, notice.id, notice)');
  check('Spin.Value=170011 And spinChanges=1 And n=1','NMUPDOWN signed delta updates once and vetoes duplicate default application');
  add('On Error Resume Next\nErr.Clear\nBar.Value=100001');check('Err.Number=5 And Bar.Value=100000','invalid Value raises an error without changing the position');
  add('Err.Clear\nOn Error GoTo 0');
  return finish(`Private Type NMUPDOWN
 hwnd As Long
 id As Long
 code As Long
 position As Long
 delta As Long
End Type
Private barChanges As Long, trackChanges As Long, trackScrolls As Long, spinChanges As Long`,
`Private Sub Bar_Change()
 barChanges=barChanges+1
End Sub
Private Sub Track_Change()
 trackChanges=trackChanges+1
End Sub
Private Sub Track_Scroll()
 trackScrolls=trackScrolls+1
End Sub
Private Sub Spin_Change()
 spinChanges=spinChanges+1
End Sub`);
}
export function contentControlFixture(){
  const {control,add,check,finish}=fixture('AotControlContent');
  control('TreeView','Tree',{Nodes:[{Key:'child',Text:'Child',Parent:'root'},{Key:'root',Text:'Root'}]});
  control('ListView','Rows',{View:3,Columns:[{Text:'Name',Width:1500},{Text:'Value',Width:900}],Items:[{Text:'First',SubItems:['One']},{Text:'Second',SubItems:['Two']}]});
  control('StatusBar','Status',{Panels:[{Text:'Ready',Width:1500},{Text:'Native',Width:1500}]});
  control('Toolbar','Tools',{Buttons:[{Key:'open',Caption:'Open'},{Key:'save',Caption:'Save'}]});
  control('SSTab','Pages',{Tabs:[{Caption:'First'},{Caption:'Second'},{Caption:'Third'}],Tab:0});
  control('TabStrip','Strip',{Tabs:[{Caption:'A'},{Caption:'B'}]});
  control('DTPicker','DateBox',{Value:'2024-02-29'});control('MonthView','Calendar',{Value:'2024-02-29'});
  add('Dim n As Long, notice As NMHDR');
  check('Tree.Nodes.Count=2','tree parent-first insertion preserves both saved nodes');
  check('Rows.ListItems.Count=2 And Rows.ColumnHeaders.Count=2','saved list-view rows and columns become native items');
  check('Status.Panels.Count=2 And Tools.Buttons.Count=2','saved status panels and toolbar buttons are populated');
  check('Pages.Tabs.Count=3 And Strip.Tabs.Count=2','saved tab captions produce native tab items');
  add('Pages.Tab=2');check('Pages.Tab=2 And tabChanges=1 And previousTab=0','SSTab setter dispatches the previous-tab event argument');
  add('n=SendValue(Pages.hWnd, &H130C, 1, 0)\nnotice.hwnd=Pages.hWnd\nnotice.id=GetDlgCtrlID(Pages.hWnd)\nnotice.code=-551\nn=SendRecord(Me.hWnd,&H4E,notice.id,notice)');
  check('Pages.Tab=1 And tabChanges=2 And previousTab=2','TCN_SELCHANGE dispatches the real old and selected tabs');
  check('Year(DateBox.Value)=2024 And Month(DateBox.Value)=2 And Day(DateBox.Value)=29','SYSTEMTIME seed preserves leap day');
  add('DateBox.Value=DateSerial(2032,12,25)\nCalendar.Value=DateSerial(2032,12,26)');
  check('Year(DateBox.Value)=2032 And Day(DateBox.Value)=25 And Day(Calendar.Value)=26','Date property uses native SYSTEMTIME and OLE DATE conversion');
  add('Rows.FullRowSelect=True\nRows.GridLines=True');check('Rows.FullRowSelect And Rows.GridLines','list-view extended styles round-trip');
  add('Tree.Nodes.Clear\nRows.ListItems.Clear\nTools.Buttons.Clear\nStrip.Tabs.Clear');
  check('Tree.Nodes.Count=0 And Rows.ListItems.Count=0 And Tools.Buttons.Count=0 And Strip.Tabs.Count=0','collection Clear removes actual native items');
  return finish(`Private Type NMHDR
 hwnd As Long
 id As Long
 code As Long
End Type
Private tabChanges As Long, previousTab As Integer`,
`Private Sub Pages_Click(Previous As Integer)
 previousTab=Previous
 tabChanges=tabChanges+1
End Sub`);
}
export function editControlFixture(){
  const f=fixture('AotControlEditing'),{control,add,check,finish}=f;
  control('PictureBox','Surface',{Width:6000,Height:4000,ScaleMode:1});
  control('RichTextBox','Rich',{Text:'Alpha beta'},'Surface');
  control('TextBox','Edit',{Text:''},'Surface');
  control('CommandButton','Button',{Caption:'Mouse',Index:3},'Surface');
  control('CommandButton','Button',{Caption:'Other',Index:8},'Surface');
  add('Dim n As Long, i As Long, w As Long, h As Long');
  check('GetParent(Rich.hWnd)=Surface.hWnd','RichEdit is nested inside the native picture container');
  add('Rich.SelStart=6\nRich.SelLength=4');check('Rich.SelText="beta"','RichEdit selection reads the actual UTF-16 selection');
  add('Rich.SelText="gamma"');check('Rich.Text="Alpha gamma"','RichEdit selection replacement changes native text');
  add('Rich.Locked=True');check('Rich.Locked','RichEdit read-only style round-trips');
  add('Rich.Locked=False\nEdit.Text=""\nn=SendValue(Edit.hWnd,&H102,120,0)');check('Edit.Text="" And keyCalls=1','ByRef KeyAscii cancellation suppresses native text insertion');
  add('n=SendValue(Edit.hWnd,&H102,65,0)');check('Edit.Text="A" And keyCalls=2','noncancelled KeyAscii reaches the original EDIT procedure');
  add('n=SendValue(Button(3).hWnd,&H201,1, &H70005)');
  check('mouseCalls=1 And mouseIndex=3 And mouseButton=1 And mouseX=75 And mouseY=105','indexed MouseDown receives ByRef Index/Button and Single twip coordinates');
  add('w=Edit.Width\nh=Edit.Height\nEdit.Left=750\nEdit.Top=900');
  check('Edit.Left=750 And Edit.Top=900 And Edit.Width=w And Edit.Height=h','moving individual coordinates preserves the original dimensions');
  add('Edit.Move 1050,1200');check('Edit.Left=1050 And Edit.Top=1200 And Edit.Width=w And Edit.Height=h','Move with omitted dimensions keeps size');
  add('Edit.FontName="Segoe UI"\nEdit.FontSize=12.75\nEdit.FontBold=True\nEdit.FontItalic=True\nEdit.FontUnderline=True\nEdit.FontStrikethru=True');
  check('Edit.FontName="Segoe UI" And Edit.FontSize=12.75 And Edit.FontBold And Edit.FontItalic And Edit.FontUnderline And Edit.FontStrikethru','mutable font metadata preserves exact requested fractional size');
  check('SendValue(Edit.hWnd,&H31,0,0)<>0','font mutations install an actual HFONT');
  add('With Button(8)\n .FontSize=14.5\n .FontBold=True\nEnd With');
  check('Button(8).FontSize=14.5 And Button(8).FontBold And Not Button(3).FontBold','indexed With font mutation does not affect sibling array elements');
  add('Edit.Tag="owned tag"');check('Edit.Tag="owned tag"','per-control Tag owns a BSTR');
  add('For i=1 To 100\n Edit.FontSize=10+i/100\n Edit.FontName="Segoe UI"\n Edit.Tag="iteration" & CStr(i)\nNext');
  check('Edit.FontSize=11 And Edit.Tag="iteration100"','repeated owned font and Tag replacements remain usable');
  const metadata=extendNativeMetadataFixture(f);
  return finish(`${metadata.declarations}
Private keyCalls As Long, mouseCalls As Long, mouseIndex As Integer, mouseButton As Integer
Private mouseX As Single, mouseY As Single`,
`Private Sub Edit_KeyPress(KeyAscii As Integer)
 keyCalls=keyCalls+1
 If KeyAscii=120 Then KeyAscii=0
End Sub
Private Sub Button_MouseDown(Index As Integer, Button As Integer, Shift As Integer, X As Single, Y As Single)
 mouseCalls=mouseCalls+1
 mouseIndex=Index
 mouseButton=Button
 mouseX=X
 mouseY=Y
End Sub
${metadata.handlers}`);
}
export function fileControlFixture(){
  const {control,add,check,finish}=fixture('AotControlFiles');
  control('DriveListBox','Drives');control('DirListBox','Folders',{Path:'.'});control('FileListBox','Files',{Path:'.',Pattern:'*.exe;*.not-present'});
  add('Dim before As String, after As String, n As Long\nbefore=String$(512,0)\nn=GetCurrentDirectoryW(512,StrPtr(before))\nbefore=Left$(before,n)');
  check('Drives.ListCount>0','drive combo enumerates installed logical drives');
  check('Files.ListCount=1','file list uses semicolon-delimited patterns in an isolated directory');
  add('Files.ListIndex=0');check('InStr(1,Files.FileName,"AotControlFiles")=1','file name is read from the selected Win32 list item');
  add('Files.Pattern="*.not-present"');check('Files.ListCount=0','Pattern change repopulates the list');
  add('Files.Pattern="*.exe"\nFiles.Refresh');check('Files.ListCount=1','Refresh re-enumerates the current path');
  add('after=String$(512,0)\nn=GetCurrentDirectoryW(512,StrPtr(after))\nafter=Left$(after,n)');check('before=after','file enumeration and property changes never mutate process CWD');
  add('On Error Resume Next\nErr.Clear\nDrives.Drive="?:"');check('Err.Number=5','invalid drive is rejected rather than silently selecting another drive');
  add('Err.Clear\nOn Error GoTo 0');
  return finish('Private Declare Function GetCurrentDirectoryW Lib "kernel32" (ByVal count As Long,ByVal buffer As Long) As Long');
}
export function drawingControlFixture(){
  const {control,add,check,finish}=fixture('AotControlDrawing');
  control('Shape','Shape1',{Shape:0,FillStyle:0,FillColor:0x332211,BorderStyle:0,Width:1500,Height:1500});
  control('Line','Line1',{BorderColor:0x112233,BorderWidth:2});
  control('Image','Image1',{BackColor:0x665544});
  control('PictureBox','Picture1',{BackColor:0x887766});
  add('Dim dc As Long, bitmap As Long, old As Long, item As DRAWITEM, n As Long, i As Long, baseline As Long');
  add('dc=CreateCompatibleDC(0)\nbitmap=CreateBitmap(100,100,1,32,0)\nold=SelectObject(dc,bitmap)');
  check('dc<>0 And bitmap<>0 And old<>0','offscreen native drawing surface was created');
  add('item.kind=5\nitem.id=GetDlgCtrlID(Shape1.hWnd)\nitem.action=1\nitem.hwnd=Shape1.hWnd\nitem.dc=dc\nitem.right=100\nitem.bottom=100\nn=SendRecord(Me.hWnd,&H2B,item.id,item)');
  check('GetPixel(dc,50,50)=&H332211','owner-drawn Shape uses authored RGB fill in a real GDI bitmap');
  add('Shape1.FillColor=&H665544\nShape1.Shape=2\nn=SendRecord(Me.hWnd,&H2B,item.id,item)');
  check('GetPixel(dc,50,50)=&H665544','mutable shape color and ellipse kind affect actual painting');
  add('baseline=GetGuiResources(GetCurrentProcess(),0)\nFor i=1 To 200\n n=SendRecord(Me.hWnd,&H2B,item.id,item)\nNext');
  check('GetGuiResources(GetCurrentProcess(),0)<=baseline+1','owner drawing restores the DC and does not leak GDI pens or brushes');
  add('n=SelectObject(dc,old)\nn=DeleteObject(bitmap)\nn=DeleteDC(dc)');
  return finish(`Private Type DRAWITEM
 kind As Long
 id As Long
 item As Long
 action As Long
 state As Long
 hwnd As Long
 dc As Long
 left As Long
 top As Long
 right As Long
 bottom As Long
 data As Long
End Type
Private Declare Function CreateCompatibleDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function CreateBitmap Lib "gdi32" (ByVal width As Long,ByVal height As Long,ByVal planes As Long,ByVal bits As Long,ByVal pixels As Long) As Long
Private Declare Function SelectObject Lib "gdi32" (ByVal dc As Long,ByVal item As Long) As Long
Private Declare Function DeleteObject Lib "gdi32" (ByVal item As Long) As Long
Private Declare Function DeleteDC Lib "gdi32" (ByVal dc As Long) As Long
Private Declare Function GetPixel Lib "gdi32" (ByVal dc As Long,ByVal x As Long,ByVal y As Long) As Long
Private Declare Function GetGuiResources Lib "user32" (ByVal process As Long,ByVal flags As Long) As Long
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long`);
}
export function richTextControlFixture(){
  const {control,add,check,finish}=fixture('AotControlRichText');
  control('PictureBox','Surface',{Width:7500,Height:5500});
  control('RichTextBox','Rich',{TextRTF:'{\\rtf1\\ansi AOT \\b rich\\b0  text}',MaxLength:250000},'Surface');
  control('TextBox','Plain',{Text:'',MultiLine:-1,MaxLength:250000},'Surface');
  add('Dim s As String, n As Long, notice As NMHDR, previous As Long');
  check('Rich.Text="AOT rich text"','persisted RTF is parsed by actual System RichEdit');
  add('s=Rich.TextRTF');check('Left$(s,5)="{\\rtf"','TextRTF exports a native RTF document');
  add('Rich.TextRTF="{\\rtf1\\ansi Unicode \\u261?}"');
  check('Rich.Text="Unicode " & ChrW$(261)','RTF Unicode escape is not converted through the ANSI code page');
  add('Rich.Text="alpha beta"\nRich.SelStart=6\nRich.SelLength=4\ns=Rich.SelRTF');
  check('Left$(s,5)="{\\rtf"','SelRTF streams only the selected range as an RTF document');
  add('Rich.SelRTF="{\\rtf1\\ansi gamma}"');check('Rich.Text="alpha gamma"','SelRTF replacement is applied to the selected range');
  add('Rich.Text="first" & vbCrLf & "second"\nRich.SelStart=6\nRich.SelLength=6');
  check('Rich.SelText="second"','RichEdit logical positions after a paragraph are read through TEXTRANGE');
  add('Rich.Text=String$(70000,"x") & "tail"\nRich.SelStart=70000\nRich.SelLength=4');
  check('Len(Rich.Text)=70004 And Rich.SelText="tail"','RichEdit text and selection retain more than 65535 UTF-16 units');
  add('Plain.Text=String$(70000,"y") & "end"\nPlain.SelStart=70000\nPlain.SelLength=3');
  check('Len(Plain.Text)=70003 And Plain.SelText="end"','EDIT uses an owned dynamic snapshot beyond the old 4096-unit buffer');
  add('notice.hwnd=Rich.hWnd\nnotice.id=GetDlgCtrlID(Rich.hWnd)\nnotice.code=&H702\nprevious=selectionChanges\nn=SendRecord(Surface.hWnd,&H4E,notice.id,notice)');
  check('selectionChanges=previous+1','nested EN_SELCHANGE WM_NOTIFY reaches exactly one RichTextBox handler');
  add('Rich.TextRTF="{\\rtf1\\ansi Saved \\b rich\\b0  content}"\nRich.SaveFile "rich-roundtrip.rtf"\nRich.Text="cleared"\nRich.LoadFile "rich-roundtrip.rtf"');
  check('Rich.Text="Saved rich content"','SaveFile/LoadFile use actual RTF byte streams');
  add('n=DeleteFileW(StrPtr("rich-roundtrip.rtf"))');check('n<>0','successful RTF streams release the file handle before returning');
  add('Rich.Text="plain text"\nRich.SaveFile "plain-roundtrip.txt",1\nRich.Text="cleared"\nRich.LoadFile "plain-roundtrip.txt",1');
  check('Rich.Text="plain text"','file type 1 uses native plain text streaming');
  add('n=DeleteFileW(StrPtr("plain-roundtrip.txt"))');check('n<>0','successful text streams release the file handle before returning');
  add('On Error Resume Next\nErr.Clear\nRich.LoadFile "a-file-that-does-not-exist.rtf"');
  check('Err.Number=75','file-open failure returns a VB error instead of invoking an invalid stream callback');
  add('Err.Clear\nOn Error GoTo 0');
  add('Plain.Text="Unicode " & ChrW$(261) & ChrW$(937) & ChrW$(20013) & ChrW$(-10179) & ChrW$(-8576)\nRich.Text=Plain.Text\ns=Rich.TextRTF');
  check('Left$(s,6)="{\\rtf1" And InStr(s,ChrW$(20013))=0','standard RTF output uses escaped non-ASCII content, not the URTF dialect');
  add('Rich.Text="cleared"\nRich.TextRTF=s');
  check('Rich.Text=Plain.Text','TextRTF round-trips BMP and supplementary Unicode through standard RTF');
  add('Rich.SelStart=0\nRich.SelLength=Len(Rich.Text)\ns=Rich.SelRTF\nRich.Text=""\nRich.SelRTF=s');
  check('Rich.Text=Plain.Text','SelRTF round-trips the full Unicode selection through standard RTF');
  add("Rich.TextRTF=\"{\\rtf1\\ansi\\ansicpg1252 {\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}}\\f0 Caf\\'e9}\"");
  check('Rich.Text="Caf" & ChrW$(233)','ASCII RTF hex escapes retain the declared native font code page');
  add('Rich.TextRTF="{\\rtf1\\ansi " & Plain.Text & "}"');
  check('Rich.Text=Plain.Text','literal Unicode String RTF still uses explicit UTF-8 input');
  return finish(`Private Type NMHDR
 hwnd As Long
 id As Long
 code As Long
End Type
Private selectionChanges As Long
Private Declare Function DeleteFileW Lib "kernel32" (ByVal path As Long) As Long`,
`Private Sub Rich_SelChange()
 selectionChanges=selectionChanges+1
End Sub`);
}
export function nativeControlFixtures(){return [nativeSurfacePictureFixture(fixture),...nativeSurfaceDrawingFixtures(fixture),nativeSurfaceFixture(fixture),nativeSurfaceLifetimeFixture(fixture),nativeErrorArgumentFixture(fixture),nativeMathControlFixture(fixture),nativeRecordStringFixture(fixture),nativeFileControlFixture(fixture),nativeListControlFixture(fixture),commonItemControlFixture(fixture),rangeControlFixture(),contentControlFixture(),editControlFixture(),fileControlFixture(),drawingControlFixture(),richTextControlFixture(),...advancedNativeControlFixtures(fixture),...gridControlFixtures(),...gridEditControlFixtures(),chartControlFixture(),...tabControlFixtures()];}
export function buildControlFixtures(directory='reports/native-controls'){
  fs.mkdirSync(directory,{recursive:true});const builds=[];
  for(const {project,checks}of nativeControlFixtures())for(const optimization of [0,1,2]){
    const result=compileWin32(project,{optimization}),name=project.name+'-O'+optimization;
    fs.writeFileSync(path.join(directory,name+'.exe'),result.bytes);
    const sha256=createHash('sha256').update(result.bytes).digest('hex');builds.push({name,optimization,sha256,bytes:result.bytes.length,checks,controls:result.report.controls,imports:result.report.imports});
  }
  fs.writeFileSync(path.join(directory,'builds.json'),JSON.stringify(builds,null,2)+'\n');return builds;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(buildControlFixtures(process.argv[2]),null,2));
