import assert from 'node:assert/strict';
import {compileProject} from '../../src/language/compiler.js';
import {VirtualMachine} from '../../src/runtime/vm.js';
import {nativeGridCoreSource,NATIVE_GRID_HOSTS} from '../../src/native/control-grid-core.js';
import {NATIVE_GRID_FIELDS as F} from '../../src/native/control-grid-contract.js';
import {VBError} from '../../src/language/lexer.js';
export async function gridKernel(count=2){
 const pattern=new RegExp('^Private Function ('+Object.keys(NATIVE_GRID_HOSTS).join('|')+')\\([^\\n]*\\nEnd Function\\n','gm');
 const source=nativeGridCoreSource(count).replace(pattern,'')+'\nPrivate Sub Main()\nEnd Sub\n';
 const program=compileProject({name:'GridKernel',startup:'Sub Main',externalSymbols:Object.keys(NATIVE_GRID_HOSTS).map(name=>({name,kind:'function'})),modules:[{name:'GridKernel',kind:'module',code:source}]});assert.deepEqual(program.diagnostics,[]);
 const buffers=new Map(),draws=[],notices=[],invalidations=[],bars=[];let next=1,remaining=Infinity,writes=Infinity;
 const allocate=(n,kind)=>{if(remaining--<=0)throw new VBError('Injected allocation failure',7);const handle=next++;buffers.set(handle,{kind,items:Array(n).fill(kind===8?'':0)});return handle;};
 const buffer=h=>{const b=buffers.get(h);if(!b)throw new VBError('Invalid array',9);return b;};
 const checked=(h,i)=>{const b=buffer(h);if(!Number.isInteger(i)||i<0||i>=b.items.length)throw new VBError('Array bounds',9);return b;};
 const vm=new VirtualMachine(program,{}, {instructionLimit:100000000});
 vm.library.set('buffercopy',h=>{const old=buffer(h),copy=allocate(old.items.length,old.kind);buffers.get(copy).items=[...old.items];return copy;});
 vm.library.set('buffernew',allocate);vm.library.set('bufferfree',h=>{if(h&&!buffers.delete(h))throw new Error('Double free: '+h);return 0;});
 for(const name of ['bufferget','buffertext'])vm.library.set(name,(h,i)=>checked(h,i).items[i]);
 for(const name of ['bufferput','bufferwrite'])vm.library.set(name,(h,i,v)=>{if(writes--<=0)throw new VBError('Injected copy failure',7);checked(h,i).items[i]=v;return 0;});
 vm.library.set('hostinvalidate',hwnd=>{invalidations.push(hwnd);return 0;});
 vm.library.set('hostnotify',(hwnd,flags)=>{notices.push({hwnd,flags});return 0;});
 vm.library.set('hostcolors',()=>0);
 vm.library.set('hostcell',(hwnd,dc,x,y,width,height,text,flags,alignment)=>{draws.push({hwnd,dc,x,y,width,height,text,flags,alignment});return 0;});
 vm.library.set('hostbars',(...args)=>{bars.push(args);return 0;});
 await vm.start();const instance=vm.instances.get('gridkernel');
 const raw=(name,...args)=>vm.callProcedure(instance,instance.module.procedures.get(name.toLowerCase()),args);
 const epochs=new Map(),handles=new Map();
 const call=(id,name,...args)=>raw(name,id,handles.get(id),epochs.get(id),...args);
 return {vm,buffers,draws,notices,bars,invalidations,raw,call,failAfter:n=>{remaining=n;},failWrites:n=>{writes=n;},
  async initialize(id,rows,cols,hwnd=100+id){await raw('initialize',id,hwnd,rows,cols);epochs.set(id,await raw('stamp',id));handles.set(id,hwnd);},
  get:(id,name)=>call(id,'getfield',F[name]),set:(id,name,v)=>call(id,'setfield',F[name],v),
  text:(id,r,c)=>call(id,'gettext',r,c),put:(id,r,c,v)=>call(id,'settext',r,c,v),
  async close(){for(const id of handles.keys())await raw('dispose',id);assert.equal(buffers.size,0);vm.stop();}
 };
}
