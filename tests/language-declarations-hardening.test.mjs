import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDeclarations,parseParameters,compileModule,compileProject} from '../src/language/compiler.js';
import {parseProcedureHeader} from '../src/language/declarations.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../src/language/diagnostics.js';
import {VirtualMachine} from '../src/runtime/vm.js';

const module=(name,code)=>({id:name,name,kind:'module',code});
const project=(...modules)=>({name:'Declarations',startup:'Sub Main',modules});
async function run(p){const c=compileProject(p);assert.deepEqual(c.diagnostics,[]);const output=[];await new VirtualMachine(c,{print:s=>output.push(s)}).start();return output;}
for(const [source,type] of [['[True] As Long','Long'],['zażółć As String','String'],['n&','Long'],['[Then]() As Variant','Variant'],['item As Lib.Record','Lib.Record']])
  test('declaration supports '+source,()=>assert.equal(parseDeclarations(source)[0].type,type));
test('balanced array bounds preserve nested calls and quoted To text',()=>{const [d]=parseDeclarations('a(InStr(" To ", " To ") To UBound(Array(1, 2)), 3) As Long');assert.equal(d.bounds.length,2);assert.equal(d.bounds[0][0].kind,'call');assert.equal(d.bounds[0][1].kind,'call');});
test('all sixty VB array dimensions parse and the sixty-first is diagnosed',()=>{assert.equal(parseDeclarations('a('+Array(60).fill('1').join(',')+')')[0].bounds.length,60);assert.throws(()=>parseDeclarations('a('+Array(61).fill('1').join(',')+')'),/60 dimensions/);});
for(const source of ['a(1,','a As','a As A..B','n& As String','n As Long * 3','s As String * 0','s As String * 65536','n As New Long','WithEvents n As Long','WithEvents a() As Object','WithEvents a As New Thing'])
  test('invalid declaration is diagnosed: '+source,()=>assert.throws(()=>parseDeclarations(source),e=>e.number===1002));
for(const source of ['Optional a As Long, ParamArray rest()','ByVal ParamArray rest()','ByRef ParamArray rest()','ParamArray ByRef rest()','ParamArray a() As Long','ParamArray a() As Variant, b','a(1) As Long','WithEvents a As Object','ByVal ByRef a','Optional a, b','a As Long = 1'])
  test('invalid parameter signature is diagnosed: '+source,()=>assert.throws(()=>parseParameters(source),e=>e.number===1002));
test('ParamArray defaults to Variant despite a module Def-type directive',()=>assert.equal(parseParameters('ParamArray args()',{a:'Long'})[0].type,'Variant'));
test('escaped optional parameter names and default parentheses are preserved',()=>{const [p]=parseParameters('Optional ByVal [Then] As String = LeftValue');assert.equal(p.name,'Then');assert.equal(p.byRef,false);assert.equal(p.initial.name,'LeftValue');});
for(const header of ['Sub Main','Public Sub Main()','Static Sub Main','Private Static Sub Main'])test('parameterless procedure syntax: '+header,()=>{const p=parseProcedureHeader(header);assert.equal(p.name,'Main');assert.deepEqual(p.params,[]);});
test('parameterless functions and escaped names execute',async()=>assert.deepEqual(await run(project(module('M','Sub Main\nDebug.Print [True]()\nEnd Sub\nFunction [True] As Long\n[True] = 42\nEnd Function'))),['42']));
test('non-ASCII variable and procedure identifiers execute',async()=>assert.deepEqual(await run(project(module('M','Sub Main\nDim wartość As Long\nwartość = Żółć(4)\nDebug.Print wartość\nEnd Sub\nFunction Żółć(ByVal liczba As Long) As Long\nŻółć = liczba + 3\nEnd Function'))),['7']));
for(const header of ['Sub S() As Long','Sub S$()','Property Let V(ByVal n As Long) As Long','Property Get V() As String * 2','Function F&() As String','Function F() As Decimal'])
  test('invalid procedure return syntax: '+header,()=>assert.throws(()=>parseProcedureHeader(header),e=>e.number===1002));
