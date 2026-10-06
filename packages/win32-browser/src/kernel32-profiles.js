import {Win32Error,unsigned} from './core.js';
import {registerAW} from './services-utils.js';

/** Private INI storage shared by individual-key, complete-section and legacy
 * WIN.INI APIs. Reads/writes do not yield; output validation precedes mutation. */
export function installProfiles(w) {
  const m=w.memory,fs=w.fs,ci=s=>String(s).trim().toLowerCase();
  const aw=(name,arity,fn)=>registerAW(w,'kernel32',name,arity,fn,{notes:'Application-private INI storage. No host WIN.INI or registry IniFileMapping.'});
  function fileName(p,wide){const s=m.string(p,wide)||'win.ini';return fs.normalize(s.includes('\\')||s.includes('/')||s.includes(':')?s:'/Windows/'+s);}
  function read(p,wide) {
    const file=fileName(p,wide);
    if(!fs.exists(file)){w.lastError=2;return {file,lines:[],sections:new Map(),unicode:false};}
    const b=fs.readBytes(file);if(b.length>w.maxFileBytes)throw new Win32Error('INI file quota exceeded',8);
    const unicode=b[0]===255&&b[1]===254;if(unicode&&(b.length%2))throw new Win32Error('Malformed UTF-16 INI file',13);
    const str=m.decode(unicode?b.subarray(2):b,unicode),lines=str.replace(/^\uFEFF/,'').split(/\r?\n/),sections=new Map();let current=null;
    lines.forEach((line,i)=>{const s=line.trim(),match=/^\[([^\]]+)\]/.exec(s);if(match){const key=ci(match[1]);if(!sections.has(key))sections.set(key,{name:match[1],start:i,keys:new Map()});current=sections.get(key);}else if(current&&s&&!/^[;#]/.test(s)){const eq=s.indexOf('=');if(eq>=0){const name=s.slice(0,eq).trim(),key=ci(name);if(!current.keys.has(key))current.keys.set(key,{name,value:s.slice(eq+1).trim(),line:i});}}});
    return {file,lines,sections,unicode};
  }
  function save(doc) {
    const text=doc.lines.join('\r\n');if(text.length>w.maxFileBytes)throw new Win32Error('INI file quota exceeded',8);
    const body=m.stringBytes(text,doc.unicode),length=body.length+(doc.unicode?2:0);if(length>w.maxFileBytes)throw new Win32Error('INI file quota exceeded',8);
    const parent=doc.file.slice(0,doc.file.lastIndexOf('/'))||'/';if(!fs.directories.has(parent))throw new Win32Error('INI directory not found',3);
    const bytes=new Uint8Array(length);if(doc.unicode)bytes.set([255,254]);bytes.set(body,doc.unicode?2:0);fs.writeBytes(doc.file,bytes);
  }
  function sectionEnd(doc,section){let i=section.start+1;while(i<doc.lines.length&&!/^\s*\[/.test(doc.lines[i]))i++;return i;}
  const sectionName=(p,wide)=>{const s=m.string(p,wide);if(!s.trim()||/[\r\n\[\]]/.test(s))throw new Win32Error('Invalid INI section name');return s;};
  function multiInput(p,wide) {
    const step=wide?2:1;let text;
    if(typeof p==='string'){if(p.length*step>w.maxFileBytes)throw new Win32Error('INI input quota exceeded',8);text=p;}
    else {const b=m.block(p),offset=Number(p)-b.ptr,limit=Math.min(b.size-offset,w.maxFileBytes);let end=-1;
      for(let i=0;i+step*2<=limit;i+=step){if(!b.bytes[offset+i]&&(!wide||!b.bytes[offset+i+1])&&!b.bytes[offset+i+step]&&(!wide||!b.bytes[offset+i+step+1])){end=i;break;}}
      if(end<0)throw new Win32Error('Unterminated INI section buffer');text=m.decode(b.bytes.subarray(offset,offset+end+2*step),wide);}
    const end=text.indexOf('\0\0');if(end<0)throw new Win32Error('INI section requires double-NUL termination');
    const entries=end?text.slice(0,end).split('\0'):[];
    for(const entry of entries){const eq=entry.indexOf('=');if(eq<=0||/[\r\n]/.test(entry)||/[\[\]]/.test(entry.slice(0,eq)))throw new Win32Error('INI section entries must be key=value');}
    return entries;
  }
  const putMulti=(out,entries,n,wide)=>m.putString(out,entries.length?entries.join('\0')+'\0':'',n,wide,true);
  aw('GetPrivateProfileString',6,(wide,app,key,def,out,n,file)=>{
    const doc=read(file,wide),section=doc.sections.get(ci(m.string(app,wide)));
    if(!app||!key)return putMulti(out,!app?[...doc.sections.values()].map(s=>s.name):[...(section?.keys.values()||[])].map(k=>k.name),n,wide);
    const entry=section?.keys.get(ci(m.string(key,wide)));let value=entry?.value??m.string(def,wide).replace(/ +$/,'');
    if(entry&&value.length>=2&&['"',"'"].includes(value[0])&&value.at(-1)===value[0])value=value.slice(1,-1);
    return m.putString(out,value,n,wide);
  });
  aw('GetPrivateProfileInt',4,(wide,app,key,def,file)=>{
    const entry=read(file,wide).sections.get(ci(m.string(app,wide)))?.keys.get(ci(m.string(key,wide)));if(!entry)return unsigned(def);
    const n=parseInt(entry.value,10);return (Number.isNaN(n)?0:n)>>>0;
  });
  aw('WritePrivateProfileString',4,(wide,app,key,value,file)=>{
    if(!app&&!key&&!value)return 1;
    const name=sectionName(app,wide),k=key?m.string(key,wide):'',v=key&&value?m.string(value,wide):'';
    if(/[\r\n=]/.test(k)||/[\r\n]/.test(v))throw new Win32Error('Invalid INI field');
    const doc=read(file,wide),s=doc.sections.get(ci(name)),entry=s?.keys.get(ci(k));
    if(!key){if(s)doc.lines.splice(s.start,sectionEnd(doc,s)-s.start);}
    else if(!value){if(entry)doc.lines.splice(entry.line,1);}
    else if(entry)doc.lines[entry.line]=entry.name+'='+v;
    else if(s)doc.lines.splice(sectionEnd(doc,s),0,k+'='+v);
    else doc.lines.push('['+name+']',k+'='+v);
    save(doc);return 1;
  });
  aw('GetPrivateProfileSectionNames',3,(wide,out,n,file)=>putMulti(out,[...read(file,wide).sections.values()].map(s=>s.name),n,wide));
  aw('GetPrivateProfileSection',4,(wide,app,out,n,file)=>{const section=read(file,wide).sections.get(ci(m.string(app,wide)));return putMulti(out,[...(section?.keys.values()||[])].map(k=>k.name+'='+k.value),n,wide);});
  aw('WritePrivateProfileSection',3,(wide,app,input,file)=>{
    const name=sectionName(app,wide),entries=input?multiInput(input,wide):null,doc=read(file,wide),s=doc.sections.get(ci(name)),replacement=entries===null?[]:['['+name+']',...entries];
    if(s)doc.lines.splice(s.start,sectionEnd(doc,s)-s.start,...replacement);else doc.lines.push(...replacement);
    save(doc);return 1;
  });
  // Same implementation and storage for the classic WIN.INI aliases.
  for(const [name,arity] of [['GetProfileString',5],['GetProfileInt',3],['WriteProfileString',3],['GetProfileSection',3],['WriteProfileSection',2]]) {
    for(const wide of [false,true]){const suffix=wide?'W':'A',api=w.resolve('kernel32',name.replace('Profile','PrivateProfile')+suffix);
      w.register('kernel32',name+suffix,(...args)=>api.fn(...args,'win.ini'),{arity,notes:'Legacy WIN.INI alias in the private Windows directory.'});}
  }
}
