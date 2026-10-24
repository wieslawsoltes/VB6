import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {exportLinuxApplication,exportLinuxAOT,loadLinuxAOTRuntime,verifyLinuxAOTRuntime} from '../packages/linux-native/src/index.js';
import {setResourceString} from '../src/project/res.js';
const execute=promisify(execFile);
const architecture=process.arch==='arm64'?'arm64':'x64',runtimeArchitecture=architecture==='arm64'?'arm64':'x86_64';
const nativeHost=process.platform==='linux'&&['x64','arm64'].includes(process.arch);
const glibc=nativeHost?String(process.report?.getReport().header.glibcVersionRuntime||'0.0').split('.').map(Number):[0,0];
const supportedHost=nativeHost&&(glibc[0]>2||glibc[0]===2&&glibc[1]>=39);
const runtimeDirectory=process.env.VB6_LINUX_AOT_RUNTIME_DIR;
const rebuiltRuntime=runtimeDirectory?{bytes:new Uint8Array(await readFile(path.join(runtimeDirectory,'runtime-'+runtimeArchitecture))),manifest:JSON.parse(await readFile(path.join(runtimeDirectory,'runtime.json'),'utf8'))}:null;
for(const target of ['x64','arm64'])test('embedded Linux '+target+' runtime bytes and symbol manifest are isolated for each caller',async()=>{
  const first=await loadLinuxAOTRuntime({architecture:target});await verifyLinuxAOTRuntime(first.bytes,first.manifest);first.bytes[0]^=1;first.manifest.helpers.vb6_aot_clear++;
  const second=await loadLinuxAOTRuntime({architecture:target});await verifyLinuxAOTRuntime(second.bytes,second.manifest);assert.equal(second.bytes[0],0x7f);
  assert.equal(second.manifest.architecture,target==='arm64'?'arm64':'x86_64');
  const controller=new AbortController();controller.abort();await assert.rejects(()=>loadLinuxAOTRuntime({architecture:target,signal:controller.signal}),{name:'AbortError'});
});
test('JS-emitted '+runtimeArchitecture+' ELF executes ABI stack arguments, nested calls, errors and resources',{
  skip:!supportedHost?'Requires Linux x64/arm64 with glibc 2.39 or newer':false,timeout:60000
},async()=>{
  const project={schema:1,name:'LinuxNativeABI',startup:'Sub Main',resources:setResourceString(null,101,'Zażółć\0🙂'),modules:[{name:'MainModule',kind:'module',code:`Option Explicit
Private Function Add(ByVal a As Long, ByRef b As Long) As Long
  b = b + 3
  Add = a + b
End Function
Private Function Counter() As Long
  Static count As Long
  count = count + 1
  Counter = count
End Function
Public Sub Main()
  Dim fixed As String * 7, i As Long, n As Long, total As Long
  fixed = "abc"
  Debug.Assert Len(fixed) = 7
  Debug.Assert fixed = "abc    "
  Debug.Assert Add(9, n) = 12
  Debug.Assert n = 3
  Debug.Assert Counter() = 1
  Debug.Assert Counter() = 2
  For i = 1 To 10
    total = total + i
  Next
  Debug.Assert total = 55
  Dim values() As Long
  ReDim values(-2 To 2)
  values(-1) = 71
  ReDim Preserve values(-2 To 5)
  Debug.Assert values(-1) = 71
  GoSub bump
  Debug.Assert total = 56
  On Error GoTo handled
  Error 11
  Debug.Assert False
afterError:
  Debug.Assert LoadResString(101) = "Zażółć" & ChrW(0) & "🙂"
  Debug.Print "LINUX_NATIVE_ABI_OK"
  Exit Sub
bump:
  total = total + 1
  Return
handled:
  Debug.Assert Err.Number = 11
  Resume afterError
End Sub`}]};
  const exported=rebuiltRuntime?await exportLinuxAOT(project,rebuiltRuntime,{architecture,optimization:3}):await exportLinuxApplication(project,{architecture,optimization:3}),directory=await mkdtemp(path.join(os.tmpdir(),'vb6-linux-aot-test-'));
  try{
    for(const [name,bytes]of Object.entries(exported.files)){const file=path.join(directory,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
    const executable=path.join(directory,project.name,'bin',project.name);await chmod(executable,0o755);
    // A distinct working directory proves RES lookup follows the application,
    // while removing DISPLAY proves console code does not require GTK startup.
    const cwd=path.join(directory,'unrelated');await mkdir(cwd);const env={...process.env};delete env.DISPLAY;delete env.WAYLAND_DISPLAY;
    const result=await execute(executable,[],{cwd,env,timeout:30000,maxBuffer:1024*1024});assert.match(result.stdout,/LINUX_NATIVE_ABI_OK/);assert.equal(result.stderr,'');
  }finally{await rm(directory,{recursive:true,force:true});}
});
