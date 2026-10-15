import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../src/language/diagnostics.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {newProject,createControl} from '../src/project/model.js';
import {externalSymbolSnapshot} from '../src/language/symbol-snapshot.js';
const module=(name,code,kind='module',attributes=[])=>({id:name,name,code,kind,attributes});
const project=(body,extra=[])=>({name:'ReferenceChecks',startup:'Sub Main',modules:[module('M',`Option Explicit\nSub Main()\n${body}\nEnd Sub`),...extra]});
const check=p=>compileProject(p);
function good(p){const r=check(p);assert.deepEqual(r.diagnostics,[]);assert.equal(r.valid,true);return r;}
function bad(p,code,message){const r=check(p);assert.equal(r.valid,false);const matches=r.diagnostics.filter(d=>d.code===code);assert.ok(matches.length,JSON.stringify(r.diagnostics));if(message)assert.match(matches[0].message,message);return r;}
async function run(p){const output=[],program=good(p),vm=new VirtualMachine(program,{print:s=>output.push(s)});await vm.start();return {vm,output};}
const method=module('Helpers','Public Function Add(ByVal first As Long, Optional ByVal second As Long = 2) As Long\nAdd = first + second\nEnd Function');
const box=code=>module('Box',code,'class');
for(const body of ['missing = 1','Debug.Print missing','If False Then\nDebug.Print missing\nEnd If','Dim values() As Long\nReDim values(missing)','Debug.Assert missing','Select Case 1\nCase missing\nEnd Select','Open missing For Output As #1','Dim s As String\nMid(s, missing) = "x"','RaiseEvent MissingEvent'])test('undeclared reference rejected before execution: '+body.split('\n')[0],()=>{
  const result=bad(project(body),body.startsWith('RaiseEvent')?'VB_EVENT_NAME':'VB_UNDEFINED_NAME');assert.equal(result.diagnostics[0].source,'M');assert.ok(result.diagnostics[0].line>=3);
});
test('an uncalled procedure is still name-checked',()=>{const p=project('');p.modules[0].code+='\nPrivate Sub Unused\nDebug.Print typo\nEnd Sub';const r=bad(p,'VB_UNDEFINED_NAME');assert.equal(r.diagnostics[0].line,6);});
test('VM startup rejects invalid bound programs without executing host callbacks',async()=>{let started=0;const vm=new VirtualMachine(check(project('missing = 1')),{print:()=>started++});await assert.rejects(vm.start(),e=>e.number===1002);assert.equal(started,0);});
test('later declarations, type suffixes, implicit ReDim and return variables are in procedure scope',async()=>{
 const p=project('Debug.Print Twice(2)');p.modules[0].code+='\nFunction Twice(ByVal n As Long) As Long\nIf False Then\nDim total&\nEnd If\nReDim a(2) As Long\ntotal = n + n\na(0) = total\nTwice = a(0)\nEnd Function';assert.deepEqual((await run(p)).output,['4']);
});
test('scope precedence lets source names and local variables shadow intrinsics',async()=>{
 const p=project('Dim Add As Long\nAdd = 8\nDebug.Print Add\nDebug.Print Helpers.Add(3)',[method]);assert.deepEqual((await run(p)).output,['8','5']);
});
test('non-Explicit modules retain implicit variable semantics',async()=>{const p=project('notDeclared = 3\nDebug.Print notDeclared');p.modules[0].code=p.modules[0].code.replace('Option Explicit\n','');assert.deepEqual((await run(p)).output,['3']);});
test('public imports reject ambiguity instead of using module order',()=>{bad(project('Debug.Print Value',[module('A','Public Value As Long'),module('B','Public Value As Long')]),'VB_AMBIGUOUS_NAME');});
test('private source module fields are not unqualified imports',()=>{bad(project('Debug.Print Hidden',[module('Other','Private Hidden As Long')]),'VB_UNDEFINED_NAME');});
test('qualified calls and named optional arguments bind case-insensitively',async()=>{assert.deepEqual((await run(project('Debug.Print Helpers.Add(SECOND:=3, FIRST:=4)\nDebug.Print Add(5)',[method]))).output,['7','7']);});
for(const [expression,code] of [
 ['Add()','VB_ARGUMENT_REQUIRED'],['Add(, 2)','VB_ARGUMENT_REQUIRED'],['Add(1, 2, 3)','VB_ARGUMENT_COUNT'],
 ['Add(noSuch:=1)','VB_NAMED_ARGUMENT'],['Add(first:=1, first:=2)','VB_DUPLICATE_ARGUMENT'],
 ['Add(1, first:=2)','VB_DUPLICATE_ARGUMENT'],['Add(second:=2, 1)','VB_ARGUMENT_ORDER'],
 ['Add(ByVal 1)','VB_BYVAL_ARGUMENT'],
])test('source call validation: '+expression,()=>bad(project('Debug.Print '+expression,[method]),code));
test('source return values cannot use a Sub procedure',()=>bad(project('Debug.Print Work()',[module('H','Public Sub Work\nEnd Sub')]),'VB_SUB_VALUE'));
test('source Sub and Function calls can discard a return value',async()=>{const p=project('Helpers.Add 4\nWork',[method,module('H','Public Sub Work\nDebug.Print 9\nEnd Sub')]);assert.deepEqual((await run(p)).output,['9']);});
test('ParamArray accepts any positional tail and rejects all named arguments',async()=>{
 const helper=module('H','Public Function Size(ByVal first As Long, ParamArray args() As Variant) As Long\nSize = first + UBound(args) + 1\nEnd Function');
 assert.deepEqual((await run(project('Debug.Print Size(1, 2, 3)\nDebug.Print Size(1)',[helper]))).output,['3','1']);
 bad(project('Debug.Print Size(first:=1)',[helper]),'VB_NAMED_ARGUMENT');
});
test('declared external calls accept explicit ByVal without executing the DLL during compilation',()=>{
 good(project('Call Native(ByVal 3)',[module('H','Public Declare Sub Native Lib "not-loaded" (ByRef value As Long)')]));
});
test('Object and Variant callees remain late-bound',()=>{good(project('Dim obj As Object, value As Variant\nobj.Unavailable first:=1\nDebug.Print value.Unknown()'));});
test('array subscripts are not treated as procedure parameter lists',async()=>{assert.deepEqual((await run(project('Dim a(2) As Long\na(1) = 7\nDebug.Print a(1)'))).output,['7']);});
test('closed source classes reject unknown and inaccessible members',()=>{
 const cls=box('Private Hidden As Long\nPublic Value As Long');bad(project('Dim b As New Box\nDebug.Print b.Typo',[cls]),'VB_UNKNOWN_MEMBER');bad(project('Dim b As New Box\nb.Hidden = 3',[cls]),'VB_MEMBER_ACCESS');
});
test('source record member resolution retains declaring-module ownership',async()=>{
 const owner=module('A','Private Type Part\nValue As Long\nEnd Type\nPublic Type Whole\nChild As Part\nEnd Type');
 assert.deepEqual((await run(project('Dim x As A.Whole\nx.Child.Value = 9\nDebug.Print x.Child.Value',[owner,module('B','Public Type Part\nOther As Long\nEnd Type')]))).output,['9']);
 bad(project('Dim x As A.Whole\nx.Child.Typo = 9',[owner]),'VB_UNKNOWN_MEMBER');
});
test('enum namespaces are checked separately from record and module values',async()=>{
 const e=module('E','Public Enum Mode\nFirst = 7\nEnd Enum');assert.deepEqual((await run(project('Debug.Print Mode.First, E.First',[e]))).output,['7 7']);bad(project('Debug.Print Mode.Typo',[e]),'VB_UNKNOWN_MEMBER');
});
test('source constants cannot be assigned even in unreachable code',()=>bad(project('If False Then\nLimit = 8\nEnd If',[module('H','Public Const Limit = 4')]),'VB_CONSTANT_ASSIGNMENT'));
test('indexed Property Let/Set uses index arguments, not the final value parameter',async()=>{
 const cls=box('Private saved As Long\nPublic Property Get Value(ByVal index As Long) As Long\nValue = saved + index\nEnd Property\nPublic Property Let Value(ByVal index As Long, ByVal rhs As Long)\nsaved = rhs - index\nEnd Property');
 assert.deepEqual((await run(project('Dim b As New Box\nb.Value(index:=3) = 8\nDebug.Print b.Value(4)',[cls]))).output,['9']);
 bad(project('Dim b As New Box\nb.Value = 8',[cls]),'VB_ARGUMENT_REQUIRED');bad(project('Dim b As New Box\nSet b.Value(1) = Nothing',[cls]),'VB_PROPERTY_ACCESS');
});
test('With receiver identities survive nested blocks and check source calls',async()=>{
 const cls=box('Public Child As Box\nPublic Sub Add(ByVal n As Long)\nDebug.Print n\nEnd Sub');
 const p=project('Dim b As New Box\nSet b.Child = New Box\nWith b\n.Add 2\nWith .Child\n.Add 3\nEnd With\n.Add 4\nEnd With',[cls]);assert.deepEqual((await run(p)).output,['2','3','4']);
 bad(project('Dim b As New Box\nWith b\n.Add\nEnd With',[cls]),'VB_ARGUMENT_REQUIRED');
});
test('default source property calls bind the selected index signature',async()=>{
 const cls=module('Bag','Private n As Long\nPublic Property Get Item(ByVal index As Long) As Long\nItem = n + index\nEnd Property\nPublic Property Let Item(ByVal index As Long, ByVal rhs As Long)\nn = rhs - index\nEnd Property','class',['Attribute Item.VB_UserMemId = 0']);
 assert.deepEqual((await run(project('Dim b As New Bag\nb(2) = 7\nDebug.Print b(3)',[cls]))).output,['8']);
 bad(project('Dim b As New Bag\nDebug.Print b(1, 2)',[cls]),'VB_ARGUMENT_COUNT');
});
test('AddressOf binds standard-module source procedures only',()=>{
 good(project('Dim callback As Variant\ncallback = AddressOf H.Handler',[module('H','Public Sub Handler\nEnd Sub')]));
 bad(project('Dim callback As Variant\ncallback = AddressOf Box.Handler',[box('Public Sub Handler\nEnd Sub')]),'VB_ADDRESSOF_TARGET');
 bad(project('Dim callback As Variant\ncallback = AddressOf H.Native',[module('H','Public Declare Sub Native Lib "unused" ()')]),'VB_ADDRESSOF_TARGET');
});
test('RaiseEvent uses the declared event signature',()=>{
 const cls=box('Public Event Changed(ByVal value As Long)\nPublic Sub Work\nRaiseEvent Changed()\nEnd Sub');bad(project('',[cls]),'VB_ARGUMENT_REQUIRED');
 cls.code=cls.code.replace('Changed()','Changed(3)');good(project('',[cls]));
});
test('external names are explicit, detached, and can invalidate cached diagnostics without reparsing',()=>{
 const p=project('Debug.Print HostValue'),cache=new ProjectDiagnosticCache();assert.equal(cache.check(diagnosticSnapshot(p)).valid,false);
 p.externalSymbols=[{name:'HostValue',kind:'variable',type:'Long'}];const snapshot=diagnosticSnapshot(p);p.externalSymbols[0].name='Different';const r=cache.check(snapshot);assert.equal(r.valid,true);assert.equal(r.stats.compiledModules,0);assert.equal(r.semanticCacheHit,false);
 assert.equal(cache.check(snapshot).semanticCacheHit,true);assert.equal(cache.check(diagnosticSnapshot(p)).valid,false);
});
test('external symbol metadata does not execute getters or toJSON',()=>{
 let touched=0;const symbol={name:'Safe',type:'Long',toJSON(){touched++;throw Error('no');}};Object.defineProperty(symbol,'kind',{enumerable:true,get(){touched++;throw Error('no');}});
 const values=[symbol];Object.defineProperty(values,'1',{get(){touched++;throw Error('no');}});assert.deepEqual(externalSymbolSnapshot(values),[{name:'Safe',type:'Long'}]);
 const p=project('Debug.Print Safe');p.externalSymbols=values;good(p);diagnosticSnapshot(p);assert.equal(touched,0);
});
test('form/control metadata changes rebind cached modules, not their source',()=>{
 const p=newProject('FormBindings'),m=p.modules[0],cache=new ProjectDiagnosticCache();m.code='Option Explicit\nPrivate Sub Form_Load\nButton1.Caption = "ok"\nEnd Sub';m.form.controls=[createControl('CommandButton','Button1')];
 const a=cache.check(diagnosticSnapshot(p));assert.equal(a.valid,true);m.form.controls[0].name='Renamed';const b=cache.check(diagnosticSnapshot(p));assert.equal(b.valid,false);assert.equal(b.stats.compiledModules,0);assert.equal(b.semanticCacheHit,false);assert.equal(b.diagnostics[0].code,'VB_UNDEFINED_NAME');
 m.form.controls[0].name='Button1';assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);
});
test('diagnostic snapshots retain menu/array identities without images or data credentials',()=>{
 const p=newProject('Snapshot'),m=p.modules[0];m.form.controls=[createControl('CommandButton','Choice')];m.form.controls[0].properties.Index=0;m.form.controls[0].properties.Picture='secret-image';m.form.menus=[{name:'FileMenu',children:[{name:'OpenMenu'}]}];
 p.dataSources={connections:[{name:'Db',connectionString:'private-connection'}]};p.externalSymbols=[{name:'External',live:{secret:'secret-live'}}];
 const s=diagnosticSnapshot(p),json=JSON.stringify(s);assert.doesNotMatch(json,/secret-image|private-connection|secret-live/);assert.ok(s.modules[0].symbolBindings.items.some(n=>n.name==='Choice'&&n.array));assert.ok(s.modules[0].symbolBindings.items.some(n=>n.name==='OpenMenu'));
});
test('dependency signature changes recheck unchanged callers and remain isolated across projects',()=>{
 const p=project('Debug.Print Add(2)',[structuredClone(method)]),cache=new ProjectDiagnosticCache();assert.equal(cache.check(diagnosticSnapshot(p)).valid,true);
 p.modules[1].code=p.modules[1].code.replace('Optional ByVal second As Long = 2','ByVal second As Long');const r=cache.check(diagnosticSnapshot(p));assert.equal(r.valid,false);assert.equal(r.stats.compiledModules,1);assert.equal(r.stats.cacheHits,1);assert.equal(r.diagnostics[0].source,'M');
 assert.equal(cache.check(diagnosticSnapshot(project('Debug.Print Add(2)',[method]))).valid,true);
});
test('interleaved diagnostic passes capture their own symbol metadata',()=>{
 const p=project('Debug.Print HostValue'),cache=new ProjectDiagnosticCache(),badSnapshot=diagnosticSnapshot(p);p.externalSymbols=[{name:'HostValue'}];const goodSnapshot=diagnosticSnapshot(p),steps=cache.steps(goodSnapshot);steps.next();assert.equal(cache.check(badSnapshot).valid,false);let step;do{step=steps.next();}while(!step.done);assert.equal(step.value.valid,true);assert.equal(cache.check(badSnapshot).valid,false);
});

