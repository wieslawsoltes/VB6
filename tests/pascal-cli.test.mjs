import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {parsePascalOptions,readPascalProject,compilePascalCLI,createPascalLineInput} from '../tools/compile-pascal.mjs';
import {compileProject,createPascalProject} from '../packages/turbo-pascal/src/index.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {encodeStringTable} from '../src/project/res.js';
import {readZip} from '../src/project/zip.js';
import {inspectLinuxELF} from '../packages/linux-native/src/elf.js';

const cli=fileURLToPath(new URL('../tools/compile-pascal.mjs',import.meta.url));
async function temporary(action) {const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pascal-cli-'));try{return await action(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
const invoke=(args,options={})=>{
  const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000,...options});
  assert.equal(result.error,undefined,'Unable to launch the Pascal CLI: '+String(result.error||''));
  return result;
};

test('Pascal CLI validates missing, repeated, unknown and incompatible options',()=>{
  for(const [args,message] of [
    [[],/source.*required/i],
    [['main.pas','--target'],/Missing value/],
    [['main.pas','--target','--out','a'],/Missing value/],
    [['main.pas','--out','x','--out','y'],/Repeated option/],
    [['main.pas','--target','run','--target','check'],/Repeated option/],
    [['main.pas','--bad'],/Unknown option/],
    [['main.pas','-x'],/Unknown option/],
    [['main.pas','--target','bad'],/Unknown Pascal target/],
    [['main.pas','--target','ir'],/--out is required/],
    [['main.pas','--target','check','--out','x'],/--out is not used/],
    [['main.pas','--target','run','--out','x'],/--out is not used/],
    [['main.pas','--name',''],/Missing value/],
    [['main.pas','--architecture'],/Missing value/],
    [['main.pas','--target','linux','--architecture','x86','--out','x'],/must be x64 or arm64/],
    [['main.pas','--target','macos','--architecture','arm64','--out','x'],/only supported for the linux target/],
    [['main.pas','--architecture','x64'],/only supported for the linux target/],
    [['main.pas','--target','linux','--architecture','x64','--architecture','arm64','--out','x'],/Repeated option/],
  ]) assert.throws(()=>parsePascalOptions(args),message,JSON.stringify(args));
  assert.deepEqual(parsePascalOptions(['--target','check','--','--main.pas']).inputs,['--main.pas']);
  const help=invoke(['--help']); assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/Usage:/);assert.match(help.stdout,/standard input/);assert.doesNotMatch(help.stdout,/"valid"/);
});

test('actual check and IR commands load units and retain positioned Pascal source',()=>temporary(async directory=>{
  const main=path.join(directory,'main.pas'),unit=path.join(directory,'math.pas'),output=path.join(directory,'program.json');
  await fs.writeFile(main,'program Main; uses MathWork; begin Writeln(Twice(21)) end.');
  await fs.writeFile(unit,'unit MathWork; interface function Twice(N:Integer):Integer; implementation function Twice(N:Integer):Integer; begin Twice:=N*2 end; end.');
  const check=invoke([main,unit,'--target','check']);assert.equal(check.status,0,check.stderr);assert.deepEqual(JSON.parse(check.stdout),{valid:true,language:'pascal',modules:2,diagnostics:[]});
  const compiled=invoke([main,unit,'--target','ir','--out',output]);assert.equal(compiled.status,0,compiled.stderr);assert.equal(JSON.parse(compiled.stdout).target,'ir');
  const ir=JSON.parse(await fs.readFile(output,'utf8'));assert.equal(ir.modules.main.language,'pascal');assert.match(ir.modules.main.source,/program Main;/);assert.match(ir.modules.main.generatedSource,/Public Sub Main/);assert.ok(ir.modules.main.procedures.main.code.some(instruction=>instruction.sequencePoint&&instruction.line===1));assert.equal(ir.modules.mathwork.pascal.kind,'unit');
  const run=invoke([main,unit,'--target','run']);assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,'42\n');assert.equal(run.stderr,'');
}));

