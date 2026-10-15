/** Retained graphics contract. Coordinates are logical CSS pixels, independent of
 * devicePixelRatio. All mutable caller input is copied before it is retained.
 * VB semantics/references and deliberately bounded resources: docs/GRAPHICS.md.
 */
export const GRAPHICS_LIMITS = Object.freeze({commands:50000,commandBytes:32*1024*1024,rasterBytes:32*1024*1024,imagePixels:4194304,readPixels:4194304,displayPixels:16777216,dimension:8192,points:16384,text:1048576,stack:128,coordinate:1e9});
export const DRAW_MODES = Object.freeze({Blackness:1,NotMergePen:2,MaskNotPen:3,NotCopyPen:4,MaskPenNot:5,Invert:6,XorPen:7,NotMaskPen:8,MaskPen:9,NotXorPen:10,Nop:11,MergeNotPen:12,CopyPen:13,MergePenNot:14,MergePen:15,Whiteness:16});
export const DRAW_STYLES = Object.freeze({Solid:0,Dash:1,Dot:2,DashDot:3,DashDotDot:4,Invisible:5,InsideSolid:6});
export const FILL_STYLES = Object.freeze({Solid:0,Transparent:1,HorizontalLine:2,VerticalLine:3,UpwardDiagonal:4,DownwardDiagonal:5,Cross:6,DiagonalCross:7});
/** Colors are immutable OLE_COLOR integers or bounded CSS strings. Do not
 * retain caller objects whose toString/valueOf can change after a draw. */
