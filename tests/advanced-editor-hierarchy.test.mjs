import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {LanguageClient} from '../src/editor/advanced/client.js';
import {messagePortTransport} from '../src/editor/advanced/rpc.js';
import {BuiltinLanguageServer} from '../src/editor/advanced/builtin-server.js';

async function workspace(t,modules) {
  const {port1,port2}=new MessageChannel(),server=new BuiltinLanguageServer(messagePortTransport(port1),{diagnosticDelay:60000}),client=new LanguageClient(messagePortTransport(port2));
  t.after(()=>{client.dispose();server.dispose();});await client.initialize();
  const documents=modules.map(m=>({moduleId:m.id,languageId:'vb6',uri:'vb6-editor://workspace/'+m.name+'.bas'}));
  client.notify('vb6/project',{project:{id:'test',name:'Test',settings:{},modules},documents});
  for(const m of modules)client.open(documents.find(d=>d.moduleId===m.id).uri,'vb6',m.code);
  const at=(name,needle,n=0)=>{const document=client.documents.get('vb6-editor://workspace/'+name+'.bas');let index=-1;for(let i=0;i<=n;i++)index=document.text.indexOf(needle,index+1);assert.ok(index>=0,needle);return {textDocument:{uri:document.uri},position:document.positionAt(index+1)};};
  return {client,server,at};
}
const math={id:'math',name:'Math',kind:'module',code:'Public Function Add(ByVal n As Long) As Long\n  Add = n\n  If n > 1 Then Add = Add(n - 1)\nEnd Function\n'};
const main={id:'main',name:'Main',kind:'module',code:'Public Sub Run()\n  Dim value As Long\n  value = Add(1) + Add(2)\n  Debug.Print "Add(3)"\n  \' Add(4)\n#If 0 Then\n  value = Add(5)\n#End If\nEnd Sub\nPrivate Sub Shadow()\n  Dim Add As Long\n  Add = 9\nEnd Sub\n'};
test('call hierarchy binds calls, groups call sites and excludes strings/comments/inactive code/shadowed locals',async t=>{
  const {client,at}=await workspace(t,[math,main]);
  const [item]=await client.request('textDocument/prepareCallHierarchy',at('Math','Add'));
  const incoming=await client.request('callHierarchy/incomingCalls',{item});
  assert.deepEqual(incoming.map(e=>[e.from.name,e.fromRanges.length]).sort(),[['Add',1],['Run',2]]);
  const run=incoming.find(e=>e.from.name==='Run').from;
  const outgoing=await client.request('callHierarchy/outgoingCalls',{item:run});
  assert.equal(outgoing.length,1);assert.equal(outgoing[0].to.name,'Add');assert.equal(outgoing[0].fromRanges.length,2);
  const recursive=await client.request('callHierarchy/outgoingCalls',{item});assert.equal(recursive[0].fromRanges.length,1);
});
test('hierarchy items reject changes anywhere in the workspace, including close/reopen',async t=>{
  const {client,at}=await workspace(t,[math,main]);const [item]=await client.request('textDocument/prepareCallHierarchy',at('Math','Add'));
  const uri=at('Main','Run').textDocument.uri;client.close(uri);client.open(uri,'vb6',main.code,1);
  await assert.rejects(client.request('callHierarchy/incomingCalls',{item}),{code:-32801});
});
const intf={id:'interface',name:'IFoo',kind:'class',code:'Public Sub Ping()\nEnd Sub\n'};
const cls={id:'impl',name:'Worker',kind:'class',code:'Implements IFoo\nPrivate Sub IFoo_Ping()\nEnd Sub\n'};
const caller={id:'caller',name:'Caller',kind:'module',code:'Public Sub Run()\n  Dim x As IFoo\n  x.Ping\nEnd Sub\n'};
test('type hierarchy describes Implements relationships and resolves interface member implementation',async t=>{
  const {client,at}=await workspace(t,[intf,cls,caller]);
  const [item]=await client.request('textDocument/prepareTypeHierarchy',at('Caller','x.Ping'));
  assert.equal(item.name,'IFoo');
  const subs=await client.request('typeHierarchy/subtypes',{item});assert.deepEqual(subs.map(x=>x.name),['Worker']);
  const supers=await client.request('typeHierarchy/supertypes',{item:subs[0]});assert.deepEqual(supers.map(x=>x.name),['IFoo']);
  const locations=await client.request('textDocument/implementation',at('Caller','Ping'));
  assert.equal(locations[0].uri,'vb6-editor://workspace/Worker.bas');assert.equal(locations[0].range.start.line,1);
  const types=await client.request('textDocument/typeDefinition',at('Caller','x.Ping'));
  assert.equal(types[0].uri,'vb6-editor://workspace/IFoo.bas');
});
test('call hierarchy remains static for interface calls, with implementation navigation separate',async t=>{
  const {client,at}=await workspace(t,[intf,cls,caller]);const [item]=await client.request('textDocument/prepareCallHierarchy',at('Caller','Run'));
  const calls=await client.request('callHierarchy/outgoingCalls',{item});
  assert.equal(calls[0].to.name,'Ping');assert.equal(calls[0].to.uri,'vb6-editor://workspace/IFoo.bas');
});
test('hierarchy queries do not execute source and already-cancelled traversal is rejected',async t=>{
  const {client,at}=await workspace(t,[math,main]);const [item]=await client.request('textDocument/prepareCallHierarchy',at('Main','Run'));
  const abort=new AbortController();abort.abort();await assert.rejects(client.request('callHierarchy/outgoingCalls',{item},{signal:abort.signal}),{code:-32800});
});

test('colon-separated procedure bodies are calls, qualified AddressOf is not',async t=>{
  const module={id:'main',name:'Main',kind:'module',code:'Public Sub Run(): Call Add(1): End Sub\nPublic Sub Register()\n  Dim callback As Long\n  callback = AddressOf Math.Add\nEnd Sub\n'};
  const {client,at}=await workspace(t,[math,module]);
  const [item]=await client.request('textDocument/prepareCallHierarchy',at('Math','Add'));
  const calls=await client.request('callHierarchy/incomingCalls',{item});
  assert.deepEqual(calls.map(x=>x.from.name).sort(),['Add','Run']);
});
