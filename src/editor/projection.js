import {procedures} from './language-service.js';
/** UTF-16 offsets, as used by textarea selections and the source compiler. */
export function indexSource(text,language='vb6'){
  const source=String(text),lines=source.split('\n'),starts=new Uint32Array(lines.length);let offset=0;
  for(let i=0;i<lines.length;i++){starts[i]=offset;offset+=lines[i].length+1;}
  return {text:source,lines,starts,procedures:procedures(source,language),...(language!=='vb6'?{language}:{})};
}
export function positionAt(index,offset){
  const p=Math.max(0,Math.min(index.text.length,Number(offset)||0));let lo=0,hi=index.starts.length;
  while(lo+1<hi){const mid=(lo+hi)>>>1;if(index.starts[mid]<=p)lo=mid;else hi=mid;}
  return {line:lo+1,column:p-index.starts[lo]+1,offset:p};
}
export function offsetAt(index,line,column=1){const n=Math.max(0,Math.min(index.lines.length-1,Math.floor(Number(line)||1)-1));return index.starts[n]+Math.max(0,Math.min(index.lines[n].length,(Number(column)||1)-1));}
export function sourceRange(index,line=1,mode='module'){
  if(mode!=='procedure')return {start:0,end:index.text.length,firstLine:0,name:'(Full Module)'};
  let procedure=null,next=null;for(const p of index.procedures){if(p.line<=line)procedure=p;else{next=p;break;}}
  const firstLine=procedure?procedure.line-1:0,start=index.starts[firstLine],nextStart=next?index.starts[next.line-1]:index.text.length;
  // The separating newline belongs to neither projection. Keeping it outside
  // the editable span prevents a deletion from joining two procedure headers.
  const end=next&&nextStart>start?nextStart-1:nextStart;
  return {start,end:Math.max(start,end),firstLine,name:procedure?.name||'(Declarations)'};
}
export function replaceRange(source,range,replacement){return source.slice(0,range.start)+String(replacement)+source.slice(range.end);}
export function textChange(oldText,newText){let start=0;while(start<oldText.length&&start<newText.length&&oldText[start]===newText[start])start++;let oldEnd=oldText.length,newEnd=newText.length;while(oldEnd>start&&newEnd>start&&oldText[oldEnd-1]===newText[newEnd-1]){oldEnd--;newEnd--;}return {start,oldEnd,newEnd,delta:newText.length-oldText.length};}
export function mapOffset(change,offset){if(offset<=change.start)return offset;if(offset>=change.oldEnd)return offset+change.delta;return change.newEnd;}
