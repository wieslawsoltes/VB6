/** CPU regression for legacy SSE2 alignment, not a PE32/Windows emulator.
 * These SSE2 and MOV/RET byte encodings are identical in IA-32 and long mode.
 * The C caller supplies host-width RDI/RSI addresses; no x86 stack/ABI is tested.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {BinarySection} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {mem128} from '../src/native/x86-operands.js';
export function verifySSEAlignmentCPU() {
  if(process.platform!=='linux'||process.arch!=='x64')throw new Error('SSE CPU check requires Linux x86-64 and a C compiler');
  const make=unsafe=>{const s=new BinarySection('.text',0x60000020),x=new X86(s,null);x.sse('pxor','xmm4','xmm4');
    if(unsafe)x.sse('paddd','xmm4',mem128({base:'edi'}));else x.sseUnaligned('paddd','xmm4',mem128({base:'edi'}),'xmm5');
    x.sse('movdqu',mem128({base:'esi'}),'xmm4').mov('eax',0).ret();return s.bytes;};
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vb6-sse-cpu-'));
  try {
    const source=path.join(directory,'check.c'),binary=path.join(directory,'check');
    fs.writeFileSync(source,`#include <stdint.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
static const unsigned char safe_code[]={${make(false)}};
static const unsigned char raw_code[]={${make(true)}};
int main(int argc,char **argv){
  _Alignas(16) unsigned char input[64];_Alignas(16) uint32_t output[4];
  uint32_t expected[4]={1,2,3,4};const unsigned char *bytes=argc>1?raw_code:safe_code;
  size_t length=argc>1?sizeof(raw_code):sizeof(safe_code);long page=sysconf(_SC_PAGESIZE);
  if(page<1)return 90;void *code=mmap(0,page,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS,-1,0);
  if(code==MAP_FAILED)return 91;memcpy(code,bytes,length);if(mprotect(code,page,PROT_READ|PROT_EXEC))return 92;
  int (*run)(void*,void*)=(int(*)(void*,void*))code;
  if(argc>1){memcpy(input+12,expected,16);return run(input+12,output);}
  for(int offset=0;offset<16;offset++){memcpy(input+offset,expected,16);memset(output,0,sizeof(output));if(run(input+offset,output)||memcmp(output,expected,16))return offset+1;}
  munmap(code,page);return 0;
}
`);
    const built=spawnSync('cc',['-std=c11','-D_GNU_SOURCE','-O2',source,'-o',binary],{encoding:'utf8',timeout:20000});
    if(built.error||built.status!==0)throw new Error('SSE CPU harness build failed: '+(built.error?.message||built.stderr));
    const run=args=>spawnSync('/bin/sh',['-c','ulimit -c 0; exec "$@"','sse-cpu',binary,...args],{cwd:directory,encoding:'utf8',timeout:10000});
    const raw=run(['raw']);if(raw.signal!=='SIGSEGV')throw new Error('Expected original unaligned packed-memory form to fault, got '+JSON.stringify({status:raw.status,signal:raw.signal,stderr:raw.stderr,error:raw.error?.message}));
    const safe=run([]);if(safe.error||safe.status!==0)throw new Error('Unaligned-safe instruction sequence failed: '+JSON.stringify({status:safe.status,signal:safe.signal,stderr:safe.stderr,error:safe.error?.message}));
    return {ok:true,platform:'Linux x86-64 SSE2 CPU',unalignedLegacyForm:raw.signal,unalignedSafeOffsets:16,scope:'identical SSE2 encodings only; not PE32 or Windows execution'};
  } finally{fs.rmSync(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(verifySSEAlignmentCPU(),null,2));
