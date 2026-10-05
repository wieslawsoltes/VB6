import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeAutomationClient} from '../tools/interop/native-automation.mjs';

function clientWithTransport(options={}){
  const client=new NativeAutomationClient({allowNativeCode:true,allowed:['Scripting.Dictionary'],...options});
  const writes=[];let kills=0;
  client.child={stdin:{write(text,callback){writes.push(JSON.parse(text));callback?.();}},kill(){kills++;}};
  return {client,writes,kills:()=>kills};
}
test('native host startup has its own bounded budget without extending invocation timeout',()=>{
  const {client}=clientWithTransport();
  assert.equal(client.timeout,15000);assert.equal(client.startupTimeout,60000);
  for(const startupTimeout of [0,99,120001,Infinity,NaN,'60000'])assert.throws(()=>clientWithTransport({startupTimeout}),/options/);
  assert.equal(clientWithTransport({timeout:250,startupTimeout:1000}).client.timeout,250);
});
test('cold-start budget does not expire on the shorter invocation deadline',async()=>{
  const {client,writes,kills}=clientWithTransport({timeout:100,startupTimeout:500});
  const aborted=Error('test cancellation');
  const result=assert.rejects(client.send({op:'init'},{startup:true}),error=>error===aborted);
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(client.pending.size,1);assert.equal(kills(),0);
  client.abort(aborted);await result;assert.equal(writes.length,1);assert.equal(kills(),1);
});
test('initialization timeout reports its phase and aborts rather than replaying',async()=>{
  const {client,writes,kills}=clientWithTransport({timeout:500,startupTimeout:100});
  await assert.rejects(client.send({op:'init'},{startup:true}),error=>error.code==='NATIVE_STARTUP_TIMEOUT'&&error.operation==='init'&&error.timeoutMs===100);
  assert.equal(client.pending.size,0);assert.equal(client.closed,true);assert.equal(writes.length,1);assert.equal(kills(),1);
});
test('normal native calls keep their invocation deadline and reject pending calls on abort',async()=>{
  const {client,writes,kills}=clientWithTransport({timeout:100,startupTimeout:1000});
  const first=client.send({op:'call',args:['private value']});const second=client.send({op:'info'});
  const results=await Promise.allSettled([first,second]);
  for(const result of results){assert.equal(result.status,'rejected');assert.equal(result.reason.code,'NATIVE_INVOCATION_TIMEOUT');assert.equal(result.reason.timeoutMs,100);assert.ok(!result.reason.message.includes('private value'));}
  assert.equal(client.pending.size,0);assert.equal(writes.length,2);assert.equal(kills(),1);
  assert.equal(client.diagnostics().initialized,false);assert.equal(client.diagnostics().pending,0);
  await assert.rejects(client.request({op:'call'}),/closed/);assert.equal(writes.length,2);
});
