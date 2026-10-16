import {initVim} from './vendor/vim.js';

/**
 * CodeMirror's editing protocol without a CodeMirror editor or document. The
 * canonical document and undo history belong to the host. This adapter stages
 * operations, transforms selections and marks, then publishes one atomic edit.
 * Positions at this boundary are UTF-16 offsets; the upstream engine uses
 * zero-based {line,ch} positions internally.
 */
const eventMaps=new WeakMap();
let activeAdapter=null;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const copySelection=s=>({anchor:s.anchor,head:s.head});
const sameSelections=(a,b)=>a.length===b.length&&a.every((s,i)=>s.anchor===b[i].anchor&&s.head===b[i].head);
const escapeRegExp=text=>String(text).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const wordChar=character=>!!character&&/[\p{L}\p{N}_$]/u.test(character);
const nextCodePoint=(text,offset)=>Math.min(text.length,offset+(text.codePointAt(offset)>0xffff?2:1));
const previousCodePoint=(text,offset)=>Math.max(0,offset-(offset>1&&/[\uDC00-\uDFFF]/.test(text[offset-1])&&/[\uD800-\uDBFF]/.test(text[offset-2])?2:1));

function eventMap(target){let map=eventMaps.get(target);if(!map){map=new Map();eventMaps.set(target,map);}return map;}
function on(target,type,listener){if(target.addEventListener)target.addEventListener(type,listener);else{const map=eventMap(target);if(!map.has(type))map.set(type,new Set());map.get(type).add(listener);}}
function off(target,type,listener){if(target.removeEventListener)target.removeEventListener(type,listener);else eventMaps.get(target)?.get(type)?.delete(listener);}
function signal(target,type,...args){for(const listener of [...eventMaps.get(target)?.get(type)||[]])listener(...args);}

export function VimPosition(line,ch){this.line=line;this.ch=ch;}

/** Token stream used by the upstream Ex parser, including quoted/ranged input. */
export class VimStringStream {
  constructor(text,tabSize=4){this.string=String(text);this.pos=0;this.start=0;this.tabSize=tabSize;}
  eol(){return this.pos>=this.string.length;}
  sol(){return this.pos===0;}
  peek(){return this.string.charAt(this.pos)||undefined;}
  next(){if(this.pos<this.string.length)return this.string.charAt(this.pos++);}
  eat(match){const ch=this.peek(),matched=typeof match==='string'?ch===match:typeof match==='function'?match(ch):!!ch&&match.test(ch);if(matched){this.pos++;return ch;}}
  eatWhile(match){const start=this.pos;while(this.eat(match)){}return this.pos>start;}
  eatSpace(){return this.eatWhile(/[\s\u00a0]/);}
  skipToEnd(){this.pos=this.string.length;}
  skipTo(ch){const found=this.string.indexOf(ch,this.pos);if(found>=0){this.pos=found;return true;}}
  backUp(amount){this.pos=Math.max(0,this.pos-amount);}
  column(){return visualColumn(this.string,this.start,this.tabSize);}
  indentation(){return visualColumn(this.string,/^\s*/.exec(this.string)[0].length,this.tabSize);}
  match(pattern,consume=true,caseInsensitive=false){
    if(typeof pattern==='string'){const actual=this.string.slice(this.pos,this.pos+pattern.length),equal=caseInsensitive?actual.toLowerCase()===pattern.toLowerCase():actual===pattern;if(equal&&consume)this.pos+=pattern.length;return equal;}
    const flags=pattern.flags.replace(/[gy]/g,''),match=new RegExp(pattern.source,flags).exec(this.string.slice(this.pos));if(!match||match.index!==0)return null;if(consume)this.pos+=match[0].length;return match;
  }
  current(){return this.string.slice(this.start,this.pos);}
}

function visualColumn(text,index,tabSize){let col=0;for(let i=0;i<Math.min(index,text.length);i++)col=text[i]==='\t'?col+tabSize-col%tabSize:col+1;return col;}
function characterAtColumn(text,column,tabSize){let col=0,index=0;while(index<text.length){const next=text[index]==='\t'?col+tabSize-col%tabSize:col+1;if(next>column)break;col=next;index++;}return index;}
function transformOffset(offset,start,end,length,assoc=1){if(offset<start||offset===start&&assoc<0)return offset;if(offset>end||offset===end&&assoc>0)return offset+length-(end-start);return start+(assoc<0?0:length);}

class VimMarker {
  constructor(cm,offset,insertLeft=false){this.cm=cm;this.id=++cm.$mid;this.offset=offset;this.assoc=insertLeft?1:-1;cm._markers.add(this);}
  clear(){this.offset=null;this.cm._markers.delete(this);}
  find(){return this.offset===null||this.cm.disposed?null:this.cm.posFromIndex(this.offset);}
  update(change){if(this.offset!==null)this.offset=transformOffset(this.offset,change.start,change.end,change.text.length,this.assoc);}
}

