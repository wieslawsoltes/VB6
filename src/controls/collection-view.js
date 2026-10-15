import {el,lower} from '../core/core.js';
import {Cell} from '../runtime/values.js';
import {acceptsInput,inputScaleFactor} from './input.js';
import {VBError} from '../language/lexer.js';

export function text(node,value) {value=String(value??'');if(node.textContent!==value)node.textContent=value;}
export function attr(node,key,value) {if(value===null||value===undefined){if(node.hasAttribute(key))node.removeAttribute(key);}else if(node.getAttribute(key)!==String(value))node.setAttribute(key,String(value));}
export function style(node,values) {for(const [key,value]of Object.entries(values))if(node.style[key]!==value)node.style[key]=value;}
export function reconcile(parent,nodes) {let next=parent.firstChild;for(const node of nodes){if(node!==next)parent.insertBefore(node,next);next=node.nextSibling;}while(next){const old=next;next=next.nextSibling;old.remove();}}
export function scale(control,vertical=false) {return inputScaleFactor(control.form?.props.ScaleMode??1,vertical);}
export function clientPoint(control,x,y,viewport=control.viewport) {
  x=Number(x);y=Number(y);if(!Number.isFinite(x)||!Number.isFinite(y))throw new VBError('Invalid coordinates',380);
  const outer=control.node.getBoundingClientRect(),inner=viewport.getBoundingClientRect(),sx=control.node.offsetWidth?outer.width/control.node.offsetWidth:1,sy=control.node.offsetHeight?outer.height/control.node.offsetHeight:1;
  x=x/scale(control)-(inner.left-outer.left)/(sx||1)-viewport.clientLeft;
  y=y/scale(control,true)-(inner.top-outer.top)/(sy||1)-viewport.clientTop;
  return x<0||y<0||x>=viewport.clientWidth||y>=viewport.clientHeight?null:{x:x+viewport.scrollLeft,y:y+viewport.scrollTop};
}
export function focusViewport(control) {
  attr(control.node,'tabindex',-1);attr(control.viewport,'tabindex',control.design||!control.props.Enabled||!control.props.TabStop?-1:Number(control.props.TabIndex)||0);
  attr(control.viewport,'aria-label',control.props.ToolTipText||control.model.name);
  attr(control.viewport,'aria-disabled',!control.props.Enabled);
  control.node.classList.toggle('vb-hide-selection',!!control.props.HideSelection);
  control.node.classList.toggle('vb-hottracking',!!control.props.HotTracking);
}
export class ImageBindings {
  constructor(control,safeImage){this.control=control;this.safeImage=safeImage;this.bindings=new Map();}
  resolve(property) {
    const c=this.control,ref=c.props[property],images=typeof ref==='string'?c.form?.controlMap?.get(lower(ref)):ref;
    const previous=this.bindings.get(property);
    if(previous?.images!==images){previous?.release?.();this.bindings.set(property,{images,release:images?.ListImages?.subscribe?.(()=>c.invalidate())});}
    return images?.type==='ImageList'&&!images.disposed?images:null;
  }
  source(property,key) {const images=this.resolve(property);if(!images||key===undefined||key===null||key===''||key===0)return '';try{return this.safeImage(images.ListImages.Item(key).Picture,images.assets);}catch(error){if(error.number===35600||error.number===35601)return '';throw error;}}
  paint(node,property,key,size=16) {const source=this.source(property,key);attr(node,'src',source||null);attr(node,'hidden',source?null:'');style(node,{width:size+'px',height:size+'px'});}
  dispose(){for(const binding of this.bindings.values())binding.release?.();this.bindings.clear();}
}
export class LabelEditor {
  constructor(view){this.view=view;this.epoch=0;this.edit=null;}
  schedule(item,event,label) {
    this.cancelPending();const c=this.view.control;
    if(event.detail!==1||event.ctrlKey||event.metaKey||event.shiftKey||!label.contains(event.target)||this.view.collection.selected!==item||Number(c.props.LabelEdit)===1)return;
    this.timerWindow=c.node.ownerDocument.defaultView;this.timer=this.timerWindow.setTimeout(()=>{this.timer=0;this.start(item).catch(error=>{c.LastControlError=error.message;attr(c.node,'data-error',error.message);});},600);
  }
  cancelPending(){if(this.timer)this.timerWindow.clearTimeout(this.timer);this.timer=0;}
  async start(item,fromCode=false) {
    const view=this.view,c=view.control,collection=view.collection;
    if(!item||!collection.owns(item)||!acceptsInput(c)||!fromCode&&Number(c.props.LabelEdit)===1)return;
    this.cancel();const token=++this.epoch,cancel=new Cell('Integer',0);
    if(fromCode&&c.vm?.stack?.length){const proc=c.instance?.module?.procedures.get(lower(c.model.name+'_BeforeLabelEdit'));if(proc)await c.vm.callProcedure(c.instance,proc,c.props.Index===undefined?[{ref:cancel}]:[Number(c.props.Index),{ref:cancel}],c.vm.currentFrame);}
    else await c.event('BeforeLabelEdit',[{ref:cancel}]);
    if(token!==this.epoch||cancel.get()||!collection.owns(item)||collection.selected!==item||!acceptsInput(c))return;
    view.ensure(item);const row=view.rows.get(item);if(!row)return;
    const input=el('input',{class:'vb-item-label-editor',value:item.Text,'aria-label':'Edit '+item.Text}),old=item.Text;
    this.edit={item,input,old,token,done:false};row.label.replaceChildren(input);input.focus();input.select();
    input.addEventListener('keydown',event=>{
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();this.finish(true);}
      else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.finish(false);}
    });
    input.addEventListener('blur',()=>this.finish(true));
  }
  async finish(commit) {
    const edit=this.edit,view=this.view,c=view.control;if(!edit||edit.done)return;edit.done=true;
    try {
      if(commit&&edit.token===this.epoch&&view.collection.owns(edit.item)&&acceptsInput(c)) {
        const cancel=new Cell('Integer',0),value=new Cell('String',edit.input.value);edit.input.readOnly=true;
        await c.event('AfterLabelEdit',[{ref:cancel},{ref:value}]);
        if(!cancel.get()&&edit.token===this.epoch&&view.collection.owns(edit.item)&&acceptsInput(c)) {
          if(edit.item.Text!==edit.old)throw new VBError('The item changed during label editing',3197);
          edit.item.Text=value.get();
        }
      }
    }catch(error){c.LastControlError=error.message;attr(c.node,'data-error',error.message);}
    finally {if(this.edit===edit){this.edit=null;view.paint();if(acceptsInput(c))c.viewport.focus({preventScroll:true});}}
  }
  cancel(){this.cancelPending();this.epoch++;if(this.edit){const edit=this.edit;this.edit=null;edit.done=true;edit.input.remove();}}
}
export function typeSearch(view,event,items,current) {
  if(event.key.length!==1||event.ctrlKey||event.metaKey||event.altKey||event.key===' ')return -1;
  const now=Date.now(),letter=event.key.toLocaleLowerCase();view.search=now-(view.searchTime||0)>900?letter:(view.search||'')+letter;view.searchTime=now;
  // Repeated characters cycle through matching entries rather than requiring AA.
  const query=[...view.search].every(ch=>ch===letter)?letter:view.search;
  const begin=query.length===1?current+1:Math.max(0,current);
  for(let j=0;j<items.length;j++){const i=(begin+j+items.length)%items.length;if(String(items[i].Text).toLocaleLowerCase().startsWith(query))return i;}return -1;
}
