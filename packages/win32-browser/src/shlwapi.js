import {Win32Error} from './core.js';
import {registerAW,units,putComplete} from './services-utils.js';
/** Lexical Windows path helpers. No shell, URL navigation or native filesystem.
 * https://learn.microsoft.com/windows/win32/api/shlwapi/nf-shlwapi-pathcombinea
 * https://learn.microsoft.com/windows/win32/api/shlwapi/nf-shlwapi-pathfindextensiona */
export function installPathUtilities(w){
  const m=w.memory,notes='Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access.';
  const aw=(name,arity,fn)=>registerAW(w,'shlwapi',name,arity,fn,{notes});
  const read=(p,wide)=>{const s=m.string(p,wide);if(units(m,s,wide)>=260)throw new Win32Error('Path exceeds MAX_PATH',206);return s;};
  const write=(p,s,wide)=>{if(units(m,s,wide)>=260)throw new Win32Error('Path exceeds MAX_PATH',206);putComplete(m,p,s,Math.min(260,Math.floor(m.size(p)/(wide?2:1))),wide);};
  const filename=s=>Math.max(s.lastIndexOf('\\'),s.lastIndexOf('/'),s.lastIndexOf(':'))+1;
  const extension=s=>{const start=filename(s),dot=s.lastIndexOf('.');return dot>=start?dot:s.length;};
  const root=s=>/^(?:[A-Za-z]:\\|\\|\\\\[^\\]+\\[^\\]+\\?)$/.test(s);
  function canonical(s){
    if(/^\\\\[?.]\\/.test(s))throw new Win32Error('Device namespaces are unsupported',50);
    let prefix='',rest=s;
    const unc=/^(\\\\[^\\]+\\[^\\]+)(?:\\|$)/.exec(s),drive=/^[A-Za-z]:/.exec(s);
    if(unc){prefix=unc[1]+'\\';rest=s.slice(unc[0].length);}else if(drive){prefix=drive[0]+(s[2]==='\\'?'\\':'');rest=s.slice(prefix.length);}else if(s[0]==='\\'){prefix='\\';rest=s.slice(1);}
    const parts=[];for(const item of rest.split('\\')){if(!item||item==='.')continue;if(item==='..'){if(parts.length&&parts.at(-1)!=='..')parts.pop();else if(!prefix.endsWith('\\'))parts.push('..');}else parts.push(item);}
    return prefix+parts.join('\\')||(s?'\\':'');
  }
  aw('PathFindFileName',1,(wide,p)=>Number(p)+units(m,read(p,wide).slice(0,filename(read(p,wide))),wide)*(wide?2:1));
  aw('PathFindExtension',1,(wide,p)=>Number(p)+units(m,read(p,wide).slice(0,extension(read(p,wide))),wide)*(wide?2:1));
  aw('PathRemoveExtension',1,(wide,p)=>{const s=read(p,wide);write(p,s.slice(0,extension(s)),wide);});
  aw('PathRenameExtension',2,(wide,p,ext)=>{const s=read(p,wide),e=read(ext,wide);if(e&&(!e.startsWith('.')||/[\\/:*?]/.test(e)))throw new Win32Error('Invalid extension');write(p,s.slice(0,extension(s))+e,wide);return 1;});
  aw('PathAddBackslash',1,(wide,p)=>{let s=read(p,wide);if(s&&!s.endsWith('\\'))s+='\\';write(p,s,wide);return Number(p)+units(m,s,wide)*(wide?2:1);});
  aw('PathRemoveBackslash',1,(wide,p)=>{let s=read(p,wide);const index=Math.max(0,units(m,s,wide)-1);if(s.endsWith('\\')&&!root(s))s=s.slice(0,-1);write(p,s,wide);return Number(p)+index*(wide?2:1);});
  aw('PathIsRelative',1,(wide,p)=>{const s=read(p,wide);return s.startsWith('\\')||s.length>1&&s[1]===':'?0:1;});
  aw('PathIsRoot',1,(wide,p)=>root(read(p,wide))?1:0);
  aw('PathIsUNC',1,(wide,p)=>read(p,wide).startsWith('\\\\')?1:0);
  aw('PathCanonicalize',2,(wide,out,input)=>{write(out,canonical(read(input,wide)),wide);return 1;});
  aw('PathCombine',3,(wide,out,dir,file)=>{
    if(!dir&&!file)throw new Win32Error('At least one path is required');
    const a=read(dir,wide),b=read(file,wide);let value;
    if(!a||/^[A-Za-z]:|^\\\\/.test(b))value=b;
    else if(b.startsWith('\\')){const match=/^(?:[A-Za-z]:|\\\\[^\\]+\\[^\\]+)/.exec(a);value=(match?.[0]??'')+b;}
    else value=a+(a.endsWith('\\')||!b?'':'\\')+b;
    write(out,canonical(value),wide);return out;
  });
  aw('PathFileExists',1,(wide,p)=>{const s=read(p,wide);if(!s||s.startsWith('\\\\'))return 0;const path=w.fs.normalize(s);return w.fs.exists(path)||w.fs.directories.has(path)?1:0;});
  aw('PathIsDirectory',1,(wide,p)=>{const s=read(p,wide);return s&&!s.startsWith('\\\\')&&w.fs.directories.has(w.fs.normalize(s))?16:0;});
}
