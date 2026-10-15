import {finite,integer} from './contract.js';
/** VB logical units per CSS pixel (96 logical DPI, independent of display DPR).
 * Character mode uses separate horizontal and vertical cell dimensions. */
export function graphicsUnits(mode,vertical=false){mode=integer(mode,0,7,'ScaleMode');return mode===4?(vertical?1/16:1/8):[1,15,.75,1,0,1/96,25.4/96,2.54/96][mode];}
export function coordinateSystem(props,width,height){
  const mode=integer(props.ScaleMode??1,0,7,'ScaleMode'),left=finite(props.ScaleLeft??0),top=finite(props.ScaleTop??0);
  width=Math.max(1,finite(width));height=Math.max(1,finite(height));
  const sx=mode===0?finite(props.ScaleWidth??width)/width:graphicsUnits(mode),sy=mode===0?finite(props.ScaleHeight??height)/height:graphicsUnits(mode,true);
  if(!sx||!sy)throw new RangeError('ScaleWidth and ScaleHeight cannot be zero');
  return {sx,sy,left,top,x:value=>(finite(value)-left)/sx,y:value=>(finite(value)-top)/sy,dx:value=>finite(value)/sx,dy:value=>finite(value)/sy};
}
export function relativeCoordinates(kind,coords,currentX,currentY,options={}){
  const a=coords.map(v=>finite(v));
  if(options.implicitStart){a[0]=finite(currentX);a[1]=finite(currentY);}else if(options.stepStart){a[0]+=finite(currentX);a[1]+=finite(currentY);}
  if((kind==='line'||kind==='rect')&&options.stepEnd){a[2]+=a[0];a[3]+=a[1];}
  return a;
}
export function prepareDrawing(kind,coords,system,currentX=0,currentY=0,options={}){
  const a=relativeCoordinates(kind,coords,currentX,currentY,options),point=[system.x(a[0]),system.y(a[1])];
  if(kind==='circle'){
    const radius=finite(a[2],'radius'),aspect=finite(options.aspect??1,'aspect'),start=finite(options.start??0,'start angle',Math.PI*2),end=finite(options.end??Math.PI*2,'end angle',Math.PI*2);
    if(radius<0||aspect<=0)throw new RangeError('Circle requires a nonnegative radius and positive aspect');
    const rx=Math.abs(system.dx(radius*Math.min(1,1/aspect))),ry=Math.abs(system.dy(radius*Math.min(1,aspect)));
    const full=options.start===undefined&&options.end===undefined;
    return {kind:full?(rx===ry?'circle':'ellipse'):'arc',coords:full?[...point,rx,...(rx===ry?[]:[ry])]:[...point,rx,ry,Math.abs(start),Math.abs(end)],options:{radialStart:start<0,radialEnd:end<0},current:[a[0],a[1]]};
  }
  if(kind==='pixel')return {kind,coords:point,options:{},current:[a[0],a[1]]};
  if(kind==='line'||kind==='rect')return {kind,coords:[...point,system.x(a[2]),system.y(a[3])],options:{},current:[a[2],a[3]]};
  throw new RangeError('Unsupported VB graphics method: '+kind);
}
