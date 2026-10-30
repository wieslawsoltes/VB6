import {positionAt, textChange,indexSource} from './projection.js';
import {procedures} from './language-service.js';

/** Update line/procedure indices by reparsing only affected physical lines.
 * UTF-16 offsets match textarea selection and VB source diagnostics.
 * Untouched line strings are shared. Work after the edit is an offset shift,
 * never a lexer/parser pass over the unchanged tail.
 */
export function updateSourceIndex(index, next, hint=null,language=index.language||'vb6') {
  next=String(next);
  const change=hint||textChange(index.text,next);
  if(index.text===next&&(index.language||'vb6')===language)return {index,change,changedProcedures:false,scannedLines:0};
  // Pascal's multiline comments and nested declarations can alter scopes far
  // beyond the edited physical line. Rebuild their lexical index atomically.
  if(language==='pascal'||index.language==='pascal'){const updated=indexSource(next,language);return {index:updated,change,changedProcedures:true,scannedLines:updated.lines.length};}
  const first=positionAt(index,change.start).line-1;
  const last=positionAt(index,change.oldEnd).line-1;
  const from=index.starts[first];
  const to=last+1<index.lines.length?index.starts[last+1]-1:index.text.length;
  const replacement=next.slice(from,to+change.delta).split('\n');
  const shift=replacement.length-(last-first+1);
  const lines=index.lines.slice(0,first).concat(replacement,index.lines.slice(last+1));
  const starts=new Uint32Array(lines.length);
  starts.set(index.starts.subarray(0,first));
  let offset=from;
  for(let i=first;i<lines.length;i++){starts[i]=offset;offset+=lines[i].length+1;}
  const inserted=procedures(replacement.join('\n')).map(p=>({...p,line:p.line+first}));
  const before=index.procedures.filter(p=>p.line<=first);
  const after=index.procedures.filter(p=>p.line>last+1).map(p=>shift?{...p,line:p.line+shift}:p);
  const updated=before.concat(inserted,after);
  const changedProcedures=shift!==0||JSON.stringify(inserted)!==JSON.stringify(index.procedures.filter(p=>p.line>first&&p.line<=last+1));
  return {index:{text:next,lines,starts,procedures:updated},change,changedProcedures,scannedLines:replacement.length};
}
export function replacementChange(start,end,length){return {start,oldEnd:end,newEnd:start+length,delta:length-(end-start)};}
export function inputChange(before,next,selection,caret){
  if(!selection||selection.composing)return null;
  let {start,end,type}=selection;
  const delta=next.length-before.length;
  if(/^insert(?:Text|FromPaste|FromDrop|LineBreak|Paragraph)$/.test(type)){
    const length=end-start+delta;
    if(length<0||caret!==start+length)return null;
    return replacementChange(start,end,length);
  }
  if(type==='deleteContentBackward'||type==='deleteContentForward'||type==='deleteByCut'){
    if(delta>0)return null;
    if(start===end){if(type==='deleteContentBackward')start=caret;end=start-delta;}
    if(end-start!==-delta||caret!==start)return null;
    return replacementChange(start,end,0);
  }
  return null;
}
export class HighlightCache {
  constructor(limit=2048,maxChars=2*1024*1024){this.limit=limit;this.maxChars=maxChars;this.map=new Map();this.chars=0;this.hits=0;this.misses=0;}
  get(key,make){if(this.map.has(key)){const value=this.map.get(key);this.map.delete(key);this.map.set(key,value);this.hits++;return value;}
    this.misses++;const value=make();if(key.length+value.length>this.maxChars/4)return value;
    this.map.set(key,value);this.chars+=key.length+value.length;
    while(this.map.size>this.limit||this.chars>this.maxChars){const first=this.map.keys().next().value;this.chars-=first.length+this.map.get(first).length;this.map.delete(first);}return value;}
  clear(){this.map.clear();this.chars=0;}
}