test('run reads stdin lines, preserves blank lines and writes exact non-newline output',()=>temporary(async directory=>{
  const file=path.join(directory,'input.pas');
  await fs.writeFile(file,"program InputProgram; var N:Integer; S:String[3]; begin Read(N); Readln(S); Write(N,':',S); Readln(S); Writeln(':',Length(S)); Readln(S); Writeln(S) end.");
  const result=invoke([file,'--target','run'],{input:'12 abcdef\r\n\r\nlast'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'12: ab:0\nlas\n');assert.equal(result.stderr,'');
}));

test('stdin EOF reports Pascal error 100 and unchecked EOF remains visible through IOResult',()=>temporary(async directory=>{
  const file=path.join(directory,'eof.pas');
  await fs.writeFile(file,'program EOFInput; var N:Integer; begin Read(N) end.');
  const result=invoke([file,'--target','run'],{input:''});assert.equal(result.status,1);assert.equal(result.stdout,'');
  const diagnostic=JSON.parse(result.stderr).diagnostics[0];assert.equal(diagnostic.number,100);assert.match(diagnostic.message,/end of standard input/i);
  await fs.writeFile(file,'program EOFInput; var S:String; Code:Integer; begin {$I-} Readln(S); {$I+} Code:=IOResult; Writeln(Code) end.');
  const unchecked=invoke([file,'--target','run'],{input:''});assert.equal(unchecked.status,0,unchecked.stderr);assert.equal(unchecked.stdout,'100\n');
}));

test('a missing console host fails before executing Pascal instructions',async()=>{
  const program=compileProject(createPascalProject('program MissingHost; var N:Integer; begin Read(N) end.'));
  assert.deepEqual(program.diagnostics,[]);const vm=new VirtualMachine(program,{}, {instructionLimit:20});
  await assert.rejects(vm.start(),error=>error.code==='TP_HOST_INPUT_REQUIRED'&&/inputBox/.test(error.message));assert.equal(vm.instructionCount,0);
  const textProgram=compileProject(createPascalProject("program FileOnly; var F:Text; S:String; begin Assign(F,'data.txt'); Rewrite(F); Writeln(F,'ready'); Close(F); Reset(F); Readln(F,S); Close(F) end."));
  await new VirtualMachine(textProgram).start();
});

test('line input is lazy, treats empty lines as data and releases its reader',async()=>{
  const source=Readable.from(['\nfirst\r\nlast']),reader=createPascalLineInput(source);
  assert.equal(source.readableFlowing,null);
  assert.equal(await reader.inputBox(),'');assert.equal(await reader.inputBox(),'first');assert.equal(await reader.inputBox(),'last');
  await assert.rejects(reader.inputBox(),error=>error.number===100);reader.close();await assert.rejects(reader.inputBox(),error=>error.number===100);
});

test('compile API accepts an explicit input host without consuming stdin',()=>temporary(async directory=>{
  const file=path.join(directory,'api.pas');await fs.writeFile(file,'program API; var N:Integer; begin Readln(N); Write(N) end.');
  const output=[],source=Readable.from(['unused\n']);let calls=0;
  const result=await compilePascalCLI({target:'run',inputs:[file]},{input:source,inputBox:async()=>{calls++;return '17';},print:(text,newline)=>output.push({text,newline})});
  assert.equal(result.executed,true);assert.equal(calls,1);assert.equal(source.readableFlowing,null);assert.deepEqual(output,[{text:'17',newline:false}]);
}));

test('CLI errors preserve original source positions and never create output artifacts',()=>temporary(async directory=>{
  const file=path.join(directory,'bad.pas'),output=path.join(directory,'bad.json');await fs.writeFile(file,'program Broken;\nbegin\n  Missing := 1;\nend.');
  const result=invoke([file,'--target','ir','--out',output]);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(JSON.parse(result.stderr).diagnostics[0].line,3);await assert.rejects(fs.stat(output),error=>error.code==='ENOENT');
  const missing=invoke([path.join(directory,'missing.pas')]);assert.equal(missing.status,1);assert.match(JSON.parse(missing.stderr).diagnostics[0].message,/ENOENT/);
}));

test('IR export cannot overwrite an output file or its own source',()=>temporary(async directory=>{
  const source='program Protected; begin end.',file=path.join(directory,'main.pas'),output=path.join(directory,'existing.json');await fs.writeFile(file,source);await fs.writeFile(output,'keep');
  for(const target of [output,file]){const result=invoke([file,'--target','ir','--out',target]);assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).diagnostics[0].code,'EEXIST');}
  assert.equal(await fs.readFile(file,'utf8'),source);assert.equal(await fs.readFile(output,'utf8'),'keep');
}));

