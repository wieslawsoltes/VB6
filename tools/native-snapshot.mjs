/** Single-file publication and stable, bounded native workspace reads. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {normalizedEntries} from '../src/project/native-project.js';
import {nativeOutputPath} from '../src/project/native-directory.js';
import {equalBytes} from '../src/project/native-text.js';
import {writeZip} from '../src/project/zip.js';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function readStableNativeFolder(root){
  root=await fs.realpath(root);const files=[];let total=0;
  async function walk(dir,prefix='',depth=0){if(depth>16)throw Error('Folder nesting exceeds 16 levels');for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw Error('Symbolic links are not allowed in native snapshots');if(['.git','node_modules','.vb6-save-journal'].includes(entry.name.toLowerCase()))continue;const name=prefix+entry.name;if(entry.isDirectory())await walk(path.join(dir,entry.name),name+'/',depth+1);else if(entry.isFile()){if(files.length>=2000)throw Error('Too many native files');const full=path.join(dir,entry.name),stat=await fs.lstat(full);if(stat.isSymbolicLink()||stat.size>20*1024*1024)throw Error('Invalid or excessive native file');total+=stat.size;if(total>50*1024*1024)throw Error('Native snapshot exceeds 50 MiB');const bytes=await fs.readFile(full);if(bytes.length!==stat.size)throw Error('Source changed while reading '+name);files.push([nativeOutputPath(name),bytes]);}}}
  await walk(root);
  for(const [name,bytes]of files){const file=path.join(root,name);if((await fs.lstat(file)).isSymbolicLink()||!equalBytes(await fs.readFile(file),bytes))throw Error('Source changed while reading '+name);}
  return normalizedEntries(files);
}
export async function publishAtomicSnapshot(filename,bytes){
  filename=path.resolve(filename);if(!(bytes instanceof Uint8Array)||bytes.length>100*1024*1024)throw TypeError('Bounded snapshot bytes required');
  const dir=path.dirname(filename);await fs.mkdir(dir,{recursive:true});const temporary=path.join(dir,'.vb6-snapshot-'+randomUUID()+'.tmp');let handle;
  try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    // The new name appears only after complete bytes are flushed. An existing
    // file is never overwritten, including a racing creator or symbolic link.
    await fs.link(temporary,filename);
    return {path:filename,size:bytes.length,sha256:sha256(bytes),publication:'exclusive-hard-link',powerLossCertified:false};
  }finally{await handle?.close().catch(()=>{});await fs.rm(temporary,{force:true}).catch(()=>{});}
}
// Resolve existing ancestors even when the output file/directories do not exist.
// Windows short (8.3) paths and directory junctions can otherwise appear outside
// the source while referring to the same folder as its canonical long path.
async function canonicalOutputPath(filename){
  let current=path.resolve(filename);const missing=[];
  for(;;){
    try{return path.join(await fs.realpath(current),...missing);}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      const parent=path.dirname(current);if(parent===current)throw error;
      missing.unshift(path.basename(current));current=parent;
    }
  }
}
export async function nativeSnapshot(root,out){
  const absolute=await fs.realpath(root),destination=await canonicalOutputPath(out);
  const relative=path.relative(absolute,destination);
  if(relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Snapshot output must be outside the source folder');
  const entries=await readStableNativeFolder(absolute);
  return publishAtomicSnapshot(destination,writeZip(Object.fromEntries(entries)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{if(process.argv.length!==4)throw Error('Usage: node tools/native-snapshot.mjs SOURCE_FOLDER NEW_OUTPUT.zip');console.log(JSON.stringify(await nativeSnapshot(process.argv[2],process.argv[3]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