class VimSearchCursor {
  constructor(cm,query,position){
    this.cm=cm;this.regex=query instanceof RegExp?new RegExp(query.source,[...new Set(query.flags.replace(/y/g,'')+'gm')].join('')):new RegExp(escapeRegExp(query),'gm');
    this.index=cm.indexFromPos(position||new VimPosition(0,0));this.start=this.end=null;this.match=null;this.lastDirection=0;
  }
  find(back=false){return back?this.findPrevious():this.findNext();}
  findNext(){
    const text=this.cm.getValue();let index=this.end===null?this.index:this.end;if(this.lastDirection===1&&this.start===this.end){if(index>=text.length)return this.fail(1);index=nextCodePoint(text,index);}
    this.regex.lastIndex=index;const match=this.regex.exec(text);return match?this.accept(match,1):this.fail(1);
  }
  findPrevious(){
    const text=this.cm.getValue(),limit=this.start===null?this.index:this.start;this.regex.lastIndex=0;let match,last=null;
    while((match=this.regex.exec(text))){if(match.index+match[0].length>limit||this.lastDirection===-1&&match.index===limit)break;last=match;if(!match[0].length){if(this.regex.lastIndex>=text.length)break;this.regex.lastIndex=nextCodePoint(text,this.regex.lastIndex);}}
    return last?this.accept(last,-1):this.fail(-1);
  }
  accept(match,direction){this.match=match;this.start=match.index;this.end=match.index+match[0].length;this.lastDirection=direction;return match;}
  fail(direction){this.match=null;this.lastDirection=direction;return null;}
  from(){return this.start===null?undefined:this.cm.posFromIndex(this.start);}
  to(){return this.end===null?undefined:this.cm.posFromIndex(this.end);}
  replace(text){if(this.start===null||this.end===null)return;this.cm.replaceRange(text,this.from(),this.to());this.end=this.start+String(text).length;this.index=this.end;}
}

