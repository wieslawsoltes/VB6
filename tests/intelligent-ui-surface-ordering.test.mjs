import test from 'node:test';
import assert from 'node:assert/strict';
import {UIRuntime} from '../packages/intelligent-ui/src/runtime.js';
import {UISurface} from '../packages/intelligent-ui/src/surface.js';
import {UIActionScope} from '../packages/intelligent-ui/src/action-scope.js';

const source='{@body const [n,setN]=DIL.useState(0)}<button onClick={()=>setN(n+1)}>Increase</button><metric label="Count" value={n}/>';
const turn=()=>new Promise(resolve=>setImmediate(resolve));

// A FIFO transport running the real interpreter. Delivery, not computation, is
// controlled to reproduce Worker responses arriving after a source edit/resize.
function fixture(input=source){
  const runtime=new UIRuntime(),deliveries=[],requests=[],nodes=new Map(),actions=[];
  const surface=Object.assign(Object.create(UISurface.prototype),{
    generation:0,version:0,eventQueue:Promise.resolve(),actionScope:new UIActionScope(),source:{},
    options:{},apply(result){
      for(const op of result.operations){
        if(op.op==='create')nodes.set(op.id,{type:op.type});
        if(op.op==='set')Object.assign(nodes.get(op.id),{props:op.props,text:op.text});
        if(op.op==='remove')nodes.delete(op.id);
      }
      this.version=result.version;
    },error(){},action(action){actions.push(action);}
  });
  surface.client={request(method,payload){
    requests.push(method);
    try{
      const result=method==='event'?runtime.dispatch(payload.id,payload.args,payload.version)
        :method==='resize'?runtime.resize(payload.viewport):runtime.update(payload.source,payload.options);
      return new Promise(resolve=>deliveries.push(()=>resolve(result)));
    }catch(error){return Promise.reject(error);}
  }};
  surface.apply(runtime.update(input));
  const event=runtime.tree[0].props.onClick;
  const metric=()=>[...nodes.values()].find(node=>node.type==='metric')?.props.value;
  return {surface,runtime,requests,deliveries,nodes,actions,event,metric};
}

for(const replacement of ['source','viewport'])test('in-flight event delta survives '+replacement+' without desynchronizing the renderer',async()=>{
  const f=fixture(),s=f.surface;
  const event=s.event(f.event,[]);await turn();
  assert.equal(f.deliveries.length,1);assert.equal(f.metric(),0);
  let update;
  if(replacement==='source')update=s.update(source+'<text>Updated source</text>');
  else {s.setViewport({width:375,height:768});clearTimeout(s.resizeTimer);update=s.flushResize();}
  f.deliveries.shift()();await event;
  f.deliveries.shift()();await update;
  assert.equal(f.runtime.tree.find(node=>node.type==='metric').props.value,1);
  assert.equal(f.metric(),1,'a skipped committed diff leaves the visible counter stale');
  assert.equal(s.version,f.runtime.version);
  assert.equal(f.actions.length,0);
});

for(const state of ['pending','inflight'])test('surface refuses old handlers while source update is '+state,async()=>{
  const f=fixture();f.surface[state]=true;
  const rejected=assert.rejects(f.surface.event(f.event,[]),/current UI update/);
  await turn();for(const deliver of f.deliveries)deliver();await rejected;
  assert.deepEqual(f.requests,[]);assert.equal(f.metric(),0);
});

test('source replacement still discards effects from a committed old event',async()=>{
  const f=fixture('<button onClick={()=>GenUI.copy("old intent")}>Copy</button>');
  const event=f.surface.event(f.event,[]);await turn();
  const update=f.surface.update('<text>Replacement</text>');
  f.deliveries.shift()();await event;f.deliveries.shift()();await update;
  assert.equal(f.actions.length,0);assert.ok([...f.nodes.values()].some(n=>n.text==='Replacement'));
});

for(const revoked of ['disposed','restarted'])test(revoked+' client results never reach the replacement renderer',async()=>{
  const f=fixture(),s=f.surface,event=s.event(f.event,[]);await turn();
  if(revoked==='disposed')s.disposed=true;else s.client={};
  const rejected=assert.rejects(event,revoked==='disposed'?/disposed/:/restarted/);
  f.deliveries.shift()();await rejected;assert.equal(f.metric(),0);assert.equal(f.actions.length,0);
});

test('a current committed event still dispatches its exact host effect',async()=>{
  const f=fixture('<button onClick={()=>GenUI.copy("current intent")}>Copy</button>');
  const event=f.surface.event(f.event,[]);await turn();f.deliveries.shift()();await event;
  assert.deepEqual(JSON.parse(JSON.stringify(f.actions)),[{type:'copy',args:['current intent']}]);
});

