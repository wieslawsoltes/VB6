import {installNativeWorkspace} from './native-workspace.js';
import {writeRecoverableNativeDirectory} from '../project/native-save-recovery.js';
import {mergedProject} from '../project/import-merge.js';
/** Native projects coexist with web snapshots; browser permissions stay explicit. */
import {el,clone,download,safeName} from '../core/core.js';
import {modal,alertDialog} from './ui.js';
import {importFiles,sourceFiles,listProjectEntries,selectWorkspaceProject,workspaceProjects} from '../project/formats.js';
import {normalizeProject} from '../project/model.js';
import {normalizedEntries,MAX_NATIVE_BYTES,MAX_NATIVE_FILES} from '../project/native-project.js';
import {NATIVE_ENCODINGS,bytesOf,decodeNativeText,unquote} from '../project/native-text.js';
import {readNativeDirectory,planNativeDirectoryWrite} from '../project/native-directory.js';
import {fromBase64} from '../project/frx.js';
import {readZip,writeZip,ZIP_FILENAME_ENCODINGS,zipFilenameEncoding} from '../project/zip.js';
const option=(value,label=value)=>el('option',{value},label);
const projectFile=p=>p.nativeProject?.path||p.name+'.vbp';
const fileName=p=>p.sourcePath||p.name+(p.kind==='form'?'.frm':p.kind==='class'?'.cls':'.bas');
const nativeExtensions=/\.(vbp|vbg|frm|bas|cls|ctl|pag|dob|dsr)$/i;
const readme='VB6 Studio Web native source export\r\n\r\nOpen the VBP or VBG with its complete companion files. Imported source, designer\r\nmetadata and opaque resources are preserved; edited known resources are appended.\r\nOpening a native project does not install or run its COM/OCX dependencies.\r\nRead docs/NATIVE-PROJECTS.md in the application source for compatibility details.\r\n';
export async function browserFileEntries(files,options={}){
  const entries=[];let total=0;
  for(const file of files){
    if(file.size>MAX_NATIVE_BYTES)throw new Error('File exceeds the 50 MiB import limit');
    const bytes=new Uint8Array(await file.arrayBuffer()),parts=/\.zip$/i.test(file.name)?await readZip(bytes,{filenameEncoding:options.filenameEncoding}):[[file.webkitRelativePath||file.name,bytes]];
    for(const [path,value]of parts){total+=bytesOf(value).length;if(total>MAX_NATIVE_BYTES||entries.length>=MAX_NATIVE_FILES)throw new Error('Import exceeds 50 MiB or 2,000 files');entries.push([path,value]);}
  }
  return normalizedEntries(entries);
}
async function importOptions(entries,provided={}){
  if(provided.interactive===false||provided.entryPath||provided.encoding)return provided;
  const choices=listProjectEntries(entries),native=[...entries.keys()].some(p=>nativeExtensions.test(p));
  if(!native&&choices.length<=1)return provided;
  const pick=el('select',{'aria-label':'Project entry',class:'dialog-input'},...choices.map(c=>option(c.path,c.path+' ('+c.format+')')));
  if(!choices.length)pick.append(option('','Selected source files'));
  pick.value=(choices.find(c=>c.format==='group')||choices.find(c=>c.format==='web')||choices[0])?.path||'';
  const encoding=el('select',{'aria-label':'Native text encoding',class:'dialog-input'},...NATIVE_ENCODINGS.map(e=>option(e,e==='auto'?'Auto (BOM / non-ASCII UTF-8 / Windows-1252)':e)));
  const content=el('div',{},el('p',{},'Select the project or group to open. All selected companion files stay in the workspace.'),el('label',{},'Project entry:',pick),el('label',{},'Native source and resource encoding:',encoding),el('p',{},'Choose the original Windows code page for legacy projects. Unknown designer/resource data is preserved, not executed.'));
  if(!await modal('Open Native / Web Project',{width:580,content,buttons:[{label:'Open',value:true,primary:true},{label:'Cancel',value:false}]}))return null;
  return {...provided,entryPath:pick.value||undefined,encoding:encoding.value};
}
export function installNativeProjects(ide){
  const menu=ide.menu.bind(ide),command=ide.command.bind(ide),renderTree=ide.renderProjectTree.bind(ide),loadProject=ide.loadProject.bind(ide);
  let importing=false,saving=false,groupSwitch=false,importGeneration=0;const sessions=new Map();
  ide.fileInput.removeAttribute('accept'); // The complete selected workspace can contain arbitrary companion files.
  ide.nativeGroupSelect=el('select',{'aria-label':'Active project in group',title:'Active project in group',class:'toolbar-select',style:{maxWidth:'160px'},hidden:true});
  ide.nativeGroupSelect.addEventListener('change',()=>ide.switchNativeProject(ide.nativeGroupSelect.value));ide.projectToolbar.append(ide.nativeGroupSelect);
  ide.renderProjectTree=()=>{
    renderTree();if(!ide.project)return;
    const selector=ide.nativeGroupSelect;selector.hidden=!ide.project.nativeWorkspace;
    if(!selector.hidden){selector.replaceChildren(...workspaceProjects(ide.project).map(p=>option(projectFile(p),(projectFile(p)===ide.project.nativeWorkspace.startupPath?'★ ':'')+p.name)));selector.value=projectFile(ide.project);selector.disabled=ide.runState!=='design';}
    const root=ide.projectTree.querySelector('.tree-row .tree-label');if(root)root.textContent=ide.project.name+' ('+projectFile(ide.project)+')';
    for(const file of ide.project.nativeProject?.files||[])if(!file.moduleId)ide.projectTree.append(el('div',{class:'tree-row',role:'treeitem',tabindex:0,title:file.opaqueReason||'Preserved native file',ondblclick:()=>ide.inspectNativeFile(file),onkeydown:e=>{if(e.key==='Enter')ide.inspectNativeFile(file);}},el('span',{class:'tree-label'},file.path+' ('+(file.resolved?'read-only':'missing')+')')));
    for(const row of ide.projectTree.querySelectorAll('[data-module]')){const m=ide.project.modules.find(m=>m.name===row.dataset.module);if(m)row.querySelector('.tree-label').textContent=m.name+' ('+fileName(m)+')';}
  };
  ide.inspectNativeFile=async file=>{const path=file.resolved||file.path,asset=ide.project.assets?.[path]||ide.project.nativeWorkspace?.files?.[path];if(!asset){await alertDialog('This referenced file was not supplied: '+file.path,'Native File');return;}const bytes=fromBase64(asset.data);let text;try{text=decodeNativeText(bytes.subarray(0,262144),{encoding:ide.project.nativeProject?.document?.encoding||'auto'}).text;}catch{text=[...bytes.subarray(0,4096)].map(b=>b.toString(16).padStart(2,'0')).join(' ');}await modal('Native File — '+path,{width:720,content:el('div',{},el('p',{},file.opaqueReason||'Preserved companion file. This viewer does not execute or change the file.'),el('textarea',{'aria-label':'Read-only native file',readonly:true,value:'',style:{width:'100%',height:'300px'}},text),el('p',{},bytes.length+' original bytes; preview is bounded.')),buttons:[{label:'Download Original',value:'download',action:()=>download(path.split('/').at(-1),bytes)},{label:'Close',value:false}]});};
  ide.loadProject=(project,...args)=>{if(!groupSwitch){sessions.clear();importGeneration++;}return loadProject(project,...args);};
  ide.switchNativeProject=(path,{interactive=true}={})=>{
    try{
      if(ide.runState!=='design')throw new Error('Stop execution before switching projects.');
      if(path.toLowerCase()===projectFile(ide.project).toLowerCase())return;
      const old=ide.project,dirty=ide.dirty,next=selectWorkspaceProject(old,path);let saved=ide.savedJSON;try{saved=JSON.stringify(selectWorkspaceProject(JSON.parse(saved),path));}catch{}
      sessions.set(projectFile(old),{undo:ide.history.undoStack.slice(),redo:ide.history.redoStack.slice(),breakpoints:clone(ide.breakpoints),watches:clone(ide.watches),docs:clone(ide.docs),active:ide.activeDoc?.key});
      groupSwitch=true;try{ide.loadProject(next);}finally{groupSwitch=false;}
      const state=sessions.get(projectFile(next));if(state){ide.history.undoStack=state.undo;ide.history.redoStack=state.redo;ide.breakpoints=state.breakpoints;ide.watches=state.watches;for(const doc of state.docs)ide.openDocument(doc.id,doc.view);const active=state.docs.find(d=>d.key===state.active);if(active)ide.openDocument(active.id,active.view);}
      // Old whole-project undo snapshots cannot replace freshly edited peers.
      ide.savedJSON=saved;ide.dirty=dirty||JSON.stringify(ide.project)!==saved;ide.updateTitle();ide.persist();ide.status('Active project: '+next.name+'; all projects remain in the workspace.');
    }catch(error){if(!interactive)throw error;ide.nativeGroupSelect.value=projectFile(ide.project);alertDialog(error.message,'Project Group');}
  };
  // Preserve the current workspace peers when applying a cached project's undo snapshot.
  for(const method of ['undo','redo']){const original=ide.history[method].bind(ide.history);ide.history[method]=(...args)=>{const current=ide.project.nativeWorkspace,result=original(...args);if(current&&result?.nativeWorkspace)result.nativeWorkspace.peers=clone(current.peers);return result;};}
  ide.openNativeGroupDialog=async()=>{
    if(!ide.project.nativeWorkspace)return false;
    const projects=workspaceProjects(ide.project),active=el('select',{'aria-label':'Active project',class:'dialog-input'},...projects.map(p=>option(projectFile(p),p.name+' — '+projectFile(p)))),startup=el('select',{'aria-label':'Startup project',class:'dialog-input'},...projects.map(p=>option(projectFile(p),p.name)));
    active.value=projectFile(ide.project);startup.value=ide.project.nativeWorkspace.startupPath;
    if(!await modal('Project Group',{content:el('div',{},el('label',{},'Active project:',active),el('label',{},'Startup project:',startup),el('p',{},'Save Project writes every project in this group. The browser runs one active project at a time.'))}))return false;
    if(startup.value!==ide.project.nativeWorkspace.startupPath){const before=clone(ide.project);ide.project.nativeWorkspace.startupPath=startup.value;ide.record(before,'Change startup project');}
    if(active.value!==projectFile(ide.project))ide.switchNativeProject(active.value);return true;
  };
  ide.importProjectEntries=async(entries,options={})=>{
    if(options.expectedProject!==undefined&&JSON.stringify(ide.project)!==options.expectedProject){await alertDialog('The project changed while files were being read. Open again to avoid losing edits.','Open Project');return false;}
    if(importing||saving)return false;importing=true;
    try{
      if(ide.runState!=='design')throw new Error('Stop execution before opening source files.');
      if(!options.add&&ide.dirty&&!await ide.confirmDiscard())return false;
      const token=JSON.stringify(ide.project),selected=await importOptions(entries,options);if(selected===null)return false;
      const result=await importFiles(entries,selected);
      if(JSON.stringify(ide.project)!==token)throw new Error('The current project changed during import. Open again to avoid losing edits.');
      if(options.add){const before=clone(ide.project);ide.project=mergedProject(ide.project,result.project);ide.record(before,'Add existing native source files');}
      else ide.loadProject(result.project);
      ide.diagnostics=result.diagnostics;ide.editor.setDiagnostics(ide.diagnostics);if(ide.diagnostics.length)ide.showDebug('Errors');
      ide.status('Opened '+ide.project.name+(ide.diagnostics.length?' — review import diagnostics.':'.'));return true;
    }catch(error){await alertDialog(error.message,'Open Project');return false;}finally{importing=false;}
  };
  ide.importBrowserFiles=async(files,options={})=>{if(!files.length)return false;const generation=++importGeneration,expectedProject=JSON.stringify(ide.project);try{const entries=await browserFileEntries(files,{filenameEncoding:options.filenameEncoding||ide.zipFilenameEncoding});if(generation!==importGeneration)return false;return await ide.importProjectEntries(entries,{...options,expectedProject});}catch(error){await alertDialog(error.message,'Open Project');return false;}};
  ide.openFolder=async()=>{
    const host=ide.root.ownerDocument.defaultView,expectedProject=JSON.stringify(ide.project);
    if(typeof host.showDirectoryPicker==='function')try{const handle=await host.showDirectoryPicker({mode:'read'}),{entries,skipped}=await readNativeDirectory(handle),opened=await ide.importProjectEntries(entries,{expectedProject});if(opened&&skipped.length)ide.status('Opened '+ide.project.name+'; skipped '+skipped.join(', '));return opened;}catch(error){if(error.name!=='AbortError')await alertDialog(error.message,'Open Project Folder');return false;}
    const input=el('input',{type:'file',webkitdirectory:true,multiple:true,hidden:true});ide.root.append(input);input.addEventListener('change',()=>{ide.importBrowserFiles([...input.files]);input.remove();},{once:true});input.addEventListener('cancel',()=>input.remove(),{once:true});input.click();return true;
  };
  ide.saveProject=async({format=ide.project.storageFormat||'web',name,encoding,directoryHandle}={})=>{
    if(saving)return false;saving=true;
    try{
      if(!['web','native','folder'].includes(format))throw new Error('Unknown project save format: '+format);
      let recoveryCleanupPending=false;const token=JSON.stringify(ide.project),project=clone(ide.project);project.storageFormat=format==='web'?'web':'native';
      const filename=safeName(name||project.nativeWorkspace?.path.split('/').at(-1).replace(/\.vbg$/i,'')||project.name);
      if(format==='web')download(filename+'.vb6web',JSON.stringify(project,null,2),'application/json');
      else{
        const files=sourceFiles(project,{encoding});
        if(format==='folder'){
          const host=ide.root.ownerDocument.defaultView;if(!directoryHandle&&typeof host.showDirectoryPicker!=='function')throw new Error('This browser does not support writing a directory. Choose Native VB6 ZIP and extract it.');
          const handle=directoryHandle||await host.showDirectoryPicker({mode:'readwrite'}),plan=await planNativeDirectoryWrite(handle,files);
          const overwrite=plan.entries.filter(e=>e.before!==null);
          if(overwrite.length&&!await modal('Replace Native Project Files',{content:el('div',{},el('p',{},'Replace '+overwrite.length+' existing files and create '+(plan.entries.length-overwrite.length)+' new files?'),el('p',{},'Unrelated files are not deleted. File changes are checked again before writing. Original and intended files are staged for conflict-aware recovery. This is not an atomic transaction.')),buttons:[{label:'Save Files',value:true,primary:true},{label:'Cancel',value:false}]}))return false;
          if(JSON.stringify(ide.project)!==token)throw new Error('Project changed during save confirmation. Save again.');
          recoveryCleanupPending=!!(await writeRecoverableNativeDirectory(plan)).recoveryCleanupPending;
        }else download(filename+'-native.zip',writeZip(files),'application/zip');
      }
      if(JSON.stringify(ide.project)!==token){ide.status('Snapshot saved; newer edits remain unsaved.');return false;}
      ide.project.storageFormat=project.storageFormat;ide.savedJSON=JSON.stringify(ide.project);ide.dirty=false;ide.rememberProject();ide.persist();ide.updateTitle();
      ide.status('Saved '+(format==='web'?filename+'.vb6web':format==='folder'?'native project folder':filename+'-native.zip')+(recoveryCleanupPending?'; saved bytes verified, but recovery journal cleanup needs attention.':''));return true;
    }catch(error){if(error.name!=='AbortError')await alertDialog(error.message,'Save Project');return false;}finally{saving=false;}
  };
  ide.confirmDiscard=async()=>{
    if(!ide.dirty)return true;
    const result=await modal('Visual Basic',{content:el('p',{},'Save changes to '+ide.project.name+'?'),buttons:[{label:'Save',value:'save',primary:true},{label:'Discard',value:'discard'},{label:'Cancel',value:false}]});
    return result==='save'?await ide.saveProject():result==='discard';
  };
  ide.openNativeSettings=async()=>{
    if(!ide.project.nativeProject||ide.runState!=='design')return false;
    const original=JSON.stringify(ide.project),input=el('textarea',{'aria-label':'Native project settings',spellcheck:false,style:{width:'100%',height:'320px'}});
    input.value=ide.project.nativeProject.entries.map(r=>r.key+'='+r.value).join('\n');
    if(!await modal('Native Project Settings',{width:650,content:el('div',{},el('p',{},'Edit native VBP settings as key=value records. Duplicate records are retained. Edit membership, references, name and startup through their dedicated project tools.'),input)}))return false;
    if(ide.runState!=='design'||JSON.stringify(ide.project)!==original)throw new Error('Project changed while native settings were open.');
    const next=clone(ide.project),entries=[];
    for(const line of input.value.split(/\r?\n/)){if(!line.trim())continue;const at=line.indexOf('=');if(at<=0)throw new Error('Each setting must be a key=value record.');entries.push({key:line.slice(0,at).trim(),value:line.slice(at+1).trim()});}
    next.nativeProject.entries=entries;next.description=unquote(entries.find(r=>r.key.toLowerCase()==='description')?.value||'');
    sourceFiles(next);const before=clone(ide.project);ide.project=next;ide.record(before,'Native project settings');return true;
  };
  ide.saveNativeAs=async()=>{
    const name=el('input',{'aria-label':'Export file name',class:'dialog-input',value:ide.project.name}),format=el('select',{'aria-label':'Save project format',class:'dialog-input'},option('web','Browser project (.vb6web)'),option('native','Original VB6 project / group (.zip)'),option('folder','Original VB6 project folder'));
    format.value=ide.project.storageFormat||'web';
    if(!await modal('Save Project As',{content:el('div',{},el('label',{},'Export file name:',name),el('label',{},'Format:',format),el('p',{},'Native files keep their existing relative paths and encodings. Browser snapshots retain all native preservation metadata.'))}))return false;
    return ide.saveProject({format:format.value,name:name.value});
  };
  ide.saveNativeModule=()=>{
    const module=ide.activeModule;if(!module)return;
    const project={...ide.project,modules:[module]};delete project.nativeWorkspace;
    const all=sourceFiles(project),path=fileName(module),companions=Object.create(null);companions[path]=all[path];
    for(const [name,bytes]of Object.entries(all))if(!/\.(vbp|vbg|vb6web|vb6proj|frm|bas|cls|ctl|pag|dob|dsr)$/i.test(name))companions[name]=bytes;
    if(Object.keys(companions).length===1)download(path.split('/').at(-1),all[path],'application/octet-stream');else download(module.name+'-native.zip',writeZip(companions),'application/zip');
    ide.status('Exported '+path+' with its available companion resources.');
  };
  ide.menu=name=>{const items=menu(name);if(name==='File'){const at=items.findIndex(i=>i?.id==='saveAs');items.splice(at+1,0,{id:'zipEncoding',label:'Open ZIP with Filename Encoding…',icon:'open'},{id:'saveNative',label:'Save Native VB6 Project (.zip)…',icon:'save'},{id:'saveNativeFolder',label:'Save Native VB6 Folder…'},{id:'saveWebProject',label:'Save Browser Project (.vb6web)…'});}if(name==='Project')items.unshift({id:'nativeSettings',label:'Native Project Settings…',enabled:!!ide.project.nativeProject&&ide.runState==='design'},{id:'nativeGroup',label:'Project Group…',enabled:!!ide.project.nativeWorkspace&&ide.runState==='design'},null);return items;};
  ide.command=async(id,...args)=>{
    try{
      if(id==='zipEncoding'){const pick=el('select',{'aria-label':'ZIP filename encoding',class:'dialog-input'},...ZIP_FILENAME_ENCODINGS.map(e=>option(e)));pick.value=ide.zipFilenameEncoding||'cp437';if(!await modal('ZIP Filename Encoding',{content:el('div',{},el('p',{},'For unmarked legacy ZIP filenames only. UTF-8 flags and valid Unicode Path metadata take precedence. This does not change source text encoding. Selection lasts until changed or the IDE reloads.'),el('label',{},'Filename code page:',pick))}))return false;ide.zipFilenameEncoding=zipFilenameEncoding(pick.value);ide.addingFiles=false;ide.fileInput.click();return true;}if(id==='open'){ide.addingFiles=false;ide.fileInput.click();return true;}if(id==='nativeSettings')return await ide.openNativeSettings();
      if(id==='saveAs')return ide.saveNativeAs();if(id==='saveNative')return ide.saveProject({format:'native'});if(id==='saveNativeFolder')return ide.saveProject({format:'folder'});if(id==='saveWebProject')return ide.saveProject({format:'web'});if(id==='nativeGroup')return ide.openNativeGroupDialog();if(id==='saveModule')return ide.saveNativeModule();
      if(id==='exportSources'){const files=sourceFiles(ide.project);let path=ide.project.name+'.vb6web';while(Object.keys(files).some(p=>p.toLowerCase()===path.toLowerCase()))path='snapshot-'+path;files[path]=JSON.stringify(ide.project,null,2);if(!Object.keys(files).some(p=>p.toLowerCase()==='vb6-studio-readme.txt'))files['VB6-Studio-README.txt']=readme;download(safeName(ide.project.name)+'-sources.zip',writeZip(files),'application/zip');ide.status('Exported native sources and browser snapshot.');return true;}
      return await command(id,...args);
    }catch(error){await alertDialog(error.message,'Native Project');return false;}
  };
  installNativeWorkspace(ide);
}
