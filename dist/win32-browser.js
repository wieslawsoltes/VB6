/* VB6 Studio Web 0.5.0 - MIT. Generated from modular sources. */
(()=>{'use strict';
const __modules=[];

/* core.js */
__modules[0]=(()=>{

/** MIT. A bounded, process-private 32-bit address and handle space. */
const ERROR = Object.freeze({SUCCESS:0,FILE_NOT_FOUND:2,PATH_NOT_FOUND:3,ACCESS_DENIED:5,INVALID_HANDLE:6,NOT_ENOUGH_MEMORY:8,INVALID_DATA:13,SHARING_VIOLATION:32,NOT_SUPPORTED:50,FILE_EXISTS:80,INVALID_PARAMETER:87,INSUFFICIENT_BUFFER:122,MOD_NOT_FOUND:126,PROC_NOT_FOUND:127,DIR_NOT_EMPTY:145,ALREADY_EXISTS:183,ENVVAR_NOT_FOUND:203,MORE_DATA:234,NO_MORE_ITEMS:259,OPERATION_ABORTED:995,INVALID_WINDOW_HANDLE:1400});
class Win32Error extends Error {
  constructor(message,code=ERROR.INVALID_PARAMETER){super(message);this.name='Win32Error';this.code=code;}
}
function integer(value,min=0,max=0xffffffff){value=Number(value);if(!Number.isSafeInteger(value)||value<min||value>max)throw new Win32Error('Invalid integer argument');return value;}
function unsigned(value){return integer(value,-0x80000000,0xffffffff)>>>0;}
class Handles {
  constructor(limit=16384){this.limit=limit;this.next=0x40000000;this.entries=new Map();}
  add(type,value){if(this.entries.size>=this.limit||this.next>=0x7fffffff)throw new Win32Error('Handle quota exceeded',8);const h=this.next++;this.entries.set(h,{type,value});return h;}
  get(handle,type){const e=this.entries.get(Number(handle));if(!e||type&&e.type!==type)throw new Win32Error('Invalid '+(type||'object')+' handle',6);return e.value;}
  has(handle,type){const e=this.entries.get(Number(handle));return !!e&&(!type||e.type===type);}
  close(handle,type){const value=this.get(handle,type);this.entries.delete(Number(handle));return value;}
}
// Explicit CP1252 table: some Node/ICU builds alias this label to ISO-8859-1.
const extended=[0x20ac,0x81,0x201a,0x192,0x201e,0x2026,0x2020,0x2021,0x2c6,0x2030,0x160,0x2039,0x152,0x8d,0x17d,0x8f,0x90,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x2dc,0x2122,0x161,0x203a,0x153,0x9d,0x17e,0x178];
const ansiChars=Array.from({length:256},(_,i)=>String.fromCharCode(i>=128&&i<160?extended[i-128]:i));
const ansiCodes=new Map(ansiChars.map((c,i)=>[c,i]));
function encodeANSI(text){return Uint8Array.from(String(text),c=>ansiCodes.get(c)??63);}
function decodeANSI(bytes){let result='';for(let offset=0;offset<bytes.length;offset+=8192)result+=Array.from(bytes.subarray(offset,offset+8192),n=>ansiChars[n]).join('');return result;}
class Memory {
  constructor({maxBytes=32*1024*1024,ansi={encode:encodeANSI,decode:decodeANSI}}={}){this.maxBytes=integer(maxBytes,1,0x20000000);this.ansi=ansi;this.blocks=[];this.freeBlocks=[];this.next=0x10000;this.used=0;}
  alloc(size){size=Math.max(1,integer(size,0,this.maxBytes));if(this.used+size>this.maxBytes)throw new Win32Error('Memory quota exceeded',8);const span=Math.ceil(size/16)*16;let ptr,slot=this.freeBlocks.findIndex(b=>b.span>=span);if(slot>=0){const b=this.freeBlocks[slot];ptr=b.ptr;b.ptr+=span;b.span-=span;if(!b.span)this.freeBlocks.splice(slot,1);}else{if(this.next+span>=0x40000000)throw new Win32Error('Virtual address space exhausted',8);ptr=this.next;this.next+=span;}const block={ptr,size,span,bytes:new Uint8Array(size)};let lo=0,hi=this.blocks.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.blocks[mid].ptr<ptr)lo=mid+1;else hi=mid;}this.blocks.splice(lo,0,block);this.used+=size;return ptr;}
  block(pointer,length=1){const p=unsigned(pointer),n=integer(length,0,this.maxBytes);let lo=0,hi=this.blocks.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.blocks[mid].ptr<=p)lo=mid+1;else hi=mid;}const b=this.blocks[lo-1];if(!b||p<b.ptr||p-b.ptr+n>b.size)throw new Win32Error('Pointer is outside an allocated buffer',87);return b;}
  bytes(pointer,length){const b=this.block(pointer,length);return b.bytes.subarray(unsigned(pointer)-b.ptr,unsigned(pointer)-b.ptr+length);}
  view(pointer,length){const b=this.bytes(pointer,length);return new DataView(b.buffer,b.byteOffset,b.byteLength);}
  size(pointer){const b=this.block(pointer,0);return b.size-(unsigned(pointer)-b.ptr);}
  free(pointer){const i=this.blocks.findIndex(b=>b.ptr===unsigned(pointer));if(i<0)throw new Win32Error('Invalid allocation base',6);const [b]=this.blocks.splice(i,1);b.bytes.fill(0);this.used-=b.size;this.freeBlocks.push({ptr:b.ptr,span:b.span});this.freeBlocks.sort((a,b)=>a.ptr-b.ptr);for(let j=this.freeBlocks.length-1;j>0;j--){const a=this.freeBlocks[j-1],v=this.freeBlocks[j];if(a.ptr+a.span===v.ptr){a.span+=v.span;this.freeBlocks.splice(j,1);}}}
  readU32(p){return this.view(p,4).getUint32(0,true);}
  writeU32(p,n){this.view(p,4).setUint32(0,unsigned(n),true);}
  readI32(p){return this.view(p,4).getInt32(0,true);}
  writeI32(p,n){this.view(p,4).setInt32(0,Number(n),true);}
  stringBytes(text,wide=false){if(!wide)return this.ansi.encode(String(text));const s=String(text),b=new Uint8Array(s.length*2),v=new DataView(b.buffer);for(let i=0;i<s.length;i++)v.setUint16(i*2,s.charCodeAt(i),true);return b;}
  decode(bytes,wide=false){if(!wide)return this.ansi.decode(bytes);let s='';for(let i=0;i+1<bytes.length;i+=2)s+=String.fromCharCode(bytes[i]|bytes[i+1]<<8);return s;}
  string(pointer,wide=false){if(typeof pointer==='string')return pointer.split('\0')[0];if(!pointer)return '';const b=this.block(pointer),offset=unsigned(pointer)-b.ptr,step=wide?2:1;let end=offset;for(;end+step<=b.size;end+=step)if(!b.bytes[end]&&(!wide||!b.bytes[end+1]))return this.decode(b.bytes.subarray(offset,end),wide);throw new Win32Error('Unterminated string');}
  putString(pointer,text,capacity,wide=false,multi=false){
    const step=wide?2:1;capacity=integer(capacity,0,Math.floor(this.maxBytes/step));if(!capacity)return 0;
    const out=this.bytes(pointer,capacity*step),source=this.stringBytes(text,wide),units=source.length/step;
    // Enumeration source includes each entry's NUL; append the final NUL. On
    // truncation Win32 requires two terminators and returns capacity minus two.
    const terminators=multi&&units+1>capacity?Math.min(2,capacity):1;
    const n=Math.min(units,capacity-terminators);out.set(source.subarray(0,n*step));out.fill(0,n*step,(n+terminators)*step);
    if(multi&&!units&&capacity>1)out.fill(0,0,2*step);return n;
  }
  allocString(text,wide=false){const bytes=this.stringBytes(text,wide),p=this.alloc(bytes.length+(wide?2:1));this.bytes(p,bytes.length).set(bytes);return p;}
  clear(){for(const b of this.blocks)b.bytes.fill(0);this.blocks=[];this.freeBlocks=[];this.used=0;this.next=0x10000;}
}
/** Case-insensitive, app-private in-memory disk. Embedders can supply a disk adapter. */
class MemoryFileSystem {
  constructor(){this.files=new Map();this.directories=new Set(['/']);this.cwd='/';}
  normalize(path){const raw=String(path).replace(/\\/g,'/').replace(/^[a-z]:/i,'');const parts=[];for(const p of ((raw.startsWith('/')?'':this.cwd+'/')+raw).split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return ('/'+parts.join('/')).toLowerCase();}
  exists(p){return this.files.has(this.normalize(p));}
  readBytes(p){const b=this.files.get(this.normalize(p));if(!b)throw new Win32Error('File not found',2);return b.slice();}
  writeBytes(p,bytes){this.files.set(this.normalize(p),Uint8Array.from(bytes));}
  remove(p){if(!this.files.delete(this.normalize(p)))throw new Win32Error('File not found',2);}
  read(p){return decodeANSI(this.readBytes(p));}
  write(p,s){this.writeBytes(p,encodeANSI(s));}
}

return {ERROR,Win32Error,integer,unsigned,Handles,encodeANSI,decodeANSI,Memory,MemoryFileSystem};
})();

/* gdi-region.js */
__modules[1]=(()=>{
const {Win32Error,integer}=__modules[0];

const REGION_CONSTANTS=Object.freeze({RGN_AND:1,RGN_OR:2,RGN_XOR:3,RGN_DIFF:4,RGN_COPY:5,ERROR:0,NULLREGION:1,SIMPLEREGION:2,COMPLEXREGION:3,OBJ_REGION:8,RDH_RECTANGLES:1});
const MIN=-0x4000000,MAX=0x3ffffff;
const coordinate=n=>integer(n,MIN,MAX);
const equalSpans=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const inside=(mode,a,b)=>mode===1?a&&b:mode===2?a||b:mode===3?a!==b:a&&!b;
const EMPTY=Object.freeze({bands:Object.freeze([]),bounds:Object.freeze([0,0,0,0]),count:0,type:1});

/** Immutable, canonical y-bands: sorted disjoint half-open x intervals per band.
 * Boolean operations depend on edge count, never coordinate magnitude or area.
 * Frozen geometry may safely be shared by handles, clips and saved DC states.
 */
class RegionStore {
  constructor(options={}){
    this.limit=integer(options.maxRegionRectangles??4096,1,65536);
    this.workLimit=integer(options.maxRegionWork??1048576,16,16777216);
  }
  rectangle(left,top,right,bottom){
    [left,top,right,bottom]=[left,top,right,bottom].map(coordinate);
    if(left>right)[left,right]=[right,left];if(top>bottom)[top,bottom]=[bottom,top];
    return left===right||top===bottom?EMPTY:this.finish([{top,bottom,spans:[left,right]}]);
  }
  finish(bands){
    if(!bands.length)return EMPTY;
    let count=0,left=MAX,right=MIN;
    for(const b of bands){count+=b.spans.length/2;left=Math.min(left,b.spans[0]);right=Math.max(right,b.spans.at(-1));Object.freeze(b.spans);Object.freeze(b);}
    if(count>this.limit)throw new Win32Error('Region rectangle quota exceeded',8);
    return Object.freeze({bands:Object.freeze(bands),bounds:Object.freeze([left,bands[0].top,right,bands.at(-1).bottom]),count,type:count===1?2:3});
  }
  append(bands,top,bottom,spans,budget){
    if(!spans.length||bottom<=top)return;
    const last=bands.at(-1);
    if(last&&last.bottom===top&&equalSpans(last.spans,spans)){last.bottom=bottom;return;}
    budget.count+=spans.length/2;if(budget.count>this.limit)throw new Win32Error('Region rectangle quota exceeded',8);
    bands.push({top,bottom,spans});
  }
  combine(a,b,mode){
    mode=integer(mode,1,5);if(mode===5)return a;
    if(a===b)return mode===3||mode===4?EMPTY:a;
    if(!a.count)return mode===2||mode===3?b:EMPTY;
    if(!b.count)return mode===1?EMPTY:a;
    const ys=[...new Set([...a.bands,...b.bands].flatMap(x=>[x.top,x.bottom]))].sort((x,y)=>x-y);
    const result=[],budget={count:0};let ai=0,bi=0,work=0;
    for(let y=0;y+1<ys.length;y++){
      const top=ys[y],bottom=ys[y+1];while(ai<a.bands.length&&a.bands[ai].bottom<=top)ai++;while(bi<b.bands.length&&b.bands[bi].bottom<=top)bi++;
      const aa=a.bands[ai],bb=b.bands[bi],as=aa&&aa.top<=top?aa.spans:[],bs=bb&&bb.top<=top?bb.spans:[];
      work+=as.length+bs.length;if(work>this.workLimit)throw new Win32Error('Region operation work quota exceeded',8);
      let i=0,j=0,inA=false,inB=false,active=false;const spans=[];
      while(i<as.length||j<bs.length){
        const x=Math.min(as[i]??Infinity,bs[j]??Infinity);
        if(as[i]===x){inA=!inA;i++;}if(bs[j]===x){inB=!inB;j++;}
        const next=inside(mode,inA,inB);if(next!==active){spans.push(x);active=next;}
      }
      this.append(result,top,bottom,spans,budget);
    }
    return this.finish(result);
  }
  // RGNDATA already consists of sorted, non-overlapping rectangles. Validate
  // this contract rather than accepting quadratic arbitrary rectangle soups.
  fromRectangles(rectangles){
    if(rectangles.length>this.limit)throw new Win32Error('Region rectangle quota exceeded',8);
    const bands=[],budget={count:0};let current=null;
    for(const input of rectangles){
      const [left,top,right,bottom]=input.map(coordinate);
      if(left>=right||top>=bottom)throw new Win32Error('RGNDATA contains an empty or inverted rectangle');
      if(current&&top===current.top&&bottom===current.bottom){
        const last=current.spans.at(-1);if(left<last)throw new Win32Error('RGNDATA rectangles overlap or are unsorted');
        if(left===last)current.spans[current.spans.length-1]=right;else current.spans.push(left,right);
      }else{
        if(current){if(top<current.bottom)throw new Win32Error('RGNDATA bands overlap or are unsorted');this.append(bands,current.top,current.bottom,current.spans,budget);}
        current={top,bottom,spans:[left,right]};
      }
    }
    if(current)this.append(bands,current.top,current.bottom,current.spans,budget);
    return this.finish(bands);
  }
  offset(region,x,y){
    x=integer(x,-0x80000000,0x7fffffff);y=integer(y,-0x80000000,0x7fffffff);if(!region.count)return region;
    // Check every new bound before constructing or publishing any new state.
    [region.bounds[0]+x,region.bounds[1]+y,region.bounds[2]+x,region.bounds[3]+y].forEach(coordinate);
    if(!x&&!y)return region;
    return this.finish(region.bands.map(b=>({top:b.top+y,bottom:b.bottom+y,spans:b.spans.map(n=>n+x)})));
  }
  row(region,y){
    let lo=0,hi=region.bands.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(region.bands[mid].bottom<=y)lo=mid+1;else hi=mid;}
    const band=region.bands[lo];return band&&band.top<=y?band.spans:[];
  }
  contains(region,x,y){
    const spans=this.row(region,y);let lo=0,hi=spans.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(spans[mid]<=x)lo=mid+1;else hi=mid;}
    return (lo&1)!==0;
  }
  intersects(region,rect){
    const [l,t,r,b]=rect;if(l>=r||t>=b)return false;
    for(const band of region.bands){if(band.top>=b)break;if(band.bottom<=t)continue;for(let i=0;i<band.spans.length;i+=2){if(band.spans[i]>=r)break;if(band.spans[i+1]>l)return true;}}
    return false;
  }
  equal(a,b){return a===b||(a.count===b.count&&a.bands.length===b.bands.length&&a.bands.every((x,i)=>x.top===b.bands[i].top&&x.bottom===b.bands[i].bottom&&equalSpans(x.spans,b.bands[i].spans)));}
  rectangles(region){return region.bands.flatMap(b=>{const out=[];for(let i=0;i<b.spans.length;i+=2)out.push([b.spans[i],b.top,b.spans[i+1],b.bottom]);return out;});}
}

