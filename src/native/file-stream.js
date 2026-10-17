/** Buffered sequential byte streams. The OS cursor may lead the public cursor;
 * tell subtracts unread bytes, and seek invalidates every decoder/buffer state.
 * Heap buffers are slot-owned and released by Close, including after read errors.
 * https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-readfile
 * https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-setfilepointerex
 */
import {mem8,mem32} from './x86-operands.js';
const P='native:file:',K='kernel32.dll',arg=argument=>({argument}),addr=address=>({address});
const at=(base,displacement=0)=>mem32({base,displacement}),m=n=>at('ebp',n);
export function emitNativeFileStream(c){
 const x=c.x;
 x.label(P+'snapshot').enter().value(arg(8)).mov('edx',at('eax',12)).cmp('edx',m(12)).branch('ne','error:52').cmp(at('eax'),0).branch('e','error:52').leave(8);
 const inputReady=x.unique();
 x.label(P+'require-input').enter().push(arg(12)).push(arg(8)).call(P+'snapshot').cmp(at('eax',4),3).branch('e',inputReady).cmp(at('eax',4),4).branch('ne','error:54');
 x.mov('edx',at('eax',8)).and('edx',1).branch('e','error:54').label(inputReady).leave(8);
 // A peek never consumes a byte, including when a read-ahead fill is required.
 const available=x.unique(),buffer=x.unique(),eof=x.unique();
 x.label(P+'peek').enter(4).value(arg(8)).mov('esi','eax').mov('ebx',at('esi',36)).cmp('ebx',at('esi',40)).branch('b',available);
 x.mov('edi',at('esi',32)).testOperand('edi','edi').branch('ne',buffer)
  .api(K,'GetProcessHeap').pushOperand(at('esi',52)).pushOperand(0).push().invoke(K,'HeapAlloc').test().branch('e','error:7').mov('edi','eax').mov(at('esi',32),'eax');
 x.label(buffer).push(0).push(addr(-4)).pushOperand(at('esi',52)).pushOperand('edi').pushOperand(at('esi')).invoke(K,'ReadFile').test().branch('e',P+'last-error');
 x.mov('eax',m(-4)).cmp('eax',at('esi',52)).branch('a','error:75').mov(at('esi',40),'eax').mov(at('esi',36),0).mov('ebx',0).test().branch('e',eof);
 x.label(available).mov('eax',at('esi',32)).movzx('eax',mem8({base:'eax',index:'ebx'})).leave(4);
 x.label(eof).value(-1).leave(4);
 const byteDone=x.unique();x.label(P+'read-byte').enter().push(arg(8)).call(P+'peek').test().branch('s',byteDone).mov('edx',m(8)).inc(at('edx',36)).label(byteDone).leave(4);
 const output=x.unique(),notEof=x.unique(),binaryEof=x.unique();
 x.label(P+'eof').enter().value(arg(8)).cmp(at('eax',4),3).branch('ne',output).cmp(at('eax',44),0).branch('ne',notEof).push(arg(8)).call(P+'peek').test().setcc('s','al').movzx('eax','al').neg('eax').leave(4);
 x.label(output).cmp(at('eax',4),4).branch('ae',binaryEof).value(-1).leave(4);x.label(notEof).value(0).leave(4);
 x.label(binaryEof).push(arg(8)).call(P+'tell').mov('ebx','eax').push(arg(8)).call(P+'length').cmp('ebx','eax').setcc('ae','al').movzx('eax','al').neg('eax').leave(4);
 // Query with a 64-bit Win32 API, then explicitly reject values outside VB Long.
 x.label(P+'length').enter(8).value(arg(8)).mov('esi','eax').push(addr(-8)).pushOperand(at('esi')).invoke(K,'GetFileSizeEx').test().branch('e',P+'last-error');
 x.cmp(m(-4),0).branch('ne','error:6').mov('eax',m(-8)).test().branch('s','error:6').leave(4);
 x.label(P+'tell').enter(8).value(arg(8)).mov('esi','eax').push(1).push(addr(-8)).push(0).push(0).pushOperand(at('esi')).invoke(K,'SetFilePointerEx').test().branch('e',P+'last-error');
 const noBorrow=x.unique();
 x.mov('ecx',at('esi',40)).sub('ecx',at('esi',36)).mov('eax',m(-8)).mov('edx',m(-4)).sub('eax','ecx').branch('ae',noBorrow).dec('edx').label(noBorrow).testOperand('edx','edx').branch('ne','error:6').test().branch('s','error:6').leave(4);
 const seekPositionReady=x.unique(),locBytes=x.unique(),locRandom=x.unique();
 x.label(P+'seek-position').enter().push(arg(8)).call(P+'tell').mov('esi',m(8)).cmp(at('esi',4),5).branch('ne',seekPositionReady).mov('ecx',at('esi',48)).cdq().idiv('ecx');
 x.label(seekPositionReady).add('eax',1).branch('o','error:6').leave(4);
 x.label(P+'loc').enter().value(arg(8)).cmp(at('eax',4),5).branch('e',locRandom).push(arg(8)).call(P+'tell').mov('esi',m(8)).cmp(at('esi',4),4).branch('e',locBytes).shift('shr','eax',7).label(locBytes).leave(4);
 x.label(locRandom).mov('eax',at('eax',56)).leave(4);
 const seekScaled=x.unique();
 x.label(P+'seek-to').enter().push(arg(12)).push(arg(8)).call(P+'snapshot').mov('esi','eax').value(arg(16)).compare(1).branch('l','error:5').dec('eax');
 x.cmp(at('esi',4),5).branch('ne',seekScaled).imul('eax',at('esi',48)).branch('o','error:6').label(seekScaled).push().push(arg(12)).push(arg(8)).call(P+'seek-bytes').leave(12);
 x.label(P+'seek-bytes').enter().push(arg(12)).push(arg(8)).call(P+'snapshot').mov('esi','eax').value(arg(16)).test().branch('s','error:5');
 x.pushOperand(0).pushOperand(0).pushOperand(0).push().pushOperand(at('esi')).invoke(K,'SetFilePointerEx').test().branch('e',P+'last-error');
 for(const offset of [16,36,40,44])x.mov(at('esi',offset),0);
 x.value(0).leave(12);
 const attrOutput=x.unique(),attrAppend=x.unique(),attrBinary=x.unique(),attrRandom=x.unique();
 x.label(P+'attr').enter().value(arg(12)).compare(1).branch('ne','error:5').value(arg(8)).mov('eax',at('eax',4)).compare(1).branch('e',attrOutput).compare(2).branch('e',attrAppend).compare(4).branch('e',attrBinary).compare(5).branch('e',attrRandom).value(1).leave(8);
 x.label(attrOutput).value(2).leave(8);x.label(attrAppend).value(8).leave(8);
 x.label(attrBinary).value(32).leave(8);x.label(attrRandom).value(4).leave(8);
}
