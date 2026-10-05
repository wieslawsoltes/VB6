import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {compileWin32,extractNativeDeclarations} from '../src/native/compiler.js';
import {storageLayout} from '../src/native/storage.js';
import {nativeParameterBytes,REAL_TYPES,FLOAT_TYPES} from '../src/native/numeric.js';
import {nativeDateMethods} from '../src/native/dates.js';
import {dateFixture} from '../tools/win32-date-fixtures.mjs';
const project=(body,extra='')=>{const p=newProject('Dates');p.startup='Sub Main';p.modules=[{id:'dates',name:'Dates',kind:'module',code:`${extra}\nSub Main()\n${body}\nEnd Sub`}];return p;};
const compile=(body,extra)=>compileWin32(project(body,extra));
const compiler={fail:message=>{throw Error(message);}};
test('Date storage and ABI use eight bytes while remaining distinct from Double',()=>{
 assert.equal(storageLayout(compiler,{name:'d',type:'Date'},{optionBase:0}).nativeBytes,8);
 assert.equal(storageLayout(compiler,{name:'d',type:'Date'},{optionBase:0}).nativeElementBytes,8);
 assert.equal(nativeParameterBytes({type:'Date',byRef:false}),8);
 assert.equal(nativeParameterBytes({type:'Date',byRef:true}),4);
 assert.equal(nativeParameterBytes({type:'Date',bounds:[],byRef:true}),4);
 assert.equal(REAL_TYPES.has('date'),true);assert.equal(FLOAT_TYPES.has('date'),false);
});
for(const body of [
 'Dim d As Date\nd = #2024-02-29 06:00:00#',
 'Dim d As Date\nd = CDate(0.5)\nd = CDate(1@)\nd = CDate("2024-02-29")',
 'Dim d As Date, n As Long\nd = CDate(1)\nn = CInt(d)\nn = CBool(d)\nn = Len(d)',
 'Dim d As Date, s As String\ns = CStr(d)\ns = TypeName(d)\ns = CStr(Year(d))',
 'Dim a() As Date, b() As Date\nReDim a(-1 To 2)\na(0) = Now\nReDim Preserve a(-1 To 3)\nb = a\nErase a\nErase b',
 'Dim d(-2 To 2) As Date\nd(-1) = Date\nErase d',
 'Dim d As Date\nd = DateSerial(2024,3,0)\nd = TimeSerial(6,-15,0)',
 'Dim n As Long\nn = Year(Now)\nn = Month(Date)\nn = Day(Date)\nn = Hour(Time)\nn = Minute(Time)\nn = Second(Time)',
 'Dim n As Long\nn = Weekday(Now)\nn = Weekday(Now,0)\nn = IsDate("x")',
 'Dim d As Date\nd = DateValue(Now)\nd = TimeValue("06:00:00")',
 'Dim d As Date, n As Long\nFor d = CDate(1) To CDate(2) Step 0.5\n n = n + 1\nNext',
 'Dim s As Single\ns = Timer',
 'Dim d As Date\nOn Error Resume Next\nd = CDate(2958466)',
 'Dim d As Date\nd = Early\nd = Late',
])test('Date source compiles deterministically: '+body.split('\n').at(-1),()=>{
 const p=project(body,'Private Const Early As Date = #0100-01-01#\nPrivate Const Late As Date = #9999-12-31#'),before=JSON.stringify(p),result=compileWin32(p);
 assert.equal(JSON.stringify(p),before);assert.deepEqual(result.bytes,compileWin32(p).bytes);assert.equal(result.report.extraction,false);
});
test('Date source parameters and results preserve exact declared type',()=>{
 compile('Dim d As Date\nd = F(d)','Private Function F(ByRef value As Date) As Date\n F = value\nEnd Function');
 assert.throws(()=>compile('Dim d As Double\nd = F(d)','Private Function F(ByRef value As Date) As Date\n F = value\nEnd Function'),/exact declared type/);
});
test('external Date arguments and result are supported only under the scalar stdcall contract',()=>{
 const d=extractNativeDeclarations({name:'M',code:'Declare Function EchoDate Lib "probe" (ByVal value As Date, ByRef output As Date) As Date'}).declarations.get('echodate');
 assert.equal(d.returnType,'Date');assert.deepEqual(d.params.map(nativeParameterBytes),[8,4]);
 assert.throws(()=>extractNativeDeclarations({name:'M',code:'Declare Function EchoDate Lib "probe" (value() As Date) As Date'}),/Native Declare/);
 compile('Dim d As Date\nd = EchoDate(#2024-02-29#)','Declare Function EchoDate Lib "probe" (ByVal value As Date) As Date');
});
test('Date arrays cannot alias Double arrays despite identical element size',()=>{
 assert.throws(()=>compile('Dim d() As Date, f() As Double\nd = f'),/type/i);
 assert.throws(()=>compile('Dim d() As Double\nF d','Sub F(ByRef a() As Date)\nEnd Sub'),/exact declared element type/);
});
for(const code of ['CDate()','DateSerial(1,2)','TimeSerial(1,2,3,4)','Weekday()','Weekday(Now,1,2)','Year()','Now(1)','IsDate()'])test('Date builtin arity fails closed: '+code,()=>assert.throws(()=>compile('Dim d As Date\nd = '+code),/argument/));
test('Date array quota uses eight-byte elements',()=>{
 assert.throws(()=>compile('Dim a(0 To 131072) As Date'),/one MiB/);
});
test('Date literal conversion preserves absolute negative fractions and range endpoints',()=>{
 const c={fail:compiler.fail,floatLiteral:n=>n};
 assert.equal(nativeDateMethods.dateLiteral.call(c,new Date(1899,11,29,6)), -1.25);
 assert.throws(()=>nativeDateMethods.dateLiteral.call(c,new Date(NaN)),/literal/);
});
test('Date builtins do not shadow user variables or functions',()=>{
 compile('Dim Now As Long\nNow = 3\nDim n As Long\nn = Now');
 compile('Dim n As Long\nn = Year(3)','Function Year(ByVal n As Long) As Long\n Year = n\nEnd Function');
});
test('complete Date runtime fixture lowers without mutating its source',()=>{
 const {project:p,checks}=dateFixture(),before=JSON.stringify(p),result=compileWin32(p);
 assert.ok(checks.length>=60);assert.equal(JSON.stringify(p),before);assert.deepEqual(result.bytes,compileWin32(p).bytes);
 for(const symbol of ['VarDateFromR8','VarDateFromCy','VarDateFromStr','VarBstrFromDate','VariantTimeToSystemTime','GetCalendarInfoW','GetLocalTime'])assert.ok(result.report.imports.some(i=>i.symbol===symbol),symbol);
});


test('independent Date ABI/calendar fixture builds without invoking a foreign compiler',async()=>{
 const {dateABIFixture}=await import('../tools/win32-date-abi-fixtures.mjs');
 const {project:p,checks}=dateABIFixture(),before=JSON.stringify(p),result=compileWin32(p);
 assert.ok(checks.length>=20);assert.equal(JSON.stringify(p),before);
 assert.deepEqual(result.bytes,compileWin32(p).bytes);
 assert.ok(result.report.imports.some(i=>i.symbol==='EchoDate'));
});

test('IsDate evaluates non-Date scalar arguments once without numeric date coercion',()=>{
 for(const type of ['boolean','long','double','single','currency']){
  const seen=[],x={value:n=>seen.push(n)};
  const c={x,type:()=>type,expression:n=>seen.push(n),variable:()=>null,resolveProcedure:()=>null,fail:compiler.fail};
  const input={kind:'id',name:'value'},call={kind:'call',callee:{kind:'id',name:'IsDate'},args:[input]};
  assert.equal(nativeDateMethods.dateBuiltin.call(c,call,'isdate'),true);
  assert.deepEqual(seen,[input,0]);
 }
});
