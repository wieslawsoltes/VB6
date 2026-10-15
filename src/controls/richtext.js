/** RichTextBox DOM adapter. All content is constructed as text nodes, never innerHTML. */
import {parseRTF,RichTextDocument,richText} from './rtf.js';
import {VBError} from '../language/lexer.js';
import {oleColor} from '../graphics/surface.js';
import {fontFamily} from '../theme/theme.js';
const BOOLS=new Set(['bold','italic','underline','strike']);
const FIELDS={SelBold:'bold',SelItalic:'italic',SelUnderline:'underline',SelStrikeThru:'strike',SelColor:'color',SelBackColor:'background',SelFontName:'fontName',SelFontSize:'fontSize',SelAlignment:'alignment',SelIndent:'leftIndent',SelRightIndent:'rightIndent',SelHangingIndent:'firstIndent'};
const PARAGRAPH=new Set(['alignment','leftIndent','rightIndent','firstIndent']);
const fail=message=>{throw new VBError('RichTextBox: '+message,380);};
function selectionIndent(document,start,end,key){const styles=start===end?[document.styleAt(start)]:document.slice(start,end).runs.map(r=>r.style);const values=styles.map(s=>key==='SelIndent'?s.leftIndent+s.firstIndent:-s.firstIndent);return values.every(v=>v===values[0])?values[0]:null;}
function nativeColor(value){if(value===null)return null;const c=value.replace('#','');return parseInt(c.slice(0,2),16)+(parseInt(c.slice(2,4),16)<<8)+(parseInt(c.slice(4,6),16)<<16);}
export class RichTextController {
  constructor(node,{text='',rtf=null,defaults={},readOnly=false,maxLength=0,onChange=()=>{},onSelection=()=>{}}={}){
    this.node=node;this.defaults=defaults;this.document=rtf?parseRTF(rtf,defaults):RichTextDocument.plain(text,defaults);this.start=0;this.end=0;this.readOnly=readOnly;this.maxLength=maxLength;this.onChange=onChange;this.onSelection=onSelection;this.undoStack=[];this.redoStack=[];this.handlers=[];this.render();
    this.listen(node,'beforeinput',e=>this.beforeInput(e));this.listen(node,'keydown',e=>this.keyDown(e));
    this.listen(node,'compositionstart',()=>{this.composing=true;this.compositionBefore=this.capture();});this.listen(node,'compositionend',()=>{this.composing=false;this.adoptDOM(this.compositionBefore);this.compositionBefore=null;});
    this.listen(node,'input',()=>{if(!this.composing)this.adoptDOM();});
    this.listen(node,'paste',e=>{e.preventDefault();if(this.readOnly)return;const rtf=e.clipboardData?.getData('text/rtf');this.replaceSelection(rtf?parseRTF(rtf,this.defaults):e.clipboardData?.getData('text/plain')||'');});
    this.listen(node,'copy',e=>this.copyEvent(e,false));this.listen(node,'cut',e=>this.copyEvent(e,true));
    this.listen(document,'selectionchange',()=>this.readSelection());
  }
  listen(target,event,handler){
    const guarded=e=>{try{handler(e);}catch(error){if(!(error instanceof VBError))throw error;e.preventDefault();this.lastInputError=error.message;this.render();this.writeSelection();this.node.dataset.inputError=error.message;this.node.title='Input rejected: '+error.message;}};
    target.addEventListener(event,guarded);this.handlers.push(()=>target.removeEventListener(event,guarded));
  }
  capture(){return {document:this.document.snapshot(),start:this.start,end:this.end,insertionStyle:this.insertionStyle?{...this.insertionStyle}:null};}
  restore(snapshot){this.document=RichTextDocument.restore(snapshot.document);this.start=snapshot.start;this.end=snapshot.end;this.insertionStyle=snapshot.insertionStyle;this.render();this.writeSelection();this.onChange();this.onSelection();}
  saveUndo(snapshot){this.undoStack.push(snapshot);this.redoStack=[];let bytes=0;for(let i=this.undoStack.length-1;i>=0;i--){const d=this.undoStack[i].document;bytes+=(d.originalRTF?.length||0)+d.runs.reduce((n,r)=>n+r.text.length+120,0);if((bytes>8_000_000||this.undoStack.length-i>100)&&i<this.undoStack.length-1){this.undoStack.splice(0,i+1);break;}}}
  change(fn){const before=this.capture();fn();this.saveUndo(before);this.render();this.writeSelection();this.onChange();this.onSelection();}
  undo(){if(!this.undoStack.length)return false;this.redoStack.push(this.capture());this.restore(this.undoStack.pop());return true;}
  redo(){if(!this.redoStack.length)return false;this.undoStack.push(this.capture());this.restore(this.redoStack.pop());return true;}
  setText(value){const next=RichTextDocument.plain(value,this.defaults);this.change(()=>{this.document=next;this.start=this.end=0;this.insertionStyle=null;});}
  setRTF(value){const next=parseRTF(value,this.defaults);this.change(()=>{this.document=next;this.start=this.end=0;this.insertionStyle=null;});}
  get text(){return this.document.text;}
  get rtf(){return this.document.toRTF();}
  get selectedText(){return this.text.slice(this.start,this.end);}
  get selectedRTF(){return this.document.slice(this.start,this.end).toRTF();}
  select(start,end=start){start=Number(start);end=Number(end);this.document.checkRange(start,end);this.start=start;this.end=end;this.insertionStyle=null;this.writeSelection();this.onSelection();}
  replaceSelection(value){this.readSelection();const start=this.start,end=this.end,style=this.insertionStyle||this.document.styleAt(start),insert=value instanceof RichTextDocument?value:richText(value);const length=insert instanceof RichTextDocument?insert.length:insert.length;if(this.maxLength>0&&this.document.length-(end-start)+length>this.maxLength)fail('MaxLength exceeded');this.change(()=>{const length=this.document.replace(start,end,insert,style);this.start=this.end=start+length;this.insertionStyle={...style};});}
  style(key){this.readSelection();const field=FIELDS[key];if(!field)fail('unsupported selection property '+key);if(key==='SelIndent'||key==='SelHangingIndent')return selectionIndent(this.document,this.start,this.end,key);let value=this.start===this.end&&this.insertionStyle?this.insertionStyle[field]:this.document.selectionStyle(this.start,this.end,field);if(value===null)return null;if(BOOLS.has(field))return value?-1:0;if(field==='color'||field==='background')return nativeColor(value);return value;}
  format(key,value){this.readSelection();const field=FIELDS[key];if(!field)fail('unsupported selection property '+key);if(BOOLS.has(field))value=!!value;else if(field==='color'||field==='background'){value=oleColor(value);if(!/^#[0-9a-f]{6}$/i.test(value))fail('color must be an OLE color or #RRGGBB');}else if(field==='fontSize'){value=Number(value);if(!Number.isFinite(value)||value<=0||value>16383.5)fail('invalid font size');value=Math.round(value*2)/2;}else if(field==='fontName'){value=String(value);if(!value||value.length>128||/[;\r\n\0]/.test(value))fail('invalid font name');}else{value=Number(value);if(!Number.isInteger(value)||Math.abs(value)>31680||field==='alignment'&&(value<0||value>3))fail('invalid paragraph property');}
    if(this.start===this.end&&!PARAGRAPH.has(field)){this.insertionStyle={...(this.insertionStyle||this.document.styleAt(this.start)),[field]:value};this.onSelection();return;}
    this.change(()=>{if(PARAGRAPH.has(field))this.document.formatParagraphs(this.start,this.end,key==='SelIndent'?s=>({leftIndent:value-s.firstIndent}):key==='SelHangingIndent'?s=>({leftIndent:s.leftIndent+s.firstIndent+value,firstIndent:-value}):{[field]:value});else this.document.format(this.start,this.end,{[field]:value});});
  }
  render(){
    const active=document.activeElement===this.node,scrollTop=this.node.scrollTop,scrollLeft=this.node.scrollLeft,fragment=document.createDocumentFragment();this.positions=[];this.positionsByNode=new WeakMap();this.paragraphs=[];const text=this.text,runs=this.document.runs;let start=0,runIndex=0,runOffset=0,position=0;
    const advance=count=>{while(count>0&&runIndex<runs.length){const available=runs[runIndex].text.length-runOffset,part=Math.min(available,count);runOffset+=part;position+=part;count-=part;if(runOffset===runs[runIndex].text.length){runIndex++;runOffset=0;}}};
    for(;;){const found=text.indexOf('\r\n',start),end=found<0?text.length:found,paragraph=document.createElement('div');paragraph.className='vb-rich-paragraph';paragraph.dataset.start=start;paragraph.dataset.end=end;const style=runs[runIndex]?.style||this.document.styleAt(start);
      Object.assign(paragraph.style,{textAlign:['left','right','center','justify'][style.alignment||0],marginLeft:style.leftIndent/15+'px',marginRight:style.rightIndent/15+'px',textIndent:style.firstIndent/15+'px',minHeight:'1.25em'});
      while(position<end&&runIndex<runs.length){const run=runs[runIndex],count=Math.min(run.text.length-runOffset,end-position),span=document.createElement('span'),s=run.style,textNode=document.createTextNode(run.text.slice(runOffset,runOffset+count));Object.assign(span.style,{fontFamily:/MS Sans Serif/i.test(s.fontName)?'Arial, sans-serif':fontFamily(s.fontName),fontSize:s.fontSize+'pt',fontWeight:s.bold?'bold':'normal',fontStyle:s.italic?'italic':'normal',textDecoration:[s.underline?'underline':'',s.strike?'line-through':''].filter(Boolean).join(' ')||'none',color:s.color||'',backgroundColor:s.background||'',whiteSpace:'pre-wrap',display:s.hidden?'none':''});span.append(textNode);paragraph.append(span);const entry={node:textNode,start:position,end:position+count};this.positions.push(entry);this.positionsByNode.set(textNode,entry);advance(count);}
      if(!paragraph.childNodes.length)paragraph.append(document.createElement('br'));fragment.append(paragraph);this.paragraphs.push(paragraph);if(found<0)break;advance(2);start=end+2;
    }
    this.node.replaceChildren(fragment);this.node.contentEditable=String(!this.readOnly);this.node.setAttribute('aria-multiline','true');this.node.title=this.document.warnings.length?'Unsupported RTF structures retained while unchanged. Editing requires flattening before RTF export.\n'+this.document.warnings.join('\n'):'';this.node.scrollTop=scrollTop;this.node.scrollLeft=scrollLeft;if(active)this.writeSelection();
  }
  endpoint(node,offset){const direct=this.positionsByNode.get(node);if(direct)return Math.min(direct.end,direct.start+offset);if(node===this.node){const child=node.childNodes[offset];return child?Number(child.dataset.start):this.text.length;}if(node.nodeType===1){const child=node.childNodes[offset];if(child){const position=this.positions.find(p=>child===p.node||child.contains?.(p.node));if(position)return position.start;}const all=this.positions.filter(p=>node.contains(p.node));if(all.length)return all.at(-1).end;const paragraph=node.closest('.vb-rich-paragraph');if(paragraph)return Number(paragraph.dataset.start);}return 0;}
  readSelection(){if(this.composing)return;const selection=document.getSelection();if(!selection?.rangeCount||!this.node.contains(selection.anchorNode)||!this.node.contains(selection.focusNode))return;const a=this.endpoint(selection.anchorNode,selection.anchorOffset),b=this.endpoint(selection.focusNode,selection.focusOffset),start=Math.min(a,b),end=Math.max(a,b);if(start===this.start&&end===this.end)return;this.start=start;this.end=end;this.insertionStyle=null;this.onSelection();}
  positionAt(offset){let lo=0,hi=this.positions.length;while(lo<hi){const mid=(lo+hi)>>1;if(this.positions[mid].end<offset)lo=mid+1;else hi=mid;}const p=this.positions[lo];if(p&&p.start<=offset)return {node:p.node,offset:offset-p.start};lo=0;hi=this.paragraphs.length;while(lo<hi){const mid=(lo+hi)>>1;if(Number(this.paragraphs[mid].dataset.start)<offset)lo=mid+1;else hi=mid;}return {node:this.paragraphs[lo]||this.node.lastChild,offset:0};}
  writeSelection(){if(!this.node.isConnected)return;const a=this.positionAt(this.start),b=this.positionAt(this.end);if(!a.node||!b.node)return;const range=document.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);}
  beforeInput(e){if(this.readOnly){e.preventDefault();return;}if(this.composing||e.isComposing)return;this.readSelection();const kind=e.inputType;
    if(['insertText','insertReplacementText','insertParagraph','insertLineBreak'].includes(kind)){e.preventDefault();this.replaceSelection(kind==='insertParagraph'||kind==='insertLineBreak'?'\r\n':e.data||'');return;}
    if(kind.startsWith('delete')){e.preventDefault();if(this.start===this.end){let a=this.start,b=this.end;if(/Backward$/.test(kind)){if(kind.includes('Word'))a=this.text.slice(0,a).replace(/\S+\s*$/,'').length;else a=Math.max(0,a-(this.text.slice(a-2,a)==='\r\n'||/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(this.text.slice(a-2,a))?2:1));}else if(/Forward$/.test(kind)){if(kind.includes('Word'))b=this.end+(this.text.slice(b).match(/^\s*\S+/)?.[0].length||1);else b=Math.min(this.text.length,b+(this.text.slice(b,b+2)==='\r\n'||this.text.codePointAt(b)>65535?2:1));}this.start=a;this.end=Math.min(this.text.length,b);this.writeSelection();}this.replaceSelection('');return;}
    if(kind==='historyUndo'||kind==='historyRedo'){e.preventDefault();kind==='historyUndo'?this.undo():this.redo();return;}
    if(kind.startsWith('format')){e.preventDefault();const field={formatBold:'SelBold',formatItalic:'SelItalic',formatUnderline:'SelUnderline'}[kind];if(field)this.format(field,this.style(field)?0:-1);}
  }
  keyDown(e){const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();if(!mod)return;if(key==='a'){e.preventDefault();this.select(0,this.text.length);return;}if(this.readOnly)return;if(key==='z'||key==='y'){e.preventDefault();e.shiftKey||key==='y'?this.redo():this.undo();}else if(['b','i','u'].includes(key)){e.preventDefault();const field={b:'SelBold',i:'SelItalic',u:'SelUnderline'}[key];this.format(field,this.style(field)?0:-1);}}
  copyEvent(e,cut){this.readSelection();if(!this.selectedText)return;e.preventDefault();e.clipboardData?.setData('text/plain',this.selectedText);try{e.clipboardData?.setData('text/rtf',this.selectedRTF);}catch{}if(cut&&!this.readOnly)this.replaceSelection('');}
  adoptDOM(before=null){
    // Composition normally alters a text node inside an existing paragraph. Read those
    // paragraphs separately so trailing empty paragraphs and CRLF selection units survive.
    if(this.readOnly){this.render();this.writeSelection();return;}
    const selection=document.getSelection(),children=[...this.node.children],structured=children.length===this.node.childNodes.length&&children.every(p=>p.classList.contains('vb-rich-paragraph'));
    let text,caret=this.start;
    if(structured){const parts=children.map(p=>p.textContent||'');text=parts.join('\r\n');if(selection?.rangeCount&&this.node.contains(selection.focusNode)){let parent=selection.focusNode;while(parent&&parent.parentNode!==this.node)parent=parent.parentNode;const at=children.indexOf(parent);if(at>=0){const prefix=document.createRange();prefix.selectNodeContents(parent);prefix.setEnd(selection.focusNode,selection.focusOffset);caret=parts.slice(0,at).reduce((n,t)=>n+t.length+2,0)+prefix.toString().length;}}}
    else{text=richText(this.node.innerText);if(selection?.rangeCount&&this.node.contains(selection.focusNode)){const prefix=document.createRange();prefix.selectNodeContents(this.node);prefix.setEnd(selection.focusNode,selection.focusOffset);caret=richText(prefix.toString()).length;}}
    if(text===this.text){this.render();this.writeSelection();return;}
    if(this.maxLength>0&&text.length>this.maxLength){this.render();this.writeSelection();return;}
    let a=0,oldEnd=this.text.length,newEnd=text.length;while(a<oldEnd&&a<newEnd&&this.text[a]===text[a])a++;while(oldEnd>a&&newEnd>a&&this.text[oldEnd-1]===text[newEnd-1]){oldEnd--;newEnd--;}
    const snapshot=before||this.capture();this.document.replace(a,oldEnd,text.slice(a,newEnd),this.insertionStyle||this.document.styleAt(a));this.start=this.end=Math.min(this.document.length,Math.max(a,caret));this.saveUndo(snapshot);this.render();this.writeSelection();this.onChange();this.onSelection();
  }
  find(text,start=0,end=this.text.length,flags=0){text=String(text);start=Number(start);end=end<0?this.text.length:Number(end);this.document.checkRange(start,end);if(!text)return -1;const hay=flags&4?this.text:this.text.toLocaleLowerCase(),needle=flags&4?text:text.toLocaleLowerCase();let at=hay.indexOf(needle,start);while(at>=0&&at+needle.length<=end){const word=/[\p{L}\p{N}_]/u,whole=!(flags&2)||(!word.test(this.text[at-1]||'')&&!word.test(this.text[at+needle.length]||''));if(whole){if(!(flags&8))this.select(at,at+needle.length);return at;}at=hay.indexOf(needle,at+1);}return -1;}
  dispose(){for(const off of this.handlers)off();this.handlers=[];}
}
export const RICH_SELECTION_PROPERTIES=Object.freeze(Object.keys(FIELDS));
