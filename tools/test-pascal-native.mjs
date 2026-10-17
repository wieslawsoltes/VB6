/** Execute emitted Pascal machine code using the existing platform runtime.
 * No C/C++/Pascal compiler recompiles the project under test. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pascalNativeVerificationProject} from '../tests/pascal-integration-fixtures.mjs';

const project=pascalNativeVerificationProject();
const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-pascal-native-'));
const reportDirectory=path.resolve('reports/pascal-native');
await fs.mkdir(reportDirectory,{recursive:true});
const report={platform:process.platform,architecture:process.arch,source:'Turbo Pascal 7.0',checks:[]};

async function extract(files,root,executableName) {
  for(const [name,bytes] of files) {
    const destination=path.join(root,...name.split('/'));
    if(!destination.startsWith(root+path.sep))throw new Error('Native archive path escaped extraction root.');
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,bytes,{flag:'wx',mode:name===executableName?0o755:0o644});
  }
  return path.join(root,...executableName.split('/'));
}

try {
  for(const optimization of [0,2]) {
    const work=path.join(directory,'O'+optimization);await fs.mkdir(work);
    let executable,bytes;
    if(process.platform==='win32') {
      const {compileWin32}=await import('../src/native/compiler.js');
      const compiled=compileWin32(project,{optimization});bytes=compiled.bytes;
      executable=path.join(work,project.name+'.exe');await fs.writeFile(executable,bytes,{flag:'wx'});
    }else if(process.platform==='darwin'&&process.arch==='arm64') {
      const {exportMacOSApplication}=await import('../packages/macos-native/src/aot-application.js');
      const {unpackMacOSAOTArchive,verifyMacOSAOTArchive}=await import('../packages/macos-native/src/aot-export.js');
      const result=await exportMacOSApplication(project,{optimization});await verifyMacOSAOTArchive(result.bytes,result.options);
      const unpacked=await unpackMacOSAOTArchive(result.bytes,result.options);
      executable=await extract(unpacked.files,work,result.options.name+'.app/Contents/MacOS/'+result.options.name);bytes=await fs.readFile(executable);
    }else if(process.platform==='linux'&&process.arch==='x64') {
      const {exportLinuxApplication,unpackLinuxAOTArchive,verifyLinuxAOTArchive}=await import('../packages/linux-native/src/aot-export.js');
      const result=await exportLinuxApplication(project,{optimization});await verifyLinuxAOTArchive(result.bytes,result.options);
      const unpacked=await unpackLinuxAOTArchive(result.bytes,result.options);
      executable=await extract(unpacked.files,work,result.options.name+'/bin/'+result.options.name);bytes=await fs.readFile(executable);
    }else throw new Error('Pascal native qualification needs Windows, Apple Silicon macOS or x64 Linux.');
    const processResult=spawnSync(executable,[],{cwd:work,encoding:'utf8',timeout:30000,maxBuffer:1024*1024,windowsHide:true});
    assert.ifError(processResult.error);assert.equal(processResult.status,0,processResult.stderr||processResult.stdout);
    const actual=await fs.readFile(path.join(work,'pascal-native-result.txt'),'utf8');
    assert.equal(actual.trim(),'42','Native Pascal initialization, loops, calls and var aliasing');
    report.checks.push({optimization,executableSHA256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,result:actual.trim(),executed:true});
  }
  report.valid=true;console.log(JSON.stringify(report,null,2));
}catch(error){report.valid=false;report.error=error.stack;throw error;}
finally{await fs.writeFile(path.join(reportDirectory,process.platform+'-'+process.arch+'.json'),JSON.stringify(report,null,2)+'\n');}
