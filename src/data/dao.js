import {dataDefault} from './defaults.js';
import {assertData,after,quoteIdentifier,connectionConfiguration,DATA_LIMITS} from './common.js';
import {DataCollection,NamedCollection} from './collection.js';
import {ConnectedRecordset} from './connected-recordset.js';
import {DAORecordset} from './dao-recordset.js';
import {DAO_TYPES,parameterPlan,sqlTokens,simpleSelect} from './sql-parameters.js';
import {fieldValue,fieldScalarType} from './recordset.js';
import {initializeSQLite} from './vendor/sqlite.js';

const folded=v=>String(v).toLowerCase();
const copy=v=>v instanceof Date?new Date(v):v instanceof Uint8Array?v.slice():v;
const internalCatalog='__vb6_dao_querydefs';
function remove(collection,item){const i=collection.items.indexOf(item);if(i>=0)collection.items.splice(i,1);}
function records(result){return (result.values||[]).map(row=>Object.fromEntries(result.columns.map((c,i)=>[c.Name.toUpperCase(),row[i]])));}
function validName(value){value=String(value);assertData(value.length>0&&value.length<=255&&!value.includes('\0'),'Invalid catalog name',3001);return value;}
const typeSql={1:'BOOLEAN',2:'TINYINT',3:'SMALLINT',4:'INTEGER',5:'CURRENCY_TEXT',6:'REAL',7:'DOUBLE',8:'DATETIME',9:'BINARY',10:'VARCHAR',11:'BLOB',12:'TEXT',15:'GUID',16:'BIGINT',20:'DECIMAL_TEXT',21:'DECIMAL_TEXT',23:'DATETIME'};
function declaredType(value){const t=String(value).toUpperCase();return /GUID/.test(t)?15:/BIGINT/.test(t)?16:/SMALLINT/.test(t)?3:/TINYINT/.test(t)?2:/BOOL|BIT/.test(t)?1:/INT/.test(t)?4:/CURRENCY|MONEY/.test(t)?5:/DOUBLE|FLOAT/.test(t)?7:/REAL|SINGLE/.test(t)?6:/DATE|TIME/.test(t)?8:/BLOB/.test(t)?11:/BINARY/.test(t)?9:/DECIMAL|NUMERIC/.test(t)?20:/TEXT|MEMO/.test(t)?12:10;}
function defaultSQL(value){
  if(value===''||value===undefined)return '';
  if(value===null)return 'NULL';if(typeof value==='boolean')return value?'1':'0';if(typeof value==='number'){assertData(Number.isFinite(value),'Invalid default',13);return String(value);}
  const text=String(value).trim();assertData(/^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)|NULL|TRUE|FALSE|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|'(?:[^']|'')*'|"(?:[^"]|"")*")$/i.test(text),'DefaultValue must be a literal or a SQLite current-date/time constant',3251);
  return text.startsWith('"')?"'"+text.slice(1,-1).replace(/""/g,'"').replace(/'/g,"''")+"'":text;
}
function literalDefault(value){
  const text=defaultSQL(value);if(!text||/^(NULL|CURRENT_)/i.test(text))return null;if(/^TRUE$/i.test(text))return -1;if(/^FALSE$/i.test(text))return 0;if(text[0]==="'")return text.slice(1,-1).replace(/''/g,"'");return Number(text);
}

