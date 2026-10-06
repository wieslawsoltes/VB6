import {Win32Error,unsigned} from './core.js';

/** Operations are indivisible within one JS compatibility instance. The bounded
 * memory is not shared between workers; no cross-worker native fence is claimed. */
export function installIntegerOperations(w) {
  const m=w.memory;
  const add=(name,arity,op,updated=false)=>w.register('kernel32',name,(p,...args)=>{
    if(unsigned(p)%4)throw new Win32Error('Interlocked LONG must be four-byte aligned');
    const values=args.map(n=>unsigned(n)|0),v=m.view(p,4),old=v.getInt32(0,true),next=op(old,...values)|0;
    v.setInt32(0,next,true);return updated?next:old;
  },{arity,notes:'Signed 32-bit wraparound in private, single-agent memory; not SharedArrayBuffer synchronization.'});
  add('InterlockedIncrement',1,n=>n+1,true);
  add('InterlockedDecrement',1,n=>n-1,true);
  add('InterlockedExchange',2,(_n,value)=>value);
  add('InterlockedExchangeAdd',2,(n,value)=>n+value);
  add('InterlockedCompareExchange',3,(n,value,expected)=>n===expected?value:n);
  add('InterlockedAnd',2,(n,value)=>n&value);
  add('InterlockedOr',2,(n,value)=>n|value);
  add('InterlockedXor',2,(n,value)=>n^value);
}
