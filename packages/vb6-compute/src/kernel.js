import {ComputeError, integer} from './protocol.js';
/** Escape hatch for arbitrary WGSL compute: textures, workgroup memory/barriers,
 * atomics and specialization constants follow WebGPU's own binding contracts.
 * Buffers/textures remain owned by the caller and can be shared across kernels.
 */
export class ComputeKernel {
  static async create(gpu,{code,entryPoint='main',constants={},layout='auto'}={}) {
    if(typeof code!=='string'||!code.trim())throw new ComputeError('WGSL source is required','GPU_WGSL');
    const kernel=new ComputeKernel(gpu);
    await gpu.operation(async d=>{
      const module=await gpu.shader(code,'Standalone WGSL compute kernel');
      kernel.pipeline=await d.createComputePipelineAsync({layout,compute:{module,entryPoint,constants}});
    });return kernel;
  }
  constructor(gpu){this.gpu=gpu;this.closed=false;this.groups=new Map();}
  check(){this.gpu.check();if(this.closed)throw new ComputeError('Kernel is disposed','GPU_DISPOSED');}
  bind(index,entries,{dynamicOffsets=[]}={}) {
    this.check();integer(index,'bind group index',0,this.gpu.device.limits.maxBindGroups-1);
    if(!Array.isArray(entries))throw new ComputeError('Bind group entries must be an array','GPU_BINDING');
    const offsets=Array.from(dynamicOffsets,x=>integer(x,'dynamic offset',0,0xffffffff));
    return this.gpu.operation(d=>{
      this.check();const group=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(index),entries});this.groups.set(index,{group,offsets});
    });
  }
  dispatch(x,y=1,z=1) {
    this.check();const limit=this.gpu.device.limits.maxComputeWorkgroupsPerDimension;
    for(const [name,n] of [['x',x],['y',y],['z',z]])integer(n,'workgroup count '+name,0,limit);
    return this.encode(pass=>pass.dispatchWorkgroups(x,y,z));
  }
  dispatchIndirect(buffer,offset=0) {
    this.check();if(!buffer||!(buffer.usage&256))throw new ComputeError('Indirect dispatch requires an INDIRECT GPUBuffer','GPU_BINDING');
    integer(offset,'indirect offset',0,buffer.size-12);if(offset%4)throw new ComputeError('Indirect offset must be word aligned','GPU_ALIGNMENT');
    return this.encode(pass=>pass.dispatchWorkgroupsIndirect(buffer,offset));
  }
  encode(dispatch) {
    return this.gpu.operation(d=>{
      this.check();const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(this.pipeline);
      for(const [index,{group,offsets}] of this.groups)pass.setBindGroup(index,group,offsets);
      dispatch(pass);pass.end();d.queue.submit([encoder.finish()]);
    });
  }
  dispose(){this.closed=true;this.groups.clear();}
}
