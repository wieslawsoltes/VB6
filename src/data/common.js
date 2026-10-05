import {VBError} from '../language/lexer.js';
import {VBArray, VBCurrency, VBDecimal} from '../runtime/values.js';

export const DATA_LIMITS = Object.freeze({rows:100000, cells:1000000, bytes:20*1024*1024, pages:100});
export const DATA_CONSTANTS = Object.freeze({
  adStateClosed:0, adStateOpen:1, adStateConnecting:2, adStateExecuting:4,
  adOpenForwardOnly:0, adOpenKeyset:1, adOpenDynamic:2, adOpenStatic:3,
  adLockReadOnly:1, adLockPessimistic:2, adLockOptimistic:3, adLockBatchOptimistic:4,
  adUseServer:2, adUseClient:3, adCmdText:1, adCmdTable:2, adCmdStoredProc:4,
  adExecuteNoRecords:128, adParamInput:1, adParamOutput:2, adParamInputOutput:3,
  adParamReturnValue:4, adSchemaTables:20, adSchemaColumns:4,
  adModeRead:1, adModeWrite:2, adModeReadWrite:3,
  adSmallInt:2, adInteger:3, adSingle:4, adDouble:5, adCurrency:6,
  adDate:7, adBoolean:11, adVariant:12, adDecimal:14, adGUID:72, adNumeric:131, adDBDate:133, adDBTime:134, adDBTimeStamp:135, adUnsignedTinyInt:17, adBigInt:20,
  adBinary:128, adChar:129, adWChar:130, adVarChar:200, adLongVarChar:201,
  adVarWChar:202, adLongVarWChar:203, adVarBinary:204, adLongVarBinary:205,
  adAffectCurrent:1, adAffectGroup:2, adAffectAll:3, adLockUnspecified:-1,
  adFilterNone:0, adFilterPendingRecords:1, adFilterAffectedRecords:2,
  adFilterFetchedRecords:3, adFilterConflictingRecords:5,
  adRecOK:0, adRecNew:1, adRecModified:2, adRecDeleted:4,
  adRecPendingChanges:128, adRecConcurrencyViolation:2048, adRecIntegrityViolation:4096,
  adResyncUnderlyingValues:1, adResyncAllValues:2, adClipString:2,
  adBookmark:8192, adApproxPosition:16384, adMovePrevious:512, adHoldRecords:256,
  adFind:524288, adUpdateBatch:65536, adResync:131072,
  adAddNew:16778240, adDelete:16779264, adUpdate:16809984,
  dbOpenSnapshot:4, dbOpenDynaset:2, dbOpenTable:1, dbOpenForwardOnly:8, dbReadOnly:4,
  dbFailOnError:128, dbUseJet:2, dbUseODBC:1, dbEditNone:0, dbEditInProgress:1, dbEditAdd:2,
  dbUpdateRegular:1, dbUpdateBatch:4, dbOptimistic:3, dbOptimisticValue:1, dbPessimistic:2, dbOptimisticBatch:5, dbAutoIncrField:16, dbDescending:1,
  dbBoolean:1, dbByte:2, dbInteger:3, dbLong:4, dbCurrency:5, dbSingle:6,
  dbDouble:7, dbDate:8, dbBinary:9, dbText:10, dbLongBinary:11, dbMemo:12, dbGUID:15,
  dbBigInt:16, dbDecimal:20, dbNumeric:21, dbTimeStamp:23,
});
export function dataError(message, number=3001){return new VBError(message,number,'VB6.Data');}
export function assertData(condition,message,number=3001){if(!condition)throw dataError(message,number);}
export function after(value,callback){return value && typeof value.then==='function'?value.then(callback):callback(value);}
export function dataList(value){return value instanceof VBArray?[...value]:Array.isArray(value)?value:value===undefined?[]:[value];}
export function sqlValue(value){
  if(value==null)return null;
  if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();
  if(value instanceof Date)return value.toISOString();
  if(value instanceof VBArray)return Uint8Array.from([...value]);
  if(value instanceof Uint8Array)return value;
  if(typeof value==='boolean')return value?1:0;
  assertData(typeof value==='string'||typeof value==='number','Unsupported parameter value',13);
  assertData(typeof value!=='number'||Number.isFinite(value),'Non-finite data value',13);
  return value;
}
export function quoteIdentifier(value){return '"'+String(value).replace(/"/g,'""')+'"';}
export function sameValue(a,b){
  if(a instanceof Uint8Array&&b instanceof Uint8Array)return a.length===b.length&&a.every((v,i)=>v===b[i]);
  if(a instanceof Date&&b instanceof Date)return +a===+b;
  return Object.is(a,b);
}
/** ADO/ODBC strings: quotes, braces, escaped delimiters, case-insensitive keys. */
export function parseConnectionString(text){
  const result=Object.create(null);text=String(text??'');let i=0;
  assertData(text.length<=32768,'Connection string is too long',7);
  while(i<text.length){
    while(/[;\s]/.test(text[i]||'')&&i<text.length)i++;
    if(i===text.length)break;
    const start=i;while(i<text.length&&text[i]!=='='&&text[i]!==';')i++;
    assertData(text[i]==='=','Expected key=value in connection string');
    const key=text.slice(start,i++).trim().toLowerCase();assertData(key,'Empty connection property');
    while(/\s/.test(text[i]||'')&&i<text.length)i++;
    let value='';const opening=text[i],closing=opening==='{'?'}':opening;
    if(['"',"'",'{'].includes(opening)){
      i++;let closed=false;
      while(i<text.length){const ch=text[i++];if(ch===closing){if(text[i]===closing){value+=closing;i++;}else{closed=true;break;}}else value+=ch;}
      assertData(closed,'Unterminated connection-string value');
      while(/\s/.test(text[i]||'')&&i<text.length)i++;
      assertData(i===text.length||text[i]===';','Unexpected text after quoted value');
    }else{const start=i;while(i<text.length&&text[i]!==';')i++;value=text.slice(start,i).trim();}
    assertData(!Object.hasOwn(result,key),'Duplicate connection property: '+key);
    result[key]=value;
  }
  return result;
}
export function connectionConfiguration(value,profiles=[]){
  if(value&&typeof value==='object')return structuredClone(value);
  const text=String(value??'');const named=profiles.find(p=>p.name.toLowerCase()===text.toLowerCase());
  if(named)return structuredClone(named);
  const fields=parseConnectionString(text);
  if(fields.name){const profile=profiles.find(p=>p.name.toLowerCase()===fields.name.toLowerCase());assertData(profile,'Data connection not found',3706);return structuredClone(profile);}
  const provider=(fields.provider||'SQLite').toLowerCase();
  const result={provider,database:fields['data source']||fields.database||':memory:'};
  if(['rest','json','odata','graphql','gateway'].includes(provider))result.url=fields['data source']||fields.url||'';
  if(fields['rows path'])result.rowsPath=fields['rows path'];
  if(fields['credential reference'])result.credentialRef=fields['credential reference'];
  if(fields.profile)result.profile=fields.profile;
  if(fields['read only'])result.readOnly=/^(true|yes|1)$/i.test(fields['read only']);
  return result;
}
const SECRET=/^(?:(?:x|proxy)[-_ ]?)?(password|pwd|token|secret|authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|cookie|set[-_ ]?cookie)$/i;
export function assertPublicConfiguration(config){
  function check(value){
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      assertData(!SECRET.test(key)||item==null||item==='','Store credentials at runtime, not in project data connections',70);
      if(typeof item==='string'&&/connectionstring/i.test(key)){
        for(const [part,v] of Object.entries(parseConnectionString(item)))assertData(!SECRET.test(part)||!v,'Remove credentials from connection strings before saving',70);
      }
      if(typeof item==='string'&&/^(url|endpoint|nexturl|baseurl)$/i.test(key)&&item){
        const u=new URL(item,'http://project.invalid');assertData(!u.username&&!u.password,'Credentials in URLs cannot be shipped',70);
        for(const param of u.searchParams.keys())assertData(!SECRET.test(param),'Secret query parameters cannot be shipped',70);
      }
      check(item);
    }
  }
  check(config);return config;
}
export function normalizeDataSources(value){
  if(!value)return {version:1,connections:[],commands:[]};
  assertData(value.version===1,'Unsupported data-source configuration version');
  assertData(Array.isArray(value.connections)&&Array.isArray(value.commands),'Invalid data-source configuration');
  assertData(value.connections.length<=256&&value.commands.length<=2048,'Too many data objects',7);
  const result=structuredClone(value),names=new Set(['connections','commands','setcredential','clearcredentials','constructor','prototype','__type']);
  for(const entry of [...result.connections,...result.commands]){
    assertData(/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(entry.name),'Use a Visual Basic identifier for data objects');
    const key=entry.name.toLowerCase();assertData(!names.has(key),'Duplicate data object: '+entry.name);names.add(key);
  }
  for(const command of result.commands){
    assertData(!names.has(('rs'+command.name).toLowerCase()),'A generated recordset name conflicts with a data object');names.add(('rs'+command.name).toLowerCase());
    assertData(result.connections.some(c=>c.name.toLowerCase()===String(command.connection).toLowerCase()),'Command connection does not exist');
    assertData(!command.parameters||Array.isArray(command.parameters)&&command.parameters.length<=1024,'Invalid command parameters');
    const parameters=new Set();for(const p of command.parameters||[]){assertData(/^[A-Za-z][A-Za-z0-9_]*$/.test(p.name)&&!parameters.has(p.name.toLowerCase()),'Invalid or duplicate parameter name');parameters.add(p.name.toLowerCase());}
  }
  for(const connection of result.connections){
    assertData(typeof connection.provider==='string'&&connection.provider,'A provider is required');
    if(connection.fields){assertData(Array.isArray(connection.fields)&&connection.fields.length<=1024,'Invalid field mapping');const fields=new Set();for(const f of connection.fields){assertData(typeof f.name==='string'&&f.name&&!fields.has(f.name.toLowerCase()),'Duplicate or empty field mapping');fields.add(f.name.toLowerCase());pathValue({},f.path||f.name);}}
    if(connection.timeout!=null)assertData(Number.isFinite(Number(connection.timeout))&&Number(connection.timeout)>0&&Number(connection.timeout)<=600,'Invalid connection timeout');
  }
  return assertPublicConfiguration(result);
}
export function safeHttpURL(value,base){
  let url;try{url=new URL(value,base);}catch{throw dataError('Invalid HTTP data-source URL');}
  assertData(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'Only HTTP(S) URLs without embedded credentials are supported',70);
  url.hash='';return url;
}
export function pathValue(value,path=''){
  if(!path)return value;
  if(value&&Object.hasOwn(Object(value),path))return value[path];
  const parts=String(path).replace(/^\$\.?/,'').split('.');
  for(const key of parts){assertData(key&&!['__proto__','constructor','prototype'].includes(key),'Invalid JSON field path');value=value!=null&&Object.hasOwn(Object(value),key)?value[key]:undefined;}
  return value;
}
export function columnType(value){
  if(value instanceof Uint8Array)return 204;
  if(value instanceof Date)return 7;
  if(typeof value==='boolean')return 11;
  if(typeof value==='number')return Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?3:5;
  if(value===null||value===undefined)return 12;
  return typeof value==='string'?202:12;
}
export function resultFromRows(rows,fields){
  assertData(Array.isArray(rows),'Data response must contain an array of records',13);
  assertData(rows.length<=DATA_LIMITS.rows,'Row limit exceeded',7);
  assertData(rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)),'Every record must be a JSON object',13);
  const keys=new Set();if(!fields?.length)for(const row of rows)for(const key of Object.keys(row)){keys.add(key);assertData(keys.size<=1024,'Column limit exceeded',7);}
  const names=fields?.length?fields.map(f=>f.name):[...keys];
  assertData(names.length<=1024&&names.length*rows.length<=DATA_LIMITS.cells,'Result allocation limit exceeded',7);
  const columns=names.map((name,index)=>{
    const definition=fields?.[index],path=definition?.path||name;
    const samples=rows.map(row=>pathValue(row,path)).filter(v=>v!=null);
    const types=new Set(samples.map(columnType));
    let type=types.size===1?[...types][0]:[...types].every(t=>[3,5].includes(t))?5:12;
    if(definition?.type!=null)type=Number(definition.type);
    return {Name:name,Type:type,DefinedSize:definition?.size||0,path};
  });
  const values=rows.map(row=>columns.map(col=>pathValue(row,col.path)??null));
  return {columns,values,rowsAffected:0};
}
