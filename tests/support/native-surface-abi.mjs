/** Checked IA-32 execution of the authored native surface procedures. GDI calls
 * below are explicit test doubles, not a Windows runtime or pixel certification.
 * They enforce selected-bitmap exclusivity, ownership and saved-state balance.
 */
import assert from 'node:assert/strict';
import {compileWin32} from '../../src/native/compiler.js';
import {PE32Image} from '../../src/native/pe32.js';
import {NativeX86Machine} from './native-x86-machine.mjs';
import {newProject} from '../../src/project/model.js';
import {SURFACE_KERNEL} from '../../src/native/surface-kernel.js';
const wrappers=String.raw`
Private value As Surface
Private answer As Long, failure As Long
Private Sub Main()
End Sub
Private Sub TryDC()
 On Error Resume Next
 answer=SurfaceDC(value)
 failure=Err.Number
End Sub
Private Sub TryPaint()
 On Error Resume Next
 SurfacePaint value,900
 failure=Err.Number
End Sub
Private Sub TryDestroy()
 On Error Resume Next
 SurfaceDestroy value
 failure=Err.Number
End Sub
`;
export function surfaceMachine(t,optimization=1,{extraSource='',extraWrappers='',Machine=NativeX86Machine}={}){
 let linked;const finish=PE32Image.prototype.finish;
 const mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});
 const result=compileWin32({...newProject('SurfaceABI'),startup:'Sub Main',modules:[{id:'S',name:'S',kind:'module',code:SURFACE_KERNEL+extraSource+wrappers+extraWrappers}]},{optimization});mock.mock.restore();
 const vm=new Machine(linked),memory=vm.memory,objects=new Map(),faults=new Map(),attempts=new Map();
 const surface=vm.symbol('global:S:value'),layout=result.report.records.find(r=>r.name==='s.surface'),fields=new Map(layout.fields.map(f=>[f.name,f.offset]));
 vm.hooks.delete(vm.symbol('native:error:raise'));
 let next=1000,w=8,h=6,valid=true;
 const owned=(kind,data={})=>{const id=next++;objects.set(id,{kind,...data});return id;};
 const get=(id,kind)=>{const v=objects.get(id);assert.equal(v?.kind,kind,'expected live '+kind+' '+id);return v;};
 const bitmap=(width,height,stock=false)=>owned('bitmap',{width,height,pixels:new Uint32Array(width*height),stock});
 const dc=(kind='memory')=>{
  const original=bitmap(1,1,true);return owned('dc',{bitmap:original,original,brush:0,saved:[],mode:1,transform:0,clip:0,origin:[0,0,0,0],kindOfDC:kind});
 };
 const outputBitmap=bitmap(64,64),output=dc('display');objects.set(900,objects.get(output));objects.delete(output);objects.get(900).bitmap=outputBitmap;
 const hook=(name,n,fn,dll='gdi32.dll')=>vm.hook(dll,name,n,(args)=>{
   const count=(attempts.get(name)||0)+1;attempts.set(name,count);
   if(faults.get(name)===count){faults.delete(name);return 0;}
   return fn(...args);
 });
 hook('GetLastError',0,()=>0,'kernel32.dll');
 hook('IsWindow',1,hwnd=>hwnd===42&&valid?1:0,'user32.dll');
 hook('GetClientRect',2,(hwnd,out)=>{assert.equal(hwnd,42);[0,0,w,h].forEach((v,i)=>memory.write(out+4*i,v));return 1;},'user32.dll');
 hook('GetSysColor',1,index=>{assert.equal(index,15);return 0x123456;},'user32.dll');
 hook('CreateCompatibleDC',1,reference=>{assert.equal(reference,0);return dc();});
 hook('GetDC',1,hwnd=>{assert.equal(hwnd,42);return dc('display');},'user32.dll');
 hook('ReleaseDC',2,(hwnd,hdc)=>{assert.equal(hwnd,42);assert.equal(get(hdc,'dc').kindOfDC,'display');objects.delete(hdc);return 1;},'user32.dll');
 hook('CreateDIBSection',6,(hdc,info,use,out,section,offset)=>{
  get(hdc,'dc');assert.equal(memory.read(info),40);const width=memory.read(info+4),height=-(memory.read(info+8)|0);
  assert.equal(memory.read(info+12,16),1);assert.equal(memory.read(info+14,16),32);assert.equal(memory.read(info+16),0);assert.deepEqual([use,section,offset],[0,0,0]);
  memory.write(out,0x60606060);return bitmap(width,height);
 });
 hook('CreateSolidBrush',1,color=>owned('brush',{color}));
 hook('SelectObject',2,(hdc,id)=>{
  const d=get(hdc,'dc'),obj=objects.get(id);assert.ok(obj,'select a live object');
  if(obj.kind==='bitmap'){
   assert.ok(![...objects].some(([other,v])=>other!==hdc&&v.kind==='dc'&&v.bitmap===id),'a bitmap cannot be selected into two DCs');
   const old=d.bitmap;d.bitmap=id;return old;
  }
  assert.equal(obj.kind,'brush');const old=d.brush;d.brush=id;return old;
 });
 hook('DeleteObject',1,id=>{
  const obj=objects.get(id);assert.ok(obj,'object is freed exactly once');assert.ok(!obj.stock,'never delete the stock bitmap');
  assert.ok(![...objects.values()].some(v=>v.kind==='dc'&&(v.bitmap===id||v.brush===id)),'restore objects before deletion');
  objects.delete(id);return 1;
 });
 hook('DeleteDC',1,id=>{const obj=get(id,'dc');assert.equal(obj.kindOfDC,'memory');assert.equal(obj.saved.length,0,'no unmatched private SaveDC');objects.delete(id);return 1;});
 hook('SaveDC',1,hdc=>{const d=get(hdc,'dc');d.saved.push({bitmap:d.bitmap,brush:d.brush,mode:d.mode,transform:d.transform,clip:d.clip,origin:[...d.origin]});return d.saved.length;});
 hook('RestoreDC',2,(hdc,depth)=>{const d=get(hdc,'dc');depth|=0;const index=depth<0?d.saved.length+depth:depth-1;assert.ok(index>=0&&index<d.saved.length);Object.assign(d,d.saved[index]);d.saved.length=index;return 1;});
 hook('SetGraphicsMode',2,(hdc,mode)=>{get(hdc,'dc').mode=mode;return 1;});
 hook('ModifyWorldTransform',3,(hdc,matrix,mode)=>{assert.deepEqual([matrix,mode],[0,1]);get(hdc,'dc').transform=0;return 1;});
 hook('SetMapMode',2,(hdc,mode)=>{const d=get(hdc,'dc'),old=d.mode;d.mode=mode;return old;});
 hook('SetWindowOrgEx',4,(hdc,x,y,old)=>{assert.equal(old,0);get(hdc,'dc').origin.splice(0,2,x,y);return 1;});
 hook('SetViewportOrgEx',4,(hdc,x,y,old)=>{assert.equal(old,0);get(hdc,'dc').origin.splice(2,2,x,y);return 1;});
 hook('SelectClipRgn',2,(hdc,clip)=>{get(hdc,'dc').clip=clip;return 1;});
 hook('FillRect',3,(hdc,bounds,brush)=>{
  const d=get(hdc,'dc'),b=get(d.bitmap,'bitmap'),color=get(brush,'brush').color;
  assert.equal(d.transform,0);assert.equal(d.clip,0);assert.deepEqual(d.origin,[0,0,0,0]);
  const rect=Array.from({length:4},(_,i)=>memory.read(bounds+4*i));
  for(let y=rect[1];y<Math.min(rect[3],b.height);y++)for(let x=rect[0];x<Math.min(rect[2],b.width);x++)b.pixels[y*b.width+x]=color;
  return 1;
 },'user32.dll');
 hook('BitBlt',9,(target,tx,ty,width,height,source,sx,sy,rop)=>{
  assert.equal(rop,0xcc0020);const src=get(source,'dc'),dst=get(target,'dc');
  assert.equal(src.transform,0);assert.deepEqual(src.origin,[0,0,0,0]);
  const a=get(src.bitmap,'bitmap'),b=get(dst.bitmap,'bitmap');
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(ty+y<b.height&&tx+x<b.width&&sy+y<a.height&&sx+x<a.width)b.pixels[(ty+y)*b.width+tx+x]=a.pixels[(sy+y)*a.width+sx+x];
  return 1;
 });
 hook('InvalidateRect',3,()=>1,'user32.dll');
 const set=(name,value)=>memory.write(surface+fields.get(name),value),read=name=>memory.read(surface+fields.get(name));
 set('hwnd',42);set('redraw',-1);set('back',0xabcdef);set('scale',3);set('epoch',1);
 const count=()=>[...objects.values()].filter(v=>v.kind==='brush'||v.kind==='bitmap'&&!v.stock||v.kind==='dc').length;
 const call=name=>{vm.invoke('proc:S:'+name);return memory.read(vm.symbol('global:S:failure'));};
 return {vm,objects,set,read,call,count,hook,owned,get,linked,fields,surface,resize:(width,height)=>{w=width;h=height;},invalidate:()=>{valid=false;},
  fail:(name,after=1)=>faults.set(name,(attempts.get(name)||0)+after),
  dc:()=>get(read('dc'),'dc'),pixels:()=>get(read('bitmap'),'bitmap'),output:()=>get(outputBitmap,'bitmap')};
}
