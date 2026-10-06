/** Portable source-control persistence. This is not the proprietary OCX/FRX format. */
import {encodeAutomationValue,decodeAutomationValue} from '../runtime/automation-wire.js';
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
function synchronous(value){if(value&&typeof value.then==='function')throw new TypeError('Portable OCX lifecycle hooks must be synchronous');return value;}
/** One site per trusted adapter instance; never created from serialized executable code. */
export class OcxControlSite {
  #control=null;#closed=false;#dirty=false;#bag;#lifecycle;
  constructor(model,{design=false,form=null,onPropertyChanged=()=>{}}={}){
    this.model=model;this.design=!!design;this.onPropertyChanged=onPropertyChanged;
    this.#bag=new OcxPropertyBag(model.ocxState);
    this.Ambient=Object.freeze({get UserMode(){return design?0:-1;},get BackColor(){return form?.props?.BackColor??0x8000000f;},get ForeColor(){return form?.props?.ForeColor??0x80000012;},get DisplayName(){return model.name;}});
  }
  bind(control){
    if(this.#control||this.#closed)throw new Error('OCX site is already bound or closed');this.#control=control;this.#lifecycle=control.ocxLifecycle||{};sites.set(control,this);
    for(const name of ['initProperties','readProperties','writeProperties','terminate'])if(this.#lifecycle[name]!==undefined&&typeof this.#lifecycle[name]!=='function')throw new TypeError('Invalid OCX lifecycle hook');
    if(this.model.ocxState===undefined)synchronous(this.#lifecycle.initProperties?.(this));else synchronous(this.#lifecycle.readProperties?.(this.#bag,this));
    return this;
  }
  get Extender(){this.#assertOpen();return this.#control;}
  get Dirty(){return this.#dirty;}
  PropertyChanged(name){this.#assertOpen();checkedName(name);this.#dirty=true;this.onPropertyChanged(name,this);}
  async RaiseEvent(name,args=[]){this.#assertOpen();if(typeof name!=='string'||!validName(name)||!Array.isArray(args)||args.length>64)throw new TypeError('Invalid OCX event');if(this.design)return;return this.#control.event?.(name,args);}
  save(){this.#assertOpen();const bag=new OcxPropertyBag(this.#bag.Contents);synchronous(this.#lifecycle.writeProperties?.(bag,this));this.#bag=bag;this.#dirty=false;return bag.Contents;}
  close(){if(this.#closed)return;this.#closed=true;sites.delete(this.#control);synchronous(this.#lifecycle?.terminate?.(this));}
  #assertOpen(){if(this.#closed||!this.#control)throw new Error('OCX site is not active');}
}
export function ocxControlSite(control){return sites.get(control)||null;}
