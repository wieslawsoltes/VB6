import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLinuxAOT,LinuxCompileError,linuxOptions,exportLinuxAOT,linkLinuxAOT,verifyLinuxAOTArchive,writeLinuxAppZip} from '../packages/linux-native/src/index.js';
import {inspectLinuxELF,createLinuxAOTRuntimeManifest,verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
import {X64AOTAssembler,linkX64AOT} from '../packages/linux-native/src/aot-emitter.js';
import {AOT_ABI,AOT_HELPERS} from '../packages/macos-native/src/aot-abi.js';
import {conformanceProject} from '../packages/macos-native/tests/conformance.mjs';
const encoder=new TextEncoder();
/** Structural fixture, deliberately never executed. Native execution coverage
 * uses the compiled GTK SDK in linux-aot-native.test.mjs. */
function elfFixture(){
  const bytes=new Uint8Array(0x6000),v=new DataView(bytes.buffer),u16=(at,n)=>v.setUint16(at,n,true),u32=(at,n)=>v.setUint32(at,n,true),u64=(at,n)=>v.setBigUint64(at,BigInt(n),true);
  bytes.set([0x7f,0x45,0x4c,0x46,2,1,1]);u16(16,3);u16(18,62);u32(20,1);u64(24,0x1000);u64(32,64);u64(40,0x5100);u16(52,64);u16(54,56);u16(56,9);u16(58,64);u16(60,7);u16(62,6);
  const ph=(i,type,flags,offset,address,size,alignment=4096)=>{const at=64+i*56;u32(at,type);u32(at+4,flags);u64(at+8,offset);u64(at+16,address);u64(at+24,address);u64(at+32,size);u64(at+40,size);u64(at+48,alignment);};
  const interpreter=encoder.encode('/lib64/ld-linux-x86-64.so.2\0');bytes.set(interpreter,0x400);
  ph(0,6,4,64,64,9*56,8);ph(1,3,4,0x400,0x400,interpreter.length,1);ph(2,1,4,0,0,0x1000);ph(3,1,5,0x1000,0x1000,0x1000);ph(4,1,4,0x2000,0x2000,0x1000);ph(5,1,6,0x3000,0x3000,0x1000);ph(6,2,6,0x3000,0x3000,48,8);ph(7,0x6474e551,6,0,0,0,16);ph(8,0x6474e552,4,0x3000,0x3000,256,1);
  const dynstr=encoder.encode('\0libgtk-3.so.0\0');bytes.set(dynstr,0x2000);u64(0x3000,1);u64(0x3008,1);u64(0x3010,24);
  const symbolNames=['',...AOT_HELPERS.map(name=>'vb6_aot_'+name)],nameOffsets=[];let names='';for(const name of symbolNames){nameOffsets.push(names.length);names+=name+'\0';}bytes.set(encoder.encode(names),0x4800);
  for(let i=1;i<symbolNames.length;i++){const at=0x4000+i*24;u32(at,nameOffsets[i]);bytes[at+4]=0x12;u16(at+6,1);u64(at+8,0x1000+i*16);u64(at+16,1);bytes[0x1000+i*16]=0xc3;}
  bytes[0x1000]=0xc3;
  const sectionNames=['','.text','.dynstr','.dynamic','.symtab','.strtab','.shstrtab'],sectionNameOffsets=[];let sectionText='';for(const name of sectionNames){sectionNameOffsets.push(sectionText.length);sectionText+=name+'\0';}bytes.set(encoder.encode(sectionText),0x5000);
  const sh=(i,type,flags,address,offset,size,link=0,entrySize=0)=>{const at=0x5100+i*64;u32(at,sectionNameOffsets[i]);u32(at+4,type);u64(at+8,flags);u64(at+16,address);u64(at+24,offset);u64(at+32,size);u32(at+40,link);u64(at+48,1);u64(at+56,entrySize);};
  sh(1,1,6,0x1000,0x1000,0x1000);sh(2,3,2,0x2000,0x2000,dynstr.length);sh(3,6,3,0x3000,0x3000,48,2,16);sh(4,2,0,0,0x4000,symbolNames.length*24,5,24);sh(5,3,0,0,0x4800,names.length);sh(6,3,0,0,0x5000,sectionText.length);
  return bytes;
}
const project={schema:1,name:'LinuxDirect',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code:'Public Sub Main()\nDebug.Assert 3 + 4 = 7\nDebug.Print "LINUX_DIRECT_OK"\nEnd Sub'}]};
const template=elfFixture(),runtime={bytes:template,manifest:await createLinuxAOTRuntimeManifest(template,{fixture:true})},compiled=compileLinuxAOT(project),exported=await linkLinuxAOT(compiled,runtime);
test('Linux emits machine-code procedures and shares the bound native ABI',()=>{
  const result=compileLinuxAOT(conformanceProject());assert.equal(result.metadata.abi,AOT_ABI);assert.ok(result.section.length>4096);assert.ok(result.metadata.entries.length>10);
  assert.ok(result.metadata.entries.every(offset=>Number.isInteger(offset)&&offset%16===0));assert.ok(result.section.fixups.every(f=>f.kind==='x86_64-rel32'));assert.ok(!JSON.stringify(result.metadata).includes('"op":'));
  for(const offset of result.metadata.entries)assert.deepEqual(result.section.bytes.slice(offset,offset+4),[0xf3,0x0f,0x1e,0xfa]);
  assert.equal(result.report.compiled,false);for(const optimization of [0,1,2,3])assert.equal(compileLinuxAOT(project,{optimization}).report.optimization.level,optimization);
});
test('Linux target constants override conflicting project defaults without mutating input',()=>{
  const input=structuredClone(project);input.settings={conditionalConstants:{Linux:0,Mac:-1,Win32:-1,ARM64:-1}};
  input.modules[0].code='#If Linux And X86_64 And GTK3 Then\nSub Main()\nDebug.Print "LINUX_SELECTED"\nEnd Sub\n#Else\nSub Main()\nDebug.Print "WRONG_TARGET"\nEnd Sub\n#End If';
  const before=structuredClone(input),result=compileLinuxAOT(input);assert.ok(result.metadata.literals.some(v=>v.value==='LINUX_SELECTED'));assert.ok(!result.metadata.literals.some(v=>v.value==='WRONG_TARGET'));assert.deepEqual(input,before);
});
test('Linux target validates names, architecture, toolkit and allocation limits',()=>{
  for(const name of ['','..','-danger','a/b','a\\b','a:b','a\0b','a\nb','a\x7fb','日'.repeat(86)])assert.throws(()=>linuxOptions({name}),LinuxCompileError);
  assert.equal(linuxOptions({name:'日'.repeat(85)}).name,'日'.repeat(85));
  assert.equal(linuxOptions({name:'LinuxApp',arch:'x64'}).arch,'x86_64');
  assert.equal(linuxOptions({architecture:'arm64'}).architecture,'arm64');
  for(const options of [{arch:'riscv64'},{toolkit:'gtk5'},{optimization:4},{maxCallDepth:0},{maxArrayElements:2**32}])assert.throws(()=>linuxOptions(options),LinuxCompileError);
});
test('Linux catalog rejects unavailable controls and Declares before export',()=>{
  const code='Declare Sub Unsupported Lib "kernel32" Alias "VirtualAlloc" (ByVal n As Long)\nSub Main()\nEnd Sub';
  assert.throws(()=>compileLinuxAOT({...project,modules:[{name:'M',kind:'module',code}]}),error=>error instanceof LinuxCompileError&&error.diagnostics[0].code==='LIN210');
  const form={schema:1,name:'Unsupported',startup:'F',modules:[{name:'F',kind:'form',code:'',form:{name:'F',type:'Form',properties:{},controls:[{name:'Browser',type:'WebBrowser',properties:{}}],menus:[]}}]};
  assert.throws(()=>compileLinuxAOT(form),error=>error instanceof LinuxCompileError&&error.diagnostics[0].code==='LIN220');
});
test('Linux Declare callbacks use the explicit four-Long timer ABI',()=>{
  const source=parameters=>`Declare Function SetTimer Lib "user32" (ByVal window As Long, ByVal id As Long, ByVal interval As Long, ByVal callback As Long) As Long
Sub Tick(${parameters})
End Sub
Sub Main()
  Dim id As Long
  id = SetTimer(0, 0, 10, AddressOf Tick)
End Sub`;
  const parameters='ByVal window As Long, ByVal message As Long, ByVal id As Long, ByVal time As Long';
  const make=code=>({...project,modules:[{name:'MainModule',kind:'module',code}]});assert.equal(compileLinuxAOT(make(source(parameters))).report.imports[0].id,'user32.SetTimer');
  for(const invalid of ['ByVal value As Long',parameters.replace('time As Long','time As Double'),parameters.replace('ByVal id','ByRef id')])assert.throws(()=>compileLinuxAOT(make(source(invalid))),error=>error instanceof LinuxCompileError&&error.diagnostics[0].code==='LIN230');
  assert.throws(()=>compileLinuxAOT(make('Declare Function GetTickCount64 Lib "kernel32" () As Long\nSub Main()\nEnd Sub')),error=>error.diagnostics[0].code==='LIN210');
  assert.throws(()=>compileLinuxAOT(make('Declare Sub SleepW Lib "kernel32" (ByVal interval As Long)\nSub Main()\nEnd Sub')),error=>error.diagnostics[0].code==='LIN210');
});
test('ELF linking appends scalable RX and R mappings preserving native addresses',()=>{
  const before=inspectLinuxELF(template),after=inspectLinuxELF(exported.executable,{requireProject:true});assert.equal(after.programCount,before.programCount+2);assert.equal(after.code.flags&7,5);assert.equal(after.metadata.flags&7,4);
  assert.deepEqual([...after.symbols],[...before.symbols]);assert.equal(after.phdr.address,after.metadata.address);assert.equal(after.phdr.offset,after.metadata.offset);
  assert.equal(after.codeSize,compiled.section.length);assert.equal(after.metadataJSON.name,'LinuxDirect');assert.ok(after.sections.some(s=>s.name==='.vb6code'&&s.size===compiled.section.length));
  assert.ok(after.image.pie&&after.image.nonExecutableStack&&after.image.relro&&after.image.bindNow);
});
test('ELF code and metadata capacities grow independently beyond fixed reservations',async()=>{
  const large=compileLinuxAOT(project);large.section.zero(3*1024*1024);large.metadata.names.push('long metadata '.repeat(180000));
  large.report={...large.report,codeBytes:large.section.length,metadataBytes:encoder.encode(JSON.stringify(large.metadata)).length};
  const result=await linkLinuxAOT(large,runtime),layout=inspectLinuxELF(result.executable,{requireProject:true});assert.ok(layout.code.size>2*1024*1024);assert.ok(layout.metadata.size>2*1024*1024);assert.deepEqual(runtime.bytes,template);
});
test('Linux ZIP is deterministic and verifies code, resources, provenance and modes',async()=>{
  const next=await exportLinuxAOT(project,runtime);assert.deepEqual(next.bytes,exported.bytes);assert.equal(next.filename,'LinuxDirect-linux-x64.zip');
  const verified=await verifyLinuxAOTArchive(next.bytes,next.options);assert.equal(verified.compiled,true);assert.equal(verified.integrityVerified,true);assert.equal(verified.runtimeProvenanceVerified,true);assert.equal(verified.signed,false);
  await verifyLinuxAOTRuntime(runtime.bytes,runtime.manifest);
});
test('Linux archive rejects code, report and resource changes and unsealed injection',async()=>{
  for(const path of ['LinuxDirect/bin/LinuxDirect','LinuxDirect/Resources/vb6-build.json','LinuxDirect/README.txt']){
    const files={...exported.files};files[path]=files[path].slice();files[path][100]^=1;await assert.rejects(()=>verifyLinuxAOTArchive(writeLinuxAppZip(files,'LinuxDirect/bin/LinuxDirect'),exported.options),/integrity/);
  }
  const files={...exported.files,'LinuxDirect/Resources/injected.txt':encoder.encode('injected')};await assert.rejects(()=>verifyLinuxAOTArchive(writeLinuxAppZip(files,'LinuxDirect/bin/LinuxDirect'),exported.options),/seal/);
  const broken=exported.bytes.slice(),v=new DataView(broken.buffer);let at=v.getUint32(broken.length-22+16,true);v.setUint32(at+38,(0o100644*65536)>>>0,true);await assert.rejects(()=>verifyLinuxAOTArchive(broken,exported.options),/permissions/);
});
test('Linux archive provenance verifies actual runtime prefix rather than labels',async()=>{
  const files={...exported.files},name='LinuxDirect/manifest.json',manifest=JSON.parse(new TextDecoder().decode(files[name]));manifest.runtime.header[24]^=1;files[name]=encoder.encode(JSON.stringify(manifest));
  await assert.rejects(()=>verifyLinuxAOTArchive(writeLinuxAppZip(files,'LinuxDirect/bin/LinuxDirect'),exported.options),/provenance hash/);
});
test('Linux resources cannot escape or replace reserved runtime assets',async()=>{
  for(const name of ['Resources/../outside','Resources/vb6-build.json','Resources/vb6-assets.bin','Resources/vb6-runtime-license.txt','Resources/a\\b','Resources/a:b','outside','Resources/'+'日'.repeat(86),'Resources/'+('a'.repeat(200)+'/').repeat(21)+'file'])await assert.rejects(()=>linkLinuxAOT(compiled,runtime,{resources:{[name]:'bad'}}),/resource path/);
  const result=await linkLinuxAOT(compiled,runtime,{resources:{'Resources/Zażółć.txt':'gęślą jaźń'}});await verifyLinuxAOTArchive(result.bytes,result.options);
});
test('ELF runtime manifests reject changed ABI, helpers, dependencies and hashes',async()=>{
  for(const change of [m=>m.abi++,m=>m.sha256='0'.repeat(64),m=>m.helpers.vb6_aot_clear++,m=>m.dependencies=[]]){const manifest=structuredClone(runtime.manifest);change(manifest);await assert.rejects(()=>verifyLinuxAOTRuntime(template,manifest));}
  for(const change of [v=>v.setUint16(18,183,true),v=>v.setUint32(64+3*56+4,7,true),v=>v.setUint32(64+7*56+4,7,true),v=>v.setBigUint64(64+3*56+16,0n,true)]){const bytes=template.slice();change(new DataView(bytes.buffer));assert.throws(()=>inspectLinuxELF(bytes));}
});
test('x86_64 rel32 link rejects undefined, out-of-range, corrupt and overlapping fixups',()=>{
  const a=new X64AOTAssembler();a.call('helper');assert.throws(()=>linkX64AOT(a.s,0),/Undefined/);assert.throws(()=>linkX64AOT(a.s,0,new Map([['helper',2**32]])),/displacement/);
  const valid=linkX64AOT(a.s,0x1000,new Map([['helper',0x2000]]));assert.equal(new DataView(valid.buffer).getInt32(1,true),0xffb);assert.equal(a.s.bytes[1],0);
  a.s.fixups.push({...a.s.fixups[0]});assert.throws(()=>linkX64AOT(a.s,0,new Map([['helper',100]])),/Overlapping/);a.s.fixups.pop();a.s.bytes[0]=0x90;assert.throws(()=>linkX64AOT(a.s,0,new Map([['helper',100]])),/opcode/);
});
