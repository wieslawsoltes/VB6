import {installWindowProperties} from './user32-properties.js';
import {installBinaryCodec,CRYPT_CONSTANTS} from './crypt32-codec.js';
import {installGUID} from './ole32-guid.js';
import {installPathUtilities} from './shlwapi.js';
import {installFileUtilities} from './kernel32-files.js';
import {installNLS,NLS_CONSTANTS} from './kernel32-nls.js';
import {installSynchronization,SYNC_CONSTANTS} from './kernel32-sync.js';
import {GPURasterPresenter} from './gpu-presenter.js';
import {TRANSFORM_CONSTANTS} from './gdi-transform.js';
import {PATH_CONSTANTS} from './gdi-path.js';
import {TEXT_CONSTANTS} from './gdi-text.js';
import {PAINT_CONSTANTS} from './user32-paint.js';
import {REGION_CONSTANTS,RegionStore} from './gdi-region.js';
import {GDI_CONSTANTS} from './gdi-bitmap.js';
import {installClipboard} from './clipboard.js';
import {ERROR,Win32Error,Handles,Memory,MemoryFileSystem,integer,unsigned,encodeANSI,decodeANSI} from './core.js';
import {installKernel32} from './kernel32.js';
import {installUser32} from './user32.js';
import {installRegistry} from './advapi32.js';
import {installGDI,colorRef} from './gdi32.js';
export {GPURasterPresenter,RegionStore,ERROR,Win32Error,Memory,MemoryFileSystem,encodeANSI,decodeANSI,colorRef};
export const WIN32_CONSTANTS=Object.freeze({...NLS_CONSTANTS,...SYNC_CONSTANTS,...CRYPT_CONSTANTS,...TRANSFORM_CONSTANTS,...PATH_CONSTANTS,...TEXT_CONSTANTS,...PAINT_CONSTANTS,...GDI_CONSTANTS,...REGION_CONSTANTS,INVALID_HANDLE_VALUE:-1,GENERIC_READ:0x80000000,GENERIC_WRITE:0x40000000,FILE_SHARE_READ:1,FILE_SHARE_WRITE:2,CREATE_NEW:1,CREATE_ALWAYS:2,OPEN_EXISTING:3,OPEN_ALWAYS:4,TRUNCATE_EXISTING:5,FILE_ATTRIBUTE_NORMAL:128,FILE_ATTRIBUTE_DIRECTORY:16,GMEM_FIXED:0,GMEM_MOVEABLE:2,GMEM_ZEROINIT:64,SW_HIDE:0,SW_SHOWNORMAL:1,SW_SHOW:5,SW_RESTORE:9,WM_SETTEXT:12,WM_GETTEXT:13,WM_GETTEXTLENGTH:14,HKEY_CURRENT_USER:0x80000001,KEY_READ:0x20019,KEY_WRITE:0x20006,KEY_ALL_ACCESS:0xf003f,REG_SZ:1,REG_EXPAND_SZ:2,REG_BINARY:3,REG_DWORD:4,REG_MULTI_SZ:7,REG_QWORD:11,CF_TEXT:1,CF_UNICODETEXT:13});
export function normalizeDLL(name){const dll=String(name).replace(/\\/g,'/').split('/').at(-1).replace(/\.dll$/i,'').toLowerCase();if(!/^[a-z0-9_.-]+$/.test(dll))throw new Win32Error('Invalid DLL name',126);return dll;}
/** Reusable browser/worker/Node compatibility process; never loads native code. */
export class Win32Browser {
  constructor(options={}){
    this.options=options;this.memory=new Memory(options);this.handles=new Handles(options.maxHandles);this.fs=options.fs||new MemoryFileSystem();this.lastError=0;this.disposed=false;this.modules=new Map();this.timers=new Map();this.timerCallbacks=new Map();this.nextTimer=1;this.delays=new Set();this.clock=options.clock||(()=>globalThis.performance?.now?.()??Date.now());this.now=options.now||(()=>new Date());this.epoch=this.clock();this.maxFileBytes=integer(options.maxFileBytes??Math.min(20*1024*1024,this.memory.maxBytes),1,this.memory.maxBytes);this.environment=new Map(Object.entries(options.environment||{}).map(([k,v])=>[k.toUpperCase(),String(v)]));
    for(const name of ['/Windows','/Temp'])this.fs.directories.add(this.fs.normalize(name));
    installKernel32(this);installUser32(this);installRegistry(this);installGDI(this);installClipboard(this);installFileUtilities(this);installNLS(this);installSynchronization(this);installPathUtilities(this);installGUID(this);installBinaryCodec(this);installWindowProperties(this);
    if(options.registry){for(const [path,record]of options.registry){if(!/^(HKCR|HKCU|HKLM|HKU|HKCC)(\\|$)/.test(path)||!Array.isArray(record.values))throw new Win32Error('Invalid registry snapshot');this.registry.set(path,{name:String(record.name),values:new Map(record.values)});}}
    this.register('shell32','ShellExecuteA',(handle,operation,file,parameters,directory,show)=>this.openURL(false,handle,operation,file,parameters,directory,show),{arity:6,failure:5,mode:'browser',notes:'Only explicitly enabled http/https/mailto navigation; no executable launch.'});
    this.register('shell32','ShellExecuteW',(handle,operation,file,parameters,directory,show)=>this.openURL(true,handle,operation,file,parameters,directory,show),{arity:6,failure:5,mode:'browser',notes:'Only explicitly enabled http/https/mailto navigation; no executable launch.'});
  }
  register(dll,name,fn,{arity,mode='emulated',notes='',failure=0,statusError=false,replace=false}={}){dll=normalizeDLL(dll);if(typeof fn!=='function'||!Number.isInteger(arity)||arity<0||arity>64||!/^[A-Za-z_]\w*$/.test(name))throw new Win32Error('Invalid API registration');let exports=this.modules.get(dll);if(!exports)this.modules.set(dll,exports=new Map());if(exports.has(name)&&!replace)throw new Win32Error('Duplicate API export');exports.set(name,{dll,name,fn,arity,mode,notes,failure,statusError});return this;}
  resolve(dll,name){dll=normalizeDLL(dll);const module=this.modules.get(dll);if(!module)throw new Win32Error('DLL has no browser compatibility module: '+dll,126);const api=module.get(String(name));if(!api)throw new Win32Error('Win32 API is not implemented: '+dll+'!'+name,127);return api;}
  invoke(dll,name,args=[]){if(this.disposed)throw new Win32Error('Compatibility process is disposed',995);const api=this.resolve(dll,name);if(!Array.isArray(args)||args.length!==api.arity)throw new Win32Error('Invalid argument count for '+api.dll+'!'+name,87);const failure=error=>{if(!(error instanceof Win32Error))throw error;if(api.statusError)return error.code;this.lastError=error.code;this.options.onDiagnostic?.({dll:api.dll,name,code:error.code,message:error.message});return typeof api.failure==='function'?api.failure(args):api.failure;};try{const value=api.fn(...args);return value?.then?value.catch(failure):value;}catch(error){return failure(error);}}
  manifest(){return [...this.modules.values()].flatMap(exports=>[...exports.values()].map(({dll,name,arity,mode,notes})=>({dll,name,arity,mode,notes}))).sort((a,b)=>(a.dll+'!'+a.name).localeCompare(b.dll+'!'+b.name));}
  registerWindow(descriptor){if(!descriptor||typeof descriptor!=='object')throw new Win32Error('Window descriptor required');return this.handles.add('window',descriptor);}
  unregisterWindow(handle){if(!this.handles.has(handle,'window'))return;this.releaseWindowProperties?.(handle);this.releaseWindowGDI?.(handle);for(const [key,t]of this.timers)if(t.handle===Number(handle)){clearInterval(t.timer);this.timers.delete(key);}for(const [id,e]of this.handles.entries)if(e.type==='dc'&&e.value.handle===Number(handle))this.handles.close(id,'dc');this.handles.close(handle,'window');}
  registerCallback(fn,{onTimer=fn}={}){if(typeof fn!=='function'||typeof onTimer!=='function')throw new Win32Error('Callback must be a function');const handle=this.handles.add('callback',fn);this.timerCallbacks.set(handle,onTimer);return handle;}
  unregisterCallback(handle){for(const t of this.timers.values())if(t.callback===handle)throw new Win32Error('Callback is still used by a timer',5);this.handles.close(handle,'callback');this.timerCallbacks.delete(handle);}
  sleep(milliseconds){milliseconds=unsigned(milliseconds);return new Promise((resolve,reject)=>{const state={timer:null,reject};this.delays.add(state);const end=this.clock()+milliseconds;const next=()=>{if(this.disposed){this.delays.delete(state);reject(new Win32Error('Sleep cancelled',995));return;}const remaining=end-this.clock();if(remaining<=0){this.delays.delete(state);resolve();}else state.timer=setTimeout(next,Math.min(remaining,0x7fffffff));};state.timer=setTimeout(next,Math.min(milliseconds,0x7fffffff));});}
  registrySnapshot(){return [...this.registry].map(([path,r])=>[path,{name:r.name,values:[...r.values].map(([key,v])=>[key,{...v,value:Array.isArray(v.value)?v.value.slice():v.value}])}]);}
  async openURL(wide,handle,operation,file,parameters,directory,show){if(handle)this.handles.get(handle,'window');const verb=this.memory.string(operation,wide).toLowerCase();if(verb&&verb!=='open'||this.memory.string(parameters,wide)||this.memory.string(directory,wide))return 31;let url;try{url=new URL(this.memory.string(file,wide));}catch{throw new Win32Error('Invalid navigation URL',87);}if(!['http:','https:','mailto:'].includes(url.protocol)||!this.options.allowNavigation||typeof this.options.openURL!=='function')return 5;return await this.options.openURL(url.href,show)?33:5;}
  dispose(){if(this.disposed)return;this.disposeWindowGDI?.();this.disposeSynchronization?.();this.disposeWindowProperties?.();this.disposed=true;for(const t of this.timers.values())clearInterval(t.timer);this.timers.clear();for(const d of this.delays){clearTimeout(d.timer);d.reject(new Win32Error('Operation cancelled',995));}this.delays.clear();this.handles.entries.clear();this.timerCallbacks.clear();this.memory.clear();}
}
export function createWin32(options={}){return new Win32Browser(options);}
