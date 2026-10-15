import assert from 'node:assert/strict';import {compileProject} from '../../src/language/compiler.js';import {VirtualMachine} from '../../src/runtime/vm.js';import {VBError} from '../../src/language/lexer.js';
import {NATIVE_CHART_HOSTS,nativeChartCoreSource,NATIVE_CHART_FIELDS as F} from '../../src/native/control-chart-core.js';
export async function chartKernel(count=2){
 const pattern=new RegExp('^Private Function ('+Object.keys(NATIVE_CHART_HOSTS).join('|')+')\\([^\\n]*\\nEnd Function\\n','gm');
 const program=compileProject({name:'ChartKernel',externalSymbols:Object.keys(NATIVE_CHART_HOSTS).map(name=>({name,kind:'function'})),startup:'Sub Main',modules:[{name:'ChartKernel',kind:'module',code:nativeChartCoreSource(count).replace(pattern,'')+'\nPrivate Sub Main()\nEnd Sub'}]});assert.deepEqual(program.diagnostics,[]);
 const vm=new VirtualMachine(program,{}, {instructionLimit:100000000}),buffers=new Map(),draws=[],invalidations=[];let next=1,allocations=Infinity,writes=Infinity;
 const buffer=h=>{const b=buffers.get(h);if(!b)throw new VBError('Invalid chart array',9);return b;},checked=(h,i)=>{const b=buffer(h);if(!Number.isInteger(i)||i<0||i>=b.items.length)throw new VBError('Subscript out of range',9);return b;};
 vm.library.set('buffernew',(n,kind)=>{if(allocations--<=0)throw new VBError('Injected allocation failure',7);const h=next++;buffers.set(h,{kind,items:Array(n).fill(kind===8?'':0)});return h;});vm.library.set('bufferfree',h=>{if(h)assert.ok(buffers.delete(h),'single destroy');return 0;});
 for(const name of ['numberget','buffertext'])vm.library.set(name,(h,i)=>checked(h,i).items[i]);
 for(const name of ['numberput','bufferwrite'])vm.library.set(name,(h,i,value)=>{if(writes--<=0)throw new VBError('Injected copy failure',7);checked(h,i).items[i]=value;return 0;});
 vm.library.set('finite',value=>Number.isFinite(value)?-1:0);vm.library.set('hostdraw',(...args)=>{draws.push(args);return 1;});vm.library.set('hostinvalidate',h=>{invalidations.push(h);return 1;});
 await vm.start();const instance=vm.instances.get('chartkernel'),epochs=new Map(),handles=new Map();
 const raw=(name,...args)=>vm.callProcedure(instance,instance.module.procedures.get(name.toLowerCase()),args);
 const call=(id,name,...args)=>raw(name,id,handles.get(id),epochs.get(id),...args);
 return {vm,buffers,draws,raw,call,invalidations,failAfter:n=>{allocations=n;},failWrites:n=>{writes=n;},
 async init(id,rows,cols,hwnd=100+id){await raw('initialize',id,hwnd,rows,cols);handles.set(id,hwnd);epochs.set(id,await raw('stamp',id));},
 get:(id,field)=>call(id,'getfield',F[field]),set:(id,field,value)=>call(id,'setfield',F[field],value),
 async close(){for(const id of handles.keys())await raw('dispose',id);assert.equal(buffers.size,0);vm.stop();}
 };
}
