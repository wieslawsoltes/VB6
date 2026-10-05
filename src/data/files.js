import {assertData,DATA_LIMITS,resultFromRows,sameValue,pathValue} from './common.js';
import {fieldValue} from './recordset.js';

export function parseCSV(text){
  text=String(text).replace(/^\uFEFF/,'');assertData(text.length<=DATA_LIMITS.bytes,'CSV file is too large',7);
  const records=[];let row=[],value='',quoted=false,closed=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=ch;continue;}
    if(ch==='"'){assertData(!value&&!closed,'Unexpected quote in CSV');quoted=true;}
    else if(ch===','){row.push(value);value='';closed=false;}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(value);records.push(row);row=[];value='';closed=false;assertData(records.length<=DATA_LIMITS.rows+1,'CSV row limit exceeded',7);}
    else{assertData(!closed,'Unexpected characters after a quoted CSV field');value+=ch;}
  }
  assertData(!quoted,'Unterminated CSV field');if(value||row.length||closed){row.push(value);records.push(row);}
  if(!records.length)return [];
  const headers=records.shift();assertData(headers.every(Boolean)&&new Set(headers.map(v=>v.toLowerCase())).size===headers.length,'CSV headers must be nonempty and unique');
  assertData(headers.length<=1024&&records.length*headers.length<=DATA_LIMITS.cells,'CSV allocation limit exceeded',7);
  return records.map(row=>{assertData(row.length===headers.length,'CSV records have inconsistent column counts');return Object.fromEntries(headers.map((key,i)=>[key,row[i]]));});
}
export function writeCSV(rows,headers){
  headers ||= Object.keys(rows[0]||{});const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  return [headers,...rows.map(row=>headers.map(key=>row[key]))].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
export class FileDataProvider {
  constructor(context,config){this.context=context;this.config=config;}
  open(){assertData(this.config.provider!=='csv'||!(this.config.fields||[]).some(f=>f.path&&f.path!==f.name),'CSV mappings must use their header names',3251);this.path=this.context.fs.normalize(this.config.database||'/data.json');assertData(this.context.fs.exists(this.path),'Data file not found',53);}
  read(){const text=this.context.fs.read(this.path);return this.config.provider==='csv'?parseCSV(text):JSON.parse(text);}
  execute(text=''){
    assertData(!text||text===this.path,'File providers expose the file as a recordset; SQL requires SQLite',3251);
    const result=resultFromRows(this.read(),this.config.fields);
    if(!this.config.readOnly&&this.config.keyField)result.write=(kind,row,before)=>{
      const rows=this.read(),key=this.config.keyField;
      const mapped=rows.map(raw=>Object.fromEntries(result.columns.map(c=>[c.Name,fieldValue(c,pathValue(raw,c.path)??null)])));
      const merge=(raw,value)=>{for(const column of result.columns){let node=raw;const path=String(column.path||column.Name).split('.');for(const part of path.slice(0,-1)){assertData(!['__proto__','constructor','prototype'].includes(part),'Invalid JSON write field');node=node[part]??={};}const last=path.at(-1);assertData(!['__proto__','constructor','prototype'].includes(last),'Invalid JSON write field');node[last]=column.Type===11&&value[column.Name]!=null?Boolean(value[column.Name]):value[column.Name];}return raw;};
      if(kind==='insert'){assertData(row[key]!=null&&!mapped.some(r=>sameValue(r[key],row[key])),'A unique key is required',3197);rows.push(merge({},row));}
      else{
        const index=mapped.findIndex(r=>sameValue(r[key],before[key]));
        assertData(index>=0&&result.columns.every(c=>sameValue(mapped[index][c.Name]??null,before[c.Name])),'Data file record changed since it was read',3197);
        if(kind==='delete')rows.splice(index,1);else{assertData(!mapped.some((r,i)=>i!==index&&sameValue(r[key],row[key])),'Duplicate key',3197);rows[index]=merge(rows[index],row);}
      }
      this.context.fs.write(this.path,this.config.provider==='csv'?writeCSV(rows,result.columns.map(c=>c.Name)):JSON.stringify(rows,null,2));this.context.persist?.();
    };
    return result;
  }
  schema(){return resultFromRows(this.execute().columns.map(c=>({COLUMN_NAME:c.Name,DATA_TYPE:c.Type})));}
  close(){}
}
