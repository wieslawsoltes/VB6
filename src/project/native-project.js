import {dataSidecarPath,decodeDataSidecar} from '../data/project-sidecar.js';
/** VB6 project/workspace interchange. No native code, COM activation or network I/O. */
import {newProject,newId,normalizeProject} from './model.js';
import {readRES} from './res.js';
import {cleanProjectPath,relativeProjectPath,resolveProjectPath,hydrateResources,toBase64,fromBase64} from './frx.js';
import {decodeNativeText,encodeNativeText,bytesOf,equalBytes,linesOf,lineBody,lineEnding,preferredEOL,unquote,quote,nativePathValue,commentAt,replaceLineValue} from './native-text.js';
import {rememberNativeSource,nativeTree} from './native-source.js';
import {VBError} from '../language/lexer.js';
export const MAX_NATIVE_FILES=2000;
export const MAX_NATIVE_BYTES=50*1024*1024;
export const MAX_NATIVE_PROJECTS=32;
const fail=message=>{throw new VBError('Project: '+message,1002);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const memberKinds={form:'form',module:'module',class:'class',usercontrol:'form',propertypage:'form',userdocument:'form',designer:'class',relateddoc:'related'};
const nativeNames={form:'Form',module:'Module',class:'Class',usercontrol:'UserControl',propertypage:'PropertyPage',userdocument:'UserDocument',designer:'Designer',relateddoc:'RelatedDoc'};
const sourcePattern=/\.(frm|bas|cls|ctl|pag|dob|dsr)$/i;
const cleanValue=value=>{const at=commentAt(value,true);return (at<0?value:value.slice(0,at)).trim();};
const modulePath=m=>m.sourcePath||m.name+(m.kind==='form'?'.frm':m.kind==='class'?'.cls':'.bas');
function record(line,index){const body=lineBody(line),m=body.match(/^\s*([^=]+?)\s*=\s*(.*)$/);return m?{index,key:m[1].trim(),value:cleanValue(m[2]),rawValue:m[2]}:null;}
function mainRecords(text){const records=[];for(const [index,line]of linesOf(text).entries()){if(/^\s*\[/.test(line))break;const item=record(line,index);if(item&&!/^\s*[';]/.test(line))records.push(item);}if(records.length>10000)fail('Native project metadata exceeds 10,000 records');return records;}
function splitMember(value){let quoted=false;for(let i=0;i<value.length;i++){if(value[i]==='"'){if(quoted&&value[i+1]==='"'){i++;continue;}quoted=!quoted;}if(value[i]===';'&&!quoted)return {name:unquote(value.slice(0,i)),path:unquote(value.slice(i+1))};}return {path:unquote(value)};}
export function parseNativeProject(text){
  const meta={name:'Project1',startup:'Form1',files:[],references:[],settings:{},raw:{},rawEntries:[],records:mainRecords(text)};
  for(const item of meta.records){const {key,value}=item,k=key.toLowerCase();
    if(Object.hasOwn(memberKinds,k)){const file=['module','class'].includes(k)?splitMember(value):{path:unquote(value)};meta.files.push({...file,kind:memberKinds[k],nativeKind:nativeNames[k],index:item.index});}
    else if(k==='name')meta.name=unquote(value);else if(k==='startup')meta.startup=unquote(value);
    else if(k==='reference'||k==='object')meta.references.push({kind:k==='reference'?'Reference':'Object',value});
    else{Object.defineProperty(meta.raw,key,{value,enumerable:true,writable:true,configurable:true});meta.rawEntries.push({key,value});}
  }
  return meta;
}
export function parseVBG(text){const records=mainRecords(text),projects=[],startup=records.find(r=>r.key.toLowerCase()==='startupproject');for(const r of records)if(['project','startupproject'].includes(r.key.toLowerCase())){const path=unquote(r.value);if(!projects.some(p=>p.toLowerCase()===path.toLowerCase()))projects.push(path);}return {projects,startup:startup?unquote(startup.value):projects[0],records};}
export function normalizedEntries(entries){
  const result=new Map(),seen=new Set();let total=0;
  for(const [name,value]of entries){const path=cleanProjectPath(name),key=path.toLowerCase();if(seen.has(key))fail('Duplicate case-insensitive project path: '+name);seen.add(key);const size=bytesOf(value).length;total+=size;if(size>20*1024*1024||total>MAX_NATIVE_BYTES||seen.size>MAX_NATIVE_FILES)fail('Import exceeds 20 MiB/file, 50 MiB total, or 2,000 files');result.set(path,value);}
  return result;
}
export function listProjectEntries(entries){return [...entries].map(([path,data])=>{
  let format=/\.(vb6web|vb6proj)$/i.test(path)?'web':/\.vbg$/i.test(path)?'group':/\.vbp$/i.test(path)?'native':null;
  if(/\.json$/i.test(path))try{const value=JSON.parse(decodeNativeText(data).text);if(value?.schema===1&&Array.isArray(value.modules))format='web';}catch{}
  return {path,format};
}).filter(x=>x.format);}
function exactPath(entries,owner,reference){try{return resolveProjectPath(entries.keys(),owner,reference);}catch{return null;}}
function resolve(entries,owner,reference,diagnostics,{fallback=false}={}){
  let problem;try{const exact=resolveProjectPath(entries.keys(),owner,reference);if(exact)return exact;}catch(error){problem=error;}
  // Relocate only to an explicitly supplied, unique file. Never read an absolute
  // path, fetch a URL, or walk outside the selected workspace.
  if(fallback&&!/[\x00-\x1f]/.test(reference)&&!/^\w+:\/\//.test(reference)){
    const basename=String(reference).replace(/\\/g,'/').split('/').at(-1).toLowerCase();
    const matches=[...entries.keys()].filter(p=>p.split('/').at(-1).toLowerCase()===basename);
    if(matches.length===1){diagnostics.push({severity:'warning',source:owner,message:'Relocated '+reference+' to selected file '+matches[0]+'. Export will update the project reference.'});return matches[0];}
    if(matches.length>1)problem=new Error('Ambiguous selected file name: '+reference);
  }
  if(problem)diagnostics.push({severity:'error',source:owner,message:problem.message});return null;
}
const asset=data=>({encoding:'base64',data:toBase64(bytesOf(data))});
function codePage(options){return options.encoding&&options.encoding!=='auto'&&!/^utf-/i.test(options.encoding)?options.encoding:'windows-1252';}
function readDocument(value,options){return decodeNativeText(value,{encoding:options.encoding||'auto'});}
function singleProject(entries,path,options,api,diagnostics){
  const document=path?readDocument(entries.get(path),options):null,meta=document?parseNativeProject(document.text):null;
  const project=newProject(meta?.name||'ImportedProject');project.modules=[];project.description=unquote(meta?.rawEntries.find(r=>r.key.toLowerCase()==='description')?.value||'');project.references=meta?.references||[];project.storageFormat='native';project.assets=Object.create(null);
  const native=meta?{path,originalPath:path,document,entries:meta.rawEntries,files:[],baseline:{name:project.name,description:project.description,startup:meta.startup,references:structuredClone(project.references),entries:structuredClone(meta.rawEntries)}}:null;
  if(native)project.nativeProject=native;
  const consumed=new Set(path?[path]:[]),selected=[],seen=new Set();
  for(const file of meta?.files||[...entries.keys()].filter(n=>sourcePattern.test(n)).map(path=>({path,kind:/\.(frm|ctl|pag|dob)$/i.test(path)?'form':/\.(cls|dsr)$/i.test(path)?'class':'module',nativeKind:({ctl:'UserControl',pag:'PropertyPage',dob:'UserDocument',dsr:'Designer'})[path.split('.').at(-1).toLowerCase()]}))){
    const resolved=path?resolve(entries,path,file.path,diagnostics,{fallback:options.basenameFallback!==false}):file.path;
    const saved={...file,resolved:resolved||null,relocated:!!(path&&resolved&&exactPath(entries,path,file.path)!==resolved),moduleId:null};if(native)native.files.push(saved);
    if(!resolved){diagnostics.push({severity:'error',source:project.name,message:'Missing referenced source file: '+file.path+' (project entry retained).'});continue;}
    if(file.kind==='related')continue;
    if(seen.has(resolved.toLowerCase())){diagnostics.push({severity:'warning',source:project.name,message:'Repeated source membership retained: '+file.path});saved.moduleId=selected.find(x=>x.path===resolved)?.saved.moduleId;continue;}
    seen.add(resolved.toLowerCase());selected.push({path:resolved,file,saved});
  }
  for(const item of selected){
    if(options.budget){options.budget.bytes+=bytesOf(entries.get(item.path)).length;if(options.budget.bytes>MAX_NATIVE_BYTES)fail('Combined project-group source references exceed 50 MiB');}
    let doc,module;
    try{
      doc=readDocument(entries.get(item.path),options);if(doc.text.length>5000000)throw new Error('Module exceeds 5,000,000-character source limit');if(doc.encoding==='windows-1252'&&bytesOf(entries.get(item.path)).some(b=>b>=128))diagnostics.push({severity:'warning',source:item.path,message:'Decoded native source as Windows-1252. Choose the original code page for projects from another locale.'});
      if(item.file.kind==='form')module=api.parseFRM(doc.text,item.path).module;
      else if(/\.dsr$/i.test(item.path)){
        const tree=nativeTree(doc.text),body=tree.root?tree.tail:doc.text;module=api.parseCodeModule(body,item.path);module.kind='class';module.nativeOpaque=true;
        diagnostics.push({severity:'warning',source:item.path,message:'Custom designer preserved byte-for-byte; its designer host is not available in the browser.'});
      }else module=api.parseCodeModule(doc.text,item.path);
    normalizeProject({...project,modules:[module]});
    }catch(error){if(!native)fail('Cannot open '+item.path+': '+error.message);item.saved.opaqueReason=error.message;diagnostics.push({severity:'error',source:item.path,message:'Source retained unchanged as a read-only native file: '+error.message});continue;}
    module.sourcePath=item.path;module.sourceEncoding=doc.encoding;module.resourceEncoding=codePage(options);if(item.file.nativeKind)module.nativeKind=item.file.nativeKind;
    item.saved.moduleId=module.id;project.modules.push(module);consumed.add(item.path);
    const canonical=module.nativeOpaque?doc.text:api.canonicalSource(module);rememberNativeSource(module,doc,canonical);
    if(/\.(ctl|pag|dob)$/i.test(item.path))diagnostics.push({severity:'warning',source:module.name,message:'Native '+(module.nativeKind||module.form.type)+' source and designer data are editable/preserved; original COM designer behavior is not provided.'});
    if(item.file.name&&item.file.name.toLowerCase()!==module.name.toLowerCase())diagnostics.push({severity:'warning',source:project.name,message:'Project alias '+item.file.name+' differs from Attribute VB_Name '+module.name+'; original entry retained until renamed.'});
  }
  if(native)for(const file of native.files)if(file.resolved&&!file.moduleId&&file.kind!=='related')file.moduleId=project.modules.find(m=>m.sourcePath===file.resolved)?.id||null;
  if(!project.modules.length&&!meta)fail('No .vb6web project or referenced native source files found. Select the project and its companion files together.');
  project.startup=meta?.startup||project.modules.find(m=>m.form)?.name||'Sub Main';
  const res=meta?.rawEntries.find(r=>r.key.toLowerCase()==='resfile32');
  if(res){const ref=unquote(res.value),resolved=resolve(entries,path,ref,diagnostics,{fallback:options.basenameFallback!==false});if(!resolved)diagnostics.push({severity:'error',source:project.name,message:'Missing referenced resource file: '+ref});else{try{project.resources=readRES(bytesOf(entries.get(resolved)),resolved);native.resourcePath=resolved;native.resourceRelocated=exactPath(entries,path,ref)!==resolved;consumed.add(resolved);}catch(error){diagnostics.push({severity:'warning',source:resolved,message:'Resource file retained without decoding: '+error.message});}}}
  if(path){const sidecar=[...entries.keys()].find(name=>name.toLowerCase()===dataSidecarPath(path).toLowerCase());if(sidecar){Object.assign(project,decodeDataSidecar(bytesOf(entries.get(sidecar))));consumed.add(sidecar);diagnostics.push({severity:'info',source:sidecar,message:'Loaded portable browser data definitions and virtual data files. These are not a native VB6 Data Environment designer.'});}}
  const resourcePaths=new Set();for(const m of project.modules)for(const node of m.form?[m.form,...m.form.controls,...m.form.menus]:[])for(const value of Object.values(node.properties||{}))if(value?.resource){const resolved=resolve(entries,m.sourcePath,value.resource,diagnostics);if(resolved)resourcePaths.add(resolved);}
  for(const [name,value]of entries)if(!consumed.has(name)&&(!options.group||resourcePaths.has(name)))project.assets[name]=asset(value);
  hydrateResources(project,diagnostics);
  for(const reference of project.references)diagnostics.push({severity:'warning',source:project.name,message:'Native reference retained; browser reimplementation required: '+reference.value});
  const type=meta?.rawEntries.find(r=>r.key.toLowerCase()==='type')?.value;
  if(type&&!/^Exe$/i.test(type))diagnostics.push({severity:'warning',source:project.name,message:'Project type '+type+' retained; opening/saving does not install native COM components.'});
  return normalizeProject(project);
}
export async function importNativeFiles(input,options,api){
  const entries=normalizedEntries(input),diagnostics=[],choices=listProjectEntries(entries);let selected=options.entryPath?cleanProjectPath(options.entryPath):null;
  if(selected&&!entries.has(selected)){selected=[...entries.keys()].find(p=>p.toLowerCase()===selected.toLowerCase());if(!selected)fail('Selected project entry was not supplied');}
  if(!selected){
    const webs=choices.filter(c=>c.format==='web'&&!/\.json$/i.test(c.path)),groups=choices.filter(c=>c.format==='group'),projects=choices.filter(c=>c.format==='native');
    const candidates=webs.length?webs:groups.length?groups:projects.length?projects:choices.filter(c=>c.format==='web');
    if(candidates.length>1)fail('More than one project entry is available; choose entryPath: '+candidates.map(c=>c.path).join(', '));
    selected=candidates[0]?.path;
    if(!selected){for(const candidate of choices.filter(c=>/\.json$/i.test(c.path))){try{const parsed=JSON.parse(readDocument(entries.get(candidate.path),options).text);if(parsed?.schema===1&&Array.isArray(parsed.modules)){selected=candidate.path;break;}}catch{}}}
  }
  if(selected&&/\.(vb6web|vb6proj|json)$/i.test(selected)){
    const project=normalizeProject(JSON.parse(readDocument(entries.get(selected),options).text));validateWorkspace(project);project.storageFormat='web';return {project,diagnostics,format:'web',entryPath:selected};
  }
  if(selected&&/\.vbg$/i.test(selected)){
    const document=readDocument(entries.get(selected),options),group=parseVBG(document.text);if(group.projects.length>MAX_NATIVE_PROJECTS)fail('Project group exceeds 32 projects');
    const paths=[],projects=[],resolvedRefs=new Map(),budget={bytes:0};
    for(const ref of group.projects){const path=resolve(entries,selected,ref,diagnostics,{fallback:options.basenameFallback!==false});if(!path){diagnostics.push({severity:'error',source:selected,message:'Missing referenced project: '+ref+' (group entry retained).'});continue;}resolvedRefs.set(ref,path);if(!/\.vbp$/i.test(path))fail('A group entry must reference a .vbp file');if(paths.some(p=>p.toLowerCase()===path.toLowerCase()))continue;paths.push(path);projects.push(singleProject(entries,path,{...options,group:true,budget},api,diagnostics));}
    if(!projects.length)fail('No referenced projects were supplied for '+selected);
    const startupPath=resolve(entries,selected,group.startup,[],{fallback:options.basenameFallback!==false})||paths[0],index=Math.max(0,paths.indexOf(startupPath)),project=projects[index];
    const files=Object.create(null);for(const [path,value]of entries)files[path]=asset(value);
    project.nativeWorkspace={version:1,path:selected,originalPath:selected,document,references:group.records.filter(r=>['project','startupproject'].includes(r.key.toLowerCase())).map(r=>({...r,resolved:resolvedRefs.get(unquote(r.value))||null,relocated:resolvedRefs.has(unquote(r.value))&&exactPath(entries,selected,unquote(r.value))!==resolvedRefs.get(unquote(r.value))})),order:paths,startupPath,originalStartupPath:startupPath,peers:projects.filter((_,i)=>i!==index),files};
    return {project,diagnostics,format:'native',entryPath:selected};
  }
  const project=singleProject(entries,selected&&/\.vbp$/i.test(selected)?selected:null,options,api,diagnostics);
  return {project,diagnostics,format:'native',entryPath:selected||null};
}

/** Update only tracked values and memberships; unknown sections and records survive. */
export function patchNativeProject(project,generated){
  const native=project.nativeProject;if(!native?.document)return generated;if(/[\r\n\0]/.test(project.name)||/[\r\n\0]/.test(project.startup))fail('Invalid native project name or startup value');
  const lines=linesOf(native.document.text),baseline=native.baseline||{},records=mainRecords(native.document.text),edits=new Map(),add=[],seenModules=new Set();
  const set=(key,value)=>{const items=records.filter(r=>r.key.toLowerCase()===key.toLowerCase());if(items.length)for(const r of items)edits.set(r.index,value);else if(value!==null)add.push(key+'='+value);};
  if(project.name!==baseline.name)set('Name',quote(project.name));if(project.description!==(baseline.description||'')&&project.description!==undefined)set('Description',quote(project.description));if(project.startup!==baseline.startup)set('Startup',quote(project.startup));
  for(const file of native.files||[]){
    if(!file.moduleId){if(file.resolved&&(native.path!==native.originalPath||file.relocated))edits.set(file.index,nativePathValue(relativeProjectPath(native.path,file.resolved)));continue;}const m=project.modules.find(m=>m.id===file.moduleId);
    if(!m){edits.set(file.index,null);continue;}seenModules.add(m.id);
    const path=modulePath(m),moved=native.path!==native.originalPath||path!==file.resolved,renamed=m.name!==m.nativeSource?.name;
    const originallyResolved=!file.relocated;
    if(moved||renamed||!originallyResolved){const ref=nativePathValue(relativeProjectPath(native.path,path)),value=['Module','Class'].includes(m.nativeKind||file.nativeKind)?m.name+'; '+ref:ref;edits.set(file.index,value);}
  }
  for(const m of project.modules)if(!seenModules.has(m.id)){const kind=m.nativeKind||(m.kind==='form'?'Form':m.kind==='class'?'Class':'Module'),ref=nativePathValue(relativeProjectPath(native.path,modulePath(m)));add.push(kind+'='+(['Module','Class'].includes(kind)?m.name+'; ':'')+ref);}
  if(!same(project.references||[],baseline.references||[])){for(const r of records)if(['reference','object'].includes(r.key.toLowerCase()))edits.set(r.index,null);for(const r of project.references||[]){if(!['Reference','Object'].includes(r.kind)||/[\r\n\0]/.test(r.value))fail('Invalid native reference');add.push(r.kind+'='+r.value);}}
  if(!same(native.entries||[],baseline.entries||[])){
    for(const r of native.entries||[])if(typeof r.key!=='string'||typeof r.value!=='string'||!r.key||/^[\[;']/.test(r.key)||/[\r\n\0=]/.test(r.key)||/[\r\n\0]/.test(r.value)||Object.hasOwn(memberKinds,r.key.toLowerCase())||['name','startup','reference','object'].includes(r.key.toLowerCase()))fail('Invalid project setting');
    const keys=new Set([...(native.entries||[]),...(baseline.entries||[])].map(r=>r.key.toLowerCase()));
    for(const key of keys){
      const before=(baseline.entries||[]).filter(r=>r.key.toLowerCase()===key),after=(native.entries||[]).filter(r=>r.key.toLowerCase()===key);
      if(same(before,after))continue;
      const rows=records.filter(r=>r.key.toLowerCase()===key);
      for(let i=0;i<rows.length;i++)edits.set(rows[i].index,after[i]?.value??null);
      for(let i=rows.length;i<after.length;i++)add.push(after[i].key+'='+after[i].value);
    }
  }
  if(project.resources){const ref=relativeProjectPath(native.path,project.resources.fileName),current=records.find(r=>r.key.toLowerCase()==='resfile32');if(!current||native.resourceRelocated||native.path!==native.originalPath||native.resourcePath!==project.resources.fileName)set('ResFile32',quote(ref));}
  else if(native.resourcePath)set('ResFile32',null);
  return applyLineEdits(lines,edits,add);
}
function applyLineEdits(lines,edits,add){const eol=preferredEOL(lines.join(''));let output='',inserted=false;for(let i=0;i<lines.length;i++){if(!inserted&&/^\s*\[/.test(lines[i])){if(output&&!/[\r\n]$/.test(output))output+=eol;output+=add.map(x=>x+eol).join('');inserted=true;}if(!edits.has(i))output+=lines[i];else if(edits.get(i)!==null)output+=replaceLineValue(lines[i],edits.get(i),true);}if(!inserted&&add.length){if(output&&!/[\r\n]$/.test(output))output+=eol;output+=add.map(x=>x+eol).join('');}return output;}
export function workspaceProjects(project){const workspace=project.nativeWorkspace;if(!workspace)return [project];const current={...project};delete current.nativeWorkspace;const projects=[current,...workspace.peers];return workspace.order.map(path=>projects.find(p=>p.nativeProject?.path.toLowerCase()===path.toLowerCase())).filter(Boolean);}
export function validateWorkspace(project){const w=project.nativeWorkspace;if(!w)return;if(w.version!==1||!Array.isArray(w.peers)||w.peers.length>=MAX_NATIVE_PROJECTS||!Array.isArray(w.order)||!w.files)fail('Invalid native project group snapshot');cleanProjectPath(w.path);const seen=new Set();for(const p of [project,...w.peers]){if(p!==project&&p.nativeWorkspace)fail('Nested project groups are not supported');const path=cleanProjectPath(p.nativeProject?.path||'');if(seen.has(path.toLowerCase()))fail('Duplicate project in group');seen.add(path.toLowerCase());if(p!==project)normalizeProject(p);}if(!seen.has(String(w.startupPath).toLowerCase()))fail('Startup project is not an open member of the group');if(w.order.length!==seen.size||new Set(w.order.map(p=>p.toLowerCase())).size!==seen.size||w.order.some(p=>!seen.has(p.toLowerCase())))fail('Invalid project group ordering');normalizedEntries(Object.entries(w.files).map(([p,a])=>[p,fromBase64(a.data)]));}
export function selectWorkspaceProject(project,path){validateWorkspace(project);const projects=workspaceProjects(project),selected=projects.find(p=>p.nativeProject?.path.toLowerCase()===path.toLowerCase());if(!selected)fail('Unknown project in group: '+path);const result=normalizeProject(selected);result.nativeWorkspace={...structuredClone(project.nativeWorkspace),peers:projects.filter(p=>p!==selected).map(p=>structuredClone(p))};result.storageFormat=project.storageFormat;return result;}
export function workspaceFiles(project,options,exportSingle){
  validateWorkspace(project);const w=project.nativeWorkspace,files=Object.create(null),baseline=new Map(),written=new Map();
  for(const [name,value]of Object.entries(w.files)){const path=cleanProjectPath(name),bytes=fromBase64(value.data);files[path]=bytes;baseline.set(path.toLowerCase(),{path,bytes});}
  for(const p of workspaceProjects(project))for(const [name,value]of Object.entries(exportSingle(p,options))){
    const path=cleanProjectPath(name),key=path.toLowerCase(),original=baseline.get(key),changed=!original||!equalBytes(value,original.bytes),previous=written.get(key);
    if(previous&&changed&&previous.changed&&!equalBytes(previous.value,value))fail('Conflicting edits to shared file '+path+' in '+previous.project+' and '+p.name+'; save is cancelled');
    if(!previous||changed&&!previous.changed){if(original&&original.path!==path)delete files[original.path];files[path]=value;written.set(key,{value,changed,project:p.name});}
  }
  const edits=new Map(),records=mainRecords(w.document.text),moved=w.path!==w.originalPath;
  for(const r of records){const key=r.key.toLowerCase(),reference=w.references?.find(ref=>ref.index===r.index);if(key==='startupproject'&&(moved||reference?.relocated||w.startupPath!==w.originalStartupPath))edits.set(r.index,nativePathValue(relativeProjectPath(w.path,w.startupPath)));else if(key==='project'&&(moved||reference?.relocated)){const found=reference?.resolved||exactPath(new Map(Object.entries(w.files)),w.originalPath,unquote(r.value));if(found)edits.set(r.index,nativePathValue(relativeProjectPath(w.path,found)));}}
  const additions=!records.some(r=>r.key.toLowerCase()==='startupproject')&&w.startupPath!==w.originalStartupPath?['StartupProject='+nativePathValue(relativeProjectPath(w.path,w.startupPath))]:[];
  if(w.startupPath!==w.originalStartupPath&&!records.some(r=>r.key.toLowerCase()==='project'&&(w.references?.find(ref=>ref.index===r.index)?.resolved||exactPath(new Map(Object.entries(w.files)),w.originalPath,unquote(r.value)))===w.originalStartupPath))additions.push('Project='+nativePathValue(relativeProjectPath(w.path,w.originalStartupPath)));
  if(written.has(cleanProjectPath(w.path).toLowerCase()))fail('Project group output path collides with a project file');if(moved)delete files[w.originalPath];files[cleanProjectPath(w.path)]=encodeNativeText(applyLineEdits(linesOf(w.document.text),edits,additions),w.document,options.encoding);
  normalizedEntries(Object.entries(files));return files;
}
