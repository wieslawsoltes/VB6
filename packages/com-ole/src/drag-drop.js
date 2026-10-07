import {ComError,HRESULT,IID,integer} from './contracts.js';
import {ComObject} from './identity.js';
export const DROPEFFECT=Object.freeze({NONE:0,COPY:1,MOVE:2,LINK:4,SCROLL:0x80000000});
export const MK=Object.freeze({LBUTTON:1,RBUTTON:2,SHIFT:4,CONTROL:8,MBUTTON:16,ALT:32});
function point(value){if(!value||!Number.isFinite(value.x)||!Number.isFinite(value.y)||Math.abs(value.x)>0x7fffffff||Math.abs(value.y)>0x7fffffff)throw new ComError(HRESULT.E_INVALIDARG,'Invalid drag point');return Object.freeze({x:value.x,y:value.y});}
function sync(value){if(value?.then){Promise.resolve(value).catch(()=>{});throw new ComError(HRESULT.E_INVALIDARG,'Drag callbacks must be synchronous');}return value;}
function effect(value,allowed,scroll=false){integer(value,0,0xffffffff);if(value&~(scroll?0x80000007:7))throw new ComError(HRESULT.E_INVALIDARG,'Invalid drop effect');const selected=(value&allowed)&7;if(![0,1,2,4].includes(selected))throw new ComError(HRESULT.E_INVALIDARG,'Target must choose a single effect');return (selected|(scroll?value&0x80000000:0))>>>0;}
export class DropSource extends ComObject {
  #buttons;#feedback;
  constructor({buttons=MK.LBUTTON,feedback=null}={}){super([IID.IDropSource]);integer(buttons,1,19);if(buttons&~19||feedback!==null&&typeof feedback!=='function')throw new ComError(HRESULT.E_INVALIDARG);this.#buttons=buttons;this.#feedback=feedback;}
  QueryContinueDrag(escape,keyState){this.assertAlive();if(typeof escape!=='boolean')throw new ComError(HRESULT.E_INVALIDARG);integer(keyState,0,63);return escape?HRESULT.DRAGDROP_S_CANCEL:(keyState&this.#buttons)?HRESULT.S_OK:HRESULT.DRAGDROP_S_DROP;}
  GiveFeedback(value){this.assertAlive();return this.#feedback?sync(this.#feedback(value)):HRESULT.DRAGDROP_S_USEDEFAULTCURSORS;}
}
export class DropTarget extends ComObject {
  #callbacks;
  constructor({enter,over,leave,drop}){super([IID.IDropTarget]);if([enter,over,leave,drop].some(f=>typeof f!=='function'))throw new ComError(HRESULT.E_INVALIDARG,'All target callbacks are required');this.#callbacks={enter,over,leave,drop};}
  DragEnter(data,keyState,location,allowed){this.assertAlive();return sync(this.#callbacks.enter(data,keyState,location,allowed));}
  DragOver(keyState,location,allowed){this.assertAlive();return sync(this.#callbacks.over(keyState,location,allowed));}
  DragLeave(){this.assertAlive();sync(this.#callbacks.leave());return HRESULT.S_OK;}
  Drop(data,keyState,location,allowed){this.assertAlive();return sync(this.#callbacks.drop(data,keyState,location,allowed));}
}
/** Caller-driven drag loop. DOM/OS event registration is deliberately left to the embedding host. */
export class OleDragSession {
  #data;#source;#target=null;#allowed;#effect=0;#state='active';#busy=false;
  constructor(dataObject,dropSource,allowedEffects=1){
    integer(allowedEffects,1,7);this.#allowed=allowedEffects;this.#data=dataObject.QueryInterface(IID.IDataObject);
    try{this.#source=dropSource.QueryInterface(IID.IDropSource);}catch(error){this.#data.Release();throw error;}
  }
  get state(){return this.#state;}
  get currentEffect(){return this.#effect;}
  #run(fn){if(this.#state!=='active')throw new ComError(HRESULT.CO_E_OBJNOTCONNECTED,'Drag operation finished');if(this.#busy)throw new ComError(HRESULT.E_ABORT,'Reentrant drag operation');this.#busy=true;try{return fn();}catch(error){try{this.#finish('cancelled',true);}catch(cleanup){throw new AggregateError([error,cleanup],'Drag and cleanup failed');}throw error;}finally{this.#busy=false;}}
  #leave(){const target=this.#target;this.#target=null;this.#effect=0;if(target)try{sync(target.DragLeave());}finally{target.Release();}}
  #finish(state,leave){if(this.#state!=='active')return;this.#state=state;try{if(leave)this.#leave();else{const target=this.#target;this.#target=null;target?.Release();}}finally{try{this.#data.Release();}finally{this.#source.Release();}}}
  enter(target,keyState,location){return this.#run(()=>{
    integer(keyState,0,63);location=point(location);this.#leave();const reference=target.QueryInterface(IID.IDropTarget);this.#target=reference;
    this.#effect=effect(sync(reference.DragEnter(this.#data,keyState,location,this.#allowed)),this.#allowed,true);sync(this.#source.GiveFeedback(this.#effect));return this.#effect;
  });}
  leave(){return this.#run(()=>{this.#leave();return HRESULT.S_OK;});}
  update(escape,keyState,location){return this.#run(()=>{
    if(typeof escape!=='boolean')throw new ComError(HRESULT.E_INVALIDARG);integer(keyState,0,63);location=point(location);
    const status=sync(this.#source.QueryContinueDrag(escape,keyState));
    if(status===HRESULT.DRAGDROP_S_CANCEL){this.#finish('cancelled',true);return {hresult:status,effect:0};}
    if(status===HRESULT.DRAGDROP_S_DROP){
      let selected=0;if(this.#target)selected=effect(sync(this.#target.Drop(this.#data,keyState,location,this.#allowed)),this.#allowed);
      this.#effect=selected;this.#finish('dropped',false);return {hresult:status,effect:selected};
    }
    if(status!==HRESULT.S_OK)throw new ComError(status,'Drop source rejected drag');
    this.#effect=this.#target?effect(sync(this.#target.DragOver(keyState,location,this.#allowed)),this.#allowed,true):0;
    sync(this.#source.GiveFeedback(this.#effect));return {hresult:HRESULT.S_OK,effect:this.#effect};
  });}
  cancel(){if(this.#state!=='active')return HRESULT.S_FALSE;return this.#run(()=>{this.#finish('cancelled',true);return HRESULT.DRAGDROP_S_CANCEL;});}
}