/** Register region, application clip and region-painting APIs on the shared DCs. */
function installRegions(w,{dc,bitmaps,regions,add}){
  const h=w.handles,m=w.memory,get=id=>h.get(id,'region'),set=(id,shape)=>{get(id).shape=shape;return shape.type;};
  const rect=p=>{const v=m.view(p,16);return [0,4,8,12].map(o=>v.getInt32(o,true));};
  const writeRect=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));};
  const create=shape=>h.add('region',{shape});
  const deviceRegion=s=>regions.rectangle(...bitmaps.bounds(s));
  const effective=s=>s.clip?regions.combine(s.clip,deviceRegion(s),1):deviceRegion(s);
  const logicalRect=(s,r)=>regions.offset(regions.rectangle(...r),s.viewportX,s.viewportY);
  const select=(s,object,mode)=>{
    mode=integer(mode,1,5);
    if(!object){if(mode!==5)throw new Win32Error('NULL clip requires RGN_COPY');s.clip=null;return effective(s).type;}
    const shape=get(object).shape;
    const next=mode===5?shape:regions.combine(s.clip||deviceRegion(s),shape,mode);
    // Calculate before assigning, so failures preserve the previous clip.
    const type=regions.combine(next,deviceRegion(s),1).type;s.clip=next;return type;
  };
  add('CreateRectRgn',4,(...r)=>create(regions.rectangle(...r)));
  add('CreateRectRgnIndirect',1,p=>create(regions.rectangle(...rect(p))));
  add('SetRectRgn',5,(object,...r)=>{get(object);set(object,regions.rectangle(...r));return 1;});
  add('CombineRgn',4,(dest,a,b,mode)=>{get(dest);const first=get(a).shape;mode=integer(mode,1,5);return set(dest,mode===5?first:regions.combine(first,get(b).shape,mode));});
  add('EqualRgn',2,(a,b)=>regions.equal(get(a).shape,get(b).shape)?1:0);
  add('OffsetRgn',3,(object,x,y)=>set(object,regions.offset(get(object).shape,x,y)));
  add('GetRgnBox',2,(object,out)=>{const shape=get(object).shape;writeRect(out,shape.bounds);return shape.type;});
  add('PtInRegion',3,(object,x,y)=>regions.contains(get(object).shape,integer(x,-0x80000000,0x7fffffff),integer(y,-0x80000000,0x7fffffff))?1:0);
  add('RectInRegion',2,(object,p)=>regions.intersects(get(object).shape,rect(p))?1:0);
  add('GetRegionData',3,(object,count,out)=>{
    const shape=get(object).shape,size=32+shape.count*16;count=integer(count,0,0xffffffff);if(!out)return size;
    if(count<size)throw new Win32Error('Region data buffer is too small',122);
    const v=m.view(out,size);v.setUint32(0,32,true);v.setUint32(4,1,true);v.setUint32(8,shape.count,true);v.setUint32(12,shape.count*16,true);writeRect(out+16,shape.bounds);
    let offset=32;for(const r of regions.rectangles(shape)){writeRect(out+offset,r);offset+=16;}return size;
  });
  add('ExtCreateRegion',3,(transform,count,p)=>{
    count=integer(count,32,m.maxBytes);const v=m.view(p,count),n=v.getUint32(8,true),bytes=v.getUint32(12,true);
    if(v.getUint32(0,true)!==32||v.getUint32(4,true)!==1||n>regions.limit||bytes<n*16||32+n*16>count)throw new Win32Error('Invalid or excessive RGNDATA');
    let dx=0,dy=0;
    if(transform){const x=m.view(transform,24),a=[0,4,8,12,16,20].map(o=>x.getFloat32(o,true));if(a[0]!==1||a[1]!==0||a[2]!==0||a[3]!==1||!Number.isInteger(a[4])||!Number.isInteger(a[5]))throw new Win32Error('Region XFORM supports identity and integral translation only',50);[dx,dy]=a.slice(4);}
    let shape=regions.fromRectangles(Array.from({length:n},(_,i)=>rect(p+32+i*16)));
    const bounds=rect(p+16);if(!bounds.every((x,i)=>x===shape.bounds[i]))throw new Win32Error('RGNDATA bounding rectangle is inconsistent');
    shape=regions.offset(shape,dx,dy);return create(shape);
  });
  add('SelectClipRgn',2,(handle,object)=>select(dc(handle),object,5));
  add('ExtSelectClipRgn',3,(handle,object,mode)=>select(dc(handle),object,mode));
  add('GetClipRgn',2,(handle,object)=>{const s=dc(handle);get(object);if(!s.clip)return 0;set(object,s.clip);return 1;},{failure:-1});
  for(const [name,mode]of [['IntersectClipRect',1],['ExcludeClipRect',4]])add(name,5,(handle,...r)=>{
    const s=dc(handle),next=regions.combine(s.clip||deviceRegion(s),logicalRect(s,r),mode),type=regions.combine(next,deviceRegion(s),1).type;s.clip=next;return type;
  });
  add('OffsetClipRgn',3,(handle,x,y)=>{const s=dc(handle);x=integer(x,-0x80000000,0x7fffffff);y=integer(y,-0x80000000,0x7fffffff);if(!s.clip)return effective(s).type;const next=regions.offset(s.clip,x,y),type=regions.combine(next,deviceRegion(s),1).type;s.clip=next;return type;});
  add('GetClipBox',2,(handle,out)=>{const s=dc(handle),shape=effective(s);writeRect(out,shape.count?shape.bounds.map((n,i)=>n-(i%2?s.viewportY:s.viewportX)):[0,0,0,0]);return shape.type;});
  add('PtVisible',3,(handle,x,y)=>{const s=dc(handle);x=integer(x,-0x80000000,0x7fffffff)+s.viewportX;y=integer(y,-0x80000000,0x7fffffff)+s.viewportY;return regions.contains(effective(s),x,y)?1:0;});
  add('RectVisible',2,(handle,p)=>{const s=dc(handle),r=rect(p);return regions.intersects(effective(s),[r[0]+s.viewportX,r[1]+s.viewportY,r[2]+s.viewportX,r[3]+s.viewportY])?1:0;});
  const paint=(handle,object,brush,invert=false)=>{
    const s=dc(handle),shape=logicalRectShape(s,get(object).shape),b=invert?null:h.get(brush,'brush');if(b?.null)return 1;
    const clipped=regions.combine(shape,effective(s),1);if(!clipped.count)return 1;
    const r=clipped.bounds,image=bitmaps.read(s,r),color=b?.color||0;
    for(const band of clipped.bands)for(let y=band.top;y<band.bottom;y++)for(let j=0;j<band.spans.length;j+=2)for(let x=band.spans[j];x<band.spans[j+1];x++){
      const i=((y-r[1])*image.width+x-r[0])*4;
      if(invert){image.data[i]^=255;image.data[i+1]^=255;image.data[i+2]^=255;image.data[i+3]=0;}
      else{image.data[i]=color&255;image.data[i+1]=color>>>8&255;image.data[i+2]=color>>>16&255;image.data[i+3]=0;}
    }
    bitmaps.write(s,r,image);return 1;
  };
  const logicalRectShape=(s,shape)=>regions.offset(shape,s.viewportX,s.viewportY);
  add('FillRgn',3,(handle,object,brush)=>paint(handle,object,brush));
  add('PaintRgn',2,(handle,object)=>paint(handle,object,dc(handle).brush));
  add('InvertRgn',2,(handle,object)=>paint(handle,object,0,true));
  return {select};
}

return {REGION_CONSTANTS,RegionStore,installRegions};
})();

/* gdi-bitmap.js */
__modules[2]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];

// All bitmap addresses are process-private. DIBs use Win32 BGR/BGRA scan lines,
// not Canvas RGBA. DDB scan lines are WORD aligned; DIBs are DWORD aligned.
const GDI_CONSTANTS=Object.freeze({BI_RGB:0,DIB_RGB_COLORS:0,CBM_INIT:4,
  SRCCOPY:0x00cc0020,SRCPAINT:0x00ee0086,SRCAND:0x008800c6,SRCINVERT:0x00660046,
  SRCERASE:0x00440328,NOTSRCCOPY:0x00330008,NOTSRCERASE:0x001100a6,
  MERGECOPY:0x00c000ca,MERGEPAINT:0x00bb0226,PATCOPY:0x00f00021,
  PATPAINT:0x00fb0a09,PATINVERT:0x005a0049,DSTINVERT:0x00550009,
  BLACKNESS:0x00000042,WHITENESS:0x00ff0062,COLORONCOLOR:3,
  AC_SRC_OVER:0,AC_SRC_ALPHA:1,OBJ_PEN:1,OBJ_BRUSH:2,OBJ_DC:3,OBJ_BITMAP:7,
  OBJ_MEMDC:10,MM_TEXT:1,NULLREGION:1,SIMPLEREGION:2,CLR_INVALID:0xffffffff});
const rops=new Set(Object.entries(GDI_CONSTANTS).filter(([k])=>['SRCCOPY','SRCPAINT','SRCAND','SRCINVERT','SRCERASE','NOTSRCCOPY','NOTSRCERASE','MERGECOPY','MERGEPAINT','PATCOPY','PATPAINT','PATINVERT','DSTINVERT','BLACKNESS','WHITENESS'].includes(k)).map(([,v])=>v));
const coord=value=>integer(value,-0x80000000,0x7fffffff);
function intersect(a,b){const r=[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];return r[2]<=r[0]||r[3]<=r[1]?[0,0,0,0]:r;}
function rgbBytes(color){color=unsigned(color);return [color&255,color>>>8&255,color>>>16&255,0];}
function rgbValue(data,i=0){return data[i]|data[i+1]<<8|data[i+2]<<16;}
function ropInfo(value){value=unsigned(value);if(!rops.has(value))throw new Win32Error('Unsupported raster operation or capture flags',50);const code=value>>>16&255;return {code,source:((code^(code>>>2))&0x33)!==0,pattern:((code^(code>>>4))&15)!==0};}
function applyROP(code,p,s,d){let out=0;for(let i=0;i<8;i++)if(code>>i&1)out|=(i&4?p:~p)&(i&2?s:~s)&(i&1?d:~d);return out&255;}

