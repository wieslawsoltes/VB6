import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLinuxAOT,linuxOptions,LINUX_TARGET,LINUX_TARGETS,linuxTarget,linuxArtifactFilename,linkLinuxAOT,verifyLinuxAOTArchive} from '../packages/linux-native/src/index.js';
import {inspectLinuxELF,createLinuxAOTRuntimeManifest,verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
import {emitLinuxAOTFunctions,linkLinuxARM64AOT,LinuxARM64AOTAssembler} from '../packages/linux-native/src/aot-emitter.js';
import {AOTFunction} from '../packages/macos-native/src/aot-emitter.js';
import {linuxELFFixture} from './linux-aot-elf-fixture.mjs';
const project={schema:1,name:'LinuxARM64',startup:'Sub Main',modules:[{name:'M',kind:'module',code:'Sub Main()\nDebug.Assert 40 + 2 = 42\nEnd Sub'}]};
const runtimes={};for(const architecture of ['x64','arm64']){const bytes=linuxELFFixture(architecture);runtimes[architecture]={bytes,manifest:await createLinuxAOTRuntimeManifest(bytes,{fixture:true})};}

test('Linux x64 remains the default and ARM64 explicitly selects the AAPCS64 ELF target',()=>{
  assert.equal(LINUX_TARGET,LINUX_TARGETS.x64);assert.equal(linuxOptions().architecture,'x64');assert.equal(linuxOptions().arch,'x86_64');
  assert.equal(linuxOptions({architecture:'arm64'}).arch,'arm64');assert.equal(linuxTarget('arm64').callingConvention,'aapcs64');assert.equal(linuxTarget('arm64').machine,183);
  assert.throws(()=>linuxOptions({architecture:'arm64',arch:'x86_64'}),/Conflicting/);assert.throws(()=>linuxOptions({architecture:'riscv64'}),/architecture/);
});
test('ARM64 uses the existing helper graph, real instructions, ELF symbols and selected target constants',()=>{
  const input=structuredClone(project);input.settings={conditionalConstants:{ARM64:0,AARCH64:0,X86_64:-1,Mac:-1}};
  input.modules[0].code='#If Linux And ARM64 And AARCH64 And (X86_64 = 0) And (AMD64 = 0) And (Mac = 0) Then\nSub Main()\nDebug.Print "ARM64_SELECTED"\nEnd Sub\n#Else\nSub Main()\nError 5\nEnd Sub\n#End If';
  const before=structuredClone(input);
  for(const optimization of [0,1,2,3]){
    const compiled=compileLinuxAOT(input,{architecture:'arm64',optimization}),bytes=Uint8Array.from(compiled.section.bytes),view=new DataView(bytes.buffer);
    assert.equal(compiled.report.target,'linux-arm64');assert.equal(compiled.report.codegen,'arm64-aot');assert.equal(compiled.report.callingConvention,'aapcs64');
    assert.equal(compiled.report.optimization.level,optimization);assert.ok(compiled.metadata.literals.some(v=>v.value==='ARM64_SELECTED'));
    for(const offset of compiled.metadata.entries){assert.equal(offset%16,0);assert.equal(view.getUint32(offset,true),0xa9bf7bfd);}
    assert.ok(compiled.section.fixups.every(f=>f.kind.startsWith('arm64-')));assert.ok(compiled.section.fixups.some(f=>f.label==='vb6_aot_print'));assert.ok(!compiled.section.fixups.some(f=>f.label.startsWith('_vb6_')));
    assert.ok(!JSON.stringify(compiled.metadata).includes('"op":'));
  }
  assert.deepEqual(input,before);
});
test('ARM64 ELF links immutable project mappings at 64 KiB boundaries and verifies its actual machine ABI',async()=>{
  const compiled=compileLinuxAOT(project,{architecture:'arm64'}),result=await linkLinuxAOT(compiled,runtimes.arm64),layout=inspectLinuxELF(result.executable,{requireProject:true,architecture:'arm64'});
  assert.equal(new DataView(result.executable.buffer).getUint16(18,true),183);assert.equal(result.filename,'LinuxARM64-linux-arm64.zip');
  assert.equal(layout.image.architecture,'arm64');assert.equal(layout.image.callingConvention,'aapcs64');assert.equal(layout.image.pageBytes,65536);
  for(const segment of [layout.code,layout.metadata]){assert.equal(segment.address%65536,0);assert.equal(segment.offset%65536,0);assert.equal(segment.alignment,65536);}
  assert.equal(layout.phdr.address,layout.programOffset,'AT_PHDR must agree with load_addr + e_phoff under QEMU user execution');
  assert.deepEqual([...layout.symbols],[...inspectLinuxELF(runtimes.arm64.bytes).symbols]);
  const verified=await verifyLinuxAOTArchive(result.bytes,result.options);assert.equal(verified.machine,183);assert.equal(verified.runtimeProvenanceVerified,true);assert.equal(verified.callingConvention,'aapcs64');
  await assert.rejects(()=>verifyLinuxAOTArchive(result.bytes,{name:project.name,architecture:'x64'}),/manifest/);
});
test('UTF-8 download filenames fit Linux limits while preserving full application names',async()=>{
  const name='日'.repeat(85);
  for(const architecture of ['x64','arm64'])for(const extension of ['.zip','.tar.gz']){
    const filename=linuxArtifactFilename(name,architecture,extension);assert.ok(new TextEncoder().encode(filename).length<=255);assert.ok(filename.endsWith('-linux-'+architecture+extension));assert.ok(!filename.includes('\ufffd'));
  }
  const compiled=compileLinuxAOT({...project,name},{name,architecture:'arm64'}),result=await linkLinuxAOT(compiled,runtimes.arm64);
  assert.equal(result.options.name,name);assert.ok(Object.hasOwn(result.files,name+'/bin/'+name));assert.equal(result.filename,linuxArtifactFilename(name,'arm64'));
  assert.throws(()=>linuxArtifactFilename('App','arm64','/outside'),/extension/);assert.throws(()=>linuxOptions({name:'broken\ud800'}),/name/);
});
test('Cross-architecture objects, manifests, interpreters and 4 KiB ARM64 mappings fail closed',async()=>{
  for(const [architecture,other] of [['x64','arm64'],['arm64','x64']]){
    await assert.rejects(()=>linkLinuxAOT(compileLinuxAOT(project,{architecture}),runtimes[other]),/architectures/);
    await assert.rejects(()=>verifyLinuxAOTRuntime(runtimes[architecture].bytes,{...runtimes[architecture].manifest,architecture:linuxTarget(other).architecture}),/machine/);
    assert.throws(()=>inspectLinuxELF(runtimes[architecture].bytes,{architecture:other}),/machine/);
  }
  for(const mutate of [v=>v.setUint16(18,62,true),v=>v.setUint32(48,1,true),v=>v.setBigUint64(64+3*56+48,4096n,true),v=>v.setBigUint64(24,65538n,true)]){
    const bytes=runtimes.arm64.bytes.slice();mutate(new DataView(bytes.buffer));assert.throws(()=>inspectLinuxELF(bytes));
  }
});
test('ARM64 expands conditional branches beyond 1 MiB while retaining checked direct calls',()=>{
  const f=new AOTFunction(0);f.slots=2;f.branch(1,'far');
  for(let i=0;i<140000;i++)f.ops.push({op:'move',out:{slot:1},value:1});
  f.label('far');f.end();
  const section=emitLinuxAOTFunctions([f],0,'arm64');assert.ok(section.length>1024*1024);
  const bytes=linkLinuxARM64AOT(section,0x10000);assert.equal(bytes.length,section.length);assert.ok(section.fixups.some(f=>f.kind==='arm64-cond19'));
  const a=new LinuxARM64AOTAssembler();a.enter(16).bl('_vb6_aot_clear').leave(16);
  assert.throws(()=>linkLinuxARM64AOT(a.s,0x10000),/Undefined/);assert.throws(()=>linkLinuxARM64AOT(a.s,0x10000,new Map([['vb6_aot_clear',0x9000000]])),/range/);
  a.s.fixups.push({...a.s.fixups[0]});assert.throws(()=>linkLinuxARM64AOT(a.s,0x10000,new Map([['vb6_aot_clear',0x20000]])),/Overlapping/);
});
