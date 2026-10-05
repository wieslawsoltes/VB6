import path from 'node:path';
import {assertData} from '../../src/data/common.js';
import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {fileURLToPath} from 'node:url';
import {encodeCell,decodeResult} from '../../src/data/wire.js';
export function oledbHost(profile,{platform=process.platform,env=process.env,arch=process.arch}={}){
 assertData(platform==='win32','OLE DB requires Windows and an installed matching provider',3706);
 if(profile.powershell)return String(profile.powershell); // Explicit trusted server-only override.
 const architecture=profile.architecture||'native';assertData(['native','x86','x64'].includes(architecture),'Choose native, x86 or x64 OLE DB architecture',5);
 const root=env.SystemRoot||env.WINDIR;assertData(root&&path.win32.isAbsolute(root),'Windows system directory is unavailable',3706);
 const folder=architecture==='x86'?(arch==='ia32'&&!env.PROCESSOR_ARCHITEW6432?'System32':'SysWOW64'):architecture==='x64'&&arch==='ia32'?'Sysnative':'System32';
 return path.win32.join(root,folder,'WindowsPowerShell','v1.0','powershell.exe');
}
/** One isolated ADO COM connection per gateway session. No SQL is evaluated as PowerShell. */
export async function createOLEDBDriver(profile){
 if(process.platform!=='win32')throw new Error('OLE DB requires Windows and an installed matching provider');
 const worker=fileURLToPath(new URL('./oledb-worker.ps1',import.meta.url)),child=spawn(oledbHost(profile),['-NoLogo','-NoProfile','-NonInteractive','-File',worker],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let pending=null,closed=false,info;const lines=createInterface({input:child.stdout});
 function fail(error){if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}}
 child.on('error',fail);child.on('exit',()=>{closed=true;fail(new Error('OLE DB worker stopped'));});child.stderr.on('data',()=>{});
 lines.on('line',line=>{if(!pending)return;const call=pending;pending=null;clearTimeout(call.timer);try{const result=JSON.parse(line);if(result.error)throw Object.assign(new Error('OLE DB operation failed'),{number:Number(result.number)||3001});call.resolve(result);}catch(error){call.reject(error);}});
 const call=message=>new Promise((resolve,reject)=>{
   if(closed||pending){reject(new Error('OLE DB worker is closed or busy'));return;}
   const timer=setTimeout(()=>{fail(new Error('OLE DB operation timed out'));child.kill();},(profile.timeout||30000)+5000);pending={resolve,reject,timer};child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error)fail(error);});
 });
 try{info=await call({operation:'open',connectionString:profile.options.connectionString,timeout:Math.ceil((profile.timeout||30000)/1000)});assertData(profile.architecture!=='x86'||info.bits===32,'OLE DB worker bitness mismatch',3706);assertData(profile.architecture!=='x64'||info.bits===64,'OLE DB worker bitness mismatch',3706);}catch(error){child.kill();throw error;}
 return {info,async execute(text,parameters=[]){return decodeResult(await call({operation:'execute',text,parameters:parameters.map(encodeCell)}));},async schema(kind){return decodeResult(await call({operation:'schema',kind}));},begin:()=>call({operation:'begin'}),commit:()=>call({operation:'commit'}),rollback:()=>call({operation:'rollback'}),async close(){try{if(!closed)await call({operation:'close'});}finally{child.kill();lines.close();}}};
}
