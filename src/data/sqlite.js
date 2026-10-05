import {initializeSQLite} from './vendor/sqlite.js';
import {assertData,dataError,DATA_LIMITS,quoteIdentifier,sqlValue,columnType} from './common.js';

/** Real embedded SQLite. A context owns a disk; connections share its live database handles. */
export class SQLiteProvider {
  constructor(context,config){this.context=context;this.config=config;this.entry=null;this.level=0;}
  async open(){
    const SQL=await initializeSQLite();this.engine=SQL;
    assertData(!this.context.closed,'Data context is closed',3704);
    const path=this.config.database||':memory:';
    this.path=path===':memory:'?Symbol('memory'):this.context.fs.normalize(path);
    let entry=this.context.databases.get(this.path);
    if(!entry){
      const bytes=typeof this.path==='string'&&this.context.fs.exists(this.path)?this.context.fs.readBytes(this.path):undefined;
      assertData(!this.config.readOnly||bytes,'Read-only database does not exist',53);
      const db=new SQL.Database(bytes);
      db.run('PRAGMA foreign_keys=ON');db.run('PRAGMA journal_mode=DELETE');
      entry={db,users:new Set(),owner:null,dirty:false};
      this.context.databases.set(this.path,entry);
    }
    entry.users.add(this);this.entry=entry;
  }
  requireAccess(){assertData(this.entry,'Connection is closed',3704);assertData(!this.entry.owner||this.entry.owner===this,'Database is in use by another transaction',3197);}
  execute(text,parameters=[],options={}){
    this.requireAccess();const db=this.entry.db;
    assertData(typeof text==='string'&&text.trim()&&text.length<=1000000,'Invalid SQL command');
    // Skip SQL comments/delimiters before applying the transaction policy.
    const head=text.replace(/^(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/,'');
    assertData(!/^(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH)\b/i.test(head),'Use Connection transaction methods; ATTACH is not exposed',3251);
    assertData(!/^PRAGMA\b/i.test(head)||/^PRAGMA\s+(?:(?:main|temp)\s*\.\s*)?(?:table_info|table_xinfo|index_info|index_xinfo|index_list|foreign_key_list|database_list|integrity_check|quick_check)\s*(?:\([^;]*\))?\s*;?\s*$/i.test(head),'Only SQLite schema and integrity PRAGMAs are exposed; connection settings are managed by the provider',3251);
    db.run('PRAGMA query_only='+ (this.config.readOnly?'ON':'OFF'));
    let statement;const before=db.exec('SELECT total_changes() AS n')[0].values[0][0];
    try{
      // Preparing a second statement is rejected before the first is stepped.
      let count=0,sql='';
      for(const candidate of db.iterateStatements(text)){if(!count)sql=candidate.getSQL();count++;}
      assertData(count===1,'Execute accepts one parameterized statement at a time');
      statement=db.prepare(sql);
      const bindings=Array.isArray(parameters)?parameters.map(sqlValue):Object.fromEntries(Object.entries(parameters).map(([k,v])=>[k,sqlValue(v)]));
      statement.bind(bindings);
      const names=statement.getColumnNames();const values=[];
      assertData(names.length<=1024,'Column limit exceeded',7);
      while(statement.step()){
        assertData(values.length<DATA_LIMITS.rows&&(values.length+1)*names.length<=DATA_LIMITS.cells,'Result allocation limit exceeded',7);
        const row=statement.get(null,{useBigInt:true}).map(v=>typeof v==='bigint'?(v>=BigInt(Number.MIN_SAFE_INTEGER)&&v<=BigInt(Number.MAX_SAFE_INTEGER)?Number(v):v.toString()):v);
        values.push(row);
      }
      const columns=names.map((Name,c)=>{const types=new Set(values.map(r=>r[c]).filter(v=>v!=null).map(columnType));return {Name,Type:types.size===1?[...types][0]:[...types].every(t=>[3,5].includes(t))&&types.size?5:12,DefinedSize:0};});
      const after=db.exec('SELECT total_changes() AS n')[0].values[0][0];
      const changed=after!==before||!/^\s*(SELECT|EXPLAIN)\b/i.test(sql);
      const rowsAffected=after!==before?db.getRowsModified():0;
      statement.free();statement=null;
      if(changed&&!this.config.readOnly){this.entry.dirty=true;if(!this.level)this.flush();}
      return {columns,values,rowsAffected};
    }catch(error){throw error.number?error:dataError(error.message, /constraint/i.test(error.message)?-2147217873:3001);}
    finally{statement?.free();if(this.entry)this.entry.db.run('PRAGMA query_only=OFF');}
  }
  flush(){
    const entry=this.entry;if(!entry||entry.owner||!entry.dirty)return;
    if(typeof this.path==='string')this.context.fs.writeBytes(this.path,this.engine.vb6Snapshot(entry.db));
    entry.dirty=false;this.context.persist?.();
  }
  begin(){
    this.requireAccess();assertData(!this.config.readOnly,'Connection is read-only',3251);
    if(!this.level){this.entry.db.run('BEGIN IMMEDIATE');this.entry.owner=this;}
    else this.entry.db.run('SAVEPOINT vb6_'+this.level);
    return ++this.level;
  }
  commit(){
    this.requireAccess();assertData(this.level,'No active transaction',3246);
    this.entry.db.run(this.level===1?'COMMIT':'RELEASE SAVEPOINT vb6_'+(this.level-1));
    if(--this.level===0){this.entry.owner=null;this.flush();}
  }
  rollback(){
    this.requireAccess();assertData(this.level,'No active transaction',3246);
    this.entry.db.run('ROLLBACK');this.level=0;this.entry.owner=null;this.entry.dirty=false;
  }
  schema(kind=20){
    assertData([20,4].includes(Number(kind)),'Only table and column schema rows are implemented',3251);
    const tables=this.execute("SELECT name AS TABLE_NAME, type AS TABLE_TYPE FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name");
    if(Number(kind)===20)return tables;
    const values=[];
    for(const [name]of tables.values)for(const row of this.execute('PRAGMA table_info('+quoteIdentifier(name)+')').values)values.push([name,row[1],row[2],row[3]?0:-1,row[5]]);
    return {columns:['TABLE_NAME','COLUMN_NAME','DATA_TYPE','IS_NULLABLE','PRIMARY_KEY'].map(Name=>({Name,Type:12})),values,rowsAffected:0};
  }
  table(name){
    this.requireAccess();const exists=this.execute('SELECT type FROM sqlite_master WHERE name = ? COLLATE NOCASE',[name]);
    assertData(exists.values.length,'Table does not exist',3265);
    const info=this.execute('PRAGMA table_info('+quoteIdentifier(name)+')');
    const keys=info.values.filter(r=>r[5]).sort((a,b)=>a[5]-b[5]).map(r=>r[1]);
    const result=this.execute('SELECT * FROM '+quoteIdentifier(name));
    const writable=exists.values[0][0]==='table'&&keys.length>0&&!this.config.readOnly;
    if(writable)result.write=(kind,row,before)=>{
      this.requireAccess();
      const names=result.columns.map(c=>c.Name),q=quoteIdentifier(name);
      if(kind==='insert'){
        const supplied=names.filter(n=>row[n]!==null&&row[n]!==undefined);
        this.execute(supplied.length?'INSERT INTO '+q+' ('+supplied.map(quoteIdentifier).join(',')+') VALUES ('+supplied.map(()=>'?').join(',')+')':'INSERT INTO '+q+' DEFAULT VALUES',supplied.map(n=>row[n]));
        if(keys.length===1&&row[keys[0]]==null){const keyInfo=info.values.find(r=>r[1]===keys[0]);if(/^INTEGER$/i.test(keyInfo[2]))row[keys[0]]=this.execute('SELECT last_insert_rowid()').values[0][0];}
      }else{
        const where=names.map(n=>quoteIdentifier(n)+' IS ?').join(' AND ');
        const original=names.map(n=>before[n]);
        const response=kind==='delete'?this.execute('DELETE FROM '+q+' WHERE '+where,original):this.execute('UPDATE '+q+' SET '+names.map(n=>quoteIdentifier(n)+' = ?').join(',')+' WHERE '+where,[...names.map(n=>row[n]),...original]);
        assertData(response.rowsAffected===1,'Record was changed or deleted by another writer',3197);
      }
      if(kind!=='delete'){
        const refreshed=this.execute('SELECT * FROM '+q+' WHERE '+keys.map(k=>quoteIdentifier(k)+' IS ?').join(' AND '),keys.map(k=>row[k]));
        if(refreshed.values.length===1)result.columns.forEach((c,i)=>row[c.Name]=refreshed.values[0][i]);
      }
    };
    // Read by the original primary key without replacing the whole cursor.
    result.refresh=(row,before)=>{
      this.requireAccess();assertData(keys.length,'A primary key is required for refresh',3251);
      const record=this.execute('SELECT * FROM '+quoteIdentifier(name)+' WHERE '+keys.map(k=>quoteIdentifier(k)+' IS ?').join(' AND '),keys.map(k=>(before||row)[k]));
      return record.values.length?Object.fromEntries(record.columns.map((c,i)=>[c.Name,record.values[0][i]])):null;
    };
    if(!keys.length)delete result.refresh;
    return result;
  }
  close(){
    if(!this.entry)return;if(this.level)this.rollback();this.flush();
    const entry=this.entry;entry.users.delete(this);this.entry=null;
    if(!entry.users.size){entry.db.close();this.context.databases.delete(this.path);}
  }
}
