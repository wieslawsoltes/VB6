/** Host code only. Native project data cannot register code or fetch plug-ins. */
import {OcxControlSite,ocxControlSite} from './ocx-site.js';
import {ocxContainerFor} from './ocx-container.js';
import {OcxPropertyPageSession} from './ocx-pages.js';
const nameOK=n=>typeof n==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(n)&&!['constructor','prototype','__proto__'].includes(n.toLowerCase());
const scalar=v=>v===null||['string','boolean','number'].includes(typeof v)&&(!(typeof v==='number')||Number.isFinite(v))&&(!(typeof v==='string')||v.length<=65536);
function metadataFor(type,metadata={}){
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new TypeError('Invalid control metadata');
  const properties=metadata.properties||[],events=metadata.events||[];
  if(!Array.isArray(properties)||properties.length>256||!Array.isArray(events)||events.length>256)throw new TypeError('Control metadata exceeds limits');
  const seen=new Set(),eventNames=new Set();
  const normalized=properties.map(p=>{
    if(!p||!nameOK(p.name)||seen.has(p.name.toLowerCase())||p.default!==undefined&&!scalar(p.default))throw new TypeError('Invalid or duplicate control property');seen.add(p.name.toLowerCase());
    const defaultValue=typeof p.default==='boolean'?(p.default?-1:0):p.default;const choices=(p.choices||(typeof p.default==='boolean'?[{value:0,label:'False'},{value:-1,label:'True'}]:undefined))?.map(c=>{if(!c||!Number.isFinite(c.value)||typeof c.label!=='string'||c.label.length>256)throw new TypeError('Invalid property choices');return Object.freeze({value:c.value,label:c.label});});
    if(choices&&(choices.length>256||new Set(choices.map(c=>c.value)).size!==choices.length))throw new TypeError('Invalid property choices');
    if(choices&&p.default!==undefined&&!choices.some(c=>Object.is(c.value,defaultValue)))throw new TypeError('Default value is not a property choice');
    return Object.freeze({name:p.name,readOnly:!!p.readOnly,description:String(p.description||'').slice(0,2048),...(p.default===undefined?{}:{default:defaultValue}),...(choices?{choices:Object.freeze(choices)}:{})});
  });
  const normalizedEvents=events.map(e=>{
    if(!e||!nameOK(e.name)||eventNames.has(e.name.toLowerCase())||!Array.isArray(e.params||[])||(e.params||[]).length>64)throw new TypeError('Invalid control event');eventNames.add(e.name.toLowerCase());const paramsSeen=new Set();
    const params=(e.params||[]).map(p=>{if(!p||!nameOK(p.name)||paramsSeen.has(p.name.toLowerCase())||!['Variant','Byte','Integer','Long','Single','Double','String','Boolean','Object','Date','Currency','Decimal'].includes(p.type||'Variant'))throw new TypeError('Invalid event parameter');paramsSeen.add(p.name.toLowerCase());if(p.array!==undefined&&typeof p.array!=='boolean'||p.array&&!p.byRef)throw new TypeError('Array events require ByRef parameters');return Object.freeze({name:p.name,type:p.type||'Variant',byRef:!!p.byRef,...(p.array?{array:true}:{})});});
    return Object.freeze({name:e.name,params:Object.freeze(params)});
  });
  const derived=type.split('.').filter(x=>/^[A-Za-z]/.test(x)).at(-1)?.replace(/[^A-Za-z0-9_]/g,'').slice(0,30)||'OcxControl',baseName=metadata.baseName??derived;
  if(!nameOK(baseName)||baseName.length>30)throw new TypeError('Invalid control base name');
  if(metadata.defaultEvent!==undefined&&!normalizedEvents.some(e=>e.name===metadata.defaultEvent))throw new TypeError('Unknown default event');
  return Object.freeze({type,baseName,displayName:String(metadata.displayName||type).slice(0,255),description:String(metadata.description||'').slice(0,2048),properties:Object.freeze(normalized),events:Object.freeze(normalizedEvents),defaultEvent:metadata.defaultEvent||normalizedEvents[0]?.name||null});
}
export class ControlAdapterRegistry {
  #entries=new Map();
  register(type,{runtime,designer,metadata,lifecycle=false,propertyPages}={}){
    if(typeof type!=='string'||!type.length||type.length>255||!runtime&&!designer||[runtime,designer,propertyPages].some(f=>f!==undefined&&typeof f!=='function'))throw new TypeError('A control type and trusted runtime/designer factories are required');
    if(this.#entries.has(type.toLowerCase()))throw Error('Control adapter already registered');
    this.#entries.set(type.toLowerCase(),{runtime,designer,metadata:metadataFor(type,metadata),lifecycle:!!lifecycle,propertyPages});return this;
  }
  create(model,options={}){
    const entry=this.#entries.get(String(model.type).toLowerCase()),factory=options.design?entry?.designer:entry?.runtime;
    if(!factory)return null;
    const site=entry.lifecycle?new OcxControlSite(model,{...options,container:options.container||ocxContainerFor(options.form,options)}):null;let control;
    try{
      control=factory(model,site?{...options,ocxSite:site}:options);
      if(!control||!control.__control||!control.node||typeof control.dispose!=='function'||typeof control.refresh!=='function'||control.model?.id!==model.id)throw new TypeError('Custom control factory must return a synchronous BrowserControl-compatible adapter');
      if(site){site.bind(control);const refresh=control.refresh.bind(control);control.refresh=(...args)=>{const value=refresh(...args);site.sync();return value;};const dispose=control.dispose.bind(control);let closed=false;control.dispose=()=>{if(closed)return;closed=true;try{site.close();}finally{dispose();}};}
      return control;
    }catch(error){try{site?.close();}catch{}try{control?.dispose?.();}catch{}throw error;}
  }
  has(type,design=false){const entry=this.#entries.get(String(type).toLowerCase());return typeof(design?entry?.designer:entry?.runtime)==='function';}
  types(){return [...this.#entries.keys()];}
  catalog(){return [...this.#entries.values()].map(e=>({...e.metadata,runtime:!!e.runtime,designer:!!e.designer,propertyPages:!!e.propertyPages}));}
  describe(type){return this.#entries.get(String(type).toLowerCase())?.metadata||null;}
  property(type,key){return this.describe(type)?.properties.find(p=>p.name.toLowerCase()===String(key).toLowerCase())||null;}
  defaults(type){return Object.fromEntries((this.describe(type)?.properties||[]).filter(p=>p.default!==undefined).map(p=>[p.name,p.default]));}
  initializeModel(model){model.properties={...this.defaults(model.type),...model.properties};return model;}
  validateProperties(type,changes){
    if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).length>256)throw new TypeError('Invalid control properties');
    for(const [key,value]of Object.entries(changes)){if(!nameOK(key))throw new TypeError('Invalid property name');const p=this.property(type,key);if(!p)continue;if(p.readOnly)throw new TypeError(p.name+' is read-only');if(value!==undefined&&!scalar(value))throw new TypeError('Invalid '+p.name+' value');if(p.choices&&value!==undefined&&!p.choices.some(c=>Object.is(c.value,value)))throw new TypeError('Invalid '+p.name+' choice');if(p.default!==undefined&&p.default!==null&&value!==undefined&&typeof value!==typeof p.default)throw new TypeError('Invalid '+p.name+' type');}
  }
  hasPropertyPages(type){return !!this.#entries.get(String(type).toLowerCase())?.propertyPages;}
  async editProperties(model,options={}){const entry=this.#entries.get(String(model.type).toLowerCase());if(!entry?.propertyPages)throw new Error('No property pages for this component');const changes=await entry.propertyPages(JSON.parse(JSON.stringify(model)),{...options,metadata:entry.metadata});if(changes===null||changes===undefined||changes===false)return null;this.validateProperties(model.type,changes);return changes;}
  canEditSelection(models){return Array.isArray(models)&&models.length>0&&models.length<=256&&new Set(models).size===models.length&&models.every(model=>model&&typeof model.type==='string'&&model.type.toLowerCase()===models[0].type.toLowerCase()&&this.hasPropertyPages(model.type));}
  async editSelection(models,options={}){
    if(!this.canEditSelection(models))throw TypeError('Select 1..256 components of the same property-page type');
    const snapshots=models.map(model=>JSON.stringify(model));
    const changes=await this.editProperties(models[0],{...options,objects:models.map(model=>JSON.parse(JSON.stringify(model)))});
    if(models.some((model,i)=>JSON.stringify(model)!==snapshots[i]))throw Error('Property-page selection has changed; reopen the page');
    if(changes===null)return null;
    const canonical={};for(const [name,value] of Object.entries(changes)){const key=this.property(models[0].type,name)?.name||name;if(Object.hasOwn(canonical,key))throw TypeError('Duplicate property-page property');canonical[key]=value;}
    for(const model of models)this.validateProperties(model.type,canonical);return canonical;
  }
  createPropertyPageSession(models,options){return new OcxPropertyPageSession(this,models,options);}
  save(control){const site=ocxControlSite(control);if(!site)throw new Error('This component has no portable OCX persistence site');return site.save();}
}