export class DAOField {
  constructor(name='',type=10,size=0){this.__type='DAO.Field';this.Name=String(name);this.Type=Number(type);this.Size=Number(size);this.Attributes=0;this.Required=false;this.AllowZeroLength=true;this.DefaultValue='';this.ValidationRule='';this.ValidationText='';}
}
export class DAOIndex {
  constructor(name=''){this.__type='DAO.Index';this.Name=String(name);this.Primary=false;this.Unique=false;this.Required=false;this.IgnoreNulls=false;this.Fields=new NamedCollection();}
  CreateField(name){return new DAOField(name,0,0);}
}
export class DAOTableDef {
  constructor(database,name='',attributes=0,source='',connect=''){
    this.__type='DAO.TableDef';this.database=database;this.Name=String(name);this.Attributes=Number(attributes);this.SourceTableName=String(source);this.Connect=String(connect);this._attached=false;
    this.Fields=new NamedCollection([],{append:()=>assertData(!this._attached,'Use ALTER TABLE for schema changes on an attached portable TableDef',3251),delete:()=>assertData(!this._attached,'Use ALTER TABLE for schema changes on an attached portable TableDef',3251)});
    this.Indexes=new NamedCollection([],{append:index=>this._attached?this.database.addIndex(this,index):undefined,delete:index=>this._attached?this.database.deleteIndex(this,index):undefined,refresh:()=>this.database.refreshIndexes(this)});
  }
  CreateField(name,type=10,size=0){return new DAOField(name,type,size);}
  CreateIndex(name){return new DAOIndex(name);}
  OpenRecordset(type=1,options=0,lockEdit=0){return this.database.OpenRecordset(this.Name,type,options,lockEdit);}
  RefreshLink(){assertData(false,'Linked Jet/ACE TableDefs require a native catalog provider',3251);}
}
export class DAOParameter {
  constructor(definition){this.__type='DAO.Parameter';Object.assign(this,definition);this._value=null;dataDefault(this,()=>fieldScalarType(DAO_TYPES[this.Type]||12));}
  get Value(){return copy(this._value);}
  set Value(value){this._value=fieldValue({Name:this.Name,Type:DAO_TYPES[this.Type]||12,DefinedSize:this.Size},value);}
}
export class DAOQueryDef {
  constructor(database,name='',sql=''){
    this.__type='DAO.QueryDef';this.database=database;this.Name=String(name);this._attached=false;this._closed=false;this._sql='';this.Parameters=new DataCollection();this.Parameters.setItem=(key,value)=>{this.Parameters.Item(key).Value=value;};this.Parameters.Refresh=()=>this.prepare();this.RecordsAffected=0;this.ODBCTimeout=-1;this.MaxRecords=0;this.ReturnsRecords=true;this.Connect='';this.SQL=sql;
  }
  require(){this.database.require();assertData(!this._closed,'QueryDef is closed',3420);}
  get SQL(){return this._sql;}
  set SQL(value){this.require();const plan=parameterPlan(value),old=this.Parameters.items;this.database.checkWritable(!this._attached);if(this._attached)this.database.storeQuery(this.Name,String(value));this._sql=String(value);this.plan=plan;this.Parameters.items=plan.parameters.map(p=>{const parameter=new DAOParameter(p),previous=old.find(o=>folded(o.Name)===folded(p.Name));if(previous)parameter.Value=previous.Value;return parameter;});}
  get Name(){return this._name;}
  set Name(value){value=String(value);if(this._attached){this.require();validName(value);this.database.requireSQLite();assertData(!this.database.QueryDefs.items.some(q=>q!==this&&folded(q.Name)===folded(value)),'QueryDef already exists',3012);this.database.connection.adapter.execute('UPDATE '+quoteIdentifier(internalCatalog)+' SET name=? WHERE name=?',[value,this._name]);}this._name=value;}
  get Type(){const first=sqlTokens(this.plan.text)[0]?.value.toUpperCase();return {SELECT:0,WITH:0,DELETE:32,UPDATE:48,INSERT:64,CREATE:96,ALTER:96,DROP:96}[first]??112;}
  prepare(){this.require();const old=this.Parameters.items,plan=parameterPlan(this.SQL);this.plan=plan;this.Parameters.items=plan.parameters.map(p=>{const param=new DAOParameter(p),existing=old.find(o=>folded(o.Name)===folded(p.Name));if(existing)param.Value=existing.Value;return param;});}
  values(){return this.plan.bindings.map(i=>this.Parameters.Item(i).Value);}
  async OpenRecordset(type=2,options=0,lockEdit=0){this.require();this.validateOptions();assertData(!this.Connect,'Use a database opened with a named gateway profile for pass-through queries',3251);assertData(this.ReturnsRecords,'QueryDef does not return records',3065);const rs=await this.database.openResult(this.plan.text,this.values(),type,options,lockEdit,this);if(this.MaxRecords){assertData(Number.isSafeInteger(this.MaxRecords)&&this.MaxRecords>0&&this.MaxRecords<=DATA_LIMITS.rows,'Invalid MaxRecords',5);rs.cursor.rows.splice(this.MaxRecords);rs.cursor._cache=null;}return rs;}
  validateOptions(){assertData(!this.Connect,'Open a named gateway profile on the Database for pass-through queries',3251);assertData(Number.isSafeInteger(this.MaxRecords)&&this.MaxRecords>=0&&this.MaxRecords<=DATA_LIMITS.rows,'Invalid MaxRecords',5);assertData(this.ODBCTimeout===-1||Number.isFinite(this.ODBCTimeout)&&this.ODBCTimeout>=1&&this.ODBCTimeout<=600,'ODBCTimeout must inherit (-1) or be 1–600 seconds',5);}
  async Execute(options=0){this.require();this.validateOptions();assertData(this.Type!==0,'Cannot execute a SELECT query with Execute',3065);this.RecordsAffected=0;this.RecordsAffected=await this.database.executePlan(this.plan.text,this.values(),options,this.ODBCTimeout===-1?this.database.QueryTimeout:this.ODBCTimeout);}
  Close(){this.require();this._closed=true;}
}

