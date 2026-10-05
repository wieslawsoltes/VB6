/** Authenticated, server-owned named profiles. Never accepts connection strings or credentials from clients. */
import http from 'node:http';import fs from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {randomBytes,timingSafeEqual} from 'node:crypto';
import {createNativeDriver} from './data/drivers.mjs';
import {assertData,DATA_LIMITS} from '../src/data/common.js';
import {encodeResult,decodeCell} from '../src/data/wire.js';
function matches(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function createDataGateway({profiles,token,origins=[],ttlMs=60000,maxSessions=32,maxConcurrent=16,driverFactory=createNativeDriver}={}){
 assertData(typeof token==='string'&&Buffer.byteLength(token)>=32,'A gateway bearer token of at least 32 bytes is required');
 assertData(profiles&&typeof profiles==='object'&&!Array.isArray(profiles),'Named server-side profiles are required');
 assertData(Array.isArray(origins)&&!origins.includes('*'),'Use an explicit origin allowlist');
 const sessions=new Map(),resources=new Map();let active=0,stopping=false;
 const resourceKey=(name,p)=>p.driver==='sqlite'?'sqlite:'+path.resolve(p.filename):null;
 async function release(id,rollback=true){const session=sessions.get(id);if(!session)return;sessions.delete(id);try{if(rollback)await session.driver.rollback();}catch{}finally{try{await session.driver.close();}catch{}if(session.key&&resources.get(session.key)===id)resources.delete(session.key);}}
 const reap=setInterval(()=>{for(const [id,session]of sessions)if(!session.busy&&Date.now()-session.used>ttlMs)void release(id);},Math.max(10,Math.min(ttlMs,5000)));reap.unref();
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin,host=String(req.headers.host||'').split(':')[0];
  const send=(status,value)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  if(stopping){send(503,{error:'Gateway is stopping'});return;}
  // Loopback host allowlist blocks DNS-rebinding names even when no Origin is present.
  if(!['127.0.0.1','localhost'].includes(host)){send(403,{error:'Host is not allowed'});return;}
  if(origin&&!origins.includes(origin)){send(403,{error:'Origin is not allowed'});return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');
  if(req.method==='OPTIONS'){send(204,{});return;}
  if(!matches(String(req.headers.authorization||''),'Bearer '+token)){send(401,{error:'Authentication required'});return;}
  if(req.method!=='POST'||req.url!=='/data'||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||'')){send(400,{error:'POST JSON to /data'});return;}
  if(active>=maxConcurrent){send(429,{error:'Gateway is busy'});return;}active++;
  let driver=null,temporary=false,session=null,resource=null,lock=null;
  try{
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;assertData(bytes<=1024*1024,'Request exceeds limit',7);chunks.push(chunk);}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));assertData(input&&typeof input==='object'&&!Array.isArray(input),'Invalid request');
   assertData(Object.keys(input).every(key=>['operation','profile','session','text','parameters','kind'].includes(key)),'Unknown request property');
   const name=input.profile;assertData(typeof name==='string'&&Object.hasOwn(profiles,name),'Unknown profile',70);const profile=profiles[name],operation=input.operation;
   assertData(['execute','schema','begin','commit','rollback'].includes(operation),'Unknown operation');assertData(input.session==null||typeof input.session==='string','Invalid session');
   assertData(input.kind==null||[4,20].includes(Number(input.kind)),'Unsupported schema kind',3251);
   if(input.session){session=sessions.get(input.session);assertData(session&&session.profile===name&&session.origin===(origin||''),'Unknown session',70);assertData(!session.busy,'Session is busy',3197);session.busy=true;session.used=Date.now();driver=session.driver;}
   else{
    assertData(!['commit','rollback'].includes(operation),'A transaction session is required',3246);
    assertData(operation!=='begin'||sessions.size<maxSessions,'Session limit reached',7);
    resource=resourceKey(name,profile);lock=Symbol(name);assertData(!resource||!resources.has(resource),'SQLite profile is in use by another operation',3197);if(resource)resources.set(resource,lock);
    driver=await driverFactory(profile);temporary=true;
   }
   let result={};
   if(operation==='execute'){
    assertData(typeof input.text==='string'&&input.text.length<=1000000,'Invalid command');assertData(input.parameters==null||Array.isArray(input.parameters)&&input.parameters.length<=1024,'Invalid parameters');
    const named=profile.commands&&Object.hasOwn(profile.commands,input.text)?profile.commands[input.text]:null;
    assertData(named||profile.allowAdHoc===true,'Only server-allowlisted commands may be executed on this profile',70);
    const text=typeof named==='string'?named:named?.text||input.text;
    if(named?.parameterCount!=null)assertData((input.parameters||[]).length===named.parameterCount,'Parameter count does not match server command');
    const raw=await driver.execute(text,(input.parameters||[]).map(decodeCell));
    assertData(Array.isArray(raw.columns)&&Array.isArray(raw.values)&&raw.columns.length<=1024&&raw.values.length<=DATA_LIMITS.rows&&raw.columns.length*raw.values.length<=DATA_LIMITS.cells,'Result exceeds limits',7);result=encodeResult(raw);
   }else if(operation==='schema')result=encodeResult(await driver.schema(Number(input.kind||20)));
   else if(operation==='begin'){
    assertData(!session,'Nested transactions are not exposed',3251);await driver.begin();const id=randomBytes(24).toString('hex');
    sessions.set(id,{driver,profile:name,origin:origin||'',used:Date.now(),busy:false,key:resource});if(resource)resources.set(resource,id);temporary=false;result={session:id};
   }else{
    if(operation==='commit')await driver.commit();else await driver.rollback();
    await release(input.session,false);session=null;driver=null;
   }
   const serialized=JSON.stringify(result);assertData(Buffer.byteLength(serialized)<=DATA_LIMITS.bytes,'Response exceeds limit',7);
   // Complete cleanup before replying: a caller may issue its next request immediately.
   if(temporary&&driver){await driver.close();driver=null;temporary=false;}
   if(resource&&resources.get(resource)===lock)resources.delete(resource);
   if(session){session.busy=false;session.used=Date.now();session=null;}
   send(200,result);
  }catch(error){
   // Driver messages can include usernames, DSNs and SQL. Never expose them over HTTP.
   send(error.number===70?403:error.number===3197?409:400,{error:'Gateway operation failed',number:Number(error.number)||3001});
  }finally{
   if(temporary&&driver)try{await driver.close();}catch{}
   if(resource&&resources.get(resource)===lock)resources.delete(resource);
   if(session){session.busy=false;session.used=Date.now();}active--;
  }
 });
 server.requestTimeout=35000;server.headersTimeout=10000;
 return {server,sessions,async close(){stopping=true;clearInterval(reap);await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await Promise.all([...sessions.keys()].map(id=>release(id)));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const file=process.argv[2];if(!file)throw new Error('Usage: VB6_DATA_TOKEN=<runtime secret> node tools/data-gateway.mjs <server-profiles.json>');
 const config=JSON.parse(await fs.readFile(file,'utf8'));const gateway=createDataGateway({...config,token:process.env.VB6_DATA_TOKEN});
 gateway.server.listen(Number(config.port||4287),'127.0.0.1',()=>console.log('VB6 data gateway listening on loopback; profiles: '+Object.keys(config.profiles).join(', ')));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void gateway.close());
}
