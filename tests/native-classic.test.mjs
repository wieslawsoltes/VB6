import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { inspectPE, verifyClassicExecutable } from '../tools/pe.mjs';
import { parseClassicOptions, configureVBP, compilerArguments, findCompiler, stageClassic, buildClassic, runCompiler } from '../tools/build-classic.mjs';
function fixture(dll='MSVBVM60.DLL') {
  const b=Buffer.alloc(1024); b.write('MZ'); b.writeUInt32LE(0x80,0x3c); b.write('PE\0\0',0x80);
  b.writeUInt16LE(0x14c,0x84); b.writeUInt16LE(1,0x86); b.writeUInt16LE(224,0x94); b.writeUInt16LE(0x102,0x96);
  const o=0x98; b.writeUInt16LE(0x10b,o); b.writeUInt32LE(512,o+60); b.writeUInt16LE(2,o+68); b.writeUInt32LE(16,o+92);
  b.writeUInt32LE(0x1000,o+104); b.writeUInt32LE(40,o+108);
  const s=o+224; b.write('.idata',s); b.writeUInt32LE(512,s+8); b.writeUInt32LE(0x1000,s+12); b.writeUInt32LE(512,s+16); b.writeUInt32LE(512,s+20);
  b.writeUInt32LE(0x1050,512+12); b.write(dll+'\0',512+80); return b;
}
test('PE inspection identifies classic runtime import without executing the input', () => {
  const result=verifyClassicExecutable(fixture()); assert.equal(result.arch,'x86'); assert.equal(result.format,'PE32'); assert.deepEqual(result.imports,['MSVBVM60.DLL']); assert.equal(result.classicRuntimeImport,true);
  assert.equal(inspectPE(fixture('KERNEL32.dll')).classicRuntimeImport,false);
  assert.throws(()=>verifyClassicExecutable(fixture('KERNEL32.dll')), /MSVBVM60/);
});
test('PE inspector rejects truncated, invalid and ambiguous binary structures', () => {
  for (const length of [0,2,63,128,250,500,900]) assert.throws(()=>inspectPE(fixture().subarray(0,length)));
  const bad=fixture(); bad.writeUInt32LE(0xffffffff,0x3c); assert.throws(()=>inspectPE(bad));
  const rva=fixture(); rva.writeUInt32LE(0xffffffff,524); assert.throws(()=>inspectPE(rva));
  const dll=fixture(); dll.writeUInt16LE(0x2102,0x96); assert.throws(()=>verifyClassicExecutable(dll));
  const arch=fixture(); arch.writeUInt16LE(0x8664,0x84); assert.throws(()=>verifyClassicExecutable(arch));
});
test('classic CLI is distinct from WebGPU and no-runtime packaging', () => {
  assert.equal(parseClassicOptions(['--project','x.vbp']).codegen,'preserve');
  assert.equal(parseClassicOptions(['--inspect','x.exe']).inspect,'x.exe');
  for (const args of [[],['--project'],['--project','x.vbp','--arch','x64'],['--project','x.vbp','--graphics','webgpu'],['--project','x.vbp','--codegen','invalid'],['--inspect','x.exe','--project','x.vbp'],['--project','x.vbp','--timeout','0']]) assert.throws(()=>parseClassicOptions(args));
});
test('classic VBP patch preserves unknown fields and sections and controls native/P-code mode', () => {
  const src=Buffer.from('Type=Exe\r\nName="Old"\r\nExeName32="Old.exe"\r\nCompilationType=1\r\nCustom="caf\xe9"\r\n[Designer]\r\nPath32="untouched"\r\n','latin1');
  const native=configureVBP(src,'New App','native').toString('latin1');
  assert.match(native,/CompilationType=0/); assert.match(native,/ExeName32="New App.exe"/); assert.match(native,/Custom="caf\xe9"/);
  assert.match(native,/\[Designer\]\r\nPath32="untouched"/); assert.match(native,/AutoIncrementVer=0/);
  assert.match(configureVBP(src,'Name','preserve').toString(),/CompilationType=1/);
  assert.match(configureVBP(src,'Name','pcode').toString(),/CompilationType=1/);
  assert.throws(()=>configureVBP(Buffer.from('Type=OleDll'),'Name'));
  assert.throws(()=>configureVBP(Buffer.from('Type=Exe\nExeName32="a"\nEXENAME32="b"'),'Name'));
});
test('classic command arguments preserve spaces and metacharacters without a shell', () => {
  assert.deepEqual(compilerArguments({vbp:'C:\\source & safe\\a.vbp',log:'C:\\a log.txt',bin:'C:\\out'}),['/make','C:\\source & safe\\a.vbp','/out','C:\\a log.txt','/outdir','C:\\out']);
});
test('classic compiler detection uses explicit paths and never downloads a compiler', async () => {
  assert.equal(await findCompiler({compiler:process.execPath}),process.execPath);
  await assert.rejects(findCompiler({compiler:path.join(os.tmpdir(),'does-not-exist-VB6.EXE')},{}),/not found/);
});
test('classic stage preserves source bytes and reports an uncompiled external-runtime plan', async () => {
  const input=path.resolve('examples/classic/HelloRuntime.vbp'), before=await fs.readFile(input);
  const plan=await stageClassic(parseClassicOptions(['--project',input,'--stage-only','--codegen','pcode']));
  try { assert.equal(plan.compiled,false); assert.equal(plan.arch,'x86'); assert.match(await fs.readFile(plan.vbp,'utf8'),/CompilationType=1/); assert.deepEqual(await fs.readFile(input),before); assert.ok((await fs.stat(path.join(path.dirname(plan.vbp),'Main.bas'))).size); }
  finally { await fs.rm(plan.stage,{recursive:true,force:true}); }
});
test('classic stage rejects source traversal outside the chosen source root', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'classic-traversal-'));
  try { const input=path.join(dir,'x.vbp'); await fs.writeFile(input,'Type=Exe\nForm=../outside.frm'); await assert.rejects(stageClassic(parseClassicOptions(['--project',input,'--stage-only'])),/escapes/); }
  finally { await fs.rm(dir,{recursive:true,force:true}); }
});
test('mocked classic compiler integration verifies new PE output before publishing', async () => {
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'classic-output-'));
  let stage;
  try {
    const options=parseClassicOptions(['--project','examples/classic/HelloRuntime.vbp','--compiler',process.execPath,'--out',out]);
    const result=await buildClassic(options,{platform:'win32',runCompiler:async(_exe,args)=>{ stage=path.dirname(args[3]); await fs.writeFile(path.join(args[5],'HelloRuntime.exe'),fixture()); await fs.writeFile(args[3],'Mock compiler fixture (not a real VB6 compilation)'); return {code:0}; }});
    assert.equal(result.compiled,true); assert.equal(result.pe.classicRuntimeImport,true); assert.match(result.sha256,/^[a-f0-9]{64}$/); assert.ok((await fs.stat(result.executable)).size);
  } finally { await fs.rm(out,{recursive:true,force:true}); if(stage)await fs.rm(stage,{recursive:true,force:true}); }
});
test('zero compiler exit without an executable is not reported as success', async () => {
  let stage;
  try { await assert.rejects(buildClassic(parseClassicOptions(['--project','examples/classic/HelloRuntime.vbp','--compiler',process.execPath]),{platform:'win32',runCompiler:async(_exe,args)=>{stage=path.dirname(args[3]);return {code:0};}}),/fresh executable/); }
  finally { if(stage)await fs.rm(stage,{recursive:true,force:true}); }
});
test('classic process runner reports nonzero exits and enforces its timeout', async () => {
  assert.equal((await runCompiler(process.execPath,['-e','process.exit(7)'],{cwd:process.cwd(),timeout:2000})).code,7);
  await assert.rejects(runCompiler(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:process.cwd(),timeout:100}),/timed out/);
});