class BitmapStore {
  constructor(w,regions){this.regions=regions;this.w=w;this.m=w.memory;this.h=w.handles;this.maxPixels=integer(w.options.maxRasterPixels??Math.max(1,Math.min(4194304,Math.floor(w.memory.maxBytes/4))),1,16777216);}
  geometry(width,height,bpp,dib=false){width=integer(width,1,32767);height=integer(height,1,32767);if(![1,24,32].includes(bpp)||dib&&bpp===1)throw new Win32Error('Only 1-bit DDB and 24/32-bit BI_RGB bitmaps are supported',50);const unit=dib?32:16,stride=Math.ceil(width*bpp/unit)*unit/8,size=stride*height;if(size>this.m.maxBytes)throw new Win32Error('Bitmap exceeds process memory quota',8);return {width,height,bpp,stride,size};}
  header(pointer,usage=0){if(unsigned(usage)!==0)throw new Win32Error('Logical palettes are not supported',50);const v=this.m.view(pointer,40);if(v.getUint32(0,true)!==40)throw new Win32Error('Only BITMAPINFOHEADER is supported',50);const width=v.getInt32(4,true),signedHeight=v.getInt32(8,true),bpp=v.getUint16(14,true);if(v.getUint16(12,true)!==1||!signedHeight)throw new Win32Error('Invalid bitmap planes or height');if(v.getUint32(16,true)!==0||v.getUint32(32,true)!==0)throw new Win32Error('Only uncompressed true-color BI_RGB without a color table is supported',50);return {...this.geometry(width,Math.abs(signedHeight),bpp,true),topDown:signedHeight<0,dib:true};}
  create(width,height,bpp,{dib=false,topDown=true,bits=0,stock=false}={}){const g=this.geometry(width,height,bpp,dib);const input=bits?this.m.bytes(bits,g.size).slice():null;const ptr=this.m.alloc(g.size);this.m.block(ptr).owner='gdi-bitmap';try{if(input)this.m.bytes(ptr,g.size).set(input);return this.h.add('bitmap',{...g,ptr,dib,topDown,stock,dimensionX:0,dimensionY:0});}catch(error){this.m.free(ptr);throw error;}}
  get(handle){return this.h.get(handle,'bitmap');}
  data(bitmap){return this.m.bytes(bitmap.ptr,bitmap.size);}
  bytesFor(rect){const width=rect[2]-rect[0],height=rect[3]-rect[1];if(width<0||height<0||width*height>this.maxPixels)throw new Win32Error('Raster operation exceeds pixel quota',8);return {width,height,data:new Uint8ClampedArray(width*height*4)};}
  bounds(state){if(state.bitmap){const b=this.get(state.bitmap);return [0,0,b.width,b.height];}const d=state.window,r=d.getClientRect?.(),c=d.context?.canvas||d.node;return [0,0,integer(Math.ceil(r?.width??c?.width??c?.clientWidth??0),0,32767),integer(Math.ceil(r?.height??c?.height??c?.clientHeight??0),0,32767)];}
  clip(state,rect){const r=intersect(rect,this.bounds(state));if(!state.clip)return r;return this.regions.combine(this.regions.rectangle(...r),state.clip,1).bounds;}
  spans(state,y,left,right){return state.clip?this.regions.row(state.clip,y):[left,right];}
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
    dx+=dst.viewportX;dy+=dst.viewportY;if(src){sx+=src.viewportX;sy+=src.viewportY;}
    const rawDst=[Math.min(dx,dx+dw),Math.min(dy,dy+dh),Math.max(dx,dx+dw),Math.max(dy,dy+dh)],r=this.clip(dst,rawDst);
    const rawSrc=[Math.min(sx,sx+sw),Math.min(sy,sy+sh),Math.max(sx,sx+sw),Math.max(sy,sy+sh)];
    if(rop.source){if(!src)throw new Win32Error('Source device context required',6);const b=this.bounds(src);if(rawSrc[0]<0||rawSrc[1]<0||rawSrc[2]>b[2]||rawSrc[3]>b[3])throw new Win32Error('Source rectangle is outside its bitmap');if(blend&&(dst.bitmap?dst.bitmap===src.bitmap:dst.window===src.window)){const overlap=intersect(rawSrc,rawDst);if(overlap[2]>overlap[0])throw new Win32Error('Overlapping AlphaBlend rectangles');}}
    if(!dw||!dh||rop.source&&(!sw||!sh)||r[2]===r[0])return 1;
    const brush=this.h.get(dst.brush,'brush');if(rop.pattern&&brush.null)return 1;
    // Snapshot before writes: aliased source/destination is safe for every ROP.
    const source=rop.source?this.read(src,rawSrc):null,image=this.read(dst,r),pattern=rgbBytes(brush.color||0),mono=src?.bitmap&&this.get(src.bitmap).bpp===1;
    const fg=rgbBytes(dst.textColor),bg=rgbBytes(dst.backgroundColor),constant=(extra>>>16&255)/255,perPixel=extra>>>24===1;
    for(let y=0;y<image.height;y++){const spans=this.spans(dst,r[1]+y,r[0],r[2]);for(let span=0;span<spans.length;span+=2)for(let x=Math.max(r[0],spans[span])-r[0];x<Math.min(r[2],spans[span+1])-r[0];x++){
      const i=(y*image.width+x)*4;
      const ix=source?Math.min(source.width-1,Math.max(0,Math.floor(sx+((r[0]+x+.5-dx)/dw)*sw)-rawSrc[0])):0;
      const iy=source?Math.min(source.height-1,Math.max(0,Math.floor(sy+((r[1]+y+.5-dy)/dh)*sh)-rawSrc[1])):0;
      const si=source?(iy*source.width+ix)*4:0,s=mono?(source.data[si]?bg:fg):source?.data;
      const offset=mono?0:si;
      if(transparent&&rgbValue(s,offset)===(unsigned(extra)&0xffffff))continue;
      if(blend){const alpha=constant*(perPixel?s[offset+3]/255:1);for(let c=0;c<3;c++)image.data[i+c]=Math.min(255,Math.round(s[offset+c]*constant+image.data[i+c]*(1-alpha)));image.data[i+3]=Math.round(255*alpha+image.data[i+3]*(1-alpha));}
      else{for(let c=0;c<3;c++)image.data[i+c]=transparent?s[offset+c]:applyROP(rop.code,pattern[c],s?.[offset+c]||0,image.data[i+c]);image.data[i+3]=transparent||rop.code===0xcc?s[offset+3]:0;}
    }
    }this.write(dst,r,image);return 1;
  }
  pixel(state,x,y,color){x=coord(x)+state.viewportX;y=coord(y)+state.viewportY;const r=this.clip(state,[x,y,x+1,y+1]);if(!r[2])return 0xffffffff;const image=this.read(state,r);if(color===undefined)return rgbValue(image.data);image.data.set(rgbBytes(color));this.write(state,r,image);return state.bitmap&&this.get(state.bitmap).bpp===1?rgbValue(this.read(state,r).data):color&0xffffff;}
  // Integer software primitives for memory DCs. Font rasterization remains a
  // Canvas/host facility; no platform font metrics are fabricated in workers.
  primitive(state,operation,args,style){
    if(!['line','rect','ellipse'].includes(operation))throw new Win32Error('Software memory DC does not support this primitive',50);
    let [x1,y1,x2,y2]=args.map(coord);x1+=state.viewportX;x2+=state.viewportX;y1+=state.viewportY;y2+=state.viewportY;
    const width=style.pen.width||1,pad=operation==='line'?Math.ceil(width/2):0;
    const r=this.clip(state,[Math.min(x1,x2)-pad,Math.min(y1,y2)-pad,Math.max(x1,x2)+pad,Math.max(y1,y2)+pad]);if(!r[2])return;
    const image=this.read(state,r),pen=rgbBytes(style.pen.color||0),brush=rgbBytes(style.brush.color||0);
    const l=Math.min(x1,x2),t=Math.min(y1,y2),right=Math.max(x1,x2),bottom=Math.max(y1,y2),rx=(right-l)/2,ry=(bottom-t)/2;
    for(let y=0;y<image.height;y++){const spans=this.spans(state,r[1]+y,r[0],r[2]);for(let span=0;span<spans.length;span+=2)for(let x=Math.max(r[0],spans[span])-r[0];x<Math.min(r[2],spans[span+1])-r[0];x++){
      const px=r[0]+x,py=r[1]+y;let fill=false,stroke=false;
      if(operation==='rect'){fill=px>=l&&px<right&&py>=t&&py<bottom;stroke=fill&&(px<l+width||px>=right-width||py<t+width||py>=bottom-width);}
      else if(operation==='ellipse'){const nx=px+.5-l-rx,ny=py+.5-t-ry;fill=rx>0&&ry>0&&nx*nx/(rx*rx)+ny*ny/(ry*ry)<=1;stroke=fill&&(rx<=width||ry<=width||nx*nx/((rx-width)**2)+ny*ny/((ry-width)**2)>=1);}
      else {const dx=x2-x1,dy=y2-y1,len=dx*dx+dy*dy,u=len?((px-x1)*dx+(py-y1)*dy)/len:-1;stroke=u>=0&&u<1&&((px-x1-u*dx)**2+(py-y1-u*dy)**2)<=width*width/4;}
      if(stroke&&!style.pen.null)image.data.set(pen,(y*image.width+x)*4);else if(fill&&!style.brush.null)image.data.set(brush,(y*image.width+x)*4);
    }
    }this.write(state,r,image);
  }
}

return {GDI_CONSTANTS,coord,intersect,rgbBytes,rgbValue,ropInfo,BitmapStore};
})();

/* clipboard.js */
__modules[3]=(()=>{
const {Win32Error,unsigned}=__modules[0];

/** Synchronous, app-private clipboard. System clipboard synchronization is explicit. */
function installClipboard(w){
  const m=w.memory,h=w.handles;w.clipboard={open:false,owner:0,formats:new Map(),sequence:0};
  const c=w.clipboard,requireOpen=()=>{if(!c.open)throw new Win32Error('Clipboard is not open',1418);};
  const clear=()=>{for(const handle of c.formats.values()){if(h.has(handle,'memory')){const block=h.close(handle,'memory');m.free(block.ptr);}}c.formats.clear();};
  const add=(name,arity,fn)=>w.register('user32',name,fn,{arity,mode:'emulated',notes:'Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission.'});
  add('OpenClipboard',1,owner=>{if(owner)h.get(owner,'window');if(c.open)throw new Win32Error('Clipboard already open',5);c.open=true;c.pendingOwner=Number(owner);return 1;});
  add('CloseClipboard',0,()=>{requireOpen();c.open=false;return 1;});
  add('EmptyClipboard',0,()=>{requireOpen();clear();c.owner=c.pendingOwner;c.sequence++;return 1;});
  add('SetClipboardData',2,(format,handle)=>{requireOpen();format=unsigned(format);if(![1,13].includes(format))throw new Win32Error('Only text clipboard formats are implemented',50);if(!c.owner)throw new Win32Error('OpenClipboard needs a window owner before EmptyClipboard/SetClipboardData',5);const block=h.get(handle,'memory');if(block.prefix!=='Global'||block.clipboard||block.locks)throw new Win32Error('Clipboard requires unlocked moveable global memory',6);m.string(block.ptr,format===13);for(const old of new Set(c.formats.values())){const prior=h.close(old,'memory');m.free(prior.ptr);}c.formats.clear();block.clipboard=true;c.formats.set(format,Number(handle));c.sequence++;return handle;});
  const getData=format=>{requireOpen();format=unsigned(format);if(![1,13].includes(format))return 0;if(c.formats.has(format))return c.formats.get(format);const source=c.formats.entries().next().value;if(!source)return 0;const text=m.string(h.get(source[1],'memory').ptr,source[0]===13),p=m.allocString(text,format===13),handle=h.add('memory',{ptr:p,prefix:'Global',locks:0,clipboard:true});c.formats.set(format,handle);return handle;};
  add('GetClipboardData',1,getData);
  add('IsClipboardFormatAvailable',1,format=>[1,13].includes(Number(format))&&c.formats.size?1:0);
  add('CountClipboardFormats',0,()=>c.formats.size?2:0);
  add('EnumClipboardFormats',1,format=>{requireOpen();if(!c.formats.size)return 0;if(Number(format)===0)return 1;if(Number(format)===1)return 13;w.lastError=0;return 0;});
  add('GetClipboardOwner',0,()=>c.owner);
  add('GetOpenClipboardWindow',0,()=>c.open?c.pendingOwner:0);
  add('GetClipboardSequenceNumber',0,()=>c.sequence>>>0);
  w.getClipboardText=()=>{const first=c.formats.entries().next().value;return first?m.string(h.get(first[1],'memory').ptr,first[0]===13):'';};
  w.setClipboardText=text=>{if(c.open)throw new Win32Error('Clipboard already open',5);clear();if(text!==null){const ptr=m.allocString(String(text),true),handle=h.add('memory',{ptr,prefix:'Global',locks:0,clipboard:true});c.formats.set(13,handle);}c.sequence++;};
  // No automatic reads, writes, or permission prompts. Call from a user gesture.
  w.readSystemClipboard=async()=>{if(!w.options.allowClipboard||!w.options.clipboard?.readText)throw new Win32Error('System clipboard access is not enabled',5);const text=await w.options.clipboard.readText();if(w.disposed)throw new Win32Error('Disposed',995);w.setClipboardText(text);return text;};
  w.writeSystemClipboard=async()=>{if(!w.options.allowClipboard||!w.options.clipboard?.writeText)throw new Win32Error('System clipboard access is not enabled',5);return w.options.clipboard.writeText(w.getClipboardText());};
}

return {installClipboard};
})();

