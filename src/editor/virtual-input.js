import {el} from '../core/core.js';
import {offsetAt,positionAt} from './projection.js';

/** Window the native text input as well as syntax. Native textarea shaping is
 * otherwise O(module size) per keystroke even when the highlighting is virtual.
 * The complete source, selection and undo remain in SourceEditor, never the DOM.
 */
export class VirtualTextInput {
  constructor(editor,pane){
    this.editor=editor;this.pane=pane;this.active=false;this.windowSize=256;this.threshold=2000;
    this.rail=el('div',{class:'code-virtual-scroll',tabindex:-1,'aria-label':'Module vertical scroll',hidden:true});this.spacer=el('div');this.rail.append(this.spacer);pane.viewport.append(this.rail);
    this.rail.addEventListener('scroll',()=>this.scrollTo(this.rail.scrollTop));
    pane.input.addEventListener('wheel',e=>{if(!this.active||e.ctrlKey)return;e.preventDefault();if(e.shiftKey||Math.abs(e.deltaX)>Math.abs(e.deltaY))pane.input.scrollLeft+=e.deltaX||e.deltaY;else this.scrollTo(this.rail.scrollTop+e.deltaY*(e.deltaMode===1?editor.lineHeight:e.deltaMode===2?pane.viewport.clientHeight:1));},{passive:false});
    pane.input.addEventListener('scroll',()=>{if(!this.active||this.syncing)return;const global=(pane.range.firstLine-this.full.firstLine)*editor.lineHeight+pane.input.scrollTop;if(Math.abs(global-this.rail.scrollTop)>1)this.scrollTo(global);});
    pane.input.addEventListener('keydown',e=>this.keydown(e),true);
    pane.input.addEventListener('beforeinput',e=>this.beforeInput(e),true);
    pane.input.addEventListener('copy',e=>this.clipboard(e,false));pane.input.addEventListener('cut',e=>this.clipboard(e,true));
    pane.input.addEventListener('paste',e=>{if(!this.active||pane.input.readOnly)return;e.preventDefault();editor.activatePane(pane);this.replace(e.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n'));});
    for(const type of ['select','keyup','click'])pane.input.addEventListener(type,()=>this.captureSelection(),true);
    pane.input.addEventListener('pointerdown',e=>this.pointerDown(e),true);
  }
  project(full,start,end){
    const e=this.editor,p=this.pane,totalLast=positionAt(e.index,full.end).line-1,count=totalLast-full.firstLine+1;
    this.full=full;const was=this.active;this.active=count>this.threshold;
    this.rail.hidden=!this.active;p.viewport.classList.toggle('virtual-native-input',this.active);
    if(!this.active){this.logical=null;this.first=null;return full;}
    const cursor=positionAt(e.index,this.focusHint??start).line-1;this.focusHint=null;
    const limit=Math.max(full.firstLine,totalLast-this.windowSize+1);
    let first=this.forceFirst??this.first;
    if(first===undefined||first===null||!was||this.forceFirst===undefined&&(cursor<first||cursor>=first+this.windowSize))first=cursor-64;
    this.forceFirst=undefined;first=Math.max(full.firstLine,Math.min(limit,first));this.first=first;
    const last=Math.min(totalLast,first+this.windowSize-1),rangeStart=e.index.starts[first],rangeEnd=last<totalLast?e.index.starts[last+1]-1:full.end;
    this.spacer.style.height=(count*e.lineHeight+8)+'px';
    this.logical={start,end,anchor:this.direction==='backward'?end:start,focus:this.direction==='backward'?start:end};
    return {...full,start:rangeStart,end:rangeEnd,firstLine:first};
  }
  selection(){return this.active&&this.logical?this.logical:{start:this.pane.range.start+this.pane.input.selectionStart,end:this.pane.range.start+this.pane.input.selectionEnd};}
  captureSelection(){
    if(!this.active||this.syncing)return;const p=this.pane,expectedStart=Math.max(0,Math.min(p.input.value.length,this.logical.start-p.range.start)),expectedEnd=Math.max(expectedStart,Math.min(p.input.value.length,this.logical.end-p.range.start));
    if(p.input.selectionStart===expectedStart&&p.input.selectionEnd===expectedEnd)return;
    const start=p.range.start+p.input.selectionStart,end=p.range.start+p.input.selectionEnd,back=p.input.selectionDirection==='backward';this.direction=back?'backward':'forward';this.logical={start,end,anchor:back?end:start,focus:back?start:end};
  }
  select(anchor,focus=anchor,{reveal=true}={}){
    const p=this.pane,e=this.editor;anchor=Math.max(this.full.start,Math.min(this.full.end,anchor));focus=Math.max(this.full.start,Math.min(this.full.end,focus));
    this.direction=focus<anchor?'backward':'forward';this.focusHint=focus;
    if(!reveal)this.forceFirst=this.first;
    this.syncing=true;e.syncPane(p,Math.min(anchor,focus),Math.max(anchor,focus));this.logical={start:Math.min(anchor,focus),end:Math.max(anchor,focus),anchor,focus};
    if(reveal){const row=positionAt(e.index,focus).line-1-p.range.firstLine,y=row*e.lineHeight;if(y<p.input.scrollTop)p.input.scrollTop=y;else if(y>p.input.scrollTop+p.viewport.clientHeight-40)p.input.scrollTop=y-p.viewport.clientHeight+40;this.rail.scrollTop=(p.range.firstLine-this.full.firstLine)*e.lineHeight+p.input.scrollTop;}
    this.syncing=false;e.cursorChanged();
  }
  scrollTo(top){
    if(!this.active||this.syncing)return;const e=this.editor,p=this.pane,limit=Math.max(0,this.spacer.offsetHeight-this.rail.clientHeight);top=Math.max(0,Math.min(limit,top));
    const first=Math.max(this.full.firstLine,Math.floor(top/e.lineHeight)+this.full.firstLine-16),selection=this.selection();
    this.syncing=true;this.forceFirst=first;e.syncPane(p,selection.start,selection.end);p.input.scrollTop=top-(p.range.firstLine-this.full.firstLine)*e.lineHeight;this.rail.scrollTop=top;this.syncing=false;e.schedulePaint();
  }
  replace(text,start=this.selection().start,end=this.selection().end,kind='command'){this.editor.activatePane(this.pane);this.editor.replaceGlobal(text,start,end,kind);}
  beforeInput(event){
    if(!this.active||this.pane.input.readOnly||event.isComposing)return;
    const type=event.inputType,selection=this.selection();
    if(type==='insertText'||type==='insertLineBreak'||type==='insertParagraph'){
      if(event.data===null&&type==='insertText')return;event.preventDefault();event.stopImmediatePropagation();let text=type==='insertText'?event.data:'\n',end=selection.end;
      if(this.editor.overwrite&&selection.start===selection.end&&type==='insertText'&&this.editor.text[end]!=='\n')end=Math.min(this.full.end,end+(this.editor.text.codePointAt(end)>65535?2:1));this.replace(text,selection.start,end,'typing');
    }else if(['deleteContentBackward','deleteContentForward','deleteWordBackward','deleteWordForward','deleteByCut'].includes(type)){
      event.preventDefault();event.stopImmediatePropagation();let {start,end}=selection;
      if(start===end){if(type.endsWith('Backward'))start=this.previous(start,type==='deleteWordBackward');else end=this.next(end,type==='deleteWordForward');}this.replace('',start,end,type==='deleteByCut'?'command':'typing');
    }
  }
  previous(offset,word=false){const text=this.editor.text;if(word){const previous=text.slice(this.full.start,offset).match(/(?:\s+|[^\w\s]+|\w+)$/);return Math.max(this.full.start,offset-(previous?.[0].length||1));}return Math.max(this.full.start,offset-(offset>1&&/[\uDC00-\uDFFF]/.test(text[offset-1])&&/[\uD800-\uDBFF]/.test(text[offset-2])?2:1));}
  next(offset,word=false){const text=this.editor.text;if(word){const next=text.slice(offset,this.full.end).match(/^(?:\s+|[^\w\s]+|\w+)/);return Math.min(this.full.end,offset+(next?.[0].length||1));}return Math.min(this.full.end,offset+(text.codePointAt(offset)>65535?2:1));}
  keydown(event){
    if(!this.active||event.isComposing||this.editor.composing)return;
    if(this.editor.completion&&['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Enter','Tab','Escape'].includes(event.key))return;
    const ctrl=event.ctrlKey||event.metaKey,key=event.key,e=this.editor,p=this.pane,s=this.selection(),focus=s.focus??s.end,pos=positionAt(e.index,focus);let next=null;
    if(ctrl&&key.toLowerCase()==='a'){event.preventDefault();event.stopImmediatePropagation();this.select(this.full.start,this.full.end);return;}
    if(ctrl&&['ArrowUp','ArrowDown'].includes(key))return;
    if(ctrl&&['PageUp','PageDown'].includes(key)){event.preventDefault();event.stopImmediatePropagation();this.scrollTo(this.rail.scrollTop+p.viewport.clientHeight*(key==='PageDown'?1:-1));return;}
    if(key==='ArrowLeft')next=!event.shiftKey&&s.start!==s.end?s.start:this.previous(focus,ctrl);
    if(key==='ArrowRight')next=!event.shiftKey&&s.start!==s.end?s.end:this.next(focus,ctrl);
    if(key==='ArrowUp'||key==='ArrowDown'){this.desiredColumn??=pos.column;next=offsetAt(e.index,pos.line+(key==='ArrowUp'?-1:1),this.desiredColumn);}
    if(key==='PageUp'||key==='PageDown'){const amount=Math.max(1,Math.floor(p.viewport.clientHeight/e.lineHeight)-2);next=offsetAt(e.index,pos.line+amount*(key==='PageUp'?-1:1),pos.column);}
    if(key==='Home'){const lineStart=offsetAt(e.index,pos.line),indent=e.index.lines[pos.line-1].match(/^[ \t]*/)[0].length;next=ctrl?this.full.start:focus===lineStart+indent?lineStart:lineStart+indent;}
    if(key==='End')next=ctrl?this.full.end:offsetAt(e.index,pos.line,1e9);
    if(next!==null){event.preventDefault();event.stopImmediatePropagation();if(!['ArrowUp','ArrowDown'].includes(key))this.desiredColumn=null;this.select(event.shiftKey?s.anchor??s.start:next,next);}
  }
  clipboard(event,cut){if(!this.active)return;event.preventDefault();const s=this.selection();event.clipboardData?.setData('text/plain',this.editor.text.slice(s.start,s.end));if(cut&&!this.pane.input.readOnly)this.replace('');}
  hit(clientX,clientY){
    const e=this.editor,p=this.pane,r=p.input.getBoundingClientRect(),row=Math.max(0,Math.min(p.lines.length-1,Math.floor((clientY-r.top+p.input.scrollTop-4)/e.lineHeight))),line=e.index.lines[p.range.firstLine+row],column=Math.max(0,Math.round((clientX-r.left+p.input.scrollLeft-3)/e.characterWidth)),tab=e.project.settings.tabWidth||4;let visual=0,index=0;
    while(index<line.length&&visual<column){const next=line[index]==='\t'?visual+tab-visual%tab:visual+1;if(next>column&&column-visual<(next-visual)/2)break;visual=next;index++;}
    return e.index.starts[p.range.firstLine+row]+index;
  }
  pointerDown(event){
    if(!this.active||event.button!==0)return;const e=this.editor,p=this.pane,r=p.input.getBoundingClientRect();if(event.clientY>r.bottom-18)return;
    event.preventDefault();e.activatePane(p);p.input.focus();let point=this.hit(event.clientX,event.clientY),anchor=event.shiftKey?this.selection().anchor:point;
    if(event.detail===2){let a=point,b=point;while(a>this.full.start&&/[\w]/.test(e.text[a-1]))a--;while(b<this.full.end&&/[\w]/.test(e.text[b]))b++;this.select(a,b);return;}
    if(event.detail>=3){const line=positionAt(e.index,point).line;this.select(offsetAt(e.index,line),Math.min(this.full.end,offsetAt(e.index,line+1)));return;}
    this.select(anchor,point,{reveal:false});p.input.setPointerCapture(event.pointerId);let x=event.clientX,y=event.clientY,done=false;
    const update=()=>{const rect=p.input.getBoundingClientRect();if(y<rect.top+10)this.scrollTo(this.rail.scrollTop-2*e.lineHeight);if(y>rect.bottom-28)this.scrollTo(this.rail.scrollTop+2*e.lineHeight);point=this.hit(x,Math.max(rect.top+4,Math.min(rect.bottom-24,y)));this.select(anchor,point,{reveal:false});};
    const move=ev=>{x=ev.clientX;y=ev.clientY;update();};const timer=setInterval(()=>{const rect=p.input.getBoundingClientRect();if(y<rect.top+10||y>rect.bottom-28)update();},50);
    const finish=()=>{if(done)return;done=true;clearInterval(timer);p.input.removeEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])p.input.removeEventListener(type,finish);};p.input.addEventListener('pointermove',move);for(const type of ['pointerup','pointercancel','lostpointercapture'])p.input.addEventListener(type,finish);this.cancelPointer=finish;
  }
  dispose(){this.cancelPointer?.();this.rail.remove();}
}
