import {assertData,DATA_LIMITS,quoteIdentifier} from './common.js';
import {dataDefault,dataMembers} from './defaults.js';
import {DataCollection} from './collection.js';
import {ConnectedRecordset} from './connected-recordset.js';
import {DAORecordset} from './dao-recordset.js';
import {fieldValue} from './recordset.js';
import {sqlTokens,simpleSelect} from './sql-parameters.js';
import {VBArray} from '../runtime/values.js';

// RDO uses ODBC SQL type numbers, not ADO DataTypeEnum or DAO DataTypeEnum.
export const RDO_TYPES=Object.freeze({0:12,1:129,2:131,3:14,4:3,5:2,6:5,7:4,8:5,9:133,10:134,11:135,12:202,[-1]:203,[-2]:128,[-3]:204,[-4]:205,[-5]:20,[-6]:17,[-7]:11});
export const RDO_CONSTANTS=Object.freeze({rdOpenForwardOnly:0,rdOpenKeyset:1,rdOpenDynamic:2,rdOpenStatic:3,rdConcurReadOnly:1,rdConcurLock:2,rdConcurRowVer:3,rdConcurValues:4,rdConcurBatch:5,rdUseIfNeeded:0,rdUseOdbc:1,rdUseServer:2,rdUseClientBatch:3,rdUseNone:4,rdDriverPrompt:0,rdDriverNoPrompt:1,rdDriverComplete:2,rdDriverCompleteRequired:3,rdParamUnknown:0,rdParamInput:1,rdParamOutput:2,rdParamInputOutput:3,rdParamReturnValue:4,rdTypeCHAR:1,rdTypeNUMERIC:2,rdTypeDECIMAL:3,rdTypeINTEGER:4,rdTypeSMALLINT:5,rdTypeFLOAT:6,rdTypeREAL:7,rdTypeDOUBLE:8,rdTypeDATE:9,rdTypeTIME:10,rdTypeTIMESTAMP:11,rdTypeVARCHAR:12,rdTypeLONGVARCHAR:-1,rdTypeBINARY:-2,rdTypeVARBINARY:-3,rdTypeLONGVARBINARY:-4,rdTypeBIGINT:-5,rdTypeTINYINT:-6,rdTypeBIT:-7,rdRowUnmodified:0,rdRowModified:1,rdRowNew:2,rdRowDeleted:3,rdRowDBDeleted:4,rdEditNone:0,rdEditInProgress:1,rdEditAdd:2,rdQSelect:0,rdQAction:1,rdQProcedures:2,rdQCompound:3,rdAsyncEnable:32,rdExecDirect:64,rdFetchLongColumns:128});
const bit=value=>value?-1:0;
const copy=value=>value instanceof Date?new Date(value):value instanceof Uint8Array?value.slice():value;
const remove=(collection,item)=>{const i=collection.items.indexOf(item);if(i>=0)collection.items.splice(i,1);};
const name=value=>{value=String(value);assertData(value.length<=255&&!value.includes('\0'),'Invalid RDO object name',5);return value;};
const timeout=value=>{value=Number(value);assertData(Number.isFinite(value)&&value>=1&&value<=600,'Timeout must be 1–600 seconds',5);return value;};
const driver=value=>{value=Number(value);assertData([0,3,4].includes(value),'Native ODBC/server cursor libraries require the native RDO provider',3251);return value;};
const options=value=>{value=Number(value);assertData(Number.isInteger(value)&&(value&~192)===0,'Unsupported RDO options; VB calls await provider I/O',3251);return value;};
const reverseType=ado=>({2:5,3:4,4:7,5:8,6:3,7:11,8:12,11:-7,12:0,14:3,17:-6,20:-5,128:-2,129:1,130:1,131:2,133:9,134:10,135:11,200:12,201:-1,202:12,203:-1,204:-3,205:-4}[ado]??0);
const rows=result=>result.values.map(row=>Object.fromEntries(result.columns.map((column,i)=>[column.Name.toUpperCase(),row[i]])));

