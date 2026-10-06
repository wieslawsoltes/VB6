import {polygonRegion,roundedRegion,transformRegion,frameRegion} from './gdi-geometry.js';
import {mapping,devicePoint,mapBounds,inverse,readTransform} from './gdi-transform.js';
import {Win32Error,integer} from './core.js';

export const REGION_CONSTANTS=Object.freeze({RGN_AND:1,RGN_OR:2,RGN_XOR:3,RGN_DIFF:4,RGN_COPY:5,ERROR:0,NULLREGION:1,SIMPLEREGION:2,COMPLEXREGION:3,OBJ_REGION:8,RDH_RECTANGLES:1});
const MIN=-0x4000000,MAX=0x3ffffff;
const coordinate=n=>integer(n,MIN,MAX);
const equalSpans=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const inside=(mode,a,b)=>mode===1?a&&b:mode===2?a||b:mode===3?a!==b:a&&!b;
const EMPTY=Object.freeze({bands:Object.freeze([]),bounds:Object.freeze([0,0,0,0]),count:0,type:1});

/** Immutable, canonical y-bands: sorted disjoint half-open x intervals per band.
 * Boolean operations depend on edge count, never coordinate magnitude or area.
 * Frozen geometry may safely be shared by handles, clips and saved DC states.
 */