test('array-returning procedures with parameters still validate the invocation',async()=>{
 const helper=module('H','Public Function Values(ByVal count As Long) As Long()\nDim a(1) As Long\na(0) = count\nValues = a\nEnd Function');
 bad(project('Debug.Print Values()',[helper]),'VB_ARGUMENT_REQUIRED');bad(project('Debug.Print Values(1, 2)',[helper]),'VB_ARGUMENT_COUNT');
 assert.deepEqual((await run(project('Debug.Print Values(7)(0)',[helper]))).output,['7']);
});
test('no-argument array-returning functions and properties allow subscripting their result',async()=>{
 const helper=module('H','Public Function Values() As Long()\nDim a(1) As Long\na(1) = 7\nValues = a\nEnd Function');assert.deepEqual((await run(project('Debug.Print Values(1)',[helper]))).output,['7']);
});
test('built-in constants and enum members cannot be assignment targets',()=>{
 bad(project('vbRed = 7'),'VB_CONSTANT_ASSIGNMENT');bad(project('Mode.First = 1',[module('H','Public Enum Mode\nFirst = 7\nEnd Enum')]),'VB_CONSTANT_ASSIGNMENT');
 good(project('Dim vbRed As Long\nvbRed = 7'));
});
test('assignment to a source procedure is not confused with its return variable',()=>{
 bad(project('Add = 3',[method]),'VB_ASSIGNABLE_TARGET');good(project('Debug.Print Add(2)',[method]));
});
test('module property access is checked against the selected accessor visibility',()=>{
 const property=module('H','Private Property Get Value() As Long\nValue = 7\nEnd Property\nPublic Property Let Value(ByVal rhs As Long)\nEnd Property');
 good(project('Value = 3',[property]));bad(project('Debug.Print Value',[property]),'VB_MEMBER_ACCESS');bad(project('Debug.Print H.Value',[property]),'VB_MEMBER_ACCESS');
});
test('an argument failure is not hidden by an array-returning property signature',()=>{
 const cls=box('Public Property Get Values(ByVal index As Long) As Long()\nDim a(1) As Long\nValues = a\nEnd Property');
 bad(project('Dim b As New Box\nDebug.Print b.Values(1, 2)',[cls]),'VB_ARGUMENT_COUNT');
});