export class RDOParameter {
  constructor(ordinal){this.__type='RDO.rdoParameter';this._name='Parameter'+(ordinal+1);this._type=0;this._size=0;this._value=null;dataDefault(this);}
  get Name(){return this._name;}
  get Type(){return this._type;}set Type(value){value=Number(value);assertData(Object.hasOwn(RDO_TYPES,value),'Unsupported ODBC parameter type',3251);const next=fieldValue({Type:RDO_TYPES[value],DefinedSize:this.Size},this._value);this._type=value;this._value=next;}
  get Size(){return this._size;}set Size(value){value=Number(value);assertData(Number.isSafeInteger(value)&&value>=0&&value<=DATA_LIMITS.bytes,'Invalid parameter size',5);const next=fieldValue({Type:RDO_TYPES[this.Type],DefinedSize:value},this._value);this._size=value;this._value=next;}
  get Direction(){return 1;}set Direction(value){assertData(Number(value)===1,'Output/return parameters require native procedure metadata and execution',3251);}
  get Value(){return copy(this._value);}set Value(value){this._value=fieldValue({Type:RDO_TYPES[this.Type],DefinedSize:this.Size},value);}
}

export class RDOQuery {
  constructor(context,connection=null,queryName='',sql=''){
    this.__type='RDO.rdoQuery';this._context=context;this._connection=connection;this._name=name(queryName);this._sql='';this._parameters=new DataCollection();this._parameters.setItem=(key,value)=>{this._parameters.Item(key).Value=value;};this._closed=false;this._busy=false;this._maxRows=0;this._timeout=null;this._affected=0;this.SQL=sql;dataMembers(this,['rdoParameters']);
  }
  require(){assertData(!this._closed,'Query is closed',3420);assertData(!this._busy,'Query operation is pending',3219);}
  get Name(){return this._name;}
  get ActiveConnection(){return this._connection;}set ActiveConnection(value){this.require();assertData(value instanceof RDOConnection&&value._context===this._context,'Expected an RDO connection from this runtime',13);this._connection=value;}
  get SQL(){return this._sql;}set SQL(value){this.require();value=String(value);const tokens=sqlTokens(value);assertData(!tokens.some((t,i)=>t.kind==='symbol'&&[':', '@','$'].includes(t.value)&&tokens[i-1]?.value!=='@'&&tokens[i+1]?.value!=='@'),'RDO queries use positional question-mark parameters',3251);const count=tokens.filter(t=>t.kind==='symbol'&&t.value==='?').length;assertData(count<=1024,'Parameter limit exceeded',7);this._sql=value;this._parameters.items=Array.from({length:count},(_,i)=>new RDOParameter(i));}
  get rdoParameters(){return this._parameters;}
  Item(key){this.require();return this._parameters.Item(key);}setItem(key,value){this.Item(key).Value=value;}
  get Type(){const token=sqlTokens(this.SQL)[0]?.value.toUpperCase();return token==='SELECT'||token==='WITH'?0:1;}
  get RowCount(){return this._affected;}
  get MaxRows(){return this._maxRows;}set MaxRows(value){value=Number(value);assertData(Number.isSafeInteger(value)&&value>=0&&value<=DATA_LIMITS.rows,'Invalid MaxRows',5);this._maxRows=value;}
  get QueryTimeout(){return this._timeout??this._connection?.QueryTimeout??30;}set QueryTimeout(value){this._timeout=timeout(value);}
  async run(){this.require();const cn=this._connection;assertData(cn instanceof RDOConnection,'Query requires an ActiveConnection',3709);cn.require();this._busy=true;try{const result=await cn._guard(()=>cn._ado.query(this.SQL,this._parameters.items.map(p=>p.Value),1,this.QueryTimeout,'odbc'));this._affected=Number(result.rowsAffected||0);cn._affected=this._affected;if(this.MaxRows)result.values=result.values.slice(0,this.MaxRows);return result;}finally{this._busy=false;}}
  async Execute(flags=0){options(flags);const result=await this.run();assertData(!result.columns.length,'Execute requires an action query; use OpenResultset',40041);}
  async OpenResultset(type=0,lock=1,flags=0){options(flags);this.require();const cn=this._connection;assertData(cn instanceof RDOConnection,'Query requires an ActiveConnection',3709);const mode=cn.cursorMode(type,lock);const result=await this.run();assertData(result.columns.length,'Query did not return columns',40041);return cn.result(result,this,mode);}
  Cancel(){this._connection?.Cancel();}
  Close(){this.require();this._closed=true;this._connection&&remove(this._connection.rdoQueries,this);}
}

