import test from 'node:test';
import assert from 'node:assert/strict';
import {createWin32,WIN32_CONSTANTS as C} from '../src/index.js';

function setup(t,options={}) {
  const w=createWin32(options),m=w.memory;kCleanup(t,w);
  const k=(name,...args)=>w.invoke('kernel32',name,args);
  const st=fields=>{const p=m.alloc(16);fields.forEach((n,i)=>m.view(p,16).setUint16(i*2,n,true));return p;};
  const fields=p=>Array.from({length:8},(_,i)=>m.view(p,16).getUint16(i*2,true));
  const ft=n=>{const p=m.alloc(8);m.view(p,8).setBigUint64(0,n,true);return p;};
  return {w,m,k,st,fields,ft};
}
function kCleanup(t,w){t.after(()=>w.dispose());}
const EPOCH=116444736000000000n;
for(const [name,value,expected] of [
  ['epoch',0n,[1601,1,1,1,0,0,0,0]],
  ['one tick',1n,[1601,1,1,1,0,0,0,0]],
  ['below millisecond',9999n,[1601,1,1,1,0,0,0,0]],
  ['millisecond',10000n,[1601,1,1,1,0,0,0,1]],
  ['unix epoch',EPOCH,[1970,1,4,1,0,0,0,0]],
  ['leap day',133536855091230000n,[2024,2,4,29,13,5,9,123]]
]) test('FILETIME UTC '+name,t=>{
  const {m,k,ft,st,fields}=setup(t),src=ft(value),dst=st([]),back=ft(0n);
  assert.equal(k('FileTimeToSystemTime',src,dst),1);assert.deepEqual(fields(dst),expected);
  assert.equal(k('SystemTimeToFileTime',dst,back),1);
  assert.equal(m.view(back,8).getBigUint64(0,true),value/10000n*10000n);
});
for(const year of [1601,1900,2000,2023,2024,2100,2400,30827])test('Gregorian leap validation '+year,t=>{
  const {m,k,ft,st,fields}=setup(t),src=st([year,2,99,29,23,59,59,999]),dst=ft(123n);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  assert.equal(k('SystemTimeToFileTime',src,dst),leap?1:0);
  if(leap){assert.equal(k('FileTimeToSystemTime',dst,src),1);assert.equal(fields(src)[0],year);assert.ok(fields(src)[2]<=6);}
  else assert.equal(m.view(dst,8).getBigUint64(0,true),123n);
});
for(const [index,value] of [[0,1600],[0,30828],[1,0],[1,13],[3,0],[3,32],[4,24],[5,60],[6,60],[7,1000]])test('Invalid SYSTEMTIME preserves output '+index+':'+value,t=>{
  const {m,k,st,ft}=setup(t),f=[2024,1,0,1,0,0,0,0];f[index]=value;
  const dst=ft(555n);assert.equal(k('SystemTimeToFileTime',st(f),dst),0);assert.equal(m.view(dst,8).getBigUint64(0,true),555n);
});
test('FILETIME signed conversion limit and unsigned comparison',t=>{
  const {m,k,ft,st,fields}=setup(t),max=ft(0x7fffffffffffffffn),min=ft(0x8000000000000000n),out=st([]);
  assert.equal(k('FileTimeToSystemTime',max,out),1);const original=fields(out);
  assert.equal(k('FileTimeToSystemTime',min,out),0);assert.deepEqual(fields(out),original);
  assert.equal(k('CompareFileTime',min,ft(0xffffffffffffffffn)),-1);
  assert.equal(k('CompareFileTime',min,min),0);assert.equal(k('CompareFileTime',min,max),1);
});
for(const bias of [-840,-60,0,330,720])test('FILETIME bias keeps sub-ms bits '+bias,t=>{
  const {m,k,ft}=setup(t,{timeZoneBiasMinutes:bias}),src=ft(EPOCH+987654321n),local=ft(0n),back=ft(0n);
  assert.equal(k('FileTimeToLocalFileTime',src,local),1);
  assert.equal(m.view(local,8).getBigUint64(0,true),EPOCH+987654321n-BigInt(bias)*600000000n);
  assert.equal(k('LocalFileTimeToFileTime',local,back),1);assert.equal(k('CompareFileTime',src,back),0);
});
test('precise clock does not fabricate precision; supplied ticks remain exact',t=>{
 const a=setup(t,{now:()=>new Date(0)}),p=a.ft(0n);a.k('GetSystemTimePreciseAsFileTime',p);assert.equal(a.m.view(p,8).getBigUint64(0,true),EPOCH);
 const b=setup(t,{nowFileTime:()=>EPOCH+1n}),q=b.ft(0n);b.k('GetSystemTimePreciseAsFileTime',q);assert.equal(b.m.view(q,8).getBigUint64(0,true),EPOCH+1n);
});
test('invalid precise clock and bias do not mutate output',t=>{
 const a=setup(t,{nowFileTime:()=>123}),p=a.ft(42n);assert.equal(a.k('GetSystemTimePreciseAsFileTime',p),0);assert.equal(a.m.view(p,8).getBigUint64(0,true),42n);
 const b=setup(t,{timeZoneBiasMinutes:2000}),q=b.ft(42n);assert.equal(b.k('FileTimeToLocalFileTime',q,q),0);assert.equal(b.m.view(q,8).getBigUint64(0,true),42n);
});
for(const second of [0,2,28,58])test('DOS date packing '+second,t=>{
 const {k,st,ft,m}=setup(t),src=st([2024,2,0,29,13,5,second,0]),f=ft(0n),d=m.alloc(2),tm=m.alloc(2),back=ft(0n);
 assert.equal(k('SystemTimeToFileTime',src,f),1);assert.equal(k('FileTimeToDosDateTime',f,d,tm),1);
 assert.equal(m.view(d,2).getUint16(0,true),(44<<9)|(2<<5)|29);assert.equal(m.view(tm,2).getUint16(0,true),(13<<11)|(5<<5)|(second/2));
 assert.equal(k('DosDateTimeToFileTime',m.view(d,2).getUint16(0,true),m.view(tm,2).getUint16(0,true),back),1);assert.equal(k('CompareFileTime',f,back),0);
});
test('DOS invalid fields and output pointers preserve values',t=>{
 const {m,k,ft}=setup(t),f=ft(123n),d=m.alloc(2);m.view(d,2).setUint16(0,77,true);
 assert.equal(k('DosDateTimeToFileTime',0,0,f),0);assert.equal(m.view(f,8).getBigUint64(0,true),123n);
 const valid=ft((BigInt(Date.UTC(2024,0,1))+11644473600000n)*10000n);
 assert.equal(k('FileTimeToDosDateTime',valid,d,0),0);assert.equal(m.view(d,2).getUint16(0,true),77);
});
for(const [name,old,args,ret,next] of [
 ['InterlockedIncrement',0,[],1,1],['InterlockedIncrement',2147483647,[],-2147483648,-2147483648],
 ['InterlockedDecrement',-2147483648,[],2147483647,2147483647],
 ['InterlockedExchange',10,[-5],10,-5],['InterlockedExchangeAdd',2147483647,[1],2147483647,-2147483648],
 ['InterlockedCompareExchange',8,[7,8],8,7],['InterlockedCompareExchange',8,[7,9],8,8],
 ['InterlockedAnd',15,[5],15,5],['InterlockedOr',5,[10],5,15],['InterlockedXor',15,[5],15,10]
])test(name+' '+old+' '+args,t=>{const {m,k}=setup(t),p=m.alloc(4);m.writeI32(p,old);assert.equal(k(name,p,...args),ret);assert.equal(m.readI32(p),next);});
test('unaligned and invalid interlocked arguments cannot mutate memory',t=>{
 const {m,k}=setup(t),p=m.alloc(8);m.bytes(p,8).fill(0x55);const original=m.bytes(p,8).slice();
 assert.equal(k('InterlockedIncrement',p+1),0);assert.equal(k('InterlockedExchange',p,NaN),0);assert.deepEqual(m.bytes(p,8),original);
});
for(const wide of [false,true]){
 const suffix=wide?'W':'A',step=wide?2:1;
 test('locale size query, complete string and numeric counts '+suffix,t=>{
  const {m,k}=setup(t),p=m.alloc(128),n=k('GetLocaleInfo'+suffix,0x409,C.LOCALE_SNAME,0,0);
  assert.equal(n,6);assert.equal(k('GetLocaleInfo'+suffix,0x409,C.LOCALE_SNAME,p,6),6);assert.equal(m.string(p,wide),'en-US');
  m.bytes(p,128).fill(0x55);assert.equal(k('GetLocaleInfo'+suffix,0x409,C.LOCALE_SNAME,p,5),0);assert.equal(m.bytes(p,128)[0],0x55);
  const count=wide?2:4;assert.equal(k('GetLocaleInfo'+suffix,0x409,C.LOCALE_RETURN_NUMBER|C.LOCALE_IDEFAULTANSICODEPAGE,0,0),count);
  assert.equal(k('GetLocaleInfo'+suffix,0x409,C.LOCALE_RETURN_NUMBER|C.LOCALE_IDEFAULTANSICODEPAGE,p,count),count);assert.equal(m.readU32(p),1252);
 });
 test('date pictures, query/count, ignored time fields '+suffix,t=>{
  const {k,st,m}=setup(t),p=m.alloc(512),s=st([2024,2,6,29,65000,65000,65000,65000]),format="dddd, dd MMMM yyyy 'it''s'";
  const expected="Thursday, 29 February 2024 it's";
  assert.equal(k('GetDateFormat'+suffix,0x409,0,s,format,0,0),expected.length+1);
  assert.equal(k('GetDateFormat'+suffix,0x409,0,s,format,p,256),expected.length+1);assert.equal(m.string(p,wide),expected);
  m.bytes(p,512).fill(0x55);assert.equal(k('GetDateFormat'+suffix,0x409,0,s,format,p,2),0);assert.equal(m.bytes(p,512)[0],0x55);
 });
 test('time pictures, ignored date fields, default suppression '+suffix,t=>{
  const {k,st,m}=setup(t),p=m.alloc(512),s=st([0,0,0,0,13,5,9,0]);
  assert.ok(k('GetTimeFormat'+suffix,0x409,0,s,'hh:mm:ss tt',p,256));assert.equal(m.string(p,wide),'01:05:09 PM');
  for(const [flags,result] of [[1,'1 PM'],[2,'1:05 PM'],[4,'1:05:09'],[8,'13:05:09 PM']]){assert.ok(k('GetTimeFormat'+suffix,0x409,flags,s,0,p,256));assert.equal(m.string(p,wide),result);}
 });
 test('INI complete section/key interoperation, comments and quotes '+suffix,t=>{
  const {k,m,w}=setup(t),out=m.alloc(256*step),file='C:\\Temp\\settings.ini';
  assert.equal(k('WritePrivateProfileSection'+suffix,'App','Color=Blue\0Count=42\0\0',file),1);
  assert.equal(k('GetPrivateProfileInt'+suffix,'app','COUNT',0,file),42);
  assert.equal(k('GetPrivateProfileSection'+suffix,'APP',out,256,file),20);assert.equal(m.decode(m.bytes(out,21*step),wide),'Color=Blue\0Count=42\0\0');
  assert.equal(k('WritePrivateProfileString'+suffix,'App','Color','"Red"',file),1);
  assert.equal(k('GetPrivateProfileString'+suffix,'app','color','',out,256,file),3);assert.equal(m.string(out,wide),'Red');
  assert.equal(k('WritePrivateProfileString'+suffix,'Other','Flag','yes',file),1);
  assert.equal(k('WritePrivateProfileSection'+suffix,'APP',0,file),1);
  assert.equal(k('GetPrivateProfileString'+suffix,'Other','Flag','',out,256,file),3);assert.equal(m.string(out,wide),'yes');
 });
 test('INI names and exact multi-string truncation '+suffix,t=>{
  const {k,m}=setup(t),out=m.alloc(32*step);
  k('WritePrivateProfileSection'+suffix,'Alpha','One=1\0\0','catalog.ini');k('WritePrivateProfileSection'+suffix,'Beta','Two=2\0\0','catalog.ini');
  const n=k('GetPrivateProfileSectionNames'+suffix,out,32,'catalog.ini');assert.equal(n,11);assert.equal(m.decode(m.bytes(out,12*step),wide),'Alpha\0Beta\0\0');
  for(const cap of [1,2,3,5,10]){m.bytes(out,32*step).fill(0x55);assert.equal(k('GetPrivateProfileSectionNames'+suffix,out,cap,'catalog.ini'),Math.max(0,cap-2));assert.ok(m.bytes(out+(cap-Math.min(2,cap))*step,Math.min(2,cap)*step).every(v=>v===0));assert.equal(m.bytes(out+cap*step,1)[0],0x55);}
 });
 test('INI malformed inputs/quotas are transactional '+suffix,t=>{
  const {k,m,w}=setup(t,{maxFileBytes:128}),file='small.ini';k('WritePrivateProfileSection'+suffix,'A','One=1\0\0',file);const old=w.fs.readBytes('/Windows/small.ini');
  for(const input of ['bad\0\0','missing terminator','a=b\nnext=x\0\0','a='+'x'.repeat(128)+'\0\0']){assert.equal(k('WritePrivateProfileSection'+suffix,'A',input,file),0);assert.deepEqual(w.fs.readBytes('/Windows/small.ini'),old);}
  const p=m.alloc(8);m.bytes(p,8).fill(65);assert.equal(k('WritePrivateProfileSection'+suffix,'A',p,file),0);assert.deepEqual(w.fs.readBytes('/Windows/small.ini'),old);
 });
 test('INI legacy WIN.INI aliases share private section storage '+suffix,t=>{
  const {k,m,w}=setup(t),out=m.alloc(256*step);
  assert.equal(k('WriteProfileSection'+suffix,'Settings','Mode=Classic\0\0'),1);assert.equal(k('GetProfileString'+suffix,'Settings','Mode','',out,256),7);assert.equal(m.string(out,wide),'Classic');
  assert.equal(k('WriteProfileString'+suffix,'Settings','Count','42'),1);assert.equal(k('GetProfileInt'+suffix,'Settings','Count',0),42);
  assert.ok(k('GetProfileSection'+suffix,'Settings',out,256)>0);assert.ok(w.fs.exists('/Windows/win.ini'));
 });
 test('FormatMessage direct/allocated output and insertion buffers '+suffix,t=>{
  const {k,m}=setup(t),out=m.alloc(512),args=m.alloc(12),name=m.allocString('sample',wide);m.writeU32(args,name);m.writeU32(args+4,42);m.writeU32(args+8,-7);
  const template='File %1: %2!04X! %3!04d!%n%% %! %.%0ignored',expected='File sample: 002A -007\r\n% ! .';
  const count=k('FormatMessage'+suffix,0x2400,template,0,0,out,256,args);assert.equal(count,expected.length);assert.equal(m.string(out,wide),expected);
  const pp=m.alloc(4),used=m.used;assert.equal(k('FormatMessage'+suffix,0x1300,0,5,0x409,pp,0,0),'Access is denied.\r\n'.length);
  const allocated=m.readU32(pp);assert.equal(m.string(allocated,wide),'Access is denied.\r\n');assert.equal(k('LocalFree',allocated),0);assert.equal(m.used,used);
 });
 test('FormatMessage ignores insert pointers and preserves hard line breaks '+suffix,t=>{
  const {k,m}=setup(t),out=m.alloc(512);
  const template='A\r\n%1!s!%nB',expected='A %1!s!\r\nB';
  assert.equal(k('FormatMessage'+suffix,0x6ff,template,0,0,out,256,0xffff),expected.length);assert.equal(m.string(out,wide),expected);
 });
 test('FormatMessage string precision/alignment and numeric conversions '+suffix,t=>{
  const {k,m}=setup(t),out=m.alloc(512),args=m.alloc(8);m.writeU32(args,m.allocString('abcdef',wide));m.writeU32(args+4,0xffffffff);
  const expected='abc   |4294967295|ffffffff|-1';assert.equal(k('FormatMessage'+suffix,0x2400,'%1!-6.3s!|%2!u!|%2!x!|%2!d!',0,0,out,256,args),expected.length);assert.equal(m.string(out,wide),expected);
 });
 test('FormatMessage failure leaves output and allocator unchanged '+suffix,t=>{
  const {w,k,m}=setup(t),out=m.alloc(512);m.bytes(out,512).fill(0x55);const original=m.bytes(out,512).slice(),used=m.used;
  for(const [flags,src,id,lang,n,args] of [[0x400,'%1',0,0,256,0],[0x2400,'%1!I64u!',0,0,256,0],[0x1000,0,999999,0,256,0],[0x1000,0,5,0x411,256,0],[0x400,'too long',0,0,2,0],[0x401,'wrapped',0,0,256,0]]){assert.equal(k('FormatMessage'+suffix,flags,src,id,lang,out,n,args),0);assert.deepEqual(m.bytes(out,512),original);assert.equal(m.used,used);}
  assert.equal(k('FormatMessage'+suffix,0x1500,'x',0,0,0,0,0),0);assert.equal(m.used,used);
 });
}
test('UTF-16 BOM profile files retain non-ANSI content across A/W updates',t=>{
 const {m,k,w}=setup(t),text='[A]\r\nValue=日本語\r\n',body=m.stringBytes(text,true),b=new Uint8Array(body.length+2);b.set([255,254]);b.set(body,2);w.fs.writeBytes('/Windows/unicode.ini',b);
 const out=m.alloc(128);assert.equal(k('GetPrivateProfileStringW','A','Value','',out,64,'unicode.ini'),3);assert.equal(m.string(out,true),'日本語');
 assert.equal(k('WritePrivateProfileStringA','A','Count','42','unicode.ini'),1);assert.deepEqual([...w.fs.readBytes('/Windows/unicode.ini').slice(0,2)],[255,254]);assert.equal(k('GetPrivateProfileStringW','A','Value','',out,64,'unicode.ini'),3);assert.equal(m.string(out,true),'日本語');
});
test('locale profiles, thread state and Ex names are explicit and isolated',t=>{
 const a=setup(t,{localeId:0x809}),b=setup(t),out=a.m.alloc(64);
 assert.equal(a.k('GetSystemDefaultLCID'),0x809);assert.equal(a.k('GetUserDefaultLangID'),0x809);assert.equal(a.k('GetSystemDefaultLangID'),0x809);
 assert.equal(a.k('SetThreadLocale',0x7f),1);assert.equal(a.k('GetThreadLocale'),0x7f);assert.equal(b.k('GetThreadLocale'),0x409);
 assert.equal(a.k('LocaleNameToLCID','EN-gb',0),0x809);assert.equal(a.k('LCIDToLocaleName',0x809,out,32,0),6);assert.equal(a.m.string(out,true),'en-GB');
 assert.equal(a.k('GetUserDefaultLocaleName',out,32),6);assert.equal(a.k('GetSystemDefaultLocaleName',out,32),6);
 assert.equal(a.k('GetLocaleInfoEx','en-US',C.LOCALE_SNAME,out,32),6);assert.equal(a.m.string(out,true),'en-US');
 assert.equal(a.k('IsValidLocale',0x409,1),1);assert.equal(a.k('IsValidLocale',0x411,2),0);assert.equal(a.k('SetThreadLocale',0x411),0);assert.equal(a.k('GetThreadLocale'),0x7f);
});
for(const [id,style,expected] of [[0x409,1,'2/29/2024'],[0x809,1,'29/02/2024'],[0x7f,1,'02/29/2024'],[0x409,2,'Thursday, February 29, 2024'],[0x809,8,'February 2024']])test('default date profile '+id+':'+style,t=>{
 const {m,k,st}=setup(t),p=m.alloc(256),s=st([2024,2,0,29,0,0,0,0]);assert.equal(k('GetDateFormatW',id,style,s,0,p,128),expected.length+1);assert.equal(m.string(p,true),expected);
});
test('date/time Ex and invalid unsupported formats preserve output',t=>{
 const {m,k,st}=setup(t),p=m.alloc(256),s=st([2024,2,0,29,13,5,9,0]);
 assert.equal(k('GetDateFormatEx','en-US',0,s,'yyyy-MM-dd',p,128,0),11);assert.equal(m.string(p,true),'2024-02-29');
 assert.equal(k('GetTimeFormatEx','en-GB',0,s,0,p,128),9);assert.equal(m.string(p,true),'13:05:09');const saved=m.bytes(p,256).slice();
 for(const call of [()=>k('GetDateFormatW',0x411,0,s,0,p,128),()=>k('GetDateFormatW',0x409,3,s,0,p,128),()=>k('GetDateFormatW',0x409,0,s,"yyyy'",p,128),()=>k('GetDateFormatW',0x409,0,s,'g',p,128),()=>k('GetTimeFormatW',0x409,2,s,'HH:mm:ss',p,128),()=>k('GetDateFormatEx','en-US',0,s,0,p,128,1)]){assert.equal(call(),0);assert.deepEqual(m.bytes(p,256),saved);}
});
