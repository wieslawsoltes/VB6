import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';

export function dateFixture(){
  const p=newProject('AotDates');p.startup='Sub Main';const code=[],checks=[];
  const add=s=>code.push(s),check=(expr,label)=>{checks.push(label);add(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
  add('Dim d As Date, other As Date, value As Double, money As Currency, n As Long, total As Long, text As String\nDim times() As Date, copied() As Date\nDim fixed(-1 To 1) As Date');
  check('CDbl(d) = 0 And Year(d) = 1899 And Month(d) = 12 And Day(d) = 30','Date zero initialization is the OLE epoch');
  add('d = #2024-02-29 06:07:08#');
  check('Year(d) = 2024 And Month(d) = 2 And Day(d) = 29','Gregorian date literal fields');
  check('Hour(d) = 6 And Minute(d) = 7 And Second(d) = 8','date literal time fields');
  check('CDbl(#1899-12-29 06:00:00#) = -1.25','negative day uses the absolute fractional time');
  check('Hour(CDate(-1.25)) = 6 And Day(CDate(-1.25)) = 29','negative serial unpacking preserves civil time');
  check('Hour(CDate(-0.5)) = 12 And Day(CDate(-0.5)) = 30','negative zero-day aliases represent time on the epoch');
  check('CDbl(Epoch) = 0 And CDbl(Calendar.Leap) = 45351','private and qualified typed Date constants');
  check('VarType(d) = 7 And TypeName(d) = "Date" And Len(d) = 8 And LenB(d) = 8','Date semantic type and storage size');
  add('d = CDate(2)\nother = CDate(0.25)');
  check('CDbl(d + other) = 2.25 And VarType(d + other) = 7','Date addition has Date result');
  check('CDbl(d - other) = 1.75 And VarType(d - other) = 5','Date-Date subtraction returns Double');
  check('VarType(d - 1) = 7 And VarType(1 - d) = 7','Date mixed subtraction remains Date');
  check('d = 2 And d > 1 And d < 3 And 2 = d And 1 < d','Date comparisons use serial values in both operand orders');
  check('CDbl(d * 2) = 4 And d / 2 = 1 And d ^ 2 = 4','Date multiplicative operations use Double');
  check('CDbl(d + 0.0001@) = 2.0001 And CCur(d) = 2@','Currency and Date conversion does not use a pointer as a Long');
  check('CInt(CDate(2.5)) = 2 And CLng(CDate(3.5)) = 4 And CByte(CDate(255)) = 255','Date integer conversion uses checked nearest-even rounding');
  check('CBool(CDate(0.125)) And Not CBool(CDate(0))','fractional Date truth tests');
  add('total = 0\nFor d = CDate(1) To CDate(2) Step 0.25\n total = total + 1\nNext');
  check('total = 5','Date For uses a fractional step');
  add('d = CDate(-1.25)\nSelect Case d\nCase CDate(-1.25)\n total = 9\nCase Else\n total = 0\nEnd Select');
  check('total = 9','Date Select Case retains its type and snapshot');
  add('d = Mixed(3, #2024-02-29#, CSng(0.5), 1, "DATE")');
  check('d = #2024-03-03 12:00:00#','mixed stack widths preserve Date ByVal and return');
  add('d = #2024-02-29#\nother = d + Mutate(d)');
  check('other = #2024-03-01# And d = #2025-01-01#','left Date operands are immutable before later ByRef mutations');
  check('Forward(Calendar.Leap) = #2024-02-29#','qualified Date constant argument');
  add('d = Recursive(12, #2024-02-29#)');
  check('d = #2024-03-12#','recursive Date function results leave no live FPU stack');
  check('StaticNext() = CDate(1) And StaticNext() = CDate(2)','static Date storage persists');
  add('ReDim times(-2 To 1)\ntimes(-2) = #0100-01-01#\ntimes(1) = #9999-12-31#\nReDim Preserve times(-2 To 3)');
  check('times(-2) = #0100-01-01# And times(1) = #9999-12-31# And CDbl(times(3)) = 0','Date arrays retain endpoints and zero new elements on Preserve');
  add('copied = times\nChangeArray copied\nfixed(-1) = #2024-02-29#');
  check('times(1) = #9999-12-31# And copied(1) = #2024-02-29#','Date whole-array assignment copies storage');
  check('TypeName(times) = "Date()" And VarType(times) = 8199','VT_DATE arrays remain distinct from Double arrays');
  add('On Error Resume Next\nTouchLocked times(1)\nn = Err.Number\nErr.Clear\nOn Error GoTo 0');
  check('n = 10','Date ByRef elements lock the backing SAFEARRAY');
  add('ReDim times(0 To 2)\nErase copied\nErase fixed');
  check('CDbl(fixed(-1)) = 0 And LBound(fixed) = -1 And UBound(times) = 2','Date Erase and error unwind release element pins');
  add('d = #2024-02-29 06:00:00#\ntext = CStr(d)\nother = CDate(text)');
  check('other = d','date formatting round-trips through the Windows user locale');
  check('IsDate(text) And Not IsDate("not a date") And Not IsDate("") And Not IsDate(vbNullString)','IsDate handles valid and invalid text without raising');
  check('Not IsDate("2024-02-29" & ChrW(0) & "bad")','embedded NUL date text is not silently truncated');
  check('IsDate(CDate(-657434)) And IsDate(CDate(2958465.75)) And Not IsDate(-657435) And Not IsDate(2958466)','IsDate recognizes typed Dates but does not coerce numeric inputs');
  check('Not IsDate(True) And Not IsDate(False) And Not IsDate(1) And Not IsDate(1@) And Not IsDate(CDbl(1))','IsDate rejects Boolean and numeric types independently of value');
  check('DateValue(CDate(-1.25)) = CDate(-1) And TimeValue(CDate(-1.25)) = CDate(0.25)','DateValue/TimeValue strip negative serial parts correctly');
  check('DateValue("2024-02-29 06:00:00") = #2024-02-29# And TimeValue("2024-02-29 06:00:00") = CDate(0.25)','text date/time projection through Automation');
  check('Weekday(#2024-02-29#) = 5 And Weekday(#2024-02-29#,2) = 4','Weekday honors explicit first day');
  check('Weekday(#2024-02-29#,0) >= 1 And Weekday(#2024-02-29#,0) <= 7','Weekday zero obtains Windows NLS settings');
  check('DateSerial(2024,2,29) = #2024-02-29# And DateSerial(2023,2,29) = #2023-03-01#','DateSerial Gregorian leap normalization');
  check('DateSerial(2024,3,0) = #2024-02-29# And DateSerial(2024,13,1) = #2025-01-01#','DateSerial zero day and overflowing month');
  check('DateSerial(2024,0,1) = #2023-12-01# And DateSerial(2024,-12,1) = #2022-12-01#','DateSerial negative month floor division');
  check('DateSerial(99,13,1) = #0100-01-01# And DateSerial(101,0,1) = #0100-12-01#','DateSerial normalizes months before expanding a short year');
  check('DateSerial(10000,0,1) = #9999-12-01#','month normalization can first bring a large year back in range');
  check('DateSerial(2024,-32768,1) = DateSerial(2024,32767,32)','minimum Integer month retains legacy decrement wrapping');
  check('DateSerial(100,0,32) = DateSerial(99,12,32)','month-derived short years use the same current NLS window');
  check('DateSerial(2000,2,29) = #2000-02-29# And DateSerial(1900,2,29) = #1900-03-01#','Gregorian century exceptions');
  check('DateSerial(2024.5,2,29) = #2024-02-29#','DateSerial arguments use nearest-even Integer conversion');
  check('TimeSerial(6,-15,0) = #05:45:00# And TimeSerial(0,75,0) = #01:15:00#','TimeSerial normalizes minutes');
  check('CDbl(TimeSerial(24,0,0)) = 1 And CDbl(TimeSerial(12,0,0)) = 0.5','TimeSerial permits whole-day carry');
  check('VarType(Now) = 7 And VarType(Date) = 7 And VarType(Time) = 7 And VarType(Timer) = 4','clock getter result types');
  add('d = Now\nother = Date');
  check('Year(d) >= 2026 And Year(other) >= 2026 And CDbl(other) = Fix(CDbl(other))','native local date/time comes from the OS');
  check('Time >= CDate(0) And Time < CDate(1) And Timer >= 0 And Timer <= 86400','clock time values have the documented ranges');
  for(const [stmt,error,label]of [
    ['d = CDate(2958466)',6,'positive Date range overflow'],['d = CDate(-657435)',6,'negative Date range overflow'],
    ['d = CDate("invalid")',13,'date parse failure'],['d = #9999-12-31# + 1',6,'typed Date arithmetic overflow'],
    ['d = DateSerial(100,1,0)',5,'DateSerial final result out of range'],
    ['d = DateSerial(9999,13,-30)',5,'DateSerial invalid normalized year cannot be rescued by a negative day'],['d = DateSerial(40000,1,1)',6,'DateSerial Integer input overflow'],
    ['d = TimeSerial(40000,0,0)',6,'TimeSerial Integer input overflow'],['n = Weekday(#2024-02-29#,8)',5,'Weekday argument range'],
    ['d = ErrorDate()',13,'Date-returning error procedure unwinds before FPU use']]){
    add('d = #2024-02-29#\nOn Error Resume Next\nErr.Clear\n'+stmt+'\nn = Err.Number\nErr.Clear\nOn Error GoTo 0');check(`n = ${error}`,label);check('d = #2024-02-29#','failed Date operation does not overwrite the target: '+label);
  }
  add('For n = 1 To 2000\n d = Recursive(3, #2024-02-29#)\n ReDim times(0 To 1)\n times(1) = d\n copied = times\n Erase times\n Erase copied\nNext');
  check('d = #2024-03-03#','2000 Date call/array allocation/cleanup cycles');
  add('ExitProcess 0');
  p.modules=[{id:'dates',name:'Dates',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Const Epoch As Date = #1899-12-30#
Private backing() As Date
Private Function Mixed(ByVal a As Long, ByVal value As Date, ByVal b As Single, ByVal short As Integer, ByVal text As String) As Date
 If text <> "DATE" Or short <> 1 Then ExitProcess 240
 Mixed = value + a + b
End Function
Private Function Mutate(ByRef value As Date) As Date
 value = #2025-01-01#
 Mutate = CDate(1)
End Function
Private Function Forward(ByVal value As Date) As Date
 Forward = value
End Function
Private Function Recursive(ByVal level As Long, ByVal value As Date) As Date
 If level = 0 Then
  Recursive = value
 Else
  Recursive = Recursive(level-1, value + 1)
 End If
End Function
Private Function StaticNext() As Date
 Static value As Date
 value = value + 1
 StaticNext = value
End Function
Private Sub ChangeArray(ByRef a() As Date)
 a(1) = #2024-02-29#
End Sub
Private Sub EraseOwner(ByRef a() As Date, ByRef element As Date)
 Erase a
End Sub
Private Sub TouchLocked(ByRef element As Date)
 ' Pin the exact owner through a local array and its element.
 ReDim backing(0 To 1)
 EraseOwner backing, backing(1)
End Sub
Private Function ErrorDate() As Date
 Err.Raise 13
End Function
Public Sub Main()
${code.join('\n')}
End Sub`},{id:'calendar',name:'Calendar',kind:'module',code:'Public Const Leap As Date = #2024-02-29#'}];
  return {project:p,checks};
}
export function writeDateFixture(directory='validation/dates'){
 const {project,checks}=dateFixture(),result=compileWin32(project);fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
 fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'date-build.json'),JSON.stringify({...result.report,checks,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
 console.log(`${project.name}: ${checks.length} assertions; ${result.bytes.length} bytes`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeDateFixture();