export class RDOResultset {
  constructor(connection,result,source,mode){
    this.__type='RDO.rdoResultset';this._connection=connection;this._source=source;this._mode=mode;this._collisions=[];this._conflicts=new WeakMap();this._deletedInBatch=false;
    const cursor=new ConnectedRecordset(connection._context);cursor.ActiveConnection=connection._ado;cursor.Source=source instanceof RDOQuery?source.SQL:String(source);cursor.load(result,mode.lock===5?4:mode.lock===1?1:3);connection._ado.recordsets.add(cursor);
    this._dao=new DAORecordset(cursor,null,mode.type===0?8:2,cursor.Source);this._columns=this.columns();dataMembers(this,['rdoColumns']);connection.rdoResultsets.items.push(this);
  }
  require(){this._connection.require();this._dao.require();}
  get _cursor(){return this._dao.cursor;}
  columns(){const rs=this,collection=new DataCollection(this._cursor.columns.map(c=>{
    const field=()=>rs._dao.field(c.Name);return dataDefault({__type:'RDO.rdoColumn',Name:c.Name,Type:reverseType(c.Type),Size:c.DefinedSize||0,
      get Value(){return field().Value;},set Value(value){field().Value=value;},get OriginalValue(){return rs._dao.EditMode?field().OriginalValue:rs._cursor.Fields.Item(c.Name).OriginalValue;},
      get BatchConflictValue(){rs.require();const row=rs._cursor.cursorRow();assertData(rs._conflicts.has(row),'No refreshed provider value for this conflict',3251);const fresh=rs._conflicts.get(row);assertData(fresh,'Record was deleted from the provider',3021);return copy(fresh[c.Name]);},
      get Updatable(){return rs.Updatable;},get ColumnSize(){return field().FieldSize;},GetChunk(offset,length){return field().GetChunk(offset,length);},AppendChunk(value){return field().AppendChunk(value);}});
    }));collection.setItem=(key,value)=>{collection.Item(key).Value=value;};return collection;}
  get rdoColumns(){return this._columns;}
  Item(key){this.require();return this._columns.Item(key);}setItem(key,value){this.Item(key).Value=value;}
  get Name(){return this._source instanceof RDOQuery?this._source.Name:String(this._source);}
  get SQL(){return this._cursor.Source;}
  get Type(){return this._mode.type;}get LockType(){return this._mode.lock;}
  get BOF(){return this._dao.BOF;}get EOF(){return this._dao.EOF;}
  get RowCount(){return this._dao.RecordCount;}get Updatable(){return this._dao.Updatable;}get Bookmarkable(){return this._dao.Bookmarkable;}
  get EditMode(){return this._dao.EditMode;}
  get AbsolutePosition(){return this._dao.AbsolutePosition;}set AbsolutePosition(value){this._dao.AbsolutePosition=value;this._deletedInBatch=false;}
  get PercentPosition(){return this._dao.PercentPosition;}set PercentPosition(value){this._dao.PercentPosition=value;this._deletedInBatch=false;}
  get Bookmark(){return this._dao._deleted&&this._deletedInBatch?this._cursor.Bookmark:this._dao.Bookmark;}
  set Bookmark(value){this.require();const cursor=this._cursor,row=cursor.rows.find(row=>cursor._bookmarks.get(row)===Number(value));if(cursor._family.batch.get(row)?.kind==='delete'){this._dao.CancelUpdate();cursor._deletedCurrent=row;cursor._cache=null;cursor.position=cursor.view().indexOf(row);this._dao._deleted=true;this._deletedInBatch=true;cursor.notify('move');}else{this._dao.Bookmark=value;this._deletedInBatch=false;}}
  get LastModified(){return this._dao.LastModified;}
  get Status(){this.require();const entry=this._cursor._family.batch.get(this._cursor.cursorRow());return entry?.kind==='insert'?2:entry?.kind==='delete'?3:entry?1:0;}
  get BatchCollisionCount(){return this._collisions.length;}get BatchCollisionRows(){return VBArray.from(this._collisions);}
  Edit(){return this._dao.Edit();}AddNew(){this._deletedInBatch=false;return this._dao.AddNew();}CancelUpdate(){return this._dao.CancelUpdate();}
  async Update(force=false){assertData(!force,'Forced overwrites are not enabled for portable providers',3251);return this._connection._guard(()=>this._dao.Update());}
  async Delete(){await this._connection._guard(()=>this._dao.Delete());this._deletedInBatch=this.LockType===5&&!!this._cursor._deletedCurrent;}
  MoveNext(){if(this._deletedInBatch){this._deletedInBatch=false;return this._dao.move(this._cursor.position+1,true);}return this._dao.MoveNext();}
  MovePrevious(){this._deletedInBatch=false;return this._dao.MovePrevious();}MoveFirst(){this._deletedInBatch=false;return this._dao.MoveFirst();}MoveLast(){this._deletedInBatch=false;return this._dao.MoveLast();}
  Move(count,start){this._deletedInBatch=false;return this._dao.Move(count,start);}
  GetRows(count){return this._dao.GetRows(count);}
  async BatchUpdate(singleRow=false,force=false){
    this.require();assertData(this.LockType===5,'BatchUpdate requires rdConcurBatch',3251);assertData(!force,'Forced overwrite is not enabled',3251);assertData(!this.EditMode,'Update or CancelUpdate the copy buffer first',3219);
    const cursor=this._cursor,selected=cursor.selection(singleRow?1:3),bookmarks=new Map(selected.map(row=>[row,cursor._bookmarks.get(row)]));this._collisions=[];this._conflicts=new WeakMap();
    try{await this._connection._guard(()=>cursor.UpdateBatch(singleRow?1:3));}
    finally{
      for(const row of selected)if(cursor._family.batch.get(row)?.error){this._collisions.push(bookmarks.get(row));if(cursor._resync&&cursor.State&&cursor.ActiveConnection?.State===1){try{this._conflicts.set(row,await cursor._resync(row,cursor._family.batch.get(row).before));}catch{/* Preserve the original update error; unavailable values remain explicitly unavailable. */}}}
      this._dao._deleted=false;this._deletedInBatch=false;
    }
  }
  CancelBatch(singleRow=false){this.require();assertData(this.LockType===5,'CancelBatch requires rdConcurBatch',3251);this._dao.CancelUpdate();this._cursor.CancelBatch(singleRow?1:3);this._dao._deleted=false;this._deletedInBatch=false;}
  async Requery(flags=0){options(flags);this.require();this.CancelUpdate();assertData(!this._cursor._family.batch.size,'BatchUpdate or CancelBatch before Requery',3219);const fresh=this._source instanceof RDOQuery?await this._source.OpenResultset(this.Type,this.LockType):await this._connection.OpenResultset(this._source,this.Type,this.LockType);const old=this._cursor;this._dao=fresh._dao;this._columns=this.columns();remove(this._connection.rdoResultsets,fresh);old.dispose();this._collisions=[];this._conflicts=new WeakMap();this._deletedInBatch=false;}
  async Refresh(){this.require();this.CancelUpdate();await this._connection._guard(()=>this._cursor.Resync(3,2));this._dao._deleted=false;this._deletedInBatch=false;}
  async Close(){await this._dao.Close();remove(this._connection.rdoResultsets,this);}
}

