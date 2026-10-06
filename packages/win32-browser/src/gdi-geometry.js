import {Win32Error,integer} from './core.js';

const point=n=>integer(n,-0x4000000,0x3ffffff);
const quota=()=>{throw new Win32Error('Region scan conversion work quota exceeded',8);};
/** Exact ceil of an integer edge intersection. Large coordinates use BigInt to
 * avoid loss of a pixel when intermediate products exceed Number precision. */
function edgeX(a,b,y){
  const dy=b[1]-a[1],dx=b[0]-a[0],n=a[0]*dy+(y-a[1])*dx;
  if(Number.isSafeInteger(a[0]*dy)&&Number.isSafeInteger((y-a[1])*dx)&&Number.isSafeInteger(n))return Math.ceil(n/dy);
  const d=BigInt(dy),v=BigInt(a[0])*d+BigInt(y-a[1])*BigInt(dx);
  return Number(v/d+(v>0n&&v%d!==0n?1n:0n));
}
/** Integer scan conversion with ALTERNATE or WINDING fill. Edges are sampled at
 * integer device rows and intervals are half-open. No bitmap-area allocation. */
export function polygonRegion(store,polygons,mode=1){
  mode=integer(mode,1,2);let count=0,top=Infinity,bottom=-Infinity;const edges=[];
  if(!Array.isArray(polygons))throw new Win32Error('Polygon array required');
  for(const polygon of polygons){
    if(!Array.isArray(polygon)||polygon.length<2)throw new Win32Error('A polygon requires at least two points');
    count+=polygon.length;if(count>store.limit*4||count>store.workLimit)quota();
    const points=polygon.map(p=>{if(!Array.isArray(p)||p.length!==2)throw new Win32Error('Invalid POINT');return p.map(point);});
    for(let i=0;i<points.length;i++){
      let a=points[i],b=points[(i+1)%points.length];if(a[1]===b[1])continue;
      const sign=a[1]<b[1]?1:-1;if(sign<0)[a,b]=[b,a];
      edges.push({a,b,sign});top=Math.min(top,a[1]);bottom=Math.max(bottom,b[1]);
    }
  }
  if(!edges.length)return store.rectangle(0,0,0,0);
  if((bottom-top)*edges.length>store.workLimit)quota();
  const bands=[],budget={count:0};
  for(let y=top;y<bottom;y++){
    const hits=[];for(const e of edges)if(e.a[1]<=y&&e.b[1]>y)hits.push([edgeX(e.a,e.b,y),e.sign]);
    hits.sort((a,b)=>a[0]-b[0]);let winding=0,active=false;const spans=[];
    for(let i=0;i<hits.length;){const x=hits[i][0];do{winding+=mode===1?1:hits[i][1];i++;}while(i<hits.length&&hits[i][0]===x);
      const next=mode===1?(winding&1)!==0:winding!==0;if(active!==next){spans.push(x);active=next;}}
    store.append(bands,y,y+1,spans,budget);
  }
  return store.finish(bands);
}
/** Bounded analytic ellipse/rounded-rectangle scan conversion. Pixel edges are
 * deterministic across engines; curved-edge GDI rasterizer parity is measured
 * separately from Boolean geometry and is not assumed from API availability. */
export function roundedRegion(store,left,top,right,bottom,ew,eh){
  [left,top,right,bottom]=[left,top,right,bottom].map(point);
  if(left>right)[left,right]=[right,left];if(top>bottom)[top,bottom]=[bottom,top];
  // GDI curved region constructors exclude the last right/bottom raster edge.
  right--;bottom--;if(right<left)[left,right]=[right,left];if(bottom<top)[top,bottom]=[bottom,top];
  ew=Math.min(right-left,Math.abs(integer(ew,-0x7fffffff,0x7fffffff)));
  eh=Math.min(bottom-top,Math.abs(integer(eh,-0x7fffffff,0x7fffffff)));
  if(!ew||!eh)return store.rectangle(left,top,right,bottom);
  if(bottom-top>store.workLimit)quota();
  const rx=ew/2,ry=eh/2,bands=[],budget={count:0};
  for(let y=top;y<bottom;y++){
    const cy=y<top+ry?top+ry:bottom-ry;
    const yy=y+.5,dy=yy<top+ry||yy>bottom-ry?(yy-cy)/ry:0;
    const inset=rx-rx*Math.sqrt(Math.max(0,1-dy*dy));
    const l=Math.ceil(left+inset-.5),r=Math.ceil(right-inset-.5);
    store.append(bands,y,y+1,l<r?[l,r]:[],budget);
  }
  return store.finish(bands);
}
export function transformRegion(store,region,matrix){
  if(!Array.isArray(matrix)||matrix.length!==6||matrix.some(n=>!Number.isFinite(n)))throw new Win32Error('Invalid region transform');
  const [a,b,c,d,tx,ty]=matrix;
  if(a===1&&!b&&!c&&d===1&&Number.isInteger(tx)&&Number.isInteger(ty))return store.offset(region,tx,ty);
  if(!region.count)return region;
  // Transform all bands as one winding polygon set. Shared edges cancel and
  // self-overlap is handled once, rather than repeatedly unioning scan rows.
  return polygonRegion(store,store.rectangles(region).map(([l,t,r,bt])=>[[l,t],[r,t],[r,bt],[l,bt]].map(([x,y])=>[point(Math.round(a*x+c*y+tx)),point(Math.round(b*x+d*y+ty))])),2);
}
/** Rectangular morphological erosion: subtract the complement dilated by the
 * requested horizontal/vertical border widths. The result works on holes and
 * disconnected components, not just the outer bounding rectangle. */
export function frameRegion(store,region,x,y){
  x=Math.abs(integer(x,-0x7fffffff,0x7fffffff));y=Math.abs(integer(y,-0x7fffffff,0x7fffffff));
  if(!x||!y||!region.count)return store.rectangle(0,0,0,0);
  const [l,t,r,b]=region.bounds;
  if(x*2>=r-l||y*2>=b-t)return region;
  const innerBox=store.rectangle(l+x,t+y,r-x,b-y);
  const holes=store.combine(store.rectangle(l,t,r,b),region,4);
  let inner=innerBox,work=0;
  for(const q of store.rectangles(holes)){
    work+=inner.count+holes.count;if(work>store.workLimit)quota();
    const dilated=store.rectangle(Math.max(l,q[0]-x),Math.max(t,q[1]-y),Math.min(r,q[2]+x),Math.min(b,q[3]+y));
    inner=store.combine(inner,dilated,4);
  }
  return store.combine(region,inner,4);
}
