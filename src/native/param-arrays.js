/** Classic VB ParamArray lowering. Packing is not a C varargs call. Variable elements retain ByRef
 * bindings; expression and parenthesized elements retain owned values. One caller-owned Variant owns the complete SAFEARRAY; publishing
 * that owner before evaluating arguments makes partial packs exception-safe.
 * MS-VBAL 5.3.1.11 and the VBA named-argument diagnostic define this contract.
 */
import {mem16,mem32} from './x86-operands.js';
import {nativeVariantReference} from './variant-references.js';
import {NATIVE_ARRAY_MAX_BYTES} from './arrays.js';
const P='native:paramarray:',V='native:variant:',DLL='oleaut32.dll';
const arg=argument=>({argument}),addr=address=>({address});
const at=(base,displacement=0)=>mem32({base,displacement});

export function lowerNativeParamArray(c,args) {
  if(args.length>Math.floor((c.maxArrayBytes??NATIVE_ARRAY_MAX_BYTES)/16))
    c.fail('Native ParamArray exceeds the configured array backing-store budget');
  if(args.some(a=>['named','byval','addressOf'].includes(a?.kind)))
    c.fail('Native ParamArray elements must be positional values or omitted placeholders');
  c.useVariant('paramarray');const x=c.x,owner=c.temporaryVariant(),pins=[];
  x.push(args.length);c.rawStorageAddress(owner);x.push().call(P+'create');
  args.forEach((node,index)=>{
    if(!node||node.kind==='missing')c.variantSeed(10,0x80020004);
    else {
      const variable=node.kind==='group'?null:c.variable(node);
      if(variable){
        const {pin}=nativeVariantReference(c,variable);if(pin)pins.push(pin);
        if(String(variable.type).toLowerCase()==='variant'){
          // Copy an existing borrowed descriptor, or bind to the live owner.
          // Never turn an existing VT_BYREF|VT_VARIANT into a nested chain.
          c.useVariant('paramarray-borrow');x.push();
          const view=c.arrayWorkspace(16,'paramarray-reference');c.rawStorageAddress(view);
          x.push().call(P+'borrow');
        }
      }else c.boxVariant(node);
    }
    x.push().push(index);c.rawStorageAddress(owner);x.push().call(P+'put');
  });
  // The existing unsized array ABI takes a SAFEARRAY**. ReDim/Erase in the callee
  // update this very slot, so the owner's eventual VariantClear sees its value.
  c.rawStorageAddress(owner);x.add('eax',8);
  return {owner,pins};
}

export function emitNativeParamArrayHelpers(c) {
  const x=c.x,limit=Math.floor((c.maxArrayBytes??NATIVE_ARRAY_MAX_BYTES)/16);
  if(c.nativeVariantsUsed.has('paramarray-borrow')){
    const follow=x.unique(),typed=x.unique(),owned=x.unique(),valid=x.unique();
    x.label(P+'borrow').enter().value(arg(12)).mov('esi','eax').mov('ecx',64).label(follow);
    x.testOperand('esi','esi').branch('e','error:91').movzx('edx',mem16({base:'esi'}));
    x.cmp('edx',0x400c).branch('ne',typed).dec('ecx').branch('e','error:13');
    x.mov('esi',at('esi',8)).jump(follow).label(typed).testOperand('edx',0x4000).branch('e',owned);
    for(const vt of [2,3,4,5,6,7,8,11,17])x.cmp('edx',0x4000|vt).branch('e',valid);
    x.jump('error:13').label(valid).cmp(at('esi',8),0).branch('e','error:91');
    x.value(arg(8)).mov('edi','eax').mov('ecx',4).cld().repMove(32).value(arg(8)).leave(8);
    x.label(owned).value(arg(8)).mov(at('eax'),0x400c).mov(at('eax',4),0).mov(at('eax',8),'esi').mov(at('eax',12),0).leave(8);
  }
  // create(owner, count): ownership is installed before another fallible call.
  // SafeArrayCreate accepts a zero count and retains lower=0, upper=-1. Unlike
  // SafeArrayCreateVector it does not force FADF_FIXEDSIZE on this local array.
  x.label(P+'create').enter(8).value(arg(12)).compare(limit).branch('a','error:7');
  x.mov(at('ebp',-8),'eax').mov(at('ebp',-4),0);
  x.push(arg(8)).call(V+'clear').api(DLL,'SafeArrayCreate',[12,1,addr(-8)]).test().branch('e','error:7');
  x.mov('edx','eax').value(arg(8)).mov(at('eax',8),'edx').mov(at('eax'),0x200c).add('eax',8).leave(8);
  // put(owner, index, source): OleAut32 copies a Variant, including its BSTR or
  // nested SAFEARRAY. The source stays separately owned by the current statement.
  x.label(P+'put').enter().value(arg(8)).mov('ebx',at('eax',8)).testOperand('ebx','ebx').branch('e','error:9');
  x.push(arg(16)).push(addr(12)).pushOperand('ebx').invoke(DLL,'SafeArrayPutElement').call(V+'check').leave(12);
}
