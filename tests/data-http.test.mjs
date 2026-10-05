import test from 'node:test';import assert from 'node:assert/strict';
import {DataContext} from '../src/data/context.js';import {ConnectedRecordset} from '../src/data/connected-recordset.js';
import {createExampleServer} from '../tools/data-example-server.mjs';
const profile=(url,extra={})=>({name:'Service',provider:'rest',url,rowsPath:'items',keyField:'id',etagField:'etag',requireETag:true,pagination:{mode:'next',nextPath:'next'},fields:[{name:'id',type:3},{name:'name',type:202},{name:'email',type:202},{name:'active',type:11}],...extra});
async function open(t,definition,options={}){const context=new DataContext({dataSources:{version:1,connections:[definition],commands:[]} },options);t.after(()=>context.close());const cn=context.connection();await cn.Open('Service');return {context,cn};}
async function fixture(t){const {server,records}=createExampleServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));return {base:'http://127.0.0.1:'+server.address().port,records};}
const fail=n=>e=>e.number===n;
test('REST page reading, typed fields, CRUD writeback, item ETags, null responses',async t=>{
 const {base,records}=await fixture(t);const {context,cn}=await open(t,profile(base+'/customers',{pagination:{mode:'page',size:2,hasMorePath:'hasMore'},write:{insert:{url:'/customers'},update:{url:'/customers/{id}'},delete:{url:'/customers/{id}'}}}));
 const rs=new ConnectedRecordset(context);await rs.Open('',cn,3,3);assert.equal(rs.RecordCount,3);assert.equal(rs.Item('active'),-1);
 rs.Fields.Item('name').Value='Edited';rs.Fields.Item('email').Value=null;rs.Fields.Item('active').Value=0;await rs.Update();assert.equal(records.get(1).name,'Edited');assert.equal(records.get(1).email,null);assert.equal(records.get(1).active,false);assert.equal(rs.Item('email'),null);
 await rs.AddNew(['name','active'],['New customer',-1]);assert.equal(rs.Item('id'),4);assert.equal(records.get(4).active,true);await rs.Delete();assert.equal(records.has(4),false);
 await rs.MoveFirst();records.get(1).revision++;rs.Fields.Item('name').Value='Stale';await assert.rejects(async()=>await rs.Update(),fail(3197));assert.equal(rs.EditMode,1);rs.CancelUpdate();await rs.Requery();assert.equal(rs.Item('name'),'Edited');
});
test('OData next links and GraphQL variable requests use real HTTP',async t=>{
 const {base}=await fixture(t);let data=await open(t,profile(base+'/odata/Customers',{provider:'odata',rowsPath:'value',pagination:undefined}));assert.equal((await data.cn.Execute('')).RecordCount,3);
 data=await open(t,profile(base+'/graphql',{provider:'graphql',rowsPath:'data.customers'}));const cmd=data.context.command();cmd.ActiveConnection=data.cn;cmd.CommandText='query($active: Boolean) { customers(active:$active) { id name email active } }';cmd.Parameters.Append(cmd.CreateParameter('active',11,1,0,0));assert.equal((await cmd.Execute()).RecordCount,1);
 cmd.CommandText='{ missing }';await assert.rejects(()=>cmd.Execute(),fail(3001));
});
test('REST credentials remain runtime-only; requests never follow credential-bearing redirects',async t=>{
 let request;const definition=profile('https://api.example.test/items',{credentialRef:'session'});const {context,cn}=await open(t,definition,{credentialProvider:()=> 'runtime-secret',fetch:async(url,options)=>{request={url,options};return new Response(JSON.stringify({items:[{id:1,name:'Hello'}]}),{headers:{'Content-Type':'application/json'}});}});
 assert.equal((await cn.Execute('')).Item('name'),'Hello');assert.equal(request.options.headers.get('Authorization'),'Bearer runtime-secret');assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'omit');assert.ok(!JSON.stringify(context.config).includes('runtime-secret'));await context.close();assert.equal(context.credentials.size,0);
});
test('parameterized REST URLs encode keys rather than interpolating query syntax',async t=>{
 let actual;const {context,cn}=await open(t,profile('https://api.example.test/items'),{fetch:async(url)=>{actual=url;return new Response('{"items":[]}');}});const cmd=context.command();cmd.ActiveConnection=cn;cmd.CommandText='/items/{key}';cmd.Parameters.Append(cmd.CreateParameter('key',202,1,0,'a/b?admin=true'));cmd.Parameters.Append(cmd.CreateParameter('q',202,1,0,'x&admin=true'));await cmd.Execute();const url=new URL(actual);assert.equal(url.pathname,'/items/a%2Fb%3Fadmin%3Dtrue');assert.equal(url.searchParams.get('q'),'x&admin=true');assert.equal(url.searchParams.get('admin'),null);
});
for(const [name,body,number] of [['cross-origin paging',{items:[],next:'https://evil.test/data'},70],['cyclic paging',{items:[],next:'https://api.example.test/items'},3001],['invalid record shape',{items:[1]},13]])test('REST rejects '+name,async t=>{
 const {cn}=await open(t,profile('https://api.example.test/items'),{fetch:async()=>new Response(JSON.stringify(body))});await assert.rejects(()=>cn.Execute(''),fail(number));
});
test('REST response limits and JSON parsing fail without accepting partial rows',async t=>{
 for(const response of [()=>new Response('{"items":[]}',{headers:{'Content-Length':'99999999'}}),()=>new Response('not-json')]){const {cn}=await open(t,profile('https://api.example.test/items'),{fetch:async()=>response()});await assert.rejects(()=>cn.Execute(''));}
});
test('Cancel interrupts the fetch and leaves a usable connection; Close cancels active I/O',async t=>{
 let started;const ready=new Promise(resolve=>started=resolve);const {cn}=await open(t,profile('https://api.example.test/items'),{fetch:async(url,{signal})=>new Promise((resolve,reject)=>{started();signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});})});
 const work=cn.Execute('');await ready;cn.Cancel();await assert.rejects(()=>work,fail(-2147467260));assert.equal(cn.State,1);const next=cn.Execute('');await new Promise(r=>setTimeout(r,1));await cn.Close();await assert.rejects(()=>next,fail(-2147467260));assert.equal(cn.State,0);
});
test('unsupported transactions and insecure URL schemes fail explicitly',async t=>{
 const {cn}=await open(t,profile('https://api.example.test/items'),{fetch:async()=>new Response('{"items":[]}')});await assert.rejects(()=>cn.BeginTrans(),fail(3251));await assert.rejects(()=>cn.Execute('http://elsewhere.test/items'),fail(70));
 await assert.rejects(()=>open(t,profile('file:///etc/passwd')),fail(70));
});
