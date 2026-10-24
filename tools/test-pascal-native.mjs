/** Execute emitted Pascal machine code using the existing platform runtime.
 * No C/C++/Pascal compiler recompiles the project under test. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {pascalNativeVerificationProject,pascalNativeExpectedResult} from '../tests/pascal-integration-fixtures.mjs';

const root=path.resolve(import.meta.dirname,'..');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Deliberately invalid metadata is linked into real machine-code programs.
 * The runtime must reject it; a JS compilation error is not execution proof. */
export function pascalNativeGuardCases() {
  const virtual=initialized=>({schema:1,name:'PascalVirtualGuard',language:'pascal',startup:'Sub Main',modules:[{name:'VirtualGuard',kind:'module',language:'pascal',code:`program VirtualGuard;
type TBase=object
  constructor Init;
  function Read:Longint; virtual;
end;
TChild=object(TBase)
  function Read:Longint; virtual;
end;
constructor TBase.Init; begin end;
function TBase.Read:Longint; begin Read:=31 end;
function TChild.Read:Longint; begin Read:=47 end;
var Item:TBase;
begin ${initialized?'Item.Init; ':''}WriteLn(Item.Read) end.`}]});
  const nominal={schema:1,name:'NominalRecords',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',language:'vb6',code:`Option Explicit
Public Type First
  X As Long
End Type
Public Type Second
  X As Long
End Type
Private Sub Accept(ByRef Item As First)
  Item.X = 3
End Sub
Public Sub Main()
  Dim Item As First
  Accept Item
End Sub`}]};
  const derived=metadata=>metadata.modules.find(module=>module.name==='NativeDerived').records.find(record=>record.pascalObject).pascalObject;
  const dispatch=metadata=>metadata.modules.find(module=>module.name==='NativeObjects').procedures.find(procedure=>procedure.pascalDispatch).pascalDispatch;
  const malformed=(name,mutate)=>({name,project:pascalNativeVerificationProject(),mutate,status:2,error:/Invalid AOT Pascal object metadata/});
  return [
    {name:'uninitialized-virtual-receiver',project:virtual(false),status:1,error:/VB6 error 210:/},
    {name:'incompatible-virtual-tag',project:virtual(true),status:1,error:/VB6 error 210:/,mutate(metadata){
      const records=metadata.modules[0].records,base=records.find(record=>record.pascalObject?.name==='TBase').pascalObject;
      const child=records.find(record=>record.pascalObject?.name==='TChild').pascalObject;
      const literals=metadata.literals.filter(value=>value.type==='long'&&value.value===String(base.typeId));
      assert.ok(literals.length,'Missing constructor runtime tag literal');
      for(const literal of literals)literal.value=String(child.typeId);
    }},
    {name:'vb-records-remain-nominal',project:nominal,status:1,error:/VB6 error 13:/,mutate(metadata){
      metadata.modules[0].procedures.find(procedure=>procedure.name==='Accept').parameters[0].type='Second';
    }},
    malformed('invalid-ancestor-prefix',metadata=>{derived(metadata).fields[1].name='unrelated';}),
    malformed('invalid-ancestor-identity',metadata=>{derived(metadata).parent='nativeobjects.missing';}),
    malformed('invalid-dispatch-tag',metadata=>{dispatch(metadata).branches[0].typeId+=100;}),
    malformed('vb-module-cannot-authorize-pascal-views',metadata=>{metadata.modules.find(module=>module.name==='NativeObjects').language='vb6';})
  ];
}

async function extract(files,root,executableName) {
  for(const [name,bytes] of files) {
    const destination=path.join(root,...name.split('/'));
    if(!destination.startsWith(root+path.sep))throw new Error('Native archive path escaped extraction root.');
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,bytes,{flag:'wx',mode:name===executableName?0o755:0o644});
  }
  return path.join(root,...executableName.split('/'));
}

export async function testPascalNative({runtimeDirectory,rebuild=false}={}) {
  if(runtimeDirectory&&rebuild)throw new Error('--runtime and --rebuild are mutually exclusive.');
  if((runtimeDirectory||rebuild)&&process.platform!=='linux')throw new Error('Explicit runtime input and rebuilding are supported only for native Linux qualification.');
  if(!(process.platform==='win32'||process.platform==='darwin'&&process.arch==='arm64'||process.platform==='linux'&&['x64','arm64'].includes(process.arch)))
    throw new Error('Pascal native qualification needs Windows, Apple Silicon macOS, or native x64/ARM64 Linux.');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-pascal-native-'));
  const reportDirectory=path.join(root,'reports/pascal-native');await fs.mkdir(reportDirectory,{recursive:true});
  const report={platform:process.platform,architecture:process.arch,hostArchitecture:process.arch,executionMode:'native',source:'Turbo Pascal 7.0',checks:[]};
  try {
    let runtime,compile,link,unpack,entry;
    if(process.platform==='linux') {
      const {linuxTarget}=await import('../packages/linux-native/src/target.js');
      const {verifyLinuxAOTRuntime}=await import('../packages/linux-native/src/elf.js');
      const {readLinuxAOTSourceProvenance,checkLinuxAOTRuntimeProvenance}=await import('./linux-aot-provenance.mjs');
      const target=linuxTarget(process.arch);
      if(rebuild) {
        const {buildLinuxAOTTemplate}=await import('./build-linux-aot-template.mjs');
        runtime=await buildLinuxAOTTemplate({architecture:target.option,out:path.join(directory,'runtime'),log:text=>process.stderr.write(text)});
      }else if(runtimeDirectory) {
        runtime={bytes:new Uint8Array(await fs.readFile(path.join(runtimeDirectory,'runtime-'+target.architecture))),
          manifest:JSON.parse(await fs.readFile(path.join(runtimeDirectory,'runtime.json'),'utf8'))};
      }else {
        checkLinuxAOTRuntimeProvenance(root,{architecture:target.option});
        const {loadLinuxAOTRuntime}=await import('../packages/linux-native/src/aot-runtime.js');
        runtime=await loadLinuxAOTRuntime({architecture:target.option});
      }
      await verifyLinuxAOTRuntime(runtime.bytes,runtime.manifest);
      assert.equal(runtime.manifest.architecture,target.architecture,'Pascal execution requires the native host architecture');
      for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance(root)))
        assert.equal(runtime.manifest.provenance?.[name],value,'Pascal runtime source mismatch: '+name);
      const {compileLinuxAOT}=await import('../packages/linux-native/src/compiler.js');
      const {linkLinuxAOT,unpackLinuxAOTArchive}=await import('../packages/linux-native/src/aot-export.js');
      compile=(project,optimization)=>compileLinuxAOT(project,{architecture:target.option,optimization});
      link=linkLinuxAOT;unpack=unpackLinuxAOTArchive;entry=name=>name+'/bin/'+name;
    }else if(process.platform==='darwin') {
      const {checkAOTRuntimeProvenance}=await import('./macos-aot-provenance.mjs');checkAOTRuntimeProvenance(root);
      const {loadMacOSAOTRuntime}=await import('../packages/macos-native/src/aot-runtime.js');runtime=await loadMacOSAOTRuntime();
      const {compileMacOSAOT}=await import('../packages/macos-native/src/aot-compiler.js');
      const {linkMacOSAOT,unpackMacOSAOTArchive}=await import('../packages/macos-native/src/aot-export.js');
      compile=(project,optimization)=>compileMacOSAOT(project,{optimization});
      link=linkMacOSAOT;unpack=unpackMacOSAOTArchive;entry=name=>name+'.app/Contents/MacOS/'+name;
    }
    if(runtime)report.runtimeSHA256=runtime.manifest.sha256;
    const build=async(project,optimization,work,mutate)=>{
      await fs.mkdir(work);
      if(process.platform==='win32') {
        assert.equal(mutate,undefined,'AOT metadata guards do not use the Win32 linker');
        const {compileWin32}=await import('../src/native/compiler.js'),bytes=compileWin32(project,{optimization}).bytes;
        const executable=path.join(work,project.name+'.exe');await fs.writeFile(executable,bytes,{flag:'wx'});return {executable,bytes};
      }
      const compiled=compile(project,optimization);
      if(mutate){mutate(compiled.metadata);compiled.report.metadataBytes=new TextEncoder().encode(JSON.stringify(compiled.metadata)).length;}
      const result=await link(compiled,runtime),unpacked=await unpack(result.bytes,result.options);
      const executable=await extract(unpacked.files,work,entry(result.options.name));
      return {executable,bytes:await fs.readFile(executable)};
    };
    const run=(executable,work)=>{
      const result=spawnSync(executable,[],{cwd:work,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,windowsHide:true});
      assert.ifError(result.error);assert.equal(result.signal,null,'Native process exited by signal');return result;
    };
    for(const optimization of [0,2]) {
      const work=path.join(directory,'O'+optimization),{executable,bytes}=await build(pascalNativeVerificationProject(),optimization,work);
      const result=run(executable,work);assert.equal(result.status,0,result.stderr||result.stdout);
      const actual=await fs.readFile(path.join(work,'pascal-native-result.txt'),'utf8');
      assert.equal(actual.trim(),pascalNativeExpectedResult,'Native Pascal initialization, loops, calls, objects, pointer heaps and files');
      assert.equal(await fs.readFile(path.join(work,'pascal-native.txt'),'utf8'),'  42\r\n');
      assert.deepEqual([...await fs.readFile(path.join(work,'pascal-native.dat'))],[255,255,129,0,0,0,0,64]);
      report.checks.push({optimization,executableSHA256:digest(bytes),bytes:bytes.length,result:actual.trim(),executed:true});
    }
    if(runtime)for(const guard of pascalNativeGuardCases()) {
      const work=path.join(directory,guard.name),{executable,bytes}=await build(guard.project,2,work,guard.mutate);
      const result=run(executable,work);
      assert.equal(result.status,guard.status,guard.name+': '+result.stderr+result.stdout);
      assert.match(result.stderr+result.stdout,guard.error,guard.name);
      await assert.rejects(()=>fs.access(path.join(work,'pascal-native-result.txt')),error=>error.code==='ENOENT','Invalid native contracts must not execute the project harness');
      report.checks.push({name:guard.name,optimization:2,executableSHA256:digest(bytes),bytes:bytes.length,executed:true,rejected:true});
    }
    report.valid=true;return report;
  }catch(error){report.valid=false;report.error=error.stack;throw error;}
  finally {
    await fs.writeFile(path.join(reportDirectory,process.platform+'-'+process.arch+'.json'),JSON.stringify(report,null,2)+'\n');
    await fs.rm(directory,{recursive:true,force:true});
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options={};
    for(let index=2;index<process.argv.length;index++) {
      const argument=process.argv[index];
      if(argument==='--rebuild'&&!options.rebuild)options.rebuild=true;
      else if(argument==='--runtime'&&!options.runtimeDirectory&&process.argv[index+1]&&!process.argv[index+1].startsWith('--'))options.runtimeDirectory=path.resolve(process.argv[++index]);
      else throw new Error('Usage: node tools/test-pascal-native.mjs [--rebuild | --runtime DIRECTORY]');
    }
    console.log(JSON.stringify(await testPascalNative(options),null,2));
  }catch(error){console.error(error.stack||error.message);process.exitCode=1;}
}
