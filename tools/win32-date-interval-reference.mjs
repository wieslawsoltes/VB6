/** Fixed, reviewed expressions evaluated by the installed Windows Script Host.
 * Its records are independent expectations, never output from our date emitter. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
const cases=[];
const add=(expression,kind='long')=>cases.push({name:expression,expression,kind});
const intervals=['yyyy','q','m','y','d','w','ww','h','n','s'];
const dates=['DateSerial(100,1,1)','DateSerial(1899,12,29) + TimeSerial(6,0,0)','CDate(-1.25)','CDate(-0.25)','CDate(0)','CDate(0.75)','DateSerial(2024,1,31) + TimeSerial(12,34,56)','DateSerial(2024,2,29)','DateSerial(9999,12,31)'];
for(const interval of intervals)for(const date of dates)for(const n of [-2.5,-1.5,-1,-0.5,0,0.5,1,1.5,2.5])add(`DateAdd("${interval}", ${n}, ${date})`,'date');
for(const interval of intervals)for(const n of [-2147483648,2147483647,2147483648])add(`DateAdd("${interval}", ${n}, DateSerial(2024,1,31))`,'date');
for(const interval of intervals)for(const n of ['"1"','"-1.5"','"bad"','True'])add(`DateAdd("${interval}", ${n}, DateSerial(2024,1,31))`,'date');
const pairs=[
 ['CDate(-1.75)','CDate(-0.25)'],['CDate(-0.75)','CDate(0.25)'],['CDate(-1.25)','CDate(-1.75)'],
 ['DateSerial(2023,12,31)','DateSerial(2024,1,1)'], ['DateSerial(2024,1,1)','DateSerial(2024,1,7)'],
 ['DateSerial(2024,1,1)','DateSerial(2024,1,8)'],['DateSerial(2024,2,29)','DateSerial(2025,3,1)'],
 ['DateSerial(100,1,1)','DateSerial(9999,12,31)'], ['DateSerial(2024,1,1) + TimeSerial(23,59,59)','DateSerial(2024,1,2)'],
 ['DateSerial(2000,2,28)','DateSerial(2000,3,1)'], ['DateSerial(1900,2,28)','DateSerial(1900,3,1)'],
];
for(const interval of intervals)for(const [a,b]of pairs)for(const [first,last]of [[a,b],[b,a]])add(`DateDiff("${interval}", ${first}, ${last})`);
const weekDates=['DateSerial(1998,12,28)','DateSerial(1999,1,1)','DateSerial(2000,1,1)','DateSerial(2000,12,31)','DateSerial(2020,12,31)','DateSerial(2021,1,1)','DateSerial(2024,12,30)','DateSerial(100,1,1)','DateSerial(9999,12,31)'];
for(const date of weekDates)for(let fd=0;fd<=7;fd++)for(let fw=0;fw<=3;fw++) {
 add(`DatePart("ww", ${date}, ${fd}, ${fw})`);
 add(`DatePart("w", ${date}, ${fd}, ${fw})`);
 add(`DateDiff("ww", DateSerial(2024,1,1), ${date}, ${fd}, ${fw})`);
}
for(const interval of intervals)for(const date of dates)add(`DatePart("${interval}", ${date})`);
for(const date of dates)for(let format=0;format<=4;format++)add(`FormatDateTime(${date}, ${format})`,'string');
// Preserve and report unexpected type/coercion/range errors, including parameters
// that a legacy routine may intentionally ignore for non-week intervals.
for(const interval of ['""','"MM"','"YYYY"','"Ww"','"m "','"m" & ChrW(0)','"bad"','1']) {
 add(`DateAdd(${interval}, 1, CDate(1))`,'date');
 add(`DateDiff(${interval}, CDate(1), CDate(2))`);
 add(`DatePart(${interval}, CDate(1))`);
}
for(const interval of ['yyyy','d','w','ww'])for(const fd of [-1,8,32768])for(const fw of [-1,4,32768]) {
 add(`DatePart("${interval}", CDate(1), ${fd}, ${fw})`);
 add(`DateDiff("${interval}", CDate(1), CDate(2), ${fd}, ${fw})`);
}
for(const value of [-1,5,32768,'"1"','"bad"'])add(`FormatDateTime(CDate(0.25), ${value})`,'string');
// Date serials preserve subsecond fractions. Probe both sides of midnight and
// Automation's negative-day discontinuity independently of ordinary dates.
for(const number of [-1.999999,-1.000001,-0.000001,0.000001,0.999999,1.000001,45292.0000057,45292.0000059]) {
 for(const interval of ['d','h','n','s']) {
  add(`DateAdd("${interval}", 0, CDate(${number}))`,'date');
  add(`DateAdd("${interval}", 1, CDate(${number}))`,'date');
  add(`DateDiff("${interval}", CDate(0), CDate(${number}))`);
  add(`DatePart("${interval}", CDate(${number}))`);
 }
}
export const DATE_INTERVAL_CONTRACTS=Object.freeze(cases.map(Object.freeze));
export const CHUNK_SIZE=80;
export function writeIntervalReference(directory='validation/date-intervals') {
 fs.mkdirSync(directory,{recursive:true});
 const lines=['Option Explicit','Dim result, savedError','Function Encode(value)',' Dim i, n, text',' text = ""',' For i = 1 To Len(value)','  n = AscW(Mid(value, i, 1))','  If n < 0 Then n = n + 65536','  text = text & Right("0000" & Hex(n), 4)',' Next',' Encode = text','End Function','On Error Resume Next'];
 cases.forEach(({expression,kind},i)=>{
  lines.push('Err.Clear','result = '+expression,'savedError = Err.Number','If savedError <> 0 Then',` WScript.Echo "${i}|error|" & savedError`,'Else');
  if(kind==='string')lines.push(` WScript.Echo "${i}|string|" & Encode(CStr(result))`);
  else lines.push(` WScript.Echo "${i}|${kind}|" & Replace(CStr(CDbl(result)), ",", ".")`);
  lines.push('End If');
 });
 fs.writeFileSync(path.join(directory,'interval-reference.vbs'),lines.join('\r\n')+'\r\n');
}
export function readIntervalRecords(text) {
 const lines=String(text).replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 if(lines.length!==cases.length)throw Error(`Incomplete interval reference: ${lines.length} of ${cases.length}`);
 return lines.map((line,i)=>{
  const m=/^(\d+)\|(error|long|date|string)\|(.*)$/.exec(line.trim());
  if(!m||Number(m[1])!==i)throw Error('Invalid interval reference order: '+i);
  if(m[2]!=='error'&&m[2]!==cases[i].kind)throw Error('Unexpected interval reference type');
  let value;
  if(m[2]==='string'){
   if(!/^(?:[0-9A-Fa-f]{4})*$/.test(m[3]))throw Error('Invalid UTF-16 reference');
   value=(m[3].match(/.{4}/g)||[]).map(s=>String.fromCharCode(parseInt(s,16))).join('');
  }else{
   if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/i.test(m[3]))throw Error('Invalid numeric reference');
   value=Number(m[3]);
   if(!Number.isFinite(value)||m[2]==='error'&&(!Number.isInteger(value)||value<=0||value>65535)||m[2]==='long'&&(!Number.isInteger(value)||value< -2147483648||value>2147483647))throw Error('Out-of-range reference');
  }
  return {...cases[i],outcome:m[2],value,index:i};
 });
}
export function intervalProject(records,name='AotDateIntervals') {
 const code=['Dim numberResult As Long, dateResult As Date, textResult As String, actualError As Long'];
 const variable={long:'numberResult',date:'dateResult',string:'textResult'};
 records.forEach((r,i)=>{
  const v=variable[r.kind];
  code.push('On Error Resume Next','Err.Clear',v+' = '+r.expression,'actualError = Err.Number','Err.Clear','On Error GoTo 0',`If actualError <> ${r.outcome==='error'?r.value:0} Then ExitProcess ${i+1}`);
  if(r.outcome==='error')return;
  if(r.kind==='date')code.push(`If Abs(CDbl(${v}) - (${r.value})) > 0.000000001 Then ExitProcess ${i+1}`);
  else if(r.kind==='long')code.push(`If ${v} <> ${r.value} Then ExitProcess ${i+1}`);
  else code.push(`If ${v} <> "${r.value.replaceAll('"','""')}" Then ExitProcess ${i+1}`);
 });
 code.push('ExitProcess 0');
 const p=newProject(name);p.startup='Sub Main';p.modules=[{id:'main',name:'Main',kind:'module',code:'Option Explicit\nPrivate Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)\nSub Main()\n'+code.join('\n')+'\nEnd Sub'}];
 return p;
}
export function writeIntervalFixtures(directory='validation/date-intervals') {
 const records=readIntervalRecords(fs.readFileSync(path.join(directory,'interval-reference.txt'),'utf8')),programs=[];
 for(let offset=0;offset<records.length;offset+=CHUNK_SIZE){
  const subset=records.slice(offset,offset+CHUNK_SIZE),name='AotDateIntervals'+programs.length,p=intervalProject(subset,name),result=compileWin32(p);
  fs.writeFileSync(path.join(directory,name+'.vb6web'),JSON.stringify(p,null,2)+'\n');
  fs.writeFileSync(path.join(directory,name+'.exe'),result.bytes);
  fs.writeFileSync(path.join(directory,name+'.json'),JSON.stringify({...result.report,offset,checks:subset.map(r=>r.name),records:subset,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
  programs.push(name);
 }
 fs.writeFileSync(path.join(directory,'interval-programs.json'),JSON.stringify({reference:'installed Windows VBScript (not licensed VB6)',dateToleranceDays:1e-9,count:records.length,programs},null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 if(process.argv[2]==='--prepare')writeIntervalReference();else if(process.argv[2]==='--compile')writeIntervalFixtures();else throw Error('Use --prepare or --compile');
}
