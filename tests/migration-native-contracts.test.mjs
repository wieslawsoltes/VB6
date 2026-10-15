import test from 'node:test';
import assert from 'node:assert/strict';
import {convertVbNetProject,createVbNetMigrator,RUNTIME_CATALOG} from '../src/migration/index.js';
import {runtimeClosure} from '../src/migration/runtime-catalog.js';
import {RUNTIME_FEATURES} from '../src/migration/runtime-sources.js';
import {project,procedure,formProject} from './migration-fixtures.mjs';
import {compactIdentifiers} from '../src/migration/vb-tokens.js';
const convert=(p,options={})=>convertVbNetProject(p,{platform:'AnyCPU',includeOriginals:false,...options});
const code=r=>r.files['Application/Module1.vb'];
const good=r=>{assert.ok(r.success,JSON.stringify(r.diagnostics));return r;};
const native=r=>r.report.representations.filter(d=>d.representation.startsWith('native-'));

test('native/minimal/preserve defaults are explicit in every report',()=>{
 const r=good(convert(procedure('')));assert.equal(r.report.codeStyle,'native');assert.equal(r.report.semanticPolicy,'preserve');assert.equal(r.report.runtime.policy,'minimal');assert.deepEqual(r.report.runtime.features,[]);
 assert.equal(r.files['Application/__vbEntry.vb'],undefined);assert.match(r.files[r.projectFile],/<StartupObject>Module1<\/StartupObject>/);
 assert.equal((r.files['MigrationFixture.slnx'].match(/<Project /g)||[]).length,1);
});
test('nested and cross-module record fields retain declared types and value semantics',()=>{
 const p=project('Public Type Inner\nValue As Long\nEnd Type\nPublic Type Outer\nNested As Inner\nEnd Type');
 p.modules.push({name:'Program',kind:'module',code:'Public Sub Main()\nDim p As Outer\np.Nested.Value = 4\np.Nested.Value = p.Nested.Value + 2\nDebug.Print p.Nested.Value\nEnd Sub'});
 const r=good(convert(p));assert.deepEqual(r.report.runtime.features,[]);assert.doesNotMatch(r.files['Application/Program.vb'],/VbVariant|CopyValue/);assert.match(r.files['Application/Program.vb'],/Module1.Outer/);
});
test('records distinguish custom initialization from deep copying',()=>{
 const r=good(convert(project('Public Type Person\nName As String\nBorn As Date\nEnd Type\nPublic Sub Main()\nDim p As Person, q As Person\nq = p\nEnd Sub')));
 assert.match(code(r),/Function Create/);assert.match(code(r),/String.Empty/);assert.match(code(r),/FromOADate/);assert.doesNotMatch(code(r),/IVbValue|CopyValue/);assert.deepEqual(r.report.runtime.features,[]);
});
test('nonzero local vectors retain checked address translation without general arrays',()=>{
 const r=good(convert(procedure('Dim a(-2 To 2) As Long\na(-2) = 9\nDebug.Print a(-2)\nDebug.Print LBound(a)\nDebug.Print UBound(a)')));
 assert.deepEqual(r.report.runtime.features,['VbNativeArrays.Index']);assert.match(code(r),/VbNativeArrays.Index/);assert.match(code(r),/New Integer\(4\) \{\}/);assert.equal(r.report.runtime.sourceFiles,1);
});
test('native element references are restricted to matching, non-redimensioning calls',()=>{
 const p=project('Public Sub Main()\nDim a(2) As Long\na(0)=1\nMutate a(0), a(0)\nDebug.Print a(0)\nEnd Sub\nPublic Sub Mutate(ByRef first As Long, ByRef second As Long)\nfirst=7\nsecond=second+1\nEnd Sub');
 const r=good(convert(p));assert.deepEqual(r.report.runtime.features,[]);assert.match(code(r),/Mutate\(a\(CInt\(0S\)\), a\(CInt\(0S\)\)\)/);
 const mismatch=convert(project(p.modules[0].code.replace('first As Long','first As Variant')));
 assert.equal(mismatch.success,false);assert.ok(mismatch.diagnostics.some(d=>d.code==='MIG_ARRAY_ELEMENT_BYREF'));
});
test('whole native array assignments clone owned scalar values',()=>{
 const r=good(convert(procedure('Dim a() As Long, b() As Long\nReDim a(2)\na(0)=9\nb=a\nb(0)=2\nDebug.Print a(0)')));
 assert.equal(native(r).length,2);assert.match(code(r),/DirectCast\(a.Clone\(\), Integer\(\)\)/);assert.deepEqual(r.report.runtime.features,[]);
});
test('native string vectors flow from framework Split through Filter and Join',()=>{
 const r=good(convert(procedure('Dim a() As String, b() As String\na=Split("one,two,three", ",")\nb=Filter(a, "t")\nDebug.Print Join(b, "|")')));
 assert.equal(native(r).length,2);assert.deepEqual(r.report.runtime.features,[]);assert.match(code(r),/Global.Microsoft.VisualBasic.Strings.Split/);assert.match(code(r),/Global.Microsoft.VisualBasic.Strings.Filter/);
});
for(const [name,body] of [
 ['missing allocation','Dim a() As Long\nDebug.Print a(0)'],
 ['multidimensional enumeration','Dim a(2,2) As Long, v As Variant\nFor Each v In a\nDebug.Print v\nNext'],
 ['resumption','Dim a(2) As Long\nOn Error Resume Next\na(5)=1'],
 ['uncertain dynamic bound','Dim a() As Long, n As Long\nn=2\nReDim a(n)'],
 ['owned initialization','Dim a(2) As String\nDebug.Print a(0)'],
 ['Variant escape','Dim a(2) As Long, v As Variant\nv=a']
])test('unproved array case keeps compatibility storage: '+name,()=>{
 const r=convert(procedure(body));assert.equal(native(r).length,0);assert.ok(r.report.runtime.features.includes('VbArray'));
});
test('scalar Variant specialization requires homogeneous writes dominating every use',()=>{
 const r=good(convert(procedure('Dim value As Variant\nvalue="safe"\nDebug.Print value')));assert.match(code(r),/value As String/);assert.deepEqual(r.report.runtime.features,[]);
 for(const body of ['Dim value As Variant\nDebug.Print value\nvalue="later"','Dim value As Variant\nvalue=2\nDebug.Print VarType(value)','Dim value As Variant\nvalue=2\nvalue=Null\nDebug.Print value']){
  const q=good(convert(procedure(body)));assert.match(code(q),/value As Object/);assert.equal(q.report.representations.some(d=>d.kind==='variant'),false);
 }
});
test('simple forms use direct ownership, framework colors and strict typed event lambdas',()=>{
 const r=good(convert(formProject()));assert.deepEqual(r.report.runtime.features,[]);assert.match(r.files['Application/__vbEntry.vb'],/Application.Run\(New MainForm\(\)\)/);
 const d=r.files['Application/MainForm.Designer.vb'];assert.match(d,/Sub\(sender As Object, e As EventArgs\) RunButton_Click\(\)/);assert.doesNotMatch(d,/__vbEvent|__vbTips|__vbComponents|VbForms/);
});
test('default instance use retains lifecycle support, without dragging in core arrays',()=>{
 const p=formProject();p.modules[0].code+='\nPrivate Sub More()\nMainForm.Hide\nEnd Sub';
 const r=good(convert(p));assert.ok(r.report.runtime.features.includes('VbForms.GetInstance'));assert.equal(r.report.runtime.features.includes('VbArray'),false);
});
test('support catalog closes only explicit roots and all extracted units match',()=>{
 for(const [name,spec] of Object.entries(RUNTIME_CATALOG)){
  const closure=runtimeClosure([name]);assert.ok(closure.includes(name));assert.ok(RUNTIME_FEATURES[name]);
  assert.deepEqual(RUNTIME_FEATURES[name].dependencies,spec.dependencies);
  assert.match(RUNTIME_FEATURES[name].source,/Namespace Global.VB6.Compatibility/);
  for(const dependency of spec.dependencies)assert.ok(closure.includes(dependency));
 }
 assert.deepEqual(runtimeClosure(['VbRuntime.FixedString']),['VbRuntime.FixedString']);
});
test('typed plugin results declare exact support; opaque results remain conservative',()=>{
 const input=procedure('Debug.Print Special');
 const p={id:'typed',externalSymbols:[{name:'Special',type:'Integer'}],representationSafe:true,expression({node}){if(node?.kind==='id'&&node.name==='Special')return {code:'42I',requires:[]};}};
 const r=good(createVbNetMigrator({plugins:[p]}).convertProject(input));assert.deepEqual(r.report.runtime.features,[]);
 const q=good(createVbNetMigrator({plugins:[{...p,expression({node}){if(node?.kind==='id'&&node.name==='Special')return '42I';}}]}).convertProject(input));assert.ok(q.report.runtime.features.includes('VbArray'));
 const withSupport=good(createVbNetMigrator({plugins:[{...p,expression({node}){if(node?.kind==='id'&&node.name==='Special')return {code:'VbRuntime.FixedString("x", 3)',requires:['VbRuntime.FixedString']};}}]}).convertProject(input));
 assert.deepEqual(withSupport.report.runtime.features,['VbRuntime.FixedString']);assert.match(code(withSupport),/Imports VB6.Compatibility/);
});
test('finalize support requirements are linked after extensions run',()=>{
 const p={id:'final',requires:[],representationSafe:true,finalize(files,context){context.requireRuntime('VbRuntime.FixedString');context.addFile('Application/Extra.vb','Imports VB6.Compatibility\nPublic Module Extra\nPublic Function Pad() As String\nReturn VbRuntime.FixedString("x", 3)\nEnd Function\nEnd Module\n');}};
 const r=good(createVbNetMigrator({plugins:[p]}).convertProject(procedure('')));assert.deepEqual(r.report.runtime.features,['VbRuntime.FixedString']);
});
test('project and package modes reflect actual support, and never assume package publication',()=>{
 const input=procedure('Dim c As Currency\nc=1@');
 const a=good(convert(input,{runtime:'project'}));assert.ok(a.files['VB6.Compatibility/VB6.Compatibility.vbproj']);assert.match(a.files[a.projectFile],/ProjectReference/);
 assert.throws(()=>convert(input,{runtime:'package'}),/runtimePackage/);
 const b=good(convert(input,{runtime:'package',runtimePackage:{id:'Company.Compat',version:'0.2.0'}}));assert.match(b.files[b.projectFile],/PackageReference Include="Company.Compat" Version="0.2.0"/);assert.equal(b.report.runtime.sourceFiles,0);assert.ok(b.diagnostics.some(d=>d.code==='MIG_RUNTIME_PACKAGE'));
});
test('invalid output, package and modernization options fail closed',()=>{
 for(const options of [{codeStyle:'fast'},{runtime:'drop'},{semanticPolicy:'guess'},{semanticPolicy:'modernize'}, {acceptedRules:['currency-decimal']},{semanticPolicy:'modernize',acceptedRules:['unknown']},{runtimePackage:{id:'bad"',version:'1.0.0'}},{runtimePackage:{id:'Ok',version:'*'}}])assert.throws(()=>convert(procedure(''),options));
});
test('identifier cleanup never modifies comments or string contents',()=>{
 assert.equal(compactIdentifiers('Dim [value] As String = "[not code]" \' [comment]'),'Dim value As String = "[not code]" \' [comment]');
 assert.equal(compactIdentifiers('[Class].[Name] = "a""[text]"'),'[Class].Name = "a""[text]"');
});
test('native source mappings still identify their emitted statements',()=>{
 const r=good(convert(procedure('Dim x As Long\nx=7\nDebug.Print x')));const lines=code(r).split('\n');
 const m=r.sourceMap.find(m=>m.sourceLine===4);assert.ok(m);assert.match(lines[m.generatedLine-1],/x = 7S/);
});


