import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createWin32} from '../packages/win32-browser/src/index.js';
const path=process.argv[2]||'reports/win32-system/native.json';
const native=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,'')),w=createWin32(),m=w.memory,k=(n,...a)=>w.invoke('kernel32',n,a);
const p=m.alloc(16),q=m.alloc(16),out=m.alloc(512),date=m.alloc(2),time=m.alloc(2);
const fields=ptr=>Array.from({length:8},(_,i)=>m.view(ptr,16).getUint16(i*2,true));
const setFields=f=>f.forEach((n,i)=>m.view(q,16).setUint16(i*2,n,true));
const actual={};
try {
 actual.calendar=native.calendar.map(({ticks})=>{m.view(p,8).setBigUint64(0,BigInt(ticks),true);const ok=k('FileTimeToSystemTime',p,q);return {ticks,ok,fields:ok?fields(q):[]};});
 actual.leap=native.leap.map(({year})=>{setFields([year,2,99,29,13,5,9,123]);const ok=k('SystemTimeToFileTime',q,p);return {year,ok,ticks:ok?m.view(p,8).getBigUint64(0,true).toString():''};});
 m.view(p,8).setBigUint64(0,9223372036854775808n,true);m.view(q,8).setBigUint64(0,18446744073709551615n,true);actual.unsignedCompare=k('CompareFileTime',p,q);
 actual.dos=native.dos.map(({ticks})=>{m.view(p,8).setBigUint64(0,BigInt(ticks),true);const ok=k('FileTimeToDosDateTime',p,date,time),d=m.view(date,2).getUint16(0,true),t=m.view(time,2).getUint16(0,true);let roundtrip='0';if(ok){k('DosDateTimeToFileTime',d,t,q);roundtrip=m.view(q,8).getBigUint64(0,true).toString();}return {ticks,ok,date:d,time:t,roundtrip};});
 setFields([2024,2,0,29,13,5,9,123]);
 let count=k('GetDateFormatW',0x409,0,q,"dddd, dd MMMM yyyy 'at'",out,256);actual.date={count,text:m.string(out,true)};
 count=k('GetTimeFormatW',0x409,0,q,"hh':'mm':'ss tt",out,256);actual.time={count,text:m.string(out,true)};
 const args=m.alloc(8),name=m.allocString('sample',true);m.writeU32(args,name);m.writeU32(args+4,42);
 count=k('FormatMessageW',0x2400,'File %1: %2!04X!%n%% %! %.%0ignored',0,0,out,256,args);actual.insert={count,text:m.string(out,true)};
 const pp=m.alloc(4);count=k('FormatMessageW',0x1300,0,5,0x409,pp,0,0);const allocated=m.readU32(pp);actual.allocated={count,text:m.string(allocated,true)};k('LocalFree',allocated);
 writeFileSync(path.replace(/\.json$/,'.browser.json'),JSON.stringify(actual,null,2)+'\n');
 assert.deepEqual(actual,native);
 console.log('Matched 28 native calendar/DOS/formatting cases (all fields) against installed Windows APIs.');
} finally {w.dispose();}
