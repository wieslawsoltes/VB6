import test from 'node:test';
import assert from 'node:assert/strict';
import {DataContext} from '../src/data/context.js';
import {ConnectedRecordset} from '../src/data/connected-recordset.js';
import {VirtualFileSystem} from '../src/runtime/filesystem.js';
import {parseConnectionString,normalizeDataSources,assertPublicConfiguration,resultFromRows} from '../src/data/common.js';
import {parseCSV,writeCSV} from '../src/data/files.js';
const config=(connections,commands=[])=>({dataSources:{version:1,connections,commands}});
async function db(t,database=':memory:',options={}){const context=new DataContext({},options);t.after(()=>context.close());const cn=context.connection();await cn.Open({provider:'sqlite',database});return {context,cn};}
async function setup(cn){await cn.Execute('CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN DEFAULT 1)');await cn.Execute("INSERT INTO customers(name) VALUES('Alice')");}
const number=n=>e=>e.number===n;

test('ADO connection strings preserve quoted and braced separators',()=>{
 const values=parseConnectionString(' Provider = SQLite;Data Source="/semi;colon.db"; X={a}}b;c}; Y=\'a\'\'b\';');
 assert.equal(values.provider,'SQLite');assert.equal(values['data source'],'/semi;colon.db');assert.equal(values.x,'a}b;c');assert.equal(values.y,"a'b");
 for(const value of ['Provider=SQLite;provider=REST','broken','X="unterminated','X={unterminated','X="done"bad'])assert.throws(()=>parseConnectionString(value));
});
test('configuration rejects secrets, prototype paths and Data Environment name collisions',()=>{
 for(const key of ['password','Authorization','X-API-Key','access_token','Proxy-Authorization'])assert.throws(()=>assertPublicConfiguration({headers:{[key]:'secret'}}),number(70));
 assert.throws(()=>assertPublicConfiguration({url:'https://host/data?api_key=secret'}),number(70));
 assert.throws(()=>assertPublicConfiguration({url:'https://user:password@host/data'}),number(70));
 for(const name of ['Connections','constructor','SetCredential'])assert.throws(()=>normalizeDataSources(config([{name,provider:'sqlite'}]).dataSources));
 assert.throws(()=>normalizeDataSources(config([{name:'Database',provider:'sqlite'},{name:'rsCustomers',provider:'sqlite'}],[{name:'Customers',connection:'Database'}]).dataSources));
 assert.throws(()=>normalizeDataSources(config([{name:'Data',provider:'rest',fields:[{name:'x',path:'__proto__.x'}]}]).dataSources));
});
test('real SQLite prepared statements retain null, binary and exact large integers',async t=>{
 const {context,cn}=await db(t);await cn.Execute('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, payload BLOB, value TEXT)');
 const cmd=context.command();cmd.ActiveConnection=cn;cmd.CommandText='INSERT INTO t(name,payload,value) VALUES(?,?,?)';
 cmd.Parameters.Append(cmd.CreateParameter('name',202,1,50,"O'Reilly; DROP TABLE t"));cmd.Parameters.Append(cmd.CreateParameter('payload',204,1,16,new Uint8Array([0,255,4])));cmd.Parameters.Append(cmd.CreateParameter('value',202,1,0,null));
 const action=await cmd.Execute();assert.equal(action.State,0);assert.equal(action.RowsAffected,1);
 const rs=await cn.Execute('SELECT * FROM t');assert.equal(rs.Item('name'),"O'Reilly; DROP TABLE t");assert.deepEqual(rs.Item('payload'),new Uint8Array([0,255,4]));assert.equal(rs.Item('value'),null);
 assert.equal((await cn.Execute('SELECT 9223372036854775807 AS big')).Item('big'),'9223372036854775807');
 cmd.Parameters.Item(0).Size=3;await assert.rejects(()=>cmd.Execute(),number(372));
});
test('SQLite real SQL joins, aggregates, schema and empty SELECTs',async t=>{
 const {cn}=await db(t);await setup(cn);await cn.Execute('CREATE TABLE orders(customer INTEGER, amount NUMERIC)');await cn.Execute('INSERT INTO orders VALUES(1,20),(1,30)');
 assert.equal((await cn.Execute('SELECT c.name, SUM(o.amount) AS total FROM customers c JOIN orders o ON o.customer=c.id GROUP BY c.id')).Item('total'),50);
 const empty=await cn.Execute('SELECT id,name FROM customers WHERE 0');assert.equal(empty.State,1);assert.equal(empty.EOF,-1);assert.equal(empty.Fields.Count,2);
 assert.equal((await cn.OpenSchema(20)).RecordCount,2);assert.ok((await cn.OpenSchema(4)).RecordCount>=5);
});
test('parameterized execution rejects multiple commands before executing any',async t=>{
 const {cn}=await db(t);await assert.rejects(()=>cn.Execute('CREATE TABLE forbidden(n); INSERT INTO forbidden VALUES(1)'));
 assert.equal((await cn.Execute("SELECT count(*) AS n FROM sqlite_master WHERE name='forbidden'")).Item('n'),0);
 for(const sql of ['/* hidden */ BEGIN','-- comment\nATTACH DATABASE \'x\' AS x','PRAGMA "journal_mode"=WAL','PRAGMA main.journal_mode(WAL)'])await assert.rejects(()=>cn.Execute(sql),number(3251));
});
test('SQLite keyed table CRUD, optimistic conflicts and failed edit cancellation',async t=>{
 const {cn,context}=await db(t);await setup(cn);const rs=new ConnectedRecordset(context);await rs.Open('customers',cn,3,3,2);
 rs.Fields.Item('name').Value='Bob';await rs.Update();assert.equal((await cn.Execute('SELECT name FROM customers')).Item('name'),'Bob');
 await rs.AddNew(['name'],['Carol']);assert.equal(rs.Item('id'),2);assert.equal(rs.Item('active'),1);
 await rs.MoveFirst();await cn.Execute("UPDATE customers SET name='external' WHERE id=1");rs.Fields.Item('name').Value='stale';await assert.rejects(async()=>await rs.Update(),number(3197));assert.equal(rs.EditMode,1);rs.CancelUpdate();await rs.Requery();assert.equal(rs.Item('name'),'external');
 await rs.MoveLast();await rs.Delete();assert.equal((await cn.Execute('SELECT count(*) AS n FROM customers')).Item('n'),1);
});
test('SQLite persistent snapshots do not reset last insert id or temporary tables',async t=>{
 const fs=new VirtualFileSystem();const {context,cn}=await db(t,'/app.sqlite',{fs});await setup(cn);
 await cn.Execute('CREATE TEMP TABLE scratch(value INTEGER)');await cn.Execute('INSERT INTO scratch VALUES(42)');
 assert.equal((await cn.Execute('SELECT value FROM scratch')).Item('value'),42);assert.equal((await cn.Execute('SELECT last_insert_rowid() AS id')).Item('id'),1);
 const bytes=fs.readBytes('/app.sqlite');assert.equal(new TextDecoder().decode(bytes.slice(0,16)),'SQLite format 3\0');
 await context.close();const reload=await db(t,'/app.sqlite',{fs:new VirtualFileSystem(fs.snapshot())});assert.equal((await reload.cn.Execute('SELECT name FROM customers')).Item('name'),'Alice');
});
test('nested transactions, shared connection isolation, commit, rollback and close',async t=>{
 const {context,cn}=await db(t,'/shared.sqlite');await setup(cn);const other=context.connection();await other.Open('Provider=SQLite;Data Source=/shared.sqlite');
 assert.equal(await cn.BeginTrans(),1);await cn.Execute("UPDATE customers SET name='pending'");assert.equal(await cn.BeginTrans(),2);await cn.Execute("UPDATE customers SET name='nested'");await cn.CommitTrans();
 await assert.rejects(()=>other.Execute('SELECT * FROM customers'),number(3197));await cn.RollbackTrans();assert.equal((await other.Execute('SELECT name FROM customers')).Item('name'),'Alice');
 await cn.BeginTrans();await cn.Execute("UPDATE customers SET name='saved'");await cn.CommitTrans();assert.equal((await other.Execute('SELECT name FROM customers')).Item('name'),'saved');
 await cn.BeginTrans();await cn.Execute("UPDATE customers SET name='unsaved'");await cn.Close();assert.equal((await other.Execute('SELECT name FROM customers')).Item('name'),'saved');
});
test('read-only connection and recordset policies fail explicitly',async t=>{
 const {context,cn}=await db(t,'/read.sqlite');await setup(cn);const ro=context.connection();ro.Mode=1;await ro.Open('Provider=SQLite;Data Source=/read.sqlite');
 await assert.rejects(()=>ro.Execute('DELETE FROM customers'));await assert.rejects(()=>ro.BeginTrans(),number(3251));
 const rs=await cn.Execute('SELECT * FROM customers');assert.throws(()=>rs.Fields.Item('name').Value='no',number(3251));
 await assert.rejects(()=>context.connection().Open('Provider=Microsoft.Jet.OLEDB.4.0;Data Source=legacy.mdb'),number(3706));
 await assert.rejects(()=>context.createObject('DAO.DBEngine.36').OpenDatabase('legacy.mdb'),number(3706));
});
test('DAO database convenience executes SQL and opens keyed SQLite recordsets',async t=>{
 const context=new DataContext();t.after(()=>context.close());const database=await context.createObject('DAO.DBEngine.36').OpenDatabase('/dao.sqlite');
 await database.Execute('CREATE TABLE t(id INTEGER PRIMARY KEY,name TEXT)');await database.Execute("INSERT INTO t VALUES(1,'DAO')");assert.equal(database.RecordsAffected,1);
 const rs=await database.OpenRecordset('t');assert.equal(rs.Item('name'),'DAO');rs.Fields.Item('name').Value='updated';await rs.Update();await database.Close();assert.equal(rs.State,0);
});
test('Data Environment preserves recordset identity for declarative bindings',async t=>{
 const context=new DataContext(config([{name:'Local',provider:'sqlite'}],[{name:'Customers',connection:'Local',text:'SELECT ? AS value',parameters:[{name:'value',type:3,value:2}]}]));t.after(()=>context.close());
 const env=context.environment(),bound=env.rsCustomers;let changes=0;bound.subscribe(()=>changes++);
 assert.equal(await env.Customers(7),bound);assert.equal(bound.Item('value'),7);assert.equal(await env.Customers(9),bound);assert.equal(bound.Item('value'),9);assert.ok(changes>=2);
});
test('CSV strict parsing, quoting, typed file writeback and JSON nested mappings',async t=>{
 const text='id,name\r\n1,"Line, one"\r\n2,"Line\nTwo"\r\n';const rows=parseCSV(text);assert.equal(rows[1].name,'Line\nTwo');assert.deepEqual(parseCSV(writeCSV(rows)),rows);
 for(const value of ['id,id\n1,2','id,name\n1','id\n"bad"junk','id\n"open'])assert.throws(()=>parseCSV(value));
 const fs=new VirtualFileSystem();fs.write('/x.csv',text);fs.write('/x.json',JSON.stringify([{id:1,profile:{name:'Nested'},hidden:42}]));
 const context=new DataContext(config([{name:'CSV',provider:'csv',database:'/x.csv',keyField:'id',fields:[{name:'id',type:3},{name:'name',type:202}]},{name:'JSON',provider:'json',database:'/x.json',keyField:'id',fields:[{name:'id',type:3},{name:'name',path:'profile.name',type:202}]}]),{fs});t.after(()=>context.close());
 for(const name of ['CSV','JSON']){const cn=context.connection();await cn.Open(name);const rs=new ConnectedRecordset(context);await rs.Open('',cn,3,3);rs.Fields.Item('name').Value='Changed';await rs.Update();await rs.Requery();assert.equal(rs.Item('name'),'Changed');}
 assert.equal(JSON.parse(fs.read('/x.json'))[0].hidden,42);assert.equal(JSON.parse(fs.read('/x.json'))[0].profile.name,'Changed');
});
test('allocation limits reject excessive schema and rows before cursor creation',()=>{
 assert.throws(()=>resultFromRows([Object.fromEntries(Array.from({length:1025},(_,i)=>['f'+i,i]))]),number(7));
 const rs=new ConnectedRecordset(new DataContext());assert.throws(()=>rs.load({columns:[{Name:'a'},{Name:'A'}],values:[]}),number(3191));
});
test('blur/save/reposition overlap joins one asynchronous update without sending duplicate writes',async()=>{
 const context=new DataContext(),rs=new ConnectedRecordset(context);let release,writes=0;
 rs.load({columns:[{Name:'id',Type:3},{Name:'name',Type:202}],values:[[1,'Before'],[2,'Second']],write:()=>{writes++;return new Promise(resolve=>{release=resolve;});}},3);
 rs.Fields.Item('name').Value='Saved';const first=rs.Update(),second=rs.Update(),move=rs.MoveNext();assert.equal(first,second);assert.equal(writes,1);release();await Promise.all([first,second,move]);assert.equal(rs.Item('name'),'Second');assert.equal(rs.rows[0].name,'Saved');assert.equal(rs.EditMode,0);await context.close();
});