test('input arriving during a committed resize waits for its rendered version and executes exactly once',async()=>{
  const f=fixture(),s=f.surface;s.setViewport({width:375,height:768});clearTimeout(s.resizeTimer);
  const resize=s.flushResize(),event=s.event(f.event,[]);await turn();
  assert.deepEqual(f.requests,['resize'],'input must not use a version awaiting delivery');
  assert.notEqual(s.version,f.runtime.version);
  f.deliveries.shift()();await resize;await turn();
  assert.deepEqual(f.requests,['resize','event']);
  f.deliveries.shift()();await event;
  assert.equal(f.metric(),1);assert.equal(s.version,f.runtime.version);
  assert.equal(s.generation,0,'a viewport change does not replace the authored source');
});

test('successive inputs wait for a resize and preserve their order without replay',async()=>{
  const f=fixture(),s=f.surface;s.setViewport({width:375,height:768});clearTimeout(s.resizeTimer);
  const resize=s.flushResize(),first=s.event(f.event,[]),second=s.event(f.event,[]);await turn();
  assert.deepEqual(f.requests,['resize']);f.deliveries.shift()();await resize;await turn();
  f.deliveries.shift()();await first;await turn();f.deliveries.shift()();await second;
  assert.deepEqual(f.requests,['resize','event','event']);assert.equal(f.metric(),2);
  assert.equal(s.version,f.runtime.version);
});

test('source replacement revokes input waiting behind resize before the old handler executes',async()=>{
  const f=fixture('<button onClick={()=>GenUI.copy("old intent")}>Copy</button>'),s=f.surface;
  s.setViewport({width:375,height:768});clearTimeout(s.resizeTimer);
  const resize=s.flushResize(),event=s.event(f.event,[]),rejected=assert.rejects(event,/changed/);await turn();
  const update=s.update('<text>Replacement</text>');
  f.deliveries.shift()();await resize;await rejected;await turn();
  assert.deepEqual(f.requests,['resize','update']);f.deliveries.shift()();await update;
  assert.equal(f.actions.length,0);assert.ok([...f.nodes.values()].some(n=>n.text==='Replacement'));
});

test('a responsive handler removed by resize is rejected instead of retargeting the interaction',async()=>{
  const f=fixture('{#if DIL.useBreakpoint("md")}<button onClick={()=>GenUI.copy("wide intent")}>Wide</button>{:else}<button onClick={()=>GenUI.copy("narrow intent")}>Narrow</button>{/if}'),s=f.surface;
  s.setViewport({width:375,height:768});clearTimeout(s.resizeTimer);
  const resize=s.flushResize(),event=s.event(f.event,[]),rejected=assert.rejects(event,/no longer available/);await turn();
  f.deliveries.shift()();await resize;await rejected;
  assert.equal(f.actions.length,0);assert.equal(s.version,f.runtime.version);
  assert.ok([...f.nodes.values()].some(n=>n.text==='Narrow'));
});

test('a rejected operation does not poison subsequent valid interactions',async()=>{
  const f=fixture(),s=f.surface;
  await assert.rejects(s.event('missing handler',[]),/no longer available/);
  const event=s.event(f.event,[]);await turn();f.deliveries.shift()();await event;
  assert.deepEqual(f.requests,['event','event']);assert.equal(f.metric(),1);
});

for(const revoked of ['disposed','restarted'])test(revoked+' client also rejects input queued behind an undelivered resize',async()=>{
  const f=fixture(),s=f.surface;s.setViewport({width:375,height:768});clearTimeout(s.resizeTimer);
  const resize=s.flushResize(),event=s.event(f.event,[]);await turn();
  if(revoked==='disposed')s.disposed=true;else s.client={};
  const rejected=assert.rejects(event,revoked==='disposed'?/disposed/:/restarted/);
  f.deliveries.shift()();await resize;await rejected;
  assert.deepEqual(f.requests,['resize']);assert.equal(f.metric(),0);assert.equal(f.actions.length,0);
});

test('an unanswered host review does not hold the render operation queue',async()=>{
  const f=fixture('<button onClick={()=>GenUI.copy("reviewed intent")}>Copy</button>'),s=f.surface;
  let release;s.action=()=>new Promise(resolve=>release=resolve);
  const event=s.event(f.event,[]);await turn();f.deliveries.shift()();await turn();
  assert.equal(typeof release,'function');
  const update=s.update('<text>Replacement while review is pending</text>');await turn();
  f.deliveries.shift()();await update;
  assert.ok([...f.nodes.values()].some(n=>n.text==='Replacement while review is pending'));
  release();await event;assert.deepEqual(f.requests,['event','update']);
});
