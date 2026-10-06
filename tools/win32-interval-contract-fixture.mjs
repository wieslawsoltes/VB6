/** Hand-authored language/API invariants complement the external date oracle.
 * No expected result is calculated by the native calendar emitter. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
export function intervalContractFixture() {
 const checks=[],code=['Dim value As Date, result As Date, i As Long, text As String, actualError As Long'];
 const check=(expr,label)=>{checks.push(label);code.push(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
 const failure=(statement,label)=>{code.push('On Error Resume Next','Err.Clear',statement,'actualError = Err.Number','Err.Clear','On Error GoTo 0');check('actualError = 5',label);};
 code.push('value = #2024-01-31#');
 check('DateAdd("m",1,value) = #2024-02-29#','Leap-year end-of-month clamp');
 check('DateAdd("m",-1,#2024-03-31#) = #2024-02-29#','Backward end-of-month clamp');
 check('DateAdd("q",1,value) = #2024-04-30#','Quarter addition clamps April day');
 check('DateAdd("yyyy",1.5,value) = #2026-01-31#','Positive half count rounds to nearest even');
 check('DateAdd("yyyy",-1.5,value) = #2022-01-31#','Negative half count rounds to nearest even');
 check('DateAdd("yyyy",2.5,value) = #2026-01-31#','Even half count is not always rounded away from zero');
 check('DateAdd("s",2147483648#,value) = #2092-02-18 03:14:08#','Double interval count does not wrap at signed Long maximum');
 check('DateDiff("w",#2024-01-01#,#2024-01-07#) = 0 And DateDiff("ww",#2024-01-01#,#2024-01-07#) = 1','Elapsed and calendar weeks are distinct');
 check('DatePart("w",#2024-01-01#,vbSunday) = 2 And DatePart("w",#2024-01-01#,vbMonday) = 1','Weekday numbering follows the requested first day');
 check('DateDiff("d",#2024-01-01#,#2024-01-02#,-1,4) = 1 And DatePart("d",value,-1,4) = 31','Non-week units ignore otherwise invalid week flags');
 check('DateAdd("d",0,CDate(-1.999999)) = CDate(0)','Subsecond rounding carries over Automation negative-day discontinuity');
 check('DateAdd("h",1,CDate(-0.000001)) = TimeSerial(1,0,0)','DateAdd components use consistent whole-second rounding');
 code.push('result = value');failure('result = DateAdd("yyyy",2147483647,value)','Huge year addition reports an invalid date instead of wrapped year');
 check('result = value','Failed DateAdd preserves assignment target');
 failure('result = DateAdd("m" & ChrW(0),1,value)','Full interval tokens reject embedded NUL suffixes');
 check('result = value','Invalid interval leaves the target unchanged');
 for(let format=0;format<5;format++)check(`Len(FormatDateTime(#0100-01-01#,${format})) > 0`,'Windows Automation formats valid year 100 in mode '+format);
 code.push('For i = 1 To 2000',' result = DateAdd("m",1,value)',' text = FormatDateTime(result,vbShortDate)','Next');
 check('result = #2024-02-29# And Len(text) > 0 And i = 2001','Repeated calendar and owned formatting results remain usable');
 code.push('ExitProcess 0');
 const p=newProject('AotIntervalContract');p.startup='Sub Main';p.modules=[{id:'main',name:'Main',kind:'module',code:'Option Explicit\nPrivate Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)\nSub Main()\n'+code.join('\n')+'\nEnd Sub'}];
 return {project:p,checks};
}
export function writeIntervalContractFixture(directory='validation/interval-contract') {
 const {project,checks}=intervalContractFixture(),result=compileWin32(project);fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
 fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'interval-contract-build.json'),JSON.stringify({...result.report,checks,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
 console.log(`${project.name}: ${checks.length} assertions; ${result.bytes.length} bytes`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeIntervalContractFixture();
