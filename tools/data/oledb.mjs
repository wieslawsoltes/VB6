import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {fileURLToPath} from 'node:url';
import {encodeCell,decodeResult} from '../../src/data/wire.js';
/** One isolated ADO COM connection per gateway session. No SQL is evaluated as PowerShell. */
export async function createOLEDBDriver(profile){
 if(process.platform!=='win32')throw new Error('OLE DB requires Windows and an installed matching provider');
 const worker=fileURLToPath(new URL('./oledb-worker.ps1',import.meta.url)),child=spawn(profile.powershell||'powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',worker],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let pending=null,closed=false;const lines=createInterface({input:child.stdout});
 function fail(error){if(pending){clearTimeout(pending.timer);pending.reject(error);pending=null;}}
 child.on('error',fail);child.on('exit',()=>{closed=true;fail(new Error('OLE DB worker stopped'));});child.stderr.on('data',()=>{});
 lines.on('line',line=>{if(!pending)return;const call=pending;pending=null;clearTimeout(call.timer);try{const result=JSON.parse(line);if(result.error)throw Object.assign(new Error('OLE DB operation failed'),{number:Number(result.number)||3001});call.resolve(result);}catch(error){call.reject(error);}});
 const call=message=>new Promise((resolve,reject)=>{
   if(closed||pending){reject(new Error('OLE DB worker is closed or busy'));return;}
   const timer=setTimeout(()=>{fail(new Error('OLE DB operation timed out'));child.kill();},(profile.timeout||30000)+5000);pending={resolve,reject,timer};child.stdin.write(JSON.stringify(message)+'\n',error=>{if(error)fail(error);});
 });
 try{await call({operation:'open',connectionString:profile.options.connectionString,timeout:Math.ceil((profile.timeout||30000)/1000)});}catch(error){child.kill();throw error;}
 return {async execute(text,parameters=[]){return decodeResult(await call({operation:'execute',text,parameters:parameters.map(encodeCell)}));},async schema(kind){return decodeResult(await call({operation:'schema',kind}));},begin:()=>call({operation:'begin'}),commit:()=>call({operation:'commit'}),rollback:()=>call({operation:'rollback'}),async close(){try{if(!closed)await call({operation:'close'});}finally{child.kill();lines.close();}}};
}
