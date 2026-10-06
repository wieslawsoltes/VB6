import {GPURasterPresenter} from '../../packages/win32-browser/src/gpu-presenter.js';
import { colorValue, getTheme } from '../theme/theme.js';
/** Demand-rendered 2D primitives: WebGPU triangles, Canvas2D fallback, DOM text. */
const surfaces = new WeakMap();
export function refreshGraphicsSurfaces(root) { for (const canvas of root.querySelectorAll('canvas.graphics-surface')) surfaces.get(canvas)?.transferDocument(); }
const sharedDevices = new WeakMap();
export function oleColor(color,fallback='#c0c0c0',theme='classic'){return colorValue(color,fallback,theme);}
function rgba(color,theme='classic'){const c=oleColor(color,'#c0c0c0',theme);return [parseInt(c.slice(1,3),16)/255,parseInt(c.slice(3,5),16)/255,parseInt(c.slice(5,7),16)/255,1];}
export async function getGPUDevice(view=globalThis) {
  if(view.vb6NativeGPUUnavailable)return null;
  if(view.vb6NativeGPUDevice)return view.vb6NativeGPUDevice;
  const gpu=view.navigator?.gpu;if(!gpu)return null;
  let pending=sharedDevices.get(view);
  if(!pending){
    pending=(async()=>{
      try{
        const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});
        if(!adapter)return null;
        const device=await adapter.requestDevice();
        device.lost.then(()=>{if(sharedDevices.get(view)===pending)sharedDevices.delete(view);});
        return device;
      }catch{return null;}
    })();
    sharedDevices.set(view,pending);
    pending.then(device=>{if(!device&&sharedDevices.get(view)===pending)sharedDevices.delete(view);});
  }
  let timeout;
  try{return await Promise.race([pending,new Promise(resolve=>timeout=setTimeout(()=>resolve(null),3000))]);}
  finally{clearTimeout(timeout);}
}
const SHADER=`struct Screen { size: vec2f, padding: vec2f };
@group(0) @binding(0) var<uniform> screen: Screen;
struct VertexOut { @builtin(position) position: vec4f, @location(0) color: vec4f };
@vertex fn vs(@location(0) xy: vec2f, @location(1) color: vec4f) -> VertexOut {
 var out: VertexOut; out.position = vec4f(xy.x / screen.size.x * 2.0 - 1.0, 1.0 - xy.y / screen.size.y * 2.0, 0.0, 1.0); out.color = color; return out;
}
@fragment fn fs(in: VertexOut) -> @location(0) vec4f { return in.color; }`;
export class GraphicsSurface {
  constructor(container,{backend='auto',background=16777215,onBackend=()=>{}}={}){this.container=container;this.theme=getTheme(container).id;this.themeChanged=()=>{this.theme=getTheme(container).id;this.invalidate();};this.themeDocument=container.ownerDocument;this.themeDocument.addEventListener('vb-theme-change',this.themeChanged);this.requestedBackend=backend;this.backend='canvas2d';this.background=background;this.commands=[];this.onBackend=onBackend;this.dirty=false;this.disposed=false;this.width=1;this.height=1;this.canvas=container.ownerDocument.createElement('canvas');this.canvas.className='graphics-surface';this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';container.append(this.canvas);surfaces.set(this.canvas,this);this.context=this.canvas.getContext('2d');this.resizeObserver=new ResizeObserver(()=>this.scheduleResize());this.resizeObserver.observe(container);this.resize();if(backend!=='canvas2d')this.gpuReady=this.initializeGPU();else onBackend('Canvas2D');}
  releaseGPU(){
    // A surface owns its buffers/context, never the window's shared device.
    this.gpuGeneration=(this.gpuGeneration||0)+1;
    this.rasterPresenter?.dispose();this.rasterPresenter=null;this.rasterPending=null;
    this.vertexBuffer?.destroy();this.uniform?.destroy();this.gpuContext?.unconfigure();this.gpuCanvas?.remove();
    this.vertexBuffer=this.uniform=this.gpuContext=this.gpuCanvas=this.pipeline=this.bindGroup=this.device=null;
    this.bufferSize=0;this.backend='canvas2d';
  }
  async initializeGPU(){
    const generation=this.gpuGeneration=(this.gpuGeneration||0)+1;
    const document=this.container.ownerDocument,view=document.defaultView;
    const current=()=>!this.disposed&&this.gpuGeneration===generation&&this.container.ownerDocument===document;
    const device=await getGPUDevice(view);
    if(!current())return false;
    if(!device){this.gpuError='No WebGPU device became available';this.onBackend('Canvas2D');return false;}
    let context,uniform;
    try{
      const canvas=document.createElement('canvas');canvas.className='graphics-surface';canvas.style.cssText=this.canvas.style.cssText;
      context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU canvas context unavailable in this window');
      const format=view.navigator.gpu.getPreferredCanvasFormat();
      const module=device.createShaderModule({code:SHADER});
      const info=await module.getCompilationInfo();
      if(!current())return false;
      if(info.messages.some(m=>m.type==='error'))throw new Error('Graphics shader compilation failed: '+info.messages.filter(m=>m.type==='error').map(m=>m.message).join('; '));
      let pipeline,bindGroup,validation;
      device.pushErrorScope('validation');
      try{
        context.configure({device,format,alphaMode:'opaque',usage:view.GPUTextureUsage.RENDER_ATTACHMENT|view.GPUTextureUsage.COPY_SRC});
        pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}});
        uniform=device.createBuffer({size:16,usage:view.GPUBufferUsage.UNIFORM|view.GPUBufferUsage.COPY_DST});
        bindGroup=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}}]});
      }finally{validation=await device.popErrorScope();}
      if(validation)throw validation;
      if(!current()){uniform.destroy();context.unconfigure();return false;}
      Object.assign(this,{device,pipeline,uniform,bindGroup,gpuCanvas:canvas,gpuContext:context,gpuFormat:format,gpuError:null});
      this.canvas.before(canvas);this.canvas.style.zIndex='1';this.backend='webgpu';
      device.lost.then(info=>{if(current()&&this.device===device){this.gpuError='WebGPU device lost: '+info.message;this.releaseGPU();this.onBackend('Canvas2D · device lost');this.invalidate();}});
      this.resize();this.onBackend('WebGPU');return true;
    }catch(error){
      uniform?.destroy();context?.unconfigure();
      if(current()){this.gpuError=error.message||String(error);this.releaseGPU();this.onBackend('Canvas2D');this.invalidate();}
      return false;
    }
  }
  scheduleResize(){
    if(this.disposed||this.resizeFrame)return;
    this.resizeWindow=this.container.ownerDocument.defaultView;
    this.resizeFrame=this.resizeWindow.requestAnimationFrame(()=>{this.resizeFrame=0;this.resize();});
  }
  transferDocument(){
    if(this.disposed)return;
    const changed=this.themeDocument!==this.container.ownerDocument;
    this.resizeWindow?.cancelAnimationFrame(this.resizeFrame);this.resizeFrame=0;
    this.themeDocument.removeEventListener('vb-theme-change',this.themeChanged);
    (this.frameWindow||this.themeDocument.defaultView).cancelAnimationFrame(this.raf);this.dirty=false;
    this.themeDocument=this.container.ownerDocument;this.themeDocument.addEventListener('vb-theme-change',this.themeChanged);
    this.theme=getTheme(this.container).id;this.resizeObserver.disconnect();
    this.resizeObserver=new this.themeDocument.defaultView.ResizeObserver(()=>this.scheduleResize());this.resizeObserver.observe(this.container);
    if(changed){this.releaseGPU();if(this.requestedBackend!=='canvas2d')this.gpuReady=this.initializeGPU();}
    this.resize();
  }
  resize(){if(this.disposed)return;this.theme=getTheme(this.container).id;const rect=this.container.getBoundingClientRect(),dpr=Math.min(this.container.ownerDocument.defaultView.devicePixelRatio||1,3,8192/Math.max(1,this.container.clientWidth||rect.width),8192/Math.max(1,this.container.clientHeight||rect.height));this.width=Math.max(1,Math.min(8192,Math.round(this.container.clientWidth||rect.width)));this.height=Math.max(1,Math.min(8192,Math.round(this.container.clientHeight||rect.height)));for(const canvas of [this.canvas,this.gpuCanvas])if(canvas){const width=Math.max(1,Math.min(8192,Math.round(this.width*dpr))),height=Math.max(1,Math.min(8192,Math.round(this.height*dpr)));if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;}this.dpr=dpr;this.invalidate();}
  add(kind,coords,color=0,fill=false,width=1){if(this.commands.length>=50000)throw new Error('Graphics command limit reached (50,000); use Cls between frames.');this.commands.push({kind,coords:[...coords],color,fill,width});this.invalidate();}
  text(text,x,y,color=0,font='12px Arial'){if(this.commands.length>=50000)throw new Error('Graphics command limit reached (50,000).');this.commands.push({kind:'text',text:String(text),coords:[x,y],color,font});this.invalidate();}
  clear(){this.rasterPresenter?.dispose();this.rasterPresenter=null;this.commands=[];this.rasterBytes=0;this.gdiCanvas=null;this.invalidate();}
  // Raster transfers retain CPU-readable command order; presentation may use WebGPU.
  // No synchronous GPU readback or CSS/device-pixel coordinate mixing is needed.
  writePixels(x,y,image){
    const {width,height,data}=image,bytes=width*height*4;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||bytes>16*1024*1024||data?.length!==bytes)throw new RangeError('Invalid or oversized GDI raster');
    const last=this.commands.at(-1),replace=last?.kind==='bitmap'&&last.coords[0]===x&&last.coords[1]===y&&last.canvas.width===width&&last.canvas.height===height;
    const full=x===0&&y===0&&width===this.width&&height===this.height;
    const retained=full?0:(this.rasterBytes||0)-(replace?last.canvas.width*last.canvas.height*4:0);
    if(retained+bytes>32*1024*1024||!replace&&!full&&this.commands.length>=50000)throw new RangeError('GDI raster command quota exceeded; use Cls');
    const canvas=this.container.ownerDocument.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d'),pixels=context.createImageData(width,height);pixels.data.set(data);
    // Ordinary GDI COLORREF drawing has no per-window alpha channel.
    for(let i=3;i<bytes;i+=4)pixels.data[i]=255;
    context.putImageData(pixels,0,0);
    if(full)this.commands=[];else if(replace)this.commands.pop();
    this.commands.push({kind:'bitmap',coords:[x,y],canvas});this.rasterBytes=retained+bytes;this.invalidate();
  }
  rasterize(){
    if(this.width*this.height>4194304)throw new RangeError('GDI readback surface exceeds four million pixels');
    if(this.gdiCanvas&&this.gdiPaintRevision===this.paintRevision)return this.gdiCanvas;
    const canvas=this.gdiCanvas||this.container.ownerDocument.createElement('canvas');
    canvas.width=this.width;canvas.height=this.height;const ctx=canvas.getContext('2d');
    ctx.fillStyle=oleColor(this.background,'#c0c0c0',this.theme);ctx.fillRect(0,0,this.width,this.height);
    if(this.picture)ctx.drawImage(this.picture,0,0);
    if(this.grid){ctx.fillStyle='#808080';for(let y=0;y<this.height;y+=this.grid)for(let x=0;x<this.width;x+=this.grid)ctx.fillRect(x,y,1,1);}
    for(const cmd of this.commands){const a=cmd.coords;
      if(cmd.kind==='bitmap'){ctx.drawImage(cmd.canvas,...a);continue;}
      ctx.strokeStyle=ctx.fillStyle=oleColor(cmd.color,'#000000',this.theme);ctx.lineWidth=cmd.width||1;ctx.beginPath();
      if(cmd.kind==='pixel')ctx.fillRect(a[0],a[1],1,1);
      else if(cmd.kind==='line'){ctx.moveTo(a[0]+.5,a[1]+.5);ctx.lineTo(a[2]+.5,a[3]+.5);ctx.stroke();}
      else if(cmd.kind==='rect'){const r=[Math.min(a[0],a[2]),Math.min(a[1],a[3]),Math.abs(a[2]-a[0]),Math.abs(a[3]-a[1])];cmd.fill?ctx.fillRect(...r):ctx.strokeRect(...r);}
      else if(cmd.kind==='circle'){ctx.arc(a[0],a[1],Math.abs(a[2]),0,Math.PI*2);cmd.fill?ctx.fill():ctx.stroke();}
      else if(cmd.kind==='text'){ctx.font=cmd.font;ctx.textBaseline='top';ctx.fillText(cmd.text,...a);}
    }
    this.gdiCanvas=canvas;this.gdiPaintRevision=this.paintRevision;return canvas;
  }
  readPixels(x,y,width,height){return this.rasterize().getContext('2d').getImageData(x,y,width,height);}
  setPicture(source){
    if((source||'')===(this.pictureSource||''))return;this.pictureSource=source||'';this.picture=null;this.pictureError=null;
    if(source){const image=new Image();image.onload=()=>{if(!this.disposed&&this.pictureSource===source){this.picture=image;this.invalidate();}};image.onerror=()=>{if(!this.disposed&&this.pictureSource===source){this.pictureError='Image decoding failed';this.invalidate();}};image.src=source;}
    this.invalidate();
  }
  setGrid(spacing=8){this.grid=spacing;this.invalidate();}
  invalidate(){this.paintRevision=(this.paintRevision||0)+1;if(this.dirty||this.disposed)return;this.dirty=true;this.frameWindow=this.container.ownerDocument.defaultView;this.raf=this.frameWindow.requestAnimationFrame(()=>{this.dirty=false;this.render();});}
  vertices(){const out=[];const triangle=(p1,p2,p3,c)=>{for(const p of [p1,p2,p3])out.push(p[0],p[1],...c);};const rect=(x,y,w,h,c)=>{triangle([x,y],[x+w,y],[x,y+h],c);triangle([x+w,y],[x+w,y+h],[x,y+h],c);};const line=(x1,y1,x2,y2,width,c)=>{const dx=x2-x1,dy=y2-y1,length=Math.hypot(dx,dy)||1,ox=-dy/length*width/2,oy=dx/length*width/2;triangle([x1+ox,y1+oy],[x2+ox,y2+oy],[x1-ox,y1-oy],c);triangle([x1-ox,y1-oy],[x2+ox,y2+oy],[x2-ox,y2-oy],c);};
    if(this.grid){const c=rgba(8421504);for(let y=0;y<this.height;y+=this.grid)for(let x=0;x<this.width;x+=this.grid)rect(x,y,1,1,c);}
    for(const cmd of this.commands){const c=rgba(cmd.color,this.theme),a=cmd.coords;if(cmd.kind==='pixel')rect(a[0],a[1],1,1,c);else if(cmd.kind==='line')line(...a,cmd.width,c);else if(cmd.kind==='rect'){const x=Math.min(a[0],a[2]),y=Math.min(a[1],a[3]),w=Math.abs(a[2]-a[0]),h=Math.abs(a[3]-a[1]);if(cmd.fill)rect(x,y,w,h,c);else{rect(x,y,w,cmd.width,c);rect(x,y+h-cmd.width,w,cmd.width,c);rect(x,y,cmd.width,h,c);rect(x+w-cmd.width,y,cmd.width,h,c);}}else if(cmd.kind==='circle'){const n=Math.min(180,Math.max(16,Math.round(a[2]*2))),[cx,cy,r]=a;for(let i=0;i<n;i++){const a1=i/n*Math.PI*2,a2=(i+1)/n*Math.PI*2,p1=[cx+Math.cos(a1)*r,cy+Math.sin(a1)*r],p2=[cx+Math.cos(a2)*r,cy+Math.sin(a2)*r];if(cmd.fill)triangle([cx,cy],p1,p2,c);else line(...p1,...p2,cmd.width,c);}}}return new Float32Array(out);}
  render(){if(this.disposed)return;if(this.rasterBytes){
      if(this.backend==='webgpu'&&this.gpuCanvas){
        if(!this.rasterPresenter&&!this.rasterPending){
          const generation=this.gpuGeneration,device=this.device;
          this.rasterPending=GPURasterPresenter.create(device,this.gpuFormat).then(presenter=>{
            if(this.disposed||this.gpuGeneration!==generation||this.device!==device){presenter.dispose();return;}
            this.rasterPending=null;if(this.rasterBytes){this.rasterPresenter=presenter;this.invalidate();}else presenter.dispose();
          }).catch(error=>{if(!this.disposed&&this.gpuGeneration===generation){this.gpuError=error.message||String(error);this.releaseGPU();this.invalidate();}});
        }
        if(this.rasterPresenter)try{
          this.rasterPresenter.render(this.gpuContext,this.rasterize(),this.paintRevision,this.gpuCanvas.width,this.gpuCanvas.height);
          this.gpuCanvas.hidden=false;const ctx=this.context;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
          if(this.renderingBackend!=='WebGPU · GDI texture'){this.renderingBackend='WebGPU · GDI texture';this.onBackend(this.renderingBackend);}return;
        }catch(error){this.gpuError=error.message||String(error);this.releaseGPU();}
      }
      const actual='Canvas2D · GDI bitmap';if(this.renderingBackend!==actual){this.renderingBackend=actual;this.onBackend(actual);}if(this.gpuCanvas)this.gpuCanvas.hidden=true;const ctx=this.context;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.clearRect(0,0,this.width,this.height);ctx.save();try{ctx.imageSmoothingEnabled=false;ctx.drawImage(this.rasterize(),0,0);}finally{ctx.restore();}return;}const actual=this.picture?'Canvas2D · raster picture':this.backend==='webgpu'?'WebGPU':'Canvas2D';if(actual!==this.renderingBackend){this.renderingBackend=actual;this.onBackend(actual);}const ctx=this.context;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.clearRect(0,0,this.width,this.height);if(this.gpuCanvas)this.gpuCanvas.hidden=!!this.picture;if(this.backend==='webgpu'&&this.gpuCanvas&&!this.picture){try{const data=this.vertices(),device=this.device;device.queue.writeBuffer(this.uniform,0,new Float32Array([this.width,this.height,0,0]));if(!this.vertexBuffer||this.bufferSize<data.byteLength){this.vertexBuffer?.destroy();this.bufferSize=Math.max(1024,Math.ceil(data.byteLength/1024)*1024);this.vertexBuffer=device.createBuffer({size:this.bufferSize,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}if(data.length)device.queue.writeBuffer(this.vertexBuffer,0,data);const encoder=device.createCommandEncoder(),bg=rgba(this.background,this.theme);const pass=encoder.beginRenderPass({colorAttachments:[{view:this.gpuContext.getCurrentTexture().createView(),clearValue:{r:bg[0],g:bg[1],b:bg[2],a:1},loadOp:'clear',storeOp:'store'}]});if(data.length){pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.setVertexBuffer(0,this.vertexBuffer);pass.draw(data.length/6);}pass.end();device.queue.submit([encoder.finish()]);}catch(error){this.gpuError=error.message||String(error);this.backend='canvas2d';this.gpuCanvas.remove();this.gpuCanvas=null;this.onBackend('Canvas2D');}}
    if(this.backend==='canvas2d'||this.picture){ctx.fillStyle=oleColor(this.background,'#c0c0c0',this.theme);ctx.fillRect(0,0,this.width,this.height);if(this.picture)ctx.drawImage(this.picture,0,0);if(this.grid){ctx.fillStyle='#808080';for(let y=0;y<this.height;y+=this.grid)for(let x=0;x<this.width;x+=this.grid)ctx.fillRect(x,y,1,1);}for(const cmd of this.commands){const a=cmd.coords;ctx.strokeStyle=ctx.fillStyle=oleColor(cmd.color,'#000000',this.theme);ctx.lineWidth=cmd.width||1;ctx.beginPath();if(cmd.kind==='pixel')ctx.fillRect(a[0],a[1],1,1);if(cmd.kind==='line'){ctx.moveTo(a[0]+.5,a[1]+.5);ctx.lineTo(a[2]+.5,a[3]+.5);ctx.stroke();}if(cmd.kind==='rect'){const r=[Math.min(a[0],a[2]),Math.min(a[1],a[3]),Math.abs(a[2]-a[0]),Math.abs(a[3]-a[1])];cmd.fill?ctx.fillRect(...r):ctx.strokeRect(...r);}if(cmd.kind==='circle'){ctx.arc(a[0],a[1],Math.abs(a[2]),0,Math.PI*2);cmd.fill?ctx.fill():ctx.stroke();}}}
    for(const cmd of this.commands)if(cmd.kind==='text'){ctx.fillStyle=oleColor(cmd.color,'#000000',this.theme);ctx.font=cmd.font;ctx.textBaseline='top';ctx.fillText(cmd.text,...cmd.coords);}
  }
  dispose(){this.disposed=true;this.resizeWindow?.cancelAnimationFrame(this.resizeFrame);this.themeDocument.removeEventListener('vb-theme-change',this.themeChanged);(this.frameWindow||this.container.ownerDocument.defaultView).cancelAnimationFrame(this.raf);this.resizeObserver.disconnect();this.releaseGPU();this.commands=[];this.rasterBytes=0;this.gdiCanvas=null;this.canvas.remove();}
}
