import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
export function dateABIFixture(){
 const p=newProject('AotDateABI');p.startup='Sub Main';const code=[],checks=[];
 const add=s=>code.push(s),check=(expr,label)=>{checks.push(label);add(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
 add('Dim d As Date, other As Date, y As Long, m As Long, n As Long, value As Double, text As String');
 add('d = Probe.EchoDate(#2024-02-29 06:00:00#)');
 check('d = #2024-02-29 06:00:00#','independent C Date return uses ST0');
 check('EchoDate(CDate(-1.25)) = CDate(-1.25)','negative Date return preserves its raw representation');
 check('CDbl(EchoDate(CDate(-0.5))) = -0.5','negative zero-day alias is not silently canonicalized');
 check('EchoDate(#0100-01-01#) = #0100-01-01# And EchoDate(#9999-12-31#) = #9999-12-31#','minimum and maximum days survive foreign Date ABI');
 check('MixedDate(2, #2024-02-29#, CSng(0.5), 1) = #2024-03-03 12:00:00#','mixed 4/8-byte foreign argument slots');
 add('d = #2024-02-29#\nother = Probe.BumpDate(d)');
 check('d = #2024-03-01# And other = d','foreign ByRef mutation and Date return');
 add('Probe.ResetCalls');
 check('VarType(EchoDate(CDate(1))) = 7 And Calls() = 1','Date type query calls foreign function exactly once');
 check('TypeName(EchoDate(CDate(1))) = "Date" And Calls() = 2','Date name query calls foreign function exactly once');
 check('IsDate(EchoDate(CDate(1))) And Calls() = 3','IsDate evaluates foreign expression once');
 check('Year(DateSerial(0,1,1)) = ExpandedYear(0) And Year(DateSerial(29,1,1)) = ExpandedYear(29)','DateSerial obeys current Windows two-digit year window');
 check('Year(DateSerial(30,1,1)) = ExpandedYear(30) And Year(DateSerial(99,1,1)) = ExpandedYear(99)','DateSerial window upper half');
 check('Weekday(#2024-02-29#,0) = Weekday(#2024-02-29#,FirstDay())','Weekday system option follows independent NLS lookup');
 add('d = CDate(-1.25)');
 check('Year(d)=SystemPart(d,0) And Month(d)=SystemPart(d,1) And Day(d)=SystemPart(d,2)','negative day components match Windows conversion');
 check('Hour(d)=SystemPart(d,3) And Minute(d)=SystemPart(d,4) And Second(d)=SystemPart(d,5)','negative time components match Windows conversion');
 check('Weekday(d)=SystemPart(d,6)+1','negative weekday matches Windows SYSTEMTIME');
 add('text = CStr(#2024-02-29 06:00:00#)');
 check('CDate(text)=ParseDate(StrPtr(text),0)','user-locale string parsing matches Automation');
 check('DateValue(text)=ParseDate(StrPtr(text),2) And TimeValue(text)=ParseDate(StrPtr(text),1)','date/time-only parsing flags match Automation');
 // Independently convert valid Gregorian dates for all months in one 400-year cycle.
 add('For y = 1600 To 1999\nFor m = 1 To 12\n d = DateSerial(y,m,28)\n other = SystemDate(y,m,28,0,0,0)');
 check('d=other And Year(d)=y And Month(d)=m And Day(d)=28','4800 normalized Gregorian dates match Windows SYSTEMTIME conversion');
 add('Next\nNext');
 for(const [stmt,error,label]of [['d = InvalidDate()',6,'out-of-range foreign Date'],['d = NonfiniteDate()',6,'nonfinite foreign Date']]){
  add('d = #2024-02-29#\nOn Error Resume Next\nErr.Clear\n'+stmt+'\nn=Err.Number\nErr.Clear\nOn Error GoTo 0');
  check(`n=${error} And d=#2024-02-29#`,label+' is catchable and leaves target unchanged');
  check('EchoDate(CDate(0.25))=CDate(0.25)','FPU/error frame recovers after '+label);
 }
 add('For n = 1 To 2000\n d = EchoDate(#2024-02-29 12:00:00#)\n other = MixedDate(1,d,CSng(0.25),1)\nNext');
 check('other=#2024-03-02 18:00:00#','2000 independent Date ABI cycles');
 add('ExitProcess 0');
 p.modules=[{id:'main',name:'Main',kind:'module',code:'Option Explicit\nPrivate Declare Sub ExitProcess Lib "kernel32" (ByVal value As Long)\nSub Main()\n'+code.join('\n')+'\nEnd Sub'},
 {id:'probe',name:'Probe',kind:'module',code:`Option Explicit
Public Declare Function EchoDate Lib "vb6-date-probe.dll" (ByVal value As Date) As Date
Public Declare Function BumpDate Lib "vb6-date-probe.dll" (ByRef value As Date) As Date
Public Declare Function MixedDate Lib "vb6-date-probe.dll" (ByVal a As Long, ByVal value As Date, ByVal b As Single, ByVal c As Integer) As Date
Public Declare Function InvalidDate Lib "vb6-date-probe.dll" () As Date
Public Declare Function NonfiniteDate Lib "vb6-date-probe.dll" () As Date
Public Declare Function Calls Lib "vb6-date-probe.dll" () As Long
Public Declare Sub ResetCalls Lib "vb6-date-probe.dll" ()
Public Declare Function SystemDate Lib "vb6-date-probe.dll" (ByVal y As Long, ByVal m As Long, ByVal d As Long, ByVal h As Long, ByVal n As Long, ByVal s As Long) As Date
Public Declare Function SystemPart Lib "vb6-date-probe.dll" (ByVal d As Date, ByVal part As Long) As Long
Public Declare Function ExpandedYear Lib "vb6-date-probe.dll" (ByVal y As Long) As Long
Public Declare Function FirstDay Lib "vb6-date-probe.dll" () As Long
Public Declare Function ParseDate Lib "vb6-date-probe.dll" (ByVal text As Long, ByVal flags As Long) As Date`}];
 return {project:p,checks};
}
export function writeDateABIFixture(directory='validation/dates'){
 const {project,checks}=dateABIFixture(),result=compileWin32(project);fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
 fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'date-abi-build.json'),JSON.stringify({...result.report,checks,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
 console.log(`${project.name}: ${checks.length} assertions; ${result.bytes.length} bytes`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeDateABIFixture();
