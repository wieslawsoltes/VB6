/** Self-checking PE32 executables. Execute on Windows, not in a JS VM. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {nativeLanguageFixture} from '../tests/fixtures/native-language.mjs';
import {nativeLanguageFixture as continuationLanguageFixture} from './win32-language-fixtures.mjs';
import {nativeStringLibraryFixture} from './win32-string-library-fixtures.mjs';
import {nativeWithControlsFixture} from './win32-with-controls-fixtures.mjs';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {win32Fixtures} from './win32-fixtures.mjs';
import {PE32Image} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {mem32,mem64,mem128} from '../src/native/x86-operands.js';
export function optimizerFixture() {
  const checks=[],lines=['Dim n As Long, m As Long, i As Long, p As POINTAPI, q As POINTAPI, box As BOX, clock As SYSTEMTIME, fileTime As FILETIME, again As SYSTEMTIME'];
  const add=source=>lines.push(source);
  const check=(expression,label)=>{checks.push(label);add(`If Not (${expression}) Then ExitProcess ${checks.length}`);};
  check('16777217! = 16777216!', 'Single literals round before comparison at every optimization level');
  check('16777217# <> 16777216#', 'Double literals are not narrowed to Single by optimization');
  check('(3 + 4) * (11 - 2) = 63','pure integer expression folding');
  add('n = (3 + 4) * (11 - 2)');check('n = 63','constant-folded assignment preserves its typed value independently of branch folding');
  check('-7 \\ 3 = -2 And -7 Mod 3 = -1','signed division and remainder');
  check('(2 Eqv 3) = -2 And (2 Imp 3) = -1','eager bitwise Eqv and Imp');
  add('n = 7\nn = n * 9 + 128 - 127');
  check('n = 64','immediate multiply/add/subtract preserve checked results');
  add('n = Touch() * 0');
  check('n = 0 And sequence = 1','multiply by zero still evaluates effectful left operand');
  add('n = 0 And Touch()');
  check('sequence = 2','Boolean And remains eager');
  add('n = -1 Or Touch()');
  check('sequence = 3','Boolean Or remains eager');
  add('n = 0\nFor i = 1 To 100\n n = n + i\nNext');
  check('n = 5050','forward/backward branches and loop arithmetic');
  add('On Error Resume Next\nErr.Clear\nn = 2147483647\nn = n + 1');
  check('Err.Number = 6 And n = 2147483647','checked immediate overflow leaves destination unchanged');
  add('Err.Clear\nn = (2147483647 + 1) - 1');
  check('Err.Number = 6 And n = 2147483647','overflowing constant subtree cannot be folded away');
  add('Err.Clear\nn = 123\nm = 0\nn = 7 \\ m');
  check('Err.Number = 11 And n = 123','division error and Resume Next remain correctly located');
  add('Err.Clear\nOn Error GoTo 0\np.x = 11\np.y = -7\nq = p\nChange q\nChange (p)');
  check('p.x = 11 And p.y = -7 And q.x = 12 And q.y = 42','POD snapshots, true ByRef aliases and parenthesized isolated copies');
  check('Len(p) = 8 And LenB(p) = 8 And VarPtr(p) <> 0','record sizes and address intrinsic');
  add('box.tag = 9\nbox.first = q\nbox.samples(-1, 3) = -32768\nbox.samples(2, 4) = 32767\nbox.corners(0) = p\nbox.corners(1) = q');
  check('box.tag = 9 And box.first.x = 12 And box.samples(-1, 3) = -32768 And box.samples(2, 4) = 32767 And box.corners(1).y = 42','nested records and multidimensional inline array strides');
  check('Len(box) = 41 And LenB(box) = 44','record Len omits padding and LenB includes it');
  add('sequence = 0\nbox.samples(IndexOnce(), 3) = 81');
  check('sequence = 1 And box.samples(-1, 3) = 81','field subscript expressions evaluate once');
  add('On Error Resume Next\nErr.Clear\nbox.samples(3, 3) = 10');
  check('Err.Number = 9 And box.tag = 9','inline array bounds are checked before storing');
  add('Err.Clear\nOn Error GoTo 0\nCopyMemory p, q, LenB(p)');
  check('p.x = 12 And p.y = 42','As Any passes record storage to Win32 RtlMoveMemory');
  add('p.x = 0\nCopyMemory ByVal VarPtr(p), ByVal VarPtr(q), LenB(p)');
  check('p.x = 12','explicit ByVal pointers use Win32 value ABI, not pointer-to-pointer');
  add('GetSystemTime clock');
  check('clock.year >= 2020 And clock.month >= 1 And clock.month <= 12 And clock.day >= 1 And clock.day <= 31 And clock.milliseconds >= 0','typed Win32 SYSTEMTIME output fields and alignment');
  check('SystemTimeToFileTime(clock, fileTime) <> 0 And FileTimeToSystemTime(fileTime, again) <> 0','typed SYSTEMTIME/FILETIME pointer input and output');
  check('again.year = clock.year And again.month = clock.month And again.day = clock.day And again.hour = clock.hour And again.minute = clock.minute And again.second = clock.second And again.milliseconds = clock.milliseconds','installed Windows time conversion round-trip preserves all fields');
  add('For i = 1 To 3000\n q = p\n Change (q)\nNext');
  check('q.x = p.x And q.y = p.y','repeated record temporaries retain isolated per-call lifetime');
  add('ExitProcess 0');
  const project=newProject('AotOptimizerRecords');project.startup='Sub Main';
  project.modules=[{id:'entry',name:'Entry',kind:'module',code:`Option Explicit
Private Type POINTAPI
 x As Long
 y As Long
End Type
Private Type BOX
 tag As Byte
 first As POINTAPI
 samples(-1 To 2, 3 To 4) As Integer
 corners(0 To 1) As POINTAPI
End Type
Private Type SYSTEMTIME
 year As Integer
 month As Integer
 weekday As Integer
 day As Integer
 hour As Integer
 minute As Integer
 second As Integer
 milliseconds As Integer
End Type
Private Type FILETIME
 low As Long
 high As Long
End Type
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (dst As Any, src As Any, ByVal bytes As Long)
Private Declare Sub GetSystemTime Lib "kernel32" (value As SYSTEMTIME)
Private Declare Function SystemTimeToFileTime Lib "kernel32" (clock As SYSTEMTIME, result As FILETIME) As Long
Private Declare Function FileTimeToSystemTime Lib "kernel32" (fileTime As FILETIME, result As SYSTEMTIME) As Long
Private sequence As Long
Private Function Touch() As Long
 sequence = sequence + 1
 Touch = sequence
End Function
Private Function IndexOnce() As Long
 sequence = sequence + 1
 IndexOnce = -1
End Function
Private Sub Change(p As POINTAPI)
 p.x = p.x + 1
 p.y = 42
End Sub
Public Sub Main()
 ${lines.join('\n ')}
End Sub
`}];return {project,checks};
}
export function assemblerFixture(optimization=1) {
  const image=new PE32Image(),text=image.section('.text',0x60000020),data=image.section('.data',0xc0000040),x=new X86(text,image),checks=[];
  const check=(name,condition='e')=>{const ok=x.unique('check');checks.push(name);x.branch(condition,ok).api('kernel32.dll','ExitProcess',[checks.length]).label(ok);};
  const equal=(n,name)=>{x.compare(n);check(name);};
  const float=(label,value)=>{const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,value,true);data.align(8).label(label).emit(...bytes);};
  data.label('counter').u32(4).label('pair').u32(1).u32(2).label('result').zero(16).label('packed').u32(1).u32(2).u32(3).u32(4);
  data.align(16).label('packed-aligned').u32(1).u32(2).u32(3).u32(4);float('a',1.5);float('b',2.25);
  x.label('entry').enter(64).mov('eax',127).add('eax',128);equal(255,'checked scalar immediate encoding executes');
  x.mov('eax',-7).cdq().mov('ecx',3).idiv('ecx');equal(-2,'signed IDIV quotient');x.mov('eax','edx');equal(-1,'signed IDIV remainder');
  x.mov('eax',0x80000000).shift('sar','eax',31);equal(-1,'arithmetic right shift');
  x.mov('eax',0x7fffffff).add('eax',1);check('overflow flag is preserved by checked encoding','o');
  x.fninit().fld(mem64({label:'a'})).fadd(mem64({label:'b'})).fistp(mem32({label:'result'})).mov('eax',mem32({label:'result'}));equal(4,'x87 nearest-even conversion and memory operands');
  x.fld(mem64({label:'a'})).fld(mem64({label:'b'})).fsubp(1).fstp(mem64({label:'result'}));
  x.sse('movsd','xmm0',mem64({label:'result'})).sseConvert('cvttsd2si','eax','xmm0');equal(0,'x87 stack subtraction and SSE truncation');
  x.sse('movsd','xmm3',mem64({label:'a'})).sse('addsd','xmm3',mem64({label:'b'})).sseConvert('cvttsd2si','eax','xmm3');equal(3,'SSE2 scalar Double arithmetic and conversion');
  // Legacy packed arithmetic requires aligned memory; MOVDQU is the explicit unaligned load.
  x.sse('pxor','xmm4','xmm4').sse('movdqu','xmm5',mem128({label:'packed'})).sse('paddd','xmm4','xmm5').sseShift('pslld','xmm4',1).sse('movdqu',mem128({label:'result'}),'xmm4');
  for(let i=0;i<4;i++){x.mov('eax',mem32({label:'result',displacement:i*4}));equal((i+1)*2,'SSE2 packed lane '+i);}
  x.sse('pxor','xmm4','xmm4').sse('paddd','xmm4',mem128({label:'packed-aligned'})).sse('movdqu',mem128({label:'result'}),'xmm4');
  for(let i=0;i<4;i++){x.mov('eax',mem32({label:'result',displacement:i*4}));equal(i+1,'aligned SSE2 memory lane '+i);}
  x.sse('pxor','xmm6','xmm6').sseUnaligned('paddd','xmm6',mem128({label:'packed'}),'xmm7').sse('movdqu',mem128({label:'result'}),'xmm6');
  for(let i=0;i<4;i++){x.mov('eax',mem32({label:'result',displacement:i*4}));equal(i+1,'explicit unaligned SSE2 helper lane '+i);}
  x.mov('eax',4).mov('ecx',9).atomic('cmpxchg',mem32({label:'counter'}),'ecx');check('locked CMPXCHG success flag');
  x.mov('eax',3).atomic('xadd',mem32({label:'counter'}),'eax');equal(9,'locked XADD returns old value');x.mov('eax',mem32({label:'counter'}));equal(12,'locked XADD writes sum');
  x.mov('eax',1).mov('edx',2).mov('ebx',3).mov('ecx',4).cmpxchg8b(mem64({label:'pair'}));check('locked CMPXCHG8B success flag');
  x.mov('eax',mem32({label:'pair'}));equal(3,'CMPXCHG8B low half');x.mov('eax',mem32({label:'pair',displacement:4}));equal(4,'CMPXCHG8B high half');
  x.mov('edi','esp').cdecl('msvcrt.dll','abs',[-17]);equal(17,'cdecl imported return value');x.cmp('esp','edi');check('cdecl caller stack cleanup');
  x.mov('ecx',6).value('indirect').callIndirect('eax');equal(7,'register-indirect call/return');
  x.mov('edi','esp').pushOperand(5).pushOperand(4).call('sum');equal(9,'stdcall arguments in formal stack order');x.cmp('esp','edi');check('stdcall callee stack cleanup');
  x.api('kernel32.dll','ExitProcess',[0]);
  x.label('indirect').add('ecx',1).mov('eax','ecx').ret();
  x.label('sum').enter().mov('eax',mem32({base:'ebp',displacement:8})).add('eax',mem32({base:'ebp',displacement:12})).leave(8);
  const linked=image.finish('entry',{optimization});
  return {bytes:linked.bytes,report:{size:linked.bytes.length,optimization:linked.optimization,architecture:'x86',target:'assembler-test',dataAddresses:{packed:linked.symbols.packed,alignedPacked:linked.symbols['packed-aligned'],result:linked.symbols.result},sections:linked.sections,imports:linked.imports},checks};
}
export function writeOptimizerFixtures(directory='reports/native-optimizer') {
  fs.mkdirSync(directory,{recursive:true});const reports=[],fixture=optimizerFixture();
  const arithmetic=win32Fixtures()[0];
  // The existing arithmetic fixture is an independent regression, not an optimizer oracle.
  const continuation=continuationLanguageFixture(),strings=nativeStringLibraryFixture();
  const fixtures=[fixture,nativeLanguageFixture(),continuation,strings,nativeWithControlsFixture(),{project:arithmetic,checks:['existing AOT arithmetic/recursion/scalar/Declare regression']}];
  for(const {project,checks}of fixtures)for(const optimization of [0,1,2]) {
    const result=compileWin32(project,{optimization}),name=project.name+'-O'+optimization;
    const report={name,optimization,checks,sha256:createHash('sha256').update(result.bytes).digest('hex'),...result.report};
    fs.writeFileSync(path.join(directory,name+'.exe'),result.bytes);
    fs.writeFileSync(path.join(directory,name+'.build.json'),JSON.stringify(report,null,2)+'\n');reports.push(report);
  }
  for(const {project,checks}of [continuation,strings]){
    const result=compileWin32(project,{optimization:2,pruneUnusedProcedures:true}),name=project.name+'-O2-pruned';
    if(!result.report.optimization.removedProcedures.includes('proc:Entry:NeverCalled'))throw new Error('Unreachable fixture procedure was not pruned');
    const report={name,checks,sha256:createHash('sha256').update(result.bytes).digest('hex'),...result.report};
    fs.writeFileSync(path.join(directory,name+'.exe'),result.bytes);fs.writeFileSync(path.join(directory,name+'.build.json'),JSON.stringify(report,null,2)+'\n');reports.push(report);
  }
  for(const optimization of [0,1,2]){const result=assemblerFixture(optimization),name='AotAssembler-O'+optimization,report={name,checks:result.checks,sha256:createHash('sha256').update(result.bytes).digest('hex'),...result.report};fs.writeFileSync(path.join(directory,name+'.exe'),result.bytes);fs.writeFileSync(path.join(directory,name+'.build.json'),JSON.stringify(report,null,2)+'\n');reports.push(report);}
  fs.writeFileSync(path.join(directory,'builds.json'),JSON.stringify(reports,null,2)+'\n');return reports;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const reports=writeOptimizerFixtures(process.argv[2]);console.log(JSON.stringify(reports.map(r=>({name:r.name,optimization:r.optimization,bytes:r.size,checks:r.checks.length})),null,2));}
