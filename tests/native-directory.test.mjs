import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeOutputPath,readNativeDirectory,planNativeDirectoryWrite,writeNativeDirectory} from '../src/project/native-directory.js';
import {bytesOf} from '../src/project/native-text.js';
import {normalizedEntries} from '../src/project/native-project.js';
import {readZip,writeZip} from '../src/project/zip.js';
const text=b=>new TextDecoder().decode(b);
const notFound=()=>Object.assign(new Error('Not found'),{name:'NotFoundError'});
class MemoryDirectory {
  constructor(files={},root=null,path=''){
    this.root=root||this;this.path=path;this.name=path.split('/').at(-1);this.kind='directory';
    if(!root){this.files=new Map(Object.entries(files).map(([p,b])=>[p,bytesOf(b).slice()]));this.dirs=new Set(['']);this.writes=[];
      for(const p of this.files.keys()){let d=p.split('/');d.pop();while(d.length){this.dirs.add(d.join('/'));d.pop();}}
    }
  }
  child(name){return this.path?this.path+'/'+name:name;}
  async getDirectoryHandle(name,{create=false}={}){const path=this.child(name);if(!this.root.dirs.has(path)){if(!create)throw notFound();this.root.dirs.add(path);}return new MemoryDirectory({},this.root,path);}
  async getFileHandle(name,{create=false}={}){
    const path=this.child(name),root=this.root;if(!root.files.has(path)){if(!create)throw notFound();root.files.set(path,new Uint8Array());}
    return {kind:'file',name,async getFile(){const bytes=root.files.get(path);if(!bytes)throw notFound();return {size:bytes.length,async arrayBuffer(){return bytes.slice().buffer;}};},async createWritable(){
      let bytes;return {async write(value){if(root.fail===path)throw new Error('Disk failure');bytes=bytesOf(value).slice();},async close(){root.files.set(path,bytes);root.writes.push(path);root.afterWrite?.(path);},async abort(){}};
    }};
  }
  async *values(){const prefix=this.path?this.path+'/':'';
    for(const p of this.root.dirs)if(p.startsWith(prefix)&&p!==this.path&&!p.slice(prefix.length).includes('/'))yield new MemoryDirectory({},this.root,p);
    for(const p of this.root.files.keys())if(p.startsWith(prefix)&&!p.slice(prefix.length).includes('/'))yield await this.getFileHandle(p.slice(prefix.length));
  }
}
for(const path of ['../escape','C:\\escape','/absolute','a/CON.txt','a/nul','a/trailing.','a/trailing ','a/x?.bas','a/x:stream'])test('reject unsafe native output '+path,()=>assert.throws(()=>nativeOutputPath(path),/unsafe|escape/i));
test('directory import preserves arbitrary companions while skipping tooling folders',async()=>{
  const dir=new MemoryDirectory({'P.vbp':'Type=Exe','nested/control.ctx':Uint8Array.of(0,255),'nested/config.json':'{}','.git/config':'private','node_modules/a.js':'ignored'}),result=await readNativeDirectory(dir);
  assert.equal(result.entries.size,3);assert.deepEqual(result.entries.get('nested/control.ctx'),Uint8Array.of(0,255));assert.deepEqual(result.skipped.sort(),['.git','node_modules']);assert.equal(dir.writes.length,0);
});
test('directory preflight is read-only, detects unchanged bytes and writes manifests last',async()=>{
  const dir=new MemoryDirectory({'same.bin':Uint8Array.of(0,1),'P.vbp':'old','other.txt':'keep'}),p=await planNativeDirectoryWrite(dir,{'Group.vbg':'group','P.vbp':'new','src/M.bas':'module','same.bin':Uint8Array.of(0,1)});
  assert.equal(p.unchanged,1);assert.deepEqual(p.entries.map(e=>e.path),['src/M.bas','P.vbp','Group.vbg']);assert.equal(dir.writes.length,0);const result=await writeNativeDirectory(p);assert.deepEqual(result.written,['src/M.bas','P.vbp','Group.vbg']);assert.equal(text(dir.files.get('other.txt')),'keep');
});
test('stale save plan is rejected before any file is changed',async()=>{
  const dir=new MemoryDirectory({'M.bas':'before','P.vbp':'before'}),p=await planNativeDirectoryWrite(dir,{'M.bas':'after','P.vbp':'after'});dir.files.set('P.vbp',bytesOf('external'));
  await assert.rejects(()=>writeNativeDirectory(p),/nothing was written/);assert.equal(dir.writes.length,0);assert.equal(text(dir.files.get('M.bas')),'before');
});
test('mid-save conflict reports partial completion and does not overwrite the external edit',async()=>{
  const dir=new MemoryDirectory({'M.bas':'before','P.vbp':'before'}),p=await planNativeDirectoryWrite(dir,{'M.bas':'after','P.vbp':'after'});dir.afterWrite=()=>dir.files.set('P.vbp',bytesOf('external'));
  await assert.rejects(()=>writeNativeDirectory(p),/1 files completed/);assert.equal(text(dir.files.get('P.vbp')),'external');
});
test('failed stream does not claim a completed save',async()=>{
  const dir=new MemoryDirectory({'M.bas':'before','P.vbp':'before'}),p=await planNativeDirectoryWrite(dir,{'M.bas':'after','P.vbp':'after'});dir.fail='P.vbp';await assert.rejects(()=>writeNativeDirectory(p),/project remains unsaved/);assert.equal(text(dir.files.get('P.vbp')),'before');
});
test('native file-count bounds apply before unbounded allocation',()=>assert.throws(()=>normalizedEntries(Array.from({length:2001},(_,i)=>['f'+i,''])),/2,000/));
test('directory depth bound rejects excessive nesting',async()=>{const dir=new MemoryDirectory({['a/'.repeat(18)+'M.bas']:'x'});await assert.rejects(()=>readNativeDirectory(dir),/16 levels/);});
test('ZIP rejects normalized case-insensitive aliases',()=>assert.throws(()=>writeZip({'a/./M.bas':'a','A/m.BAS':'b'}),/Duplicate/));
test('ZIP export/reopen keeps binary companion bytes and Unicode file paths',async()=>{const data={'Folder/Żółć.ctx':Uint8Array.of(0,128,255),'Group.vbg':'VBGROUP 5.0\r\n'};const files=await readZip(writeZip(data));assert.deepEqual(files.get('Folder/Żółć.ctx'),data['Folder/Żółć.ctx']);assert.equal(text(files.get('Group.vbg')),data['Group.vbg']);});