export function graphicsColor(value){
  if(typeof value==='number'&&Number.isInteger(value)&&value>=-2147483648&&value<=0xffffffff)return value;
  if(typeof value==='string'&&value.trim()&&value.length<=1024)return value;
  throw new TypeError('Graphics color must be an OLE_COLOR integer or CSS string');
}
export function finite(value,name='coordinate',limit=GRAPHICS_LIMITS.coordinate){const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>limit)throw new RangeError(`Invalid graphics ${name}`);return n;}
export function integer(value,min,max,name){const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new RangeError(`Invalid graphics ${name}`);return n;}
export function dimensions(width,height,maxPixels=GRAPHICS_LIMITS.readPixels){width=integer(width,1,GRAPHICS_LIMITS.dimension,'width');height=integer(height,1,GRAPHICS_LIMITS.dimension,'height');if(width*height>maxPixels)throw new RangeError('Graphics pixel quota exceeded');return {width,height};}
export function rectangle(coords){const [x,y,w,h]=coords;return [Math.min(x,x+w),Math.min(y,y+h),Math.abs(w),Math.abs(h)];}
export function intersectRect(a,b){const x=Math.max(a[0],b[0]),y=Math.max(a[1],b[1]);return [x,y,Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-x),Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-y)];}
export function copyClip(value){if(value==null)return null;if(!Array.isArray(value)&&!ArrayBuffer.isView(value)||value.length!==4)throw new TypeError('Clip requires x, y, width, height');return Object.freeze(rectangle(Array.from(value,v=>finite(v,'clip'))));}
export function copyTransform(value){if(value==null)return Object.freeze([1,0,0,1,0,0]);if((!Array.isArray(value)&&!ArrayBuffer.isView(value))||value.length!==6)throw new TypeError('Transform requires six numbers');return Object.freeze(Array.from(value,v=>finite(v,'transform',1e6)));}
export function isIdentity(m){return !m||m[0]===1&&m[1]===0&&m[2]===0&&m[3]===1&&m[4]===0&&m[5]===0;}
export function multiplyTransform(a,b){return copyTransform([a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]);}
export function normalizeStyle(options={}){
  if(!options||typeof options!=='object')throw new TypeError('Graphics style must be an object');
  const opacity=finite(options.opacity??1,'opacity',1);if(opacity<0)throw new RangeError('Invalid graphics opacity');
  const style={drawMode:integer(options.drawMode??13,1,16,'DrawMode'),drawStyle:integer(options.drawStyle??0,0,6,'DrawStyle'),fillStyle:integer(options.fillStyle??1,0,7,'FillStyle'),opacity,clip:copyClip(options.clip),transform:copyTransform(options.transform)};
  if(options.fillColor!==undefined)style.fillColor=graphicsColor(options.fillColor);
  if(options.stroke!==undefined)style.stroke=!!options.stroke;
  if(options.fillRule!==undefined&&!['nonzero','evenodd'].includes(options.fillRule))throw new RangeError('Invalid graphics fill rule');
  style.fillRule=options.fillRule||'nonzero';
  style.lineCap=options.lineCap??'butt';style.lineJoin=options.lineJoin??'miter';
  if(!['butt','square','round'].includes(style.lineCap)||!['miter','bevel','round'].includes(style.lineJoin))throw new RangeError('Invalid graphics line cap/join');
  return Object.freeze(style);
}
export function dashPattern(style,width=1){return width>1?[]:([[],[4,3],[1,3],[4,3,1,3],[4,3,1,3,1,3],[],[]][style]||[]);}
export function hatchPixel(style,x,y){x=((Math.floor(x)%8)+8)%8;y=((Math.floor(y)%8)+8)%8;switch(style){case 0:return true;case 1:return false;case 2:return y===0;case 3:return x===0;case 4:return (x+y)%8===0;case 5:return x===y;case 6:return x===0||y===0;case 7:return x===y||(x+y)%8===0;default:throw new RangeError('Invalid FillStyle');}}
/** Windows ROP2 is a four-bit truth table indexed by (pen << 1) | destination. */
export function rop2Byte(source,destination,mode=13){const t=mode-1;return ((~source&~destination&-(t&1))|(~source&destination&-((t>>1)&1))|(source&~destination&-((t>>2)&1))|(source&destination&-((t>>3)&1)))&255;}
/** Full ROP3 truth table, including pattern-dependent operations. */
export function rop3Byte(pattern,source,destination,truth=0xcc){let out=0;for(let i=0;i<8;i++)if(truth&(1<<i))out|=(i&4?pattern:~pattern)&(i&2?source:~source)&(i&1?destination:~destination);return out&255;}
export function rasterOperation(value=0x00cc0020){const n=Number(value);if(!Number.isInteger(n)||n< -2147483648||n>0xffffffff)throw new RangeError('Invalid raster operation');return (n>>>16)&255;}
const counts={pixel:[2,3],line:[4,4],rect:[4,4],circle:[3,3],ellipse:[4,4],arc:[6,6],roundrect:[5,6],polyline:[4,32768],polygon:[6,32768]};
export function normalizeCommand(kind,coords,color=0,fill=false,width=1,options={}){
  const count=Object.hasOwn(counts,kind)?counts[kind]:null;if(!count)throw new RangeError('Unsupported graphics primitive: '+kind);
  if((!Array.isArray(coords)&&!ArrayBuffer.isView(coords))||coords.length<count[0]||coords.length>count[1]||['polyline','polygon'].includes(kind)&&coords.length%2)throw new TypeError('Invalid '+kind+' coordinates');
  const a=Array.from(coords,v=>finite(v));if(kind==='pixel')a.length=2;
  if(['circle','ellipse','arc'].includes(kind)&&a.slice(2,kind==='circle'?3:4).some(v=>v<0))throw new RangeError('Graphics radii cannot be negative');
  if(kind==='roundrect'&&a.slice(4).some(v=>v<0))throw new RangeError('Corner radii cannot be negative');
  width=integer(width,1,32767,'DrawWidth');const style=normalizeStyle(options);
  const cmd={kind,coords:Object.freeze(a),color:graphicsColor(color),fill:!!fill,width,style};
  if(kind==='arc'){cmd.radialStart=!!options.radialStart;cmd.radialEnd=!!options.radialEnd;}
  return Object.freeze(cmd);
}
export function normalizePath(segments){
  if(!Array.isArray(segments)||!segments.length||segments.length>GRAPHICS_LIMITS.points)throw new RangeError('Invalid or oversized graphics path');
  const arity={M:2,L:2,Q:4,C:6,Z:0};let started=false;
  return Object.freeze(segments.map(segment=>{
    if(!Array.isArray(segment)||!Object.hasOwn(arity,segment[0])||segment.length!==arity[segment[0]]+1)throw new TypeError('Path commands are M, L, Q, C and Z');
    if(segment[0]==='M')started=true;else if(!started)throw new TypeError('A path must begin with M');
    return Object.freeze([segment[0],...segment.slice(1).map(v=>finite(v,'path coordinate'))]);
  }));
}
export function commandBytes(cmd){return 128+(cmd.coords?.length||0)*8+(cmd.text?.length||0)*2+(cmd.path?.reduce((n,s)=>n+s.length*8,0)||0);}
/** The pixel-exact triangle path is deliberately restricted. Curves, diagonal
 * strokes, text, transforms, clips and compositing use the ordered retained
 * texture path, rather than disagree with Canvas/readback at coverage edges. */
export function triangleCompatible(cmd){
  if(!['pixel','rect'].includes(cmd.kind))return false;
  const s=cmd.style||{};
  return (s.drawMode??13)===13&&(s.drawStyle??0)===0&&(s.opacity??1)===1&&!s.clip&&isIdentity(s.transform)&&cmd.coords.every(Number.isInteger)&&(cmd.kind==='pixel'||cmd.fill&&s.stroke!==true);
}
