import {colorValue} from '../theme/theme.js';
import {GRAPHICS_LIMITS,dashPattern,hatchPixel,intersectRect,rectangle,rop2Byte,rop3Byte} from './contract.js';
const TAU=Math.PI*2;
export function canvas2D(document,width,height){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Canvas2D is unavailable for retained graphics');return {canvas,context};}
export function textMetrics(ctx,text,font,lineHeight){
  ctx.save();try{
    ctx.font=font;const lines=String(text).split(/\r\n|\r|\n/),em=Number(/([\d.]+)px/.exec(ctx.font)?.[1])||12;
    const reference=ctx.measureText('Mg'),ascent=reference.fontBoundingBoxAscent??reference.actualBoundingBoxAscent??em*.8,descent=reference.fontBoundingBoxDescent??reference.actualBoundingBoxDescent??em*.2;
    const advance=lineHeight??Math.max(em*1.2,ascent+descent);let width=0;for(const line of lines)width=Math.max(width,ctx.measureText(line).width);
    return {width,height:advance*lines.length,lineHeight:advance,ascent,descent,lines};
  }finally{ctx.restore();}
}
function trace(ctx,cmd){
  const a=cmd.coords;
  switch(cmd.kind){
    case 'line':ctx.moveTo(a[0]+.5,a[1]+.5);ctx.lineTo(a[2]+.5,a[3]+.5);break;
    case 'rect':ctx.rect(Math.min(a[0],a[2]),Math.min(a[1],a[3]),Math.abs(a[2]-a[0]),Math.abs(a[3]-a[1]));break;
    case 'roundrect':ctx.roundRect(Math.min(a[0],a[2]),Math.min(a[1],a[3]),Math.abs(a[2]-a[0]),Math.abs(a[3]-a[1]),[{x:a[4],y:a[5]??a[4]}]);break;
    case 'circle':ctx.arc(a[0],a[1],a[2],0,TAU);break;
    case 'ellipse':ctx.ellipse(a[0],a[1],a[2],a[3],0,0,TAU);break;
    case 'arc':{
      const start=a[4],delta=a[5]-start,sweep=delta>=0?Math.min(TAU,delta):((delta%TAU)+TAU)%TAU,end=start+sweep;
      const x=a[0]+a[2]*Math.cos(start),y=a[1]-a[3]*Math.sin(start);
      if(cmd.radialStart){ctx.moveTo(a[0],a[1]);ctx.lineTo(x,y);}else ctx.moveTo(x,y);
      ctx.ellipse(a[0],a[1],a[2],a[3],0,-start,-end,true);
      if(cmd.radialEnd)ctx.lineTo(a[0],a[1]);
      if(cmd.radialStart&&cmd.radialEnd||sweep===TAU)ctx.closePath();break;
    }
    case 'polygon':case 'polyline':ctx.moveTo(a[0],a[1]);for(let i=2;i<a.length;i+=2)ctx.lineTo(a[i],a[i+1]);if(cmd.kind==='polygon')ctx.closePath();break;
    case 'path':for(const s of cmd.path){switch(s[0]){case 'M':ctx.moveTo(s[1],s[2]);break;case 'L':ctx.lineTo(s[1],s[2]);break;case 'Q':ctx.quadraticCurveTo(...s.slice(1));break;case 'C':ctx.bezierCurveTo(...s.slice(1));break;case 'Z':ctx.closePath();break;}}break;
  }
}
function closed(cmd){return !['line','polyline'].includes(cmd.kind)&&(cmd.kind!=='arc'||cmd.radialStart&&cmd.radialEnd||Math.abs(cmd.coords[5]-cmd.coords[4])>=TAU);}
function imageRect(cmd){const a=cmd.coords,source=cmd.canvas;if(!source)return null;return [a[0],a[1],a[2]??source.width,a[3]??source.height,a[4]??0,a[5]??0,a[6]??source.width,a[7]??source.height];}
function paintImage(ctx,cmd){
  const a=imageRect(cmd);if(!a)return;const [x,y,w,h,sx,sy,sw,sh]=a;if(!w||!h||!sw||!sh)return;
  const flipX=(w<0)!==(sw<0),flipY=(h<0)!==(sh<0),dx=Math.min(x,x+w),dy=Math.min(y,y+h);
  ctx.imageSmoothingEnabled=!!cmd.smoothing;
  ctx.translate(dx+(flipX?Math.abs(w):0),dy+(flipY?Math.abs(h):0));ctx.scale(flipX?-1:1,flipY?-1:1);
  ctx.drawImage(cmd.canvas,Math.min(sx,sx+sw),Math.min(sy,sy+sh),Math.abs(sw),Math.abs(sh),0,0,Math.abs(w),Math.abs(h));
}
/** Conservative command bounds; curves use their complete control-point hull.
 * Scissor the result before allocating any scratch/readback memory. */
export function commandBounds(cmd,ctx){
  const a=cmd.coords;let b;
  if(cmd.kind==='text'){
    const m=textMetrics(ctx,cmd.text,cmd.font,cmd.lineHeight),w=cmd.maxWidth?Math.min(m.width,cmd.maxWidth):m.width;
    const offset=cmd.align==='center'?-w/2:cmd.align==='right'?-w:0;b=[a[0]+offset,a[1],w,m.height];
  }else if(cmd.kind==='bitmap'||cmd.kind==='picture'){const r=imageRect(cmd);if(!r)return [0,0,0,0];b=rectangle(r.slice(0,4));}
  else if(['circle','ellipse','arc'].includes(cmd.kind)){const rx=a[2],ry=cmd.kind==='circle'?rx:a[3];b=[a[0]-rx,a[1]-ry,rx*2,ry*2];}
  else if(cmd.kind==='pixel'){const w=cmd.width||1;b=[Math.round(a[0])-Math.floor(w/2),Math.round(a[1])-Math.floor(w/2),w,w];}
  else{
    const points=cmd.kind==='path'?cmd.path.flatMap(s=>s.slice(1)):cmd.kind==='roundrect'?a.slice(0,4):a;
    let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(let i=0;i<points.length;i+=2){x=Math.min(x,points[i]);right=Math.max(right,points[i]);y=Math.min(y,points[i+1]);bottom=Math.max(bottom,points[i+1]);}
    b=Number.isFinite(x)?[x,y,right-x,bottom-y]:[0,0,0,0];
  }
  const pad=cmd.kind==='text'?Math.max(4,textMetrics(ctx,'Mg',cmd.font).lineHeight):((cmd.width||1)*(cmd.style?.lineJoin==='miter'?5:1)+2);
  b=[b[0]-pad,b[1]-pad,b[2]+pad*2,b[3]+pad*2];
  const m=cmd.style?.transform;
  if(m){const p=[[b[0],b[1]],[b[0]+b[2],b[1]],[b[0],b[1]+b[3]],[b[0]+b[2],b[1]+b[3]]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);const xs=p.map(v=>v[0]),ys=p.map(v=>v[1]);b=[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];}
  return cmd.style?.clip?intersectRect(b,cmd.style.clip):b;
}
export class RasterPainter {
  constructor(document){this.document=document;this.patterns=new Map();this.painted=0;}
  pattern(ctx,style,color){
    const key=style+':'+color;let tile=this.patterns.get(key);
    if(!tile){const item=canvas2D(this.document,8,8);tile=item.canvas;item.context.fillStyle=color;for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(hatchPixel(style,x,y))item.context.fillRect(x,y,1,1);if(this.patterns.size>=32)this.patterns.delete(this.patterns.keys().next().value);this.patterns.set(key,tile);}
    return ctx.createPattern(tile,'repeat');
  }
  plain(ctx,cmd,theme){
    const s=cmd.style||{},a=cmd.coords,drawStyle=s.drawStyle??0;
    ctx.save();try{
      if(s.clip){ctx.beginPath();ctx.rect(...s.clip);ctx.clip();}
      if(s.transform)ctx.transform(...s.transform);
      ctx.globalAlpha=s.opacity??1;ctx.globalCompositeOperation='source-over';
      ctx.strokeStyle=ctx.fillStyle='#000000';ctx.strokeStyle=ctx.fillStyle=colorValue(cmd.color,'#000000',theme);ctx.lineWidth=cmd.width||1;ctx.lineCap=s.lineCap||'butt';ctx.lineJoin=s.lineJoin||'miter';ctx.miterLimit=10;ctx.setLineDash(dashPattern(drawStyle,cmd.width));
      if(cmd.kind==='bitmap'||cmd.kind==='picture'){paintImage(ctx,cmd);return;}
      if(cmd.kind==='text'){
        const m=textMetrics(ctx,cmd.text,cmd.font,cmd.lineHeight);ctx.font=cmd.font;ctx.textBaseline='top';ctx.textAlign=cmd.align||'left';
        for(let i=0;i<m.lines.length;i++){
          const line=m.lines[i],y=a[1]+i*m.lineHeight,w=cmd.maxWidth?Math.min(ctx.measureText(line).width,cmd.maxWidth):ctx.measureText(line).width,offset=cmd.align==='center'?-w/2:cmd.align==='right'?-w:0;
          if(cmd.opaque){ctx.fillStyle=colorValue(cmd.background,'#ffffff',theme);ctx.fillRect(a[0]+offset,y,w,m.lineHeight);ctx.fillStyle=colorValue(cmd.color,'#000000',theme);}
          if(cmd.maxWidth)ctx.fillText(line,a[0],y,cmd.maxWidth);else ctx.fillText(line,a[0],y);
          const thickness=Math.max(1,Math.round(m.lineHeight/16));
          if(cmd.underline)ctx.fillRect(a[0]+offset,y+m.ascent+thickness,w,thickness);
          if(cmd.strikeThrough)ctx.fillRect(a[0]+offset,y+m.ascent*.55,w,thickness);
        }return;
      }
      if(cmd.kind==='pixel'){if(drawStyle!==5){const w=cmd.width||1;ctx.fillRect(Math.round(a[0])-Math.floor(w/2),Math.round(a[1])-Math.floor(w/2),w,w);}return;}
      ctx.beginPath();trace(ctx,cmd);
      const fillStyle=cmd.fill?0:s.fillStyle??1;
      if(closed(cmd)&&fillStyle!==1){
        const color=colorValue(cmd.fill?cmd.color:s.fillColor??cmd.color,'#000000',theme);ctx.fillStyle=fillStyle===0?color:this.pattern(ctx,fillStyle,color);ctx.fill(s.fillRule||'nonzero');
      }
      if((s.stroke??!cmd.fill)&&drawStyle!==5){
        if(drawStyle===6&&closed(cmd)){ctx.clip(s.fillRule||'nonzero');ctx.lineWidth=(cmd.width||1)*2;}
        ctx.stroke();
      }
    }finally{ctx.restore();}
  }
  paint(ctx,cmd,theme,width,height,scale=1){
    if(cmd.pending||cmd.failed)return;
    const mode=cmd.style?.drawMode??13,opcode=cmd.opcode??0xcc;
    if(mode===11)return;
    if(mode===13&&opcode===0xcc){this.plain(ctx,cmd,theme);this.painted++;return;}
    const bounds=intersectRect(commandBounds(cmd,ctx),[0,0,width,height]),x=Math.max(0,Math.floor(bounds[0]*scale)),y=Math.max(0,Math.floor(bounds[1]*scale)),right=Math.min(ctx.canvas.width,Math.ceil((bounds[0]+bounds[2])*scale)),bottom=Math.min(ctx.canvas.height,Math.ceil((bounds[1]+bounds[3])*scale)),w=right-x,h=bottom-y;
    if(w<=0||h<=0)return;
    if(w*h>GRAPHICS_LIMITS.displayPixels)throw new RangeError('Graphics raster-operation quota exceeded');
    if(!this.scratch)this.scratch=canvas2D(this.document,w,h);
    const scratch=this.scratch.canvas,c=this.scratch.context;
    if(scratch.width!==w)scratch.width=w;if(scratch.height!==h)scratch.height=h;
    c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,w,h);c.setTransform(scale,0,0,scale,-x,-y);this.plain(c,cmd,theme);
    const source=c.getImageData(0,0,w,h),destination=ctx.getImageData(x,y,w,h),pctx=this.patternColor||(this.patternColor=canvas2D(this.document,1,1).context);
    pctx.clearRect(0,0,1,1);pctx.fillStyle='#000000';pctx.fillStyle=colorValue(cmd.patternColor??0,'#000000',theme);pctx.fillRect(0,0,1,1);const pattern=pctx.getImageData(0,0,1,1).data;
    for(let i=0;i<source.data.length;i+=4)if(source.data[i+3]>=128){for(let c=0;c<3;c++)destination.data[i+c]=opcode===0xcc?rop2Byte(source.data[i+c],destination.data[i+c],mode):rop3Byte(pattern[c],source.data[i+c],destination.data[i+c],opcode);destination.data[i+3]=255;}
    ctx.putImageData(destination,x,y);this.painted++;
  }
  dispose(){this.patterns.clear();this.scratch=null;this.patternColor=null;}
}
/** Append-only replay cache. Changes to background, picture, scale, theme or
 * command replacement invalidate the base; unrelated invalidations do not
 * redraw 50,000 retained operations. No per-frame pixel readback is required. */
