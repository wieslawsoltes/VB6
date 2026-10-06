import {LayoutEngine} from '../../packages/auto-layout/src/index.js';
import {layoutNode,parentIds,layoutOptions} from './model.js';
import {layoutEligible} from './contract.js';

/** One controller and one paint callback per form. Logical geometry is updated
 * synchronously before Resize/user code; only DOM painting is frame-batched. */
export class FormLayout {
  constructor(form) {
    this.form=form;this.records=new Map();this.views=new Map();this.suspended=0;this.applying=false;this.paint=new Set();this.frame=0;
    this.engine=new LayoutEngine([],layoutOptions({properties:form.props}));
    this.rebuild();this.arrange();
  }
  snapshot(control) {return {...control.model,properties:control.props};}
  rebuild(edited=null,key='') {
    const form=this.form,models=form.controls.map(c=>this.snapshot(c)),parents=parentIds(models);
    const fresh=new Map(),views=new Map(),nodes=[],byId=new Map(form.controls.map(c=>[c.model.id,c]));
    for(const control of form.controls) {
      const m=this.snapshot(control),parent=parents.get(m.id),old=this.records.get(m.id),next=layoutNode(m,parent);
      views.set(m.id,control);
      if(old)Object.assign(next,{bounds:old.bounds,baselineWidth:old.baselineWidth,baselineHeight:old.baselineHeight});
      if(!old||old.parent!==parent||edited===control&&['Left','Top','Width','Height','Anchor','Dock'].includes(key)) {
        next.bounds=layoutNode(m,parent).bounds;
        const pv=parent===null?form:byId.get(parent),p=pv?.props||{};
        next.baselineWidth=Math.max(0,Number(parent===null?p.ClientWidth??p.Width:p.Width)-2*Number(p.LayoutPadding||0));
        next.baselineHeight=Math.max(0,Number(parent===null?p.ClientHeight??p.Height:p.Height)-2*Number(p.LayoutPadding||0));
      }
      fresh.set(m.id,next);nodes.push(next);
    }
    const p=form.props;
    Object.assign(this.engine.options,{layout:p.LayoutMode??0,gap:p.LayoutGap??0,padding:[0,0,0,0].map(()=>Number(p.LayoutPadding||0)),justify:p.LayoutJustify??0});
    this.engine.setNodes(nodes);this.records=fresh;this.views=views;
  }
  edit(control,key) {
    if(this.applying||this.form.disposed)return;
    if(control===this.form){const p=control.props;this.engine.configure({layout:p.LayoutMode??0,padding:p.LayoutPadding??0,gap:p.LayoutGap??0,justify:['start','center','end','space-between','space-around','space-evenly'][p.LayoutJustify??0]});}
    else if(key==='Container'||!this.records.has(control.model.id))this.rebuild(control,key);
    else {
      const id=control.model.id,old=this.records.get(id),next={...layoutNode(this.snapshot(control),old.parent),bounds:old.bounds,baselineWidth:old.baselineWidth,baselineHeight:old.baselineHeight};
      if(['Left','Top','Width','Height','Anchor','Dock'].includes(key)){next.bounds=layoutNode(this.snapshot(control),old.parent).bounds;const p=(old.parent===null?this.form:this.views.get(old.parent)).props;next.baselineWidth=Math.max(0,Number(old.parent===null?p.ClientWidth??p.Width:p.Width)-2*Number(p.LayoutPadding||0));next.baselineHeight=Math.max(0,Number(old.parent===null?p.ClientHeight??p.Height:p.Height)-2*Number(p.LayoutPadding||0));}
      this.engine.update(id,next);this.records.set(id,next);
    }
    this.arrange();
  }
  arrange() {
    if(this.suspended||this.applying||this.form.disposed)return;
    const p=this.form.props,result=this.engine.arrange(Number(p.ClientWidth??p.Width),Number(p.ClientHeight??p.Height));
    this.applying=true;
    try {
      for(let j=0;j<result.changedCount;j++) {
        const i=result.changed[j],n=this.engine.nodes[i],view=this.views.get(n.id);if(!view||!layoutEligible(view.model))continue;
        const k=i*4,r=result.rects;Object.assign(view.props,{Left:r[k],Top:r[k+1],Width:r[k+2],Height:r[k+3]});this.paint.add(view);
      }
    } finally {this.applying=false;}
    if(this.paint.size&&!this.frame)this.frame=requestAnimationFrame(()=>this.flush());
  }
  flush() {if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;for(const view of this.paint)if(!view.disposed)view.refresh();this.paint.clear();}
  suspend() {this.suspended++;}
  resume(perform=true) {if(this.suspended)this.suspended--;if(perform!==false&&perform!==0)this.arrange();}
  perform() {this.engine.dirty=true;this.arrange();}
  dispose() {if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.paint.clear();this.records.clear();this.views.clear();}
}
