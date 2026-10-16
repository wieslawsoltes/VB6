import {LayoutEngine} from '../../packages/auto-layout/src/index.js';
import {layoutEnabled,layoutContainer} from './contract.js';
import {formNodes,layoutOptions,layoutSettings,parentIds} from './model.js';
import {selectedRoots,reparentControls,worldBounds,descendantIds} from './authoring.js';
import {GuideIndex,unionBounds,insertionGuide} from './guides.js';
import {resizeGridTrack,moveGridControls,placeGridControls} from './grid-tools.js';
import {paintGridGuides,paintMasonryGuides,gridCellAt} from './grid-guides.js';

const active=d=>layoutEnabled(d.project)&&d.module?.form;
const guiRect=(d,c)=>{const r=d.controlRect(c);return r?{id:c.id,x:r.x*15,y:r.y*15,width:r.width*15,height:r.height*15}:null;};

/** Install the capture-phase pieces before the classic controller, then finish
 * after it has exposed its state and rendering lifecycle. */
export function prepareAdvancedDesignerLayout(d,ui){
  if(d.advancedAutoLayoutTools)return ()=>{};
  const advanced={previewEngine:null,gridForm:null,gridRevision:-1,gridEngine:null,gridSnapshots:new Map(),masonrySnapshots:new Map(),tools:null,disposed:false};
  const enabled=()=>!!active(d),editable=()=>enabled()&&ui.ide.runState==='design'&&!d.locked&&!d.root.inert&&!ui.ide.hasUIDialog?.();
  const state=()=>advanced.tools?.state;
  function invalidate(){advanced.previewEngine=null;advanced.gridForm=null;advanced.gridRevision=-1;advanced.gridEngine=null;advanced.gridSnapshots.clear();advanced.masonrySnapshots.clear();}
  function gridFor(form,parentId){
    if(advanced.previewEngine)return advanced.previewEngine.getGridLayout(parentId);
    if(advanced.gridForm!==form||advanced.gridRevision!==ui.ide.visualRevision){const engine=new LayoutEngine(formNodes(form),layoutOptions(form));engine.arrange();advanced.gridForm=form;advanced.gridRevision=ui.ide.visualRevision;advanced.gridEngine=engine;advanced.gridSnapshots=new Map();advanced.masonrySnapshots=new Map();}
    if(!advanced.gridSnapshots.has(parentId))advanced.gridSnapshots.set(parentId,advanced.gridEngine.getGridLayout(parentId));
    return advanced.gridSnapshots.get(parentId);
  }
  function masonryFor(form,parentId){
    if(advanced.previewEngine)return advanced.previewEngine.getMasonryLayout(parentId);
    gridFor(form,parentId);
    if(!advanced.masonrySnapshots.has(parentId))advanced.masonrySnapshots.set(parentId,advanced.gridEngine.getMasonryLayout(parentId));
    return advanced.masonrySnapshots.get(parentId);
  }
  function paint(){
    if(!enabled()||!d.overlay||d.project.settings.autoLayoutGuides===false)return;
    const layer=d.overlay.querySelector('.auto-layout-guides:last-of-type');if(!layer)return;
    const selected=d.selected(),form=d.module.form,target=selected.length===1&&layoutContainer(selected[0])?selected[0]:!selected.length?form:null;
    if(!target||target.properties.LayoutMode<5)return;
    layer.querySelectorAll('.auto-grid-cell,.auto-gap-handle,[data-layout-track]').forEach(node=>node.remove());
    const parentId=target===form?null:target.id,rect=target===form?{x:0,y:0,width:form.properties.ClientWidth,height:form.properties.ClientHeight}:guiRect(d,target);if(!rect)return;
    if(target.properties.LayoutMode===5){const grid=gridFor(form,parentId);if(grid)paintGridGuides(d,layer,rect,grid,parentId,editable());}
    else {const masonry=masonryFor(form,parentId);if(masonry)paintMasonryGuides(d,layer,rect,masonry,parentId,editable());}
  }
  function begin(event,onMove,onCommit,onCancel){
    const root=d.root,win=root.ownerDocument.defaultView,pid=event.pointerId,revision=ui.ide.visualRevision,form=d.module.form;let frame=0,last=null,finished=false;
    const valid=()=>editable()&&ui.ide.visualRevision===revision&&d.module?.form===form;
    const clear=()=>{const s=state();if(s){s.guides=[];s.ghost=null;s.target=null;s.cancel=null;}advanced.previewEngine=null;d.renderSelection();};
    const run=()=>{frame=0;if(last&&valid())try{onMove(last);}catch(error){cancel();ui.report(error);}};
    const move=e=>{if(e.pointerId!==pid)return;if(!valid()){cancel();return;}last=e;if(!frame)frame=win.requestAnimationFrame(run);};
    const cleanup=()=>{if(finished)return false;finished=true;if(frame)win.cancelAnimationFrame(frame);root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',cancel);root.removeEventListener('lostpointercapture',cancel);win.removeEventListener('keydown',escape,true);win.removeEventListener('blur',cancel);if(root.hasPointerCapture?.(pid))root.releasePointerCapture(pid);if(state())state().cancel=null;return true;};
    const cancel=()=>{if(!cleanup())return;if(d.module?.form===form)onCancel?.();clear();};
    const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}};
    const up=e=>{if(e.pointerId!==pid)return;if(!valid()){cancel();return;}last=e;if(frame)win.cancelAnimationFrame(frame);frame=0;try{onMove(e);if(cleanup()){const s=state();if(s){s.guides=[];s.ghost=null;s.target=null;}onCommit();clear();}}catch(error){if(d.module?.form===form)onCancel?.();clear();ui.report(error);}};
    if(state())state().cancel=cancel;event.preventDefault();event.stopImmediatePropagation();root.focus({preventScroll:true});root.setPointerCapture(pid);
    root.addEventListener('pointermove',move);root.addEventListener('pointerup',up);root.addEventListener('pointercancel',cancel);root.addEventListener('lostpointercapture',cancel);win.addEventListener('keydown',escape,true);win.addEventListener('blur',cancel);
  }
  function applyPreview(engine,views,form){
    const result=engine.arrange(form.properties.ClientWidth,form.properties.ClientHeight);advanced.previewEngine=engine;
    for(let j=0;j<result.changedCount;j++){const i=result.changed[j],view=views.get(engine.nodes[i].id);if(view){const b=engine.getBounds(view.model.id);Object.assign(view.props,{Left:b.x,Top:b.y,Width:b.width,Height:b.height});view.refresh();}}
    d.renderSelection();
  }
  function trackResize(event,handle){
    if(handle.getAttribute('aria-disabled')==='true')return;
    const id=handle.dataset.layoutTarget||null,axis=handle.dataset.layoutTrack,index=Number(handle.dataset.trackIndex),coordinate=handle.dataset.axis,minimum=Number(handle.getAttribute('aria-valuemin')),maximum=Number(handle.getAttribute('aria-valuemax')),start=d.position(event),value=Number(handle.getAttribute('aria-valuenow')),form=d.module.form;
    const draft=structuredClone(form),engine=new LayoutEngine(formNodes(form),layoutOptions(form)),views=new Map((d.formView?.controls||[]).map(v=>[v.model.id,v]));let latest=value;
    const restore=()=>{advanced.previewEngine=null;d.refreshControlPositions();};
    begin(event,e=>{const point=d.position(e),step=e.shiftKey?120:15;latest=Math.max(minimum,Math.min(maximum,Math.round((value+(point[coordinate]-start[coordinate])*15*Number(handle.dataset.sign||1))/step)*step));resizeGridTrack(draft,id,axis,index,latest);const target=id?draft.controls.find(c=>c.id===id):draft,settings=layoutSettings(target.properties);if(id)engine.update(id,settings);else engine.configure(settings);applyPreview(engine,views,form);},()=>{restore();if(latest!==value)ui.commit('Resize grid track',next=>resizeGridTrack(next,id,axis,index,latest));},restore);
  }
  function pointerDown(event){
    if(!editable()||event.button!==0||d.tool!=='Pointer')return;
    const track=event.target.closest('[data-layout-track]');if(track){trackResize(event,track);return;}
    if(event.target.closest('[data-layout-space]'))return;
    const handle=event.target.closest('[data-handle]'),node=event.target.closest('[data-control-id]'),id=handle?.dataset.id||node?.dataset.controlId,control=d.module.form.controls.find(c=>c.id===id);
    if(!control||event.target.closest('[data-order-id]')||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(!d.selection.has(id))d.select([id]);
    const before=d.module.form,items=selectedRoots(before,[...d.selection]);if(!items.length)return;
    const ids=items.map(c=>c.id),chosen=new Set(ids),parents=parentIds(before.controls),parentId=parents.get(items[0].id),models=new Map(before.controls.map(c=>[c.id,c]));
    const parent=parentId===null?before:models.get(parentId),managed=!handle&&parent.properties.LayoutMode&&!control.properties.LayoutIgnore&&!control.properties.Dock;
    // The classic controller remains authoritative for unmanaged resize/move.
    if(!managed)return;
    const start=d.position(event),rects=items.map(c=>guiRect(d,c)).filter(Boolean),box=unionBounds(rects);if(!box)return;
    const world=worldBounds(before),excluded=descendantIds(before,ids),siblings=before.controls.filter(c=>parents.get(c.id)===parentId&&!excluded.has(c.id)&&c.properties.Visible!==0),parentRect=parentId===null?world.get(null):guiRect(d,parent),guideIndex=new GuideIndex(siblings.map(c=>guiRect(d,c)).filter(Boolean),{parent:parentRect});
    let moved=false,delta={x:0,y:0},drop=null;
    function targetAt(e,point){
      const doc=d.root.ownerDocument,candidates=doc.elementsFromPoint(e.clientX,e.clientY);let target=null;
      for(const element of candidates){if(!d.formView.node.contains(element))continue;const cid=element.closest('[data-control-id]')?.dataset.controlId,m=models.get(cid);if(m&&layoutContainer(m)&&!excluded.has(cid)){target=m;break;}}
      const targetId=target?.id??null,p=target?.properties||before.properties,r=target?guiRect(d,target):world.get(null);if(!d.formView.node.contains(doc.elementFromPoint(e.clientX,e.clientY))||!r)return null;
      if(p.LayoutMode===5){const grid=gridFor(before,targetId),cell=grid&&gridCellAt(grid,{x:point.x*15-r.x,y:point.y*15-r.y});if(cell)return {parentId:targetId,index:0,cell,rect:{x:r.x+cell.x,y:r.y+cell.y,width:cell.width,height:cell.height}};}
      if(p.LayoutMode){const children=before.controls.filter(c=>parents.get(c.id)===targetId&&!excluded.has(c.id)&&c.properties.Visible!==0&&!c.properties.LayoutIgnore&&!c.properties.Dock),rectangles=children.map(c=>guiRect(d,c)).filter(Boolean),insertion=insertionGuide(rectangles,{x:point.x*15,y:point.y*15},p.LayoutMode,r);return {parentId:targetId,index:insertion.index,guide:insertion.guide,rect:r};}
      return {parentId:targetId,index:Infinity,rect:r};
    }
    begin(event,e=>{const now=d.position(e);delta={x:(now.x-start.x)*15,y:(now.y-start.y)*15};if(Math.abs(delta.x)+Math.abs(delta.y)>45)moved=true;if(!moved)return;drop=targetAt(e,now);const s=state();if(s){s.ghost={...box,x:box.x+delta.x,y:box.y+delta.y};s.guides=drop?.guide?[drop.guide]:[];s.target=drop?.rect;}d.renderSelection();},()=>{if(!moved)return;ui.commit(drop?'Reorder or reparent controls':'Move auto-layout controls',form=>{if(drop?.cell&&!event.altKey)return placeGridControls(form,ids,drop.parentId,drop.cell.column,drop.cell.row);if(drop)return reparentControls(form,ids,drop.parentId,drop.index,{ignore:event.altKey});return [...chosen];});},()=>d.refreshControlPositions());
  }
  function keydown(event){
    if(!editable()||event.target.matches('input,textarea,select'))return;
    const arrows=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
    const track=event.target.closest('[data-layout-track]');if(track&&arrows.includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(track.getAttribute('aria-disabled')==='true')return;const axis=track.dataset.layoutTrack,index=Number(track.dataset.trackIndex),id=track.dataset.layoutTarget||null,delta=(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)*Number(track.dataset.sign||1),value=Number(track.getAttribute('aria-valuenow'))+delta*(event.shiftKey?120:15);try{ui.commit('Resize grid track',form=>resizeGridTrack(form,id,axis,index,Math.max(Number(track.getAttribute('aria-valuemin')),Math.min(Number(track.getAttribute('aria-valuemax')),value))));d.root.querySelector(`[data-layout-track="${axis}"][data-track-index="${index}"]`)?.focus({preventScroll:true});}catch(error){ui.report(error);}return;}
    if(event.shiftKey||!arrows.includes(event.key)||!d.selection.size)return;
    const parents=parentIds(d.module.form.controls),c=d.selected()[0],pid=parents.get(c.id),parent=pid===null?d.module.form:d.module.form.controls.find(item=>item.id===pid);if(parent?.properties.LayoutMode!==5||c.properties.LayoutIgnore||c.properties.Dock)return;
    event.preventDefault();event.stopImmediatePropagation();try{ui.commit('Move grid cells',form=>moveGridControls(form,[...d.selection],(event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0)*(gridFor(d.module.form,pid)?.direction==='rtl'?-1:1),event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0));}catch(error){ui.report(error);}
  }
  d.root.addEventListener('pointerdown',pointerDown,true);d.root.addEventListener('keydown',keydown,true);
  return tools=>{
    advanced.tools=tools;
    const selection=d.renderSelection,dispose=d.dispose;
    d.renderSelection=function(...args){const result=selection.apply(this,args);paint();return result;};
    d.dispose=function(...args){if(advanced.disposed)return;advanced.disposed=true;state()?.cancel?.();this.root.removeEventListener('pointerdown',pointerDown,true);this.root.removeEventListener('keydown',keydown,true);invalidate();return dispose.apply(this,args);};
    d.advancedAutoLayoutTools=advanced;d.renderSelection();
  };
}
