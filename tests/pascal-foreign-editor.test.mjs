import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {LanguageClient} from '../src/editor/advanced/client.js';
import {messagePortTransport} from '../src/editor/advanced/rpc.js';
import {BuiltinLanguageServer} from '../src/editor/advanced/builtin-server.js';
import {compileProject} from '../src/language/compiler.js';

const main = `program Main;
var N: Integer; Box: Counter;
begin
  N := 1;
  Helper.Increment(N);
  Box := Factory.Make();
  Box.Store(N);
  Helper.Bump(Helper.Items);
  N := Helper.Total(1, 2, 3);
  Helper.Describe();
  WriteLn(Box.Value, CounterReady)
end.
`;
const helper = `Public Items(0 To 1) As Integer
Public Sub Increment(ByRef Value As Integer, Optional ByVal Amount As Integer = 2)
Value = Value + Amount
End Sub
Public Sub Bump(ByRef Values() As Integer)
Values(0) = Values(0) + 1
End Sub
Public Function Total(ParamArray Values() As Variant) As Integer
Total = 0
End Function
Public Sub Describe(Optional ByVal Caption As String = "As=, text")
End Sub
Private Sub Secret()
End Sub
`;
const counter = `Public Value As Integer
Public Sub Store(ByVal NextValue As Integer)
Value = NextValue
End Sub
Private Hidden As Integer
Public Enum CounterState
CounterReady = 3
End Enum
`;
function fixture() {
  return {id:'foreign-editor',schema:1,name:'ForeignEditor',language:'pascal',startup:'Sub Main',settings:{},modules:[
    {id:'main',name:'Main',kind:'module',language:'pascal',code:main},
    {id:'helper',name:'Helper',kind:'module',language:'vb6',code:helper},
    {id:'counter',name:'Counter',kind:'class',language:'vb6',code:counter},
    {id:'factory',name:'Factory',kind:'module',language:'vb6',code:'Public Function Make() As Counter\nSet Make = New Counter\nEnd Function'},
  ]};
}
async function workspace(t) {
  const project=fixture(),{port1,port2}=new MessageChannel();
  const server=new BuiltinLanguageServer(messagePortTransport(port1),{diagnosticDelay:60000}),client=new LanguageClient(messagePortTransport(port2));
  t.after(()=>{client.dispose();server.dispose();});await client.initialize();
  const uris=Object.fromEntries(project.modules.map(module=>[module.id,'file:///workspace/'+module.name+(module.language==='pascal'?'.pas':module.kind==='class'?'.cls':'.bas')]));
  client.notify('vb6/project',{project,documents:project.modules.map(module=>({moduleId:module.id,uri:uris[module.id],languageId:module.language}))});
  for(const module of project.modules)client.open(uris[module.id],module.language,module.code);
  const at=(needle,id='main')=>{
    const document=client.documents.get(uris[id]),offset=document.text.indexOf(needle);
    assert.notEqual(offset,-1,'Fixture position must exist: '+needle);
    return {textDocument:{uri:uris[id]},position:document.positionAt(offset+needle.length)};
  };
  const change=(id,text)=>{
    const module=project.modules.find(module=>module.id===id);module.code=text;
    client.change(uris[id],[{text}],client.documents.get(uris[id]).version+1);
  };
  const diagnostic=previousResultId=>client.request('textDocument/diagnostic',{textDocument:{uri:uris.main},...(previousResultId?{previousResultId}:{})});
  return {project,client,uris,at,change,diagnostic};
}
const labels=result=>result.items.map(item=>item.label);

test('Pascal LSP imports public VB globals and resolves class members through instances',async t=>{
  const {project,client,uris,at}=await workspace(t);
  assert.deepEqual(compileProject(project).diagnostics,[]);
  const globals=labels(await client.request('textDocument/completion',at('begin\n')));
  for(const name of ['Helper','Counter','Increment','CounterState','CounterReady'])assert.ok(globals.includes(name),name);
  for(const name of ['Store','Value','Hidden','Secret'])assert.ok(!globals.includes(name),'not a public project global: '+name);
  const members=labels(await client.request('textDocument/completion',at('  Box.')));
  assert.ok(members.includes('Store'));assert.ok(members.includes('Value'));assert.ok(!members.includes('Hidden'));
  const helperMembers=labels(await client.request('textDocument/completion',at('  Helper.')));
  assert.ok(helperMembers.includes('Increment'));assert.ok(!helperMembers.includes('Secret'));
  const definition=await client.request('textDocument/definition',at('Box.St'));
  assert.equal(definition[0].uri,uris.counter);assert.equal(definition[0].range.start.line,1);
  const enumeration=await client.request('textDocument/definition',at('WriteLn(Box.Value, CounterRe'));
  assert.equal(enumeration[0].uri,uris.counter);assert.equal(enumeration[0].range.start.line,6);
  project.modules[0].code=main.replace('Box.Store(N)','Store(N)');
  assert.equal(compileProject(project).valid,false,'an instance method cannot be called as a bare global');
});

