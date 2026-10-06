import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {createNativeDebuggerBridge} from '../packages/native-debugger/src/bridge.mjs';
import {CdbSession,findCdb} from '../packages/native-debugger/src/cdb-session.mjs';
const args=process.argv.slice(2),origins=[];let port=8767;
for(let i=0;i<args.length;i++){
  if(args[i]==='--origin'&&args[i+1])origins.push(args[++i]);
  else if(args[i]==='--port'&&args[i+1])port=Number(args[++i]);
  else if(args[i]==='--allow-file-origin')origins.push('null');
  else throw new Error('Usage: node tools/native-debugger.mjs --origin https://your-ide-origin [--port 8767] [--allow-file-origin]');
}
if(!stdin.isTTY)throw new Error('Run the native debugger bridge in an interactive terminal: every attach or launch requires local approval.');
const cdbPath=await findCdb(),terminal=createInterface({input:stdin,output:stdout});let approvals=Promise.resolve();
const bridge=await createNativeDebuggerBridge({port,origins,createSession:()=>new CdbSession({cdbPath}),authorize:(request,{signal}={})=>{
  const result=approvals.then(async()=>{
    const target=request.pid?'PID '+request.pid:request.executable+' '+JSON.stringify(request.args);
    console.log('\nThe IDE requests '+request.operation+' of '+target+(request.debugChildren?' and its child processes':'')+'. Debugging can read and modify this process. Detaching leaves it running.');
    try{return (await terminal.question('Type YES to approve this target: ',{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)})).trim()==='YES';}catch{return false;}
  });approvals=result.catch(()=>false);return result;
}});
console.log('Native debugger: '+bridge.url+'\nToken (memory only): '+bridge.token+'\nAllowed browser origins: '+(origins.join(', ')||'(none)')+'\nCDB: '+cdbPath);
let closing=false;const close=async()=>{if(closing)return;closing=true;terminal.close();await bridge.close();};
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());terminal.on('close',()=>void close());
