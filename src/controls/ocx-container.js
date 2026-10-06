/** Portable in-place control container. Native HWND/OLE embedding is a separate path. */
import {OcxAmbientProperties} from './ocx-ambient.js';
const containers=new WeakMap();
const enabled=site=>site.State!=='closed'&&site.Visible&&!site.design&&!site.Ambient.UIDead&&site.Extender.props?.Enabled!==0&&site.Extender.props?.Enabled!==false;
export class OcxContainer {
  #sites=[];#focus=null;#closed=false;#listeners=new Map();#invalidators=new Set();#keyHandler;
  constructor({form=null,node=form?.node||null,design=false,onError=error=>console.error(error)}={}){
    if(typeof onError!=='function')throw TypeError('Expected container error callback');this.onError=onError;
    this.form=form;this.node=node;this.design=!!design;
    this.#keyHandler=event=>{if(event.defaultPrevented||this.#closed)return;if(this.translateAccelerator(event))event.preventDefault?.();};
    node?.addEventListener?.('keydown',this.#keyHandler);
  }
  get Count(){return this.#sites.length;}
  get Closed(){return this.#closed;}
  get ActiveControl(){return this.#focus&&enabled(this.#focus)&&this.#focus.Focused?this.#focus.Extender:null;}
  get Sites(){return [...this.#sites];}
  add(site){
    this.#assertOpen();if(this.#sites.includes(site))return;if(this.#sites.length>=1024)throw new RangeError('OCX container limit');
    if(site.State==='closed'||site.Container&&site.Container!==this)throw new Error('OCX site belongs to another container or is closed');
    this.#sites.push(site);const node=site.Extender.node;
    const focus=()=>{if(enabled(site)&&this.#focus!==site)try{this.activate(site);}catch(error){this.onError(error);}};node?.addEventListener?.('focusin',focus);this.#listeners.set(site,()=>node?.removeEventListener?.('focusin',focus));
    this.invalidate(site);
  }
  remove(site){
    const index=this.#sites.indexOf(site);if(index<0)return false;
    this.#sites.splice(index,1);this.#listeners.get(site)?.();this.#listeners.delete(site);if(this.#focus===site)this.#focus=null;this.invalidate(site);return true;
  }
  enumerate(){
    this.#assertOpen();const result=new Set(this.#sites.filter(s=>s.State!=='closed').map(s=>s.Extender));
    for(const control of this.form?.controls||[])if(control?.__control&&!control.disposed)result.add(control);return [...result];
  }
  activate(site){
    this.#assertOpen();if(!this.#sites.includes(site)||!enabled(site))return false;if(this.#focus===site&&site.Focused)return true;
    // Moving UI focus does not tear down another control's in-place lifetime.
    const previous=this.#focus;if(previous&&previous.State!=='closed')previous.deactivate({uiOnly:true});
    this.#focus=null;
    try{if(site.setFocus(true)){this.#focus=site;return true;}if(previous&&previous.State!=='closed'&&previous.setFocus(true))this.#focus=previous;return false;}
    catch(error){try{if(previous&&previous.State!=='closed'&&previous.setFocus(true))this.#focus=previous;}catch(restore){throw new AggregateError([error,restore],'OCX activation and recovery failed');}throw error;}
  }
  focusNext(reverse=false){
    this.#assertOpen();const candidates=this.#sites.map((site,index)=>({site,index})).filter(({site})=>enabled(site)&&site.Extender.props?.TabStop!==0&&site.Extender.props?.TabStop!==false)
      .sort((a,b)=>(Number(a.site.Extender.props?.TabIndex)||0)-(Number(b.site.Extender.props?.TabIndex)||0)||a.index-b.index).map(x=>x.site);
    if(!candidates.length)return false;let i=candidates.indexOf(this.#focus);i=i<0?(reverse?candidates.length-1:0):(i+(reverse?-1:1)+candidates.length)%candidates.length;
    const site=candidates[i];if(!this.activate(site))return false;(site.Extender.input||site.Extender.node)?.focus?.();return true;
  }
  translateAccelerator(event){
    this.#assertOpen();if(this.design||!event||event.isComposing||event.defaultPrevented)return false;
    if(this.#focus&&enabled(this.#focus)&&this.#focus.translateAccelerator(event))return true;
    if(event.altKey&&!event.ctrlKey&&!event.metaKey){for(const site of this.#sites)if(enabled(site)&&site.mnemonic(event))return true;}
    if(event.key==='Tab'&&!event.ctrlKey&&!event.altKey&&!event.metaKey)return this.focusNext(!!event.shiftKey);
    if(['Enter','Escape'].includes(event.key)&&!event.ctrlKey&&!event.altKey&&!event.metaKey){
      const property=event.key==='Enter'?'Default':'Cancel',site=this.#sites.find(s=>enabled(s)&&!!s.Extender.props?.[property]);
      if(site){Promise.resolve(site.RaiseEvent('Click')).catch(error=>this.onError(error));return true;}
    }
    return false;
  }
  setAmbient(changes){this.#assertOpen();new OcxAmbientProperties(changes);if(Object.keys(changes).some(k=>k.toLowerCase()==='usermode'))throw TypeError('Use setDesignMode to change UserMode');const errors=[];for(const site of [...this.#sites])try{site.setAmbient(changes);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'OCX ambient notifications failed');}
  setDesignMode(design){this.#assertOpen();if(typeof design!=='boolean')throw TypeError('Expected Boolean design mode');if(this.#focus&&this.#focus.State!=='closed')this.#focus.deactivate();this.#focus=null;this.design=design;const errors=[];for(const site of [...this.#sites])try{site.setDesignMode(design);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'OCX design-mode update failed');}
  hitTest(x,y){this.#assertOpen();if(!Number.isFinite(x)||!Number.isFinite(y))return null;return [...this.#sites].reverse().find(s=>{const r=s.Bounds;return enabled(s)&&r&&x>=r.left&&y>=r.top&&x<r.left+r.width&&y<r.top+r.height;})||null;}
  onInvalidate(handler){this.#assertOpen();if(typeof handler!=='function')throw TypeError('Expected invalidation callback');this.#invalidators.add(handler);return ()=>this.#invalidators.delete(handler);}
  invalidate(site,bounds=site?.Bounds||null){const errors=[];for(const handler of [...this.#invalidators])try{handler(bounds);}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'OCX invalidation failed');}
  close(){if(this.#closed)return;this.#closed=true;this.node?.removeEventListener?.('keydown',this.#keyHandler);const errors=[];for(const site of [...this.#sites].reverse())try{site.Extender.dispose();}catch(error){errors.push(error);}for(const cleanup of this.#listeners.values())cleanup();this.#listeners.clear();this.#sites=[];this.#focus=null;this.#invalidators.clear();if(errors.length)throw new AggregateError(errors,'OCX container disposal failed');}
  #assertOpen(){if(this.#closed)throw new Error('OCX container is closed');}
}
export function ocxContainerFor(form,options={}){if(!form||typeof form!=='object')return null;let container=containers.get(form);if(!container||container.Closed){container=new OcxContainer({...options,form});containers.set(form,container);}return container;}
