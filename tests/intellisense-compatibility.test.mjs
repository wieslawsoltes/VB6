import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorIntelligence,callContext,scanDeclarations} from '../src/editor/intelligence.js';
import {declarationTargets,handlerEdit} from '../src/editor/event-completion.js';
import {parseExpression} from '../src/language/expression.js';
import {tokenize} from '../src/language/lexer.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';

const fixture=(code='',others=[],kind='module')=>{const module={id:'m',name:'Main',kind,code},project={name:'Project1',modules:[module,...others],settings:{tabWidth:4}},service=new EditorIntelligence();return {module,project,service};};
const items=(f,text,line=text.split('\n').length)=>f.service.completions(f.project,f.module,line,text,text.length).items;
const names=(f,text,line)=>items(f,text,line).map(s=>s.name);
const cls=(name,code)=>({id:name,name,kind:'class',code});
const customer=cls('Customer','Public Name As String\nPublic Parent As Customer\nPublic Event Changed(ByVal Value As String)\nPublic Function Find(ByVal Key As String) As Customer\nEnd Function');
const resolve=(f,text,line=1)=>f.service.resolve(f.project,f.module,line,text);
const signature=(f,text,line=1)=>f.service.parameterInfo(f.project,f.module,line,text,text.length);

for(const [text,name,slot]of [
 ['items(0).Find ', 'items(0).Find',0],
 ['items(0).Find key:=', 'items(0).Find',0],
 ['items(0).Find("a").Find ', 'items(0).Find("a").Find',0],
 ['If ready Then MsgBox "hi", ', 'MsgBox',1],
 ['If ready Then Beep Else MsgBox "hi", ', 'MsgBox',1],
 ['Call MsgBox("hi", ', 'MsgBox',1],
])test('call context '+text,()=>{const f=fixture('Dim items() As Customer',[customer]);assert.equal(callContext(text,text.length).name,name);assert.equal(signature(f,text).active,slot);});

