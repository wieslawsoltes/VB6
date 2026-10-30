import test from 'node:test';
import assert from 'node:assert/strict';
import {UIActionScope} from '../packages/intelligent-ui/src/action-scope.js';
import {UISurface} from '../packages/intelligent-ui/src/surface.js';

test('scope aborts every pending action, then accepts new independent actions',()=>{
  const scope=new UIActionScope(),a=scope.acquire(),b=scope.acquire();scope.invalidate();
  assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,true);assert.equal(scope.pending.size,0);
  const c=scope.acquire();assert.equal(c.signal.aborted,false);scope.dispose();assert.equal(c.signal.aborted,true);
  assert.throws(()=>scope.acquire(),/disposed/);scope.dispose();
});
test('external cancellation propagates its reason and releases the lease',()=>{
  const scope=new UIActionScope(),abort=new AbortController(),entry=scope.acquire(abort.signal);
  const reason=new Error('user cancelled');abort.abort(reason);assert.equal(entry.signal.reason,reason);
  assert.equal(scope.pending.size,0);entry.release();assert.throws(()=>scope.acquire(abort.signal),/user cancelled/);
});
test('scope is bounded and completion makes capacity available again',()=>{
  assert.throws(()=>new UIActionScope({limit:0}));const scope=new UIActionScope({limit:1}),entry=scope.acquire();
  assert.throws(()=>scope.acquire(),/Too many/);entry.release();entry.release();const next=scope.acquire();
  scope.invalidate();assert.equal(entry.signal.aborted,false);assert.equal(next.signal.aborted,true);
});
test('surface supplies cancellation for built-in actions and preserves the exact result promise',async()=>{
  let finish,signal;const promise=new Promise(resolve=>finish=resolve),scope=new UIActionScope();
  const surface={actionScope:scope,options:{onAction:(action,view,context)=>{signal=context.signal;return promise;}}};
  const result=UISurface.prototype.action.call(surface,{type:'message',args:['Review']});assert.equal(result,promise);
  scope.invalidate();assert.equal(signal.aborted,true);finish({});await result;await Promise.resolve();assert.equal(scope.pending.size,0);
});
test('surface releases leases after synchronous failures and asynchronous denial',async()=>{
  const scope=new UIActionScope(),surface={actionScope:scope,options:{onAction:()=>{throw new Error('denied');}}};
  assert.throws(()=>UISurface.prototype.action.call(surface,{type:'copy',args:['a']}),/denied/);assert.equal(scope.pending.size,0);
  surface.options.onAction=()=>Promise.reject(new Error('later denial'));
  await assert.rejects(UISurface.prototype.action.call(surface,{type:'copy',args:['a']}),/later denial/);assert.equal(scope.pending.size,0);
});
for(const state of ['pending','inflight'])test('surface blocks host effects while '+state,()=>{
  const surface={[state]:true,actionScope:new UIActionScope(),options:{onAction:()=>assert.fail('effect')}};
  assert.throws(()=>UISurface.prototype.action.call(surface,{type:'message',args:['a']}),/current UI update/);
});
test('releasing a scope removes external abort listeners',()=>{
  const controller=new AbortController(),signal=controller.signal;let added=0,removed=0;
  const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
  signal.addEventListener=(...args)=>{added++;return add(...args);};signal.removeEventListener=(...args)=>{removed++;return remove(...args);};
  const scope=new UIActionScope(),a=scope.acquire(signal);a.release();a.release();
  const b=scope.acquire(signal);scope.dispose();b.release();assert.equal(added,2);assert.equal(removed,2);
});

test('source replacement detaches blocked old event queue and discards its remaining effects',async()=>{
  let complete,calls=0,errors=0;const scope=new UIActionScope();
  const surface={generation:0,version:1,eventQueue:Promise.resolve(),actionScope:scope,
    commit:UISurface.prototype.commit,
    source:{},options:{},client:{request:async()=>({actions:[{type:'copy',args:['first']},{type:'copy',args:['second']}]})},
    apply(){},error(){errors++;},flush(){},action(){calls++;return new Promise(resolve=>complete=resolve);}};
  const pending=UISurface.prototype.event.call(surface,'event',[]);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  const updating=UISurface.prototype.enqueue.call(surface,'update','<text>New</text>',{partial:true});
  clearTimeout(surface.timer);assert.equal(surface.generation,1);
  let available=false;await surface.eventQueue.then(()=>available=true);assert.equal(available,true);
  complete();await pending;assert.equal(calls,1);assert.equal(errors,0);surface.pending.resolve();await updating;
});
test('enqueue clones data and rejects invalid viewport without invalidating live actions',async()=>{
  const scope=new UIActionScope(),entry=scope.acquire(),surface={generation:0,actionScope:scope,source:{},flush(){}};
  await assert.rejects(UISurface.prototype.enqueue.call(surface,'update','x',{viewport:{width:-1,height:2}}));
  assert.equal(entry.signal.aborted,false);const data={value:1};
  const update=UISurface.prototype.enqueue.call(surface,'update','x',{data,partial:true});clearTimeout(surface.timer);
  data.value=2;assert.equal(surface.pending.options.data.value,1);assert.equal(entry.signal.aborted,true);surface.pending.resolve();await update;
});
test('client takes ownership of an immutable snapshot copy at construction',async()=>{
  const {UIClient}=await import('../packages/intelligent-ui/src/client.js');const snapshot={state:{value:1}};
  const client=new UIClient({snapshot});snapshot.state.value=5;assert.equal(client.snapshot().state.value,1);client.dispose();
});
