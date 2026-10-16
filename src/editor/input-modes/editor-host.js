import {indexSource,positionAt,offsetAt,sourceRange,textChange} from '../projection.js';

const hooksKey=Symbol.for('vb6.editor.input-host.hooks.v1');
const finite=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value,length)=>Math.max(0,Math.min(length,Math.trunc(finite(value))));
const sameSelection=(a,b)=>a?.anchor===b?.anchor&&a?.head===b?.head;
const copySelections=values=>values.map(({anchor,head})=>({anchor,head}));
const comparePosition=(a,b)=>a.line-b.line||a.ch-b.ch;
const changeEnd=(from,text)=>({line:from.line+text.length-1,ch:(text.length===1?from.ch:0)+text[text.length-1].length});
function transformPosition(position,from,to,text,assoc=1){
  if(comparePosition(position,from)<0||comparePosition(position,from)===0&&assoc<0)return position;
  const end=changeEnd(from,text);
  if(comparePosition(position,to)>0||comparePosition(position,to)===0&&assoc>0)return {line:position.line+end.line-to.line,ch:position.line===to.line?end.ch+position.ch-to.ch:position.ch};
  return assoc<0?{...from}:end;
}

/** A shared notification hook survives the optional Monaco adapter wrapping an
 * editor method. It never retains a disposed host, even when an outer adapter
 * temporarily owns a method and prevents restoring the original immediately. */
function observeEditor(editor,listener){
  let hooks=editor[hooksKey];
  if(!hooks){
    hooks={listeners:new Set(),methods:new Map()};
    Object.defineProperty(editor,hooksKey,{value:hooks,configurable:true});
    for(const name of ['setDocument','setAppearance','setReadOnly','toggleSplit','transferDocument','cursor','dispose']){
      const original=editor[name];if(typeof original!=='function')continue;
      const wrapped=function(...args){
        const before=this.text,result=original.apply(this,args);
        for(const receive of [...hooks.listeners])receive({method:name,oldText:before,newText:this.text,args});
        return result;
      };
      editor[name]=wrapped;hooks.methods.set(name,{original,wrapped});
    }
  }
  for(const [name,{original,wrapped}]of hooks.methods)if(editor[name]===original)editor[name]=wrapped;
  hooks.listeners.add(listener);
  return ()=>{
    hooks.listeners.delete(listener);if(hooks.listeners.size)return;
    let restored=true;
    for(const [name,{original,wrapped}]of hooks.methods){
      if(editor[name]===wrapped)editor[name]=original;
      else if(editor[name]!==original)restored=false;
    }
    // An advanced surface may still hold one of these wrappers as its original.
    // Keep the empty hub available for reuse until that surface is released.
    if(restored&&editor[hooksKey]===hooks)delete editor[hooksKey];
  };
}

/** Full-document UTF-16 editing port shared by classic, XAML and Monaco views.
 * The project/editor remains authoritative. Only secondary native selections
 * and their presentation are retained here; no private document or history is
 * introduced. One host follows split-pane focus and optional surface changes. */