test('project loading rejects malformed projects, duplicate units, extra programs and invalid UTF-8',()=>temporary(async directory=>{
  const main=path.join(directory,'main.pas'),extra=path.join(directory,'extra.pas'),project=path.join(directory,'bad.vb6web');
  await fs.writeFile(main,'program Main; begin end.');await fs.writeFile(extra,'program Extra; begin end.');await assert.rejects(readPascalProject([main,extra]),/must declare units/);
  await fs.writeFile(extra,'unit Main; interface implementation end.');await assert.rejects(readPascalProject([main,extra]),/Duplicate Pascal/);
  await fs.writeFile(project,'null');await assert.rejects(readPascalProject([project]),/project object/);
  await fs.writeFile(project,'{broken');await assert.rejects(readPascalProject([project]),SyntaxError);
  await fs.writeFile(extra,new Uint8Array([255,254,128]));await assert.rejects(readPascalProject([extra]),/encoded data|encoding/i);
  await assert.rejects(readPascalProject([directory]),/Expected.*input/);
}));

test('run loads project resources, files and settings into an isolated runtime snapshot',()=>temporary(async directory=>{
  const project=createPascalProject(`program Stored;
var F:Text; S:String;
begin
  Assign(F,'/input.txt'); Reset(F); ReadLn(F,S); Close(F);
  WriteLn(S,':',LoadResString(1),':',GetSetting('Stored','Section','Key','missing'));
  SaveSetting('Stored','Section','Key','changed');
  Rewrite(F); WriteLn(F,'changed'); Close(F);
  WriteLn(GetSetting('Stored','Section','Key'))
end.`,{name:'Stored'});
  project.vfs={files:{'/input.txt':'from-project\r\n'},directories:['/']};
  project.appSettings={'Stored/Section/Key':'original'};
  const strings=Array(16).fill('');strings[1]='resource';
  project.resources={entries:[{type:6,name:1,language:0,data:Buffer.from(encodeStringTable(strings)).toString('base64')}]};
  const filename=path.join(directory,'stored.vb6web'),snapshot=JSON.stringify(project);
  await fs.writeFile(filename,snapshot);
  for(let attempt=0;attempt<2;attempt++) {
    const result=invoke([filename,'--target','run']);
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout,'from-project:resource:original\nchanged\n');
  }
  assert.equal(await fs.readFile(filename,'utf8'),snapshot);
}));

for(const [architecture,machine,reported] of [[undefined,62,'x86_64'],['arm64',183,'arm64']])
test('Linux artifact CLI emits the requested '+(architecture||'default x64')+' ELF architecture',()=>temporary(async directory=>{
  const file=path.join(directory,'native.pas'),output=path.join(directory,'native.zip');
  await fs.writeFile(file,`program NativeProgram;
{$IFDEF LINUX} procedure TargetOnly; begin WriteLn(42) end; {$ENDIF}
begin TargetOnly end.`);
  const args=[file,'--target','linux','--out',output];if(architecture)args.push('--architecture',architecture);
  const result=invoke(args);assert.equal(result.status,0,result.stderr);
  const summary=JSON.parse(result.stdout);assert.equal(summary.report.architecture,reported);assert.equal(summary.report.machine,machine);
  assert.equal(summary.report.integrityVerified,true);assert.equal(summary.report.runtimeProvenanceVerified,true);
  const archive=await readZip(await fs.readFile(output)),bytes=archive.get('NativeProgram/bin/NativeProgram');
  assert.ok(bytes,'Verified ZIP contains the application executable');
  assert.equal(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint16(18,true),machine);
  const layout=inspectLinuxELF(bytes,{requireProject:true,architecture:architecture||'x64'});
  assert.ok(layout.codeSize>0);assert.equal(layout.metadataJSON.name,'NativeProgram');
}));
