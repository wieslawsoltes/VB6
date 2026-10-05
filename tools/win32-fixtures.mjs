import fs from 'node:fs/promises';
import {win32ArrayFixtures} from './win32-array-fixtures.mjs';
import {win32StorageFixtures,win32ErrorFixtures} from './win32-storage-fixtures.mjs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject,createForm,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
export function win32Fixtures() {
  const arithmetic=newProject('AotArithmetic');arithmetic.startup='Sub Main';
  arithmetic.modules=[{id:'arithmetic',name:'MainModule',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function GetCurrentProcessId Lib "kernel32" () As Long
Private Sequence As Long
Private Function NextValue() As Long
    Sequence = Sequence + 1
    NextValue = Sequence
End Function
Private Function Pair(ByVal a As Long, ByVal b As Long) As Long
    Pair = a * 10 + b
End Function
Private Sub Increment(ByRef n As Long)
    n = n + 1
End Sub
Private Function Factorial(ByVal n As Long) As Long
    If n <= 1 Then
        Factorial = 1
    Else
        Factorial = n * Factorial(n - 1)
    End If
End Function
Public Sub Main()
    Dim n As Long, i As Long, b As Byte, small As Integer, flag As Boolean
    n = 0
    For i = 1 To 10
        n = n + i
    Next i
    If n <> 55 Then ExitProcess 10
    For i = 10 To 1 Step -2
        n = n - i
    Next i
    If n <> 25 Then ExitProcess 11
    Do While n < 30
        Increment n
    Loop
    If n <> 30 Then ExitProcess 12
    If Factorial(8) <> 40320 Then ExitProcess 13
    If Pair(NextValue(), NextValue()) <> 12 Then ExitProcess 14
    If -7 \\ 3 <> -2 Then ExitProcess 15
    If -7 Mod 3 <> -1 Then ExitProcess 16
    If (5 And 3) <> 1 Then ExitProcess 17
    If (5 Or 3) <> 7 Then ExitProcess 18
    If (5 Xor 3) <> 6 Then ExitProcess 19
    If Not 0 <> -1 Then ExitProcess 20
    b = 255
    small = -32768
    flag = CBool(2)
    If b <> 255 Or small <> -32768 Or flag <> True Then ExitProcess 21
    If CStr(-2147483648) <> "-2147483648" Then ExitProcess 22
    If "X" & CStr(42) & "Y" <> "X42Y" Then ExitProcess 23
    If CLng("1234") <> 1234 Then ExitProcess 24
    Select Case n
        Case 1, 2
            ExitProcess 25
        Case 25 To 35
            n = 90
        Case Else
            ExitProcess 26
    End Select
    If n <> 90 Then ExitProcess 27
    If GetCurrentProcessId() <= 0 Then ExitProcess 28
    ExitProcess 0
End Sub
`}];
  const gui=newProject('AotWindows'),f=gui.modules[0];
  f.form.properties.Caption='AOT native window';
  const control=(type,name,left,top,width=2100,height=450)=>{const c=createControl(type,name,left,top);Object.assign(c.properties,{Width:width,Height:height});f.form.controls.push(c);return c;};
  control('CommandButton','Command1',300,300).properties.Caption='Increment';
  control('TextBox','Text1',2700,300).properties.Text='0';
  control('CommandButton','Command2',300,900).properties.Caption='Modal';
  control('CommandButton','Command3',2700,900).properties.Caption='Allow close';
  control('ListBox','List1',300,1500,2100,1200).properties.List=['one','two'];
  control('ComboBox','Combo1',2700,1500).properties.List=['first','second'];
  const frame=control('Frame','Frame1',300,3000,6600,2500);frame.properties.Caption='Native parent';
  const nested=control('Frame','Frame2',300,300,5000,1800);nested.parent='Frame1';nested.properties.Caption='Nested native parent';
  const nestedButton=control('CommandButton','NestedButton',300,450);nestedButton.parent='Frame2';nestedButton.properties.Caption='Nested event';
  f.code=`Option Explicit
Private RejectClose As Boolean
Private Counter As Long
Private InitializeCount As Long
Private LoadCount As Long
Private Sub Form_Initialize()
    InitializeCount = InitializeCount + 1
    ' Self UI access must not recursively allocate the default form instance.
    Caption = "Initialized native window"
End Sub
Private Sub Form_Load()
    LoadCount = LoadCount + 1
    RejectClose = True
    Counter = 41
End Sub
Private Sub Command1_Click()
    Counter = Counter + 1
    If InitializeCount <> 1 Or LoadCount <> 1 Then End
    Text1.Text = CStr(Counter)
    Caption = "Counter " & CStr(Counter)
    List1.AddItem "item " & CStr(Counter)
    Combo1.ListIndex = 1
End Sub
Private Sub Command2_Click()
    If Form2.InitialValue() <> 9 Then End
    If Form2.Initialized <> 1 Then End
    If Form2.Loads <> 0 Then End
    Form2.Show vbModal, Me
    Text1.Text = "Modal returned"
End Sub
Private Sub Command3_Click()
    RejectClose = False
End Sub
Private Sub Form_QueryUnload(Cancel As Integer, UnloadMode As Integer)
    If RejectClose Then Cancel = 1
End Sub
Private Sub MenuHello_Click()
    Text1.Text = "Native menu"
End Sub
Private Sub NestedButton_Click()
    Text1.Text = "Nested native frame"
End Sub
`;
  f.form.menus=[{id:'menu-file',type:'Menu',name:'MenuFile',parent:null,properties:{Caption:'&File',Visible:-1,Enabled:-1}},{id:'menu-hello',type:'Menu',name:'MenuHello',parent:'MenuFile',properties:{Caption:'&Hello',Visible:-1,Enabled:-1}}];
  const dialog=createForm('Form2','AOT modal window');dialog.form.properties.BorderStyle=3;
  dialog.form.controls=[createControl('CommandButton','CloseButton')];dialog.form.controls[0].properties.Caption='Close';
  dialog.code=`Option Explicit
Public Initialized As Long
Public Loads As Long
Private Value As Long
Private Sub Form_Initialize()
    Initialized = Initialized + 1
    Value = 9
End Sub
Private Sub Form_Load()
    Loads = Loads + 1
    If Initialized <> 1 Then End
End Sub
Public Function InitialValue() As Long
    InitialValue = Value
End Function
Private Sub CloseButton_Click()
    Unload Me
End Sub`;gui.modules.push(dialog);
  const mdi=newProject('AotMDI'),parent=mdi.modules[0];parent.form.type='MDIForm';parent.form.properties.Caption='AOT native MDI';
  parent.code='Option Explicit\nPrivate Sub MDIForm_Load()\n Form2.Show\n Form3.Show\nEnd Sub';
  for(const [name,caption] of [['Form2','First MDI child'],['Form3','Second MDI child']]){const child=createForm(name,caption);Object.assign(child.form.properties,{MDIChild:-1,ClientWidth:3300,ClientHeight:2400});child.form.controls=[createControl('CommandButton','Command1')];child.form.controls[0].properties.Caption='Update';child.code='Option Explicit\nPrivate Sub Command1_Click()\n Caption = "Native MDI event"\nEnd Sub';mdi.modules.push(child);}
  const faults = [
    ['AotOverflow',6,'Dim n As Long\n n = 2147483647\n n = n + 1'],
    ['AotDivideZero',11,'Dim n As Long\n n = 42 \\ 0'],
    ['AotTextOverflow',6,'Dim n As Long\n n = CLng("2147483648")'],
    ['AotTextMismatch',13,'Dim n As Long\n n = CLng("not a number")']
  ].map(([name,error,code])=>{
    const p=newProject(name);p.startup='Sub Main';p.nativeTestError=error;
    p.modules=[{id:name,name:'MainModule',kind:'module',code:'Option Explicit\nPublic Sub Main()\n'+code+'\nEnd Sub'}];return p;
  });
  return [arithmetic,gui,mdi,...faults,...win32StorageFixtures(),...win32ErrorFixtures(),...win32ArrayFixtures()];
}
export async function emitWin32Fixtures(out='validation/win32') {
  await fs.mkdir(out,{recursive:true});const evidence=[];
  for(const project of win32Fixtures()){
    const {bytes,report}=compileWin32(project);const file=path.join(out,project.name+'.exe');await fs.writeFile(file,bytes);
    const sha256=createHash('sha256').update(bytes).digest('hex');evidence.push({file,sha256,...report});
    await fs.writeFile(path.join(out,project.name+'.vb6web'),JSON.stringify(project,null,2));
  }
  await fs.writeFile(path.join(out,'build-evidence.json'),JSON.stringify(evidence,null,2));return evidence;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await emitWin32Fixtures(process.argv[2]),null,2));
