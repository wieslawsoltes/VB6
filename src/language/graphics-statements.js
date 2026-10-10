/** Parse graphics syntax structurally. A dot or the word Line inside a quoted
 * argument is data, not a receiver/method delimiter. Coordinates can themselves
 * contain nested calls, escaped names and named arguments. Parsing never invokes
 * a receiver or expression; the backend retains evaluation-order responsibility. */
import {tokenize,splitTop,VBError} from './lexer.js';
import {parseExpression as E} from './expression.js';
const is=(token,value)=>token?.type==='op'&&token.value===value;
const methods=new Set(['line','circle','pset']);
const fail=message=>{throw new VBError(message,1002);};
export function parseGraphicsStatement(text){
  if(!/\b(?:Line|Circle|PSet)\s*\(/i.test(text))return null;
  const tokens=tokenize(text);let depth=0,at=-1;
  for(let i=0;i<tokens.length-1;i++){
    const token=tokens[i];
    if(is(token,'('))depth++;
    else if(is(token,')'))depth--;
    else if(depth===0&&token.type==='id'&&methods.has(token.value.toLowerCase())&&is(tokens[i+1],'(')&&(i===0||is(tokens[i-1],'.'))){at=i;break;}
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
  let coords=point();
  if(method==='line'){
    if(!is(tokens[index],'-'))fail('Line requires an endpoint coordinate pair');index++;
    coords.push(...point());
  }
  let tail=[];
  if(tokens[index]?.type!=='eof'){
    if(!is(tokens[index],','))fail('Unexpected text after graphics coordinates');
    tail=splitTop(text.slice(tokens[index].end));
  }
  if(method==='line'){
    if(tail.length>2||tail.length===2&&!/^(?:B|BF)$/i.test(tail[1].trim()))fail('Line requires an optional color and B or BF flag');
    const flag=tail[1]?.trim().toLowerCase();
    return {op:'graphics',object,kind:flag?'rect':'line',coords,color:E(tail[0]||'0'),fill:flag==='bf'};
  }
  if(method==='pset'){
    if(tail.length>1)fail('PSet accepts one optional color');
    return {op:'graphics',object,kind:'pixel',coords,color:E(tail[0]||'0')};
  }
  if(!tail.length||!tail[0].trim()||tail.length>2)fail('Circle requires a radius and one optional color');
  coords.push(E(tail[0]));return {op:'graphics',object,kind:'circle',coords,color:E(tail[1]||'0')};
}
