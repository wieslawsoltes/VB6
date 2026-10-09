import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {JsonRpcPeer,messagePortTransport} from '../src/editor/advanced/rpc.js';
import {LanguageClient} from '../src/editor/advanced/client.js';
import {PullDiagnostics} from '../src/editor/advanced/pull-diagnostics.js';

const uri='vb6-editor://workspace/module.bas',relatedUri='vb6-editor://workspace/other.bas';
const marker={range:{start:{line:0,character:0},end:{line:0,character:1}},message:'Expected value',severity:1};
const tick=()=>new Promise(r=>setTimeout(r,1));
async function until(check){const end=Date.now()+2000;while(!check()){if(Date.now()>end)assert.fail('Timed out waiting for protocol state.');await tick();}}
async function fixture(t,handler,capability={identifier:'test',interFileDependencies:true}) {
  const {port1,port2}=new MessageChannel(),server=new JsonRpcPeer(messagePortTransport(port1)),client=new LanguageClient(messagePortTransport(port2));
  server.onRequest('initialize',()=>({capabilities:{textDocumentSync:2,...(capability?{diagnosticProvider:capability}:{})}}));
  server.onRequest('textDocument/diagnostic',handler);await client.initialize();
  const published=[],errors=[];client.on('diagnostics',value=>published.push(value));
  const pull=new PullDiagnostics(client,{delay:3,maxConcurrent:2,onError:error=>errors.push(error)});
  t.after(()=>{pull.dispose();client.dispose();server.close();});
  return {server,client,pull,published,errors};
}
test('pull diagnostics publishes full and unchanged reports with previous result IDs',async t=>{
  const calls=[],f=await fixture(t,p=>{calls.push(p);return calls.length===1?{kind:'full',resultId:'one',items:[marker]}:{kind:'unchanged',resultId:'two'};});
  f.client.open(uri,'vb6','a');await until(()=>f.published.length===1);
  assert.equal(calls[0].identifier,'test');assert.equal(f.published[0].version,1);
  f.client.change(uri,[{text:'b'}],2);await until(()=>f.published.length===2);
  assert.equal(calls[1].previousResultId,'one');assert.deepEqual(f.published[1].diagnostics,[marker]);assert.equal(f.published[1].version,2);
  assert.equal(f.pull.states.get(uri).result.resultId,'two');assert.deepEqual(f.errors,[]);
});
test('document changes cancel older pulls and never overwrite fresh markers',async t=>{
  const calls=[],f=await fixture(t,(p,{signal})=>new Promise(resolve=>calls.push({p,resolve,signal})));
  f.client.open(uri,'vb6','a');await until(()=>calls.length===1);
  f.client.change(uri,[{text:'b'}],2);await until(()=>calls.length===2&&calls[0].signal.aborted);
  calls[1].resolve({kind:'full',items:[{...marker,message:'new'}]});await until(()=>f.published.length===1);
  calls[0].resolve({kind:'full',items:[{...marker,message:'old'}]});await tick();
  assert.equal(f.published.at(-1).diagnostics[0].message,'new');assert.equal(f.published[0].version,2);
});
test('diagnostic refresh is a request and triggers a new pull without editing',async t=>{
  let calls=0;const f=await fixture(t,()=>{calls++;return {kind:'full',items:[]};});f.client.open(uri,'vb6','a');await until(()=>calls===1);
  assert.equal(await f.server.request('workspace/diagnostic/refresh'),null);await until(()=>calls===2);
});
test('related reports target only matching known snapshots',async t=>{
  const f=await fixture(t,()=>({kind:'full',items:[],relatedDocuments:{[relatedUri]:{kind:'full',resultId:'related',items:[marker]},'file:///outside':{kind:'full',items:[marker]}}}),{documentSelector:[{language:'vb6'}]});
  // Remove the unrelated document from the pull queue to exercise the related-report path.
  f.client.open(relatedUri,'vb6','b');clearTimeout(f.pull.states.get(relatedUri).timer);f.pull.states.get(relatedUri).timer=null;
  f.client.open(uri,'vb6','a');await until(()=>f.published.some(p=>p.uri===relatedUri));
  assert.deepEqual(f.published.find(p=>p.uri===relatedUri).diagnostics,[marker]);assert.equal(f.published.some(p=>p.uri==='file:///outside'),false);
});
test('closed/reopened documents cancel pending work and discard previous result identity',async t=>{
  const calls=[],f=await fixture(t,(p,{signal})=>new Promise(resolve=>calls.push({p,signal,resolve})));
  f.client.open(uri,'vb6','a');await until(()=>calls.length===1);f.client.close(uri);f.client.open(uri,'vb6','b',1);
  await until(()=>calls.length===2&&calls[0].signal.aborted);calls[0].resolve({kind:'full',resultId:'old',items:[marker]});calls[1].resolve({kind:'full',resultId:'new',items:[]});
  await until(()=>f.pull.states.get(uri)?.result?.resultId==='new');assert.ok(f.published.every(p=>p.diagnostics.length===0));
});
test('the pull queue bounds concurrency and disposal cancels all active requests',async t=>{
  const calls=[],f=await fixture(t,(p,{signal})=>new Promise(resolve=>calls.push({p,resolve,signal})));
  for(let i=0;i<8;i++)f.client.open(uri+i,'vb6','a');await until(()=>calls.length===2);
  assert.equal(f.pull.running,2);calls[0].resolve({kind:'full',items:[]});await until(()=>calls.length===3);assert.equal(f.pull.running,2);
  f.pull.dispose();await until(()=>calls.slice(1).every(c=>c.signal.aborted));assert.equal(f.pull.states.size,0);assert.equal(f.pull.queue.size,0);
});
test('servers without diagnostic capability receive no pulls',async t=>{
  let calls=0;const f=await fixture(t,()=>{calls++;return {kind:'full',items:[]};},false);f.client.open(uri,'vb6','a');await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);
});
test('malformed unchanged reports are diagnosed instead of clearing current markers',async t=>{
  const f=await fixture(t,()=>({kind:'unchanged',resultId:'missing'}));f.client.open(uri,'vb6','a');await until(()=>f.errors.length>0);
  assert.match(f.errors[0].message,/previous result/);assert.equal(f.published.length,0);
});
