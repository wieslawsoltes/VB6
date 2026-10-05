import {dataDefault} from './defaults.js';
import {VBError} from '../language/lexer.js';
import {VBArray,VBCurrency,VBDecimal,coerce,bankersRound,numeric,binary,truth} from '../runtime/values.js';

// Disconnected client-side cursor. ConnectedRecordset adds explicit provider I/O.
const TYPES=new Map([[2,'Integer'],[3,'Long'],[4,'Single'],[5,'Double'],[6,'Currency'],[7,'Date'],[11,'Boolean'],[17,'Byte'],[16,'Integer'],[18,'Long'],[19,'Double'],[21,'Decimal'],[8,'String'],[129,'String'],[130,'String'],[200,'String'],[201,'String'],[202,'String'],[203,'String'],[12,'Variant'],[20,'Variant'],[14,'Decimal'],[131,'Decimal'],[72,'GUID'],[133,'Date'],[134,'Date'],[135,'Date'],[128,'Binary'],[204,'Binary'],[205,'Binary']]);
// Additional integer widths returned by native OLE DB schema rowsets.
const INTEGER_RANGES=new Map([[16,[-128n,127n]],[18,[0n,65535n]],[19,[0n,4294967295n]],[21,[0n,(1n<<64n)-1n]]]);
const fold=value=>String(value).toLowerCase();
const copy=value=>value instanceof Date?new Date(value):value instanceof Uint8Array?value.slice():value;
const args=value=>value instanceof VBArray?[...value]:Array.isArray(value)?value:[value];
function fail(message,number=3001){throw new VBError(message,number);}
function integer(value){return bankersRound(numeric(value));}
export function fieldValue(column,value){
  if(value===null||value===undefined)return null;
  const type=TYPES.get(column.Type);if(!type)fail('Field type is not supported by the disconnected provider',3251);
  const bounds=INTEGER_RANGES.get(column.Type);
  if(bounds){
    // Reject already-rounded JS 64-bit inputs; strings/Decimal/BigInt are exact.
    if(column.Type===21&&typeof value==='number'&&Math.abs(value)>Number.MAX_SAFE_INTEGER)fail('Overflow',6);
    const n=Number.isSafeInteger(value)?BigInt(value):coerce(value,'Decimal').roundedInteger();
    if(n<bounds[0]||n>bounds[1])fail('Overflow',6);
    return column.Type===21?VBDecimal.fromParts(n,0):Number(n);
  }
  if(type==='Binary'){if(value instanceof VBArray&&[...value].some(v=>!Number.isInteger(v)||v<0||v>255))fail('Binary field requires byte values',13);const bytes=value instanceof VBArray?Uint8Array.from([...value]):value;if(!(bytes instanceof Uint8Array))fail('Binary field requires a byte array',13);if(column.DefinedSize&&bytes.length>column.DefinedSize)fail('Binary field exceeds DefinedSize',372);return bytes.slice();}
  if(type==='GUID'){const text=String(value).replace(/^\{(.*)\}$/,'$1');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text))fail('Invalid GUID value',13);return '{'+text.toUpperCase()+'}';}
  const result=coerce(value,type);
  if(type==='String'&&column.DefinedSize&&result.length>column.DefinedSize)fail('Field value exceeds DefinedSize',372);
  return result;
}
function compare(a,b){if(a===b)return 0;if(a==null)return -1;if(b==null)return 1;if(typeof a==='string'&&typeof b==='string'){a=fold(a);b=fold(b);}if(a instanceof VBCurrency&&b instanceof VBCurrency)return a.raw<b.raw?-1:a.raw>b.raw?1:0;return a<b?-1:a>b?1:0;}

