/** Exact native GDI region/clip contracts. This is not full GDI certification. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createWin32} from '../packages/win32-browser/src/index.js';
export function regionContracts(){
 const w=createWin32(),m=w.memory,g=(n,...a)=>w.invoke('gdi32',n,a),r={};
 const region=(...a)=>g('CreateRectRgn',...a),out=m.alloc(1024);
 const data=h=>{const n=g('GetRegionData',h,1024,out);assert.ok(n&&n<=1024);return Array.from({length:n/4},(_,i)=>m.readI32(out+i*4));};
 const box=(fn,h)=>{const type=g(fn,h,out);return [type,...Array.from({length:4},(_,i)=>m.readI32(out+i*4))];};
 try{
  const a=region(0,0,8,8),b=region(2,2,6,6),dest=region(0,0,0,0),reversed=region(8,8,0,0);
  r.reversed=data(reversed);r.empty=data(dest);
  r.modes=[];for(let mode=1;mode<=5;mode++){const type=g('CombineRgn',dest,a,mode===5?0:b,mode);r.modes.push({type,data:data(dest)});}
  g('CombineRgn',dest,a,b,4);r.membership=[];for(const [x,y]of [[0,0],[7,7],[8,0],[0,8],[2,2],[5,5],[6,6]])r.membership.push(g('PtInRegion',dest,x,y));
  r.rectangles=[];for(const rect of [[2,2,6,6],[1,1,3,3],[8,0,9,8],[0,0,0,1]]){rect.forEach((n,i)=>m.writeI32(out+i*4,n));r.rectangles.push(g('RectInRegion',dest,out));}
  const encoded=data(dest),buf=m.alloc(encoded.length*4);encoded.forEach((n,i)=>m.writeI32(buf+i*4,n));const copy=g('ExtCreateRegion',0,encoded.length*4,buf);r.roundtrip=g('EqualRgn',copy,dest);
  const transform=m.alloc(24),v=m.view(transform,24);v.setFloat32(0,1,true);v.setFloat32(12,1,true);v.setFloat32(16,3,true);v.setFloat32(20,-2,true);r.translated=data(g('ExtCreateRegion',transform,encoded.length*4,buf));
  const dc=g('CreateCompatibleDC',0),info=m.alloc(40),bitsOut=m.alloc(4),iv=m.view(info,40);iv.setUint32(0,40,true);iv.setInt32(4,8,true);iv.setInt32(8,-8,true);iv.setUint16(12,1,true);iv.setUint16(14,32,true);const bitmap=g('CreateDIBSection',0,info,0,bitsOut,0,0);g('SelectObject',dc,bitmap);
  r.noClip=g('GetClipRgn',dc,copy);r.select=g('SelectClipRgn',dc,dest);r.clipBox=box('GetClipBox',dc);r.copyClip=g('GetClipRgn',dc,copy);r.copied=data(copy);
  r.saved=g('SaveDC',dc);g('SelectClipRgn',dc,0);g('SetRectRgn',dest,0,0,1,1);g('DeleteObject',dest);r.restored=g('RestoreDC',dc,-1);r.restoredVisibility=[g('PtVisible',dc,3,3),g('PtVisible',dc,7,7)];
  r.offsetClip=g('OffsetClipRgn',dc,20,20);r.offscreenBox=box('GetClipBox',dc);g('GetClipRgn',dc,copy);r.offscreenData=data(copy);
  g('SelectClipRgn',dc,0);r.intersectOutside=g('IntersectClipRect',dc,20,20,30,30);g('GetClipRgn',dc,copy);r.intersectOutsideData=data(copy);
  g('SelectClipRgn',dc,0);r.exclude=g('ExcludeClipRect',dc,2,2,6,6);r.excludedBox=box('GetClipBox',dc);
  g('SelectClipRgn',dc,a);g('SetViewportOrgEx',dc,2,2,0);r.logicalExclude=g('ExcludeClipRect',dc,1,1,3,3);r.logicalBox=box('GetClipBox',dc);r.logicalVisibility=[g('PtVisible',dc,1,1),g('PtVisible',dc,0,0)];g('SetViewportOrgEx',dc,0,0,0);
  r.extSelect=[];for(let mode=1;mode<=5;mode++){g('SelectClipRgn',dc,a);r.extSelect.push(g('ExtSelectClipRgn',dc,b,mode));g('GetClipRgn',dc,copy);r.extSelect.push(data(copy));}
  g('CombineRgn',copy,a,b,4);g('SelectClipRgn',dc,copy);r.regionSelect=g('SelectObject',dc,copy);
  const brush=g('CreateSolidBrush',0x563412),bits=m.readU32(bitsOut),rgb=()=>Array.from({length:64},(_,i)=>{const p=bits+i*4;return m.bytes(p,3).reduce((n,v,j)=>n|(v<<((2-j)*8)),0);});
  r.painted=[];for(const name of ['FillRgn','PaintRgn','InvertRgn']){m.bytes(bits,256).fill(0);g('SelectObject',dc,brush);r.painted.push(name==='FillRgn'?g(name,dc,a,brush):g(name,dc,a));r.painted.push(rgb());}
  r.patBlt=g('PatBlt',dc,0,0,8,8,0xf00021);r.patPixels=rgb();
  // FillRgn coordinates are logical even though SelectClipRgn uses device units.
  g('SelectClipRgn',dc,0);g('SetViewportOrgEx',dc,1,1,0);m.bytes(bits,256).fill(0);r.fillTranslated=g('FillRgn',dc,b,brush);r.fillTranslatedPixels=rgb();
  return r;
 }finally{w.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const actual=regionContracts();if(process.argv[2]==='--compare'){const native=JSON.parse(readFileSync(process.argv[3],'utf8').replace(/^\uFEFF/,''));assert.deepEqual(actual,native);console.log(JSON.stringify({passed:true,contractFields:Object.keys(actual).length,compatibility:actual,native},null,2));}else console.log(JSON.stringify(actual,null,2));}
