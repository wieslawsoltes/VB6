import {assertData} from './common.js';

/** Lossless SQL token positions. Parameter substitution never visits quoted strings or comments. */
export function sqlTokens(source) {
  source=String(source);assertData(source.length<=1000000,'SQL length limit exceeded',7);
  const tokens=[];let i=0;
  while(i<source.length){
    const start=i,c=source[i];
    if(/\s/.test(c)){i++;continue;}
    if(source.startsWith('--',i)){i=source.indexOf('\n',i);if(i<0)break;continue;}
    if(source.startsWith('/*',i)){const end=source.indexOf('*/',i+2);assertData(end>=0,'Unterminated SQL comment');i=end+2;continue;}
    if(c==="'"||c==='"'||c==='`'||c==='['){
      const close=c==='['?']':c;let value='',closed=false;i++;
      while(i<source.length){const ch=source[i++];if(ch===close){if(source[i]===close){value+=close;i++;}else{closed=true;break;}}else value+=ch;}
      assertData(closed,'Unterminated SQL quote');tokens.push({kind:c==="'"?'string':'identifier',value,start,end:i});continue;
    }
    const number=source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if(number){i+=number[0].length;tokens.push({kind:'number',value:number[0],start,end:i});continue;}
    const word=source.slice(i).match(/^[A-Za-z_\u0080-\uffff][\w$\u0080-\uffff]*/);
    if(word){i+=word[0].length;tokens.push({kind:'word',value:word[0],start,end:i});continue;}
    const pair=source.slice(i,i+2);i+=['<=','>=','<>','!='].includes(pair)?2:1;
    tokens.push({kind:'symbol',value:source.slice(start,i),start,end:i});
    assertData(tokens.length<=100000,'SQL token limit exceeded',7);
  }
  return tokens;
}
export const DAO_TYPES=Object.freeze({1:11,2:17,3:2,4:3,5:6,6:4,7:5,8:7,9:128,10:202,11:205,12:203,15:72,16:20,20:14,21:14,23:135});
const declarationTypes={bit:1,boolean:1,yesno:1,byte:2,tinyint:2,short:3,smallint:3,integer:3,long:4,int:4,counter:4,currency:5,money:5,single:6,real:6,double:7,float:7,datetime:8,date:8,time:8,binary:9,varbinary:9,text:10,char:10,varchar:10,nvarchar:10,longbinary:11,oleobject:11,memo:12,longtext:12,guid:15,uniqueidentifier:15,bigint:16,decimal:20,numeric:20};
/** Access PARAMETERS declarations and SQL parameter markers become ordered, bound arguments. */
export function parameterPlan(source) {
  source=String(source);const tokens=sqlTokens(source),parameters=[];let start=0,index=0;
  const take=()=>tokens[index++],expect=value=>{const t=take();assertData(t?.value.toUpperCase()===value,'Invalid PARAMETERS declaration');return t;};
  if(tokens[0]?.value.toUpperCase()==='PARAMETERS'){
    index=1;
    while(index<tokens.length){
      const name=take();assertData(['word','identifier'].includes(name?.kind),'A parameter name is required');
      const type=take(),code=declarationTypes[type?.value.toLowerCase()];assertData(code,'Unsupported DAO parameter type: '+type?.value,3251);
      let size=0;if(tokens[index]?.value==='('){index++;const value=take();size=Number(value?.value);assertData(value?.kind==='number'&&Number.isSafeInteger(size)&&size>0&&size<=1048576,'Invalid parameter size');expect(')');}
      assertData(!parameters.some(p=>p.Name.toLowerCase()===name.value.toLowerCase()),'Duplicate query parameter',3001);
      parameters.push({Name:name.value,Type:code,Size:size});const separator=take();assertData(separator&&[',',';'].includes(separator.value),'Invalid PARAMETERS separator');if(separator.value===';'){start=separator.end;break;}
    }
    assertData(start,'PARAMETERS requires a terminating semicolon');
  }
  const lookup=new Map(parameters.map((p,i)=>[p.Name.toLowerCase(),i])),declared=new Set(lookup.keys()),bindings=[];let out='',last=start,positional=0;
  const add=(name,position)=>{
    let n=lookup.get(name.toLowerCase());if(n===undefined){n=parameters.length;parameters.push({Name:name,Type:0,Size:0});lookup.set(name.toLowerCase(),n);}bindings.push(n);return n;
  };
  for(let i=index;i<tokens.length;i++){
    const token=tokens[i];if(token.start<start)continue;let end=token.end,name=null;
    if(token.value==='?'){name='p'+(++positional);add(name,i);}
    else if([':', '@', '$'].includes(token.value)&&['word','identifier'].includes(tokens[i+1]?.kind)){name=tokens[++i].value;end=tokens[i].end;add(name,i);}
    else if(['word','identifier'].includes(token.kind)&&declared.has(token.value.toLowerCase())&&tokens[i-1]?.value!=='.'&&tokens[i+1]?.value!=='.'){name=token.value;bindings.push(lookup.get(name.toLowerCase()));}
    if(name!==null){out+=source.slice(last,token.start)+'?';last=end;}
  }
  out+=source.slice(last);return {text:out.trim(),parameters,bindings};
}
/** Only direct, unaliased single-table projections can acquire a portable keyed writer. */
export function simpleSelect(source) {
  const tokens=sqlTokens(source);let i=0;if(tokens[i++]?.value.toUpperCase()!=='SELECT')return null;
  const columns=[];let wildcard=false;
  while(i<tokens.length){
    const t=tokens[i++];if(t.value==='*'){if(columns.length)return null;wildcard=true;}
    else if(['word','identifier'].includes(t.kind))columns.push(t.value);else return null;
    if(tokens[i]?.value===','){if(wildcard)return null;i++;continue;}break;
  }
  if(tokens[i++]?.value.toUpperCase()!=='FROM')return null;
  const table=tokens[i++];if(!['word','identifier'].includes(table?.kind))return null;
  const next=tokens[i]?.value.toUpperCase();if(next&&!['WHERE','ORDER','LIMIT',';'].includes(next))return null;
  // Reject compound selects, aggregation and extra top-level source clauses, even if names align.
  let depth=0;for(;i<tokens.length;i++){const t=tokens[i];if(t.value==='(')depth++;if(t.value===')')depth--;if(depth<0)return null;if(!depth&&t.kind==='word'&&['JOIN','UNION','INTERSECT','EXCEPT','GROUP','HAVING','RETURNING','FROM'].includes(t.value.toUpperCase()))return null;if(t.value===';'&&i!==tokens.length-1)return null;}
  return depth===0?{table:table.value,columns:wildcard?null:columns}:null;
}
