import {Win32Error,integer,unsigned} from './core.js';
import {registerAW} from './services-utils.js';
export const SYNC_CONSTANTS=Object.freeze({WAIT_OBJECT_0:0,WAIT_TIMEOUT:258,WAIT_FAILED:0xffffffff,INFINITE:0xffffffff,MAXIMUM_WAIT_OBJECTS:64,SYNCHRONIZE:0x100000,EVENT_MODIFY_STATE:2,SEMAPHORE_MODIFY_STATE:2,EVENT_ALL_ACCESS:0x1f0003,SEMAPHORE_ALL_ACCESS:0x1f0003});
/** Cooperative process-private event/semaphore waits, never Atomics.wait on the UI.
 * https://learn.microsoft.com/windows/win32/api/synchapi/nf-synchapi-waitformultipleobjects
 * https://learn.microsoft.com/windows/win32/sync/event-objects
 * Names are case-sensitive and shared only by this Win32Browser instance. */
export function installSynchronization(w) {
  const m=w.memory,h=w.handles,names=new Map(),pending=new Set();
  const limit=integer(w.options.maxPendingWaits??1024,1,65536);
  const notes='Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace.';
  const add=(name,arity,fn,extra={})=>w.register('kernel32',name,fn,{arity,notes,...extra});
  function get(handle,access=0){const e=h.get(handle,'sync');if((e.access&access)!==access)throw new Win32Error('Synchronization handle access denied',5);return e.object;}
  function makeHandle(object,access){const handle=h.add('sync',{object,access});object.refs++;return handle;}
  function nameOf(p,wide){const name=m.string(p,wide);if(name.length>260)throw new Win32Error('Object name is too long',206);return name;}
  function create(wide,type,security,a,b,namePtr){
    if(security)throw new Win32Error('Security descriptors are not supported',50);
    const name=nameOf(namePtr,wide);let object=name?names.get(name):null;
    if(object){if(object.type!==type)throw new Win32Error('Name belongs to another object type',6);const handle=makeHandle(object,0x1f0003);w.lastError=183;return handle;}
    if(type==='semaphore'){a=integer(a,0,0x7fffffff);b=integer(b,1,0x7fffffff);if(a>b)throw new Win32Error('Initial count exceeds maximum');}
    object={type,name,refs:0,manual:!!a,signaled:!!b,count:a,max:b};
    const handle=makeHandle(object,0x1f0003);if(name)names.set(name,object);w.lastError=0;return handle;
  }
  for(const type of ['event','semaphore']){
    const suffix=type==='event'?'Event':'Semaphore';
    registerAW(w,'kernel32','Create'+suffix,4,(wide,security,a,b,name)=>create(wide,type,security,a,b,name),{notes});
    registerAW(w,'kernel32','Open'+suffix,3,(wide,access,inherit,p)=>{
      access=unsigned(access);if(access&~0x1f0003||inherit)throw new Win32Error('Unsupported access or inheritance',50);
      const object=names.get(nameOf(p,wide));if(!object)throw new Win32Error('Named object not found',2);
      if(object.type!==type)throw new Win32Error('Named object type mismatch',6);return makeHandle(object,access);
    },{notes});
  }
  const ready=o=>o.type==='event'?o.signaled:o.count>0;
  const consume=o=>{if(o.type==='event'){if(!o.manual)o.signaled=false;}else o.count--;};
  function tryAcquire(wait){
    for(const handle of wait.handles)if(!h.has(handle,'sync'))throw new Win32Error('A waited handle was closed',6);
    const index=wait.all?(wait.objects.every(ready)?0:-1):wait.objects.findIndex(ready);
    if(index<0)return null;
    if(wait.all)wait.objects.forEach(consume);else consume(wait.objects[index]);return index;
  }
  function finish(wait,value,error){pending.delete(wait);clearTimeout(wait.timer);if(error)wait.reject(error);else wait.resolve(value);}
  function notify(){for(const wait of [...pending]){try{const result=tryAcquire(wait);if(result!==null)finish(wait,result);}catch(error){finish(wait,0,error);}}}
  add('SetEvent',1,handle=>{const o=get(handle,2);if(o.type!=='event')throw new Win32Error('Expected event',6);o.signaled=true;notify();return 1;});
  add('ResetEvent',1,handle=>{const o=get(handle,2);if(o.type!=='event')throw new Win32Error('Expected event',6);o.signaled=false;return 1;});
  add('ReleaseSemaphore',3,(handle,count,previous)=>{const o=get(handle,2);if(o.type!=='semaphore')throw new Win32Error('Expected semaphore',6);count=integer(count,1,0x7fffffff);if(previous)m.view(previous,4);if(o.count+count>o.max)throw new Win32Error('Semaphore maximum exceeded',298);if(previous)m.writeU32(previous,o.count);o.count+=count;notify();return 1;});
  function wait(handles,all,timeout){
    timeout=unsigned(timeout);if(new Set(handles).size!==handles.length)throw new Win32Error('Duplicate wait handles');
    const state={handles,all,objects:handles.map(handle=>get(handle,0x100000)),timer:null};
    // Aliased handles to the same object cannot be consumed twice in wait-all.
    if(all&&new Set(state.objects).size!==state.objects.length)throw new Win32Error('Duplicate wait objects');
    const result=tryAcquire(state);if(result!==null)return result;if(timeout===0)return 258;
    if(pending.size>=limit)throw new Win32Error('Wait quota exceeded',8);
    return new Promise((resolve,reject)=>{
      Object.assign(state,{resolve,reject});pending.add(state);
      if(timeout!==0xffffffff){const end=w.clock()+timeout;const tick=()=>{const remaining=end-w.clock();if(remaining<=0)finish(state,258);else state.timer=setTimeout(tick,Math.min(remaining,0x7fffffff));};state.timer=setTimeout(tick,Math.min(timeout,0x7fffffff));}
    });
  }
  add('WaitForSingleObject',2,(handle,timeout)=>wait([Number(handle)],false,timeout),{failure:0xffffffff});
  add('WaitForMultipleObjects',4,(count,list,all,timeout)=>{count=integer(count,1,64);const v=m.view(list,count*4);return wait(Array.from({length:count},(_,i)=>v.getUint32(i*4,true)),!!all,timeout);},{failure:0xffffffff});
  const closeFile=w.resolve('kernel32','CloseHandle').fn;
  add('CloseHandle',1,handle=>{
    if(!h.has(handle,'sync'))return closeFile(handle);
    const o=h.close(handle,'sync').object;if(--o.refs===0&&o.name)names.delete(o.name);notify();return 1;
  },{replace:true,notes:'Closes file or synchronization handles. Closing a pending wait fails it with INVALID_HANDLE rather than leaving an unresolved promise.'});
  w.disposeSynchronization=()=>{for(const state of [...pending])finish(state,0,new Win32Error('Compatibility process disposed',995));names.clear();};
}
