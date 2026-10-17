/** Offline native export authority. Generated applications are never executed. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {exportLinuxApplication,importFiles,unpackLinuxAOTArchive} from '../dist/index.js';

async function readRegularFile(filename,limit) {
  const handle=await fs.open(filename,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try {
    const info=await handle.stat();
    if(!info.isFile()||info.size>limit)throw new Error('Expected a bounded regular source file: '+filename);
    const bytes=await handle.readFile();
    if(bytes.length!==info.size||bytes.length>limit)throw new Error('Source changed while reading: '+filename);
    return bytes;
  }finally {await handle.close();}
}
export async function readLinuxProject(input) {
  if(typeof input!=='string'||!input||input.includes('\0'))throw new TypeError('A project path is required.');
  const absolute=path.resolve(input),stat=await fs.lstat(absolute);
  if(stat.isSymbolicLink())throw new Error('Source must not be a symbolic link.');
  if(stat.isFile()&&/\.(vb6web|vb6proj|json)$/i.test(absolute))
    return JSON.parse((await readRegularFile(absolute,50*1024*1024)).toString('utf8'));
  if(!stat.isDirectory()&&!(stat.isFile()&&/\.vbp$/i.test(absolute)))
    throw new Error('Expected a .vb6web, .vbp, or native project directory.');
  const sourceRoot=stat.isDirectory()?absolute:path.dirname(absolute),entries=new Map();let total=0;
  async function walk(directory,relative='',depth=0) {
    if(depth>16)throw new Error('Source nesting exceeds 16 directories.');
    const info=await fs.lstat(directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Source directory links are not accepted.');
    for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
      if(['.git','node_modules','.vb6-save-journal'].includes(entry.name))continue;
      if(entry.isSymbolicLink())throw new Error('Source links are not accepted.');
      const full=path.join(directory,entry.name),name=relative+entry.name;
      if(entry.isDirectory()){await walk(full,name+'/',depth+1);continue;}
      if(!entry.isFile())throw new Error('Only regular source files are accepted.');
      const bytes=await readRegularFile(full,20*1024*1024);total+=bytes.length;
      if(total>50*1024*1024||entries.size>=2000)throw new Error('Native source exceeds import limits.');
      entries.set(name,new Uint8Array(bytes));
    }
  }
  await walk(sourceRoot);
  const imported=await importFiles(entries,stat.isDirectory()?{}:{entryPath:path.basename(absolute)});
  const errors=imported.diagnostics.filter(diagnostic=>diagnostic.severity==='error');
  if(errors.length)throw Object.assign(new Error('Native import contains errors.'),{diagnostics:errors});
  return imported.project;
}
async function outputDirectory(out) {
  const directory=path.resolve(out);await fs.mkdir(directory,{recursive:true,mode:0o755});
  const info=await fs.lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Output must be a regular directory, not a link.');
  return fs.realpath(directory);
}
export async function exportLinuxProject(project,{compiler={},out=path.resolve('out'),signal,resources}={}) {
  signal?.throwIfAborted();
  const result=await exportLinuxApplication(project,compiler,{signal,resources}),directory=await outputDirectory(out);
  signal?.throwIfAborted();
  const destination=path.join(directory,result.filename),file=await fs.open(destination,'wx',0o644);let complete=false;
  try {await file.writeFile(result.bytes);await file.sync();signal?.throwIfAborted();complete=true;}
  finally {await file.close();if(!complete)await fs.unlink(destination);}
  return {...result.report,archive:destination};
}
export async function exportLinuxExecutable(project,{compiler={},out=path.resolve('out'),signal,resources}={}) {
  signal?.throwIfAborted();
  const result=await exportLinuxApplication(project,compiler,{signal,resources});
  const unpacked=await unpackLinuxAOTArchive(result.bytes,result.options),directory=await outputDirectory(out);
  const application=path.join(directory,result.options.name),prefix=result.options.name+'/',entry='bin/'+result.options.name;
  signal?.throwIfAborted();
  // Exclusive directory creation reserves this application name without a
  // check/rename race or replacing an existing empty directory.
  await fs.mkdir(application,{recursive:false,mode:0o755});let complete=false;
  try {
    for(const [name,bytes]of unpacked.files) {
      signal?.throwIfAborted();
      if(!name.startsWith(prefix))throw new Error('Archive member is outside its application directory.');
      const relative=name.slice(prefix.length);
      if(!relative||/[\\\x00-\x1f\x7f]/.test(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'))
        throw new Error('Invalid native application path.');
      const destination=path.join(application,...relative.split('/'));
      await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o755});
      const handle=await fs.open(destination,'wx',relative===entry?0o755:0o644);
      try {await handle.writeFile(bytes);await handle.sync();}finally {await handle.close();}
    }
    signal?.throwIfAborted();complete=true;
  }finally {if(!complete)await fs.rm(application,{recursive:true,force:true});}
  return {...result.report,application,executable:path.join(application,'bin',result.options.name)};
}
