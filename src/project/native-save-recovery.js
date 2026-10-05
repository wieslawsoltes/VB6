/** Staged, recoverable folder saves. Not an atomic multi-file filesystem transaction. */
import {nativeOutputPath,writeNativeDirectory} from './native-directory.js';
import {equalBytes} from './native-text.js';
export const NATIVE_SAVE_JOURNAL='.vb6-save-journal';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const MAX=50*1024*1024, active=[];
const same=(a,b)=>a===null?b===null:b!==null&&equalBytes(a,b);
async function at(root,path,create=false){let dir=root;const parts=path.split('/');for(const name of parts.slice(0,-1))try{dir=await dir.getDirectoryHandle(name,{create});}catch(e){if(!create&&e.name==='NotFoundError')return null;throw e;}try{return await dir.getFileHandle(parts.at(-1),{create});}catch(e){if(!create&&e.name==='NotFoundError')return null;throw e;}}
async function read(root,path){const h=await at(root,path);if(!h)return null;const f=await h.getFile();if(f.size>20*1024*1024)throw new Error('Recovery file exceeds 20 MiB: '+path);return new Uint8Array(await f.arrayBuffer());}
async function write(root,path,bytes){const f=await at(root,path,true),s=await f.createWritable({keepExistingData:false});try{await s.write(bytes);await s.close();}catch(e){try{await s.abort();}catch{}throw e;}}
async function remove(root,path){const parts=path.split('/');let dir=root;for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name);await dir.removeEntry(parts.at(-1));}
async function journal(root){try{return await root.getDirectoryHandle(NATIVE_SAVE_JOURNAL);}catch(e){if(e.name==='NotFoundError')return null;throw e;}}
async function localLock(root,fn){for(const h of active)if(h===root||root.isSameEntry&&await root.isSameEntry(h))throw new Error('A native folder save or recovery is already active');active.push(root);try{return await fn();}finally{active.splice(active.indexOf(root),1);}}
// Web Locks coordinate cooperating tabs on this origin. The journal and byte
// checks still protect crash recovery; external editors are not locked out.
async function lock(root,fn){const locks=globalThis.navigator?.locks;return locks?locks.request('VB6Studio.native-directory-save',()=>localLock(root,fn)):localLock(root,fn);}
// SHA-256 is required for persistent journal integrity, never a weak checksum fallback.
async function hash(bytes){if(!globalThis.crypto?.subtle)throw new Error('Recoverable saves require a secure context with SHA-256');return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
async function descriptor(root,path,data){if(data===null)return null;await write(root,path,data);const digest=await hash(data);if(!same(data,await read(root,path)))throw new Error('Recovery stage verification failed');return {path,size:data.length,sha256:digest};}
async function verified(root,d,expected){if(d===null)return null;if(!d||d.path!==expected||!Number.isSafeInteger(d.size)||d.size<0||d.size>20*1024*1024||!/^[a-f0-9]{64}$/.test(d.sha256))throw new Error('Invalid recovery data descriptor');const b=await read(root,d.path);if(!b||b.length!==d.size||await hash(b)!==d.sha256)throw new Error('Recovery data is missing or corrupt: '+d.path);return b;}
async function load(root){
  const dir=await journal(root);if(!dir)return null;const bytes=await read(dir,'manifest.json');if(!bytes||bytes.length>2*1024*1024)throw new Error('Incomplete recovery staging: no valid manifest. Keep the incomplete journal for manual inspection; no automatic recovery is possible.');
  const doc=JSON.parse(decoder.decode(bytes));if(doc.version!==1||doc.format!=='VB6Studio.NativeSave'||!Array.isArray(doc.entries)||doc.entries.length>2000||!['staged','committed'].includes(doc.phase))throw new Error('Invalid native recovery manifest');
  const entries=[],names=new Set();let total=0;
  for(let i=0;i<doc.entries.length;i++){
    const e=doc.entries[i],path=nativeOutputPath(e.path);if(path!==e.path||path.split('/')[0].toLowerCase()===NATIVE_SAVE_JOURNAL||names.has(path.toLowerCase()))throw new Error('Invalid recovery destination');names.add(path.toLowerCase());
    const before=await verified(dir,e.before,'before/'+i),after=await verified(dir,e.after,'after/'+i);if(after===null)throw new Error('Missing recovery output');total+=(before?.length||0)+after.length;if(total>2*MAX)throw new Error('Recovery exceeds size limit');entries.push({path,before,bytes:after});
  }return {dir,doc,entries};
}
export async function inspectNativeSaveRecovery(root){const state=await load(root);if(!state)return null;const files=[];for(const e of state.entries){const current=await read(root,e.path);files.push({path:e.path,state:same(current,e.bytes)?'saved':same(current,e.before)?'original':'conflict',created:e.before===null});}return {phase:state.doc.phase,files,conflicts:files.filter(e=>e.state==='conflict').map(e=>e.path)};}
async function recover(root,action){
  const state=await load(root);if(!state)return {recovered:[],remaining:[],journal:false};
  if(!['rollback','complete'].includes(action))throw new Error('Recovery action must be rollback or complete');
  state.entries.sort((a,b)=>(/\.vbg$/i.test(a.path)?2:/\.vbp$/i.test(a.path)?1:0)-(/\.vbg$/i.test(b.path)?2:/\.vbp$/i.test(b.path)?1:0));
  const order=action==='rollback'?[...state.entries].reverse():state.entries,recovered=[],remaining=[];
  // Preflight all entries, including unchanged source dependencies, before any recovery writes.
  for(const e of order){const b=await read(root,e.path);if(!same(b,e.before)&&!same(b,e.bytes))remaining.push(e.path);}
  if(remaining.length)return {recovered,remaining,journal:true};
  for(const e of order){
    try{const desired=action==='rollback'?e.before:e.bytes,current=await read(root,e.path);if(same(current,desired))continue;if(!same(current,e.before)&&!same(current,e.bytes)){remaining.push(e.path);break;}
      if(desired===null)await remove(root,e.path);else await write(root,e.path,desired);
      if(!same(await read(root,e.path),desired)){remaining.push(e.path);break;}recovered.push(e.path);
    }catch{remaining.push(e.path);break;}
  }
  for(const e of state.entries)if(!same(await read(root,e.path),action==='rollback'?e.before:e.bytes)&&!remaining.includes(e.path))remaining.push(e.path);
  let cleanupPending=false;if(!remaining.length)try{await root.removeEntry(NATIVE_SAVE_JOURNAL,{recursive:true});}catch{cleanupPending=true;}
  return {recovered,remaining,journal:!!remaining.length||cleanupPending,cleanupPending};
}
export async function recoverNativeDirectory(root,{action='rollback'}={}){return lock(root,()=>recover(root,action));}
export async function writeRecoverableNativeDirectory(plan){return lock(plan.handle,async()=>{
  const root=plan.handle;if(typeof root.removeEntry!=='function')throw new Error('Recoverable saves require directory removal support');
  if(await journal(root))throw new Error('A previous native save journal exists. Recover or inspect it before saving again.');
  for(const e of plan.observed||plan.entries){nativeOutputPath(e.path);if(e.path.split('/')[0].toLowerCase()===NATIVE_SAVE_JOURNAL)throw new Error('Reserved save journal path');if(!same(await read(root,e.path),e.before))throw new Error('File changed since save confirmation: '+e.path+'; nothing was written');}
  if(!plan.entries.length)return writeNativeDirectory(plan);
  const dir=await root.getDirectoryHandle(NATIVE_SAVE_JOURNAL,{create:true}),doc={format:'VB6Studio.NativeSave',version:1,phase:'staged',entries:[]};let staged=false;
  try{
    // Stage both original and intended bytes for ALL observed dependencies.
    for(const [i,e]of (plan.observed||plan.entries).entries())doc.entries.push({path:e.path,before:await descriptor(dir,'before/'+i,e.before),after:await descriptor(dir,'after/'+i,e.bytes)});
    await write(dir,'manifest.json',encoder.encode(JSON.stringify(doc)));await load(root);staged=true;
    const result=await writeNativeDirectory(plan);
    // All destination bytes are verified. Bookkeeping/cleanup failure cannot turn
    // a completed save into a destructive rollback (or discard its valid result).
    let recoveryCleanupPending=false;
    try{doc.phase='committed';await write(dir,'manifest.json',encoder.encode(JSON.stringify(doc)));await root.removeEntry(NATIVE_SAVE_JOURNAL,{recursive:true});}catch{recoveryCleanupPending=true;}
    return {...result,recoverable:true,recoveryCleanupPending};
  }catch(error){
    if(!staged){throw new Error(error.message+'; recovery staging did not complete. No destination file was changed. Retained '+NATIVE_SAVE_JOURNAL+' for inspection.');}
    // A failed publication can be reverted only while current bytes still match
    // this operation. Never destroy a third party's later edit to "roll back".
    let recovery;try{recovery=await recover(root,'rollback');}catch{}
    const message=recovery&&!recovery.remaining.length?'Original destination bytes restored.':'Recovery journal retained; inspect conflicts before retrying.';
    const result=new Error(error.message+'; '+message+' The project remains unsaved.');result.recovery=recovery;throw result;
  }
});}
