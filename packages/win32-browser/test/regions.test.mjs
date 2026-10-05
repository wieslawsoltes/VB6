import test from 'node:test';
import assert from 'node:assert/strict';
import {createWin32,WIN32_CONSTANTS as C} from '../src/index.js';
import {RegionStore} from '../src/gdi-region.js';
const api=(w,n,...a)=>w.invoke('gdi32',n,a);
function context(t,options){const w=createWin32(options);t.after(()=>w.dispose());return w;}
const make=(w,...r)=>api(w,'CreateRectRgn',...r);
const putRect=(w,r)=>{const p=w.memory.alloc(16);r.forEach((n,i)=>w.memory.writeI32(p+i*4,n));return p;};
const bounds=(w,h)=>{const p=w.memory.alloc(16);try{const type=api(w,'GetRgnBox',h,p);return {type,rect:Array.from({length:4},(_,i)=>w.memory.readI32(p+i*4))};}finally{w.memory.free(p);}};
function surface(w,width=8,height=8){const p=w.memory.alloc(40),out=w.memory.alloc(4),v=w.memory.view(p,40);v.setUint32(0,40,true);v.setInt32(4,width,true);v.setInt32(8,-height,true);v.setUint16(12,1,true);v.setUint16(14,32,true);const bitmap=api(w,'CreateDIBSection',0,p,0,out,0,0),bits=w.memory.readU32(out),dc=api(w,'CreateCompatibleDC',0),old=api(w,'SelectObject',dc,bitmap);w.memory.free(p);w.memory.free(out);assert.ok(bitmap&&dc&&old);return {dc,bitmap,bits,width,height};}
const hole=w=>{const a=make(w,0,0,8,8),b=make(w,2,2,6,6);assert.equal(api(w,'CombineRgn',a,a,b,C.RGN_DIFF),3);api(w,'DeleteObject',b);return a;};
const pixel=(w,s,x,y)=>{const p=s.bits+(y*s.width+x)*4;return w.memory.bytes(p,3).reduce((n,v,i)=>n|(v<<((2-i)*8)),0);};
function failure(w,name,args,code=87,result=0){assert.equal(api(w,name,...args),result,name);assert.equal(w.lastError,code,name);}

