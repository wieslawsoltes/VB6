import test from 'node:test';import assert from 'node:assert/strict';import os from 'node:os';import fs from 'node:fs/promises';import path from 'node:path';
import {createDataGateway} from '../tools/data-gateway.mjs';import {DataContext} from '../src/data/context.js';import {encodeCell,decodeCell} from '../src/data/wire.js';
const token='test-only-gateway-token-not-a-real-secret';
async function gateway(t,extras={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-gateway-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const instance=createDataGateway({token,profiles:{Local:{driver:'sqlite',filename:path.join(dir,'data.sqlite'),allowAdHoc:true}},origins:['null'],...extras});
 await new Promise(r=>instance.server.listen(0,'127.0.0.1',r));t.after(()=>instance.close());
 const url='http://127.0.0.1:'+instance.server.address().port+'/data';
 const context=new DataContext({dataSources:{version:1,connections:[{name:'Native',provider:'gateway',url,profile:'Local',credentialRef:'Gateway'}],commands:[]}},{credentialProvider:()=>token});t.after(()=>context.close());const cn=context.connection();await cn.Open('Native');
 return {instance,context,cn,url,post:(body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,...headers},body:JSON.stringify(body)})};
}
test('real gateway persists SQLite SQL and transactions with exact BLOB transport',async t=>{
 const {cn,context}=await gateway(t);await cn.Execute('CREATE TABLE t(id INTEGER PRIMARY KEY, value BLOB)');const cmd=context.command();cmd.ActiveConnection=cn;cmd.CommandText='INSERT INTO t VALUES(?,?)';cmd.Parameters.Append(cmd.CreateParameter('id',3,1,0,1));cmd.Parameters.Append(cmd.CreateParameter('blob',204,1,0,new Uint8Array([0,255,42])));await cmd.Execute();assert.deepEqual((await cn.Execute('SELECT value FROM t')).Item('value'),new Uint8Array([0,255,42]));
 await cn.BeginTrans();await cn.Execute('DELETE FROM t');await cn.RollbackTrans();assert.equal((await cn.Execute('SELECT count(*) AS n FROM t')).Item('n'),1);
 await cn.BeginTrans();await cn.Execute('DELETE FROM t');await cn.CommitTrans();assert.equal((await cn.Execute('SELECT count(*) AS n FROM t')).Item('n'),0);assert.equal((await cn.OpenSchema(20)).RecordCount,1);
});
test('gateway rejects missing authentication, bad origins, credential injection and unknown profiles',async t=>{
 const {post}=await gateway(t);const base={profile:'Local',operation:'schema',kind:20};
 assert.equal((await post(base,{Authorization:''})).status,401);assert.equal((await post(base,{Origin:'https://evil.test'})).status,403);assert.equal((await post({...base,connectionString:'Pwd=secret'})).status,400);assert.equal((await post({...base,profile:'unknown'})).status,403);
});
test('gateway default denies ad-hoc SQL and allows server-owned command definitions',async t=>{
 let executed;const driverFactory=async()=>({execute:async(text,params)=>{executed={text,params};return {columns:[{Name:'n',Type:3}],values:[[5]],rowsAffected:0};},close:async()=>{}});
 const {post}=await gateway(t,{driverFactory,profiles:{Local:{driver:'custom',commands:{Find:{text:'SELECT ? AS n',parameterCount:1}}}}});
 assert.equal((await post({profile:'Local',operation:'execute',text:'SELECT secret',parameters:[]})).status,403);
 const response=await post({profile:'Local',operation:'execute',text:'Find',parameters:[5]});assert.equal(response.status,200);assert.deepEqual(executed,{text:'SELECT ? AS n',params:[5]});assert.equal((await post({profile:'Local',operation:'execute',text:'Find',parameters:[]})).status,400);
});
test('context close rolls back a gateway transaction and releases the SQLite resource',async t=>{
 const {context,cn,instance,post}=await gateway(t);await cn.Execute('CREATE TABLE t(n)');await cn.BeginTrans();await cn.Execute('INSERT INTO t VALUES(1)');await context.close();assert.equal(instance.sessions.size,0);
 const response=await post({profile:'Local',operation:'execute',text:'SELECT count(*) AS n FROM t'});assert.equal(response.status,200);assert.equal((await response.json()).values[0][0],0);
});
test('gateway expires idle sessions and refuses cross-origin session reuse',async t=>{
 const {instance,post}=await gateway(t,{ttlMs:25,origins:['null','http://allowed.test']});let response=await post({profile:'Local',operation:'begin'},{Origin:'null'});const {session}=await response.json();assert.ok(session);
 response=await post({profile:'Local',operation:'rollback',session},{Origin:'http://allowed.test'});assert.equal(response.status,403);
 await new Promise(r=>setTimeout(r,90));assert.equal(instance.sessions.size,0);
});
test('wire cells retain binary, dates, and large integer strings',()=>{
 for(const input of [new Uint8Array([0,128,255]),new Date('2026-10-05T00:00:00Z')])assert.deepEqual(decodeCell(encodeCell(input)),input);
 assert.equal(decodeCell(encodeCell(9223372036854775807n)),'9223372036854775807');assert.throws(()=>decodeCell({$vb6:'surprise',value:'bad'}));
});
