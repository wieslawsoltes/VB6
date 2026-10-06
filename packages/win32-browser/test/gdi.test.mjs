import test from 'node:test';
import assert from 'node:assert/strict';
import {createWin32, WIN32_CONSTANTS as C} from '../src/index.js';

const api=(w,name,...args)=>w.invoke('gdi32',name,args);
function process(t,options){const w=createWin32(options);t.after(()=>w.dispose());return w;}
function header(w,width,height,bpp=32){
  const p=w.memory.alloc(40),v=w.memory.view(p,40);
  v.setUint32(0,40,true);v.setInt32(4,width,true);v.setInt32(8,height,true);
  v.setUint16(12,1,true);v.setUint16(14,bpp,true);return p;
}
function bitmap(w,width=4,height=3,bpp=32,topDown=true){
  const info=header(w,width,topDown?-height:height,bpp),out=w.memory.alloc(4);
  try{const handle=api(w,'CreateDIBSection',0,info,0,out,0,0);assert.ok(handle,`DIB failed: ${w.lastError}`);return {handle,bits:w.memory.readU32(out),width,height,bpp};}
  finally{w.memory.free(info);w.memory.free(out);}
}
function surface(w,width=4,height=3,bpp=32,topDown=true){
  const b=bitmap(w,width,height,bpp,topDown),dc=api(w,'CreateCompatibleDC',0);
  assert.ok(dc);const old=api(w,'SelectObject',dc,b.handle);assert.ok(old);
  return {...b,dc,old};
}
const pixel=(w,s,x,y,color)=>color===undefined?api(w,'GetPixel',s.dc,x,y):api(w,'SetPixel',s.dc,x,y,color);
function close(w,s){assert.equal(api(w,'SelectObject',s.dc,s.old),s.handle);assert.equal(api(w,'DeleteObject',s.handle),1);assert.equal(api(w,'DeleteDC',s.dc),1);}
function fail(w,name,args,code=87,value=0){assert.equal(api(w,name,...args),value,name);assert.equal(w.lastError,code,name+' error');}
function windowSurface(w,width=4,height=3){
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=3;i<data.length;i+=4)data[i]=255;
  let reads=0,writes=0;
  const handle=w.registerWindow({getClientRect:()=>({width,height}),
    readPixels(x,y,sw,sh){reads++;const result=new Uint8ClampedArray(sw*sh*4);for(let yy=0;yy<sh;yy++)result.set(data.subarray(((y+yy)*width+x)*4,((y+yy)*width+x+sw)*4),yy*sw*4);return {width:sw,height:sh,data:result};},
    writePixels(x,y,image){writes++;for(let yy=0;yy<image.height;yy++)data.set(image.data.subarray(yy*image.width*4,(yy+1)*image.width*4),((y+yy)*width+x)*4);}
  });
  return {handle,dc:w.invoke('user32','GetDC',[handle]),data,get reads(){return reads;},get writes(){return writes;}};
}

