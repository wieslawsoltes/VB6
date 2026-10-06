/** Intrinsic and two-dimensional layout. No DOM or renderer dependencies. */
export const advancedColumns=['wm','hm','ignore','items','content','crossGap','preferredW','preferredH','baseline','column','row','columnSpan','rowSpan','self'];
const alignments=['start','center','end','stretch','baseline'];
const distributions=['start','center','end','space-between','space-around','space-evenly','stretch'];
const sizes=['fixed','hug','fill'];
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function number(n,fallback,name,min=-Infinity,max=Infinity){if(n===undefined)return fallback;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw new RangeError('Invalid '+name);return n;}
function choice(v,values,fallback,name){if(v===undefined)return fallback;const i=typeof v==='number'?v:values.indexOf(v);if(!Number.isInteger(i)||i<0||i>=values.length)throw new RangeError('Invalid '+name);return i;}
function integer(v,fallback,name,min,max){v=number(v,fallback,name,min,max);if(!Number.isInteger(v))throw new RangeError('Invalid '+name);return v;}
export function normalizeAdvanced(n){
  const bounds=n.bounds||n;
  return {wm:choice(n.widthMode??n.wm,sizes,0,'widthMode'),hm:choice(n.heightMode??n.hm,sizes,0,'heightMode'),
    ignore:n.ignoreLayout===undefined?integer(n.ignore,0,'ignoreLayout',0,1):n.ignoreLayout===true?1:n.ignoreLayout===false?0:(()=>{throw new TypeError('ignoreLayout must be Boolean');})(),
    items:choice(n.alignItems??n.items,alignments,0,'alignItems'),content:choice(n.alignContent??n.content,distributions,0,'alignContent'),
    crossGap:n.crossGap===undefined?NaN:number(n.crossGap,0,'crossGap'),
    preferredW:number(n.preferredWidth,n.preferredW??bounds.width??0,'preferredWidth',0),preferredH:number(n.preferredHeight,n.preferredH??bounds.height??0,'preferredHeight',0),
    baseline:number(n.baseline,(bounds.height??0)*.8,'baseline',0),column:integer(n.gridColumn,-1,'gridColumn',0,1023),row:integer(n.gridRow,-1,'gridRow',0,262143),
    columnSpan:integer(n.columnSpan,1,'columnSpan',1,1024),rowSpan:integer(n.rowSpan,1,'rowSpan',1,1024),self:choice(n.justifySelf,alignments.slice(0,4),-1,'justifySelf')};
}
/** Track grammar: positive count; space-separated fixed/Hug/Nfr; or arrays.
 * Empty rows means implicit Hug rows; implicit columns use 1fr. */
