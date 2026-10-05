import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';

/** Checks the Date representation across the named/optional call lowering, not
 * merely whether separately implemented Date and call examples can compile. */
export function dateCallFixture() {
  const project=newProject('AotDateCalls');project.startup='Sub Main';
  const lines=[],checks=[];
  const add=text=>lines.push(text);
  const check=(expr,name)=>{checks.push(name);add(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
  add('Dim d As Date, result As Date, numeric As Double, text As String, n As Long\nDim a() As Date');
  check('DefaultDate() = #2024-02-29 06:00:00#','typed optional ByVal Date uses its declaring module constant');
  check('DefaultDate = #2024-02-29 06:00:00#','implicit optional Date call preserves ST(0) result');
  check('Other.DefaultDate = #2000-01-01#','qualified implicit Date call has its own default scope');
  check('DateCopy() = #2024-02-29# And DateCopy() = #2024-02-29#','omitted ByRef Date resets after callee mutation');
  check('DateZero() = CDate(0) And DateZero() = CDate(0)','uninitialized optional Date is an independent eight-byte epoch');
  check('VarType(DateCopy()) = 7 And TypeName(DateCopy()) = "Date"','Date return semantic type survives optional argument materialization');
  add('d = #2024-02-29#\nresult = DateCopy(value:=d)');
  check('result = #2024-02-29# And d = #2025-01-01#','named exact-type Date ByRef aliases original storage');
  add('d = #2024-02-29#\nresult = DateCopy(value:=(d))');
  check('result = #2024-02-29# And d = #2024-02-29#','grouped named Date uses eight-byte writable copy without copy-back');
  check('DateCopy(#1899-12-29 06:00:00#) = CDate(-1.25)','literal Date receives writable storage without changing read-only bytes');
  check('DateCopy(CDate(1)+CDate(0.25)) = CDate(1.25)','Date expression snapshot becomes writable ByRef storage');
  add('numeric = -1.25\nresult = DateCopy((numeric))');
  check('CDbl(result) = -1.25 And numeric = -1.25','Double-to-Date isolated copy preserves negative serial bits and original Double');
  add('text = "2024-02-29 06:00:00"\nresult = DateCopy((text))');
  check('result = #2024-02-29 06:00:00# And text = "2024-02-29 06:00:00"','text-to-Date isolated copy uses conversion without text copy-back');
  check('Mixed() = #2024-03-01 12:00:00#','optional Date shares formal stack with Integer Currency Single Double String');
  check('Mixed(, , 0.25@, , 0.25, ) = #2024-03-01 12:00:00#','omitted interior and trailing Date-adjacent ABI slots');
  check('Mixed(label:="ok", extra:=0.25, stamp:=#2024-02-29#, count:=1, money:=0.25@, fraction:=CSng(0)) = #2024-03-01 12:00:00#','reordered named arguments retain distinct eight-byte Date/Currency slots');
  add('trace = 0\nresult = Order(right:=MarkDate(1), left:=MarkDate(2))');
  check('result = CDate(21) And trace = 12','named Date expressions evaluate once in written order, then formal order');
  add('d = CDate(2)\nresult = Order(d, ChangeActual(d))');
  check('result = CDate(23) And d = CDate(99)','ByVal Date snapshots survive later source mutations');
  check('Recursive(8) = #2024-03-08# And Recursive(8) = #2024-03-08#','recursive omitted Date defaults use independent caller frames');
  add('ReDim a(-1 To 1)\na(-1) = #2024-02-29#\nresult = DateCopy(a(-1))');
  check('result = #2024-02-29# And a(-1) = #2025-01-01#','Date element reference pins its owner and writes both words');
  add('a(-1) = #2024-02-29#\nresult = DateCopy((a(-1)))');
  check('result = #2024-02-29# And a(-1) = #2024-02-29#','grouped Date element is isolated from its SAFEARRAY owner');
  add('Call ResizeDates(stamp:=#2000-01-01#, values:=a)');
  check('UBound(a) = 2 And a(2) = #2000-01-01# And a(-1) = #2024-02-29#','named array and optional Date arguments preserve resize contents');
  add('ReDim backing(0 To 1)\nbacking(0) = CDate(4)\nOn Error Resume Next\nErr.Clear\nCall TwoDates(backing(0), GrowBacking())');
  check('Err.Number = 10','Date element pin prevents later argument evaluation from reallocating it');
  add('Err.Clear\nReDim backing(0 To 3)');
  check('Err.Number = 0 And UBound(backing) = 3','failed Date call releases pin before recovery');
  add('Err.Clear\nd = #2024-02-29#\nCall ChangeAndFail((d))');
  check('Err.Number = 11 And d = #2024-02-29#','callee error never copies a changed isolated Date back');
  add('Err.Clear\nresult = DateCopy((2958466#))');
  check('Err.Number = 6','ByRef Date temporary conversion rejects out-of-range input');
  add('Err.Clear\nresult = DateCopy(("bad date"))');
  check('Err.Number = 13','ByRef Date temporary rejects invalid text before callee execution');
  add('Err.Clear\nOn Error GoTo 0');
  check('Recover(#2024-02-29#) = #2000-01-01#','Date grouped calls recover through handler and Resume with correct error frame');
  add('For n = 1 To 2000\nresult = Recursive(4)\nresult = DateCopy((result))\nNext');
  check('result = #2024-03-04#','2000 recursive optional/grouped Date lifetimes finish with usable FPU stack');
  add('For n = 1 To 2000\nOn Error Resume Next\nCall ChangeAndFail((d))\nErr.Clear\nOn Error GoTo 0\nNext');
  check('d = #2024-02-29# And DefaultDate() = #2024-02-29 06:00:00#','2000 Date error unwinds preserve the source and subsequent return values');
  add('ExitProcess 0');
  project.modules=[{id:'entry',name:'Entry',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Const Seed As Date = #2024-02-29 06:00:00#
Private trace As Long
Private backing() As Date
Private Function DefaultDate(Optional ByVal value As Date = Seed) As Date
 DefaultDate = value
 value = #2025-01-01#
End Function
Private Function DateCopy(Optional ByRef value As Date = #2024-02-29#) As Date
 DateCopy = value
 value = #2025-01-01#
End Function
Private Function DateZero(Optional ByRef value As Date) As Date
 DateZero = value
 value = #2025-01-01#
End Function
Private Function Mixed(Optional ByVal count As Integer = 1, Optional ByVal stamp As Date = #2024-02-29#, Optional ByVal money As Currency = 0.25@, Optional ByVal fraction As Single = 0, Optional ByVal extra As Double = 0.25, Optional ByRef label As String = "ok") As Date
 If label <> "ok" Then ExitProcess 240
 label = "changed"
 Mixed = stamp + count + money + fraction + extra
End Function
Private Function MarkDate(ByVal value As Long) As Date
 trace = trace * 10 + value
 MarkDate = CDate(value)
End Function
Private Function Order(ByVal left As Date, Optional ByVal right As Date = #1899-12-30#) As Date
 Order = left * 10 + right
End Function
Private Function ChangeActual(ByRef value As Date) As Date
 value = CDate(99)
 ChangeActual = CDate(3)
End Function
Private Function Recursive(ByVal depth As Long, Optional ByRef value As Date = #2024-02-29#) As Date
 If depth = 0 Then
  Recursive = value
 Else
  Recursive = Recursive(depth-1) + 1
 End If
 value = #2000-01-01#
End Function
Private Sub ResizeDates(ByRef values() As Date, Optional ByVal stamp As Date = #2024-02-29#)
 ReDim Preserve values(-1 To 2)
 values(2) = stamp
End Sub
Private Sub TwoDates(ByRef first As Date, ByVal second As Date)
 ExitProcess 241
End Sub
Private Function GrowBacking() As Date
 ReDim backing(0 To 9)
 GrowBacking = CDate(0)
End Function
Private Sub ChangeAndFail(ByRef value As Date)
 value = #2000-01-01#
 Err.Raise 11
End Sub
Private Function Recover(ByVal value As Date) As Date
 On Error GoTo failed
 Call ChangeAndFail((value))
ready:
 Recover = value
 Exit Function
failed:
 value = #2000-01-01#
 Resume ready
End Function
Public Sub Main()
${lines.join('\n')}
End Sub`},{id:'other',name:'Other',kind:'module',code:`Private Const Seed As Date = #2000-01-01#
Public Function DefaultDate(Optional ByVal value As Date = Seed) As Date
 DefaultDate = value
End Function`}];
  return {project,checks};
}
export function writeDateCallFixture(directory='validation/dates') {
  const {project,checks}=dateCallFixture(),result=compileWin32(project);
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
  fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
  fs.writeFileSync(path.join(directory,'date-calls-build.json'),JSON.stringify({...result.report,checks,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
  console.log(`${project.name}: ${checks.length} assertions; ${result.bytes.length} bytes`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeDateCallFixture();
