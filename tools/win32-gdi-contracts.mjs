/** Small, deterministic common-contract comparison; not full native GDI certification. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWin32,WIN32_CONSTANTS as C} from '../packages/win32-browser/src/index.js';
export function gdiContracts(){
  const w=createWin32(),m=w.memory,g=(name,...a)=>w.invoke('gdi32',name,a),report={};
  const info=(width,height,bpp)=>{const p=m.alloc(40),v=m.view(p,40);v.setUint32(0,40,true);v.setInt32(4,width,true);v.setInt32(8,height,true);v.setUint16(12,1,true);v.setUint16(14,bpp,true);return p;};
  const dib=(width,height,bpp=32)=>{const p=info(width,height,bpp),out=m.alloc(4),bitmap=g('CreateDIBSection',0,p,0,out,0,0),bits=m.readU32(out),dc=g('CreateCompatibleDC',0),old=g('SelectObject',dc,bitmap);assert.ok(bitmap&&dc&&old);return {p,bitmap,bits,dc,old};};
  try{
    const s=dib(3,2,24),object=m.alloc(84),out=m.alloc(64);g('GetObjectW',s.bitmap,84,object);
    report.dibStride=m.readI32(object+12);report.dibBitmapBitsSize=g('GetBitmapBits',s.bitmap,0,0);
    m.bytes(s.bits,24).set([1,2,3,4,5,6,7,8,9,0,0,0,11,12,13,14,15,16,17,18,19,0,0,0]);
    report.dibPixels=[g('GetPixel',s.dc,0,0),g('GetPixel',s.dc,0,1)];
    const count=g('GetBitmapBits',s.bitmap,64,out);report.dibBitmapBitsCount=count;report.dibBitmapBits=Array.from(m.bytes(out,count));
    g('SelectObject',s.dc,s.old);const top=info(3,-2,24),bottom=info(3,2,24);
    report.topDIBCount=g('GetDIBits',s.dc,s.bitmap,0,2,out,top,0);report.topDIB=Array.from(m.bytes(out,24)).filter((_,i)=>i%12<9);
    m.bytes(out,64).fill(0);report.bottomDIBCount=g('GetDIBits',s.dc,s.bitmap,0,2,out,bottom,0);report.bottomDIB=Array.from(m.bytes(out,24)).filter((_,i)=>i%12<9);
    m.bytes(out,64).fill(0);report.partialDIBCount=g('GetDIBits',s.dc,s.bitmap,1,1,out,bottom,0);report.partialDIB=Array.from(m.bytes(out,9));
    const raw=m.alloc(20);m.bytes(raw,20).set(Array.from({length:20},(_,i)=>i+1));const ddb=g('CreateBitmap',3,2,1,24,raw);g('GetObjectW',ddb,24,object);report.ddbStride=m.readI32(object+12);const n=g('GetBitmapBits',ddb,64,out);report.ddbBits=Array.from(m.bytes(out,n));
    const a=dib(1,-1),b=dib(1,-1),penColor=0x3cb17e;g('SelectObject',b.dc,g('CreateSolidBrush',penColor));
    const names=['SRCCOPY','SRCPAINT','SRCAND','SRCINVERT','SRCERASE','NOTSRCCOPY','NOTSRCERASE','MERGECOPY','MERGEPAINT','PATCOPY','PATPAINT','PATINVERT','DSTINVERT','BLACKNESS','WHITENESS'];
    report.rops=names.map(name=>{g('SetPixel',a.dc,0,0,0xa6c319);g('SetPixel',b.dc,0,0,0x69e052);assert.equal(g('BitBlt',b.dc,0,0,1,1,a.dc,0,0,C[name]),1);return g('GetPixel',b.dc,0,0);});
    m.bytes(a.bits,4).set([0,0,128,128]);m.bytes(b.bits,4).set([200,0,0,255]);report.alphaResult=w.invoke('msimg32','AlphaBlend',[b.dc,0,0,1,1,a.dc,0,0,1,1,0x01ff0000]);g('GdiFlush');report.alphaBytes=Array.from(m.bytes(b.bits,4));
    report.defaultDepth=(g('GetObjectW',g('GetCurrentObject',s.dc,7),24,object),m.view(object,24).getUint16(18,true));
    return report;
  }finally{w.dispose();}
}
const actual=gdiContracts();
if(process.argv[2]==='--compare'){
  const native=JSON.parse(readFileSync(process.argv[3],'utf8').replace(/^\uFEFF/,''));
  const rounding=actual.alphaBytes.map((n,i)=>Math.abs(n-native.alphaBytes[i]));
  assert.ok(rounding.every(n=>n<=1),'Alpha rounding differs by more than one channel value');
  const {alphaBytes:_,...left}=actual,{alphaBytes:__,...right}=native;assert.deepEqual(left,right);
  console.log(JSON.stringify({passed:true,contractFields:Object.keys(actual).length,alphaChannelTolerance:1,compatibility:actual,native},null,2));
}else console.log(JSON.stringify(actual,null,2));
