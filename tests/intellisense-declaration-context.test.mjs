import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorIntelligence} from '../src/editor/intelligence.js';

const cls=(name,field)=>({id:name,name,kind:'class',code:'Public '+field+' As String'});
const fixture=(code,others=[])=>{const module={id:'main',name:'Main',kind:'module',code},project={name:'Project1',modules:[module,...others],settings:{}},service=new EditorIntelligence();return {module,project,service};};
const hint=(f,text,line=1)=>f.service.parameterInfo(f.project,f.module,line,text,text.length);
const names=(f,text,line=1)=>f.service.completions(f.project,f.module,line,text,text.length).items.map(s=>s.name);

for(const kind of ['Sub','Function'])test('DefType argument hints retain declaring-module defaults: '+kind,()=>{
 const other={id:'library',name:'Library',kind:'module',code:'DefInt A-Z\nPublic '+kind+' Read(first, Optional second = 2)\nEnd '+kind};
 const f=fixture('DefStr A-Z',[other]),info=hint(f,'Library.Read ');
 assert.equal(info.parameters[0].type,'Integer');assert.equal(info.parameters[1].type,'Integer');
});
test('Property Get argument hints retain inferred types through accessor coalescing',()=>{
 const other={id:'library',name:'Library',kind:'class',code:'DefInt A-Z\nPublic Property Get Item(index) As String\nEnd Property'},f=fixture('Dim value As Library',[other]);
 assert.equal(hint(f,'value.Item(').parameters[0].type,'Integer');
});
for(const prefix of ['','ByRef ','ByVal '])test('source qualification does not rewrite a string default: '+prefix,()=>{
 const other={id:'library',name:'Library',kind:'module',code:'Public Type Point\nX As Long\nEnd Type\nPublic Sub Read(Optional '+prefix+'value = "As Point")\nEnd Sub'},f=fixture('',[other]);
 const info=hint(f,'Library.Read ');assert.equal(info.params[0],'Optional '+prefix+'value = "As Point"');assert.equal(info.parameters[0].defaultValue,'"As Point"');
});
test('portable reference normalization does not rewrite defaults or bracketed parameter names',()=>{
 const f=fixture();f.service.registerTypeLibrary('Library',[
  {name:'Point',kind:'type',members:[{name:'X',type:'Long'}]},
  {name:'Api',kind:'module',members:[{name:'Read',kind:'sub',type:'Void',params:['Optional value = "As Point"','Optional [As Point] As String = "x"']}]}
 ]);
 const info=hint(f,'Library.Api.Read ');assert.deepEqual(info.params,['Optional value = "As Point"','Optional [As Point] As String = "x"']);
});
test('declared-type qualification ignores As embedded in bracketed parameter names',()=>{
 const other={id:'library',name:'Library',kind:'module',code:'Public Type Point\nX As Long\nEnd Type\nPublic Sub Read(ByVal [As Point] As String)\nEnd Sub'},f=fixture('',[other]);
 assert.equal(hint(f,'Library.Read ').params[0],'ByVal [As Point] As String');
});
for(const nesting of [false,true])test('With receiver scope uses source offsets for same-line procedures: '+nesting,()=>{
 const tail=nesting?'With obj: With .Parent: .':'With obj: .';
 const a=cls('One','First'),b={...cls('Two','Second'),code:'Public Second As String\nPublic Parent As Two'};
 const source='Sub A(): Dim obj As One: End Sub: Sub B(): Dim obj As Two: '+tail;
 const f=fixture(source,[a,b]);assert.ok(names(f,source).includes('Second'));assert.ok(!names(f,source).includes('First'));
});
test('Select Case receiver scope uses offsets for same-line procedures',()=>{
 const source='Public Enum A\nFirst=1\nEnd Enum\nPublic Enum B\nSecond=2\nEnd Enum\nSub One(): Dim choice As A: End Sub: Sub Two(): Dim choice As B: Select Case choice: Case ';
 const f=fixture(source);assert.deepEqual(names(f,source,7),['Second']);
});
for(const statement of [
 'If True Then ReDim items(2) As Customer',
 'If False Then Debug.Print "Then ReDim ignored(3)" Else ReDim items(2) As Customer',
 'If True Then ReDim items(2) As Customer Else ReDim others(3) As Customer',
 'If True Then If True Then ReDim items(2) As Customer',
 '100 If True Then ReDim items(2) As Customer',
 'If True Then ReDim items(0 To Len("Else Then"), 1 To 2) As Customer'
])test('single-line conditional ReDim is a procedure declaration: '+statement,()=>{
 const f=fixture('Sub Work()\n'+statement+'\nEnd Sub',[cls('Customer','Name')]);assert.ok(names(f,'items(0).',2).includes('Name'));
 assert.equal(f.service.resolve(f.project,f.module,2,'ignored'),null);
});
test('both branches of a single-line ReDim retain separate declarations and original offsets',()=>{
 const source='Sub Work()\nIf True Then ReDim items(1) As Customer Else ReDim others(1) As Customer\nEnd Sub',f=fixture(source,[cls('Customer','Name')]);
 for(const name of ['items','others']){const symbol=f.service.resolve(f.project,f.module,2,name);assert.equal(symbol?.type,'Customer');assert.equal(symbol.line,2);assert.ok(symbol.offset>=source.indexOf('If True'));}
});
test('single-line conditional ReDim preserves later explicit/shared bindings',()=>{
 const f=fixture('Sub Work()\nIf True Then ReDim items(2) As Customer\nDim items As Variant\nEnd Sub',[cls('Customer','Name')]);assert.deepEqual(names(f,'items(0).',2),[]);
});