export class RDOConnection {
  constructor(context,environment=null,connectionName=''){
    this.__type='RDO.rdoConnection';this._context=context;this._environment=environment;this._name=name(connectionName);this._ado=context.connection();this._driver=environment?.CursorDriver??0;this._timeout=environment?.QueryTimeout??30;this._loginTimeout=environment?.LoginTimeout??15;this._connect='';this._readOnly=false;this._affected=0;this._levels=0;this._opening=false;
    this.rdoQueries=new DataCollection();this.rdoResultsets=new DataCollection();this.rdoTables=new DataCollection();this.rdoTables.Refresh=()=>this.refreshTables();dataMembers(this,['rdoQueries','rdoResultsets','rdoTables']);
  }
  get Name(){return this._name;}
  get Connect(){return this._connect;}set Connect(value){assertData(!this._ado.State,'Connection is already open',3705);this._connect=value;}
  get StillConnecting(){return bit(this._opening);}
  get CursorDriver(){return this._driver;}set CursorDriver(value){assertData(!this.rdoResultsets.Count,'Close resultsets before changing CursorDriver',3219);this._driver=driver(value);}
  get QueryTimeout(){return this._timeout;}set QueryTimeout(value){this._timeout=timeout(value);}
  get LoginTimeout(){return this._loginTimeout;}set LoginTimeout(value){this._loginTimeout=timeout(value);}
  get RowCount(){return this._affected;}
  require(){assertData(this._ado.State===1,'Connection is closed',3709);}
  async _guard(action){this._ado.Errors.Clear();this._environment?._engine.rdoErrors.Clear();try{return await action();}catch(error){const errors=this._ado.Errors.items;this._environment?._engine.capture(error,errors);throw error;}}
  async EstablishConnection(prompt=1,readOnly=false,flags=0){assertData(Number(prompt)===1,'Interactive native ODBC login dialogs are unavailable; use rdDriverNoPrompt',3251);options(flags);assertData(!this._opening&&!this._ado.State,'Connection is already open or opening',3705);this._opening=true;try{await this._guard(async()=>{this._ado.ConnectionTimeout=this.LoginTimeout;this._ado.Mode=readOnly?1:3;this._ado.CommandTimeout=this.QueryTimeout;await this._ado.Open(this.Connect||this.Name);this._readOnly=!!readOnly;});}finally{this._opening=false;}}
  async Execute(sql,flags=0){options(flags);this.require();const result=await this._guard(()=>this._ado.query(String(sql),[],1,this.QueryTimeout));this._affected=Number(result.rowsAffected||0);assertData(!result.columns.length,'Execute requires an action query; use OpenResultset',40041);}
  cursorMode(type,lock){
    this.require();type=Number(type);lock=Number(lock);assertData([0,1,2,3].includes(type),'Invalid resultset type',5);assertData([1,4,5].includes(lock),'Pessimistic/row-version native concurrency is unavailable',3251);
    if(this.CursorDriver===3){assertData(lock===1||lock===5,'Client batch cursors require rdConcurReadOnly or rdConcurBatch',3251);type=3;}
    else{assertData([0,3].includes(type),'Native keyset/dynamic cursors require a native cursor provider',3251);assertData(lock!==5,'Set CursorDriver to rdUseClientBatch for batch writes',3251);}
    assertData(this.CursorDriver!==4||type===0,'rdUseNone only permits forward-only reads',3251);assertData(type!==0||lock===1,'Forward-only portable cursors are read-only',3251);assertData(!this._readOnly||lock===1,'Connection is read-only',3027);return {type,lock};
  }
  async result(result,source,mode){const select=simpleSelect(source instanceof RDOQuery?source.SQL:String(source));if(select&&this._ado.adapter.projectTable)result=await this._ado.adapter.projectTable(select,result);return new RDOResultset(this,result,source,mode);}
  async OpenResultset(sql,type=0,lock=1,flags=0){options(flags);const mode=this.cursorMode(type,lock),query=this.rdoQueries.items.find(q=>q.Name.toLowerCase()===String(sql).toLowerCase());if(query)return query.OpenResultset(type,lock,flags);
    const table=this.rdoTables.items.find(t=>t.Name.toLowerCase()===String(sql).toLowerCase());if(table)sql='SELECT * FROM '+quoteIdentifier(table.Name);
    const result=await this._guard(()=>this._ado.query(String(sql),[],1,this.QueryTimeout));assertData(result.columns.length,'Query did not return columns',40041);return this.result(result,String(sql),mode);
  }
  CreateQuery(queryName,sql=''){this.require();queryName=name(queryName);assertData(!this.rdoQueries.items.some(q=>q.Name.toLowerCase()===queryName.toLowerCase()),'Duplicate RDO query name',3265);const query=new RDOQuery(this._context,this,queryName,sql);this.rdoQueries.items.push(query);return query;}
  async refreshTables(){this.require();const result=await this._guard(()=>this._ado.adapter.schema(20));this.rdoTables.items=rows(result).map(row=>{const table={__type:'RDO.rdoTable',Name:String(row.TABLE_NAME),Type:String(row.TABLE_TYPE||'TABLE')};return table;});}
  async BeginTrans(){this.require();assertData(!this.rdoResultsets.items.some(rs=>rs.EditMode),'Post or cancel edits before starting a transaction',3219);const result=await this._guard(()=>this._ado.BeginTrans());this._levels++;return result;}
  async CommitTrans(){this.require();assertData(this._levels,'No transaction is active',3219);await this._guard(()=>this._ado.CommitTrans());this._levels--;}
  async RollbackTrans(){this.require();assertData(this._levels,'No transaction is active',3219);await this._guard(()=>this._ado.RollbackTrans());this._levels--;}
  Cancel(){this._ado.Cancel();}
  async Close(){this.Cancel();for(const rs of [...this.rdoResultsets.items]){if(rs._cursor.State)await rs.Close();else remove(this.rdoResultsets,rs);}while(this._levels){await this._ado.RollbackTrans();this._levels--;}for(const query of this.rdoQueries.items)query._closed=true;this.rdoQueries.items=[];await this._ado.Close();this._environment&&remove(this._environment.rdoConnections,this);}
}

