import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject,compileModule} from '../src/language/compiler.js';
import {logicalLines} from '../src/language/lexer.js';
import {parseForHeader,loopVariable,parseFileStatement,parseComputedBranch,parseLabel} from '../src/language/statement-headers.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileWin32} from '../src/native/compiler.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../src/language/diagnostics.js';
const module=(code,name='M',kind='module')=>({id:name,name,kind,code});
const project=(...modules)=>({schema:1,name:'StatementHeaders',startup:'Sub Main',modules});
async function run(code,...modules){const p=compileProject(project(module(code),...modules));assert.deepEqual(p.diagnostics,[]);const output=[];const vm=new VirtualMachine(p,{print:s=>output.push(s)});await vm.start();assert.notEqual(vm.state,'error');return {output,vm};}
const invalid=body=>assert.throws(()=>compileModule(module('Sub Main\n'+body+'\nEnd Sub')),e=>e.number===1002&&e.source==='M'&&e.line>1);

test('For delimiter tokens ignore strings, escaped names, member names, and nested arguments',()=>{
  const p=parseForHeader('For [index] = F("1 To 9", [To]) To G("5 Step -1", obj.Step) Step H(1, 2)');
  assert.equal(p.name,'index');assert.equal(p.start.callee.name,'F');assert.equal(p.end.callee.name,'G');assert.equal(p.step.callee.name,'H');
});
test('structural loop identity distinguishes bracketed dots from member paths',()=>{
  assert.equal(loopVariable('[Count]').identity,loopVariable('cOuNt').identity);
  assert.notEqual(loopVariable('[a.b]').identity,loopVariable('a.b').identity);
});
for(const name of ['Żółć','[counter]','[True]'])test('numeric For and Next execute for '+name,async()=>{
  const {output}=await run(`Sub Main\nDim ${name} As Long\nFor ${name} = Val("3 To 99") To Val("1 Step 4") Step -1\nDebug.Print ${name}\nNext ${name}\nEnd Sub`);assert.deepEqual(output,['3','2','1']);
});
test('For evaluates both bounds and step once before the loop',async()=>{
  const {output}=await run('Dim calls As Long\nFunction Bound(ByVal n As Long) As Long\ncalls = calls + 1\nBound = n\nEnd Function\nSub Main\nDim i As Long\nFor i = Bound(1) To Bound(3) Step Bound(1)\nDebug.Print i\nNext\nDebug.Print calls\nEnd Sub');
  assert.deepEqual(output,['1','2','3','3']);
});
for(const name of ['Żółć','[entry]','[Empty]'])test('For Each escaped and Unicode iteration: '+name,async()=>{
  const {output}=await run(`Sub Main\nDim ${name} As Variant\nFor Each ${name} In Array(" In ", "done")\nDebug.Print ${name}\nNext ${name}\nEnd Sub`);assert.deepEqual(output,[' In ','done']);
});
test('multiple Next names normalize redundant brackets and preserve loop order',async()=>{
  const {output}=await run('Sub Main\nDim i As Long, j As Long\nFor [i] = 1 To 2\nFor j = 3 To 4\nDebug.Print i, j\nNext [j], i\nEnd Sub');assert.deepEqual(output,['1 3','1 4','2 3','2 4']);
});
for(const body of [
  'For i = 1 To 2\nFor [I] = 1 To 2\nNext\nNext',
  'For i = 1 To 2\nFor Each i In Array(1)\nNext\nNext',
  'For n(1) = 1 To 2\nNext', 'For i = 1\nNext', 'For i = To 2\nNext',
  'For i = 1 To 2 Step\nNext', 'For Each i Array(1)\nNext', 'For Each i In\nNext',
  'For i = 1 To 2\nNext j', 'For i = 1 To 2\nNext i,'
])test('invalid loop is source-located: '+body.split('\n')[0],()=>invalid(body));
test('native numeric loops consume canonical Unicode and redundantly escaped counters',()=>{
  const p=project(module('Sub Main\nDim Żółć As Long\nFor [Żółć] = 1 To 2\nNext Żółć\nEnd Sub'));
  const result=compileWin32(p);assert.equal(result.bytes[0],0x4d);assert.equal(result.bytes[1],0x5a);
});
test('Open grammar retains nested handle and record-length expressions',()=>{
  const p=parseFileStatement('Open F("x For Output As #9", 2) For Random Access Read Write Lock Write As #H(1, 2) Len = R(3, 4)');
  assert.equal(p.mode,'random');assert.equal(p.access,'read write');assert.equal(p.sharing,'lock write');
  assert.equal(p.path.callee.name,'F');assert.equal(p.handle.callee.name,'H');assert.equal(p.recordLength.callee.name,'R');
});
test('Len is not a record-length delimiter when it is the handle expression',()=>{
  const p=parseFileStatement('Open "x" For Output As Len("x")');assert.equal(p.handle.callee.name,'Len');assert.equal(p.recordLength,null);
});
for(const mode of ['Input','Output','Append','Binary','Random'])test('Open mode '+mode,()=>assert.equal(parseFileStatement(`Open "a For b As c Len = d" For ${mode} Shared As #1`).mode,mode.toLowerCase()));
for(const text of ['Open "x" As #1','Open "x" For Wrong As #1','Open "x" For Output Access Wrong As #1','Open "x" For Output Lock As #1','Open "x" For Output As','Open "x" For Random As #1 Len =','Get #1, x','Put #1, 2, 3','Seek #1,','Lock #1,','Unlock #1, 1 To','Input #1, 2','Line Input #1, a, b'])test('malformed file statement is diagnosed: '+text,()=>invalid(text));
for(const action of ['Get','Put'])test('record '+action+' retains commas in all three expressions',()=>{
  const p=parseFileStatement(`${action} #F(1, 2), G(3, 4), values(H(5, 6))`);
  assert.equal(p.handle.args.length,2);assert.equal(p.position.args.length,2);assert.equal(p.target.args[0].args.length,2);
});
test('Seek, Lock and Unlock parse only top-level delimiters',()=>{
  assert.equal(parseFileStatement('Seek #F(1, 2), G(3, 4)').position.args.length,2);
  const p=parseFileStatement('Lock #F(1, 2), G("1 To 9", 3) To H(4, 5)');
  assert.equal(p.start.callee.name,'G');assert.equal(p.end.callee.name,'H');
  assert.equal(parseFileStatement('Unlock #F(1, 2)').start,null);
});
const handleHelper='Function Handle(ByVal left As Long, ByVal right As Long) As Long\nHandle = left + right\nEnd Function\n';
test('binary Open/Get/Put/Seek/Lock execute with nested comma arguments and quoted keywords',async()=>{
  const {output}=await run(handleHelper+'Sub Main\nDim value As Long, result As Long\nvalue = 123456\nOpen "file For Output As #9" For Binary Access Read Write As #Handle(0, 1)\nPut #Handle(0, 1), CLng(1), value\nLock #Handle(0, 1), CLng(1) To CLng(4)\nUnlock #Handle(0, 1), CLng(1) To CLng(4)\nSeek #Handle(0, 1), CLng(1)\nGet #Handle(0, 1), , result\nDebug.Print result\nClose #Handle(0, 1)\nEnd Sub');assert.deepEqual(output,['123456']);
});
test('Print and Line Input execute with nested file handles without changing semicolon semantics',async()=>{
  const {output}=await run(handleHelper+'Sub Main\nDim text As String\nOpen "text For Input As #8" For Output As #Handle(0, 1)\nPrint #Handle(0, 1), "A,B"; " C"\nClose #Handle(0, 1)\nOpen "text For Input As #8" For Input As #Handle(0, 1)\nLine Input #Handle(0, 1), text\nDebug.Print text\nClose #Handle(0, 1)\nEnd Sub');assert.deepEqual(output,['A,B C']);
});
test('Write/Input nested file handles preserve CSV value quoting and target lists',async()=>{
  const {output}=await run(handleHelper+'Sub Main\nDim text As String, n As Long\nOpen "csv" For Output As #Handle(0, 1)\nWrite #Handle(0, 1), "A,B", 42\nClose #Handle(0, 1)\nOpen "csv" For Input As #Handle(0, 1)\nInput #Handle(0, 1), text, n\nDebug.Print text, n\nClose #Handle(0, 1)\nEnd Sub');assert.deepEqual(output,['A,B 42']);
});
for(const name of ['Obsłuż','[Next]'])test('GoSub/Return and GoTo resolve label '+name,async()=>{
  const {output}=await run(`Sub Main\nGoSub ${name}\nGoTo Koniec\n${name}:\nDebug.Print "called"\nReturn\nKoniec:\nEnd Sub`);assert.deepEqual(output,['called']);
});
test('On Error and Resume distinguish escaped Next from Resume Next',async()=>{
  const {output}=await run('Sub Main\nOn Error GoTo Błąd\nError 5\n[Next]:\nDebug.Print "resumed"\nExit Sub\nBłąd:\nDebug.Print Err.Number\nResume [Next]\nEnd Sub');assert.deepEqual(output,['5','resumed']);
});
test('computed branch ignores keyword text inside strings and nested calls',()=>{
  const p=parseComputedBranch('On F("GoSub", obj.GoTo, [GoTo]) GoTo Żółć, [Next], 10');
  assert.equal(p.gosub,false);assert.equal(p.expr.args.length,3);assert.deepEqual(p.labels,['Żółć','Next','10']);
});
test('computed GoSub with escaped/Unicode targets really returns',async()=>{
  const {output}=await run('Sub Main\nOn Val("2 GoTo 1") GoSub Żółć, [Next]\nExit Sub\nŻółć:\nDebug.Print "wrong"\nReturn\n[Next]:\nDebug.Print "right"\nReturn\nEnd Sub');assert.deepEqual(output,['right']);
});
for(const label of ['1.5','Name$','"label"','a.b','a, b',''])test('invalid branch label '+JSON.stringify(label),()=>assert.throws(()=>parseLabel(label),e=>e.number===1002));
test('bracketed label source lines survive continuation and colon splitting',()=>assert.deepEqual(logicalLines('[Next]: Debug.Print _\n 1'),[{text:'Next',line:1,label:true},{text:'Debug.Print  1',line:1}]));
test('Unicode default-member attribute enables actual default-property dispatch',async()=>{
  const c=module('Public Property Get Żółć() As Long\nAttribute Żółć.VB_UserMemId = 0\nŻółć = 42\nEnd Property','ValueBox','class');
  const {output}=await run('Sub Main\nDim v As New ValueBox\nDebug.Print CLng(v)\nEnd Sub',c);assert.deepEqual(output,['42']);
});
test('new malformed statement diagnostics agree after a warm-cache edit',()=>{
  const p=project(module('Sub Main\nOpen "x" For Output As\nEnd Sub')),cache=new ProjectDiagnosticCache();
  const first=cache.check(diagnosticSnapshot(p)),second=cache.check(diagnosticSnapshot(p));
  assert.equal(first.valid,false);assert.deepEqual(first.diagnostics,second.diagnostics);assert.equal(first.diagnostics[0].line,2);
  p.modules[0].code='Sub Main\nOpen "x" For Output As #1\nEnd Sub';assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);
});
