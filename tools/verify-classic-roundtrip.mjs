/** Owner-run licensed VB6 round-trip checks. No proprietary binary is distributed. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {buildClassic} from './build-classic.mjs';
import {readStableNativeFolder,sha256} from './native-snapshot.mjs';
import {importFiles,sourceFiles} from '../src/project/formats.js';
import {bytesOf,equalBytes} from '../src/project/native-text.js';
import {nativeOutputPath} from '../src/project/native-directory.js';
async function put(root,files){for(const [name,bytes]of files){const target=path.join(root,nativeOutputPath(name));await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,bytesOf(bytes),{flag:'wx'});}}
export function classicRoundtripOptions(args){const o={encoding:'auto',compile:false,allowNativeCode:false,timeout:120000};const keys={'--project':'project','--source-root':'sourceRoot','--compiler':'compiler','--out':'out','--encoding':'encoding','--timeout':'timeout'};for(let i=0;i<args.length;i++){if(args[i]==='--compile')o.compile=true;else if(args[i]==='--allow-native-code')o.allowNativeCode=true;else if(args[i]==='--ide-smoke')o.ideSmoke=true;else if(keys[args[i]]&&args[i+1]&&!args[i+1].startsWith('--'))o[keys[args[i]]]=args[++i];else throw Error('Unknown or incomplete round-trip option '+args[i]);}o.timeout=Number(o.timeout);if(!o.project||!o.out||!/\.vbp$/i.test(o.project))throw Error('--project native.vbp and --out NEW_DIRECTORY are required');if(!Number.isInteger(o.timeout)||o.timeout<1000||o.timeout>3600000)throw Error('Invalid timeout');if(o.compile&&!o.allowNativeCode||o.ideSmoke&&!o.compile)throw Error('Native compilation/IDE execution requires --compile --allow-native-code');return o;}
async function runIDE(compiler,plan,timeout){
  // This mode is intentionally limited to the repository's self-terminating
  // HelloRuntime fixture. General user applications need their own smoke oracle.
  const marker=path.join(path.dirname(plan.vbp),'classic-smoke.txt');await fs.rm(marker,{force:true});
  const log=path.join(plan.stage,'ide-run.log'),args=['/runexit',plan.vbp,'/out',log,'/cmd','/smoke'];
  await new Promise((resolve,reject)=>{const p=spawn(compiler,args,{cwd:path.dirname(plan.vbp),stdio:'ignore',shell:false});const timer=setTimeout(()=>{if(process.platform==='win32')spawn('taskkill',['/pid',String(p.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});else p.kill();reject(Error('Licensed IDE smoke timed out'));},timeout);p.once('error',e=>{clearTimeout(timer);reject(e);});p.once('close',code=>{clearTimeout(timer);if(code)reject(Error('Licensed IDE smoke failed: '+code));else resolve();});});
  const result=await fs.readFile(marker,'utf8');if(result.trim()!=='VB6 runtime OK')throw Error('Licensed IDE did not produce the expected fresh smoke marker');return {passed:true,args,marker,log};
}
export async function verifyClassicRoundtrip(options,{builder=buildClassic}={}){
  if(options.compile&&!options.allowNativeCode)throw Error('Explicit native-code consent required');
  const input=await fs.realpath(options.project),root=await fs.realpath(options.sourceRoot||path.dirname(input)),relative=path.relative(root,input).replace(/\\/g,'/');nativeOutputPath(relative);
  const files=await readStableNativeFolder(root),imported=await importFiles(files,{entryPath:relative,encoding:options.encoding||'auto'});if(imported.diagnostics.some(d=>d.severity==='error'))throw Error('Original native import has errors: '+imported.diagnostics.map(d=>d.message).join('; '));
  const exported=new Map(Object.entries(sourceFiles(imported.project))),reopened=await importFiles(exported,{entryPath:relative,encoding:options.encoding||'auto'});if(reopened.diagnostics.some(d=>d.severity==='error'))throw Error('Round-trip reimport failed');
  const differences=[...new Set([...files.keys(),...exported.keys()])].filter(p=>!files.has(p)||!exported.has(p)||!equalBytes(bytesOf(files.get(p)),bytesOf(exported.get(p))));if(differences.length)throw Error('No-op round-trip changed native bytes: '+differences.join(', '));
  const out=path.resolve(options.out),inside=path.relative(root,out);if(inside===''||!inside.startsWith('..'+path.sep)&&inside!=='..'&&!path.isAbsolute(inside))throw Error('Round-trip output must be outside the source folder');await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out,{recursive:false});
  const report={format:'VB6Studio.ClassicRoundtrip',version:1,entry:relative,encoding:options.encoding||'auto',sourceFiles:[...files].map(([name,b])=>({name,size:bytesOf(b).length,sha256:sha256(bytesOf(b))})),bytePreservation:true,compilerStatus:options.compile?'pending':'not-run',ideStatus:'not-run',builds:[],universalCertification:false};
  try{
    const original=path.join(out,'original'),roundtrip=path.join(out,'roundtrip');await fs.mkdir(original);await fs.mkdir(roundtrip);await put(original,files);await put(roundtrip,exported);
    if(options.ideSmoke){const expected=await fs.readFile(new URL('../examples/classic/Main.bas',import.meta.url));const found=files.get(path.posix.join(path.posix.dirname(relative),'Main.bas'));if(!found||!equalBytes(expected,found))throw Error('--ide-smoke requires the unmodified HelloRuntime sample');}
    for(const codegen of ['native','pcode'])for(const [kind,sourceRoot]of [['original',original],['roundtrip',roundtrip]]){
      const result=await builder({project:path.join(sourceRoot,relative),sourceRoot,out:path.join(out,'build-'+kind+'-'+codegen),compiler:options.compiler,codegen,timeout:options.timeout||120000,stageOnly:!options.compile});
      report.builds.push({kind,codegen,compiled:result.compiled===true,executable:result.compiled?result.executable:null,sha256:result.sha256||null,stage:result.stage,log:result.log});
      if(options.compile&&result.compiled!==true)throw Error('Licensed compiler did not confirm fresh output');
      if(options.ideSmoke&&codegen==='native')report.builds.at(-1).ide=await runIDE(result.compiler,result,options.timeout||120000);
    }
    if(options.compile)report.compilerStatus='passed';if(options.ideSmoke)report.ideStatus='passed';
    return report;
  }catch(error){report.error=error.message;if(options.compile)report.compilerStatus='failed';if(options.ideSmoke)report.ideStatus='failed';throw error;
  }finally{await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{console.log(JSON.stringify(await verifyClassicRoundtrip(classicRoundtripOptions(process.argv.slice(2))),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
