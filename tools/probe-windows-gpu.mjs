/** Isolated diagnostic: compare a stock Electron canvas with the application host. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(new URL('../desktop/package.json',import.meta.url));
const executable=require('electron');
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-gpu-probe-'));
const modes={
  default:[],
  swangle:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  softwarecompositor:['--disable-gpu-compositing','--enable-unsafe-swiftshader'],
  nogpuSandbox:['--disable-gpu-sandbox','--enable-unsafe-swiftshader'],
  fallback:['--use-gl=angle','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader','--disable-skia-graphite']
};
async function canvasProbe(){
  const result={secure:isSecureContext,gpu:!!navigator.gpu};
  let device,context,buffer;
  try{
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)return {...result,error:'No adapter'};
    device=await adapter.requestDevice();globalThis.retainedGPU={adapter,device};
    result.adapter={vendor:adapter.info?.vendor,architecture:adapter.info?.architecture};
    device.lost.then(info=>{result.lost={reason:info.reason,message:info.message};});
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;document.body.append(canvas);
    context=canvas.getContext('webgpu');
    device.pushErrorScope('validation');
    context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
    buffer=device.createBuffer({size:256*64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const encoder=device.createCommandEncoder(),texture=context.getCurrentTexture();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:'clear',storeOp:'store',clearValue:[1,0,0,1]}]});
    pass.end();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:256},[64,64]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const pixel=Array.from(new Uint8Array(buffer.getMappedRange(),0,4));buffer.unmap();
    result.pixel=pixel;result.format=navigator.gpu.getPreferredCanvasFormat();
    const validation=await device.popErrorScope();if(validation)throw new Error(validation.message);
    result.ok=pixel[3]===255&&pixel[result.format==='bgra8unorm'?2:0]===255;
  }catch(error){result.error=error.message;result.ok=false;}
  finally{buffer?.destroy();context?.unconfigure();}
  return result;
}
await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:'gpu-diagnostic',main:'main.cjs'}));
await fs.writeFile(path.join(stage,'index.html'),'<html><body>Native WebGPU diagnostic</body></html>');
await fs.writeFile(path.join(stage,'main.cjs'),`
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const events=[];let done=false;
app.commandLine.appendSwitch('enable-unsafe-webgpu');
app.on('child-process-gone',(_event,info)=>events.push(info));
function finish(result){if(done)return;done=true;fs.writeFileSync(process.env.VB6_GPU_REPORT,JSON.stringify({...result,events},null,2));app.exit(result.ok?0:1);}
setTimeout(()=>finish({ok:false,error:'GPU diagnostic timed out'}),20000);
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:400,height:300,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 win.webContents.on('console-message',(_event,details)=>events.push({console:details?.message??details}));
 await win.loadFile(path.join(__dirname,'index.html'));
 try{const result=await win.webContents.executeJavaScript('('+${JSON.stringify(canvasProbe.toString())}+')()');finish({...result,gpu:app.getGPUFeatureStatus(),info:await app.getGPUInfo('basic')});}
 catch(error){finish({ok:false,error:error.message});}
}).catch(error=>finish({ok:false,error:error.message}));
`);
await fs.mkdir('validation',{recursive:true});
for(const [mode,flags] of Object.entries(modes)){
  const output=path.resolve('validation','gpu-isolated-'+mode+'.json');let log='';
  const exit=await new Promise(resolve=>{
    const child=spawn(executable,['--enable-logging=stderr',...flags,stage],{shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,VB6_GPU_REPORT:output}});
    const capture=data=>{log=(log+data).slice(-200000);};child.stdout.on('data',capture);child.stderr.on('data',capture);
    const timer=setTimeout(()=>{child.kill();resolve({timeout:true});},25000);
    child.on('error',error=>{clearTimeout(timer);resolve({error:error.message});});
    child.on('close',code=>{clearTimeout(timer);resolve({code});});
  });
  let report;try{report=JSON.parse(await fs.readFile(output,'utf8'));}catch{report={ok:false,error:'No diagnostic report'};}
  await fs.writeFile(output,JSON.stringify({...report,testFlags:flags,exit},null,2));
  await fs.writeFile(output+'.log',log);
  console.log(mode,JSON.stringify(report));
}
await fs.rm(stage,{recursive:true,force:true});
