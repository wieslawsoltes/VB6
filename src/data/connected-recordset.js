import {VBDecimal,VBCurrency,coerce} from '../runtime/values.js';
import {ProviderRecordset} from './provider-recordset.js';
import {DisconnectedRecordset,fieldValue} from './recordset.js';
import {assertData,after,dataList,sameValue} from './common.js';

const copy = value => value instanceof Date ? new Date(value) : value instanceof Uint8Array ? value.slice() : value;
const copyRow = row => Object.fromEntries(Object.entries(row || {}).map(([key,value]) => [key,copy(value)]));
const family = rs => ({members:new Set([rs]),batch:new Map(),affected:new Set(),fetched:new Set(),busy:null,pending:null,nextBookmark:1});
const statusOf = entry => entry ? ({insert:1,update:2,delete:4}[entry.kind] | (entry.error ? entry.error.number===3197?2048:entry.error.number===-2147217873?4096:128 : 0)) : 0;
function compare(a,b) {
  if(sameValue(a,b))return 0;
  if(a!=null&&b!=null&&(a instanceof VBDecimal||b instanceof VBDecimal)){const exact=v=>Number.isSafeInteger(v)?VBDecimal.fromParts(BigInt(v),0):coerce(v,'Decimal');return exact(a).compare(exact(b));}
  if(a instanceof VBCurrency&&b instanceof VBCurrency)return a.raw<b.raw?-1:1;
  if(a==null)return -1;if(b==null)return 1;
  if(typeof a==='string'&&typeof b==='string'){a=a.toLowerCase();b=b.toLowerCase();}
  return a<b?-1:a>b?1:0;
}

