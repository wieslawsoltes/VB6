import {el} from '../core/core.js';
import {XamlLanguageService,SourceText,applyTextEdits} from '../../packages/xaml-compiler/src/index.js';

/** Dependency-free editor surface. Source positions never refer to rendered HTML.
 * The highlight layer only contains visible lines; native textarea owns IME,
 * accessibility, clipboard, selection, scrolling and keyboard text input. */
export class XamlEditor {
  constructor({uri,schema,onEdit,onSelect,onCommand,onError}={}) {
    this.uri=uri;this.service=new XamlLanguageService({schema});this.version=0;this.text='';this.composing=false;this.closed=false;this.paintFrame=null;
    this.onEdit=onEdit;this.onSelect=onSelect;this.onCommand=onCommand;this.onError=onError??(()=>{});this.disposables=[];
    this.root=el('section',{class:'xaml-editor','aria-label':'XAML form editor'});
    this.toolbar=el('div',{class:'xaml-toolbar',role:'toolbar','aria-label':'XAML editing actions'});
    for(const [id,label,title] of [['format','Format','Format XAML (Shift+Alt+F)'],['complete','Complete','Complete XAML (Ctrl+Space)'],['definition','Definition','Go to definition (F12)'],['references','References','Find references (Shift+F12)'],['rename','Rename','Rename symbol (F2)'],['import','Import…','Import XAML source'],['download','Save XAML','Download this XAML document'],['designer','Use Designer','Replace draft with the current designer model; retain a backup'],['apply','Apply Draft','Explicitly apply a conflicting draft'],['restore','Previous Source','Restore the source backup as an editable draft']]) {
      this.toolbar.append(el('button',{type:'button','data-xaml-action':id,title,onclick:()=>this.action(id)},label));
    }
    this.outline=el('select',{'aria-label':'XAML document outline',onchange:()=>{const value=this.outline.value;if(value)this.reveal(Number(value));}});
    this.toolbar.append(this.outline);
    this.searchInput=el('input',{type:'search','aria-label':'Find in XAML',placeholder:'Find literal text',onkeydown:e=>{e.stopPropagation();if(e.key==='Enter'){e.preventDefault();this.find(e.shiftKey?-1:1);}}});
    this.replaceInput=el('input',{type:'text','aria-label':'Replace in XAML',placeholder:'Replacement'});
    this.findBar=el('div',{class:'xaml-find',hidden:true},this.searchInput,this.replaceInput,el('button',{onclick:()=>this.find(1)},'Next'),el('button',{onclick:()=>this.safeReplace(false)},'Replace'),el('button',{onclick:()=>this.safeReplace(true)},'Replace All'),el('button',{onclick:()=>{this.findBar.hidden=true;this.input.focus();}},'Close'));
    this.viewport=el('div',{class:'xaml-viewport'});
    this.highlight=el('div',{class:'xaml-highlight','aria-hidden':'true'});this.gutter=el('div',{class:'xaml-gutter','aria-hidden':'true'});
    this.input=el('textarea',{class:'xaml-input',spellcheck:false,autocapitalize:'off',autocomplete:'off',wrap:'off','aria-label':'XAML source','aria-describedby':'xaml-note-'+(++XamlEditor.sequence)});
    this.completionList=el('div',{class:'xaml-completions',role:'listbox','aria-label':'XAML completions',hidden:true});
    this.completionId='xaml-completion-'+XamlEditor.sequence;this.completionList.id=this.completionId;
    this.info=el('div',{class:'xaml-info',hidden:true});
    this.viewport.append(this.highlight,this.gutter,this.input,this.completionList,this.info);
    this.note=el('div',{class:'xaml-note',role:'status','aria-live':'polite',id:this.input.getAttribute('aria-describedby')});
    this.problems=el('div',{class:'xaml-problems','aria-label':'XAML problems'});
    this.root.append(this.toolbar,this.findBar,this.viewport,this.note,this.problems);
    this.listen(this.input,'compositionstart',()=>this.composing=true);
    this.listen(this.input,'compositionend',()=>{this.composing=false;this.commitInput();});
    this.listen(this.input,'input',()=>{if(!this.composing)this.commitInput();});
    this.listen(this.input,'scroll',()=>this.schedulePaint());
    this.listen(this.input,'keydown',e=>this.keydown(e));
    this.listen(this.input,'keyup',()=>this.cursor());this.listen(this.input,'click',()=>this.cursor());this.listen(this.input,'select',()=>this.cursor());
    this.listen(this.input,'blur',()=>{this.hideCompletion();this.info.hidden=true;});
    this.resize=new ResizeObserver(()=>this.schedulePaint());this.resize.observe(this.viewport);
    this.setAppearance({editorSize:13,editorFont:'monospace'});
  }
  listen(node,event,listener){node.addEventListener(event,listener);this.disposables.push(()=>node.removeEventListener(event,listener));}
  setAppearance(appearance) {
    this.lineHeight=Math.max(15,Number(appearance.editorSize||13)+4);
    this.root.style.setProperty('--xaml-line-height',this.lineHeight+'px');this.root.style.setProperty('--xaml-font-size',(appearance.editorSize||13)+'px');
    this.root.style.setProperty('--xaml-font',JSON.stringify(appearance.editorFont||'monospace')+', monospace');this.paint();
  }
  setDocument(text,{compilation,diagnostics=[],readOnly=false,conflict=false,message=''}={}) {
    if(this.closed)return;
    if(text!==this.text||!this.service.documents.has(this.uri)) {
      this.text=text;this.service.openDocument(this.uri,text,++this.version);this.source=new SourceText(text,this.uri);
      if(this.input.value!==text) {const start=this.input.selectionStart,end=this.input.selectionEnd,scrollTop=this.input.scrollTop,scrollLeft=this.input.scrollLeft;this.input.value=text;this.input.setSelectionRange(Math.min(start,text.length),Math.min(end,text.length));this.input.scrollTop=scrollTop;this.input.scrollLeft=scrollLeft;}
      this.hideCompletion();
    }
    if(compilation&&compilation.syntax.source.text===text) {const d=this.service.document(this.uri);d.compilation=compilation;d.schemaRevision=this.service.schema.revision;}
    const c=this.service.analyze(this.uri);this.tokens=c.syntax.tokens;this.diagnostics=diagnostics.length?diagnostics:c.diagnostics;
    this.input.readOnly=readOnly;this.input.setAttribute('aria-invalid',String(this.diagnostics.some(d=>d.severity==='error')||conflict));
    for(const button of this.toolbar.querySelectorAll('button'))button.disabled=readOnly&&['format','rename','import','designer','apply','restore'].includes(button.dataset.xamlAction);
    this.root.classList.toggle('xaml-conflict',conflict);
    this.note.textContent=message||(conflict?'The designer changed while a draft was pending. Use Designer or explicitly Apply Draft.':this.diagnostics.some(d=>d.severity==='error')?'Draft saved. Errors prevent it from replacing the last valid form.':readOnly?'Read-only while running or while the form is locked.':'XAML and the VB6 form model are synchronized. Native coordinates are twips.');
    this.problems.replaceChildren(...this.diagnostics.slice(0,80).map(d=>el('button',{type:'button',title:d.message,onclick:()=>this.reveal(d.start??0)},`${d.severity} ${d.code} · ${d.line??1}:${d.column??1} — ${d.message}`)));
    this.problems.hidden=!this.diagnostics.length;
    if(this.outlineText!==text) {
      this.outlineText=text;const previous=this.outline.value,options=[el('option',{value:''},'Document outline')];
      for(const e of c.syntax.elements.slice(0,2000)) options.push(el('option',{value:e.start},e.attributes.find(a=>a.localName==='Name')?.value??e.name));
      this.outline.replaceChildren(...options);this.outline.value=previous;
    }
    this.paint();
  }
  commitInput() {
    if(this.input.readOnly||this.closed||this.composing||this.input.value===this.text)return;
    try {this.onEdit?.(this.input.value);}
    catch(error){this.onError(error);this.input.value=this.text;}
  }
  edit(edits) {
    if(this.input.readOnly)return;
    const text=applyTextEdits(this.input.value,edits),caret=edits.length===1?edits[0].start+edits[0].text.length:this.input.selectionStart;
    this.input.value=text;this.input.setSelectionRange(caret,caret);this.commitInput();this.input.focus();this.cursor();
  }
  cursor(){if(this.closed||this.composing)return;this.onSelect?.(this.input.selectionStart);}
  reveal(start,end=start,focus=true) {
    if(!this.source)return;start=Math.max(0,Math.min(this.text.length,start));end=Math.max(start,Math.min(this.text.length,end));
    this.input.setSelectionRange(start,end);const line=this.source.positionAt(start).line;this.input.scrollTop=Math.max(0,(line-3)*this.lineHeight);this.paint();if(focus)this.input.focus();
  }
  // Do not write highlighted DOM inside ResizeObserver delivery. Showing the
  // find/hover UI changes viewport size; schedule the latest viewport once in
  // the next frame instead of producing another same-frame layout notification.
  // https://www.w3.org/TR/resize-observer/#html-processing-model-event-loop
  schedulePaint() {
    if(this.closed||this.paintFrame!==null)return;
    this.paintWindow=this.root.ownerDocument.defaultView;
    this.paintFrame=this.paintWindow.requestAnimationFrame(()=>{
      this.paintFrame=null;if(!this.closed)this.paint();
    });
  }
  paint() {
    if(!this.source||this.closed)return;
    const first=Math.max(0,Math.floor(this.input.scrollTop/this.lineHeight)-2),last=Math.min(this.source.lineStarts.length,first+Math.ceil((this.viewport.clientHeight||300)/this.lineHeight)+5);
    const lines=[],numbers=[],text=this.text;
    const startOffset=this.source.lineStarts[first]??0,endOffset=this.source.lineStarts[last]??text.length;
    // Binary seek to the first possibly visible token. Tokens never overlap.
    const all=this.tokens??[];let lo=0,hi=all.length;while(lo<hi){const m=(lo+hi)>>>1;if(all[m].end<=startOffset)lo=m+1;else hi=m;}
    const tokens=[];for(let i=lo;i<all.length&&all[i].start<endOffset;i++)tokens.push(all[i]);
    let ti=0;
    for(let line=first;line<last;line++) {
      const start=this.source.lineStarts[line],end=(this.source.lineStarts[line+1]??text.length),raw=text.slice(start,end).replace(/[\r\n]+$/,''),row=el('div',{class:'xaml-line'});let cursor=start;
      while(ti<tokens.length&&tokens[ti].end<=start)ti++;
      for(let i=ti;i<tokens.length&&tokens[i].start<start+raw.length;i++) {
        const t=tokens[i],a=Math.max(start,t.start),b=Math.min(start+raw.length,t.end);if(a>cursor)row.append(document.createTextNode(text.slice(cursor,a)));
        row.append(el('span',{class:'xaml-token-'+t.kind.toLowerCase()},text.slice(a,b)));cursor=b;
      }
      if(cursor<start+raw.length)row.append(document.createTextNode(text.slice(cursor,start+raw.length)));if(!raw)row.append(' ');
      const hasError=this.diagnostics?.some(d=>d.severity==='error'&&(d.range?.start.line??d.line-1)===line);
      numbers.push(el('div',{class:'xaml-line'+(hasError?' xaml-error-line':''),title:hasError?'XAML error':''},String(line+1)));lines.push(row);
    }
    this.highlight.style.transform=`translate(${-this.input.scrollLeft}px,${first*this.lineHeight-this.input.scrollTop}px)`;
    this.gutter.style.transform=`translateY(${first*this.lineHeight-this.input.scrollTop}px)`;
    this.highlight.replaceChildren(...lines);this.gutter.replaceChildren(...numbers);
  }
  hideCompletion(){this.completionList.hidden=true;this.completions=[];this.input.removeAttribute('aria-controls');this.input.removeAttribute('aria-activedescendant');}
  complete() {
    if(this.input.readOnly)return;this.completions=this.service.completion(this.uri,this.input.selectionStart).slice(0,200);this.completionIndex=0;
    this.completionList.replaceChildren(...this.completions.map((c,i)=>el('button',{role:'option',id:this.completionId+'-'+i,'aria-selected':i===0,onmousedown:e=>{e.preventDefault();this.accept(i);}},el('strong',{},c.label),el('span',{},c.detail??''))));
    this.completionList.hidden=!this.completions.length;if(this.completions.length){this.input.setAttribute('aria-controls',this.completionId);this.input.setAttribute('aria-activedescendant',this.completionId+'-0');}
  }
  accept(index=this.completionIndex){const item=this.completions?.[index];if(!item)return;this.edit([{start:item.start,end:item.end,text:item.insertText}]);if(item.insertText.endsWith('=""'))this.reveal(item.start+item.insertText.length-1);this.hideCompletion();}
  find(direction=1) {
    const q=this.searchInput.value;if(!q)return false;const text=this.input.value,start=this.input.selectionStart,end=this.input.selectionEnd;
    let at=direction<0?text.lastIndexOf(q,Math.max(-1,start-1)):text.indexOf(q,end);
    if(at<0)at=direction<0?text.lastIndexOf(q):text.indexOf(q);if(at<0){this.note.textContent='No matches.';return false;}
    this.reveal(at,at+q.length);return true;
  }
  safeReplace(all){try{return this.replace(all);}catch(error){this.onError(error);}}
  replace(all) {
    if(this.input.readOnly||!this.searchInput.value)return;
    const q=this.searchInput.value,changes=[],text=this.input.value;
    if(all){let at=0;while((at=text.indexOf(q,at))>=0){changes.push({start:at,end:at+q.length,text:this.replaceInput.value});at+=q.length;if(changes.length>10000)throw new RangeError('Replace All exceeds 10,000 matches.');}}
    else {const start=this.input.selectionStart,end=this.input.selectionEnd;if(text.slice(start,end)!==q){this.find(1);return;}changes.push({start,end,text:this.replaceInput.value});}
    if(changes.length)this.edit(changes);
  }
  action(id) {
    try {
      if(id==='complete')return this.complete();
      if(id==='format')return this.edit(this.service.format(this.uri,{tabSize:2}));
      if(id==='find'){this.findBar.hidden=false;this.searchInput.focus();return;}
      if(id==='definition'){const result=this.service.definition(this.uri,this.input.selectionStart)[0];if(result)this.reveal(result.start,result.end);else this.note.textContent='No definition at this position.';return;}
      if(id==='references'){const refs=this.service.references(this.uri,this.input.selectionStart);this.problems.hidden=false;this.problems.replaceChildren(...refs.map(r=>el('button',{onclick:()=>this.reveal(r.start,r.end)},`${r.declaration?'Declaration':'Reference'} · ${r.range.start.line+1}:${r.range.start.character+1} · ${r.name}`)));this.note.textContent=refs.length+' reference(s).';return;}
      if(id==='hover'){const value=this.service.hover(this.uri,this.input.selectionStart);this.info.textContent=value?.contents.value??'';this.info.hidden=!value;return;}
      return this.onCommand?.(id,this);
    } catch(error){this.onError(error);}
  }
  keydown(event) {
    event.stopPropagation();if(this.composing||event.isComposing)return;
    const ctrl=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
    if(!this.completionList.hidden&&['ArrowUp','ArrowDown','Enter','Tab','Escape'].includes(event.key)) {
      event.preventDefault();if(event.key==='Escape')return this.hideCompletion();if(event.key==='Enter'||event.key==='Tab')return this.accept();
      this.completionIndex=(this.completionIndex+(event.key==='ArrowDown'?1:-1)+this.completions.length)%this.completions.length;
      [...this.completionList.children].forEach((n,i)=>n.setAttribute('aria-selected',String(i===this.completionIndex)));const active=this.completionList.children[this.completionIndex];active.scrollIntoView({block:'nearest'});this.input.setAttribute('aria-activedescendant',active.id);return;
    }
    if(ctrl&&key===' '){event.preventDefault();return this.complete();}
    if(ctrl&&['z','y','s','f','h'].includes(key)){event.preventDefault();if(key==='f'||key==='h')return this.action('find');return this.onCommand?.(key==='s'?'save':key==='y'||event.shiftKey?'redo':'undo',this);}
    if(event.key==='F2'){event.preventDefault();return this.action('rename');}
    if(event.key==='F12'){event.preventDefault();return this.action(event.shiftKey?'references':'definition');}
    if(event.shiftKey&&event.altKey&&key==='f'){event.preventDefault();return this.action('format');}
    if(ctrl&&key==='i'){event.preventDefault();return this.action('hover');}
    if(event.key==='F5'){event.preventDefault();return this.onCommand?.(event.shiftKey?'stop':'run',this);}
    if(event.key==='Escape'){this.hideCompletion();this.info.hidden=true;return;}
    if(event.key==='Tab'&&!this.input.readOnly){event.preventDefault();this.edit([{start:this.input.selectionStart,end:this.input.selectionEnd,text:'  '}]);return;}
    if(event.key==='Enter'&&!this.input.readOnly) {
      const start=this.input.selectionStart,line=this.input.value.slice(0,start).split(/\r\n|\r|\n/).at(-1),indent=/^[\t ]*/.exec(line)[0];
      event.preventDefault();this.edit([{start,end:this.input.selectionEnd,text:'\n'+indent+(/<[^/!][^>]*>\s*$/.test(line)&&!line.trimEnd().endsWith('/>')?'  ':'')}]);return;
    }
    this.hideCompletion();
  }
  dispose(){if(this.closed)return;this.closed=true;this.resize.disconnect();if(this.paintFrame!==null){this.paintWindow.cancelAnimationFrame(this.paintFrame);this.paintFrame=null;}this.disposables.forEach(d=>d());this.service.closeDocument(this.uri);this.root.remove();}
}
XamlEditor.sequence=0;
