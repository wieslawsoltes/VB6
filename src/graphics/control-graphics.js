import {VBError} from '../language/lexer.js';
import {fontFamily} from '../theme/theme.js';
import {finite,integer} from './contract.js';
import {coordinateSystem,graphicsUnits,prepareDrawing} from './coordinates.js';
export function controlSize(control){
  const host=control.content||control.node,p=control.props;
  // Form_Load executes before the form is shown. Hidden elements have zero
  // client dimensions, but their authored client area is already meaningful.
  return {width:host.clientWidth||Number(p.ClientWidth??p.Width)/15||1,height:host.clientHeight||Number(p.ClientHeight??p.Height)/15||1};
}
export function controlSystem(control){const size=controlSize(control);return coordinateSystem(control.props,size.width,size.height);}
export function graphicsProperty(control,key,value){
  const ranges={DrawWidth:[1,32767],DrawMode:[1,16],DrawStyle:[0,6],FillStyle:[0,7]};
  try{
    if(Object.hasOwn(ranges,key)){control.props[key]=integer(value,...ranges[key],key);return true;}
    if(!['ScaleMode','ScaleLeft','ScaleTop','ScaleWidth','ScaleHeight'].includes(key))return false;
    const before=controlSystem(control),px=before.x(control.currentX||0),py=before.y(control.currentY||0),p=control.props;
    if(key==='ScaleMode'){
      value=integer(value,0,7,key);
      if(value){p.ScaleMode=value;p.ScaleLeft=p.ScaleTop=0;delete p.ScaleWidth;delete p.ScaleHeight;}
      else{p.ScaleWidth=control.get('ScaleWidth');p.ScaleHeight=control.get('ScaleHeight');p.ScaleMode=0;}
    }else{
      value=finite(value,key);if((key==='ScaleWidth'||key==='ScaleHeight')&&!value)throw new RangeError(key+' cannot be zero');
      const width=control.get('ScaleWidth'),height=control.get('ScaleHeight');p.ScaleWidth=width;p.ScaleHeight=height;p[key]=value;p.ScaleMode=0;
    }
    const after=controlSystem(control);control.currentX=px*after.sx+after.left;control.currentY=py*after.sy+after.top;return true;
  }catch(error){throw new VBError(error.message,380);}
}
export function drawControl(control,kind,coords,color,fill=false,options={}){
  if(kind==='scale'){scaleControl(control,...coords);return;}
  const p=control.props,command=prepareDrawing(kind,coords,controlSystem(control),control.currentX,control.currentY,options);
  control.ensureSurface().add(command.kind,command.coords,color===undefined?p.ForeColor:color,fill,p.DrawWidth??1,{drawStyle:p.DrawStyle??0,drawMode:p.DrawMode??13,fillStyle:p.FillStyle??1,fillColor:p.FillColor??0,...command.options});
  [control.currentX,control.currentY]=command.current;
}
export function controlFont(control){const p=control.props,size=finite(p.FontSize??8.25,'font size',4096);if(size<=0)throw new VBError('Invalid FontSize',380);return `${p.FontItalic?'italic ':''}${p.FontBold?'bold ':''}${size*96/72}px ${fontFamily(p.FontName)}`;}
export function printControl(control,values){
  const p=control.props,s=control.ensureSurface(),system=controlSystem(control),font=controlFont(control),text=values.map(v=>String(v??'')).join(' '),metrics=s.measureText(text,font);
  s.text(text,system.x(control.currentX),system.y(control.currentY),p.ForeColor,font,{underline:!!p.FontUnderline,strikeThrough:!!p.FontStrikethru,opaque:p.FontTransparent===0,background:p.BackColor});
  control.currentX=system.left;control.currentY+=metrics.height*system.sy;
}
export function measureControl(control,text,vertical=false){const size=control.ensureSurface().measureText(text,controlFont(control)),s=controlSystem(control);return vertical?size.height*s.sy:size.width*s.sx;}
export function scaleControl(control,...values){
  if(!values.length){graphicsProperty(control,'ScaleMode',1);return;}
  if(values.length!==4)throw new VBError('Scale requires four coordinates',450);
  const [x1,y1,x2,y2]=values.map(v=>finite(v));if(x1===x2||y1===y2)throw new VBError('Scale dimensions cannot be zero',5);
  const before=controlSystem(control),px=before.x(control.currentX),py=before.y(control.currentY);
  Object.assign(control.props,{ScaleMode:0,ScaleLeft:x1,ScaleTop:y1,ScaleWidth:x2-x1,ScaleHeight:y2-y1});
  const after=controlSystem(control);control.currentX=px*after.sx+after.left;control.currentY=py*after.sy+after.top;
}
export function scaleLength(control,value,from=3,to=control.props.ScaleMode??1,vertical=false){
  const s=controlSystem(control),units=mode=>Number(mode)===0?(vertical?s.sy:s.sx):graphicsUnits(mode,vertical);
  return finite(value)*units(to)/units(from);
}
export function paintControlPicture(control,picture,x,y,width,height,sx=0,sy=0,sw,sh,opcode){
  const s=controlSystem(control),surface=control.ensureSurface();
  // VB source and destination dimensions both use the destination's ScaleMode;
  // omitted image dimensions preserve the decoded image's natural pixel size.
  return surface.paintPicture(picture,s.x(x),s.y(y),width==null?undefined:s.dx(width),height==null?undefined:s.dy(height),s.dx(sx),s.dy(sy),sw==null?undefined:s.dx(sw),sh==null?undefined:s.dy(sh),{opcode});
}