/** Cached row view, typed fields, pending edits and stable row bookmarks. */
export class DisconnectedRecordset {
  constructor(){
    this.rows=[];this.columns=[];this.position=0;this._state=0;this._lock=3;this._filter='';this._sort='';this._predicate=null;this._sortSpecs=[];this._cache=null;this._pending=null;this._observers=new Set();this._bookmarks=new WeakMap();this._nextBookmark=1;this.revision=0;
    const rs=this;
    this.Fields={
      Append(name,type=200,size=0){
        if(rs.State)fail('Fields cannot be appended to an open Recordset',3219);
        name=String(name);type=integer(type);size=integer(size);
        if(!name||name.length>255||size<0||size>2000000)fail('Invalid field definition');
        if(rs.columns.some(c=>fold(c.Name)===fold(name)))fail('Field already exists',3191);
        if(rs.columns.length>=1024)fail('Field limit exceeded',7);
        if(!TYPES.has(type))fail('Field type is not implemented by the disconnected provider',3251);
        rs.columns.push(Object.freeze({Name:name,Type:type,DefinedSize:size}));
      },
      get Count(){return rs.columns.length;},
      setItem(key,value){this.Item(key).Value=value;},
      Item(key){const col=rs.column(key);return dataDefault({Name:col.Name,Type:col.Type,DefinedSize:col.DefinedSize,get Value(){return copy(rs.current()[col.Name]);},set Value(value){rs.edit(col,value);},get OriginalValue(){const row=rs.current();return copy(rs._pending?.row===row?rs._pending.before?.[col.Name]??null:row[col.Name]);}});},
      [Symbol.iterator](){return rs.columns.map(c=>this.Item(c.Name)).values();}
    };
  }
  get State(){return this._state;}
  get CursorLocation(){return 3;}set CursorLocation(v){if(this.State)fail('Recordset is open',3705);if(Number(v)!==3)fail('Only client-side cursors are supported',3251);}
  get CursorType(){return 3;}set CursorType(v){if(this.State)fail('Recordset is open',3705);if(Number(v)!==3)fail('Only a disconnected static cursor is supported',3251);}
  get LockType(){return this._lock;}set LockType(v){if(this.State)fail('Recordset is open',3705);if(![1,3].includes(Number(v)))fail('Only read-only and immediate optimistic locks are supported',3251);this._lock=Number(v);}
  requireOpen(){if(!this.State)fail('Operation is not allowed when the object is closed',3704);}
  requireWrite(){this.requireOpen();if(this._lock===1)fail('Recordset is read-only',3251);}
  column(key){const column=typeof key==='number'&&Number.isInteger(key)?this.columns[key]:typeof key==='string'?this.columns.find(c=>fold(c.Name)===fold(key)):null;if(!column)fail('Item cannot be found in the collection',3265);return column;}
  subscribe(callback){if(typeof callback!=='function')throw new TypeError('Expected observer function');this._observers.add(callback);return()=>this._observers.delete(callback);}
  notify(kind){this.revision++;for(const cb of [...this._observers]){try{cb({kind,recordset:this,revision:this.revision});}catch(error){this.lastObserverError=error;}}}
  view(){this.requireOpen();if(!this._cache){let rows=this._predicate?this.rows.filter(r=>this._predicate(r)||this._pending?.isNew&&this._pending.row===r):this.rows;if(this._sortSpecs.length)rows=[...rows].sort((a,b)=>{for(const [col,dir]of this._sortSpecs){const c=compare(a[col.Name],b[col.Name]);if(c)return c*dir;}return 0;});this._cache=rows;}return this._cache;}
  current(){this.requireOpen();const row=this.view()[this.position];if(!row)fail('Either BOF or EOF is True',3021);return row;}
  get RecordCount(){return this.view().length;}
  get EOF(){return !this.RecordCount||this.position>=this.RecordCount?-1:0;}
  get BOF(){return !this.RecordCount||this.position<0?-1:0;}
  get EditMode(){return this._pending?(this._pending.isNew?2:1):0;}
  get AbsolutePosition(){this.requireOpen();return this.BOF?-2:this.EOF?-3:this.position+1;}
  set AbsolutePosition(v){this.requireOpen();v=integer(v);if(v<1||v>this.RecordCount)fail('Invalid absolute position');this.moveTo(v-1);}
  get Bookmark(){const row=this.current();return this._bookmarks.get(row);}
  set Bookmark(v){this.requireOpen();this.Update();const n=integer(v),index=this.view().findIndex(row=>this._bookmarks.get(row)===n);if(index<0)fail('Bookmark is not valid in the current view',3001);this.position=index;this.notify('move');}
  Open(source,connection,cursor,lock,options){
    if(this.State)fail('Operation is not allowed when the object is open',3705);
    if(source!==undefined&&source!==''||connection!==undefined&&connection!==null&&connection!==''||options!==undefined&&Number(options)!==0)fail('Database connections, SQL, and persisted recordsets are not implemented',3251);
    if(cursor!==undefined)this.CursorType=cursor;if(lock!==undefined)this.LockType=lock;
    if(!this.columns.length)fail('A disconnected Recordset requires fields',3265);
    this._state=1;this.position=0;this._cache=null;this.notify('open');
  }
  Close(){this.requireOpen();this.Update();this._state=0;this.rows=[];this._cache=null;this._filter='';this._sort='';this._predicate=null;this._sortSpecs=[];this.position=0;this.notify('close');}
  changes(fields,values){const fs=args(fields),vs=args(values);if(fs.length!==vs.length)fail('Fields and Values must have equal length');const seen=new Set();return fs.map((key,i)=>{const col=this.column(key);if(seen.has(col))fail('A field appears more than once');seen.add(col);return[col,fieldValue(col,vs[i])];});}
  edit(column,value){this.requireWrite();const next=fieldValue(column,value),row=this.current();if(!this._pending)this._pending={row,before:Object.assign(Object.create(null),row),isNew:false};row[column.Name]=next;this.notify('edit');}
  AddNew(fields,values){
    this.requireWrite();const changes=fields===undefined?[]:this.changes(fields,values);
    if(this.rows.length>=100000||(this.rows.length+1)*this.columns.length>1000000)fail('Disconnected recordset allocation limit exceeded',7);
    this.Update();const previous=this.view()[this.position]||null,row=Object.create(null);for(const col of this.columns)row[col.Name]=null;for(const [col,value]of changes)row[col.Name]=value;
    this._bookmarks.set(row,this._nextBookmark++);this._pending={row,isNew:true,previous};this.rows.push(row);this._cache=null;this.position=this.view()===this.rows?this.rows.length-1:this.view().indexOf(row);this.notify('add');if(fields!==undefined)this.Update();
  }
  Update(fields,values){
    this.requireOpen();if(fields!==undefined){this.requireWrite();const changes=this.changes(fields,values),row=this.current();if(!this._pending)this._pending={row,before:Object.assign(Object.create(null),row),isNew:false};for(const [col,value]of changes)row[col.Name]=value;}
    if(!this._pending)return;
    const row=this._pending.row,old=this.position;this._pending=null;this._cache=null;const view=this.view(),index=view[old]===row?old:view.indexOf(row);this.position=index>=0?index:Math.min(old,view.length);this.notify('update');
  }
  CancelUpdate(){this.requireOpen();if(!this._pending)return;const pending=this._pending;this._pending=null;if(pending.isNew)this.rows.splice(this.rows.indexOf(pending.row),1);else for(const col of this.columns)pending.row[col.Name]=pending.before[col.Name];this._cache=null;const row=pending.isNew?pending.previous:pending.row;this.position=row?this.view().indexOf(row):0;this.notify('cancel');}
  Delete(affect=1){this.requireWrite();if(Number(affect)!==1)fail('Only deletion of the current row is implemented',3251);const row=this.current(),position=this.position;this._pending=null;this.rows.splice(this.rows.indexOf(row),1);this._cache=null;this.position=Math.min(position,this.RecordCount);this.notify('delete');}
  moveTo(position){this.requireOpen();this.Update();this.position=Math.max(-1,Math.min(this.RecordCount,position));this.notify('move');}
  MoveFirst(){this.moveTo(0);}MoveLast(){this.moveTo(this.RecordCount-1);}MoveNext(){this.moveTo(this.position+1);}MovePrevious(){this.moveTo(this.position-1);}Move(n,start){if(start!==undefined)this.Bookmark=start;this.moveTo(this.position+integer(n));}
  get Filter(){return this._filter;}
  set Filter(value){this.requireOpen();if(value===0)value='';if(typeof value!=='string')fail('Only criteria-string filters and adFilterNone are implemented',3251);const predicate=this.compileFilter(value);this.Update();this._filter=value;this._predicate=predicate;this._cache=null;this.position=0;this.notify('filter');}
  compileFilter(text){
    if(!text.trim())return null;if(text.length>16384)fail('Filter length limit exceeded',7);
    // Flat AND/OR expressions, evaluated left-to-right as ADO specifies. Grouped,
    // bookmark and batch-state filters are rejected rather than approximated.
    const clauses=[],joins=[];let rest=text;
    const token=/^\s*(?:\[((?:[^\]]|\]\])+)\]|([A-Za-z_][\w$]*))\s*(<=|>=|<>|=|<|>|LIKE\b)\s*(?:'((?:[^']|'')*)'|#([^#]+)#|\$?([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?))\s*/i;
    while(rest){if(clauses.length>=128)fail('Filter clause limit exceeded',7);const m=rest.match(token);if(!m)fail('Unsupported or malformed filter; grouped and Null criteria are not implemented',3251);const col=this.column(m[1]?.replace(/\]\]/g,']')??m[2]),op=m[3].toUpperCase();let value=m[4]!==undefined?m[4].replace(/''/g,"'"):m[5]!==undefined?coerce(m[5],'Date'):m[6];
      if(op==='LIKE'){if(TYPES.get(col.Type)!=='String')fail('LIKE requires a text field');const pattern=fold(value),left=/^[*%]/.test(pattern),right=/[*%]$/.test(pattern),body=pattern.slice(left?1:0,right?-1:undefined);if(/[*%]/.test(body)||left&&!right&&body)fail('LIKE supports trailing or surrounding wildcards only',3251);clauses.push(row=>{if(row[col.Name]==null)return false;const v=fold(row[col.Name]);return left&&right?v.includes(body):right?v.startsWith(body):v===body;});}
      else{value=fieldValue({...col,DefinedSize:0},value);clauses.push(row=>row[col.Name]!=null&&truth(binary(op,row[col.Name],value,'text')));}
      rest=rest.slice(m[0].length);if(!rest)break;const join=rest.match(/^(AND|OR)\b\s*/i);if(!join)fail('Grouped or malformed filters are not implemented',3251);joins.push(join[1].toUpperCase());rest=rest.slice(join[0].length);if(!rest)fail('Filter ends with an operator');
    }
    return row=>{let result=clauses[0](row);for(let i=1;i<clauses.length;i++)result=joins[i-1]==='AND'?result&&clauses[i](row):result||clauses[i](row);return result;};
  }
  get Sort(){return this._sort;}
  set Sort(value){this.requireOpen();value=String(value??'');if(value.length>16384)fail('Sort length limit exceeded',7);const specs=[];let rest=value.trim();while(rest){const m=rest.match(/^(?:\[((?:[^\]]|\]\])+)\]|([A-Za-z_][\w$]*))(?:\s+(ASC|DESC))?\s*(,|$)\s*/i);if(!m)fail('Invalid sort expression');const col=this.column(m[1]?.replace(/\]\]/g,']')??m[2]);if(specs.some(s=>s[0]===col))fail('Duplicate sort field');specs.push([col,m[3]?.toUpperCase()==='DESC'?-1:1]);rest=rest.slice(m[0].length);if(m[4]&&!rest)fail('Sort ends with a comma');}this.Update();this._sort=value;this._sortSpecs=specs;this._cache=null;this.position=0;this.notify('sort');}
  GetRows(count=-1,start,fields){this.requireOpen();if(start!==undefined)this.Bookmark=start;count=integer(count);if(count< -1)fail('Invalid row count');const cols=fields===undefined?this.columns:args(fields).map(k=>this.column(k)),rows=this.view().slice(Math.max(0,this.position),count===-1?undefined:Math.max(0,this.position)+count);if(!rows.length||!cols.length)return new VBArray();const array=new VBArray([[0,cols.length-1],[0,rows.length-1]]);rows.forEach((row,r)=>cols.forEach((col,c)=>array.set([c,r],row[col.Name])));this.moveTo(Math.max(0,this.position)+rows.length);return array;}
  // Read-through binding API: no full grid copy and no mutation through raw values.
  setRowValue(row,key,value,expected){this.requireWrite();if(!this.rows.includes(row))fail('Bound row has been deleted',3021);const col=this.column(key),next=fieldValue(col,value);if(expected!==undefined&&(!Object.is(row[col.Name],expected)&&!(row[col.Name] instanceof Date&&expected instanceof Date&&row[col.Name].getTime()===expected.getTime())&&!(row[col.Name] instanceof VBCurrency&&expected instanceof VBCurrency&&row[col.Name].raw===expected.raw)))fail('Bound value changed while the editor was active',3197);this.Update();const index=this.view().indexOf(row);if(index<0)fail('Bound row no longer belongs to the current view',3021);this.position=index;this.edit(col,next);this.Update();}
}
