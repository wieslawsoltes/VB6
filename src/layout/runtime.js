import {LayoutEngine} from '../../packages/auto-layout/src/index.js';
import {layoutNode,parentIds,layoutOptions,layoutSettings,layoutInsets} from './model.js';
import {layoutEligible,layoutContainer} from './contract.js';
import {clearLayoutMeasurements} from './measurement.js';
const geometry=new Set(['Left','Top','Width','Height','Anchor','Dock']);
const typography=/^(Text|Caption|FontName|FontSize|FontBold|FontItalic|MultiLine|BorderStyle|Appearance)$/;

/** Applies only the opted-in container's authoring preferences; it never changes
 * the application's colors, fonts, or IDE theme. */
export function applyLayoutAppearance(view){
  if(!view?.anchoring)return;
  if(layoutContainer(view.model)&&view.childHost){view.childHost.style.overflow=view.props.LayoutClipContents===0?'visible':'hidden';}

}
/** One compiled tree per form. Geometry is synchronous; DOM painting is batched.
 * Controller-owned wrappers add text measurement without changing classic APIs. */
export class FormLayout {
  constructor(form){
    this.form=form;this.records=new Map();this.views=new Map();this.suspended=0;this.applying=false;this.paint=new Set();this.frame=0;this.wrapped=new Map();
    this.engine=new LayoutEngine([],layoutOptions({properties:form.props}));
    this.fonts=globalThis.document?.fonts;this.fontChanged=()=>{if(!form.disposed){clearLayoutMeasurements();this.rebuild();this.arrange();}};
    this.fonts?.addEventListener?.('loadingdone',this.fontChanged);
    this.rebuild();this.resolveSizing();this.arrange();
  }
  snapshot(control){return {...control.model,properties:control.props};}
  wrap(view){
    if(this.wrapped.has(view))return;
    const set=view.set,refresh=view.refresh,controller=this;
    const wrappedSet=function(key,...args){const out=set.call(this,key,...args);if(typography.test(key))controller.edit(this,key);return out;};
    const wrappedRefresh=function(...args){const out=refresh.apply(this,args);applyLayoutAppearance(this);return out;};
    view.set=wrappedSet;view.refresh=wrappedRefresh;this.wrapped.set(view,{set,refresh,wrappedSet,wrappedRefresh});
  }
  unwrap(view){const w=this.wrapped.get(view);if(!w)return;if(view.set===w.wrappedSet)view.set=w.set;if(view.refresh===w.wrappedRefresh)view.refresh=w.refresh;this.wrapped.delete(view);this.paint.delete(view);}
  client(parent){const pv=parent===null?this.form:this.views.get(parent),p=pv?.props||{},insets=layoutInsets(p);return {width:Math.max(0,Number(parent===null?p.ClientWidth??p.Width:p.Width)-insets[1]-insets[3]),height:Math.max(0,Number(parent===null?p.ClientHeight??p.Height:p.Height)-insets[0]-insets[2])};}
  rebuild(edited=null,key=''){
    const form=this.form,models=form.controls.map(c=>this.snapshot(c)),parents=parentIds(models),fresh=new Map(),nodes=[];
    this.views=new Map(form.controls.map(c=>[c.model.id,c]));for(const view of this.wrapped.keys())if(view!==form&&this.views.get(view.model.id)!==view)this.unwrap(view);this.wrap(form);
    for(const control of form.controls){
      this.wrap(control);const m=this.snapshot(control),parent=parents.get(m.id),old=this.records.get(m.id),next=layoutNode(m,parent);
      if(old)Object.assign(next,{bounds:old.bounds,baselineWidth:old.baselineWidth,baselineHeight:old.baselineHeight});
      if(!old||old.parent!==parent||edited===control&&geometry.has(key)){next.bounds=layoutNode(m,parent).bounds;const c=this.client(parent);next.baselineWidth=c.width;next.baselineHeight=c.height;}
      fresh.set(m.id,next);nodes.push(next);
    }
    this.engine.configure(layoutSettings(form.props));this.engine.setNodes(nodes);this.records=fresh;
  }
  updateRecord(control,key=''){
    const id=control.model.id,old=this.records.get(id),latest=layoutNode(this.snapshot(control),old.parent),next={...latest,bounds:old.bounds,baselineWidth:old.baselineWidth,baselineHeight:old.baselineHeight};
    if(geometry.has(key)){next.bounds=latest.bounds;const space=this.client(old.parent);next.baselineWidth=space.width;next.baselineHeight=space.height;}
    this.engine.update(id,next);this.records.set(id,next);
  }
  edit(control,key){
    if(this.applying||this.form.disposed)return;
    if(control===this.form)this.engine.configure(layoutSettings(control.props));
    else if(key==='Container'||!this.records.has(control.model.id))this.rebuild(control,key);
    else {
      // Manual dimensions change Hug/Fill to Fixed, but a position-only Move
      // (whose legacy API also reports Width) must not clear either size mode.
      const i=this.engine.index.get(control.model.id),r=this.engine.rects;
      if(['Width','Height'].includes(key))for(const [axis,offset]of [['Width',2],['Height',3]])if(control.props[axis]!==r[i*4+offset])control.props['Layout'+axis+'Mode']=0;
      this.updateRecord(control,key);
    }
    this.resolveSizing();this.arrange();
  }
  resolveSizing(){
    for(const [id,n]of this.records){const child=this.views.get(id),cp=child.props;if(!layoutEligible(child.model)||cp.Visible===0||cp.LayoutIgnore||cp.Dock)continue;
      const parent=n.parent===null?this.form:this.views.get(n.parent),p=parent.props;if(!p.LayoutMode)continue;let changed=false;
      for(const axis of ['Width','Height'])if(p['Layout'+axis+'Mode']===1&&cp['Layout'+axis+'Mode']===2){p['Layout'+axis+'Mode']=0;changed=true;}
      if(changed){if(parent===this.form)this.engine.configure(layoutSettings(p));else this.updateRecord(parent);}
    }
  }
  arrange(){
    if(this.suspended||this.applying||this.form.disposed)return;
    const p=this.form.props;
    // Root geometry can be changed by resize chrome or Move, bypassing set().
    // Only an external dimension change clears a root's Hug mode.
    if(this.lastRoot)for(const [axis,key]of [['Width','width'],['Height','height']])if(p['Layout'+axis+'Mode']===1&&Number(p['Client'+axis]??p[axis])!==this.lastRoot[key]){p['Layout'+axis+'Mode']=0;this.engine.configure(layoutSettings(p));}
    const result=this.engine.arrange(Number(p.ClientWidth??p.Width),Number(p.ClientHeight??p.Height));
    this.applying=true;
    try{
      for(let j=0;j<result.changedCount;j++){const i=result.changed[j],view=this.views.get(this.engine.nodes[i].id);if(!view||!layoutEligible(view.model))continue;const k=i*4,r=result.rects;Object.assign(view.props,{Left:r[k],Top:r[k+1],Width:r[k+2],Height:r[k+3]});this.paint.add(view);}
      this.lastRoot=this.engine.getRootBounds();
      for(const [axis,key]of [['Width','width'],['Height','height']])if(p['Layout'+axis+'Mode']===1&&p['Client'+axis]!==this.lastRoot[key]){p['Client'+axis]=p[axis]=this.lastRoot[key];this.paint.add(this.form);}
      // Sibling paint order belongs to each container, not to the flat model list.
      for(const parent of [this.engine.count,...this.engine.order]){const view=parent===this.engine.count?this.form:this.views.get(this.engine.nodes[parent].id),children=this.engine.children[parent];if(!view)continue;for(let j=0;j<children.length;j++){const child=this.views.get(this.engine.nodes[children[j]].id);if(child?.node)child.node.style.zIndex=String(view.props.LayoutStacking===1?children.length-j:j+1);}applyLayoutAppearance(view);}
    }finally{this.applying=false;}
    if(this.paint.size&&!this.frame)this.frame=requestAnimationFrame(()=>this.flush());
  }
  flush(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;const batch=[...this.paint];this.paint.clear();for(const view of batch)if(!view.disposed)view.refresh();}
  suspend(){this.suspended++;}
  resume(perform=true){if(this.suspended)this.suspended--;if(perform!==false&&perform!==0)this.arrange();}
  perform(){this.engine.dirty=true;this.arrange();}
  dispose(){if(this.frame)cancelAnimationFrame(this.frame);this.fonts?.removeEventListener?.('loadingdone',this.fontChanged);for(const view of this.wrapped.keys())this.unwrap(view);this.frame=0;this.paint.clear();this.records.clear();this.views.clear();}
}