export class RasterCache {
  constructor(document){this.document=document;this.painter=new RasterPainter(document);this.count=0;this.rebuilds=0;this.revision=0;}
  render(surface,scale=1){
    const width=Math.max(1,Math.floor(surface.width*scale)),height=Math.max(1,Math.floor(surface.height*scale));
    if(width*height>GRAPHICS_LIMITS.displayPixels)throw new RangeError('Graphics surface exceeds retained pixel budget');
    if(!this.canvas){const item=canvas2D(this.document,width,height);this.canvas=item.canvas;this.context=item.context;}
    const key=[surface.width,surface.height,width,height,surface.background,surface.theme,surface.grid,surface.replayEpoch||0].join('|');
    const reset=key!==this.key||this.commands!==surface.commands||this.picture!==surface.picture||this.count>surface.commands.length;
    const ctx=this.context;
    if(reset){
      if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);ctx.setTransform(scale,0,0,scale,0,0);
      ctx.fillStyle='#c0c0c0';ctx.fillStyle=colorValue(surface.background,'#c0c0c0',surface.theme);ctx.fillRect(0,0,surface.width,surface.height);
      if(surface.picture)ctx.drawImage(surface.picture,0,0);
      if(surface.grid){
        // An 8192x8192 one-pixel grid is one repeating tile, not 67M calls.
        // Fractional phase is retained exactly by the bounded explicit path.
        const count=Math.ceil(surface.width/surface.grid)*Math.ceil(surface.height/surface.grid);
        if(Number.isInteger(surface.grid)&&surface.grid<=256){
          if(this.gridSpacing!==surface.grid){const tile=canvas2D(this.document,surface.grid,surface.grid);tile.context.fillStyle='#808080';tile.context.fillRect(0,0,1,1);this.gridTile=tile.canvas;this.gridSpacing=surface.grid;}
          ctx.fillStyle=ctx.createPattern(this.gridTile,'repeat');ctx.fillRect(0,0,surface.width,surface.height);
        }else{
          if(count>1000000)throw new RangeError('Fractional grid exceeds draw-call quota');
          ctx.fillStyle='#808080';for(let y=0;y<surface.height;y+=surface.grid)for(let x=0;x<surface.width;x+=surface.grid)ctx.fillRect(x,y,1,1);
        }
      }
      this.key=key;this.picture=surface.picture;this.commands=surface.commands;this.count=0;this.rebuilds++;this.revision++;
    }else ctx.setTransform(scale,0,0,scale,0,0);
    while(this.count<surface.commands.length){this.painter.paint(ctx,surface.commands[this.count],surface.theme,surface.width,surface.height,scale);this.count++;this.revision++;}
    return this.canvas;
  }
  dispose(){this.painter.dispose();this.canvas=this.context=this.commands=this.picture=this.gridTile=null;}
}
