import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {planNativeArguments} from '../src/native/call-plan.js';
import {parseExpression} from '../src/language/expression.js';
import {newProject} from '../src/project/model.js';
import {storageLayout} from '../src/native/storage.js';
import {PE32Image} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {emitNativeVariantHelpers} from '../src/native/variant-kernels.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';
const signature={name:'Pack',params:[{name:'first',type:'Long',byRef:false},{name:'values',type:'Variant',bounds:[],paramArray:true,byRef:false}]};
const plan=source=>planNativeArguments(signature,parseExpression(source).args);
const project=(body,proc='Function Pack(ByVal first As Long,ParamArray values() As Variant) As Variant\nPack=values(0)\nEnd Function')=>({...newProject('NativeParamArray'),startup:'Sub Main',modules:[{id:'m',name:'Entry',kind:'module',code:`Option Explicit\nOption Base 1\nSub Main()\n${body}\nEnd Sub\n${proc}`}]});

test('ParamArray planner stages a single rest slot after all required arguments',()=>{
 const p=plan('Pack(Mark(1),Mark(2),,Mark(3))');
 assert.deepEqual(p.order.map(e=>e.index),[0,1]);assert.deepEqual(p.slots[1].node.args.map(a=>a.kind),['call','missing','call']);
 assert.deepEqual(p.slots[1].node.args.filter(a=>a.kind==='call').map(a=>a.args[0].value),[2,3]);
});
test('empty ParamArray still has a real array slot, not an omitted optional default',()=>{
 const p=plan('Pack(1)');assert.equal(p.slots[1].omitted,false);assert.deepEqual(p.slots[1].node.args,[]);
});
test('ParamArray argument planning does not mutate the signature or parsed call',()=>{
 const args=parseExpression('Pack(1,2,,3)').args,before=JSON.stringify({signature,args});planNativeArguments(signature,args);assert.equal(JSON.stringify({signature,args}),before);
});
for(const source of ['Pack()','Pack(,2)'])test('required ParamArray prefix remains required: '+source,()=>assert.throws(()=>plan(source),/required|not optional/));
for(const source of ['Pack(first:=1)','Pack(1,values:=2)','Pack(first:=1,values:=2)'])test('classic ParamArray rejects every named calling spelling: '+source,()=>assert.throws(()=>plan(source),/positional/));
test('ParamArray storage accepts its internal descriptor-slot ABI without reclassifying source ByVal',()=>{
 const c={fail:m=>{throw Error(m);}},p=storageLayout(c,{...signature.params[1],parameter:true},{optionBase:1});
 assert.equal(p.byRef,false);assert.equal(p.nativeBytes,4);assert.equal(p.nativeElementBytes,16);assert.equal(p.nativeDynamic,true);
 assert.throws(()=>storageLayout(c,{name:'a',type:'Variant',bounds:[],parameter:true,byRef:false},{optionBase:0}),/unsized and ByRef/);
});
for(const optimization of [0,1,2])test('native ParamArray compiles scalar snapshots and indexed write-through at O'+optimization,()=>{
 const p=project('Dim v As Variant\nv=Pack(7,"A" & ChrW(0) & "B",CDec("1.25"),Null,,CByte(255))',`Function Pack(ByVal first As Long,ParamArray values() As Variant) As Variant
Dim n As Long
n=LBound(values)+UBound(values)
If Not IsMissing(values) Then values(0)="changed"
Pack=values(0)
End Function`),before=JSON.stringify(p),r=compileWin32(p,{optimization});
 assert.equal(JSON.stringify(p),before);assert.deepEqual(r.bytes,compileWin32(p,{optimization}).bytes);
 for(const name of ['SafeArrayCreate','SafeArrayPutElement','VariantClear','VariantCopyInd'])assert.ok(JSON.stringify(r.report.imports).includes(name),name);
 assert.equal(r.report.architecture,'x86');assert.equal(r.report.extraction,false);
});
test('native ParamArray obeys the host sixteen-byte element budget',()=>{
 assert.ok(compileWin32(project('Dim v As Variant\nv=Pack(1,2,3)'),{maxArrayBytes:32}).bytes.length);
 assert.throws(()=>compileWin32(project('Dim v As Variant\nv=Pack(1,2,3,4)'),{maxArrayBytes:32}),/ParamArray.*budget/);
});
test('unused native ParamArray support adds no element-copy API to ordinary programs',()=>{
 const p=project('Dim n As Long\nn=1','');assert.ok(!JSON.stringify(compileWin32(p).report.imports).includes('SafeArrayPutElement'));
});
for(const source of ['Pack 1, ByVal 2','Pack first:=1'])test('illegal native ParamArray actuals remain explicit: '+source,()=>assert.throws(()=>compileWin32(project(source)),error=>{if(source.includes(':=')){assert.deepEqual(error.diagnostics.map(d=>d.code),['VB_NAMED_ARGUMENT','VB_ARGUMENT_REQUIRED']);assert.match(error.message,/Named arguments are not allowed for a ParamArray procedure/);}else assert.match(error.message,/positional|ByVal/);return true;}));