export class RDOEnvironment {
  constructor(engine,environmentName=''){
    this.__type='RDO.rdoEnvironment';this._engine=engine;this._name=name(environmentName);this._driver=0;this._timeout=30;this._loginTimeout=15;this._closed=false;this._pending=0;this.rdoConnections=new DataCollection();dataMembers(this,['rdoConnections']);
  }
  get Name(){return this._name;}get CursorDriver(){return this._driver;}set CursorDriver(value){this._driver=driver(value);}
  get QueryTimeout(){return this._timeout;}set QueryTimeout(value){this._timeout=timeout(value);}
  get LoginTimeout(){return this._loginTimeout;}set LoginTimeout(value){this._loginTimeout=timeout(value);}
  async OpenConnection(connectionName,prompt=1,readOnly=false,connect='',flags=0){assertData(!this._closed,'Environment is closed',3420);connectionName=name(connectionName);assertData(!this.rdoConnections.items.some(c=>c.Name.toLowerCase()===connectionName.toLowerCase()),'Duplicate connection name',3265);const cn=new RDOConnection(this._engine._context,this,connectionName);cn.Connect=connect||connectionName;this.rdoConnections.items.push(cn);this._pending++;try{await cn.EstablishConnection(prompt,readOnly,flags);assertData(!this._closed,'Environment closed while connecting',3420);return cn;}catch(error){await cn.Close();throw error;}finally{this._pending--;}}
  async transaction(method){assertData(!this._closed&&!this._pending,'Environment is closed or a connection is opening',3219);const connections=this.rdoConnections.items.filter(c=>c._ado.State===1);assertData(connections.length,'No open connections',3709);const completed=[];try{for(const cn of connections){await cn[method]();completed.push(cn);}}catch(error){if(method==='BeginTrans')for(const cn of completed.reverse()){try{await cn.RollbackTrans();}catch{/* Original begin failure remains the primary error. */}}throw error;}}
  BeginTrans(){return this.transaction('BeginTrans');}CommitTrans(){return this.transaction('CommitTrans');}RollbackTrans(){return this.transaction('RollbackTrans');}
  async Close(){this._closed=true;await Promise.all(this.rdoConnections.items.map(c=>c.Close()));remove(this._engine.rdoEnvironments,this);}
}