test('explicit Currency modernization binds conversions and scalar intrinsics consistently',()=>{
 const options={runtime:'none',semanticPolicy:'modernize',acceptedRules:['currency-decimal']};
 const r=good(convert(procedure('Dim c As Currency\nc=CCur(1.23456)\nDebug.Print Abs(c)\nDebug.Print Sgn(c)\nDebug.Print Round(c,2)\nDebug.Print Len(c)\nDebug.Print VarType(c)\nIf c Then Debug.Print c'),options));
 assert.deepEqual(r.report.runtime.features,[]);assert.match(code(r),/Math.Abs/);assert.match(code(r),/CDec/);assert.match(code(r),/CBool/);
 assert.match(r.report.modernization[0].reason,/subtype/);
 const legacy=good(convert(procedure('Dim c As Currency\nc=CCur(1.23456)'),{...options,codeStyle:'compatibility'}));
 assert.deepEqual(legacy.report.runtime.features,[]);assert.match(code(legacy),/CDec/);
});

test('published support metadata cannot mutate later conversions',()=>{
 assert.ok(Object.isFrozen(RUNTIME_CATALOG));
 for(const spec of Object.values(RUNTIME_CATALOG)){assert.ok(Object.isFrozen(spec));assert.ok(Object.isFrozen(spec.dependencies));}
 assert.throws(()=>RUNTIME_CATALOG.VbCurrency.dependencies.push('VbArray'));
 assert.deepEqual(runtimeClosure(['VbCurrency']),['VbCurrency']);
});


