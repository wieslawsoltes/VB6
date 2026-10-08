/** Detach borrowed elements of a newly cloned Variant SAFEARRAY before it can
 * escape its caller. Returns HRESULT: the owner must destroy a failed clone.
 * Never publishes a partially normalized array and never clears a referent.
 * https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-variantcopyind
 */
import {mem16,mem32} from './x86-operands.js';
import {NATIVE_ARRAY_MAX_BYTES,NATIVE_ARRAY_MAX_RANK} from './arrays.js';
const DLL='oleaut32.dll',arg=argument=>({argument}),addr=address=>({address});
const at=(base,displacement=0)=>mem32({base,displacement}),local=n=>at('ebp',n);
export function emitNativeVariantArraySnapshot(c){
 const x=c.x,limit=Math.floor((c.maxArrayBytes??NATIVE_ARRAY_MAX_BYTES)/16);
 const bounds=x.unique(),loop=x.unique(),next=x.unique();
 const failure=x.unique(),unlock=x.unique(),returnError=x.unique(),done=x.unique(),invalid=x.unique(),overflow=x.unique();
 x.label('native:variant:array-detach').enter(24);
 for(const n of [-24,-20,-16,-12,-8,-4])x.mov(local(n),0);
 x.value(arg(8)).test().branch('e',invalid).mov('ebx','eax');
 x.cmp(at('ebx',4),16).branch('ne',invalid).movzx('ecx',mem16({base:'ebx'}));
 x.cmp('ecx',1).branch('b',invalid).cmp('ecx',NATIVE_ARRAY_MAX_RANK).branch('a',invalid);
 x.mov('esi','ebx').add('esi',16).mov('edi',1).label(bounds);
 x.imul('edi',at('esi')).branch('o',overflow).cmp('edi',limit).branch('a',overflow);
 x.add('esi',8).dec('ecx').branch('ne',bounds);
 x.api(DLL,'SafeArrayAccessData',[arg(8),addr(-24)]).test().branch('s',done);
 x.mov('esi',local(-24)).label(loop).testOperand('edi','edi').branch('e',unlock);
 x.testOperand(mem16({base:'esi'}),0x4000).branch('e',next);
 x.pushOperand('esi').push(addr(-16)).invoke(DLL,'VariantCopyInd').test().branch('s',failure);
 // Clearing a borrowed VARIANT descriptor does not destroy its target.
 x.pushOperand('esi').invoke(DLL,'VariantClear').test().branch('s',failure);
 for(const n of [0,4,8,12])x.mov('eax',local(-16+n)).mov(at('esi',n),'eax').mov(local(-16+n),0);
 x.label(next).add('esi',16).dec('edi').jump(loop);
 x.label(failure).mov(local(-20),'eax').api(DLL,'VariantClear',[addr(-16)]);
 x.label(unlock).api(DLL,'SafeArrayUnaccessData',[arg(8)]).cmp(local(-20),0).branch('ne',returnError).jump(done);
 x.label(returnError).value(arg(-20)).jump(done);
 x.label(invalid).value(0x80070057).jump(done).label(overflow).value(0x8007000e);
 x.label(done).leave(4);
}
