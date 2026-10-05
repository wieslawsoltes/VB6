# One-time integration of the independently tested language service. Removed
# by the feature-branch integration workflow before the reviewable commit.
from pathlib import Path
import hashlib
p=Path('src/editor/editor.js');s=p.read_text()
raw=p.read_bytes()
assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()=='02d7cb50cdb6e8771508a4ca2250b0d7a8ba97c7', 'Editor changed since review; rebase the integration, do not overwrite it'
s=s.replace("import {EditorIntelligence,wordAt} from './intelligence.js';", "import {EditorIntelligence,wordAt} from './intelligence.js';\nimport {completionSpan,statementBefore} from './source-context.js';\nlet completionSerial=0;")
s=s.replace("this.closeCompletion();this.activePane=pane", "this.closeCompletion();this.closeInfo();this.activePane=pane")
s=s.replace("setDocument(module,project){const changed=", "setDocument(module,project){this.closeCompletion();this.closeInfo();const changed=")
s=s.replace("  changed(){if(!this.module)return;", "  changed(){if(!this.module)return;this.changingSource=true;")
s=s.replace("    if(this.completion&&!this.composing)this.complete(this.completionMode,true);\n    clearTimeout(this.infoTimer);if(this.appearance.autoQuickInfo&&!this.composing)this.infoTimer=setTimeout(()=>this.showInfo('parameter',true),160);", """    if(!this.composing&&!this.acceptingCompletion){
      if(this.completion)this.complete(this.completionMode,true);
      else if(this.appearance.autoListMembers&&this.selectionBounds().start===this.selectionBounds().end&&/[.=,( \\t]$/.test(this.text.slice(Math.max(0,start-1),start)))this.complete('auto');
    }
    this.changingSource=false;
    clearTimeout(this.infoTimer);if(this.appearance.autoQuickInfo&&!this.composing&&!this.acceptingCompletion)this.infoTimer=setTimeout(()=>this.showInfo('parameter',true),160);""")
