/** Destructive fixtures ONLY in the disposable CI databases configured here. */
import assert from 'node:assert/strict';
import {createDataGateway} from './data-gateway.mjs';
import {DataContext} from '../src/data/context.js';
const kind=process.argv[2];assert(['pg','mysql','mssql'].includes(kind),'Choose pg, mysql or mssql');
const options=kind==='pg'?{host:'127.0.0.1',port:5432,database:'vb6test',user:'postgres',password:process.env.VB6_PG_PASSWORD}:kind==='mysql'?{host:'127.0.0.1',port:3306,database:'vb6test',user:'root',password:process.env.VB6_MYSQL_PASSWORD}:{server:'127.0.0.1',port:1433,database:'master',user:'sa',password:process.env.VB6_SQL_PASSWORD,options:{encrypt:true,trustServerCertificate:true}};
const token='disposable-ci-gateway-token-not-production';
const gateway=createDataGateway({token,profiles:{fixture:{driver:kind,options,allowAdHoc:true}}});
await new Promise(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));
const context=new DataContext({dataSources:{version:1,connections:[{name:'Database',provider:'gateway',url:`http://127.0.0.1:${gateway.server.address().port}/data`,profile:'fixture',credentialRef:'test'}],commands:[]}}, {credentialProvider:()=>token});
const cn=context.connection();await cn.Open('Database');
try{
 for(let i=0;;i++){try{await cn.query('SELECT 1 AS ready');break;}catch(e){if(i===30)throw e;await new Promise(r=>setTimeout(r,2000));}}
 await cn.query('DROP TABLE IF EXISTS vb6_data_test');
 const binary=kind==='pg'?'BYTEA':kind==='mysql'?'BLOB':'VARBINARY(100)',parameter=i=>kind==='pg'?'$'+i:kind==='mssql'?'@p'+i:'?';
 await cn.query(`CREATE TABLE vb6_data_test(id INTEGER PRIMARY KEY, name ${kind==='mssql'?'NVARCHAR':'VARCHAR'}(100), payload ${binary}, optional_value VARCHAR(100))`);
 const insert=`INSERT INTO vb6_data_test(id,name,payload,optional_value) VALUES(${[1,2,3,4].map(parameter).join(',')})`;
 const value="quotes '; DROP TABLE never; -- π";
 await cn.query(insert,[1,value,new Uint8Array([0,127,255]),null]);
 const rows=await cn.Execute('SELECT * FROM vb6_data_test');assert.equal(rows.RecordCount,1);assert.equal(rows.Item('name'),value);assert.deepEqual([...rows.Item('payload')],[0,127,255]);assert.equal(rows.Item('optional_value'),null);
 await cn.BeginTrans();await cn.query(insert,[2,'rolled back',new Uint8Array([1]),null]);await cn.RollbackTrans();assert.equal(Number((await cn.Execute('SELECT count(*) AS n FROM vb6_data_test')).Item('n')),1);
 await cn.BeginTrans();await cn.query(insert,[2,'committed',new Uint8Array([2]),null]);await cn.CommitTrans();assert.equal(Number((await cn.Execute('SELECT count(*) AS n FROM vb6_data_test')).Item('n')),2);
 const schema=await cn.OpenSchema(20);assert(schema.RecordCount>0);const columns=await cn.OpenSchema(4);assert(columns.RecordCount>=4);
 await cn.BeginTrans();await cn.query(insert,[3,'close rolls back',new Uint8Array([3]),null]);await cn.Close();await cn.Open('Database');assert.equal(Number((await cn.Execute('SELECT count(*) AS n FROM vb6_data_test')).Item('n')),2);
 await assert.rejects(()=>cn.query(insert,[1,'duplicate',new Uint8Array([4]),null]));
 // Actual DAO/RDO clients use canonical question marks, not hand-written per-driver SQL.
 const db=await context.createObject('DAO.DBEngine.36').OpenDatabase('Database');
 const add=db.CreateQueryDef('', 'PARAMETERS pId Long, pName Text(100); INSERT INTO vb6_data_test(id,name) VALUES([pId],[pName])');
 add.Parameters.Item('pId').Value=8;add.Parameters.Item('pName').Value=value;await add.Execute();assert.equal(add.RecordsAffected,1);
 const rdo=context.createObject('RDO.rdoEngine'),rcn=await rdo.rdoEnvironments.Item(0).OpenConnection('NativeTest',1,false,'Database');
 const query=rcn.CreateQuery('ReadById','SELECT name FROM vb6_data_test WHERE id = ?');query.Item(0).Type=4;query.Item(0).Value=8;
 assert.equal((await query.OpenResultset(3,1)).Item(0).Value,value);await rcn.Close();await db.Close();
 await cn.query('DROP TABLE vb6_data_test');
 console.log(JSON.stringify({driver:kind,passed:true,checks:['authenticated HTTP gateway','prepared SQL injection-shaped Unicode value','binary and null values','schema','transaction commit','transaction rollback','close rollback','provider failure','DAO typed action QueryDef','RDO positional query']},null,2));
}finally{await context.close();await gateway.close();}
