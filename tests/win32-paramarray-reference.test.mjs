import test from 'node:test';
import assert from 'node:assert/strict';
import {PE32Image} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {emitNativeVariantHelpers} from '../src/native/variant-kernels.js';
import {emitNativeArrayHelpers} from '../src/native/arrays.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';

// Independent instruction execution with deliberately bounded OleAut32 mocks.
// Windows conformance is established separately by the unchanged native job.
function harness(){
 const image=new PE32Image(),x=new X86(image.section('.text',0x60000020),image);
 const config={x,maxArrayBytes:128,nativeVariantArraysUsed:true,nativeVariantsUsed:new Set(['paramarray','paramarray-borrow','array-copy','assign','change'])};
 emitNativeVariantHelpers(config);emitNativeArrayHelpers(config);
 for(const name of ['clear','initialize-fixed'])x.label('native:string:'+name).jump('error:5');
 for(const n of [5,6,7,9,10,11,13,91,94,449])x.label('error:'+n).value(n).jump('native:error:raise');
 x.label('native:error:raise').ret();
 const cpu=new NativeX86Machine(image.finish('native:paramarray:borrow')),mem=cpu.memory;
 const ownedArrays=new Map();
 const fault={copyAt:0,access:0,unlock:0},counts={copy:0,access:0,unlock:0};
 const zero=p=>{for(let n=0;n<16;n+=4)mem.write(p+n,0);};
 const clear=p=>{if(mem.read(p,16)===8&&mem.read(p+8))mem.free(mem.read(p+8)-4);zero(p);return 0;};
 const slot=(vt=0,value=0,high=0)=>{const p=mem.alloc(16,'Variant');zero(p);mem.write(p,vt,16);mem.write(p+8,vt===8?mem.string(value):value);mem.write(p+12,high);return p;};
 const value=p=>{
  let depth=0;while(mem.read(p,16)===0x400c){assert.ok(++depth<64);p=mem.read(p+8);}
  const vt=mem.read(p,16),tag=vt&~0x4000,at=vt&0x4000?mem.read(p+8):p+8;
  return {tag,bits:mem.read(at,tag===17?8:[2,11].includes(tag)?16:32),high:[5,6,7].includes(tag)?mem.read(at+4):0};
 };
 cpu.hook('oleaut32.dll','VariantClear',1,([p])=>clear(p));
 cpu.hook('oleaut32.dll','SysStringLen',1,([p])=>p?mem.bstr(p).length:0);
 cpu.hook('oleaut32.dll','SysFreeString',1,([p])=>{if(p)mem.free(p-4);return 0;});
 cpu.hook('oleaut32.dll','VariantCopyInd',2,([out,source])=>{
  const v=value(source);clear(out);counts.copy++;
  if(counts.copy===fault.copyAt){mem.write(out,8,16);mem.write(out+8,mem.string('partial'));return 0x8007000e;}
  mem.write(out,v.tag,16);mem.write(out+8,v.tag===8?mem.string(mem.bstr(v.bits)):v.bits);mem.write(out+12,v.high);return 0;
 });
 cpu.hook('oleaut32.dll','VariantChangeTypeEx',5,([out,source,lcid,flags,tag])=>{
  assert.equal(lcid,0x400);assert.equal(flags,2);const v=value(source);assert.equal(tag,v.tag,'test uses same-subtype writes');
  clear(out);mem.write(out,tag,16);mem.write(out+8,tag===8?mem.string(mem.bstr(v.bits)):v.bits);mem.write(out+12,v.high);return 0;
 });
 cpu.hook('oleaut32.dll','SafeArrayAccessData',2,([p,out])=>{
  counts.access++;if(fault.access)return fault.access;mem.write(p+8,mem.read(p+8)+1);mem.write(out,mem.read(p+12));return 0;
 });
 cpu.hook('oleaut32.dll','SafeArrayUnaccessData',1,([p])=>{counts.unlock++;assert.ok(mem.read(p+8)>0);mem.write(p+8,mem.read(p+8)-1);return fault.unlock;});
 const array=(elements,bounds=[elements.length])=>{
  assert.equal(bounds.reduce((a,b)=>a*b,1),elements.length);
  const p=mem.alloc(16+8*bounds.length,'SAFEARRAY'),data=mem.alloc(Math.max(16,elements.length*16),'elements');
  mem.region(p).bytes.fill(0);mem.region(data).bytes.fill(0);mem.write(p,bounds.length,16);mem.write(p+2,0x800,16);mem.write(p+4,16);mem.write(p+12,data);
  bounds.forEach((n,i)=>{mem.write(p+16+8*i,n);mem.write(p+20+8*i,-3);});
  elements.forEach((src,i)=>{for(let n=0;n<16;n+=4)mem.write(data+16*i+n,mem.read(src+n));if(mem.read(src,16)===8)mem.write(data+16*i+8,mem.string(mem.bstr(mem.read(src+8))));});
  const result={p,data,elements:elements.length,bounds,drop(){assert.equal(mem.read(p+8),0);for(let i=0;i<elements.length;i++)clear(data+i*16);mem.free(data);mem.free(p);ownedArrays.delete(p);}};
  ownedArrays.set(p,result);return result;
 };
 cpu.hook('oleaut32.dll','SafeArrayCopy',2,([p,out])=>{
  const source=ownedArrays.get(p);assert.ok(source);const copy=array(Array.from({length:source.elements},(_,i)=>source.data+16*i),source.bounds);mem.write(out,copy.p);return 0;
 });
 cpu.hook('oleaut32.dll','SafeArrayDestroy',1,([p])=>{if(!p)return 0;const a=ownedArrays.get(p);assert.ok(a);if(mem.read(p+8))return 0x8002000d;a.drop();return 0;});
 const call=(name,args=[])=>{const esp=cpu.get('esp');try{return cpu.invoke('native:'+name,args);}finally{cpu.set('esp',esp);}};
 return {cpu,mem,slot,clear,value,array,call,fault,counts,ownedArrays};
}
for(const tag of [0,1,2,3,4,5,6,7,8,10,11,14,17])test('ParamArray binds live Variant owner with initial subtype '+tag,()=>{
 const h=harness(),owner=h.slot(tag,tag===8?'initial':7),view=h.slot();
 assert.equal(h.call('paramarray:borrow',[view,owner]),view);assert.equal(h.mem.read(view,16),0x400c);assert.equal(h.mem.read(view+8),owner);
 h.clear(owner);h.mem.write(owner,3,16);h.mem.write(owner+8,99);assert.equal(h.value(view).bits,99);
 h.clear(view);assert.equal(h.value(owner).bits,99,'clearing a borrowed descriptor never clears its referent');
});
for(const tag of [2,3,4,5,6,7,8,11,17])test('ParamArray forwarding flattens typed reference '+tag,()=>{
 const h=harness(),owner=h.slot(tag,tag===8?'A\0\ud800B':12,0x12345678),typed=h.slot(0x4000|tag,owner+8),indirect=h.slot(0x400c,typed),view=h.slot();
 h.call('paramarray:borrow',[view,indirect]);assert.equal(h.mem.read(view,16),0x4000|tag);assert.equal(h.mem.read(view+8),owner+8);
 const source=h.slot(tag,tag===8?'new\0text':55,0x11223344);h.call('variant:assign',[view,source]);
 if(tag===8)assert.equal(h.mem.bstr(h.value(owner).bits),'new\0text');else assert.equal(h.value(owner).bits,55);
 assert.equal(h.mem.read(view,16),0x4000|tag);
});
test('ParamArray aliases and forwarded Variant owners keep one referent',()=>{
 const h=harness(),owner=h.slot(3,7),a=h.slot(),b=h.slot(),forwarded=h.slot();h.call('paramarray:borrow',[a,owner]);h.call('paramarray:borrow',[b,owner]);h.call('paramarray:borrow',[forwarded,a]);
 assert.equal(h.mem.read(forwarded+8),owner);h.call('variant:assign',[a,h.slot(3,42)]);assert.equal(h.value(b).bits,42);assert.equal(h.value(forwarded).bits,42);
});
for(const kind of ['null-owner','null-referent','cycle','unsupported-tag'])test('malformed ParamArray reference fails before publishing: '+kind,()=>{
 const h=harness(),out=h.slot(3,123),src=kind==='null-owner'?0:h.slot(kind==='unsupported-tag'?0x600c:kind==='null-referent'?0x4003:0x400c);
 if(kind==='cycle')h.mem.write(src+8,src);
 assert.throws(()=>h.call('paramarray:borrow',[out,src]),e=>e.number===(kind.startsWith('null')?91:13));assert.equal(h.mem.read(out,16),3);assert.equal(h.mem.read(out+8),123);
});
for(const bounds of [[0],[2],[1,2],[2,1,1]])test('owned Variant array snapshot detaches borrowed elements across bounds '+bounds,()=>{
 const h=harness(),source=h.slot(8,'A\0\ud800B'),ref=h.slot(0x400c,source),n=bounds.reduce((a,b)=>a*b,1),a=h.array(Array(n).fill(ref),bounds);
 assert.equal(h.call('variant:array-detach',[a.p]),0);assert.equal(h.mem.read(a.p+8),0);
 for(let i=0;i<n;i++){assert.equal(h.mem.read(a.data+i*16,16),8);assert.notEqual(h.mem.read(a.data+i*16+8),h.mem.read(source+8));}
 h.clear(source);for(let i=0;i<n;i++)assert.equal(h.mem.bstr(h.mem.read(a.data+i*16+8)),'A\0\ud800B');a.drop();
});
test('normal Variant values do not incur snapshot API calls or change ownership',()=>{
 const h=harness(),a=h.array([h.slot(3,42),h.slot(8,'owned')]),old=h.mem.read(a.data+24);assert.equal(h.call('variant:array-detach',[a.p]),0);assert.equal(h.counts.copy,0);assert.equal(h.mem.read(a.data+24),old);a.drop();
});
for(const failing of [1,2,3])test('failed array detach retains ownership for outer transaction cleanup: '+failing,()=>{
 const h=harness(),source=h.slot(8,'retained'),ref=h.slot(0x400c,source),regions=h.mem.regions.length,a=h.array([ref,ref,ref]);h.fault.copyAt=failing;
 assert.equal(h.call('variant:array-detach',[a.p]),0x8007000e);assert.equal(h.counts.unlock,1);assert.equal(h.mem.read(a.p+8),0);assert.equal(h.mem.bstr(h.value(source).bits),'retained');
 a.drop();assert.equal(h.mem.regions.length,regions,'partial temporary and previously detached BSTRs are reclaimed');
});
test('snapshot access failure does not unlock an unacquired lock',()=>{
 const h=harness(),a=h.array([]);h.fault.access=0x8007000e;assert.equal(h.call('variant:array-detach',[a.p]),h.fault.access);assert.equal(h.counts.unlock,0);a.drop();
});
test('snapshot preserves primary copy error when unlock also fails',()=>{
 const h=harness(),src=h.slot(3,7),a=h.array([h.slot(0x400c,src)]);h.fault.copyAt=1;h.fault.unlock=0x8002000d;assert.equal(h.call('variant:array-detach',[a.p]),0x8007000e);a.drop();
});
test('snapshot reports unlock error when element copies succeed',()=>{
 const h=harness(),a=h.array([]);h.fault.unlock=0x8002000d;assert.equal(h.call('variant:array-detach',[a.p]),h.fault.unlock);a.drop();
});
for(const [offset,width,value,error]of [[0,16,0,0x80070057],[0,16,61,0x80070057],[4,32,8,0x80070057],[16,32,9,0x8007000e]])test('invalid array snapshot geometry is checked before data access '+offset+'/'+value,()=>{
 const h=harness(),a=h.array([]);h.mem.write(a.p+offset,value,width);assert.equal(h.call('variant:array-detach',[a.p]),error);assert.equal(h.counts.access,0);a.drop();
});
const project=code=>({...newProject('ParamArrayReferences'),startup:'Sub Main',modules:[{id:'m',name:'Entry',kind:'module',code}]});
for(const optimization of [0,1,2])test('compile ParamArray aliases, pinned elements and escaping value arrays at O'+optimization,()=>{
 const p=project('Dim saved() As Variant\nSub Main()\nDim n As Long\nDim a() As Long\nReDim a(1 To 2)\nP n,n,(n),a(1)\nEnd Sub\nSub P(ParamArray values() As Variant)\nvalues(0)=42\nsaved=values\nEnd Sub'),before=JSON.stringify(p),r=compileWin32(p,{optimization});
 assert.equal(JSON.stringify(p),before);assert.deepEqual(r.bytes,compileWin32(p,{optimization}).bytes);assert.equal(r.report.extraction,false);
 assert.match(JSON.stringify(r.report.imports),/SafeArrayAccessData/);
});

