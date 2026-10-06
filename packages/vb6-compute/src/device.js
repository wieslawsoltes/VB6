import {ComputeError, BUFFER_USAGE, integer} from './protocol.js';

/** Owns validation scopes and serializes their async lifetime on one GPUDevice. */
export class ComputeDevice {
  constructor(device, {owned=false}={}) {
    if(!device?.createComputePipelineAsync)throw new ComputeError('A WebGPU GPUDevice is required','GPU_DEVICE');
    this.device=device;this.owned=owned;this.closed=false;this.loss=null;this.tail=Promise.resolve();this.resources=new Set();
    this.lost=Promise.resolve(device.lost).then(info=>{this.loss=info||{message:'Device lost'};return this.loss;});
  }
  static async request({gpu=globalThis.navigator?.gpu,powerPreference='high-performance',requiredFeatures=[],requiredLimits={}}={}) {
    if(!gpu)throw new ComputeError('WebGPU is unavailable; use a secure context and a supported browser','GPU_UNAVAILABLE');
    const adapter=await gpu.requestAdapter({powerPreference});
    if(!adapter)throw new ComputeError('No WebGPU adapter is available','GPU_UNAVAILABLE');
    for(const feature of requiredFeatures)if(!adapter.features.has(feature))throw new ComputeError('Unsupported GPU feature: '+feature,'GPU_FEATURE');
    const device=await adapter.requestDevice({requiredFeatures,requiredLimits});
    return new ComputeDevice(device,{owned:true});
  }
  check() {
    if(this.closed)throw new ComputeError('Compute device is disposed','GPU_DISPOSED');
    if(this.loss)throw new ComputeError(this.loss.message||'GPU device lost','GPU_LOST',{reason:this.loss.reason});
  }
  operation(fn) {
    const promise=this.tail.then(async()=>{
      this.check();const d=this.device;d.pushErrorScope('validation');d.pushErrorScope('out-of-memory');
      let result,error;try{result=await fn(d);}catch(e){error=e;}
      const memory=await d.popErrorScope(),validation=await d.popErrorScope();
      if(error)throw error;
      if(memory||validation)throw new ComputeError((memory||validation).message,memory?'GPU_MEMORY':'GPU_VALIDATION');
      this.check();return result;
    });
    this.tail=promise.catch(()=>{});return promise;
  }
  buffer(size,usage,label='VB6 compute buffer') {
    this.check();integer(size,'buffer bytes',4,this.device.limits.maxBufferSize);
    if(size%4)throw new ComputeError('Buffer size must be aligned to four bytes','GPU_ALIGNMENT');
    if((usage&BUFFER_USAGE.STORAGE)&&size>this.device.limits.maxStorageBufferBindingSize)throw new ComputeError('Buffer exceeds maxStorageBufferBindingSize','GPU_LIMIT');
    const b=this.device.createBuffer({size,usage,label});this.resources.add(b);return b;
  }
  release(resource) {if(this.resources.delete(resource))resource.destroy();}
  async shader(code,label='VB6 compute shader') {
    const shader=this.device.createShaderModule({code,label});
    const info=await shader.getCompilationInfo();const errors=[...info.messages].filter(m=>m.type==='error');
    if(errors.length)throw new ComputeError(errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}`).join('\n'),'GPU_WGSL',{diagnostics:errors.map(m=>({message:m.message,line:m.lineNum,column:m.linePos}))});
    return shader;
  }
  async readBuffer(buffer,size=buffer.size,offset=0) {
    integer(size,'readback bytes',4,buffer.size);integer(offset,'readback offset',0,buffer.size-size);
    if(size%4||offset%4)throw new ComputeError('Readback must be word aligned','GPU_ALIGNMENT');
    const staging=this.buffer(size,BUFFER_USAGE.COPY_DST|BUFFER_USAGE.MAP_READ,'VB6 compute readback');
    try {
      const encoder=this.device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,offset,staging,0,size);this.device.queue.submit([encoder.finish()]);
      await staging.mapAsync(1);return staging.getMappedRange().slice(0);
    } finally {this.release(staging);}
  }
  async dispose() {
    if(this.closed)return;
    // Reject newly queued work, but wait for scopes already running to unwind.
    this.closed=true;await this.tail;
    for(const resource of this.resources)resource.destroy();this.resources.clear();
    if(this.owned)this.device.destroy();
  }
}
