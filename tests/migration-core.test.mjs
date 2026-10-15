import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compileProject,compileModule,parseLeafStatement} from '../src/language/compiler.js';
import {parseExpression} from '../src/language/expression.js';
import {convertVbNetProject,exportVbNetProject,createVbNetMigrator,MigrationError,migrationZip} from '../src/migration/index.js';
import {readZip} from '../src/project/zip.js';
import {key,typeName,identifier} from '../src/migration/names.js';
import {project,procedure,formProject,CORE_FIXTURE} from './migration-fixtures.mjs';

// Retain exact legacy-output contracts alongside the native-first suite.
const convert=(input,options={})=>convertVbNetProject(input,{platform:'AnyCPU',codeStyle:'compatibility',runtime:'project',...options});
const code=result=>result.files['Application/Module1.vb'];
function okay(result){assert.equal(result.success,true,JSON.stringify(result.diagnostics));return result;}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('retained syntax is opt-in; execution IR remains byte-for-byte unchanged',()=>{
  const input=procedure('Dim n As Long\nn = 2: n = n + 1'),a=compileProject(input),b=compileProject(input,{retainSyntax:true});
  const pa=a.modules.get('module1').procedures.get('main'),pb=b.modules.get('module1').procedures.get('main');
  assert.equal(pa.statements,undefined);assert.equal(pb.statements.length,3);assert.deepEqual(pa.code,pb.code);
});
test('leaf parsing shares assignment, calls and file grammar and rejects blocks',()=>{
  const module=compileModule(project('').modules[0]),proc={name:'Test',kind:'sub',code:[],line:1,params:[]};
  assert.equal(parseLeafStatement('Set x = New Thing',module,proc)[0].objectSet,true);
  assert.equal(parseLeafStatement('Open "x" For Input As #1',module,proc)[0].op,'fileOpen');
  assert.throws(()=>parseLeafStatement('If True Then',module,proc),/leaf/);
});
test('core source emits modules, scaled Currency, fixed strings, bounded arrays and GoSub',()=>{
  const result=okay(convert(CORE_FIXTURE)),source=code(result);
  assert.match(source,/VbArray\(Of Integer\)/);assert.match(source,/\.Resize\(.*True\)/);
  assert.match(source,/VbCurrency\.FromDecimal\(12\.34565D\)/);assert.match(source,/ = VbRuntime\.MidAssign\(/);
  assert.match(source,/Static \[value\] As Integer/);assert.match(source,/__vbReturns\.Push/);assert.match(source,/GoTo __vbContinue1/);
  assert.equal(result.report.validation.dotnetBuild,'not-run');assert.ok(result.files['VB6.Compatibility/src/VbArray.vb']);
  assert.ok(result.files['VB6.Compatibility/LICENSE']);
});
test('integer widths and conversion intrinsics are preserved rather than renamed naively',()=>{
  const result=okay(convert(procedure('Dim i As Integer, l As Long\ni = CInt(1.5)\nl = CLng(1.5)')));
  assert.match(code(result),/\[i\] As Short/);assert.match(code(result),/\[l\] As Integer/);
  assert.match(code(result),/\[i\] = CShort\(/);assert.match(code(result),/\[l\] = CInt\(/);
});
for(const [old,expected] of Object.entries({Byte:'Byte',Boolean:'Boolean',Integer:'Short',Long:'Integer',Single:'Single',Double:'Double',Currency:'VbCurrency',String:'String',Date:'Date',Variant:'Object',Object:'Object'}))test('type mapping '+old,()=>assert.equal(typeName(old),expected));
test('keyword escaping, suffix stripping and Unicode identifiers',()=>{
  assert.equal(identifier('Class$'),'[Class]');assert.equal(identifier('Zażółć'),'[Zażółć]');assert.equal(key('Count&'),'count');assert.throws(()=>identifier('x\nEnd Module'));
});
test('strings are never rewritten as source code and original comments survive in originals',()=>{
  const input=procedure('Dim text As String\ntext = "Integer Set x = y: End If" \' Do not edit this comment');
  const result=okay(convert(input));assert.match(code(result),/"Integer Set x = y: End If"/);
  assert.equal(result.files['Originals/Code/Module1.bas'],input.modules[0].code);
});
test('source maps point to retained original physical lines',()=>{
  const result=okay(convert(procedure('Dim x As Long\nx = 1'))),mapping=result.sourceMap.find(m=>m.sourceLine===4);
  assert.equal(mapping.source,'Module1');assert.match(result.files[mapping.generatedFile].split('\n')[mapping.generatedLine-1],/\[x\] = 1S/);
});
test('native and browser source retention is independent from generated Compile globs',()=>{
  const result=okay(convert(procedure('Debug.Print "Hello"')));
  assert.ok(Object.keys(result.files).some(p=>p.startsWith('Originals/Native/')&&p.endsWith('.bas')));
  assert.equal(JSON.parse(result.files['Originals/project.vb6web']).modules[0].code,procedure('Debug.Print "Hello"').modules[0].code);
  assert.match(result.files[result.projectFile],/<TargetFramework>net10.0<\/TargetFramework>/);
});
test('recursive function calls do not bind to the function-result local',()=>{
  const input=project('Public Function F(ByVal n As Long) As Long\nIf n = 0 Then\nF = 1\nElse\nF = n * F(n - 1)\nEnd If\nEnd Function',{startup:'',name:'Module1'});
  const result=okay(convert(input,{target:'library'}));assert.match(code(result),/\[F\]\(\(\[n\] - 1S\)\)/);assert.doesNotMatch(code(result),/__vbResult\(/);
});
test('Get/Let groups become one idiomatic property',()=>{
  const input=project('Private mValue As Long\nPublic Property Get Value() As Long\nValue = mValue\nEnd Property\nPublic Property Let Value(ByVal nextValue As Long)\nmValue = nextValue\nEnd Property',{kind:'class'});
  const result=okay(convert(input,{target:'library'}));assert.equal((code(result).match(/Public Property \[Value\]/g)||[]).length,1);assert.match(code(result),/Set\(value As Integer\)/);assert.match(code(result),/\[mValue\] = value/);
});
test('dynamic array declared by ReDim starts unallocated, not fixed-size',()=>{
  const result=okay(convert(procedure('ReDim values(1 To 3) As Long\nvalues(1) = 4')));
  assert.match(code(result),/Dim \[values\] As VbArray\(Of Integer\) = New VbArray\(Of Integer\)\(\)/);
});
test('On Error/Resume remains native unstructured VB.NET rather than an unsafe Try rewrite',()=>{
  const result=okay(convert(procedure('On Error GoTo Failed\nError 5\nExit Sub\nFailed:\nResume Next')));
  assert.match(code(result),/On Error GoTo \[Failed\]/);assert.match(code(result),/Resume Next/);assert.doesNotMatch(code(result),/Try/);
});
test('computed branches evaluate their selector once',()=>{
  const result=okay(convert(procedure('Dim n As Integer\nOn n GoTo One, Two\nExit Sub\nOne:\nn = 1\nGoTo Done\nTwo:\nn = 2\nDone:')));
  assert.equal((code(result).match(/VbRuntime.BranchIndex/g)||[]).length,1);assert.match(code(result),/Select Case __vbBranch/);
});
test('With receivers are captured once and nested aliases are restored',()=>{
  const result=convert(project('Public Sub Main()\nDim value As Object\nWith value\n.Name = "first"\nWith .Child\n.Name = "second"\nEnd With\n.Name = "last"\nEnd With\nEnd Sub'));
  assert.match(code(result),/Dim __vbWith0 = \[value\]/);assert.match(code(result),/__vbWith1\.\[Name\] = "second"/);assert.match(code(result),/__vbWith0\.\[Name\] = "last"/);
});
test('eager And/Or are not rewritten to short-circuit operators',()=>{
  const result=okay(convert(procedure('Dim a As Boolean, b As Boolean\na = a And b\nb = a Or b')));
  assert.match(code(result),/\[a\] And \[b\]/);assert.doesNotMatch(code(result),/AndAlso|OrElse/);
});
test('Variant operators route through compatibility logic',()=>{
  const result=okay(convert(procedure('Dim value As Variant\nvalue = Null\nvalue = value + 1\nIf value Then Debug.Print "yes"')));
  assert.match(code(result),/DBNull.Value/);assert.match(code(result),/VbVariant.Binary\("\+"/);assert.match(code(result),/VbVariant.Truth/);
});
test('selected conditional configuration is converted and inactive source retained',()=>{
  const input=project('#If Feature Then\nPublic Sub Main()\nDebug.Print "active"\nEnd Sub\n#Else\nPublic Sub Main()\nDebug.Print "inactive"\nEnd Sub\n#End If',{settings:{conditionalConstants:{Feature:-1}}});
  const result=okay(convert(input));assert.match(code(result),/"active"/);assert.doesNotMatch(code(result),/"inactive"/);assert.match(result.files['Originals/Code/Module1.bas'],/"inactive"/);
});
test('optional Variant retains an IsMissing sentinel and explicit ByRef defaults',()=>{
  const result=okay(convert(project('Public Sub Test(Optional value As Variant)\nIf IsMissing(value) Then Exit Sub\nEnd Sub'),{target:'library'}));
  assert.match(code(result),/Optional ByRef \[value\] As Object = VbMissing.Value/);assert.match(code(result),/VbRuntime.IsMissing/);
});
test('LSet, RSet and Mid assignment assign the runtime return value',()=>{
  const result=okay(convert(procedure('Dim value As String * 8\nLSet value = "xy"\nRSet value = "z"\nMid$(value, 2) = "a"')));
  assert.match(code(result),/\[value\] = VbRuntime.Align\("xy", Len\(\[value\]\), False\)/);assert.match(code(result),/\[value\] = VbRuntime.MidAssign\(\[value\], 2S, "a"\)/);
});
test('file operations are emitted with real .NET APIs, never executed by the converter',()=>{
  const input=procedure('Dim value As String\nOpen "never-created.txt" For Output As #1\nPrint #1, "data"\nClose #1\nOpen "never-created.txt" For Input As #1\nLine Input #1, value\nClose #1');
  const result=okay(convert(input));assert.match(code(result),/FileSystem.FileOpen/);assert.match(code(result),/FileSystem.LineInput/);assert.equal(fs.existsSync('never-created.txt'),false);
});
test('verified classic Declare stays x86 and unsafe architecture changes are blocked',()=>{
  const input=project('Public Declare Sub Sleep Lib "kernel32" (ByVal dwMilliseconds As Long)');
  const x86=convert(input,{target:'library',platform:'x86'});assert.equal(x86.success,true);assert.match(code(x86),/Declare Ansi Sub \[Sleep\] Lib "kernel32"/);
  assert.ok(convert(input,{target:'library',platform:'x64'}).diagnostics.some(d=>d.code==='MIG_POINTER_WIDTH'));
});
test('raw pointers and AddressOf are blocked pending explicit marshaling adapters',()=>{
  const result=convert(procedure('Dim value As Long\nvalue = VarPtr(value)'));assert.ok(result.diagnostics.some(d=>d.code==='MIG_MANAGED_POINTER'));assert.equal(result.success,false);
});
test('unresolved normal export is rejected; explicit review archives contain build guards',()=>{
  const input=procedure('MissingProcedure');assert.throws(()=>exportVbNetProject(input),MigrationError);
  const result=exportVbNetProject(input,{includeUnresolved:true});assert.equal(result.success,false);assert.match(result.fileName,/-review.zip$/);assert.match(result.files['Directory.Build.targets'],/<Error Text=/);
});
test('no-originals option deliberately omits original source',()=>assert.equal(Object.keys(convert(procedure(''),{includeOriginals:false}).files).some(p=>p.startsWith('Originals/')),false));
test('conversion is reentrant and does not mutate even a deeply frozen input',()=>{
  const input=freeze(procedure('Debug.Print "test"')),before=JSON.stringify(input),m=createVbNetMigrator();const a=m.convertProject(input),b=m.convertProject(input);
  assert.equal(JSON.stringify(input),before);assert.deepEqual(a.files,b.files);
});
test('ZIP output is byte-for-byte deterministic and independently readable',async()=>{
  const input=procedure('Debug.Print "hello"'),a=exportVbNetProject(input),b=exportVbNetProject(input);
  assert.deepEqual(a.bytes,b.bytes);const files=await readZip(a.bytes);assert.equal(new TextDecoder().decode(files.get('Application/Module1.vb')),code(a));
});
for(const path of ['../escape','/absolute','a/../x','a\\x','a//x','a/./x','CON.txt','a/NUL','file.','file ','a:x','\ud800'])test('unsafe archive path rejected '+JSON.stringify(path),()=>assert.throws(()=>migrationZip({[path]:'x'})));
test('archive rejects Unicode-normalized and case-insensitive aliases',()=>{assert.throws(()=>migrationZip({'A.txt':'x','a.txt':'y'}));assert.throws(()=>migrationZip({'é.txt':'x','e\u0301.txt':'y'}));});
test('invalid options, oversized projects and cancellation fail before conversion',()=>{
  assert.throws(()=>convert(procedure(''),{platform:'bogus'}));assert.throws(()=>convert(procedure(''),{target:'wpf'}));assert.throws(()=>convert(procedure(''),{maxSourceBytes:1}));
  const abort=new AbortController();abort.abort();assert.throws(()=>convert(procedure(''),{signal:abort.signal}),/cancel/i);
});
test('plugins are ordered, explicit, reusable, and can add runtime source files',()=>{
  const calls=[],m=createVbNetMigrator({plugins:[{id:'first',externalSymbols:[{name:'Special',type:'Integer'}],expression({node}){if(node.kind==='id'&&node.name==='Special'){calls.push(1);return '42I';}},finalize(files,context){context.addFile('Adapter/README.txt','adapter');}},{id:'second',expression({node}){if(node.kind==='id'&&node.name==='Special'){calls.push(2);return '7I';}}}]});
  const result=m.convertProject(procedure('Debug.Print Special'));okay(result);assert.deepEqual(calls,[1]);assert.match(code(result),/42I/);assert.equal(result.files['Adapter/README.txt'],'adapter');
});
test('duplicate plugin ids and asynchronous hooks are rejected',()=>{
  assert.throws(()=>createVbNetMigrator({plugins:[{id:'p'},{id:'p'}]}));
  assert.throws(()=>createVbNetMigrator({plugins:[{id:'p',analyze(){return Promise.resolve();}}]}).convertProject(procedure('')),/synchronous/);
});
test('malformed source cannot disappear as a successful empty module',()=>{
  const result=convert(project('Public Sub Main()\nIf Then\nEnd Sub'));assert.equal(result.success,false);assert.equal(result.report.sourceModules[0].converted,false);assert.match(result.files['Originals/Code/Module1.bas'],/If Then/);
});
test('WinForms exports designer, event bridges, runtime source and a real startup loop',()=>{
  const result=okay(convert(formProject())),source=result.files['Application/MainForm.Designer.vb'];
  assert.match(source,/New Button\(\)/);assert.match(source,/New TextBox\(\)/);assert.match(source,/AddHandler Me.\[RunButton\].Click/);
  assert.match(result.files['Application/MainForm.vb'],/Me.Text = "Migrated to .NET 10"/);
  assert.match(result.files['Application/__vbEntry.vb'],/Application.Run\(VbForms.GetInstance/);assert.equal(result.report.targetFramework,'net10.0-windows');
});
test('control-array dictionaries preserve sparse Index values and event parameters',()=>{
  const p=formProject(),m=p.modules[0],button=m.form.controls[0];button.properties.Index=3;m.code='Private Sub RunButton_Click(Index As Integer)\nOutputBox.Text = CStr(Index)\nEnd Sub';
  const result=okay(convert(p)),source=result.files['Application/MainForm.Designer.vb'];assert.match(source,/Dictionary\(Of Short, Button\)/);assert.match(source,/\.Add\(3S,/);assert.match(source,/\[RunButton_Click\]\(3S\)/);
});
test('unknown controls and nonmapped nondefault properties produce blocking diagnostics',()=>{
  const p=formProject();p.modules[0].form.controls[0].type='Vendor.Ocx';assert.ok(convert(p).diagnostics.some(d=>d.code==='MIG_CONTROL'));
  const q=formProject();q.modules[0].form.controls[1].properties.VendorBehavior='custom';assert.ok(convert(q).diagnostics.some(d=>d.code==='MIG_CONTROL_PROPERTY'));
});
test('bare control default-property assignments remain assignments to Text',()=>{
  const p=formProject();p.modules[0].code='Private Sub Form_Load()\nOutputBox = "hello"\nEnd Sub';const result=okay(convert(p));assert.match(result.files['Application/MainForm.vb'],/\[OutputBox\].Text = "hello"/);
});
test('control receiver qualification does not accidentally coerce it to its default Text',()=>{
  const p=formProject();p.modules[0].code='Private Sub Form_Load()\nOutputBox.Text = OutputBox.Text & "!"\nEnd Sub';const result=okay(convert(p));assert.doesNotMatch(result.files['Application/MainForm.vb'],/Text\.Text/);
});
test('console target cannot silently discard forms',()=>assert.ok(convert(formProject(),{target:'console'}).diagnostics.some(d=>d.code==='MIG_UI_TARGET')));
test('source used by the published browser bundle has no required host environment',()=>{
  const context={TextEncoder,TextDecoder,Uint8Array,DataView,Map,Set,URL,structuredClone,console};context.globalThis=context;
  vm.runInNewContext(fs.readFileSync('packages/vbnet-migration/dist/vbnet-migration.js','utf8'),context);
  assert.equal(context.VB6Migration.convertVbNetProject(procedure('Debug.Print 1')).success,true);
});

test('whole arrays and records use value copies instead of managed reference aliasing',()=>{
  const result=okay(convert(procedure('Dim a() As Long, b() As Long\nReDim a(1 To 2)\na(1) = 9\nb = a\nb(1) = 8')));
  assert.match(code(result),/\[b\] = CType\(VbRuntime.CopyValue\(\[a\]\), VbArray\(Of Integer\)\)/);
  assert.match(result.files['VB6.Compatibility/src/VbArray.vb'],/Public Function Copy\(\)/);
});
test('fixed string arrays use per-element factories and preserve padded defaults',()=>{
  const result=okay(convert(procedure('Dim names(1 To 2) As String * 4\nnames(1) = "x"')));
  assert.match(code(result),/VbArray\(Of String\).*Function\(\) New String\(" "c, 4\)/);
  assert.match(code(result),/\[names\]\(1S\) = VbRuntime.FixedString\("x", 4\)/);
});
test('record arrays carry constructors and nested value-copy implementations',()=>{
  const input=project('Public Type Record\nLabel As String * 6\nValues(1 To 2) As Long\nEnd Type\nPublic Sub Main()\nDim records(1 To 3) As Record\nEnd Sub');
  const result=okay(convert(input));assert.match(code(result),/AddressOf \[Record\].Create/);assert.match(code(result),/Implements IVbValue/);assert.match(code(result),/Public Function CopyValue\(\)/);
});
test('As New procedure locals instantiate lazily after Set Nothing',()=>{
  const input=procedure('Dim value As New Widget\nvalue.Touch\nSet value = Nothing\nvalue.Touch');
  input.modules.push({name:'Widget',kind:'class',code:'Public Sub Touch()\nEnd Sub'});
  const result=okay(convert(input));assert.match(code(result),/Dim \[value\] As \[Widget\] = Nothing/);
  assert.equal((code(result).match(/VbRuntime.AutoNew/g)||[]).length,2);assert.match(code(result),/\[value\] = Nothing/);
});
test('record lvalue With uses native VB.NET With rather than a discarded copy',()=>{
  const input=project('Public Type Record\nValue As Long\nEnd Type\nPublic Sub Main()\nDim item As Record\nWith item\n.Value = 2\nEnd With\nEnd Sub');
  const result=okay(convert(input));assert.match(code(result),/With \[item\]/);assert.match(code(result),/\.\[Value\] = 2S/);assert.doesNotMatch(code(result),/Dim __vbWith/);
});
test('Form Initialize runs in the constructor and QueryUnload precedes Unload',()=>{
  const input=formProject();input.modules[0].code+='\nPrivate Sub Form_Initialize()\nCaption = "Initialized"\nEnd Sub\nPrivate Sub Form_QueryUnload(Cancel As Integer, UnloadMode As Integer)\nCancel = 0\nEnd Sub\nPrivate Sub Form_Unload(Cancel As Integer)\nCancel = 0\nEnd Sub';
  const result=okay(convert(input)),source=result.files['Application/MainForm.Designer.vb'];
  assert.match(result.files['Application/MainForm.vb'],/InitializeComponent\(\)\n\s+\[Form_Initialize\]\(\)/);
  assert.equal((source.match(/AddHandler Me.FormClosing/g)||[]).length,1);assert.match(source,/\[Form_QueryUnload\]\(cancel, mode\)\n\s+If cancel = 0 Then \[Form_Unload\]\(cancel\)/);
});
test('dynamic control Load is not mistaken for loading a Form',()=>{
  const input=formProject();input.modules[0].code+='\nPrivate Sub AddOne()\nLoad RunButton\nEnd Sub';
  const result=convert(input);assert.equal(result.success,false);assert.ok(result.diagnostics.some(d=>d.code==='MIG_DYNAMIC_CONTROL'));
});

test('shared intrinsic constants are converted without undefined VB6-only identifiers',()=>{
  const result=okay(convert(procedure('Debug.Print vbCrLf & vbTab\nDebug.Print vbButtonFace\nDebug.Print adOpenForwardOnly\nDebug.Print vbFormMDIForm')));
  assert.doesNotMatch(code(result),/\[vbCrLf\]|\[vbButtonFace\]|\[adOpenForwardOnly\]/);assert.match(code(result),/-2147483633/);
  const invalid=convert(procedure('Debug.Print vbUnregisteredConstant'));assert.equal(invalid.success,false);assert.ok(invalid.diagnostics.some(d=>d.code==='MIG_UNRESOLVED_NAME'));
});
test('vbNullString stays an empty String except at an explicit native String boundary',()=>{
  const result=okay(convert(procedure('Debug.Print IsEmpty(vbNullString)')));assert.match(code(result),/IsEmpty\(String.Empty\)/);
  const native=project('Public Declare Sub NativeCall Lib "vendor" (ByVal text As String)\nPublic Sub Main()\nNativeCall vbNullString\nEnd Sub');
  const converted=okay(convert(native,{platform:'x86'}));assert.match(code(converted),/\[NativeCall\]\(Nothing\)/);
});
