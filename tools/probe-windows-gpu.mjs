import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(new URL('../desktop/package.json',import.meta.url));
const executable=require('electron'),stage=path.resolve(process.argv[2]);
const modes={
  d3d11:['--use-webgpu-adapter=d3d11','--use-angle=d3d11'],
  d3d12:['--use-webgpu-adapter=d3d12','--use-angle=d3d11'],
  swiftshader:['--use-webgpu-adapter=swiftshader','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  vulkan:['--use-webgpu-adapter=swiftshader','--enable-features=Vulkan','--use-angle=vulkan','--use-vulkan=swiftshader','--disable-vulkan-surface']
};
await fs.mkdir('validation',{recursive:true});
for(const [mode,flags] of Object.entries(modes)){
  const output=path.resolve('validation','gpu-'+mode+'.json');
  const result=await new Promise(resolve=>{
    const child=spawn(executable,[...flags,stage,'--native-smoke'],{shell:false,stdio:'inherit',env:{...process.env,VB6_SMOKE_REPORT:output,VB6_SMOKE_SOFTWARE_GPU:'1'}});
    const timer=setTimeout(()=>{const killer=spawn('taskkill.exe',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});killer.on('error',()=>child.kill());resolve({timeout:true});},45000);
    child.on('error',error=>{clearTimeout(timer);resolve({error:error.message});});
    child.on('close',code=>{clearTimeout(timer);resolve({code});});
  });
  let report;try{report=JSON.parse(await fs.readFile(output,'utf8'));}catch{report={ok:false,...result};}
  report.testFlags=flags;report.exit=result;
  await fs.writeFile(output,JSON.stringify(report,null,2));
  console.log(mode,JSON.stringify(report));
}
