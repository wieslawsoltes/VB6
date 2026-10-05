import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {DATE_INTERVAL_CONTRACTS,intervalProject,readIntervalRecords} from '../tools/win32-date-interval-reference.mjs';
const project=(body,extra='')=>{const p=newProject('DateIntervals');p.startup='Sub Main';p.modules=[{id:'main',name:'Main',kind:'module',code:extra+'\nSub Main()\n'+body+'\nEnd Sub'}];return p;};
const build=(expr,extra)=>compileWin32(project('Dim result As String\nresult = CStr('+expr+')',extra));
for(const expression of [
 'DateAdd("m", 1.5, #2024-01-31#)', 'DateAdd("s", "1", CDate(-1.25))',
 'DateDiff("ww", #2023-12-31#, #2024-01-01#, vbMonday, vbFirstFourDays)',
 'DatePart("y", #2024-12-31#)', 'DatePart("w", Now, vbUseSystem)',
 'FormatDateTime(Now, vbGeneralDate)', 'FormatDateTime(Now, vbLongDate)',
 'FormatDateTime(Now, vbShortDate)', 'FormatDateTime(Now, vbLongTime)',
 'FormatDateTime(Now, vbShortTime)',
 'DateAdd(date := Now, number := 1, interval := "m")',
 'DateDiff(date2 := Now, date1 := Date, interval := "s", firstweekofyear := 1)',
 'DatePart("ww", Now, , vbFirstFullWeek)', 'FormatDateTime(namedformat := 4, date := Time)'
])test('native interval source: '+expression,()=>{
 const p=project('Dim result As String\nresult = CStr('+expression+')'),before=JSON.stringify(p),a=compileWin32(p),b=compileWin32(p);
 assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(p),before);assert.equal(a.report.extraction,false);
 assert.ok(a.report.sourceMap.every(item=>item.source==='Main'));
 assert.ok(a.report.imports.every(item=>!/(vbscript|msvbvm|mscoree|vb6intrinsic)/i.test(item.dll)));
});
for(const expr of ['DateAdd("d", 1)','DateDiff("d", Now)','DatePart()','FormatDateTime()','DatePart("d", Now, 1, 1, 1)','FormatDateTime(Now, 1, 1)','DateAdd(date := Now, number := 1, wrong := "d")'])test('invalid interval call shape: '+expr,()=>assert.throws(()=>build(expr),/argument/i));
test('private native calendar scope cannot see user intrinsic shadows',()=>{
 const p=project('Dim value As Date\nvalue = DateAdd("m", 1, #2024-01-31#)', 'Public CDate As Long\nPublic Year As Long\nPublic IntervalIndex As Long\nPublic DateSerial As Long');
 assert.doesNotThrow(()=>compileWin32(p));
});
test('internal module name collision does not mutate or shadow user modules',()=>{
 const p=project('Dim value As Date\nvalue = DateAdd("m", 1, #2024-01-31#)');
 p.modules.push({id:'collision',name:'VB6NativeCalendar',kind:'module',code:'Public marker As Long'});
 const before=JSON.stringify(p);assert.doesNotThrow(()=>compileWin32(p));assert.equal(JSON.stringify(p),before);
});
test('Date interval builtins do not shadow explicitly declared project functions',()=>{
 for(const name of ['DateAdd','DateDiff','DatePart','FormatDateTime']) {
  const result=build(name+'(1)',`Function ${name}(ByVal n As Long) As Long\n ${name} = n\nEnd Function`);
  assert.ok(!result.report.imports.some(i=>i.symbol==='VarFormatDateTime'));
 }
});
test('Date interval helpers are absent when not used',()=>{
 const r=build('Year(Now)');assert.ok(!r.report.imports.some(i=>i.symbol==='VarFormat'));
});
test('reference covers every interval, bounds, week convention, errors and UTF-16 formatting',()=>{
 assert.ok(DATE_INTERVAL_CONTRACTS.length>2000);
 for(const name of ['DateAdd','DateDiff','DatePart','FormatDateTime'])assert.ok(DATE_INTERVAL_CONTRACTS.some(c=>c.expression.startsWith(name+'(')));
 assert.ok(DATE_INTERVAL_CONTRACTS.some(c=>c.expression.includes('ChrW(0)')));
 const records=DATE_INTERVAL_CONTRACTS.map((c,i)=>`${i}|${c.kind}|${c.kind==='string'?'004101050000':c.kind==='date'?'1.25':'1'}`).join('\n');
 const parsed=readIntervalRecords(records);assert.equal(parsed.length,DATE_INTERVAL_CONTRACTS.length);
 assert.equal(parsed.find(c=>c.kind==='string').value,'Aą\0');
 assert.throws(()=>readIntervalRecords('0|date|1'),/Incomplete/);
 assert.throws(()=>readIntervalRecords(records.replace('0|date|1.25','1|date|1.25')),/order/);
});
test('every independent reference expression is accepted by native code generation',()=>{
 for(let i=0;i<DATE_INTERVAL_CONTRACTS.length;i+=80){
  const records=DATE_INTERVAL_CONTRACTS.slice(i,i+80).map((r,index)=>({...r,index:i+index,outcome:'error',value:5}));
  const result=compileWin32(intervalProject(records));assert.equal(result.bytes[0],77);
 }
});

test('independent reference applies the same Long destination conversion without dropping wide DateDiff cases',async()=>{
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const {writeIntervalReference}=await import('../tools/win32-date-interval-reference.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-interval-reference-'));
 try {
  writeIntervalReference(dir);const source=fs.readFileSync(path.join(dir,'interval-reference.vbs'),'utf8');
  const diff='DateDiff("s", DateSerial(100,1,1), DateSerial(9999,12,31))';
  assert.ok(DATE_INTERVAL_CONTRACTS.some(c=>c.expression===diff));
  assert.ok(source.includes('result = CLng('+diff+')\r\nsavedError = Err.Number'));
  assert.ok(source.includes('result = DateAdd("yyyy", -2.5, DateSerial(100,1,1))'));
  assert.equal((source.match(/savedError = Err.Number/g)||[]).length,DATE_INTERVAL_CONTRACTS.length);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('malformed out-of-range records remain errors and name the failed reference index',()=>{
 const records=DATE_INTERVAL_CONTRACTS.map((c,i)=>`${i}|${c.kind}|${c.kind==='string'?'':c.kind==='date'?'1.25':'1'}`);
 const index=DATE_INTERVAL_CONTRACTS.findIndex(c=>c.kind==='long');records[index]=`${index}|long|3913228800`;
 assert.throws(()=>readIntervalRecords(records.join('\n')),new RegExp('Out-of-range reference at '+index));
});
test('native differential batches record every actual result, not only the first failed expression',()=>{
 const records=DATE_INTERVAL_CONTRACTS.slice(0,3).map((r,index)=>({...r,index:100+index,outcome:'date',value:1}));
 const p=intervalProject(records),source=p.modules[0].code;
 assert.equal((source.match(/actualError = Err.Number/g)||[]).length,3);
 assert.ok(source.includes('Record "100|error|"'));assert.ok(source.includes('Record "102|date|"'));
 assert.ok(source.includes('ExitProcess firstFailure'));assert.ok(!source.includes('Then ExitProcess 1'));
 assert.ok(compileWin32(p).report.imports.some(i=>i.symbol==='WriteFile'));
});
