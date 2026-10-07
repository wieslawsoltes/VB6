import {el} from '../core/core.js';
import {LayoutEngine} from '../../packages/auto-layout/src/index.js';
import {layoutEnabled,layoutContainer} from './contract.js';
import {layoutInsets,formNodes,layoutOptions,layoutSettings,parentIds} from './model.js';
import {selectedRoots,reparentControls,reorderControls,editLayoutProperties,worldBounds,descendantIds} from './authoring.js';
import {GuideIndex,unionBounds,distanceGuides,insertionGuide,gapRegions} from './guides.js';
import {applyLayoutAppearance} from './runtime.js';
const px=n=>n/15+'px';
const active=d=>layoutEnabled(d.project)&&d.module?.form;
const guiRect=(d,c)=>{const r=d.controlRect(c);return r?{id:c.id,x:r.x*15,y:r.y*15,width:r.width*15,height:r.height*15}:null;};
const setBounds=(node,r)=>Object.assign(node.style,{left:px(r.x),top:px(r.y),width:px(Math.max(0,r.width)),height:px(Math.max(0,r.height))});
function drawGuide(layer,g){
  const line=el('div',{class:'auto-guide auto-guide-'+g.kind,'aria-hidden':true});
  Object.assign(line.style,{left:px(Math.min(g.x1,g.x2)),top:px(Math.min(g.y1,g.y2)),width:px(Math.abs(g.x2-g.x1)),height:px(Math.abs(g.y2-g.y1))});
  if(g.x1===g.x2)line.classList.add('vertical');
  if(g.value!==undefined)line.append(el('span',{class:'auto-guide-value'},Math.round(g.value)+' tw'));
  layer.append(line);
}
function paintAppearance(d){
  if(!active(d))return;const parents=parentIds(d.module.form.controls),models=new Map(d.module.form.controls.map(c=>[c.id,c])),counts=new Map();
  for(const p of parents.values())counts.set(p,(counts.get(p)||0)+1);const seen=new Map();
  for(const view of d.formView?.controls||[]){const p=parents.get(view.model.id),parent=p===null?d.module.form:models.get(p),i=(seen.get(p)||0)+1;seen.set(p,i);view.node.style.zIndex=String(parent?.properties.LayoutStacking===1?counts.get(p)-i+1:i);applyLayoutAppearance(view);}
  applyLayoutAppearance(d.formView);
}
/** Installs against public FormDesigner methods. Gating is checked on every
 * action, including stale detached windows and cancelled pointer sessions. */