export class RDOEngine {
  constructor(context){this.__type='RDO.rdoEngine';this._context=context;this.rdoEnvironments=new DataCollection();this.rdoErrors=new DataCollection();this.rdoErrors.Clear=()=>{this.rdoErrors.items=[];};this.rdoEnvironments.items.push(new RDOEnvironment(this,'Default_Environment'));dataMembers(this,['rdoEnvironments','rdoErrors','rdoCreateEnvironment']);}
  capture(error,errors=[]){this.rdoErrors.items=errors.length?errors.map(e=>({...e})): [{Number:error.number||3001,Description:error.message,Source:error.source||'VB6.RDO',SQLState:error.SQLState||'',NativeError:error.NativeError||error.number||3001}];}
  rdoCreateEnvironment(environmentName='',userName='',password=''){assertData(!userName&&!password,'Use a named authenticated gateway profile; native environment credentials are not browser connection credentials',3251);environmentName=name(environmentName);assertData(!environmentName||!this.rdoEnvironments.items.some(e=>e.Name.toLowerCase()===environmentName.toLowerCase()),'Duplicate environment name',3265);const environment=new RDOEnvironment(this,environmentName);if(environmentName)this.rdoEnvironments.items.push(environment);return environment;}
}

for(const [prototype,method,names,required] of [
  [RDOConnection.prototype,'EstablishConnection',['Prompt','ReadOnly','Options'],0],
  [RDOConnection.prototype,'OpenResultset',['Name','Type','LockType','Options'],1],
  [RDOConnection.prototype,'Execute',['Source','Options'],1],
  [RDOConnection.prototype,'CreateQuery',['Name','SQL'],1],
  [RDOQuery.prototype,'OpenResultset',['Type','LockType','Options'],0],
  [RDOQuery.prototype,'Execute',['Options'],0],
  [RDOEnvironment.prototype,'OpenConnection',['Name','Prompt','ReadOnly','Connect','Options'],1],
  [RDOEngine.prototype,'rdoCreateEnvironment',['Name','UserName','Password'],0],
  [RDOResultset.prototype,'BatchUpdate',['SingleRow','Force'],0],
  [RDOResultset.prototype,'CancelBatch',['SingleRow'],0],
  [RDOResultset.prototype,'Update',['Force'],0]
])prototype[method].vbParams=names.map((name,i)=>({name,optional:i>=required}));