for(const failing of [1,2])test('Variant array assignment keeps old destination and destroys a failed detached clone: '+failing,()=>{
 const h=harness(),owner=h.slot(8,'live'),ref=h.slot(0x400c,owner),source=h.array([ref,ref]),old=h.array([h.slot(8,'keep')]),src=h.mem.alloc(4),dest=h.mem.alloc(4);
 h.mem.write(src,source.p);h.mem.write(dest,old.p);const regions=h.mem.regions.length;h.fault.copyAt=failing;
 assert.throws(()=>h.call('array:copy-variants',[dest,src]),e=>e.number===7);
 assert.equal(h.mem.read(dest),old.p);assert.equal(h.mem.bstr(h.mem.read(old.data+8)),'keep');assert.equal(h.ownedArrays.size,2);assert.equal(h.mem.regions.length,regions);
 assert.equal(h.mem.bstr(h.mem.read(owner+8)),'live');assert.equal(h.mem.read(source.data,16),0x400c);
});
test('successful Variant array assignment commits only detached owned elements',()=>{
 const h=harness(),owner=h.slot(8,'owned copy'),source=h.array([h.slot(0x400c,owner)]),old=h.array([h.slot(3,5)]),src=h.mem.alloc(4),dest=h.mem.alloc(4);
 h.mem.write(src,source.p);h.mem.write(dest,old.p);h.call('array:copy-variants',[dest,src]);const copy=h.ownedArrays.get(h.mem.read(dest));assert.ok(copy);assert.ok(!h.ownedArrays.has(old.p));assert.notEqual(copy.p,source.p);
 h.clear(owner);source.drop();assert.equal(h.mem.read(copy.data,16),8);assert.equal(h.mem.bstr(h.mem.read(copy.data+8)),'owned copy');copy.drop();assert.equal(h.ownedArrays.size,0);
});
for(const fixed of [false,true])test('locked or fixed Variant destination fails before snapshot allocation: '+fixed,()=>{
 const h=harness(),source=h.array([h.slot(3,1)]),old=h.array([h.slot(3,2)]),src=h.mem.alloc(4),dest=h.mem.alloc(4);
 h.mem.write(src,source.p);h.mem.write(dest,old.p);h.mem.write(old.p+(fixed?2:8),fixed?0x810:1,fixed?16:32);
 assert.throws(()=>h.call('array:copy-variants',[dest,src]),e=>e.number===10);assert.equal(h.counts.copy,0);assert.equal(h.mem.read(dest),old.p);assert.equal(h.ownedArrays.size,2);
});
