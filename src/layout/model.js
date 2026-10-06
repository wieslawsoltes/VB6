import {LayoutEngine} from '../../packages/auto-layout/src/index.js';
import {layoutEligible} from './contract.js';

export const formSize = form => ({width:Number(form.properties.ClientWidth??form.properties.Width??0),height:Number(form.properties.ClientHeight??form.properties.Height??0)});
export function layoutNode(model,parent=null) {
  const p=model.properties||model.props||{};
  return {id:model.id,parent,bounds:{x:Number(p.Left||0),y:Number(p.Top||0),width:Number(p.Width||0),height:Number(p.Height||0)},
    anchor:p.Anchor??5,dock:p.Dock??0,layout:p.LayoutMode??0,
    minWidth:Number(p.MinimumWidth??0),minHeight:Number(p.MinimumHeight??0),maxWidth:Number(p.MaximumWidth??0),maxHeight:Number(p.MaximumHeight??0),
    padding:Number(p.LayoutPadding??0),margin:Number(p.LayoutMargin??0),gap:Number(p.LayoutGap??0),grow:Number(p.LayoutGrow??0),shrink:Number(p.LayoutShrink??1),
    align:['start','center','end','stretch'][p.LayoutAlign??0],justify:['start','center','end','space-between','space-around','space-evenly'][p.LayoutJustify??0],
    visible:p.Visible!==0,participate:layoutEligible(model)};
}
export function parentIds(controls) {
  const names=new Map(),ids=new Map(controls.map(c=>[c.id,c])),parents=new Map();
  for(const c of controls){const k=c.name.toLowerCase();if(!names.has(k))names.set(k,c);}
  for(const c of controls){let parent=null;if(c.parent){parent=ids.get(c.nativeParentId)||names.get(c.parent.toLowerCase());if(!parent)throw new Error('Missing layout parent: '+c.parent);}
    parents.set(c.id,parent?.id??null);}
  return parents;
}
export function layoutOptions(form) {
  const p=form.properties;return {...formSize(form),padding:Number(p.LayoutPadding??0),layout:p.LayoutMode??0,gap:Number(p.LayoutGap??0),
    justify:['start','center','end','space-between','space-around','space-evenly'][p.LayoutJustify??0]};
}
export function formNodes(form) {
  const parents=parentIds(form.controls);return form.controls.map(c=>layoutNode(c,parents.get(c.id)));
}
/** Apply one designer transaction, always relative to its original snapshot.
 * edited IDs keep the user's new geometry; descendants retain their baselines.
 * Results are written to the model, so undo, save, export and selection agree. */
export function arrangeFormEdit(before,after,edited=[]) {
  const ids=new Set(edited),current=new Map(after.controls.map(c=>[c.id,c]));
  const engine=new LayoutEngine(formNodes(before),layoutOptions(before));
  const oldIndex=engine.index,oldNodes=engine.nodes,d=engine.data,parents=parentIds(after.controls);
  const nodes=after.controls.map(c=>{
    const parent=parents.get(c.id),latest=layoutNode(c,parent),i=oldIndex.get(c.id),old=oldNodes[i];
    if(!old||old.parent!==parent||ids.has(c.id)){
      const p=parent===null?after.properties:current.get(parent).properties,space=parent===null?formSize(after):{width:p.Width,height:p.Height};
      return {...latest,baselineWidth:Math.max(0,space.width-2*Number(p.LayoutPadding||0)),baselineHeight:Math.max(0,space.height-2*Number(p.LayoutPadding||0))};
    }
    return {...latest,bounds:old.bounds,baselineWidth:d.bw[i],baselineHeight:d.bh[i]};
  });
  engine.options={...engine.options,...layoutOptions(after),padding:[0,0,0,0].map(()=>Number(after.properties.LayoutPadding||0)),width:engine.options.width,height:engine.options.height};
  engine.setNodes(nodes);const size=formSize(after);engine.arrange(size.width,size.height);
  for(const n of nodes){const c=current.get(n.id),b=engine.getBounds(n.id);if(!layoutEligible(c))continue;Object.assign(c.properties,{Left:b.x,Top:b.y,Width:b.width,Height:b.height});}
  return engine;
}
