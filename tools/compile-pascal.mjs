#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {VBError} from '../src/language/lexer.js';
import {createPascalProject,compileProject,parsePascalModule} from '../packages/turbo-pascal/src/index.js';

export const PASCAL_CLI_USAGE=`Usage: node tools/compile-pascal.mjs main.pas [unit.pas ...] [options]
       node tools/compile-pascal.mjs project.vb6web [options]
  --target check|run|ir|html|win32|macos|linux   Default: check
  --out FILE          Required for artifact targets; creates a new file
  --name NAME         Override the project/application name
  --help              Display help

Forms use the same .vb6web project and designer model as Visual Basic.
Native targets reuse the existing Win32 PE, macOS ARM64 and Linux ELF AOT
compilers. macOS/Linux output is a verified application ZIP. Build the matching
runtime first with npm run build. Existing output files are never overwritten.
Run reads UTF-8 lines from standard input and preserves Write/WriteLn output.
End of standard input raises Pascal I/O error 100; diagnostics use standard
error. Check and artifact targets print a JSON result.`;

export function parsePascalOptions(args) {
  const result={target:'check',inputs:[]},seen=new Set();
  for(let index=0;index<args.length;index++) {
    const arg=args[index];
    if(arg==='--help'){result.help=true;continue;}
    if(arg==='--'){result.inputs.push(...args.slice(index+1));break;}
    if(!arg.startsWith('-')){result.inputs.push(arg);continue;}
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
    if(!project||typeof project!=='object'||Array.isArray(project)||!Array.isArray(project.modules))throw new Error('Expected a .vb6web project object with a modules array.');
    if(name!==undefined)project.name=name;
    return project;
  }
  if(inputs.some(file=>!/\.(?:pas|pp)$/i.test(file)))throw new Error('Expected .pas, .pp or .vb6web input.');
  const modules=[],names=new Set();
  for(const file of inputs) {
    const code=await readSource(file),fallback=path.basename(file).replace(/\.[^.]+$/,'');
    const ast=parsePascalModule({name:fallback,code});
    if(modules.length&&ast.moduleKind!=='unit')throw new Error('Additional Pascal source files must declare units: '+file);
    if(names.has(ast.name.toLowerCase()))throw new Error('Duplicate Pascal program or unit name: '+ast.name);
    names.add(ast.name.toLowerCase());
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

/** The shared VM requests one line at a time through its existing InputBox
 * host contract. Opening lazily avoids consuming stdin for unused routines. */
export function createPascalLineInput(input=process.stdin) {
  let reader=null,iterator=null,closed=false;
  const endOfInput=()=>new VBError('Unexpected end of standard input',100,'Turbo Pascal file I/O');
  return {
    async inputBox() {
      if(closed)throw endOfInput();
      if(!reader){reader=createInterface({input,terminal:false,crlfDelay:Infinity});iterator=reader[Symbol.asyncIterator]();}
      const next=await iterator.next();
      if(next.done)throw endOfInput();
      return next.value;
    },
    close(){closed=true;reader?.close();},
  };
}

export async function compilePascalCLI(options,{print=(text,newline=true)=>process.stdout.write(String(text)+(newline?'\n':'')),input=process.stdin,inputBox=null}={}) {
  if(options.help){print(PASCAL_CLI_USAGE);return {valid:true};}
  const project=await readPascalProject(options.inputs,options);
  const program=compileProject(project);
  if(!program.valid)return {valid:false,diagnostics:program.diagnostics};
  if(options.target==='check')return {valid:true,language:'pascal',modules:program.modules.size,diagnostics:[]};
  if(options.target==='run') {
    if([...program.modules.values()].some(module=>module.form))throw new Error('The run target provides console I/O; use the HTML or native target to run forms.');
    const {VirtualMachine}=await import('../src/runtime/vm.js');
    const lines=inputBox?null:createPascalLineInput(input);
    try {const vm=new VirtualMachine(program,{print,inputBox:inputBox||lines.inputBox});await vm.start();return {valid:true,executed:true};}
    finally{lines?.close();}
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
    const options=parsePascalOptions(process.argv.slice(2)),result=await compilePascalCLI(options);
    if(!result.valid){console.error(JSON.stringify(result,null,2));process.exitCode=1;}
    else if(!options.help&&options.target!=='run')console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(JSON.stringify({valid:false,diagnostics:error.diagnostics||[{severity:'error',message:error.message,number:error.number,code:error.code,source:error.source,line:error.line,column:error.column}]},null,2));process.exitCode=1;}
}