test('labels are procedure-local, navigable and excluded from ordinary lists',()=>{
 const source='Sub Work()\nOn Error GoTo Done\nGoSub Helper\n100 Debug.Print 1\nHelper: Return\nDone:\nEnd Sub\nSub Other()\nNotHere:\nEnd Sub',f=fixture(source);
 assert.deepEqual(names(f,'GoTo ',3),['100','Done','Helper']);assert.ok(!names(f,'',3).includes('Done'));
 const at=source.indexOf('Done')+2,hit=f.service.definition(f.project,f.module,2,source,at);
 assert.equal(hit.line,6);assert.equal(hit.kind,'label');assert.deepEqual(names(f,'GoTo ',9),['NotHere']);
});
test('same-line procedure offsets do not leak arguments',()=>{
 const source='Sub A(one As Long): End Sub: Sub B(two As Long): two: End Sub',f=fixture(source);
 const at=source.lastIndexOf('two')+3;
 const scope=f.service.scope(f.project,f.module,1,at);
 assert.equal(scope.proc.name,'B');assert.ok(scope.symbols.some(s=>s.name==='two'));assert.ok(!scope.symbols.some(s=>s.name==='one'));
});
test('typed module records resolve in their declaration scope',()=>{
 const other={id:'o',name:'Origin',kind:'module',code:'Public Type Position\nX As Long\nEnd Type\nPublic Point As Position'};
 const f=fixture('Private Type Position\nY As Long\nEnd Type',[other]);assert.deepEqual(names(f,'Origin.Point.'),['X']);
});
test('qualified class type names do not fabricate default instances',()=>{
 const f=fixture('',[customer]);assert.deepEqual(names(f,'Project1.Customer.'),[]);
 customer.attributes=['Attribute VB_PredeclaredId = True'];assert.ok(names(f,'Project1.Customer.').includes('Name'));delete customer.attributes;
});
test('events cannot be invoked or enumerated as object methods',()=>{
 const f=fixture('Dim c As Customer',[customer]);assert.ok(!names(f,'c.').includes('Changed'));assert.equal(resolve(f,'c.Changed'),null);
 const own=fixture('Public Event Changed(ByVal value As Long)\nSub Work()\nRaiseEvent Changed \nEnd Sub',[],'class');
 assert.deepEqual(names(own,'RaiseEvent ',3),['Changed']);assert.ok(!items(own,'RaiseEvent Changed ',3).some(i=>i.name==='value:='));
});
test('property Get returning a collection uses the collection default member',()=>{
 const library=cls('Library','Public Property Get Books() As BookList\nEnd Property');
 const f=fixture('Dim lib As Library',[library]);f.service.registerTypeLibrary('Types',[{name:'Book',members:[{name:'Title',type:'String'}]},{name:'BookList',defaultMember:'Item',members:[{name:'Item',type:'Book',params:['Index As Long']}]}]);
 assert.deepEqual(names(f,'lib.Books(0).'),['Title']);assert.equal(signature(f,'lib.Books(').params[0],'Index As Long');
});
test('array-valued Property Get indexes an element instead of pretending to call the getter',()=>{
 const library=cls('Library','Public Property Get All() As Customer()\nEnd Property'),f=fixture('Dim lib As Library',[library,customer]);
 assert.ok(names(f,'lib.All(0).').includes('Name'));assert.deepEqual(names(f,'lib.All.'),[]);
});
test('enum assignments retain their expectation across Or and explicit continuations',()=>{
 const f=fixture('Public Enum Options\nOne=1\nTwo=2\nEnd Enum\nDim flags As Options');
 for(const text of ['flags = One Or ','flags = One Or _\n  '])assert.deepEqual(names(f,text),['One','Two']);
 assert.ok(names(f,'MsgBox "hi", vbYesNo Or ').includes('vbDefaultButton2'));
});
test('indexed property assignments use the value type',()=>{
 const c=cls('Settings','Public Enum Options\nOne=1\nTwo=2\nEnd Enum\nPublic Property Let Values(ByVal Index As Long, ByVal Value As Options)\nEnd Property');
 const f=fixture('Dim config As Settings',[c]);assert.deepEqual(names(f,'config.Values(0) = '),['One','Two']);
});
test('a nested RHS call wins over the target assignment type',()=>{
 const f=fixture('Dim answer As Boolean');assert.ok(names(f,'answer = MsgBox("hi", ').includes('vbYesNo'));assert.ok(!names(f,'answer = MsgBox("hi", ').includes('True'));
});
test('typed intrinsic suffix variants remain individually selectable',()=>{
 const f=fixture();assert.ok(names(f,'Left').includes('Left$'));assert.ok(names(f,'Left').includes('Left'));assert.deepEqual(names(f,'Left$'),['Left$']);assert.equal(resolve(f,'Left$').type,'String');
});
test('string-key shorthand distinguishes a bang operator from Single suffix',()=>{
 assert.equal(parseExpression('fields!Name').kind,'call');assert.equal(tokenize('amount!')[0].value,'amount!');assert.equal(parseExpression('fields![Display Name]').args[0].value,'Display Name');
 const f=fixture('Dim rs As ADODB.Recordset');assert.ok(names(f,'rs.Fields!Name.').includes('Value'));
});
test('early-binding library descriptors qualify relative returns, parameters and default members',()=>{
 const f=fixture('Dim client As Remote.Client');f.service.registerTypeLibrary('Remote',[
  {name:'Client',members:[{name:'Child',type:'Client'},{name:'Find',type:'Client',params:['Key As Keys']}]},
  {name:'Keys',kind:'enum',members:[{name:'Primary',value:1},{name:'Secondary',value:2}]}
 ]);
 assert.ok(names(f,'client.Child.').includes('Find'));assert.deepEqual(names(f,'client.Find '),['Primary','Secondary']);assert.deepEqual(names(f,'Remote.Keys.'),['Primary','Secondary']);assert.ok(names(f,'Remote.').includes('Primary'));
 assert.ok(names(f,'Pri').includes('Primary'));assert.equal(resolve(f,'Primary').value,1);
});
test('module/global descriptors export members and preserve qualified names',()=>{
 const f=fixture();f.service.registerTypeLibrary('Tools',[{name:'Utilities',kind:'module',members:[{name:'Compute',type:'Long',params:['Value As Long']}]}]);
 assert.equal(resolve(f,'Compute').type,'Long');assert.equal(resolve(f,'Tools.Utilities.Compute').type,'Long');assert.ok(names(f,'Tools.').includes('Compute'));
});
test('interface descriptors belong in As/Implements but not New',()=>{
 const f=fixture();f.service.registerTypeLibrary('Lib',[{name:'IFoo',kind:'interface',members:[]},{name:'Abstract',creatable:false,members:[]},{name:'Concrete',members:[]}]);
 assert.ok(names(f,'Dim a As ').includes('Lib.IFoo'));assert.ok(names(f,'Implements ').includes('Lib.IFoo'));assert.ok(!names(f,'New ').includes('Lib.IFoo'));assert.ok(!names(f,'New ').includes('Lib.Abstract'));assert.ok(names(f,'New ').includes('Lib.Concrete'));
});
test('library aliases resolve with cycle bounds and disposer replacement ownership',()=>{
 const f=fixture('Dim value As Data.Handle');const dispose=f.service.registerTypeLibrary('Data',[{name:'Value',members:[{name:'Title',type:'String'}]},{name:'Handle',kind:'alias',target:'Value',members:[]}]);
 assert.deepEqual(names(f,'value.'),['Title']);f.service.registerTypeLibrary('Data',[{name:'Handle',members:[{name:'Updated',type:'Boolean'}]}]);assert.equal(dispose(),false);assert.deepEqual(names(f,'value.'),['Updated']);
 f.service.registerTypeLibrary('Data',[{name:'Handle',kind:'alias',target:'Loop',members:[]},{name:'Loop',kind:'alias',target:'Handle',members:[]}]);assert.deepEqual(names(f,'value.'),[]);
});
for(const types of [null,[null],[{name:'X',members:[null]}],[{name:'Bad\nEnd Sub',members:[]}],[{name:'X',members:[{name:'M',params:['ByVal x As Long\nEnd Sub']}]}],[{name:'X',members:[]},{name:'x',members:[]}]])test('invalid reference metadata rejected atomically '+JSON.stringify(types),()=>{
 const f=fixture('Dim x As Lib.X');f.service.registerTypeLibrary('Lib',[{name:'X',members:[{name:'Safe',type:'String'}]}]);assert.throws(()=>f.service.registerTypeLibrary('Lib',types));assert.deepEqual(names(f,'x.'),['Safe']);
});
test('metadata copies are detached from caller mutation',()=>{
 const f=fixture('Dim x As Lib.X'),types=[{name:'X',members:[{name:'Safe',type:'String'}]}];f.service.registerTypeLibrary('Lib',types);types[0].members.push({name:'Poison'});assert.deepEqual(names(f,'x.'),['Safe']);
});
test('WithEvents source and typed event signature populate classic dropdown targets',()=>{
 const f=fixture('Private WithEvents source As Customer',[customer],'class'),targets=declarationTargets(f.project,f.module,f.service);assert.ok(targets.some(t=>t.name==='Class'));
 const source=targets.find(t=>t.name==='source');assert.deepEqual(source.members.map(s=>s.name),['Changed']);const edit=handlerEdit(f.project,f.module,f.service,'source','Changed');assert.match(edit.text,/Private Sub source_Changed\(ByVal Value As String\)/);
 f.module.code+=edit.text;assert.ok(handlerEdit(f.project,f.module,f.service,'source','Changed').existing);
});
test('generated WithEvents sink is executable by the existing runtime',async()=>{
 const source=cls('Publisher','Public Event Changed(ByVal Value As Long)\nPublic Sub Send()\nRaiseEvent Changed(42)\nEnd Sub');
 const sink=cls('Sink','Private WithEvents source As Publisher\nPublic Received As Long\nPublic Sub Run()\nSet source = New Publisher\nsource.Send\nEnd Sub');
 const f=fixture('',[source,sink]);const edit=handlerEdit(f.project,sink,f.service,'source','Changed');sink.code+=edit.text.replace('    \n','    Received = Value\n');
 f.module.code='Public Sub Main()\nDim s As New Sink\ns.Run\nDebug.Print s.Received\nEnd Sub';const output=[];f.project.startup='Sub Main';
 const vm=new VirtualMachine(f.project,{print:value=>output.push(value),output:value=>output.push(value)});await vm.start();assert.ok(output.join(' ').includes('42'),JSON.stringify(output));
});
test('interface property Get/Let are separate stubs with exact parameter modes',()=>{
 const contract=cls('IThing','Public Function Read(ByRef Key As Long) As String\nEnd Function\nPublic Property Get Value() As String\nEnd Property\nPublic Property Let Value(ByVal NewValue As String)\nEnd Property');
 const f=fixture('Implements IThing',[contract],'class'),target=declarationTargets(f.project,f.module,f.service).find(t=>t.name==='IThing');assert.deepEqual(target.members.map(m=>m.key),['Read','Value:get','Value:let']);
 for(const key of ['Read','Value:get','Value:let']){const edit=handlerEdit(f.project,f.module,f.service,'IThing',key);assert.ok(edit);f.module.code+=edit.text;assert.ok(handlerEdit(f.project,f.module,f.service,'IThing',key).existing);}
 assert.match(f.module.code,/Private Function IThing_Read\(ByRef Key As Long\) As String/);assert.match(f.module.code,/Private Property Let IThing_Value\(ByVal NewValue As String\)/);
 assert.equal(compileProject(f.project).diagnostics.length,0);
});
test('array controls are deduplicated and handler templates include Index',()=>{
 const f=fixture('',[],'form');f.module.form={controls:[{name:'Timer1',type:'Timer',properties:{}},{name:'Text1',type:'TextBox',properties:{Index:0}},{name:'Text1',type:'TextBox',properties:{Index:1}}]};
 assert.equal(declarationTargets(f.project,f.module,f.service).filter(t=>t.name==='Text1').length,1);assert.match(handlerEdit(f.project,f.module,f.service,'Text1','KeyDown').text,/Index As Integer, KeyCode As Integer, Shift As Integer/);
 assert.deepEqual(declarationTargets(f.project,f.module,f.service).find(t=>t.name==='Timer1').members.map(m=>m.name),['Timer']);
});
test('source module constraints keep WithEvents and class lifecycle out of standard modules',()=>{
 const f=fixture('Private WithEvents source As Customer',[customer]);assert.deepEqual(declarationTargets(f.project,f.module,f.service),[]);assert.equal(handlerEdit(f.project,f.module,f.service,'source','Changed'),null);
});
test('external expression offsets preserve selected procedure locals',()=>{
 const f=fixture("' leading\n".repeat(25)+'Sub Work(ByVal who As Customer)\nDim local As Customer\nEnd Sub',[customer]);assert.ok(names(f,'local.',27).includes('Name'));assert.ok(names(f,'who.',27).includes('Name'));
});