test('Friend procedures are rejected in standard modules',()=>assert.throws(()=>compileModule(module('M','Friend Sub S()\nEnd Sub')),/Friend/));
test('Optional Object defaults support Nothing',async()=>assert.deepEqual(await run(project(module('M','Sub Main\nDebug.Print MissingObject()\nEnd Sub\nFunction MissingObject(Optional ByVal value As Object = Nothing) As Boolean\nMissingObject = value Is Nothing\nEnd Function'))),['True']));
test('Optional project-class defaults support Nothing',async()=>assert.deepEqual(await run(project(module('M','Sub Main\nDebug.Print MissingObject()\nEnd Sub\nFunction MissingObject(Optional ByVal value As Thing = Nothing) As Boolean\nMissingObject = value Is Nothing\nEnd Function'),{...module('Thing','Public Value As Long'),kind:'class'})),['True']));
for(const decl of ['Optional a As Integer = 32768','Optional a As Object = 0','Optional a As Long = Nothing'])test('invalid typed optional default: '+decl,()=>assert.equal(compileProject(project(module('M',`Sub F(${decl})\nEnd Sub`))).valid,false));
test('qualified enum declarations and returns get Long storage',async()=>{
  const p=project(module('Types','Public Enum State\nReady = 7\nEnd Enum'),module('M','Sub Main\nDim s As Types.State\ns = GetState()\nDebug.Print s, VarType(s)\nEnd Sub\nFunction GetState As Types.State\nGetState = Ready\nEnd Function'));
  assert.deepEqual(await run(p),['7 3']);
});
test('private qualified enum types cannot leak between modules',()=>assert.equal(compileProject(project(module('Types','Private Enum State\nReady = 7\nEnd Enum'),module('M','Dim s As Types.State'))).valid,false));
test('stable module IDs retain diagnostic ASTs when modules are reordered',()=>{
  const cache=new ProjectDiagnosticCache(),p=project(module('A','Private Const X = 1'),module('B','Private Const X = 2'));
  cache.check(diagnosticSnapshot(p));p.modules.reverse();assert.deepEqual(cache.check(diagnosticSnapshot(p)).stats,{compiledModules:0,cacheHits:2,totalModules:2});
});
test('duplicate module IDs use isolated positional cache entries',()=>{
  const cache=new ProjectDiagnosticCache(),p=project({...module('A','Private Const X = 1'),id:'same'},{...module('B','Private Const X = 2'),id:'same'});
  cache.check(diagnosticSnapshot(p));p.modules.reverse();const result=cache.check(diagnosticSnapshot(p));assert.equal(result.stats.compiledModules,2);assert.equal(cache.entries.size,2);assert.equal(result.valid,true);
});
test('constant indexes refresh after a dependency changes despite cache hits',()=>{
  const cache=new ProjectDiagnosticCache(),p=project(module('A','Public Const N = 5'),module('B','Private Const X = N'));
  assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);p.modules[0].code='Private Const N = 5';const result=cache.check(diagnosticSnapshot(p));assert.equal(result.stats.cacheHits,1);assert.equal(result.valid,false);assert.match(result.diagnostics[0].message,/Constant not defined/);
});
test('fixed string lengths bind module and procedure constants',async()=>assert.deepEqual(await run(project(module('M','Private Const Width = 6\nPrivate Text As String * Width\nSub Main\nConst LocalWidth = 3\nDim s As String * (LocalWidth + 1)\ns = "abcdef"\nDebug.Print Len(Text), Len(s), s\nEnd Sub'))),['6 4 abcd']));
test('fixed string lengths bind forward constants and UDT fields',async()=>assert.deepEqual(await run(project(module('M','Private Type Record\nName As String * WIDTH\nEnd Type\nPrivate Const WIDTH = 4\nSub Main\nDim value As Record\nvalue.Name = "abcdef"\nDebug.Print Len(value.Name), value.Name\nEnd Sub'))),['4 abcd']));
test('cached fixed string lengths rebind when an imported constant changes',()=>{
  const cache=new ProjectDiagnosticCache(),p=project(module('A','Public Const WIDTH = 4'),module('B','Private Text As String * WIDTH'));
  assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);p.modules[0].code='Public Const WIDTH = 0';const result=cache.check(diagnosticSnapshot(p));assert.equal(result.stats.cacheHits,1);assert.equal(result.valid,false);assert.match(result.diagnostics[0].message,/Fixed string length/);
});
for(const expr of ['MissingLength','1 / 2','Len("abc")','0 + 0'])test('invalid fixed string length expression: '+expr,()=>assert.equal(compileProject(project(module('M','Private Text As String * '+expr))).valid,false));
test('symbolic fixed strings remain invalid procedure parameters',()=>assert.throws(()=>parseParameters('value As String * WIDTH'),/Invalid procedure parameter/));
test('optional imported object types can use Nothing defaults without constructing a host object',()=>assert.equal(compileProject(project(module('M','Sub F(Optional ByVal command As ADODB.Command = Nothing)\nEnd Sub'))).valid,true));