s=s.replace("  cursorChanged(){if(!this.module)return;const cursor=this.cursor();", "  cursorChanged(){if(!this.module)return;const cursor=this.cursor();if(!this.changingSource&&this.completion&&cursor.offset!==this.completionCaret)this.closeCompletion();if(!this.changingSource&&this.info&&cursor.offset!==this.infoOffset)this.closeInfo();")
s=s.replace("setValue(value){if(this.readOnly||String(value)===this.text)return;", "setValue(value){if(this.readOnly||String(value)===this.text)return;this.closeCompletion();this.closeInfo();")
s=s.replace("    if(this.disposed||this.transferState)return;", "    if(this.disposed||this.transferState)return;this.closeCompletion();this.closeInfo();")
start=s.index('  keydown(e){');end=s.index("    if(ctrl&&['ArrowUp'",start)
s=s[:start]+'''  keydown(e){if(e.isComposing||this.composing)return;const ctrl=e.ctrlKey||e.metaKey;
    if(this.completion&&!ctrl&&!e.altKey){
      if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End','Enter','Tab','Escape'].includes(e.key)){
        e.preventDefault();
        if(e.key==='Escape'){this.closeCompletion();this.closeInfo();}
        else if(e.key==='Enter'||e.key==='Tab')this.acceptCompletion(e.key==='Enter'?'\\n':'');
        else {const count=this.completionItems.length;this.completionIndex=e.key==='Home'?0:e.key==='End'?count-1:Math.max(0,Math.min(count-1,this.completionIndex+({ArrowDown:1,ArrowUp:-1,PageDown:9,PageUp:-9}[e.key])));this.scrollCompletion();}
        return;
      }
      if(['.','(',',',' ',')'].includes(e.key)&&!this.input.readOnly){e.preventDefault();this.acceptCompletion(e.key);return;}
      if(['ArrowLeft','ArrowRight'].includes(e.key))this.closeCompletion();
    }
'''+s[end:]
s=s.replace("    if(e.key==='.'&&!this.input.readOnly&&this.appearance.autoListMembers)setTimeout(()=>{if(!this.disposed)this.complete();},0);\n",'')
start=s.index("  complete(mode='members'");end=s.index('  definition(){',start)
s=s[:start]+'''  completionSnapshot(){return {project:this.project,module:this.module.id,library:this.intelligence.libraryRevision,references:JSON.stringify(this.project.references||[]),modules:this.project.modules.map(m=>({id:m.id,name:m.name,kind:m.kind,code:m.id===this.module.id?null:m.code,metadata:JSON.stringify([m.form?.controls?.map(c=>[c.name,c.type,c.properties?.Index]),m.form?.menus,m.attributes])})),conditions:JSON.stringify(this.project.settings?.conditionalConstants||{})};}
  sameCompletionSnapshot(a,b){return a&&a.project===b.project&&a.module===b.module&&a.library===b.library&&a.references===b.references&&a.conditions===b.conditions&&a.modules.length===b.modules.length&&a.modules.every((m,i)=>Object.keys(m).every(k=>m[k]===b.modules[i][k]));}
  complete(mode='members',reuse=false){
    if(!this.module||this.composing||this.input.readOnly)return;
    const cursor=this.cursor(),span=completionSpan(this.text,cursor.offset),seed=this.text.slice(0,span.start),suffix=this.text.slice(span.end),snapshot=this.completionSnapshot();
    const previous=this.completionDetails?.[this.completionIndex]?.name;
    if(!reuse||this.completionSeed!==seed||this.completionSuffix!==suffix||this.completionMode!==mode||!this.sameCompletionSnapshot(this.completionState,snapshot)){
      const result=this.intelligence.completions(this.project,{...this.module,code:this.text},cursor.line,this.text,cursor.offset,{constants:mode==='constants',contextual:mode==='auto',unfiltered:true});
      this.completionCandidates=result.items;this.completionContext=result.context;this.completionSeed=seed;this.completionSuffix=suffix;this.completionState=snapshot;
    }
    this.completionStart=span.start;this.completionEnd=span.end;this.completionCaret=cursor.offset;this.completionMode=mode;
    const prefix=span.prefix.replace(/^\\[/,'').toLowerCase();
    this.completionDetails=this.completionCandidates.filter(s=>lower(s.name).startsWith(prefix));
    this.completionItems=this.completionDetails.map(s=>s.name);if(!this.completionItems.length){this.closeCompletion();return;}
    this.completionIndex=Math.max(0,reuse?this.completionItems.indexOf(previous):0);
    if(!this.completion){
      this.completion=el('div',{id:'vb6-completion-'+(++completionSerial),class:'completion-list',role:'listbox','aria-label':this.completionContext==='constants'?'List Constants':'List Members'});
      this.completion.style.height='180px';this.completion.addEventListener('scroll',()=>this.renderCompletion());this.viewport.append(this.completion);
    }
    this.completion.dataset.context=this.completionContext;this.input.setAttribute('aria-expanded','true');this.input.setAttribute('aria-controls',this.completion.id);this.input.setAttribute('aria-autocomplete','list');this.positionPopup(this.completion);this.scrollCompletion();
  }
  completeWord(){this.complete();if(this.completion&&this.completionItems.length===1)this.acceptCompletion();}
  positionPopup(node){
    const cursor=this.cursor(),height=node.offsetHeight||(node.classList.contains('completion-list')?180:50),width=node.offsetWidth||240;
    const y=(cursor.line-this.activePane.range.firstLine)*this.lineHeight+4-this.input.scrollTop;
    let top=y;if(node===this.info&&this.completion)top=y-height-this.lineHeight-2;
    if(top<0)top=this.completion?y+this.completion.offsetHeight+2:y;
    node.style.left=Math.max(0,Math.min(this.viewport.clientWidth-width,(cursor.column-1)*this.characterWidth+(this.appearance.margin===false?0:this.showLineNumbers?32:18)-this.input.scrollLeft))+'px';
    node.style.top=Math.max(0,Math.min(this.viewport.clientHeight-height,top))+'px';
  }
  renderCompletion(){if(!this.completion)return;const rowHeight=19,count=this.completionItems.length,start=Math.max(0,Math.floor(this.completion.scrollTop/rowHeight)-1),end=Math.min(count,start+13);const spacer=el('div',{'aria-hidden':'true',style:{height:count*rowHeight+'px',pointerEvents:'none'}}),rows=[];
    for(let i=start;i<end;i++){
      const item=this.completionDetails[i],name=item.name;
      rows.push(el('div',{id:this.completion.id+'-'+i,class:'completion-item'+(i===this.completionIndex?' selected':''),role:'option','aria-selected':i===this.completionIndex,'aria-posinset':i+1,'aria-setsize':count,title:[item.signature||name,item.description].filter(Boolean).join(' — '),style:{position:'absolute',top:i*rowHeight+'px',height:rowHeight+'px',left:0,right:0},onpointerdown:e=>{e.preventDefault();this.completionIndex=i;this.acceptCompletion();}},el('span',{class:'completion-icon'},icon(['function','method','sub'].includes(item.kind)?'code':'properties',12)),name));
    }
    this.completion.replaceChildren(spacer,...rows);this.input.setAttribute('aria-activedescendant',this.completion.id+'-'+this.completionIndex);
  }
  scrollCompletion(){if(!this.completion)return;const top=this.completionIndex*19;if(top<this.completion.scrollTop)this.completion.scrollTop=top;else if(top+19>this.completion.scrollTop+180)this.completion.scrollTop=top-161;this.renderCompletion();}
  acceptCompletion(commit=''){
    const item=this.completionDetails?.[this.completionIndex];if(!this.completion||!item||this.input.readOnly)return;
    const cursor=this.cursor(),span=completionSpan(this.text,cursor.offset),snapshot=this.completionSnapshot();
    if(this.text.slice(0,span.start)!==this.completionSeed||this.text.slice(span.end)!==this.completionSuffix||!this.sameCompletionSnapshot(this.completionState,snapshot)){this.closeCompletion();return;}
    let name=item.insertText||item.name;
    if(this.text[span.start]==='['&&!name.startsWith('['))name='['+name+']';
    const indent=commit==='\\n'&&this.appearance.autoIndent?this.text.slice(this.text.lastIndexOf('\\n',cursor.offset-1)+1,cursor.offset).match(/^[ \\t]*/)[0]:'';
    this.closeCompletion();this.closeInfo();this.acceptingCompletion=true;
    try{this.replaceGlobal(name+commit+indent,span.start,span.end);}finally{this.acceptingCompletion=false;}
    if(commit&&commit!=='\\n'){
      if(this.appearance.autoListMembers)this.complete('auto');
      if(this.appearance.autoQuickInfo)this.showInfo('parameter',true);
    }
  }
  closeCompletion(){this.completion?.remove();this.completion=null;for(const name of ['aria-expanded','aria-controls','aria-activedescendant','aria-autocomplete'])this.input?.removeAttribute(name);}
  showInfo(mode='quick',automatic=false){
    if(!this.module||this.composing)return;const cursor=this.cursor(),module={...this.module,code:this.text},selection=this.selectionBounds(),selected=this.text.slice(selection.start,selection.end);
    let info=this.intelligence.parameterInfo(this.project,module,cursor.line,this.text,cursor.offset,{outer:mode==='parameter'&&!automatic});
    if(mode==='quick'&&(!info||selected)){
      const st=statementBefore(this.text,cursor.offset),word=selected||wordAt(this.text,cursor.offset).text;
      info=st.state==='code'?this.intelligence.resolve(this.project,module,cursor.line,word,{offset:cursor.offset}):null;
    }
    if(!info){this.closeInfo();if(!automatic)this.emit('status','No declaration information at this position.');return;}
    if(!this.info){this.info=el('div',{class:'source-info',role:'tooltip','aria-label':'Code information'});this.viewport.append(this.info);}
    const doc=this.root.ownerDocument;
    if(info.params){
      this.info.replaceChildren(doc.createTextNode(info.name+'('),...info.params.flatMap((p,i)=>[i?', ':'',el(i===info.active?'strong':'span',{},/^Optional\\s+/i.test(p)?'['+p.replace(/^Optional\\s+/i,'')+']':p.endsWith('?')?'['+p.slice(0,-1)+']':p)]),doc.createTextNode(')'+(info.type&&info.type!=='Void'?' As '+info.type:'')));
      this.info.dataset.parameter=String(info.active??-1);
    }else{this.info.textContent=info.signature||info.name+' As '+(info.type||'Variant');delete this.info.dataset.parameter;}
    if(info.description)this.info.append(el('div',{class:'source-info-description'},info.description));
    this.infoOffset=cursor.offset;this.positionPopup(this.info);this.lastInfo=info;
  }
  closeInfo(){this.info?.remove();this.info=null;clearTimeout(this.infoTimer);}
'''+s[end:]
p.write_text(s)
p=Path('src/editor/assistance.js');s=p.read_text();s=s.replace("if(!/^[A-Za-z_]\\w*[$%&!#@]?(?:\\.[A-Za-z_]\\w*[$%&!#@]?)*$/.test(word.text)||", "if(!word.text||word.text.length>4096||")
p.write_text(s)
p=Path('src/editor/editor-advanced.css');s=p.read_text().replace('font-weight:700;text-decoration:underline','font-weight:700');s+='\n.source-info-description{margin-top:3px;border-top:1px solid var(--vb-shadow);padding-top:2px}\n';p.write_text(s)
p=Path('src/editor/type-catalog.js');s=p.read_text().replace('UCase UCase','UCase');p.write_text(s)
