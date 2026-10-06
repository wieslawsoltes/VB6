/** WebGPU presentation of a retained, CPU-readable GDI surface. Raster operations
 * remain synchronous in the compatibility engine; only presentation is GPU work.
 * One cached texture and a fullscreen triangle replace Canvas2D display blits. */
const SHADER=`@group(0) @binding(0) var image: texture_2d<f32>;
struct Size { value: vec2f, padding: vec2f };
@group(0) @binding(1) var<uniform> size: Size;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[index], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = textureDimensions(image);
  let point = min(vec2u(position.xy / size.value * vec2f(dimensions)), dimensions - vec2u(1u));
  return vec4f(textureLoad(image, vec2i(point), 0).rgb, 1.0);
}`;
export class GPURasterPresenter {
  constructor(device,format){
    this.device=device;this.revision=-1;this.width=this.height=0;this.disposed=false;
    const module=device.createShaderModule({code:SHADER});
    const descriptor={layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}};
    this.ready=(async()=>{
      const info=await module.getCompilationInfo();
      const errors=info.messages.filter(message=>message.type==='error');
      if(errors.length)throw new Error('GDI presentation shader: '+errors.map(e=>e.message).join('; '));
      const pipeline=await device.createRenderPipelineAsync(descriptor);
      if(this.disposed)return;
      this.pipeline=pipeline;
      this.uniform=device.createBuffer({size:16,usage:0x40|0x08}); // UNIFORM | COPY_DST
    })();
  }
  static async create(device,format){const presenter=new GPURasterPresenter(device,format);try{await presenter.ready;return presenter;}catch(error){presenter.dispose();throw error;}}
  render(context,source,revision,width,height){
    const d=this.device;if(!d)throw new Error('GPU raster presenter is disposed');if(!this.pipeline)throw new Error('Await GPU raster presenter.ready before rendering');
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!source.width||!source.height)throw new RangeError('Invalid GPU presentation dimensions');
    if(source.width>d.limits.maxTextureDimension2D||source.height>d.limits.maxTextureDimension2D)throw new RangeError('GDI texture exceeds device dimensions');
    if(!this.texture||this.width!==source.width||this.height!==source.height){
      this.texture?.destroy();this.width=source.width;this.height=source.height;
      this.texture=d.createTexture({size:[this.width,this.height],format:'rgba8unorm',usage:0x04|0x02|0x10});
      this.bindGroup=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture.createView()},{binding:1,resource:{buffer:this.uniform}}]});this.revision=-1;
    }
    if(this.revision!==revision){d.queue.copyExternalImageToTexture({source},{texture:this.texture,premultipliedAlpha:false},[this.width,this.height]);this.revision=revision;}
    d.queue.writeBuffer(this.uniform,0,new Float32Array([width,height,0,0]));
    const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.draw(3);pass.end();d.queue.submit([encoder.finish()]);
  }
  dispose(){this.disposed=true;this.texture?.destroy();this.uniform?.destroy();this.texture=this.uniform=this.bindGroup=this.pipeline=this.device=null;}
}
