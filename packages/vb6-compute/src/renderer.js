import {ComputeError, BUFFER_USAGE, TEXTURE_USAGE, MAX_CURVE_EDGES, integer} from './protocol.js';
import {ComputeScene} from './scene.js';
import {ComputeProgram} from './runtime.js';
import {RENDER_WGSL} from './render-wgsl.js';

export class ComputeRenderer {
  static async create(gpu,{width=640,height=480,canvas=null,tileCapacity=128,samples=4}={}) {
    const renderer=new ComputeRenderer(gpu,width,height,canvas,tileCapacity,samples);
    try{await gpu.operation(d=>renderer.initialize(d));return renderer;}catch(e){await renderer.dispose();throw e;}
  }
  constructor(gpu,width,height,canvas,tileCapacity,samples) {
    this.gpu=gpu;this.width=integer(width,'width',1,gpu.device.limits.maxTextureDimension2D);this.height=integer(height,'height',1,gpu.device.limits.maxTextureDimension2D);
    this.tileCapacity=integer(tileCapacity,'tileCapacity',1,1024);if(![1,4].includes(samples))throw new ComputeError('samples must be 1 or 4','GPU_OPTION');this.samples=samples;
    this.canvas=canvas;this.closed=false;this.buffers=[];this.context=null;
    this.tilesX=Math.ceil(width/16);this.tilesY=Math.ceil(height/16);
    const tileBytes=this.tilesX*this.tilesY*(this.tileCapacity+1)*4;
    if(tileBytes>gpu.device.limits.maxStorageBufferBindingSize)throw new ComputeError('Tile storage exceeds device limits','GPU_LIMIT');
  }
  async initialize(d) {
    this.texture=d.createTexture({label:'VB6 compute framebuffer',size:[this.width,this.height],format:'rgba8unorm',usage:TEXTURE_USAGE.STORAGE_BINDING|TEXTURE_USAGE.COPY_SRC|TEXTURE_USAGE.TEXTURE_BINDING});this.gpu.resources.add(this.texture);
    this.params=this.gpu.buffer(48,BUFFER_USAGE.UNIFORM|BUFFER_USAGE.COPY_DST,'VB6 render parameters');this.buffers.push(this.params);
    this.tiles=this.gpu.buffer(this.tilesX*this.tilesY*(this.tileCapacity+1)*4,BUFFER_USAGE.STORAGE,'VB6 ordered tile bins');this.buffers.push(this.tiles);
    this.layout=d.createBindGroupLayout({entries:[
      {binding:0,visibility:4,buffer:{type:'storage'}},{binding:1,visibility:4,buffer:{type:'read-only-storage'}},{binding:2,visibility:4,buffer:{type:'uniform'}},
      {binding:3,visibility:4,buffer:{type:'read-only-storage'}},{binding:4,visibility:4,buffer:{type:'storage'}},{binding:5,visibility:4,buffer:{type:'storage'}},
      {binding:6,visibility:4,storageTexture:{access:'write-only',format:'rgba8unorm'}},{binding:7,visibility:4,buffer:{type:'read-only-storage'}}]});
    const module=await this.gpu.shader(RENDER_WGSL,'VB6 coarse/fine rasterizer'),layout=d.createPipelineLayout({bindGroupLayouts:[this.layout]});this.pipelines={};
    for(const entryPoint of ['flatten','prepare','coarse','fine'])this.pipelines[entryPoint]=await d.createComputePipelineAsync({layout,compute:{module,entryPoint}});
    if(this.canvas) {
      this.canvas.width=this.width;this.canvas.height=this.height;this.context=this.canvas.getContext('webgpu');
      if(!this.context)throw new ComputeError('A WebGPU canvas context is required','GPU_CANVAS');
      this.context.configure({device:d,format:'rgba8unorm',alphaMode:'premultiplied',usage:TEXTURE_USAGE.COPY_DST|TEXTURE_USAGE.RENDER_ATTACHMENT});
    }
  }
  check() {this.gpu.check();if(this.closed)throw new ComputeError('Renderer is disposed','GPU_DISPOSED');}
  render(source,{present=true}={}) {
    this.check();const isProgram=source instanceof ComputeProgram;
    if(!isProgram&&!(source instanceof ComputeScene))throw new ComputeError('Expected ComputeScene or ComputeProgram','GPU_TYPE');
    if(source.width!==this.width||source.height!==this.height)throw new ComputeError('Surface dimensions do not match renderer','GPU_SIZE');
    if(isProgram&&source.gpu!==this.gpu)throw new ComputeError('Program and renderer must share a ComputeDevice','GPU_DEVICE');
    const encoded=isProgram?null:source.encode();
    return this.gpu.operation(d=>{
      this.check();if(isProgram)source.check();const transient=[];
      const upload=(data,usage,label)=>{const b=this.gpu.buffer(data.byteLength,usage|BUFFER_USAGE.COPY_DST,label);transient.push(b);d.queue.writeBuffer(b,0,data);return b;};
      try {
        const count=isProgram?source.count:1,capacity=isProgram?source.capacity:Math.max(1,encoded.count),total=count*capacity,stride=isProgram?source.artifact.stateStride:6,curveCount=encoded?.curveCount||0;
        if(Math.ceil(total/64)>d.limits.maxComputeWorkgroupsPerDimension||Math.ceil(curveCount*MAX_CURVE_EDGES/64)>d.limits.maxComputeWorkgroupsPerDimension)throw new ComputeError('Raster dispatch exceeds device limits','GPU_LIMIT');
        const commands=isProgram?source.draws:upload(encoded.commands,BUFFER_USAGE.STORAGE,'Scene commands');
        const states=isProgram?source.state:upload(new Uint32Array([0,0,0,encoded.count,0,0]),BUFFER_USAGE.STORAGE,'Scene state');
        const curves=upload(encoded?.curves||new Uint32Array(12),BUFFER_USAGE.STORAGE,'Encoded curves');
        const images=upload(encoded?.images||new Uint32Array(1),BUFFER_USAGE.STORAGE,'RGBA image pixels');
        const edges=this.gpu.buffer(Math.max(1,curveCount)*MAX_CURVE_EDGES*16,BUFFER_USAGE.STORAGE,'Flattened curve edges');transient.push(edges);
        d.queue.writeBuffer(this.params,0,new Uint32Array([this.width,this.height,total,capacity,stride,count,this.tilesX,this.tilesY,this.tileCapacity,curveCount,this.samples,0]));
        const bindGroup=d.createBindGroup({layout:this.layout,entries:[commands,states,this.params,curves,edges,this.tiles].map((buffer,binding)=>({binding,resource:{buffer}})).concat([{binding:6,resource:this.texture.createView()},{binding:7,resource:{buffer:images}}])});
        const encoder=d.createCommandEncoder();
        const pass=(name,x,y=1)=>{if(!x)return;const p=encoder.beginComputePass({label:'VB6 '+name});p.setPipeline(this.pipelines[name]);p.setBindGroup(0,bindGroup);p.dispatchWorkgroups(x,y);p.end();};
        pass('flatten',Math.ceil(curveCount*MAX_CURVE_EDGES/64));pass('prepare',Math.ceil(total/64));pass('coarse',Math.ceil(this.tilesX*this.tilesY/64));pass('fine',Math.ceil(this.width/8),Math.ceil(this.height/8));
        if(present&&this.context)encoder.copyTextureToTexture({texture:this.texture},{texture:this.context.getCurrentTexture()},[this.width,this.height]);
        d.queue.submit([encoder.finish()]);return {width:this.width,height:this.height,passes:curveCount?4:3};
      } finally {for(const b of transient)this.gpu.release(b);}
    });
  }
  readPixels() {
    this.check();return this.gpu.operation(async d=>{
      this.check();const row=Math.ceil(this.width*4/256)*256,size=row*this.height;
      const buffer=this.gpu.buffer(size,BUFFER_USAGE.COPY_DST|BUFFER_USAGE.MAP_READ,'Framebuffer readback');
      try {
        const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:this.texture},{buffer,bytesPerRow:row,rowsPerImage:this.height},[this.width,this.height]);d.queue.submit([e.finish()]);await buffer.mapAsync(1);
        const bytes=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8Array(this.width*this.height*4);
        for(let y=0;y<this.height;y++)pixels.set(bytes.subarray(y*row,y*row+this.width*4),y*this.width*4);return pixels;
      }finally{this.gpu.release(buffer);}
    });
  }
  async dispose() {if(this.closed)return;this.closed=true;await this.gpu.tail;this.context?.unconfigure();for(const b of this.buffers)this.gpu.release(b);if(this.texture)this.gpu.release(this.texture);this.buffers=[];}
}
