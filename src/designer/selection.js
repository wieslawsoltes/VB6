import {displayScale} from '../rendering/coordinate-space.js';
import {resizeAxes,tabOrderEligible} from './control-model.js';
import {el} from '../core/core.js';
import {anchorGuideNodes} from '../layout/designer-tools.js';
/** Read-before-write selection painting, retaining the existing rounded form
 * handles, fresh outline nodes, zoom coordinates and z/DOM ordering.
 * Design guidance (no external code copied):
 * https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
 */
export function renderDesignerSelection(designer){
 const d=designer;if(!d.overlay||!d.module)return;
 const items=d.selected(),controls=d.module.form.controls,views=new Map(d.formView.controls.map(v=>[v.model.id,v]));
 const root=d.formView.content.getBoundingClientRect(),scale=displayScale(d.formView.content,d.zoom,root),rects=new Map(),nodes=[],handles=[];
 for(const control of d.showTabOrder?controls:items){
  const view=views.get(control.id);if(!view||view.node.closest('[hidden]'))continue;
  const r=view.node.getBoundingClientRect();rects.set(control.id,{x:(r.left-root.left)/scale.x,y:(r.top-root.top)/scale.y,width:r.width/scale.x,height:r.height/scale.y});
 }
 const width=!items.length&&d.formSelection?d.formView.node.getBoundingClientRect().width:0;
 const height=!items.length&&d.formSelection?d.formView.node.getBoundingClientRect().height:0;
 // Guides may measure nested parent containers. Do so before replacing either
 // live overlay, not after inserting selection outlines or tab-order markers.
 const guides=anchorGuideNodes(d,{root,scale,rects,views});
 if(!items.length&&d.formSelection)for(const [edge,x,y]of [['nw',0,0],['n',width/2,0],['ne',width,0],['w',0,height/2],['e',width,height/2],['sw',0,height],['s',width/2,height],['se',width,height]]){
  const enabled=!d.locked&&['e','s','se'].includes(edge);handles.push(el('div',{class:'designer-form-handle'+(enabled?'':' disabled'),title:enabled?'Resize form':'Form sizing handle','data-resize-form':edge,style:{left:Math.round(8+x-3)+'px',top:Math.round(8+y-3)+'px'}}));
 }
 for(const control of items){
  const r=rects.get(control.id);if(!r)continue;
  const box=el('div',{class:'selection-outline'+(control.id===d.primaryId?' primary-selection':''),'data-selection-id':control.id,style:{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'}});
  const axes=resizeAxes(control);
  for(const handle of d.locked?[]:['nw','n','ne','e','se','s','sw','w'].filter(h=>(axes.x||!/[ew]/.test(h))&&(axes.y||!/[ns]/.test(h))))box.append(el('i',{class:'selection-handle '+handle,'data-handle':handle,'data-id':control.id}));nodes.push(box);
 }
 if(d.showTabOrder)for(const control of controls){const r=rects.get(control.id);if(r&&tabOrderEligible(control))nodes.push(el('button',{class:'tab-order-marker','data-order-id':control.id,style:{left:r.x+'px',top:r.y+'px'},text:control.properties.TabIndex||0}));}
 d.formSelection?.replaceChildren(...handles);d.overlay.replaceChildren(...nodes,...guides);
}
