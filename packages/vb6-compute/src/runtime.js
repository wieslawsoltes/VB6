import {ComputeError, COMPUTE_ABI, STATE_HEADER_WORDS, ARRAY_HEADER_WORDS, COMMAND_WORDS, BUFFER_USAGE, integer, finite} from './protocol.js';
import {ComputeDevice} from './device.js';

const types=new Set(['byte','integer','long','boolean','single']);
export function validateArtifact(artifact) {
  if(artifact?.abi!==COMPUTE_ABI||artifact.target!=='webgpu-compute'||artifact.entryPoint!=='main'||typeof artifact.wgsl!=='string')throw new ComputeError('Unsupported compute artifact','GPU_ABI');
  integer(artifact.stateWords,'stateWords',0,65536);integer(artifact.workgroupSize,'workgroupSize',1,256);
  if(artifact.stateStride!==artifact.stateWords+STATE_HEADER_WORDS||!Array.isArray(artifact.initialState)||artifact.initialState.length!==artifact.stateWords)throw new ComputeError('Invalid compute state layout','GPU_ABI');
  for(const word of artifact.initialState)integer(word,'state word',0,0xffffffff);
  if(!Array.isArray(artifact.globals)||!Array.isArray(artifact.sources))throw new ComputeError('Missing compute metadata','GPU_ABI');
  for(const s of artifact.globals) {
    if(!types.has(s.type)||typeof s.name!=='string'||typeof s.module!=='string')throw new ComputeError('Invalid global metadata','GPU_ABI');
    integer(s.offset,'global offset',0,artifact.stateWords-1);integer(s.words,'global words',1,artifact.stateWords-s.offset);
    if(s.array) {
      if(!Array.isArray(s.bounds)||s.bounds.length<1||s.bounds.length>4)throw new ComputeError('Invalid array bounds','GPU_ABI');
      let length=1;
      for(const pair of s.bounds) {
        if(!Array.isArray(pair)||pair.length!==2)throw new ComputeError('Invalid array dimension','GPU_ABI');
        integer(pair[0],'lower bound',-1073741824,1073741823);integer(pair[1],'upper bound',pair[0],1073741823);length*=pair[1]-pair[0]+1;
      }
      if(length!==s.length||s.words!==ARRAY_HEADER_WORDS+length)throw new ComputeError('Invalid array storage length','GPU_ABI');
    } else if(s.words!==1)throw new ComputeError('Invalid scalar storage','GPU_ABI');
  }
  return artifact;
}
export function encodeScalar(value,type) {
  if(type==='boolean') {
    if(typeof value!=='boolean'&&(typeof value!=='number'||!Number.isFinite(value)))throw new ComputeError('Boolean input must be Boolean or finite number','GPU_VALUE');
    return value?0xffffffff:0;
  }
  if(type==='single'){finite(value);const f=new Float32Array([value]);return new Uint32Array(f.buffer)[0];}
  const limits={byte:[0,255],integer:[-32768,32767],long:[-2147483648,2147483647]};
  if(!limits[type])throw new ComputeError('Unsupported scalar type '+type,'GPU_TYPE');
  integer(value,type,...limits[type]);return value>>>0;
}
export function decodeScalar(word,type) {
  if(type==='single')return new Float32Array(new Uint32Array([word]).buffer)[0];
  if(type==='boolean')return word!==0;
  return word|0;
}
function field(artifact,name) {
  const n=String(name).toLowerCase(),matches=artifact.globals.filter(s=>`${s.module}.${s.name}`.toLowerCase()===n||s.name.toLowerCase()===n);
  if(matches.length!==1)throw new ComputeError(matches.length?'Ambiguous global: '+name:'Unknown global: '+name,'GPU_NAME');
  return matches[0];
}
export function createInitialState(artifact,count=1) {
  validateArtifact(artifact);integer(count,'count',1,1048576);
  const length=count*artifact.stateStride;
  if(length>16777216)throw new ComputeError('Initial host state exceeds 64 MiB safety budget','GPU_LIMIT');
  const state=new Uint32Array(length);
  for(let lane=0;lane<count;lane++)state.set(artifact.initialState,lane*artifact.stateStride+STATE_HEADER_WORDS);
  return state;
}
export function decodeState(artifact,buffer,count=1) {
  const words=new Uint32Array(buffer),lanes=[];
  if(words.length!==artifact.stateStride*count)throw new ComputeError('Readback size does not match compute state','GPU_ABI');
  for(let lane=0;lane<count;lane++) {
    const base=lane*artifact.stateStride,globals={};
    for(const s of artifact.globals) {
      const offset=base+STATE_HEADER_WORDS+s.offset+(s.array?ARRAY_HEADER_WORDS:0);
      globals[s.module+'.'+s.name]=s.array?Array.from(words.subarray(offset,offset+s.length),v=>decodeScalar(v,s.type)):decodeScalar(words[offset],s.type);
    }
    const source=artifact.sources.find(s=>s.id===words[base+4]);
    lanes.push({lane,error:words[base],line:words[base+1],steps:words[base+2],drawCount:words[base+3],source:source?.module,procedure:source?.procedure,globals});
  }
  return lanes;
}

