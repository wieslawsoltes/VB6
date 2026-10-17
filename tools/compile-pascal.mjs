#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPascalProject,compileProject,parsePascalModule} from '../packages/turbo-pascal/src/index.js';

export const PASCAL_CLI_USAGE=`Usage: node tools/compile-pascal.mjs main.pas [unit.pas ...] [options]
       node tools/compile-pascal.mjs project.vb6web [options]
  --target check|run|ir|html|win32|macos|linux   Default: check
  --out FILE          Required for artifact targets; creates a new file
  --name IDENTIFIER   Override the project/application name
  --help              Display help

Forms use the same .vb6web project and designer model as Visual Basic.
Native targets reuse the existing Win32 PE, macOS ARM64 and Linux ELF AOT
compilers. macOS/Linux output is a verified application ZIP. Build the matching
runtime first with npm run build. Existing output files are never overwritten.`;

export function parsePascalOptions(args) {
  const result={target:'check',inputs:[]},seen=new Set();
  for(let index=0;index<args.length;index++) {
    const arg=args[index];
    if(arg==='--help'){result.help=true;continue;}
    if(!arg.startsWith('--')){result.inputs.push(arg);continue;}
    if(!['--target','--out','--name'].includes(arg))throw new Error('Unknown option: '+arg);
    if(seen.has(arg))throw new Error('Repeated option: '+arg);
    seen.add(arg);
    if(!args[index+1]||args[index+1].startsWith('--'))throw new Error('Missing value for '+arg);
    result[arg.slice(2)]=args[++index];
  }
  if(result.help)return result;
  if(!result.inputs.length)throw new Error('A Pascal source or .vb6web project is required.');
  if(!['check','run','ir','html','win32','macos','linux'].includes(result.target))throw new Error('Unknown Pascal target: '+result.target);
  if(!['check','run'].includes(result.target)&&!result.out)throw new Error('--out is required for '+result.target);
  if(['check','run'].includes(result.target)&&result.out)throw new Error('--out is not used by '+result.target);
  return result;
}

async function readSource(file) {
  const handle=await fs.open(file,'r');
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>20*1024*1024)throw new Error('Source must be a regular file of at most 20 MiB: '+file);
    return new TextDecoder('utf-8',{fatal:true}).decode(await handle.readFile());
  }finally{await handle.close();}
}

export async function readPascalProject(inputs,{name}={}) {
  if(/\.vb6web$/i.test(inputs[0])) {
    if(inputs.length!==1)throw new Error('Additional sources belong in the .vb6web project.');
    const project=JSON.parse(await readSource(inputs[0]));
    if(name!==undefined)project.name=name;
    return project;
  }
  if(inputs.some(file=>!/\.(?:pas|pp)$/i.test(file)))throw new Error('Expected .pas, .pp or .vb6web input.');
  const modules=[];
  for(const file of inputs) {
    const code=await readSource(file),fallback=path.basename(file).replace(/\.[^.]+$/,'');
    const ast=parsePascalModule({name:fallback,code});
    modules.push({name:ast.name||fallback,code,sourcePath:path.basename(file),language:'pascal'});
  }
  const [main,...units]=modules;
  return createPascalProject(main.code,{name:name||main.name,moduleName:main.name,units});
}

function serializableIR(value) {
  if(value instanceof Map)return Object.fromEntries(value);
  if(value instanceof Set)return [...value];
  if(typeof value==='bigint')return value.toString();
  return value;
}

export async function compilePascalCLI(options,{print=text=>process.stdout.write(String(text)+'\n')}={}) {
  if(options.help){print(PASCAL_CLI_USAGE);return {valid:true};}
  const project=await readPascalProject(options.inputs,options);
  const program=compileProject(project);
  if(!program.valid)return {valid:false,diagnostics:program.diagnostics};
  if(options.target==='check')return {valid:true,language:'pascal',modules:program.modules.size,diagnostics:[]};
  if(options.target==='run') {
    const {VirtualMachine}=await import('../src/runtime/vm.js');
    const vm=new VirtualMachine(program,{print});await vm.start();
    return {valid:true,executed:true};
  }
  let bytes,report;
  switch(options.target) {
    case 'ir':bytes=JSON.stringify(program,(_key,value)=>serializableIR(value),2)+'\n';break;
    case 'html':{
      const {exportApplication}=await import('../src/exporter/exporter.js');
      bytes=exportApplication(project);break;
    }
    case 'win32':{
      const {compileWin32}=await import('../src/native/compiler.js');
      const result=compileWin32(project);bytes=result.bytes;report=result.report;break;
    }
    case 'macos':{
      const {exportMacOSApplication}=await import('../packages/macos-native/src/aot-application.js');
      const result=await exportMacOSApplication(project);bytes=result.bytes;report=result.report;break;
    }
    case 'linux':{
      const {exportLinuxApplication}=await import('../packages/linux-native/src/aot-export.js');
      const result=await exportLinuxApplication(project);bytes=result.bytes;report=result.report;break;
    }
    default:throw new Error('Unknown Pascal target: '+options.target);
  }
  const output=path.resolve(options.out);
  await fs.writeFile(output,bytes,{flag:'wx'});
  return {valid:true,target:options.target,output,bytes:typeof bytes==='string'?Buffer.byteLength(bytes):bytes.byteLength,...(report?{report}:{})};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const result=await compilePascalCLI(parsePascalOptions(process.argv.slice(2)));
    console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=1;
  }catch(error){console.error(JSON.stringify({valid:false,diagnostics:error.diagnostics||[{severity:'error',message:error.message,source:error.source,line:error.line,column:error.column}]},null,2));process.exitCode=1;}
}
