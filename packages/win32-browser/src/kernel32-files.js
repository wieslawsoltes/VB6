import {Win32Error,integer,unsigned} from './core.js';
import {registerAW,units,putComplete} from './services-utils.js';

/** File discovery in the existing app-private disk, not host disk discovery.
 * WIN32_FIND_DATA has DWORD fields at 0..43, then 260/14 TCHARs.
 * https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-findfirstfilea
 * https://learn.microsoft.com/windows/win32/api/minwinbase/ns-minwinbase-win32_find_dataa */
export function installFileUtilities(w) {
  const m=w.memory,h=w.handles,fs=w.fs;
  const notes='Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero.';
  const aw=(name,arity,fn)=>registerAW(w,'kernel32',name,arity,fn,{notes});
  const pathOf=text=>{if(!text)throw new Win32Error('Path is empty',3);if(/^(?:\\\\|\/\/)/.test(text)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.:]|$)/i.test(text.split(/[\\/]/).at(-1)))throw new Win32Error('Devices and UNC paths are unsupported',50);return fs.normalize(text);};
  const parent=p=>p.slice(0,p.lastIndexOf('/'))||'/';
  function matches(pattern,name) {
    pattern=pattern.toLowerCase();name=name.toLowerCase();if(pattern==='*.*')pattern='*';
    // Bounded dynamic program, not a backtracking regular expression.
    function glob(p){let row=Array(name.length+1).fill(false);row[0]=true;
      for(const c of p){const next=Array(name.length+1).fill(false);next[0]=c==='*'&&row[0];for(let i=1;i<=name.length;i++)next[i]=c==='*'?(next[i-1]||row[i]):row[i-1]&&(c==='?'||c===name[i-1]);row=next;}return row[name.length];}
    return glob(pattern)||(!name.includes('.')&&pattern.endsWith('.*')&&glob(pattern.slice(0,-2)));
  }
  function writeFind(entry,out,wide){
    const step=wide?2:1,size=wide?592:320,n=units(m,entry.name,wide);
    if(n>=260)throw new Win32Error('Filename exceeds WIN32_FIND_DATA capacity',206);
    const buffer=m.bytes(out,size);buffer.fill(0);const view=m.view(out,size);
    view.setUint32(0,entry.directory?16:128,true);view.setUint32(32,entry.size,true);
    m.putString(out+44,entry.name,260,wide);return 1;
  }
  for(const wide of [false,true]){
    w.register('kernel32','FindFirstFile'+(wide?'W':'A'),(input,out)=>{
      const raw=m.string(input,wide);if(/[\\/]$/.test(raw))throw new Win32Error('Search path has a trailing separator',2);
      const path=pathOf(raw),folder=parent(path),pattern=path.slice(path.lastIndexOf('/')+1);
      if(folder.includes('*')||folder.includes('?'))throw new Win32Error('Wildcards are supported only in the filename',50);
      if(pattern.length>259)throw new Win32Error('Search pattern is too long',206);
      if(!fs.directories.has(folder))throw new Win32Error('Directory not found',3);
      m.bytes(out,wide?592:320);const entries=[],seen=new Set();
      const limit=integer(w.options.maxFindEntries??16384,1,1000000);
      for(const [paths,directory] of [[fs.directories,true],[fs.files.keys(),false]])for(const p of paths){
        if(p===folder||parent(p).toLowerCase()!==folder.toLowerCase()||seen.has(p.toLowerCase()))continue;
        const name=p.slice(p.lastIndexOf('/')+1);if(!matches(pattern,name))continue;
        if(entries.length>=limit)throw new Win32Error('File enumeration quota exceeded',8);
        seen.add(p.toLowerCase());entries.push({name,directory,size:directory?0:fs.readBytes(p).length});
      }
      if(!entries.length)throw new Win32Error('No matching files',2);
      // Validate the first record before reserving a handle, and roll back on error.
      if(units(m,entries[0].name,wide)>=260)throw new Win32Error('Filename is too long',206);
      const handle=h.add('find',{entries,index:0});try{writeFind(entries[0],out,wide);}catch(error){h.close(handle,'find');throw error;}return handle;
    },{arity:2,notes,failure:-1});
    w.register('kernel32','FindNextFile'+(wide?'W':'A'),(handle,out)=>{const state=h.get(handle,'find'),entry=state.entries[state.index+1];if(!entry)throw new Win32Error('No more files',18);writeFind(entry,out,wide);state.index++;return 1;},{arity:2,notes});
  }
  w.register('kernel32','FindClose',handle=>{h.close(handle,'find');return 1;},{arity:1,notes});
  w.register('kernel32','GetFileSizeEx',(handle,out)=>{const file=h.get(handle,'file');m.view(out,8).setBigInt64(0,BigInt(fs.readBytes(file.path).length),true);return 1;},{arity:2,notes});
  w.register('kernel32','FlushFileBuffers',handle=>{const file=h.get(handle,'file');if(!file.write)throw new Win32Error('Write access is required',5);const result=fs.flush?.(file.path);return result?.then?result.then(()=>1):1;},{arity:1,notes:'Writes to the private memory disk are immediate. Calls fs.flush(path) when supplied; no claim of host disk durability.'});
  aw('GetFullPathName',4,(wide,input,capacity,out,filePart)=>{
    const value='C:'+pathOf(m.string(input,wide)).replace(/\//g,'\\'),n=units(m,value,wide);
    capacity=integer(capacity,0,Math.floor(m.maxBytes/(wide?2:1)));if(capacity<=n)return n+1;
    if(filePart)m.view(filePart,4);putComplete(m,out,value,capacity,wide);
    if(filePart){const index=value.lastIndexOf('\\')+1;m.writeU32(filePart,index===value.length?0:Number(out)+units(m,value.slice(0,index),wide)*(wide?2:1));}return n;
  });
  let sequence=1;
  aw('GetTempFileName',4,(wide,directory,prefix,unique,out)=>{
    const dir=pathOf(m.string(directory,wide));if(!fs.directories.has(dir))throw new Win32Error('Temporary directory not found',3);
    const pre=m.string(prefix,wide).slice(0,3);if(/[\\/:*?<>|]/.test(pre))throw new Win32Error('Invalid temporary prefix');
    unique=unsigned(unique)&65535;let chosen=unique,path;
    for(let attempt=0;attempt<65535;attempt++){
      if(!unique){chosen=sequence;sequence=sequence%65535+1;}
      path=fs.normalize(dir+'/'+pre+chosen.toString(16).toUpperCase().padStart(4,'0')+'.tmp');
      if(unique||!fs.exists(path)&&!fs.directories.has(path))break;path=null;
    }
    if(!path)throw new Win32Error('Temporary name space exhausted',80);
    const value='C:'+path.replace(/\//g,'\\');if(units(m,value,wide)>=260)throw new Win32Error('Temporary path is too long',206);
    m.bytes(out,260*(wide?2:1));if(!unique)fs.writeBytes(path,[]);putComplete(m,out,value,260,wide);return chosen;
  });
}
