import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

/** Execute the real registration helper in separate OS processes, headlessly. */
export async function qualifyLinuxInstances(executable,{prefix=[]}={}){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-instance-contracts-'));
  const processes=new Set();
  const environment={...process.env};delete environment.DISPLAY;delete environment.WAYLAND_DISPLAY;
  async function start(file=executable,args=[],env=environment){
    const child=spawn(prefix[0]||file,[...prefix.slice(1),...(prefix.length?[file]:[]),...args],{stdio:['pipe','pipe','pipe'],env});processes.add(child);
    let stderr='';child.stderr.setEncoding('utf8');child.stderr.on('data',text=>stderr+=text);
    const lines=createInterface({input:child.stdout});const waiting=[],buffer=[];
    const completion=new Promise((resolve,reject)=>{
      child.once('error',reject);child.once('exit',(code,signal)=>{processes.delete(child);resolve({code,signal,stderr});});
    });
    lines.on('line',line=>waiting.length?waiting.shift()(line):buffer.push(line));
    const line=()=>Promise.race([
      new Promise(resolve=>buffer.length?resolve(buffer.shift()):waiting.push(resolve)),
      completion.then(result=>{throw new Error('Probe exited before response: '+JSON.stringify(result));}),
      new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Instance probe response timed out')),10000);timer.unref();})
    ]);
    assert.match(await line(),/^READY \d+$/);
    return {child,completion,line,async command(value){child.stdin.write(value+'\n');return line();},async stop(){child.stdin.end('exit\n');assert.equal((await completion).code,0);},async kill(){child.kill('SIGKILL');assert.equal((await completion).signal,'SIGKILL');}};
  }
  try{
    // Registration happens before any property access by the first process.
    const first=await start(),second=await start();
    assert.equal(await second.command('get'),'PREVIOUS');
    assert.equal(await first.command('get'),'FIRST');
    assert.equal(await first.command('same-process'),'SAME_PROCESS_OK');
    await first.kill();
    const third=await start();assert.equal(await third.command('get'),'PREVIOUS');
    await second.stop();assert.equal(await third.command('get'),'PREVIOUS');await third.stop();
    const restart=await start();assert.equal(await restart.command('get'),'FIRST');

    const alias=path.join(directory,'alias');await fs.symlink(executable,alias);
    const linked=await start(alias);assert.equal(await linked.command('get'),'PREVIOUS');await linked.stop();
    const varied=await start(executable,[],{...environment,HOME:directory,TMPDIR:directory,XDG_RUNTIME_DIR:directory});
    assert.equal(await varied.command('get'),'PREVIOUS');await varied.stop();
    const copy=path.join(directory,'different-application');await fs.copyFile(executable,copy);await fs.chmod(copy,0o755);
    const independent=await start(copy);assert.equal(await independent.command('get'),'FIRST');await independent.stop();await restart.stop();

    const simultaneous=await Promise.all(Array.from({length:8},()=>start()));
    const classifications=await Promise.all(simultaneous.map(child=>child.command('get')));
    assert.equal(classifications.filter(value=>value==='FIRST').length,1);
    assert.equal(classifications.filter(value=>value==='PREVIOUS').length,7);
    await Promise.all(simultaneous.map(child=>child.kill()));
    const recovered=await start();assert.equal(await recovered.command('get'),'FIRST');await recovered.stop();

    const exec=await start(executable,['--exec']);
    // The replacement image acknowledges exec after the kernel has closed all
    // registration descriptors. This also works across PID namespaces.
    assert.equal(await exec.line(),'EXEC_READY');
    const afterExec=await start();assert.equal(await afterExec.command('get'),'FIRST');await afterExec.stop();await exec.kill();
    return {passed:true,concurrentProcesses:8,checks:['startup-before-access','stable-startup-snapshot','same-process-sharing','surviving-secondary','normal-exit','crash-restart','simultaneous-start','symlink-identity','environment-independent-identity','separate-application','close-on-exec']};
  }finally{
    for(const child of processes)child.kill('SIGKILL');
    await fs.rm(directory,{recursive:true,force:true});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await qualifyLinuxInstances(path.resolve(process.argv[2])),null,2));}
  catch(error){console.error(error);process.exitCode=1;}
}