test('rectangular regions normalize reversed edges, exclude lower/right edges, and report type',t=>{
  const w=context(t),r=make(w,5,7,-1,-2);assert.deepEqual(bounds(w,r),{type:2,rect:[-1,-2,5,7]});assert.equal(api(w,'GetObjectType',r),C.OBJ_REGION);
  assert.equal(api(w,'PtInRegion',r,-1,-2),1);assert.equal(api(w,'PtInRegion',r,5,2),0);assert.equal(api(w,'PtInRegion',r,2,7),0);
  assert.equal(api(w,'SetRectRgn',r,1,1,1,2),1);assert.deepEqual(bounds(w,r),{type:1,rect:[0,0,0,0]});
});
test('CreateRectRgnIndirect reads RECT data without retaining its storage',t=>{const w=context(t),p=putRect(w,[1,2,3,4]),r=api(w,'CreateRectRgnIndirect',p);w.memory.free(p);assert.deepEqual(bounds(w,r).rect,[1,2,3,4]);});
for(const mode of [1,2,3,4,5])test(`CombineRgn mode ${mode} supports aliased destinations and correct membership`,t=>{
  const w=context(t),a=make(w,0,0,4,4),b=make(w,2,2,6,6),dest=make(w,0,0,0,0);
  const type=api(w,'CombineRgn',dest,a,mode===5?0:b,mode);assert.ok(type);assert.equal(api(w,'CombineRgn',a,a,mode===5?0:b,mode),type);assert.equal(api(w,'EqualRgn',dest,a),1);
  for(let y=-1;y<8;y++)for(let x=-1;x<8;x++){const aa=x>=0&&x<4&&y>=0&&y<4,bb=x>=2&&x<6&&y>=2&&y<6,expected=mode===1?aa&&bb:mode===2?aa||bb:mode===3?aa!==bb:mode===4?aa&&!bb:aa;assert.equal(api(w,'PtInRegion',dest,x,y),+expected);}
});
test('canonical y-bands merge adjacent rectangles and compare independently constructed shapes',t=>{const w=context(t),a=make(w,0,0,3,2),b=make(w,3,0,6,2),c=make(w,0,2,6,4);assert.equal(api(w,'CombineRgn',a,a,b,2),2);assert.equal(api(w,'CombineRgn',a,a,c,2),2);assert.equal(api(w,'EqualRgn',a,make(w,0,0,6,4)),1);});
test('RectInRegion detects holes, partial overlap and half-open boundaries',t=>{const w=context(t),r=hole(w);for(const [box,yes]of [[[2,2,6,6],0],[[1,1,3,3],1],[[8,0,9,8],0],[[0,0,0,1],0]]){const p=putRect(w,box);assert.equal(api(w,'RectInRegion',r,p),yes);w.memory.free(p);}});
test('OffsetRgn preserves geometry and handles negative offsets',t=>{const w=context(t),r=hole(w);assert.equal(api(w,'OffsetRgn',r,-10,20),3);assert.deepEqual(bounds(w,r).rect,[-10,20,-2,28]);assert.equal(api(w,'PtInRegion',r,-7,23),0);assert.equal(api(w,'PtInRegion',r,-10,20),1);});
test('coordinate overflow, invalid handles, modes and buffers fail without mutation',t=>{
 const w=context(t),r=make(w,0,0,8,8),before=bounds(w,r);failure(w,'OffsetRgn',[r,0x3ffffff,0]);assert.deepEqual(bounds(w,r),before);failure(w,'CreateRectRgn',[-0x4000001,0,1,1]);failure(w,'SetRectRgn',[r,0,0,1,0x4000000]);assert.deepEqual(bounds(w,r),before);failure(w,'CombineRgn',[r,r,r,6]);assert.deepEqual(bounds(w,r),before);failure(w,'GetRgnBox',[r,0]);failure(w,'DeleteObject',[999],6);assert.equal(api(w,'DeleteObject',r),1);failure(w,'PtInRegion',[r,0,0],6);
});
test('GetRegionData writes canonical RGNDATA header and rectangles; size query is allocation-free',t=>{
 const w=context(t),r=hole(w),size=api(w,'GetRegionData',r,0,0);assert.equal(size,96);const p=w.memory.alloc(size+4);w.memory.bytes(p,size+4).fill(0xa5);assert.equal(api(w,'GetRegionData',r,size,p),size);
 assert.deepEqual(Array.from({length:8},(_,i)=>w.memory.readI32(p+i*4)),[32,1,4,64,0,0,8,8]);assert.deepEqual(Array.from({length:16},(_,i)=>w.memory.readI32(p+32+i*4)),[0,0,8,2,0,2,2,6,6,2,8,6,0,6,8,8]);assert.equal(w.memory.readU32(p+size),0xa5a5a5a5);
 const copy=api(w,'ExtCreateRegion',0,size,p);assert.ok(copy);assert.equal(api(w,'EqualRgn',r,copy),1);
});
test('empty region RGNDATA is a 32-byte roundtrip',t=>{const w=context(t),r=make(w,0,0,0,0),p=w.memory.alloc(32);assert.equal(api(w,'GetRegionData',r,32,p),32);assert.equal(api(w,'EqualRgn',r,api(w,'ExtCreateRegion',0,32,p)),1);});
test('GetRegionData small or invalid destination is not partially written',t=>{const w=context(t),r=hole(w),p=w.memory.alloc(64);w.memory.bytes(p,64).fill(99);failure(w,'GetRegionData',[r,64,p],87);assert.ok(w.memory.bytes(p,64).every(n=>n===99));failure(w,'GetRegionData',[r,96,p]);assert.ok(w.memory.bytes(p,64).every(n=>n===99));});
test('ExtCreateRegion validates bounds, counts, order, header, XFORM and buffer before allocating',t=>{
 const w=context(t),r=hole(w),p=w.memory.alloc(96),x=w.memory.alloc(24);api(w,'GetRegionData',r,96,p);const initial=w.handles.entries.size,v=w.memory.view(x,24);v.setFloat32(0,1,true);v.setFloat32(12,1,true);v.setFloat32(16,4,true);v.setFloat32(20,-3,true);const translated=api(w,'ExtCreateRegion',x,96,p);assert.deepEqual(bounds(w,translated).rect,[4,-3,12,5]);api(w,'DeleteObject',translated);
 for(const [offset,value]of [[0,31],[4,2],[8,5000],[12,1],[16,1],[32,8]]){const old=w.memory.readU32(p+offset);w.memory.writeU32(p+offset,value);failure(w,'ExtCreateRegion',[0,96,p]);w.memory.writeU32(p+offset,old);assert.equal(w.handles.entries.size,initial);}
 v.setFloat32(0,2,true);const scaled=api(w,'ExtCreateRegion',x,96,p);assert.deepEqual(bounds(w,scaled).rect,[4,-3,20,5]);api(w,'DeleteObject',scaled);v.setFloat32(0,1,true);v.setFloat32(16,.5,true);const fractional=api(w,'ExtCreateRegion',x,96,p);assert.ok(fractional);api(w,'DeleteObject',fractional);v.setFloat32(0,NaN,true);failure(w,'ExtCreateRegion',[x,96,p],87);assert.equal(w.handles.entries.size,initial);
});
test('region quota failures are atomic and do not change the destination',t=>{
 const w=context(t,{maxRegionRectangles:2}),a=make(w,0,0,1,1),b=make(w,2,0,3,1),c=make(w,4,0,5,1);assert.equal(api(w,'CombineRgn',a,a,b,2),3);const before=bounds(w,a);failure(w,'CombineRgn',[a,a,c,2],8);assert.deepEqual(bounds(w,a),before);assert.equal(api(w,'PtInRegion',a,4,0),0);
});
test('large coordinate regions combine without rasterizing their area',()=>{const r=new RegionStore(),a=r.rectangle(-60000000,-60000000,60000000,60000000),b=r.rectangle(-1,-1,1,1),c=r.combine(a,b,4);assert.equal(c.count,4);assert.equal(r.contains(c,0,0),false);assert.equal(r.contains(c,59999999,59999999),true);});
test('deterministic randomized band algebra agrees with an independent point-set oracle',()=>{
 const r=new RegionStore();let seed=0x642fe9;const next=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
 let shape=r.rectangle(0,0,0,0),points=new Set();
 for(let n=0;n<400;n++){const x=next()%15-7,y=next()%15-7,w=next()%6,h=next()%6,mode=1+next()%4,other=r.rectangle(x,y,x+w,y+h);shape=r.combine(shape,other,mode);const actual=new Set();for(let py=-10;py<=15;py++)for(let px=-10;px<=15;px++){const key=px+','+py,a=points.has(key),b=px>=x&&px<x+w&&py>=y&&py<y+h,yes=mode===1?a&&b:mode===2?a||b:mode===3?a!==b:a&&!b;assert.equal(r.contains(shape,px,py),yes,`operation ${n} mode ${mode} (${key})`);if(yes)actual.add(key);}points=actual;assert.ok(r.equal(shape,r.fromRectangles(r.rectangles(shape))));}
});
test('region snapshots are immutable and not shared mutable arrays',()=>{const r=new RegionStore(),s=r.rectangle(0,0,2,2);assert.throws(()=>s.bands[0].spans[0]=10,TypeError);assert.throws(()=>s.bounds[0]=10,TypeError);assert.throws(()=>s.bands.push({}),TypeError);});
test('SelectClipRgn copies geometry; deleting and mutating the source never affect clips',t=>{
 const w=context(t),s=surface(w),r=hole(w),copy=make(w,0,0,1,1);assert.equal(api(w,'GetClipRgn',s.dc,copy),0);assert.equal(api(w,'SelectClipRgn',s.dc,r),3);assert.equal(api(w,'GetClipRgn',s.dc,copy),1);assert.equal(api(w,'EqualRgn',r,copy),1);api(w,'SetRectRgn',r,0,0,1,1);api(w,'DeleteObject',r);assert.equal(api(w,'PtVisible',s.dc,7,7),1);assert.equal(api(w,'PtVisible',s.dc,3,3),0);api(w,'OffsetRgn',copy,10,10);assert.equal(api(w,'PtVisible',s.dc,7,7),1);assert.equal(api(w,'SelectClipRgn',s.dc,0),2);assert.equal(api(w,'PtVisible',s.dc,3,3),1);
});
test('SelectObject(region) returns region complexity rather than a previous handle',t=>{const w=context(t),s=surface(w),r=hole(w);assert.equal(api(w,'SelectObject',s.dc,r),3);assert.equal(api(w,'DeleteObject',r),1);assert.equal(api(w,'PtVisible',s.dc,3,3),0);});
test('SaveDC/RestoreDC snapshot application clips independently at multiple levels',t=>{const w=context(t),s=surface(w),r=hole(w);api(w,'SelectClipRgn',s.dc,r);assert.equal(api(w,'SaveDC',s.dc),1);api(w,'SelectClipRgn',s.dc,0);assert.equal(api(w,'SaveDC',s.dc),2);api(w,'IntersectClipRect',s.dc,0,0,1,1);api(w,'DeleteObject',r);assert.equal(api(w,'RestoreDC',s.dc,-1),1);assert.equal(api(w,'PtVisible',s.dc,3,3),1);assert.equal(api(w,'RestoreDC',s.dc,-1),1);assert.equal(api(w,'PtVisible',s.dc,3,3),0);});
test('region selection uses device coordinates; rectangle clipping and GetClipBox use logical coordinates',t=>{
 const w=context(t),s=surface(w),r=make(w,2,2,7,7),p=w.memory.alloc(16);api(w,'SetViewportOrgEx',s.dc,2,2,0);api(w,'SelectClipRgn',s.dc,r);assert.equal(api(w,'PtVisible',s.dc,0,0),1);assert.equal(api(w,'PtVisible',s.dc,5,0),0);assert.equal(api(w,'ExcludeClipRect',s.dc,1,1,3,3),3);assert.equal(api(w,'PtVisible',s.dc,1,1),0);assert.equal(api(w,'GetClipBox',s.dc,p),3);assert.deepEqual(Array.from({length:4},(_,i)=>w.memory.readI32(p+i*4)),[0,0,5,5]);
});
test('ExtSelectClipRgn modes, NULL validation and GetClipRgn failure result',t=>{const w=context(t),s=surface(w),a=make(w,0,0,4,4),b=make(w,2,2,6,6);api(w,'SelectClipRgn',s.dc,a);assert.equal(api(w,'ExtSelectClipRgn',s.dc,b,3),3);assert.equal(api(w,'PtVisible',s.dc,3,3),0);failure(w,'ExtSelectClipRgn',[s.dc,0,1]);assert.equal(api(w,'PtVisible',s.dc,3,3),0);failure(w,'GetClipRgn',[s.dc,0],6,-1);});
test('OffsetClipRgn and RectVisible handle holes and clipped device bounds',t=>{const w=context(t),s=surface(w),r=hole(w);api(w,'SelectClipRgn',s.dc,r);assert.equal(api(w,'RectVisible',s.dc,putRect(w,[2,2,6,6])),0);assert.equal(api(w,'RectVisible',s.dc,putRect(w,[1,1,3,3])),1);assert.equal(api(w,'OffsetClipRgn',s.dc,20,20),3);assert.equal(api(w,'PtVisible',s.dc,0,0),0);const p=w.memory.alloc(16);assert.equal(api(w,'GetClipBox',s.dc,p),1);assert.deepEqual([...w.memory.bytes(p,16)],Array(16).fill(0));});
for(const name of ['PatBlt','BitBlt','StretchBlt','TransparentBlt','AlphaBlend','Rectangle','Ellipse','LineTo','SetPixelV'])test(`${name} honors complex region holes without changing excluded DIB bytes`,t=>{
 const w=context(t),s=surface(w),src=surface(w),r=hole(w),brush=api(w,'CreateSolidBrush',0xffffff);w.memory.bytes(s.bits,256).fill(19);w.memory.bytes(src.bits,256).fill(200);api(w,'SelectObject',s.dc,brush);api(w,'SelectClipRgn',s.dc,r);api(w,'SelectObject',s.dc,api(w,'CreatePen',0,1,0xffffff));
 let result;if(name==='PatBlt')result=api(w,name,s.dc,0,0,8,8,C.PATCOPY);else if(name==='BitBlt')result=api(w,name,s.dc,0,0,8,8,src.dc,0,0,C.SRCCOPY);else if(name==='StretchBlt'){api(w,'SetStretchBltMode',s.dc,3);result=api(w,name,s.dc,0,0,8,8,src.dc,0,0,4,4,C.SRCCOPY);}else if(name==='TransparentBlt'||name==='AlphaBlend')result=w.invoke('msimg32',name,[s.dc,0,0,8,8,src.dc,0,0,8,8,name==='AlphaBlend'?0x00ff0000:0]);else if(name==='LineTo'){api(w,'MoveToEx',s.dc,0,0,0);result=api(w,name,s.dc,8,8);}else if(name==='SetPixelV')result=api(w,name,s.dc,0,0,0xffffff);else result=api(w,name,s.dc,0,0,8,8);
 assert.equal(result,1);for(let y=2;y<6;y++)for(let x=2;x<6;x++)assert.deepEqual([...w.memory.bytes(s.bits+(y*8+x)*4,4)],[19,19,19,19]);assert.ok(w.memory.bytes(s.bits,256).some(n=>n!==19));assert.equal(api(w,'GetPixel',s.dc,3,3),C.CLR_INVALID);
});
for(const name of ['FillRgn','PaintRgn','InvertRgn'])test(`${name} paints a logical region through the copied destination clip`,t=>{
 const w=context(t),s=surface(w),r=hole(w),clip=make(w,0,0,4,8),brush=api(w,'CreateSolidBrush',0x563412);api(w,'SelectObject',s.dc,brush);api(w,'SelectClipRgn',s.dc,clip);assert.equal(name==='FillRgn'?api(w,name,s.dc,r,brush):api(w,name,s.dc,r),1);assert.equal(pixel(w,s,0,0),name==='InvertRgn'?0xffffff:0x563412);assert.equal(pixel(w,s,3,3),0);assert.equal(pixel(w,s,7,0),0);
});
test('window raster adapter receives region-clipped pixels and deterministic disposal',t=>{
 const w=context(t),data=new Uint8ClampedArray(256);const window=w.registerWindow({getClientRect:()=>({width:8,height:8}),readPixels(x,y,width,height){const a=new Uint8ClampedArray(width*height*4);for(let row=0;row<height;row++)a.set(data.subarray(((y+row)*8+x)*4,((y+row)*8+x+width)*4),row*width*4);return {width,height,data:a};},writePixels(x,y,image){for(let row=0;row<image.height;row++)data.set(image.data.subarray(row*image.width*4,(row+1)*image.width*4),((y+row)*8+x)*4);}}),dc=w.invoke('user32','GetDC',[window]),r=hole(w);api(w,'SelectClipRgn',dc,r);api(w,'SelectObject',dc,api(w,'CreateSolidBrush',0xabcdef));assert.equal(api(w,'PatBlt',dc,0,0,8,8,C.PATCOPY),1);assert.deepEqual([...data.slice(0,4)],[239,205,171,255]);assert.deepEqual([...data.slice((3*8+3)*4,(3*8+3)*4+3)],[0,0,0]);w.dispose();assert.equal(w.handles.entries.size,0);assert.equal(w.memory.used,0);
});
