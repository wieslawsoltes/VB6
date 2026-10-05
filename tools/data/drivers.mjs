/** Optional native drivers are installed only on the trusted gateway, never in exported apps. */
import fs from 'node:fs/promises';import path from 'node:path';
import {DataContext} from '../../src/data/context.js';
import {VirtualFileSystem} from '../../src/runtime/filesystem.js';
import {assertData,resultFromRows,columnType} from '../../src/data/common.js';
import {createOLEDBDriver} from './oledb.mjs';
const empty=()=>({columns:[],values:[],rowsAffected:0});
const rowsResult=(rows,names,affected=0)=>{
 const result=resultFromRows(rows);if(!rows.length&&names)result.columns=names.map(Name=>({Name,Type:12}));result.rowsAffected=Number(affected||0);return result;
};
function optionsFor(profile){
 const options={...profile.options};
 for(const [key,name]of Object.entries(profile.environment||{})){assertData(typeof name==='string'&&process.env[name]!==undefined,'Missing server-side driver environment setting');options[key]=process.env[name];}
 return options;
}
export async function createNativeDriver(profile,{load=specifier=>import(specifier)}={}){
 const options=optionsFor(profile),driver=String(profile.driver||'').toLowerCase();
 assertData(!profile.readOnly||driver==='sqlite','The readOnly gateway flag is supported only by SQLite. Use a read-only database account for native drivers.');
 if(driver==='sqlite'){
   assertData(profile.filename&&profile.filename!==':memory:','Gateway SQLite requires an explicit server-owned filename');const filename=path.resolve(profile.filename),vfs=new VirtualFileSystem();
   try{vfs.writeBytes('/gateway.sqlite',new Uint8Array(await fs.readFile(filename)));}catch(error){if(error.code!=='ENOENT')throw error;}
   const context=new DataContext({}, {fs:vfs}),cn=context.connection();await cn.Open({provider:'sqlite',database:'/gateway.sqlite',readOnly:!!profile.readOnly});
   const persist=async()=>{if(profile.readOnly||!vfs.exists('/gateway.sqlite'))return;await fs.mkdir(path.dirname(filename),{recursive:true});const temporary=filename+'.'+process.pid+'.tmp';await fs.writeFile(temporary,vfs.readBytes('/gateway.sqlite'),{mode:0o600});await fs.rename(temporary,filename);};
   return {async execute(text,parameters){const result=await cn.query(text,parameters);if(!cn.adapter.level)await persist();return result;},schema:kind=>cn.adapter.schema(kind),begin:()=>cn.BeginTrans(),async commit(){await cn.CommitTrans();await persist();},rollback:()=>cn.RollbackTrans(),async close(){await context.close();await persist();}};
 }
 if(driver==='postgresql'||driver==='pg'){
   const pg=await load('pg'),client=new (pg.Client||pg.default.Client)({...options,connectionTimeoutMillis:15000,statement_timeout:profile.timeout||30000,query_timeout:profile.timeout||30000});await client.connect();
   const execute=async(text,values=[])=>{const r=await client.query({text,values,rowMode:'array'});assertData(!Array.isArray(r),'Use one SQL statement per gateway request');return {columns:r.fields.map((f,i)=>({Name:f.name,Type:12})),values:r.rows,rowsAffected:r.command==='SELECT'?0:r.rowCount||0};};
   return {execute,schema:kind=>execute(kind===20?"SELECT table_schema,table_name,table_type FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name":"SELECT table_schema,table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name,ordinal_position"),begin:()=>client.query('BEGIN'),commit:()=>client.query('COMMIT'),rollback:()=>client.query('ROLLBACK'),close:()=>client.end()};
 }
 if(driver==='mysql'||driver==='mariadb'){
   const module=await load('mysql2/promise'),mysql=module.default||module,client=await mysql.createConnection({...options,multipleStatements:false,supportBigNumbers:true,bigNumberStrings:true,connectTimeout:15000});
   const execute=async(text,parameters=[])=>{const [rows,fields]=await client.execute({sql:text,timeout:profile.timeout||30000},parameters.map(value=>value instanceof Uint8Array?Buffer.from(value):value));return Array.isArray(rows)?rowsResult(rows,fields?.map(f=>f.name)): {...empty(),rowsAffected:Number(rows.affectedRows||0)};};
   return {execute,schema:kind=>execute(kind===20?'SELECT table_schema,table_name,table_type FROM information_schema.tables WHERE table_schema=DATABASE()':'SELECT table_schema,table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=DATABASE()'),begin:()=>client.beginTransaction(),commit:()=>client.commit(),rollback:()=>client.rollback(),close:()=>client.end()};
 }
 if(driver==='sqlserver'||driver==='mssql'){
   const module=await load('mssql'),sql=module.default||module,pool=await new sql.ConnectionPool({...options,connectionTimeout:15000,requestTimeout:profile.timeout||30000}).connect();let transaction=null;
   const execute=async(text,parameters=[])=>{const request=transaction?new sql.Request(transaction):pool.request();parameters.forEach((value,i)=>request.input('p'+(i+1),value instanceof Uint8Array?Buffer.from(value):value));const result=await request.query(text);assertData((result.recordsets?.length||0)<=1,'Multiple SQL Server rowsets require separate commands');return rowsResult(result.recordset||[],Object.keys(result.recordset?.columns||{}),result.recordset?0:(result.rowsAffected||[]).reduce((a,b)=>a+b,0));};
   return {execute,schema:kind=>execute(kind===20?'SELECT TABLE_SCHEMA,TABLE_NAME,TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES':'SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,DATA_TYPE,IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS'),async begin(){transaction=new sql.Transaction(pool);await transaction.begin();},async commit(){await transaction.commit();transaction=null;},async rollback(){if(transaction){await transaction.rollback();transaction=null;}},async close(){if(transaction)try{await transaction.rollback();}catch{}await pool.close();}};
 }
 if(driver==='odbc'){
   const module=await load('odbc'),odbc=module.default||module,client=await odbc.connect({...options,connectionString:options.connectionString,loginTimeout:15,connectionTimeout:30});
   const execute=async(text,parameters=[])=>{const result=await client.query(text,parameters.map(value=>value instanceof Uint8Array?Buffer.from(value):value),{timeout:Math.ceil((profile.timeout||30000)/1000)});return rowsResult(result,result.columns?.map(c=>c.name),result.count>0?result.count:0);};
   return {execute,async schema(kind){const result=kind===20?await client.tables(null,null,null,null):await client.columns(null,null,null,null);return rowsResult(result,result.columns?.map(c=>c.name));},begin:()=>client.beginTransaction(),commit:()=>client.commit(),rollback:()=>client.rollback(),close:()=>client.close()};
 }
 if(driver==='oledb')return createOLEDBDriver({...profile,options});
 throw new Error('Unsupported gateway driver: '+driver);
}
