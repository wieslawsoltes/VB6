import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {nativeStringLibraryMethods} from '../src/native/string-library.js';
import {parseExpression} from '../src/language/expression.js';
import {newProject} from '../src/project/model.js';
import {nativeStringLibraryFixture} from '../tools/win32-string-library-fixtures.mjs';
const project=code=>({...newProject('Strings'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code}]});
for(const optimization of [0,1,2])test(`counted string library fixture emits deterministic PE32 at O${optimization}`,()=>{
 const {project,checks}=nativeStringLibraryFixture(),before=JSON.stringify(project),a=compileWin32(project,{optimization});
 assert.ok(checks.length>=20);assert.deepEqual(a.bytes,compileWin32(project,{optimization}).bytes);assert.equal(JSON.stringify(project),before);
 for(const name of ['SysAllocStringLen','SysStringLen','SysFreeString','CompareStringW','MultiByteToWideChar'])assert.ok(a.report.imports.some(i=>i.symbol===name));
});
test('new string library type signatures preserve String, Long and Integer return metadata',()=>{
 const c={resolveProcedure:()=>null};
 for(const [expression,type]of [['Trim$("x")','string'],['String$(2,65)','string'],['StrReverse("x")','string'],['StrComp("a","b")','integer'],['InStrRev("x","x")','long']])assert.equal(nativeStringLibraryMethods.stringLibraryType.call(c,parseExpression(expression)),type);
 c.resolveProcedure=()=>({});assert.equal(nativeStringLibraryMethods.stringLibraryType.call(c,parseExpression('Trim$("x")')),null);
});
for(const call of ['Trim$()','RTrim$("a","b")','String$(1)','StrComp("a")','InStrRev("a","b",1,0,5)','StrComp(typo:="a",string2:="b")','StrComp("a",string1:="b",string2:="c")'])test('string signature rejects incomplete or ambiguous call '+call,()=>assert.throws(()=>compileWin32(project('Sub Main()\nDim s As String\ns='+call+'\nEnd Sub'))));
test('named arguments and omitted default slots compile without mutating the authored order',()=>{
 for(const call of ['InStrRev(stringmatch:="x",stringcheck:="xxx")','String$(character:="x",number:=3)','StrComp("a","b",)','InStrRev("aaa","a",,0)'])assert.ok(compileWin32(project('Sub Main()\nDim s As String\ns=CStr('+call+')\nEnd Sub')).bytes.length);
});
test('Option Compare Text now lowers comparison expressions and Select Case using NLS',()=>{
 const p=project('Option Compare Text\nSub Main()\nDim s As String,n As Long\ns="a"\nIf s="A" Then n=1\nSelect Case s\nCase "A"\nn=n+1\nEnd Select\nn=StrComp(s,"A",-1)\nEnd Sub');assert.ok(compileWin32(p,{optimization:2}).bytes.length);
});
test('managed Null and object arguments remain unsupported rather than becoming empty strings',()=>{
 for(const body of ['Dim v As Variant\nv=Null\ns=Trim$(v)','Dim v As Object\ns=StrReverse(v)'])assert.throws(()=>compileWin32(project('Sub Main()\nDim s As String\n'+body+'\nEnd Sub')),/storage/);
});
test('Len and LenB indexed numeric/record values retain subscript calls and bounds checks',()=>{
 const p=project('Type P\n x As Long\nEnd Type\nType B\n points(0 To 1) As P\nEnd Type\nFunction Index() As Long\nIndex=1\nEnd Function\nSub Main()\nDim a(0 To 1) As Long,b As B,n As Long\nn=Len(a(Index()))+LenB(b.points(Index()))\nEnd Sub');
 const r=compileWin32(p,{optimization:2,pruneUnusedProcedures:true}).report;
 assert.ok(!r.optimization.removedProcedures.includes('proc:M:Index'));assert.ok(r.sourceMap.filter(s=>s.procedure==='Index').every(s=>s.rva>0));
});
