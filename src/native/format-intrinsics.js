/** Native Automation formatting and ANSI character conversion.
 * https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varformat
 * https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/chr-function
 * Format retains VT_NULL; Format$ raises 94. Outputs are owned before Windows
 * is called, including failure paths and nested/recursive source expressions. */
import {planNativeArguments} from './call-plan.js';
import {mem16,mem32} from './x86-operands.js';
import {MAX_NATIVE_STRING} from './storage.js';
const key=v=>String(v).toLowerCase(),at=(base,displacement=0)=>mem32({base,displacement});
const local=offset=>at('ebp',offset),arg=argument=>({argument}),addr=address=>({address});
export function nativeFormatType(c,node){
  if(node.kind!=='call'||node.callee.kind!=='id'||c.resolveProcedure(node.callee))return null;
  const name=key(node.callee.name);
  return name==='format'?'variant':['format$','chr','chr$'].includes(name)?'string':null;
}
export function nativeFormatBuiltin(c,node,name){
  if(!['format','chr'].includes(name)||c.resolveProcedure(node.callee))return false;
  const x=c.x;
  if(name==='chr'){
    const plan=planNativeArguments({name:'Chr',params:[{name:'charcode'}]},node.args,m=>c.fail(m));
    c.numeric(plan.slots[0].node);x.push().call('native:format:chr');c.nativeAnsiChrUsed=true;c.ownString();return true;
  }
  const fields=[['expression'],['format',''],['firstdayofweek',1],['firstweekofyear',1]],slots=[];
  const plan=planNativeArguments({name:'Format',params:fields.map(f=>({name:f[0],optional:f.length===2}))},node.args,m=>c.fail(m));
  for(const entry of plan.order){
    const i=entry.index,expr=entry.omitted?{kind:'literal',value:fields[i][1]}:entry.node;
    if(i===0)c.boxVariant(expr);else if(i===1)c.textExpression(expr);else {
      c.numeric(expr);x.compare(0).branch('l','error:5').compare(i===2?7:3).branch('g','error:5');
      // The installed Windows VarFormat ABI uses VB's Sunday=1 convention,
      // as independently exercised by DatePart and the native fixture. Do not
      // remap it using the contradictory Monday-first documentation table.
    }
    const slot=c.arrayWorkspace(4,'format-argument');x.mov(local(slot.offset),'eax');slots[i]=slot;
  }
  c.useVariant();const dollar=key(node.callee.name).endsWith('$'),out=dollar?c.temporaryString():c.temporaryVariant();
  if(dollar)c.clearStringStorage(out);else {c.clearVariantStorage(out);c.zeroStorage(out);}
  const present=x.unique(),done=x.unique();x.mov('eax',local(slots[0].offset)).cmp(mem16({base:'eax'}),1);
  if(dollar)x.branch('e','error:94');else {
    x.branch('ne',present);c.rawStorageAddress(out);x.mov(at('eax'),1).jump(done).label(present);
  }
  c.rawStorageAddress(out);if(!dollar)x.mov(at('eax'),8).add('eax',8);
  x.push().push(0).pushOperand(local(slots[3].offset)).pushOperand(local(slots[2].offset))
    .pushOperand(local(slots[1].offset)).pushOperand(local(slots[0].offset)).invoke('oleaut32.dll','VarFormat').call('native:variant:check');
  c.rawStorageAddress(out);x.mov('eax',at('eax',dollar?0:8)).push().invoke('oleaut32.dll','SysStringLen').compare(MAX_NATIVE_STRING).branch('a','error:7');
  x.label(done);c.rawStorageAddress(out);if(dollar)x.mov('eax',at('eax'));return true;
}
export function emitNativeFormatHelpers(c){
  if(!c.nativeAnsiChrUsed)return;
  const x=c.x,single=x.unique(),convert=x.unique();
  x.label('native:format:chr').enter(32).value(arg(8)).compare(-32768).branch('l','error:5').compare(65535).branch('g','error:5');
  x.mov(local(-12),'eax').compare(255).branch('be',single);
  // Extended codes are valid only on a multi-byte ANSI system. Never silently
  // truncate them to a byte or reinterpret the active ANSI page as Latin-1.
  x.api('kernel32.dll','GetCPInfo',[0,addr(-32)]).test().branch('e','error:5').cmp(local(-32),1).branch('be','error:5');
  x.mov('eax',local(-12)).emit(0x86,0xc4).mov(local(-12),'eax').mov('ebx',2).jump(convert);
  x.label(single).mov('ebx',1).label(convert).push(2).push(addr(-8)).pushOperand('ebx').push(addr(-12)).push(8).push(0).invoke('kernel32.dll','MultiByteToWideChar').test().branch('e','error:5');
  x.push().push(addr(-8)).invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7').leave(4);
}
