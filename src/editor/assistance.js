import {el,clone,lower} from '../core/core.js';
import {wordAt,maskSource} from './intelligence.js';
import {positionAt,offsetAt,textChange,mapOffset} from './projection.js';
import {moveSourceSelection} from './find-index.js';

/** Side-effect-free debugger hover. No project procedure, property getter or
 * constructor is executed: the IDE supplies the guarded storage inspector. */
export class CodeAssistance {
  constructor(editor,ide,drag) {
    this.editor=editor;this.ide=ide;this.drag=drag;this.serial=0;this.bindings=[];
    for(const pane of editor.panes)this.bind(pane);
    const create=editor.createPane.bind(editor);editor.createPane=()=>{const pane=create();this.bind(pane);return pane;};
    editor.on('change',()=>this.hide());
  }
  listen(target,type,callback,options){target.addEventListener(type,callback,options);this.bindings.push(()=>target.removeEventListener(type,callback,options));}
  bind(pane) {
    this.drag.register(this.editor,pane);
    this.listen(pane.input,'pointermove',event=>{
      if(event.buttons||event.pointerType==='touch'||!this.editor.appearance.autoDataTips||this.ide.runState!=='paused'){this.hide();return;}
      const offset=pane.virtualizer.hit(event.clientX,event.clientY),word=wordAt(this.editor.text,offset);
      const key=this.editor.module?.id+':'+word.start+':'+word.text;
      if(this.hoverKey===key)return;this.hide();this.hoverKey=key;
      this.timer=setTimeout(()=>this.showAt(offset,pane,{x:event.clientX,y:event.clientY}),400);
    });
    for(const type of ['pointerleave','pointerdown','keydown','scroll','blur'])this.listen(pane.input,type,()=>this.hide());
  }
  async showAt(offset,pane=this.editor.activePane,point=null) {
    this.hide();const editor=this.editor,ide=this.ide,workbench=ide.debuggerWindows;
    if(editor.disposed||!editor.appearance.autoDataTips||ide.runState!=='paused'||!workbench)return null;
    const position=positionAt(editor.index,offset),word=wordAt(editor.text,offset),line=editor.index.lines[position.line-1],local=word.start-editor.index.starts[position.line-1];
    if(!word.text||word.text.length>4096||!maskSource(line).slice(Math.max(0,local),Math.max(0,local)+word.text.length).trim())return null;
    const frame=ide.stack[workbench.frameIndex??ide.stack.length-1],procedure=editor.procedureIndex.filter(p=>p.line<=position.line).at(-1);
    if(!frame||lower(frame.module)!==lower(editor.module?.name)||procedure&&lower(procedure.name)!==lower(frame.procedure))return null;
    const serial=++this.serial,text=editor.text,pauseId=workbench.pauseId,frameIndex=workbench.frameIndex;
    let result;
    try {result=await workbench.inspect(word.text);}
    catch(error){result={value:'<'+error.message+'>',type:'Unavailable'};}
    if(editor.disposed||serial!==this.serial||text!==editor.text||ide.runState!=='paused'||workbench.pauseId!==pauseId||workbench.frameIndex!==frameIndex)return null;
    const tip=this.tip=el('div',{class:'source-data-tip',role:'tooltip','aria-label':'Data Tip'},el('strong',{},word.text+' = '),el('span',{},result.value??''),el('span',{class:'data-tip-type'},result.type?'  As '+result.type:''));
    pane.viewport.append(tip);const rect=pane.viewport.getBoundingClientRect();
    const left=point?point.x-rect.left:pane.input.getBoundingClientRect().left-rect.left+3+(position.column-1)*editor.characterWidth-pane.input.scrollLeft;
    const top=point?point.y-rect.top+18:(position.line-pane.range.firstLine)*editor.lineHeight+5-pane.input.scrollTop;
    tip.style.left=Math.max(0,Math.min(rect.width-tip.offsetWidth,left))+'px';tip.style.top=Math.max(0,Math.min(rect.height-tip.offsetHeight,top))+'px';
    return result;
  }
  hide(){this.serial++;clearTimeout(this.timer);this.hoverKey=null;this.tip?.remove();this.tip=null;}
  dispose(){this.hide();for(const unbind of this.bindings)unbind();this.bindings=[];this.drag.remove(this.editor);}
}

