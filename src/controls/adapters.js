/** Host code only. Native project data cannot register code or fetch plug-ins. */
export class ControlAdapterRegistry {
  #entries=new Map();
  register(type,{runtime,designer}={}){
    if(typeof type!=='string'||!type.length||type.length>255||!runtime&&!designer||[runtime,designer].some(f=>f!==undefined&&typeof f!=='function'))throw new TypeError('A control type and trusted runtime/designer factories are required');
    if(this.#entries.has(type.toLowerCase()))throw Error('Control adapter already registered');
    this.#entries.set(type.toLowerCase(),{runtime,designer});return this;
  }
  create(model,options={}){
    const entry=this.#entries.get(String(model.type).toLowerCase()),factory=options.design?entry?.designer:entry?.runtime;
    if(!factory)return null;
    const control=factory(model,options);
    if(!control||!control.__control||!control.node||typeof control.dispose!=='function'||typeof control.refresh!=='function'||control.model?.id!==model.id){try{control?.dispose?.();}catch{}throw new TypeError('Custom control factory must return a synchronous BrowserControl-compatible adapter');}
    return control;
  }
  has(type,design=false){const entry=this.#entries.get(String(type).toLowerCase());return typeof(design?entry?.designer:entry?.runtime)==='function';}
  types(){return [...this.#entries.keys()];}
}
