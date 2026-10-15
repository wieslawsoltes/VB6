import {GRAPHICS_LIMITS,graphicsColor,finite,integer,dimensions,normalizeCommand,normalizeStyle,normalizePath,commandBytes,copyClip,copyTransform,intersectRect,multiplyTransform,rasterOperation} from './contract.js';
import {RasterCache,canvas2D,textMetrics} from './raster.js';
import {loadImage,snapshotImage} from './images.js';
/** Backend-independent retained commands and synchronous CSS-pixel readback. */
export class RetainedGraphics {
  constructor(container){
    this.container=container;this.commands=[];this.commandBytes=0;this.rasterBytes=0;this.hasGDI=false;this.replayEpoch=0;
    this.state=normalizeStyle();this.stateStack=[];this.imageTasks=new Set();this.batchDepth=0;
  }
  assertLive(){if(this.disposed)throw new Error('Graphics surface is disposed');}
  style(options={}){return normalizeStyle({...this.state,...options});}
  setState(options){this.assertLive();this.state=this.style(options);return this;}
  save(){this.assertLive();if(this.stateStack.length>=GRAPHICS_LIMITS.stack)throw new RangeError('Graphics state stack quota exceeded');this.stateStack.push(this.state);return this;}
  restore(){this.assertLive();if(!this.stateStack.length)throw new RangeError('Graphics state stack is empty');this.state=this.stateStack.pop();return this;}
  setClip(x,y,width,height){const clip=copyClip([x,y,width,height]);return this.setState({clip});}
  clip(x,y,width,height){const clip=copyClip([x,y,width,height]);return this.setState({clip:this.state.clip?intersectRect(this.state.clip,clip):clip});}
  resetClip(){return this.setState({clip:null});}
  setTransform(...matrix){return this.setState({transform:copyTransform(matrix)});}
  transform(...matrix){return this.setState({transform:multiplyTransform(this.state.transform,copyTransform(matrix))});}
  resetTransform(){return this.setState({transform:null});}
  batch(callback){
    this.assertLive();if(typeof callback!=='function')throw new TypeError('A graphics batch requires a synchronous callback');
    this.batchDepth++;try{const result=callback(this);if(result&&typeof result.then==='function')throw new TypeError('Graphics batches cannot span asynchronous work');return result;}
    finally{this.batchDepth--;if(!this.batchDepth&&this.batchDirty){this.batchDirty=false;this.invalidate();}}
  }
  reserve(command,extraRaster=0,replace=false,full=false){
    this.assertLive();const last=replace&&!full?this.commands.at(-1):null,bytes=(full?0:this.commandBytes)-(last?commandBytes(last):0)+commandBytes(command),raster=(full?0:this.rasterBytes)-(last?.bytes||0)+extraRaster;
    if((full?0:this.commands.length-(replace?1:0))>=GRAPHICS_LIMITS.commands||bytes>GRAPHICS_LIMITS.commandBytes||raster>GRAPHICS_LIMITS.rasterBytes)throw new RangeError('Graphics command quota exceeded; use Cls');
    return {bytes,raster};
  }
  retain(command,extraRaster=0,replace=false,full=false){
    const quota=this.reserve(command,extraRaster,replace,full);
    if(full){this.cancelCommandImages();this.commands=[];this.hasGDI=false;this.replayEpoch++;}else if(replace){this.commands.pop();this.replayEpoch++;}
    this.commands.push(command);if(command.kind==='bitmap')this.hasGDI=true;this.commandBytes=quota.bytes;this.rasterBytes=quota.raster;this.invalidate();return command;
  }
  add(kind,coords,color=0,fill=false,width=1,options={}){return this.retain(normalizeCommand(kind,coords,color,fill,width,{...options,...this.style(options)}));}
  path(segments,color=0,fill=false,width=1,options={}){
    const cmd=Object.freeze({kind:'path',coords:Object.freeze([]),path:normalizePath(segments),color:graphicsColor(color),fill:!!fill,width:integer(width,1,32767,'DrawWidth'),style:this.style(options)});return this.retain(cmd);
  }
  text(text,x,y,color=0,font='12px Arial',options={}){
    text=String(text);font=String(font);if(text.length>GRAPHICS_LIMITS.text||font.length>4096)throw new RangeError('Graphics text quota exceeded');
    if(!['left','center','right'].includes(options.align??'left'))throw new RangeError('Invalid text alignment');
    const maxWidth=options.maxWidth==null?undefined:finite(options.maxWidth,'text width'),lineHeight=options.lineHeight==null?undefined:finite(options.lineHeight,'line height');
    if(maxWidth!==undefined&&maxWidth<=0||lineHeight!==undefined&&lineHeight<=0)throw new RangeError('Text dimensions must be positive');
    return this.retain(Object.freeze({kind:'text',coords:Object.freeze([finite(x),finite(y)]),text,color:graphicsColor(color),font,style:this.style(options),maxWidth,lineHeight,align:options.align??'left',underline:!!options.underline,strikeThrough:!!options.strikeThrough,opaque:!!options.opaque,background:graphicsColor(options.background??this.background??0xffffff)}));
  }
  measureText(text,font='12px Arial',lineHeight){
    this.assertLive();text=String(text);if(text.length>GRAPHICS_LIMITS.text)throw new RangeError('Graphics text quota exceeded');
    if(!this.measureContext)this.measureContext=canvas2D(this.container.ownerDocument,1,1).context;
    return textMetrics(this.measureContext,text,font,lineHeight);
  }
  cancelCommandImages(){for(const task of this.imageTasks||[])task.cancel();this.imageTasks?.clear();}
  clear(){
    this.assertLive();this.cancelCommandImages();this.commands=[];this.commandBytes=this.rasterBytes=0;this.hasGDI=false;this.replayEpoch++;
    this.releaseRaster?.();this.dropRasterCaches();this.vertexData=this.vertexCommands=this.uploadedVertices=null;this.triangleCommands=null;this.invalidate();
  }
  dropRasterCaches(){this.logicalCache?.dispose();this.displayCache?.dispose();this.logicalCache=this.displayCache=this.gdiCanvas=null;this.measureContext=null;}
  // Raw GDI writes are opaque and replacement, not alpha-composited PaintPicture.
  writePixels(x,y,image){
    this.assertLive();x=finite(x);y=finite(y);const {width,height,data}=image||{};dimensions(width,height,GRAPHICS_LIMITS.imagePixels);
    if(!ArrayBuffer.isView(data)||data.BYTES_PER_ELEMENT!==1||data.length!==width*height*4)throw new TypeError('GDI pixels must be RGBA bytes');
    const bytes=width*height*4,last=this.commands.at(-1),replace=last?.kind==='bitmap'&&last.coords[0]===x&&last.coords[1]===y&&last.canvas.width===width&&last.canvas.height===height,full=x===0&&y===0&&width===this.width&&height===this.height;
    const cmd={kind:'bitmap',coords:Object.freeze([x,y]),bytes,style:normalizeStyle(),color:0};this.reserve(cmd,bytes,replace,full);
    const item=canvas2D(this.container.ownerDocument,width,height),pixels=item.context.createImageData(width,height);pixels.data.set(data);for(let i=3;i<bytes;i+=4)pixels.data[i]=255;item.context.putImageData(pixels,0,0);cmd.canvas=item.canvas;
    return this.retain(Object.freeze(cmd),bytes,replace,full);
  }
  paintPicture(source,x,y,width,height,sx=0,sy=0,sw,sh,options={}){
    this.assertLive();const coords=[finite(x),finite(y),width==null?undefined:finite(width),height==null?undefined:finite(height),finite(sx),finite(sy),sw==null?undefined:finite(sw),sh==null?undefined:finite(sh)];
    const cmd={kind:'picture',coords:Object.freeze(coords),color:0,style:this.style(options),opcode:rasterOperation(options.opcode),patternColor:graphicsColor(options.patternColor??0),smoothing:!!options.smoothing};
    if(typeof source!=='string'){cmd.canvas=snapshotImage(this.container.ownerDocument,source);cmd.bytes=cmd.canvas.width*cmd.canvas.height*4;this.retain(Object.freeze(cmd),cmd.bytes);return Promise.resolve(true);}
    // Reserve the command's place *before* starting its decode. Later commands
    // must still cover this picture when it eventually becomes available.
    this.reserve(cmd);const task=loadImage(this.container.ownerDocument,source);cmd.pending=true;this.retain(cmd);this.imageTasks.add(task);
    const ready=task.promise.then(result=>{
      this.imageTasks.delete(task);if(result.cancelled||this.disposed)return false;
      cmd.pending=false;
      if(result.canvas&&this.rasterBytes+result.canvas.width*result.canvas.height*4<=GRAPHICS_LIMITS.rasterBytes){cmd.canvas=result.canvas;cmd.bytes=result.canvas.width*result.canvas.height*4;this.rasterBytes+=cmd.bytes;}
      else{cmd.failed=true;cmd.error=result.error||'Graphics raster quota exceeded';this.pictureError=cmd.error;}
      Object.freeze(cmd);this.replayEpoch++;this.invalidate();return !cmd.failed;
    });task.ready=ready;return ready;
  }
  setPicture(source){
    this.assertLive();source=source||'';
    if(typeof source==='string'&&source===this.pictureSource)return this.pictureReady||Promise.resolve(true);
    // Validate/decode-request construction before releasing the current image.
    // A malformed new input must not cancel a valid pending image or erase it.
    const snapshot=source&&typeof source!=='string'?snapshotImage(this.container.ownerDocument,source):null;
    const task=typeof source==='string'&&source?loadImage(this.container.ownerDocument,source):null;
    this.pictureTask?.cancel();this.pictureSource=source;this.picture=snapshot;this.pictureError=null;this.pictureTask=task;this.replayEpoch++;
    if(!task){this.invalidate();return this.pictureReady=Promise.resolve(true);}
    this.pictureReady=task.promise.then(result=>{if(result.cancelled||this.disposed||this.pictureTask!==task)return false;this.pictureTask=null;this.picture=result.canvas||null;this.pictureError=result.error||null;this.replayEpoch++;this.invalidate();return !!this.picture;});
    this.invalidate();return this.pictureReady;
  }
  setGrid(spacing=8){this.assertLive();spacing=finite(spacing,'grid spacing',8192);if(spacing!==0&&spacing<1)throw new RangeError('Grid spacing must be zero or at least one pixel');if(this.grid!==spacing){this.grid=spacing;this.invalidate();}return this;}
  rasterize(){
    this.assertLive();dimensions(this.width,this.height,GRAPHICS_LIMITS.readPixels);this.logicalCache||=new RasterCache(this.container.ownerDocument);return this.gdiCanvas=this.logicalCache.render(this);
  }
  readPixels(x,y,width,height){this.assertLive();x=finite(x);y=finite(y);dimensions(width,height,GRAPHICS_LIMITS.readPixels);return this.rasterize().getContext('2d').getImageData(x,y,width,height);}
  point(x,y){x=finite(x);y=finite(y);x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=this.width||y>=this.height)return -1;const p=this.readPixels(x,y,1,1).data;return p[0]|p[1]<<8|p[2]<<16;}
  async flush(){this.assertLive();this.resize?.();await this.pictureReady;await Promise.all([...this.imageTasks].map(t=>t.ready));if(this.disposed)return false;await this.gpuReady;if(this.disposed)return false;this.render();await this.rasterPending;if(this.disposed)return false;this.render();return true;}
  toDataURL(type='image/png',quality){return this.rasterize().toDataURL(type,quality);}
  toBlob(type='image/png',quality){return new Promise((resolve,reject)=>{this.rasterize().toBlob(blob=>blob?resolve(blob):reject(new Error('Graphics image encoding failed')),type,quality);});}
  disposeRetained(){this.cancelCommandImages();this.pictureTask?.cancel();this.pictureTask=null;this.picture=this.pictureSource=null;this.commands=[];this.commandBytes=this.rasterBytes=0;this.hasGDI=false;this.stateStack=[];this.dropRasterCaches();}
}
