/** Native display formatting shared by Debug.Print and sequential-file Print.
 * Preserve separators before native lowering; the legacy exprs array cannot
 * distinguish semicolons from print-zone commas. No source text is executed.
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/printstatement
 */
import {splitPrintList} from '../language/print-list.js';
import {parseExpression} from '../language/expression.js';
import {mem16,mem32} from './x86-operands.js';
const at=(base,displacement=0)=>mem32({base,displacement}),slot=o=>at('ebp',o.offset),key=v=>String(v).toLowerCase();
const lit=value=>({kind:'literal',value});
export function parseNativePrintList(text){
  const {parts,newline}=splitPrintList(text),result=[];
  for(const part of parts){
    if(part.text){const expr=parseExpression(part.text),callee=expr.kind==='call'?expr.callee:expr;
      if(callee.kind==='id'&&['tab','spc'].includes(key(callee.name))){
        const kind=key(callee.name),args=expr.kind==='call'?expr.args:[];
        if(args.length>1||kind==='spc'&&args.length!==1||args.some(a=>['missing','named'].includes(a.kind)))throw new TypeError('Print '+kind+' expects '+(kind==='spc'?'one':'zero or one')+' positional argument');
        result.push({kind,expr:args[0]||null});
      }else result.push({kind:'value',expr});
    }
    if(part.separator===',')result.push({kind:'tab',expr:null});
  }
  return {items:result,newline};
}

function save(c,name){const s=c.arrayWorkspace(4,name);c.x.mov(slot(s),'eax');return s;}
function concat(c,left,right){for(const value of [right,left])typeof value==='string'?c.x.push(value):c.x.pushOperand(value);c.x.call('native:string:concat');c.ownString();}
/** Emit a single, owned display image. Allocation failure preserves the previous
 * file contents; expression order is lexical, never sorted by formal arguments. */
export function nativePrintImage(c,instruction,column){
  const x=c.x,out=c.temporaryString(),position=c.arrayWorkspace(4,'print-column');
  c.clearStringStorage(out);x.value(column).mov(slot(position),'eax');
  let plan;
  try{plan=instruction.outputList===undefined?{items:instruction.exprs.map(expr=>({kind:'value',expr})),newline:instruction.newline}:parseNativePrintList(instruction.outputList);}
  catch(error){c.fail(error.message);}
  c.nativePrintUsed=true;
  const append=()=>{
    const text=save(c,'print-fragment');
    x.pushOperand(slot(text)).pushOperand(slot(out)).call('native:string:concat');c.ownString();
    x.push();c.rawStorageAddress(out);x.push().call('native:string:assign');
    x.pushOperand(slot(position)).pushOperand(slot(text)).call('native:print:column').mov(slot(position),'eax');
  };
  for(const item of plan.items){
    if(item.kind!=='value'){
      if(item.expr)c.numeric(item.expr);else x.value(0);
      x.push().push(item.kind==='spc'?0:item.expr?1:2).pushOperand(slot(position)).call('native:print:spacing');c.ownString();append();continue;
    }
    c.boxVariant(item.expr);const value=save(c,'print-value');
    const nullValue=x.unique(),formatted=x.unique(),notNumber=x.unique();
    x.cmp(mem16({base:'eax'}),1).branch('e',nullValue);
    c.unboxVariant('string',true);const text=save(c,'print-formatted');
    x.mov('edx',slot(value)).movzx('edx',mem16({base:'edx'}));
    const number=x.unique();for(const type of [2,3,4,5,6,14,17])x.cmp('edx',type).branch('e',number);
    x.value({argument:text.offset}).jump(notNumber).label(number);
    const signed=x.unique();x.value({argument:text.offset}).test().branch('e',signed).cmp(mem16({base:'eax'}),45).branch('e',signed);
    concat(c,c.string(' '),slot(text));x.mov(slot(text),'eax');
    x.label(signed);concat(c,slot(text),c.string(' '));
    x.label(notNumber).jump(formatted).label(nullValue).value(c.string('Null')).label(formatted);append();
  }
  if(plan.newline){x.value(c.string('\r\n'));append();}
  x.value({argument:out.offset});return {out,position};
}
export function emitNativePrintHelpers(c){
  if(!c.nativePrintUsed)return;const x=c.x,arg=argument=>({argument});
  // column(text, current): raw CR/LF resets the position; embedded NUL is data.
  const loop=x.unique(),done=x.unique(),reset=x.unique(),next=x.unique();
  x.label('native:print:column').enter().api('oleaut32.dll','SysStringLen',[arg(8)]).mov('ecx','eax').value(arg(8)).mov('edx','eax').value(arg(12));
  x.label(loop).testOperand('ecx','ecx').branch('e',done).cmp(mem16({base:'edx'}),13).branch('e',reset).cmp(mem16({base:'edx'}),10).branch('e',reset).inc('eax').compare(0x7fffffff).branch('e','error:6').jump(next);
  x.label(reset).xor('eax','eax').label(next).add('edx',2).dec('ecx').jump(loop).label(done).leave(8);
  // spacing(column, kind, n): kind 0=Spc, 1=Tab(n), 2=next 14-column zone.
  const zone=x.unique(),allocate=x.unique(),newline=x.unique(),ready=x.unique(),positive=x.unique(),tab=x.unique();
  x.label('native:print:spacing').enter().mov('esi',0).value(arg(16)).compare(32767).branch('g','error:5');
  x.cmp(at('ebp',12),0).branch('ne',tab).compare(0).branch('l','error:5').jump(allocate);
  x.label(tab).cmp(at('ebp',12),2).branch('e',zone);
  x.compare(1).branch('ge',positive).value(1).mov(at('ebp',16),'eax').label(positive).dec('eax').sub('eax',at('ebp',8)).branch('s',newline).jump(allocate);
  x.label(newline).mov('esi',2).value(arg(16)).dec('eax').jump(allocate);
  x.label(zone).value(arg(8)).xor('edx','edx').mov('ecx',14).div('ecx').mov('eax',14).sub('eax','edx');
  x.label(allocate).mov('ebx','eax').add('eax','esi').push().push(0).invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7').mov('edi','eax').push();
  x.testOperand('esi','esi').branch('e',ready).mov(mem16({base:'edi'}),13).mov(mem16({base:'edi',displacement:2}),10).add('edi',4);
  x.label(ready).mov('ecx','ebx').mov('eax',32).cld().repStore(16).popOperand('eax').leave(12);
}
