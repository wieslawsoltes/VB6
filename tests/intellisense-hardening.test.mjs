import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorIntelligence,callContext,wordAt} from '../src/editor/intelligence.js';
import {lexicalContext,completionSpan} from '../src/editor/source-context.js';
import {declarationTargets,handlerEdit} from '../src/editor/event-completion.js';
import {compileProject} from '../src/language/compiler.js';

const make=(code='',other=[],kind='module')=>{const module={id:'m',name:'Main',kind,code},project={name:'Project1',modules:[module,...other],settings:{tabWidth:4}},service=new EditorIntelligence();return {module,project,service};};
const complete=(f,text=f.module.code)=>f.service.completions(f.project,f.module,text.split('\n').length,text,text.length).items.map(m=>m.name);
const register=(f,params)=>f.service.registerTypeLibrary('Example',[{name:'IEvents',members:[{name:'Changed',kind:'event',type:'Void',params}]}]);
for(const parameter of ['Key As Long): Debug.Print 9 \'', 'Key As Long: Stop', 'Key As Long \' injected', 'Optional Key As Long = Shell("calc")', 'Optional Key As Long = 1, Other As Long','Key As Long = 1','Optional Key As String = "unterminated']){
 test('reference parameters reject executable or malformed suffix: '+parameter,()=>assert.throws(()=>register(make(),[parameter]),/parameter|descriptor/i));
}
test('parameter metadata retains safe optional constants and bracket names',()=>{
 const f=make();register(f,['ByRef [Display Name] As String','Optional Delimiter As String = ":,\"\""','Optional Minimum As Long = -1']);
 assert.equal(f.service.referenceTypes(f.project)[0].members[0].params[1],'Optional Delimiter As String = ":,\"\""');
});
test('invalid metadata cannot replace a previously registered library',()=>{
 const f=make();register(f,['ByVal Key As Long']);assert.throws(()=>register(f,['Key As Long: Stop']));assert.equal(f.service.referenceTypes(f.project)[0].members[0].params[0],'ByVal Key As Long');
});
test('bracket completion replaces the entire name including spaces to the right',()=>{
 const text='item.[Display Name]';const caret=text.indexOf('play');const span=completionSpan(text,caret);
 assert.equal(span.start,5);assert.equal(span.end,text.length);assert.equal(wordAt(text,caret).text,text);
});
test('complete bracket name is a whole token for Quick Info',()=>{
 const f=make('Dim [Display Name] As Long');assert.equal(wordAt('Debug.Print [Display Name]',16).text,'[Display Name]');
 assert.equal(f.service.resolve(f.project,f.module,1,wordAt('[Display Name]',5).text).type,'Long');
});
test('numeric labels leave the following call and comment in statement scope',()=>{
 assert.equal(callContext('100 MsgBox "Hello", ',20)?.name,'MsgBox');
 assert.equal(lexicalContext('100 Rem do not complete').state,'comment');
 assert.deepEqual(complete(make(), '100 Rem do not complete'),[]);
});
test('bare opening date delimiters are not completion contexts',()=>assert.deepEqual(complete(make('Dim x As Date'), 'x = #'),[]));
test('multiple file channels are not accidentally masked as a date literal',()=>{
 assert.equal(lexicalContext('Close #1, #2').masked,'Close #1, #2');
 assert.equal(lexicalContext('Print #1, "x": Close #2').masked,'Print #1,    : Close #2');
});
test('zero-argument array getter supplies subscript parameter information',()=>{
 const f=make('Public Property Get Values() As Long()\nEnd Property');const text='Values(';const info=f.service.parameterInfo(f.project,f.module,2,text,text.length);
 assert.ok(info);assert.equal(info.kind,'array');assert.deepEqual(info.params,['Index1 As Long']);
});
test('instance-only runtime metadata is never offered by As New',()=>{
 const list=complete(make(),'Dim value As New ');for(const name of ['App','Screen','Clipboard','Debug','ErrObject','Forms','MDIForm','ADODB.Field','ADODB.Fields','Node','Scripting.TextStream'])assert.ok(!list.includes(name),name);
 for(const name of ['Collection','ADODB.Connection','ADODB.Recordset','Scripting.Dictionary','Scripting.FileSystemObject'])assert.ok(list.includes(name),name);
});
test('MDI form project modules are not New candidates either',()=>{
 const m={id:'mdi',name:'MDIForm1',kind:'form',code:'',form:{type:'MDIForm',controls:[],properties:{}}};assert.ok(!complete(make('',[m]),'Dim f As New ').includes('MDIForm1'));
});
test('public interface variables generate the accessors required by the compiler',()=>{
 const contract={id:'iface',name:'IState',kind:'class',code:'Public Count As Long\nPublic Child As IState'},f=make('Implements IState',[contract],'class');
 const target=declarationTargets(f.project,f.module,f.service).find(t=>t.name==='IState');
 assert.deepEqual(target.members.map(m=>m.key).sort(),['Child:get','Child:set','Count:get','Count:let']);
 for(const key of ['Count:get','Count:let','Child:get','Child:set']){const edit=handlerEdit(f.project,f.module,f.service,'IState',key);assert.ok(edit,key);f.module.code+=edit.text;}
 f.project.startup='Sub Main';f.project.modules.push({id:'start',name:'Startup',kind:'module',code:'Public Sub Main()\nEnd Sub'});
 assert.deepEqual(compileProject(f.project).diagnostics,[]);
});
test('control-array and menu-array dropdowns are deduplicated with Index signatures',()=>{
 const f=make('',[],'form');f.module.form={type:'Form',controls:[],menus:[{id:'1',name:'mnuItem',properties:{Index:0}},{id:'2',name:'mnuItem',properties:{Index:1}}]};
 const menus=declarationTargets(f.project,f.module,f.service).filter(t=>t.name==='mnuItem');assert.equal(menus.length,1);assert.deepEqual(menus[0].members[0].params,['Index As Integer']);
});
test('invalid event parameter syntax cannot be copied into a generated handler',()=>{
 const source={id:'source',name:'Publisher',kind:'class',code:'Public Event Changed(Key As Long) As Long: Stop'},f=make('Private WithEvents source As Publisher',[source],'class');
 // A validated metadata source is covered above. Direct source may be unfinished;
 // only its actual parsed parameter list can be copied, never its statement tail.
 const edit=handlerEdit(f.project,f.module,f.service,'source','Changed');assert.ok(edit);assert.ok(!edit.text.includes('Stop'));
});
test('inactive conditional source lines do not show automatic or explicit lists',()=>{
 const code='#If False Then\nSub Dormant()\nDim obj As Collection\nobj.\nEnd Sub\n#End If',f=make(code),offset=code.indexOf('obj.')+4;
 assert.deepEqual(f.service.completions(f.project,f.module,4,code,offset).items,[]);
});
test('DAO catalog describes its own edit, workspace, query and schema contracts',()=>{
 const f=make('Dim rs As DAO.Recordset\nDim db As DAO.Database');const members=complete(f,'rs.');
 for(const name of ['Edit','FindFirst','Seek','CopyQueryDef','LastModified'])assert.ok(members.includes(name),name);
 assert.ok(!members.includes('UpdateBatch'));assert.ok(!members.includes('ActiveConnection'));
 for(const expr of ['db.QueryDefs("Query").Parameters(0).','DBEngine.Workspaces(0).Databases(0).CreateQueryDef().Parameters(0).'])assert.ok(complete(f,expr).includes('Value'),expr);
 assert.ok(complete(f,'db.CreateTableDef().CreateIndex().Fields.').includes('Append'));
 assert.ok(complete(f,'rs.CopyQueryDef().').includes('SQL'));
 assert.equal(f.service.resolve(f.project,f.module,1,'rs.Fields(0)').type,'DAO.Field');
 assert.equal(f.service.parameterInfo(f.project,f.module,1,'rs.Fields(0).GetChunk(',22).params.length,2);
});
test('DAO argument constants and factory aliases preserve their own enums',()=>{
 const f=make('Dim db As DAO.Database');const source='db.OpenRecordset "items", ';
 assert.deepEqual(complete(f,source),['dbOpenDynaset','dbOpenForwardOnly','dbOpenSnapshot','dbOpenTable']);
 assert.ok(complete(make('Dim engine As DAO.DBEngine.120'),'engine.').includes('Workspaces'));
 const info=f.service.parameterInfo(f.project,f.module,1,'db.CreateTableDef().CreateField "id", ',38);assert.equal(info.parameters[info.active].type,'DAO.DataTypeEnum');
});
test('reference descriptors reject unvalidated internal accessors and unsafe accessor kinds',()=>{
 const f=make();for(const raw of [{name:'Name',accessors:[{name:'Evil',type:'Long: Stop',params:[]}]},{name:'Name',accessor:'Get(): Stop'},{name:'Name',params:[],kind:'private function hacked'}])
 assert.throws(()=>f.service.registerTypeLibrary('Lib',[{name:'Contract',members:[raw]}]),/descriptor|accessor/i);
});
test('portable property accessors are coalesced and remain individually generatable',()=>{
 const f=make('Implements Lib.IState',[],'class');f.service.registerTypeLibrary('Lib',[{name:'IState',kind:'interface',members:[{name:'Value',kind:'property',accessor:'get',type:'Long',params:[]},{name:'Value',kind:'property',accessor:'let',type:'Long',params:['ByVal RHS As Long']}]}]);
 const target=declarationTargets(f.project,f.module,f.service).find(t=>t.name==='IState');assert.deepEqual(target.members.map(m=>m.key),['Value:get','Value:let']);
 assert.equal(f.service.members(f.project,f.module,'Lib.IState').filter(s=>s.name==='Value').length,1);
 assert.match(handlerEdit(f.project,f.module,f.service,'IState','Value:let').text,/Private Property Let IState_Value\(ByVal RHS As Long\)/);
});