/** Pointer and native text DnD share one transaction path. A cross-module move is
 * a single undo entry; no source is removed until the destination is validated. */
export class SourceDragManager {
  constructor(ide){this.ide=ide;this.inputs=new WeakMap();this.current=null;}
  register(editor,pane) {
    this.inputs.set(pane.input,{editor,pane});
    pane.viewport.addEventListener('pointerdown',e=>{if(e.target===pane.input)this.pointerDown(editor,pane,e);},true);
    pane.input.addEventListener('dragstart',e=>{
      if(!editor.appearance.dragText){e.preventDefault();return;}
      const drag=this.makeDrag(editor,pane);if(!drag)return;
      this.current=drag;e.dataTransfer?.setData('text/plain',drag.text.slice(drag.start,drag.end));e.dataTransfer.effectAllowed=editor.readOnly?'copy':'copyMove';
    });
    pane.input.addEventListener('dragover',e=>{if(editor.appearance.dragText&&!editor.readOnly&&!e.dataTransfer?.types.includes('Files')){e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect=e.ctrlKey||e.metaKey?'copy':'move';}});
    pane.input.addEventListener('drop',e=>{
      if(e.dataTransfer?.types.includes('Files'))return;
      e.preventDefault();e.stopPropagation();if(!editor.appearance.dragText||editor.readOnly)return;
      const at=pane.virtualizer.hit(e.clientX,e.clientY),drag=this.current;
      if(drag)this.apply(drag,{editor,pane},at,e.ctrlKey||e.metaKey||drag.editor.readOnly);
      else {const text=e.dataTransfer?.getData('text/plain');if(text){editor.activatePane(pane);editor.replaceGlobal(text.replace(/\r\n?/g,'\n'),at,at);}}
      this.current=null;
    });
    pane.input.addEventListener('dragend',()=>{this.current=null;});
  }
  makeDrag(editor,pane) {
    const selection=editor.selectionBounds(pane);if(selection.start===selection.end)return null;
    return {editor,pane,module:editor.module,project:this.ide.project,text:editor.text,start:selection.start,end:selection.end};
  }
  apply(drag,target,offset,copy=false) {
    const ide=this.ide,source=drag.editor,editor=target.editor;
    if(!editor.appearance.dragText||editor.readOnly||source.disposed||editor.disposed)return false;
    if(drag.project!==ide.project||source.module!==drag.module||source.text!==drag.text||!ide.project.modules.includes(drag.module)||!ide.project.modules.includes(editor.module)){
      ide.status('Text drop cancelled because the source project changed.');return false;
    }
    copy ||= source.readOnly;
    const selected=drag.text.slice(drag.start,drag.end);editor.activatePane(target.pane);
    if(editor===source) {
      const result=moveSourceSelection(source.text,drag.start,drag.end,offset,copy);
      if(result.changed){editor.setValue(result.text);editor.selectGlobal(result.start,result.end);}return result.changed;
    }
    if(!Number.isInteger(offset)||offset<0||offset>editor.text.length)return false;
    const before=clone(ide.project),destination=editor.module,targetText=editor.text;
    if(!copy)drag.module.code=drag.text.slice(0,drag.start)+drag.text.slice(drag.end);
    destination.code=targetText.slice(0,offset)+selected+targetText.slice(offset);
    // Keep definition-return anchors synchronized along with source/bookmarks.
    for(const mark of ide.definitionHistory||[])for(const [module,old] of [[drag.module,drag.text],[destination,targetText]])if(mark.id===module.id&&old!==module.code)mark.offset=mapOffset(textChange(old,module.code),mark.offset);
    ide.lastTyped=0;ide.lastTypingModule=null;
    if(ide.runState==='paused'){ide.pendingEdits=true;ide.editRevision=(ide.editRevision||0)+1;}
    ide.record(before,copy?'Copy source text':'Move source text');
    ide.openDocument(destination.id,'code');editor.activatePane(target.pane);editor.selectGlobal(offset,offset+selected.length);
    ide.status(copy?'Copied source text.':'Moved source text. Undo restores both modules.');return true;
  }
  pointerDown(editor,pane,event) {
    if(event.button!==0||event.shiftKey||event.detail>1||event.pointerType==='touch'||!editor.appearance.dragText)return;
    const drag=this.makeDrag(editor,pane);if(!drag)return;
    const point=pane.virtualizer.hit(event.clientX,event.clientY);if(point<drag.start||point>=drag.end)return;
    // Capture above the textarea/virtualizer: an existing selection is not lost
    // at pointerdown, and a normal click still collapses it on pointerup.
    event.preventDefault();event.stopPropagation();this.cancel?.();this.current=drag;
    const origin={x:event.clientX,y:event.clientY};let moved=false,last=event,target=null,at=null,finished=false;
    const ghost=el('div',{class:'source-drag-ghost','aria-hidden':'true',hidden:true},drag.text.slice(drag.start,drag.end).replace(/\s+/g,' ').slice(0,60));document.body.append(ghost);
    const move=e=>{
      last=e;if(!moved&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)<5)return;
      moved=true;ghost.hidden=false;ghost.style.left=Math.min(innerWidth-ghost.offsetWidth,e.clientX+12)+'px';ghost.style.top=Math.min(innerHeight-ghost.offsetHeight,e.clientY+16)+'px';
      const hit=document.elementFromPoint(e.clientX,e.clientY);target=this.inputs.get(hit)||null;at=null;this.caret?.remove();this.caret=null;
      if(target&&!target.editor.readOnly&&target.editor.appearance.dragText){
        const r=target.pane.input.getBoundingClientRect(),v=target.pane.virtualizer;
        if(e.clientY<r.top+12){if(v.active)v.scrollTo(v.rail.scrollTop-17);else target.pane.input.scrollTop-=17;}
        if(e.clientY>r.bottom-22){if(v.active)v.scrollTo(v.rail.scrollTop+17);else target.pane.input.scrollTop+=17;}
        at=v.hit(e.clientX,e.clientY);const pos=positionAt(target.editor.index,at),caret=this.caret=el('div',{class:'source-drop-caret','aria-hidden':'true'});
        target.pane.viewport.append(caret);caret.style.left=(target.pane.input.getBoundingClientRect().left-target.pane.viewport.getBoundingClientRect().left+3+(pos.column-1)*target.editor.characterWidth-target.pane.input.scrollLeft)+'px';caret.style.top=(4+(pos.line-1-target.pane.range.firstLine)*target.editor.lineHeight-target.pane.input.scrollTop)+'px';caret.style.height=target.editor.lineHeight+'px';
      }else if(hit?.matches('input.immediate-input,.watch-entry input'))target={expressionInput:hit};
      ghost.dataset.valid=String(!!target);ghost.dataset.copy=String(e.ctrlKey||e.metaKey||editor.readOnly||!!target?.expressionInput);
    };
    const finish=e=>{
      if(finished)return;finished=true;cleanup();
      if(e?.type==='pointerup'){
        if(!moved){editor.activatePane(pane);editor.selectGlobal(point);}
        else if(target?.editor&&at!==null)this.apply(drag,target,at,e.ctrlKey||e.metaKey||editor.readOnly);
        else if(target?.expressionInput){const input=target.expressionInput;input.focus();input.setRangeText(drag.text.slice(drag.start,drag.end),input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input',{bubbles:true}));this.ide.status('Expression copied. Press Enter to evaluate or add it.');}
      }
    };
    const key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();finish(e);}};
    const timer=setInterval(()=>{if(moved)move(last);},65);
    const cleanup=()=>{clearInterval(timer);window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',finish,true);window.removeEventListener('pointercancel',finish,true);window.removeEventListener('keydown',key,true);window.removeEventListener('blur',finish);ghost.remove();this.caret?.remove();this.caret=null;this.current=null;this.cancel=null;};
    this.cancel=()=>finish(null);window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',finish,true);window.addEventListener('pointercancel',finish,true);window.addEventListener('keydown',key,true);window.addEventListener('blur',finish);
  }
  remove(editor){if(this.current?.editor===editor){this.cancel?.();this.current=null;}}
}
