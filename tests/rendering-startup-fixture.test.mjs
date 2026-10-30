import test from 'node:test';
import assert from 'node:assert/strict';
import awaitInitialLayout from './fixtures/rendering-startup.mjs';

function fixture({pending = false, dirty = false, fonts = Promise.resolve(), paintDelay = 1} = {}) {
  const calls = [], handles = new Map(); let id = 0;
  const schedule = (callback, delay) => {
    const key = id++;
    handles.set(key, setTimeout(() => { handles.delete(key); callback(); }, delay));
    return key;
  };
  const cancel = key => { clearTimeout(handles.get(key)); handles.delete(key); };
  const r = {driver:{}, disposed:false, resizeTargetsTask:pending ? {} : null,
    stylesDirty:dirty, frame:null, observedElements:new Set([{}])};
  const view = {setTimeout:schedule, clearTimeout:cancel,
    requestAnimationFrame:fn=>schedule(fn, 1), cancelAnimationFrame:cancel,
    ResizeObserver:class {
      observe(node) {
        assert.equal(r.resizeTargetsTask,null,'The barrier must follow deferred registration');
        calls.push(['observe',node]);
        this.handle = schedule(() => {
          // Model the renderer observer's initial notification and its paint.
          r.frame = schedule(() => { r.frame = null; if (!dirty) r.stylesDirty = false; },paintDelay);
          r.stylesDirty = true; this.callback();
        },1);
      }
      constructor(callback) { this.callback=callback; }
      disconnect() { cancel(this.handle); calls.push(['disconnect']); }
    }};
  r.document = {body:{}, fonts:{ready:fonts}, defaultView:view};
  return {r,calls,handles,schedule,cancel,cleanup(){for(const key of handles.keys())cancel(key);}};
}

test('cache baseline waits for delayed registration and its initial invalidation', async t => {
  const f=fixture({pending:true});t.after(()=>f.cleanup());
  const styles={}, originalStyles=styles;f.r.adapter={styles};
  f.schedule(()=>{f.r.resizeTargetsTask=null;},20);
  const result=await awaitInitialLayout(f.r,500);
  assert.equal(result.initialLayoutSettled,true);assert.equal(result.observedTargets,1);
  assert.equal(f.r.stylesDirty,false);assert.equal(f.r.frame,null);
  assert.equal(f.r.adapter.styles,originalStyles,'The barrier must never rebuild or replace styles');
  assert.equal(f.calls.filter(x=>x[0]==='observe').length,1);assert.equal(f.handles.size,0);
});

test('perpetual dirty state fails rather than blessing a fresh baseline', async t => {
  const f=fixture({dirty:true});t.after(()=>f.cleanup());
  await assert.rejects(awaitInitialLayout(f.r,20),/did not settle/);
  assert.equal(f.r.stylesDirty,true);
  // The barrier releases its own timer/task/frame, not the renderer's pending
  // paint. Under load the deadline can win before that independent paint runs.
  assert.deepEqual([...f.handles.keys()], f.r.frame == null ? [] : [f.r.frame]);
});

test('startup timeout releases barrier work without cancelling the renderer-owned frame', async t => {
  const f=fixture({dirty:true,paintDelay:1000});t.after(()=>f.cleanup());
  await assert.rejects(awaitInitialLayout(f.r,20),/did not settle/);
  assert.notEqual(f.r.frame,null,'The simulated renderer still owns its scheduled paint');
  assert.deepEqual([...f.handles.keys()],[f.r.frame]);
  assert.equal(f.r.stylesDirty,true);
  assert.ok(f.calls.some(call=>call[0]==='disconnect'),'The barrier observer is released');
});

test('a renderer disposed during deferred registration is rejected', async t => {
  const f=fixture({pending:true});t.after(()=>f.cleanup());
  f.schedule(()=>{f.r.disposed=true;},5);
  await assert.rejects(awaitInitialLayout(f.r,500),/stopped/);
  assert.equal(f.calls.length,0);assert.equal(f.handles.size,0);
});

test('pending font timeout releases the deadline and ignores late completion', async t => {
  let release;const fonts=new Promise(resolve=>{release=resolve;});
  const f=fixture({fonts});t.after(()=>f.cleanup());
  await assert.rejects(awaitInitialLayout(f.r,10),/did not settle/);
  release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.length,0);assert.equal(f.handles.size,0);
});

test('initialization failure does not silently qualify the HTML fallback', async t => {
  const f=fixture();t.after(()=>f.cleanup());f.r.driver=null;
  await assert.rejects(awaitInitialLayout(f.r,100),/stopped/);
  assert.equal(f.calls.length,0);assert.equal(f.handles.size,0);
});

test('invalid deadlines allocate no resources', async t => {
  const f=fixture();t.after(()=>f.cleanup());
  for(const timeout of [0,-1,NaN,Infinity])await assert.rejects(awaitInitialLayout(f.r,timeout),RangeError);
  assert.equal(f.calls.length,0);assert.equal(f.handles.size,0);
});
