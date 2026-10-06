import {ComputeDevice} from './device.js';
import {ComputeProgram,validateArtifact,encodeScalar} from './runtime.js';
import {ComputeRenderer} from './renderer.js';
import {ComputeError,integer,finite,STATE_HEADER_WORDS} from './protocol.js';

export const APPLICATION_EVENTS=Object.freeze({load:1,frame:2,pointerDown:3,pointerMove:4,pointerUp:5,pointerCancel:6,keyDown:7,keyUp:8,wheel:9,timer:10});
export const INPUT_FIELDS=Object.freeze({EventId:'Long',PointerX:'Single',PointerY:'Single',Buttons:'Long',PointerId:'Long',Pressure:'Single',KeyCode:'Long',Character:'Long',Modifiers:'Long',WheelX:'Single',WheelY:'Single',WheelMode:'Long',Elapsed:'Single',DeltaTime:'Single',Frame:'Long'});
export function validateApplication(value) {
  if(value?.kind!=='vb6-compute-application'||value.version!==1||!value.events||Array.isArray(value.events)||!Object.keys(value.events).length)throw new ComputeError('Invalid compute application descriptor','GPU_APPLICATION');
  validateArtifact(value.artifact);
  for(const [event,name] of Object.entries(value.events))if(!Object.hasOwn(APPLICATION_EVENTS,event)||typeof name!=='string')throw new ComputeError('Invalid event binding','GPU_EVENT');
  for(const [name,type] of Object.entries(INPUT_FIELDS)) {
    const fields=value.artifact.globals.filter(g=>g.module==='ComputeInput'&&g.name===name);
    if(fields.length!==1||fields[0].array||fields[0].type!==type.toLowerCase())throw new ComputeError('Invalid application input layout: '+name,'GPU_ABI');
  }
  return value;
}

/** Serial, bounded event delivery to GPU-resident VB handlers.
 * Owns listeners/scheduling, never evaluates VB on the CPU and never creates a
 * second state store for an event. An externally supplied ComputeDevice is borrowed.
 */
