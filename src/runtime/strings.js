import {VBError} from '../language/lexer.js';
import {MISSING,VBArray,coerce,vbString} from './values.js';

const invalid=()=>{throw new VBError('Invalid procedure call or argument',5);};
const optional=(value,fallback)=>value===MISSING?fallback:value;
const integer=(value,fallback)=>coerce(optional(value,fallback),'Long');
function compare(value,frameMode,defaultMode=-1){
  const mode=integer(value,defaultMode);
  if(mode===-1)return frameMode==='text'?1:0;
  if(mode!==0&&mode!==1)invalid();
  return mode;
}
const literal=text=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Literal-only regexp keeps UTF-16 source positions intact. Text comparison is
 * invariant ECMAScript case folding, not a Windows LCID/collation implementation. */
function search(text,needle,mode){
  if(!mode)return start=>text.indexOf(needle,start);
  const re=new RegExp(literal(needle),'gi');
  return start=>{re.lastIndex=start;return re.exec(text)?.index??-1;};
}
function array(values){const result=VBArray.from(values);result.type='String';return result;}
function strings(value){
  if(!(value instanceof VBArray)||value.bounds.length!==1)throw new VBError('Type mismatch: expected a one-dimensional array',13);
  return Array.from(value,vbString);
}
function functions(frameMode){return {
  InStr(...args){
    let [start,string1,string2,comparison]=args.length===2?[MISSING,...args]:args;
    start=integer(start,1);if(start<1)invalid();const mode=compare(comparison,frameMode);
    if(string1===null||string2===null)return null;
    const text=vbString(string1),needle=vbString(string2);
    if(!text)return 0;if(!needle)return start;if(start>text.length)return 0;
    return search(text,needle,mode)(start-1)+1;
  },
  InStrRev(stringcheck,stringmatch,start,comparison){
    start=integer(start,-1);if(start< -1||start===0)invalid();const mode=compare(comparison,frameMode,0);
    if(stringcheck===null||stringmatch===null)return null;
    const text=vbString(stringcheck),needle=vbString(stringmatch);
    if(start===-1)start=text.length;if(!text||start>text.length)return 0;if(!needle)return start;
    const end=start-needle.length;if(end<0)return 0;
    if(!mode)return text.lastIndexOf(needle,end)+1;
    const find=search(text,needle,mode);let at=find(0),last=-1;
    while(at>=0&&at<=end){last=at;at=find(at+1);}return last+1;
  },
  Replace(expression,find,replacement,start,count,comparison){
    start=integer(start,1);count=integer(count,-1);if(start<1||count< -1)invalid();const mode=compare(comparison,frameMode);
    const text=vbString(expression).slice(start-1),needle=vbString(find),value=vbString(replacement);
    if(!needle||count===0)return text;
    const next=search(text,needle,mode),pieces=[];let pos=0,hits=0;
    while(count<0||hits<count){const at=next(pos);if(at<0)break;pieces.push(text.slice(pos,at),value);pos=at+needle.length;hits++;}
    pieces.push(text.slice(pos));return pieces.join('');
  },
  Split(expression,delimiter,limit,comparison){
    limit=integer(limit,-1);if(limit< -1)invalid();const mode=compare(comparison,frameMode);
    const text=vbString(expression),needle=vbString(optional(delimiter,' '));
    if(!text||limit===0)return array([]);if(!needle||limit===1)return array([text]);
    const next=search(text,needle,mode),parts=[];let pos=0;
    while(limit<0||parts.length<limit-1){const at=next(pos);if(at<0)break;parts.push(text.slice(pos,at));pos=at+needle.length;}
    parts.push(text.slice(pos));return array(parts);
  },
  Join(sourcearray,delimiter){return strings(sourcearray).join(vbString(optional(delimiter,' ')));},
  Filter(sourcearray,match,include,comparison){
    const mode=compare(comparison,frameMode),wanted=coerce(optional(include,-1),'Boolean')!==0,needle=vbString(match);
    return array(strings(sourcearray).filter(text=>(search(text,needle,mode)(0)>=0)===wanted));
  },
  StrComp(string1,string2,comparison){
    const mode=compare(comparison,frameMode);if(string1===null||string2===null)return null;
    let a=vbString(string1),b=vbString(string2);if(mode){a=a.toLowerCase();b=b.toLowerCase();}return a<b?-1:a>b?1:0;
  },
};}
/** Explicit frame context also makes caller-frame debugger inspection obey the
 * caller module rather than whichever frame happens to be on top of the VM. */
export function stringLibrary(vm){
  const tables={binary:functions('binary'),text:functions('text')},result={};
  for(const name of Object.keys(tables.binary)){
    const invoke=(args,frame)=>{
      if(name==='InStr'&&args.length===2)args=[MISSING,...args];
      const supplied=args.slice(),count={InStr:4,InStrRev:4,Replace:6,Split:4,Join:2,Filter:4,StrComp:3}[name];
      while(supplied.length<count)supplied.push(MISSING);
      return tables[frame?.module.optionCompare==='text'?'text':'binary'][name](...supplied);
    };
    const fn=(...args)=>invoke(args,vm.currentFrame);
    fn.vbInvoke=invoke;fn.vbPreserveMissing=true;
    if(name==='InStr')fn.vbShortParams=[{name:'string1'},{name:'string2'}];
    result[name]=fn;
  }
  return result;
}
