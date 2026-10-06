/** Trusted multi-selection property-page transaction, with stale edit detection. */
export class OcxPropertyPageSession {
  #registry;#models;#snapshots;#pending=new Map();#closed=false;#apply;#applying=false;
  constructor(registry,models,{onApply=()=>{}}={}){
    if(!registry?.validateProperties||!Array.isArray(models)||!models.length||models.length>256||new Set(models).size!==models.length||typeof onApply!=='function')throw TypeError('Invalid property-page selection');
    for(const model of models)if(!model||!registry.describe(model.type))throw TypeError('Unknown property-page control type');
    this.#registry=registry;this.#models=[...models];this.#snapshots=models.map(model=>JSON.stringify(model));this.#apply=onApply;
  }
  get IsPageDirty(){return this.#pending.size>0;}
  get Objects(){this.#assertActive();return this.#models.map(model=>JSON.parse(JSON.stringify(model)));}
  edit(changes,index=null){
    this.#assertActive();const selected=index===null?this.#models.map((_,i)=>i):[index];
    if(selected.some(i=>!Number.isInteger(i)||i<0||i>=this.#models.length))throw RangeError('Invalid property-page selection index');
    if(!changes||typeof changes!=='object'||Array.isArray(changes))throw TypeError('Invalid property-page changes');if(!Object.keys(changes).length)return;
    const next=new Map(this.#pending);
    for(const i of selected){const model=this.#models[i];this.#registry.validateProperties(model.type,changes);const canonical={};for(const [name,value]of Object.entries(changes)){const key=this.#registry.property(model.type,name)?.name||name;if(Object.keys(canonical).some(n=>n.toLowerCase()===key.toLowerCase()))throw TypeError('Duplicate property-page property');canonical[key]=structuredClone(value);}next.set(i,{...next.get(i),...canonical});}
    this.#pending=next;
  }
  Apply(){
    this.#assertActive();if(!this.#pending.size)return false;this.#applying=true;
    const backup=this.#models.map(model=>model.properties),entries=[];
    try{
      for(const [i,changes]of this.#pending){const model=this.#models[i];this.#registry.validateProperties(model.type,changes);entries.push({model,changes:{...changes},previous:JSON.parse(JSON.stringify(model.properties||{}))});}
      for(const entry of entries)entry.model.properties={...entry.model.properties,...entry.changes};
      const result=this.#apply(entries);if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw TypeError('Property-page commit must be synchronous');}
      this.#pending.clear();this.#snapshots=this.#models.map(model=>JSON.stringify(model));return true;
    }catch(error){this.#models.forEach((model,i)=>{model.properties=backup[i];});throw error;}finally{this.#applying=false;}
  }
  Cancel(){if(this.#closed)return;this.#closed=true;this.#pending.clear();}
  #assertActive(){if(this.#closed)throw Error('Property page is closed');if(this.#applying)throw Error('Property page is applying');if(this.#models.some((model,i)=>JSON.stringify(model)!==this.#snapshots[i]))throw Error('Property-page selection has changed; reopen the page');}
}