test('host extensions do not leak their symbols into ordinary source projects',async()=>{
 const {compileCompute}=await import('../src/compute/index.js');
 const {computeSourceProject,computeSymbolProject,COMPUTE_SYMBOLS}=await import('../src/compute/symbols.js');
 const p=project('Debug.Print ComputeIndex()');
 bad(p,'VB_UNDEFINED_NAME');good(computeSourceProject(p));bad(p,'VB_UNDEFINED_NAME');
 assert.equal(p.externalSymbols,undefined);assert.equal(p.symbolMetadata,undefined);
 const publicSymbols=computeSymbolProject(p);assert.ok(publicSymbols.externalSymbols.some(s=>s.name==='ComputeIndex'&&s.type==='Long'));
 assert.ok(COMPUTE_SYMBOLS.find(s=>s.name==='ComputeStoreLong').params.length===2);
 assert.equal(typeof compileCompute,'function');
});
test('diagnostics snapshot retains reference identities but not connection secrets',()=>{
 const p=project('Dim d As Object\nSet d = DataEnvironment.Connection1');
 p.externalSymbols=[{name:'DataEnvironment',type:'Object'}];
 p.dataSources={connections:[{name:'Connection1',connectionString:'must-not-copy',password:'secret'}]};
 const snapshot=diagnosticSnapshot(p);good(snapshot);
 assert.equal(JSON.stringify(snapshot).includes('must-not-copy'),false);assert.equal(JSON.stringify(snapshot).includes('secret'),false);
});
test('parser depth limits protect the additional semantic walk',()=>{
 const p=project('Debug.Print '+Array(1000).fill('1').join('+'));
 assert.equal(check(p).valid,false);assert.match(check(p).diagnostics[0].message,/depth limit/);
});
