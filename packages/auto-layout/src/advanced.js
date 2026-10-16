import {normalizeTracks,resolveTrackTemplate} from './track-template.js';
import {areaGeometry,lineNames,resolveGridItem,resolveAxisPlacement} from './grid-lines.js';
export {normalizeTracks};
import {placeGridItems} from './grid-placement.js';
/** Intrinsic and two-dimensional layout. No DOM or renderer dependencies. */
export const advancedColumns=['wm','hm','ignore','items','content','crossGap','preferredW','preferredH','baseline','column','row','columnSpan','rowSpan','self','autoFlow','dir','rev','wrapRev'];
const alignments=['start','center','end','stretch','baseline'];
const distributions=['start','center','end','space-between','space-around','space-evenly','stretch'];
const sizes=['fixed','hug','fill'];
const flows=['row','column','row dense','column dense'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function number(n,fallback,name,min=-Infinity,max=Infinity){if(n===undefined)return fallback;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new RangeError('Invalid '+name);return n;}
function choice(v,values,fallback,name){if(v===undefined)return fallback;const i=typeof v==='number'?v:values.indexOf(v);if(!Number.isInteger(i)||i<0||i>=values.length)throw new RangeError('Invalid '+name);return i;}
function integer(v,fallback,name,min,max){v=number(v,fallback,name,min,max);if(!Number.isInteger(v))throw new RangeError('Invalid '+name);return v;}
function flag(v,old,name){if(v===undefined)return integer(old,0,name,0,1);if(typeof v!=='boolean')throw new TypeError(name+' must be Boolean');return v?1:0;}
export function normalizeAdvanced(n){
  const bounds=n.bounds||n;
  return {dir:choice(n.direction??n.dir,['ltr','rtl','inherit'],2,'direction'),rev:flag(n.reverse,n.rev,'reverse'),wrapRev:flag(n.wrapReverse,n.wrapRev,'wrapReverse'),autoFlow:choice(n.gridAutoFlow??n.autoFlow,flows,0,'gridAutoFlow'),wm:choice(n.widthMode??n.wm,sizes,0,'widthMode'),hm:choice(n.heightMode??n.hm,sizes,0,'heightMode'),
    ignore:n.ignoreLayout===undefined?integer(n.ignore,0,'ignoreLayout',0,1):n.ignoreLayout===true?1:n.ignoreLayout===false?0:(()=>{throw new TypeError('ignoreLayout must be Boolean');})(),
    items:choice(n.alignItems??n.items,alignments,0,'alignItems'),content:choice(n.alignContent??n.content,distributions,0,'alignContent'),
    crossGap:n.crossGap===undefined?NaN:number(n.crossGap,0,'crossGap'),
    preferredW:number(n.preferredWidth,n.preferredW??bounds.width??0,'preferredWidth',0),preferredH:number(n.preferredHeight,n.preferredH??bounds.height??0,'preferredHeight',0),
    baseline:number(n.baseline,(bounds.height??0)*.8,'baseline',0),column:integer(n.gridColumn,-1,'gridColumn',0,1023),row:integer(n.gridRow,-1,'gridRow',0,262143),
    columnSpan:integer(n.columnSpan,1,'columnSpan',1,1024),rowSpan:integer(n.rowSpan,1,'rowSpan',1,1024),self:choice(n.justifySelf,alignments.slice(0,4),-1,'justifySelf')};
}
/** Capped proportional distribution. O(n) without saturation, O(n log n)
 * otherwise; unlike repeated freezing it cannot degrade to quadratic scans. */
export function distribute(ids,begin,end,values,weights,mins,maxs,free,scratch=[]){
  if(Math.abs(free)<1e-9)return;
  const sign=free>0?1:-1;let total=0,first=Infinity,scale=0;scratch.length=0;
  for(let j=begin;j<end;j++){const weight=weights[ids[j]];if(!Number.isFinite(weight)||weight<0)throw new RangeError('Invalid flex weight');scale=Math.max(scale,weight);}
  if(!scale)return;
  const weight=i=>weights[i]/scale,cap=i=>(sign>0?maxs[i]-values[i]:values[i]-mins[i])/weight(i);
  for(let j=begin;j<end;j++){const i=ids[j],w=weight(i);if(w>0){total+=w;first=Math.min(first,cap(i));scratch.push(i);}}
  let level=Math.abs(free)/total;
  if(level>first){
    scratch.sort((a,b)=>cap(a)-cap(b));let previous=0,remaining=Math.abs(free);
    for(const i of scratch){const limit=cap(i),step=(limit-previous)*total;if(remaining<=step){level=previous+remaining/total;remaining=0;break;}remaining-=step;total-=weight(i);previous=limit;level=limit;if(total<=0)break;}
  }
  for(const i of scratch)values[i]=clamp(values[i]+sign*level*weight(i),mins[i],maxs[i]);
}
function preferred(e,i,axis){const d=e.data;return axis===0?(d.wm[i]===1?e.measuredWidth[i]:d.w[i]):(d.hm[i]===1?e.measuredHeight[i]:d.h[i]);}
function active(e,i){return e.visible[i]&&e.participant[i]&&!e.data.ignore[i]&&!e.data.dock[i];}
function placements(e,parent,ids,columns,rows,regions){
  const cache=e.gridCache.get(parent);if(cache?.revision===e.revision&&cache.explicitColumns===columns.length&&cache.explicitRows===rows.length)return cache;
  const d=e.data,cn=lineNames(columns,regions,'column'),rn=lineNames(rows,regions,'row');
  const items=ids.map(i=>resolveGridItem(e.nodes[i],{i,row:d.row[i],col:d.column[i],cs:d.columnSpan[i],rs:d.rowSpan[i]},cn,rn,regions));
  const result={revision:e.revision,explicitColumns:columns.length,explicitRows:rows.length,columnNames:cn,rowNames:rn,...placeGridItems(items,columns.length,rows.length,d.autoFlow[parent])};
  e.gridCache.set(parent,result);return result;
}
function trackSpec(e,parent,grid,axis){return axis?grid.rowSpec:grid.columnSpec;}
const defaultTrack=axis=>({mode:axis?1:2,value:axis?0:1,min:0,max:Infinity});
const visibleTracks=spec=>spec.reduce((n,t)=>n+!t.collapsed,0);
function naturalTracks(e,parent,grid,axis){
  const d=e.data,count=axis?grid.rows:grid.columns,spec=trackSpec(e,parent,grid,axis),gap=axis?(Number.isNaN(d.crossGap[parent])?d.gap[parent]:d.crossGap[parent]):d.gap[parent];
  const values=Array.from({length:count},(_,i)=>{const t=spec[i];return t?.mode===0?clamp(t.value,t.min,t.max):t?.min||0;});
  const weights=spec.map(t=>t.mode===0?0:1),mins=spec.map(t=>t.min),maxs=spec.map(t=>t.max),scratch=[];
  // Non-spanning requirements establish minima before spanning distribution.
  for(const spanning of [false,true])for(const p of grid.placed){const at=axis?p.row:p.col,span=axis?p.rs:p.cs;if((span>1)!==spanning)continue;
    const i=p.i,desired=preferred(e,i,axis)+(axis?d.mt[i]+d.mb[i]:d.ml[i]+d.mr[i]);let used=gap*(span-1),flex=0;
    for(let j=at;j<at+span;j++){used+=values[j];if(spec[j]?.mode!==0)flex++;}
    if(desired>used&&flex){const ids=Array.from({length:span},(_,j)=>at+j);distribute(ids,0,span,values,weights,mins,maxs,desired-used,scratch);}
  }
  if(axis){const rows=new Map();for(const p of grid.placed){const i=p.i;if(p.rs!==1||(d.align[i]<0?d.items[parent]:d.align[i])!==4)continue;const h=preferred(e,i,1),base=Math.min(h,d.baseline[i]),v=rows.get(p.row)||[0,0];v[0]=Math.max(v[0],d.mt[i]+base);v[1]=Math.max(v[1],h-base+d.mb[i]);rows.set(p.row,v);}for(const [row,[up,down]]of rows)if(spec[row].mode!==0)values[row]=clamp(Math.max(values[row],up+down),spec[row].min,spec[row].max);}
  return values;
}
function resolveTracks(spec,natural,available,gap){
  const values=natural.map((n,i)=>{const t=spec[i]||{mode:1,min:0,max:Infinity};return t.mode===0?clamp(t.value,t.min,t.max):t.mode===1?clamp(n,t.min,t.max):t.min;});
  const ids=[],events=[];let fixed=gap*Math.max(0,visibleTracks(spec)-1),minimum=0,scale=0;
  for(const t of spec)if(t.mode===2)scale=Math.max(scale,t.value);
  for(let i=0;i<values.length;i++){const t=spec[i];if(t?.mode===2){ids.push(i);minimum+=t.min;const w=t.value/scale;if(!w)continue;events.push({at:t.min/w,weight:w});if(Number.isFinite(t.max))events.push({at:t.max/w,weight:-w});}else fixed+=values[i];}
  const budget=available-fixed;if(!ids.length||budget<=minimum)return values;
  events.sort((a,b)=>a.at-b.at);let used=minimum,level=0,weight=0,found=false;
  for(const ev of events){const delta=(ev.at-level)*weight;if(weight>0&&used+delta>=budget){level+=(budget-used)/weight;found=true;break;}used+=delta;level=ev.at;weight+=ev.weight;}
  if(!found&&weight>0)level+=(budget-used)/weight;
  for(const i of ids){const t=spec[i];values[i]=clamp(level*(t.value/scale),t.min,t.max);}return values;
}
function gridSizes(e,parent,ids,width,height,intrinsic=false){
  const d=e.data,gap=d.gap[parent],crossGap=Number.isNaN(d.crossGap[parent])?gap:d.crossGap[parent],variables=e.resolvedVariables[parent];
  const authored=e.tracks[parent],columnSpec=resolveTrackTemplate(authored.columns,width,gap,variables),rowSpec=resolveTrackTemplate(authored.rows,height,crossGap,variables);
  const owner=parent===e.count?e.options:e.nodes[parent],areas=owner.gridTemplateAreas,regions=areaGeometry(areas);
  const areaColumns=areas.length?areas[0].split(' ').length:0;
  while(columnSpec.length<Math.max(areaColumns,columnSpec.length?0:2))columnSpec.push(defaultTrack(0));
  while(rowSpec.length<areas.length)rowSpec.push(defaultTrack(1));
  const grid={...placements(e,parent,ids,columnSpec,rowSpec,regions),columnSpec,rowSpec};
  while(columnSpec.length<grid.columns)columnSpec.push(defaultTrack(0));while(rowSpec.length<grid.rows)rowSpec.push(defaultTrack(1));
  for(const axis of [0,1]){const spec=axis?rowSpec:columnSpec;if(!spec.some(t=>t.autoRepeat==='auto-fit'))continue;
    const occupied=new Uint8Array(spec.length);for(const p of grid.placed){const start=axis?p.row:p.col,end=start+(axis?p.rs:p.cs);occupied.fill(1,start,end);}
    for(let i=0;i<spec.length;i++){const t=spec[i];t.collapsed=t.autoRepeat==='auto-fit'&&!occupied[i];if(t.collapsed)Object.assign(t,{mode:0,value:0,min:0,max:0});}
  }
  const nw=naturalTracks(e,parent,grid,0),nh=naturalTracks(e,parent,grid,1);
  return {...grid,gap,crossGap,widths:intrinsic?nw:resolveTracks(columnSpec,nw,width,gap),heights:intrinsic?nh:resolveTracks(rowSpec,nh,height,crossGap)};
}
function stretchTracks(values,spec,available,gap){
  const free=available-values.reduce((a,b)=>a+b,0)-gap*Math.max(0,visibleTracks(spec)-1);
  if(free<=0)return;
  const ids=spec.flatMap((t,i)=>t.mode===1?[i]:[]);
  distribute(ids,0,ids.length,values,spec.map(t=>t.mode===1?1:0),spec.map(t=>t.min),spec.map(t=>t.max),free);
}
function trackPositions(values,start,available,gap,align,spec){
  const count=visibleTracks(spec),free=Math.max(0,available-values.reduce((a,b)=>a+b,0)-gap*Math.max(0,count-1));
  let offset=align===1?free/2:align===2?free:align===4&&count?free/count/2:align===5?free/(count+1):0;
  const step=gap+(align===3&&count>1?free/(count-1):align===4&&count?free/count:align===5?free/(count+1):0),positions=[];let left=count;
  for(let i=0;i<values.length;i++){positions.push(start+offset);if(!spec[i].collapsed){offset+=values[i];if(--left>0)offset+=step;}}
  return positions;
}
export function layoutGrid(e,parent,ids,x,y,width,height){
  const d=e.data,r=e.rects,g=gridSizes(e,parent,ids,width,height);
  if(d.content[parent]===6)stretchTracks(g.heights,trackSpec(e,parent,g,1),height,g.crossGap);
  const xs=trackPositions(g.widths,x,width,g.gap,d.justify[parent],g.columnSpec),ys=trackPositions(g.heights,y,height,g.crossGap,d.content[parent],g.rowSpec);
  const rtl=e.resolvedDirection[parent],cells=[],baselines=new Map(),columnSpec=trackSpec(e,parent,g,0),rowSpec=trackSpec(e,parent,g,1);
  for(const p of g.placed){const i=p.i,ay=d.align[i]<0?d.items[parent]:d.align[i];if(ay===4&&p.rs===1)baselines.set(p.row,Math.max(baselines.get(p.row)||0,d.mt[i]+Math.min(preferred(e,i,1),d.baseline[i])));}
  for(const p of g.placed){const i=p.i,k=i*4,cw=Math.max(0,xs[p.col+p.cs-1]+g.widths[p.col+p.cs-1]-xs[p.col]),ch=Math.max(0,ys[p.row+p.rs-1]+g.heights[p.row+p.rs-1]-ys[p.row]);
    const aw=Math.max(0,cw-d.ml[i]-d.mr[i]),ah=Math.max(0,ch-d.mt[i]-d.mb[i]);
    const ax=d.self[i]<0?0:d.self[i],ay=d.align[i]<0?d.items[parent]:d.align[i];
    const w=clamp(d.wm[i]===2||ax===3?aw:preferred(e,i,0),d.minW[i],d.maxW[i]),h=clamp(d.hm[i]===2||ay===3?ah:preferred(e,i,1),d.minH[i],d.maxH[i]);
    r[k]=xs[p.col]+(rtl?d.mr[i]:d.ml[i])+(ax===1?(aw-w)/2:ax===2?aw-w:0);
    r[k+1]=ys[p.row]+(ay===4&&p.rs===1?(baselines.get(p.row)||0)-Math.min(h,d.baseline[i]):d.mt[i]+(ay===1?(ah-h)/2:ay===2?ah-h:0));r[k+2]=w;r[k+3]=h;
    if(rtl)r[k]=2*x+width-r[k]-w;
    cells.push({id:e.nodes[i].id,row:p.row,column:p.col,rowSpan:p.rs,columnSpan:p.cs,x:rtl?2*x+width-xs[p.col]-cw:xs[p.col],y:ys[p.row],width:cw,height:ch});
  }
  const snapshot=(spec,positions,values,axis)=>positions.map((start,i)=>({index:i,start:rtl&&!axis?2*x+width-start-values[i]:start,size:values[i],min:spec[i].min,max:spec[i].max,implicit:i>=(axis?g.explicitRows:g.explicitColumns),names:(axis?g.rowNames:g.columnNames)[i]?.slice()||[],endNames:(axis?g.rowNames:g.columnNames)[i+1]?.slice()||[],collapsed:!!spec[i].collapsed,autoRepeat:spec[i].autoRepeat||null,sourceIndex:spec[i].sourceIndex??-1}));
  e.pendingGridLayouts?.set(parent,{x,y,width,height,direction:rtl?'rtl':'ltr',columns:snapshot(columnSpec,xs,g.widths,0),rows:snapshot(rowSpec,ys,g.heights,1),cells});
}
/** Deterministic shortest-lane masonry, independent of the CSS Grid 3 draft.
 * The stacking axis is intrinsic/fixed; only the perpendicular axis has tracks.
 * Every candidate probe is bounded, and model/keyboard order is never changed. */
export function layoutMasonry(e,parent,ids,x,y,width,height,intrinsic=false){
  const d=e.data,r=e.rects,vertical=d.mode[parent]===6,axis=vertical?0:1,owner=parent===e.count?e.options:e.nodes[parent];
  const laneGap=d.gap[parent],stackGap=Number.isNaN(d.crossGap[parent])?laneGap:d.crossGap[parent],extent=vertical?width:height;
  if(owner.gridTemplateAreas.length)throw new RangeError('Masonry does not use rectangular grid areas');
  if(d.content[parent]>2)throw new RangeError('Masonry stacking alignment supports Start, Center or End');
  const spec=resolveTrackTemplate(e.tracks[parent][vertical?'columns':'rows'],extent,laneGap,e.resolvedVariables[parent]);
  if(!spec.length)spec.push(defaultTrack(0),defaultTrack(0));
  const names=lineNames(spec,new Map(),vertical?'column':'row');
  const entries=ids.map(i=>{const node=e.nodes[i];
    if(node.gridArea||(vertical?node.gridRowStart||node.gridRowEnd||d.row[i]>=0||d.rowSpan[i]!==1||d.hm[i]===2:node.gridColumnStart||node.gridColumnEnd||d.column[i]>=0||d.columnSpan[i]!==1||d.wm[i]===2))throw new RangeError('Masonry stacking axis must use fixed/Hug size without explicit cells or spans');
    const p=resolveAxisPlacement(vertical?node.gridColumnStart:node.gridRowStart,vertical?node.gridColumnEnd:node.gridRowEnd,vertical?d.column[i]:d.row[i],vertical?d.columnSpan[i]:d.rowSpan[i],names);
    const end=(p.coordinate<0?0:p.coordinate)+p.span;if(end>1024)throw new RangeError('Masonry lane budget exceeded');
    while(spec.length<end)spec.push(defaultTrack(0));
    return {i,lane:p.coordinate,span:p.span,size:clamp(preferred(e,i,1-axis),vertical?d.minH[i]:d.minW[i],vertical?d.maxH[i]:d.maxW[i])};
  });
  const skyline=new Float64Array(spec.length),occupied=new Uint8Array(spec.length);let probes=0,content=0;
  for(const entry of entries){let lane=entry.lane,level=Infinity;
    const first=lane<0?0:lane,last=lane<0?spec.length-entry.span:lane;
    // A monotonic deque computes all sliding range maxima in O(lane count).
    const deque=[];let head=0;
    for(let at=first;at<=last+entry.span-1;at++){
      if(++probes>8388608)throw new RangeError('Masonry search budget exceeded');
      while(deque.length>head&&skyline[deque.at(-1)]<=skyline[at])deque.pop();deque.push(at);
      const start=at-entry.span+1;if(start<first)continue;
      while(head<deque.length&&deque[head]<start)head++;
      const top=skyline[deque[head]];if(top<level){level=top;lane=start;}
    }
    entry.lane=lane;const i=entry.i,before=vertical?d.mt[i]:e.resolvedDirection[parent]?d.mr[i]:d.ml[i],after=vertical?d.mb[i]:e.resolvedDirection[parent]?d.ml[i]:d.mr[i];
    entry.position=level+before;const end=entry.position+entry.size+after;content=Math.max(content,end);
    skyline.fill(end+stackGap,lane,lane+entry.span);occupied.fill(1,lane,lane+entry.span);
  }
  spec.forEach((t,i)=>{t.collapsed=t.autoRepeat==='auto-fit'&&!occupied[i];if(t.collapsed)Object.assign(t,{mode:0,value:0,min:0,max:0});});
  const natural=spec.map(t=>t.mode===0?clamp(t.value,t.min,t.max):t.min),weights=spec.map(t=>t.mode===0?0:1),mins=spec.map(t=>t.min),maxs=spec.map(t=>t.max);
  for(const entry of entries){const i=entry.i,start=entry.lane,end=start+entry.span,desired=preferred(e,i,axis)+(vertical?d.ml[i]+d.mr[i]:d.mt[i]+d.mb[i]),used=natural.slice(start,end).reduce((a,b)=>a+b,0)+laneGap*(entry.span-1);
    if(desired>used)distribute(Array.from({length:entry.span},(_,n)=>start+n),0,entry.span,natural,weights,mins,maxs,desired-used);
  }
  const values=intrinsic?natural:resolveTracks(spec,natural,extent,laneGap),positions=trackPositions(values,vertical?x:y,extent,laneGap,d.justify[parent],spec);
  const minor=values.reduce((a,b)=>a+b,0)+laneGap*Math.max(0,visibleTracks(spec)-1),size={width:vertical?minor:content,height:vertical?content:minor};
  if(intrinsic)return size;
  const free=Math.max(0,(vertical?height:width)-content),offset=d.content[parent]===1?free/2:d.content[parent]===2?free:0,rtl=e.resolvedDirection[parent],cells=[];
  for(const entry of entries){const i=entry.i,k=i*4,start=entry.lane,end=start+entry.span-1,space=Math.max(0,positions[end]+values[end]-positions[start]);
    const before=vertical?(rtl?d.mr[i]:d.ml[i]):d.mt[i],after=vertical?(rtl?d.ml[i]:d.mr[i]):d.mb[i],available=Math.max(0,space-before-after),align=vertical?Math.max(0,d.self[i]):d.align[i]<0?d.items[parent]:d.align[i];
    const fill=(vertical?d.wm[i]:d.hm[i])===2,cross=clamp(fill||align===3?available:preferred(e,i,axis),vertical?d.minW[i]:d.minH[i],vertical?d.maxW[i]:d.maxH[i]);
    const position=positions[start]+before+(align===1?(available-cross)/2:align===2?available-cross:0);
    r[k]=vertical?position:x+entry.position+offset;r[k+1]=vertical?y+entry.position+offset:position;r[k+2]=vertical?cross:entry.size;r[k+3]=vertical?entry.size:cross;
    if(rtl)r[k]=2*x+width-r[k]-r[k+2];
    cells.push({id:e.nodes[i].id,lane:entry.lane,laneSpan:entry.span,x:r[k],y:r[k+1],width:r[k+2],height:r[k+3]});
  }
  const lanes=spec.map((t,i)=>({index:i,start:rtl&&vertical?2*x+width-positions[i]-values[i]:positions[i],size:values[i],min:t.min,max:t.max,collapsed:!!t.collapsed,autoRepeat:t.autoRepeat||null,sourceIndex:t.sourceIndex??-1,names:names[i]?.slice()||[]}));
  e.pendingMasonryLayouts?.set(parent,{x,y,width,height,orientation:vertical?'vertical':'horizontal',direction:rtl?'rtl':'ltr',contentWidth:size.width,contentHeight:size.height,lanes,cells,probes});return size;
}

/** Bottom-up preferred dimensions. Wrapped cross-axis sizes are recomputed
 * against allocated main-axis sizes, without ever overwriting authored bounds. */
export function measureTree(e,allocated){
  const d=e.data,r=e.rects,mw=e.measuredWidth,mh=e.measuredHeight;let changed=false;
  for(let q=e.order.length-1;q>=-1;q--){const i=q<0?e.count:e.order[q],mode=d.mode[i],ids=e.children[i].filter(j=>active(e,j));let w=d.preferredW[i],h=d.preferredH[i];if(d.rev[i]&&mode!==5)ids.reverse();
    if(!e.children[i].length&&e.nodes[i]?.measure&&(d.wm[i]===1||d.hm[i]===1)){
      const value=e.nodes[i].measure({width:allocated?r[i*4+2]:d.w[i],height:allocated?r[i*4+3]:d.h[i],widthMode:sizes[d.wm[i]],heightMode:sizes[d.hm[i]]});
      if(!value||typeof value!=='object')throw new TypeError('measure must return a preferred size');
      w=number(value.width,w,'measured width',0);h=number(value.height,h,'measured height',0);
      if(value.baseline!==undefined)d.baseline[i]=number(value.baseline,0,'measured baseline',0);
    }
    if(ids.length){
      const gap=d.gap[i],cg=Number.isNaN(d.crossGap[i])?gap:d.crossGap[i];
      if(mode>=6){const m=layoutMasonry(e,i,ids,0,0,Math.max(0,(allocated?r[i*4+2]:d.w[i])-d.pl[i]-d.pr[i]),Math.max(0,(allocated?r[i*4+3]:d.h[i])-d.pt[i]-d.pb[i]),true);w=m.width;h=m.height;}else if(mode===5){const g=gridSizes(e,i,ids,Math.max(0,(allocated?r[i*4+2]:d.w[i])-d.pl[i]-d.pr[i]),Math.max(0,(allocated?r[i*4+3]:d.h[i])-d.pt[i]-d.pb[i]),true);w=g.widths.reduce((a,b)=>a+b,0)+gap*Math.max(0,visibleTracks(g.columnSpec)-1);h=g.heights.reduce((a,b)=>a+b,0)+cg*Math.max(0,visibleTracks(g.rowSpec)-1);}
      else if(mode){const vertical=mode===2||mode===4,wrap=mode===3||mode===4,axis=vertical?1:0;
        const available=(vertical?d.hm[i]:d.wm[i])===1?Math.max(0,(vertical?d.maxH[i]:d.maxW[i])-(vertical?d.pt[i]+d.pb[i]:d.pl[i]+d.pr[i])):Math.max(0,(allocated?r[i*4+(vertical?3:2)]:(vertical?d.h[i]:d.w[i]))-(vertical?d.pt[i]+d.pb[i]:d.pl[i]+d.pr[i]));
        let used=0,lineCross=0,ascent=0,descent=0,maxMain=0,totalCross=0,lineCount=0,items=0;
        for(const j of ids){const main=preferred(e,j,axis)+(vertical?d.mt[j]+d.mb[j]:d.ml[j]+d.mr[j]),cross=preferred(e,j,1-axis)+(vertical?d.ml[j]+d.mr[j]:d.mt[j]+d.mb[j]);
          if(wrap&&items&&used+gap+main>available+1e-9){maxMain=Math.max(maxMain,used);totalCross+=Math.max(lineCross,ascent+descent)+(lineCount?cg:0);lineCount++;used=0;lineCross=0;ascent=descent=0;items=0;}
          used+=(items?gap:0)+main;lineCross=Math.max(lineCross,cross);if(!vertical&&(d.align[j]<0?d.items[i]:d.align[j])===4){const height=preferred(e,j,1),base=Math.min(height,d.baseline[j]);ascent=Math.max(ascent,d.mt[j]+base);descent=Math.max(descent,height-base+d.mb[j]);}items++;
        }
        maxMain=Math.max(0,maxMain,used);totalCross+=Math.max(lineCross,ascent+descent)+(lineCount?cg:0);w=vertical?totalCross:maxMain;h=vertical?maxMain:totalCross;
      }else{w=0;h=0;for(const j of ids){w=Math.max(w,d.x[j]+preferred(e,j,0)+d.mr[j]);h=Math.max(h,d.y[j]+preferred(e,j,1)+d.mb[j]);}}
      w+=d.pl[i]+d.pr[i];h+=d.pt[i]+d.pb[i];
    }else if(mode>=6){const m=layoutMasonry(e,i,ids,0,0,Math.max(0,(allocated?r[i*4+2]:d.w[i])-d.pl[i]-d.pr[i]),Math.max(0,(allocated?r[i*4+3]:d.h[i])-d.pt[i]-d.pb[i]),true);w=m.width+d.pl[i]+d.pr[i];h=m.height+d.pt[i]+d.pb[i];}else if(mode===5){const g=gridSizes(e,i,ids,Math.max(0,(allocated?r[i*4+2]:d.w[i])-d.pl[i]-d.pr[i]),Math.max(0,(allocated?r[i*4+3]:d.h[i])-d.pt[i]-d.pb[i]),true);w=g.widths.reduce((a,b)=>a+b,0)+g.gap*Math.max(0,visibleTracks(g.columnSpec)-1)+d.pl[i]+d.pr[i];h=g.heights.reduce((a,b)=>a+b,0)+g.crossGap*Math.max(0,visibleTracks(g.rowSpec)-1)+d.pt[i]+d.pb[i];}else if(mode){w=d.pl[i]+d.pr[i];h=d.pt[i]+d.pb[i];}
    w=clamp(d.wm[i]===1&&!ids.some(j=>d.wm[j]===2)?w:d.w[i],d.minW[i],d.maxW[i]);h=clamp(d.hm[i]===1&&!ids.some(j=>d.hm[j]===2)?h:d.h[i],d.minH[i],d.maxH[i]);
    if(d.wm[i]===1&&Math.abs(w-mw[i])>1e-7||d.hm[i]===1&&Math.abs(h-mh[i])>1e-7)changed=true;mw[i]=w;mh[i]=h;
  }
  return changed;
}
