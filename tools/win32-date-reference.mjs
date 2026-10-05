/** Differential test input is fixed source, never supplied by a project/user.
 * The reference is installed Windows VBScript, not the licensed VB6 compiler. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
export const DATE_CONTRACTS = [
 ...[[-1,0,0],[-24,0,0],[-25,0,0],[0,-1,0],[0,0,-1],[0,-75,0],[24,0,0],[25,0,0],[6,-15,0],[0,75,0],[32767,0,0],[-32768,0,0]].map(args=>['TimeSerial('+args.join(',')+')','CLng(CDbl(TimeSerial('+args.join(',')+')) * 86400)']),
 ...[-1.25,-0.5,0,1.25].flatMap(n=>['DateValue','TimeValue'].map(fn=>[fn+'('+n+')','CLng(CDbl('+fn+'(CDate('+n+'))) * 86400)'])),
 ['IsDate Boolean','CLng(IsDate(True))'],['IsDate Long','CLng(IsDate(1))'],['IsDate invalid text','CLng(IsDate("bad date"))'],
 ['Date addition type','VarType(CDate(1) + CDate(0.5))'],['Date difference type','VarType(CDate(1) - CDate(0.5))'],
 ['Date Int type','VarType(Int(CDate(-1.25)))'],['Date Fix type','VarType(Fix(CDate(-1.25)))'],['Date Abs type','VarType(Abs(CDate(-1.25)))'],
 ['Negative date ordering','CLng(CDate(-1.5) < CDate(-1.25))'],
 ['Normalized minimum','CLng(CDbl(DateSerial(100,0,32)))'],['Normalized maximum','CLng(CDbl(DateSerial(9999,13,-30)))'],
 ['Leap normalization','CLng(CDbl(DateSerial(1900,2,29)))'],['Negative month normalization','CLng(CDbl(DateSerial(2024,-12,1)))'],
 // Probe boundary normalization separately from the 4,800 ordinary dates. The
 // results stay independent input data; no native result is treated as its oracle.
 ...[-1,0,29,30,99,100,101,9999,10000].flatMap(y=>[-13,0,1,13].flatMap(m=>[-31,0,1,32].map(d=>[
   `DateSerial boundary (${y},${m},${d})`, `CLng(CDbl(DateSerial(${y},${m},${d})))`
 ]))),
 // Extend, never replace, the original 177 independent reference expressions.
 // Negative years and large month/day offsets exercise both normalization orders.
 ...[-32768,-2001,-2000,-1999,-1901,-1900,-1899,-101,-100,-99,49,50,32767].flatMap(y=>[-32768,0,1,13,32767].flatMap(m=>[-32768,1,32767].map(d=>[
   `DateSerial extended (${y},${m},${d})`, `CLng(CDbl(DateSerial(${y},${m},${d})))`
 ])))
];
export function writeReference(directory='validation/dates') {
 fs.mkdirSync(directory,{recursive:true});
 const lines=['Option Explicit','Dim result','On Error Resume Next'];
 DATE_CONTRACTS.forEach(([,expression],i)=>lines.push('Err.Clear','result = '+expression,'If Err.Number <> 0 Then',` WScript.Echo "${i}|error|" & Err.Number`,'Else',` WScript.Echo "${i}|value|" & result`,'End If'));
 fs.writeFileSync(path.join(directory,'date-reference.vbs'),lines.join('\r\n')+'\r\n');
}
export function compileReference(text) {
 const lines=String(text).replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 if(lines.length!==DATE_CONTRACTS.length)throw Error('Windows Script Host did not produce the complete Date reference');
 const p=newProject('AotDateReference');p.startup='Sub Main';const code=['Dim result As Long, n As Long, d As Date'],checks=[],records=[];
 lines.forEach((line,i)=>{
  const m=/^(\d+)\|(error|value)\|(-?\d+)$/.exec(line.trim());
  if(!m||Number(m[1])!==i||!Number.isSafeInteger(Number(m[3]))||Number(m[3])< -2147483648||Number(m[3])>2147483647)throw Error('Invalid or out-of-order native reference record');
  const [,expression]=DATE_CONTRACTS[i],value=Number(m[3]);
  records.push({name:DATE_CONTRACTS[i][0],expression,kind:m[2],value});checks.push(DATE_CONTRACTS[i][0]);
  if(m[2]==='error')code.push('On Error Resume Next','Err.Clear','result = '+expression,'result = Err.Number','Err.Clear','On Error GoTo 0');
  else code.push('result = '+expression);
  code.push(`If result <> ${value} Then ExitProcess ${i+1}`);
 });
 code.push('For n = 1 To 2000',' d = CDate(0.25)','Next','ExitProcess 0');
 p.modules=[{id:'main',name:'Main',kind:'module',code:'Option Explicit\nPrivate Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)\nSub Main()\n'+code.join('\n')+'\nEnd Sub'}];
 return {project:p,checks,records};
}
export function writeReferenceFixture(directory='validation/dates') {
 const {project,checks,records}=compileReference(fs.readFileSync(path.join(directory,'date-reference.txt'),'utf8'));
 const result=compileWin32(project);
 fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
 fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'date-reference-build.json'),JSON.stringify({...result.report,reference:'installed Windows VBScript; not licensed VB6',checks,records,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv[2]==='--prepare')writeReference();else if(process.argv[2]==='--compile')writeReferenceFixture();else throw Error('Use --prepare or --compile');
}