/* kernel32.js */
__modules[4]=(()=>{
const {ERROR,Win32Error,integer,unsigned}=__modules[0];

function installKernel32(w){
  const m=w.memory,h=w.handles,fs=w.fs;
  const add=(name,arity,fn,options={})=>w.register('kernel32',name,fn,{arity,...options});
  const aw=(name,arity,fn,options={})=>{for(const wide of [false,true])add(name+(wide?'W':'A'),arity,(...args)=>fn(wide,...args),options);};
  const text=(p,wide)=>m.string(p,wide);
  add('GetLastError',0,()=>w.lastError);
  add('SetLastError',1,n=>{w.lastError=unsigned(n);});
  add('GetTickCount',0,()=>Math.floor(w.clock()-w.epoch)>>>0,{mode:'browser',notes:'Elapsed milliseconds since this compatibility process was created, not host OS boot.'});
  add('GetTickCount64',0,()=>Math.floor(w.clock()-w.epoch),{mode:'browser',notes:'JavaScript number; exact within the safe integer range.'});
  add('QueryPerformanceFrequency',1,p=>{m.view(p,8).setBigInt64(0,1000000n,true);return 1;});
  add('QueryPerformanceCounter',1,p=>{m.view(p,8).setBigInt64(0,BigInt(Math.floor((w.clock()-w.epoch)*1000)),true);return 1;},{mode:'browser',notes:'Microsecond units; precision is limited by browser timer policy.'});
  add('Sleep',1,ms=>w.sleep(unsigned(ms)),{mode:'browser',notes:'Asynchronous cooperative delay; does not block the UI thread.'});
  add('MulDiv',3,(a,b,c)=>{a=integer(a,-2147483648,2147483647);b=integer(b,-2147483648,2147483647);c=integer(c,-2147483648,2147483647);if(!c)return -1;let v=BigInt(a)*BigInt(b),d=BigInt(c),sign=(v<0n)!==(d<0n)?-1n:1n;v=v<0n?-v:v;d=d<0n?-d:d;const n=sign*((v+d/2n)/d);return n < -2147483648n||n>2147483647n?-1:Number(n);},{failure:-1});
  for(const utc of [false,true])add(utc?'GetSystemTime':'GetLocalTime',1,p=>{const d=w.now(),prefix=utc?'getUTC':'get',v=m.view(p,16),values=[d[prefix+'FullYear'](),d[prefix+'Month']()+1,d[prefix+'Day'](),d[prefix+'Date'](),d[prefix+'Hours'](),d[prefix+'Minutes'](),d[prefix+'Seconds'](),d[prefix+'Milliseconds']()];values.forEach((n,i)=>v.setUint16(i*2,n,true));});
  add('GetSystemTimeAsFileTime',1,p=>m.view(p,8).setBigUint64(0,(BigInt(w.now().getTime())+11644473600000n)*10000n,true));
  for(const name of ['RtlMoveMemory','CopyMemory','MoveMemory'])add(name,3,(dst,src,n)=>{n=integer(n,0,m.maxBytes);if(n)m.bytes(dst,n).set(m.bytes(src,n).slice());});
  for(const name of ['RtlZeroMemory','ZeroMemory'])add(name,2,(dst,n)=>{if(n)m.bytes(dst,integer(n,0,m.maxBytes)).fill(0);});
  for(const name of ['RtlFillMemory','FillMemory'])add(name,3,(dst,n,value)=>{if(n)m.bytes(dst,integer(n,0,m.maxBytes)).fill(unsigned(value)&255);});
  for(const prefix of ['Global','Local']){
    add(prefix+'Alloc',2,(flags,n)=>{flags=unsigned(flags);if(flags&~0x42)throw new Win32Error('Unsupported allocation flags',50);const ptr=m.alloc(n),value={ptr,locks:0,prefix};if(!(flags&2))return ptr;try{return h.add('memory',value);}catch(error){m.free(ptr);throw error;}});
    add(prefix+'Lock',1,handle=>{if(h.has(handle,'memory')){const a=h.get(handle,'memory');a.locks++;return a.ptr;}m.block(handle);return unsigned(handle);});
    add(prefix+'Unlock',1,handle=>{if(!h.has(handle,'memory')){m.block(handle);w.lastError=0;return 0;}const a=h.get(handle,'memory');if(!a.locks){w.lastError=158;return 0;}a.locks--;w.lastError=0;return a.locks?1:0;});
    add(prefix+'Size',1,handle=>m.size(h.has(handle,'memory')?h.get(handle,'memory').ptr:handle));
    add(prefix+'Free',1,handle=>{if(!handle)return 0;const a=h.has(handle,'memory')?h.get(handle,'memory'):null;if(a?.clipboard){w.lastError=5;return handle;}if(a&&a.locks){w.lastError=158;return handle;}if(m.block(a?a.ptr:handle).owner==='gdi-bitmap'){w.lastError=5;return handle;}m.free(a?a.ptr:handle);if(a)h.close(handle,'memory');return 0;},{failure:args=>args[0]});
  }
  aw('lstrlen',1,(wide,p)=>m.stringBytes(text(p,wide),wide).length/(wide?2:1));
  aw('lstrcpyn',3,(wide,dst,src,n)=>{m.putString(dst,text(src,wide),n,wide);return dst;});
  aw('lstrcpy',2,(wide,dst,src)=>{const s=text(src,wide);m.putString(dst,s,m.stringBytes(s,wide).length/(wide?2:1)+1,wide);return dst;});
  const envName=p=>text(p,false).toUpperCase();
  aw('GetEnvironmentVariable',3,(wide,name,out,size)=>{const key=text(name,wide).toUpperCase();if(!w.environment.has(key)){w.lastError=203;return 0;}const s=w.environment.get(key),n=m.stringBytes(s,wide).length/(wide?2:1);if(unsigned(size)<=n)return n+1;m.putString(out,s,size,wide);return n;});
  aw('SetEnvironmentVariable',2,(wide,name,value)=>{const key=text(name,wide).toUpperCase();if(!key||key.includes('='))throw new Win32Error('Invalid environment variable');if(!value)w.environment.delete(key);else w.environment.set(key,text(value,wide));return 1;});
  aw('GetCurrentDirectory',2,(wide,size,out)=>{const s='C:'+fs.cwd.replace(/\//g,'\\'),n=m.stringBytes(s,wide).length/(wide?2:1);if(unsigned(size)<=n)return n+1;m.putString(out,s,size,wide);return n;});
  aw('SetCurrentDirectory',1,(wide,p)=>{const path=fs.normalize(text(p,wide));if(!fs.directories.has(path))throw new Win32Error('Directory not found',3);fs.cwd=path;return 1;});
  aw('GetTempPath',2,(wide,size,out)=>{const s='C:\\Temp\\';if(unsigned(size)<=s.length)return s.length+1;m.putString(out,s,size,wide);return s.length;},{notes:'Path is in the application-private virtual filesystem.'});
  const openFiles=()=>[...h.entries.values()].filter(e=>e.type==='file').map(e=>e.value);
  const pathOf=(p,wide)=>{const raw=text(p,wide);if(/^(?:\\\\|\/\/)/.test(raw)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.:]|$)/i.test(raw.split(/[\\/]/).at(-1)))throw new Win32Error('Devices and UNC paths are not supported',50);return fs.normalize(raw);};
  const ensureParent=path=>{const parent=path.slice(0,path.lastIndexOf('/'))||'/';if(!fs.directories.has(parent))throw new Win32Error('Parent directory not found',3);};
  const assertMutable=path=>{if(openFiles().some(f=>f.path===path))throw new Win32Error('File is open',32);};
  aw('CreateFile',7,(wide,p,access,share,security,disposition,flags,template)=>{
    const path=pathOf(p,wide);access=unsigned(access);share=unsigned(share);flags=unsigned(flags);integer(disposition,1,5);
    if(security||template||flags&~0x80||share&~3||access&~0xc0000000)throw new Win32Error('Only synchronous ordinary files and read/write sharing are supported',50);
    if(fs.directories.has(path))throw new Win32Error('Cannot open directory as a file',5);ensureParent(path);
    const read=!!(access&0x80000000),write=!!(access&0x40000000),exists=fs.exists(path);
    if(openFiles().some(f=>f.path===path&&((read&&!(f.share&1))||(write&&!(f.share&2))||(f.read&&!(share&1))||(f.write&&!(share&2)))))throw new Win32Error('Sharing violation',32);
    if(disposition===1&&exists)throw new Win32Error('File exists',80);
    if((disposition===3||disposition===5)&&!exists)throw new Win32Error('File not found',2);
    if(disposition===5&&!write)throw new Win32Error('Write access required',5);
    const handle=h.add('file',{path,read,write,share,position:0});
    try{if(!exists||disposition===2||disposition===5)fs.writeBytes(path,[]);}catch(error){h.close(handle,'file');throw error;}
    if(disposition===2||disposition===4)w.lastError=exists?183:0;return handle;
  },{failure:-1,notes:'Synchronous app-private disk. No device paths, native disk, overlapped I/O, or security descriptors.'});
  add('CloseHandle',1,handle=>{h.close(handle,'file');return 1;});
  add('ReadFile',5,(handle,out,n,read,overlapped)=>{if(overlapped)throw new Win32Error('Overlapped I/O is not supported',50);n=integer(n,0,m.maxBytes);const f=h.get(handle,'file');if(!f.read)throw new Win32Error('Read access denied',5);m.writeU32(read,0);if(!n)return 1;const dest=m.bytes(out,n);const b=fs.readBytes(f.path).subarray(f.position,f.position+n);dest.set(b);f.position+=b.length;m.writeU32(read,b.length);return 1;});
  add('WriteFile',5,(handle,input,n,written,overlapped)=>{if(overlapped)throw new Win32Error('Overlapped I/O is not supported',50);n=integer(n,0,m.maxBytes);const f=h.get(handle,'file');if(!f.write)throw new Win32Error('Write access denied',5);m.writeU32(written,0);if(!n)return 1;const src=m.bytes(input,n).slice();const old=fs.readBytes(f.path),end=f.position+n;if(end>w.maxFileBytes)throw new Win32Error('File quota exceeded',8);const b=new Uint8Array(Math.max(old.length,end));b.set(old);b.set(src,f.position);fs.writeBytes(f.path,b);f.position=end;m.writeU32(written,n);return 1;});
  add('GetFileSize',2,(handle,high)=>{const n=fs.readBytes(h.get(handle,'file').path).length;if(high)m.writeU32(high,0);return n;},{failure:0xffffffff});
  add('SetFilePointer',4,(handle,low,high,method)=>{const f=h.get(handle,'file');integer(method,0,2);let offset=BigInt(integer(low,-2147483648,2147483647));if(high)offset=BigInt(m.readI32(high))*0x100000000n+BigInt(unsigned(low));const base=method===0?0:method===1?f.position:fs.readBytes(f.path).length;const next=BigInt(base)+offset;if(next<0||next>BigInt(w.maxFileBytes))throw new Win32Error('Invalid file position');if(high)m.writeU32(high,0);f.position=Number(next);w.lastError=0;return f.position;},{failure:0xffffffff});
  add('SetEndOfFile',1,handle=>{const f=h.get(handle,'file');if(!f.write)throw new Win32Error('Write access denied',5);const b=new Uint8Array(f.position);b.set(fs.readBytes(f.path).subarray(0,f.position));fs.writeBytes(f.path,b);return 1;});
  aw('DeleteFile',1,(wide,p)=>{const path=pathOf(p,wide);assertMutable(path);fs.remove(path);return 1;});
  aw('CopyFile',3,(wide,a,b,fail)=>{a=pathOf(a,wide);b=pathOf(b,wide);if(a===b)throw new Win32Error('Source and destination are identical',87);ensureParent(b);if(fail&&fs.exists(b))throw new Win32Error('File exists',80);assertMutable(a);assertMutable(b);fs.writeBytes(b,fs.readBytes(a));return 1;});
  aw('MoveFile',2,(wide,a,b)=>{a=pathOf(a,wide);b=pathOf(b,wide);if(fs.exists(b))throw new Win32Error('File exists',183);ensureParent(b);assertMutable(a);assertMutable(b);const bytes=fs.readBytes(a);fs.writeBytes(b,bytes);fs.remove(a);return 1;});
  aw('GetFileAttributes',1,(wide,p)=>{const path=pathOf(p,wide);if(fs.directories.has(path))return 16;if(fs.exists(path))return 128;throw new Win32Error('File not found',2);},{failure:0xffffffff});
  aw('CreateDirectory',2,(wide,p,security)=>{if(security)throw new Win32Error('Security descriptors are not supported',50);const path=pathOf(p,wide);ensureParent(path);if(fs.exists(path)||fs.directories.has(path))throw new Win32Error('Already exists',183);fs.directories.add(path);fs.dirty=true;return 1;});
  aw('RemoveDirectory',1,(wide,p)=>{const path=pathOf(p,wide);if(!fs.directories.has(path))throw new Win32Error('Directory not found',3);if(path==='/'||path===fs.cwd)throw new Win32Error('Directory in use',5);if([...fs.files.keys(),...fs.directories].some(x=>x.startsWith(path+'/')))throw new Win32Error('Directory not empty',145);fs.directories.delete(path);fs.dirty=true;return 1;});
  installProfiles(w,aw);
  w.register('winmm','timeGetTime',()=>Math.floor(w.clock()-w.epoch)>>>0,{arity:0,mode:'browser',notes:'Process-relative monotonic browser time.'});
}

function installProfiles(w,aw){
  const m=w.memory,fs=w.fs,ci=s=>String(s).trim().toLowerCase();
  function path(p,wide){const s=m.string(p,wide);return fs.normalize(s.includes('\\')||s.includes('/')||s.includes(':')?s:'/Windows/'+s);}
  function read(p,wide){const file=path(p,wide);if(!fs.exists(file)){w.lastError=2;return {file,lines:[],sections:new Map()};}const b=fs.readBytes(file);const str=b[0]===255&&b[1]===254?m.decode(b.subarray(2),true):m.decode(b);const lines=str.replace(/^\uFEFF/,'').split(/\r?\n/),sections=new Map();let current=null;
    lines.forEach((line,i)=>{const s=line.trim(),match=/^\[([^\]]+)\]/.exec(s);if(match){const key=ci(match[1]);if(!sections.has(key))sections.set(key,{name:match[1],start:i,keys:new Map()});current=sections.get(key);}else if(current&&s&&!/^[;#]/.test(s)){const eq=s.indexOf('=');if(eq>=0){const name=s.slice(0,eq).trim(),key=ci(name);if(!current.keys.has(key))current.keys.set(key,{name,value:s.slice(eq+1).trim(),line:i});}}});return {file,lines,sections};}
  aw('GetPrivateProfileString',6,(wide,app,key,def,out,n,file)=>{const doc=read(file,wide),section=doc.sections.get(ci(m.string(app,wide)));if(!app||!key){const names=!app?[...doc.sections.values()].map(s=>s.name):[...(section?.keys.values()||[])].map(k=>k.name);const value=names.length?names.join('\0')+'\0':'';return m.putString(out,value,n,wide,true);}const entry=section?.keys.get(ci(m.string(key,wide)));let value=entry?.value??m.string(def,wide).replace(/ +$/,'');if(entry&&value.length>=2&&(['"',"'"].includes(value[0]))&&value.at(-1)===value[0])value=value.slice(1,-1);return m.putString(out,value,n,wide);});
  aw('GetPrivateProfileInt',4,(wide,app,key,def,file)=>{const doc=read(file,wide),entry=doc.sections.get(ci(m.string(app,wide)))?.keys.get(ci(m.string(key,wide)));if(!entry)return unsigned(def);const n=parseInt(entry.value,10);return (Number.isNaN(n)?0:n)>>>0;});
  aw('WritePrivateProfileString',4,(wide,app,key,value,file)=>{if(!app&&!key&&!value)return 1;if(!app)throw new Win32Error('Section required');const doc=read(file,wide),name=m.string(app,wide),k=m.string(key,wide),s=doc.sections.get(ci(name)),entry=s?.keys.get(ci(k));if(/[\r\n\[\]]/.test(name)||/[\r\n=]/.test(k)||/[\r\n]/.test(m.string(value,wide)))throw new Win32Error('Invalid INI field');
    let lines=doc.lines;if(!key){if(s){let end=lines.length;for(let i=s.start+1;i<lines.length;i++)if(/^\s*\[/.test(lines[i])){end=i;break;}lines.splice(s.start,end-s.start);}}
    else if(!value){if(entry)lines.splice(entry.line,1);}
    else if(entry)lines[entry.line]=entry.name+'='+m.string(value,wide);
    else if(s){let end=lines.length;for(let i=s.start+1;i<lines.length;i++)if(/^\s*\[/.test(lines[i])){end=i;break;}lines.splice(end,0,k+'='+m.string(value,wide));}
    else lines.push('['+name+']',k+'='+m.string(value,wide));
    const str=lines.join('\r\n');const old=fs.exists(doc.file)?fs.readBytes(doc.file):[];const unicode=old[0]===255&&old[1]===254;const b=m.stringBytes(str,unicode);if(unicode){const bytes=new Uint8Array(b.length+2);bytes.set([255,254]);bytes.set(b,2);fs.writeBytes(doc.file,bytes);}else fs.writeBytes(doc.file,b);return 1;
  },{notes:'Project-private INI files. Preserves unrelated lines; does not implement Windows registry IniFileMapping.'});
}

return {installKernel32};
})();

/* user32.js */
__modules[5]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];

/** Registered windows only: never queries or controls unrelated page DOM. */
function installUser32(w){
  const m=w.memory,h=w.handles;
  const add=(name,arity,fn,options={})=>w.register('user32',name,fn,{arity,mode:'browser',...options});
  const aw=(name,arity,fn,options={})=>{for(const wide of [false,true])add(name+(wide?'W':'A'),arity,(...args)=>fn(wide,...args),options);};
  const win=handle=>{if(!h.has(handle,'window'))throw new Win32Error('Invalid window handle',1400);return h.get(handle,'window');};
  const parent=entry=>Number(typeof entry.parent==='function'?entry.parent():entry.parent??0);
  const rect=entry=>{const r=entry.getRect?.()??entry.node?.getBoundingClientRect?.();if(!r)throw new Win32Error('Window has no geometry',50);return [r.left,r.top,r.right??r.left+r.width,r.bottom??r.top+r.height].map(Math.round);};
  const client=entry=>{const r=entry.getClientRect?.();if(r)return [r.left??0,r.top??0,r.right??r.width,r.bottom??r.height].map(Math.round);const n=entry.input||entry.node;return [0,0,n?.clientWidth||0,n?.clientHeight||0];};
  const writeRect=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));return 1;};
  const getText=entry=>String(entry.getText?.()??entry.input?.value??entry.node?.textContent??'');
  const setText=(entry,s)=>{if(entry.setText)entry.setText(s);else if(entry.input)entry.input.value=s;else if(entry.node)entry.node.textContent=s;else throw new Win32Error('Window text is not writable',50);return 1;};
  const visible=entry=>entry.isVisible?!!entry.isVisible():!entry.node?.hidden;
  const enabled=entry=>entry.isEnabled?!!entry.isEnabled():!entry.input?.disabled;
  add('IsWindow',1,handle=>h.has(handle,'window')?1:0);
  add('IsWindowVisible',1,handle=>{let entry=win(handle),seen=new Set();while(entry){if(seen.has(entry)||!visible(entry))return 0;seen.add(entry);const p=parent(entry);entry=p?win(p):null;}return 1;});
  add('IsWindowEnabled',1,handle=>enabled(win(handle))?1:0);
  add('EnableWindow',2,(handle,on)=>{const entry=win(handle),wasDisabled=!enabled(entry);if(entry.setEnabled)entry.setEnabled(!!on);else if(entry.input)entry.input.disabled=!on;else throw new Win32Error('Window enabled state is not writable',50);return wasDisabled?1:0;});
  add('ShowWindow',2,(handle,command)=>{const entry=win(handle);command=integer(command,0,11);const was=visible(entry);if(entry.show)entry.show(command);else if([0,1,5,8,9].includes(command)&&entry.node)entry.node.hidden=command===0;else throw new Win32Error('Show command needs a window adapter',50);return was?1:0;});
  aw('GetWindowText',3,(wide,handle,out,n)=>m.putString(out,getText(win(handle)),n,wide));
  aw('SetWindowText',2,(wide,handle,p)=>setText(win(handle),m.string(p,wide)));
  aw('GetWindowTextLength',1,(wide,handle)=>m.stringBytes(getText(win(handle)),wide).length/(wide?2:1));
  aw('GetClassName',3,(wide,handle,out,n)=>m.putString(out,win(handle).className||'Window',n,wide));
  const find=(wide,parentHandle,after,klass,title,topOnly)=>{if(parentHandle)win(parentHandle);if(after)win(after);let passed=!after;for(const [id,e]of h.entries){if(e.type!=='window')continue;if(!passed){if(id===Number(after))passed=true;continue;}const entry=e.value,p=parent(entry);if(topOnly?p!==0:p!==Number(parentHandle))continue;if(klass&&String(entry.className||'Window').toLowerCase()!==m.string(klass,wide).toLowerCase())continue;if(title&&getText(entry).toLowerCase()!==m.string(title,wide).toLowerCase())continue;return id;}return 0;};
  aw('FindWindow',2,(wide,klass,title)=>find(wide,0,0,klass,title,true));
  aw('FindWindowEx',4,(wide,p,after,klass,title)=>find(wide,p,after,klass,title,false));
  add('GetParent',1,handle=>parent(win(handle)));
  add('IsChild',2,(ancestor,handle)=>{win(ancestor);let p=parent(win(handle)),seen=new Set();while(p&&!seen.has(p)){if(p===Number(ancestor))return 1;seen.add(p);p=parent(win(p));}return 0;});
  add('GetDlgCtrlID',1,handle=>win(handle).controlId||0);
  add('GetDlgItem',2,(handle,id)=>{win(handle);for(const [key,e]of h.entries)if(e.type==='window'&&parent(e.value)===Number(handle)&&e.value.controlId===Number(id))return key;return 0;});
  add('GetWindowRect',2,(handle,p)=>writeRect(p,rect(win(handle))));
  add('GetClientRect',2,(handle,p)=>writeRect(p,client(win(handle))));
  for(const screen of [false,true])add(screen?'ClientToScreen':'ScreenToClient',2,(handle,p)=>{const entry=win(handle),origin=entry.clientOrigin?.()||rect(entry).slice(0,2),v=m.view(p,8),sign=screen?1:-1;v.setInt32(0,v.getInt32(0,true)+origin[0]*sign,true);v.setInt32(4,v.getInt32(4,true)+origin[1]*sign,true);return 1;});
  const move=(entry,x,y,width,height,repaint)=>{for(const n of [x,y,width,height])integer(n,-2147483648,2147483647);if(width<0||height<0)throw new Win32Error('Negative window size');if(entry.move)entry.move(x,y,width,height,!!repaint);else if(entry.node)Object.assign(entry.node.style,{position:'absolute',left:x+'px',top:y+'px',width:width+'px',height:height+'px'});else throw new Win32Error('Window cannot move',50);return 1;};
  add('MoveWindow',6,(handle,x,y,width,height,repaint)=>move(win(handle),x,y,width,height,repaint));
  add('SetWindowPos',7,(handle,after,x,y,width,height,flags)=>{const entry=win(handle);flags=unsigned(flags);if(flags&~0xdf)throw new Win32Error('Unsupported positioning flags',50);if(!(flags&4)&&![0,1,-1,-2,0xffffffff,0xfffffffe].includes(Number(after)))throw new Win32Error('Arbitrary sibling ordering is not supported',50);const r=entry.getPosition?.()||rect(entry);if(flags&2){x=r[0];y=r[1];}if(flags&1){width=r[2]-r[0];height=r[3]-r[1];}move(entry,x,y,width,height,!(flags&8));if(!(flags&4)&&entry.node)entry.node.style.zIndex=[-1,0xffffffff].includes(Number(after))?'10000':Number(after)===1?'0':'';if(flags&0x40)w.invoke('user32','ShowWindow',[handle,5]);if(flags&0x80)w.invoke('user32','ShowWindow',[handle,0]);return 1;},{notes:'App-local position and CSS stacking; no desktop topmost guarantee.'});
  add('GetFocus',0,()=>{for(const [id,e]of h.entries)if(e.type==='window'){const n=e.value.input||e.value.node;if(n&&n.ownerDocument?.activeElement===n)return id;}return 0;});
  add('SetFocus',1,handle=>{const prior=w.invoke('user32','GetFocus',[]);if(!handle){for(const e of h.entries.values())if(e.type==='window')e.value.input?.blur?.();return prior;}const entry=win(handle);if(!enabled(entry))throw new Win32Error('Window is disabled',5);const node=entry.input||entry.node;if(!node?.focus)throw new Win32Error('Focus not supported',50);node.focus();return prior;});
  add('GetForegroundWindow',0,()=>{let handle=w.invoke('user32','GetFocus',[]);while(handle&&parent(win(handle)))handle=parent(win(handle));return handle;});
  add('SetForegroundWindow',1,handle=>{const entry=win(handle);if(entry.activate)entry.activate();else (entry.input||entry.node)?.focus?.();return 1;},{notes:'Activates only an app-local window, not the OS browser window.'});
  aw('GetWindowLong',2,(wide,handle,index)=>{const e=win(handle);if(![-16,-20,-21,-12].includes(Number(index)))throw new Win32Error('Window procedure/instance addresses are unavailable',50);if([-16,-20].includes(Number(index))&&!e.longs?.has(Number(index)))throw new Win32Error('Window style values need an explicit adapter',50);return Number(index)===-12?e.controlId||0:(e.longs?.get(Number(index))||0);});
  aw('SetWindowLong',3,(wide,handle,index,value)=>{const e=win(handle);if(![-21,-12].includes(Number(index)))throw new Win32Error('Only user data and control IDs are writable; subclassing is unsupported',50);const old=Number(index)===-12?e.controlId||0:e.longs?.get(Number(index))||0;if(Number(index)===-12)e.controlId=Number(value);else{e.longs||=new Map();e.longs.set(Number(index),Number(value)|0);}w.lastError=0;return old;});
  add('GetSystemMetrics',1,index=>{const view=w.options.window||globalThis.window;const metrics={0:view?.innerWidth??1024,1:view?.innerHeight??768,5:1,6:1,16:view?.innerWidth??1024,17:view?.innerHeight??768,19:1,43:3,78:view?.innerWidth??1024,79:view?.innerHeight??768,80:1};if(!(index in metrics))throw new Win32Error('System metric is not implemented',50);return metrics[index];},{notes:'CSS-pixel app viewport metrics, not physical desktop measurements.'});
  aw('MessageBox',4,(wide,handle,message,title,type)=>{if(handle)win(handle);if(!w.options.messageBox)throw new Win32Error('Message box adapter unavailable',50);return w.options.messageBox(m.string(message,wide),unsigned(type),m.string(title,wide));});
  aw('SendMessage',4,async(wide,handle,msg,wp,lp)=>{
    const e=win(handle);msg=unsigned(msg);
    if(msg===12)return setText(e,m.string(lp,wide));
    if(msg===13)return m.putString(lp,getText(e),wp,wide);
    if(msg===14)return m.stringBytes(getText(e),wide).length/(wide?2:1);
    if(msg===0xb0){const start=e.input?.selectionStart??0,end=e.input?.selectionEnd??0;if(wp)m.writeU32(wp,start);if(lp)m.writeU32(lp,end);return start>65535||end>65535?-1:(end<<16)|start;}
    if(msg===0xb1){if(!e.input?.setSelectionRange)throw new Win32Error('Not an edit control',50);let start=Number(wp)|0,end=Number(lp)|0;if(start===-1)start=end=e.input.selectionEnd??0;else if(end===-1)end=getText(e).length;e.input.setSelectionRange(start,end);return 0;}
    if(msg===0xc2){if(!e.input?.setSelectionRange)throw new Win32Error('Not an edit control',50);const value=getText(e),start=e.input.selectionStart??0,end=e.input.selectionEnd??0,replacement=m.string(lp,wide);setText(e,value.slice(0,start)+replacement+value.slice(end));e.input.setSelectionRange(start+replacement.length,start+replacement.length);return 0;}
    if(msg===0xf0){if(!e.getCheck)throw new Win32Error('Not a checkable button',50);return e.getCheck();}
    if(msg===0xf1){if(!e.setCheck)throw new Win32Error('Not a checkable button',50);e.setCheck(integer(wp,0,2));return 0;}
    if(msg===0xf5){if(e.click)await e.click();else if(e.input?.click)e.input.click();else throw new Win32Error('Not a button',50);return 0;}
    if(e.message){const result=await e.message(msg,wp,lp,wide);if(result!==undefined)return result;}
    throw new Win32Error('Window message '+msg+' is not implemented',50);
  },{notes:'WM text, edit selection/replacement and button check/click messages; unknown messages fail explicitly.'});
  add('EnumWindows',2,async(callback,data)=>{const fn=h.get(callback,'callback');for(const [id,e]of [...h.entries])if(e.type==='window'&&!parent(e.value)&&h.has(id,'window'))if(!await fn(id,data))return 0;return 1;});
  add('SetTimer',4,(handle,id,ms,callback)=>{if(handle)win(handle);if(!callback)throw new Win32Error('WM_TIMER message queue is not implemented; supply a callback',50);h.get(callback,'callback');id=handle&&id?unsigned(id):w.nextTimer++;const key=handle+':'+id;if(w.timers.has(key))clearInterval(w.timers.get(key).timer);if(w.timers.size>=1024)throw new Win32Error('Timer quota exceeded',8);const state={handle,id,callback,busy:false,timer:null};state.timer=setInterval(async()=>{if(state.busy||w.disposed)return;state.busy=true;try{await (w.timerCallbacks.get(callback)||h.get(callback,'callback'))(handle,0x113,id,Math.floor(w.clock()-w.epoch)>>>0);}catch(error){w.options.onError?.(error);}finally{state.busy=false;}},Math.max(10,Math.min(unsigned(ms),0x7fffffff)));w.timers.set(key,state);return id;},{notes:'Browser timers are throttled in background tabs; callbacks are coalesced.'});
  add('KillTimer',2,(handle,id)=>{const key=handle+':'+unsigned(id),state=w.timers.get(key);if(!state)return 0;clearInterval(state.timer);w.timers.delete(key);return 1;});
  installRectangles(w,add);
}
function installRectangles(w,add){
  const m=w.memory,read=p=>{const v=m.view(p,16);return [0,4,8,12].map(i=>v.getInt32(i,true));},write=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));return 1;},empty=r=>r[0]>=r[2]||r[1]>=r[3];
  add('SetRect',5,(p,l,t,r,b)=>write(p,[l,t,r,b]),{mode:'emulated'});
  add('SetRectEmpty',1,p=>write(p,[0,0,0,0]),{mode:'emulated'});
  add('CopyRect',2,(a,b)=>write(a,read(b)),{mode:'emulated'});
  add('OffsetRect',3,(p,x,y)=>write(p,read(p).map((v,i)=>v+Number(i%2?y:x))),{mode:'emulated'});
  add('InflateRect',3,(p,x,y)=>write(p,read(p).map((v,i)=>v+Number(i%2?y:x)*(i<2?-1:1))),{mode:'emulated'});
  add('IsRectEmpty',1,p=>empty(read(p))?1:0,{mode:'emulated'});
  add('EqualRect',2,(a,b)=>{const x=read(a),y=read(b);return x.every((v,i)=>v===y[i])?1:0;},{mode:'emulated'});
  add('PtInRect',3,(p,x,y)=>{const r=read(p);return x>=r[0]&&x<r[2]&&y>=r[1]&&y<r[3]?1:0;},{mode:'emulated',notes:'POINT is passed by value as two 32-bit arguments.'});
  add('IntersectRect',3,(p,a,b)=>{const x=read(a),y=read(b),r=[Math.max(x[0],y[0]),Math.max(x[1],y[1]),Math.min(x[2],y[2]),Math.min(x[3],y[3])],none=empty(r);write(p,none?[0,0,0,0]:r);return none?0:1;},{mode:'emulated'});
  add('UnionRect',3,(p,a,b)=>{const x=read(a),y=read(b),r=empty(x)?y:empty(y)?x:[Math.min(x[0],y[0]),Math.min(x[1],y[1]),Math.max(x[2],y[2]),Math.max(x[3],y[3])],none=empty(r);write(p,none?[0,0,0,0]:r);return none?0:1;},{mode:'emulated'});
}

