/** Renderer-independent runner for VB-authored UserControl logic.
 * Each instance has an isolated interpreter. No project startup, DLL activation,
 * JavaScript evaluation, DOM access or design-mode execution happens implicitly.
 */
import {VirtualMachine,VBInstance} from '../runtime/vm.js';
import {compileProject} from '../language/compiler.js';
import {Cell,NOTHING,unbox,readScalar} from '../runtime/values.js';
import {OcxPropertyBag} from './ocx-site.js';
import {OcxAmbientProperties} from './ocx-ambient.js';
const identifier=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name)&&!['constructor','prototype','__proto__'].includes(name.toLowerCase());
const inputEvents=new Set(['Paint','Click','DblClick','KeyDown','KeyUp','KeyPress','MouseDown','MouseMove','MouseUp','EnterFocus','ExitFocus','HitTest','DragOver','DragDrop','OLEStartDrag','OLESetData','OLEGiveFeedback','OLEDragOver','OLEDragDrop','OLECompleteDrag'].map(n=>n.toLowerCase()));
const reserved=new Set(['usercontrol','ambient','extender','parent','controls']);
function sourceBag(bag){
  const facade={ReadProperty:(name,value)=>bag.ReadProperty(name,value),WriteProperty:(name,value,def)=>bag.WriteProperty(name,value,def)};
  facade.ReadProperty.vbScalarInvoke=args=>bag.ReadPropertyScalar(unbox(args[0]),args[1]);
  facade.ReadProperty.vbParams=[{name:'Name'},{name:'DefaultValue',optional:true}];
  facade.WriteProperty.vbScalarInvoke=args=>args.length>2?bag.WriteProperty(unbox(args[0]),args[1],args[2]):bag.WriteProperty(unbox(args[0]),args[1]);
  facade.WriteProperty.vbParams=[{name:'Name'},{name:'Value'},{name:'DefaultValue',optional:true}];
  // Host functions keep exact variants, including Nothing and typed arrays.
  facade.ReadProperty.vbRawArgs=facade.WriteProperty.vbRawArgs=true;return Object.freeze(facade);
}
export class SourceUserControl {
  #vm;#instance;#module;#bag;#ambient;#properties;#control;#listeners=new Set();#queue=Promise.resolve();#pending=0;
  #closed=false;#closing=false;#callbackDepth=0;#dirty=false;#revision=0;#frozen=0;#design;#bounds=null;#visible=false;
  constructor(project,moduleName,{properties={},ambient={},controls={},state=undefined,extender=null,parent=NOTHING,design=false,allowDesignCode=false,host={},instructionLimit=1000000,sliceMilliseconds=8}={}){
    if(!project||!identifier(moduleName)||!controls||typeof controls!=='object'||Array.isArray(controls)||typeof design!=='boolean'||typeof allowDesignCode!=='boolean')throw TypeError('Invalid source-control options');
    if(design&&!allowDesignCode)throw Error('Design-time VB execution requires explicit allowDesignCode consent');
    if(!Number.isInteger(instructionLimit)||instructionLimit<1||instructionLimit>50000000||!Number.isFinite(sliceMilliseconds)||sliceMilliseconds<1||sliceMilliseconds>100)throw RangeError('Invalid source-control execution budget');
    const source=structuredClone(project),selected=source.modules?.find(m=>m.name?.toLowerCase()===moduleName.toLowerCase());
    if(!selected||selected.form?.type!=='UserControl')throw TypeError('Select a VB UserControl source module');
    this.formModel=structuredClone(selected.form);this.#properties={...selected.form.properties,...properties};this.#properties.Width??=this.#properties.ClientWidth??0;this.#properties.Height??=this.#properties.ClientHeight??0;this.#design=design;this.#ambient=new OcxAmbientProperties({...ambient,UserMode:design?0:-1});
    const initialState=state===undefined?selected.ocxState:state;this.#bag=new OcxPropertyBag(initialState);
    // Form/class declarations remain available as types, but the isolated source
    // runner never constructs project forms or executes a project's Sub Main.
    for(const module of source.modules)if(module.form){module.kind='class';delete module.form;}
    const compiled=compileProject(source);if(!compiled.valid)throw new Error(compiled.diagnostics.map(d=>`${d.source}:${d.line}: ${d.message}`).join('\n'));
    this.#module=compiled.modules.get(moduleName.toLowerCase());
    if(this.#module.declarations.some(d=>reserved.has(d.name.toLowerCase())))throw TypeError('Source control redeclares a reserved host member');
    if(Object.keys(controls).length>256||Object.keys(controls).some(n=>!identifier(n)||reserved.has(n.toLowerCase()))||new Set(Object.keys(controls).map(n=>n.toLowerCase())).size!==Object.keys(controls).length)throw TypeError('Invalid source-control child map');
    controls=Object.freeze({...controls});
    this.#vm=new VirtualMachine(compiled,{...host,createForm:undefined,sourceEventEnabled:instance=>instance!==this.#instance||!this.#closed&&!this.#design&&!this.#frozen,sourceEvent:(...args)=>this.#outgoing(...args)},{instructionLimit,sliceMilliseconds,debuggerEnabled:false,debugStatements:false});
    this.#instance=new VBInstance(this.#module);const instance=this;
    const collection=Object.freeze({get Count(){return Object.keys(controls).length;},Item(key){const entries=Object.entries(controls),found=typeof key==='number'?entries[key]:entries.find(([name])=>name.toLowerCase()===String(key).toLowerCase());if(!found)throw RangeError('Child control not found');return found[1];},[Symbol.iterator](){return Object.values(controls).values();}});
    this.#control={__control:true,type:'UserControl',model:{name:moduleName},get Ambient(){return instance.#ambient;},get Controls(){return collection;},get Parent(){return parent;},get Extender(){return extender||instance.#control;},
      PropertyChanged(name){if(!identifier(name))throw TypeError('Invalid changed property');instance.#dirty=true;instance.#revision++;return host.propertyChanged?.(name);}};
    for(const name of ['Width','Height','Left','Top','Enabled','Visible','BackColor','ForeColor','Caption'])Object.defineProperty(this.#control,name,{enumerable:true,get:()=>this.#properties[name]??(['Enabled','Visible'].includes(name)?-1:name==='Caption'?'':0),set:value=>{if(['Width','Height','Left','Top'].includes(name)&&(!Number.isFinite(value)||['Width','Height'].includes(name)&&value<0))throw RangeError('Invalid source-control bounds');this.#properties[name]=value;}});
    Object.defineProperties(this.#control,{ScaleWidth:{get:()=>this.#control.Width},ScaleHeight:{get:()=>this.#control.Height},ScaleMode:{value:1}});
    this.#instance.formObject=this.#control;
    for(const [name,value]of Object.entries({UserControl:this.#control,Ambient:this.#ambient,Extender:extender||this.#control,Parent:parent,Controls:collection,...controls}))this.#instance.fields.set(name.toLowerCase(),new Cell('Object',value,true));
    this.ready=this.#initialize(initialState).catch(async error=>{try{await this.#lifecycle('Terminate');}catch{}this.#closed=true;this.#vm.stop();throw error;});
  }
  static async create(project,moduleName,options){const control=new SourceUserControl(project,moduleName,options);await control.ready;return control;}
  get Ambient(){return this.#ambient;}
  get Dirty(){return this.#dirty;}
  get Closed(){return this.#closed;}
  get Revision(){return this.#revision;}
  get Events(){return [...(this.#module.events||new Map()).values()].map(e=>({name:e.name,params:e.params.map(p=>({name:p.name,type:p.storageType||p.type,byRef:!!p.byRef}))}));}
  get Properties(){return {...this.#properties};}
  async #initialize(state){await this.#vm.initialize();await this.#vm.initializeFields(this.#instance);this.#vm.setState('running');await this.#lifecycle('Initialize');await this.#lifecycle(state===undefined?'InitProperties':'ReadProperties',state===undefined?[]:[sourceBag(this.#bag)]);await this.#sync();return this;}
  #lifecycle(name,args=[]){const proc=this.#module.procedures.get('usercontrol_'+name.toLowerCase());return proc?this.#vm.callProcedure(this.#instance,proc,args,this.#vm.currentFrame):undefined;}
  async #sync(){
    for(let i=0;i<16;i++){
      const {Width:width,Height:height}=this.#control,visible=this.#control.Visible!==0&&this.#control.Visible!==false;
      if(![width,height].every(Number.isFinite)||width<0||height<0)throw RangeError('Invalid source-control size');
      const resized=!this.#bounds||width!==this.#bounds.width||height!==this.#bounds.height,changed=visible!==this.#visible;
      if(!resized&&!changed)return;this.#bounds={width,height};this.#visible=visible;if(resized)await this.#lifecycle('Resize');if(changed)await this.#lifecycle(visible?'Show':'Hide');
    }
    throw RangeError('Recursive source-control layout did not stabilize');
  }
  #enqueue(action){
    if(this.#closed||this.#closing)return Promise.reject(Error('Source control is closed'));
    if(this.#callbackDepth)return Promise.reject(Error('Use the event context for reentrant source-control calls'));
    if(this.#pending>=128)return Promise.reject(RangeError('Source-control operation queue is full'));this.#pending++;
    const run=this.#queue.then(async()=>{await this.ready;if(this.#closed)throw Error('Source control is closed');const value=await action();await this.#sync();return value;}).finally(()=>this.#pending--);
    this.#queue=run.catch(()=>{});return run;
  }
  #member(name,mode,args){if(!identifier(name)||!Array.isArray(args)||args.length>64)throw TypeError('Invalid source-control member call');return this.#vm.callByNameScalar(this.#instance,name,mode,args,this.#vm.currentFrame);}
  get(name,args=[]){return this.#enqueue(async()=>unbox(await this.#member(name,2,args)));}
  getScalar(name,args=[]){return this.#enqueue(()=>this.#member(name,2,args));}
  set(name,value,{object=false,args=[]}={}){return this.#enqueue(async()=>{if(typeof object!=='boolean'||!Array.isArray(args))throw TypeError('Invalid source property options');return unbox(await this.#member(name,object?8:4,[...args,value]));});}
  invoke(name,args=[]){return this.#enqueue(async()=>unbox(await this.#member(name,1,args)));}
  /** Feed host UI events into the private UserControl_* procedures. ByRef key,
   * hit-test and drag arguments are returned with declared scalar types intact.
   * Event freezing suppresses outgoing events, not incoming input or painting.
   */
  dispatchControlEvent(name,values=[]){return this.#enqueue(async()=>{
    if(typeof name!=='string'||!inputEvents.has(name.toLowerCase())||!Array.isArray(values)||values.length>64)throw TypeError('Invalid source-control input event');
    if(this.#design&&name.toLowerCase()!=='paint'||this.#ambient.UIDead&&name.toLowerCase()!=='paint')return {handled:false,args:[...values]};
    const procedure=this.#module.procedures.get('usercontrol_'+name.toLowerCase());if(!procedure)return {handled:false,args:[...values]};
    if(values.length!==procedure.params.length)throw TypeError('Source-control input event argument count mismatch');
    const cells=procedure.params.map((param,i)=>new Cell(param.storageType||param.type||'Variant',values[i]));
    await this.#vm.callProcedure(this.#instance,procedure,cells.map((cell,i)=>procedure.params[i].byRef?{ref:cell}:readScalar(cell)),this.#vm.currentFrame);
    return {handled:true,args:cells.map((cell,i)=>procedure.params[i].byRef?readScalar(cell):values[i])};
  });}
  resize(width,height){return this.#enqueue(()=>{if(![width,height].every(Number.isFinite)||width<0||height<0)throw RangeError('Invalid source-control size');this.#control.Width=width;this.#control.Height=height;});}
  show(visible=true){return this.#enqueue(()=>{if(typeof visible!=='boolean')throw TypeError('Expected Boolean visibility');this.#control.Visible=visible?-1:0;});}
  setAmbient(changes){return this.#enqueue(async()=>{if(Object.keys(changes||{}).some(n=>n.toLowerCase()==='usermode'))throw TypeError('Use setDesignMode');for(const name of this.#ambient.update(changes,false))await this.#lifecycle('AmbientChanged',[name]);});}
  setDesignMode(design,{allowDesignCode=false}={}){return this.#enqueue(async()=>{if(typeof design!=='boolean'||typeof allowDesignCode!=='boolean')throw TypeError('Invalid design-mode options');if(design&&!allowDesignCode)throw Error('Design-time VB execution requires explicit allowDesignCode consent');if(design===this.#design)return;this.#design=design;this.#ambient.update({UserMode:design?0:-1},false);await this.#lifecycle('AmbientChanged',['UserMode']);});}
  freezeEvents(freeze){if(this.#closed||this.#closing)throw Error('Source control is closed');if(typeof freeze!=='boolean')throw TypeError('Expected Boolean event freeze');const depth=this.#frozen+(freeze?1:-1);if(depth<0||depth>256)throw RangeError('Unbalanced or excessive source event freeze');this.#frozen=depth;}
  save({clearDirty=true}={}){return this.#enqueue(async()=>{if(typeof clearDirty!=='boolean')throw TypeError('Expected Boolean dirty-state acknowledgement');const revision=this.#revision,bag=new OcxPropertyBag(this.#bag.Contents);await this.#lifecycle('WriteProperties',[sourceBag(bag)]);this.#bag=bag;if(clearDirty&&this.#revision===revision)this.#dirty=false;return bag.Contents;});}
  load(contents){const bag=new OcxPropertyBag(contents);return this.#enqueue(async()=>{this.#dirty=true;this.#revision++;await this.#lifecycle('ReadProperties',[sourceBag(bag)]);this.#bag=bag;this.#dirty=false;});}
  subscribe(handler){if(this.#closed||this.#closing)throw Error('Source control is closed');if(typeof handler!=='function')throw TypeError('Expected source event handler');if(this.#listeners.size>=256)throw RangeError('Source event subscriber limit');const listener={handler};this.#listeners.add(listener);return ()=>this.#listeners.delete(listener);}
  async #outgoing(instance,name,args){
    if(instance!==this.#instance||this.#closed||this.#design||this.#frozen)return;if(this.#callbackDepth>=32)throw RangeError('Source event recursion limit');this.#callbackDepth++;
    try{for(const entry of [...this.#listeners]){if(!this.#listeners.has(entry))continue;let active=true,tail=Promise.resolve(),pending=0;const depth=this.#callbackDepth,errors=[];
      const member=(name,mode,args,raw=false)=>{
        if(!active||depth!==this.#callbackDepth)throw Error('Source event context has expired or is suspended');
        if(pending>=128)throw RangeError('Reentrant source event queue is full');pending++;
        const run=tail.then(()=>this.#member(name,mode,args)).then(value=>raw?value:unbox(value)).finally(()=>pending--);
        // Serialize nested procedures and retain rejected fire-and-forget calls.
        // Return the original result to an awaiting handler without unhandled tails.
        tail=run.catch(error=>{errors.push(error);});return run;
      };
      const context=Object.freeze({get:(name,args=[])=>member(name,2,args),getScalar:(name,args=[])=>member(name,2,args,true),set:(name,value)=>member(name,4,[value]),invoke:(name,args=[])=>member(name,1,args)});
      let callbackError;
      try{await entry.handler(name,args.map(arg=>arg?.ref?{ref:arg.ref}:arg),context);}catch(error){callbackError=error;}finally{active=false;await tail;}
      if(callbackError)throw callbackError;if(errors.length)throw new AggregateError(errors,'Source event context calls failed');
    }}finally{this.#callbackDepth--;}
  }

  close(){
    if(this.#closed)return Promise.resolve();if(this.#callbackDepth)return Promise.reject(Error('Cannot close a source control during its outgoing event'));if(this.#closing)return this.closing;
    this.#closing=true;this.closing=this.#queue.then(async()=>{try{await this.ready;await this.#lifecycle('Terminate');}finally{this.#listeners.clear();this.#closed=true;this.#vm.stop();}});return this.closing;
  }
}
