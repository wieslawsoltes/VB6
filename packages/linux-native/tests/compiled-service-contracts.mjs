import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {exportLinuxAOT} from '../src/aot-export.js';
import {linuxPrinterProject,linuxInstanceProject} from './services.mjs';
import {createMockCups} from './mock-cups.mjs';

export async function qualifyLinuxCompiledServices(runtime,{architecture='x64',prefix=[]}={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-compiled-services-'));
  const artifacts={};
  const service=await createMockCups();const children=new Set();
  const env={...process.env,CUPS_SERVER:service.server,HOME:directory};delete env.DISPLAY;delete env.WAYLAND_DISPLAY;delete env.LPDEST;delete env.PRINTER;
  async function build(project){
    const result=await exportLinuxAOT(project,runtime,{architecture,optimization:3});
    const {executableSha256,runtimeSha256,architecture:canonicalArchitecture,machine,callingConvention}=result.report;
    artifacts[project===linuxPrinterProject?'printer':'instance']={executableSha256,runtimeSha256,architecture:canonicalArchitecture,machine,callingConvention};
    for(const [name,bytes]of Object.entries(result.files)){const filename=path.join(directory,name);await fs.mkdir(path.dirname(filename),{recursive:true});await fs.writeFile(filename,bytes,{flag:'wx',mode:name===project.name+'/bin/'+project.name?0o755:0o644});}
    return path.join(directory,project.name,'bin',project.name);
  }
  function execute(file,args=[]){
    const child=spawn(prefix[0]||file,[...prefix.slice(1),...(prefix.length?[file]:[]),...args],{cwd:directory,env,stdio:['ignore','pipe','pipe']});children.add(child);
    let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);
    const timer=setTimeout(()=>child.kill('SIGKILL'),45000);
    const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{clearTimeout(timer);children.delete(child);resolve({code,signal,stdout,stderr});});});
    return {child,completion};
  }
  try{
    const printer=await build(linuxPrinterProject),result=await execute(printer).completion;
    assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.stderr,'');assert.match(result.stdout,/LINUX_PRINTERS_AOT_OK/);
    const instance=await build(linuxInstanceProject),first=await execute(instance).completion;
    assert.equal(first.code,0,JSON.stringify(first));assert.equal(first.stderr,'');assert.match(first.stdout,/INSTANCE_FIRST/);
    const held=execute(instance,['hold']);
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Compiled instance did not acknowledge startup')),10000);let output='';
      held.child.stdout.on('data',bytes=>{output+=bytes;if(output.includes('INSTANCE_READY')){clearTimeout(timeout);resolve();}});
      held.completion.then(result=>{clearTimeout(timeout);reject(new Error('Compiled held instance exited: '+JSON.stringify(result)));},reject);
    });
    const second=await execute(instance).completion;assert.equal(second.code,0,JSON.stringify(second));assert.equal(second.stderr,'');assert.match(second.stdout,/INSTANCE_PREVIOUS/);
    held.child.kill('SIGKILL');assert.equal((await held.completion).signal,'SIGKILL');
    const restart=await execute(instance).completion;assert.equal(restart.code,0,JSON.stringify(restart));assert.equal(restart.stderr,'');assert.match(restart.stdout,/INSTANCE_FIRST/);
    assert.deepEqual(service.errors,[]);assert.equal(service.documents.length,0);
    return {passed:true,architecture,artifacts,checks:['compiled-headless-screen-cursor','compiled-printers-collection','compiled-set-printer-type-errors','compiled-set-printer-selection','compiled-printer-settings','compiled-instance-startup-before-access','compiled-instance-crash-restart']};
  }finally{for(const child of children)child.kill('SIGKILL');await service.close();await fs.rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==3)throw new Error('Usage: node compiled-service-contracts.mjs /path/to/x64/runtime-directory');
    const directory=path.resolve(process.argv[2]);const runtime={bytes:new Uint8Array(await fs.readFile(path.join(directory,'runtime-x86_64'))),manifest:JSON.parse(await fs.readFile(path.join(directory,'runtime.json'),'utf8'))};
    console.log(JSON.stringify(await qualifyLinuxCompiledServices(runtime),null,2));
  }catch(error){console.error(error);process.exitCode=1;}
}