export class DAODatabase {
  constructor(connection,workspace=null,readOnly=false){
    this.__type='DAO.Database';this.connection=connection;this.workspace=workspace;this._closed=false;this._readOnly=readOnly;this._queryTimeout=60;this.Name=connection._config?.name||connection._config?.database||'';this.Connect=connection.ConnectionString;this.RecordsAffected=0;this.Recordsets=new DataCollection();
    this.TableDefs=new NamedCollection([],{append:t=>this.appendTable(t),delete:t=>this.deleteTable(t),refresh:()=>this.refreshTables()});
    this.QueryDefs=new NamedCollection([],{append:q=>{this.require();assertData(q instanceof DAOQueryDef&&q.database===this&&!q._attached,'QueryDef belongs to another collection',3001);this.storeQuery(q.Name,q.SQL,false);q._attached=true;},delete:q=>{this.requireSQLite();this.connection.adapter.execute('DELETE FROM '+quoteIdentifier(internalCatalog)+' WHERE name = ?',[q.Name]);q._attached=false;},refresh:()=>this.refreshQueries()});
    this.QueryDefs.Item=key=>{const q=DataCollection.prototype.Item.call(this.QueryDefs,key);if(!q._closed)return q;const fresh=new DAOQueryDef(this,q.Name,q.SQL);fresh._attached=q._attached;this.QueryDefs.items[this.QueryDefs.items.indexOf(q)]=fresh;return fresh;};
  }
  require(){assertData(!this._closed&&this.connection.State===1,'Database is closed',3420);}
  checkWritable(temporary=false){this.require();assertData(temporary||!this._readOnly,'Database is read-only',3027);}
  requireSQLite(){this.checkWritable();assertData(this.connection.Provider==='sqlite','Portable catalog writes require SQLite; native catalogs require a native DAO host',3251);}
  get Updatable(){return !this._closed&&!this._readOnly?-1:0;}
  get Transactions(){return this.connection.adapter?.begin?-1:0;}
  get QueryTimeout(){return this._queryTimeout;}
  set QueryTimeout(value){value=Number(value);assertData(Number.isFinite(value)&&value>=1&&value<=600,'QueryTimeout must be 1–600 seconds',5);this._queryTimeout=value;}
  async refreshTables(){
    this.require();if(!this.connection.adapter.schema){this.TableDefs.items=[];return;}
    const tables=records(await this.connection.adapter.schema(20)),columns=records(await this.connection.adapter.schema(4));
    this.TableDefs.items=tables.filter(r=>r.TABLE_NAME!==internalCatalog).map(row=>{
      const t=new DAOTableDef(this,row.TABLE_NAME);t._attached=true;t._view=String(row.TABLE_TYPE).toLowerCase()==='view';
      for(const c of columns.filter(c=>c.TABLE_NAME===row.TABLE_NAME)){const f=new DAOField(c.COLUMN_NAME,declaredType(c.DATA_TYPE),Number(String(c.DATA_TYPE).match(/\((\d+)\)/)?.[1]||0));f.Required=!c.IS_NULLABLE;f._primary=Number(c.PRIMARY_KEY||0);t.Fields.items.push(f);}
      if(this.connection.Provider==='sqlite')this.refreshIndexes(t);return t;
    });
  }
  refreshIndexes(table){
    this.require();assertData(this.connection.Provider==='sqlite','Index metadata is not exposed by this provider',3251);const adapter=this.connection.adapter;
    const info=adapter.execute('PRAGMA table_info('+quoteIdentifier(table.Name)+')').values;
    for(const row of info){const field=table.Fields.items.find(f=>f.Name===row[1]);if(field){field.DefaultValue=row[4]??'';field._primary=row[5];}}
    const master=adapter.execute('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?',['table',table.Name]).values[0]?.[0]||'';
    const primary=info.filter(r=>r[5]).sort((a,b)=>a[5]-b[5]);const indices=[];
    if(primary.length){const index=new DAOIndex('PrimaryKey');index.Primary=true;index.Unique=true;index.Fields.items=primary.map(r=>new DAOField(r[1],0));indices.push(index);if(primary.length===1&&/^INTEGER$/i.test(primary[0][2])&&/\bAUTOINCREMENT\b/i.test(master))table.Fields.Item(primary[0][1]).Attributes|=16;}
    for(const row of adapter.execute('PRAGMA index_list('+quoteIdentifier(table.Name)+')').values){if(row[3]==='pk')continue;const index=new DAOIndex(row[1]);index.Unique=!!row[2];for(const c of adapter.execute('PRAGMA index_xinfo('+quoteIdentifier(index.Name)+')').values)if(c[5]&&c[2]!=null){const f=new DAOField(c[2],0);f.Attributes=c[3]?1:0;index.Fields.items.push(f);}if(index.Fields.Count)indices.push(index);}
    table.Indexes.items=indices;
  }
  CreateTableDef(name='',attributes=0,source='',connect=''){this.require();return new DAOTableDef(this,name,attributes,source,connect);}
  appendTable(table){
    this.requireSQLite();assertData(table instanceof DAOTableDef&&table.database===this&&!table._attached,'Invalid unattached TableDef',3001);validName(table.Name);assertData(table.Name!==internalCatalog,'Reserved catalog name',3001);
    assertData(table.Attributes===0&&!table.SourceTableName&&!table.Connect,'Linked/system TableDefs require a native provider',3251);assertData(table.Fields.Count,'Table requires fields',3265);
    const primaries=table.Indexes.items.filter(i=>i.Primary);assertData(primaries.length<=1,'A table has only one primary index',3001);const autos=table.Fields.items.filter(f=>f.Attributes&16);assertData(autos.length<=1&&(!autos.length||autos[0].Type===4),'AutoNumber requires one Long field',3251);
    if(autos.length&&primaries.length)assertData(primaries[0].Fields.Count===1&&primaries[0].Fields.Item(0).Name===autos[0].Name,'AutoNumber must be the primary key',3251);
    const fields=table.Fields.items.map(f=>{validName(f.Name);assertData(typeSql[f.Type],'Unsupported DAO field type',3251);assertData(!f.ValidationRule&&!f.ValidationText,'ValidationRule expressions require a native Jet catalog',3251);assertData((f.Attributes&~16)===0,'Unsupported field attributes',3251);assertData(Number.isSafeInteger(f.Size)&&f.Size>=0&&f.Size<=1048576,'Invalid field size',5);let sql=quoteIdentifier(f.Name)+' '+typeSql[f.Type];if(f.Size&&[9,10].includes(f.Type))sql+='('+f.Size+')';if(f.Attributes&16)sql+=' PRIMARY KEY AUTOINCREMENT';if(f.Required)sql+=' NOT NULL';if(!f.AllowZeroLength&&[10,12].includes(f.Type))sql+=' CHECK(length('+quoteIdentifier(f.Name)+') > 0)';const value=defaultSQL(f.DefaultValue);if(value)sql+=' DEFAULT '+value;return sql;});
    if(primaries.length&&!autos.length)fields.push('PRIMARY KEY ('+this.indexFields(table,primaries[0])+')');
    const adapter=this.connection.adapter;adapter.begin();try{adapter.execute('CREATE TABLE '+quoteIdentifier(table.Name)+' ('+fields.join(',')+')');for(const index of table.Indexes)if(!index.Primary)this.addIndex(table,index);adapter.commit();table._attached=true;this.refreshIndexes(table);}catch(error){adapter.rollbackLevel();throw error;}
  }
  indexFields(table,index){assertData(index instanceof DAOIndex&&index.Fields.Count,'Index requires fields',3265);return index.Fields.items.map(f=>{table.Fields.Item(f.Name);assertData((f.Attributes&~1)===0,'Unsupported index field attributes',3251);return quoteIdentifier(f.Name)+(f.Attributes&1?' DESC':' ASC');}).join(',');}
  addIndex(table,index){this.requireSQLite();validName(index.Name);assertData(!index.Primary,'Add a primary index before appending the TableDef',3251);assertData(!index.IgnoreNulls&&!index.Required,'Required/IgnoreNulls index policies need a native catalog',3251);const fields=this.indexFields(table,index);this.connection.adapter.execute('CREATE '+(index.Unique?'UNIQUE ':'')+'INDEX '+quoteIdentifier(index.Name)+' ON '+quoteIdentifier(table.Name)+' ('+fields+')');}
  deleteIndex(table,index){this.requireSQLite();assertData(!index.Primary&&!index.Name.startsWith('sqlite_'),'Primary/constraint indexes require a table rebuild',3251);this.connection.adapter.execute('DROP INDEX '+quoteIdentifier(index.Name));}
  deleteTable(table){this.requireSQLite();assertData(!table._view,'Use DROP VIEW for a view',3251);this.connection.adapter.execute('DROP TABLE '+quoteIdentifier(table.Name));table._attached=false;}
  refreshQueries(){
    this.require();this.QueryDefs.items=[];if(this.connection.Provider!=='sqlite')return;
    const adapter=this.connection.adapter,exists=adapter.execute('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?',['table',internalCatalog]);if(!exists.values.length)return;
    for(const [name,sql]of adapter.execute('SELECT name, sql FROM '+quoteIdentifier(internalCatalog)+' ORDER BY name').values){const q=new DAOQueryDef(this,name,sql);q._attached=true;this.QueryDefs.items.push(q);}
  }
  storeQuery(name,sql,replace=true){this.requireSQLite();validName(name);const adapter=this.connection.adapter;adapter.begin();try{adapter.execute('CREATE TABLE IF NOT EXISTS '+quoteIdentifier(internalCatalog)+' (name TEXT PRIMARY KEY COLLATE NOCASE, sql TEXT NOT NULL)');adapter.execute('INSERT INTO '+quoteIdentifier(internalCatalog)+' (name,sql) VALUES (?,?)'+(replace?' ON CONFLICT(name) DO UPDATE SET sql=excluded.sql':''),[name,sql]);adapter.commit();}catch(error){adapter.rollbackLevel();throw error;}}
  CreateQueryDef(name='',sql=''){this.require();const query=new DAOQueryDef(this,name,sql);if(name)this.QueryDefs.Append(query);return query;}
  async OpenRecordset(source,type,options=0,lockEdit=0){this.require();const query=this.QueryDefs.items.find(q=>folded(q.Name)===folded(source));if(query)return this.QueryDefs.Item(query.Name).OpenRecordset(type??2,options,lockEdit);return this.openResult(String(source),[],type,options,lockEdit);}
  async openResult(source,parameters,type,options=0,lockEdit=0,query=null){
    this.require();if(type===undefined){const ts=sqlTokens(source);type=this.TableDefs.items.some(t=>folded(t.Name)===folded(source))||ts.length===1&&['word','identifier'].includes(ts[0].kind)?1:2;}type=Number(type);options=Number(options);assertData([1,2,4,8].includes(type),'Only table, dynaset, snapshot and forward-only client records are supported',3251);assertData((options&~4)===0,'Unsupported DAO OpenRecordset options',3251);assertData([0,1,3,4].includes(Number(lockEdit)),'Pessimistic/batch DAO locking is unavailable',3251);assertData(!(options&4)||Number(lockEdit)!==4,'Read-only cannot be specified twice',3001);
    const adapter=this.connection.adapter,tokens=sqlTokens(source),known=this.TableDefs.items.find(t=>folded(t.Name)===folded(source)),isTable=!!known||tokens.length===1&&['word','identifier'].includes(tokens[0].kind);assertData(type!==1||isTable,'A table cursor requires a table name',3219);let result,table=null;
    if(isTable){const name=known?.Name||tokens[0].value;assertData(adapter.table,'Provider does not expose keyed table access',3251);if(!known)await this.refreshTables();result=await adapter.table(name);table=this.TableDefs.items.find(t=>folded(t.Name)===folded(name));}
    else{result=await this.connection.query(source,parameters,1,query&&query.ODBCTimeout!==-1?query.ODBCTimeout:this.QueryTimeout);const select=simpleSelect(source);if(select&&adapter.projectTable)result=await adapter.projectTable(select,result);table=select&&this.TableDefs.items.find(t=>folded(t.Name)===folded(select.table));}
    assertData(result.columns?.length,'The command does not return a recordset',3065);
    if(table)result.columns=result.columns.map(c=>{const field=table.Fields.items.find(f=>folded(f.Name)===folded(c.Name));return field?{...c,Type:DAO_TYPES[field.Type]||c.Type,DefinedSize:field.Size}:c;});
    const readonly=this._readOnly||!!(options&4)||Number(lockEdit)===4||type===4||type===8||!result.write;
    const cursor=new ConnectedRecordset(this.connection.context);cursor.ActiveConnection=this.connection;cursor.Source=isTable?(known?.Name||tokens[0].value):source;cursor._options=isTable?2:1;cursor._parameters=parameters;cursor.load(result,readonly?1:3);this.connection.recordsets.add(cursor);
    const rs=new DAORecordset(cursor,this,type,query?.Name||source,table);rs._queryDef=query;rs._reload=()=>this.openResult(source,query?query.values():parameters,type,options,lockEdit,query);return rs;
  }
  async executePlan(text,parameters=[],options=0,timeout=this.QueryTimeout){
    this.checkWritable();options=Number(options);assertData([0,128].includes(options),'Only dbFailOnError is supported for DAO Execute',3251);assertData(!/^(SELECT|WITH)\b/i.test(text.trim()),'Cannot execute a SELECT query with Execute',3065);
    const result=await this.connection.query(text,parameters,1,timeout);this.RecordsAffected=Number(result.rowsAffected||0);return this.RecordsAffected;
  }
  async Execute(text,options=0){this.RecordsAffected=0;const query=this.QueryDefs.items.find(q=>folded(q.Name)===folded(text));if(query){await query.Execute(options);this.RecordsAffected=query.RecordsAffected;}else await this.executePlan(String(text),[],options);}
  BeginTrans(){this.require();return this.workspace?this.workspace.BeginTrans():this.connection.BeginTrans();}
  CommitTrans(options=0){this.require();return this.workspace?this.workspace.CommitTrans(options):this.connection.CommitTrans();}
  Rollback(){this.require();return this.workspace?this.workspace.Rollback():this.connection.RollbackTrans();}
  async Close(){
    this.require();if(this.workspace?._level)await this.workspace.Rollback();for(const rs of [...this.Recordsets])if(rs.State)await rs.Close();this._closed=true;
    if(this.workspace){remove(this.workspace.Databases,this);const shared=this.workspace.Databases.items.some(db=>db.connection===this.connection);if(!shared){this.workspace._resources.delete(this._resourceKey);await this.connection.Close();}}
    else await this.connection.Close();
  }
}