export class EditorHost {
  constructor(editor,ide){
    if(!editor?.root)throw new TypeError('An editor surface is required.');
    this.editor=editor;this.ide=ide;this.root=editor.root;this.xaml=!Array.isArray(editor.panes);
    this.listeners=new Set();this.disposables=[];this.selectionStates=new WeakMap();this.cursorOptions=new Map();this.pending=new Map();this.mode=null;
    const changed=event=>this.queue('change',event),cursor=event=>{if(!this.settingSelection&&!this.applying)this.getSelections();this.queue('cursor',event);this.schedulePaint();};
    if(typeof editor.on==='function'){
      this.disposables.push(editor.on('change',changed),editor.on('cursor',cursor));
    }
    this.disposables.push(observeEditor(editor,event=>{
      if(event.method==='dispose'){this.notify({type:'dispose'});this.dispose();return;}
      if(event.method==='setDocument'&&event.oldText!==event.newText)changed({oldText:event.oldText,newText:event.newText,origin:'external'});
      else if(event.method==='cursor'&&this.xaml)cursor();
      else if(event.method!=='cursor')this.queue('surface');
      this.schedulePaint();
    }));
    const listen=(name,callback,capture=false)=>{this.root.addEventListener?.(name,callback,capture);this.disposables.push(()=>this.root.removeEventListener?.(name,callback,capture));};
    listen('scroll',()=>this.schedulePaint(),true);
    for(const type of ['focusin','focusout','select','pointerup'])listen(type,event=>{if(this.ownsEvent(event)){cursor();this.queue('surface');}},true);
    listen('compositionstart',event=>{if(this.ownsEvent(event)){this.nativeComposition=true;this.schedulePaint();}},true);
    listen('compositionend',event=>{if(this.ownsEvent(event)){this.nativeComposition=false;this.schedulePaint();}},true);
    const view=this.root.ownerDocument?.defaultView;
    if(view?.MutationObserver){
      const observer=new view.MutationObserver(()=>{this.queue('surface');this.schedulePaint();});
      observer.observe(this.root,{childList:true,attributes:true,attributeFilter:['class']});this.disposables.push(()=>observer.disconnect());
    }
    if(view?.ResizeObserver){const observer=new view.ResizeObserver(()=>this.schedulePaint());observer.observe(this.root);this.disposables.push(()=>observer.disconnect());}
    this.getSelections();
  }
  get surface(){const value=this.ide?.advancedEditor?.runtime?.surfaces?.get(this.editor);return value&&!value.disposed?value:null;}
  get view(){return this.surface?.view||null;}
  get language(){return this.surface?.record.language||(this.xaml?'xaml':this.editor.module?.language||'vb6');}
  get input(){return this.view?.getDomNode?.()?.querySelector?.('textarea.inputarea,.inputarea[contenteditable="true"]')||this.editor.input;}
  get identity(){return this.view||this.editor.activePane||this.editor.input;}
  get composing(){return !!(this.nativeComposition||this.editor.composing||this.surface?.composing);}
  get readOnly(){
    if(this.disposed||this.editor.disposed||this.editor.closed)return true;
    if(this.surface)return this.surface.readOnly();
    if(this.xaml){const id=this.moduleId;return !!this.editor.input.readOnly||!!this.ide&&this.ide.runState!=='design'||!!this.ide?.documents?.designers?.get(id)?.locked;}
    return !!this.editor.readOnly||!!this.editor.input.readOnly||this.ide?.runState==='running';
  }
  get moduleId(){
    if(!this.xaml)return this.editor.module?.id;
    if(this.surface)return this.surface.record.moduleId;
    for(const tool of this.ide?.xaml?.tools?.values?.()||[])if(tool.editor===this.editor)return tool.moduleId;
    return undefined;
  }
  get options(){
    const surface=this.surface,view=surface?.view,model=surface?.record.model,raw=model?.getOptions?.(),tabSize=Math.max(1,finite(raw?.tabSize,this.xaml?2:this.editor.project?.settings?.tabWidth||this.ide?.project?.settings?.tabWidth||4));
    const keys=surface?.monaco?.editor.EditorOption,font=keys&&view?.getOption?.(keys.fontInfo);
    const lineHeight=Math.max(1,finite(keys&&view?.getOption?.(keys.lineHeight),finite(view?.getRawOptions?.().lineHeight,this.editor.lineHeight||17))),charWidth=font?.typicalHalfwidthCharacterWidth||this.editor.characterWidth||lineHeight*.48,viewport=this.viewport;
    return {tabSize,indentUnit:tabSize,indentWithTabs:raw?.insertSpaces===false,lineHeight,charWidth,viewportLines:Math.max(1,Math.floor((viewport?.clientHeight||300)/lineHeight))};
  }
  get viewport(){return this.surface?.views.find(state=>state.view===this.view)?.pane||this.editor.activePane?.viewport||this.editor.viewport;}
  getText(){const record=this.surface?.record;return String(record?(record.lastText??record.model.getValue()):(this.editor.text??''));}
  get index(){const text=this.getText();if(this.editor.index?.text===text)return this.editor.index;if(this.cachedIndex?.text!==text)this.cachedIndex=indexSource(text);return this.cachedIndex;}
  normalizeSelections(selections,length=this.getText().length){
    const values=Array.isArray(selections)&&selections.length?selections:[{anchor:0,head:0}];
    return values.map(value=>({anchor:clamp(value?.anchor,length),head:clamp(value?.head??value?.anchor,length)}));
  }
  primarySelection(){
    const editor=this.editor,view=this.view;
    if(view){const model=this.surface.record.model,s=view.getSelection();return s?{anchor:model.getOffsetAt({lineNumber:s.selectionStartLineNumber,column:s.selectionStartColumn}),head:model.getOffsetAt({lineNumber:s.positionLineNumber,column:s.positionColumn})}:{anchor:0,head:0};}
    if(this.xaml){const input=editor.input,back=input.selectionDirection==='backward';return {anchor:back?input.selectionEnd:input.selectionStart,head:back?input.selectionStart:input.selectionEnd};}
    const pane=editor.activePane,s=editor.selectionBounds(pane),back=pane.virtualizer?.active?pane.virtualizer.direction==='backward':pane.input.selectionDirection==='backward';
    return {anchor:s.anchor??(back?s.end:s.start),head:s.focus??(back?s.start:s.end)};
  }
  getSelections(){
    const attached=this.ide?.advancedEditor?.runtime?.surfaces?.get(this.editor);
    // Disposal/reparenting can synchronously emit blur and cursor events while
    // Monaco's wrappers still own the legacy methods. Keep the last complete
    // selection until the replacement surface is installed.
    if(this.selectionSnapshot&&attached&&(attached.disposed||!attached.view||attached.view.getModel?.()===null))return copySelections(this.selectionSnapshot.selections);
    const surface=this.surface,view=surface?.view,identity=this.identity,text=this.getText();let selections;
    if(view){const model=surface.record.model,values=view.getSelections?.();if(values?.length)selections=values.map(s=>({anchor:model.getOffsetAt({lineNumber:s.selectionStartLineNumber,column:s.selectionStartColumn}),head:model.getOffsetAt({lineNumber:s.positionLineNumber,column:s.positionColumn})}));}
    if(!selections){const primary=this.primarySelection(),state=this.selectionStates.get(identity);selections=state&&state.text===text&&sameSelection(primary,state.selections[0])?copySelections(state.selections):[primary];}
    const previous=this.selectionSnapshot;
    const oldViewExists=surface?surface===previous?.surface&&surface.views.some(state=>state.view===previous.identity):!previous?.surface&&(this.xaml?identity===previous?.identity:this.editor.panes.includes(previous?.identity));
    if(this.mode&&previous&&!oldViewExists&&previous.text===text&&previous.moduleId===this.moduleId&&previous.projectId===this.ide?.project?.id){
      const before=previous.selections[0],after=selections[0];
      // Legacy backend transfers retain only the normalized primary range.
      // Restore direction and block ranges only when that same primary range
      // survived. Ordinary split focus or an explicit navigation stays intact.
      if(Math.min(before.anchor,before.head)===Math.min(after.anchor,after.head)&&Math.max(before.anchor,before.head)===Math.max(after.anchor,after.head)){
        selections=copySelections(previous.selections);this.setSelections(selections,{reveal:false});
      }
    }
    this.rememberSelections(selections,surface,identity,text);return selections;
  }
  rememberSelections(selections,surface=this.surface,identity=this.identity,text=this.getText()){
    this.selectionSnapshot={surface,identity,text,moduleId:this.moduleId,projectId:this.ide?.project?.id,selections:copySelections(selections)};
  }
  setSelections(selections,{reveal=true,focus=false}={}){
    if(this.disposed)return;
    const values=this.normalizeSelections(selections),primary=values[0],surface=this.surface,view=surface?.view;
    this.settingSelection=true;
    try{
      if(view){
        const model=surface.record.model;
        view.setSelections(values.map(({anchor,head})=>{const a=model.getPositionAt(anchor),b=model.getPositionAt(head);return {selectionStartLineNumber:a.lineNumber,selectionStartColumn:a.column,positionLineNumber:b.lineNumber,positionColumn:b.column};}));
        if(reveal)view.revealPositionInCenterIfOutsideViewport?.(model.getPositionAt(primary.head));
      }else if(this.xaml){
        const {input}=this.editor,top=input.scrollTop,left=input.scrollLeft;this.editor.reveal(Math.min(primary.anchor,primary.head),Math.max(primary.anchor,primary.head),false);
        input.setSelectionRange(Math.min(primary.anchor,primary.head),Math.max(primary.anchor,primary.head),primary.head<primary.anchor?'backward':'forward');
        if(!reveal){input.scrollTop=top;input.scrollLeft=left;}
        this.editor.cursor();
      }else{
        const editor=this.editor,pane=editor.activePane,index=this.index,start=Math.min(primary.anchor,primary.head),end=Math.max(primary.anchor,primary.head);
        pane.explicitDeclarations=false;
        // The editable procedure is a projection, never a separate Vim buffer.
        // A point motion changes projections; a spanning selection needs the
        // full module so no endpoint is silently clipped by the native input.
        if(pane.mode==='procedure'){
          const range=sourceRange(index,positionAt(index,primary.head).line,'procedure');
          if(values.some(s=>Math.min(s.anchor,s.head)<range.start||Math.max(s.anchor,s.head)>range.end))pane.mode='module';
        }
        const virtual=pane.virtualizer;
        if(virtual){virtual.direction=primary.head<primary.anchor?'backward':'forward';virtual.focusHint=primary.head;}
        editor.syncPane(pane,start,end);
        if(virtual?.active)virtual.select(primary.anchor,primary.head,{reveal});
        else{
          pane.input.setSelectionRange(start-pane.range.start,end-pane.range.start,primary.head<primary.anchor?'backward':'forward');
          if(reveal){const y=(positionAt(index,primary.head).line-1-pane.range.firstLine)*editor.lineHeight;
            if(y<pane.input.scrollTop)pane.input.scrollTop=y;
            else if(y>pane.input.scrollTop+pane.viewport.clientHeight-editor.lineHeight*2)pane.input.scrollTop=Math.max(0,y-pane.viewport.clientHeight+editor.lineHeight*2);
          }
          editor.cursorChanged();
        }
      }
      this.selectionStates.set(this.identity,{text:this.getText(),selections:values});
      this.rememberSelections(values);
      if(focus)this.focus();
    }finally{this.settingSelection=false;}
    this.queue('cursor');this.schedulePaint();
  }
  /** Commit only the changed span. SourceEditor emits its normal sparse history
   * patch; XAML applies one compiled draft transaction, including designer sync. */
  apply(text,selections,{origin='vim',kind=origin==='typing'?'typing':'command'}={}){
    if(this.readOnly||this.composing)return false;
    const next=String(text),before=this.getText(),values=this.normalizeSelections(selections,next.length);
    this.applying=true;
    try{
      if(before!==next){
        const change=textChange(before,next),typing=kind==='typing';
        if(this.xaml&&this.ide?.xaml?.apply&&this.moduleId!==undefined)this.ide.xaml.apply(this.moduleId,next,{typing});
        else if(this.xaml&&this.surface)this.surface.replace(next.slice(change.start,change.newEnd),change.start,change.oldEnd,kind);
        else if(this.xaml)this.editor.edit([{start:change.start,end:change.oldEnd,text:next.slice(change.start,change.newEnd)}]);
        else this.editor.replaceGlobal(next.slice(change.start,change.newEnd),change.start,change.oldEnd,kind);
      }
      // Rejected/failed edits must never move selections into an unapplied text.
      if(this.getText()!==next)return false;
      this.setSelections(values);
    }finally{this.applying=false;}
    if(before!==next)this.queue('change',{oldText:before,newText:next,origin,kind});
    return true;
  }
  undo(){if(this.readOnly)return false;this.ide?.history?.stopMerging?.();return this.ide?.command?.('undo');}
  redo(){if(this.readOnly)return false;this.ide?.history?.stopMerging?.();return this.ide?.command?.('redo');}
  focus(){if(!this.disposed){if(this.view)this.view.focus();else this.editor.input.focus();}}
  ownsEvent(event){
    const target=event?.target;if(!target||!this.root.contains?.(target))return false;
    const surface=this.surface;
    if(surface)return surface.views.some(state=>state.pane.contains(target)&&target.matches?.('textarea.inputarea,.inputarea[contenteditable="true"]'));
    return this.xaml?target===this.editor.input:this.editor.panes.some(pane=>pane.input===target);
  }
  activateEvent(event){
    if(!this.ownsEvent(event))return false;
    const surface=this.surface;
    if(surface){const state=surface.views.find(value=>value.pane.contains(event.target));if(state){surface.view=state.view;surface.runtime.lastActive=surface;}}
    else if(!this.xaml){const pane=this.editor.panes.find(value=>value.input===event.target);if(pane)this.editor.activatePane(pane);}
    this.schedulePaint();return true;
  }
  subscribe(listener){if(typeof listener!=='function')throw new TypeError('A host listener is required.');if(this.disposed)return()=>{};this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  notify(event){for(const listener of [...this.listeners])listener(event);}
  queue(type,event={}){
    if(this.disposed||this.applying&&type==='change')return;
    this.pending.set(type,{...event,type});if(this.notificationPending)return;this.notificationPending=true;
    queueMicrotask(()=>{this.notificationPending=false;if(this.disposed)return;const events=[...this.pending.values()];this.pending.clear();for(const value of events)this.notify(value);});
  }
  setMode(state){this.mode=state?.mode?{...state}:null;this.updateCursorOptions();this.schedulePaint();}
  updateCursorOptions(){
    if(!this.xaml){
      if(this.mode){if(!this.overwriteState)this.overwriteState={value:this.editor.overwrite};if(this.editor.overwrite){this.editor.overwrite=false;this.root.classList?.toggle('overwrite-mode',false);}}
      else if(this.overwriteState){this.editor.overwrite=this.overwriteState.value;this.root.classList?.toggle('overwrite-mode',!!this.editor.overwrite);this.overwriteState=null;}
    }
    const surface=this.surface,views=new Set(surface?.views.map(state=>state.view)||[]);
    for(const [view,saved]of this.cursorOptions)if(!views.has(view)||!this.mode){try{view.updateOptions(saved);}catch{}this.cursorOptions.delete(view);}
    if(!this.mode){for(const input of this.xaml?[this.editor.input]:this.editor.panes.map(pane=>pane.input))if(input?.dataset)delete input.dataset.vimMode;return;}
    for(const view of views){
      if(!this.cursorOptions.has(view)){const raw=view.getRawOptions?.()||{};this.cursorOptions.set(view,{cursorStyle:raw.cursorStyle??'line',cursorBlinking:raw.cursorBlinking??'blink'});}
      const style=this.mode.mode==='insert'?'line':this.mode.mode==='replace'?'underline':'block';
      const blinking=this.mode.mode==='insert'?'blink':'solid',raw=view.getRawOptions?.();
      if(raw?.cursorStyle!==style||raw?.cursorBlinking!==blinking)view.updateOptions({cursorStyle:style,cursorBlinking:blinking});
    }
    for(const input of this.xaml?[this.editor.input]:this.editor.panes.map(pane=>pane.input))if(input?.dataset)input.dataset.vimMode=this.mode.mode;
  }
  getScrollInfo(){
    const view=this.view,input=this.editor.input,viewport=this.viewport,pane=this.editor.activePane,virtual=pane?.virtualizer;
    if(view)return {left:view.getScrollLeft?.()||0,top:view.getScrollTop?.()||0,width:view.getScrollWidth?.()||0,height:view.getScrollHeight?.()||0,clientWidth:viewport?.clientWidth||0,clientHeight:viewport?.clientHeight||0};
    const origin=(virtual?.active?virtual.full.firstLine:pane?.range.firstLine||0)*this.options.lineHeight;
    return {left:input.scrollLeft||0,top:origin+(virtual?.active?virtual.rail.scrollTop:input.scrollTop)||0,
      width:input.scrollWidth||viewport?.clientWidth||0,height:Math.max(input.scrollHeight||0,this.index.lines.length*this.options.lineHeight+this.padding().top*2),
      clientWidth:viewport?.clientWidth||0,clientHeight:viewport?.clientHeight||0};
  }
  scrollTo(left,top){
    if(this.view){const position={};if(left!=null)position.scrollLeft=finite(left);if(top!=null)position.scrollTop=finite(top);this.view.setScrollPosition(position);}
    else {
      const pane=this.editor.activePane,{lineHeight}=this.options;
      if(top!=null){
        top=Math.max(0,finite(top));
        if(pane?.mode==='procedure'){
          const range=pane.virtualizer?.full||pane.range,origin=range.firstLine*lineHeight;
          const height=(positionAt(this.index,range.end).line-range.firstLine)*lineHeight+this.padding().top*2;
          // Vim scroll positions belong to the full document. If scrolling
          // leaves a procedure, expose the module without moving its selection.
          if(top<origin||top>origin+Math.max(0,height-(this.viewport?.clientHeight||0))){const selections=this.getSelections();pane.mode='module';pane.explicitDeclarations=false;this.setSelections(selections,{reveal:false});}
        }
        const virtual=pane?.virtualizer,origin=(virtual?.active?virtual.full.firstLine:pane?.range.firstLine||0)*lineHeight;
        if(virtual?.active)virtual.scrollTo(top-origin);else this.editor.input.scrollTop=top-origin;
      }
      if(left!=null)this.editor.input.scrollLeft=finite(left);
      this.editor.schedulePaint?.();
    }
    this.schedulePaint();
  }
  scrollIntoView(value,margin=0){
    const offset=clamp(typeof value==='object'?value.to??value.from:value,this.getText().length);
    if(this.view)this.view.revealPositionInCenterIfOutsideViewport(this.surface.record.model.getPositionAt(offset));
    else {const at=this.charCoords(offset,'local'),info=this.getScrollInfo();
      if(at.top<info.top+margin)this.scrollTo(null,Math.max(0,at.top-margin));
      else if(at.bottom>info.top+info.clientHeight-margin)this.scrollTo(null,Math.max(0,at.bottom-info.clientHeight+margin));
    }
  }
  /** Ask the displayed Monaco layout for a motion without changing the Vim
   * buffer. The native command handles wrapping, tabs, injected text and folded
   * regions. Its temporary cursor never reaches the canonical source editor. */
  findPosV(offset,amount,unit='line',goalColumn,context={}){
    const surface=this.surface,view=surface?.view,model=surface?.record.model;
    if(!view?.trigger||!view.getPosition||this.disposed||this.composing)return undefined;
    if(context.text!==undefined&&context.text!==this.getText())return this.findStagedPosV(offset,amount,unit,goalColumn,context);
    const count=Math.abs(Math.trunc(finite(amount)))*(unit==='page'?Math.max(1,this.options.viewportLines-2):1);
    offset=clamp(offset,this.getText().length);if(!count)return {offset,hitSide:false};
    const selections=view.getSelections?.();if(!selections?.length)return undefined;
    const saved=selections.map(s=>({selectionStartLineNumber:s.selectionStartLineNumber,selectionStartColumn:s.selectionStartColumn,positionLineNumber:s.positionLineNumber,positionColumn:s.positionColumn}));
    const scroll={scrollTop:view.getScrollTop?.()||0,scrollLeft:view.getScrollLeft?.()||0},setting=this.settingSelection,sync=surface.syncCursor;
    const immediate=surface.monaco?.editor.ScrollType?.Immediate,start=model.getPositionAt(offset),top=p=>view.getTopForPosition?.(p.lineNumber,p.column)??view.getTopForLineNumber?.(p.lineNumber),fromTop=top(start);
    const move=args=>view.trigger('vim-motion','cursorMove',{select:false,noHistory:true,...args});
    this.settingSelection=true;surface.syncCursor=true;
    try{
      view.setSelections([{selectionStartLineNumber:start.lineNumber,selectionStartColumn:start.column,positionLineNumber:start.lineNumber,positionColumn:start.column}],'api');
      // A row's first column has an unambiguous wrap affinity. Move that point
      // first, then hit-test the saved pixel goal on the destination row; this
      // retains a long goal column while crossing short continuation rows.
      const pixelGoal=!context.logical&&Number.isFinite(goalColumn)&&view.getTargetAtClientPoint;
      if(pixelGoal)move({to:'wrappedLineStart'});
      move({to:amount<0?'up':'down',by:context.logical?'foldedLine':'wrappedLine',value:Math.min(1e9,count)});
      let position=view.getPosition();if(!position)return undefined;
      const toTop=top(position),hitSide=fromTop!==undefined&&toTop===fromTop;
      if(pixelGoal&&!hitSide){
        view.revealPositionInCenterIfOutsideViewport?.(position);
        const layout=view.getLayoutInfo?.()||{},left=layout.contentLeft||0,width=layout.contentWidth||this.viewport?.clientWidth||400,goal=Math.max(left+1,goalColumn);
        let horizontal=view.getScrollLeft?.()||0;
        if(goal-horizontal<left+1||goal-horizontal>left+width-1){view.setScrollPosition?.({scrollLeft:Math.max(0,goal-left-width/2)},immediate);horizontal=view.getScrollLeft?.()||0;}
        // Hit testing requires the destination row to be rendered, including a
        // counted jump outside the original viewport.
        view.render?.();
        const rect=view.getDomNode?.()?.getBoundingClientRect?.(),at=view.getScrolledVisiblePosition?.(position),height=view.getLineHeightForPosition?.(position)||this.options.lineHeight;
        if(rect&&at){
          const target=view.getTargetAtClientPoint(rect.left+Math.max(left+1,Math.min(left+width-1,goal-horizontal)),rect.top+at.top+height/2)?.position;
          if(target){
            const targetTop=top(target);
            if(targetTop===undefined||toTop===undefined||targetTop===toTop)position=target;
            else if(target.lineNumber===position.lineNumber&&targetTop>toTop){
              // A soft-wrap boundary is both the preceding row's end and the
              // next row's start. Keep a normal-mode motion on this row.
              let end=model.getOffsetAt(target),text=this.getText();
              if(end>0){end--;const code=text.charCodeAt(end);if(code>=0xdc00&&code<=0xdfff&&end>0)end--;const previous=model.getPositionAt(end);if(top(previous)===toTop)position=previous;}
            }
          }
        }
      }
      return {offset:model.getOffsetAt(position),hitSide};
    }finally{
      try{view.setSelections(saved,'api');view.setScrollPosition?.(scroll,immediate);}
      finally{surface.syncCursor=sync;this.settingSelection=setting;}
    }
  }
  stagedLayout(context){
    const surface=this.surface,create=surface?.runtime.assets?.createVimLineLayout;
    if(!create||!context?.getLine||!context.positionAt||!context.offsetAt||context.text===this.getText())return null;
    const operation=context.operation&&typeof context.operation==='object'?context.operation:null;
    this.stagedLayouts??=new WeakMap();let state=operation&&this.stagedLayouts.get(operation);
    if(!state||state.view!==surface.view){
      const model=surface.record.model,ranges=surface.view.saveViewState?.()?.contributionsState?.['editor.contrib.folding']?.collapsedRegions||[];
      state={view:surface.view,layout:create(surface.view),changes:0,folds:ranges.filter(r=>r.isCollapsed!==false&&r.endLineNumber>r.startLineNumber).map(r=>({from:{line:r.startLineNumber-1,ch:0},to:{line:r.endLineNumber-1,ch:Math.max(0,(model.getLineMaxColumn?.(r.endLineNumber)||1)-1)}}))};
      if(operation)this.stagedLayouts.set(operation,state);
    }
    const changes=context.changes||[];
    for(;state.changes<changes.length;state.changes++){
      const change=changes[state.changes];
      for(const fold of state.folds){fold.from=transformPosition(fold.from,change.from,change.to,change.text,1);fold.to=transformPosition(fold.to,change.from,change.to,change.text,-1);}
    }
    const hidden=[];
    for(const fold of [...state.folds].sort((a,b)=>comparePosition(a.from,b.from))){
      const from=fold.from.line+1,to=Math.min(context.lineCount-1,fold.to.line);if(from>to)continue;
      const previous=hidden[hidden.length-1];if(previous&&from<=previous.to+1)previous.to=Math.max(previous.to,to);else hidden.push({from,to});
    }
    return {layout:state.layout,hidden};
  }
  findStagedPosV(offset,amount,unit,goalColumn,context){
    const staged=this.stagedLayout(context);if(!staged)return undefined;
    const count=Math.abs(Math.trunc(finite(amount)))*(unit==='page'?Math.max(1,this.options.viewportLines-2):1),direction=amount<0?-1:1,start=context.positionAt(clamp(offset,context.text.length));
    if(!count)return {offset:context.offsetAt(start.line,start.ch),hitSide:false};
    let line=start.line,remaining=count,projection=staged.layout.line(context.getLine(line)),row=projection.rowAt(start.ch);
    const nextLine=(current,steps)=>{
      let next=current+direction*steps;
      for(const range of direction>0?staged.hidden:[...staged.hidden].reverse()){
        if(direction>0&&range.from>current&&range.from<=next)next+=range.to-range.from+1;
        else if(direction<0&&range.to<current&&range.to>=next)next-=range.to-range.from+1;
      }
      return Math.max(0,Math.min(context.lineCount-1,next));
    };
    if(context.logical){line=nextLine(line,count);return {offset:context.offsetAt(line,Number.isFinite(context.goalCharacter)?context.goalCharacter:start.ch),hitSide:count>0&&line===start.line};}
    const left=this.view.getLayoutInfo?.().contentLeft||0,goal=Number.isFinite(goalColumn)?goalColumn-left:projection.left(start.ch);
    while(remaining>0){
      const available=direction>0?projection.count-1-row:row;
      if(remaining<=available){row+=direction*remaining;remaining=0;break;}
      remaining-=available;const next=nextLine(line,1);if(next===line)break;
      line=next;projection=staged.layout.line(context.getLine(line));row=direction>0?0:projection.count-1;remaining--;
    }
    return {offset:context.offsetAt(line,projection.character(row,goal)),hitSide:remaining>0};
  }
  charCoords(offset,mode='page',context){
    const external=context?.positionAt&&context.text!==this.getText(),position=external?context.positionAt(clamp(offset,context.text.length)):null;
    const p=position?{line:position.line+1,column:position.ch+1}:positionAt(this.index,offset),text=external?context.getLine(position.line):this.index.lines[p.line-1],view=this.view,input=this.editor.input,win=this.root.ownerDocument?.defaultView,rect=(view?.getDomNode?.()||input)?.getBoundingClientRect?.()||{left:0,top:0};
    let left,top,height=this.options.lineHeight,width=this.options.charWidth;
    const staged=external&&this.stagedLayout(context);
    if(view&&staged){
      const projection=staged.layout.line(text);left=(view.getLayoutInfo?.().contentLeft||0)+projection.left(position.ch);
      let base={line:position.line,ch:0};const changes=context.changes||[];
      for(let i=changes.length-1;i>=0;i--){const change=changes[i];base=transformPosition(base,change.from,changeEnd(change.from,change.text),change.removed,1);}
      top=(view.getTopForLineNumber?.(base.line+1)||0)+projection.rowAt(position.ch)*height;
    }else if(view){
      const at=view.getScrolledVisiblePosition?.({lineNumber:p.line,column:p.column}),column=at?0:view.getOffsetForColumn?.(p.line,p.column);
      left=at?at.left+(view.getScrollLeft?.()||0):(view.getLayoutInfo?.().contentLeft||0)+(column>=0?column:this.visualColumn(text,p.column-1)*width);
      top=at?at.top+(view.getScrollTop?.()||0):view.getTopForPosition?.(p.line,p.column)??view.getTopForLineNumber?.(p.line)??(p.line-1)*height;height=at?.height||height;
    }else {const padding=this.padding();left=padding.left+this.visualColumn(text,p.column-1)*width;top=padding.top+(p.line-1)*height;}
    if(mode!=='local'&&mode!=='div'){
      const scroll=this.getScrollInfo();left+=rect.left-scroll.left;top+=rect.top-scroll.top;
      if(mode==='page'){left+=win?.scrollX||0;top+=win?.scrollY||0;}
    }
    return {left,right:left+width,top,bottom:top+height};
  }
  coordsChar(coords,mode='page'){
    const win=this.root.ownerDocument?.defaultView,view=this.view,input=this.editor.input,rect=(view?.getDomNode?.()||input)?.getBoundingClientRect?.()||{left:0,top:0},scroll=this.getScrollInfo();
    let x=finite(coords?.left??coords?.x),y=finite(coords?.top??coords?.y);
    if(mode!=='local'&&mode!=='div'){x-=rect.left-scroll.left+(mode==='page'?win?.scrollX||0:0);y-=rect.top-scroll.top+(mode==='page'?win?.scrollY||0:0);}
    const {lineHeight,charWidth,tabSize}=this.options,padding=view?{left:view.getLayoutInfo?.().contentLeft||0,top:0}:this.padding();
    let line=Math.max(0,Math.min(this.index.lines.length-1,Math.floor((y-padding.top)/lineHeight)));
    if(view){
      // Screen motions request x=0. Target the text lane, including when the
      // editor has line numbers, a glyph margin or horizontal scroll.
      const target=view.getTargetAtClientPoint?.(rect.left+Math.max(padding.left+1,x-scroll.left),rect.top+y-scroll.top);
      if(target?.position)return this.surface.record.model.getOffsetAt(x<=padding.left?{...target.position,column:1}:target.position);
      if(view.getTopForLineNumber){let low=1,high=this.index.lines.length;while(low<high){const mid=Math.ceil((low+high)/2);if(view.getTopForLineNumber(mid)<=y)low=mid;else high=mid-1;}line=low-1;}
    }
    const text=this.index.lines[line],column=Math.max(0,Math.round((x-padding.left)/charWidth));
    let visual=0,index=0;for(const glyph of text){const width=glyph==='\t'?tabSize-visual%tabSize:1;if(visual+width>column)break;visual+=width;index+=glyph.length;}
    return offsetAt(this.index,line+1,index+1);
  }
  padding(){const style=this.root.ownerDocument?.defaultView?.getComputedStyle?.(this.editor.input);return {left:finite(parseFloat(style?.paddingLeft),3),top:finite(parseFloat(style?.paddingTop),4)};}
  visualColumn(text,offset){let column=0;const tabSize=this.options.tabSize;for(const glyph of String(text).slice(0,offset))column+=glyph==='\t'?tabSize-column%tabSize:1;return column;}
  schedulePaint(){
    if(this.disposed)return;
    const win=this.root.ownerDocument?.defaultView;
    if(this.paintFrame!=null&&this.paintWindow!==win){this.paintWindow?.cancelAnimationFrame?.(this.paintFrame);this.paintFrame=null;}
    if(this.paintFrame!=null||!win?.requestAnimationFrame)return;
    this.paintWindow=win;this.paintFrame=win.requestAnimationFrame(()=>{this.paintFrame=null;this.paintSelections();});
  }
  paintSelections(){
    if(this.disposed)return;this.updateCursorOptions();
    const input=this.editor.input,viewport=this.viewport,doc=this.root.ownerDocument;
    if(this.surface||!this.mode||this.composing||!viewport?.getBoundingClientRect||doc?.activeElement!==input){this.overlay?.remove();this.overlay=null;return;}
    if(this.overlay?.parentNode!==viewport){this.overlay?.remove();this.overlay=doc.createElement('div');this.overlay.className='input-mode-overlay';this.overlay.setAttribute('aria-hidden','true');Object.assign(this.overlay.style,{position:'absolute',inset:'0',pointerEvents:'none',overflow:'hidden',zIndex:'4'});viewport.append(this.overlay);}
    const bounds=viewport.getBoundingClientRect(),selections=this.getSelections(),index=this.index,{lineHeight,charWidth}=this.options,first=this.editor.activePane?.range.firstLine||0;
    const visibleFirst=Math.max(first,first+Math.floor((input.scrollTop||0)/lineHeight)-1),visibleLast=Math.min(index.lines.length-1,visibleFirst+Math.ceil((viewport.clientHeight||300)/lineHeight)+2),nodes=[];
    const rectangle=(offset,length,caret=false)=>{const at=this.charCoords(offset,'window'),left=at.left-bounds.left,top=at.top-bounds.top;if(top+lineHeight<0||top>viewport.clientHeight)return;const node=doc.createElement('span');node.className=caret?'input-mode-cursor':'input-mode-selection';Object.assign(node.style,{position:'absolute',left:left+'px',top:top+'px',width:Math.max(caret?charWidth:1,length*charWidth)+'px',height:lineHeight+'px',pointerEvents:'none'});if(caret&&this.mode.mode==='replace'){node.style.top=(top+lineHeight-2)+'px';node.style.height='2px';}nodes.push(node);};
    for(let n=0;n<selections.length&&nodes.length<2048;n++){
      const s=selections[n],start=Math.min(s.anchor,s.head),end=Math.max(s.anchor,s.head);
      if(start===end){if(n>0||this.mode.mode!=='insert')rectangle(s.head,1,true);continue;}
      if(n===0)continue;
      const startLine=Math.max(visibleFirst,positionAt(index,start).line-1),endLine=Math.min(visibleLast,positionAt(index,Math.max(start,end-1)).line-1);
      for(let line=startLine;line<=endLine&&nodes.length<2048;line++){
        const from=Math.max(start,index.starts[line]),to=Math.min(end,index.starts[line]+index.lines[line].length),a=from-index.starts[line],b=to-index.starts[line];
        rectangle(from,this.visualColumn(index.lines[line],b)-this.visualColumn(index.lines[line],a)+(end>to?1:0));
      }
    }
    this.overlay.replaceChildren(...nodes);
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;
    if(this.paintFrame!=null)this.paintWindow?.cancelAnimationFrame?.(this.paintFrame);this.paintFrame=null;
    for(const dispose of this.disposables.splice(0))dispose();
    this.mode=null;this.updateCursorOptions();
    for(const state of this.surface?.views||[])state.presentation?.refresh?.();
    for(const input of this.xaml?[this.editor.input]:this.editor.panes.map(pane=>pane.input))if(input?.dataset)delete input.dataset.vimMode;
    this.overlay?.remove();this.overlay=null;this.selectionSnapshot=null;this.stagedLayouts=null;this.pending.clear();this.listeners.clear();
  }
}

export const createEditorHost=(editor,ide)=>new EditorHost(editor,ide);
