import {VBError} from '../language/lexer.js';
/** Explicit host for VB .pag source. Imported source is never auto-executed.
 * SelectedControls are detached property facades; only ApplyChanges may stage
 * writes, and the existing property-page transaction commits them as one undo.
 * This is not a native IPropertyPage COM implementation or binary OCX compiler.
 */
import {VirtualMachine,VBInstance} from '../runtime/vm.js';
import {compileProject} from '../language/compiler.js';
import {Cell,unbox} from '../runtime/values.js';
import {OcxPropertyPageSession} from './ocx-pages.js';
import {ocxEventCell} from './ocx-events.js';
const identifier=name=>typeof name==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(name)&&!['constructor','prototype','__proto__'].includes(name.toLowerCase());
const reserved=new Set(['propertypage','selectedcontrols','controls','changed']);
const events=new Set(['Change','Click','DblClick','KeyDown','KeyUp','KeyPress','MouseDown','MouseMove','MouseUp','GotFocus','LostFocus','Validate'].map(n=>n.toLowerCase()));
function collection(items){return Object.freeze({get Count(){return items.length;},Item(index){if(!Number.isInteger(index)||index<0||index>=items.length)throw new VBError('Subscript out of range',9);return items[index];},[Symbol.iterator](){return items.values();}});}

