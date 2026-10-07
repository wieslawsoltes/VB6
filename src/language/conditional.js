import {VBError} from './errors.js';
import {stripComment} from './source-scanner.js';
import {parseIfHeader} from './statement-syntax.js';
import {parseExpression} from './expression.js';
import {binary, unary, truth, literalScalar, signedLiteralScalar, unbox} from '../runtime/values.js';

/** Removed physical lines remain blank, preserving editor/debugger coordinates. */
export function preprocess(source, constants = {}, sourceName = '') {
  const values = new Map(Object.entries({VBWEB:-1, VBA7:0, Win32:0, Win64:0, Mac:0, ...constants}).map(([k,v])=>[k.toLowerCase(),v]));
  const frames=[];
  const enabled=()=>frames.length===0||frames[frames.length-1].active;
  const evaluate=(node,depth=0)=>{
    if(depth>=256)throw new VBError('Conditional expression nesting limit exceeded',1002);
    const ev=n=>evaluate(n,depth+1);
    if(['literal','date','currency'].includes(node.kind))return literalScalar(node);
    if(node.kind==='empty')return undefined;
    if(node.kind==='id')return values.get(node.name.toLowerCase());
    if(node.kind==='group')return ev(node.expr);
    if(node.kind==='unary')return signedLiteralScalar(node)||unary(node.op,ev(node.expr));
    if(node.kind==='binary'){
      if(node.op==='is')throw new VBError('Object identity is not a conditional constant expression',1002);
      // Conditional directives always use Text comparison, independent of the
      // module's Option Compare, and evaluate both operands (no short circuit).
      const result=binary(node.op,ev(node.left),ev(node.right),'text');
      if(typeof unbox(result)==='string'&&unbox(result).length>1048576)throw new VBError('Conditional string exceeds 1 MiB compiler limit',1002);
      return result;
    }
    throw new VBError('Conditional expressions must be constant expressions',1002);
  };
  const result=String(source).replace(/\r\n?/g,'\n').split('\n').map((line,i)=>{
    if(!/^\s*#(?:Const|If|ElseIf|Else|End)\b/i.test(line))return enabled()?line:'';
    const text=stripComment(line).trim();let m;
    try {
      if((m=text.match(/^#Const\s+([A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)\s*=\s*(.+)$/i))){if(enabled())values.set(m[1].toLowerCase(),evaluate(parseExpression(m[2])));}
      else if(/^#If\b/i.test(text)){
        const header=parseIfHeader(text.slice(1));if(header.body)throw new VBError('Invalid conditional compilation directive',1002);
        // All #If/#ElseIf expressions are checked, even in excluded branches.
        const condition=truth(evaluate(parseExpression(header.condition))),parent=enabled(),active=parent&&condition;
        frames.push({parent,active,taken:active,hadElse:false,line:i+1});
      }
      else if(/^#ElseIf\b/i.test(text)){
        const f=frames.at(-1);if(!f||f.hadElse)throw new VBError('Unexpected #ElseIf',1002);
        const header=parseIfHeader(text.slice(1));if(header.body)throw new VBError('Invalid conditional compilation directive',1002);
        const condition=truth(evaluate(parseExpression(header.condition)));
        f.active=f.parent&&!f.taken&&condition;f.taken ||= f.active;
      }
      else if(/^#Else\s*$/i.test(text)){const f=frames.at(-1);if(!f||f.hadElse)throw new VBError('Unexpected #Else',1002);f.hadElse=true;f.active=f.parent&&!f.taken;f.taken=true;}
      else if(/^#End\s+If\s*$/i.test(text)){if(!frames.length)throw new VBError('Unexpected #End If',1002);frames.pop();}
      else throw new VBError('Invalid conditional compilation directive',1002);
    }catch(error){error.source=sourceName;error.line=i+1;throw error;}
    return '';
  });
  if(frames.length)throw new VBError('Expected #End If',1002,sourceName,frames.at(-1).line);
  return result.join('\n');
}
