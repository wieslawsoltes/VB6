/** Inline UTF-16 fixed Strings and their distinct ANSI Declare record layout.
 * Unlike managed String fields these own no BSTRs and whole-record copies are
 * ordinary value copies. Explicit ByVal pointers always bypass conversion.
 * Microsoft, Developing DLLs for Visual Basic 5.0, sections 6 and 10:
 * https://classicvb.net/tips/vb5dll/
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/len-function
 */
import {nativeStorageMethods} from './storage.js';
import {mem16,mem32} from './x86-operands.js';
const key=v=>String(v).toLowerCase(),arg=argument=>({argument});
const at=(base,displacement=0)=>mem32({base,displacement}),local=v=>at('ebp',v.offset);
const P='native:record:',label=(layout,kind)=>P+layout.id+':'+kind;
export const nativeRecordStringMethods={
  initializeFixedString(variable){
    if(variable.nativeRecord)return this.initializeRecordStrings(variable);
    return nativeStorageMethods.initializeFixedString.call(this,variable);
  },
  stringBuiltin(node,name){
    if(name==='strptr'&&node.args.length===1){
      const variable=this.variable(node.args[0]);
      if(variable?.nativeInlineString){
        if(variable.recordFieldArray)this.fail('StrPtr requires an indexed fixed String field');
        this.address(variable);return true;
      }
    }
    return nativeStorageMethods.stringBuiltin.call(this,node,name);
  },
  nativeRecordAwareCall(target,plan){
    const previous=this.nativeRecordTransfers,transfers=[];
    this.nativeRecordTransfers=target.proc?null:transfers;
    try{this.nativeTypedCall(target,plan);}finally{this.nativeRecordTransfers=previous;}
    if(transfers.length){this.x.push();for(const transfer of transfers)this.nativeRecordCopyBack(transfer);this.x.popOperand('eax');}
  },
  loadInlineRecordString(variable){
    if(variable.recordFieldArray)this.fail('Native record array field requires indices');
    this.address(variable);
    // Preserve the field pointer in EAX while placing the length on the stack.
    // Legacy push(value) loads EAX; the machine PUSH operand does not.
    this.x.pushOperand(variable.fixedLength).push().invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7');
    this.ownString();
  },
  storeInlineRecordString(variable){
    if(variable.recordFieldArray)this.fail('Native record array field requires indices');
    const x=this.x;x.push();this.address(variable);x.pushOperand(variable.fixedLength).push().call(P+'assign-fixed');
  },
  initializeRecordStrings(variable){
    const layout=variable.nativeRecord;
    if(!layout?.hasFixedStrings||variable.parameter)return;
    this.rawStorageAddress(variable);this.x.push().call(label(layout,'initialize'));
  },
  nativeRecordTransferLayout(parameter,node){
    const layout=parameter.nativeRecord||(key(parameter.type)==='any'?this.variable(node)?.nativeRecord:null);
    return layout?.hasFixedStrings?layout:null;
  },
  nativeExternalRecordArgument(parameter,node){
    const variable=this.variable(node),layout=this.nativeRecordTransferLayout(parameter,node);
    if(!variable?.nativeRecord||variable.recordFieldArray||variable.nativeRecord.id!==layout.id)
      this.fail('ByRef native record argument requires the exact declared record type');
    const x=this.x,destination=this.arrayWorkspace(4,'record-copyback-address'),buffer=this.arrayWorkspace(Math.ceil(layout.ansiSize/4)*4,'record-ansi');
    // The destination is resolved before later argument expressions, including
    // nested array subscripts and foreign callbacks. Parentheses suppress copyback.
    this.address(variable);x.mov(local(destination),'eax');
    this.zeroStorage(buffer);this.rawStorageAddress(buffer);x.push().push(arg(destination.offset)).call(label(layout,'to-ansi'));
    this.rawStorageAddress(buffer);return {destination:node.kind==='group'?null:destination,buffer,layout};
  },
  nativeRecordCopyBack({destination,buffer,layout}){
    if(!destination)return;
    this.x.push(arg(destination.offset));this.rawStorageAddress(buffer);this.x.push().call(label(layout,'from-ansi'));
  }
};
export function emitNativeRecordStringHelpers(c){
  const x=c.x,layouts=[...c.recordLayouts.layouts.values()].filter(l=>l.hasFixedStrings);
  if(!layouts.length)return;
  // assign-fixed(destination, length, source BSTR): no allocation or foreign
  // lifetime is involved in publishing a fixed field. NUL remains counted data.
  const fits=x.unique();
  x.label(P+'assign-fixed').enter().value(arg(12)).mov('ebx','eax')
    .api('oleaut32.dll','SysStringLen',[arg(16)]).cmp('eax','ebx').branch('be',fits).mov('eax','ebx').label(fits)
    .mov('ecx','eax').sub('ebx','eax').value(arg(16)).mov('esi','eax').value(arg(8)).mov('edi','eax')
    .cld().repMove(16).mov('ecx','ebx').mov('eax',32).repStore(16).value(arg(8)).leave(12);
  for(const layout of layouts){
    for(const kind of ['initialize','to-ansi','from-ansi']){
      const to=kind==='to-ansi',init=kind==='initialize';
      // Win32 fixed CHAR[N] fields cannot grow when CP_ACP is a multibyte code
      // page. Convert into bounded scratch first, then fit the N-byte field.
      const max=to?Math.max(0,...[...layout.fields.values()].filter(f=>f.nativeInlineString).map(f=>f.fixedLength*4)):0;
      const scratch=(max+3)&~3;
      x.label(label(layout,kind)).enter(scratch+12).value(arg(8)).mov('esi','eax');
      if(!init)x.value(arg(12)).mov('edi','eax');
      for(const field of layout.fields.values()){
        if(init&&!field.nativeInlineString&&!field.nativeRecord?.hasFixedStrings)continue;
        const loop=x.unique(),sourceOffset=to||init?field.recordOffset:field.ansiOffset,destOffset=to?field.ansiOffset:field.recordOffset;
        x.pushOperand('esi').pushOperand('edi').add('esi',sourceOffset);
        if(!init)x.add('edi',destOffset);
        x.mov('ebx',field.nativeCount).label(loop);
        if(field.nativeInlineString){
          if(init){x.pushOperand('edi').mov('edi','esi').mov('ecx',field.fixedLength).mov('eax',32).cld().repStore(16).popOperand('edi');}
          else if(to){
            x.mov(at('ebp',-4),'esi').mov(at('ebp',-8),'edi');
            x.push(0).push(0).push(field.fixedLength*4).local(-scratch-12).push().push(field.fixedLength).pushOperand('esi').push(0).push(0).invoke('kernel32.dll','WideCharToMultiByte').test().branch('e','error:5');
            const fits=x.unique();x.compare(field.fixedLength).branch('be',fits).value(field.fixedLength).label(fits).mov(at('ebp',-12),'eax');
            x.pushOperand('esi').pushOperand('edi').mov('ecx','eax').local(-scratch-12).mov('esi','eax').cld().repMove(8)
              .mov('ecx',field.fixedLength).sub('ecx',at('ebp',-12)).mov('eax',32).repStore(8).popOperand('edi').popOperand('esi');
          }else{
            x.push(field.fixedLength).pushOperand('edi').push(field.fixedLength).pushOperand('esi').push(0).push(0).invoke('kernel32.dll','MultiByteToWideChar').test().branch('e','error:5');
            x.pushOperand('edi').lea('edi',mem32({base:'edi',index:'eax',scale:2})).mov('ecx',field.fixedLength).sub('ecx','eax').mov('eax',32).cld().repStore(16).popOperand('edi');
          }
        }else if(field.nativeRecord?.hasFixedStrings){
          if(!init)x.pushOperand('edi');x.pushOperand('esi').call(label(field.nativeRecord,kind));
        }else{
          x.pushOperand('esi').pushOperand('edi').mov('ecx',field.nativeElementBytes).cld().repMove(8).popOperand('edi').popOperand('esi');
        }
        x.add('esi',to||init?field.nativeElementBytes:field.ansiElementBytes);
        if(!init)x.add('edi',to?field.ansiElementBytes:field.nativeElementBytes);
        x.dec('ebx').branch('ne',loop).popOperand('edi').popOperand('esi');
      }
      x.value(arg(init?8:12)).leave(init?4:8);
    }
  }
}
