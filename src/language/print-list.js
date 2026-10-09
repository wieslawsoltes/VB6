import {ExpressionParser} from './expression.js';
import {scanSyntax} from './source-scanner.js';
/** Lossless top-level Print separators. Unlike replacing semicolons with commas,
 * this leaves strings, escaped names, date literals and call arguments intact.
 * Consumers choose their own output device; parsing never evaluates expressions. */
export function splitPrintList(source){
  const text=String(source??''),parts=[];let start=0,depth=0;
  const end=scanSyntax(text,token=>{
    if(token.kind!=='op')return;
    if(token.value==='(')depth++;
    else if(token.value===')')depth--;
    else if(!depth&&(token.value===','||token.value===';')){
      parts.push({text:text.slice(start,token.start).trim(),separator:token.value});start=token.end;
    }
  });
  if(text.slice(start,end).trim())parts.push({text:text.slice(start,end).trim(),separator:null});
  const expressions=[];
  for(const part of parts){
    if(!part.text){expressions.push(part);continue;}
    const parser=new ExpressionParser(part.text);
    while(parser.peek().type!=='eof'){
      const start=parser.peek().start;parser.finish(parser.expression());
      const end=parser.tokens[parser.i-1].end,last=parser.peek().type==='eof';
      if(!last&&!/\s/.test(part.text.slice(end,parser.peek().start)))
        throw new SyntaxError('Print expressions require a separator');
      expressions.push({text:part.text.slice(start,end),separator:last?part.separator:';'});
    }
  }
  return {parts:expressions,newline:parts.length===0||parts.at(-1).separator===null};
}