export class ComputeApplication {
  static async create(descriptor,options={}) {
    validateApplication(descriptor);
    const app=new ComputeApplication(structuredClone(descriptor),options);
    try {
      app.gpu=options.gpu||await ComputeDevice.request(options.deviceOptions);app.ownsDevice=!options.gpu;
      app.program=await ComputeProgram.create(app.gpu,app.descriptor.artifact,options.programOptions);
      if(app.canvas)app.renderer=await ComputeRenderer.create(app.gpu,{...options.renderOptions,canvas:app.canvas,width:app.program.width,height:app.program.height});
      app.attach();
      if(Object.hasOwn(app.descriptor.events,'load'))await app.dispatch('load');
      if(options.autoStart)app.start();
      return app;
    } catch(error){await app.dispose();throw error;}
  }
  constructor(descriptor,{canvas=null,maxQueuedEvents=128,onError=null,timerInterval=0}={}) {
    this.descriptor=descriptor;this.canvas=canvas;this.onError=onError;
    this.maxQueuedEvents=integer(maxQueuedEvents,'maxQueuedEvents',1,4096);
    this.timerInterval=finite(timerInterval,'timerInterval');if(timerInterval<0)throw new ComputeError('timerInterval cannot be negative','GPU_VALUE');
    if(onError!==null&&typeof onError!=='function')throw new ComputeError('onError must be a function','GPU_VALUE');
    this.closed=false;this.running=false;this.generation=0;this.queued=0;this.tail=Promise.resolve();this.listeners=[];
    this.inputs=Object.fromEntries(Object.keys(INPUT_FIELDS).map(k=>[k,0]));this.frame=0;this.startedAt=null;this.lastFrame=null;this.lastTimer=0;
    this.inputSymbols=descriptor.artifact.globals.filter(g=>g.module==='ComputeInput');
    this.hasTabIndex=canvas?.hasAttribute?.('tabindex');this.originalTabIndex=canvas?.getAttribute?.('tabindex');
  }
  check(){if(this.closed)throw new ComputeError('Application is disposed','GPU_DISPOSED');this.program.check();}
  dispatch(event,values={}, {readback=true,present=true}={}) {
    this.check();
    if(!Object.hasOwn(APPLICATION_EVENTS,event))throw new ComputeError('Unknown application event: '+event,'GPU_EVENT');
    if(!Object.hasOwn(this.descriptor.events,event))return Promise.resolve({handled:false});
    if(!values||typeof values!=='object'||Array.isArray(values))throw new ComputeError('Expected input fields','GPU_VALUE');
    const update={};
    for(const [name,value] of Object.entries(values)) {
      if(!Object.hasOwn(INPUT_FIELDS,name)||name==='EventId')throw new ComputeError('Unknown or read-only input: '+name,'GPU_NAME');
      encodeScalar(value,INPUT_FIELDS[name].toLowerCase());update[name]=value;
    }
    return this.enqueue(()=>this.execute(event,update,{readback,present}));
  }
  enqueue(operation) {
    this.check();
    if(this.queued>=this.maxQueuedEvents)throw new ComputeError('Application event queue is full','GPU_QUEUE_FULL');
    this.queued++;
    const work=this.tail.then(()=>{this.check();return operation();}).finally(()=>{this.queued--;});
    this.tail=work.catch(()=>{});return work;
  }
  async execute(event,update,{readback=true,present=true}={}) {
    this.check();Object.assign(this.inputs,update,{EventId:APPLICATION_EVENTS[event]});
    const words=this.inputSymbols.map(s=>[s.offset,encodeScalar(this.inputs[s.name],s.type)]);
    await this.gpu.operation(d=>{
      this.check();
      for(let lane=0;lane<this.program.count;lane++)for(const [offset,word] of words)d.queue.writeBuffer(this.program.state,(lane*this.descriptor.artifact.stateStride+STATE_HEADER_WORDS+offset)*4,new Uint32Array([word]));
    });
    const result=await this.program.run({time:this.inputs.Elapsed,readback});
    if(present&&this.renderer&&(!readback||result.some(l=>l.drawCount>0)))await this.renderer.render(this.program);
    return {handled:true,event,result};
  }
  report(error) {
    this.stop();this.lastError=error;
    if(this.onError){try{this.onError(error);}catch(callbackError){this.callbackError=callbackError;}}
    else if(this.canvas&&typeof CustomEvent==='function')this.canvas.dispatchEvent(new CustomEvent('computeerror',{detail:error}));
  }
  send(event,values) {try{this.dispatch(event,values).catch(e=>this.report(e));}catch(e){this.report(e);}}
  attach() {
    const c=this.canvas;if(!c?.addEventListener)return;
    if(!this.hasTabIndex)c.setAttribute('tabindex','0');
    const listen=(name,fn,options)=>{c.addEventListener(name,fn,options);this.listeners.push(()=>c.removeEventListener(name,fn,options));};
    const modifiers=e=>(e.shiftKey?1:0)|(e.ctrlKey?2:0)|(e.altKey?4:0)|(e.metaKey?8:0);
    const pointer=e=>{const rect=c.getBoundingClientRect();return {PointerX:rect.width?(e.clientX-rect.left)*this.program.width/rect.width:0,PointerY:rect.height?(e.clientY-rect.top)*this.program.height/rect.height:0,Buttons:e.buttons||0,PointerId:e.pointerId||0,Pressure:e.pressure||0,Modifiers:modifiers(e)};};
    for(const [name,event] of [['pointerdown','pointerDown'],['pointerup','pointerUp'],['pointercancel','pointerCancel']])if(Object.hasOwn(this.descriptor.events,event))listen(name,e=>{
      if(name==='pointerdown'){c.focus();try{c.setPointerCapture(e.pointerId);}catch{}}
      this.send(event,pointer(e));
    });
    if(Object.hasOwn(this.descriptor.events,'pointerMove'))listen('pointermove',e=>{
      // Immutable snapshots preserve event order; the bounded queue reports overflow.
      this.send('pointerMove',pointer(e));
    });
    for(const [name,event] of [['keydown','keyDown'],['keyup','keyUp']])if(Object.hasOwn(this.descriptor.events,event))listen(name,e=>this.send(event,{KeyCode:e.keyCode||0,Character:[...e.key].length===1?e.key.codePointAt(0):0,Modifiers:modifiers(e)}));
    if(Object.hasOwn(this.descriptor.events,'wheel'))listen('wheel',e=>this.send('wheel',{...pointer(e),WheelX:e.deltaX,WheelY:e.deltaY,WheelMode:e.deltaMode}),{passive:true});
  }
  start() {
    this.check();if(this.running)return;
    if(typeof globalThis.requestAnimationFrame!=='function')throw new ComputeError('Animation frame scheduling is unavailable','GPU_SCHEDULER');
    this.running=true;const generation=++this.generation;this.lastFrame=null;
    const frame=async now=>{
      if(this.closed||!this.running||generation!==this.generation)return;
      if(this.startedAt===null)this.startedAt=now;
      const elapsed=(now-this.startedAt)/1000,delta=this.lastFrame===null?0:Math.max(0,(now-this.lastFrame)/1000);this.lastFrame=now;
      try {
        this.frame=integer(this.frame+1,'frame',1,2147483647);
        await this.dispatch('frame',{Frame:this.frame,Elapsed:elapsed,DeltaTime:delta});
        if(this.timerInterval>0&&elapsed-this.lastTimer>=this.timerInterval){this.lastTimer=elapsed;await this.dispatch('timer',{Frame:this.frame,Elapsed:elapsed,DeltaTime:delta});}
      }catch(error){if(!this.closed)this.report(error);return;}
      // Schedule only after GPU work finishes: no growing animation backlog.
      if(!this.closed&&this.running&&generation===this.generation)this.request=globalThis.requestAnimationFrame(frame);
    };
    this.request=globalThis.requestAnimationFrame(frame);
  }
  stop(){this.running=false;this.generation++;if(this.request!==undefined)globalThis.cancelAnimationFrame?.(this.request);this.request=undefined;}
  reset() {
    this.check();this.stop();
    return this.enqueue(async()=>{
      await this.program.reset();this.inputs=Object.fromEntries(Object.keys(INPUT_FIELDS).map(k=>[k,0]));
      this.frame=0;this.startedAt=null;this.lastFrame=null;this.lastTimer=0;this.lastError=null;
      if(Object.hasOwn(this.descriptor.events,'load'))return this.execute('load',{});
    });
  }
  dispose() {
    if(this.disposal)return this.disposal;this.closed=true;this.stop();
    for(const remove of this.listeners)remove();this.listeners=[];
    if(this.canvas&&!this.hasTabIndex)this.canvas.removeAttribute?.('tabindex');
    this.disposal=(async()=>{await this.tail;await this.renderer?.dispose();await this.program?.dispose();if(this.ownsDevice)await this.gpu?.dispose();})();return this.disposal;
  }
}
