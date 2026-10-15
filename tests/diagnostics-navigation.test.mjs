import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagnosticsScheduler} from '../src/editor/diagnostics-scheduler.js';
import {bindDiagnosticsLifecycle} from '../src/editor/diagnostics-lifecycle.js';

// A small event target preserves capture-before-bubble ordering, unlike Node's
// EventTarget. Browser tests additionally exercise real navigation and input.
class Target {
  listeners=[];
  addEventListener(type,callback,capture=false){this.listeners.push({type,callback,capture});}
  removeEventListener(type,callback,capture=false){this.listeners=this.listeners.filter(l=>l.type!==type||l.callback!==callback||l.capture!==capture);}
  emit(type,fields={}){
    const event={type,isTrusted:false,defaultPrevented:false,...fields};
    for(const capture of [true,false])for(const listener of [...this.listeners])
      if(listener.type===type&&listener.capture===capture)listener.callback(event);
    return event;
  }
}
const project={name:'Navigation',modules:[{id:'m',name:'Module1',kind:'module',code:'Sub Main()\nEnd Sub'}],settings:{}};
function fixture(t){
  const view=new Target();view.document=new Target();view.document.visibilityState='visible';view.navigation=new Target();
  const workers=[];let resumed=0;
  const scheduler=new DiagnosticsScheduler({delay:60000,workerFactory:()=>{
    const worker={postMessage(){},terminate(){this.terminated=true;}};workers.push(worker);return worker;
  }});
  // Emulate a persistence hook installed before the diagnostics plugin.
  view.addEventListener('beforeunload',()=>{scheduler.schedule(project,0);scheduler.start();});
  const cleanup=bindDiagnosticsLifecycle(scheduler,{view,onResume:()=>{resumed++;scheduler.schedule(project);}});
  t.after(()=>{cleanup();scheduler.dispose();});
  const start=()=>{scheduler.schedule(project);scheduler.start();return workers.at(-1);};
  return {view,scheduler,workers,start,cleanup,get resumed(){return resumed;}};
}

test('beforeunload cancels startup before earlier persistence hooks can requeue diagnostics',t=>{
  const f=fixture(t),worker=f.start();
  f.view.emit('beforeunload');
  assert.equal(worker.terminated,true);assert.equal(f.workers.length,1);
  assert.equal(f.scheduler.suspended,true);assert.equal(f.scheduler.pending,false);
  assert.equal(f.scheduler.timer,null);assert.equal(f.scheduler.worker,null);assert.equal(f.scheduler.busy,null);
});

test('abandoned navigation resumes latest source only after a trusted user interaction',t=>{
  const f=fixture(t);f.start();f.view.emit('beforeunload');
  f.view.emit('keydown');assert.equal(f.scheduler.suspended,true);
  f.view.document.emit('visibilitychange');assert.equal(f.resumed,0);
  project.modules[0].code='Sub Updated()\nEnd Sub';
  f.view.emit('pointerdown',{isTrusted:true});
  assert.equal(f.scheduler.suspended,false);assert.equal(f.resumed,1);
  assert.equal(f.scheduler.target.project,project);assert.equal(f.scheduler.target.project.modules[0].code,'Sub Updated()\nEnd Sub');
  f.view.emit('keydown',{isTrusted:true});assert.equal(f.resumed,1);
});

test('pagehide blocks late input and pageshow reactivates a suspended document once',t=>{
  const f=fixture(t);f.start();f.view.emit('pagehide',{persisted:true});
  f.view.emit('pointerdown',{isTrusted:true});assert.equal(f.resumed,0);
  f.view.emit('pageshow',{persisted:true});assert.equal(f.resumed,1);
  f.view.emit('pageshow',{persisted:true});assert.equal(f.resumed,1);
  assert.equal(f.scheduler.suspended,false);
});

test('hidden-page suspension resumes when visible without reviving outgoing documents',t=>{
  const f=fixture(t);f.start();
  f.view.document.visibilityState='hidden';f.view.document.emit('visibilitychange');
  assert.equal(f.scheduler.suspended,true);
  f.view.emit('keydown',{isTrusted:true});assert.equal(f.resumed,0);
  f.view.document.visibilityState='visible';f.view.document.emit('visibilitychange');assert.equal(f.resumed,1);
  f.view.emit('beforeunload');f.view.document.emit('visibilitychange');assert.equal(f.resumed,1);
});

test('optional navigation interception excludes hash changes and downloads',t=>{
  const f=fixture(t);f.start();
  f.view.navigation.emit('navigate',{hashChange:true});assert.equal(f.scheduler.suspended,false);
  f.view.navigation.emit('navigate',{downloadRequest:'project.zip'});assert.equal(f.scheduler.suspended,false);
  f.view.navigation.emit('navigate',{downloadRequest:''});assert.equal(f.scheduler.suspended,false);
  f.view.navigation.emit('navigate',{destination:{sameDocument:true}});assert.equal(f.scheduler.suspended,false);
  f.view.navigation.emit('navigate');assert.equal(f.scheduler.suspended,true);
});

test('lifecycle detachment is idempotent and never revives disposed schedulers',t=>{
  const f=fixture(t);f.start();f.view.emit('beforeunload');f.scheduler.dispose();
  f.view.emit('pageshow');assert.equal(f.resumed,0);
  f.cleanup();f.cleanup();assert.equal(f.view.navigation.listeners.length,0);assert.equal(f.view.document.listeners.length,0);
  assert.equal(f.view.listeners.length,1,'Only the independent persistence hook remains.');
  f.view.emit('pageshow');assert.equal(f.resumed,0);
});
