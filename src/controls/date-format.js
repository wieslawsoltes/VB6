/** DateTimePicker formats are not VB's Format() language: M is month, m minute. */
import {VBError} from '../language/lexer.js';
import {asDate} from '../runtime/calendar.js';
const fail=()=>{throw new VBError('Invalid date or date format',380);};
const tokenField={d:'day',M:'month',y:'year',h:'hour',H:'hour',m:'minute',s:'second',t:'dayPeriod',X:'callback'};
const clean=value=>String(value).replace(/[\u200e\u200f\u061c]/g,'');
const escape=value=>clean(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
const two=value=>String(value).padStart(2,'0');
export function dateFormatTokens(pattern){
  pattern=String(pattern);if(pattern.length>4096)throw new VBError('Date format is too long',7);const parts=[];let literal='';
  const flush=()=>{if(literal){parts.push({field:'literal',text:literal});literal='';}};
  for(let i=0;i<pattern.length;){const char=pattern[i];if(char==="'"){if(pattern[i+1]==="'"){literal+="'";i+=2;continue;}i++;let closed=false;while(i<pattern.length){if(pattern[i]==="'"){if(pattern[i+1]==="'"){literal+="'";i+=2;}else{i++;closed=true;break;}}else literal+=pattern[i++];}if(!closed)fail();continue;}
    if(!tokenField[char]){literal+=char;i++;continue;}flush();let end=i+1;while(pattern[end]===char)end++;const token=pattern.slice(i,end),maximum={d:4,M:4,y:4,h:2,H:2,m:2,s:2,t:2,X:64}[char];if(token.length>maximum)fail();parts.push({field:char==='d'&&token.length>2?'weekday':tokenField[char],token});i=end;
  }flush();return parts;
}
function dayPeriod(date,locale){return new Intl.DateTimeFormat(locale,{hour:'numeric',hour12:true}).formatToParts(date).find(part=>part.type==='dayPeriod')?.value||(date.getHours()<12?'AM':'PM');}
function customText(date,token,locale,callbacks){
  const n=token.length;switch(token[0]){
    case 'd':return n>2?date.toLocaleDateString(locale,{weekday:n===3?'short':'long'}):n===2?two(date.getDate()):String(date.getDate());
    case 'M':return n>2?date.toLocaleDateString(locale,{month:n===3?'short':'long'}):n===2?two(date.getMonth()+1):String(date.getMonth()+1);
    case 'y':return n===1?String(date.getFullYear()%10):n===2?two(date.getFullYear()%100):String(date.getFullYear()).padStart(n===4?4:1,'0');
    case 'H':return n===2?two(date.getHours()):String(date.getHours());case 'h':return n===2?two(date.getHours()%12||12):String(date.getHours()%12||12);
    case 'm':return n===2?two(date.getMinutes()):String(date.getMinutes());case 's':return n===2?two(date.getSeconds()):String(date.getSeconds());
    case 't':{const label=dayPeriod(date,locale);return n===1?[...label][0]:label;}case 'X':return String(callbacks?.get(token)??'');default:return token;
  }
}
export function formatDateParts(value,format=0,pattern='',locale='en-US',callbacks=new Map()){
  if(value===null)return {text:'',parts:[]};const date=asDate(value);let parts;
  if(Number(format)===3)parts=dateFormatTokens(pattern).map(part=>({...part,text:part.field==='literal'?part.text:customText(date,part.token,locale,callbacks)}));
  else{
    const options=Number(format)===2?{hour:'numeric',minute:'2-digit',second:'2-digit'}:Number(format)===1?{year:'2-digit',month:'numeric',day:'numeric'}:{weekday:'long',year:'numeric',month:'long',day:'numeric'},formatter=new Intl.DateTimeFormat(locale,options),hour12=formatter.resolvedOptions().hour12;
    parts=formatter.formatToParts(date).map(part=>({field:part.type,text:part.value,token:({year:Number(format)===1?'yy':'yyyy',month:Number(format)===1?'M':'MMMM',day:'d',weekday:'dddd',hour:hour12?'h':'H',minute:'mm',second:'ss',dayPeriod:'tt'})[part.type]}));
  }
  let output='';for(const part of parts){part.start=output.length;output+=part.text;part.end=output.length;}return {text:output,parts};
}
function monthNames(locale,short=false){const result=[];for(let month=0;month<12;month++){const date=new Date(2000,month,1),options={month:short?'short':'long'};const names=new Set([date.toLocaleDateString(locale,options),new Intl.DateTimeFormat(locale,{...options,day:'numeric'}).formatToParts(date).find(p=>p.type==='month').value]);for(const name of names)result.push({name:clean(name),month});}return result;}
function normalizedDigits(value,locale){const formatter=new Intl.NumberFormat(locale,{useGrouping:false});let result=clean(value);for(let digit=0;digit<10;digit++){const native=clean(formatter.format(digit));if(native!==String(digit))result=result.split(native).join(String(digit));}return result;}
/** Parse the displayed mask against its fields, never through Date's rollover parser. */
export function parseDateText(input,baseValue,format=0,pattern='',locale='en-US',callbacks=new Map()){
  const base=asDate(baseValue),inputText=normalizedDigits(String(input).trim(),locale);if(/^\d{4}-\d{1,2}-\d{1,2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/.test(inputText))return asDate(inputText);
  const parts=formatDateParts(base,format,pattern,locale,callbacks).parts,fields=[],expressions=[];
  for(const part of parts){const field=part.field,token=part.token||'';
    if(field==='literal'||field==='callback'){expressions.push(escape(part.text));continue;}
    if(field==='weekday'){expressions.push('(?:'+Array.from({length:7},(_,i)=>escape(new Date(2023,0,1+i).toLocaleDateString(locale,{weekday:token==='ddd'?'short':'long'}))).join('|')+')');continue;}
    if(field==='month'&&token.length>=3){const names=monthNames(locale,token.length===3);fields.push({...part,names});expressions.push('('+names.map(item=>escape(item.name)).sort((a,b)=>b.length-a.length).join('|')+')');continue;}
    if(field==='dayPeriod'){fields.push(part);const am=dayPeriod(new Date(2000,0,1,1),locale),pm=dayPeriod(new Date(2000,0,1,13),locale);expressions.push('('+[am,pm].map(value=>escape(token.length===1?[...value][0]:value)).join('|')+')');continue;}
    fields.push(part);expressions.push(field==='year'&&token.length>=3?'(\\d{3,4})':'(\\d{1,2})');
  }
  const match=new RegExp('^'+expressions.join('')+'$','iu').exec(inputText);if(!match)fail();const values={year:base.getFullYear(),month:base.getMonth()+1,day:base.getDate(),hour:base.getHours(),minute:base.getMinutes(),second:base.getSeconds()};let period=null,hour12=false;
  for(let i=0;i<fields.length;i++){const part=fields[i],raw=match[i+1],field=part.field,token=part.token||'';let value=Number(raw);
    if(part.names)value=part.names.find(item=>item.name.toLocaleLowerCase(locale)===raw.toLocaleLowerCase(locale))?.month+1;
    if(field==='dayPeriod'){period=raw;continue;}
    if(field==='year'&&token.length===2)value+=value<30?2000:1900;else if(field==='year'&&token.length===1){if(value>9)fail();value=Math.floor(base.getFullYear()/10)*10+value;}
    if(field==='hour'&&token[0]==='h'){hour12=true;if(value<1||value>12)fail();}values[field]=value;
  }
  if(hour12){const am=dayPeriod(new Date(2000,0,1,1),locale).toLocaleLowerCase(locale),pm=dayPeriod(new Date(2000,0,1,13),locale).toLocaleLowerCase(locale),isPM=period===null?base.getHours()>=12:period.toLocaleLowerCase(locale)===pm||period.toLocaleLowerCase(locale)===[...pm][0];if(period!==null&&!isPM&&period.toLocaleLowerCase(locale)!==am&&period.toLocaleLowerCase(locale)!==[...am][0])fail();values.hour=values.hour%12+(isPM?12:0);}
  return asDate(`${String(values.year).padStart(4,'0')}-${two(values.month)}-${two(values.day)} ${two(values.hour)}:${two(values.minute)}:${two(values.second)}`);
}
