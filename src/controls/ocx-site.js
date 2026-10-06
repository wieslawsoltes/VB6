/** Portable source-control persistence. This is not the proprietary OCX/FRX format. */
import {encodeAutomationValue,decodeAutomationValue} from '../runtime/automation-wire.js';
import {OcxAmbientProperties,ocxTransformCoords} from './ocx-ambient.js';
const MAX_BYTES=1024*1024,MAX_PROPERTIES=256;
const validName=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name)&&!['constructor','prototype','__proto__'].includes(name.toLowerCase());
const checkedName=name=>{if(!validName(name))throw new TypeError('Invalid OCX property name');return name.toLowerCase();};
const copy=wire=>JSON.parse(JSON.stringify(wire));
function checkedContents(value){
  if(!value||value.format!=='VB6.OCX.PropertyBag'||value.version!==1||!Array.isArray(value.properties)||value.properties.length>MAX_PROPERTIES)throw new TypeError('Invalid OCX property bag');
  const text=JSON.stringify(value);if(new TextEncoder().encode(text).length>MAX_BYTES)throw new RangeError('OCX property bag exceeds 1 MiB');
  const entries=new Map();
  for(const item of value.properties){if(!item||typeof item!=='object')throw new TypeError('Invalid OCX property');const key=checkedName(item.name);if(entries.has(key))throw new TypeError('Duplicate OCX property');decodeAutomationValue(item.value);const wire=copy(item.value);entries.set(key,{name:item.name,value:wire});}
  return entries;
}
export class OcxPropertyBag {
  #entries=new Map();
  constructor(contents){if(contents!==undefined)this.Contents=contents;}
  ReadProperty(name,defaultValue=undefined){const item=this.#entries.get(checkedName(name));return item?decodeAutomationValue(copy(item.value)):defaultValue;}
  /** Scalar-aware counterpart for compiled/adapted controls; raw embedding reads remain compatible. */
  ReadPropertyScalar(name,defaultValue=undefined){const item=this.#entries.get(checkedName(name));return item?decodeAutomationValue(copy(item.value),{preserveScalars:true}):defaultValue;}
  WriteProperty(name,value,defaultValue=undefined){
    const key=checkedName(name),wire=encodeAutomationValue(value),next=new Map(this.#entries);
    if(arguments.length>2&&JSON.stringify(wire)===JSON.stringify(encodeAutomationValue(defaultValue)))next.delete(key);
    else next.set(key,{name:next.get(key)?.name||name,value:wire});
    // Validate the whole prospective state before replacing anything.
    this.#entries=checkedContents({format:'VB6.OCX.PropertyBag',version:1,properties:[...next.values()]});
  }
  get Contents(){return {format:'VB6.OCX.PropertyBag',version:1,properties:[...this.#entries.values()].map(copy)};}
  set Contents(value){this.#entries=checkedContents(value);}
  get Count(){return this.#entries.size;}
}
const sites=new WeakMap();
function synchronous(value){if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw new TypeError('Portable OCX lifecycle hooks must be synchronous');}return value;}
const hooks=['initialize','initProperties','readProperties','writeProperties','resize','show','hide','terminate','ambientChanged','activate','deactivate','uiDeactivate','focus','paint','translateAccelerator','mnemonic','requestEdit','propertyChanged'];
/** One site per trusted adapter; imported project data never supplies executable hooks. */
export class OcxControlSite {
  #control=null;#closed=false;#dirty=false;#bag;#lifecycle={};#revision=0;#saving=false;
  #state='unbound';#freezes=0;#locks=0;#observers=new Set();#geometry=null;#visible=false;
  #focused=false;#syncing=false;#cleanup=[];#container=null;
  constructor(model,{design=false,form=null,onPropertyChanged=()=>{},ambient={},container=null}={}){
    if(!model||typeof model!=='object'||typeof onPropertyChanged!=='function')throw new TypeError('Invalid OCX site');
    this.model=model;this.design=!!design;this.onPropertyChanged=onPropertyChanged;this.#container=container;
    this.#bag=new OcxPropertyBag(model.ocxState);
    const properties=form?.props||form?.properties||{};
    this.Ambient=new OcxAmbientProperties({BackColor:properties.BackColor??0x8000000f,ForeColor:properties.ForeColor??0x80000012,DisplayName:model.name||'',...ambient,UserMode:this.design?0:-1},
      (name,dispid)=>{if(this.#control&&!this.#closed){try{this.#hook('ambientChanged',name,dispid,this);}finally{if(name==='UIDead'&&this.Ambient.UIDead)this.deactivate({uiOnly:true});}}});
  }
  bind(control){
    if(this.#control||this.#closed)throw new Error('OCX site is already bound or closed');
    const lifecycle=control?.ocxLifecycle||{};
    for(const name of hooks)if(lifecycle[name]!==undefined&&typeof lifecycle[name]!=='function')throw new TypeError('Invalid OCX lifecycle hook: '+name);
    this.#control=control;this.#lifecycle={...lifecycle};sites.set(control,this);this.#state='loaded';
    this.#hook('initialize',this);
    if(this.model.ocxState===undefined)this.#hook('initProperties',this);else this.#hook('readProperties',new OcxPropertyBag(this.#bag.Contents),this);
    this.sync();this.#container?.add(this);
    return this;
  }
  get Extender(){this.#assertOpen();return this.#control;}
  get Container(){return this.#container;}
  get State(){return this.#state;}
  get Dirty(){return this.#dirty;}
  get EventsFrozen(){return this.#freezes>0;}
  get Focused(){return this.#focused;}
  get Revision(){return this.#revision;}
  get Visible(){return this.#visible;}
  get Bounds(){return this.#geometry?{...this.#geometry}:null;}
  #hook(name,...args){return synchronous(this.#lifecycle[name]?.(...args));}
  /** Lifecycle notifications follow actual adapter properties, not a stale model. */
  sync(){
    this.#assertOpen();if(this.#syncing)return;this.#syncing=true;
    try{
      const p=this.#control.props||this.model.properties||{},geometry={left:Number(p.Left??0),top:Number(p.Top??0),width:Number(p.Width??0),height:Number(p.Height??0)};
      if(!Object.values(geometry).every(Number.isFinite)||geometry.width<0||geometry.height<0)throw new RangeError('Invalid OCX bounds');
      const resized=!this.#geometry||geometry.width!==this.#geometry.width||geometry.height!==this.#geometry.height;
      const previous=this.#geometry;this.#geometry=geometry;if(resized)this.#hook('resize',geometry.width,geometry.height,this);
      const visible=p.Visible!==0&&p.Visible!==false;if(visible!==this.#visible){this.#visible=visible;try{this.#hook(visible?'show':'hide',this);}finally{if(!visible)this.deactivate({uiOnly:true});}}
      if(p.Enabled===0||p.Enabled===false)this.deactivate({uiOnly:true});
      // Clear the old footprint as well as painting the new one after a move.
      if(previous&&Object.keys(previous).some(k=>previous[k]!==geometry[k]))this.#container?.invalidate(this,previous);
      this.#container?.invalidate(this);
    }finally{this.#syncing=false;}
  }
  setAmbient(changes){this.#assertOpen();if(Object.keys(changes||{}).some(n=>n.toLowerCase()==='usermode'))throw new TypeError('Use setDesignMode to change UserMode');return this.Ambient.update(changes);}
  setDesignMode(value){this.#assertOpen();if(typeof value!=='boolean')throw new TypeError('Expected Boolean design mode');if(value===this.design)return;if(value)this.deactivate();this.design=value;this.Ambient.update({UserMode:value?0:-1});}
  activate({ui=false}={}){
    this.#assertOpen();if(this.design||this.Ambient.UIDead||!this.#visible||this.#control.props?.Enabled===0||this.#control.props?.Enabled===false)return false;
    const state=ui?'ui-active':'in-place-active';if(this.#state===state||this.#state==='ui-active'&&!ui)return true;
    this.#hook('activate',ui,this);this.#state=state;return true;
  }
  deactivate({uiOnly=false}={}){
    this.#assertOpen();if(typeof uiOnly!=='boolean')throw TypeError('Expected Boolean UI deactivation');
    // LockInPlaceActive protects in-place, not UI-active state. Tab/focus changes
    // must still work while a source has locked its in-place lifetime.
    if(uiOnly){if(this.#state!=='ui-active')return;this.#hook('uiDeactivate',this);this.setFocus(false);this.#state='in-place-active';return;}
    if(this.#locks)throw new Error('OCX in-place activation is locked');if(this.#state==='loaded')return;
    this.#hook('deactivate',this);this.setFocus(false);this.#state='loaded';
  }
  LockInPlaceActive(lock){this.#assertOpen();if(typeof lock!=='boolean')throw new TypeError('Expected Boolean activation lock');if(lock){if(this.#locks>=256)throw new RangeError('OCX activation lock limit');this.#locks++;}else {if(!this.#locks)throw new Error('Unbalanced OCX activation unlock');this.#locks--;}}
  FreezeEvents(freeze){this.#assertOpen();if(typeof freeze!=='boolean')throw new TypeError('Expected Boolean event freeze');if(freeze){if(this.#freezes>=256)throw new RangeError('OCX event freeze limit');this.#freezes++;}else {if(!this.#freezes)throw new Error('Unbalanced OCX event thaw');this.#freezes--;}}
  setFocus(value){this.#assertOpen();if(typeof value!=='boolean')throw new TypeError('Expected Boolean focus');if(value===this.#focused)return value;if(value&&!this.activate({ui:true}))return false;try{this.#hook('focus',value,this);}catch(error){if(value&&this.#state==='ui-active')this.#state='in-place-active';throw error;}this.#focused=value;return value;}
  TransformCoords(point,options){this.#assertOpen();return ocxTransformCoords(point,options);}
  observeProperties(observer){
    this.#assertOpen();if(!observer||!['requestEdit','changed'].some(n=>typeof observer[n]==='function')||['requestEdit','changed'].some(n=>observer[n]!==undefined&&typeof observer[n]!=='function'))throw new TypeError('Invalid property observer');
    if(this.#observers.size>=256)throw new RangeError('OCX property observer limit');const entry={...observer};this.#observers.add(entry);return ()=>this.#observers.delete(entry);
  }
  RequestEdit(name){this.#assertOpen();checkedName(name);if(this.#hook('requestEdit',name,this)===false)return false;for(const observer of [...this.#observers])if(this.#observers.has(observer)&&synchronous(observer.requestEdit?.(name,this))===false)return false;return true;}
  PropertyChanged(name){
    this.#assertOpen();checkedName(name);this.#dirty=true;this.#revision++;
    const errors=[];for(const fn of [()=>this.onPropertyChanged(name,this),()=>this.#hook('propertyChanged',name,this),...[...this.#observers].map(observer=>()=>{if(this.#observers.has(observer))synchronous(observer.changed?.(name,this));})])try{fn();}catch(error){errors.push(error);}
    if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'OCX property notification failed');
  }
  async RaiseEvent(name,args=[]){this.#assertOpen();if(!validName(name)||!Array.isArray(args)||args.length>64)throw new TypeError('Invalid OCX event');if(this.design||this.EventsFrozen||this.Ambient.UIDead)return;return this.#control.event?.(name,args);}
  translateAccelerator(event){this.#assertOpen();return !this.design&&!this.Ambient.UIDead&&this.#hook('translateAccelerator',event,this)===true;}
  mnemonic(event){this.#assertOpen();return !this.design&&!this.Ambient.UIDead&&this.Ambient.SupportsMnemonics!==0&&this.#hook('mnemonic',event,this)===true;}
  paint(context,clip=null){this.#assertOpen();return this.#hook('paint',context,clip,this);}
  onDispose(callback){this.#assertOpen();if(typeof callback!=='function')throw new TypeError('Expected cleanup callback');this.#cleanup.push(callback);}
  save({clearDirty=true,onlyIfDirty=false}={}){
    this.#assertOpen();if(this.#saving)throw new Error('Recursive OCX persistence is not allowed');if(onlyIfDirty&&!this.#dirty)return this.#bag.Contents;
    const revision=this.#revision,bag=new OcxPropertyBag(this.#bag.Contents);this.#saving=true;
    try{this.#hook('writeProperties',bag,this);this.#assertOpen();this.#bag=bag;if(clearDirty&&revision===this.#revision)this.#dirty=false;return bag.Contents;}finally{this.#saving=false;}
  }
  close(){
    if(this.#closed)return;this.#closed=true;this.#state='closed';this.#focused=false;this.#observers.clear();if(this.#control)sites.delete(this.#control);
    const errors=[];for(const action of [()=>this.#container?.remove(this),...this.#cleanup.reverse(),()=>this.#hook('terminate',this)])try{synchronous(action());}catch(error){errors.push(error);}
    this.#cleanup=[];if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'OCX termination failed');
  }
  #assertOpen(){if(this.#closed||!this.#control)throw new Error('OCX site is not active');}
}
export function ocxControlSite(control){return sites.get(control)||null;}