test('unchanged output edited after confirmation invalidates the entire save',async()=>{
  const dir=new MemoryDirectory({'M.bas':'same','P.vbp':'old'}),plan=await planNativeDirectoryWrite(dir,{'M.bas':'same','P.vbp':'new'});
  dir.files.set('M.bas',bytesOf('external'));
  await assert.rejects(()=>writeNativeDirectory(plan),/nothing was written/);assert.equal(dir.writes.length,0);
});
test('unchanged source edited while resources write prevents manifest publication',async()=>{
  const dir=new MemoryDirectory({'M.bas':'same','P.vbp':'old','M.frx':'old'}),plan=await planNativeDirectoryWrite(dir,{'M.bas':'same','M.frx':'new','P.vbp':'new'});
  dir.afterWrite=path=>{if(path==='M.frx')dir.files.set('M.bas',bytesOf('external'));};
  await assert.rejects(()=>writeNativeDirectory(plan),/1 files completed/);assert.equal(text(dir.files.get('P.vbp')),'old');
});
test('post-write verification catches changes to an already written source',async()=>{
  const dir=new MemoryDirectory({'M.bas':'old','P.vbp':'old'}),plan=await planNativeDirectoryWrite(dir,{'M.bas':'new','P.vbp':'new'});
  dir.afterWrite=path=>{if(path==='P.vbp')dir.files.set('M.bas',bytesOf('external'));};
  await assert.rejects(()=>writeNativeDirectory(plan),/2 files completed/);assert.equal(text(dir.files.get('M.bas')),'external');
});
test('all-unchanged saves still validate every observed file',async()=>{
  const dir=new MemoryDirectory({'M.bas':'same'}),plan=await planNativeDirectoryWrite(dir,{'M.bas':'same'});
  assert.equal(plan.entries.length,0);dir.files.delete('M.bas');
  await assert.rejects(()=>writeNativeDirectory(plan),/nothing was written/);assert.equal(dir.writes.length,0);
});