export class VimAdapter {
  constructor(host){
    this.host=host;this.state={};this.options={firstLineNumber:1,tabSize:4,indentUnit:4,indentWithTabs:false,mode:host.language||'vb6',keyMap:'vim',...host.options};
    this.marks={};this.$mid=0;this._markers=new Set();this._lineHandles=new Set();this._input={};this._text=String(host.getText());this._selections=this.normalizeSelections(host.getSelections?.()||[{anchor:0,head:0}]);this._primary=0;
    this._lines=null;this._starts=null;this.curOp=null;this._scroll={left:0,top:0};this._notifications=new Set();this.$lastChangeEndOffset=0;this._overlays=new Set();this._replaceStack=[];this.revision=0;this.disposed=false;
  }
  get cm6(){return this.host;}
  get _handlers(){return Object.fromEntries([...eventMap(this)].map(([key,value])=>[key,[...value]]));}
  on(type,listener){on(this,type,listener);}
  off(type,listener){off(this,type,listener);}
  signal(type,...args){signal(this,type,...args);}
  index(){if(this._lines)return;this._lines=this._text.split('\n');this._starts=new Uint32Array(this._lines.length);for(let i=1;i<this._lines.length;i++)this._starts[i]=this._starts[i-1]+this._lines[i-1].length+1;}
  normalizeSelections(selections){return (selections?.length?selections:[{anchor:0,head:0}]).map(s=>({anchor:clamp(s.anchor,0,this._text.length),head:clamp(s.head,0,this._text.length)}));}
  indexFromPos(position){this.index();if(!position)return 0;if(position.line>=this._lines.length)return this._text.length;if(position.line<0)return 0;const line=Math.floor(clamp(position.line,0,this._lines.length-1));return this._starts[line]+clamp(position.ch,0,this._lines[line].length);}
  posFromIndex(offset){this.index();offset=clamp(offset,0,this._text.length);let lo=0,hi=this._starts.length;while(lo+1<hi){const mid=(lo+hi)>>>1;if(this._starts[mid]<=offset)lo=mid;else hi=mid;}return new VimPosition(lo,offset-this._starts[lo]);}
  clipPos(position){return this.posFromIndex(this.indexFromPos(position));}
  firstLine(){return 0;}
  lastLine(){return this.lineCount()-1;}
  lineCount(){this.index();return this._lines.length;}
  getLine(line){this.index();return this._lines[line]??'';}
  getValue(){return this._text;}
  setValue(text){this.replaceRange(String(text),new VimPosition(0,0),this.posFromIndex(this._text.length),'setValue');}
  getRange(start,end){return this._text.slice(this.indexFromPos(start),this.indexFromPos(end));}
  getCursor(which='head'){
    const selection=this._selections[Math.min(this._primary,this._selections.length-1)],index=which==='anchor'?selection.anchor:which==='start'?Math.min(selection.anchor,selection.head):which==='end'?Math.max(selection.anchor,selection.head):selection.head;return this.posFromIndex(index);
  }
  setCursor(line,ch){const position=typeof line==='object'?line:new VimPosition(line,ch);this.setSelection(position,position);}
  listSelections(){return this._selections.map(s=>{const anchor=this.posFromIndex(s.anchor),head=this.posFromIndex(s.head);return {anchor,head,from:()=>s.anchor<=s.head?anchor:head,to:()=>s.anchor<=s.head?head:anchor,empty:()=>s.anchor===s.head};});}
  setSelection(anchor,head=anchor){this.setSelections([{anchor,head}]);}
  setSelections(selections,primary=0){return this.operation(()=>{const values=this.normalizeSelections(selections.map(s=>({anchor:this.indexFromPos(s.anchor),head:this.indexFromPos(s.head)})));if(!sameSelections(values,this._selections)){this._selections=values;this.curOp.cursorActivity=true;this.revision++;}this._primary=clamp(primary,0,values.length-1);});}
  getSelection(separator='\n'){return this.getSelections().join(separator);}
  getSelections(){return this._selections.map(s=>this._text.slice(Math.min(s.anchor,s.head),Math.max(s.anchor,s.head)));}
  somethingSelected(){return this._selections.some(s=>s.anchor!==s.head);}
  replaceRange(text,from,to=from,origin='+input'){
    if(this.getOption('readOnly')&&!this._adopting)return;
    return this.operation(()=>{
      text=String(text);const start=this.indexFromPos(from),end=this.indexFromPos(to);if(start>end)throw new RangeError('Vim edit range is reversed.');const removed=this._text.slice(start,end);if(removed===text)return;
      const change={from:this.posFromIndex(start),to:this.posFromIndex(end),text:text.split('\n'),removed:removed.split('\n'),origin},transform={start,end,text};
      this._text=this._text.slice(0,start)+text+this._text.slice(end);this._lines=null;this._starts=null;this.revision++;
      for(const marker of this._markers)marker.update(transform);
      for(const handle of this._lineHandles)if(handle.offset!==null)handle.offset=end>start&&handle.offset>=start&&handle.offset<end?null:transformOffset(handle.offset,start,end,text.length,1);
      this._selections=this._selections.map(s=>({anchor:transformOffset(s.anchor,start,end,text.length),head:transformOffset(s.head,start,end,text.length)}));this.$lastChangeEndOffset=start+text.length;
      this.curOp.changes.push(change);this.curOp.cursorActivity=true;this.curOp.lastChange=change;
      // Core insert listeners must observe the mode at the time of the edit.
      // In particular, `o` changes the document before entering Insert, and
      // replayed macro edits occur while the engine suppresses recording.
      this.signal('change',this,change);
    });
  }
  replaceSelection(text,collapse='end',origin='+input'){return this.replaceSelections([text],collapse,origin);}
  replaceSelections(replacements,collapse='end',origin='+input'){
    if(this.getOption('readOnly'))return;
    return this.operation(()=>{
      const edits=this._selections.map((s,index)=>({index,start:Math.min(s.anchor,s.head),end:Math.max(s.anchor,s.head),text:String(replacements[index]??replacements[0]??'')})).sort((a,b)=>b.start-a.start||b.end-a.end);
      const result=[];
      for(const edit of edits){const begin=this.posFromIndex(edit.start),end=this.posFromIndex(edit.end);this.replaceRange(edit.text,begin,end,origin);for(const value of result){value.anchor=transformOffset(value.anchor,edit.start,edit.end,edit.text.length);value.head=transformOffset(value.head,edit.start,edit.end,edit.text.length);}result.push({index:edit.index,anchor:collapse==='around'?edit.start:collapse==='start'?edit.start:edit.start+edit.text.length,head:collapse==='start'?edit.start:edit.start+edit.text.length});}
      this._selections=result.sort((a,b)=>a.index-b.index).map(copySelection);this.curOp.cursorActivity=true;
    });
  }
  operation(callback){
    const previousAdapter=activeAdapter;activeAdapter=this;
    if(this.curOp){this.curOp.$d++;try{return callback();}finally{this.curOp.$d--;activeAdapter=previousAdapter;}}
    const op=this.curOp={$d:1,changes:[],cursorActivity:false,isVimOp:false};let result;
    try{result=callback();this.flush(op);return result;}finally{this.curOp=null;activeAdapter=previousAdapter;}
  }
  flush(op){
    this._flushing=true;
    try{
      if(!this.disposed){
        if(this.host.getText()!==this._text)this.host.apply(this._text,this._selections.map(copySelection),{origin:this.state.vim?.insertMode?'typing':'vim',kind:this.state.vim?.insertMode?'typing':'command'});
        else if(!sameSelections(this.normalizeSelections(this.host.getSelections?.()||[]),this._selections))this.host.setSelections(this._selections.map(copySelection));
      }
      if(op.changes.length)this.signal('changes',this,op.changes);
      if(op.cursorActivity)this.signal('cursorActivity',this);
    }finally{this._flushing=false;}
  }
  sync(change={}){
    if(this.disposed||this._flushing)return;
    const text=String(this.host.getText()),selections=this.host.getSelections?.()||this._selections;
    if(text===this._text&&sameSelections(this.normalizeSelections(selections),this._selections))return;
    this._adopting=true;
    try{return this.operation(()=>{
      if(text!==this._text){let start=0,end=this._text.length,nextEnd=text.length;while(start<end&&start<nextEnd&&this._text[start]===text[start])start++;while(end>start&&nextEnd>start&&this._text[end-1]===text[nextEnd-1]){end--;nextEnd--;}
        this.replaceRange(text.slice(start,nextEnd),this.posFromIndex(start),this.posFromIndex(end),change.origin||'+input');}
      const values=this.normalizeSelections(selections);if(!sameSelections(values,this._selections)){this._selections=values;this.curOp.cursorActivity=true;this.revision++;}
    });}finally{this._adopting=false;}
  }
  setBookmark(position,options={}){return new VimMarker(this,this.indexFromPos(position),options.insertLeft);}
  getLineHandle(row){const offset=this.indexFromPos(new VimPosition(row,0)),handle={row,index:offset,offset};this._lineHandles.add(handle);return handle;}
  getLineNumber(handle){if(!handle||handle.offset===null||!this._lineHandles.has(handle))return null;const pos=this.posFromIndex(handle.offset);return pos.ch===0?pos.line:null;}
  releaseLineHandles(){this._lineHandles.clear();}
  getLastEditEnd(){return this.posFromIndex(this.$lastChangeEndOffset);}
  getSearchCursor(query,position){return new VimSearchCursor(this,query,position);}
  addOverlay(overlay){this._overlays.add(overlay);this.host.setSearchOverlay?.(overlay);}
  removeOverlay(overlay){this._overlays.delete(overlay);if(!this._overlays.size)this.host.setSearchOverlay?.(null);}
  getInputField(){return this._input;}
  getWrapperElement(){return this.host.root||this.host.input?.parentElement;}
  getMode(){return {name:this.getOption('mode')};}
  getOption(name){if(name==='readOnly')return !!this.host.readOnly||!!this.host.composing;if(['tabSize','indentUnit','indentWithTabs'].includes(name))return this.options[name]??this.host.options?.[name];return this.options[name];}
  setOption(name,value){this.options[name]=value;this.host.setOption?.(name,value);}
  toggleOverwrite(value){if(this.state.overwrite!==!!value)this._replaceStack.length=0;this.state.overwrite=!!value;this.host.setOverwrite?.(!!value);}
  focus(){this.host.focus?.();}
  blur(){this.host.blur?.();}
  setSize(width,height){this.host.setSize?.(width,height);}
  refresh(){this.host.refresh?.();}
  defaultTextHeight(){return Number(this.host.options?.lineHeight)||18;}
  getScrollInfo(){const supplied=this.host.getScrollInfo?.();return {left:this._scroll.left,top:this._scroll.top,height:this.lineCount()*this.defaultTextHeight(),width:800,clientHeight:this.defaultTextHeight()*(this.host.options?.viewportLines||24),clientWidth:800,...supplied};}
  scrollTo(left,top){if(left!=null)this._scroll.left=Math.max(0,left);if(top!=null)this._scroll.top=Math.max(0,top);this.host.scrollTo?.(left,top);}
  scrollIntoView(position,margin){if(position?.from)this.host.scrollIntoView?.({from:this.indexFromPos(position.from),to:this.indexFromPos(position.to||position.from)},margin);else this.host.scrollIntoView?.(this.indexFromPos(position||this.getCursor()),margin);}
  charCoords(position,mode='local'){
    const supplied=this.host.charCoords?.(this.indexFromPos(position),mode);if(supplied)return supplied;position=this.clipPos(position);const height=this.defaultTextHeight(),width=Number(this.host.options?.charWidth)||8;return {left:visualColumn(this.getLine(position.line),position.ch,this.getOption('tabSize'))*width,top:position.line*height,bottom:(position.line+1)*height};
  }
  coordsChar(coords,mode='local'){
    const supplied=this.host.coordsChar?.(coords,mode);if(supplied!==undefined)return typeof supplied==='number'?this.posFromIndex(supplied):supplied;const line=clamp(Math.floor(coords.top/this.defaultTextHeight()),0,this.lastLine()),column=Math.round(coords.left/(Number(this.host.options?.charWidth)||8));return new VimPosition(line,characterAtColumn(this.getLine(line),column,this.getOption('tabSize')));
  }
  findPosV(start,amount,unit,goalColumn){
    const size=unit==='page'?Math.max(1,Math.floor(this.getScrollInfo().clientHeight/this.defaultTextHeight())-2):1,target=start.line+amount*size,line=clamp(target,0,this.lastLine());
    const column=goalColumn===undefined?visualColumn(this.getLine(start.line)||'',start.ch,this.getOption('tabSize')):goalColumn/(Number(this.host.options?.charWidth)||8);
    const result=new VimPosition(line,characterAtColumn(this.getLine(line),column,this.getOption('tabSize')));result.hitSide=target!==line;return result;
  }
  moveH(amount,unit='char'){
    let offset=this.indexFromPos(this.getCursor());for(let i=0;i<Math.abs(amount);i++){if(unit==='word'){const direction=amount<0?-1:1;let p=offset;if(direction>0){while(p<this._text.length&&wordChar(this._text[p]))p++;while(p<this._text.length&&!wordChar(this._text[p]))p++;}else{while(p>0&&!wordChar(this._text[p-1]))p--;while(p>0&&wordChar(this._text[p-1]))p--;}offset=p;}else offset=amount<0?previousCodePoint(this._text,offset):nextCodePoint(this._text,offset);}this.setCursor(this.posFromIndex(offset));
  }
  indentLine(line,more){
    const text=this.getLine(line);if(text===undefined)return;const width=Number(this.getOption('indentUnit'))||4,tab=Number(this.getOption('tabSize'))||4,indent=/^[ \t]*/.exec(text)[0],current=visualColumn(indent,indent.length,tab);
    let target;if(more===undefined||more==='smart'){const previous=line>0?this.getLine(line-1):'';target=visualColumn(previous,/^[ \t]*/.exec(previous)[0].length,tab);if(/[({[]\s*$/.test(previous))target+=width;if(/^\s*[})\]]/.test(text))target=Math.max(0,target-width);}else target=Math.max(0,current+(more===true||more==='add'?width:-width));
    const replacement=this.getOption('indentWithTabs')?'\t'.repeat(Math.floor(target/tab))+' '.repeat(target%tab):' '.repeat(target);this.replaceRange(replacement,new VimPosition(line,0),new VimPosition(line,indent.length));
  }
  selectedLines(){const result=new Set();for(const s of this.listSelections()){const a=s.from(),b=s.to(),end=b.line-(b.ch===0&&b.line>a.line?1:0);for(let line=a.line;line<=end;line++)result.add(line);}return [...result].sort((a,b)=>a-b);}
  indentMore(){this.operation(()=>{for(const line of this.selectedLines())this.indentLine(line,true);});}
  indentLess(){this.operation(()=>{for(const line of this.selectedLines())this.indentLine(line,false);});}
  hardWrap({from,to,column=this.state.textwidth||this.getOption('textwidth')||80,allowMerge=true}){
    const first=typeof from==='object'?from.line:from,last=typeof to==='object'?to.line:to;const lines=[];let paragraph=[];
    const flush=()=>{if(!paragraph.length)return;const indent=/^\s*/.exec(paragraph[0])[0],words=(allowMerge?paragraph.map(s=>s.trim()).join(' '):paragraph[0].trim()).split(/\s+/);let line=indent;for(const word of words){if(line.trim()&&line.length+1+word.length>column){lines.push(line);line=indent+word;}else line+=(line.trim()?' ':'')+word;}lines.push(line);paragraph=[];};
    for(let line=first;line<=last;line++){const text=this.getLine(line)||'';if(!text.trim()){flush();lines.push(text);}else{paragraph.push(text);if(!allowMerge)flush();}}flush();this.replaceRange(lines.join('\n'),new VimPosition(first,0),new VimPosition(last,(this.getLine(last)||'').length));return first+lines.length-1;
  }
  getTokenTypeAt(position){
    if(this.host.getTokenTypeAt)return this.host.getTokenTypeAt(this.indexFromPos(position));const line=this.getLine(position.line)||'',limit=Math.min(line.length,position.ch),mode=String(this.getOption('mode')||'').toLowerCase(),vb=/vb|basic/.test(mode);let quote=null;
    for(let i=0;i<limit;i++){const ch=line[i];if(quote){if(ch===quote){if(vb&&line[i+1]===quote)i++;else quote=null;}else if(!vb&&ch==='\\')i++;}else if(ch==='"'||!vb&&(ch==="'"||ch==='`'))quote=ch;else if(vb&&ch==="'"||!vb&&ch==='/'&&line[i+1]==='/')return 'comment';}
    return quote?'string':'';
  }
  scanForBracket(position,direction,style,config={}){
    const regex=config.bracketRegex||/[(){}[\]]/,text=this._text,pairs={'(':')','[':']','{':'}',')':'(',']':'[','}':'{'},stack=[];let offset=this.indexFromPos(position);
    if(direction<0)offset--;for(;offset>=0&&offset<text.length;offset+=direction){const ch=text[offset];regex.lastIndex=0;if(!regex.test(ch)||!pairs[ch])continue;const at=this.posFromIndex(offset);if(style!==undefined&&style!==null&&this.getTokenTypeAt(new VimPosition(at.line,at.ch+1))!==style)continue;const opening='([{'.includes(ch);if(opening===(direction>0))stack.push(ch);else if(!stack.length)return {pos:at,ch};else if(pairs[stack.pop()]!==ch)return null;}return false;
  }
  findMatchingBracket(position,options={}){
    let offset=this.indexFromPos(position),ch=this._text[offset];if(!'()[]{}'.includes(ch||'')&&offset>0){offset--;ch=this._text[offset];}if(!ch||!'()[]{}'.includes(ch))return {to:undefined};const direction='([{'.includes(ch)?1:-1,from=this.posFromIndex(offset),start=this.posFromIndex(offset+(direction>0?1:0)),style=this.getTokenTypeAt(new VimPosition(from.line,from.ch+1)),match=this.scanForBracket(start,direction,style,options),pairs={'(':')','[':']','{':'}',')':'(',']':'[','}':'{'};return match&&match.ch===pairs[ch]?{from,to:match.pos,match:true,forward:direction>0}:{from,to:undefined,match:false};
  }
  foldCode(position){this.host.execute?.('fold',{offset:this.indexFromPos(position)});}
  execCommand(name){const command=VimAdapter.commands[name];if(command)return this.operation(()=>command(this));return this.host.execute?.(name);}
  openDialog(template,callback,options={}){
    const wrap=fn=>typeof fn==='function'?(...args)=>this.operation(()=>{this.curOp.isVimOp=true;return fn(...args);}):fn;
    const close=this.host.openDialog?.(template,wrap(callback),{...options,onKeyDown:wrap(options.onKeyDown),onKeyUp:wrap(options.onKeyUp),onClose:wrap(options.onClose)})||(()=>{});this._notifications.add(close);return value=>{if(typeof value!=='string')this._notifications.delete(close);return close(value);};
  }
  openNotification(template,options={}){const close=this.host.openNotification?.(template,options)||(()=>{});this._notifications.add(close);return ()=>{this._notifications.delete(close);close();};}
  isInMultiSelectMode(){return this._selections.length>1;}
  virtualSelectionMode(){return false;}
  forEachSelection(command){
    if(this._selections.length<=1)return command(this);
    return this.operation(()=>{const saved=this._selections.map(s=>({anchor:new VimMarker(this,s.anchor,true),head:new VimMarker(this,s.head)})),result=[];this.inVirtualSelectionMode=true;
      try{for(const range of saved){this._selections=[{anchor:range.anchor.offset,head:range.head.offset}];this.virtualSelection=this._selections[0];command(this);for(const s of this._selections)result.push({anchor:new VimMarker(this,s.anchor,true),head:new VimMarker(this,s.head)});}this._selections=result.map(s=>({anchor:s.anchor.offset,head:s.head.offset}));this.curOp.cursorActivity=true;}
      finally{for(const range of [...saved,...result]){range.anchor.clear();range.head.clear();}this.virtualSelection=null;this.inVirtualSelectionMode=false;}
    });
  }
  overWriteSelection(text){this.operation(()=>{
    const beforeText=this._text,before=this._selections.map(copySelection),selections=this._selections.map(s=>{let end=Math.max(s.anchor,s.head);if(s.anchor===s.head&&this._text[end]!=='\n')end=nextCodePoint(this._text,end);return {anchor:this.posFromIndex(Math.min(s.anchor,s.head)),head:this.posFromIndex(end)};});
    const replaced=selections.map(s=>this.getRange(s.anchor,s.head));this.setSelections(selections);this.replaceSelections(selections.map(()=>text));this._replaceStack.push({beforeText,before,afterText:this._text,after:this._selections.map(copySelection),replaced,text:String(text)});
  });}
  backspaceOverwrite(){
    const last=this._replaceStack.at(-1);
    if(!last||last.afterText!==this._text||!sameSelections(last.after,this._selections)){this.moveH(-1);return;}
    this._replaceStack.pop();this.operation(()=>{this.setSelections(this._selections.map(s=>({anchor:this.posFromIndex(Math.max(0,s.head-last.text.length)),head:this.posFromIndex(s.head)})));this.replaceSelections(last.replaced,'end','+delete');this.setSelections(last.before.map(s=>({anchor:this.posFromIndex(s.anchor),head:this.posFromIndex(s.head)})));});
  }
  save(){return this.host.execute?.('save');}
  onBeforeEndOperation(){}
  onChange(){this.sync();}
  onSelectionChange(){this.sync();}
  destroy(){if(this.disposed)return;this.disposed=true;for(const marker of [...this._markers])marker.clear();this._lineHandles.clear();for(const close of this._notifications)close();this._notifications.clear();this.host.setSearchOverlay?.(null);eventMaps.delete(this);eventMaps.delete(this._input);}
}

