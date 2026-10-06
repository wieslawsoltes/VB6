import {Win32Error,integer} from './core.js';

/** Owned virtual COM task allocations, not COM activation or native pointers.
 * https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-cotaskmemalloc
 * https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-cotaskmemrealloc
 */
export function installTaskMemory(w){
  const m=w.memory;
  const add=(name,arity,fn)=>w.register('ole32',name,fn,{arity,notes:'Owned bounded virtual task memory. NULL free is harmless; failed realloc retains its original allocation. No native COM heap.'});
  const owned=p=>{const b=m.block(p,0);if(b.ptr!==Number(p)||b.owner!=='co-task-memory')throw new Win32Error('Expected a task allocation base',6);return b;};
  const allocate=n=>{n=integer(n,0,m.maxBytes);const p=m.alloc(n);m.block(p).owner='co-task-memory';return p;};
  add('CoTaskMemAlloc',1,allocate);
  add('CoTaskMemFree',1,p=>{if(p){owned(p);m.free(p);}});
  add('CoTaskMemRealloc',2,(p,n)=>{
    n=integer(n,0,m.maxBytes);if(!p)return allocate(n);
    const old=owned(p);if(!n){m.free(p);return 0;}
    // Reserve before modifying/freeing the original; quotas are failure-atomic.
    const next=allocate(n);m.bytes(next,Math.min(n,old.size)).set(old.bytes.subarray(0,n));m.free(p);return next;
  });
}
