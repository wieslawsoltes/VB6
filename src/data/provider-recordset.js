import {DisconnectedRecordset,fieldValue} from './recordset.js';
import {assertData,after,DATA_LIMITS,sameValue} from './common.js';

/** The same observable cursor as the bound controls use, with awaited provider writes. */
export class ProviderRecordset extends DisconnectedRecordset {
  constructor(context){
    super();this.context=context;this.__type='ADODB.Recordset';this.Source='';this.ActiveConnection=null;
    this._writer=null;this._busy=false;this._ownedConnection=false;this._options=1;this._parameters=[];
  }
  guard(){assertData(!this._busy,'A recordset operation is already pending',3219);}
  load(result,lock=1){
    assertData(result&&Array.isArray(result.columns)&&Array.isArray(result.values),'Invalid provider result',13);
    assertData(result.columns.length<=1024&&result.values.length<=DATA_LIMITS.rows&&result.columns.length*result.values.length<=DATA_LIMITS.cells,'Recordset allocation limit exceeded',7);
    assertData([1,3].includes(Number(lock)),'Only read-only and optimistic recordsets are supported',3251);
    if(Number(lock)===3)assertData(result.write,'This result is read-only. Open a keyed table or configure REST write operations.',3251);
    // Validate the entire result before replacing the existing cursor.
    const columns=result.columns.map(c=>({Name:String(c.Name),Type:Number(c.Type||12),DefinedSize:Number(c.DefinedSize||0)}));
    assertData(new Set(columns.map(c=>c.Name.toLowerCase())).size===columns.length,'Duplicate result column names; use SQL aliases',3191);
    const rows=result.values.map(values=>{assertData(values.length===columns.length,'Inconsistent result width',13);return Object.fromEntries(columns.map((col,i)=>[col.Name,fieldValue(col,values[i]) ]));});
    this.columns=columns;this.rows=rows;this._lock=Number(lock);this._state=1;this._cache=null;this._pending=null;this.position=0;
    this._filter='';this._sort='';this._predicate=null;this._sortSpecs=[];this._writer=result.write||null;
    for(const row of this.rows)this._bookmarks.set(row,this._nextBookmark++);
    result.onLoad?.(this.rows);this.RowsAffected=Number(result.rowsAffected||0);this.notify('open');return this;
  }
  async Open(source,connection,cursor,lock,options){
    this.guard();assertData(!this.State,'Recordset is already open',3705);
    if((source===undefined||source==='')&&!connection&&!this.ActiveConnection)return super.Open(source,connection,cursor,lock,options);
    assertData(cursor===undefined||[0,3].includes(Number(cursor)),'Only materialized forward/static cursors are supported',3251);
    this.Source=source??this.Source;this.ActiveConnection=connection||this.ActiveConnection;
    if(typeof this.ActiveConnection==='string'){
      const cn=this.context.connection();await cn.Open(this.ActiveConnection);this.ActiveConnection=cn;this._ownedConnection=true;
    }
    assertData(this.ActiveConnection?.query,'A valid ActiveConnection is required',3709);
    this._options=Number(options??1);this._busy=true;
    try{
      const result=await this.ActiveConnection.query(this.Source,this._parameters,this._options);
      assertData(!this.context.closed&&this.ActiveConnection.State===1,'Connection closed before the query completed',3704);
      this.load(result,lock??1);this.ActiveConnection.recordsets.add(this);
    }catch(error){if(this._ownedConnection)await this.ActiveConnection.Close();throw error;}
    finally{this._busy=false;}
  }
  Item(key){return this.Fields.Item(key).Value;}
  setItem(key,value){this.Fields.Item(key).Value=value;}
  edit(column,value){this.guard();return super.edit(column,value);}
  Update(fields,values){
    if(this._updatePromise&&fields===undefined)return this._updatePromise;
    this.guard();this.requireOpen();
    if(fields!==undefined){this.requireWrite();for(const [col,value]of this.changes(fields,values))this.edit(col,value);}
    if(!this._pending)return;
    if(!this._writer)return super.Update();
    const pending=this._pending;this._busy=true;
    const fail=error=>{this._busy=false;this.ActiveConnection?.capture(error);throw error;};
    const complete=()=>{this._busy=false;assertData(this.State&&this._pending===pending,'Recordset changed during writeback',3197);for(const column of this.columns)pending.row[column.Name]=fieldValue(column,pending.row[column.Name]);super.Update();};
    try{const result=this._writer(pending.isNew?'insert':'update',pending.row,pending.before);if(result?.then){this._updatePromise=result.then(complete,fail).finally(()=>{this._updatePromise=null;});return this._updatePromise;}return complete();}catch(error){return fail(error);}
  }
  AddNew(fields,values){
    if(this._updatePromise)return this._updatePromise.then(()=>this.AddNew(fields,values));
    this.guard();this.requireWrite();const changes=fields===undefined?null:this.changes(fields,values);
    return after(this.Update(),()=>{super.AddNew();if(changes){for(const [col,value]of changes)this.edit(col,value);return this.Update();}});
  }
  Delete(affect=1){
    if(this._updatePromise)return this._updatePromise.then(()=>this.Delete(affect));
    this.guard();this.requireWrite();assertData(Number(affect)===1,'Only deletion of the current row is supported',3251);
    const row=this.current(),before=this._pending?.before||{...row};
    assertData(!this._pending?.isNew,'CancelUpdate an uncommitted new record instead',3219);
    if(!this._writer)return super.Delete(affect);
    this._busy=true;
    const fail=error=>{this._busy=false;this.ActiveConnection?.capture(error);throw error;};
    const complete=()=>{this._busy=false;super.Delete(affect);};
    try{const result=this._writer('delete',row,before);return result?.then?result.then(complete,fail):complete();}catch(error){return fail(error);}
  }
  CancelUpdate(){this.guard();return super.CancelUpdate();}
  moveTo(position){if(this._updatePromise)return this._updatePromise.then(()=>this.moveTo(position));this.guard();this.requireOpen();return after(this.Update(),()=>{this.position=Math.max(-1,Math.min(this.RecordCount,position));this.notify('move');});}
  MoveFirst(){return this.moveTo(0);}MoveLast(){return this.moveTo(this.RecordCount-1);}
  MoveNext(){return this.moveTo(this.position+1);}MovePrevious(){return this.moveTo(this.position-1);}
  Move(count,start){if(start!==undefined)this.Bookmark=start;return this.moveTo(this.position+Number(count));}
  ensurePropertyEdit(){this.guard();assertData(!this._pending||!this._writer,'Call Update or CancelUpdate before changing a connected cursor property',3219);}
  get Filter(){return super.Filter;}set Filter(value){this.ensurePropertyEdit();super.Filter=value;}
  get Sort(){return super.Sort;}set Sort(value){this.ensurePropertyEdit();super.Sort=value;}
  get Bookmark(){return super.Bookmark;}set Bookmark(value){this.ensurePropertyEdit();super.Bookmark=value;}
  get AbsolutePosition(){return super.AbsolutePosition;}set AbsolutePosition(value){this.ensurePropertyEdit();super.AbsolutePosition=value;}
  GetRows(...args){return after(this.Update(),()=>super.GetRows(...args));}
  GetString(format=2,count=-1,columnDelimiter='\t',rowDelimiter='\r',nullValue=''){
    assertData(Number(format)===2,'Only adClipString is supported',3251);
    return after(this.Update(),()=>{const start=Math.max(0,this.position),rows=this.view().slice(start,Number(count)<0?undefined:start+Number(count));const text=rows.map(row=>this.columns.map(col=>row[col.Name]??nullValue).join(columnDelimiter)+rowDelimiter).join('');this.moveTo(start+rows.length);return text;});
  }
  Find(criteria,skip=0,direction=1,start){
    return after(this.Update(),()=>{if(start!==undefined)this.Bookmark=start;const predicate=this.compileFilter(String(criteria));assertData(predicate,'Find requires criteria');const step=Number(direction)===-1?-1:1;let index=this.position+Number(skip);for(;index>=0&&index<this.RecordCount;index+=step)if(predicate(this.view()[index]))break;return this.moveTo(index);});
  }
  setRowValue(row,key,value,expected){
    this.guard();this.requireWrite();const column=this.column(key),next=fieldValue(column,value);
    assertData(this.rows.includes(row),'Bound record was deleted',3021);
    assertData(expected===undefined||sameValue(row[column.Name],expected),'Bound value changed during editing',3197);
    return after(this.Update(),()=>{const index=this.view().indexOf(row);assertData(index>=0,'Bound record no longer belongs to this view',3021);this.position=index;this.edit(column,next);return this.Update();});
  }
  async Requery(){
    if(this._updatePromise)await this._updatePromise;
    this.guard();this.requireOpen();assertData(this.ActiveConnection,'Disconnected Recordset cannot requery',3251);await this.Update();
    const source=this.Source,cn=this.ActiveConnection,lock=this.LockType;this._busy=true;
    try{const result=await cn.query(source,this._parameters,this._options);assertData(cn.State===1,'Connection closed during requery',3704);this.load(result,lock);}finally{this._busy=false;}
  }
  async Close(){
    if(this._updatePromise)await this._updatePromise;
    this.guard();this.requireOpen();await this.Update();super.Close();this._writer=null;
    this.ActiveConnection?.recordsets?.delete(this);
    if(this._ownedConnection){this._ownedConnection=false;await this.ActiveConnection.Close();}
  }
  dispose(){
    this._pending=null;this._state=0;this.rows=[];this._cache=null;this._writer=null;this.notify('close');
    this.ActiveConnection?.recordsets?.delete(this);
  }
}
