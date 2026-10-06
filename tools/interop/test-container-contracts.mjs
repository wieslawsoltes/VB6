/** Windows-only: compile every native host file and run real ole32/oleaut32 contracts. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
const architecture=process.env.VB6_COM_ARCH||'x86';
if(process.platform!=='win32')throw Error('Native container contract validation requires Windows; it has not passed on this host.');
if(!['x86','x64'].includes(architecture))throw Error('VB6_COM_ARCH must be x86 or x64');
const system=architecture==='x86'?'SysWOW64':process.arch==='ia32'?'Sysnative':'System32';
const executable=path.join(process.env.SystemRoot||'C:\\Windows',system,'WindowsPowerShell','v1.0','powershell.exe');
const script=fileURLToPath(new URL('./test-container-contracts.ps1',import.meta.url));
const result=spawnSync(executable,['-NoProfile','-NonInteractive','-STA','-File',script],{encoding:'utf8',timeout:120000,windowsHide:true,maxBuffer:2*1024*1024,shell:false});
let report={architecture,status:'failed',stdout:result.stdout,stderr:result.stderr,error:result.error?.message};
try{if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr||'Native test process failed');report=JSON.parse(result.stdout.trim().replace(/^\uFEFF/,''));if(report.status!=='passed'||report.architecture!==architecture)throw Error('Invalid native test result');}
catch(error){report.status='failed';report.error=error.message;process.exitCode=1;}
await fs.mkdir('reports/native-interop',{recursive:true});await fs.writeFile(`reports/native-interop/container-contracts-${architecture}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
