import {LayoutEngine} from '../../packages/auto-layout/src/index.js';
import {layoutEligible} from './contract.js';
import {measureLayoutControl,hasLayoutMeasurement} from './measurement.js';
const aligns=['start','center','end','stretch','baseline'];
const justifies=['start','center','end','space-between','space-around','space-evenly','stretch'];
const sizeModes=['fixed','hug','fill'];
export const formSize=form=>({width:Number(form.properties.ClientWidth??form.properties.Width??0),height:Number(form.properties.ClientHeight??form.properties.Height??0)});
export function layoutInsets(p,prefix='LayoutPadding'){return ['Top','Right','Bottom','Left'].map(side=>Number(p[prefix+side]??-1)<0?Number(p[prefix]||0):Number(p[prefix+side]));}
export function layoutSettings(p){return {layout:p.LayoutMode??0,padding:layoutInsets(p),gap:Number(p.LayoutGap??0),
  crossGap:p.LayoutCrossGap===undefined||p.LayoutCrossGap===-1?undefined:Number(p.LayoutCrossGap),alignItems:aligns[p.LayoutAlignItems??0],alignContent:justifies[p.LayoutAlignContent??0],
  justify:justifies[p.LayoutJustify??0],widthMode:sizeModes[p.LayoutWidthMode??0],heightMode:sizeModes[p.LayoutHeightMode??0],columns:p.LayoutGridColumns,rows:p.LayoutGridRows};}
export function layoutNode(model,parent=null){const p=model.properties||model.props||{};return {id:model.id,parent,bounds:{x:Number(p.Left||0),y:Number(p.Top||0),width:Number(p.Width||0),height:Number(p.Height||0)},
  anchor:p.Anchor??5,dock:p.Dock??0,...layoutSettings(p),minWidth:Number(p.MinimumWidth??0),minHeight:Number(p.MinimumHeight??0),maxWidth:Number(p.MaximumWidth??0),maxHeight:Number(p.MaximumHeight??0),
  margin:layoutInsets(p,'LayoutMargin'),grow:Number(p.LayoutGrow??0),shrink:Number(p.LayoutShrink??1),basis:p.LayoutBasis===undefined||p.LayoutBasis===-1?undefined:Number(p.LayoutBasis),
  align:aligns[p.LayoutAlign??5],justifySelf:aligns.slice(0,4)[p.LayoutJustifySelf??4],ignoreLayout:!!p.LayoutIgnore,
  gridColumn:Number(p.LayoutColumn??-1)<0?undefined:Number(p.LayoutColumn),gridRow:Number(p.LayoutRow??-1)<0?undefined:Number(p.LayoutRow),columnSpan:p.LayoutColumnSpan??1,rowSpan:p.LayoutRowSpan??1,
  ...measureLayoutControl(model),measure:hasLayoutMeasurement(model)?constraint=>{const measured=measureLayoutControl({...model,properties:{...p,Width:constraint.width,Height:constraint.height}});return {width:measured.preferredWidth,height:measured.preferredHeight,baseline:measured.baseline};}:undefined,visible:p.Visible!==0,participate:layoutEligible(model)};}
export function parentIds(controls){const names=new Map(),ids=new Map(controls.map(c=>[c.id,c])),parents=new Map();for(const c of controls){const k=c.name.toLowerCase();if(!names.has(k))names.set(k,c);}for(const c of controls){let parent=null;if(c.parent){parent=ids.get(c.nativeParentId)||names.get(c.parent.toLowerCase());if(!parent)throw new Error('Missing layout parent: '+c.parent);}parents.set(c.id,parent?.id??null);}return parents;}
export function layoutOptions(form){return {...formSize(form),...layoutSettings(form.properties)};}
export function formNodes(form){const parents=parentIds(form.controls);return form.controls.map(c=>layoutNode(c,parents.get(c.id)));}
export function layoutClient(form,parent,models=new Map(form.controls.map(c=>[c.id,c]))){const p=parent===null?form.properties:models.get(parent).properties,size=parent===null?formSize(form):{width:p.Width,height:p.Height},insets=layoutInsets(p);return {width:Math.max(0,size.width-insets[1]-insets[3]),height:Math.max(0,size.height-insets[0]-insets[2])};}
/** Resolve the Figma Hug/Fill ambiguity in authored state, not by oscillation. */
export function resolveLayoutSizing(form){const parents=parentIds(form.controls),models=new Map(form.controls.map(c=>[c.id,c]));for(const child of form.controls){if(!layoutEligible(child)||child.properties.Visible===0||child.properties.LayoutIgnore||child.properties.Dock)continue;const parent=parents.get(child.id)===null?form:models.get(parents.get(child.id)),p=parent.properties;if(!p.LayoutMode)continue;for(const axis of ['Width','Height'])if(p['Layout'+axis+'Mode']===1&&child.properties['Layout'+axis+'Mode']===2)p['Layout'+axis+'Mode']=0;}return parents;}
/** One designer transaction, relative to an immutable original snapshot. */
export function arrangeFormEdit(before,after,edited=[]){
  const ids=new Set(edited),current=new Map(after.controls.map(c=>[c.id,c])),oldModels=new Map(before.controls.map(c=>[c.id,c]));
  for(const c of after.controls){const old=oldModels.get(c.id);if(old&&ids.has(c.id))for(const axis of ['Width','Height'])if(c.properties[axis]!==old.properties[axis]&&(c.properties['Layout'+axis+'Mode']??0)===(old.properties['Layout'+axis+'Mode']??0))c.properties['Layout'+axis+'Mode']=0;}
  for(const axis of ['Width','Height'])if(after.properties['Client'+axis]!==before.properties['Client'+axis]&&(after.properties['Layout'+axis+'Mode']??0)===(before.properties['Layout'+axis+'Mode']??0))after.properties['Layout'+axis+'Mode']=0;
  const parents=resolveLayoutSizing(after),engine=new LayoutEngine(formNodes(before),layoutOptions(before)),oldIndex=engine.index,oldNodes=engine.nodes,d=engine.data;
  const nodes=after.controls.map(c=>{const parent=parents.get(c.id),latest=layoutNode(c,parent),i=oldIndex.get(c.id),old=oldNodes[i];if(!old||old.parent!==parent||ids.has(c.id)){const space=layoutClient(after,parent,current);return {...latest,baselineWidth:space.width,baselineHeight:space.height};}return {...latest,bounds:old.bounds,baselineWidth:d.bw[i],baselineHeight:d.bh[i]};});
  engine.configure({...layoutOptions(after),width:engine.options.width,height:engine.options.height});engine.setNodes(nodes);const size=formSize(after);engine.arrange(size.width,size.height);
  for(const n of nodes){const c=current.get(n.id),b=engine.getBounds(n.id);if(layoutEligible(c))Object.assign(c.properties,{Left:b.x,Top:b.y,Width:b.width,Height:b.height});}
  const root=engine.getRootBounds();for(const axis of ['Width','Height'])if(after.properties['Layout'+axis+'Mode']===1){const extra=Number(after.properties[axis]??after.properties['Client'+axis])-after.properties['Client'+axis];after.properties['Client'+axis]=root[axis.toLowerCase()];after.properties[axis]=root[axis.toLowerCase()]+extra;}
  return engine;
}