export class DAOWorkspace {
  constructor(engine,name='#Default Workspace#',user='Admin',type=2){this.__type='DAO.Workspace';this.engine=engine;this.Name=String(name);this.UserName=String(user);this.Type=Number(type);this.Databases=new DataCollection();this._resources=new Map();this._opening=new Map();this._level=0;this._transaction=null;this._closed=false;}
  require(){assertData(!this._closed&&!this.engine.context.closed,'Workspace is closed',3420);}
  async OpenDatabase(name,options=false,readOnly=false,connect=''){
    this.require();assertData(!options,'Exclusive database mode requires a native DAO workspace',3251);assertData(this.Type===2,'Use RDO/ADO for remote ODBCDirect connections',3251);
    const context=this.engine.context,named=context.config.connections.find(c=>folded(c.name)===folded(name));assertData(named||! /\.(mdb|accdb)\b/i.test(name),'Jet/ACE files require a configured native provider; they are not SQLite files',3706);
    const config=connectionConfiguration(connect||named?.name||{provider:'sqlite',database:String(name)},context.config.connections);if(config.provider==='sqlite'&&config.database!==':memory:')config.database=context.fs.normalize(config.database||String(name));const key=JSON.stringify(config);
    let cn=this._resources.get(key);if(!cn){assertData(!this._level,'Cannot enlist another resource after a workspace transaction begins',3251);let opening=this._opening.get(key);if(!opening){const resource=context.connection();resource.Mode=readOnly?1:3;opening=(async()=>{await resource.Open(config);if(this._closed){await resource.Close();assertData(false,'Workspace closed during connection opening',3420);}this._resources.set(key,resource);return resource;})();this._opening.set(key,opening);opening.finally(()=>this._opening.delete(key)).catch(()=>{});}cn=await opening;}assertData(readOnly||cn.Mode!==1,'The shared workspace resource was opened read-only',3027);
    const db=new DAODatabase(cn,this,!!readOnly||!!cn._config.readOnly);db._resourceKey=key;this.Databases.items.push(db);
    try{await db.refreshTables();db.refreshQueries();return db;}catch(error){await db.Close();throw error;}
  }
  async CreateDatabase(name,locale='',options=0){
    this.require();assertData(!locale||locale==='SQLite','Jet locale/collation creation requires a native DAO provider',3251);assertData(Number(options)===0,'Jet format/encryption creation requires a native provider',3251);assertData(! /\.(mdb|accdb)\b/i.test(name),'Create a SQLite file or use a native Jet/ACE provider',3706);const fs=this.engine.context.fs;assertData(!fs.exists(name),'Database already exists',3204);const db=await this.OpenDatabase(name);db.connection.adapter.entry.dirty=true;db.connection.adapter.flush();return db;
  }
  async BeginTrans(){this.require();assertData(!this._opening.size,'Wait for pending connections before beginning a workspace transaction',3219);const connections=[...new Set(this.Databases.items.filter(db=>!db._closed).map(db=>db.connection))];assertData(connections.length===1,'A portable workspace transaction requires one resource; distributed atomicity is not emulated',3251);const cn=connections[0];assertData(!this._transaction||this._transaction===cn,'Workspace transaction resource changed',3219);await cn.BeginTrans();this._transaction=cn;return ++this._level;}
  async CommitTrans(options=0){this.require();assertData(Number(options)===0,'Disk force-flush flags require a native filesystem provider',3251);assertData(this._level,'No active workspace transaction',3034);await this._transaction.CommitTrans();if(!--this._level)this._transaction=null;}
  async Rollback(){this.require();assertData(this._level,'No active workspace transaction',3034);await this._transaction.RollbackTrans();this._level=0;this._transaction=null;for(const db of this.Databases){db.refreshQueries();await db.refreshTables();}}
  async Close(){this.require();if(this===this.engine.Workspaces.items[0]&&this.Name==='#Default Workspace#')return;if(this._level)await this.Rollback();this._closed=true;await Promise.allSettled([...this._opening.values()]);for(const db of [...this.Databases])await db.Close();remove(this.engine.Workspaces,this);}
}
export class DAOEngine {
  constructor(context){this.__type='DAO.DBEngine';this.context=context;this.Workspaces=new NamedCollection([],{append:w=>assertData(w instanceof DAOWorkspace&&w.engine===this&&!w._closed,'Invalid workspace',3001),delete:()=>assertData(false,'Close a workspace to remove it',3251)});this.Workspaces.items.push(new DAOWorkspace(this));}
  get Databases(){return this.Workspaces.Item(0).Databases;}
  get Errors(){const cn=[...this.context.connections].find(cn=>cn.Errors.Count);return cn?.Errors||new DataCollection();}
  CreateWorkspace(name,user='Admin',password='',type=2){assertData(!password&&user==='Admin','Jet workgroup security requires an installed native provider',3251);assertData([1,2].includes(Number(type)),'Unknown workspace type',3001);return new DAOWorkspace(this,validName(name),user,type);}
  OpenDatabase(...args){return this.Workspaces.Item(0).OpenDatabase(...args);}
  CreateDatabase(...args){return this.Workspaces.Item(0).CreateDatabase(...args);}
  BeginTrans(){return this.Workspaces.Item(0).BeginTrans();}CommitTrans(options=0){return this.Workspaces.Item(0).CommitTrans(options);}Rollback(){return this.Workspaces.Item(0).Rollback();}
  async CompactDatabase(source,destination,locale='',options=0,password=''){
    assertData(!this.context.closed,'Data context is closed',3420);assertData(!locale&&!options&&!password,'Jet version, encryption and locale compaction require a native DAO provider',3251);assertData(!/\.(mdb|accdb)\b/i.test(String(source)+String(destination)),'Jet/ACE compaction requires a native DAO provider',3706);
    const fs=this.context.fs,from=fs.normalize(source),to=fs.normalize(destination);assertData(from!==to&&!fs.exists(to),'Destination must not exist',3204);assertData(!this.context.databases.has(from),'Close all connections before compacting',3356);const SQL=await initializeSQLite();let db;
    try{db=new SQL.Database(fs.readBytes(from));assertData(db.exec('PRAGMA integrity_check')[0]?.values[0][0]==='ok','Database integrity check failed',3343);db.run('VACUUM');fs.writeBytes(to,SQL.vb6Snapshot(db));this.context.persist?.();}finally{db?.close();}
  }
}
