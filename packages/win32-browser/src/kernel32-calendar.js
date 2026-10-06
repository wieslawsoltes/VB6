import {Win32Error,integer} from './core.js';

// FILETIME's epoch and 100 ns units must never pass through a JavaScript Number.
export const FILETIME_EPOCH_MS=11644473600000n;
const LIMIT=0x8000000000000000n;
export function readSystemTime(m,p) {
  const v=m.view(p,16);return Array.from({length:8},(_,i)=>v.getUint16(i*2,true));
}
export function dateFields(date,local=false) {
  if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new Win32Error('Invalid host clock');
  const get=name=>date[(local?'get':'getUTC')+name]();
  return [get('FullYear'),get('Month')+1,get('Day'),get('Date'),get('Hours'),get('Minutes'),get('Seconds'),get('Milliseconds')];
}
export function systemTimeDate(f,dateOnly=false) {
  const [year,month,,day,hour,minute,second,millisecond]=f;
  integer(year,1601,30827);integer(month,1,12);integer(day,1,31);
  if(!dateOnly){integer(hour,0,23);integer(minute,0,59);integer(second,0,59);integer(millisecond,0,999);}
  const d=new Date(0);d.setUTCFullYear(year,month-1,day);d.setUTCHours(dateOnly?0:hour,dateOnly?0:minute,dateOnly?0:second,dateOnly?0:millisecond);
  if(d.getUTCMonth()!==month-1||d.getUTCDate()!==day)throw new Win32Error('Invalid Gregorian calendar date');
  return d;
}
function ticks(m,p) {const n=m.view(p,8).getBigUint64(0,true);if(n>=LIMIT)throw new Win32Error('FILETIME exceeds the supported signed calendar range');return n;}
function writeTicks(m,p,value) {if(typeof value!=='bigint'||value<0n||value>=LIMIT)throw new Win32Error('FILETIME out of range');m.view(p,8).setBigUint64(0,value,true);}
function fieldsFromTicks(n) {return dateFields(new Date(Number(n/10000n-FILETIME_EPOCH_MS)));}
function writeSystemTime(m,p,fields) {const v=m.view(p,16);fields.forEach((n,i)=>v.setUint16(i*2,n,true));}
export function installCalendar(w) {
  const m=w.memory,add=(name,arity,fn,notes='')=>w.register('kernel32',name,fn,{arity,notes});
  add('SystemTimeToFileTime',2,(src,dst)=>{const d=systemTimeDate(readSystemTime(m,src));writeTicks(m,dst,(BigInt(d.getTime())+FILETIME_EPOCH_MS)*10000n);return 1;});
  add('FileTimeToSystemTime',2,(src,dst)=>{const f=fieldsFromTicks(ticks(m,src));writeSystemTime(m,dst,f);return 1;},'Integer 100 ns input; SYSTEMTIME intentionally truncates sub-millisecond precision.');
  add('CompareFileTime',2,(a,b)=>{const x=m.view(a,8).getBigUint64(0,true),y=m.view(b,8).getBigUint64(0,true);return x<y?-1:x>y?1:0;});
  add('DosDateTimeToFileTime',3,(date,time,dst)=>{date=integer(date,0,65535);time=integer(time,0,65535);const f=[1980+(date>>>9),(date>>>5)&15,0,date&31,time>>>11,(time>>>5)&63,(time&31)*2,0];const d=systemTimeDate(f);writeTicks(m,dst,(BigInt(d.getTime())+FILETIME_EPOCH_MS)*10000n);return 1;},'Packed DOS wall-clock values; no implicit time-zone conversion.');
  add('FileTimeToDosDateTime',3,(src,date,time)=>{
    const n=ticks(m,src),year=fieldsFromTicks(n)[0];
    if(year<1980||year>2107)throw new Win32Error('DOS date out of range');
    const rounded=(n+19999999n)/20000000n*20000000n,f=fieldsFromTicks(rounded);
    if(f[0]<1980||f[0]>2107)throw new Win32Error('DOS date out of range');
    const a=m.view(date,2),b=m.view(time,2);a.setUint16(0,((f[0]-1980)<<9)|(f[1]<<5)|f[3],true);b.setUint16(0,(f[4]<<11)|(f[5]<<5)|(f[6]>>>1),true);return 1;
  },'Rounds upward to the next two-second DOS boundary; input is already local wall-clock FILETIME.');
  for(const toLocal of [true,false])add(toLocal?'FileTimeToLocalFileTime':'LocalFileTimeToFileTime',2,(src,dst)=>{
    const n=ticks(m,src),bias=w.options.timeZoneBiasMinutes??w.now().getTimezoneOffset();
    integer(bias,-1440,1440);writeTicks(m,dst,n+BigInt(bias)*600000000n*(toLocal?-1n:1n));return 1;
  },'Uses the current host UTC-minus-local bias (or explicit timeZoneBiasMinutes), not historical DST rules. Preserves all 100 ns bits.');
  add('GetSystemTimePreciseAsFileTime',1,p=>{
    let value;if(w.options.nowFileTime)value=w.options.nowFileTime();else {const date=w.now();dateFields(date);value=(BigInt(date.getTime())+FILETIME_EPOCH_MS)*10000n;}
    writeTicks(m,p,value);
  },'Default precision is the browser Date clock, not a native high-resolution clock. Optional nowFileTime returns exact bigint ticks.');
}
