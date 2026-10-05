import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorIntelligence,scanDeclarations,maskSource,callContext,wordAt} from '../src/editor/intelligence.js';
import {lexicalContext,expressionBefore} from '../src/editor/source-context.js';
import {BUILTIN_SIGNATURES} from '../src/runtime/signatures.js';
import {BUILTIN_SYMBOLS,TYPE_CATALOG,CONSTANT_SYMBOLS} from '../src/editor/type-catalog.js';
const make=(code,others=[],kind='module')=>{const module={id:'main',name:'Main',kind,code},project={name:'TestProject',modules:[module,...others]},service=new EditorIntelligence();return {module,project,service};};
const list=(f,text,options={})=>f.service.completions(f.project,f.module,text.split('\n').length,text,text.length,options).items;
const names=items=>items.map(x=>x.name);
const klass={id:'cls',name:'Customer',kind:'class',code:`Public Name As String
Private Secret As String
Public Parent As Customer
Public Function Create() As Customer
End Function
Public Property Get Child() As Customer
End Property
Public Property Let Score(ByVal Value As Long)
End Property
Public Event Changed(ByVal NewName As String)`};

for(const text of ['"','"abc.','"abc ""',"' x. ", 'Rem hello ', '#1/2/2020'])test('no suggestions in incomplete literal/comment: '+text,()=>assert.deepEqual(list(make(''),text),[]));
test('mask preserves numeric type suffixes and directives, not date contents',()=>{
 assert.equal(maskSource('Dim a#\na# = 1#\n#If Win32 Then'),'Dim a#\na# = 1#\n#If Win32 Then');
 assert.equal(maskSource('x = #1/2/2020#'),'x =           ');
 assert.equal(lexicalContext('"oops\nMe.').state,'code');
 assert.equal(maskSource('x = Rem + 1'),'x = Rem + 1');
 assert.equal(maskSource('[Rem] = 1: Rem hello'),'[Rem] = 1:          ');
});
test('declarations retain colon statements, Declare signatures and Events',()=>{
 const f=make('Private Declare Function GetTickCount Lib "kernel32" () As Long\nPublic Event Changed(ByVal Name As String)\nSub Run(): Dim a As Customer: Static b As Long: End Sub',[klass]);
 const idx=scanDeclarations(f.module);assert.equal(idx.procedures.length,1);assert.equal(idx.symbols.find(s=>s.name==='GetTickCount').external,true);assert.equal(idx.symbols.find(s=>s.name==='b').owner,'Run');assert.deepEqual(names(list(f,'RaiseEvent ')),['Changed']);
});
test('DefType, Unicode, bracket identifiers and fixed-length strings',()=>{
 const f=make('DefInt A-C\nDim apple, amount As Double, [Type] As Customer, żółć As Customer, fixed As String * 12',[klass]);
 for(const [name,type]of [['apple','Integer'],['amount','Double'],['[Type]','Customer'],['żółć','Customer'],['fixed','String']])assert.equal(f.service.resolve(f.project,f.module,2,name).type,type);
 assert.ok(names(list(f,'[Type].')).includes('Name'));assert.ok(names(list(f,'żółć.')).includes('Parent'));
});
test('accessor-local variables never leak across Get and Let of the same property',()=>{
 const f=make('Property Get Thing() As Long\nDim getOnly As Long\nEnd Property\nProperty Let Thing(ByVal setOnly As Long)\nDim setterLocal As Long\nEnd Property');
 const scope=f.service.scope(f.project,f.module,5);assert.ok(scope.symbols.some(s=>s.name==='setOnly'));assert.ok(!scope.symbols.some(s=>s.name==='getOnly'));
});
test('locals shadow module symbols in completion, not just in resolution',()=>{
 const f=make('Public item As Long\nSub Work()\nDim item As String\nitem\nEnd Sub');const items=f.service.completions(f.project,f.module,4,'item',4).items;assert.equal(items.find(s=>s.name==='item').type,'String');
});
test('class properties and methods chain through returns and array indexes',()=>{
 const f=make('Dim people() As Customer\nDim who As Customer',[klass]);
 for(const input of ['people(0).','who.Create().','who.Child.','(who).','who.Parent.Parent.']){const items=names(list(f,input));assert.ok(items.includes('Name'),input);assert.ok(!items.includes('Secret'),input);}
 assert.equal(list(f,'people.').length,0);assert.equal(list(f,'Customer.').length,0);
});
test('Property Let exposes value type rather than a fake getter argument',()=>{
 const f=make('Dim who As Customer',[klass]);const symbol=f.service.resolve(f.project,f.module,1,'who.Score');assert.equal(symbol.type,'Long');assert.equal(symbol.params.length,0);
});
test('With resolves nested and indexed receivers at full-buffer offsets',()=>{
 const code='Dim people() As Customer\nSub Work()\nWith people(0)\n With .Parent\n  .\n End With\nEnd With\nEnd Sub',f=make(code,[klass]);
 const pos=code.indexOf('  .')+3,items=f.service.completions(f.project,f.module,5,code,pos).items;assert.ok(names(items).includes('Name'));
 assert.equal(f.service.resolve(f.project,f.module,5,'.Parent.Name',{offset:pos}).type,'String');
});
test('With receivers support their own containing With but not siblings',()=>{
 const code='Dim who As Customer\nSub A()\nWith who\n.Name = "x"\nEnd With\nEnd Sub\nSub B()\n.\nEnd Sub',f=make(code,[klass]);const pos=code.lastIndexOf('\n.')+2;assert.deepEqual(f.service.completions(f.project,f.module,8,code,pos).items,[]);
});
test('As/New and namespace-qualified type completions',()=>{
 const f=make('',[klass]);assert.ok(names(list(f,'Dim x As ')).includes('Long'));assert.ok(names(list(f,'Dim x As New ')).includes('Customer'));assert.ok(!names(list(f,'Dim x As New ')).includes('Integer'));
 assert.ok(names(list(f,'Dim x As ADODB.')).includes('Connection'));assert.deepEqual(names(list(f,'Dim x As TestProject.Cus')),['Customer']);
});
test('constant list uses enum-typed assignment and Optional parameter slots',()=>{
 const f=make('Public Enum Direction\nNorth=1\nSouth=2\nEnd Enum\nDim side As Direction');assert.deepEqual(names(list(f,'side = ')),['North','South']);
 const buttons=names(list(f,'MsgBox "Hello", '));assert.ok(buttons.includes('vbYesNo'));assert.ok(!buttons.includes('vbRed'));
 const compare=names(list(f,'x = Replace("a", "b", "c", compare:= '));assert.deepEqual(compare,['vbBinaryCompare','vbTextCompare','vbUseCompareOption']);
});
test('Boolean and control property constants use declared types',()=>{
 const f=make('Dim ready As Boolean');assert.deepEqual(names(list(f,'ready = ')),['False','True']);
 f.module.kind='form';f.module.form={controls:[{name:'Check1',type:'CheckBox',properties:{}}]};assert.deepEqual(names(list(f,'Check1.Value = ')),['vbChecked','vbGrayed','vbUnchecked']);
});
test('unknown latebound Objects and Variants are never guessed',()=>{
 const f=make('Dim obj As Object, value As Variant');for(const text of ['obj.','value.','unknown.'])assert.deepEqual(list(f,text),[]);
});
test('runtime globals, control arrays, data field/default member chains',()=>{
 const f=make('Dim rs As ADODB.Recordset\nDim cn As ADODB.Connection');
 assert.ok(names(list(f,'Err.')).includes('Raise'));assert.ok(names(list(f,'App.')).includes('EXEName'));
 assert.ok(names(list(f,'rs.Fields(0).')).includes('Value'));assert.ok(names(list(f,'cn.Execute("select * from test").')).includes('Fields'));
 f.module.kind='form';f.module.form={controls:[{name:'Text1',type:'TextBox',properties:{Index:0}}]};assert.deepEqual(names(list(f,'Text1.')),['Count','Item','LBound','UBound']);assert.ok(names(list(f,'Text1(0).')).includes('Text'));
});
test('tree and list collection chains expose typed item fields',()=>{
 const f=make('','', 'form');f.project.modules=[f.module];f.module.form={controls:[{name:'Tree1',type:'TreeView',properties:{}},{name:'List1',type:'ListView',properties:{}}]};
 assert.ok(names(list(f,'Tree1.Nodes.Add().Parent.')).includes('Text'));assert.ok(names(list(f,'List1.ListItems(1).')).includes('SubItems'));
});
test('default project member metadata and hidden/restricted attributes',()=>{
 const cls={...klass,attributes:['Attribute Child.VB_UserMemId = 0','Attribute Create.VB_MemberFlags = "40"']},f=make('Dim who As Customer',[cls]);assert.ok(names(list(f,'who().')).includes('Name'));assert.ok(!names(list(f,'who.')).includes('Create'));
});
test('inactive conditional branches do not pollute symbols; edits invalidate cache',()=>{
 const f=make('#If Win32 Then\nPublic nativeOnly As Long\n#Else\nPublic browserOnly As Long\n#End If');assert.ok(!names(list(f,'')).includes('nativeOnly'));assert.ok(names(list(f,'')).includes('browserOnly'));
 f.project.settings={conditionalConstants:{Win32:-1}};assert.ok(names(list(f,'')).includes('nativeOnly'));assert.ok(!names(list(f,'')).includes('browserOnly'));
});
test('named, omitted, nested and ParamArray argument help',()=>{
 const f=make('Sub Work(ByVal first As String, Optional ByRef count As Long = 2, ParamArray rest() As Variant)\nEnd Sub');
 for(const [text,active]of [['Work "x", ',1],['Work "x", , 1, 2, ',2],['Work count:=',1]])assert.equal(f.service.parameterInfo(f.project,f.module,1,text,text.length).active,active,text);
 const text='MsgBox Format(123, ';assert.equal(callContext(text,text.length).name,'Format');assert.equal(callContext(text,text.length,{outer:true}).name,'MsgBox');
 const colon='x = 1: Work "a,b", ';assert.equal(callContext(colon,colon.length).comma,1);
});
test('parameter help for With method and indexed typed receivers',()=>{
 const f=make('Dim who As Customer\nSub Go()\nWith who\n.Create(\nEnd With\nEnd Sub',[klass]),text=f.module.code.slice(0,f.module.code.indexOf('.Create(')+8);assert.equal(f.service.parameterInfo(f.project,f.module,4,text,text.length).name,'Create');
});
test('named argument completion offers insertion syntax and excludes already-used names',()=>{
 const f=make('Sub Work(ByVal first As String, Optional count As Long)\nEnd Sub');const items=list(f,'Work first:="x", co');assert.ok(items.some(i=>i.name==='count:='&&i.insertText==='count:='));assert.ok(!list(f,'Work first:="x", ').some(i=>i.name==='first:='));
});
test('imported type metadata is case insensitive, persists on references, and can be unregistered',()=>{
 const f=make('Dim client As Example.Client');const types=[{name:'Client',members:[{name:'Name',type:'String'},{name:'GetChild',type:'Example.Client',params:['Key As Long']}]}];
 const unregister=f.service.registerTypeLibrary('Example',types);assert.ok(names(list(f,'client.GetChild(1).')).includes('Name'));unregister();assert.deepEqual(list(f,'client.'),[]);
 f.project.references=[{kind:'Reference',value:'original-native-reference',typeLibrary:{name:'Example',types}}];assert.ok(names(list(f,'client.')).includes('GetChild'));types[0].members.push({name:'Updated',type:'Boolean'});assert.ok(names(list(f,'client.')).includes('Updated'));f.project.references=[];assert.deepEqual(list(f,'client.'),[]);
});
test('reference metadata hidden members are excluded and malformed descriptors rejected',()=>{
 const f=make('Dim x As X.C');assert.throws(()=>f.service.registerTypeLibrary('X',[{name:'C',members:[{name:'Invalid',params:[0]}]}]),/Invalid/);
 f.service.registerTypeLibrary('X',[{name:'C',members:[{name:'Hidden',hidden:true},{name:'Safe',type:'Long'}]}]);assert.deepEqual(names(list(f,'x.')),['Safe']);
});
test('all runtime named-argument signatures and constants have catalog entries',()=>{
 for(const name of Object.keys(BUILTIN_SIGNATURES))assert.ok(BUILTIN_SYMBOLS.some(s=>s.name===name),name);assert.ok(CONSTANT_SYMBOLS.length>200);assert.ok(TYPE_CATALOG.size>60);
});
test('word boundaries include arrays and chained expressions without evaluating them',()=>{
 assert.equal(wordAt('Debug.Print people(0).Name',25).text,'people(0).Name');assert.equal(expressionBefore('x = GetCustomer(1).Child').text,'GetCustomer(1).Child');
});
test('cache invalidates source, metadata, removed modules and live unsaved snapshots',()=>{
 const f=make('Dim person As Customer',[klass]);list(f,'person.');const count=f.service.scanCount;for(let i=0;i<20;i++)list(f,'person.');assert.equal(f.service.scanCount,count);
 const live={...f.module,code:f.module.code+'\nPublic Unsaved As Long'};assert.ok(f.service.resolve(f.project,live,2,'Main.Unsaved'));f.project.modules=[f.module];assert.deepEqual(list(f,'person.'),[]);assert.equal(f.service.cache.has('cls'),false);
});
test('bounded syntax tree cache does not invoke user callbacks, getters or native constructors',()=>{
 const f=make('Dim x As Customer',[klass]);let invoked=0;f.project.runtime={get Customer(){invoked++;throw Error('executed');}};for(let i=0;i<300;i++)f.service.resolve(f.project,f.module,1,'x.Create('+i+').Name');assert.equal(invoked,0);assert.ok(f.service.expressionCache.size<=128);
});
