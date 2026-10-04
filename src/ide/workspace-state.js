import {snapshotEditorView,restoreEditorView} from '../editor/view-state.js';
import {normalizeWindowProfile,parseWindowProfiles,MODELESS_TOOLS} from './window-profile.js';
import {CommandBarLayout} from './command-bar-model.js';
import {el,download} from '../core/core.js';
import {modal,alertDialog} from './ui.js';
export function installWorkspaceState(ide) {
  const snapshot=ide.layoutSnapshot.bind(ide),restore=ide.restoreLayout.bind(ide),restoreDocs=ide.restoreDocuments.bind(ide),command=ide.command.bind(ide);
  const editorViews=()=>Object.fromEntries([...ide.documents.editors].slice(0,256).map(([id,e])=>[id,snapshotEditorView(e)]));
  const tools=()=>[...ide.documents.tools.keys()].filter(key=>MODELESS_TOOLS.includes(key));
  const openTools=keys=>{for(const key of Array.isArray(keys)?keys:[])if(key==='tool:resources')ide.openResourceEditor?.();else if(key==='tool:object-browser')ide.objectBrowser();else if(key==='tool:project-search')ide.projectSearch();};
  ide.layoutSnapshot=()=>({...snapshot(),tools:tools(),activeWindow:ide.documents.mdi.active,editorViews:editorViews()});
  const restoreViews=views=>{if(!views||typeof views!=='object')return;for(const [id,value]of Object.entries(views).slice(0,256)){const editor=ide.documents.editors.get(id);if(editor)restoreEditorView(editor,value);}};
  ide.restoreDocuments=()=>{const saved=ide.savedDocumentLayout;restoreDocs();openTools(saved?.tools);ide.documents.mdi.restoreSnapshot(saved?.windows);restoreViews(saved?.editorViews);if(saved?.activeDoc){const doc=ide.docs.find(d=>d.key===saved.activeDoc);if(doc)ide.documents.activate(doc);}if(saved?.activeWindow&&ide.documents.mdi.windows.has(saved.activeWindow))ide.documents.mdi.activate(saved.activeWindow);};
  ide.restoreLayout=layout=>{restore(layout);if(layout?.namedLayouts){try{ide.namedLayouts=parseWindowProfiles(JSON.stringify({version:2,layouts:layout.namedLayouts}),ide.docking.model.windows.keys());}catch(error){ide.namedLayouts=Object.create(null);ide.status('Saved layout collection ignored: '+error.message);}}};
  ide.captureWindowLayout=()=>normalizeWindowProfile({version:2,tools:tools(),activeWindow:ide.documents.mdi.active,projectId:ide.project.id,docking:ide.docking.snapshot(),commandBars:ide.commandBars.snapshot(),docs:ide.docs,activeDoc:ide.activeDoc?.key,windows:ide.documents.mdi.snapshot(),editorViews:editorViews()},ide.docking.model.windows.keys());
  ide.applyWindowLayout=value=>{
    const profile=normalizeWindowProfile(value,ide.docking.model.windows.keys());
    ide.docking.cancelInteraction?.();ide.commandBars.cancelInteraction?.();ide.documents.mdi.cancelInteraction?.();
    ide.browserWindows?.attachAll('layout');
    ide.docking.restore(profile.version===1?profile:profile.docking);
    if(profile.version===2){ide.commandBars.restore(profile.commandBars);if(profile.projectId===ide.project.id){
      for(const doc of profile.docs){const module=ide.project.modules.find(m=>m.id===doc.id);if(module&&(doc.view!=='form'||module.form))ide.openDocument(doc.id,doc.view);}
      openTools(profile.tools);ide.documents.mdi.restoreSnapshot(profile.windows);restoreViews(profile.editorViews);
      const active=ide.docs.find(d=>d.key===profile.activeDoc);if(active)ide.documents.activate(active);if(profile.activeWindow&&ide.documents.mdi.windows.has(profile.activeWindow))ide.documents.mdi.activate(profile.activeWindow);
    }}
    ide.autosave();ide.status(profile.version===2&&profile.projectId!==ide.project.id?'Tool layout restored. Document positions belong to another project.':'Window layout restored.');return profile;
  };
  ide.importWindowLayouts=text=>{
    const imported=parseWindowProfiles(text,ide.docking.model.windows.keys()),names=new Set([...Object.keys(ide.namedLayouts),...Object.keys(imported)]);
    if(names.size>20)throw new Error('Import would exceed the 20 saved layout limit.');
    for(const [name,profile]of Object.entries(imported))Object.defineProperty(ide.namedLayouts,name,{value:profile,enumerable:true,writable:true,configurable:true});
    ide.autosave();return Object.keys(imported).length;
  };
  ide.command=async(id,...args)=>{
    if(id==='resetLayout'){ide.docking.cancelInteraction?.();ide.commandBars.cancelInteraction?.();ide.documents.mdi.cancelInteraction?.();ide.commandBars.model=new CommandBarLayout();ide.commandBars.render();return command(id,...args);}
    if(id!=='manageWindowLayouts')return command(id,...args);
    const content=el('div',{class:'layout-manager'}),list=el('select',{size:9,'aria-label':'Saved layouts',style:{width:'100%'}}),note=el('p',{},'Layouts include dock groups, toolbars and project-specific editor views. Import validates the complete file before changing saved layouts.'),input=el('input',{type:'file',accept:'.json,application/json',hidden:true}),status=el('p',{role:'status'});
    const refresh=()=>{const old=list.value;list.replaceChildren(...Object.keys(ide.namedLayouts).map(name=>el('option',{value:name},name)));if(Object.hasOwn(ide.namedLayouts,old))list.value=old;};refresh();content.append(note,list,input,status);let alive=true;
    input.addEventListener('change',async()=>{const file=input.files?.[0];input.value='';if(!file)return;try{if(file.size>2*1024*1024)throw new Error('Layout file exceeds 2 MiB.');const text=await file.text();if(!alive)return;const count=ide.importWindowLayouts(text);refresh();status.textContent='Imported '+count+' layout(s).';}catch(error){if(alive)status.textContent=error.message;}});
    await modal('Window Layouts',{content,width:470,buttons:[{label:'Restore',action:()=>{if(list.value)try{ide.applyWindowLayout(ide.namedLayouts[list.value]);}catch(error){status.textContent=error.message;return false;}}},{label:'Delete',action:()=>{delete ide.namedLayouts[list.value];refresh();ide.autosave();return false;}},{label:'Import…',action:()=>{input.click();return false;}},{label:'Export…',action:()=>{download('VB6-window-layouts.json',JSON.stringify({version:2,layouts:ide.namedLayouts},null,2),'application/json');return false;}},{label:'Close',value:false}]});alive=false;
  };
  // Cursor/scroll/split changes are view metadata too, even without source edits.
  const create=ide.documents.editor.bind(ide.documents);ide.documents.editor=module=>{const existed=ide.documents.editors.has(module.id),editor=create(module);if(!existed){editor.on('cursor',()=>ide.autosave());editor.root.addEventListener('scroll',()=>ide.autosave(),true);const split=editor.setSplitRatio.bind(editor);editor.setSplitRatio=value=>{split(value);ide.autosave();};}return editor;};
  window.addEventListener('pagehide',()=>{ide.autosave.cancel();ide.persist();});
}
