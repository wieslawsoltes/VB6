#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readLinuxProject,exportLinuxProject,exportLinuxExecutable} from '../src/node.mjs';
export async function main(arguments_=process.argv.slice(2)) {
  const args=[...arguments_];
  if(!args.length||args.includes('--help')) {
    console.log('vb6-linux PROJECT.vb6web|PROJECT.vbp|FOLDER --out DIRECTORY [--extract] [--optimization 0..3] [--name NAME]');
    console.log('Default: offline Linux x86_64 ELF application ZIP export from any Node-supported host. --extract writes a new application directory containing bin/NAME and Resources. Export requires no native compiler or server. Applications use native GTK3 and require no Wine or JavaScript runtime. Existing output is never overwritten; exported applications are never executed.');
    return;
  }
  const input=args.shift(),options={compiler:{}},seen=new Set();let extract=false;
  for(let index=0;index<args.length;++index) {
    const argument=args[index];if(seen.has(argument))throw new Error('Duplicate argument: '+argument);seen.add(argument);
    if(argument==='--extract'){extract=true;continue;}
    if(!['--out','--optimization','--name'].includes(argument)||!args[index+1])throw new Error('Unknown or missing argument: '+argument);
    const value=args[++index];
    if(argument==='--out')options.out=value;
    else if(argument==='--name')options.compiler.name=value;
    else {if(!/^[0-3]$/.test(value))throw new Error('--optimization must be 0, 1, 2 or 3.');options.compiler.optimization=Number(value);}
  }
  if(!options.out)throw new Error('--out DIRECTORY is required.');
  const project=await readLinuxProject(input);
  console.log(JSON.stringify(await (extract?exportLinuxExecutable:exportLinuxProject)(project,options),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {await main();}catch(error){console.error(error.message);if(error.diagnostics)console.error(JSON.stringify(error.diagnostics,null,2));process.exitCode=1;}
}