test('opaque extensions retain record and implicit-result contracts until explicitly opted in',()=>{
 const input=project('Public Type Point\nX As Long\nEnd Type\nPublic Sub Main()\nDim p As Point\np.X=4\nDebug.Print Twice(p.X)\nEnd Sub\nPublic Function Twice(ByVal x As Long) As Long\nTwice=x*2\nEnd Function');
 const plugin={id:'legacy-shape',requires:[],expression(){}};
 const r=good(createVbNetMigrator({plugins:[plugin]}).convertProject(input));
 assert.match(code(r),/Implements IVbValue/);assert.match(code(r),/__vbResult/);assert.ok(r.files['Application/__vbEntry.vb']);
 const q=good(createVbNetMigrator({plugins:[{...plugin,representationSafe:true}]}).convertProject(input));
 assert.doesNotMatch(code(q),/IVbValue|__vbResult/);assert.equal(q.files['Application/__vbEntry.vb'],undefined);assert.deepEqual(q.report.runtime.features,[]);
});

test('extension requirements retain their explicit source attribution',()=>{
 const plugin={id:'attribution',requires:[],representationSafe:true,expression({node},context){if(node?.kind==='literal'){context.requireRuntime('VbRuntime.FixedString',{source:'adapter',line:9},'Adapter-owned helper');return {code:'"x"',requires:[]};}}};
 const r=good(createVbNetMigrator({plugins:[plugin]}).convertProject(procedure('Debug.Print "x"')));
 assert.ok(r.report.runtime.requirements.some(r=>r.source==='adapter'&&r.line===9&&r.reason==='Adapter-owned helper'));
});


test('typed constant numeric ranges remain ordinary Select Case without helpers',()=>{
 const input=procedure('Dim value As Long\nvalue=4\nSelect Case value\nCase 0 To 5\nDebug.Print "hit"\nCase Else\nDebug.Print "miss"\nEnd Select');
 const r=good(convert(input));assert.deepEqual(r.report.runtime.features,[]);assert.match(code(r),/Select Case value/);assert.match(code(r),/Case 0S To 5S/);
 const dynamic=project(input.modules[0].code.replace('0 To 5','0 To Bound()')+'\nPrivate Function Bound() As Long\nBound=5\nEnd Function');
 const q=good(convert(dynamic));assert.ok(q.report.runtime.features.includes('VbVariant.Binary'));
});
