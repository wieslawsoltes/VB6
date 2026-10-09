/** Small synchronous Win32 kernels. File table entries own handles, including
 * error paths; no helper holds an unregistered BSTR across an error transfer. */
import {mem32} from './x86-operands.js';
import {NATIVE_FILE_SLOT_BYTES as SIZE} from './files.js';
const P='native:file:',K='kernel32.dll',arg=argument=>({argument}),addr=address=>({address});
const at=(base,displacement=0)=>mem32({base,displacement}),m=n=>at('ebp',n);
export function emitNativeFileHelpers(c){
  if(!c.nativeFilesUsed)return;const x=c.x;
  // Stable, process-owned zeroed slots are allocated lazily, not embedded as
  // 16 KiB of zero bytes in every executable. Close retains their generations.
  const allocated=x.unique();
  x.label(P+'get-table').enter().mov('eax',mem32({label:P+'table'})).test().branch('ne',allocated)
    .api(K,'GetProcessHeap',[]).mov('ebx','eax').push(512*SIZE).push(8).pushOperand('ebx').invoke(K,'HeapAlloc').test().branch('e','error:7').store(P+'table')
    .label(allocated).leave();
  // Slot indices are validated before scaling; index zero is never exposed.
  x.label(P+'entry').enter().value(arg(8)).compare(1).branch('l','error:52').compare(511).branch('g','error:52').imul('ebx','eax',SIZE).call(P+'get-table').add('eax','ebx').leave(4);
  x.label(P+'resolve').enter().push(arg(8)).call(P+'entry').cmp(at('eax'),0).branch('e','error:52').leave(4);
  const high=x.unique(),search=x.unique(),found=x.unique();
  x.label(P+'free').enter().value(arg(8)).test().branch('ne',high).mov('ebx',1).mov('esi',256).jump(search);
  x.label(high).compare(1).branch('ne','error:5').mov('ebx',256).mov('esi',512);
  x.label(search).cmp('ebx','esi').branch('ae','error:67').pushOperand('ebx').call(P+'entry').cmp(at('eax'),0).branch('e',found).inc('ebx').jump(search);
  x.label(found).mov('eax','ebx').leave(4);
  // Errors are read before any cleanup API, then mapped after the cleanup.
  x.label(P+'last-error').api(K,'GetLastError');
  x.label(P+'error');
  for(const [code,error]of [[2,53],[3,76],[4,67],[5,70],[6,52],[8,7],[14,7],[32,70],[33,70],[80,58],[112,61],[123,52],[206,52]])x.compare(code).branch('e','error:'+error);
  x.jump('error:75');
  const openFail=x.unique(),valid=x.unique(),scan=x.unique(),next=x.unique(),truncate=x.unique(),publish=x.unique(),duplicate=x.unique(),closed=x.unique();
  x.label(P+'open').enter(56).push(arg(12)).call(P+'entry').mov('esi','eax').cmp(at('esi'),0).branch('ne','error:55');
  x.api('oleaut32.dll','SysStringLen',[arg(8)]).test().branch('e','error:52').compare(32767).branch('g','error:52').mov('ebx','eax')
    .api(K,'lstrlenW',[arg(8)]).cmp('eax','ebx').branch('ne','error:52');
  // OPEN_ALWAYS prevents truncation before duplicate-file identity is checked.
  // FILE_APPEND_DATA makes each append write target the actual EOF atomically.
  x.value(arg(16)).compare(2).branch('ne',valid).mov('ebx',4).jump(closed).label(valid).mov('ebx',0x40000000).label(closed);
  x.push(0).push(128).push(4).push(0).push(arg(20)).pushOperand('ebx').push(arg(8)).invoke(K,'CreateFileW').compare(-1).branch('e',P+'last-error').mov('edi','eax');
  x.push(addr(-52)).pushOperand('edi').invoke(K,'GetFileInformationByHandle');
  // The assembler's argument API uses explicit register operands below, never
  // register names disguised as relocatable strings.
  x.test().branch('e',openFail).mov('ebx',1).label(scan).cmp('ebx',512).branch('ae',truncate).pushOperand('ebx').call(P+'entry').mov('edx','eax').cmp(at('edx'),0).branch('e',next);
  for(const [source,target]of [[-24,20],[-8,24],[-4,28]])x.mov('eax',m(source)).cmp('eax',at('edx',target)).branch('ne',next);
  x.jump(duplicate).label(next).inc('ebx').jump(scan);
  x.label(truncate).cmp(m(16),2).branch('e',publish).pushOperand('edi').invoke(K,'SetEndOfFile').test().branch('e',openFail);
  x.label(publish).mov(at('esi'),'edi').value(arg(16)).mov(at('esi',4),'eax').mov(at('esi',8),2).inc(at('esi',12)).mov(at('esi',16),0);
  for(const [source,target]of [[-24,20],[-8,24],[-4,28]])x.mov('eax',m(source)).mov(at('esi',target),'eax');
  x.value(0).leave(16);
  x.label(duplicate).pushOperand('edi').invoke(K,'CloseHandle').jump('error:55');
  x.label(openFail).api(K,'GetLastError').mov('ebx','eax').pushOperand('edi').invoke(K,'CloseHandle').mov('eax','ebx').jump(P+'error');
  const done=x.unique();
  x.label(P+'close').enter().push(arg(8)).call(P+'entry').mov('esi','eax').mov('eax',at('esi')).test().branch('e',done).push().invoke(K,'CloseHandle').test().branch('e',P+'last-error');
  x.mov(at('esi'),0).inc(at('esi',12)).mov(at('esi',16),0).label(done).value(0).leave(4);
  const closeLoop=x.unique();x.label(P+'close-all').enter().mov('ebx',1).label(closeLoop).pushOperand('ebx').call(P+'close').inc('ebx').cmp('ebx',512).branch('b',closeLoop).leave();
  // write(entry, capturedGeneration, ownedByteBstr, resultingColumn)
  const write=x.unique(),written=x.unique();
  x.label(P+'write').enter(4).value(arg(8)).mov('esi','eax').mov('eax',at('esi',12)).cmp('eax',m(12)).branch('ne','error:52').cmp(at('esi'),0).branch('e','error:52');
  x.cmp(at('esi',4),1).branch('e',write).cmp(at('esi',4),2).branch('ne','error:54').label(write);
  x.api('oleaut32.dll','SysStringByteLen',[arg(16)]).mov('ebx','eax').value(arg(16)).mov('edi','eax');
  const loop=x.unique();x.label(loop).testOperand('ebx','ebx').branch('e',written).push(0).push(addr(-4)).pushOperand('ebx').pushOperand('edi').pushOperand(at('esi')).invoke(K,'WriteFile').test().branch('e',P+'last-error');
  x.value(arg(-4)).test().branch('e','error:61').cmp('eax','ebx').branch('a','error:75').add('edi','eax').sub('ebx','eax').jump(loop);
  x.label(written).value(arg(20)).mov(at('esi',16),'eax').value(0).leave(16);
}