test('memory DC begins with one-bit 1x1 bitmap and completely releases its private storage',t=>{
  const w=process(t),dc=api(w,'CreateCompatibleDC',0),object=api(w,'GetCurrentObject',dc,C.OBJ_BITMAP),p=w.memory.alloc(24);
  assert.equal(api(w,'GetObjectType',dc),C.OBJ_MEMDC);
  assert.equal(api(w,'GetObjectA',object,24,p),24);
  const v=w.memory.view(p,24);assert.equal(v.getInt32(4,true),1);assert.equal(v.getInt32(8,true),1);assert.equal(v.getUint16(18,true),1);assert.equal(v.getUint32(20,true),0);
  w.memory.free(p);assert.equal(api(w,'DeleteDC',dc),1);assert.equal(w.memory.used,0);assert.equal(w.handles.entries.size,6);
  fail(w,'DeleteDC',[dc],6);
});
for(const bpp of [24,32])for(const topDown of [true,false])test(`DIB ${bpp}-bit ${topDown?'top-down':'bottom-up'} storage is writable BGR with DWORD rows`,t=>{
  const w=process(t),s=surface(w,3,2,bpp,topDown),stride=Math.ceil(3*bpp/32)*4,bytes=w.memory.bytes(s.bits,stride*2);
  assert.equal(pixel(w,s,0,0,0x123456),0x123456);assert.equal(pixel(w,s,2,1,0xabcdef),0xabcdef);
  assert.deepEqual([...bytes.subarray(topDown?0:stride,(topDown?0:stride)+3)],[0x12,0x34,0x56]);
  const offset=(topDown?stride:0)+2*bpp/8;bytes.set([3,2,1],offset);
  assert.equal(pixel(w,s,2,1),0x030201);assert.equal(api(w,'GdiFlush'),1);
  close(w,s);assert.equal(w.memory.used,0);
});
test('DIBSECTION GetObject exposes virtual bits, signed orientation and 84-byte layout',t=>{
  const w=process(t),s=bitmap(w,3,2,24,true),p=w.memory.alloc(88),v=w.memory.view(p,88);
  w.memory.bytes(p,88).fill(0x7d);assert.equal(api(w,'GetObjectW',s.handle,0,0),24);
  assert.equal(api(w,'GetObjectW',s.handle,84,p),84);assert.equal(v.getInt32(12,true),12);
  assert.equal(v.getUint32(20,true),s.bits);assert.equal(v.getUint32(24,true),40);assert.equal(v.getInt32(32,true),-2);assert.equal(v.getUint32(80,true),0);assert.equal(v.getUint32(84,true),0x7d7d7d7d);
  assert.equal(api(w,'GetObjectW',s.handle,24,p),24);
  fail(w,'GetObjectA',[s.handle,23,p]);fail(w,'GetObjectA',[s.handle,24,p+1]);
});
test('compatible bitmap follows monochrome memory default and selected DIB format',t=>{
  const w=process(t),s=surface(w,4,3,24),dc=api(w,'CreateCompatibleDC',s.dc),p=w.memory.alloc(84);
  const mono=api(w,'CreateCompatibleBitmap',dc,2,2),dib=api(w,'CreateCompatibleBitmap',s.dc,2,2);
  assert.equal(api(w,'GetObjectA',mono,84,p),24);assert.equal(w.memory.view(p,24).getUint16(18,true),1);
  assert.equal(api(w,'GetObjectA',dib,84,p),84);assert.equal(w.memory.view(p,84).getUint16(18,true),24);
  assert.equal(api(w,'GetObjectType',dib),C.OBJ_BITMAP);
  const empty=api(w,'CreateCompatibleBitmap',s.dc,0,5);api(w,'GetObjectA',empty,24,p);assert.equal(w.memory.view(p,24).getInt32(4,true),1);
});
test('bitmap cannot be selected into two DCs or a registered window DC',t=>{
  const w=process(t),s=surface(w),other=api(w,'CreateCompatibleDC',0),win=windowSurface(w);
  fail(w,'SelectObject',[other,s.handle]);fail(w,'SelectObject',[win.dc,s.handle]);
  assert.equal(api(w,'DeleteObject',s.handle),0);assert.ok(w.handles.has(s.handle,'bitmap'));
  api(w,'SelectObject',s.dc,s.old);assert.ok(api(w,'SelectObject',other,s.handle));
});
test('saved DCs protect selected bitmaps and restore state without dangling handles',t=>{
  const w=process(t),s=surface(w),replacement=bitmap(w),other=api(w,'CreateCompatibleDC',0);
  assert.equal(api(w,'SaveDC',s.dc),1);api(w,'SelectObject',s.dc,replacement.handle);
  assert.equal(api(w,'DeleteObject',s.handle),0);fail(w,'SelectObject',[other,s.handle]);
  assert.equal(api(w,'RestoreDC',s.dc,-1),1);assert.equal(api(w,'GetCurrentObject',s.dc,C.OBJ_BITMAP),s.handle);
  assert.equal(api(w,'DeleteObject',replacement.handle),1);
  fail(w,'RestoreDC',[s.dc,-1]);
});
test('DeleteDC never deletes a user bitmap; window ReleaseDC ownership is enforced',t=>{
  const w=process(t),s=surface(w),win=windowSurface(w);
  assert.equal(w.invoke('user32','ReleaseDC',[win.handle,s.dc]),0);assert.equal(w.lastError,6);
  fail(w,'DeleteDC',[win.dc],6);assert.equal(api(w,'DeleteDC',s.dc),1);assert.ok(w.handles.has(s.handle,'bitmap'));
  assert.equal(api(w,'DeleteObject',s.handle),1);w.unregisterWindow(win.handle);assert.equal(w.handles.entries.size,6);assert.equal(w.memory.used,0);
});
test('kernel freeing a DIB pointer fails without corrupting the selected bitmap',t=>{
  const w=process(t),s=surface(w);for(const name of ['GlobalFree','LocalFree']){assert.equal(w.invoke('kernel32',name,[s.bits]),s.bits);assert.equal(w.lastError,5);}
  assert.equal(pixel(w,s,0,0,0xabc123),0xabc123);assert.equal(pixel(w,s,0,0),0xabc123);
});
test('invalid and unsupported DIB headers clear the output pointer and allocate nothing',t=>{
  const w=process(t),p=header(w,2,2),out=w.memory.alloc(4),v=w.memory.view(p,40),before=w.memory.used;
  for(const [offset,method,value,restore,code]of [[0,'Uint32',108,40,50],[4,'Int32',-2,2,87],[8,'Int32',0,2,87],[12,'Uint16',2,1,87],[14,'Uint16',8,32,50],[16,'Uint32',3,0,50],[32,'Uint32',1,0,50]]){
    v['set'+method](offset,value,true);w.memory.writeU32(out,123);
    fail(w,'CreateDIBSection',[0,p,0,out,0,0],code);assert.equal(w.memory.readU32(out),0);assert.equal(w.memory.used,before);v['set'+method](offset,restore,true);
  }
  fail(w,'CreateDIBSection',[0,p,1,out,0,0],50);fail(w,'CreateDIBSection',[0,p,0,out,123,0],50);
  assert.ok(api(w,'CreateDIBSection',0,p,0,out,0,123)); // offset ignored without a section
});
test('memory and handle allocation failures roll back DIB/DC resources',t=>{
  const w=process(t,{maxBytes:128}),p=header(w,32,32),out=w.memory.alloc(4),before=w.memory.used;
  fail(w,'CreateDIBSection',[0,p,0,out,0,0],8);assert.equal(w.memory.used,before);
  const limited=process(t,{maxHandles:7});fail(limited,'CreateCompatibleDC',[0],8);assert.equal(limited.memory.used,0);
  const b=bitmap(limited,1,1);const info=header(limited,1,1),ptr=limited.memory.alloc(4),n=limited.memory.used;
  fail(limited,'CreateDIBSection',[0,info,0,ptr,0,0],8);assert.equal(limited.memory.used,n);assert.ok(b.handle);
});
test('small configured memory processes remain constructible',t=>{const w=process(t,{maxBytes:1});fail(w,'CreateCompatibleDC',[0],8);});
test('all bitmap and saved-DC storage is cleared by process disposal',t=>{
  const w=process(t),s=surface(w);api(w,'SaveDC',s.dc);w.dispose();assert.equal(w.memory.used,0);assert.equal(w.handles.entries.size,0);assert.throws(()=>api(w,'GetPixel',s.dc,0,0),e=>e.code===995);
});
test('CreateBitmap and Get/SetBitmapBits use top-down WORD rows and bounded partial copies',t=>{
  const w=process(t),input=w.memory.alloc(16),out=w.memory.alloc(16);w.memory.bytes(input,16).set([1,2,3,4,5,6,77,88,9,10,11,12,13,14,99,100]);
  const b=api(w,'CreateBitmap',2,2,1,24,input);assert.ok(b);assert.equal(api(w,'GetBitmapBits',b,0,0),12); // 2*24 bits = 6 bytes per row
  assert.equal(api(w,'GetBitmapBits',b,12,out),12);assert.deepEqual([...w.memory.bytes(out,12)],[...w.memory.bytes(input,12)]);
  w.memory.bytes(input,16).fill(17);assert.equal(api(w,'SetBitmapBits',b,2,input),2);api(w,'GetBitmapBits',b,12,out);assert.deepEqual([...w.memory.bytes(out,4)],[17,17,3,4]);
  assert.equal(api(w,'SetBitmapBits',b,0,0),0);
});
test('24-bit DIB GetBitmapBits converts DWORD bottom-up rows to WORD top-down rows',t=>{
  const w=process(t),s=surface(w,1,2,24,false),out=w.memory.alloc(8);pixel(w,s,0,0,0x010203);pixel(w,s,0,1,0x040506);
  assert.equal(api(w,'GetBitmapBits',s.handle,8,out),8);assert.deepEqual([...w.memory.bytes(out,8)],[1,2,3,0,4,5,6,0]);
});
test('monochrome DDB expands using destination text/background colors',t=>{
  const w=process(t),s=surface(w,2,1),mdc=api(w,'CreateCompatibleDC',0),input=w.memory.alloc(2);w.memory.bytes(input,2).set([0x40,0]);const mono=api(w,'CreateBitmap',2,1,1,1,input);api(w,'SelectObject',mdc,mono);
  api(w,'SetTextColor',s.dc,0x112233);api(w,'SetBkColor',s.dc,0xaabbcc);assert.equal(api(w,'BitBlt',s.dc,0,0,2,1,mdc,0,0,C.SRCCOPY),1);
  assert.equal(pixel(w,s,0,0),0x112233);assert.equal(pixel(w,s,1,0),0xaabbcc);
});
test('bitmap dimensions are metadata and do not change pixel geometry',t=>{
  const w=process(t),s=bitmap(w),p=w.memory.alloc(8);api(w,'SetBitmapDimensionEx',s.handle,300,-200,p);assert.equal(w.memory.readI32(p),0);
  api(w,'GetBitmapDimensionEx',s.handle,p);assert.equal(w.memory.readI32(p),300);assert.equal(w.memory.readI32(p+4),-200);
});
for(const topDown of [true,false])test(`Get/SetDIBits transfer partial ${topDown?'top-down':'bottom-up'} scan lines and padding`,t=>{
  const w=process(t),s=surface(w,1,3),p=header(w,1,topDown?-3:3,24),buf=w.memory.alloc(12);
  pixel(w,s,0,0,0x010203);pixel(w,s,0,1,0x040506);pixel(w,s,0,2,0x070809);
  fail(w,'GetDIBits',[s.dc,s.handle,0,3,buf,p,0]);api(w,'SelectObject',s.dc,s.old);
  assert.equal(api(w,'GetDIBits',s.dc,s.handle,1,2,buf,p,0),2);
  assert.deepEqual([...w.memory.bytes(buf,8)],topDown?[4,5,6,0,7,8,9,0]:[4,5,6,0,1,2,3,0]);
  w.memory.bytes(buf,8).set([10,11,12,0,13,14,15,0]);assert.equal(api(w,'SetDIBits',s.dc,s.handle,1,2,buf,p,0),2);
  api(w,'SelectObject',s.dc,s.handle);assert.equal(pixel(w,s,0,1),0x0a0b0c);assert.equal(pixel(w,s,0,topDown?2:0),0x0d0e0f);
});
test('GetDIBits header query works without output pixels; selected and bad buffers fail',t=>{
  const w=process(t),s=surface(w,2,3),p=header(w,0,0,0),buf=w.memory.alloc(4);api(w,'SelectObject',s.dc,s.old);
  assert.equal(api(w,'GetDIBits',s.dc,s.handle,0,0,0,p,0),1);assert.equal(w.memory.readI32(p+4),2);assert.equal(w.memory.readI32(p+8),3);
  fail(w,'GetDIBits',[s.dc,s.handle,0,3,buf,p,0]);
  const before=[...w.memory.bytes(s.bits,24)];fail(w,'SetDIBits',[s.dc,s.handle,0,3,buf,p,0]);assert.deepEqual([...w.memory.bytes(s.bits,24)],before);
});
const formulas={SRCCOPY:(p,s,d)=>s,SRCPAINT:(p,s,d)=>s|d,SRCAND:(p,s,d)=>s&d,SRCINVERT:(p,s,d)=>s^d,SRCERASE:(p,s,d)=>s&~d,NOTSRCCOPY:(p,s,d)=>~s,NOTSRCERASE:(p,s,d)=>~(s|d),MERGECOPY:(p,s,d)=>p&s,MERGEPAINT:(p,s,d)=>~s|d,PATCOPY:(p,s,d)=>p,PATPAINT:(p,s,d)=>p|~s|d,PATINVERT:(p,s,d)=>p^d,DSTINVERT:(p,s,d)=>~d,BLACKNESS:()=>0,WHITENESS:()=>0xffffff};
for(const [name,formula]of Object.entries(formulas))test(`raster truth table ${name} matches independent Boolean formula`,t=>{
  const w=process(t),src=surface(w,1,1),dst=surface(w,1,1),p=0x3cb17e,s=0xa6c319,d=0x69e052;
  api(w,'SelectObject',dst.dc,api(w,'CreateSolidBrush',p));pixel(w,src,0,0,s);pixel(w,dst,0,0,d);
  assert.equal(api(w,'BitBlt',dst.dc,0,0,1,1,src.dc,0,0,C[name]),1);assert.equal(pixel(w,dst,0,0),formula(p,s,d)&0xffffff);
});
test('self-overlapping SRCCOPY snapshots source before writing',t=>{
  const w=process(t),s=surface(w,4,1);[1,2,3,4].forEach((c,x)=>pixel(w,s,x,0,c));api(w,'BitBlt',s.dc,1,0,3,1,s.dc,0,0,C.SRCCOPY);
  assert.deepEqual([0,1,2,3].map(x=>pixel(w,s,x,0)),[1,1,2,3]);
});
test('BitBlt clips destination but ignores source clip; origins apply to both DCs',t=>{
  const w=process(t),src=surface(w,4,2),dst=surface(w,4,2);for(let x=0;x<4;x++)pixel(w,src,x,0,x+1);
  api(w,'IntersectClipRect',src.dc,3,1,4,2);api(w,'IntersectClipRect',dst.dc,1,0,3,1);
  api(w,'SetViewportOrgEx',src.dc,1,0,0);api(w,'SetViewportOrgEx',dst.dc,1,0,0);
  assert.equal(api(w,'BitBlt',dst.dc,0,0,3,1,src.dc,0,0,C.SRCCOPY),1);
  api(w,'SetViewportOrgEx',dst.dc,0,0,0);assert.equal(pixel(w,dst,1,0),2);assert.equal(pixel(w,dst,2,0),3);assert.equal(pixel(w,dst,0,0),C.CLR_INVALID);
});
test('PatBlt uses selected brush without a source and rejects source-dependent ROP',t=>{
  const w=process(t),s=surface(w,2,2);api(w,'SelectObject',s.dc,api(w,'CreateSolidBrush',0x123456));assert.equal(api(w,'PatBlt',s.dc,0,0,2,2,C.PATCOPY),1);assert.equal(pixel(w,s,1,1),0x123456);
  fail(w,'PatBlt',[s.dc,0,0,2,2,C.SRCCOPY],50);api(w,'SelectObject',s.dc,api(w,'GetStockObject',5));assert.equal(api(w,'PatBlt',s.dc,0,0,2,2,C.PATCOPY),1);assert.equal(pixel(w,s,1,1),0x123456);
});
test('StretchBlt uses explicit nearest-neighbor mode and mirrors signed extents',t=>{
  const w=process(t),src=surface(w,2,1),dst=surface(w,4,1);pixel(w,src,0,0,1);pixel(w,src,1,0,2);
  fail(w,'StretchBlt',[dst.dc,0,0,4,1,src.dc,0,0,2,1,C.SRCCOPY],50);assert.equal(api(w,'SetStretchBltMode',dst.dc,3),1);
  assert.equal(api(w,'StretchBlt',dst.dc,0,0,4,1,src.dc,0,0,2,1,C.SRCCOPY),1);assert.deepEqual([0,1,2,3].map(x=>pixel(w,dst,x,0)),[1,1,2,2]);
  assert.equal(api(w,'StretchBlt',dst.dc,4,0,-4,1,src.dc,0,0,2,1,C.SRCCOPY),1);assert.deepEqual([0,1,2,3].map(x=>pixel(w,dst,x,0)),[2,2,1,1]);
});
test('invalid source bounds and unknown ROP leave destination unchanged',t=>{
  const w=process(t),src=surface(w),dst=surface(w);pixel(w,dst,0,0,0x1234);
  fail(w,'BitBlt',[dst.dc,0,0,2,2,src.dc,-1,0,C.SRCCOPY]);fail(w,'BitBlt',[dst.dc,0,0,2,2,src.dc,0,0,C.SRCCOPY|0x40000000],50);
  assert.equal(pixel(w,dst,0,0),0x1234);assert.equal(api(w,'BitBlt',dst.dc,0,0,0,0,src.dc,0,0,C.SRCCOPY),1);
});
test('raster pixel budget rejects work before destination mutation',t=>{
  const w=process(t,{maxRasterPixels:2}),s=surface(w,2,2);fail(w,'PatBlt',[s.dc,0,0,2,2,C.WHITENESS],8);assert.equal(pixel(w,s,0,0),0);
});
test('TransparentBlt color key preserves target pixels and copies other colors',t=>{
  const w=process(t),src=surface(w,2,1),dst=surface(w,2,1);pixel(w,src,0,0,0xff00ff);pixel(w,src,1,0,0x123456);pixel(w,dst,0,0,0x778899);
  assert.equal(w.invoke('msimg32','TransparentBlt',[dst.dc,0,0,2,1,src.dc,0,0,2,1,0xff00ff]),1);assert.equal(pixel(w,dst,0,0),0x778899);assert.equal(pixel(w,dst,1,0),0x123456);
  assert.equal(w.invoke('msimg32','TransparentBlt',[dst.dc,0,0,-2,1,src.dc,0,0,2,1,0]),0);assert.equal(w.lastError,87);
});
test('AlphaBlend honors packed constant alpha and premultiplied BGRA',t=>{
  const w=process(t),src=surface(w,1,1),dst=surface(w,1,1);w.memory.bytes(src.bits,4).set([0,0,128,128]);w.memory.bytes(dst.bits,4).set([200,0,0,255]);
  assert.equal(w.invoke('msimg32','AlphaBlend',[dst.dc,0,0,1,1,src.dc,0,0,1,1,0x01ff0000]),1);assert.deepEqual([...w.memory.bytes(dst.bits,4)],[100,0,128,255]);
  w.memory.bytes(dst.bits,4).set([200,0,0,255]);assert.equal(api(w,'GdiAlphaBlend',dst.dc,0,0,1,1,src.dc,0,0,1,1,0x01800000),1);assert.deepEqual([...w.memory.bytes(dst.bits,4)],[150,0,64,255]);
});
test('AlphaBlend rejects overlap, invalid blend flags and non-32-bit pixel alpha',t=>{
  const w=process(t),src=surface(w,2,1,24),dst=surface(w,2,1);
  for(const params of [[src.dc,0x01ff0000],[dst.dc,0x00ff0000],[src.dc,0x00ff0001],[src.dc,0x02ff0000]]){assert.equal(w.invoke('msimg32','AlphaBlend',[dst.dc,0,0,2,1,params[0],0,0,2,1,params[1]]),0);assert.equal(w.lastError,87);}
});
test('DC state saves colors, pen, brush, current point, viewport, clip and stretch mode',t=>{
  const w=process(t),s=surface(w,8,6),p=w.memory.alloc(16);api(w,'MoveToEx',s.dc,1,2,0);api(w,'SetTextColor',s.dc,0x123456);api(w,'SaveDC',s.dc);
  api(w,'SetViewportOrgEx',s.dc,2,3,p);assert.equal(w.memory.readI32(p),0);api(w,'IntersectClipRect',s.dc,0,0,2,2);api(w,'SetStretchBltMode',s.dc,3);api(w,'SetBkMode',s.dc,1);api(w,'SaveDC',s.dc);api(w,'OffsetViewportOrgEx',s.dc,1,1,0);
  assert.equal(api(w,'RestoreDC',s.dc,2),1);api(w,'GetViewportOrgEx',s.dc,p);assert.equal(w.memory.readI32(p),2);assert.equal(api(w,'GetClipBox',s.dc,p),2);assert.deepEqual([0,4,8,12].map(o=>w.memory.readI32(p+o)),[0,0,2,2]);
  assert.equal(api(w,'RestoreDC',s.dc,-1),1);assert.equal(api(w,'GetStretchBltMode',s.dc),1);assert.equal(api(w,'GetBkMode',s.dc),2);assert.equal(api(w,'GetTextColor',s.dc),0x123456);api(w,'GetCurrentPositionEx',s.dc,p);assert.deepEqual([w.memory.readI32(p),w.memory.readI32(p+4)],[1,2]);
});
test('selected pens/brushes stay alive in saved DC state',t=>{
  const w=process(t),s=surface(w),pen=api(w,'CreatePen',0,1,0xff),brush=api(w,'CreateSolidBrush',0xff00);api(w,'SelectObject',s.dc,pen);api(w,'SelectObject',s.dc,brush);api(w,'SaveDC',s.dc);
  api(w,'SelectObject',s.dc,api(w,'GetStockObject',7));api(w,'SelectObject',s.dc,api(w,'GetStockObject',0));assert.equal(api(w,'DeleteObject',pen),0);assert.equal(api(w,'DeleteObject',brush),0);api(w,'DeleteDC',s.dc);assert.equal(api(w,'DeleteObject',pen),1);assert.equal(api(w,'DeleteObject',brush),1);
});
test('GetObject returns LOGPEN and LOGBRUSH layouts',t=>{
  const w=process(t),p=w.memory.alloc(16),pen=api(w,'CreatePen',0,3,0x123456),brush=api(w,'CreateSolidBrush',0x778899);assert.equal(api(w,'GetObjectA',pen,16,p),16);assert.equal(w.memory.readI32(p+4),3);assert.equal(w.memory.readU32(p+12),0x123456);assert.equal(api(w,'GetObjectA',brush,16,p),12);assert.equal(w.memory.readU32(p+4),0x778899);
});
test('software primitives draw into DIBs with clipping and maintain current point',t=>{
  const w=process(t),s=surface(w,8,8),p=w.memory.alloc(8);api(w,'SelectObject',s.dc,api(w,'GetStockObject',8));api(w,'SelectObject',s.dc,api(w,'CreateSolidBrush',0x123456));assert.equal(api(w,'Rectangle',s.dc,1,1,6,6),1);assert.equal(pixel(w,s,2,2),0x123456);assert.equal(pixel(w,s,6,6),0);
  api(w,'SelectObject',s.dc,api(w,'CreatePen',0,1,0xff));api(w,'MoveToEx',s.dc,0,7,0);assert.equal(api(w,'LineTo',s.dc,7,7),1);assert.equal(pixel(w,s,3,7),0xff);assert.equal(pixel(w,s,7,7),0);api(w,'GetCurrentPositionEx',s.dc,p);assert.equal(w.memory.readI32(p),7);
  api(w,'IntersectClipRect',s.dc,2,2,5,5);assert.equal(api(w,'Ellipse',s.dc,0,0,7,7),1);assert.equal(api(w,'PtVisible',s.dc,3,3),1);assert.equal(api(w,'PtVisible',s.dc,6,6),0);
});
test('fonts require a host backend, mapping modes are implemented, and unsupported scaling fails',t=>{
  const w=process(t),s=surface(w);fail(w,'TextOutA',[s.dc,0,0,'hello',5],50);assert.equal(api(w,'SetMapMode',s.dc,8),1);assert.equal(api(w,'GetMapMode',s.dc),8);fail(w,'SetMapMode',[s.dc,9],87);fail(w,'SetStretchBltMode',[s.dc,4],50);
});
test('registered raster window receives blits and can be used as a readback source',t=>{
  const w=process(t),s=surface(w),win=windowSurface(w),dest=surface(w);pixel(w,s,1,1,0x123456);
  assert.equal(api(w,'BitBlt',win.dc,0,0,4,3,s.dc,0,0,C.SRCCOPY),1);assert.equal(win.writes,1);assert.deepEqual([...win.data.subarray(20,23)],[0x56,0x34,0x12]);
  assert.equal(api(w,'BitBlt',dest.dc,0,0,4,3,win.dc,0,0,C.SRCCOPY),1);assert.equal(pixel(w,dest,1,1),0x123456);
});
test('raster adapter failures and tainted canvas report errors without reading host OS',t=>{
  const w=process(t),s=surface(w),handle=w.registerWindow({getClientRect:()=>({width:4,height:3}),readPixels(){throw Object.assign(new Error('tainted'),{name:'SecurityError'});},writePixels(){}}),dc=w.invoke('user32','GetDC',[handle]);fail(w,'BitBlt',[s.dc,0,0,4,3,dc,0,0,C.SRCCOPY],5);
  const other=w.registerWindow({draw(){},getClientRect:()=>({width:4,height:3})}),otherDC=w.invoke('user32','GetDC',[other]);fail(w,'GetPixel',[otherDC,0,0],50,C.CLR_INVALID);
});
test('processes never accept one another’s bitmap/DC handles as storage pointers',t=>{
  const w=process(t),other=process(t),s=surface(w);fail(other,'GetPixel',[s.dc,0,0],6,C.CLR_INVALID);assert.throws(()=>other.memory.bytes(s.bits,4),e=>e.code===87);
});