return {installUser32};
})();

/* advapi32.js */
__modules[6]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];

/** App-private registry: no machine registry is read or modified. */
function installRegistry(w){
  const m=w.memory,h=w.handles,roots=new Map([[0x80000000,'HKCR'],[0x80000001,'HKCU'],[0x80000002,'HKLM'],[0x80000003,'HKU'],[0x80000005,'HKCC']]);
  const store=w.registry=new Map([...roots.values()].map(name=>[name,{name,values:new Map()}]));
  const allowed=0xf003f; // KEY_ALL_ACCESS excluding WOW64 view selectors.
  const keyOf=(handle,access=0)=>{handle=unsigned(handle);if(roots.has(handle))return roots.get(handle);const e=h.get(handle,'registry');if((e.access&access)!==access)throw new Win32Error('Registry handle access denied',5);if(!store.has(e.path))throw new Win32Error('Registry key was deleted',1018);return e.path;};
  const sub=(base,name)=>{const parts=String(name).replace(/\//g,'\\').split('\\').filter(Boolean);if(parts.some(p=>p==='.'||p==='..'))throw new Win32Error('Invalid registry key');return base+(parts.length?'\\'+parts.join('\\').toLowerCase():'');};
  const save=()=>w.options.onRegistryChange?.(w.registrySnapshot());
  const add=(name,arity,fn)=>w.register('advapi32',name,fn,{arity,statusError:true,mode:'emulated',notes:'Isolated application registry, not the operating-system registry.'});
  const aw=(name,arity,fn)=>{for(const wide of [false,true])add(name+(wide?'W':'A'),arity,(...a)=>fn(wide,...a));};
  const accessOf=access=>{access=unsigned(access);if(access&~allowed)throw new Win32Error('Unsupported registry access flags',50);return access;};
  aw('RegCreateKeyEx',9,(wide,root,name,reserved,klass,options,access,security,result,disposition)=>{if(reserved||klass||options||security)throw new Win32Error('Registry security/classes/options are not supported',50);access=accessOf(access);m.view(result,4);if(disposition)m.view(disposition,4);const base=keyOf(root,4),path=sub(base,m.string(name,wide)),existed=store.has(path),parts=path.split('\\');for(let i=1;i<=parts.length;i++){const p=parts.slice(0,i).join('\\');if(!store.has(p))store.set(p,{name:parts[i-1],values:new Map()});}const handle=h.add('registry',{path,access});m.writeU32(result,handle);if(disposition)m.writeU32(disposition,existed?2:1);save();return 0;});
  aw('RegOpenKeyEx',5,(wide,root,name,options,access,result)=>{if(options)throw new Win32Error('Registry options unsupported',50);access=accessOf(access);m.view(result,4);const path=sub(keyOf(root),m.string(name,wide));if(!store.has(path))return 2;m.writeU32(result,h.add('registry',{path,access}));return 0;});
  add('RegCloseKey',1,handle=>{if(!roots.has(unsigned(handle)))h.close(handle,'registry');return 0;});
  aw('RegSetValueEx',6,(wide,handle,name,reserved,type,data,size)=>{if(reserved)throw new Win32Error('Reserved must be zero');type=unsigned(type);if(![1,2,3,4,7,11].includes(type))throw new Win32Error('Registry type not implemented',50);size=integer(size,0,w.maxFileBytes);const path=keyOf(handle,2),bytes=size?m.bytes(data,size):new Uint8Array();if(type===4&&size!==4||type===11&&size!==8)throw new Win32Error('Invalid registry integer size');if(wide&&[1,2,7].includes(type)&&size%2)throw new Win32Error('Invalid Unicode registry value');const value=[1,2,7].includes(type)?m.decode(bytes,wide):Array.from(bytes);store.get(path).values.set(m.string(name,wide).toLowerCase(),{name:m.string(name,wide),type,value});save();return 0;});
  aw('RegQueryValueEx',6,(wide,handle,name,reserved,typeOut,data,sizeOut)=>{if(reserved||data&&!sizeOut)throw new Win32Error('Invalid registry query arguments');const path=keyOf(handle,1),entry=store.get(path).values.get(m.string(name,wide).toLowerCase());if(!entry)return 2;const bytes=typeof entry.value==='string'?m.stringBytes(entry.value,wide):Uint8Array.from(entry.value);if(typeOut)m.view(typeOut,4);let capacity=sizeOut?m.readU32(sizeOut):0;if(data)m.bytes(data,capacity);if(typeOut)m.writeU32(typeOut,entry.type);if(sizeOut)m.writeU32(sizeOut,bytes.length);if(!data)return 0;if(capacity<bytes.length)return 234;m.bytes(data,bytes.length).set(bytes);return 0;});
  aw('RegDeleteValue',2,(wide,handle,name)=>{const path=keyOf(handle,2);if(!store.get(path).values.delete(m.string(name,wide).toLowerCase()))return 2;save();return 0;});
  aw('RegDeleteKey',2,(wide,handle,name)=>{const path=sub(keyOf(handle,4),m.string(name,wide));if(roots.has(unsigned(handle))&&!m.string(name,wide))return 5;if(!store.has(path))return 2;if([...store.keys()].some(k=>k.startsWith(path+'\\')))return 5;store.delete(path);save();return 0;});
  aw('RegEnumKeyEx',8,(wide,handle,index,name,size,reserved,klass,classSize,time)=>{if(reserved||klass||classSize||time)throw new Win32Error('Registry class/timestamp enumeration is not implemented',50);const path=keyOf(handle,8),children=[...store].filter(([k])=>k.startsWith(path+'\\')&&!k.slice(path.length+1).includes('\\')),entry=children[integer(index)]?.[1];if(!entry)return 259;const capacity=m.readU32(size),n=m.stringBytes(entry.name,wide).length/(wide?2:1);if(capacity<=n)return 234;m.putString(name,entry.name,capacity,wide);m.writeU32(size,n);return 0;});
}

return {installRegistry};
})();

