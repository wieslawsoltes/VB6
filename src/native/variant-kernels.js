import {emitNativeVariantArraySnapshot} from './variant-array-snapshots.js';
import {emitNativeParamArrayHelpers} from './param-arrays.js';
/** Native Automation VARIANT kernels. Every externally visible write commits
 * from a complete owned temporary; a failed allocation/coercion preserves the
 * previous value. VARIANT is 16 bytes on the PE32 target, including DECIMAL.
 * https://learn.microsoft.com/en-us/windows/win32/api/oaidl/ns-oaidl-variant
 * https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-variantchangetypeex
 */
import {mem16,mem32} from './x86-operands.js';
import {MAX_NATIVE_STRING} from './storage.js';
import {emitNativeVariantReferences} from './variant-references.js';
import {emitNativeVariantDivision,NATIVE_VARIANT_DIVIDE_API} from './variant-division.js';
const P='native:variant:',DLL='oleaut32.dll',arg=argument=>({argument}),addr=address=>({address});
const m=offset=>mem32({base:'ebp',displacement:offset}),at=(base,displacement=0)=>mem32({base,displacement});
const w=(base,displacement=0)=>mem16({base,displacement});
export function emitNativeVariantHelpers(c){
 const used=c.nativeVariantsUsed;if(!used?.size)return;const x=c.x;
 if(used.has('divide'))emitNativeVariantDivision(x);
 if(used.has('assign'))emitNativeVariantReferences(x);
 if(used.has('paramarray'))emitNativeParamArrayHelpers(c);
 if(used.has('array-copy'))emitNativeVariantArraySnapshot(c);
 const checked=x.unique();x.label(P+'check').test().branch('ns',checked);
 for(const [hr,error]of [[0x8002000a,6],[0x8007000e,7],[0x8002000b,9],[0x8002000d,10],[0x80020012,11],[0x80070057,5],[0x80020004,449]])x.compare(hr).branch('e','error:'+error);
 x.jump('error:13').label(checked).ret();
 x.label(P+'clear').enter().api(DLL,'VariantClear',[arg(8)]).call(P+'check').value(0).leave(4);
 // publish(destination, ownedTemporary): transfer 16 bytes after old-owner clear.
 const publish=x.unique();x.label(P+'publish').enter().api(DLL,'VariantClear',[arg(8)]).test().branch('ns',publish);
 x.push().api(DLL,'VariantClear',[arg(12)]).popOperand('eax').call(P+'check');
 x.label(publish).value(arg(8)).mov('edi','eax').value(arg(12)).mov('esi','eax').mov('ecx',4).cld().repMove(32);
 x.value(arg(12));for(const offset of [0,4,8,12])x.mov(at('eax',offset),0);
 x.value(arg(8)).leave(8);
 function transaction(name,bytes,body){
  x.label(P+name).enter(16);for(const offset of [-16,-12,-8,-4])x.mov(m(offset),0);
  body();
  const good=x.unique(),bounded=x.unique(),within=x.unique();x.test().branch('ns',good).push().api(DLL,'VariantClear',[addr(-16)]).popOperand('eax').call(P+'check');
  x.label(good).cmp(mem16({base:'ebp',displacement:-16}),8).branch('ne',bounded);
  x.api(DLL,'SysStringLen',[arg(-8)]).compare(MAX_NATIVE_STRING).branch('be',within).api(DLL,'VariantClear',[addr(-16)]).jump('error:7').label(within);
  x.label(bounded).push(addr(-16)).push(arg(8)).call(P+'publish').leave(bytes);
 }
 transaction('copy',8,()=>x.api(DLL,'VariantCopyInd',[addr(-16),arg(12)]));
 if(used.has('change'))transaction('change',16,()=>{
  // Explicit conversion permits an Error's numeric code; implicit assignment
  // does not. Missing is distinct from an ordinary user-created Error value.
  const notError=x.unique(),convert=x.unique();
  x.value(arg(12)).cmp(w('eax'),1).branch('e','error:94').cmp(w('eax'),10).branch('ne',notError);
  x.cmp(at('eax',8),0x80020004).branch('e','error:449').cmp(m(20),0).branch('e','error:13').cmp(m(16),7).branch('e','error:13');
  // OleAut32 does not coerce VT_ERROR itself. A borrowed VT_I4 view carries the
  // original SCODE through the same checked explicit numeric/string conversion.
  x.mov('ecx',at('eax',8)).mov(m(-16),3).mov(m(-8),'ecx').push(arg(16)).push(2).push(0x400).push(addr(-16)).push(addr(-16)).invoke(DLL,'VariantChangeTypeEx').jump(convert);
  x.label(notError).api(DLL,'VariantChangeTypeEx',[addr(-16),arg(12),0x400,2,arg(16)]).label(convert);
 });
 for(const [name,api]of Object.entries({add:'VarAdd',subtract:'VarSub',multiply:'VarMul',divide:'VarDiv',idiv:'VarIdiv',mod:'VarMod',pow:'VarPow',and:'VarAnd',or:'VarOr',xor:'VarXor',eqv:'VarEqv',imp:'VarImp',cat:'VarCat'}))if(used.has(name))transaction(name,12,()=>name==='divide'?x.push(addr(-16)).push(arg(16)).push(arg(12)).call(NATIVE_VARIANT_DIVIDE_API):x.api(DLL,api,[arg(12),arg(16),addr(-16)]));
 for(const [name,api]of Object.entries({negate:'VarNeg',not:'VarNot',abs:'VarAbs',fix:'VarFix',int:'VarInt'}))if(used.has(name))transaction(name,8,()=>x.api(DLL,api,[arg(12),addr(-16)]));
 if(used.has('compare')){
  const system=x.unique(),result=x.unique(),nullValue=x.unique(),done=x.unique();
  x.label(P+'compare').enter(16);for(const offset of [-16,-12,-8,-4])x.mov(m(offset),0);
  // Binary String/String comparison is ordinal, not locale collation. Mixed
  // Variant types still follow Automation's type-order/coercion rules.
  x.cmp(m(24),0).branch('ne',system).value(arg(12)).cmp(w('eax'),8).branch('ne',system).mov('ebx',at('eax',8));
  x.value(arg(16)).cmp(w('eax'),8).branch('ne',system).pushOperand(at('eax',8)).pushOperand('ebx').call('native:string:compare').inc('eax').jump(result);
  x.label(system).api(DLL,'VarCmp',[arg(12),arg(16),0x400,arg(24)]).call(P+'check');
  x.label(result).compare(3).branch('e',nullValue);
  // The mask uses bit 0=less, 1=equal, 2=greater. Avoid variable-shift aliasing.
  x.mov('ecx','eax').mov('edx',1).shift('shl','edx','cl').testOperand(m(20),'edx').setcc('ne','al').movzx('eax','al').neg('eax');
  x.mov(m(-16),11).mov(m(-8),'eax').jump(done).label(nullValue).mov(m(-16),1).label(done);
  x.push(addr(-16)).push(arg(8)).call(P+'publish').leave(20);
 }
 if(used.has('condition')){
  const no=x.unique();x.label(P+'condition').enter(16).value(arg(8)).cmp(w('eax'),1).branch('e',no);
  for(const offset of [-16,-12,-8,-4])x.mov(m(offset),0);
  x.push(0).push(11).push(arg(8)).push(addr(-16)).call(P+'change').movsx('eax',w('eax',8)).leave(4);
  x.label(no).value(0).leave(4);
 }
}
