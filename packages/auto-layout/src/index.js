import {advancedColumns,normalizeAdvanced,normalizeTracks,measureTree,layoutGrid,distribute} from './advanced.js';
/**
 * Renderer-independent layout in arbitrary logical units. No DOM, global state,
 * clock, or dependencies. Baselines never change as a side effect of arrange().
 */
export const AnchorStyles = Object.freeze({None:0, Top:1, Bottom:2, Left:4, Right:8, All:15});
export const DockStyle = Object.freeze({None:0, Top:1, Bottom:2, Left:3, Right:4, Fill:5});
export const LayoutMode = Object.freeze({Absolute:0, Horizontal:1, Vertical:2, Wrap:3, VerticalWrap:4, Grid:5});
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
function finite(v, fallback = 0, label = 'geometry') {
  if (v === undefined) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`${label} must be finite`);
  return v;
}
function nonnegative(v, fallback = 0, label = 'size') {
  v = finite(v, fallback, label);
  if (v < 0) throw new RangeError(`${label} must be nonnegative`);
  return v;
}
function enumeration(value, values, fallback, label) {
  if (value === undefined) return fallback;
  if (typeof value === 'string') {
    const key = Object.keys(values).find(k => k.toLowerCase() === value.toLowerCase());
    if (key !== undefined) return values[key];
  }
  if (Number.isInteger(value) && Object.values(values).includes(value)) return value;
  throw new RangeError(`Invalid ${label}: ${String(value)}`);
}
export function parseAnchor(value = 5) {
  if (typeof value === 'string') {
    if (/^\d+$/.test(value.trim())) return parseAnchor(Number(value));
    let bits = 0;
    const names = value.split(/\s*(?:,|\||\bOr\b)\s*/i);
    if (!names.length) throw new RangeError('Invalid Anchor');
    for (let name of names) {
      name = name.trim().replace(/^(?:AnchorStyles\.|vbAnchor)/i,'');
      const key = Object.keys(AnchorStyles).find(k => k.toLowerCase() === name.toLowerCase());
      if (key === undefined) throw new RangeError(`Invalid Anchor edge: ${name}`);
      bits |= AnchorStyles[key];
    }
    return bits;
  }
  if (!Number.isInteger(value) || value < 0 || value > 15) throw new RangeError('Anchor must be an integer from 0 to 15');
  return value;
}
export function formatAnchor(value) {
  const bits = parseAnchor(value);
  return ['Top','Bottom','Left','Right'].filter(k => bits & AnchorStyles[k]).join(', ') || 'None';
}
export function parseDock(value) { return enumeration(value,DockStyle,0,'Dock'); }
export function parseLayoutMode(value) { return enumeration(value,LayoutMode,0,'LayoutMode'); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function limitPair(min, max, label) {
  min = nonnegative(min,0,`min${label}`);
  max = max === undefined || max === 0 || max === Infinity ? Infinity : nonnegative(max,0,`max${label}`);
  if (max < min) throw new RangeError(`max${label} must be >= min${label}`);
  return [min,max];
}
function box(v = 0, label = 'insets') {
  if (typeof v === 'number') { v = nonnegative(v,0,label); return [v,v,v,v]; }
  if (Array.isArray(v)) {
    if (![1,2,4].includes(v.length)) throw new RangeError(`${label} needs 1, 2 or 4 values`);
    const a = v.map(x => nonnegative(x,0,label));
    return a.length === 1 ? [a[0],a[0],a[0],a[0]] : a.length === 2 ? [a[0],a[1],a[0],a[1]] : a;
  }
  if (v && typeof v === 'object') return ['top','right','bottom','left'].map(k => nonnegative(v[k],0,label));
  throw new TypeError(`Invalid ${label}`);
}
/** All coordinates refer to the parent's client rectangle, not its outer frame. */
export function solveAnchor(bounds, baselineClient, client, anchor = 5, limits = {}, out = {}) {
  const mask = parseAnchor(anchor), x = finite(bounds.x), y = finite(bounds.y);
  const w = nonnegative(bounds.width), h = nonnegative(bounds.height);
  const bw = nonnegative(baselineClient.width), bh = nonnegative(baselineClient.height);
  const [minW,maxW] = limitPair(limits.minWidth,limits.maxWidth,'Width');
  const [minH,maxH] = limitPair(limits.minHeight,limits.maxHeight,'Height');
  const dx = nonnegative(client.width) - bw, dy = nonnegative(client.height) - bh;
  const dw = clamp(w + ((mask & 12) === 12 ? dx : 0),minW,maxW);
  const dh = clamp(h + ((mask & 3) === 3 ? dy : 0),minH,maxH);
  out.x = x + finite(client.x) - finite(baselineClient.x) + ((mask & 4) ? 0 : (mask & 8) ? dx + w - dw : (dx + w - dw)/2);
  out.y = y + finite(client.y) - finite(baselineClient.y) + ((mask & 1) ? 0 : (mask & 2) ? dy + h - dh : (dy + h - dh)/2);
  out.width = dw; out.height = dh;
  return out;
}

// Numeric columns (structure of arrays) keep the hot anchoring pass allocation-free.
const COLS = ['x','y','w','h','bw','bh','anchor','dock','mode','minW','minH','maxW','maxH',
  'pt','pr','pb','pl','mt','mr','mb','ml','gap','grow','shrink','basis','align','justify',...advancedColumns];
const aligns = ['start','center','end','stretch','baseline'];
const justifies = ['start','center','end','space-between','space-around','space-evenly'];
function named(value, values, fallback, label) {
  if(value===undefined)return fallback;
  const n = values.indexOf(value);
  if (n < 0) throw new RangeError(`Invalid ${label}: ${String(value)}`);
  return n;
}
function normalizeNode(n,parentWidth,parentHeight) {
  const b=n.bounds||n,v={};
  if(n.measure!==undefined&&typeof n.measure!=='function')throw new TypeError('measure must be a function');
  v.x=finite(b.x);v.y=finite(b.y);v.w=nonnegative(b.width);v.h=nonnegative(b.height);
  v.bw=nonnegative(n.baselineWidth,parentWidth);v.bh=nonnegative(n.baselineHeight,parentHeight);
  v.anchor=parseAnchor(n.anchor);v.dock=parseDock(n.dock);v.mode=parseLayoutMode(n.layout);
  [v.minW,v.maxW]=limitPair(n.minWidth,n.maxWidth,'Width');[v.minH,v.maxH]=limitPair(n.minHeight,n.maxHeight,'Height');
  [v.pt,v.pr,v.pb,v.pl]=box(n.padding,'padding');[v.mt,v.mr,v.mb,v.ml]=box(n.margin,'margin');
  v.gap=finite(n.gap);v.grow=nonnegative(n.grow);v.shrink=nonnegative(n.shrink,1);
  v.basis=n.basis===undefined?-1:nonnegative(n.basis);v.align=named(n.align,aligns,-1,'align');v.justify=named(n.justify,justifies,0,'justify');
  return Object.assign(v,normalizeAdvanced(n));
}
/**
 * A compiled, mutable layout tree. IDs may be strings or numbers. Parent IDs must
 * exist; roots use parent:null. Rectangles are parent-local, in the caller's units.
 *
 * arrange() returns the same reusable result object. Copy its buffers to retain
 * an old frame. Changes are indices in topological order. No pixel rounding is
 * applied: renderers round only at the final raster boundary.
 */
export class LayoutEngine {
  constructor(nodes = [], options = {}) {
    this.options = {width:nonnegative(options.width),height:nonnegative(options.height),padding:box(options.padding),layout:parseLayoutMode(options.layout),gap:finite(options.gap),justify:named(options.justify,justifies,0,'justify'),...normalizeAdvanced(options),columns:normalizeTracks(options.columns,2),rows:normalizeTracks(options.rows,0)};
    this.revision = 0;
    this.setNodes(nodes);
  }
  setNodes(nodes) {
    if(this.solving)throw new Error('Layout mutation is not allowed during intrinsic measurement');
    if (!Array.isArray(nodes)) throw new TypeError('nodes must be an array');
    const count = nodes.length, index = new Map(), records = new Array(count);
    const children = Array.from({length:count+1},()=>[]), parents = new Int32Array(count);
    for (let i=0;i<count;i++) {
      const n = nodes[i];
      if (!n || !['string','number'].includes(typeof n.id) || (typeof n.id === 'number' && !Number.isFinite(n.id))) throw new TypeError('Each node needs a finite numeric or string id');
      if (index.has(n.id)) throw new Error(`Duplicate layout id: ${n.id}`);
      index.set(n.id,i); records[i] = {...n,bounds:{...(n.bounds||n)},...(n.padding&&typeof n.padding==='object'?{padding:Array.isArray(n.padding)?n.padding.slice():{...n.padding}}:{}),...(n.margin&&typeof n.margin==='object'?{margin:Array.isArray(n.margin)?n.margin.slice():{...n.margin}}:{})};
    }
    for (let i=0;i<count;i++) {
      const p = records[i].parent;
      const pi = p === undefined || p === null ? count : index.get(p);
      if (pi === undefined) throw new Error(`Missing layout parent: ${p}`);
      parents[i] = pi; children[pi].push(i);
    }
    // Breadth-first topological order is iterative, even for very deep trees.
    const order = children[count].slice();
    for (let q=0;q<order.length;q++) for (const c of children[order[q]]) order.push(c);
    if (order.length !== count) throw new Error('Cyclic layout parent relationship');
    const tracks=records.map(n=>({columns:normalizeTracks(n.columns,2),rows:normalizeTracks(n.rows,0)}));
    records.forEach((n,i)=>{n.columns=tracks[i].columns.map(t=>({...t}));n.rows=tracks[i].rows.map(t=>({...t}));});
    const data = Object.fromEntries(COLS.map(k=>[k,new Float64Array(count+1)]));
    const visible = new Uint8Array(count), participant = new Uint8Array(count);
    const opt = this.options;
    data.w[count]=opt.width; data.h[count]=opt.height; data.mode[count]=parseLayoutMode(opt.layout); data.gap[count]=finite(opt.gap); data.justify[count]=typeof opt.justify==='number'?opt.justify:named(opt.justify,justifies,0,'justify');
    [data.pt[count],data.pr[count],data.pb[count],data.pl[count]]=opt.padding;
    for(const col of advancedColumns)data[col][count]=opt[col];
    tracks.push({columns:normalizeTracks(opt.columns,2),rows:normalizeTracks(opt.rows,0)});
    data.maxW.fill(Infinity); data.maxH.fill(Infinity);
    for (const i of order) {
      const n=records[i],p=parents[i],v=normalizeNode(n,Math.max(0,data.w[p]-data.pl[p]-data.pr[p]),Math.max(0,data.h[p]-data.pt[p]-data.pb[p]));
      for(const col of COLS)data[col][i]=v[col];
      visible[i]=n.visible!==false?1:0;participant[i]=n.participate!==false?1:0;
    }
    // Publish only after validation; a failed setNodes leaves the old tree usable.
    this.nodes=records;this.index=index;this.children=children;this.parents=parents;
    this.gridCache=new Map();this.tracks=tracks;this.hugCount=records.reduce((sum,_,i)=>sum+(data.wm[i]===1||data.hm[i]===1?1:0),data.wm[count]===1||data.hm[count]===1?1:0);
    this.order=Int32Array.from(order);this.data=data;this.visible=visible;this.participant=participant;this.count=count;
    this.rects=new Float64Array((count+1)*4);this.rollback=new Float64Array((count+1)*4);this.previous=new Float64Array(count*4);this.previous.fill(NaN);
    this.changed=new Int32Array(count);this.work=new Float64Array(count);this.flex=new Float64Array(count);this.frozen=new Uint8Array(count);
    this.flow=[];this.stack=[];this.breaks=[];this.measuredWidth=new Float64Array(count+1);this.measuredHeight=new Float64Array(count+1);this.result={rects:this.rects,changed:this.changed,changedCount:0,visited:0,passes:0,revision:++this.revision};
    this.dirty=true;this.lastWidth=NaN;this.lastHeight=NaN;
    return this;
  }
  /** An explicit application/user edit; never call this for solver-produced bounds. */
  update(id, patch) {
    if(this.solving)throw new Error('Layout mutation is not allowed during intrinsic measurement');
    const i=this.index.get(id);if(i===undefined)throw new Error(`Unknown layout id: ${id}`);
    const old=this.nodes[i],d=this.data;
    const next={...old,baselineWidth:d.bw[i],baselineHeight:d.bh[i],...patch,bounds:{...old.bounds,...patch.bounds}};
    if(next.id!==old.id||next.parent!==old.parent){
      const nodes=this.nodes.map((n,j)=>({...n,baselineWidth:d.bw[j],baselineHeight:d.bh[j]}));
      if(next.parent!==old.parent){const p=next.parent==null?this.count:this.index.get(next.parent);if(p===undefined)throw new Error(`Missing layout parent: ${next.parent}`);next.baselineWidth=patch.baselineWidth??Math.max(0,this.rects[p*4+2]-d.pl[p]-d.pr[p]);next.baselineHeight=patch.baselineHeight??Math.max(0,this.rects[p*4+3]-d.pt[p]-d.pb[p]);}
      nodes[i]=next;return this.setNodes(nodes);
    }
    // Validate a detached record completely before changing any live column.
    if(next.padding&&typeof next.padding==='object')next.padding=Array.isArray(next.padding)?next.padding.slice():{...next.padding};
    if(next.margin&&typeof next.margin==='object')next.margin=Array.isArray(next.margin)?next.margin.slice():{...next.margin};
    const v=normalizeNode(next,next.baselineWidth,next.baselineHeight),track={columns:normalizeTracks(next.columns,2),rows:normalizeTracks(next.rows,0)};
    next.columns=track.columns.map(t=>({...t}));next.rows=track.rows.map(t=>({...t}));
    this.hugCount+=(v.wm===1||v.hm===1?1:0)-(d.wm[i]===1||d.hm[i]===1?1:0);this.tracks[i]=track;
    for(const col of COLS)d[col][i]=v[col];this.visible[i]=next.visible!==false?1:0;this.participant[i]=next.participate!==false?1:0;
    this.nodes[i]=next;this.dirty=true;this.revision++;return this;
  }
  /** Change root configuration without reallocating the graph or result buffers. */
  configure(patch={}) {
    if(this.solving)throw new Error('Layout mutation is not allowed during intrinsic measurement');
    const o=this.options,n=this.count,d=this.data;
    const next={width:nonnegative(patch.width,o.width),height:nonnegative(patch.height,o.height),padding:patch.padding===undefined?o.padding:box(patch.padding),layout:patch.layout===undefined?o.layout:parseLayoutMode(patch.layout),gap:finite(patch.gap,o.gap),...normalizeAdvanced({...o,...patch,crossGap:own(patch,'crossGap')?patch.crossGap:(Number.isNaN(o.crossGap)?undefined:o.crossGap)}),columns:normalizeTracks(patch.columns===undefined?o.columns:patch.columns,2),rows:normalizeTracks(patch.rows===undefined?o.rows:patch.rows,0),justify:patch.justify===undefined?o.justify:named(patch.justify,justifies,0,'justify')};
    this.hugCount+=(next.wm===1||next.hm===1?1:0)-(d.wm[n]===1||d.hm[n]===1?1:0);this.options=next;this.tracks[n]={columns:next.columns,rows:next.rows};for(const col of advancedColumns)d[col][n]=next[col];d.mode[n]=next.layout;d.gap[n]=next.gap;d.justify[n]=next.justify;[d.pt[n],d.pr[n],d.pb[n],d.pl[n]]=next.padding;this.dirty=true;this.revision++;return this;
  }
  rebase(id, bounds, client) {
    const patch={bounds:{...bounds}};
    if (client) {patch.baselineWidth=client.width;patch.baselineHeight=client.height;}
    return this.update(id,patch);
  }
  getBounds(id, out={}) {
    const i=this.index.get(id);if(i===undefined)throw new Error(`Unknown layout id: ${id}`);
    const k=i*4,r=this.rects;out.x=r[k];out.y=r[k+1];out.width=r[k+2];out.height=r[k+3];return out;
  }
  getRootBounds(out={}) {const k=this.count*4,r=this.rects;return Object.assign(out,{x:r[k],y:r[k+1],width:r[k+2],height:r[k+3]});}
  arrange(width=this.options.width,height=this.options.height) {
    if(this.solving)throw new Error('Layout mutation is not allowed during intrinsic measurement');
    width=nonnegative(width);height=nonnegative(height);
    const result=this.result;result.changedCount=0;result.visited=0;result.passes=0;
    if (!this.dirty && width===this.lastWidth && height===this.lastHeight) return result;
    const d=this.data,r=this.rects,n=this.count,root=n*4;
    const guarded=this.hugCount||d.mode.includes(5);
    if(guarded)this.rollback.set(r);
    d.w[n]=width;d.h[n]=height;r[root]=0;r[root+1]=0;r[root+2]=width;r[root+3]=height;
    // Intrinsic trees converge bottom-up against the final constrained wrap/grid
    // widths. The ordinary anchor path never enters the measurement loop.
    result.passes=1;
    this.solving=true;
    try {
    if(this.hugCount)measureTree(this,false);
    for(let pass=0;;pass++) {
      if(d.wm[n]===1)r[root+2]=this.measuredWidth[n];if(d.hm[n]===1)r[root+3]=this.measuredHeight[n];
      this.layoutChildren(n);
      for(const i of this.order)if(this.children[i].length)this.layoutChildren(i);
      if(!this.hugCount||!measureTree(this,true))break;
      result.passes++;
      if(pass>=Math.min(this.count+1,127))throw new Error('Intrinsic layout did not converge; fix a cyclic Hug/Fill or wrap constraint');
    }
    } catch(error) {if(guarded)r.set(this.rollback);this.dirty=true;throw error;}finally{this.solving=false;}
    for (const i of this.order) {
      const k=i*4;result.visited++;
      if (r[k]!==this.previous[k]||r[k+1]!==this.previous[k+1]||r[k+2]!==this.previous[k+2]||r[k+3]!==this.previous[k+3]) {
        this.changed[result.changedCount++]=i;
        this.previous[k]=r[k];this.previous[k+1]=r[k+1];this.previous[k+2]=r[k+2];this.previous[k+3]=r[k+3];
      }
    }
    this.dirty=false;this.lastWidth=width;this.lastHeight=height;result.revision=this.revision;
    return result;
  }
  layoutChildren(parent) {
    const d=this.data,r=this.rects,p=parent*4,ids=this.children[parent];
    const ox=d.pl[parent],oy=d.pt[parent];
    const cw=Math.max(0,r[p+2]-ox-d.pr[parent]),ch=Math.max(0,r[p+3]-oy-d.pb[parent]);
    let left=ox,top=oy,right=ox+cw,bottom=oy+ch;
    const flow=this.flow;flow.length=0;
    // Dock consumes client space in declaration order. Fill sees space remaining
    // at its position. Adapters may reverse z-order before compiling for WinForms.
    for (const i of ids) {
      const k=i*4,a=d.anchor[i],dock=d.dock[i];
      const bw=d.wm[i]===1?this.measuredWidth[i]:d.w[i],bh=d.hm[i]===1?this.measuredHeight[i]:d.h[i];
      let w=clamp(bw,d.minW[i],d.maxW[i]),h=clamp(bh,d.minH[i],d.maxH[i]),x=d.x[i],y=d.y[i];
      if (!this.participant[i]) {r[k]=x;r[k+1]=y;r[k+2]=w;r[k+3]=h;continue;}
      if (dock && this.visible[i]) {
        const aw=Math.max(0,right-left),ah=Math.max(0,bottom-top);
        if (dock===1||dock===2||dock===5) w=clamp(aw,d.minW[i],d.maxW[i]);
        if (dock===3||dock===4||dock===5) h=clamp(ah,d.minH[i],d.maxH[i]);
        x=left;y=top;
        if(dock===1)top=Math.min(bottom,top+h);
        else if(dock===2){y=bottom-h;bottom=Math.max(top,bottom-h);}
        else if(dock===3)left=Math.min(right,left+w);
        else if(dock===4){x=right-w;right=Math.max(left,right-w);}
      } else if (d.mode[parent] && this.visible[i] && !dock && !d.ignore[i]) {
        flow.push(i);continue;
      } else {
        const dx=cw-d.bw[i],dy=ch-d.bh[i];
        w=clamp(bw+((a&12)===12&&d.wm[i]!==1?dx:0),d.minW[i],d.maxW[i]);
        h=clamp(bh+((a&3)===3&&d.hm[i]!==1?dy:0),d.minH[i],d.maxH[i]);
        x+=((a&4)?0:(a&8)?dx+bw-w:(dx+bw-w)/2);
        y+=((a&1)?0:(a&2)?dy+bh-h:(dy+bh-h)/2);
      }
      r[k]=x;r[k+1]=y;r[k+2]=w;r[k+3]=h;
    }
    if(flow.length){const args=[parent,flow,left,top,Math.max(0,right-left),Math.max(0,bottom-top)];if(d.mode[parent]===5)layoutGrid(this,...args);else this.layoutFlow(...args);}
  }
  preferred(i,vertical) {const d=this.data;return vertical?(d.hm[i]===1?this.measuredHeight[i]:d.h[i]):(d.wm[i]===1?this.measuredWidth[i]:d.w[i]);}
  layoutFlow(parent,ids,x,y,width,height) {
    const d=this.data,vertical=d.mode[parent]===2||d.mode[parent]===4,wrap=d.mode[parent]===3||d.mode[parent]===4;
    const main=vertical?height:width,cross=vertical?width:height,gap=d.gap[parent],crossGap=Number.isNaN(d.crossGap[parent])?gap:d.crossGap[parent];
    const lines=this.stack;lines.length=0;let begin=0,used=0,lineCross=0,ascent=0,descent=0;
    for(let j=0;j<ids.length;j++) {
      const i=ids[j],base=d.basis[i]<0?this.preferred(i,vertical):d.basis[i];
      const size=clamp(base,vertical?d.minH[i]:d.minW[i],vertical?d.maxH[i]:d.maxW[i]);
      const margins=vertical?d.mt[i]+d.mb[i]:d.ml[i]+d.mr[i];
      const c=clamp(this.preferred(i,!vertical),vertical?d.minW[i]:d.minH[i],vertical?d.maxW[i]:d.maxH[i])+(vertical?d.ml[i]+d.mr[i]:d.mt[i]+d.mb[i]);
      if(wrap&&j>begin&&used+gap+size+margins>main+1e-9){lines.push(begin,j,Math.max(lineCross,ascent+descent));begin=j;used=0;lineCross=0;ascent=descent=0;}
      used+=(j>begin?gap:0)+size+margins;lineCross=Math.max(lineCross,c);if(!vertical&&(d.align[i]<0?d.items[parent]:d.align[i])===4){const height=this.preferred(i,true),base=Math.min(height,d.baseline[i]);ascent=Math.max(ascent,d.mt[i]+base);descent=Math.max(descent,height-base+d.mb[i]);}
    }
    lines.push(begin,ids.length,wrap?Math.max(lineCross,ascent+descent):cross);
    const count=lines.length/3,total=lines.reduce((sum,v,i)=>sum+(i%3===2?v:0),0)+crossGap*(count-1),free=Math.max(0,cross-total),align=d.content[parent];
    let pos=align===1?free/2:align===2?free:align===4?free/count/2:align===5?free/(count+1):0;
    const step=crossGap+(align===3&&count>1?free/(count-1):align===4?free/count:align===5?free/(count+1):0);
    for(let j=0;j<lines.length;j+=3){const size=lines[j+2]+(align===6?free/count:0);this.layoutLine(parent,ids,lines[j],lines[j+1],x+(vertical?pos:0),y+(vertical?0:pos),main,size,vertical);pos+=size+step;}
  }
  layoutLine(parent,ids,begin,end,x,y,main,cross,vertical) {
    const d=this.data,r=this.rects,s=this.work,weights=this.flex,frozen=this.frozen,gap=d.gap[parent];
    let occupied=gap*Math.max(0,end-begin-1);
    for(let j=begin;j<end;j++) {
      const i=ids[j],fill=(vertical?d.hm[i]:d.wm[i])===2,base=fill?0:d.basis[i]<0?this.preferred(i,vertical):d.basis[i];
      s[i]=clamp(base,vertical?d.minH[i]:d.minW[i],vertical?d.maxH[i]:d.maxW[i]);
      occupied+=s[i]+(vertical?d.mt[i]+d.mb[i]:d.ml[i]+d.mr[i]);frozen[i]=0;
    }
    let free=main-occupied;const growing=free>=0;let shrinkScale=1,sizeScale=1;
    if(!growing)for(let j=begin;j<end;j++){const i=ids[j];shrinkScale=Math.max(shrinkScale,d.shrink[i]);sizeScale=Math.max(sizeScale,s[i]);}
    for(let j=begin;j<end;j++){const i=ids[j],fill=(vertical?d.hm[i]:d.wm[i])===2;weights[i]=growing?(fill?d.grow[i]||1:d.grow[i]):(d.shrink[i]/shrinkScale)*(s[i]/sizeScale);}
    distribute(ids,begin,end,s,weights,vertical?d.minH:d.minW,vertical?d.maxH:d.maxW,free,this.breaks);
    let used=gap*Math.max(0,end-begin-1);
    for(let j=begin;j<end;j++){const i=ids[j];used+=s[i]+(vertical?d.mt[i]+d.mb[i]:d.ml[i]+d.mr[i]);}
    const remaining=Math.max(0,main-used),count=end-begin,justify=d.justify[parent];
    let step=gap,pos=0;
    if(justify===1)pos=remaining/2;
    else if(justify===2)pos=remaining;
    else if(justify===3&&count>1)step+=remaining/(count-1);
    else if(justify===4){step+=remaining/count;pos=remaining/count/2;}
    else if(justify===5){step+=remaining/(count+1);pos=remaining/(count+1);}
    let baseline=0;
    if(!vertical)for(let j=begin;j<end;j++){const i=ids[j],a=d.align[i]<0?d.items[parent]:d.align[i];if(a===4)baseline=Math.max(baseline,d.mt[i]+Math.min(this.preferred(i,true),d.baseline[i]));}
    for(let j=begin;j<end;j++) {
      const i=ids[j],k=i*4,start=vertical?d.mt[i]:d.ml[i],finish=vertical?d.mb[i]:d.mr[i];
      const cstart=vertical?d.ml[i]:d.mt[i],cend=vertical?d.mr[i]:d.mb[i],available=Math.max(0,cross-cstart-cend);
      const align=d.align[i]<0?d.items[parent]:d.align[i],base=this.preferred(i,!vertical),fill=(vertical?d.wm[i]:d.hm[i])===2;
      const cs=clamp(align===3||fill?available:base,vertical?d.minW[i]:d.minH[i],vertical?d.maxW[i]:d.maxH[i]);
      const cp=!vertical&&align===4?baseline-Math.min(cs,d.baseline[i]):cstart+(align===1?(available-cs)/2:align===2?available-cs:0);pos+=start;
      r[k]=x+(vertical?cp:pos);r[k+1]=y+(vertical?pos:cp);r[k+2]=vertical?cs:s[i];r[k+3]=vertical?s[i]:cs;
      pos+=s[i]+finish+step;
    }
  }
}
