import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {AdvancedEditorRuntime,createAdvancedEditorRuntime} from '../src/editor/advanced/entry.js';
import {JsonRpcPeer,messagePortTransport} from '../src/editor/advanced/rpc.js';

const tick=()=>new Promise(resolve=>setTimeout(resolve,1));
async function until(predicate){const deadline=Date.now()+2500;while(!predicate()){if(Date.now()>deadline)assert.fail('Timed out waiting for editor lifecycle.');await tick();}}
const disposable=()=>({dispose(){}});
function monacoStub(){return {Uri:{parse:value=>value},languages:{getLanguages:()=>[],register:disposable,registerHoverProvider:disposable,setMonarchTokensProvider:disposable,setLanguageConfiguration:disposable},editor:{registerCommand:disposable,getModel:()=>null,getModels:()=>[]}};}

class Socket extends EventTarget {
  static instances=[];
  static respond=true;
  constructor(url){super();this.url=url;this.readyState=0;this.bufferedAmount=0;this.messages=[];Socket.instances.push(this);queueMicrotask(()=>{if(this.readyState!==3){this.readyState=1;this.dispatchEvent(new Event('open'));}});}
  send(text){const request=JSON.parse(text);this.messages.push(request);if(request.id===undefined)return;
    if(request.method==='initialize'&&!Socket.respond)return;
    const result=request.method==='initialize'?{capabilities:{textDocumentSync:2,diagnosticProvider:{identifier:'external'}}}:request.method==='textDocument/diagnostic'?{kind:'full',resultId:'one',items:[{range:{start:{line:0,character:0},end:{line:0,character:1}},severity:1,message:'External diagnostic'}]}:null;
    queueMicrotask(()=>{if(this.readyState===1)this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({jsonrpc:'2.0',id:request.id,result})}));});
  }
  close(){if(this.readyState===3)return;this.readyState=3;this.dispatchEvent(new Event('close'));}
}
function sockets(t){Socket.instances=[];Socket.respond=true;const original=globalThis.WebSocket;globalThis.WebSocket=Socket;t.after(()=>{Socket.instances.forEach(s=>s.close());globalThis.WebSocket=original;});}
const external={vb6Endpoint:'ws://localhost/vb6',xamlEndpoint:'ws://localhost/xaml'};

test('already-cancelled startup cannot create workers or language connections',async()=>{
  const abort=new AbortController();abort.abort();let workers=0;
  await assert.rejects(createAdvancedEditorRuntime({}, {},{worker:()=>{workers++;}},{signal:abort.signal}),/cancelled/);
  assert.equal(workers,0);
});
test('cancelling a pending worker initialize closes it immediately',async t=>{
  const {port1,port2}=new MessageChannel(),server=new JsonRpcPeer(messagePortTransport(port1));let started=false,terminated=false;
  server.onRequest('initialize',()=>{started=true;return new Promise(()=>{});});
  port2.terminate=()=>{terminated=true;port2.close();};t.after(()=>server.close());
  const abort=new AbortController(),promise=createAdvancedEditorRuntime({}, {},{worker:()=>port2},{signal:abort.signal});
  await until(()=>started);abort.abort();await assert.rejects(promise);assert.equal(terminated,true);
});
test('cancelling external initialization closes its socket before any model is created',async t=>{
  sockets(t);Socket.respond=false;const abort=new AbortController(),monaco=monacoStub();
  const promise=createAdvancedEditorRuntime({project:{id:'test'},status(){}},external,{monaco},{signal:abort.signal});
  await until(()=>Socket.instances[0]?.messages.some(m=>m.method==='initialize'));
  abort.abort();await assert.rejects(promise);assert.equal(Socket.instances.length,1);assert.equal(Socket.instances[0].readyState,3);
});
test('runtime owns external pull diagnostics, raw code-action markers and disconnect cleanup',async t=>{
  sockets(t);const runtime=new AdvancedEditorRuntime({project:{id:'test'},status(){}},external,{monaco:monacoStub()});
  runtime.sync=()=>{for(const language of ['vb6','xaml'])runtime.clients[language].open('vb6-editor://workspace/test/'+language,language,'a');};
  runtime.installHooks=()=>{};runtime.appearance=()=>{};t.after(()=>runtime.dispose());
  await runtime.initialize();
  await until(()=>[...runtime.diagnosticValues.values()].every(values=>values.size===1));
  assert.equal(runtime.diagnosticValues.get(runtime.clients.vb6).values().next().value[0].message,'External diagnostic');
  assert.ok(Socket.instances.every(s=>s.messages.some(m=>m.method==='textDocument/diagnostic')));
  runtime.clients.vb6.close('vb6-editor://workspace/test/vb6');assert.equal(runtime.diagnosticValues.get(runtime.clients.vb6).size,0);
  Socket.instances[1].close();assert.equal(runtime.diagnosticValues.get(runtime.clients.xaml).size,0);
  runtime.dispose();assert.ok(Socket.instances.every(s=>s.readyState===3));assert.equal(runtime.sessions.size,0);
});

test('unfocused editor commands target the active document before navigation history',()=>{
  const a={record:{moduleId:'a'},view:{hasTextFocus:()=>false,hasWidgetFocus:()=>false}},b={record:{moduleId:'b'},view:{hasTextFocus:()=>false,hasWidgetFocus:()=>false}};
  const runtime=new AdvancedEditorRuntime({documents:{mdi:{active:'b:code'}}},{},{});
  runtime.surfaces.set('a',a);runtime.surfaces.set('b',b);runtime.lastActive=a;
  assert.equal(runtime.active(),b);runtime.ide.documents.mdi.active='tool:advanced:call';assert.equal(runtime.active(),a);
});
