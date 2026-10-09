/** Explicit mock rasterizer/metrics used only to verify emitted call arguments,
 * scoped GDI ownership and control flow. Real raster/typography validation lives
 * in the Windows fixture; these hooks are not substituted for that evidence. */
import assert from 'node:assert/strict';
import {surfaceMachine} from './native-surface-abi.mjs';
import {NativeX86FloatingMachine} from './native-x86-floating.mjs';
import {SURFACE_DRAWING_KERNEL} from '../../src/native/surface-drawing-kernel.js';
const extraWrappers=String.raw`
Private drawKind As Long,drawColor As Long,drawEpoch As Long
Private ax As Double,ay As Double,bx As Double,by As Double
Private printed As String
Private Sub TryDraw()
 On Error Resume Next
 SurfaceDraw value,drawEpoch,drawKind,ax,ay,bx,by,drawColor
 failure=Err.Number
End Sub
Private Sub TryText()
 On Error Resume Next
 SurfaceText value,drawEpoch,printed
 failure=Err.Number
End Sub
`;
export function drawingMachine(t,optimization){
 const m=surfaceMachine(t,optimization,{extraSource:SURFACE_DRAWING_KERNEL,extraWrappers,Machine:NativeX86FloatingMachine});
 const {vm,objects,hook,owned,get}=m,draws=[],texts=[];
 const stockPen=owned('pen',{stock:true,color:0,width:1,style:0}),stockBrush=owned('brush',{stock:true,color:0xffffff}),stockHollow=owned('brush',{stock:true,hollow:true}),stockFont=owned('font',{stock:true});
 assert.equal(m.call('TryDC'),0);
 Object.assign(m.dc(),{pen:stockPen,brush:stockBrush,font:stockFont,rop:13,bk:2,textColor:0,alignment:0});
 m.set('penWidth',1);m.set('penStyle',0);m.set('drawMode',13);m.set('fillStyle',1);m.set('fore',0x1234);
 // Replace just the selection/save hooks with real GDI object-category rules.
 hook('SelectObject',2,(hdc,id)=>{const d=get(hdc,'dc'),obj=objects.get(id);assert.ok(obj,'select a live GDI object');const field=obj.kind;assert.ok(['bitmap','pen','brush','font'].includes(field));const old=d[field];assert.ok(old);d[field]=id;return old;});
 hook('SaveDC',1,hdc=>{const d=get(hdc,'dc');const state={...d,origin:[...d.origin]};delete state.saved;d.saved.push(state);return d.saved.length;});
 hook('DeleteObject',1,id=>{const obj=objects.get(id);assert.ok(obj&&!obj.stock,'delete only live owned drawing objects');assert.ok(![...objects.values()].some(v=>v.kind==='dc'&&v[obj.kind]===id),'restore selected object before deleting');objects.delete(id);return 1;});
 hook('CreatePen',3,(style,width,color)=>owned('pen',{style,width,color}));
 hook('CreateHatchBrush',2,(style,color)=>owned('brush',{style,color}));
 hook('GetStockObject',1,index=>{assert.ok([5,17].includes(index));return index===5?stockHollow:stockFont;});
 hook('SetROP2',2,(hdc,value)=>{const d=get(hdc,'dc'),old=d.rop;d.rop=value;return old;});
 hook('SetBkMode',2,(hdc,value)=>{const d=get(hdc,'dc'),old=d.bk;d.bk=value;return old;});
 hook('MoveToEx',4,(hdc,x,y,previous)=>{assert.equal(previous,0);get(hdc,'dc').position=[x|0,y|0];return 1;});
 for(const name of ['Rectangle','Ellipse'])hook(name,5,(hdc,...coords)=>{const d=get(hdc,'dc');draws.push({name,coords:coords.map(n=>n|0),pen:{...get(d.pen,'pen')},brush:{...get(d.brush,'brush')},rop:d.rop});return 1;});
 hook('LineTo',3,(hdc,x,y)=>{const d=get(hdc,'dc');draws.push({name:'LineTo',coords:[...d.position,x|0,y|0],pen:{...get(d.pen,'pen')},rop:d.rop});return 1;});
 hook('GetPixel',3,(hdc,x,y)=>{const b=get(get(hdc,'dc').bitmap,'bitmap');return (x|0)<0||(y|0)<0||x>=b.width||y>=b.height?0xffffffff:b.pixels[y*b.width+x];});
 hook('SetPixelV',4,(hdc,x,y,color)=>{const b=get(get(hdc,'dc').bitmap,'bitmap');b.pixels[y*b.width+x]=color;draws.push({name:'SetPixelV',coords:[x,y],color});return 1;});
 hook('SendMessageW',4,(hwnd,msg,wp,lp)=>{assert.deepEqual([hwnd,msg,wp,lp],[42,0x31,0,0]);return stockFont;},'user32.dll');
 hook('SetTextColor',2,(hdc,value)=>{const d=get(hdc,'dc'),old=d.textColor;d.textColor=value;return old;});
 hook('SetTextAlign',2,(hdc,value)=>{const d=get(hdc,'dc'),old=d.alignment;d.alignment=value;return old;});
 hook('GetTextMetricsW',2,(hdc,out)=>{get(hdc,'dc');for(let i=0;i<60;i++)vm.memory.write(out+i,0,8);vm.memory.write(out,12);vm.memory.write(out+16,2);vm.memory.write(out+20,7);return 1;});
 const textAt=(p,n)=>Array.from({length:n},(_,i)=>String.fromCharCode(vm.memory.read(p+i*2,16))).join('');
 hook('GetTextExtentPoint32W',4,(hdc,p,n,out)=>{get(hdc,'dc');assert.equal(textAt(p,n).length,n);vm.memory.write(out,n*7);vm.memory.write(out+4,12);return 1;});
 hook('TextOutW',5,(hdc,x,y,p,n)=>{const d=get(hdc,'dc');texts.push({text:textAt(p,n),x:x|0,y:y|0,color:d.textColor,bk:d.bk,align:d.alignment,font:d.font});return 1;});
 // Text procedure tests isolate its compiled control flow; the actual emitted
 // UTF-16 scanner has a separate independent instruction-execution test.
 vm.hooks.set(vm.symbol('proc:S:SurfaceLineLength'),{args:2,name:'bounded-text-scan-test-hook',callback:([p,n])=>{const s=textAt(p,n),at=s.search(/[\r\n]/);return at<0?n:at;}});
 const global=name=>vm.symbol('global:S:'+name);
 vm.memory.write(global('drawEpoch'),1);
 const draw=(kind,coords,color=0x123456)=>{vm.memory.write(global('drawKind'),kind);vm.memory.write(global('drawColor'),color);for(const [i,name]of ['ax','ay','bx','by'].entries())vm.writeFP(global(name),coords[i]??0);return m.call('TryDraw');};
 const text=value=>{const old=vm.memory.read(global('printed'));if(old)vm.memory.free(old-4);vm.memory.write(global('printed'),vm.memory.string(value));return m.call('TryText');};
 return {...m,draw,text,draws,texts,setFloat:(name,n)=>vm.writeFP(m.surface+m.fields.get(name),n),readFloat:name=>vm.readFP(m.surface+m.fields.get(name)),stockPen,stockBrush,stockFont,
  count:()=>[...objects.values()].filter(v=>!v.stock&&(v.kind==='pen'||v.kind==='brush'||v.kind==='bitmap'||v.kind==='dc')).length,
  epoch:value=>vm.memory.write(global('drawEpoch'),value)};
}
