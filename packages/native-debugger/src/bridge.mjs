import http from 'node:http';
import path from 'node:path';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {CdbSession, listWindowsProcesses} from './cdb-session.mjs';
import {NativeDebugError, integer} from './protocol.mjs';

function originValue(value) {
  if (value === 'null') return value;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) throw new Error('Configure exact HTTP(S) origins, without paths');
  return value;
}
function equal(a, b) { const x=Buffer.from(a), y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y); }
async function body(request) {
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>1048576)throw new NativeDebugError('Request exceeds 1 MiB','REQUEST_LIMIT');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new NativeDebugError('Invalid JSON','INVALID_JSON');}
}
/** Loopback only, in-memory bearer token, exact origins, and per-target consent.
 * Application/project code never receives the token or the native transport. */
export async function createNativeDebuggerBridge({port=8767,token=randomBytes(32).toString('hex'),origins=[],authorize=async()=>false,createSession=()=>new CdbSession(),listProcesses=listWindowsProcesses,leaseMilliseconds=120000}={}){
  integer(port,'port',0,65535);integer(leaseMilliseconds,'lease time',1000,3600000);
  if(typeof token!=='string'||token.length<32||token.length>512)throw new Error('Use a random token of at least 32 characters');
  const allowed=new Set(origins.map(originValue)),sessions=new Map(),starting=new Set(),shutdown=new AbortController();let opening=0,closing=false,closePromise;
  function record(id){const entry=sessions.get(id);if(!entry)throw new NativeDebugError('Unknown native debugger session','UNKNOWN_SESSION');entry.lastAccess=Date.now();return entry;}
  async function detach(id){const entry=record(id);if(entry.detaching)return entry.detaching;entry.detaching=(async()=>{try{return await entry.session.request('detach');}finally{sessions.delete(id);await entry.session.abort();}})();return entry.detaching;}
  async function invoke(method,params={},signal){
    if(closing)throw new NativeDebugError('Native debugger bridge is closing','CLOSED');
    if(typeof method!=='string'||!params||typeof params!=='object'||Array.isArray(params))throw new NativeDebugError('Invalid request','INVALID_ARGUMENT');
    if(method==='capabilities')return {version:1,engine:'CDB',platform:process.platform,targets:['native-machine-code','pcode-host-machine-code'],sourceRequiresSymbols:true,interpreterFrames:false,leaseMilliseconds};
    if(method==='listProcesses')return {processes:await listProcesses()};
    if(method==='sessions')return {sessions:[...sessions].map(([id,e])=>({id,...e.session.snapshot()}))};
    if(method==='attach'||method==='launch'){
      if(sessions.size+opening>=4)throw new NativeDebugError('At most four native sessions are supported','SESSION_LIMIT');
      // Validate all authorization-visible fields before presenting the request.
      const options=method==='attach'?{pid:integer(params.pid,'process ID',1)}:{executable:params.executable,args:params.args??[]};
      if(method==='launch'&&(typeof options.executable!=='string'||!path.win32.isAbsolute(options.executable)||!/\.exe$/i.test(options.executable)||options.executable.length>32768||/[\0\r\n]/.test(options.executable)))throw new NativeDebugError('Invalid executable','INVALID_ARGUMENT');
      if(!Array.isArray(options.args??[])||(options.args??[]).some(s=>typeof s!=='string'||s.length>8192||/[\0\r\n]/.test(s))||(options.args??[]).length>128)throw new NativeDebugError('Invalid arguments','INVALID_ARGUMENT');
      if(params.debugChildren!==undefined&&typeof params.debugChildren!=='boolean')throw new NativeDebugError('Invalid child-process option','INVALID_ARGUMENT');
      options.debugChildren=params.debugChildren===true;opening++;
      let session;
      try{
        if(await authorize({operation:method,...structuredClone(options)},{signal})!==true)throw new NativeDebugError('Native process debugging was not approved','CONSENT_DENIED');
        if(closing||signal?.aborted)throw new NativeDebugError('Debugging request was cancelled','CANCELLED');
        session=createSession();starting.add(session);const id=randomBytes(16).toString('hex'),entry={session,events:[],sequence:0,lastAccess:Date.now()};
        for(const type of ['state','paused','output','failure','closed'])session.on(type,data=>{entry.events.push({sequence:++entry.sequence,type,data:type==='output'?{text:String(data.text).slice(0,8192)}:data});if(entry.events.length>256)entry.events.shift();});
        await session.start(options);if(closing||signal?.aborted)throw new NativeDebugError('Debugging request was cancelled','CANCELLED');entry.lastAccess=Date.now();sessions.set(id,entry);return {id,...session.snapshot()};
      }catch(error){await session?.abort();throw error;}finally{starting.delete(session);opening--;}
    }
    const entry=record(params.session);
    if(method==='events'){
      const after=integer(params.after??0,'event cursor',0,Number.MAX_SAFE_INTEGER),events=entry.events.filter(e=>e.sequence>after).slice(0,128);
      return {events,cursor:events.at(-1)?.sequence??after,dropped:entry.events.length>0&&after<entry.events[0].sequence-1,status:entry.session.snapshot()};
    }
    if(method==='detach')return detach(params.session);
    if(['continue','continueHandled','continueUnhandled','stepInto','stepOver','stepOut','selectThread','selectProcess','allProcessStacks','stepMode','symbolPath','writeMemory','setRegister','setBreakpoint','setDataBreakpoint','removeBreakpoint','enableBreakpoint','runToAddress','exceptionPolicy'].includes(method))integer(params.pauseId,'pause ID',1);
    const {session:_,...args}=params;
    return entry.session.request(method,args);
  }
  const server=http.createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Type','application/json; charset=utf-8');
    const origin=request.headers.origin,host=request.headers.host;
    const respond=(status,data)=>{if(response.destroyed||response.writableEnded)return;response.writeHead(status);response.end(JSON.stringify(data));};
    if(host!=='127.0.0.1:'+server.address()?.port){respond(403,{error:{code:'HOST_DENIED',message:'Loopback Host required'}});return;}
    if(origin!==undefined&&!allowed.has(origin)){respond(403,{error:{code:'ORIGIN_DENIED',message:'Origin is not approved'}});return;}
    if(origin!==undefined){response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');}
    if(request.url!=='/debugger'){respond(404,{error:{message:'Not found'}});return;}
    if(request.method==='OPTIONS'){
      const headers=String(request.headers['access-control-request-headers']||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
      if(!origin||!allowed.has(origin)||request.headers['access-control-request-method']!=='POST'||headers.some(h=>!['authorization','content-type'].includes(h))){respond(403,{error:{message:'Preflight denied'}});return;}
      response.setHeader('Access-Control-Allow-Methods','POST');response.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');response.setHeader('Access-Control-Allow-Private-Network','true');response.writeHead(204);response.end();return;
    }
    if(request.method!=='POST'){respond(405,{error:{message:'POST required'}});return;}
    if(!equal(String(request.headers.authorization||''),'Bearer '+token)){respond(401,{error:{code:'UNAUTHORIZED',message:'Invalid debugger token'}});return;}
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||'')){respond(415,{error:{message:'application/json required'}});return;}
    const cancelled=new AbortController();request.once('aborted',()=>cancelled.abort());response.once('close',()=>{if(!response.writableEnded)cancelled.abort();});
    try{const value=await body(request);if(!value||typeof value!=='object'||Array.isArray(value))throw new NativeDebugError('Invalid request','INVALID_ARGUMENT');const result=await invoke(value.method,value.params,AbortSignal.any([cancelled.signal,shutdown.signal]));respond(200,{result});}
    catch(error){respond(error.code==='CONSENT_DENIED'?403:400,{error:{message:error.message,code:error.code||'DEBUGGER_ERROR'}});}
  });
  server.requestTimeout=30000;server.headersTimeout=10000;server.maxRequestsPerSocket=1000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const lease=setInterval(()=>{for(const [id,entry]of sessions)if(Date.now()-entry.lastAccess>leaseMilliseconds){entry.lastAccess=Date.now();void detach(id).catch(()=>{});}},Math.min(10000,leaseMilliseconds));lease.unref();
  return {server,token,url:'http://127.0.0.1:'+server.address().port+'/debugger',close(){
    if(closePromise)return closePromise;
    closing=true;shutdown.abort();clearInterval(lease);
    closePromise=(async()=>{
      await Promise.all([...sessions.keys()].map(id=>detach(id).catch(()=>{})).concat([...starting].map(s=>s.abort().catch(()=>{}))));
      await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    })();return closePromise;
  }};
}
