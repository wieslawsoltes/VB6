/** Add-existing is an all-or-nothing transaction, including its dependencies. */
import {clone} from '../core/core.js';
import {normalizeProject} from './model.js';
import {cleanProjectPath} from './frx.js';
import {fromBase64,toBase64} from './binary-assets.js';
import {equalBytes} from './native-text.js';
import {rebaseProjectReference} from './references.js';
import {normalizeResources,resourceKey,decodeStringTable,encodeStringTable} from './res.js';
import {moduleLanguage,moduleSourcePath} from './language.js';

const fileName=m=>cleanProjectPath(moduleSourcePath(m));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=message=>{throw new Error(message);};

/** Preserve reference priority, keeping unknown vendor formats opaque. */
export function mergeProjectReferences(current=[],incoming=[]){
  const result=clone(current),seen=new Set();
  for(const reference of [...current,...incoming]){
    if(!reference||!['Reference','Object'].includes(reference.kind)||typeof reference.value!=='string'||/[\r\n\0]/.test(reference.value))fail('Invalid native reference');
  }
  for(const r of current)seen.add(r.kind+'\0'+r.value.trim().toLowerCase());
  for(const r of incoming){const key=r.kind+'\0'+r.value.trim().toLowerCase();if(!seen.has(key)){seen.add(key);result.push(clone(r));}}
  return result;
}

/** Merge .res payloads without replacing existing IDs or dropping string slots. */
export function mergeProjectResources(current,incoming){
  if(!incoming)return current?normalizeResources(current):undefined;
  if(!current)return normalizeResources(incoming);
  const result=normalizeResources(current),other=normalizeResources(incoming);
  const entries=new Map(result.entries.map(e=>[resourceKey(e),e]));
  for(const entry of other.entries){
    const key=resourceKey(entry),prior=entries.get(key);
    if(!prior){const copy=clone(entry);result.entries.push(copy);entries.set(key,copy);continue;}
    if(same(prior,entry))continue;
    // Distinct string IDs often live in the same 16-slot RT_STRING block.
    const metadata=e=>({...e,data:''});
    if(entry.type!==6||!same(metadata(prior),metadata(entry)))fail('Conflicting resource type, name or language: '+key);
    const a=decodeStringTable(fromBase64(prior.data)),b=decodeStringTable(fromBase64(entry.data));
    for(let slot=0;slot<16;slot++){
      if(a[slot]&&b[slot]&&a[slot]!==b[slot])fail('Conflicting resource string ID '+((Number(entry.name)-1)*16+slot));
      if(!a[slot])a[slot]=b[slot];
    }
    prior.data=toBase64(encodeStringTable(a));
  }
  return normalizeResources(result);
}

function mergeRecords(current={},incoming={},label){
  const result=Object.assign(Object.create(null),clone(current));
  const keys=new Map(Object.keys(result).map(k=>[k.toLowerCase(),k]));
  for(const [key,value]of Object.entries(incoming)){
    const existing=keys.get(key.toLowerCase());
    if(existing!==undefined&&!same(result[existing],value))fail('Conflicting '+label+': '+key);
    if(existing===undefined){result[key]=clone(value);keys.set(key.toLowerCase(),key);}
  }
  return result;
}

export function mergedProject(current,incoming){
  if(incoming.nativeWorkspace)fail('Open a project group as a workspace rather than adding it as source files.');
  // An opaque/missing membership cannot safely be grafted into another VBP.
  // Opening that project retains it; adding it must not silently drop the entry.
  if(incoming.nativeProject?.files?.some(f=>!f.moduleId&&(f.kind!=='related'||!f.resolved)))fail('Cannot add unresolved or read-only native memberships. Open the project separately to retain them.');
  const next=normalizeProject(current),other=normalizeProject(incoming);
  next.assets=Object.assign(Object.create(null),next.assets);
  const names=new Set(next.modules.map(m=>m.name.toLowerCase()));
  const paths=new Set(next.modules.map(m=>fileName(m).toLowerCase()));
  const assets=new Map(Object.keys(next.assets).map(p=>[cleanProjectPath(p).toLowerCase(),p]));
  const reserved=new Set([next.nativeProject?.path||next.name+'.vbp',next.nativeWorkspace?.path,next.resources?.fileName].filter(Boolean).map(p=>cleanProjectPath(p).toLowerCase()));
  for(const m of other.modules){
    m.language=moduleLanguage(m,other);
    const path=fileName(m),key=path.toLowerCase();
    if(names.has(m.name.toLowerCase()))fail('A module named '+m.name+' already exists.');
    if(paths.has(key)||assets.has(key)||reserved.has(key))fail('A source file already uses '+path);
    names.add(m.name.toLowerCase());paths.add(key);next.modules.push(m);
  }
  for(const [name,value]of Object.entries(other.assets||{})){
    const path=cleanProjectPath(name),key=path.toLowerCase(),existing=assets.get(key);
    if(existing!==undefined&&(!value||value.encoding!=='base64'||next.assets[existing]?.encoding!=='base64'))fail('Conflicting companion file: '+path+' (invalid encoding)');
    if(!value||value.encoding!=='base64')fail('Invalid companion file: '+path);
    const bytes=fromBase64(value.data);
    if(paths.has(key)||reserved.has(key)||existing!==undefined&&!equalBytes(fromBase64(next.assets[existing].data),bytes))fail('Conflicting companion file: '+path);
    if(existing===undefined){next.assets[path]=clone(value);assets.set(key,path);}
  }
  const targetPath=next.nativeProject?.path||next.name+'.vbp',sourcePath=other.nativeProject?.path||other.name+'.vbp';
  next.references=mergeProjectReferences(next.references,(other.references||[]).map(r=>rebaseProjectReference(r,sourcePath,targetPath)));
  const related=[...(other.nativeProject?.relatedDocuments||[]),...(other.nativeProject?.files||[]).filter(f=>f.kind==='related').map(f=>f.resolved)];
  if(related.length){
    next.nativeProject||={path:targetPath,entries:[]};next.nativeProject.relatedDocuments||=[];
    const known=new Set([...next.nativeProject.relatedDocuments,...(next.nativeProject.files||[]).filter(f=>f.kind==='related'&&f.resolved).map(f=>f.resolved)].map(p=>cleanProjectPath(p).toLowerCase()));
    for(const path of related){const canonical=cleanProjectPath(path);if(!known.has(canonical.toLowerCase())){next.nativeProject.relatedDocuments.push(canonical);known.add(canonical.toLowerCase());}}
  }
  const resources=mergeProjectResources(next.resources,other.resources);
  if(resources){
    const key=resources.fileName.toLowerCase();
    if(paths.has(key)||assets.has(key)||key===(next.nativeProject?.path||next.name+'.vbp').toLowerCase())fail('Conflicting resource file: '+resources.fileName);
    next.resources=resources;
  }
  // Portable data dependencies belong to imported modules, unlike IDE settings,
  // startup selection and project identity, which remain owned by the target.
  if(other.dataSources){
    const sources=clone(next.dataSources||{version:1,connections:[],commands:[]});
    for(const kind of ['connections','commands'])for(const source of other.dataSources[kind]){
      const prior=sources[kind].find(s=>s.name.toLowerCase()===source.name.toLowerCase());
      if(prior&&!same(prior,source))fail('Conflicting data source: '+source.name);
      if(!prior)sources[kind].push(clone(source));
    }
    next.dataSources=sources;
  }
  if(other.vfs?.files)next.vfs={...next.vfs,files:mergeRecords(next.vfs?.files,other.vfs.files,'virtual data file')};
  return normalizeProject(next);
}
