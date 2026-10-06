import {Win32Error,integer,unsigned} from './core.js';
import {registerAW,putComplete,units} from './services-utils.js';
import {readSystemTime,dateFields,systemTimeDate} from './kernel32-calendar.js';

// Explicit portable profiles, never an inferred Windows locale from navigator.
const DAYS='Sunday Monday Tuesday Wednesday Thursday Friday Saturday'.split(' ');
const MONTHS='January February March April May June July August September October November December'.split(' ');
const PROFILES=Object.freeze({
  0x409:{name:'en-US',language:'English (United States)',country:'United States',short:'M/d/yyyy',long:'dddd, MMMM d, yyyy',yearMonth:'MMMM yyyy',time:'h:mm:ss tt',dateOrder:0,time24:0},
  0x809:{name:'en-GB',language:'English (United Kingdom)',country:'United Kingdom',short:'dd/MM/yyyy',long:'dd MMMM yyyy',yearMonth:'MMMM yyyy',time:'HH:mm:ss',dateOrder:1,time24:1},
  0x7f:{name:'',language:'Invariant Language (Invariant Country)',country:'Invariant Country',short:'MM/dd/yyyy',long:'dddd, dd MMMM yyyy',yearMonth:'yyyy MMMM',time:'HH:mm:ss',dateOrder:0,time24:1}
});
export const LOCALE_CONSTANTS=Object.freeze({LOCALE_USER_DEFAULT:0x400,LOCALE_SYSTEM_DEFAULT:0x800,LOCALE_INVARIANT:0x7f,LOCALE_NOUSEROVERRIDE:0x80000000,LOCALE_RETURN_NUMBER:0x20000000,LOCALE_SNAME:0x5c,LOCALE_SSHORTDATE:0x1f,LOCALE_SLONGDATE:0x20,LOCALE_STIMEFORMAT:0x1003,LOCALE_IDEFAULTANSICODEPAGE:0x1004,DATE_SHORTDATE:1,DATE_LONGDATE:2,DATE_YEARMONTH:8,TIME_NOMINUTESORSECONDS:1,TIME_NOSECONDS:2,TIME_NOTIMEMARKER:4,TIME_FORCE24HOURFORMAT:8,LCID_INSTALLED:1,LCID_SUPPORTED:2});
const metadata=(id,p)=>({
  1:id.toString(16).padStart(4,'0'),2:p.language,6:p.country,14:'.',15:',',16:'3;0',17:'2',18:'1',29:'/',30:':',31:p.short,32:p.long,33:String(p.dateOrder),35:String(p.time24),40:'AM',41:'PM',89:'en',90:id===0x809?'GB':id===0x409?'US':'IV',92:p.name,4097:'English',4098:p.country,4099:p.time,4100:'1252',4102:p.yearMonth
});
const NUMERIC=new Set([1,17,18,33,35,4100]);
function picture(format,values) {
  if(format.length>32767)throw new Win32Error('Format picture is too large',8);
  let text='',quoted=false;
  for(let i=0;i<format.length;) {
    const c=format[i];
    if(c==="'"){if(format[i+1]==="'"){text+="'";i+=2;}else{quoted=!quoted;i++;}continue;}
    if(quoted||!Object.hasOwn(values,c)){text+=c;i++;continue;}
    let end=i+1;while(format[end]===c)end++;const count=end-i;
    text+=values[c](count);i=end;
  }
  if(quoted)throw new Win32Error('Unterminated quoted format literal');return text;
}
export function installLocaleFormatting(w) {
  const m=w.memory,defaultId=integer(w.options.localeId??0x409),getId=id=>{id=unsigned(id);if(id===0x400||id===0x800)return defaultId;if(!Object.hasOwn(PROFILES,id))throw new Win32Error('Locale is outside the explicit en-US/en-GB/invariant profiles');return id;};
  if(!Object.hasOwn(PROFILES,defaultId))throw new Win32Error('Unsupported default localeId');w.threadLocale=defaultId;
  const add=(name,arity,fn)=>w.register('kernel32',name,fn,{arity,notes:'Explicit portable en-US, en-GB and invariant locale profiles. No OS user overrides or inferred system locale.'});
  const byName=p=>{if(!p)return defaultId;const name=m.string(p,true).toLowerCase();const entry=Object.entries(PROFILES).find(([,v])=>v.name.toLowerCase()===name);if(!entry)throw new Win32Error('Unsupported locale name');return Number(entry[0]);};
  const output=(wide,p,size,text)=>{size=integer(size,0,Math.floor(m.maxBytes/(wide?2:1)));const n=units(m,text,wide)+1;if(size===0)return n;putComplete(m,p,text,size,wide);return n;};
  for(const name of ['GetUserDefaultLCID','GetSystemDefaultLCID','GetUserDefaultLangID','GetSystemDefaultLangID'])add(name,0,()=>defaultId);
  add('GetThreadLocale',0,()=>w.threadLocale);
  add('SetThreadLocale',1,id=>{w.threadLocale=getId(id);return 1;});
  add('IsValidLocale',2,(id,flags)=>{if(flags!==1&&flags!==2)throw new Win32Error('Invalid locale flags',1004);return Object.hasOwn(PROFILES,unsigned(id))?1:0;});
  add('LCIDToLocaleName',4,(id,p,n,flags)=>{if(flags)throw new Win32Error('Unsupported locale-name flags',1004);return output(true,p,n,PROFILES[getId(id)].name);});
  add('LocaleNameToLCID',2,(p,flags)=>{if(flags)throw new Win32Error('Unsupported locale-name flags',1004);return byName(p);});
  for(const name of ['GetUserDefaultLocaleName','GetSystemDefaultLocaleName'])add(name,2,(p,n)=>output(true,p,n,PROFILES[defaultId].name));
  function localeInfo(wide,id,type,p,n) {
    id=getId(id);type=unsigned(type);const flags=type&0xffff0000,key=type&0xffff;
    if(flags&~0xa0000000)throw new Win32Error('Unsupported locale-info flags',1004);
    const profile=PROFILES[id],data=metadata(id,profile);let text;
    if(key>=0x2a&&key<=0x30)text=DAYS[(key-0x2a+1)%7];
    else if(key>=0x31&&key<=0x37)text=DAYS[(key-0x31+1)%7].slice(0,3);
    else if(key>=0x38&&key<=0x43)text=MONTHS[key-0x38];
    else if(key>=0x44&&key<=0x4f)text=MONTHS[key-0x44].slice(0,3);
    else text=data[key];
    if(text===undefined)throw new Win32Error('Locale information type is not implemented',50);
    if(flags&0x20000000){if(!NUMERIC.has(key))throw new Win32Error('Locale field is not numeric');const count=wide?2:4;n=integer(n,0,m.maxBytes);if(!n)return count;if(n<count)throw new Win32Error('Numeric locale buffer is too small',122);m.writeU32(p,parseInt(text,key===1?16:10));return count;}
    return output(wide,p,n,text);
  }
  registerAW(w,'kernel32','GetLocaleInfo',4,(wide,...args)=>localeInfo(wide,...args));
  add('GetLocaleInfoEx',4,(name,type,p,n)=>localeInfo(true,byName(name),type,p,n));
  function formatDate(wide,id,flags,source,format,p,n) {
    id=getId(id);flags=unsigned(flags);if(flags&~0x8000000b)throw new Win32Error('Unsupported date flags',1004);
    const style=flags&11;if(style&&(style&(style-1))||format&&style)throw new Win32Error('Conflicting date format flags',1004);
    const f=source?readSystemTime(m,source):dateFields(w.now(),true),d=systemTimeDate(f,true),profile=PROFILES[id],fmt=format?m.string(format,wide):style===2?profile.long:style===8?profile.yearMonth:profile.short;
    const year=f[0],month=f[1],day=f[3],weekday=d.getUTCDay();
    const text=picture(fmt,{d:c=>c===1?String(day):c===2?String(day).padStart(2,'0'):c===3?DAYS[weekday].slice(0,3):DAYS[weekday],M:c=>c===1?String(month):c===2?String(month).padStart(2,'0'):c===3?MONTHS[month-1].slice(0,3):MONTHS[month-1],y:c=>c===1?String(year%100):c===2?String(year%100).padStart(2,'0'):String(year).padStart(c>=5?5:4,'0'),g:()=>{throw new Win32Error('Era format pictures are not implemented',50);}});
    return output(wide,p,n,text);
  }
  function formatTime(wide,id,flags,source,format,p,n) {
    id=getId(id);flags=unsigned(flags);if(flags&~0x8000000f)throw new Win32Error('Unsupported time flags',1004);
    if(format&&(flags&7))throw new Win32Error('Suppressing fields in custom time pictures is not implemented',50);
    const f=source?readSystemTime(m,source):dateFields(w.now(),true);for(const [v,max] of [[f[4],23],[f[5],59],[f[6],59]])integer(v,0,max);
    const profile=PROFILES[id];let fmt=format?m.string(format,wide):profile.time;
    if(!format){if(flags&1)fmt=fmt.replace(':mm:ss','');else if(flags&2)fmt=fmt.replace(':ss','');if(flags&4)fmt=fmt.replace(' tt','');}
    const text=picture(fmt,{h:c=>String(flags&8?f[4]:f[4]%12||12).padStart(c>1?2:1,'0'),H:c=>String(f[4]).padStart(c>1?2:1,'0'),m:c=>String(f[5]).padStart(c>1?2:1,'0'),s:c=>String(f[6]).padStart(c>1?2:1,'0'),t:c=>(f[4]<12?'AM':'PM').slice(0,c===1?1:2)});
    return output(wide,p,n,text);
  }
  registerAW(w,'kernel32','GetDateFormat',6,(wide,...args)=>formatDate(wide,...args));
  registerAW(w,'kernel32','GetTimeFormat',6,(wide,...args)=>formatTime(wide,...args));
  add('GetDateFormatEx',7,(name,flags,source,format,p,n,calendar)=>{if(calendar)throw new Win32Error('Alternate calendars are not implemented',50);return formatDate(true,byName(name),flags,source,format,p,n);});
  add('GetTimeFormatEx',6,(name,flags,source,format,p,n)=>formatTime(true,byName(name),flags,source,format,p,n));
}
