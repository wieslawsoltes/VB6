/** Structural VB drawing syntax. Quoted punctuation and nested/indexed receivers
 * remain expressions, never delimiters. Evaluate each expression once, in order.
 * Extended syntax uses its own IR opcode: unimplemented export targets reject
 * it at compile time instead of silently dropping Step, arc or scale operands. */
import {tokenize,splitTop,VBError} from './lexer.js';
import {parseExpression as E} from './expression.js';
const is=(token,value)=>token?.type==='op'&&token.value===value;
const id=(token,value)=>token?.type==='id'&&token.value.toLowerCase()===value;
const methods=new Set(['line','circle','pset','scale']);
const fail=message=>{throw new VBError(message,1002);};
export function parseGraphicsStatement(text){
  if(!/\b(?:Line|Circle|PSet|Scale)\b/i.test(text))return null;
  const tokens=tokenize(text);let depth=0,at=-1;
  for(let i=0;i<tokens.length-1;i++){
    const token=tokens[i],next=tokens[i+1];
    if(is(token,'('))depth++;
    else if(is(token,')'))depth--;
    else if(depth===0&&token.type==='id'&&methods.has(token.value.toLowerCase())&&(i===0||is(tokens[i-1],'.'))&&(is(next,'(')||id(next,'step')||id(token,'line')&&is(next,'-')||id(token,'scale')&&next?.type==='eof')){at=i;break;}
  }
  if(at<0)return null;
  let object;
  if(at===0)object=E('Me');
  else if(at===1)object={kind:'with'};
  else{
    try{object=E(text.slice(0,tokens[at-1].start));}catch{return null;}
    if(!['id','member','call','group','with'].includes(object.kind))return null;
  }
  const method=tokens[at].value.toLowerCase();let index=at+1;
  const point=()=>{
    if(!is(tokens[index],'('))fail('Expected a graphics coordinate pair');
    const open=tokens[index++];let level=1,close;
    while(index<tokens.length){const t=tokens[index++];if(is(t,'('))level++;else if(is(t,')')&&!--level){close=t;break;}}
    if(!close)fail('Unclosed graphics coordinate pair');
    const parts=splitTop(text.slice(open.end,close.start));if(parts.length!==2||parts.some(p=>!p.trim()))fail('Graphics coordinates require two expressions');
    return parts.map(E);
  };
  const step=()=>{if(id(tokens[index],'step')){index++;return true;}return false;};
  if(method==='scale'&&tokens[index]?.type==='eof')return {op:'graphicsExtended',object,kind:'scale',coords:[],color:E('0')};
  const stepStart=method!=='scale'&&step(),implicitStart=method==='line'&&!stepStart&&is(tokens[index],'-');
  let coords=implicitStart?[E('0'),E('0')]:point(),stepEnd=false;
  if(method==='line'||method==='scale'){
    if(!is(tokens[index],'-'))fail(method+' requires an endpoint coordinate pair');index++;
    stepEnd=method==='line'&&step();coords.push(...point());
  }
  let tail=[];
  if(tokens[index]?.type!=='eof'){
    if(!is(tokens[index],','))fail('Unexpected text after graphics coordinates');
    tail=splitTop(text.slice(tokens[index].end));
  }
  const flags={...(stepStart?{stepStart:true}:{}),...(stepEnd?{stepEnd:true}:{}),...(implicitStart?{implicitStart:true}:{})};
  if(method==='scale'){
    if(tail.length)fail('Scale does not accept a color');return {op:'graphicsExtended',object,kind:'scale',coords,color:E('0')};
  }
  if(method==='line'){
    if(tail.length>2||tail.length===2&&!/^(?:B|BF)$/i.test(tail[1].trim()))fail('Line requires an optional color and B or BF flag');
    const flag=tail[1]?.trim().toLowerCase();
    return {op:stepStart||stepEnd||implicitStart?'graphicsExtended':'graphics',object,kind:flag?'rect':'line',coords,color:E(tail[0]||'0'),defaultColor:!tail[0]?.trim(),fill:flag==='bf',...flags};
  }
  if(method==='pset'){
    if(tail.length>1)fail('PSet accepts one optional color');
    return {op:stepStart?'graphicsExtended':'graphics',object,kind:'pixel',coords,color:E(tail[0]||'0'),defaultColor:!tail[0]?.trim(),...flags};
  }
  if(!tail.length||!tail[0].trim()||tail.length>5)fail('Circle requires a radius and optional color, start, end and aspect');
  coords.push(E(tail[0]));const arc={};for(const [i,key]of [[2,'start'],[3,'end'],[4,'aspect']])if(tail[i]?.trim())arc[key]=E(tail[i]);
  return {op:stepStart||Object.keys(arc).length?'graphicsExtended':'graphics',object,kind:'circle',coords,color:E(tail[1]||'0'),defaultColor:!tail[1]?.trim(),...(Object.keys(arc).length?{arc}:{}),...flags};
}