/* gdi32.js */
__modules[7]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];
const {RegionStore,installRegions}=__modules[1];
const {BitmapStore,GDI_CONSTANTS,coord,intersect,rgbBytes,rgbValue,ropInfo}=__modules[2];



function colorRef(value){const n=unsigned(value);return '#'+[n&255,n>>>8&255,n>>>16&255].map(v=>v.toString(16).padStart(2,'0')).join('');}
function installGDI(w){
  const h=w.handles,m=w.memory,regions=new RegionStore(w.options),bitmaps=new BitmapStore(w,regions);
  const add=(name,arity,fn,options={})=>w.register('gdi32',name,fn,{arity,mode:'emulated',...options});
  const stocks=new Map(),stock=(index,type,value)=>stocks.set(index,h.add(type,{...value,stock:true}));
  stock(0,'brush',{color:0xffffff});stock(4,'brush',{color:0});stock(5,'brush',{null:true});stock(6,'pen',{color:0xffffff,width:1});stock(7,'pen',{color:0,width:1});stock(8,'pen',{null:true,width:1});
  const dc=handle=>h.get(handle,'dc');
  const newState=()=>({pen:stocks.get(7),brush:stocks.get(0),bitmap:0,x:0,y:0,viewportX:0,viewportY:0,clip:null,saved:[],stretchMode:1,textColor:0,backgroundColor:0xffffff,backgroundMode:2});
  const states=()=>[...h.entries.values()].filter(e=>e.type==='dc').flatMap(e=>[e.value,...e.value.saved]);
  const selected=object=>states().some(s=>s.pen===Number(object)||s.brush===Number(object)||s.bitmap===Number(object));
  const style=state=>({pen:h.get(state.pen,'pen'),brush:h.get(state.brush,'brush'),textColor:state.textColor,backgroundColor:state.backgroundColor,backgroundMode:state.backgroundMode});
  const draw=(state,operation,args)=>{
    if(state.bitmap){if(operation==='pixel'){bitmaps.pixel(state,args[0],args[1],args[2]);return;}return bitmaps.primitive(state,operation,args,style(state));}
    // Hosts with a raster adapter also receive correct clipping. Legacy draw-only
    // descriptors continue to work for the original unclipped drawing surface.
    if(state.clip){if(operation==='pixel'){bitmaps.pixel(state,args[0],args[1],args[2]);return;}return bitmaps.primitive(state,operation,args,style(state));}
    args=[...args];args[0]+=state.viewportX;args[1]+=state.viewportY;if(['line','rect','ellipse'].includes(operation)){args[2]+=state.viewportX;args[3]+=state.viewportY;}
    const s=style(state);if(state.window.draw)return state.window.draw(operation,args,s);
    const ctx=bitmaps.context(state);ctx.save();try{
      ctx.strokeStyle=colorRef(s.pen.color||0);ctx.lineWidth=s.pen.width||1;ctx.fillStyle=colorRef(s.brush.color||0);
      switch(operation){
        case 'line':ctx.beginPath();ctx.moveTo(args[0],args[1]);ctx.lineTo(args[2],args[3]);if(!s.pen.null)ctx.stroke();break;
        case 'rect':if(!s.brush.null)ctx.fillRect(args[0],args[1],args[2]-args[0],args[3]-args[1]);if(!s.pen.null)ctx.strokeRect(args[0],args[1],args[2]-args[0],args[3]-args[1]);break;
        case 'ellipse':ctx.beginPath();ctx.ellipse((args[0]+args[2])/2,(args[1]+args[3])/2,Math.abs(args[2]-args[0])/2,Math.abs(args[3]-args[1])/2,0,0,Math.PI*2);if(!s.brush.null)ctx.fill();if(!s.pen.null)ctx.stroke();break;
        case 'pixel':ctx.fillStyle=colorRef(args[2]);ctx.fillRect(args[0],args[1],1,1);break;
        case 'text':ctx.font='12px Arial';ctx.textBaseline='top';if(s.backgroundMode===2){ctx.fillStyle=colorRef(s.backgroundColor);ctx.fillRect(args[0],args[1],ctx.measureText(args[2]).width,14);}ctx.fillStyle=colorRef(s.textColor);ctx.fillText(args[2],args[0],args[1]);break;
        default:throw new Win32Error('Unsupported drawing operation',50);
      }
    }finally{ctx.restore();}
  };
  add('GetStockObject',1,index=>{if(!stocks.has(Number(index)))throw new Win32Error('Stock object is not implemented',50);return stocks.get(Number(index));});
  add('CreateSolidBrush',1,color=>h.add('brush',{color:unsigned(color)&0xffffff}));
  add('CreatePen',3,(style,width,color)=>{if(![0,5].includes(Number(style)))throw new Win32Error('Only solid and null pens are supported',50);return h.add('pen',{null:Number(style)===5,width:Math.max(1,integer(width,0,4096)),color:unsigned(color)&0xffffff});});
  w.register('user32','GetDC',handle=>{const window=h.get(handle,'window');if(!window.draw&&!window.context&&!window.node?.getContext&&!window.writePixels)throw new Win32Error('No drawing adapter',50);return h.add('dc',{...newState(),window,handle:Number(handle)});},{arity:1,mode:'browser'});
  w.register('user32','ReleaseDC',(handle,hdc)=>{const state=dc(hdc);if(state.memory||state.handle!==Number(handle))throw new Win32Error('DC does not belong to window',6);h.close(hdc,'dc');return 1;},{arity:2,mode:'browser'});
  add('CreateCompatibleDC',1,handle=>{if(handle)dc(handle);if(h.entries.size+2>h.limit)throw new Win32Error('Handle quota exceeded',8);const bitmap=bitmaps.create(1,1,1,{stock:true});try{const id=h.add('dc',{...newState(),memory:true,bitmap,defaultBitmap:bitmap});bitmaps.get(bitmap).defaultFor=id;return id;}catch(error){m.free(bitmaps.get(bitmap).ptr);h.close(bitmap,'bitmap');throw error;}});
  const deleteDC=handle=>{const state=dc(handle);if(!state.memory)throw new Win32Error('Use ReleaseDC for a window DC',6);m.free(bitmaps.get(state.defaultBitmap).ptr);h.close(state.defaultBitmap,'bitmap');h.close(handle,'dc');return 1;};
  add('DeleteDC',1,deleteDC);
  add('SelectObject',2,(handle,object)=>{const state=dc(handle),entry=h.entries.get(Number(object));if(entry?.type==='region')return regionAPI.select(state,object,5);if(!entry||!['pen','brush','bitmap'].includes(entry.type))throw new Win32Error('Invalid GDI object',6);if(entry.type==='bitmap'){
      if(!state.memory||entry.value.defaultFor&&entry.value.defaultFor!==Number(handle))throw new Win32Error('Bitmap cannot be selected into this DC',87);
      for(const [id,e]of h.entries)if(e.type==='dc'&&id!==Number(handle)&&[e.value,...e.value.saved].some(s=>s.bitmap===Number(object)))throw new Win32Error('Bitmap is selected into another DC',87);
    }const old=state[entry.type];state[entry.type]=Number(object);return old;});
  add('DeleteObject',1,object=>{const entry=h.entries.get(Number(object));if(entry?.type==='dc')return deleteDC(object);if(!entry||!['pen','brush','bitmap','region'].includes(entry.type))throw new Win32Error('Invalid GDI object',6);if(entry.value.stock)return 1;if(selected(object))return 0;if(entry.type==='bitmap')m.free(entry.value.ptr);h.close(object,entry.type);return 1;});
  add('GetCurrentObject',2,(handle,type)=>{const state=dc(handle),field={1:'pen',2:'brush',7:'bitmap'}[Number(type)];if(!field)throw new Win32Error('Object type is not implemented',50);return state[field]||0;});
  add('GetObjectType',1,handle=>{const e=h.entries.get(Number(handle));if(!e)throw new Win32Error('Invalid GDI handle',6);return e.type==='dc'?(e.value.memory?10:3):({pen:1,brush:2,bitmap:7,region:8})[e.type]||0;});
  const bitmapInfo=(b,p)=>{const v=m.view(p,40);v.setUint32(0,40,true);v.setInt32(4,b.width,true);v.setInt32(8,b.topDown?-b.height:b.height,true);v.setUint16(12,1,true);v.setUint16(14,b.bpp,true);v.setUint32(16,0,true);v.setUint32(20,Math.ceil(b.width*b.bpp/32)*4*b.height,true);for(let o=24;o<40;o+=4)v.setUint32(o,0,true);};
  for(const suffix of ['A','W'])add('GetObject'+suffix,3,(object,count,out)=>{const e=h.entries.get(Number(object));if(!e||!['pen','brush','bitmap'].includes(e.type))throw new Win32Error('Unsupported GDI object',6);const b=e.value,size=e.type==='pen'?16:e.type==='brush'?12:24;if(!out)return size;count=integer(count,0,0x7fffffff);const n=e.type==='bitmap'&&b.dib&&count>=84?84:size;if(count<n||unsigned(out)%4)throw new Win32Error('Invalid GDI object buffer');const v=m.view(out,n);m.bytes(out,n).fill(0);
    if(e.type==='pen'){v.setUint32(0,b.null?5:0,true);v.setInt32(4,b.width||1,true);v.setUint32(12,b.color||0,true);}
    else if(e.type==='brush'){v.setUint32(0,b.null?1:0,true);v.setUint32(4,b.color||0,true);}
    else{v.setInt32(4,b.width,true);v.setInt32(8,b.height,true);v.setInt32(12,b.stride,true);v.setUint16(16,1,true);v.setUint16(18,b.bpp,true);v.setUint32(20,b.dib?b.ptr:0,true);if(n===84)bitmapInfo(b,out+24);}return n;
  });
  add('CreateBitmap',5,(width,height,planes,bpp,bits)=>{if(integer(planes,1,0xffff)!==1)throw new Win32Error('Multiple bitmap planes are not supported',50);width=integer(width,0,32767);height=integer(height,0,32767);return !width||!height?bitmaps.create(1,1,1):bitmaps.create(width,height,Number(bpp),{bits});});
  add('CreateCompatibleBitmap',3,(handle,width,height)=>{const state=dc(handle);width=integer(width,0,32767);height=integer(height,0,32767);if(!width||!height)return bitmaps.create(1,1,1);const source=state.bitmap?bitmaps.get(state.bitmap):null;return bitmaps.create(width,height,source?.bpp||32,{dib:!!source?.dib,topDown:source?.topDown??true});});
  add('CreateDIBSection',6,(handle,info,usage,out,section,offset)=>{m.writeU32(out,0);if(handle)dc(handle);if(section)throw new Win32Error('File-mapped DIB sections are not supported',50);unsigned(offset);const b=bitmaps.header(info,usage),id=bitmaps.create(b.width,b.height,b.bpp,{dib:true,topDown:b.topDown});m.writeU32(out,bitmaps.get(id).ptr);return id;});
  // Get/SetBitmapBits expose top-down WORD-aligned DDB rows, including for DIBs.
  const rawLayout=b=>({...b,...bitmaps.geometry(b.width,b.height,b.bpp,false),topDown:true});
  add('GetBitmapBits',3,(object,count,out)=>{const b=bitmaps.get(object),raw=rawLayout(b);count=integer(count,0,0x7fffffff);if(!out)return raw.size;const n=Math.min(count,raw.size);if(!n)return 0;const bytes=new Uint8Array(raw.size),src=bitmaps.data(b);for(let y=0;y<b.height;y++)bytes.set(src.subarray((b.topDown?y:b.height-1-y)*b.stride,(b.topDown?y:b.height-1-y)*b.stride+Math.min(raw.stride,b.stride)),y*raw.stride);m.bytes(out,n).set(bytes.subarray(0,n));return n;});
  add('SetBitmapBits',3,(object,count,input)=>{const b=bitmaps.get(object),raw=rawLayout(b);count=integer(count,0,0x7fffffff);const n=Math.min(count,raw.size);if(!n)return 0;const bytes=m.bytes(input,n).slice(),dst=bitmaps.data(b);for(let pos=0;pos<n;pos++){const y=Math.floor(pos/raw.stride),x=pos%raw.stride;dst[(b.topDown?y:b.height-1-y)*b.stride+x]=bytes[pos];}return n;});
  const pair=(p,a,b)=>{const v=m.view(p,8);v.setInt32(0,a,true);v.setInt32(4,b,true);};
  add('GetBitmapDimensionEx',2,(object,out)=>{const b=bitmaps.get(object);pair(out,b.dimensionX,b.dimensionY);return 1;});
  add('SetBitmapDimensionEx',4,(object,x,y,out)=>{const b=bitmaps.get(object);x=coord(x);y=coord(y);if(out)pair(out,b.dimensionX,b.dimensionY);b.dimensionX=x;b.dimensionY=y;return 1;});
  const requireUnselected=object=>{if(selected(object))throw new Win32Error('DIB transfer requires an unselected bitmap',87);};
  add('GetDIBits',7,(handle,object,start,lines,out,info,usage)=>{
    dc(handle);const b=bitmaps.get(object);requireUnselected(object);integer(start,0,0xffffffff);integer(lines,0,0xffffffff);if(unsigned(usage)!==0)throw new Win32Error('Logical palettes are not supported',50);
    const v=m.view(info,40);if(v.getUint32(0,true)!==40)throw new Win32Error('Only BITMAPINFOHEADER is supported',50);
    if(!out&&!v.getUint16(14,true)){bitmapInfo({...b,topDown:false},info);return 1;}
    const format=bitmaps.header(info,usage);if(format.width!==b.width||format.height!==b.height)throw new Win32Error('DIB transfer dimensions must match bitmap',50);
    if(!out){bitmapInfo(format,info);return 1;}const n=Math.min(Number(lines),Math.max(0,b.height-Number(start)));if(!n)return 0;
    const dest=m.bytes(out,n*format.stride),temp=new Uint8Array(dest.length),source=bitmaps.readBitmap(b,[0,format.topDown?Number(start):b.height-Number(start)-n,b.width,format.topDown?Number(start)+n:b.height-Number(start)]);
    for(let y=0;y<n;y++)for(let x=0;x<b.width;x++){const i=((format.topDown?y:n-1-y)*b.width+x)*4,p=y*format.stride+x*format.bpp/8;temp[p]=source.data[i+2];temp[p+1]=source.data[i+1];temp[p+2]=source.data[i];if(format.bpp===32)temp[p+3]=source.data[i+3];}dest.set(temp);bitmapInfo(format,info);return n;
  });
  add('SetDIBits',7,(handle,object,start,lines,input,info,usage)=>{
    dc(handle);const b=bitmaps.get(object);requireUnselected(object);start=integer(start,0,0xffffffff);lines=integer(lines,0,0xffffffff);const f=bitmaps.header(info,usage);if(f.width!==b.width||f.height!==b.height)throw new Win32Error('DIB transfer dimensions must match bitmap',50);const n=Math.min(lines,Math.max(0,b.height-start));if(!n)return 0;const src=m.bytes(input,n*f.stride).slice(),image=bitmaps.bytesFor([0,0,b.width,n]);
    for(let y=0;y<n;y++)for(let x=0;x<b.width;x++){const i=((f.topDown?y:n-1-y)*b.width+x)*4,p=y*f.stride+x*f.bpp/8;image.data[i]=src[p+2];image.data[i+1]=src[p+1];image.data[i+2]=src[p];image.data[i+3]=f.bpp===32?src[p+3]:0;}const top=f.topDown?start:b.height-start-n;bitmaps.writeBitmap(b,[0,top,b.width,top+n],image);return n;
  });
  add('BitBlt',9,(dest,x,y,width,height,source,sx,sy,rop)=>{integer(width,0,0x7fffffff);integer(height,0,0x7fffffff);const r=ropInfo(rop);return bitmaps.blit(dc(dest),x,y,width,height,r.source?dc(source):null,sx,sy,width,height,rop);});
  add('StretchBlt',11,(dest,x,y,width,height,source,sx,sy,sw,sh,rop)=>{const r=ropInfo(rop);return bitmaps.blit(dc(dest),x,y,width,height,r.source?dc(source):null,sx,sy,sw,sh,rop);});
  add('PatBlt',6,(dest,x,y,width,height,rop)=>{if(ropInfo(rop).source)throw new Win32Error('PatBlt does not accept source-dependent ROPs',50);return bitmaps.blit(dc(dest),x,y,width,height,null,0,0,width,height,rop);});
  for(const [name,operation]of [['TransparentBlt','transparent'],['AlphaBlend','alpha']]){
    const fn=(dest,x,y,width,height,source,sx,sy,sw,sh,extra)=>bitmaps.blit(dc(dest),x,y,width,height,dc(source),sx,sy,sw,sh,operation,extra);
    w.register('msimg32',name,fn,{arity:11,notes:name==='AlphaBlend'?'Packed BLENDFUNCTION; premultiplied 32-bit source alpha.':'Color-key transfer; positive extents only.'});
    add('Gdi'+name,11,fn);
  }
  add('GdiFlush',0,()=>1,{notes:'Memory operations and host pixel transfers are synchronous. Browser presentation is independently scheduled.'});
  add('GetPixel',3,(handle,x,y)=>bitmaps.pixel(dc(handle),x,y),{failure:0xffffffff});
  add('SetPixel',4,(handle,x,y,color)=>{const state=dc(handle);color=unsigned(color)&0xffffff;if(state.bitmap||state.clip)return bitmaps.pixel(state,x,y,color);draw(state,'pixel',[coord(x),coord(y),color]);return color;},{failure:0xffffffff});
  add('SetPixelV',4,(handle,x,y,color)=>{const result=w.invoke('gdi32','SetPixel',[handle,x,y,color]);return result===0xffffffff?0:1;});
  add('MoveToEx',4,(handle,x,y,old)=>{const state=dc(handle);x=coord(x);y=coord(y);if(old)pair(old,state.x,state.y);state.x=x;state.y=y;return 1;});
  add('GetCurrentPositionEx',2,(handle,out)=>{const s=dc(handle);pair(out,s.x,s.y);return 1;});
  add('LineTo',3,(handle,x,y)=>{const state=dc(handle);x=coord(x);y=coord(y);draw(state,'line',[state.x,state.y,x,y]);state.x=x;state.y=y;return 1;});
  for(const [name,operation]of [['Rectangle','rect'],['Ellipse','ellipse']])add(name,5,(handle,l,t,r,b)=>{draw(dc(handle),operation,[l,t,r,b].map(coord));return 1;});
  for(const [name,field]of [['TextColor','textColor'],['BkColor','backgroundColor']]){
    add('Set'+name,2,(handle,color)=>{const state=dc(handle),old=state[field];state[field]=unsigned(color)&0xffffff;return old;},{failure:0xffffffff});
    add('Get'+name,1,handle=>dc(handle)[field],{failure:0xffffffff});
  }
  add('SetBkMode',2,(handle,mode)=>{integer(mode,1,2);const state=dc(handle),old=state.backgroundMode;state.backgroundMode=Number(mode);return old;});
  add('GetBkMode',1,handle=>dc(handle).backgroundMode);
  for(const wide of [false,true])add('TextOut'+(wide?'W':'A'),5,(handle,x,y,p,n)=>{n=integer(n,0,m.maxBytes/(wide?2:1));const text=typeof p==='string'?p.slice(0,n):m.decode(m.bytes(p,n*(wide?2:1)),wide);draw(dc(handle),'text',[coord(x),coord(y),text]);return 1;},{mode:'browser',notes:'Canvas/host font metrics; software memory DC text is not implemented.'});
  add('SaveDC',1,handle=>{const state=dc(handle);if(state.saved.length>=256)throw new Win32Error('Saved DC stack exceeds 256',8);const {saved,...snapshot}=state;state.saved.push(snapshot);return state.saved.length;});
  add('RestoreDC',2,(handle,level)=>{const state=dc(handle);level=coord(level);const index=level<0?state.saved.length+level:level-1;if(!level||index<0||index>=state.saved.length)throw new Win32Error('Invalid saved DC level');const snapshot=state.saved[index];state.saved.splice(index);Object.assign(state,snapshot);return 1;});
  add('SetViewportOrgEx',4,(handle,x,y,old)=>{const state=dc(handle);x=coord(x);y=coord(y);if(old)pair(old,state.viewportX,state.viewportY);state.viewportX=x;state.viewportY=y;return 1;});
  add('OffsetViewportOrgEx',4,(handle,x,y,old)=>{const state=dc(handle);return w.invoke('gdi32','SetViewportOrgEx',[handle,coord(state.viewportX+coord(x)),coord(state.viewportY+coord(y)),old]);});
  add('GetViewportOrgEx',2,(handle,out)=>{const s=dc(handle);pair(out,s.viewportX,s.viewportY);return 1;});
  add('GetMapMode',1,handle=>{dc(handle);return 1;});
  add('SetMapMode',2,(handle,mode)=>{dc(handle);if(Number(mode)!==1)throw new Win32Error('Only MM_TEXT is supported',50);return 1;});
  add('SetStretchBltMode',2,(handle,mode)=>{const state=dc(handle);if(Number(mode)!==3)throw new Win32Error('Only COLORONCOLOR scaling is supported',50);const old=state.stretchMode;state.stretchMode=3;return old;});
  add('GetStretchBltMode',1,handle=>dc(handle).stretchMode);
  const regionAPI=installRegions(w,{dc,bitmaps,regions,add});
  add('GetDeviceCaps',2,(handle,index)=>{const s=dc(handle),r=bitmaps.bounds(s);const values={2:1,8:r[2],10:r[3],12:32,14:1,88:96,90:96};if(!(index in values))throw new Win32Error('Device capability not implemented',50);return values[index];});
}

