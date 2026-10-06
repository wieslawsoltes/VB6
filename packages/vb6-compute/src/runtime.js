import {encodeDouble,decodeDouble,validateDoubleStorage} from './double-layout.js';
import {ComputeError, COMPUTE_ABI, STATE_HEADER_WORDS, ARRAY_HEADER_WORDS, COMMAND_WORDS, BUFFER_USAGE, integer, finite} from './protocol.js';
import {encodeStringBlock,decodeStringBlock,validateStringStorage} from './string-layout.js';
import {ComputeDevice} from './device.js';
import {readArrayLayout, arrayHeader} from './array-layout.js';

const types=new Set(['byte','integer','long','boolean','single','double','string']);
export function validateArtifact(artifact) {
  if(artifact?.abi!==COMPUTE_ABI||artifact.target!=='webgpu-compute'||artifact.entryPoint!=='main'||typeof artifact.wgsl!=='string')throw new ComputeError('Unsupported compute artifact','GPU_ABI');
  integer(artifact.stateWords,'stateWords',0,65536);integer(artifact.workgroupSize,'workgroupSize',1,256);
  if(artifact.stateStride!==artifact.stateWords+STATE_HEADER_WORDS||!Array.isArray(artifact.initialState)||artifact.initialState.length!==artifact.stateWords)throw new ComputeError('Invalid compute state layout','GPU_ABI');
  for(const word of artifact.initialState)integer(word,'state word',0,0xffffffff);
  if(!Array.isArray(artifact.globals)||!Array.isArray(artifact.sources))throw new ComputeError('Missing compute metadata','GPU_ABI');
  const occupied=[];
  if(artifact.stringABI!==undefined){if(artifact.stringABI!==1)throw new ComputeError('Unsupported GPU string ABI','GPU_ABI');integer(artifact.maxStringLength,'maxStringLength',1,4096);}
  for(const s of artifact.globals) {
    if(!types.has(s.type)||typeof s.name!=='string'||typeof s.module!=='string')throw new ComputeError('Invalid global metadata','GPU_ABI');
    integer(s.offset,'global offset',0,artifact.stateWords-1);integer(s.words,'global words',1,artifact.stateWords-s.offset);
    occupied.push([s.offset,s.offset+s.words]);
    if(s.type==='string'){
      if(artifact.stringABI!==1||s.stringStorage?.capacity>artifact.maxStringLength)throw new ComputeError('Invalid string ABI or capacity','GPU_ABI');
      occupied.push(validateStringStorage(artifact,s));
    }else if(s.stringStorage)throw new ComputeError('String storage attached to a numeric field','GPU_ABI');
    if(s.type==='double'){if(artifact.doubleABI!==1)throw new ComputeError('Invalid Double ABI','GPU_ABI');occupied.push(validateDoubleStorage(artifact,s));}
    else if(s.doubleStorage)throw new ComputeError('Unexpected Double storage','GPU_ABI');
    if(s.array) {
      if(typeof s.dynamic!=='boolean'||!Array.isArray(s.bounds))throw new ComputeError('Invalid array metadata','GPU_ABI');
      integer(s.capacity,'array capacity',1,65536);
      if(s.words!==ARRAY_HEADER_WORDS+s.capacity)throw new ComputeError('Invalid array storage length','GPU_ABI');
      const layout=readArrayLayout(artifact.initialState,s.offset,s);
      if(layout.length!==s.length||JSON.stringify(layout.bounds)!==JSON.stringify(s.bounds))throw new ComputeError('Inconsistent initial array metadata','GPU_ABI');
    } else if(s.words!==1)throw new ComputeError('Invalid scalar storage','GPU_ABI');
  }
  occupied.sort((a,b)=>a[0]-b[0]);
  for(let i=1;i<occupied.length;i++)if(occupied[i][0]<occupied[i-1][1])throw new ComputeError('Overlapping global storage','GPU_ABI');
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
    const base=lane*artifact.stateStride,globals={},arrays={};
    for(const s of artifact.globals) {
      const offset=base+STATE_HEADER_WORDS+s.offset+(s.array?ARRAY_HEADER_WORDS:0);
      const name=s.module+'.'+s.name;
      if(s.type==='string'){
        const count=s.array?s.capacity:1;
        for(let i=0;i<count;i++)if(words[offset+i]!==s.stringStorage.offset+i*s.stringStorage.stride)
          throw new ComputeError('Corrupt GPU String reference: '+name,'GPU_ABI');
      }
      if(s.type==='double'){
        const count=s.array?s.capacity:1;
        for(let i=0;i<count;i++)if(words[offset+i]!==s.doubleStorage.offset+i*2)throw new ComputeError('Corrupt GPU Double reference: '+name,'GPU_ABI');
      }
      const readDouble=i=>{const p=base+STATE_HEADER_WORDS+s.doubleStorage.offset+i*2;return decodeDouble(words[p],words[p+1]);};
      if(s.array){const layout=readArrayLayout(words,base+STATE_HEADER_WORDS+s.offset,s);arrays[name]=layout;globals[name]=s.type==='double'?Array.from({length:layout.length},(_,i)=>readDouble(i)):s.type==='string'?Array.from({length:layout.length},(_,i)=>decodeStringBlock(words,base+STATE_HEADER_WORDS+s.stringStorage.offset+i*s.stringStorage.stride,s.stringStorage)):Array.from(words.subarray(offset,offset+layout.length),v=>decodeScalar(v,s.type));}
      else globals[name]=s.type==='double'?readDouble(0):s.type==='string'?decodeStringBlock(words,base+STATE_HEADER_WORDS+s.stringStorage.offset,s.stringStorage):decodeScalar(words[offset],s.type);
    }
    const source=artifact.sources.find(s=>s.id===words[base+4]);
    lanes.push({lane,error:words[base],line:words[base+1],steps:words[base+2],drawCount:words[base+3],source:source?.module,procedure:source?.procedure,depth:source?.depth,fatal:words[base+5]!==0,globals,arrays});
  }
  return lanes;
}