export class SourcePropertyPage {
  #vm;#instance;#module;#registry;#models=[];#snapshots=[];#objects=collection([]);#controls;#surface;
  #selectionRevision=0;#session=null;#phase='initializing';#dirty=false;#queue=Promise.resolve();#pending=0;#closed=false;#closing=false;#closingTask;#onApply;
  constructor(project,moduleName,{registry,models=[],controls={},allowDesignCode=false,onApply=()=>{},host={},instructionLimit=1000000,sliceMilliseconds=8}={}){
    if(allowDesignCode!==true)throw Error('Property-page source execution requires explicit allowDesignCode consent');
    if(!project||!identifier(moduleName)||!registry?.describe||!registry?.validateProperties||typeof onApply!=='function'||!controls||typeof controls!=='object'||Array.isArray(controls))throw TypeError('Invalid source property-page options');
    if(!Number.isInteger(instructionLimit)||instructionLimit<1||instructionLimit>50000000||!Number.isFinite(sliceMilliseconds)||sliceMilliseconds<1||sliceMilliseconds>100)throw RangeError('Invalid source property-page budget');
    const source=structuredClone(project),selected=source.modules?.find(m=>m.name?.toLowerCase()===moduleName.toLowerCase());
    if(selected?.form?.type!=='PropertyPage')throw TypeError('Select a VB PropertyPage source module');
    const names=Object.keys(controls);
    if(names.length>256||names.some(n=>!identifier(n)||reserved.has(n.toLowerCase()))||new Set(names.map(n=>n.toLowerCase())).size!==names.length)throw TypeError('Invalid property-page child map');
    this.formModel=structuredClone(selected.form);this.#registry=registry;this.#controls=Object.freeze({...controls});this.#onApply=onApply;
    for(const module of source.modules)if(module.form){module.kind='class';delete module.form;}
    const compiled=compileProject(source);if(!compiled.valid)throw Error(compiled.diagnostics.map(d=>`${d.source}:${d.line}: ${d.message}`).join('\n'));
    this.#module=compiled.modules.get(moduleName.toLowerCase());
    if(this.#module.declarations.some(d=>reserved.has(d.name.toLowerCase()))||[...this.#module.procedures.values()].some(p=>reserved.has(p.name.toLowerCase())))throw TypeError('Property page redeclares a reserved host member');
    const page=this;
    this.#surface={get Changed(){return page.#dirty?-1:0;},set Changed(value){page.#dirty=new Cell('Boolean',value).get()!==0;},get SelectedControls(){return page.#objects;},get Controls(){return collection(Object.values(page.#controls));},Caption:String(this.formModel.properties?.Caption||moduleName)};
    this.#vm=new VirtualMachine(compiled,{...host,createForm:undefined,sourceEventEnabled:()=>false,sourceEvent:undefined},{instructionLimit,sliceMilliseconds,debuggerEnabled:false,debugStatements:false});
    this.#instance=new VBInstance(this.#module);this.#instance.formObject=this.#surface;
    this.#instance.fields.set('propertypage',new Cell('Object',this.#surface,true));
    for(const [name,value]of Object.entries(this.#controls))this.#instance.fields.set(name.toLowerCase(),new Cell('Object',value,true));
    const initial=this.#validateSelection(models);
    this.ready=this.#initialize(initial).catch(async error=>{try{await this.#lifecycle('Terminate');}catch{}this.#closed=true;this.#vm.stop();throw error;});
  }
  static async create(project,moduleName,options){const page=new SourcePropertyPage(project,moduleName,options);await page.ready;return page;}
  get Closed(){return this.#closed;}
  get IsPageDirty(){return this.#dirty;}
  get Caption(){return this.#surface.Caption;}
  get SelectionCount(){return this.#models.length;}
  #validateSelection(models){
    if(!Array.isArray(models)||models.length>256||new Set(models).size!==models.length||models.some(m=>!m||!this.#registry.describe(m.type)))throw TypeError('Invalid source property-page selection');
    return [...models];
  }
  #assertCurrent(){if(this.#models.some((m,i)=>JSON.stringify(m)!==this.#snapshots[i]))throw Error('Property-page selection has changed; reopen the page');}
  #select(models){
    this.#models=models;this.#snapshots=models.map(m=>JSON.stringify(m));this.#dirty=false;
    const revision=++this.#selectionRevision;
    this.#objects=collection(models.map((model,index)=>{
      const assertFacade=()=>{if(this.#closed||revision!==this.#selectionRevision)throw Error('SelectedControls reference has expired');this.#assertCurrent();};
      const facade={},keys=new Map();
      for(const name of [...Object.keys(model.properties||{}),...this.#registry.describe(model.type).properties.map(p=>p.name)])if(identifier(name))keys.set(name.toLowerCase(),name);
      for(const name of keys.values()){
        // VB member lookup is case-insensitive; capitalize only the facade key
        // to preserve the VM's public-host-member policy, not project storage.
        Object.defineProperty(facade,name[0].toUpperCase()+name.slice(1),{enumerable:true,get:()=>{
          assertFacade();const snapshot=this.#session?.Objects[index]||model;
          const properties=snapshot.properties||{},key=Object.hasOwn(properties,name)?name:Object.keys(properties).find(k=>k.toLowerCase()===name.toLowerCase());
          const value=key===undefined?this.#registry.property(model.type,name)?.default:properties[key];
          return structuredClone(value);
        },set:value=>{
          assertFacade();if(this.#phase!=='applying'||!this.#session)throw Error('SelectedControls can only be changed during ApplyChanges');
          this.#session.edit({[name]:unbox(value)},index);
        }});
      }
      return Object.freeze(facade);
    }));
  }
  async #initialize(models){await this.#vm.initialize();await this.#vm.initializeFields(this.#instance);this.#vm.setState('running');await this.#lifecycle('Initialize');this.#select(models);await this.#lifecycle('SelectionChanged');this.#phase='idle';return this;}
  #lifecycle(name,args=[]){return this.#procedure('PropertyPage_'+name,args);}
  async #procedure(name,values){
    const proc=this.#module.procedures.get(name.toLowerCase());if(!proc)return {handled:false,args:[...values]};
    if(values.length!==proc.params.length)throw TypeError('Property-page event argument count mismatch');
    const cells=proc.params.map((p,i)=>ocxEventCell(p,values[i]));
    await this.#vm.callProcedure(this.#instance,proc,cells.map((c,i)=>proc.params[i].byRef?{ref:c}:c.getScalar()),this.#vm.currentFrame);
    return {handled:true,args:cells.map((c,i)=>proc.params[i].byRef?c.getScalar():values[i])};
  }
  #enqueue(action){
    if(this.#closed||this.#closing)return Promise.reject(Error('Property page is closed'));
    if(this.#pending>=128)return Promise.reject(RangeError('Property-page queue is full'));this.#pending++;
    const run=this.#queue.then(async()=>{await this.ready;if(this.#closed)throw Error('Property page is closed');return action();}).finally(()=>this.#pending--);
    this.#queue=run.catch(()=>{});return run;
  }
  setObjects(models){const next=this.#validateSelection(models);return this.#enqueue(async()=>{this.#select(next);await this.#lifecycle('SelectionChanged');});}
  dispatchControlEvent(control,name,values=[]){return this.#enqueue(async()=>{
    this.#assertCurrent();const key=Object.keys(this.#controls).find(k=>k.toLowerCase()===String(control).toLowerCase());
    if(!key||!events.has(String(name).toLowerCase())||!Array.isArray(values)||values.length>64)throw TypeError('Invalid property-page control event');
    return this.#procedure(key+'_'+name,values);
  });}
  editProperty(name){return this.#enqueue(()=>{this.#assertCurrent();if(!identifier(name))throw TypeError('Invalid property-page property');return this.#lifecycle('EditProperty',[name]);});}
  apply(){return this.#enqueue(async()=>{
    this.#assertCurrent();if(!this.#dirty)return false;if(!this.#models.length)throw Error('Select controls before applying a property page');
    const session=new OcxPropertyPageSession(this.#registry,this.#models,{onApply:this.#onApply});this.#session=session;this.#phase='applying';this.#dirty=false;
    try{await this.#lifecycle('ApplyChanges');const changed=session.Apply();this.#snapshots=this.#models.map(m=>JSON.stringify(m));return changed;}
    catch(error){this.#dirty=true;throw error;}
    finally{session.Cancel();this.#session=null;this.#phase='idle';}
  });}
  close(){
    if(this.#closed)return Promise.resolve();if(this.#closing)return this.#closingTask;this.#closing=true;
    this.#closingTask=this.#queue.then(async()=>{try{await this.ready;await this.#lifecycle('Terminate');}finally{this.#session?.Cancel();this.#objects=collection([]);this.#models=[];this.#closed=true;this.#vm.stop();}});return this.#closingTask;
  }
}
