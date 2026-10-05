import {mapping,inverse,mapPoint,mapBounds,devicePoint,translatedOnly} from './gdi-transform.js';
import {Win32Error,integer,unsigned} from './core.js';

// All bitmap addresses are process-private. DIBs use Win32 BGR/BGRA scan lines,
// not Canvas RGBA. DDB scan lines are WORD aligned; DIBs are DWORD aligned.
export const GDI_CONSTANTS=Object.freeze({BI_RGB:0,DIB_RGB_COLORS:0,CBM_INIT:4,
  SRCCOPY:0x00cc0020,SRCPAINT:0x00ee0086,SRCAND:0x008800c6,SRCINVERT:0x00660046,
  SRCERASE:0x00440328,NOTSRCCOPY:0x00330008,NOTSRCERASE:0x001100a6,
  MERGECOPY:0x00c000ca,MERGEPAINT:0x00bb0226,PATCOPY:0x00f00021,
  PATPAINT:0x00fb0a09,PATINVERT:0x005a0049,DSTINVERT:0x00550009,
  BLACKNESS:0x00000042,WHITENESS:0x00ff0062,COLORONCOLOR:3,
  AC_SRC_OVER:0,AC_SRC_ALPHA:1,OBJ_PEN:1,OBJ_BRUSH:2,OBJ_DC:3,OBJ_BITMAP:7,
  OBJ_MEMDC:10,MM_TEXT:1,NULLREGION:1,SIMPLEREGION:2,CLR_INVALID:0xffffffff});
const rops=new Set(Object.entries(GDI_CONSTANTS).filter(([k])=>['SRCCOPY','SRCPAINT','SRCAND','SRCINVERT','SRCERASE','NOTSRCCOPY','NOTSRCERASE','MERGECOPY','MERGEPAINT','PATCOPY','PATPAINT','PATINVERT','DSTINVERT','BLACKNESS','WHITENESS'].includes(k)).map(([,v])=>v));
export const coord=value=>integer(value,-0x80000000,0x7fffffff);
export function intersect(a,b){const r=[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];return r[2]<=r[0]||r[3]<=r[1]?[0,0,0,0]:r;}
export function rgbBytes(color){color=unsigned(color);return [color&255,color>>>8&255,color>>>16&255,0];}
export function rgbValue(data,i=0){return data[i]|data[i+1]<<8|data[i+2]<<16;}
export function ropInfo(value){value=unsigned(value);if(!rops.has(value))throw new Win32Error('Unsupported raster operation or capture flags',50);const code=value>>>16&255;return {code,source:((code^(code>>>2))&0x33)!==0,pattern:((code^(code>>>4))&15)!==0};}
function applyROP(code,p,s,d){let out=0;for(let i=0;i<8;i++)if(code>>i&1)out|=(i&4?p:~p)&(i&2?s:~s)&(i&1?d:~d);return out&255;}

