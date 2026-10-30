/** Actual Wayland compositor and X11 window-manager native qualification. MIT. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const script=fileURLToPath(import.meta.url);
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function start(command,args,options={}) {
  const child=spawn(command,args,{...options,stdio:['ignore','pipe','pipe']});
  const state={child,stdout:'',stderr:'',code:null,signal:null,error:null,closed:false};
  child.stdout.on('data',bytes=>state.stdout=(state.stdout+bytes).slice(-2*1024*1024));
  child.stderr.on('data',bytes=>state.stderr=(state.stderr+bytes).slice(-2*1024*1024));
  child.on('error',error=>state.error=error);
  state.done=new Promise(resolve=>child.on('close',(code,signal)=>{state.code=code;state.signal=signal;state.closed=true;resolve(state);}));
  return state;
}
async function stop(state) {
  if(state.closed)return;
  state.child.kill('SIGTERM');
  let timer;try{await Promise.race([state.done,new Promise(resolve=>timer=setTimeout(resolve,2000))]);}finally{clearTimeout(timer);}
  if(!state.closed){state.child.kill('SIGKILL');await state.done;}
}
async function run(command,args,{timeout=60000,...options}={}) {
  const state=start(command,args,options);
  let timer;
  try {
    const timedOut=await Promise.race([state.done.then(()=>false),new Promise(resolve=>timer=setTimeout(()=>resolve(true),timeout))]);
    if(timedOut)throw new Error('Native display command timed out: '+command+'\n'+state.stdout+'\n'+state.stderr);
    if(state.error)throw state.error;
    assert.equal(state.code,0,'Native display command failed ('+command+', '+state.signal+'):\n'+state.stdout+'\n'+state.stderr);
    return state;
  }finally{clearTimeout(timer);await stop(state);}
}
function nativeEnvironment(home,backend) {
  const env={...process.env,GDK_BACKEND:backend,XDG_RUNTIME_DIR:home,XDG_CONFIG_HOME:path.join(home,'config'),XDG_CACHE_HOME:path.join(home,'cache'),G_DEBUG:'fatal-criticals',NO_AT_BRIDGE:'1'};
  delete env.WAYLAND_DISPLAY;if(backend==='wayland')delete env.DISPLAY;
  return env;
}
async function nativeCase(executable,mode,{prefix=[],env,emulated=false}) {
  const command=prefix.length?prefix[0]:executable,args=[...prefix.slice(1),...(prefix.length?[executable]:[]),mode];
  const result=await run(command,args,{env,timeout:emulated?180000:60000});
  assert.equal(result.stderr.trim(),'','Native display fixture emitted unexpected GTK diagnostics');
  assert.match(result.stdout,mode==='--x11'?/LINUX_GTK_X11_WM_OK/:/LINUX_GTK_WAYLAND_OK/);
  return result.stdout.trim();
}
async function x11Child(config) {
  const env=nativeEnvironment(config.home,'x11');
  const manager=start('openbox',['--sm-disable','--config-file',config.openboxConfig],{env});
  try {
    // The compiled fixture waits for the actual EWMH capability before issuing
    // geometry requests. No inherited or system window manager is touched.
    const stdout=await nativeCase(config.executable,'--x11',{...config,env});
    assert.ok(!manager.closed,'The isolated Openbox window manager exited:\n'+manager.stderr);
    return {name:'x11-openbox',stdout};
  }catch(error){
    // Capture the manager's state before cleanup can terminate it. Rethrow the
    // same fixture error so the original assertion and stack remain visible.
    console.error('Openbox state before cleanup: '+JSON.stringify({closed:manager.closed,exitCode:manager.code,signal:manager.signal,spawnError:manager.error?.message??null})+'\nOpenbox stderr:\n'+(manager.stderr||'(empty)'));
    throw error;
  }finally{await stop(manager);}
}
async function waylandChild({executable,prefix,emulated,home}) {
  const env=nativeEnvironment(home,'wayland');env.WAYLAND_DISPLAY='vb6-wayland';
  const logfile=path.join(home,'weston.log');
  // Weston's X11 backend supplies a real pointer/keyboard seat from our own
  // Xvfb server. The bare headless backend has no seat, which GTK3 requires.
  // Applications still connect exclusively through the native Wayland socket.
  const compositor=start('weston',['--backend=x11','--renderer=pixman','--socket=vb6-wayland','--idle-time=0','--width=1280','--height=900','--no-config','--log='+logfile],{env:{...env,DISPLAY:process.env.DISPLAY}});
  try {
    const deadline=Date.now()+15000;
    for(;;){
      if(compositor.error)throw compositor.error;
      assert.ok(!compositor.closed,'Headless Weston exited before creating its socket: '+compositor.stderr+'\n'+await fs.readFile(logfile,'utf8').catch(()=>''));
      if(await fs.stat(path.join(home,'vb6-wayland')).then(value=>value.isSocket(),()=>false))break;
      assert.ok(Date.now()<deadline,'Headless Weston did not create its display socket');await delay(20);
    }
    const stdout=await nativeCase(executable,'--wayland',{prefix,emulated,env});
    assert.ok(!compositor.closed,'Headless Weston exited during native qualification');
    return {name:'wayland-weston-x11-pixman',stdout};
  }finally{await stop(compositor);}
}

export async function qualifyLinuxDisplays(executable,{prefix=[],emulated=false}={}) {
  assert.ok(path.isAbsolute(executable),'Display fixture needs an absolute executable path');
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-display-contracts-'));
  await fs.chmod(home,0o700);
  try {
    const versions={
      weston:(await run('weston',['--version'])).stdout.trim(),
      openbox:(await run('openbox',['--version'])).stdout.trim().split('\n')[0],
    };
    const openboxConfig=path.join(home,'openbox.xml');
    await fs.writeFile(openboxConfig,'<?xml version="1.0" encoding="UTF-8"?><openbox_config xmlns="http://openbox.org/3.4/rc"><focus><focusNew>yes</focusNew></focus><placement><policy>Smart</policy></placement></openbox_config>\n');
    const configFile=path.join(home,'fixture.json');
    await fs.writeFile(configFile,JSON.stringify({executable,prefix,emulated,home,openboxConfig}));
    const display=await run('xvfb-run',['-a','--server-args=-screen 0 1280x900x24',process.execPath,script,'--virtual-display-child',configFile],{timeout:emulated?400000:150000});
    assert.equal(display.stderr.trim(),'','Isolated display fixture emitted unexpected diagnostics');
    const cases=JSON.parse(display.stdout.trim());
    return {passed:true,versions,cases};
  }finally{await fs.rm(home,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try {
    if(process.argv[2]==='--virtual-display-child'){const config=JSON.parse(await fs.readFile(process.argv[3],'utf8'));console.log(JSON.stringify([await x11Child(config),await waylandChild(config)]));}
    else {
      if(process.argv.length!==3)throw new Error('Usage: node display-contracts.mjs /absolute/path/to/gtk-display-contracts');
      console.log(JSON.stringify(await qualifyLinuxDisplays(path.resolve(process.argv[2])),null,2));
    }
  }catch(error){console.error(error);process.exitCode=1;}
}