export class RegionStore {
  constructor(options={}){
    this.limit=integer(options.maxRegionRectangles??4096,1,65536);
    this.workLimit=integer(options.maxRegionWork??1048576,16,16777216);
  }
  polygons(polygons,mode=1){return polygonRegion(this,polygons,mode);}
  rounded(...args){return roundedRegion(this,...args);}
  transform(region,matrix){return transformRegion(this,region,matrix);}
  frame(region,x,y){return frameRegion(this,region,x,y);}
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
export function installRegions(w,{dc,bitmaps,regions,add}){
  const h=w.handles,m=w.memory,get=id=>{const r=h.get(id,'region');if(r.windowOwner)throw new Win32Error('Region ownership belongs to a window',5);return r;},set=(id,shape)=>{get(id).shape=shape;return shape.type;};
  const rect=p=>{const v=m.view(p,16);return [0,4,8,12].map(o=>v.getInt32(o,true));};
  const writeRect=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));};
  const create=shape=>h.add('region',{shape});
  const deviceRegion=s=>regions.rectangle(...bitmaps.bounds(s));
  const effective=s=>bitmaps.effective(s);
  const logicalRect=(s,r)=>regions.transform(regions.rectangle(...r),mapping(s));
  const select=(s,object,mode)=>{
    mode=integer(mode,1,5);
    if(!object){if(mode!==5)throw new Win32Error('NULL clip requires RGN_COPY');s.clip=null;return effective(s).type;}
    const shape=get(object).shape;
    const next=mode===5||mode===1&&!s.clip?shape:regions.combine(s.clip||deviceRegion(s),shape,mode);
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
    if(count<size)throw new Win32Error('Region data buffer is too small',87);
    const v=m.view(out,size);v.setUint32(0,32,true);v.setUint32(4,1,true);v.setUint32(8,shape.count,true);v.setUint32(12,shape.count*16,true);writeRect(out+16,shape.bounds);
    let offset=32;for(const r of regions.rectangles(shape)){writeRect(out+offset,r);offset+=16;}return size;
  });
  add('ExtCreateRegion',3,(transform,count,p)=>{
    count=integer(count,32,m.maxBytes);const v=m.view(p,count),n=v.getUint32(8,true),bytes=v.getUint32(12,true);
    if(v.getUint32(0,true)!==32||v.getUint32(4,true)!==1||n>regions.limit||bytes<n*16||bytes>count-32||32+n*16>count)throw new Win32Error('Invalid or excessive RGNDATA');
    const matrix=transform?readTransform(m,transform):null;
    let shape=regions.fromRectangles(Array.from({length:n},(_,i)=>rect(p+32+i*16)));
    const bounds=rect(p+16);if(!bounds.every((x,i)=>x===shape.bounds[i]))throw new Win32Error('RGNDATA bounding rectangle is inconsistent');
    if(matrix)shape=regions.transform(shape,matrix);return create(shape);
  });
  add('SelectClipRgn',2,(handle,object)=>select(dc(handle),object,5));
  add('ExtSelectClipRgn',3,(handle,object,mode)=>select(dc(handle),object,mode));
  add('GetClipRgn',2,(handle,object)=>{const s=dc(handle);get(object);if(!s.clip)return 0;set(object,s.clip);return 1;},{failure:-1});
  for(const [name,mode]of [['IntersectClipRect',1],['ExcludeClipRect',4]])add(name,5,(handle,...r)=>{
    const s=dc(handle),shape=logicalRect(s,r);
    // Intersecting an absent application clip stores the complete rectangle,
    // not only the currently visible bitmap portion. A later bitmap selection
    // or offset must recover that off-screen geometry (Windows GDI contracts).
    const next=mode===1&&!s.clip?shape:regions.combine(s.clip||deviceRegion(s),shape,mode);
    // Rectangle clip calls use GDI's conservative COMPLEXREGION success status;
    // GetClipBox reports the precise effective visible complexity separately.
    s.clip=next;return mode===4&&!next.count?1:3;
  });
  add('OffsetClipRgn',3,(handle,x,y)=>{const s=dc(handle);x=integer(x,-0x80000000,0x7fffffff);y=integer(y,-0x80000000,0x7fffffff);if(!s.clip)return effective(s).type;const matrix=mapping(s),next=regions.offset(s.clip,Math.round(matrix[0]*x+matrix[2]*y),Math.round(matrix[1]*x+matrix[3]*y));s.clip=next;return next.type;});
  add('GetClipBox',2,(handle,out)=>{const s=dc(handle),shape=effective(s);writeRect(out,shape.count?mapBounds(inverse(mapping(s)),shape.bounds):[0,0,0,0]);return shape.type;});
  add('PtVisible',3,(handle,x,y)=>{const s=dc(handle);[x,y]=devicePoint(s,integer(x,-0x80000000,0x7fffffff),integer(y,-0x80000000,0x7fffffff));return regions.contains(effective(s),x,y)?1:0;});
  add('RectVisible',2,(handle,p)=>{const s=dc(handle),r=rect(p);return regions.combine(effective(s),logicalRect(s,r),1).count?1:0;});
  const paint=(handle,object,brush,invert=false)=>{
    const s=dc(handle),shape=logicalRectShape(s,typeof object==='object'?object:get(object).shape),b=invert?null:h.get(brush,'brush');if(b?.null)return 1;
    const clipped=regions.combine(shape,effective(s),1);if(!clipped.count)return 1;
    const r=clipped.bounds,image=bitmaps.read(s,r),color=b?.color||0;
    for(const band of clipped.bands)for(let y=band.top;y<band.bottom;y++)for(let j=0;j<band.spans.length;j+=2)for(let x=band.spans[j];x<band.spans[j+1];x++){
      const i=((y-r[1])*image.width+x-r[0])*4;
      if(invert){image.data[i]^=255;image.data[i+1]^=255;image.data[i+2]^=255;image.data[i+3]=0;}
      else{image.data[i]=color&255;image.data[i+1]=color>>>8&255;image.data[i+2]=color>>>16&255;image.data[i+3]=0;}
    }
    bitmaps.write(s,r,image);return 1;
  };
  const logicalRectShape=(s,shape)=>regions.transform(shape,mapping(s));
  add('FillRgn',3,(handle,object,brush)=>paint(handle,object,brush));
  add('PaintRgn',2,(handle,object)=>paint(handle,object,dc(handle).brush));
  add('InvertRgn',2,(handle,object)=>paint(handle,object,0,true));
  add('FrameRgn',5,(handle,object,brush,x,y)=>paint(handle,regions.frame(get(object).shape,x,y),brush));
  add('CreateEllipticRgn',4,(l,t,r,b)=>create(regions.rounded(l,t,r,b,Math.abs(r-l),Math.abs(b-t))));
  add('CreateEllipticRgnIndirect',1,p=>{const [l,t,r,b]=rect(p);return create(regions.rounded(l,t,r,b,Math.abs(r-l),Math.abs(b-t)));});
  add('CreateRoundRectRgn',6,(...args)=>create(regions.rounded(...args)));
  const points=(p,n)=>{n=integer(n,2,regions.limit*4);const v=m.view(p,n*8);return Array.from({length:n},(_,i)=>[v.getInt32(i*8,true),v.getInt32(i*8+4,true)]);};
  add('CreatePolygonRgn',3,(p,n,mode)=>create(regions.polygons([points(p,n)],mode)));
  add('CreatePolyPolygonRgn',4,(p,counts,n,mode)=>{n=integer(n,1,regions.limit);const v=m.view(counts,n*4),polys=[];let offset=0;for(let i=0;i<n;i++){const count=integer(v.getInt32(i*4,true),2,regions.limit*4);if(offset+count>regions.limit*4)throw new Win32Error('Polygon point quota exceeded',8);polys.push(points(p+offset*8,count));offset+=count;}return create(regions.polygons(polys,mode));});
  add('GetPolyFillMode',1,id=>dc(id).polyFillMode||1);
  add('SetPolyFillMode',2,(id,mode)=>{mode=integer(mode,1,2);const s=dc(id),old=s.polyFillMode||1;s.polyFillMode=mode;return old;});
  return {select,paint};
}