function deleteInput(cm,backward,word=false){
  const ranges=cm._selections.map(s=>{
    let start=Math.min(s.anchor,s.head),end=Math.max(s.anchor,s.head);
    if(start===end){
      if(backward){start=previousCodePoint(cm._text,start);if(word){while(start>0&&/\s/.test(cm._text[start]))start--;while(start>0&&wordChar(cm._text[start-1]))start--;}}
      else{end=nextCodePoint(cm._text,end);if(word){while(end<cm._text.length&&wordChar(cm._text[end]))end++;while(end<cm._text.length&&/\s/.test(cm._text[end]))end++;}}
    }
    return {anchor:cm.posFromIndex(start),head:cm.posFromIndex(end)};
  });cm.setSelections(ranges);cm.replaceSelections(ranges.map(()=>''));
}
function newline(cm){const texts=cm._selections.map(s=>{const position=cm.posFromIndex(Math.min(s.anchor,s.head)),before=cm.getLine(position.line).slice(0,position.ch);return '\n'+/^[ \t]*/.exec(before)[0];});cm.replaceSelections(texts);}
function tagsAround(cm,position,onlyAt=false){
  const text=cm.getValue(),offset=cm.indexFromPos(position),tokens=/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(!?\/?)([\w:.-]+)\b(?:"[^"]*"|'[^']*'|[^'">])*\/?>/g,stack=[],pairs=[];let match;
  while((match=tokens.exec(text))){if(!match[2]||match[1]==='!'||/\/>$/.test(match[0]))continue;const token={name:match[2],start:match.index,end:tokens.lastIndex};if(match[1]==='/'){let i=stack.length-1;while(i>=0&&stack[i].name!==token.name)i--;if(i>=0){const open=stack[i];stack.length=i;pairs.push({open,close:token});}}else stack.push(token);}
  const found=pairs.filter(p=>onlyAt?offset>=p.open.start&&offset<p.open.end||offset>=p.close.start&&offset<p.close.end:offset>=p.open.start&&offset<=p.close.end).sort((a,b)=>(a.close.end-a.open.start)-(b.close.end-b.open.start))[0];
  if(!found)return;return {open:{from:cm.posFromIndex(found.open.start),to:cm.posFromIndex(found.open.end)},close:{from:cm.posFromIndex(found.close.start),to:cm.posFromIndex(found.close.end)}};
}

