import {chooseSnippet,navigateLanguageLocation} from './navigation.js';
import {fromDiagnostic,fromRange} from './protocol-converters.js';
import {textChange} from '../projection.js';

/** Visible editor over a project-owned model. The classic public adapter and
 * all its existing events remain intact; the hidden textarea is not a second
 * source of truth and there is only one undo/redo history. */
export class AdvancedSurface {
  constructor(runtime,record,legacy) {
    this.runtime=runtime;this.record=record;this.legacy=legacy;this.monaco=runtime.monaco;this.root=legacy.root;this.xaml=record.language==='xaml';this.disposables=[];this.restore=[];
    const doc=this.root.ownerDocument;
    this.host=doc.createElement('div');this.host.className='advanced-editor-surface';this.host.setAttribute('aria-label',this.xaml?'Advanced XAML editor':'Advanced Visual Basic editor');
    if(this.xaml)this.root.insertBefore(this.host,legacy.note);else this.root.append(this.host);
    this.root.classList.add('advanced-editor-active');
    const selection=this.xaml?{start:legacy.input.selectionStart,end:legacy.input.selectionEnd}:legacy.selectionBounds();
    this.createView();this.installAdapter();this.select(selection.start,selection.end,false);this.updateReadOnly();this.decorate();
  }
  wrap(name,handler) {
    const original=this.legacy[name];if(typeof original!=='function')return;
    const wrapped=(...args)=>handler(original.bind(this.legacy),...args);this.legacy[name]=wrapped;
    this.restore.push(()=>{if(this.legacy[name]===wrapped)this.legacy[name]=original;});
  }
  createView() {
    const a=this.runtime.ide.appearance,s=this.runtime.settings;
    this.view=this.monaco.editor.create(this.host,{model:this.record.model,theme:'vb6-advanced',automaticLayout:true,
      minimap:{enabled:s.minimap,renderCharacters:false,showSlider:'mouseover'},stickyScroll:{enabled:s.stickyScroll},wordWrap:s.wordWrap?'on':'off',fontLigatures:s.ligatures,
      fontSize:a.editorSize||13,fontFamily:a.editorFont||'monospace',tabSize:this.runtime.ide.project.settings.tabWidth||4,
      renderWhitespace:s.renderWhitespace,'semanticHighlighting.enabled':s.semanticHighlighting,inlayHints:{enabled:s.inlayHints?'on':'off'},codeLens:s.codeLens,
      glyphMargin:!this.xaml,lineNumbers:'on',folding:true,showFoldingControls:'mouseover',bracketPairColorization:{enabled:true},guides:{bracketPairs:true,indentation:true,highlightActiveIndentation:true},
      linkedEditing:true,selectionHighlight:true,occurrencesHighlight:'singleFile',multiCursorModifier:'alt',smoothScrolling:false,scrollBeyondLastLine:false,
      quickSuggestions:{other:true,comments:false,strings:this.xaml},suggest:{showWords:false},wordBasedSuggestions:'off',parameterHints:{enabled:true},
      accessibilitySupport:'auto',ariaLabel:this.xaml?'XAML source (advanced)':'Visual Basic source (advanced)',contextmenu:true,mouseWheelZoom:true,renderControlCharacters:true,editContext:false,
      unicodeHighlight:{ambiguousCharacters:true,invisibleCharacters:true},padding:{top:5,bottom:5},largeFileOptimizations:true});
    this.viewDisposables=[];
    this.viewDisposables.push(this.view.onDidChangeCursorSelection(()=>this.cursorChanged()));
    this.viewDisposables.push(this.view.onDidFocusEditorText(()=>{
      this.runtime.lastActive=this;
      if(!this.xaml&&this.runtime.ide.activeModule?.id!==this.record.moduleId)this.runtime.ide.openDocument(this.record.moduleId,'code');
      this.cursorChanged();
    }));
    this.viewDisposables.push(this.view.onDidCompositionStart(()=>{this.composing=true;this.compositionBefore=this.record.lastText;}));
    this.viewDisposables.push(this.view.onDidCompositionEnd(()=>{
      this.composing=false;if(this.compositionBefore!==undefined){const before=this.compositionBefore;this.compositionBefore=undefined;try{this.commit(before,this.record.model.getValue(),null);}catch(error){this.runtime.report(error);this.runtime.setText(this.record,before);}}
    }));
    this.viewDisposables.push(this.view.onMouseDown(event=>{
      if(!this.xaml&&event.target.type===this.monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN&&event.target.position){
        const line=event.target.position.lineNumber,eventName=event.event.ctrlKey||event.event.metaKey?'bookmark':'breakpoint';
        this.legacy.emit(eventName,{module:this.legacy.module.name,line});this.decorate();
      }
    }));
    this.viewDisposables.push(this.view.onKeyDown(event=>{
      if(this.composing||event.browserEvent.isComposing)return;
      const e=event.browserEvent,ctrl=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();let command;
      if(ctrl&&['z','y','s'].includes(key))command=key==='s'?'save':key==='y'||e.shiftKey?'redo':'undo';
      else if(e.key==='F5')command=e.shiftKey?'stop':'run';
      else if(e.key==='F9')command=e.shiftKey?'quickWatch':'breakpoint';
      else if(e.key==='F8')command=e.shiftKey?(ctrl?'stepOut':'stepOver'):'stepInto';
      if(command){event.preventDefault();event.stopPropagation();this.runtime.ide.command(command);}
    }));
    // Monaco owns its keyboard commands; the IDE must not interpret F1/Ctrl+F
    // or arrow keys again. Preserve IDE window-management shortcuts explicitly.
    const stop=e=>{if(!(e.ctrlKey||e.metaKey)||!['F4','F6','F10','Tab'].includes(e.key))e.stopPropagation();};
    this.host.addEventListener('keydown',stop);this.viewDisposables.push({dispose:()=>this.host.removeEventListener('keydown',stop)});
    this.decorations=this.view.createDecorationsCollection();
    const K=this.monaco.KeyCode,M=this.monaco.KeyMod;
    const action=(id,label,keys,run)=>{if(!this.view.getAction(id))this.viewDisposables.push(this.view.addAction({id,label,keybindings:keys,contextMenuGroupId:'navigation',contextMenuOrder:1,run}));};
    action('editor.action.revealDefinition','Go to Definition',[K.F12,M.Shift|K.F2],()=>navigateLanguageLocation(this,'textDocument/definition'));
    action('editor.action.peekDefinition','Peek Definition',[M.Alt|K.F12],()=>navigateLanguageLocation(this,'textDocument/definition',{peek:true}));
    action('editor.action.referenceSearch.trigger','Find All References',[M.Shift|K.F12],()=>navigateLanguageLocation(this,'textDocument/references',{peek:true,title:'References'}));
    action('editor.action.goToTypeDefinition','Go to Type Definition',[],()=>navigateLanguageLocation(this,'textDocument/typeDefinition',{title:'Type definition'}));
    action('editor.action.goToImplementation','Go to Implementation',[],()=>navigateLanguageLocation(this,'textDocument/implementation',{title:'Implementation'}));
    action('editor.action.revealDeclaration','Go to Declaration',[],()=>navigateLanguageLocation(this,'textDocument/declaration',{title:'Declaration'}));
    if(!this.xaml)action('vb6.insertSnippet','Insert VB6 Snippet…',[M.chord(M.CtrlCmd|K.KeyK,M.CtrlCmd|K.KeyX)],()=>chooseSnippet(this));
    action('vb6.listMembers','List Members',[M.CtrlCmd|K.KeyJ],()=>this.run('editor.action.triggerSuggest'));
    action('vb6.parameterInfo','Parameter Info',[M.CtrlCmd|M.Shift|K.KeyI],()=>this.run('editor.action.triggerParameterHints'));
    action('vb6.lastPosition','Last Definition Position',[M.CtrlCmd|M.Shift|K.F2],()=>this.runtime.ide.lastDefinitionPosition());
  }
  installAdapter() {
    const editor=this.legacy;
    if(this.xaml){
      this.wrap('setDocument',(original,text,options)=>{const result=original(text,options);if(!this.composing)this.runtime.setText(this.record,text);this.updateReadOnly();return result;});
      this.wrap('reveal',(_original,start,end=start,focus=true)=>this.select(start,end,focus));
      this.wrap('action',(original,id)=>{const map={complete:'editor.action.triggerSuggest',format:'editor.action.formatDocument',definition:'editor.action.revealDefinition',references:'editor.action.referenceSearch.trigger',rename:'editor.action.rename',hover:'editor.action.showHover',find:'actions.find'};return map[id]?this.run(map[id]):original(id);});
      this.wrap('complete',()=>this.run('editor.action.triggerSuggest'));
    }else{
      this.wrap('paint',()=>{});
      this.wrap('selectionBounds',(original,pane)=>pane&&pane!==editor.activePane?original(pane):this.selection());
      this.wrap('cursor',()=>{const p=this.view?.getPosition()||this.record.model.getPositionAt(0);return {line:p.lineNumber,column:p.column,offset:this.record.model.getOffsetAt(p)};});
      this.wrap('goToLine',(_original,line,column=1)=>{const p=this.record.model.validatePosition({lineNumber:Math.max(1,Math.trunc(Number(line)||1)),column:Math.max(1,Math.trunc(Number(column)||1))});this.view.setPosition(p);this.view.revealPositionInCenterIfOutsideViewport(p);this.focus();});
      this.wrap('selectGlobal',(_original,start,end=start)=>this.select(start,end));
      this.wrap('replaceGlobal',(_original,text,start,end,kind='command')=>this.replace(text,start,end,kind));
      this.wrap('setValue',(_original,text)=>this.replace(String(text),0,this.record.model.getValueLength()));
      this.wrap('replaceSelection',(_original,text,start,end,kind='command')=>{const s=this.selection();return this.replace(text,start===undefined?s.start:editor.activePane.range.start+start,end===undefined?s.end:editor.activePane.range.start+end,kind);});
      this.wrap('setDocument',(original,module,project)=>{if(!this.composing)this.runtime.setText(this.record,String(module.code||''));const result=original(module,project);this.decorate();return result;});
      this.wrap('setReadOnly',(original,value)=>{const result=original(value);this.updateReadOnly();return result;});
      for(const name of ['setBreakpoints','setDiagnostics','setExecution'])this.wrap(name,(original,...args)=>{const result=original(...args);this.decorate();return result;});
      this.wrap('showFind',(_original,replace)=>this.run(replace?'editor.action.startFindReplaceAction':'actions.find'));
      this.wrap('complete',()=>this.run('editor.action.triggerSuggest'));this.wrap('completeWord',()=>this.run('editor.action.triggerSuggest'));
      this.wrap('showInfo',(_original,kind)=>this.run(kind==='parameter'?'editor.action.triggerParameterHints':'editor.action.showHover'));
      this.wrap('edit',(original,id)=>{
        const map={format:'editor.action.formatDocument',comment:'editor.action.addCommentLine',uncomment:'editor.action.removeCommentLine',cut:'editor.action.clipboardCutAction',copy:'editor.action.clipboardCopyAction',paste:'editor.action.clipboardPasteAction',selectAll:'editor.action.selectAll',indent:'editor.action.indentLines',outdent:'editor.action.outdentLines'};
        if(id==='delete'){const s=this.selection();return this.replace('',s.start,s.end);}
        return map[id]?this.run(map[id]):original(id);
      });
      this.wrap('prepareDocumentTransfer',(original)=>{
        this.transferView=this.view.saveViewState();this.transferSelection=this.selection();
        const result=original();this.destroyView();return result;
      });
      this.wrap('transferDocument',(original)=>{
        // Recreate against the adopted ownerDocument instead of retaining stale
        // window event targets and observers. The model and history are shared.
        if(!this.view)this.createView();const result=original();if(this.transferView)this.view.restoreViewState(this.transferView);if(this.transferSelection)this.select(this.transferSelection.start,this.transferSelection.end,false);this.transferView=null;this.decorate();return result;
      });
    }
    this.wrap('setAppearance',(original,...args)=>{const result=original(...args);this.appearance();return result;});
    this.wrap('dispose',(original,...args)=>{this.dispose();return original(...args);});
  }
  selection(){const s=this.view?.getSelection();return s?{start:this.record.model.getOffsetAt(s.getStartPosition()),end:this.record.model.getOffsetAt(s.getEndPosition())}:this.transferSelection||{start:0,end:0};}
  select(start,end=start,focus=true){if(!this.view)return;const a=this.record.model.getPositionAt(Math.max(0,start)),b=this.record.model.getPositionAt(Math.max(start,end));this.view.setSelection(new this.monaco.Range(a.lineNumber,a.column,b.lineNumber,b.column));this.view.revealPositionInCenterIfOutsideViewport(a);if(focus)this.focus();}
  cursorChanged(){
    if(!this.view||this.disposed||this.syncCursor||this.composing)return;
    this.syncCursor=true;try{
      const bounds=this.selection();
      if(this.xaml){this.legacy.input.setSelectionRange(bounds.start,bounds.end);this.legacy.cursor();}
      else {this.legacy.syncPane(this.legacy.activePane,bounds.start,bounds.end);this.legacy.cursorChanged();}
    }finally{this.syncCursor=false;}
  }
  changed(oldText,newText,event){if(this.composing)return;this.commit(oldText,newText,event);}
  commit(oldText,newText,event){
    if(oldText===newText||this.disposed)return;
    if(this.readOnly())throw new Error('The source is read-only.');
    if(this.xaml){this.legacy.onEdit?.(newText);return;}
    const editor=this.legacy,changes=event?.changes;
    const start=changes?.length?Math.min(...changes.map(c=>c.rangeOffset)):null,oldEnd=changes?.length?Math.max(...changes.map(c=>c.rangeOffset+c.rangeLength)):null;
    const delta=newText.length-oldText.length,change=start===null?textChange(oldText,newText):{start,oldEnd,newEnd:oldEnd+delta,delta};
    editor.changingSource=true;
    try{
      editor.assignSource(newText,this.selection(),change);
      editor.emit('change',{module:editor.module,oldText,newText,change,kind:this.editKind||'typing'});
      editor.updateSelectors(false);editor.cursorChanged();
    }finally{editor.changingSource=false;this.editKind=null;}
  }
  replace(text,start,end,kind='command'){
    if(this.readOnly()||!this.view)return;const a=this.record.model.getPositionAt(start),b=this.record.model.getPositionAt(end);this.editKind=kind;
    this.view.executeEdits('vb6-ide',[{range:new this.monaco.Range(a.lineNumber,a.column,b.lineNumber,b.column),text:String(text),forceMoveMarkers:true}]);
    this.select(start+String(text).length);this.editKind=null;
  }
  readOnly(){return this.xaml?this.runtime.ide.runState!=='design'||!!this.legacy.input.readOnly||!!this.runtime.ide.documents.designers.get(this.record.moduleId)?.locked:this.runtime.ide.runState==='running'||!!this.legacy.readOnly;}
  updateReadOnly(){this.view?.updateOptions({readOnly:this.readOnly()});}
  appearance(){const a=this.runtime.ide.appearance;this.view?.updateOptions({fontSize:a.editorSize||13,fontFamily:a.editorFont||'monospace',lineHeight:(a.editorSize||13)+4});this.record.model.updateOptions({tabSize:this.runtime.ide.project.settings.tabWidth||4,insertSpaces:true});}
  decorate(){
    if(!this.view||this.xaml)return;
    const e=this.legacy,model=this.record.model,name=e.module?.name?.toLowerCase(),decorations=[];
    for(const bp of e.breakpoints||[])if(bp.module?.toLowerCase()===name&&bp.line>=1&&bp.line<=model.getLineCount())decorations.push({range:new this.monaco.Range(bp.line,1,bp.line,1),options:{glyphMargin:{position:this.monaco.editor.GlyphMarginLane.Left},glyphMarginClassName:'advanced-breakpoint'+(bp.enabled===false?' disabled':''),glyphMarginHoverMessage:{value:bp.condition?'Breakpoint: '+bp.condition:'Breakpoint',isTrusted:false},minimap:{color:'#b91c1c',position:this.monaco.editor.MinimapPosition.Gutter},overviewRuler:{color:'#b91c1c',position:1}}});
    for(const line of e.module?.bookmarks||[])if(line>=1&&line<=model.getLineCount())decorations.push({range:new this.monaco.Range(line,1,line,1),options:{linesDecorationsClassName:'advanced-bookmark'}});
    const execution=e.execution;if(execution&&(!execution.module||execution.module.toLowerCase()===name)&&execution.line<=model.getLineCount())decorations.push({range:new this.monaco.Range(Math.max(1,execution.line),1,Math.max(1,execution.line),1),options:{isWholeLine:true,className:'advanced-execution-line',glyphMargin:{position:this.monaco.editor.GlyphMarginLane.Right},glyphMarginClassName:'advanced-execution-arrow',overviewRuler:{color:'#eab308',position:7}}});
    this.decorations.set(decorations);
    if(this.markerRevision!==e.diagnosticRevision){
      this.markerRevision=e.diagnosticRevision;
      const markers=(e.diagnostics||[]).filter(d=>d.source?.toLowerCase()===name&&d.line>0).map(d=>{
        const line=Math.min(model.getLineCount(),d.line),column=Math.max(1,Math.min(model.getLineMaxColumn(line),d.column||1));
        return {severity:d.severity==='warning'?this.monaco.MarkerSeverity.Warning:this.monaco.MarkerSeverity.Error,message:String(d.message),source:'VB6 IDE',startLineNumber:line,startColumn:column,endLineNumber:line,endColumn:Math.min(model.getLineMaxColumn(line),column+1)};
      });this.monaco.editor.setModelMarkers(model,'vb6-ide',markers);
    }
  }
  run(id){this.focus();const action=this.view?.getAction(id);return action?action.run():this.view?.trigger('vb6-ide',id,null);}
  insertSnippet(text){if(this.readOnly())return;this.focus();const contribution=this.view.getContribution('snippetController2');if(!contribution)throw new Error('The pinned editor snippet contribution is unavailable.');contribution.insert(String(text));}
  focus(){this.view?.focus();}
  destroyView(){this.navigationAbort?.abort();this.peek?.dispose(false);if(!this.view)return;for(const d of this.viewDisposables||[])d.dispose();this.viewDisposables=[];this.view.dispose();this.view=null;}
  dispose(){
    if(this.disposed)return;const selection=this.selection();this.disposed=true;
    // Flush a pending IME composition before releasing the enhanced surface.
    if(this.composing){this.composing=false;this.disposed=false;try{this.commit(this.compositionBefore??this.legacy.text,this.record.model.getValue(),null);}catch(error){this.runtime.report(error);}this.disposed=true;}
    this.destroyView();for(const restore of this.restore.reverse())restore();for(const d of this.disposables)d.dispose();this.host.remove();this.root.classList.remove('advanced-editor-active');this.runtime.surfaces.delete(this.legacy);
    if(!this.legacy.disposed&&!this.legacy.closed){
      if(this.xaml)this.legacy.input.setSelectionRange(selection.start,selection.end);
      else {this.legacy.syncPane(this.legacy.activePane,selection.start,selection.end);this.legacy.paint();}
    }
  }
}
