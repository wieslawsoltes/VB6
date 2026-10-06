import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeDebuggerClient} from '../src/ide/native-debugger-client.js';
const endpoint='http://127.0.0.1:8767/debugger',token='0123456789abcdef'.repeat(4);
const json=value=>new Response(JSON.stringify({result:value}),{headers:{'Content-Type':'application/json'}});
const capabilities={version:1,engine:'CDB'};
test('native browser client validates local endpoints before sending credentials',async()=>{
  let calls=0;const client=new NativeDebuggerClient({fetch:async()=>{calls++;return json(capabilities);}});
  for(const url of ['https://example.com/debugger','http://localhost:8767/debugger',endpoint+'?token=x',endpoint+'#x','http://user@127.0.0.1:8767/debugger'])await assert.rejects(client.connect(url,token));
  assert.equal(calls,0);assert.equal(client.connected,false);
});
test('native browser credentials use only a bearer header and are not serializable',async()=>{
  const calls=[],client=new NativeDebuggerClient({fetch:async(url,options)=>{calls.push({url,options});return json(capabilities);}});
  await client.connect(endpoint,token);assert.equal(client.connected,true);
  const request=calls[0];assert.equal(request.url,endpoint);assert.equal(request.options.headers.Authorization,'Bearer '+token);
  for(const [key,value] of Object.entries({credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store'}))assert.equal(request.options[key],value);
  assert.ok(!JSON.stringify(client).includes(token));assert.ok(!request.options.body.includes(token));client.disconnect();assert.equal(client.connected,false);
});
test('native browser client rejects malformed and incompatible bridge responses',async()=>{
  for(const response of [new Response('<html/>',{headers:{'Content-Type':'text/html'}}),json({version:2,engine:'CDB'}),new Response('{}',{headers:{'Content-Type':'application/json'}})]){
    const client=new NativeDebuggerClient({fetch:async()=>response});await assert.rejects(client.connect(endpoint,token));assert.equal(client.connected,false);
  }
});
test('native browser client preserves typed bridge errors',async()=>{
  let count=0;const client=new NativeDebuggerClient({fetch:async()=>++count===1?json(capabilities):new Response(JSON.stringify({error:{code:'STALE_PAUSE',message:'Refresh target'}}),{status:400,headers:{'Content-Type':'application/json'}})});
  await client.connect(endpoint,token);await assert.rejects(client.request('stepInto',{pauseId:1}),{code:'STALE_PAUSE'});client.disconnect();
});
test('native browser disconnect rejects a late response even if transport ignores abort',async()=>{
  let resolve,count=0;const client=new NativeDebuggerClient({fetch:async()=>++count===1?json(capabilities):new Promise(r=>resolve=r)});
  await client.connect(endpoint,token);const request=client.request('registers');client.disconnect();resolve(json({registers:{rax:'0x1'}}));await assert.rejects(request,/connection changed/);
});
test('native browser response stream is bounded and cancelled',async()=>{
  let count=0,cancelled=false;const client=new NativeDebuggerClient({fetch:async()=>++count===1?json(capabilities):new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}})});
  await client.connect(endpoint,token);await assert.rejects(client.request('allProcessStacks'),/3 MiB/);assert.equal(cancelled,true);client.disconnect();
});
test('a stale connect failure cannot disconnect a newer native connection',async()=>{
  let resolve,count=0;const client=new NativeDebuggerClient({fetch:async()=>++count===1?new Promise(r=>resolve=r):json(capabilities)});
  const old=client.connect(endpoint,token);await client.connect(endpoint,token+'new');resolve(json(capabilities));await assert.rejects(old,/connection changed/);assert.equal(client.connected,true);assert.deepEqual(await client.request('capabilities'),capabilities);client.disconnect();
});