/** Persistent lane-private VB storage plus explicit shared atomic storage. */
export class ComputeProgram {
  static async create(gpu,artifact,options={}) {
    if(!(gpu instanceof ComputeDevice))throw new ComputeError('Expected ComputeDevice','GPU_DEVICE');
    validateArtifact(artifact);
    const program=new ComputeProgram(gpu,structuredClone(artifact),options);
    try {await gpu.operation(d=>program.initialize(d));return program;}
    catch(e){await program.dispose();throw e;}
  }
  constructor(gpu,artifact,{count=1,capacity=256,width=640,height=480,sharedWords=1,fuel=100000,sharedBuffer=null}={}) {
    this.gpu=gpu;this.artifact=artifact;this.closed=false;this.buffers=[];
    this.count=integer(count,'count',1,1048576);this.capacity=integer(capacity,'capacity',1,16384);
    this.width=integer(width,'width',1,16384);this.height=integer(height,'height',1,16384);
    this.sharedWords=integer(sharedWords,'sharedWords',1,16777216);this.fuel=integer(fuel,'fuel',1,10000000);this.sharedBuffer=sharedBuffer;
    if(sharedBuffer&&(!(sharedBuffer.usage&BUFFER_USAGE.STORAGE)||sharedBuffer.size<this.sharedWords*4))throw new ComputeError('Shared buffer must provide sufficient STORAGE words','GPU_BINDING');
    const l=gpu.device.limits;
    if(artifact.workgroupSize>l.maxComputeWorkgroupSizeX||artifact.workgroupSize>l.maxComputeInvocationsPerWorkgroup||Math.ceil(count/artifact.workgroupSize)>l.maxComputeWorkgroupsPerDimension)throw new ComputeError('Dispatch exceeds device limits','GPU_LIMIT');
    this.initial=createInitialState(artifact,count);
    for(const bytes of [this.initial.byteLength,count*capacity*COMMAND_WORDS*4,sharedWords*4])if(bytes>l.maxStorageBufferBindingSize||bytes>l.maxBufferSize)throw new ComputeError('Program storage exceeds device limits','GPU_LIMIT');
  }
  async initialize(d) {
    const usage=BUFFER_USAGE.STORAGE|BUFFER_USAGE.COPY_SRC|BUFFER_USAGE.COPY_DST;
    const make=(size,flags,label)=>{const b=this.gpu.buffer(size,flags,label);this.buffers.push(b);return b;};
    this.state=make(this.initial.byteLength,usage,'VB6 lane states');
    this.draws=make(this.count*this.capacity*COMMAND_WORDS*4,usage,'VB6 GPU draw commands');
    this.shared=this.sharedBuffer||make(this.sharedWords*4,usage,'VB6 atomic shared memory');
    this.params=make(32,BUFFER_USAGE.UNIFORM|BUFFER_USAGE.COPY_DST,'VB6 dispatch parameters');
    d.queue.writeBuffer(this.state,0,this.initial);
    this.layout=d.createBindGroupLayout({entries:[
      {binding:0,visibility:4,buffer:{type:'storage'}},{binding:1,visibility:4,buffer:{type:'storage'}},
      {binding:2,visibility:4,buffer:{type:'uniform'}},{binding:3,visibility:4,buffer:{type:'storage'}}]});
    this.pipeline=await d.createComputePipelineAsync({layout:d.createPipelineLayout({bindGroupLayouts:[this.layout]}),compute:{module:await this.gpu.shader(this.artifact.wgsl),entryPoint:'main'}});
    this.bindGroup=d.createBindGroup({layout:this.layout,entries:[this.state,this.draws,this.params,this.shared].map((buffer,binding)=>({binding,resource:{buffer,...(binding===3?{size:this.sharedWords*4}:{})}}))});
  }
  check() {this.gpu.check();if(this.closed)throw new ComputeError('Compute program is disposed','GPU_DISPOSED');}
  writeGlobal(name,value,lane=0) {
    this.check();integer(lane,'lane',0,this.count-1);const s=field(this.artifact,name);
    if(s.array&&(!Array.isArray(value)&&!ArrayBuffer.isView(value)||value.length!==s.length))throw new ComputeError('Array input length must equal '+s.length,'GPU_VALUE');
    const values=s.array?Array.from(value):[value],words=new Uint32Array(values.map(v=>encodeScalar(v,s.type)));
    const offset=(lane*this.artifact.stateStride+STATE_HEADER_WORDS+s.offset+(s.array?ARRAY_HEADER_WORDS:0))*4;
    return this.gpu.operation(d=>{this.check();d.queue.writeBuffer(this.state,offset,words);});
  }
  writeShared(values,offset=0) {
    this.check();if(!(this.shared.usage&BUFFER_USAGE.COPY_DST))throw new ComputeError('Shared writes require COPY_DST usage','GPU_BINDING');if(!Array.isArray(values)&&!ArrayBuffer.isView(values))throw new ComputeError('Expected shared word array','GPU_VALUE');
    integer(offset,'shared offset',0,this.sharedWords-values.length);
    const words=new Uint32Array(Array.from(values,v=>{integer(v,'shared word',-2147483648,0xffffffff);return v>>>0;}));
    return this.gpu.operation(d=>{this.check();if(words.length)d.queue.writeBuffer(this.shared,offset*4,words);});
  }
  reset({clearShared=!this.sharedBuffer}={}) {this.check();if(clearShared&&!(this.shared.usage&BUFFER_USAGE.COPY_DST))throw new ComputeError('Shared reset requires COPY_DST usage','GPU_BINDING');return this.gpu.operation(d=>{this.check();d.queue.writeBuffer(this.state,0,this.initial);const e=d.createCommandEncoder();if(clearShared)e.clearBuffer(this.shared,0,this.sharedWords*4);d.queue.submit([e.finish()]);});}
  run({time=0,fuel=this.fuel,readback=true,throwOnError=true}={}) {
    this.check();finite(time,'time');integer(fuel,'fuel',1,10000000);if(fuel*this.count>50000000)throw new ComputeError('Aggregate dispatch fuel exceeds 50 million instructions; reduce count or per-lane fuel','GPU_LIMIT');
    return this.gpu.operation(async d=>{
      this.check();const data=new ArrayBuffer(32),u=new Uint32Array(data);u.set([this.count,fuel,this.capacity,this.width,this.height,0,this.sharedWords,0]);new Float32Array(data)[5]=time;
      d.queue.writeBuffer(this.params,0,data);
      const encoder=d.createCommandEncoder(),pass=encoder.beginComputePass({label:'VB6 execution'});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.dispatchWorkgroups(Math.ceil(this.count/this.artifact.workgroupSize));pass.end();d.queue.submit([encoder.finish()]);
      if(!readback)return {submitted:true,count:this.count};
      const lanes=decodeState(this.artifact,await this.gpu.readBuffer(this.state),this.count);
      const failed=lanes.find(l=>l.error);
      if(failed&&throwOnError)throw new ComputeError(`VB compute error ${failed.error} at ${failed.source}.${failed.procedure}:${failed.line}`,'GPU_VB_RUNTIME',{...failed,lanes});
      return lanes;
    });
  }
  readState() {this.check();return this.gpu.operation(async()=>{this.check();return decodeState(this.artifact,await this.gpu.readBuffer(this.state),this.count);});}
  readShared() {this.check();if(!(this.shared.usage&BUFFER_USAGE.COPY_SRC))throw new ComputeError('Shared readback requires COPY_SRC usage','GPU_BINDING');return this.gpu.operation(async()=>{this.check();return new Uint32Array(await this.gpu.readBuffer(this.shared,this.sharedWords*4));});}
  async dispose() {
    if(this.closed)return;this.closed=true;await this.gpu.tail;
    for(const b of this.buffers)this.gpu.release(b);this.buffers=[];
  }
}
