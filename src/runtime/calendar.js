/** Gregorian/OLE DATE support. Numeric dates encode civil time, not UTC instants.
 * System-default week settings deliberately use the documented invariant defaults
 * (Sunday / week containing January 1); no Windows NLS API is available here.
 */
import {VBError} from '../language/errors.js';
const DAY=86400000;
const EPOCH=Date.UTC(1899,11,30);
function round(value){const n=Number(value);if(!Number.isFinite(n))throw new VBError('Type mismatch',13);const floor=Math.floor(n),f=n-floor;return f===.5?(floor%2===0?floor:floor+1):Math.round(n);}
function integer(value){if(value===null)throw new VBError('Invalid use of Null',94);return round(value===undefined?0:value);}
function utcCivil(y,m,d,h=0,n=0,s=0,ms=0){const x=new Date(0);x.setUTCFullYear(y,m,d);x.setUTCHours(h,n,s,ms);return x.getTime();}
function localCivil(y,m,d,h=0,n=0,s=0,ms=0){const x=new Date(0);x.setFullYear(y,m,d);x.setHours(h,n,s,ms);return x;}
export function validateDate(date){if(!(date instanceof Date)||!Number.isFinite(date.getTime())||date.getFullYear()<100||date.getFullYear()>9999)throw new VBError('Invalid procedure call or argument',5);return date;}
export function dateOrdinal(date){return Math.round((utcCivil(date.getFullYear(),date.getMonth(),date.getDate())-EPOCH)/DAY);}
function civilMillis(date){return utcCivil(date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds())-EPOCH;}
export function dateToSerial(date){validateDate(date);const day=dateOrdinal(date),fraction=(date.getHours()*3600000+date.getMinutes()*60000+date.getSeconds()*1000+date.getMilliseconds())/DAY;return day<0?day-fraction:day+fraction;}
export function serialToDate(value){
  if(!Number.isFinite(value)||value<=-657435||value>=2958466)throw new VBError('Overflow',6);
  const whole=Math.trunc(value),fraction=Math.abs(value-whole),utc=new Date(EPOCH+whole*DAY+Math.round(fraction*DAY));
  return validateDate(localCivil(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate(),utc.getUTCHours(),utc.getUTCMinutes(),utc.getUTCSeconds(),utc.getUTCMilliseconds()));
}
export function asDate(value){
  if(value instanceof Date)return validateDate(new Date(value));
  if(value===null)throw new VBError('Invalid use of Null',94);
  if(value===undefined)return serialToDate(0);
  if(typeof value==='number')return serialToDate(value);
  if(typeof value!=='string')throw new VBError('Type mismatch',13);
  const text=value.trim();if(!text)throw new VBError('Type mismatch',13);
  let y,m,d,h=0,n=0,s=0,ms=0,match;
  if((match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/))){[,y,m,d,h=0,n=0,s=0,ms=0]=match;}
  else if((match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i))){[,m,d,y,h=0,n=0,s=0]=match;y=Number(y);if(y<100)y+=y<30?2000:1900;if(match[7]){if(+h<1||+h>12)throw new VBError('Type mismatch',13);h=+h%12+(/^PM$/i.test(match[7])?12:0);}}
  else if((match=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(AM|PM)?$/i))){[,h,n,s=0,ms=0]=match;[y,m,d]=[1899,12,30];if(match[5]){if(+h<1||+h>12)throw new VBError('Type mismatch',13);h=+h%12+(/^PM$/i.test(match[5])?12:0);}}
  else if((match=text.match(/^(\d{1,2})[\/,](\d{1,2})$/))){[,m,d]=match;y=new Date().getFullYear();}
  else {const parsed=new Date(text);if(!Number.isFinite(parsed.getTime()))throw new VBError('Type mismatch',13);return validateDate(parsed);}
  [y,m,d,h,n,s]=[y,m,d,h,n,s].map(Number);ms=Number(String(ms).padEnd(3,'0'));
  if(m<1||m>12||d<1||d>daysInMonth(y,m-1)||h<0||h>23||n>59||s>59)throw new VBError('Type mismatch',13);
  return validateDate(localCivil(y,m-1,d,h,n,s,ms));
}
function daysInMonth(y,m){const x=new Date(utcCivil(y,m+1,0));return x.getUTCDate();}
function interval(value){if(value===null)throw new VBError('Invalid use of Null',94);const key=String(value).toLowerCase();if(!['yyyy','q','m','y','d','w','ww','h','n','s'].includes(key))throw new VBError('Invalid interval',5);return key;}
function firstDay(value=1){const n=integer(value);if(n<0||n>7)throw new VBError('Invalid first day of week',5);return (n||1)-1;}
function firstWeek(value=1){const n=integer(value);if(n<0||n>3)throw new VBError('Invalid first week of year',5);return n||1;}
function startWeek(ordinal,first){const dow=((ordinal+6)%7+7)%7;return ordinal-(dow-first+7)%7;}
function firstYearWeek(year,first,rule){const jan=Math.round((utcCivil(year,0,1)-EPOCH)/DAY),start=startWeek(jan,first);return rule===1?start:rule===2?(jan-start<=3?start:start+7):(jan===start?start:start+7);}
export function dateAdd(part,amount,value){
  part=interval(part);const count=integer(amount);if(count< -2147483648||count>2147483647)throw new VBError('Overflow',6);const date=asDate(value);
  if(['yyyy','q','m'].includes(part)){
    const months=date.getFullYear()*12+date.getMonth()+count*(part==='yyyy'?12:part==='q'?3:1),year=Math.floor(months/12),month=((months%12)+12)%12;
    if(year<100||year>9999)throw new VBError('Invalid procedure call or argument',5);
    return validateDate(localCivil(year,month,Math.min(date.getDate(),daysInMonth(year,month)),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds()));
  }
  const unit={y:DAY,d:DAY,w:DAY,ww:7*DAY,h:3600000,n:60000,s:1000}[part],utc=new Date(EPOCH+civilMillis(date)+count*unit);
  return validateDate(localCivil(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate(),utc.getUTCHours(),utc.getUTCMinutes(),utc.getUTCSeconds(),utc.getUTCMilliseconds()));
}
export function dateDiff(part,left,right,first=1,week=1){
  part=interval(part);first=firstDay(first);firstWeek(week);const a=asDate(left),b=asDate(right);
  if(part==='yyyy')return b.getFullYear()-a.getFullYear();
  if(part==='q')return (b.getFullYear()-a.getFullYear())*4+Math.floor(b.getMonth()/3)-Math.floor(a.getMonth()/3);
  if(part==='m')return (b.getFullYear()-a.getFullYear())*12+b.getMonth()-a.getMonth();
  const ad=dateOrdinal(a),bd=dateOrdinal(b);
  if(part==='w')return Math.trunc((bd-ad)/7)||0;
  if(part==='ww')return (startWeek(bd,first)-startWeek(ad,first))/7;
  const units={y:DAY,d:DAY,h:3600000,n:60000,s:1000},unit=units[part];return Math.floor(civilMillis(b)/unit)-Math.floor(civilMillis(a)/unit);
}
export function datePart(part,value,first=1,week=1){
  part=interval(part);first=firstDay(first);week=firstWeek(week);const d=asDate(value),ordinal=dateOrdinal(d);
  switch(part){case 'yyyy':return d.getFullYear();case 'q':return Math.floor(d.getMonth()/3)+1;case 'm':return d.getMonth()+1;case 'd':return d.getDate();case 'y':return ordinal-Math.round((utcCivil(d.getFullYear(),0,1)-EPOCH)/DAY)+1;case 'w':return (d.getDay()-first+7)%7+1;case 'h':return d.getHours();case 'n':return d.getMinutes();case 's':return d.getSeconds();case 'ww':{let start=firstYearWeek(d.getFullYear(),first,week);if(ordinal<start)start=firstYearWeek(d.getFullYear()-1,first,week);return Math.floor((ordinal-start)/7)+1;}}
}
export function dateSerial(year,month,day){[year,month,day]=[year,month,day].map(integer);if([year,month,day].some(n=>n< -32768||n>32767))throw new VBError('Overflow',6);if(year>=0&&year<100)year+=year<30?2000:1900;return validateDate(localCivil(year,month-1,day));}
export function timeSerial(hour,minute,second){[hour,minute,second]=[hour,minute,second].map(integer);if([hour,minute,second].some(n=>n< -32768||n>32767))throw new VBError('Overflow',6);return validateDate(localCivil(1899,11,30,hour,minute,second));}
export function weekday(value,first=1){return (asDate(value).getDay()-firstDay(first)+7)%7+1;}
export function monthName(month,abbreviate=0){month=integer(month);if(month<1||month>12)throw new VBError('Invalid procedure call',5);return localCivil(2000,month-1,1).toLocaleString('en-US',{month:abbreviate?'short':'long'});}
export function weekdayName(day,abbreviate=0,first=1){day=integer(day);if(day<1||day>7)throw new VBError('Invalid procedure call',5);return localCivil(2023,0,1+day-1+firstDay(first)).toLocaleString('en-US',{weekday:abbreviate?'short':'long'});}