export function installDesignerLayout(d,ui){
  if(d.autoLayoutTools)return d.autoLayoutTools;
  const state={guides:[],ghost:null,cancel:null,measure:false},original={render:d.render,selection:d.renderSelection,dispose:d.dispose,keydown:d.keydown,emit:d.emit};
  const enabled=()=>!!active(d),editable=()=>enabled()&&ui.ide.runState==='design'&&!d.locked&&!d.root.inert&&!ui.ide.hasUIDialog?.();
  function clear(){state.guides=[];state.ghost=null;state.target=null;d.renderSelection();}
  function overlay(){
    if(!enabled()||!d.overlay)return;
    paintAppearance(d);
    const layer=el('div',{class:'auto-layout-guides','aria-label':'Layout guides'}),selected=d.selected(),form=d.module.form,show=d.project.settings.autoLayoutGuides!==false;
    // Guides belong to the IDE palette even when the previewed app has its own theme.
    const palette=d.root.ownerDocument.defaultView.getComputedStyle(ui.ide.root);
    for(const key of ['--vb-face','--vb-text','--vb-window','--vb-window-text','--vb-shadow','--vb-selection','--vb-selection-text'])layer.style.setProperty(key,palette.getPropertyValue(key));
    d.overlay.append(layer);
    if(show){
      const parents=parentIds(form.controls),target=selected.length===1&&layoutContainer(selected[0])?selected[0]:!selected.length?form:null;
      if(target&&target.properties.LayoutMode){
        const parentId=target===form?null:target.id,rect=target===form?{x:0,y:0,width:form.properties.ClientWidth,height:form.properties.ClientHeight}:guiRect(d,target);
        if(rect){
          const children=form.controls.filter(c=>parents.get(c.id)===parentId&&c.properties.Visible!==0&&!c.properties.LayoutIgnore&&!c.properties.Dock),rects=children.map(c=>guiRect(d,c)).filter(Boolean),insets=layoutInsets(target.properties);
          for(const [side,index,area]of [['Top',0,{x:rect.x,y:rect.y,width:rect.width,height:Math.max(30,insets[0])}],['Right',1,{x:rect.x+rect.width-Math.max(30,insets[1]),y:rect.y,width:Math.max(30,insets[1]),height:rect.height}],['Bottom',2,{x:rect.x,y:rect.y+rect.height-Math.max(30,insets[2]),width:rect.width,height:Math.max(30,insets[2])}],['Left',3,{x:rect.x,y:rect.y,width:Math.max(30,insets[3]),height:rect.height}]]){
            const handle=el('div',{class:'auto-space-handle auto-padding-'+side.toLowerCase(),role:'slider',tabindex:editable()?0:-1,'aria-label':side+' layout padding','aria-valuenow':insets[index],'aria-valuemin':0,'aria-valuemax':300000,'data-layout-space':'LayoutPadding'+side,'data-layout-target':parentId??'','data-axis':['Left','Right'].includes(side)?'x':'y','data-sign':['Right','Bottom'].includes(side)?-1:1,title:side+' padding: '+insets[index]+' twips. Drag or use arrows; Alt changes all sides.'});setBounds(handle,area);layer.append(handle);
          }
          if(target.properties.LayoutMode!==5)for(const gap of gapRegions(rects,target.properties.LayoutMode)){
            const handle=el('div',{class:'auto-space-handle auto-gap-handle',role:'slider',tabindex:editable()?0:-1,'aria-label':'Layout spacing','aria-valuenow':Math.round(gap.value),'aria-valuemin':-300000,'aria-valuemax':300000,'data-layout-value':target.properties.LayoutGap??0,'data-layout-space':'LayoutGap','data-layout-target':parentId??'','data-axis':gap.axis,'data-sign':1,title:'Spacing: '+Math.round(gap.value)+' twips. Drag to change.'});setBounds(handle,gap);handle.append(el('span',{},Math.round(gap.value)));layer.append(handle);
          }
          if(target.properties.LayoutMode===5)for(const r of rects){const cell=el('div',{class:'auto-grid-cell'});setBounds(cell,r);layer.append(cell);}
        }
      }
      if(selected.length){const box=unionBounds(selected.map(c=>guiRect(d,c)).filter(Boolean));if(box){const label=el('span',{class:'auto-selection-size',style:{left:px(box.x+box.width/2),top:px(box.y+box.height+90)}},Math.round(box.width)+' × '+Math.round(box.height)+' tw');layer.append(label);}}
      for(const guide of state.guides)drawGuide(layer,guide);
    }
    if(state.target){const outline=el('div',{class:'auto-drop-container'});setBounds(outline,state.target);layer.append(outline);}
    if(state.ghost){const ghost=el('div',{class:'auto-drag-ghost'});setBounds(ghost,state.ghost);layer.append(ghost);}
  }
  d.renderSelection=function(...args){const result=original.selection.apply(this,args);overlay();return result;};
  d.render=function(...args){state.cancel?.();const result=original.render.apply(this,args);paintAppearance(this);return result;};
  function begin(event,onMove,onCommit,onCancel){
    const root=d.root,win=root.ownerDocument.defaultView,pid=event.pointerId,revision=ui.ide.visualRevision,form=d.module.form;let frame=0,last=null,finished=false;
    const valid=()=>editable()&&ui.ide.visualRevision===revision&&d.module?.form===form;
    const paint=()=>{frame=0;if(last&&valid())try{onMove(last);}catch(error){if(finished){if(d.module?.form===form)onCancel?.();clear();}else cancel();ui.report(error);}};
    const move=e=>{if(e.pointerId!==pid)return;if(!valid()){cancel();return;}last=e;if(!frame)frame=win.requestAnimationFrame(paint);};
    const cleanup=()=>{if(finished)return false;finished=true;if(frame)win.cancelAnimationFrame(frame);root.removeEventListener('pointermove',move);root.removeEventListener('pointerup',up);root.removeEventListener('pointercancel',cancel);root.removeEventListener('lostpointercapture',cancel);win.removeEventListener('keydown',escape,true);win.removeEventListener('blur',cancel);if(root.hasPointerCapture?.(pid))root.releasePointerCapture(pid);state.cancel=null;return true;};
    const cancel=()=>{if(!cleanup())return;if(d.module?.form===form)onCancel?.();clear();};
    const escape=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}};
    const up=e=>{if(e.pointerId!==pid)return;if(!valid()){cancel();return;}last=e;if(frame)win.cancelAnimationFrame(frame);frame=0;try{onMove(e);if(cleanup()){state.guides=[];state.ghost=null;state.target=null;onCommit();clear();}}catch(error){if(finished){if(d.module?.form===form)onCancel?.();clear();}else cancel();ui.report(error);}};
    state.cancel=cancel;event.preventDefault();event.stopImmediatePropagation();root.focus({preventScroll:true});root.setPointerCapture(pid);
    root.addEventListener('pointermove',move);root.addEventListener('pointerup',up);root.addEventListener('pointercancel',cancel);root.addEventListener('lostpointercapture',cancel);win.addEventListener('keydown',escape,true);win.addEventListener('blur',cancel);
  }
  function spacing(event,handle){
    const id=handle.dataset.layoutTarget||null,ids=id?[id]:[],key=handle.dataset.layoutSpace,axis=handle.dataset.axis,sign=Number(handle.dataset.sign),start=d.position(event),value=Number(handle.dataset.layoutValue??handle.getAttribute('aria-valuenow'));
    const form=d.module.form,target=id?form.controls.find(c=>c.id===id):form,engine=new LayoutEngine(formNodes(form),layoutOptions(form)),views=new Map((d.formView?.controls||[]).map(v=>[v.model.id,v]));let latest=value;
    const changes=()=>{const patch=event.altKey&&key.startsWith('LayoutPadding')?Object.fromEntries(['Top','Right','Bottom','Left'].map(s=>['LayoutPadding'+s,latest])):{[key]:latest};if(key==='LayoutGap')patch.LayoutJustify=0;return patch;};
    const restore=()=>d.refreshControlPositions();
    begin(event,e=>{
      const point=d.position(e);latest=Math.max(key==='LayoutGap'?-300000:0,Math.min(300000,Math.round((value+(point[axis]-start[axis])*15*sign)/(e.shiftKey?120:15))*(e.shiftKey?120:15)));
      const settings=layoutSettings({...target.properties,...changes()});if(id)engine.update(id,settings);else engine.configure(settings);
      const result=engine.arrange(form.properties.ClientWidth,form.properties.ClientHeight);
      for(let j=0;j<result.changedCount;j++){const i=result.changed[j],view=views.get(engine.nodes[i].id);if(view){const b=engine.getBounds(view.model.id);Object.assign(view.props,{Left:b.x,Top:b.y,Width:b.width,Height:b.height});view.refresh();}}
      state.guides=[{kind:'distance',x1:point.x*15,x2:point.x*15+1200,y1:point.y*15,y2:point.y*15,value:latest}];d.renderSelection();
    },()=>{restore();if(latest!==value)ui.commit('Change layout spacing',next=>editLayoutProperties(next,ids,changes()));},restore);
  }
  function pointerDown(event){
    if(!editable()||event.button!==0||d.tool!=='Pointer')return;
    const space=event.target.closest('[data-layout-space]');if(space){spacing(event,space);return;}
    const handle=event.target.closest('[data-handle]'),node=event.target.closest('[data-control-id]'),id=handle?.dataset.id||node?.dataset.controlId,control=d.module.form.controls.find(c=>c.id===id);
    if(!control||event.target.closest('[data-order-id]'))return;
    if((event.ctrlKey||event.metaKey||event.shiftKey)&&!handle){event.preventDefault();event.stopImmediatePropagation();const selected=new Set(d.selection);selected.has(id)?selected.delete(id):selected.add(id);d.select([...selected]);return;}
    if(!d.selection.has(id))d.select([id]);
    const before=d.module.form,items=selectedRoots(before,[...d.selection]);if(!items.length)return;
    const ids=items.map(c=>c.id),chosen=new Set(ids),parents=parentIds(before.controls),parentId=parents.get(items[0].id),models=new Map(before.controls.map(c=>[c.id,c]));
    const parent=parentId===null?before:models.get(parentId),managed=!handle&&parent.properties.LayoutMode&&!control.properties.LayoutIgnore&&!control.properties.Dock;
    const start=d.position(event),rects=items.map(c=>guiRect(d,c)).filter(Boolean),box=unionBounds(rects);if(!box)return;
    const world=worldBounds(before),excluded=descendantIds(before,ids);
    const siblings=before.controls.filter(c=>parents.get(c.id)===parentId&&!excluded.has(c.id)&&c.properties.Visible!==0),parentRect=parentId===null?world.get(null):guiRect(d,parent);
    const guideIndex=new GuideIndex(siblings.map(c=>guiRect(d,c)).filter(Boolean),{parent:parentRect}),engine=managed?null:new LayoutEngine(formNodes(before),layoutOptions(before)),views=new Map(d.formView.controls.map(c=>[c.model.id,c]));
    let moved=false,delta={x:0,y:0},drop=null,resize=handle?.dataset.handle;
    function targetAt(e,point){
      const doc=d.root.ownerDocument,candidates=doc.elementsFromPoint(e.clientX,e.clientY);let target=null;
      for(const element of candidates){if(!d.formView.node.contains(element))continue;const cid=element.closest('[data-control-id]')?.dataset.controlId,m=models.get(cid);if(m&&layoutContainer(m)&&!excluded.has(cid)){target=m;break;}}
      const targetId=target?.id??null,p=target?.properties||before.properties,r=target?guiRect(d,target):world.get(null);
      if(!d.formView.node.contains(doc.elementFromPoint(e.clientX,e.clientY))||!r)return null;
      if(p.LayoutMode){const children=before.controls.filter(c=>parents.get(c.id)===targetId&&!excluded.has(c.id)&&c.properties.Visible!==0&&!c.properties.LayoutIgnore&&!c.properties.Dock),rectangles=children.map(c=>guiRect(d,c)).filter(Boolean),insertion=insertionGuide(rectangles,{x:point.x*15,y:point.y*15},p.LayoutMode,r);return {parentId:targetId,index:insertion.index,guide:insertion.guide,rect:r};}
      return managed||targetId!==parentId?{parentId:targetId,index:Infinity,rect:r}:null;
    }
    begin(event,e=>{
      const now=d.position(e);delta={x:(now.x-start.x)*15,y:(now.y-start.y)*15};if(Math.abs(delta.x)+Math.abs(delta.y)>45)moved=true;if(!moved)return;
      let moving={...box,x:box.x+delta.x,y:box.y+delta.y};state.guides=[];
      if(managed){drop=targetAt(e,now);state.ghost=moving;state.guides=drop?.guide?[drop.guide]:[];state.target=drop?.rect;d.renderSelection();return;}
      if(!e.altKey&&d.project.settings.autoLayoutGuides!==false){const snapped=guideIndex.snap(resize?{...box,x:box.x+(resize.includes('w')?delta.x:0),y:box.y+(resize.includes('n')?delta.y:0),width:Math.max(15,box.width+(resize.includes('e')?delta.x:resize.includes('w')?-delta.x:0)),height:Math.max(15,box.height+(resize.includes('s')?delta.y:resize.includes('n')?-delta.y:0))}:moving,90/d.zoom,{resize,x:!resize||/[ew]/.test(resize),y:!resize||/[ns]/.test(resize),xEdges:resize?[resize.includes('w')?0:2]:[0,1,2],yEdges:resize?[resize.includes('n')?0:2]:[0,1,2]});delta.x+=snapped.dx;delta.y+=snapped.dy;state.guides=snapped.guides;}
      if(!resize){drop=targetAt(e,now);if(drop?.guide){state.guides.push(drop.guide);state.target=drop.rect;}}
      for(const c of items){const p=c.properties;let x=p.Left,y=p.Top,w=p.Width,h=p.Height;
        if(resize){if(resize.includes('e'))w+=delta.x;if(resize.includes('s'))h+=delta.y;if(resize.includes('w')){x+=delta.x;w-=delta.x;}if(resize.includes('n')){y+=delta.y;h-=delta.y;}}
        else{x+=delta.x;y+=delta.y;}
        if(!e.altKey&&!state.guides.length){x=d.snap(x);y=d.snap(y);if(resize){w=d.snap(w);h=d.snap(h);}}
        const patch={bounds:{x,y,width:Math.max(15,w),height:Math.max(15,h)}};if(resize&&/[ew]/.test(resize))patch.widthMode='fixed';if(resize&&/[ns]/.test(resize))patch.heightMode='fixed';engine.update(c.id,patch);
      }
      const result=engine.arrange(before.properties.ClientWidth,before.properties.ClientHeight);for(let j=0;j<result.changedCount;j++){const i=result.changed[j],view=views.get(engine.nodes[i].id);if(view){const b=engine.getBounds(view.model.id);Object.assign(view.props,{Left:b.x,Top:b.y,Width:b.width,Height:b.height});view.refresh();}}
      d.renderSelection();
    },()=>{
      if(!moved)return;
      ui.commit(resize?'Resize auto-layout controls':drop?'Reorder or reparent controls':'Move with smart guides',form=>{
        const targets=form.controls.filter(c=>chosen.has(c.id));
        if(!managed)for(const c of targets){const b=engine.getBounds(c.id);Object.assign(c.properties,{Left:b.x,Top:b.y,Width:b.width,Height:b.height});if(resize&&/[ew]/.test(resize))c.properties.LayoutWidthMode=0;if(resize&&/[ns]/.test(resize))c.properties.LayoutHeightMode=0;}
        if(drop&&!resize){const selection=reparentControls(form,ids,drop.parentId,drop.index,{ignore:event.altKey});if(!models.get(drop.parentId)?.properties.LayoutMode&&drop.parentId!==null||drop.parentId===null&&!form.properties.LayoutMode)for(const c of targets){const old=world.get(c.id),target=world.get(drop.parentId);c.properties.Left=old.x+delta.x-target.x;c.properties.Top=old.y+delta.y-target.y;}return selection;}
        return ids;
      });
    },()=>d.refreshControlPositions());
  }
  function hover(event){if(!editable()||state.cancel||!event.altKey||d.project.settings.autoLayoutGuides===false){if(state.measure&&!state.cancel){state.measure=false;clear();}return;}const selected=d.selected(),target=event.target.closest('[data-control-id]'),other=d.module.form.controls.find(c=>c.id===target?.dataset.controlId);if(selected.length!==1||other?.id===selected[0].id)return;const a=guiRect(d,selected[0]),b=other?guiRect(d,other):{x:0,y:0,width:d.module.form.properties.ClientWidth,height:d.module.form.properties.ClientHeight};if(a&&b){state.measure=true;state.guides=distanceGuides(a,b);d.renderSelection();}}
  function keydown(event){
    if(!editable()||event.target.matches('input,textarea,select'))return;
    const space=event.target.closest('[data-layout-space]');if(space&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();const delta=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1,key=space.dataset.layoutSpace,value=Number(space.dataset.layoutValue??space.getAttribute('aria-valuenow'))+delta*(event.shiftKey?120:15),id=space.dataset.layoutTarget;ui.commit('Change layout spacing',form=>editLayoutProperties(form,id?[id]:[],{[key]:Math.max(key==='LayoutGap'?-300000:0,value)}));return;}
    if(event.shiftKey&&event.key.toLowerCase()==='a'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();event.stopImmediatePropagation();ui.command(event.altKey?'autoLayoutRemove':'autoLayoutAdd');return;}
    if(!event.shiftKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&d.selection.size){const parents=parentIds(d.module.form.controls),c=d.selected()[0],pid=parents.get(c.id),parent=pid===null?d.module.form:d.module.form.controls.find(c=>c.id===pid);if(parent.properties.LayoutMode&&!c.properties.LayoutIgnore&&!c.properties.Dock){event.preventDefault();event.stopImmediatePropagation();ui.commit('Reorder auto-layout controls',form=>reorderControls(form,[...d.selection],['ArrowLeft','ArrowUp'].includes(event.key)?-1:1));}}
  }
  const keyup=e=>{if(e.key==='Alt'&&state.measure){state.measure=false;clear();}};
  d.root.addEventListener('pointerdown',pointerDown,true);d.root.addEventListener('pointermove',hover);d.root.addEventListener('keydown',keydown,true);d.root.addEventListener('keyup',keyup);
  d.dispose=function(...args){state.cancel?.();this.root.removeEventListener('pointerdown',pointerDown,true);this.root.removeEventListener('pointermove',hover);this.root.removeEventListener('keydown',keydown,true);this.root.removeEventListener('keyup',keyup);return original.dispose.apply(this,args);};
  d.emit=function(name,event){const result=original.emit.call(this,name,event);if(name==='change'&&event?.label==='Add control'&&enabled())this.render();return result;};
  d.autoLayoutTools={state,refresh:()=>d.renderSelection(),cancel:()=>state.cancel?.()};d.renderSelection();return d.autoLayoutTools;
}