// Instruction execution with explicit OleAut32 mocks checks ABI, ownership and
// fault paths independently of compiler pattern matching. It is not OS evidence.
function harness(){
 const image=new PE32Image(),x=new X86(image.section('.text',0x60000020),image);
 emitNativeVariantHelpers({x,nativeVariantsUsed:new Set(['paramarray']),maxArrayBytes:64});
 for(const n of [5,6,7,9,10,11,13,91,94,449])x.label('error:'+n).value(n).jump('native:error:raise');
 x.label('native:error:raise').ret();const cpu=new NativeX86Machine(image.finish('native:paramarray:create')),mem=cpu.memory,arrays=new Map(),fault={create:false,put:0,clear:0};
 const zero=p=>{for(let i=0;i<16;i+=4)mem.write(p+i,0);};
 const clear=p=>{
  const vt=mem.read(p,16),ptr=mem.read(p+8);
  if(vt===0x200c&&ptr){const a=arrays.get(ptr);assert.ok(a);for(let i=0;i<a.count;i++)clear(a.data+16*i);if(a.data)mem.free(a.data);mem.free(ptr);arrays.delete(ptr);}
  else if(vt===8&&ptr)mem.free(ptr-4);
  zero(p);return 0;
 };
 const slot=(vt=0,value=0)=>{const p=mem.alloc(16,'Variant owner');zero(p);mem.write(p,vt,16);mem.write(p+8,vt===8?mem.string(value):value);return p;};
 cpu.hook('oleaut32.dll','VariantClear',1,([p])=>fault.clear||clear(p));
 cpu.hook('oleaut32.dll','SafeArrayCreate',3,([vt,rank,bounds])=>{
  assert.equal(vt,12);assert.equal(rank,1);assert.equal(mem.read(bounds+4),0);if(fault.create)return 0;
  const count=mem.read(bounds),ptr=mem.alloc(24,'SAFEARRAY'),data=count?mem.alloc(count*16,'Variant elements'):0;
  for(let i=0;i<count;i++)zero(data+16*i);arrays.set(ptr,{count,data});return ptr;
 });
 cpu.hook('oleaut32.dll','SafeArrayPutElement',3,([ptr,index,source])=>{
  const a=arrays.get(ptr);assert.ok(a);const i=mem.read(index);if(i>=a.count)return 0x8002000b;
  const dest=a.data+i*16;clear(dest);for(let n=0;n<16;n+=4)mem.write(dest+n,mem.read(source+n));
  if(mem.read(source,16)===8)mem.write(dest+8,mem.string(mem.bstr(mem.read(source+8))));
  return fault.put;
 });
 const call=(name,args)=>{const esp=cpu.get('esp');try{return cpu.invoke(name.startsWith('native:')?name:'native:paramarray:'+name,args);}finally{cpu.set('esp',esp);}};
 return {mem,cpu,arrays,fault,slot,call,clear};
}
for(const count of [0,1,4])test('ParamArray create publishes one zero-based owned descriptor: '+count,()=>{
 const h=harness(),owner=h.slot();assert.equal(h.call('create',[owner,count]),owner+8);assert.equal(h.mem.read(owner,16),0x200c);
 const a=h.arrays.get(h.mem.read(owner+8));assert.equal(a.count,count);
 h.call('native:variant:clear',[owner]);assert.equal(h.arrays.size,0);assert.equal(h.mem.read(owner,16),0);
});
for(const count of [5,0xffffffff])test('ParamArray size rejection occurs before touching the old owner: '+count,()=>{
 const h=harness(),owner=h.slot(8,'retained'),p=h.mem.read(owner+8),regions=h.mem.regions.length;
 assert.throws(()=>h.call('create',[owner,count]),e=>e.number===7);assert.equal(h.mem.read(owner+8),p);assert.equal(h.mem.bstr(p),'retained');assert.equal(h.mem.regions.length,regions);
});
test('ParamArray allocation failure leaves no untracked owner',()=>{
 const h=harness(),owner=h.slot(8,'old');h.fault.create=true;assert.throws(()=>h.call('create',[owner,2]),e=>e.number===7);
 assert.equal(h.arrays.size,0);assert.equal(h.mem.read(owner,16),0);h.call('native:variant:clear',[owner]);
});
test('ParamArray copies counted String elements without adopting the source BSTR',()=>{
 const h=harness(),owner=h.slot(),source=h.slot(8,'A\0\ud800B');h.call('create',[owner,1]);h.call('put',[owner,0,source]);
 const a=h.arrays.get(h.mem.read(owner+8)),p=h.mem.read(a.data+8);assert.notEqual(p,h.mem.read(source+8));h.clear(source);assert.equal(h.mem.bstr(p),'A\0\ud800B');
 h.call('native:variant:clear',[owner]);assert.equal(h.arrays.size,0);
});
for(const [hr,error]of [[0x8007000e,7],[0x8002000b,9],[0x80020005,13]])test('partially populated ParamArray remains owned after failed element copy '+hr,()=>{
 const h=harness(),owner=h.slot(),source=h.slot(8,'snapshot'),regions=h.mem.regions.length;h.call('create',[owner,2]);h.call('put',[owner,0,source]);h.fault.put=hr;
 assert.throws(()=>h.call('put',[owner,1,source]),e=>e.number===error);assert.equal(h.arrays.size,1);h.call('native:variant:clear',[owner]);
 assert.equal(h.arrays.size,0);assert.equal(h.mem.regions.length,regions);assert.equal(h.mem.bstr(h.mem.read(source+8)),'snapshot');
});
test('repeated ParamArray packs release the previous descriptor before replacement',()=>{
 const h=harness(),owner=h.slot(),source=h.slot(8,'value'),regions=h.mem.regions.length;
 for(let i=0;i<100;i++){h.call('create',[owner,2]);h.call('put',[owner,0,source]);h.call('put',[owner,1,source]);assert.equal(h.arrays.size,1);}
 h.call('native:variant:clear',[owner]);assert.equal(h.mem.regions.length,regions);
});
test('failed ParamArray owner clear never allocates or publishes a replacement',()=>{
 const h=harness(),owner=h.slot();h.call('create',[owner,1]);const old=h.mem.read(owner+8);h.fault.clear=0x8002000d;
 assert.throws(()=>h.call('create',[owner,2]),e=>e.number===10);assert.equal(h.mem.read(owner+8),old);assert.equal(h.arrays.size,1);h.fault.clear=0;h.clear(owner);
});

test('previously unsupported empty ParamArray Sub now lowers with a real descriptor',()=>{
 assert.ok(compileWin32(project('P','Private Sub P(ParamArray x() As Variant)\nEnd Sub')).bytes.length);
});
