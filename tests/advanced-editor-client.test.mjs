import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {JsonRpcPeer,messagePortTransport} from '../src/editor/advanced/rpc.js';
import {LanguageClient,languageClientCapabilities} from '../src/editor/advanced/client.js';

async function session(t,capabilities={textDocumentSync:2,hoverProvider:true}) {
  const {port1,port2}=new MessageChannel(),server=new JsonRpcPeer(messagePortTransport(port1)),client=new LanguageClient(messagePortTransport(port2));
  server.onRequest('initialize',()=>({capabilities}));server.onRequest('barrier',()=>true);
  t.after(()=>{client.dispose();server.close();});await client.initialize();return {client,server};
}
const uri='vb6-editor://workspace/demo/Module1.bas';
test('close and reopen with the same version cannot accept a stale response',async t=>{
  const {client,server}=await session(t);let finish,started;
  const wait=new Promise(r=>started=r);server.onRequest('textDocument/hover',()=>new Promise(resolve=>{finish=resolve;started();}));
  client.open(uri,'vb6','old',1);const result=client.request('textDocument/hover',{textDocument:{uri}});await wait;
  client.close(uri);client.open(uri,'vb6','new',1);finish({contents:'stale'});
  await assert.rejects(result,{code:-32801});
});
test('None text synchronization emits no open, change or close notifications',async t=>{
  const {client,server}=await session(t,{textDocumentSync:0});const seen=[];
  for(const method of ['didOpen','didChange','didClose'])server.onNotification('textDocument/'+method,p=>seen.push(p));
  client.open(uri,'vb6','a');client.change(uri,[{text:'b'}],2);client.close(uri);await client.request('barrier',{});
  assert.deepEqual(seen,[]);
});
test('dynamic sync and save registrations respect selectors and unregister',async t=>{
  const {client,server}=await session(t,{}),messages=[];
  for(const method of ['didOpen','didChange','willSave','didSave'])server.onNotification('textDocument/'+method,p=>messages.push({method,p}));
  client.open(uri,'vb6','a');client.open('vb6-editor://workspace/demo/Form1.xaml','xaml','<a/>');
  await server.request('client/registerCapability',{registrations:[
    {id:'open',method:'textDocument/didOpen',registerOptions:{documentSelector:[{language:'vb6',scheme:'vb6-editor',pattern:'**/*.bas'}]}},
    {id:'change',method:'textDocument/didChange',registerOptions:{documentSelector:[{language:'vb6'}],syncKind:1}},
    {id:'willSave',method:'textDocument/willSave',registerOptions:{documentSelector:[{language:'vb6'}]}},
    {id:'save',method:'textDocument/didSave',registerOptions:{documentSelector:[{language:'vb6'}],includeText:true}},
  ]});
  client.change(uri,[{range:{start:{line:0,character:0},end:{line:0,character:1}},text:'b'}],2);client.willSave(uri);client.save(uri);await client.request('barrier',{});
  assert.deepEqual(messages.map(m=>m.method),['didOpen','didChange','willSave','didSave']);assert.equal(messages[0].p.textDocument.uri,uri);
  assert.deepEqual(messages[1].p.contentChanges,[{text:'b'}]);assert.equal(messages[3].p.text,'b');
  await server.request('client/unregisterCapability',{unregisterations:[{id:'save',method:'textDocument/didSave'}]});client.save(uri);await client.request('barrier',{});assert.equal(messages.length,4);
});
test('document lifecycle events are ordered and carry advancing snapshots',async t=>{
  const {client}=await session(t);const events=[];client.on('document',e=>events.push([e.kind,e.uri,e.document.version]));
  client.open(uri,'vb6','a');client.change(uri,[{text:'b'}],2);client.close(uri);
  assert.deepEqual(events,[['open',uri,1],['change',uri,2],['close',uri,2]]);
});
test('capabilities advertise supported presentations, not unavailable editor APIs',()=>{
  const c=languageClientCapabilities();assert.equal(c.textDocument.diagnostic.relatedDocumentSupport,true);
  assert.equal(c.textDocument.callHierarchy,undefined);assert.equal(c.textDocument.typeHierarchy,undefined);assert.equal(c.textDocument.inlineValue,undefined);
  assert.equal(c.workspace.workspaceEdit.resourceOperations,undefined);
});

test('multi-file edits cannot use a response computed before another file changed',async t=>{
  const {client,server}=await session(t);const other=uri.replace('Module1','Other');
  client.open(uri,'vb6','a');client.open(other,'vb6','b');let finish,started;
  const ready=new Promise(resolve=>started=resolve);
  server.onRequest('textDocument/rename',()=>new Promise(resolve=>{finish=resolve;started();}));
  const result=client.request('textDocument/rename',{textDocument:{uri},newName:'c'});await ready;
  client.change(other,[{text:'changed'}],2);finish({changes:{[other]:[]}});
  await assert.rejects(result,{code:-32801});
});
test('cached code-action edits become stale when any workspace document changes',async t=>{
  const {client,server}=await session(t);client.open(uri,'vb6','a');
  server.onRequest('textDocument/codeAction',()=>[{title:'Fix',edit:{changes:{[uri]:[]}}}]);
  const [action]=await client.request('textDocument/codeAction',{textDocument:{uri}});
  assert.equal(client.responseIsCurrent(action.edit),true);
  client.open(uri+'.other','vb6','new dependency');
  assert.equal(client.responseIsCurrent(action),false);assert.equal(client.responseIsCurrent(action.edit),false);
  assert.equal(client.responseIsCurrent({changes:{[uri]:[]}}),true); // server-initiated edits still require host consent
});
test('static diagnostic selectors and dynamic command registration are negotiated',async t=>{
  const {client,server}=await session(t,{diagnosticProvider:{documentSelector:[{language:'xaml'}]}});
  const document=client.open(uri,'vb6','a');assert.equal(client.capability('textDocument/diagnostic',document),false);
  await server.request('client/registerCapability',{registrations:[{id:'cmd',method:'workspace/executeCommand',registerOptions:{commands:['test.run']}}]});
  assert.deepEqual(client.capability('workspace/executeCommand').commands,['test.run']);
  await server.request('client/unregisterCapability',{unregisterations:[{id:'cmd',method:'workspace/executeCommand'}]});
  assert.equal(client.capability('workspace/executeCommand'),false);
});
test('a didOpen registration does not invent a didClose subscription',async t=>{
  const {client,server}=await session(t,{}),seen=[];
  server.onNotification('textDocument/didClose',p=>seen.push(p));
  await server.request('client/registerCapability',{registrations:[{id:'open',method:'textDocument/didOpen',registerOptions:{documentSelector:[{language:'vb6'}]}}]});
  client.open(uri,'vb6','a');client.close(uri);await client.request('barrier',{});assert.deepEqual(seen,[]);
});
