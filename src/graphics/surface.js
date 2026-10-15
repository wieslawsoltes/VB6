import {GPURasterPresenter} from '../../packages/win32-browser/src/gpu-presenter.js';
import { colorValue, getTheme } from '../theme/theme.js';
import {RetainedGraphics} from './retained.js';
import {RasterCache,canvas2D} from './raster.js';
import {GRAPHICS_LIMITS,graphicsColor,triangleCompatible} from './contract.js';
/** Demand-rendered retained graphics. Opaque integer fills use triangles; other
 * operations share ordered CPU rasterization and a cached WebGPU texture. */
const surfaces = new WeakMap();
export function refreshGraphicsSurfaces(root) { for (const canvas of root.querySelectorAll('canvas.graphics-surface')) surfaces.get(canvas)?.transferDocument(); }
const sharedDevices = new WeakMap();
export function oleColor(color,fallback='#c0c0c0',theme='classic'){return colorValue(color,fallback,theme);}
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
export class GraphicsSurface extends RetainedGraphics {
  constructor(container,{backend='auto',background=16777215,onBackend=()=>{}}={}){
    super(container);
    if(!['auto','webgpu','canvas2d'].includes(backend))throw new RangeError('Invalid graphics backend');
    this.themeDocument=container.ownerDocument;this.theme=getTheme(container).id;this.requestedBackend=backend;this.backend='canvas2d';this._background=graphicsColor(background);this.onBackend=onBackend;this.width=this.height=1;this.dpr=1;
    this.themeChanged=()=>{this.theme=getTheme(container).id;this.invalidate();};
    this.fontsChanged=()=>{this.replayEpoch++;this.invalidate();};
    this.bindDocument();
    this.canvas=container.ownerDocument.createElement('canvas');this.canvas.className='graphics-surface';this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none';container.append(this.canvas);surfaces.set(this.canvas,this);
    this.context=this.canvas.getContext('2d');if(!this.context){this.unbindDocument();this.canvas.remove();throw new Error('Canvas2D graphics fallback unavailable');}
    this.resizeObserver=new this.themeDocument.defaultView.ResizeObserver(()=>this.scheduleResize());this.resizeObserver.observe(container);
    this.resize();if(backend!=='canvas2d')this.gpuReady=this.initializeGPU();else this.reportBackend('Canvas2D');
  }
  get background(){return this._background;}
  set background(value){value=graphicsColor(value);if(value!==this._background){this._background=value;this.invalidate();}}
  bindDocument(){this.themeDocument.addEventListener('vb-theme-change',this.themeChanged);this.themeDocument.fonts?.addEventListener('loadingdone',this.fontsChanged);}
  unbindDocument(){this.themeDocument.removeEventListener('vb-theme-change',this.themeChanged);this.themeDocument.fonts?.removeEventListener('loadingdone',this.fontsChanged);}
  reportBackend(value){if(value!==this.renderingBackend){this.renderingBackend=value;this.onBackend(value);}}
  releaseRaster(){this.rasterGeneration=(this.rasterGeneration||0)+1;this.rasterPresenter?.dispose();this.rasterPresenter=null;this.rasterPending=null;this.presentedCache=null;}
  releaseGPU(){
    // Shared window devices are never destroyed by an individual surface.
    this.gpuGeneration=(this.gpuGeneration||0)+1;this.releaseRaster();
    this.vertexBuffer?.destroy();this.uniform?.destroy();this.gpuContext?.unconfigure();this.gpuCanvas?.remove();
    this.vertexBuffer=this.uniform=this.gpuContext=this.gpuCanvas=this.pipeline=this.bindGroup=this.device=null;
    this.uploadedVertices=null;this.bufferSize=0;this.backend='canvas2d';
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
    if(this.disposed)return;const document=this.container.ownerDocument,changed=this.themeDocument!==document;
    this.resizeWindow?.cancelAnimationFrame(this.resizeFrame);this.resizeFrame=0;
    (this.frameWindow||this.themeDocument.defaultView).cancelAnimationFrame(this.raf);this.raf=0;this.dirty=false;
    this.unbindDocument();this.themeDocument=document;this.bindDocument();this.theme=getTheme(this.container).id;
    this.resizeObserver.disconnect();this.resizeObserver=new document.defaultView.ResizeObserver(()=>this.scheduleResize());this.resizeObserver.observe(this.container);
    if(changed){
      this.dropRasterCaches();this.colorContext=null;this.colorCache=null;this.vertexData=null;this.releaseGPU();
      if(this.requestedBackend!=='canvas2d')this.gpuReady=this.initializeGPU();
    }
    this.resize();
  }
  resize(){
    if(this.disposed)return;this.theme=getTheme(this.container).id;
    const rect=this.container.getBoundingClientRect(),view=this.container.ownerDocument.defaultView,limit=Math.min(GRAPHICS_LIMITS.dimension,this.device?.limits?.maxTextureDimension2D||GRAPHICS_LIMITS.dimension);
    const safe=n=>Number.isFinite(n)?Math.max(1,Math.min(GRAPHICS_LIMITS.dimension,Math.round(n))):1;
    const computed=(!this.container.clientWidth||!this.container.clientHeight)?view.getComputedStyle?.(this.container):null;
    this.width=safe(this.container.clientWidth||parseFloat(computed?.width)||rect.width);this.height=safe(this.container.clientHeight||parseFloat(computed?.height)||rect.height);
    // Bound dimensions AND total allocation, including high-DPI displays.
    this.dpr=Math.min(Math.max(.1,Number(view.devicePixelRatio)||1),3,limit/this.width,limit/this.height,Math.sqrt(GRAPHICS_LIMITS.displayPixels/(this.width*this.height)));
    for(const canvas of [this.canvas,this.gpuCanvas])if(canvas){const width=Math.max(1,Math.floor(this.width*this.dpr)),height=Math.max(1,Math.floor(this.height*this.dpr));if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;}
    this.invalidate();
  }
  invalidate(){
    if(this.disposed)return;this.paintRevision=(this.paintRevision||0)+1;
    if(this.batchDepth){this.batchDirty=true;return;}if(this.dirty)return;
    this.dirty=true;this.frameWindow=this.container.ownerDocument.defaultView;
    this.raf=this.frameWindow.requestAnimationFrame(()=>{this.dirty=false;this.raf=0;this.render();});
  }
  rgba(color){
    const key=this.theme+':'+color;this.colorCache||=new Map();let value=this.colorCache.get(key);if(value)return value;
    this.colorContext||=canvas2D(this.container.ownerDocument,1,1).context;const ctx=this.colorContext;
    ctx.clearRect(0,0,1,1);ctx.fillStyle='#000000';ctx.fillStyle=oleColor(color,'#000000',this.theme);ctx.fillRect(0,0,1,1);
    value=Array.from(ctx.getImageData(0,0,1,1).data,v=>v/255);if(this.colorCache.size>=256)this.colorCache.delete(this.colorCache.keys().next().value);this.colorCache.set(key,value);return value;
  }
  canUseTriangles(){
    if(this.picture||this.pictureTask||this.rasterBytes||this.grid&&!Number.isInteger(this.grid))return false;
    const grid=this.grid?Math.ceil(this.width/this.grid)*Math.ceil(this.height/this.grid):0;
    if(this.commands.length+grid>58000||this.rgba(this.background)[3]!==1)return false;
    const key=[this.commands.length,this.theme,this.replayEpoch,this.dpr].join(':');
    if(this.triangleCommands===this.commands&&this.triangleKey===key)return this.triangleEligible;
    this.triangleCommands=this.commands;this.triangleKey=key;
    // Fractional physical edges differ between triangle coverage and Canvas2D.
    this.triangleEligible=Number.isInteger(this.dpr)&&this.commands.every(c=>triangleCompatible(c)&&this.rgba(c.color)[3]===1&&c.width===1);
    return this.triangleEligible;
  }
  vertices(){
    const key=[this.commands.length,this.width,this.height,this.grid,this.theme,this.replayEpoch].join(':');
    if(this.vertexCommands===this.commands&&this.vertexKey===key)return this.vertexData;
    const grid=this.grid?Math.ceil(this.width/this.grid)*Math.ceil(this.height/this.grid):0;
    if(this.commands.length+grid>58000)throw new RangeError('Graphics triangle budget exceeded');
    const data=new Float32Array((this.commands.length+grid)*36);let offset=0;
    const rect=(x,y,w,h,c)=>{for(const [px,py] of [[x,y],[x+w,y],[x,y+h],[x+w,y],[x+w,y+h],[x,y+h]]){data[offset++]=px;data[offset++]=py;for(const v of c)data[offset++]=v;}};
    if(this.grid){const c=this.rgba(8421504);for(let y=0;y<this.height;y+=this.grid)for(let x=0;x<this.width;x+=this.grid)rect(x,y,1,1,c);}
    for(const cmd of this.commands){if(!triangleCompatible(cmd))throw new Error('Primitive requires ordered raster presentation');const a=cmd.coords,c=this.rgba(cmd.color);if(cmd.kind==='pixel')rect(a[0],a[1],1,1,c);else rect(Math.min(a[0],a[2]),Math.min(a[1],a[3]),Math.abs(a[2]-a[0]),Math.abs(a[3]-a[1]),c);}
    this.vertexCommands=this.commands;this.vertexKey=key;return this.vertexData=data;
  }
  renderTriangles(){
    const data=this.vertices(),device=this.device,usage=this.container.ownerDocument.defaultView.GPUBufferUsage;
    device.queue.writeBuffer(this.uniform,0,new Float32Array([this.width,this.height,0,0]));
    if(data.length){
      if(!this.vertexBuffer||this.bufferSize<data.byteLength){this.vertexBuffer?.destroy();this.bufferSize=Math.max(1024,Math.ceil(data.byteLength/1024)*1024);this.vertexBuffer=device.createBuffer({size:this.bufferSize,usage:usage.VERTEX|usage.COPY_DST});this.uploadedVertices=null;}
      if(this.uploadedVertices!==data){device.queue.writeBuffer(this.vertexBuffer,0,data);this.uploadedVertices=data;}
    }
    const encoder=device.createCommandEncoder(),bg=this.rgba(this.background),pass=encoder.beginRenderPass({colorAttachments:[{view:this.gpuContext.getCurrentTexture().createView(),clearValue:{r:bg[0],g:bg[1],b:bg[2],a:1},loadOp:'clear',storeOp:'store'}]});
    if(data.length){pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.setVertexBuffer(0,this.vertexBuffer);pass.draw(data.length/6);}pass.end();device.queue.submit([encoder.finish()]);
  }
  ensureRasterPresenter(){
    if(this.rasterPresenter||this.rasterPending||this.disposed||!this.device)return;
    const generation=this.rasterGeneration||0,device=this.device;
    const current=()=>!this.disposed&&(this.rasterGeneration||0)===generation&&this.device===device;
    const pending=GPURasterPresenter.create(device,this.gpuFormat).then(presenter=>{
      if(!current()){presenter.dispose();return false;}this.rasterPresenter=presenter;this.invalidate();return true;
    },error=>{if(current()){this.gpuError=error.message||String(error);this.releaseGPU();this.invalidate();}return false;});
    this.rasterPending=pending;pending.then(()=>{if(this.rasterPending===pending)this.rasterPending=null;});
  }
  render(){
    if(this.disposed)return;
    const ctx=this.context;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    if(this.backend==='webgpu'&&this.gpuCanvas){
      try{
        if(this.canUseTriangles()){this.renderTriangles();this.gpuCanvas.hidden=false;this.reportBackend('WebGPU');this.renderError=null;return;}
        this.ensureRasterPresenter();
        if(this.rasterPresenter){
          const scale=this.hasGDI?1:this.dpr,cache=this.hasGDI?(this.logicalCache||=new RasterCache(this.container.ownerDocument)):(this.displayCache||=new RasterCache(this.container.ownerDocument));
          const source=cache.render(this,scale);if(this.presentedCache!==cache){this.rasterPresenter.revision=-1;this.presentedCache=cache;}
          this.rasterPresenter.render(this.gpuContext,source,cache.revision,this.gpuCanvas.width,this.gpuCanvas.height);
          this.gpuCanvas.hidden=false;this.reportBackend(this.hasGDI?'WebGPU · GDI texture':'WebGPU · retained texture');this.renderError=null;return;
        }
      }catch(error){this.gpuError=error.message||String(error);this.releaseGPU();}
    }
    if(this.gpuCanvas)this.gpuCanvas.hidden=true;
    try{
      const scale=this.hasGDI?1:this.dpr,cache=this.hasGDI?(this.logicalCache||=new RasterCache(this.container.ownerDocument)):(this.displayCache||=new RasterCache(this.container.ownerDocument)),source=cache.render(this,scale);
      ctx.imageSmoothingEnabled=false;ctx.drawImage(source,0,0,this.canvas.width,this.canvas.height);this.renderError=null;
      this.reportBackend(this.hasGDI?'Canvas2D · GDI bitmap':this.rasterPending?'Canvas2D · GPU initialization':'Canvas2D');
    }catch(error){this.renderError=error.message||String(error);ctx.fillStyle=oleColor(this.background,'#ffffff',this.theme);ctx.fillRect(0,0,this.canvas.width,this.canvas.height);this.reportBackend('Canvas2D · graphics error');}
  }
  get statistics(){return Object.freeze({commands:this.commands.length,commandBytes:this.commandBytes,rasterBytes:this.rasterBytes,pendingImages:this.imageTasks.size,backend:this.renderingBackend||this.backend,logicalRebuilds:this.logicalCache?.rebuilds||0,displayRebuilds:this.displayCache?.rebuilds||0,logicalCommandsPainted:this.logicalCache?.painter.painted||0,displayCommandsPainted:this.displayCache?.painter.painted||0,gpuBufferBytes:this.bufferSize||0,error:this.renderError||this.gpuError||this.pictureError||null});}
  dispose(){
    if(this.disposed)return;this.disposed=true;
    this.resizeObserver?.disconnect();this.resizeWindow?.cancelAnimationFrame(this.resizeFrame);(this.frameWindow||this.themeDocument.defaultView).cancelAnimationFrame(this.raf);this.dirty=false;
    this.unbindDocument();this.releaseGPU();this.disposeRetained();this.vertexData=this.vertexCommands=this.uploadedVertices=null;this.colorCache?.clear();this.colorContext=null;
    surfaces.delete(this.canvas);this.canvas.remove();
  }
}
