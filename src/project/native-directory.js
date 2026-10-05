/** Capability-based directory I/O. Never obtains a handle or permission itself. */
import {normalizedEntries,MAX_NATIVE_FILES,MAX_NATIVE_BYTES} from './native-project.js';
import {bytesOf,equalBytes} from './native-text.js';
import {cleanProjectPath} from './frx.js';
const fail=message=>{throw new Error(message);};
export function nativeOutputPath(path){path=cleanProjectPath(path);for(const part of path.split('/'))if(/[<>:"|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))fail('Unsafe Windows output path: '+path);return path;}
export async function readNativeDirectory(handle){
  const files=[],skipped=[];let total=0;
  const walk=async(dir,prefix='',depth=0)=>{
    if(depth>16)fail('Folder nesting exceeds 16 levels');
    for await(const item of dir.values()){
      const path=prefix+item.name;
      if(item.kind==='directory'){if(['.git','node_modules'].includes(item.name)){skipped.push(path);continue;}await walk(item,path+'/',depth+1);}
      else if(item.kind==='file'){if(files.length>=MAX_NATIVE_FILES)fail('Folder contains more than 2,000 files');const f=await item.getFile();total+=f.size;if(f.size>20*1024*1024||total>MAX_NATIVE_BYTES)fail('Folder exceeds the 20 MiB/file or 50 MiB total limit');files.push([path,new Uint8Array(await f.arrayBuffer())]);}
    }
  };
  await walk(handle);return {entries:normalizedEntries(files),skipped};
}
async function directory(handle,path,create=false){let dir=handle;for(const part of path.split('/').slice(0,-1)){try{dir=await dir.getDirectoryHandle(part,{create});}catch(error){if(!create&&error.name==='NotFoundError')return null;throw error;}}return dir;}
async function fileAt(handle,path){const dir=await directory(handle,path);if(!dir)return null;try{return await dir.getFileHandle(path.split('/').at(-1));}catch(error){if(error.name==='NotFoundError')return null;throw error;}}
async function existingBytes(handle,path){const file=await fileAt(handle,path);if(!file)return null;const data=await file.getFile();if(data.size>20*1024*1024)fail('Existing file is too large to compare safely: '+path);return new Uint8Array(await data.arrayBuffer());}
const manifestOrder=path=>/\.vbg$/i.test(path)?2:/\.vbp$/i.test(path)?1:0;
/** Preflight every path and collect original bytes before the first mutation. */
export async function planNativeDirectoryWrite(handle,input){
  const entries=normalizedEntries(Object.entries(input)),plan=[],observed=[];let oldTotal=0;
  for(const [name,value]of entries){const path=nativeOutputPath(name),bytes=bytesOf(value).slice(),before=await existingBytes(handle,path);oldTotal+=before?.length||0;if(oldTotal>MAX_NATIVE_BYTES)fail('Existing output files exceed the 50 MiB comparison limit');const entry={path,bytes,before};observed.push(entry);if(!before||!equalBytes(before,bytes))plan.push(entry);}
  plan.sort((a,b)=>manifestOrder(a.path)-manifestOrder(b.path));return {handle,entries:plan,observed,unchanged:entries.size-plan.length};
}
function matches(before,current){return before===null?current===null:current!==null&&equalBytes(before,current);}
/** Revision checks cancel stale saves. File-system APIs do not offer a directory transaction. */
export async function writeNativeDirectory(plan){
  const observed=plan.observed||plan.entries;
  for(const entry of observed)if(!matches(entry.before,await existingBytes(plan.handle,entry.path)))fail('File changed since save confirmation: '+entry.path+'; nothing was written');
  const written=[],completed=new Set();
  const verify=async()=>{
    for(const entry of observed)if(!matches(completed.has(entry.path)?entry.bytes:entry.before,await existingBytes(plan.handle,entry.path)))fail('File changed during save: '+entry.path);
  };
  try{
    let phase=0;
    for(const entry of plan.entries){
      // Recheck source/resource dependencies before publishing VBP/VBG manifests.
      if(manifestOrder(entry.path)>phase){await verify();phase=manifestOrder(entry.path);}
      if(!matches(entry.before,await existingBytes(plan.handle,entry.path)))fail('File changed during save: '+entry.path);
      const dir=await directory(plan.handle,entry.path,true),file=await dir.getFileHandle(entry.path.split('/').at(-1),{create:true}),stream=await file.createWritable({keepExistingData:false});
      try{await stream.write(entry.bytes);await stream.close();}catch(error){try{await stream.abort();}catch{}throw error;}written.push(entry.path);completed.add(entry.path);
    }
    await verify();
  }catch(error){throw new Error(error.message+'; '+written.length+' files completed. The project remains unsaved. Review the destination before retrying.');}
  return {written,unchanged:plan.unchanged};
}
