/** Opt-in local Windows process. It has user authority, NOT a sandbox. */
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {AutomationRegistry} from '../../src/runtime/automation.js';
import {encodeAutomationValue,decodeAutomationValue} from '../../src/runtime/automation-wire.js';
import {VBError} from '../../src/language/lexer.js';
const script=fileURLToPath(new URL('./automation-host.ps1',import.meta.url)),LIMIT=1024*1024;
export class NativeAutomationClient {
  constructor({allowed=[],controls=[],architecture='x86',timeout=15000,startupTimeout=60000,lcid=1033,allowNativeCode=false}={}){
    if(!allowNativeCode)throw Error('Explicit allowNativeCode consent is required; COM/OCX code has full user authority');
    if(!['x86','x64'].includes(architecture)||!Number.isInteger(timeout)||timeout<100||timeout>120000||!Number.isInteger(startupTimeout)||startupTimeout<100||startupTimeout>120000)throw Error('Invalid native host options');
    if(!Array.isArray(allowed)||!allowed.length||allowed.length>64||allowed.some(n=>typeof n!=='string'||!(/^[A-Za-z][A-Za-z0-9_.]{0,254}$/).test(n))||!Array.isArray(controls)||controls.some(n=>!allowed.includes(n)))throw Error('Explicit bounded ProgID and control allowlists are required');
    if(!Number.isInteger(lcid)||lcid<0||lcid>0xfffff)throw Error('Invalid Automation locale identifier');
    this.lcid=lcid;this.allowed=[...allowed];this.controls=[...controls];this.architecture=architecture;this.timeout=timeout;this.startupTimeout=startupTimeout;this.initialized=false;this.stderr='';this.sequence=0;this.queued=0;this.pending=new Map();this.queue=Promise.resolve();this.closed=false;this.objectIds=new WeakMap();this.adapters=new Map();
  }
  async start(){
    if(this.ready)return this.ready;if(this.closed)throw Error('Native host is closed');
    if(process.platform!=='win32')throw Error('Native Automation requires Windows; browser adapters remain available separately');
    const system=this.architecture==='x86'?'SysWOW64':process.arch==='ia32'?'Sysnative':'System32';
    const executable=path.join(process.env.SystemRoot||'C:\\Windows',system,'WindowsPowerShell','v1.0','powershell.exe');
    this.child=spawn(executable,['-NoProfile','-NonInteractive','-STA','-File',script],{stdio:['pipe','pipe','pipe'],windowsHide:true,shell:false});
    const decoder=new StringDecoder('utf8');let buffer='';
    this.child.stdout.on('data',chunk=>{buffer+=decoder.write(chunk);if(Buffer.byteLength(buffer)>2*LIMIT){this.abort(Error('Native response exceeds size limit'));return;}let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;try{const reply=JSON.parse(line);if(!reply||typeof reply!=='object'||!Object.hasOwn(reply,'result')&&!reply.error)throw Error('Invalid native response');const p=this.pending.get(reply.id);if(!p)throw Error('Unexpected native response id');this.pending.delete(reply.id);clearTimeout(p.timer);if(reply.error){const e=new VBError(reply.error.message||'Automation failure',reply.error.number||440);e.hresult=reply.error.hresult;if(typeof reply.error.source==='string')e.source=reply.error.source;if(typeof reply.error.helpFile==='string')e.helpFile=reply.error.helpFile;if(Number.isInteger(reply.error.helpContext))e.helpContext=reply.error.helpContext;p.reject(e);}else if(Object.hasOwn(reply,'result'))p.resolve(reply.result);else throw Error('Missing native result');}catch(e){this.abort(e);}}});
    this.child.stderr.on('data',b=>{this.stderr=(this.stderr+b.toString('utf8')).slice(-8192);});
    this.child.on('error',e=>this.abort(e));this.child.on('exit',(code,signal)=>{this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('Native host exited: '+(code??signal)+' '+this.stderr));}this.pending.clear();});
    this.ready=this.send({op:'init',allowed:this.allowed,controls:this.controls},{startup:true}).then(info=>{if(info.bitness!==(this.architecture==='x86'?32:64)||info.apartment!=='STA')throw Error('Native host architecture/apartment mismatch');this.initialized=true;return info;}).catch(e=>{this.abort(e);throw e;});return this.ready;
  }
  abort(error=Error('Native host closed')){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.child?.kill();}
  /** Startup includes PowerShell/.NET compilation; calls retain a separate deadline. */
  send(message,{startup=false}={}){
    if(this.closed)return Promise.reject(Error('Native host is closed'));
    const id=++this.sequence,text=JSON.stringify({...message,id})+'\n';
    if(Buffer.byteLength(text)>LIMIT)return Promise.reject(Error('Native request exceeds size limit'));
    if(this.pending.size>=128)return Promise.reject(Error('Native request queue is full'));
    const budget=startup?this.startupTimeout:this.timeout;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{
        const error=Error(startup?'Native host initialization timed out':'Native invocation timed out; native side effects cannot be undone');
        error.code=startup?'NATIVE_STARTUP_TIMEOUT':'NATIVE_INVOCATION_TIMEOUT';
        error.operation=String(message.op||'unknown');error.timeoutMs=budget;
        // Do not replay a timed-out native operation: it may have changed OS state.
        this.abort(error);
      },budget);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(text,e=>{if(e)this.abort(e);});
    });
  }
  diagnostics(){return {architecture:this.architecture,initialized:this.initialized,closed:this.closed,pending:this.pending.size,timeoutMs:this.timeout,startupTimeoutMs:this.startupTimeout,stderr:this.stderr};}
  request(message){if(this.queued>=128)return Promise.reject(Error('Native request queue is full'));this.queued++;const run=this.queue.then(async()=>{await this.start();return this.send(message);}).finally(()=>{this.queued--;});this.queue=run.catch(()=>{});return run;}
  registry(){const registry=new AutomationRegistry();for(const name of this.allowed)registry.register(name,async session=>{if(this.session&&this.session!==session)throw Error('Use a separate native client for each VM session');this.session=session;const wire=await this.request({op:'create',progId:name});try{return this.adapter(wire,session);}catch(error){this.adapters.delete(wire.id);if(!this.closed)await this.request({op:'release',handle:wire.id}).catch(()=>{});throw error;}});return registry;}
  adapter(wire,session){
    if(this.adapters.has(wire.id))return this.adapters.get(wire.id);const client=this;
    const decode=(w,preserveScalars=false)=>decodeAutomationValue(w,{preserveScalars,object:child=>{const adapter=client.adapter(child,session),o=session.adopt(adapter);client.objectIds.set(o,child.id);return o;}});
    const invoke=async(member,mode,args,byRef=[],preserveScalars=false)=>{const result=await client.request({op:'call',handle:wire.id,member,mode,lcid:client.lcid,byRef,args:args.map(v=>encodeAutomationValue(v,{objectId:o=>client.objectIds.get(o)}))});return {value:decode(result.value,preserveScalars),args:result.args.map(value=>decode(value,preserveScalars))};};
    const adapter={metadata:wire.metadata,invoke:(...args)=>invoke(...args),invokeScalar:(member,mode,args,byRef)=>invoke(member,mode,args,byRef,true),async release(){if(!client.closed)await client.request({op:'release',handle:wire.id});client.adapters.delete(wire.id);}};
    if(wire.metadata?.enumerable){const enumerate=async preserve=>{const values=await client.request({op:'enumerate',handle:wire.id});return values.map(value=>decode(value,preserve));};adapter.enumerate=()=>enumerate(false);adapter.enumerateScalar=()=>enumerate(true);}
    this.adapters.set(wire.id,adapter);
    // Map the root immediately as well as objects returned by member calls.
    try{const object=session.adopt(adapter);this.objectIds.set(object,wire.id);return adapter;}catch(error){this.adapters.delete(wire.id);if(!this.closed)this.request({op:'release',handle:wire.id}).catch(()=>{});throw error;}
  }
  async close(){if(this.closed)return;try{await this.request({op:'close'});}finally{this.closed=true;this.child?.stdin.end();const child=this.child;if(child&&child.exitCode===null){const timer=setTimeout(()=>child.kill(),1000);timer.unref();}}}
}