test('Pascal LSP keeps optional defaults, array references and variadic VB call contracts in signatures',async t=>{
  const {project,client,uris,at}=await workspace(t);
  assert.deepEqual(compileProject(project).diagnostics,[]);
  const signature=async needle=>(await client.request('textDocument/signatureHelp',at(needle))).signatures[0];
  assert.equal((await signature('Helper.Increment(')).label,'Increment(var Value: Integer; [Amount: Integer = 2])');
  assert.equal((await signature('Helper.Bump(')).label,'Bump(var Values: array of Integer)');
  const variadic=await client.request('textDocument/signatureHelp',at('Helper.Total(1, 2, '));
  assert.equal(variadic.signatures[0].label,'Total(Values: array of Variant...): Integer');assert.equal(variadic.activeParameter,0);
  assert.equal((await signature('Helper.Describe(')).label,'Describe([Caption: String = "As=, text"])');
  assert.equal((await signature('Box.Store(')).label,'Store(NextValue: Integer)');
  const hints=await client.request('textDocument/inlayHint',{textDocument:{uri:uris.main},range:{start:{line:0,character:0},end:client.documents.get(uris.main).positionAt(main.length)}});
  assert.deepEqual(hints.filter(hint=>hint.position.line===7).map(hint=>hint.tooltip.value),['var Values: array of Integer']);
  assert.deepEqual(hints.filter(hint=>hint.position.line===8).map(hint=>hint.tooltip.value),Array(3).fill('Values: array of Variant...'));
});

test('a VB-only signature change refreshes Pascal LSP diagnostics and signature help without reopening Pascal',async t=>{
  const {project,client,uris,at,change,diagnostic}=await workspace(t);
  const before=await diagnostic();assert.deepEqual(before.items,[]);
  assert.equal((await diagnostic(before.resultId)).kind,'unchanged');
  change('helper',helper.replace('ByRef Value As Integer','ByRef Value As Long'));
  const signature=await client.request('textDocument/signatureHelp',at('Helper.Increment('));
  assert.match(signature.signatures[0].label,/var Value: Long/);
  const changed=await diagnostic(before.resultId),compiled=compileProject(project);
  assert.equal(compiled.valid,false);assert.equal(changed.kind,'full');assert.notEqual(changed.resultId,before.resultId);
  assert.deepEqual(changed.items.map(item=>item.message),compiled.diagnostics.filter(item=>item.source==='Main').map(item=>item.message));
  assert.match(changed.items[0].message,/ByRef parameter/);assert.equal(changed.items[0].range.start.line,4);
  assert.equal(client.documents.get(uris.main).version,1);
  change('helper',helper);
  const restored=await diagnostic(changed.resultId);assert.equal(restored.kind,'full');assert.deepEqual(restored.items,[]);
  assert.equal(compileProject(project).valid,true);assert.equal(client.documents.get(uris.main).version,1);
});

test('a changed VB class member invalidates Pascal completions, navigation and diagnostics together',async t=>{
  const {project,client,uris,at,change,diagnostic}=await workspace(t);
  const before=await diagnostic();assert.deepEqual(before.items,[]);
  await client.request('textDocument/completion',at('  Box.'));
  await client.request('textDocument/definition',at('Box.St'));
  change('counter',counter.replace('Sub Store','Sub Put'));
  const members=labels(await client.request('textDocument/completion',at('  Box.')));
  assert.ok(members.includes('Put'));assert.ok(!members.includes('Store'));
  assert.equal(await client.request('textDocument/signatureHelp',at('Box.Store(')),null);
  assert.deepEqual(await client.request('textDocument/definition',at('Box.St')),[]);
  const changed=await diagnostic(before.resultId);assert.equal(changed.kind,'full');assert.match(changed.items[0].message,/not exported/);
  assert.equal(compileProject(project).valid,false);
  change('main',main.replace('Box.Store','Box.Put'));
  const restored=await diagnostic(changed.resultId);assert.deepEqual(restored.items,[]);assert.equal(compileProject(project).valid,true);
  const definition=await client.request('textDocument/definition',at('Box.Pu'));
  assert.equal(definition[0].uri,uris.counter);assert.equal(definition[0].range.start.line,1);
});
