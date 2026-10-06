import {ComputeError, COMMAND_WORDS, integer, finite} from './protocol.js';
const identity=[1,0,0,1,0,0];
function vector(value,length,name) {
  if(!Array.isArray(value)&&!ArrayBuffer.isView(value)||value.length!==length)throw new ComputeError(`${name} requires ${length} numbers`,'GPU_VALUE');
  return Array.from(value,v=>finite(v,name));
}
function color(value) {
  const result=vector(value,4,'RGBA color');if(result.some(v=>v<0||v>1))throw new ComputeError('RGBA channels must be in [0,1]','GPU_VALUE');return result;
}
export class ComputePath {
  constructor(){this.curves=[];this.contours=[];this.contour=null;this.point=null;this.start=null;this.open=false;}
  moveTo(x,y){this.point=[finite(x),finite(y)];this.start=[...this.point];this.open=true;this.contour={start:[...this.point],end:[...this.point],closed:false};this.contours.push(this.contour);return this;}
  segment(kind,points){if(!this.point)throw new ComputeError('Path requires moveTo first','GPU_PATH');const p=points.map(v=>finite(v));if(!this.open)this.moveTo(...this.point);this.curves.push({kind,points:[...this.point,...p]});this.point=p.slice(-2);this.contour.end=[...this.point];return this;}
  lineTo(x,y){return this.segment(1,[x,y]);}
  quadraticCurveTo(x1,y1,x,y){return this.segment(2,[x1,y1,x,y]);}
  bezierCurveTo(x1,y1,x2,y2,x,y){return this.segment(3,[x1,y1,x2,y2,x,y]);}
  closePath(){if(this.open&&this.point&&this.start&&(this.point[0]!==this.start[0]||this.point[1]!==this.start[1]))this.lineTo(...this.start);this.open=false;if(this.contour)this.contour.closed=true;return this;}
}
/** CPU encodes commands only; curve flattening, bounds, binning and pixels run in compute. */
export class ComputeScene {
  constructor(width,height){this.width=integer(width,'width',1,16384);this.height=integer(height,'height',1,16384);this.commands=[];this.curves=[];}
  add(kind,a,b,paint,options={}) {
    if(this.commands.length>=16384)throw new ComputeError('Scene command limit exceeded','GPU_LIMIT');
    const matrix=vector(options.transform||identity,6,'transform');
    const clip=vector(options.clip||[0,0,this.width,this.height],4,'clip');
    if(clip[2]<clip[0]||clip[3]<clip[1])throw new ComputeError('Clip bounds are reversed','GPU_VALUE');
    const first=color(Array.isArray(paint)||ArrayBuffer.isView(paint)?paint:paint?.from),second=paint?.to?color(paint.to):first;
    const gradient=paint?.to?vector(paint.line,4,'gradient line'):[0,0,0,0];
    const stroke=finite(options.strokeWidth??1);if(stroke<0)throw new ComputeError('Stroke width must be nonnegative','GPU_VALUE');
    this.commands.push({kind,a:vector(a,4,'geometry'),b:[stroke,...b],first,second,gradient,matrix,clip,flags:options.fill===false?0:1,paintKind:paint?.to?1:0,offset:0,count:0});return this;
  }
  clear(rgba=[0,0,0,0]){return this.add(1,[0,0,0,0],[0,0,0],rgba);}
  rect(x,y,width,height,paint,options={}){return this.add(2,[x,y,x+width,y+height],[0,0,0],paint,options);}
  line(x1,y1,x2,y2,paint,options={}){return this.add(3,[x1,y1,x2,y2],[0,0,0],paint,{...options,fill:false});}
  circle(x,y,radius,paint,options={}){if(finite(radius)<0)throw new ComputeError('Radius must be nonnegative','GPU_VALUE');return this.add(4,[x,y,radius,0],[0,0,0],paint,options);}
  path(path,paint,options={}) {
    if(!(path instanceof ComputePath))throw new ComputeError('Expected ComputePath','GPU_PATH');
    const curves=path.curves.map(c=>({kind:c.kind,points:[...c.points]}));
    if(options.fill!==false)for(const contour of path.contours)if(!contour.closed&&(contour.end[0]!==contour.start[0]||contour.end[1]!==contour.start[1]))curves.push({kind:1,points:[...contour.end,...contour.start]});
    if(options.fillRule&&!['nonzero','evenodd'].includes(options.fillRule))throw new ComputeError('Unknown fill rule','GPU_VALUE');
    if(!curves.length)return this;
    if(this.curves.length+curves.length>16384)throw new ComputeError('Curve limit exceeded','GPU_LIMIT');
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(const c of curves)for(let i=0;i<c.points.length;i+=2){x0=Math.min(x0,c.points[i]);x1=Math.max(x1,c.points[i]);y0=Math.min(y0,c.points[i+1]);y1=Math.max(y1,c.points[i+1]);}
    this.add(5,[x0,y0,x1,y1],[0,0,0],paint,options);const command=this.commands.at(-1);
    command.offset=this.curves.length;command.count=curves.length;if(options.fillRule==='evenodd')command.flags|=2;
    else if(options.fillRule&&options.fillRule!=='nonzero')throw new ComputeError('Unknown fill rule','GPU_VALUE');
    this.curves.push(...curves);return this;
  }
  encode() {
    const count=this.commands.length,commands=new ArrayBuffer(Math.max(1,count)*COMMAND_WORDS*4),u=new Uint32Array(commands),f=new Float32Array(commands);
    for(let i=0;i<count;i++){
      const c=this.commands[i],offset=i*COMMAND_WORDS;u.set([c.kind,c.flags,c.offset,c.count],offset);
      f.set(c.a,offset+4);f.set(c.b,offset+8);f.set(c.first,offset+12);f.set(c.second,offset+16);f.set(c.gradient,offset+20);
      f.set(c.matrix.slice(0,4),offset+24);f.set([...c.matrix.slice(4),c.paintKind,0],offset+28);f.set(c.clip,offset+32);
    }
    const curves=new ArrayBuffer(Math.max(1,this.curves.length)*48),cf=new Float32Array(curves),cu=new Uint32Array(curves);
    for(let i=0;i<this.curves.length;i++){const c=this.curves[i];cf.set(c.points,i*12);cu[i*12+8]=c.kind;}
    return {commands,curves,count,curveCount:this.curves.length,width:this.width,height:this.height};
  }
}