export class BitmapStore {
  constructor(w,regions){this.clipCache=new WeakMap();this.regions=regions;this.w=w;this.m=w.memory;this.h=w.handles;this.maxPixels=integer(w.options.maxRasterPixels??Math.max(1,Math.min(4194304,Math.floor(w.memory.maxBytes/4))),1,16777216);}
  geometry(width,height,bpp,dib=false){width=integer(width,1,32767);height=integer(height,1,32767);if(![1,24,32].includes(bpp)||dib&&bpp===1)throw new Win32Error('Only 1-bit DDB and 24/32-bit BI_RGB bitmaps are supported',50);const unit=dib?32:16,stride=Math.ceil(width*bpp/unit)*unit/8,size=stride*height;if(size>this.m.maxBytes)throw new Win32Error('Bitmap exceeds process memory quota',8);return {width,height,bpp,stride,size};}
  header(pointer,usage=0){if(unsigned(usage)!==0)throw new Win32Error('Logical palettes are not supported',50);const v=this.m.view(pointer,40);if(v.getUint32(0,true)!==40)throw new Win32Error('Only BITMAPINFOHEADER is supported',50);const width=v.getInt32(4,true),signedHeight=v.getInt32(8,true),bpp=v.getUint16(14,true);if(v.getUint16(12,true)!==1||!signedHeight)throw new Win32Error('Invalid bitmap planes or height');if(v.getUint32(16,true)!==0||v.getUint32(32,true)!==0)throw new Win32Error('Only uncompressed true-color BI_RGB without a color table is supported',50);return {...this.geometry(width,Math.abs(signedHeight),bpp,true),topDown:signedHeight<0,dib:true};}
  create(width,height,bpp,{dib=false,topDown=true,bits=0,stock=false}={}){const g=this.geometry(width,height,bpp,dib);const input=bits?this.m.bytes(bits,g.size).slice():null;const ptr=this.m.alloc(g.size);this.m.block(ptr).owner='gdi-bitmap';try{if(input)this.m.bytes(ptr,g.size).set(input);return this.h.add('bitmap',{...g,ptr,dib,topDown,stock,dimensionX:0,dimensionY:0});}catch(error){this.m.free(ptr);throw error;}}
  get(handle){return this.h.get(handle,'bitmap');}
  data(bitmap){return this.m.bytes(bitmap.ptr,bitmap.size);}
  bytesFor(rect){const width=rect[2]-rect[0],height=rect[3]-rect[1];if(width<0||height<0||width*height>this.maxPixels)throw new Win32Error('Raster operation exceeds pixel quota',8);return {width,height,data:new Uint8ClampedArray(width*height*4)};}
  bounds(state){if(state.bitmap){const b=this.get(state.bitmap);return [0,0,b.width,b.height];}const d=state.window,r=d.getClientRect?.(),c=d.context?.canvas||d.node;return [0,0,integer(Math.ceil(r?.width??c?.width??c?.clientWidth??0),0,32767),integer(Math.ceil(r?.height??c?.height??c?.clientHeight??0),0,32767)];}
  effective(state){
    const bounds=this.bounds(state),window=state.window,shape=window?.gdiWindowShape??window?.gdiClientShape??null,paint=state.paintClip??null,prior=this.clipCache.get(state);
    const rect=shape&&window?.gdiWindowShape?window.getRect?.():null,origin=rect?window.clientOrigin?.():null;
    const dx=origin?Math.round(rect.left-origin[0]):0,dy=origin?Math.round(rect.top-origin[1]):0;
    if(prior&&prior.clip===state.clip&&prior.shape===shape&&prior.dx===dx&&prior.dy===dy&&prior.paint===paint&&bounds.every((n,i)=>n===prior.bounds[i]))return prior.region;
    let region=this.regions.rectangle(...bounds);for(const clip of [state.clip,shape?this.regions.offset(shape,dx,dy):null,paint])if(clip)region=this.regions.combine(region,clip,1);
    this.clipCache.set(state,{bounds,clip:state.clip,shape,paint,dx,dy,region});return region;
  }
  clip(state,rect){return this.regions.combine(this.regions.rectangle(...intersect(rect,this.bounds(state))),this.effective(state),1).bounds;}
  spans(state,y,left,right){return this.regions.row(this.effective(state),y);}
  context(state){const c=state.window.context||state.window.node?.getContext?.('2d');if(!c)throw new Win32Error('Drawing adapter does not support pixel readback/writeback',50);return c;}
  readBitmap(b,rect){const image=this.bytesFor(rect),bytes=this.data(b),[l,t]=rect;for(let y=0;y<image.height;y++){const row=(b.topDown?t+y:b.height-1-t-y)*b.stride;for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4,px=l+x;if(b.bpp===1){const c=bytes[row+(px>>>3)]&(0x80>>(px&7))?255:0;image.data.set([c,c,c,255],i);}else{const p=row+px*b.bpp/8;image.data[i]=bytes[p+2];image.data[i+1]=bytes[p+1];image.data[i+2]=bytes[p];image.data[i+3]=b.bpp===32?bytes[p+3]:255;}}}return image;}
  writeBitmap(b,rect,image,background=0xffffff){const bytes=this.data(b),[l,t]=rect;for(let y=0;y<image.height;y++){const row=(b.topDown?t+y:b.height-1-t-y)*b.stride;for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4,px=l+x;if(b.bpp===1){const p=row+(px>>>3),mask=0x80>>(px&7);bytes[p]=rgbValue(image.data,i)===(background&0xffffff)?bytes[p]|mask:bytes[p]&~mask;}else{const p=row+px*b.bpp/8;bytes[p]=image.data[i+2];bytes[p+1]=image.data[i+1];bytes[p+2]=image.data[i];if(b.bpp===32)bytes[p+3]=image.data[i+3];}}}}
  read(state,rect){if(state.bitmap)return this.readBitmap(this.get(state.bitmap),rect);const image=this.bytesFor(rect);try{const result=state.window.readPixels?state.window.readPixels(rect[0],rect[1],image.width,image.height):this.context(state).getImageData(rect[0],rect[1],image.width,image.height);if(!result||result.width!==image.width||result.height!==image.height||result.data?.length!==image.data.length)throw new Win32Error('Invalid pixel readback from host',50);image.data.set(result.data);return image;}catch(error){if(error?.name==='SecurityError')throw new Win32Error('Canvas readback is not permitted',5);throw error;}}
  write(state,rect,image){if(state.bitmap)return this.writeBitmap(this.get(state.bitmap),rect,image,state.backgroundColor);for(let i=3;i<image.data.length;i+=4)image.data[i]=255;if(state.window.writePixels){if(state.window.writePixels(rect[0],rect[1],image)===false)throw new Win32Error('Host rejected raster transfer',50);return;}const ctx=this.context(state),data=ctx.createImageData(image.width,image.height);data.data.set(image.data);for(let i=3;i<data.data.length;i+=4)data.data[i]=255;ctx.putImageData(data,rect[0],rect[1]);}
  blit(dst,dx,dy,dw,dh,src,sx,sy,sw,sh,operation,extra=0){
    [dx,dy,dw,dh,sx,sy,sw,sh]=[dx,dy,dw,dh,sx,sy,sw,sh].map(coord);
    const blend=operation==='alpha',transparent=operation==='transparent',rop=blend||transparent?{source:true,pattern:false}:ropInfo(operation);
    if((blend||transparent)&&[dw,dh,sw,sh].some(n=>n<=0))throw new Win32Error('Alpha/transparent blits require positive extents');
    if(blend){extra=unsigned(extra);if(extra&0xffff||extra>>>24>1)throw new Win32Error('Unsupported BLENDFUNCTION');if(extra>>>24&&(!src?.bitmap||this.get(src.bitmap).bpp!==32))throw new Win32Error('Per-pixel alpha requires a 32-bit source bitmap');}
    if(!blend&&!transparent&&(Math.abs(dw)!==Math.abs(sw)||Math.abs(dh)!==Math.abs(sh))&&src&&dst.stretchMode!==3)throw new Win32Error('Scaled raster transfers require COLORONCOLOR',50);
    const dm=mapping(dst),di=inverse(dm),sm=src?mapping(src):null;
    const logicalDst=[Math.min(dx,dx+dw),Math.min(dy,dy+dh),Math.max(dx,dx+dw),Math.max(dy,dy+dh)];
    const rawDst=mapBounds(dm,logicalDst),r=this.clip(dst,rawDst);
    const rawSrc=src?mapBounds(sm,[Math.min(sx,sx+sw),Math.min(sy,sy+sh),Math.max(sx,sx+sw),Math.max(sy,sy+sh)]):[0,0,0,0];
    if(rop.source){if(!src)throw new Win32Error('Source device context required',6);const b=this.bounds(src);if(rawSrc[0]<0||rawSrc[1]<0||rawSrc[2]>b[2]||rawSrc[3]>b[3])throw new Win32Error('Source rectangle is outside its bitmap');if(blend&&(dst.bitmap?dst.bitmap===src.bitmap:dst.window===src.window)){const overlap=intersect(rawSrc,rawDst);if(overlap[2]>overlap[0])throw new Win32Error('Overlapping AlphaBlend rectangles');}}
    if(!dw||!dh||rop.source&&(!sw||!sh)||r[2]===r[0])return 1;
    const brush=this.h.get(dst.brush,'brush');if(rop.pattern&&brush.null)return 1;
    // Snapshot before writes: aliased source/destination is safe for every ROP.
    const source=rop.source?this.read(src,rawSrc):null,image=this.read(dst,r),pattern=rgbBytes(brush.color||0),mono=src?.bitmap&&this.get(src.bitmap).bpp===1;
    const effective=this.effective(dst),fg=rgbBytes(dst.textColor),bg=rgbBytes(dst.backgroundColor),constant=(extra>>>16&255)/255,perPixel=extra>>>24===1;
    for(let y=0;y<image.height;y++){const spans=this.regions.row(effective,r[1]+y);for(let span=0;span<spans.length;span+=2)for(let x=Math.max(r[0],spans[span])-r[0];x<Math.min(r[2],spans[span+1])-r[0];x++){
      const i=(y*image.width+x)*4,px=r[0]+x+.5,py=r[1]+y+.5,lx=di[0]*px+di[2]*py+di[4],ly=di[1]*px+di[3]*py+di[5];
      if(lx<logicalDst[0]||lx>=logicalDst[2]||ly<logicalDst[1]||ly>=logicalDst[3])continue;
      const ux=sx+((lx-dx)/dw)*sw,uy=sy+((ly-dy)/dh)*sh;
      const ix=source?Math.min(source.width-1,Math.max(0,Math.floor(sm[0]*ux+sm[2]*uy+sm[4])-rawSrc[0])):0;
      const iy=source?Math.min(source.height-1,Math.max(0,Math.floor(sm[1]*ux+sm[3]*uy+sm[5])-rawSrc[1])):0;
      const si=source?(iy*source.width+ix)*4:0,s=mono?(source.data[si]?bg:fg):source?.data;
      const offset=mono?0:si;
      if(transparent&&rgbValue(s,offset)===(unsigned(extra)&0xffffff))continue;
      if(blend){const alpha=constant*(perPixel?s[offset+3]/255:1);for(let c=0;c<3;c++)image.data[i+c]=Math.min(255,Math.round(s[offset+c]*constant+image.data[i+c]*(1-alpha)));image.data[i+3]=Math.round(255*alpha+image.data[i+3]*(1-alpha));}
      else{for(let c=0;c<3;c++)image.data[i+c]=transparent?s[offset+c]:applyROP(rop.code,pattern[c],s?.[offset+c]||0,image.data[i+c]);image.data[i+3]=transparent||rop.code===0xcc?s[offset+3]:0;}
    }
    }this.write(dst,r,image);return 1;
  }
  pixel(state,x,y,color){[x,y]=devicePoint(state,coord(x),coord(y));const r=this.clip(state,[x,y,x+1,y+1]);if(!r[2])return 0xffffffff;const image=this.read(state,r);if(color===undefined)return rgbValue(image.data);image.data.set(rgbBytes(color));this.write(state,r,image);return state.bitmap&&this.get(state.bitmap).bpp===1?rgbValue(this.read(state,r).data):color&0xffffff;}
  // Integer software primitives for memory DCs. Font rasterization remains a
  // Canvas/host facility; no platform font metrics are fabricated in workers.
  primitive(state,operation,args,style){
    if(!['line','rect','ellipse'].includes(operation))throw new Win32Error('Software memory DC does not support this primitive',50);
    let [x1,y1,x2,y2]=args.map(coord);const matrix=mapping(state),back=inverse(matrix);
    const width=style.pen.width||1,pad=operation==='line'?Math.ceil(width/2):0;
    const r=this.clip(state,mapBounds(matrix,[Math.min(x1,x2)-pad,Math.min(y1,y2)-pad,Math.max(x1,x2)+pad,Math.max(y1,y2)+pad]));if(!r[2])return;
    const effective=this.effective(state),image=this.read(state,r),pen=rgbBytes(style.pen.color||0),brush=rgbBytes(style.brush.color||0);
    const l=Math.min(x1,x2),t=Math.min(y1,y2),right=Math.max(x1,x2),bottom=Math.max(y1,y2),rx=(right-l)/2,ry=(bottom-t)/2;
    for(let y=0;y<image.height;y++){const spans=this.regions.row(effective,r[1]+y);for(let span=0;span<spans.length;span+=2)for(let x=Math.max(r[0],spans[span])-r[0];x<Math.min(r[2],spans[span+1])-r[0];x++){
      const vx=r[0]+x+.5,vy=r[1]+y+.5,px=back[0]*vx+back[2]*vy+back[4]-.5,py=back[1]*vx+back[3]*vy+back[5]-.5;let fill=false,stroke=false;
      if(operation==='rect'){fill=px>=l&&px<right&&py>=t&&py<bottom;stroke=fill&&(px<l+width||px>=right-width||py<t+width||py>=bottom-width);}
      else if(operation==='ellipse'){const nx=px+.5-l-rx,ny=py+.5-t-ry;fill=rx>0&&ry>0&&nx*nx/(rx*rx)+ny*ny/(ry*ry)<=1;stroke=fill&&(rx<=width||ry<=width||nx*nx/((rx-width)**2)+ny*ny/((ry-width)**2)>=1);}
      else {const dx=x2-x1,dy=y2-y1,len=dx*dx+dy*dy,u=len?((px-x1)*dx+(py-y1)*dy)/len:-1;stroke=u>=0&&u<1&&((px-x1-u*dx)**2+(py-y1-u*dy)**2)<=width*width/4;}
      if(stroke&&!style.pen.null)image.data.set(pen,(y*image.width+x)*4);else if(fill&&!style.brush.null)image.data.set(brush,(y*image.width+x)*4);
    }
    }this.write(state,r,image);
  }
}
