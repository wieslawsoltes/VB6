/** Counted UTF-16/BSTR library. Strings are never scanned for NUL terminators.
 * New results transfer ownership to a per-statement BSTR owner in the caller.
 * Comparison uses installed Windows NLS for text mode, exact code units for binary.
 */
import {planNativeArguments} from './calls.js';
import {mem16,mem32} from './x86-operands.js';
import {MAX_NATIVE_STRING} from './storage.js';
const S='native:string-library:',DLL='oleaut32.dll';
const lit=value=>({kind:'literal',value});
export const NATIVE_STRING_CONSTANTS=Object.freeze({vbbinarycompare:0,vbtextcompare:1,vbusecompareoption:-1});
const arg=argument=>({argument}),addr=address=>({address});
const local=offset=>mem32({base:'ebp',displacement:offset});
const specs={
 lcase:[['string','text']],ucase:[['string','text']],
 trim:[['string','text']],ltrim:[['string','text']],rtrim:[['string','text']],strreverse:[['expression','text']],
 string:[['number','number'],['character','character']],
 strcomp:[['string1','text'],['string2','text'],['compare','compare','option']],
 instrrev:[['stringcheck','text'],['stringmatch','text'],['start','number',-1],['compare','compare',0]]
};
for(const fields of Object.values(specs)){for(const f of fields)Object.freeze(f);Object.freeze(fields);}Object.freeze(specs);
export const nativeStringLibraryMethods={
  stringLibraryType(node){
    if(node.kind!=='call'||node.callee.kind!=='id')return null;
    const name=node.callee.name.toLowerCase().replace(/\$$/,'');
    if(!Object.hasOwn(specs,name)||this.resolveProcedure(node.callee))return null;
    return name==='strcomp'?'integer':name==='instrrev'?'long':'string';
  },
  nativeCompareMode() {
    const mode=this.context?.module?.module?.optionCompare||'binary';
    if(!['binary','text'].includes(mode))this.fail('Native strings support Option Compare Binary or Text');
    return mode==='text'?1:0;
  },
  compareNativeStrings(left,right,mode=lit(this.nativeCompareMode())) {
    this.textExpression(left);this.x.push();this.textExpression(right);this.x.push();this.numeric(mode);
    const ready=this.x.unique();this.x.compare(-1).branch('ne',ready).value(this.nativeCompareMode()).label(ready);
    this.x.emit(0x5a,0x59).push().emit(0x52,0x51).call(S+'strcomp');
  },
  stringLibraryBuiltin(node,name){
    if(!Object.hasOwn(specs,name)||this.resolveProcedure(node.callee))return false;
    const fields=specs[name],option=this.context?.module.module.optionCompare==='text'?1:0;
    const signature={name,params:fields.map(f=>({name:f[0],optional:f.length===3}))};
    const plan=planNativeArguments(signature,node.args,message=>this.fail(name+' expects valid arguments: '+message)),slots=new Array(fields.length),x=this.x;
    // Named arguments retain authored evaluation order; ABI slots retain formal order.
    for(const entry of plan.order){
      const spec=fields[entry.index],expr=entry.omitted?{kind:'literal',value:spec[2]==='option'?option:spec[2]}:entry.node;
      if(spec[1]==='text')this.textExpression(expr);
      else if(spec[1]==='character'){
        if(this.type(expr)==='string'){
          this.textExpression(expr);x.push().push().invoke(DLL,'SysStringLen').test().branch('e','error:5').popOperand('eax').movzx('eax',mem16({base:'eax'}));
        }else{this.numeric(expr);x.and('eax',255).push().call(S+'ansi-character');}
      }else{
        this.numeric(expr);
        if(spec[1]==='compare'){
          const ready=x.unique();x.compare(-1).branch('ne',ready).value(option).label(ready).compare(0).branch('l','error:5').compare(1).branch('g','error:5');
        }
      }
      const slot=this.arrayWorkspace(4,'string-library-argument');x.mov(local(slot.offset),'eax');slots[entry.index]=slot;
    }
    for(const slot of [...slots].reverse())x.pushOperand(local(slot.offset));
    x.call(S+name);if(this.stringLibraryType(node)==='string')this.ownString();return true;
  }
};
export function emitNativeStringLibrary(c){
  const x=c.x;
  for(const name of ['trim','ltrim','rtrim']){
    const begin=x.unique(),end=x.unique(),leadingDone=x.unique(),trailingDone=x.unique();
    x.label(S+name).enter().api(DLL,'SysStringLen',[arg(8)]).compare(MAX_NATIVE_STRING).branch('a','error:7').mov('edi','eax').value(arg(8)).mov('esi','eax').mov('ebx',0);
    if(name!=='rtrim')x.label(begin).cmp('ebx','edi').branch('ae',leadingDone).cmp(mem16({base:'esi',index:'ebx',scale:2}),32).branch('ne',leadingDone).inc('ebx').jump(begin).label(leadingDone);
    if(name!=='ltrim')x.label(end).cmp('edi','ebx').branch('be',trailingDone).cmp(mem16({base:'esi',index:'edi',scale:2,displacement:-2}),32).branch('ne',trailingDone).dec('edi').jump(end).label(trailingDone);
    x.sub('edi','ebx').lea('eax',mem32({base:'esi',index:'ebx',scale:2})).pushOperand('edi').push().invoke(DLL,'SysAllocStringLen').test().branch('e','error:7').leave(4);
  }
  {
    const loop=x.unique(),done=x.unique();
    x.label(S+'strreverse').enter().api(DLL,'SysStringLen',[arg(8)]).compare(MAX_NATIVE_STRING).branch('a','error:7').mov('ebx','eax').push().push(0).invoke(DLL,'SysAllocStringLen').test().branch('e','error:7').mov('edi','eax').push();
    x.value(arg(8)).lea('esi',mem32({base:'eax',index:'ebx',scale:2}));
    x.label(loop).testOperand('ebx','ebx').branch('e',done).sub('esi',2).mov('dx',mem16({base:'esi'})).mov(mem16({base:'edi'}),'dx').add('edi',2).dec('ebx').jump(loop).label(done).popOperand('eax').leave(4);
  }
  // Character codes use the installed ANSI code page, not Latin-1 guessing.
  x.label(S+'ansi-character').enter(4).mov(local(-4),0).api('kernel32.dll','MultiByteToWideChar',[0,0,addr(8),1,addr(-4),1]).compare(1).branch('ne','error:5').movzx('eax',mem16({base:'ebp',displacement:-4})).leave(4);
  x.label(S+'string').enter().value(arg(8)).compare(0).branch('l','error:5').compare(MAX_NATIVE_STRING).branch('a','error:7').push().push(0).invoke(DLL,'SysAllocStringLen').test().branch('e','error:7').mov('edi','eax').push().value(arg(12)).mov('ecx',local(8)).cld().repStore(16).popOperand('eax').leave(8);
  {
    const binary=x.unique(),empty=x.unique();
    x.label(S+'strcomp').enter().value(arg(16)).test().branch('e',binary).compare(1).branch('ne','error:5');
    x.api(DLL,'SysStringLen',[arg(8)]).mov('esi','eax').api(DLL,'SysStringLen',[arg(12)]).mov('edi','eax');
    x.testOperand('esi','esi').branch('e',empty).testOperand('edi','edi').branch('e',empty);
    x.pushOperand('edi').push(arg(12)).pushOperand('esi').push(arg(8)).push(1).push(0x400).invoke('kernel32.dll','CompareStringW').test().branch('e','error:5').sub('eax',2).leave(12);
    x.label(empty).cmp('esi','edi').setcc('g','al').setcc('l','cl').movzx('eax','al').movzx('ecx','cl').sub('eax','ecx').leave(12);
    x.label(binary).push(arg(12)).push(arg(8)).call('native:string:compare').leave(12);
  }
  {
    const startReady=x.unique(),emptyNeedle=x.unique(),loop=x.unique(),scan=x.unique(),next=x.unique(),text=x.unique(),found=x.unique(),notFound=x.unique(),done=x.unique();
    x.label(S+'instrrev').enter(8).value(arg(20)).compare(0).branch('l','error:5').compare(1).branch('g','error:5');
    x.value(arg(16)).compare(-1).branch('l','error:5').test().branch('e','error:5');
    x.api(DLL,'SysStringLen',[arg(8)]).mov(local(-4),'eax').test().branch('e',notFound);
    x.value(arg(16)).compare(-1).branch('ne',startReady).mov('eax',local(-4)).label(startReady).cmp('eax',local(-4)).branch('a',notFound).mov('esi','eax');
    x.api(DLL,'SysStringLen',[arg(12)]).mov(local(-8),'eax').test().branch('e',emptyNeedle).sub('esi','eax');
    x.label(loop).testOperand('esi','esi').branch('s',notFound).value(arg(8)).lea('ebx',mem32({base:'eax',index:'esi',scale:2})).value(arg(20)).test().branch('ne',text);
    x.value(arg(12)).mov('edi','eax').mov('ecx',0);
    x.label(scan).cmp('ecx',local(-8)).branch('e',found).mov('ax',mem16({base:'ebx',index:'ecx',scale:2})).cmp('ax',mem16({base:'edi',index:'ecx',scale:2})).branch('ne',next).inc('ecx').jump(scan);
    x.label(text).push(arg(-8)).push(arg(12)).push(arg(-8)).pushOperand('ebx').push(1).push(0x400).invoke('kernel32.dll','CompareStringW').test().branch('e','error:5').compare(2).branch('e',found);
    x.label(next).dec('esi').jump(loop).label(found).lea('eax',mem32({base:'esi',displacement:1})).jump(done).label(emptyNeedle).mov('eax','esi').jump(done).label(notFound).value(0).label(done).leave(16);
  }
  // Preserve installed-Windows case mappings, including mappings that change length.
  const caseEmpty=x.unique(),mapped=x.unique();
  // Query the required output size: locale mappings are not necessarily length preserving.
  x.label(S+'case').enter(8).api(DLL,'SysStringLen',[arg(8)]).mov(mem32({base:'ebp',displacement:-4}),'eax').test().branch('e',caseEmpty);
  x.api('kernel32.dll','LCMapStringW',[0x400,arg(12),arg(8),arg(-4),0,0]).test().branch('e','error:5').compare(MAX_NATIVE_STRING).branch('a','error:7').mov(mem32({base:'ebp',displacement:-8}),'eax');
  x.push().push(0).invoke(DLL,'SysAllocStringLen').test().branch('e','error:7').mov('edi','eax');
  x.push(arg(-8)).pushOperand('edi').push(arg(-4)).push(arg(8)).push(arg(12)).push(0x400).invoke('kernel32.dll','LCMapStringW');
  x.cmp('eax',mem32({base:'ebp',displacement:-8})).branch('e',mapped);
  x.pushOperand('edi').invoke(DLL,'SysFreeString').jump('error:5');
  x.label(mapped).mov('eax','edi').leave(8);
  x.label(caseEmpty).api(DLL,'SysAllocStringLen',[0,0]).test().branch('e','error:7').leave(8);
  for(const [name,flag]of [['lcase',0x100],['ucase',0x200]])x.label(S+name).enter().push(flag).push(arg(8)).call(S+'case').leave(4);
}

// Retain the established emitter entry point for compiler and SDK consumers.
export const emitNativeStringLibraryHelpers=emitNativeStringLibrary;
