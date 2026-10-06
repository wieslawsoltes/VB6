import {Win32Error,unsigned} from './core.js';

/** Process-private handle duplication. No OS process or thread authority.
 * https://learn.microsoft.com/windows/win32/api/handleapi/nf-handleapi-duplicatehandle
 * https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess
 */
export const HANDLE_CONSTANTS=Object.freeze({DUPLICATE_CLOSE_SOURCE:1,DUPLICATE_SAME_ACCESS:2,FILE_TYPE_UNKNOWN:0,FILE_TYPE_DISK:1,FILE_BEGIN:0,FILE_CURRENT:1,FILE_END:2});
export function installHandleServices(w){
  const h=w.handles,m=w.memory;
  const add=(name,arity,fn,options={})=>w.register('kernel32',name,fn,{arity,notes:'Current compatibility instance only. File duplicates share the cursor; synchronization duplicates share the object. No OS process access or inheritance.',...options});
  add('GetCurrentProcess',0,()=>-1);
  add('DuplicateHandle',7,(sourceProcess,source,targetProcess,out,access,inherit,options)=>{
    options=unsigned(options);
    // Close-source applies even on an output/access/allocation failure, but only
    // to handles belonging to the explicitly selected compatibility process.
    if(unsigned(sourceProcess)!==0xffffffff)throw new Win32Error('Foreign process handle',6);
    const entry=h.entries.get(Number(source));
    if(!entry||!['file','sync'].includes(entry.type))throw new Win32Error('Unsupported source handle',6);
    try{
      if(options&~3)throw new Win32Error('Unsupported duplicate options');
      if(!targetProcess&&(options&1))return 1;
      if(unsigned(targetProcess)!==0xffffffff)throw new Win32Error('Foreign target process',6);
      if(inherit)throw new Win32Error('Handle inheritance is unavailable',50);
      // Win32's legacy NULL output intentionally leaks. Fail explicitly instead.
      m.view(out,4);
      let value=entry.value;
      if(!(options&2)){
        access=unsigned(access);
        if(entry.type==='sync'){
          if(access&~value.access)throw new Win32Error('Cannot increase granted access',5);
          value={object:value.object,access};
        }else{
          const granted=(value.read?0x80000000:0)|(value.write?0x40000000:0);
          if(access&~granted)throw new Win32Error('Cannot increase granted access',5);
          // Forward only the shared file cursor; permissions remain per handle.
          const original=value;
          value={path:original.path,share:original.share,read:!!(access&0x80000000),write:!!(access&0x40000000),get position(){return original.position;},set position(n){original.position=n;}};
        }
      }
      const duplicate=h.add(entry.type,value);
      if(entry.type==='sync')value.object.refs++;
      m.writeU32(out,duplicate);return 1;
    }finally{
      if(options&1)w.resolve('kernel32','CloseHandle').fn(source);
    }
  });
  add('GetFileType',1,handle=>{h.get(handle,'file');return 1;});
}
