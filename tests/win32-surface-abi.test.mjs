/** Test-only Windows hooks exercise the actual emitted IA-32 allocation and
 * rollback paths. These are independent resource/pixel oracles, not real GDI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {PE32Image} from '../src/native/pe32.js';
import {SURFACE_KERNEL} from '../src/native/surface-kernel.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';
function machine(t,optimization=0){
  const p={...newProject('SurfaceABI'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:SURFACE_KERNEL+`
Private saved As Surface,result As Long,code As Long
Private Sub Main()
 On Error Resume Next
 result=SurfaceDC(saved)
 code=Err.Number
End Sub
Private Sub Dispose()
 SurfaceRelease saved
End Sub`} ]};
  let linked;const finish=PE32Image.prototype.finish;t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});
  compileWin32(p,{optimization});const vm=new NativeX86Machine(linked);vm.hooks.delete(vm.symbol('native:error:raise'));
  const state=vm.symbol('global:M:saved'),mem=vm.memory;
  mem.write(state,77);mem.write(state+24,-1);mem.write(state+28,3);mem.write(state+32,0xabcdef);
  return {vm,state,result:()=>mem.read(vm.symbol('global:M:result')),error:()=>mem.read(vm.symbol('global:M:code'))};
}
function gdi(vm){
  const m=vm.memory,objects=new Map(),dcs=new Map(),events=[];let next=1000;
  const env={width:4,height:4,fail:null,calls:0,objects,dcs,events};
  const failed=name=>env.fail===name;
  const object=(kind,more={})=>{const h=next++;objects.set(h,{kind,...more});return h;};
  const dc=()=>{const h=next++;dcs.set(h,{bitmap:1,font:0,clip:0,map:1,origin:[0,0],viewport:[0,0],world:0,saves:[]});return h;};
  env.pixel=(h,x,y)=>{const b=objects.get(dcs.get(h).bitmap);return b.pixels[y*b.width+x];};
  env.setPixel=(h,x,y,color)=>{const b=objects.get(dcs.get(h).bitmap);b.pixels[y*b.width+x]=color;};
  vm.hook('kernel32.dll','GetLastError',0,()=>5);
  vm.hook('user32.dll','IsWindow',1,([h])=>h===77?1:0);
  vm.hook('user32.dll','GetClientRect',2,([h,p])=>{assert.equal(h,77);for(const [i,n]of [0,0,env.width,env.height].entries())m.write(p+i*4,n);return 1;});
  vm.hook('user32.dll','GetSysColor',1,([index])=>0xabcdef);
  vm.hook('gdi32.dll','CreateCompatibleDC',1,([source])=>{assert.equal(source,0);if(failed('dc'))return 0;events.push('create-dc');return dc();});
  vm.hook('gdi32.dll','CreateDIBSection',6,([h,info,use,bits,section,offset])=>{
    assert.ok(dcs.has(h));assert.equal(m.read(info),40);assert.equal(m.read(info+12,16),1);assert.equal(m.read(info+14,16),32);
    const width=m.read(info+4),height=-(m.read(info+8)|0);assert.deepEqual([use,section,offset],[0,0,0]);assert.ok(width>0&&height>0);
    if(failed('bitmap'))return 0;
    const p=m.alloc(width*height*4,'DIB pixels');m.write(bits,p);events.push('create-bitmap');
    return object('bitmap',{width,height,p,pixels:new Uint32Array(width*height)});
  });
  vm.hook('gdi32.dll','SelectObject',2,([h,obj])=>{
    const d=dcs.get(h);assert.ok(d,'unknown DC');if(failed('select')&&obj!==1)return 0;
    assert.ok(obj===1||objects.has(obj),'unknown selected object');
    if(obj!==1)assert.ok(![...dcs.entries()].some(([other,v])=>other!==h&&v.bitmap===obj),'one bitmap cannot be selected into two DCs');
    const old=d.bitmap;d.bitmap=obj;return old;
  });
  vm.hook('gdi32.dll','DeleteDC',1,([h])=>{assert.ok(dcs.has(h));dcs.delete(h);events.push('delete-dc');return 1;});
  vm.hook('gdi32.dll','DeleteObject',1,([h])=>{
    const obj=objects.get(h);assert.ok(obj,'double delete/unknown GDI object');assert.ok(![...dcs.values()].some(d=>d.bitmap===h),'deleting a selected bitmap');
    if(obj.p)m.free(obj.p);objects.delete(h);events.push('delete-'+obj.kind);return 1;
  });
  vm.hook('gdi32.dll','CreateSolidBrush',1,([color])=>failed('brush')?0:object('brush',{color}));
  vm.hook('user32.dll','FillRect',3,([h,bounds,brush])=>{
    if(failed('fill'))return 0;const b=objects.get(dcs.get(h).bitmap),color=objects.get(brush).color;
    assert.equal(m.read(bounds),0);assert.equal(m.read(bounds+4),0);assert.equal(m.read(bounds+8),b.width);assert.equal(m.read(bounds+12),b.height);
    b.pixels.fill(color);return 1;
  });
  vm.hook('gdi32.dll','SaveDC',1,([h])=>{if(failed('save'))return 0;const d=dcs.get(h),{saves,...state}=d;saves.push(structuredClone(state));return saves.length;});
  vm.hook('gdi32.dll','RestoreDC',2,([h,id])=>{const d=dcs.get(h);assert.ok(id>0&&id<=d.saves.length);const state=d.saves[id-1];d.saves.length=id-1;Object.assign(d,state);return 1;});
  vm.hook('gdi32.dll','SetGraphicsMode',2,([h,n])=>1);
  vm.hook('gdi32.dll','ModifyWorldTransform',3,([h,p,kind])=>{assert.deepEqual([p,kind],[0,1]);dcs.get(h).world=0;return 1;});
  vm.hook('gdi32.dll','SetMapMode',2,([h,n])=>{const old=dcs.get(h).map;dcs.get(h).map=n;return old;});
  vm.hook('gdi32.dll','SetWindowOrgEx',4,([h,x,y,p])=>{assert.equal(p,0);dcs.get(h).origin=[x,y];return 1;});
  vm.hook('gdi32.dll','SetViewportOrgEx',4,([h,x,y,p])=>{assert.equal(p,0);dcs.get(h).viewport=[x,y];return 1;});
  vm.hook('gdi32.dll','SelectClipRgn',2,([h,r])=>{dcs.get(h).clip=r;return 1;});
  vm.hook('gdi32.dll','BitBlt',9,([dst,x,y,w,h,src,sx,sy,rop])=>{
    assert.deepEqual([x,y,sx,sy,rop],[0,0,0,0,0xcc0020]);const a=dcs.get(src),b=dcs.get(dst);
    assert.equal(a.map,1);assert.equal(a.clip,0);assert.deepEqual(a.viewport,[0,0]);assert.deepEqual(a.origin,[0,0]);assert.equal(a.world,0);
    if(failed('blit'))return 0;const from=objects.get(a.bitmap),to=objects.get(b.bitmap);
    for(let row=0;row<h;row++)for(let col=0;col<w;col++)to.pixels[row*to.width+col]=from.pixels[row*from.width+col];return 1;
  });
  return env;
}
for(const optimization of [0,1,2])test(`native surface allocation/growth uses one stable HDC, preserves pixels and restores mapping O${optimization}`,t=>{
  const {vm,state,result,error}=machine(t,optimization),env=gdi(vm);vm.invoke('proc:M:Main');assert.equal(error(),0);
  const h=result(),bitmap=vm.memory.read(state+8);assert.equal(env.pixel(h,0,0),0xabcdef);env.setPixel(h,2,3,0x123456);
  Object.assign(env.dcs.get(h),{clip:19,map:8,origin:[10,20],viewport:[30,40],world:2});
  env.width=8;env.height=6;vm.invoke('proc:M:Main');assert.equal(error(),0);assert.equal(result(),h);
  assert.ok(!env.objects.has(bitmap));assert.equal(env.dcs.size,1);assert.equal(env.objects.size,1);
  assert.equal(env.pixel(h,2,3),0x123456);assert.equal(env.pixel(h,7,5),0xabcdef);
  const current=env.dcs.get(h);assert.equal(current.clip,19);assert.equal(current.map,8);assert.deepEqual(current.viewport,[30,40]);assert.deepEqual(current.origin,[10,20]);assert.equal(current.world,2);assert.deepEqual(current.saves,[]);
  const events=env.events.length;env.width=2;env.height=2;vm.invoke('proc:M:Main');assert.equal(result(),h);assert.equal(env.events.length,events,'shrink must reuse backing');
  vm.invoke('proc:M:Dispose');assert.equal(env.dcs.size,0);assert.equal(env.objects.size,0);assert.equal(vm.memory.read(state+4),0);
  vm.invoke('proc:M:Dispose');assert.equal(env.dcs.size,0,'disposal is idempotent');
});
for(const fail of ['dc','bitmap','select','brush','save','fill'])test('initial surface failure rolls back unpublished GDI ownership: '+fail,t=>{
  const {vm,state,result,error}=machine(t),env=gdi(vm);env.fail=fail;vm.invoke('proc:M:Main');
  assert.equal(error(),fail==='fill'?5:7);assert.equal(result(),0);assert.equal(vm.memory.read(state+4),0);assert.equal(env.objects.size,0);assert.equal(env.dcs.size,0);
});
for(const fail of ['bitmap','brush','fill','blit'])test('resize failure preserves the published surface and discards only new resources: '+fail,t=>{
  const {vm,state,result,error}=machine(t),env=gdi(vm);vm.invoke('proc:M:Main');const h=result(),bitmap=vm.memory.read(state+8);env.setPixel(h,1,1,0x13579b);
  Object.assign(env.dcs.get(h),{clip:91,map:8,viewport:[9,12]});env.width=8;env.height=8;env.fail=fail;vm.invoke('proc:M:Main');
  assert.equal(error(),['fill','blit'].includes(fail)?5:7);assert.equal(vm.memory.read(state+4),h);assert.equal(vm.memory.read(state+8),bitmap);assert.equal(vm.memory.read(state+16),4);
  assert.equal(env.pixel(h,1,1),0x13579b);assert.equal(env.dcs.size,1);assert.equal(env.objects.size,1);assert.equal(env.dcs.get(h).clip,91);assert.equal(env.dcs.get(h).map,8);assert.deepEqual(env.dcs.get(h).viewport,[9,12]);assert.deepEqual(env.dcs.get(h).saves,[]);
});
