import test from 'node:test';
import assert from 'node:assert/strict';
import {JsonRpcPeer,RpcError,RPC_CANCELLED} from '../src/editor/advanced/rpc.js';

function pair(options={}) {
  const listeners=[null,null],closed=[false,false],messages=[];
  const peers=[0,1].map(i=>new JsonRpcPeer({
    send(value){if(closed[i])throw new Error('closed');messages.push(value);queueMicrotask(()=>listeners[1-i]?.(value));},
    listen(fn){listeners[i]=fn;return()=>listeners[i]=null;},close(){closed[i]=true;},
  },{timeout:100,...options}));
  return {a:peers[0],b:peers[1],messages,close:()=>peers.forEach(p=>p.close())};
}
test('JSON-RPC resolves concurrent out-of-order requests',async()=>{
  const p=pair();try{
    p.b.onRequest('echo',async ({value,delay})=>{await new Promise(r=>setTimeout(r,delay));return value;});
    assert.deepEqual(await Promise.all([p.a.request('echo',{value:1,delay:15}),p.a.request('echo',{value:2,delay:1})]),[1,2]);
    assert.equal(p.a.pending.size,0);
  }finally{p.close();}
});
test('unknown methods and server error codes are preserved',async()=>{
  const p=pair();try{
    await assert.rejects(p.a.request('unknown'),{code:-32601});
    p.b.onRequest('fail',()=>{throw new RpcError(-32001,'domain error',{detail:3});});
    await assert.rejects(p.a.request('fail'),error=>error.code===-32001&&error.data.detail===3);
  }finally{p.close();}
});
test('cancellation reaches the handler, removes pending work and ignores late responses',async()=>{
  const p=pair();try{
    let cancelled=false,done;
    p.b.onRequest('wait',(_,context)=>new Promise(resolve=>{done=resolve;context.signal.addEventListener('abort',()=>cancelled=true);}));
    const controller=new AbortController(),result=p.a.request('wait',{}, {signal:controller.signal});
    await new Promise(r=>setTimeout(r,0));controller.abort();
    await assert.rejects(result,{code:RPC_CANCELLED});await new Promise(r=>setTimeout(r,0));
    assert.equal(cancelled,true);done(42);await new Promise(r=>setTimeout(r,0));
    assert.equal(p.a.pending.size,0);assert.equal(p.b.incoming.size,0);
  }finally{p.close();}
});
test('pre-aborted requests never go on the wire',async()=>{
  const p=pair();try{const controller=new AbortController();controller.abort();await assert.rejects(p.a.request('echo',{}, {signal:controller.signal}),{code:RPC_CANCELLED});assert.equal(p.messages.length,0);}finally{p.close();}
});
test('timeouts send cancellation and dispose timers',async()=>{
  const p=pair();try{p.b.onRequest('wait',()=>new Promise(()=>{}));await assert.rejects(p.a.request('wait',{}, {timeout:5}),{code:-32098});assert.equal(p.a.pending.size,0);assert.ok(p.messages.some(m=>m.method==='$/cancelRequest'));}finally{p.close();}
});
test('connection shutdown rejects pending operations immediately',async()=>{
  const p=pair();p.b.onRequest('wait',()=>new Promise(()=>{}));const promise=p.a.request('wait');p.a.close(new Error('disconnected'));await assert.rejects(promise,/disconnected/);assert.equal(p.a.pending.size,0);await assert.rejects(p.a.request('wait'),{code:-32097});p.close();
});
test('notifications have multiple disposable listeners and do not leak rejections',async()=>{
  const errors=[],p=pair({onError:error=>errors.push(error)});try{
    let count=0;const remove=p.b.onNotification('changed',()=>count++);p.b.onNotification('changed',()=>Promise.reject(new Error('notification failure')));
    p.a.notify('changed');await new Promise(r=>setTimeout(r,0));remove();p.a.notify('changed');await new Promise(r=>setTimeout(r,0));
    assert.equal(count,1);assert.equal(errors.length,2);
  }finally{p.close();}
});
test('request queue limits and send failures do not retain pending entries',async()=>{
  const p=pair({maxPending:1});try{p.b.onRequest('wait',()=>new Promise(()=>{}));const promise=p.a.request('wait');await assert.rejects(p.a.request('wait'),{code:-32099});p.a.close();await assert.rejects(promise);assert.equal(p.a.pending.size,0);}finally{p.close();}
  const peer=new JsonRpcPeer({listen:()=>()=>{},send(){throw new Error('send failure');}});
  await assert.rejects(peer.request('wait'),/send failure/);assert.equal(peer.pending.size,0);peer.close();
});
test('invalid or oversized messages are diagnosed, not dispatched',()=>{
  const errors=[],peer=new JsonRpcPeer({listen:()=>()=>{},send(){}},{maxMessageLength:20,onError:error=>errors.push(error)});
  peer.receive('{');peer.receive(JSON.stringify({jsonrpc:'2.0',method:'x'}));peer.receive({jsonrpc:'2.0',id:[],method:'x'});assert.equal(errors.length,3);peer.close();
});