test('Select Case uses the innermost selector enum without running it',()=>{
 const code='Public Enum Choices\nOne=1\nTwo=2\nEnd Enum\nSub Work()\nDim choice As Choices\nSelect Case choice\nCase \nEnd Select\nEnd Sub',f=fixture(code);
 assert.deepEqual(names(f,'Case ',8),['One','Two']);
});
test('reference priority and disabled metadata affect both type and constant resolution',()=>{
 const f=fixture('Dim x As Client');f.project.typeLibraries=['First','Second'].map(name=>({name,types:[{name:'Client',members:[{name:name+'Only',type:'Long'}]}]}));
 assert.deepEqual(names(f,'x.'),['FirstOnly']);f.project.typeLibraries.reverse();assert.deepEqual(names(f,'x.'),['SecondOnly']);f.project.typeLibraries[0].enabled=false;assert.deepEqual(names(f,'x.'),['FirstOnly']);
});
test('a Rem-prefixed name is not a comment and inline Rem is a comment',()=>{
 const f=fixture('Dim Remote As Customer',[customer]);assert.ok(names(f,'Remote.').includes('Name'));assert.deepEqual(names(f,'If True Then Rem Remote.'),[]);assert.equal(signature(f,'If True Then Rem MsgBox('),null);
});
test('intrinsic namespace lists match Object Browser categories',()=>{
 const f=fixture();assert.ok(names(f,'VBA.Strings.').includes('Left$'));assert.ok(!names(f,'VBA.Strings.').includes('MsgBox'));assert.ok(names(f,'VBA.Financial.').includes('RATE'));assert.ok(names(f,'Dim x As VBA.').includes('Long'));
 assert.deepEqual(names(f,'CStr(1).'),[]);assert.deepEqual(names(f,'MsgBox(1).'),[]);
});
test('array argument help reports rank and never offers named subscripts',()=>{
 const f=fixture('Dim array(0 To 4, 1 To Len("xx")) As Customer',[customer]);
 const symbol=resolve(f,'array');assert.equal(symbol.type,'Customer');assert.equal(symbol.rank,2);
 assert.equal(signature(f,'array(1, ').active,1);assert.equal(signature(f,'array(').params.length,2);
 assert.ok(!items(f,'array(').some(s=>s.name==='Index1:='));assert.ok(names(f,'array(0,1).').includes('Name'));
});
test('portable metadata cannot invoke getters or toJSON during registration',()=>{
 const f=fixture();let calls=0;const accessor={};Object.defineProperty(accessor,'name',{enumerable:true,get(){calls++;return 'X';}});
 assert.throws(()=>f.service.registerTypeLibrary('Lib',[accessor]),/accessors/);
 assert.throws(()=>f.service.registerTypeLibrary('Lib',[{name:'X',members:[],toJSON(){calls++;return this;}}]));assert.equal(calls,0);
});
test('unfinished source retains variables and constants in the Object Browser',async()=>{
 const {buildObjectCatalog}=await import('../src/ide/object-catalog.js');const f=fixture('Public Value As Long\nPublic Const Flag As Long = 1\nPublic Sub Unfinished()\nIf True Then');
 const main=buildObjectCatalog(f.project).find(c=>c.name==='Main');assert.ok(main.members.some(m=>m.name==='Value'));assert.ok(main.members.some(m=>m.name==='Flag'));
});


test('Object Browser and namespace completion share intrinsic categories and suffix variants',async()=>{
 const {buildObjectCatalog}=await import('../src/ide/object-catalog.js');
 const project={name:'Project1',modules:[]},catalog=buildObjectCatalog(project);
 const strings=catalog.find(c=>c.library==='VBA'&&c.name==='Strings');
 assert.ok(strings.members.some(m=>m.name==='Left'));assert.ok(strings.members.some(m=>m.name==='Left$'));
 assert.ok(catalog.find(c=>c.library==='VBA'&&c.name==='Financial').members.some(m=>m.name.toLowerCase()==='rate'));
 assert.ok(!strings.members.some(m=>m.name==='MsgBox'));
});