test('incomplete host modules without a code field produce stable empty indexes',()=>{
 const f=fixture('');delete f.module.code;for(let i=0;i<3;i++)assert.deepEqual(f.service.index(f.module,f.project).symbols,[]);
});
test('conditional ReDim preserves physical offsets over explicit continuations',()=>{
 const source='Sub Work()\r\nIf True Then _\r\n ReDim _\r\n items(1) As Customer Else _\r\n ReDim others(1) As Customer\r\nEnd Sub';
 const f=fixture(source,[cls('Customer','Name')]);
 const other=f.service.resolve(f.project,f.module,5,'others');assert.equal(other?.type,'Customer');
 assert.ok(other.offset>=source.indexOf('Else')&&other.offset<=source.indexOf('ReDim others'));
 assert.equal(source.slice(other.offset).trimStart().slice(0,5),'ReDim');
});
test('conditional ReDim ignores commented, literal and bracketed fake branch tokens',()=>{
 const f=fixture('Sub Work()\nIf True Then Debug.Print "Else ReDim fake(1) As Customer"\nIf False Then Rem ReDim commented(1) As Customer\nIf True Then ReDim [Then Else](1) As Customer\nEnd Sub',[cls('Customer','Name')]);
 for(const name of ['fake','commented'])assert.equal(f.service.resolve(f.project,f.module,3,name),null);
 assert.equal(f.service.resolve(f.project,f.module,4,'[Then Else]').type,'Customer');
});
test('explicit parameter type is still qualified independently of default contents',()=>{
 const other={id:'library',name:'Library',kind:'module',code:'Public Enum Flags\nA=1\nEnd Enum\nPublic Sub Read(Optional value As Flags = A)\nEnd Sub'},f=fixture('',[other]);
 assert.equal(hint(f,'Library.Read ').params[0],'Optional value As Library.Flags = A');
 assert.equal(hint(f,'Library.Read ').parameters[0].type,'Library.Flags');
});
test('inferred argument types agree with compiler declaration metadata',async()=>{
 const {compileProject}=await import('../src/language/compiler.js');
 const other={id:'library',name:'Library',kind:'module',code:'DefInt A-Z\nPublic Sub Read(value)\nDebug.Print value\nEnd Sub'};
 const f=fixture('Sub Main()\nLibrary.Read 7\nEnd Sub',[other]);f.project.startup='Sub Main';
 const compiled=compileProject(f.project);assert.deepEqual(compiled.diagnostics,[]);
 const expected=compiled.modules.get('library').procedures.get('read').params[0].type;
 assert.equal(expected,'Integer');assert.equal(hint(f,'Library.Read ').parameters[0].type,expected);
});

for(const [original,expected] of [
 ['Optional value = "As Point"','Optional value As Integer = "As Point"'],
 ['ByRef [As Point]','ByRef [As Point] As Integer'],
 ['Optional [a=b] = "x=y"','Optional [a=b] As Integer = "x=y"'],
 ['value As String','value As String']
])test('inferred argument display preserves original token contents: '+original,async()=>{
 const {displayParameter}=await import('../src/editor/signature-syntax.js');
 assert.equal(displayParameter(original,{type:'Integer'}),expected);
});
