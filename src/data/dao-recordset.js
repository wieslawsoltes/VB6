import {dataDefault} from './defaults.js';
import {assertData,after,dataList,sameValue} from './common.js';
import {fieldValue} from './recordset.js';
import {compileCriteria,compareData} from './criteria.js';
import {DAO_TYPES} from './sql-parameters.js';

const copy=v=>v instanceof Date?new Date(v):v instanceof Uint8Array?v.slice():v;
const rowCopy=r=>Object.fromEntries(Object.entries(r||{}).map(([k,v])=>[k,copy(v)]));
const daoType=ado=>Number(Object.keys(DAO_TYPES).find(k=>DAO_TYPES[k]===ado)||0);
const bracket=n=>'['+String(n).replace(/]/g,']]')+']';

/** DAO has an explicit copy buffer: field assignments do not auto-enter Edit, and navigation discards edits. */
export class DAORecordset {
  constructor(cursor,database,type=2,source='',tableDef=null){
    this.__type='DAO.Recordset';this.cursor=cursor;this.database=database;this.Type=type;this.Name=String(source);this._tableDef=tableDef;
    this._mode=0;this._buffer=null;this._original=null;this._row=null;this._busy=false;this._deleted=false;this._lastModified=null;this._index='';this._noMatch=false;this._filter='';this._sort='';
    this.Fields={get Count(){return cursor.Fields.Count;},Item:key=>this.field(key),setItem:(key,value)=>{this.field(key).Value=value;},[Symbol.iterator]:()=>cursor.columns.map(c=>this.field(c.Name))[Symbol.iterator]()};
    database?.Recordsets.items.push(this);
  }
  require(){assertData(this.cursor.State===1,'Recordset is closed',3420);assertData(!this._busy,'A recordset operation is pending',3219);}
  get State(){return this.cursor.State;}
  get BOF(){this.require();return this.cursor.BOF;}
  get EOF(){this.require();return this.cursor.EOF;}
  get RecordCount(){this.require();return this.cursor.RecordCount;}
  get Updatable(){return this.cursor.State&&this.cursor.LockType!==1?-1:0;}
  get Restartable(){return this.Type===8?0:-1;}
  get Bookmarkable(){return this.Type===8?0:-1;}
  get EditMode(){this.require();return this._mode;}
  get NoMatch(){return this._noMatch?-1:0;}
  get LockEdits(){return 0;}
  set LockEdits(value){assertData(!value,'Pessimistic page locking is unavailable on materialized DAO cursors',3251);}
  Item(key){return this.Fields.Item(key).Value;}
  setItem(key,value){this.Fields.Item(key).Value=value;}
  field(key){
    const rs=this,c=rs.cursor.column(key),meta=rs._tableDef?.Fields.items.find(f=>f.Name.toLowerCase()===c.Name.toLowerCase());
    const field={__type:'DAO.Field',Name:c.Name,Type:meta?.Type??daoType(c.Type),Size:meta?.Size||c.DefinedSize||0,Attributes:meta?.Attributes||0,Required:meta?.Required||false,
      get Value(){rs.require();assertData(!rs._deleted,'Record is deleted',3167);return copy(rs._mode?rs._buffer[c.Name]:rs.cursor.current()[c.Name]);},
      set Value(value){rs.require();assertData(rs._mode,'Edit or AddNew is required before assigning a DAO field',3020);assertData(!rs._deleted,'Record is deleted',3167);assertData(!(field.Attributes&16)||rs._mode===2,'AutoNumber field is read-only',3164);const next=fieldValue({...c,Type:DAO_TYPES[field.Type]||c.Type,DefinedSize:field.Size},value);assertData(!field.Required||next!=null,'Required field cannot be Null',3314);assertData(meta?.AllowZeroLength!==false||next!=='','Zero-length text is not allowed',3315);rs._buffer[c.Name]=next;},
      get OriginalValue(){rs.require();return copy(rs._original?.[c.Name]??(rs._mode===2?null:rs.cursor.current()[c.Name]));},
      get FieldSize(){const value=field.Value;return value==null?0:typeof value==='string'?value.length*2:value.length??(field.Type===3?2:field.Type===2?1:4);},
      GetChunk(offset,length){offset=Number(offset);length=Number(length);assertData(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(length)&&length>=0,'Invalid chunk range',5);const value=field.Value;if(value==null)return null;assertData(typeof value==='string'||value instanceof Uint8Array,'Chunk requires text or binary',3251);return value.slice(offset,offset+length);},
      AppendChunk(value){const old=field.Value;assertData(old==null||typeof old===typeof value,'Chunk type mismatch',13);if(typeof value==='string')field.Value=(old||'')+value;else{assertData(value instanceof Uint8Array&&(old==null||old instanceof Uint8Array),'Binary chunk requires bytes',13);const result=new Uint8Array((old?.length||0)+value.length);if(old)result.set(old);result.set(value,old?.length||0);field.Value=result;}}
    };return dataDefault(field);
  }
  Edit(){this.require();assertData(this.Updatable,'Recordset is read-only',3027);this.CancelUpdate();assertData(!this._deleted,'Record is deleted',3167);const row=this.cursor.current();this._row=row;this._buffer=rowCopy(row);this._original=rowCopy(row);this._mode=1;}
  AddNew(){this.require();assertData(this.Updatable,'Recordset is read-only',3027);this.CancelUpdate();this._mode=2;this._buffer=Object.fromEntries(this.cursor.columns.map(c=>[c.Name,null]));this._row=null;this._original=null;this._deleted=false;}
  CancelUpdate(){this.require();this._mode=0;this._buffer=null;this._original=null;this._row=null;}
  async Update(updateType=1,force=false){
    this.require();assertData(Number(updateType)===1&&!force,'Forced/batch DAO updates require ODBCDirect support',3251);assertData(this._mode,'Edit or AddNew is required before Update',3020);
    const cursor=this.cursor,insert=this._mode===2,previous=cursor.view()[cursor.position],oldPosition=cursor.position,before=insert?null:rowCopy(this._row);
    for(const f of this._tableDef?.Fields||[])if(f.Required&&!(f.Attributes&16)&&(!insert||!f.DefaultValue))assertData(this._buffer[f.Name]!=null,'Required field cannot be Null: '+f.Name,3314);
    this._busy=true;let changedRow=null;
    try{
      if(insert){await cursor.AddNew();changedRow=cursor.current();}
      else{assertData(cursor.current()===this._row,'Current record changed while editing',3219);changedRow=this._row;}
      // Enter the provider edit using the original DAO copy-buffer snapshot for conflict detection.
      for(const c of cursor.columns)cursor.edit(c,this._buffer[c.Name]);
      if(!insert)cursor._pending.before=rowCopy(this._original);
      await cursor.Update();this._lastModified=cursor._bookmarks.get(changedRow);this._mode=0;this._buffer=null;this._original=null;this._row=null;
      if(insert){cursor._cache=null;cursor.position=previous?cursor.view().indexOf(previous):0;cursor.notify('move');}
    }catch(error){
      if(cursor.State){if(cursor._pending){if(!insert)cursor._pending.before=before;cursor.CancelUpdate();}cursor.position=Math.min(oldPosition,cursor.RecordCount);}
      throw error;
    }finally{this._busy=false;}
  }
  async Delete(){this.require();assertData(this.Updatable,'Recordset is read-only',3027);assertData(!this._deleted,'Record is deleted',3167);this.CancelUpdate();this._busy=true;try{await this.cursor.Delete();this._deleted=true;}finally{this._busy=false;}}
  move(position,forward=false){this.require();if(this.Type===8)assertData(forward,'Forward-only cursor does not support repositioning',3219);this.CancelUpdate();this._deleted=false;this._noMatch=false;return this.cursor.moveTo(position);}
  MoveFirst(){return this.move(0);}MoveLast(){return this.move(this.RecordCount-1);}
  MoveNext(){this.require();assertData(!this.cursor.EOF||this._deleted,'No current record',3021);return this.move(this.cursor.position+(this._deleted?0:1),true);}
  MovePrevious(){this.require();assertData(!this.cursor.BOF,'No current record',3021);return this.move(this.cursor.position-1);}
  Move(count,start){count=Number(count);assertData(Number.isSafeInteger(count),'Invalid movement',5);if(start!==undefined)this.Bookmark=start;return this.move(this.cursor.position+count,count>=0);}
  get Bookmark(){this.require();assertData(this.Bookmarkable,'Forward-only cursor has no bookmarks',3251);assertData(!this._deleted,'Record is deleted',3167);return this.cursor.Bookmark;}
  set Bookmark(value){this.require();assertData(this.Bookmarkable,'Forward-only cursor has no bookmarks',3251);this.CancelUpdate();this.cursor.Bookmark=value;this._deleted=false;this._noMatch=false;}
  get LastModified(){this.require();assertData(this._lastModified!=null,'No record was modified by this cursor',3021);return this._lastModified;}
  get AbsolutePosition(){this.require();assertData(this.Type!==1&&this.Type!==8,'AbsolutePosition requires a dynaset or snapshot',3251);return this.cursor.BOF||this.cursor.EOF?-1:this.cursor.position;}
  set AbsolutePosition(value){value=Number(value);assertData(Number.isSafeInteger(value)&&value>=0&&value<this.RecordCount,'Invalid AbsolutePosition',3001);assertData(this.Type!==1,'AbsolutePosition is unavailable on table cursors',3251);this.move(value);}
  get PercentPosition(){return this.AbsolutePosition<0?-1:this.RecordCount<=1?0:this.AbsolutePosition*100/(this.RecordCount-1);}
  set PercentPosition(value){value=Number(value);assertData(Number.isFinite(value)&&value>=0&&value<=100,'Invalid PercentPosition',5);this.AbsolutePosition=Math.round((this.RecordCount-1)*value/100);}
  find(criteria,start,direction){this.require();assertData([2,4].includes(this.Type),'Find requires a dynaset or snapshot',3251);const predicate=compileCriteria(criteria,this.cursor.columns);this.CancelUpdate();const rows=this.cursor.view();this._noMatch=true;for(let i=start;i>=0&&i<rows.length;i+=direction)if(predicate(rows[i])){this.cursor.position=i;this._deleted=false;this._noMatch=false;this.cursor.notify('move');break;}}
  FindFirst(criteria){return this.find(criteria,0,1);}FindLast(criteria){return this.find(criteria,this.RecordCount-1,-1);}
  FindNext(criteria){return this.find(criteria,this.cursor.position+1,1);}FindPrevious(criteria){return this.find(criteria,this.cursor.position-1,-1);}
  get Index(){return this._index;}
  set Index(name){this.require();assertData(this.Type===1&&this._tableDef,'Index requires a table cursor',3251);const index=this._tableDef.Indexes.Item(name);assertData(index.Fields.Count,'Index has no fields',3265);this.CancelUpdate();this.cursor.Sort=index.Fields.items.map(f=>bracket(f.Name)+(f.Attributes&1?' DESC':' ASC')).join(',');this._index=index.Name;this._deleted=false;}
  Seek(comparison,...keys){
    this.require();assertData(this.Type===1&&this._index,'Set an Index on a table cursor before Seek',3251);assertData(['=','<','<=','>','>='].includes(comparison),'Invalid Seek comparison',3001);const index=this._tableDef.Indexes.Item(this._index);
    assertData(keys.length===index.Fields.Count,'Supply a key for every index column',3001);this.CancelUpdate();this._noMatch=true;
    const rows=this.cursor.view();for(let i=0;i<rows.length;i++){let n=0;for(let j=0;j<keys.length;j++){n=compareData(rows[i][index.Fields.Item(j).Name],keys[j]);if(n==null){n=null;break;}if(n)break;}if(n===null)continue;const matches={'=':n===0,'<>':n!==0,'<':n<0,'<=':n<=0,'>':n>0,'>=':n>=0}[comparison];if(matches){this.cursor.position=i;this._noMatch=false;this._deleted=false;this.cursor.notify('move');if(!['<','<='].includes(comparison))break;}}
  }
  get Filter(){return this._filter;}
  set Filter(value){this.require();compileCriteria(String(value),this.cursor.columns);this._filter=String(value);}
  get Sort(){return this._sort;}
  set Sort(value){this.require();const clone=this.cursor.Clone(1);try{clone.Sort=value;this._sort=clone.Sort;}finally{clone.dispose();}}
  Clone(){this.require();assertData(this.Type!==8,'Forward-only cursor cannot be cloned',3251);return new DAORecordset(this.cursor.Clone(),this.database,this.Type,this.Name,this._tableDef);}
  OpenRecordset(type=this.Type,options=0){this.require();type=Number(type);assertData([2,4].includes(type),'Filtered recordsets are dynasets or snapshots',3251);assertData((Number(options)&~4)===0,'Unsupported recordset options',3251);const clone=new DAORecordset(this.cursor.Clone(type===4||options&4?1:-1),this.database,type,this.Name,this._tableDef);clone.cursor._predicate=compileCriteria(this._filter,this.cursor.columns);clone.cursor._filter='';clone.cursor._cache=null;clone.cursor.position=0;if(this._sort)clone.cursor.Sort=this._sort;return clone;}
  GetRows(count){this.require();this.CancelUpdate();return this.cursor.GetRows(count);}
  CopyQueryDef(){this.require();assertData(this._queryDef,'Recordset was not opened from a QueryDef',3251);const copy=this.database.CreateQueryDef('',this._queryDef.SQL);for(const p of this._queryDef.Parameters)copy.Parameters.Item(p.Name).Value=p.Value;return copy;}
  async Requery(){this.require();this.CancelUpdate();if(this._reload){const fresh=await this._reload(),old=this.cursor;this.cursor=fresh.cursor;this.Fields={get Count(){return fresh.cursor.Fields.Count;},Item:key=>this.field(key),setItem:(key,value)=>{this.field(key).Value=value;},[Symbol.iterator]:()=>this.cursor.columns.map(c=>this.field(c.Name))[Symbol.iterator]()};fresh.database=null;const i=this.database.Recordsets.items.indexOf(fresh);if(i>=0)this.database.Recordsets.items.splice(i,1);old.dispose();}else await this.cursor.Requery();this._deleted=false;this._noMatch=false;}
  async Close(){this.require();this.CancelUpdate();await this.cursor.Close();if(this.database){const i=this.database.Recordsets.items.indexOf(this);if(i>=0)this.database.Recordsets.items.splice(i,1);}}
}
