import {mem16,mem32} from './x86-operands.js';

/** Load an operating-system control DLL without trusting the application's
 * directory. Windows 7 without KB2533623 rejects LOAD_LIBRARY_SEARCH_SYSTEM32
 * with ERROR_INVALID_PARAMETER; its supported fallback is an absolute system
 * directory path, never a bare-name LoadLibrary call.
 * https://learn.microsoft.com/windows/win32/api/libloaderapi/nf-libloaderapi-loadlibraryexw
 */
export function loadNativeControlLibrary(compiler,library){
  if(!/^[a-z0-9_-]+\.dll$/i.test(library))throw new TypeError('Invalid system control library');
  const x=compiler.x,label='native:control-library:'+library,done=x.unique(),loaded=x.unique(),failed=x.unique(),overflow=x.unique();
  const capacity=260,buffer=-capacity*2;
  x.call(label).jump(done);
  x.label(label).enter(capacity*2);
  x.api('kernel32.dll','LoadLibraryExW',[compiler.string(library),0,0x800]).test().branch('ne',loaded);
  x.api('kernel32.dll','GetLastError').compare(87).branch('ne',failed);
  x.api('kernel32.dll','GetSystemDirectoryW',[{address:buffer},capacity]).test().branch('e',failed);
  // Reserve a separator, the exact library name and its terminating WCHAR.
  x.compare(capacity-library.length-2).branch('a',overflow);
  x.lea('edi',mem32({base:'ebp',index:'eax',scale:2,displacement:buffer}));
  x.mov(mem16({base:'edi'}),92).add('edi',2);
  x.value(compiler.string(library)).mov('esi','eax').mov('ecx',library.length+1).cld().repMove(16);
  // LOAD_WITH_ALTERED_SEARCH_PATH starts dependency lookup alongside the full
  // system path on legacy Windows. The primary DLL name is always absolute.
  x.api('kernel32.dll','LoadLibraryExW',[{address:buffer},0,8]).test().branch('ne',loaded);
  x.label(failed).api('kernel32.dll','GetLastError').store('native:error:lastdllerror').value(48).jump('native:error:raise');
  x.label(overflow).value(206).store('native:error:lastdllerror').value(48).jump('native:error:raise');
  x.label(loaded).leave().label(done);
}