VimAdapter.Pos=VimPosition;
VimAdapter.StringStream=VimStringStream;
VimAdapter.isWordChar=wordChar;
VimAdapter.isMac=typeof navigator!=='undefined'&&/Mac|iPhone|iPad/.test(navigator.platform||'');
VimAdapter.on=on;
VimAdapter.off=off;
VimAdapter.signal=signal;
VimAdapter.e_stop=event=>{event.preventDefault?.();event.stopPropagation?.();};
VimAdapter.e_preventDefault=event=>event.preventDefault?.();
VimAdapter.keyName=event=>{const key=({Backspace:'Backspace',Delete:'Delete',ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',Enter:'Enter',Escape:'Esc',' ':'Space'})[event.key]||event.key;return (event.ctrlKey?'Ctrl-':'')+(event.altKey?'Alt-':'')+(event.metaKey?'Cmd-':'')+(event.shiftKey&&key.length>1?'Shift-':'')+key;};
VimAdapter.findMatchingTag=(cm,pos)=>tagsAround(cm,pos,true);
VimAdapter.findEnclosingTag=(cm,pos)=>tagsAround(cm,pos);
VimAdapter.commands={
  undo:cm=>{if(cm.getOption('readOnly'))return;cm.host.undo?.();cm.sync({origin:'undo'});},
  redo:cm=>{if(cm.getOption('readOnly'))return;cm.host.redo?.();cm.sync({origin:'redo'});},
  save:cm=>cm.save(),
  newlineAndIndent:newline,
  indentAuto:cm=>{for(const line of cm.selectedLines())cm.indentLine(line);},
  indentMore:cm=>cm.indentMore(),indentLess:cm=>cm.indentLess(),
  insertTab:cm=>cm.replaceSelections(cm._selections.map(s=>cm.getOption('indentWithTabs')?'\t':' '.repeat(cm.getOption('tabSize')-visualColumn(cm.getLine(cm.posFromIndex(s.head).line),cm.posFromIndex(s.head).ch,cm.getOption('tabSize'))%cm.getOption('tabSize')))),
  delCharBefore:cm=>deleteInput(cm,true),delCharAfter:cm=>deleteInput(cm,false),delWordBefore:cm=>deleteInput(cm,true,true),delWordAfter:cm=>deleteInput(cm,false,true),
  goCharLeft:cm=>cm.moveH(-1),goCharRight:cm=>cm.moveH(1),cursorCharLeft:cm=>cm.moveH(-1),
  goLineLeft:cm=>cm.setCursor(cm.getCursor().line,0),goLineRight:cm=>cm.setCursor(cm.getCursor().line,cm.getLine(cm.getCursor().line).length),
  goLineUp:cm=>cm.setCursor(cm.findPosV(cm.getCursor(),-1,'line')),goLineDown:cm=>cm.setCursor(cm.findPosV(cm.getCursor(),1,'line')),
  toggleLineComment:cm=>{const lines=cm.selectedLines(),uncomment=lines.every(line=>/^\s*'/.test(cm.getLine(line)));for(const line of lines){const text=cm.getLine(line),start=/^\s*/.exec(text)[0].length;cm.replaceRange(uncomment?'':"'",new VimPosition(line,start),new VimPosition(line,start+(uncomment?1:0)));}},
};
const insertBindings={Enter:'newlineAndIndent',Tab:'insertTab',Backspace:'delCharBefore',Delete:'delCharAfter','Ctrl-Backspace':'delWordBefore','Ctrl-Delete':'delWordAfter',Left:'goCharLeft',Right:'goCharRight',Up:'goLineUp',Down:'goLineDown',Home:'goLineLeft',End:'goLineRight'};
VimAdapter.lookupKey=(key,map,handler)=>{const binding=insertBindings[key];return binding?handler(binding):false;};

function clipboardNotification(cm,message){
  if(cm.disposed)return;const doc=cm.host.root?.ownerDocument||globalThis.document;if(!doc){cm.host.notify?.(message);return;}const node=doc.createElement('div');node.textContent=message;node.setAttribute('class','cm-vim-message');cm.openNotification(node,{bottom:true,duration:4500});
}
VimAdapter.vimClipboardWrite=(text,registerName)=>{
  const cm=activeAdapter;if(!cm||cm.disposed)return;let write;
  try{write=cm.host.writeClipboard?cm.host.writeClipboard(text):globalThis.navigator?.clipboard?.writeText?.(text);}catch{clipboardNotification(cm,'Clipboard access failed. Text remains in register "'+registerName+'.');return;}
  if(write&&typeof write.then==='function')write.catch(()=>clipboardNotification(cm,'Clipboard access failed. Text remains in register "'+registerName+'.'));
};
VimAdapter.vimClipboardRead=(cm,register,callback)=>{
  if(cm.disposed||cm.getOption('readOnly'))return;
  // Browser clipboard reads are asynchronous. A recorded macro is synchronous,
  // so it uses the last explicitly read/yanked clipboard register immediately.
  if(Vim.getVimGlobalState_().macroModeState.isPlaying){callback(register.toString());return;}
  const source=cm.getValue(),selections=cm._selections.map(copySelection),revision=cm.revision;
  const current=()=>!cm.disposed&&!cm.getOption('readOnly')&&cm.host.isActive?.()!==false&&cm.host.getText()===source&&cm.revision===revision&&sameSelections(cm.normalizeSelections(cm.host.getSelections?.()||cm._selections),selections);
  let read;try{read=cm.host.readClipboard?cm.host.readClipboard():globalThis.navigator?.clipboard?.readText?.();}catch(error){read=Promise.reject(error);}
  cm.pendingClipboard=Promise.resolve(read).then(value=>value===undefined?register.toString():String(value),()=>{clipboardNotification(cm,'Clipboard access failed. Using the saved clipboard register.');return register.toString();}).then(value=>{if(current())cm.operation(()=>{cm.curOp.isVimOp=true;if(value!==register.toString())register.setText(value,/\n$/.test(value),false);callback(value);});else if(!cm.disposed)clipboardNotification(cm,'Clipboard paste cancelled because the editor changed.');}).catch(error=>clipboardNotification(cm,error?.message||'Clipboard paste failed.'));
  return cm.pendingClipboard;
};

/** Shared engine state intentionally provides cross-buffer registers and macros. */
export const Vim=initVim(VimAdapter);
Vim.setOption('pcre',false);
for(const [name,alias,option,defaultValue]of [['tabstop','ts','tabSize',4],['shiftwidth','sw','indentUnit',4],['softtabstop','sts','softTabSize',0]]){
  let globalValue=defaultValue;Vim.defineOption(name,defaultValue,'number',[alias],(value,cm)=>{if(value===undefined)return cm?cm.getOption(option)??globalValue:globalValue;const number=Number(value);if(!Number.isFinite(number)||number<0||number>256)return;const valid=name==='softtabstop'?number:Math.max(1,number);if(cm)cm.setOption(option,valid);else globalValue=valid;});
}
let expandTab=true;
Vim.defineOption('expandtab',true,'boolean',['et'],(value,cm)=>{if(value===undefined)return cm?!cm.getOption('indentWithTabs'):expandTab;if(cm)cm.setOption('indentWithTabs',!value);else expandTab=value;});

export function createVimSession(host,{onStatus=()=>{}}={}){
  const adapter=new VimAdapter(host);let disposed=false;
  const snapshot=()=>{const vim=adapter.state.vim||{},global=Vim.getVimGlobalState_(),recording=global.macroModeState?.isRecording?global.macroModeState.latestRegister:null;return {mode:vim.insertMode?adapter.state.overwrite?'replace':'insert':vim.visualMode?'visual':'normal',subMode:vim.visualMode?vim.visualBlock?'blockwise':vim.visualLine?'linewise':'':'',keyBuffer:vim.inputState?.keyBuffer?.join('')||'',status:vim.status||'',recording,selections:adapter._selections.map(copySelection)};};
  const changed=()=>onStatus(snapshot());adapter.on('vim-mode-change',changed);adapter.on('vim-command-done',changed);adapter.on('cursorActivity',changed);adapter.on('change',changed);Vim.enterVimMode(adapter);changed();
  return {
    adapter,
    get state(){return snapshot();},
    keyFromEvent(event){return Vim.vimKeyFromEvent(event,adapter.state.vim);},
    handleKey(key,event){
      if(disposed||!key||event?.isComposing)return false;adapter.sync();let handled=false;
      adapter.operation(()=>{
        adapter.curOp.isVimOp=true;if(event)signal(adapter._input,'keydown',event);const vim=adapter.state.vim;if(vim)vim.status=(vim.status||'')+key;
        handled=!!Vim.multiSelectHandleKey(adapter,key,'user');
        if(!handled&&adapter.state.vim?.insertMode&&(adapter.isInMultiSelectMode()||adapter.state.overwrite)){
          if(key.length===1){if(adapter.state.overwrite)adapter.overWriteSelection(key);else adapter.replaceSelections(adapter._selections.map(()=>key));handled=true;}
          else{const plain=event?VimAdapter.keyName(event):({ '<CR>':'Enter','<BS>':'Backspace','<Del>':'Delete','<Tab>':'Tab','<Left>':'Left','<Right>':'Right','<Up>':'Up','<Down>':'Down','<Home>':'Home','<End>':'End'})[key],binding=insertBindings[plain];if(adapter.state.overwrite&&plain==='Backspace'){adapter.backspaceOverwrite();handled=true;}else if(binding){VimAdapter.commands[binding](adapter);handled=true;}}
        }
        if(handled)adapter.signal('vim-keypress',key);
      });changed();return handled;
    },
    insertText(text,{origin='paste'}={}){if(disposed||host.readOnly)return false;adapter.sync();adapter.operation(()=>{adapter.curOp.isVimOp=true;adapter.replaceSelections(adapter._selections.map(()=>String(text)),'end',origin);});changed();return true;},
    executeEx(command){if(disposed)return;adapter.sync();const result=adapter.operation(()=>{adapter.curOp.isVimOp=true;return Vim.handleEx(adapter,String(command).replace(/^:/,''));});changed();return result;},
    sync(change){if(disposed)return;adapter.sync(change);changed();},
    dispose(){if(disposed)return;disposed=true;if(adapter.state.vim?.insertMode)Vim.exitInsertMode(adapter,true);Vim.leaveVimMode(adapter);adapter.destroy();},
  };
}