return {colorRef,installGDI};
})();

/* index.js */
__modules[8]=(()=>{
const {REGION_CONSTANTS}=__modules[1];
const {GDI_CONSTANTS}=__modules[2];
const {installClipboard}=__modules[3];
const {ERROR,Win32Error,Handles,Memory,MemoryFileSystem,integer,unsigned,encodeANSI,decodeANSI}=__modules[0];
const {installKernel32}=__modules[4];
const {installUser32}=__modules[5];
const {installRegistry}=__modules[6];
const {installGDI,colorRef}=__modules[7];









const WIN32_CONSTANTS=Object.freeze({...GDI_CONSTANTS,...REGION_CONSTANTS,INVALID_HANDLE_VALUE:-1,GENERIC_READ:0x80000000,GENERIC_WRITE:0x40000000,FILE_SHARE_READ:1,FILE_SHARE_WRITE:2,CREATE_NEW:1,CREATE_ALWAYS:2,OPEN_EXISTING:3,OPEN_ALWAYS:4,TRUNCATE_EXISTING:5,FILE_ATTRIBUTE_NORMAL:128,FILE_ATTRIBUTE_DIRECTORY:16,GMEM_FIXED:0,GMEM_MOVEABLE:2,GMEM_ZEROINIT:64,SW_HIDE:0,SW_SHOWNORMAL:1,SW_SHOW:5,SW_RESTORE:9,WM_SETTEXT:12,WM_GETTEXT:13,WM_GETTEXTLENGTH:14,HKEY_CURRENT_USER:0x80000001,KEY_READ:0x20019,KEY_WRITE:0x20006,KEY_ALL_ACCESS:0xf003f,REG_SZ:1,REG_EXPAND_SZ:2,REG_BINARY:3,REG_DWORD:4,REG_MULTI_SZ:7,REG_QWORD:11,CF_TEXT:1,CF_UNICODETEXT:13});
function normalizeDLL(name){const dll=String(name).replace(/\\/g,'/').split('/').at(-1).replace(/\.dll$/i,'').toLowerCase();if(!/^[a-z0-9_.-]+$/.test(dll))throw new Win32Error('Invalid DLL name',126);return dll;}
/** Reusable browser/worker/Node compatibility process; never loads native code. */
class Win32Browser {
  constructor(options={}){
    this.options=options;this.memory=new Memory(options);this.handles=new Handles(options.maxHandles);this.fs=options.fs||new MemoryFileSystem();this.lastError=0;this.disposed=false;this.modules=new Map();this.timers=new Map();this.timerCallbacks=new Map();this.nextTimer=1;this.delays=new Set();this.clock=options.clock||(()=>globalThis.performance?.now?.()??Date.now());this.now=options.now||(()=>new Date());this.epoch=this.clock();this.maxFileBytes=integer(options.maxFileBytes??Math.min(20*1024*1024,this.memory.maxBytes),1,this.memory.maxBytes);this.environment=new Map(Object.entries(options.environment||{}).map(([k,v])=>[k.toUpperCase(),String(v)]));
    for(const name of ['/Windows','/Temp'])this.fs.directories.add(this.fs.normalize(name));
    installKernel32(this);installUser32(this);installRegistry(this);installGDI(this);installClipboard(this);
    if(options.registry){for(const [path,record]of options.registry){if(!/^(HKCR|HKCU|HKLM|HKU|HKCC)(\\|$)/.test(path)||!Array.isArray(record.values))throw new Win32Error('Invalid registry snapshot');this.registry.set(path,{name:String(record.name),values:new Map(record.values)});}}
    this.register('shell32','ShellExecuteA',(handle,operation,file,parameters,directory,show)=>this.openURL(false,handle,operation,file,parameters,directory,show),{arity:6,failure:5,mode:'browser',notes:'Only explicitly enabled http/https/mailto navigation; no executable launch.'});
    this.register('shell32','ShellExecuteW',(handle,operation,file,parameters,directory,show)=>this.openURL(true,handle,operation,file,parameters,directory,show),{arity:6,failure:5,mode:'browser',notes:'Only explicitly enabled http/https/mailto navigation; no executable launch.'});
  }
  register(dll,name,fn,{arity,mode='emulated',notes='',failure=0,statusError=false,replace=false}={}){dll=normalizeDLL(dll);if(typeof fn!=='function'||!Number.isInteger(arity)||arity<0||arity>64||!/^[A-Za-z_]\w*$/.test(name))throw new Win32Error('Invalid API registration');let exports=this.modules.get(dll);if(!exports)this.modules.set(dll,exports=new Map());if(exports.has(name)&&!replace)throw new Win32Error('Duplicate API export');exports.set(name,{dll,name,fn,arity,mode,notes,failure,statusError});return this;}
  resolve(dll,name){dll=normalizeDLL(dll);const module=this.modules.get(dll);if(!module)throw new Win32Error('DLL has no browser compatibility module: '+dll,126);const api=module.get(String(name));if(!api)throw new Win32Error('Win32 API is not implemented: '+dll+'!'+name,127);return api;}
  invoke(dll,name,args=[]){if(this.disposed)throw new Win32Error('Compatibility process is disposed',995);const api=this.resolve(dll,name);if(!Array.isArray(args)||args.length!==api.arity)throw new Win32Error('Invalid argument count for '+api.dll+'!'+name,87);const failure=error=>{if(!(error instanceof Win32Error))throw error;if(api.statusError)return error.code;this.lastError=error.code;this.options.onDiagnostic?.({dll:api.dll,name,code:error.code,message:error.message});return typeof api.failure==='function'?api.failure(args):api.failure;};try{const value=api.fn(...args);return value?.then?value.catch(failure):value;}catch(error){return failure(error);}}
  manifest(){return [...this.modules.values()].flatMap(exports=>[...exports.values()].map(({dll,name,arity,mode,notes})=>({dll,name,arity,mode,notes}))).sort((a,b)=>(a.dll+'!'+a.name).localeCompare(b.dll+'!'+b.name));}
  registerWindow(descriptor){if(!descriptor||typeof descriptor!=='object')throw new Win32Error('Window descriptor required');return this.handles.add('window',descriptor);}
  unregisterWindow(handle){if(!this.handles.has(handle,'window'))return;for(const [key,t]of this.timers)if(t.handle===Number(handle)){clearInterval(t.timer);this.timers.delete(key);}for(const [id,e]of this.handles.entries)if(e.type==='dc'&&e.value.handle===Number(handle))this.handles.close(id,'dc');this.handles.close(handle,'window');}
  registerCallback(fn,{onTimer=fn}={}){if(typeof fn!=='function'||typeof onTimer!=='function')throw new Win32Error('Callback must be a function');const handle=this.handles.add('callback',fn);this.timerCallbacks.set(handle,onTimer);return handle;}
  unregisterCallback(handle){for(const t of this.timers.values())if(t.callback===handle)throw new Win32Error('Callback is still used by a timer',5);this.handles.close(handle,'callback');this.timerCallbacks.delete(handle);}
  sleep(milliseconds){milliseconds=unsigned(milliseconds);return new Promise((resolve,reject)=>{const state={timer:null,reject};this.delays.add(state);const end=this.clock()+milliseconds;const next=()=>{if(this.disposed){this.delays.delete(state);reject(new Win32Error('Sleep cancelled',995));return;}const remaining=end-this.clock();if(remaining<=0){this.delays.delete(state);resolve();}else state.timer=setTimeout(next,Math.min(remaining,0x7fffffff));};state.timer=setTimeout(next,Math.min(milliseconds,0x7fffffff));});}
  registrySnapshot(){return [...this.registry].map(([path,r])=>[path,{name:r.name,values:[...r.values].map(([key,v])=>[key,{...v,value:Array.isArray(v.value)?v.value.slice():v.value}])}]);}
  async openURL(wide,handle,operation,file,parameters,directory,show){if(handle)this.handles.get(handle,'window');const verb=this.memory.string(operation,wide).toLowerCase();if(verb&&verb!=='open'||this.memory.string(parameters,wide)||this.memory.string(directory,wide))return 31;let url;try{url=new URL(this.memory.string(file,wide));}catch{throw new Win32Error('Invalid navigation URL',87);}if(!['http:','https:','mailto:'].includes(url.protocol)||!this.options.allowNavigation||typeof this.options.openURL!=='function')return 5;return await this.options.openURL(url.href,show)?33:5;}
  dispose(){if(this.disposed)return;this.disposed=true;for(const t of this.timers.values())clearInterval(t.timer);this.timers.clear();for(const d of this.delays){clearTimeout(d.timer);d.reject(new Win32Error('Operation cancelled',995));}this.delays.clear();this.handles.entries.clear();this.timerCallbacks.clear();this.memory.clear();}
}
function createWin32(options={}){return new Win32Browser(options);}

return {WIN32_CONSTANTS,normalizeDLL,Win32Browser,createWin32,ERROR,Win32Error,Memory,MemoryFileSystem,encodeANSI,decodeANSI,colorRef};
})();
globalThis["Win32Compat"]=__modules[8];
})();