function stringPayload(values,storage) {
  const blocks=values.map(v=>encodeStringBlock(v,storage)),data=new Uint32Array(values.length*storage.stride);
  blocks.forEach((block,i)=>data.set(block,i*storage.stride));return data;
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
    if(s.array&&(!Array.isArray(value)&&!ArrayBuffer.isView(value)))throw new ComputeError('Expected an array of values','GPU_VALUE');
    const values=s.array?Array.from(value):[value];
    if(s.array&&values.length>s.capacity)throw new ComputeError('Array input exceeds capacity','GPU_VALUE');
    const words=s.type==='double'?new Uint32Array(values.flatMap(encodeDouble)):s.type==='string'?stringPayload(values,s.stringStorage):new Uint32Array(values.map(v=>encodeScalar(v,s.type)));
    if(s.array&&!s.dynamic&&values.length!==s.length)throw new ComputeError('Array input length must equal '+s.length,'GPU_VALUE');
    const base=(lane*this.artifact.stateStride+STATE_HEADER_WORDS+s.offset)*4;
    return this.gpu.operation(async d=>{
      this.check();
      if(s.dynamic){
        const header=new Uint32Array(await this.gpu.readBuffer(this.state,ARRAY_HEADER_WORDS*4,base));
        const layout=readArrayLayout(header,0,s);
        if(!layout.allocated||layout.length!==values.length)throw new ComputeError('Dynamic array must be allocated with matching length','GPU_VALUE');
      }
      const destination=s.type==='double'?(lane*this.artifact.stateStride+STATE_HEADER_WORDS+s.doubleStorage.offset)*4:s.type==='string'?(lane*this.artifact.stateStride+STATE_HEADER_WORDS+s.stringStorage.offset)*4:base+(s.array?ARRAY_HEADER_WORDS*4:0);
      if(words.length)d.queue.writeBuffer(this.state,destination,words);
    });
  }
  initializeArray(name,bounds,values=null,lane=0) {
    this.check();integer(lane,'lane',0,this.count-1);const s=field(this.artifact,name);
    if(!s.array||!s.dynamic)throw new ComputeError('initializeArray requires a dynamic array','GPU_TYPE');
    const header=arrayHeader(bounds,s.capacity),data=['string','double'].includes(s.type)?new Uint32Array(this.artifact.initialState.slice(s.offset,s.offset+s.words)):new Uint32Array(s.words);data.set(header);
    let strings=s.type==='string'?new Array(s.capacity).fill(''):null;
    if(values!==null){
      if((!Array.isArray(values)&&!ArrayBuffer.isView(values))||values.length!==header[1])throw new ComputeError('Array input length does not match bounds','GPU_VALUE');
      if(strings)Array.from(values).forEach((v,i)=>strings[i]=v);
      else if(s.type!=='double')data.set(Array.from(values,v=>encodeScalar(v,s.type)),ARRAY_HEADER_WORDS);
    }
    const payload=strings?stringPayload(strings,s.stringStorage):s.type==='double'?new Uint32Array(Array.from({length:s.capacity},(_,i)=>values&&i<values.length?values[i]:0).flatMap(encodeDouble)):null;
    const offset=(lane*this.artifact.stateStride+STATE_HEADER_WORDS+s.offset)*4;
    return this.gpu.operation(d=>{this.check();d.queue.writeBuffer(this.state,offset,data);if(payload)d.queue.writeBuffer(this.state,(lane*this.artifact.stateStride+STATE_HEADER_WORDS+(s.stringStorage||s.doubleStorage).offset)*4,payload);});
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
