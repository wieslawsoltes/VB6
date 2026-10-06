import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';

export function callbackFixture() {
 const checks=[],lines=['Dim value As Long, i As Long, pointer As Long'];
 const check=(expression,label)=>{checks.push(label);lines.push(`If Not (${expression}) Then ExitProcess ${checks.length}`);};
 check('InvokeLong(AddressOf Twice, 7) = 14','Independent DLL invokes stdcall Long callback');
 check('InvokeLong(AddressOf Narrow, -32768) = -32768','Integer callback results sign-extend');
 check('InvokeLong(AddressOf Small, 255) = 255','Byte callback results zero-extend');
 check('InvokeLong(AddressOf Flag, 1) = -1','Boolean callback results normalize true');
 check('InvokeDouble(AddressOf AddDouble, 0.125) = 1.625','Double callback uses full-width stack parameter and ST0 result');
 check('InvokeSingle(AddressOf AddSingle, 1.25) = CSng(2.5)','Single callback uses four-byte input and ST0 result');
 check('InvokeCurrency(AddressOf AddMoney, 900719925474.0993@) = 900719925474.0994@','Currency callback retains low bits in EDX:EAX');
 check('InvokeDouble(AddressOf AddDate, CDbl(#2024-02-28#)) = CDbl(#2024-02-29#)','Date callback returns Automation Date through ST0');
 check('InvokeRefs(AddressOf ChangeRefs) = 1','Callback mutates independent exact-type numeric references');
 check('InvokeZero(AddressOf ZeroArgs) = 71','Zero-argument callback has correct RET form');
 lines.push('InvokeVoid AddressOf SetCounter, 19');
 check('counter = 19','Sub callback returns after updating authored module state');
 check('InvokeLong(AddressOf Nested, 3) = 12','Nested same-thread native callbacks restore suspended VB error frames');
 check('PreserveRegisters(AddressOf Twice) = 1','External nonvolatile registers, ESP and x87 control word are preserved');
 lines.push('pointer = PointerValue(AddressOf Twice)');
 check('pointer = PointerValue(AddressOf Twice) And pointer <> 0','Repeated AddressOf binds to one stable relocated thunk');
 check('Forward(AddressOf Twice, 9) = 18','Function pointers can be forwarded through a ByVal Long procedure argument');
 lines.push('On Error Resume Next','Err.Raise 13','value = InvokeLong(AddressOf Handled, 3)');
 check('value = 6 And Err.Number = 13','Handled callback errors cannot overwrite the suspended caller Err state');
 lines.push('Err.Clear','On Error GoTo 0');
 check('InvokeLong(AddressOf Handled, 4) = 8','Callback recovers internally without jumping across DLL frames');
 lines.push('On Error Resume Next','Err.Raise 11','value = InvokeDouble(AddressOf AddDouble, 0.125)');
 check('Err.Number = 11','Successful floating callback also preserves outer Err');
 lines.push('Err.Clear','On Error GoTo 0','value = EnumWindows(AddressOf VisitWindow, 42)');
 check('windowsSeen > 0 And value = 0','Real user32 EnumWindows invokes callback and honors stop result');
 lines.push('For i = 1 To 2000','value = InvokeLong(AddressOf Nested,i)','Next');
 check('value = 8000','2000 nested stdcall callback cycles preserve return stack and state');
 lines.push('For i = 1 To 2000','value = InvokeLong(AddressOf Handled,i)','Next');
 check('value = 4000 And Err.Number = 0','2000 callback error/owned-local cleanup cycles leave caller usable');
 lines.push('ExitProcess 0');
 const p=newProject('AotCallbacks');p.startup='Sub Main';
 p.modules=[{id:'main',name:'MainModule',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function EnumWindows Lib "user32" (ByVal callback As Long, ByVal data As Long) As Long
Private Declare Function InvokeLong Lib "vb6-callback-probe.dll" (ByVal callback As Long, ByVal value As Long) As Long
Private Declare Function InvokeDouble Lib "vb6-callback-probe.dll" (ByVal callback As Long, ByVal value As Double) As Double
Private Declare Function InvokeSingle Lib "vb6-callback-probe.dll" (ByVal callback As Long, ByVal value As Single) As Single
Private Declare Function InvokeCurrency Lib "vb6-callback-probe.dll" (ByVal callback As Long, ByVal value As Currency) As Currency
Private Declare Function InvokeRefs Lib "vb6-callback-probe.dll" (ByVal callback As Long) As Long
Private Declare Sub InvokeVoid Lib "vb6-callback-probe.dll" (ByVal callback As Long, ByVal value As Long)
Private Declare Function InvokeZero Lib "vb6-callback-probe.dll" (ByVal callback As Long) As Long
Private Declare Function PointerValue Lib "vb6-callback-probe.dll" (ByVal callback As Long) As Long
Private Declare Function PreserveRegisters Lib "vb6-callback-probe.dll" (ByVal callback As Long) As Long
Private counter As Long
Private windowsSeen As Long
Private Function Twice(ByVal number As Long) As Long
 Twice = number * 2
End Function
Private Function Narrow(ByVal number As Long) As Integer
 Narrow = CInt(number)
End Function
Private Function Small(ByVal number As Long) As Byte
 Small = CByte(number)
End Function
Private Function Flag(ByVal number As Long) As Boolean
 Flag = CBool(number)
End Function
Private Function AddDouble(ByVal number As Double) As Double
 AddDouble = number + 1.5
End Function
Private Function AddSingle(ByVal number As Single) As Single
 AddSingle = number + CSng(1.25)
End Function
Private Function AddMoney(ByVal money As Currency) As Currency
 AddMoney = money + 0.0001@
End Function
Private Function AddDate(ByVal value As Date) As Date
 AddDate = DateAdd("d",1,value)
End Function
Private Function ChangeRefs(ByRef money As Currency, ByRef number As Double, ByRef count As Long) As Long
 money = money + 0.0001@
 number = number * 2
 count = count * 2
 ChangeRefs = 7
End Function
Private Function ZeroArgs() As Long
 ZeroArgs = 71
End Function
Private Sub SetCounter(ByVal value As Long)
 counter = value
End Sub
Private Function Nested(ByVal value As Long) As Long
 Nested = InvokeLong(AddressOf Twice,value) * 2
End Function
Private Function Forward(ByVal pointer As Long, ByVal value As Long) As Long
 Forward = InvokeLong(pointer,value)
End Function
Private Function Handled(ByVal value As Long) As Long
 Dim text As String, values() As Date
 On Error Resume Next
 text = "owned callback String"
 ReDim values(2)
 Err.Raise 11
 If Err.Number <> 11 Then ExitProcess 240
 Err.Clear
 Handled = value * 2
End Function
Private Function VisitWindow(ByVal hwnd As Long, ByVal data As Long) As Long
 If hwnd = 0 Or data <> 42 Then ExitProcess 241
 windowsSeen = windowsSeen + 1
 VisitWindow = 0
End Function
Public Sub Main()
${lines.join('\n')}
End Sub`}];
 return {project:p,checks};
}
export function callbackThreadFixture() {
 const p=newProject('AotCallbackThreadGuard');p.startup='Sub Main';
 p.modules=[{id:'main',name:'MainModule',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function InvokeOtherThread Lib "vb6-callback-probe.dll" (ByVal pointer As Long) As Long
Private Function WrongThread(ByVal value As Long) As Long
 ExitProcess 250
End Function
Sub Main()
 Dim result As Long
 result = InvokeOtherThread(AddressOf WrongThread)
 ExitProcess 251
End Sub`}];
 return {project:p,expectedExit:5};
}
export function writeCallbackFixtures(directory='validation/callbacks') {
 fs.mkdirSync(directory,{recursive:true});
 for(const make of [callbackFixture,callbackThreadFixture]) {
  const {project,checks=[],expectedExit=0}=make(),result=compileWin32(project);
  fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
  fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
  fs.writeFileSync(path.join(directory,project.name+'.build.json'),JSON.stringify({...result.report,checks,expectedExit,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
  console.log(project.name,checks.length,result.bytes.length);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeCallbackFixtures();