/** Materialized ADO client cursor. Batch state is shared by clones; positions and filters are not. */
export class ConnectedRecordset extends ProviderRecordset {
  constructor(context) {
    super(context);
    this._family=family(this);this._deletedCurrent=null;this._pageSize=10;this._lockExplicit=false;
    this._resync=null;this._underlying=new WeakMap();this._boundConnection=null;
    const originalItem=this.Fields.Item.bind(this.Fields);
    this.Fields.Item=key=>{
      const field=originalItem(key),rs=this,col=this.column(key);
      Object.defineProperties(field,{
        OriginalValue:{get(){const row=rs.current();const entry=rs._family.batch.get(row);return copy(entry?entry.before?.[col.Name]??null:rs._pending?.row===row?rs._pending.before?.[col.Name]??null:row[col.Name]);}},
        UnderlyingValue:{get(){const row=rs.current();assertData(rs._resync,'UnderlyingValue requires a provider with keyed refresh',3251);return after(rs._resync(row,rs._family.batch.get(row)?.before),values=>{assertData(values,'Record was deleted from the data source',3021);rs._underlying.set(row,copyRow(values));return copy(values[col.Name]);});}},
        ActualSize:{get(){const value=field.Value;return value==null?0:typeof value==='string'?value.length*2:value instanceof Uint8Array?value.length:[2,11,18].includes(col.Type)?2:[16,17].includes(col.Type)?1:[5,6,7,20,21].includes(col.Type)?8:4;}}
      });
      let chunkPosition=0,chunkRow=null;
      field.GetChunk=length=>{length=Number(length);assertData(Number.isSafeInteger(length)&&length>=0,'Invalid chunk size',5);const row=rs.current();if(chunkRow!==row){chunkRow=row;chunkPosition=0;}const value=field.Value;if(value==null)return null;assertData(typeof value==='string'||value instanceof Uint8Array,'GetChunk requires a text or binary field',3251);const chunk=value.slice(chunkPosition,chunkPosition+length);chunkPosition+=chunk.length;return chunk;};
      field.AppendChunk=value=>{const old=field.Value;assertData(typeof value==='string'||value instanceof Uint8Array,'AppendChunk requires text or bytes',13);assertData(old==null||typeof old===typeof value&&((old instanceof Uint8Array)===(value instanceof Uint8Array)),'Chunk type mismatch',13);if(typeof value==='string')field.Value=(old||'')+value;else{const bytes=new Uint8Array((old?.length||0)+value.length);if(old)bytes.set(old);bytes.set(value,old?.length||0);field.Value=bytes;}};
      return field;
    };
  }
  get ActiveConnection(){return this._activeConnection??null;}
  set ActiveConnection(value){
    if(this.State){this.guard();assertData(this.LockType===4||this.LockType===1,'Only batch/read-only client cursors can detach',3251);assertData(value==null||value===this._boundConnection,'Reconnect the cursor to its original connection',3251);}
    this._activeConnection?.recordsets?.delete(this);this._activeConnection=value;
    if(value&&typeof value!=='string'){this._boundConnection=value;if(this.State)value.recordsets?.add(this);}
  }
  get LockType(){return this._lock;}
  set LockType(value){assertData(!this.State,'Recordset is open',3705);value=Number(value);assertData([1,3,4].includes(value),'Pessimistic locking requires a native server cursor',3251);this._lock=value;this._lockExplicit=true;}
  guard(){super.guard();if(this._family){assertData(!this._family.busy||this._family.busy===this,'A clone operation is pending',3219);assertData(!this._family.pending||this._family.pending===this,'Finish the edit on the other clone first',3219);}}
  load(result,lock=1){
    // Validate before detaching an existing clone family or changing the cursor.
    assertData([1,3,4].includes(Number(lock)),'Unsupported lock type',3251);
    const previous=this._family;
    super.load(result,Number(lock)===4?3:Number(lock));
    previous?.members.delete(this);this._family=family(this);this._family.fetched=new Set(this.rows);
    this._family.nextBookmark=this._nextBookmark;this._lock=Number(lock);this._deletedCurrent=null;
    this._resync=result.refresh||null;this._underlying=new WeakMap();this._boundConnection=this.ActiveConnection;
    return this;
  }
  async Open(source,connection,cursor,lock,options){
    const connected=connection||this.ActiveConnection||source;
    await super.Open(source,connection,cursor,lock??(this._lockExplicit?this.LockType:connected?1:3),options);
    this._family.fetched=new Set(this.rows);
  }
  view(){
    this.requireOpen();if(this._cache)return this._cache;
    const mode=this._filter,batch=this._family.batch;
    let rows=this.rows.filter(row=>{
      const entry=batch.get(row),deleted=entry?.kind==='delete';
      if(typeof mode==='number'){
        if(mode===1)return !!entry;
        if(mode===2)return this._family.affected.has(row);
        if(mode===3)return this._family.fetched.has(row)&&!deleted;
        if(mode===5)return !!entry?.error;
      }
      if(Array.isArray(mode))return mode.includes(this._bookmarks.get(row));
      if(deleted&&row!==this._deletedCurrent)return false;
      return !this._predicate||this._predicate(row)||this._pending?.isNew&&this._pending.row===row;
    });
    if(this._sortSpecs.length)rows.sort((a,b)=>{for(const [col,dir]of this._sortSpecs){const n=compare(a[col.Name],b[col.Name]);if(n)return n*dir;}return 0;});
    return this._cache=rows;
  }
  current(){const row=super.current();assertData(this._family.batch.get(row)?.kind!=='delete','Record is deleted',3167);return row;}
  cursorRow(){this.requireOpen();const row=this.view()[this.position];assertData(row,'Either BOF or EOF is True',3021);return row;}
  get Status(){return statusOf(this._family.batch.get(this.cursorRow()));}
  get Bookmark(){return this._bookmarks.get(this.cursorRow());}
  set Bookmark(value){this.ensurePropertyEdit();this.requireOpen();value=Number(value);assertData(Number.isSafeInteger(value),'Invalid bookmark',3001);this.Update();const index=this.view().findIndex(row=>this._bookmarks.get(row)===value);assertData(index>=0,'Bookmark is not valid in the current view',3001);this.moveTo(index);}
  get Filter(){return Array.isArray(this._filter)?this._filter.slice():this._filter;}
  set Filter(value){
    this.ensurePropertyEdit();this.requireOpen();let predicate=null;
    if(value===0)value='';
    if(typeof value==='string')predicate=this.compileFilter(value);
    else if(typeof value==='number')assertData([1,2,3,5].includes(value),'Unknown filter group',3001);
    else{value=dataList(value).map(Number);assertData(value.every(n=>Number.isSafeInteger(n)&&this.rows.some(r=>this._bookmarks.get(r)===n)),'Invalid bookmark filter',3001);}
    if(value===1||value===5)assertData(this.LockType===4,'Batch filters require batch optimistic locking',3251);
    this.Update();this._filter=value;this._predicate=predicate;this._deletedCurrent=null;this._cache=null;this.position=0;this.notify('filter');
  }
  get PageSize(){return this._pageSize;}
  set PageSize(value){value=Number(value);assertData(Number.isSafeInteger(value)&&value>0&&value<=100000,'Invalid PageSize',5);this._pageSize=value;}
  get PageCount(){return Math.ceil(this.RecordCount/this.PageSize);}
  get AbsolutePage(){return this.AbsolutePosition<0?this.AbsolutePosition:Math.floor(this.position/this.PageSize)+1;}
  set AbsolutePage(value){value=Number(value);assertData(Number.isSafeInteger(value)&&value>=1&&value<=this.PageCount,'Invalid AbsolutePage',3001);this.moveTo((value-1)*this.PageSize);}
  Supports(flags){
    this.requireOpen();flags=Number(flags);let supported=0x100|0x200|0x2000|0x4000|0x80000;
    if(this.LockType!==1)supported|=0x1000400|0x1000800|0x1008000|0x10000;
    if(this._resync&&this.ActiveConnection)supported|=0x20000;
    return Number.isSafeInteger(flags)&&flags!==0&&(flags&supported)===flags?-1:0;
  }
  notify(kind){
    if(this._family){
      if(this._pending)this._family.pending=this;else if(this._family.pending===this)this._family.pending=null;
      if(!['open','close','move','filter','sort'].includes(kind))for(const other of this._family.members)if(other!==this&&other.State){
        const row=other._cache?.[other.position];other._cache=null;
        if(row){const index=other.view().indexOf(row);other.position=index<0?Math.min(other.position,other.RecordCount):index;}
        DisconnectedRecordset.prototype.notify.call(other,'sync');
      }
    }
    super.notify(kind);
  }
  edit(column,value){this.guard();const row=this.current();assertData(!this._family.batch.get(row)?.error,'Cancel or resynchronize the conflicting row before editing',3197);return super.edit(column,value);}
  Update(fields,values){
    if(this.LockType!==4){const result=super.Update(fields,values);if(result?.then){this._family.busy=this;const clear=()=>{if(this._family.busy===this)this._family.busy=null;};result.then(clear,clear);return result;}return result;}
    this.guard();this.requireOpen();
    if(fields!==undefined){this.requireWrite();for(const [col,value]of this.changes(fields,values))this.edit(col,value);}
    const pending=this._pending;if(!pending)return;
    if(!this._family.batch.has(pending.row))this._family.batch.set(pending.row,{kind:pending.isNew?'insert':'update',before:pending.isNew?null:copyRow(pending.before)});
    const entry=this._family.batch.get(pending.row);
    if(entry.kind==='update'&&this.columns.every(c=>sameValue(pending.row[c.Name],entry.before[c.Name])))this._family.batch.delete(pending.row);
    return DisconnectedRecordset.prototype.Update.call(this);
  }
  AddNew(fields,values){
    this._nextBookmark=this._family.nextBookmark;
    return after(super.AddNew(fields,values),()=>{this._family.nextBookmark=this._nextBookmark;});
  }
  Delete(affect=1){
    affect=Number(affect);assertData([1,2].includes(affect),'Delete accepts adAffectCurrent or adAffectGroup',3001);
    if(this.LockType!==4){assertData(affect===1,'Immediate group deletion is not supported by this provider',3251);return super.Delete(affect);}
    this.guard();this.requireWrite();this.Update();const rows=affect===1?[this.cursorRow()]:this.view().slice();assertData(rows.length,'No records in the current group',3021);
    this._family.affected=new Set(rows);
    for(const row of rows){const old=this._family.batch.get(row);if(old?.kind==='insert'){this.rows.splice(this.rows.indexOf(row),1);this._family.batch.delete(row);}else this._family.batch.set(row,{kind:'delete',before:old?.before||copyRow(row)});}
    this._deletedCurrent=affect===1?rows[0]:null;this._cache=null;this.position=Math.min(this.position,this.RecordCount);this.notify('delete');
  }
  selection(affect){
    affect=Number(affect);assertData([1,2,3].includes(affect),'Invalid AffectRecords',3001);
    if(affect===1)return [this.cursorRow()];
    if(affect===2){const rows=this.view().slice();assertData(rows.length,'No records in the current group',3021);return rows;}
    return this.rows.slice();
  }
  async UpdateBatch(affect=3){
    this.guard();this.requireWrite();assertData(this.LockType===4,'UpdateBatch requires adLockBatchOptimistic',3251);
    this.Update();const selected=this.selection(affect).filter(row=>this._family.batch.has(row));
    assertData(!this._writer||this.ActiveConnection?.State===1,'Reconnect the recordset before UpdateBatch',3709);
    const current=this.view()[this.position],errors=[];this._family.affected=new Set(selected);this.ActiveConnection?.Errors.Clear();
    this._busy=true;this._family.busy=this;
    try{
      for(const row of selected){
        const entry=this._family.batch.get(row);if(!entry)continue;
        try{
          if(this._writer)await this._writer(entry.kind,row,entry.before);
          assertData(this.State&&(!this.context||!this.context.closed),'Recordset closed during batch update',3704);
          if(entry.kind==='delete'){const index=this.rows.indexOf(row);if(index>=0)this.rows.splice(index,1);}
          else for(const col of this.columns)row[col.Name]=fieldValue(col,row[col.Name]);
          this._family.batch.delete(row);
        }catch(error){entry.error=error;errors.push(error);if(!this.State||this.context?.closed)break;}
      }
    }finally{
      this._busy=false;this._family.busy=null;this._deletedCurrent=null;this._cache=null;
      if(this.State){const index=this.view().indexOf(current);this.position=index<0?Math.min(this.position,this.RecordCount):index;this.notify('batch');}
    }
    if(errors.length){
      if(this.ActiveConnection?.Errors)this.ActiveConnection.Errors.items.splice(0,this.ActiveConnection.Errors.Count,...errors.map(e=>({Number:e.number||3001,Description:e.message,Source:e.source||'VB6.Data',SQLState:e.SQLState||'',NativeError:e.NativeError||e.number||3001})));
      throw errors[0];
    }
  }
  CancelBatch(affect=3){
    this.guard();this.requireOpen();
    if(this.LockType!==4){assertData(Number(affect)===1,'Immediate mode accepts only adAffectCurrent',3251);return this.CancelUpdate();}
    // Resolve the requested scope before cancelling an in-progress AddNew.
    const selected=this.selection(affect);this.CancelUpdate();this._family.affected=new Set(selected);
    for(const row of selected){const entry=this._family.batch.get(row);if(!entry)continue;if(entry.kind==='insert'){const i=this.rows.indexOf(row);if(i>=0)this.rows.splice(i,1);}else Object.assign(row,copyRow(entry.before));this._family.batch.delete(row);}
    this._deletedCurrent=null;this._cache=null;this.position=0;this.notify('cancelbatch');
  }
  moveTo(position){
    if(this._updatePromise)return this._updatePromise.then(()=>this.moveTo(position));
    this.guard();this.requireOpen();assertData(Number.isSafeInteger(position),'Invalid cursor movement',5);
    return after(this.Update(),()=>{
      const rows=this.view(),target=rows[position],wasEOF=position>=rows.length;
      this._deletedCurrent=null;this._cache=null;
      this.position=position<0?-1:wasEOF?this.RecordCount:target?this.view().indexOf(target):this.RecordCount;
      if(this.position<0&&position>=0)this.position=Math.min(position,this.RecordCount);
      this.notify('move');
    });
  }
  ensurePropertyEdit(){this.guard();assertData(this.LockType===4||!this._pending||!this._writer,'Call Update or CancelUpdate before changing a connected cursor property',3219);}
  Clone(lock=-1){
    this.guard();this.requireOpen();lock=Number(lock);assertData([-1,1].includes(lock),'Clone accepts adLockUnspecified or adLockReadOnly',3001);assertData(!this._pending,'Update or CancelUpdate before cloning',3219);
    const rs=new ConnectedRecordset(this.context);rs._family.members.delete(rs);rs._family=this._family;this._family.members.add(rs);
    rs.rows=this.rows;rs.columns=this.columns;rs._bookmarks=this._bookmarks;rs._nextBookmark=this._family.nextBookmark;
    rs._state=1;rs._lock=lock===1?1:this.LockType;rs._sort=this._sort;rs._sortSpecs=this._sortSpecs.slice();
    rs._writer=this._writer;rs._resync=this._resync;rs.Source=this.Source;rs._options=this._options;rs._parameters=this._parameters;
    rs._activeConnection=this.ActiveConnection;rs._boundConnection=this._boundConnection;rs.ActiveConnection?.recordsets.add(rs);
    rs._pageSize=this.PageSize;return rs;
  }
  async Resync(affect=3,values=2){
    this.guard();this.requireOpen();assertData([1,2].includes(Number(values)),'Invalid ResyncValues',3001);assertData(this.ActiveConnection?.State===1&&this._resync,'Resync requires keyed refresh from an open provider',3251);
    assertData(!this._pending,'Update or CancelUpdate before Resync',3219);const selected=this.selection(affect),errors=[];this._family.affected=new Set(selected);this._busy=true;this._family.busy=this;
    try{for(const row of selected){const entry=this._family.batch.get(row);if(entry?.kind==='insert')continue;try{const fresh=await this._resync(row,entry?.before);assertData(this.State,'Recordset was closed',3704);assertData(fresh,'Record was deleted from the data source',3021);this._underlying.set(row,copyRow(fresh));if(Number(values)===2){for(const col of this.columns)row[col.Name]=fieldValue(col,fresh[col.Name]);this._family.batch.delete(row);}}catch(error){if(entry)entry.error=error;errors.push(error);}}}
    finally{this._busy=false;this._family.busy=null;this._cache=null;if(this.State){this.position=0;this.notify('resync');}}
    if(errors.length)throw errors[0];
  }
  async Requery(){assertData(!this._family.batch.size,'UpdateBatch or CancelBatch before Requery',3219);return super.Requery();}
  async Close(){
    if(this._updatePromise)await this._updatePromise;
    this.guard();this.requireOpen();assertData(this.LockType===4||!this._pending,'Update or CancelUpdate before closing an edited recordset',3219);
    if(this.LockType===4)this.CancelBatch();
    const owned=this._ownedConnection,cn=this.ActiveConnection;
    this._ownedConnection=false;this.dispose();
    if(owned&&cn&&!cn.recordsets.size)await cn.Close();
  }
  dispose(){
    // Closing one clone must not leave a shared, uncommitted edit visible in the others.
    if(this._pending){if(this._pending.isNew){const i=this.rows.indexOf(this._pending.row);if(i>=0)this.rows.splice(i,1);}else Object.assign(this._pending.row,copyRow(this._pending.before));this._pending=null;}
    if(this._family?.pending===this)this._family.pending=null;
    this._family?.members.delete(this);super.dispose();
  }
}