export function normalizeTracks(value,fallback=0){
  if(value===undefined)value=fallback;
  if(typeof value==='number')return Array.from({length:integer(value,0,'track count',0,1024)},()=>({mode:2,value:1,min:0,max:Infinity}));
  if(typeof value==='string'){if(value.length>4096)throw new RangeError('Track definition exceeds 4096 characters');value=value.trim().startsWith('[')?JSON.parse(value):value.trim()?value.trim().split(/\s+/):[];}
  if(!Array.isArray(value)||value.length>1024)throw new TypeError('Expected at most 1024 grid tracks');
  return value.map(track=>{
    if(track&&typeof track==='object'){
      const min=number(track.min,0,'track min',0),max=track.max===Infinity?Infinity:number(track.max,Infinity,'track max',min);
      if(track.mode!==undefined){const mode=choice(track.mode,['fixed','hug','fill'],0,'track mode'),v=number(track.value,mode===2?1:0,'track value',0);if(mode===2&&!v)throw new RangeError('Fraction must be positive');return {mode,value:v,min,max};}
      const t=normalizeTracks([track.size??'1fr'])[0];return {...t,min,max};
    }
    if(typeof track==='number')return {mode:0,value:number(track,0,'fixed track',0),min:0,max:Infinity};
    if(typeof track==='string'){
      if(/^(hug|auto)$/i.test(track))return {mode:1,value:0,min:0,max:Infinity};
      if(/^(?:\d+(?:\.\d+)?|\.\d+)fr$/i.test(track)){const n=parseFloat(track);if(n>0&&Number.isFinite(n))return {mode:2,value:n,min:0,max:Infinity};}
      if(/^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/i.test(track))return {mode:0,value:number(parseFloat(track),0,'fixed track',0),min:0,max:Infinity};
    }
    throw new RangeError('Invalid grid track: '+String(track));
  });
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
function placements(e,parent,ids){
  e.gridCache ||= new Map();const cache=e.gridCache.get(parent);if(cache?.revision===e.revision)return cache;
  const d=e.data,columns=e.tracks[parent].columns.length||2,occupied=new Set(),placed=[];let cursor=0,rows=e.tracks[parent].rows.length,budget=0;
  const fits=(row,col,cs,rs)=>{if(col+cs>columns)return false;for(let r=row;r<row+rs;r++)for(let c=col;c<col+cs;c++)if(occupied.has(r*columns+c))return false;return true;};
  for(const i of ids){
    const cs=Math.min(columns,d.columnSpan[i]),rs=d.rowSpan[i];let row=d.row[i],col=d.column[i];
    if(col>=columns)col=columns-cs;else if(col>=0)col=Math.min(col,columns-cs);
    if(row<0&&col<0){while(!fits(Math.floor(cursor/columns),cursor%columns,cs,rs)){if(++cursor>1048576)throw new RangeError('Grid placement limit exceeded');}row=Math.floor(cursor/columns);col=cursor%columns;cursor+=cs;}
    else if(row<0){row=0;while(!fits(row,col,cs,rs))if(++row>262144)throw new RangeError('Grid placement limit exceeded');}
    else if(col<0){col=0;while(!fits(row,col,cs,rs)){if(++col>=columns){col=0;row++;}if(row*columns>1048576)throw new RangeError('Grid placement limit exceeded');}}
    if(row+rs>262144||(budget+=cs*rs)>1048576)throw new RangeError('Grid cell budget exceeded');
    for(let r=row;r<row+rs;r++)for(let c=col;c<col+cs;c++)occupied.add(r*columns+c);
    placed.push({i,row,col,cs,rs});rows=Math.max(rows,row+rs);
  }
  const result={revision:e.revision,columns,rows,placed};e.gridCache.set(parent,result);return result;
}
function naturalTracks(e,parent,grid,axis){
  const d=e.data,count=axis?grid.rows:grid.columns,spec=e.tracks[parent][axis?'rows':'columns'],gap=axis?(Number.isNaN(d.crossGap[parent])?d.gap[parent]:d.crossGap[parent]):d.gap[parent];
  const values=Array.from({length:count},(_,i)=>{const t=spec[i];return t?.mode===0?clamp(t.value,t.min,t.max):t?.min||0;});
  // Non-spanning requirements establish minima before spanning distribution.
  for(const spanning of [false,true])for(const p of grid.placed){const at=axis?p.row:p.col,span=axis?p.rs:p.cs;if((span>1)!==spanning)continue;
    const i=p.i,desired=preferred(e,i,axis)+(axis?d.mt[i]+d.mb[i]:d.ml[i]+d.mr[i]);let used=gap*(span-1),flex=0;
    for(let j=at;j<at+span;j++){used+=values[j];if(spec[j]?.mode!==0)flex++;}
    if(desired>used&&flex)for(let j=at;j<at+span;j++)if(spec[j]?.mode!==0)values[j]=clamp(values[j]+(desired-used)/flex,spec[j]?.min||0,spec[j]?.max??Infinity);
  }
  return values;
}
function resolveTracks(spec,natural,available,gap){
  const values=natural.map((n,i)=>{const t=spec[i]||{mode:1,min:0,max:Infinity};return t.mode===0?clamp(t.value,t.min,t.max):t.mode===1?clamp(n,t.min,t.max):t.min;});
  const ids=[],events=[];let fixed=gap*Math.max(0,values.length-1),minimum=0,scale=0;
  for(const t of spec)if(t.mode===2)scale=Math.max(scale,t.value);
  for(let i=0;i<values.length;i++){const t=spec[i];if(t?.mode===2){ids.push(i);minimum+=t.min;const w=t.value/scale;if(!w)continue;events.push({at:t.min/w,weight:w});if(Number.isFinite(t.max))events.push({at:t.max/w,weight:-w});}else fixed+=values[i];}
  const budget=available-fixed;if(!ids.length||budget<=minimum)return values;
  events.sort((a,b)=>a.at-b.at);let used=minimum,level=0,weight=0,found=false;
  for(const ev of events){const delta=(ev.at-level)*weight;if(weight>0&&used+delta>=budget){level+=(budget-used)/weight;found=true;break;}used+=delta;level=ev.at;weight+=ev.weight;}
  if(!found&&weight>0)level+=(budget-used)/weight;
  for(const i of ids){const t=spec[i];values[i]=clamp(level*(t.value/scale),t.min,t.max);}return values;
}
function gridSizes(e,parent,ids,width,height,intrinsic=false){
  const d=e.data,grid=placements(e,parent,ids),gap=d.gap[parent],crossGap=Number.isNaN(d.crossGap[parent])?gap:d.crossGap[parent];
  const nw=naturalTracks(e,parent,grid,0),nh=naturalTracks(e,parent,grid,1);
  return {...grid,gap,crossGap,widths:intrinsic?nw:resolveTracks(e.tracks[parent].columns,nw,width,gap),heights:intrinsic?nh:resolveTracks(e.tracks[parent].rows,nh,height,crossGap)};
}
export function layoutGrid(e,parent,ids,x,y,width,height){
  const d=e.data,r=e.rects,g=gridSizes(e,parent,ids,width,height),xs=[x],ys=[y];
  for(const w of g.widths)xs.push(xs.at(-1)+w+g.gap);for(const h of g.heights)ys.push(ys.at(-1)+h+g.crossGap);
  for(const p of g.placed){const i=p.i,k=i*4,aw=Math.max(0,xs[p.col+p.cs]-xs[p.col]-g.gap-d.ml[i]-d.mr[i]),ah=Math.max(0,ys[p.row+p.rs]-ys[p.row]-g.crossGap-d.mt[i]-d.mb[i]);
    const ax=d.self[i]<0?Math.min(2,d.justify[parent]):d.self[i],ay=d.align[i]<0?d.items[parent]:d.align[i];
    const w=clamp(d.wm[i]===2||ax===3?aw:preferred(e,i,0),d.minW[i],d.maxW[i]),h=clamp(d.hm[i]===2||ay===3?ah:preferred(e,i,1),d.minH[i],d.maxH[i]);
    r[k]=xs[p.col]+d.ml[i]+(ax===1?(aw-w)/2:ax===2?aw-w:0);r[k+1]=ys[p.row]+d.mt[i]+(ay===1?(ah-h)/2:ay===2?ah-h:0);r[k+2]=w;r[k+3]=h;
  }
}
/** Bottom-up preferred dimensions. Wrapped cross-axis sizes are recomputed
 * against allocated main-axis sizes, without ever overwriting authored bounds. */
export function measureTree(e,allocated){
  const d=e.data,r=e.rects,mw=e.measuredWidth,mh=e.measuredHeight;let changed=false;
  for(let q=e.order.length-1;q>=-1;q--){const i=q<0?e.count:e.order[q],mode=d.mode[i],ids=e.children[i].filter(j=>active(e,j));let w=d.preferredW[i],h=d.preferredH[i];
    if(!e.children[i].length&&e.nodes[i]?.measure&&(d.wm[i]===1||d.hm[i]===1)){
      const value=e.nodes[i].measure({width:allocated?r[i*4+2]:d.w[i],height:allocated?r[i*4+3]:d.h[i],widthMode:sizes[d.wm[i]],heightMode:sizes[d.hm[i]]});
      if(!value||typeof value!=='object')throw new TypeError('measure must return a preferred size');
      w=number(value.width,w,'measured width',0);h=number(value.height,h,'measured height',0);
      if(value.baseline!==undefined)d.baseline[i]=number(value.baseline,0,'measured baseline',0);
    }
    if(ids.length){
      const gap=d.gap[i],cg=Number.isNaN(d.crossGap[i])?gap:d.crossGap[i];
      if(mode===5){const g=gridSizes(e,i,ids,0,0,true);w=g.widths.reduce((a,b)=>a+b,0)+gap*Math.max(0,g.columns-1);h=g.heights.reduce((a,b)=>a+b,0)+cg*Math.max(0,g.rows-1);}
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
    }else if(mode){w=d.pl[i]+d.pr[i];h=d.pt[i]+d.pb[i];}
    w=clamp(d.wm[i]===1&&!ids.some(j=>d.wm[j]===2)?w:d.w[i],d.minW[i],d.maxW[i]);h=clamp(d.hm[i]===1&&!ids.some(j=>d.hm[j]===2)?h:d.h[i],d.minH[i],d.maxH[i]);
    if(d.wm[i]===1&&Math.abs(w-mw[i])>1e-7||d.hm[i]===1&&Math.abs(h-mh[i])>1e-7)changed=true;mw[i]=w;mh[i]=h;
  }
  return changed;
}
