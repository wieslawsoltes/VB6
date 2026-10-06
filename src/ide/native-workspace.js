import {captureNativeWindowState,nativeDocumentWindows} from '../project/native-window-state.js';
import {el} from '../core/core.js';
import {modal,alertDialog} from './ui.js';
import {inspectNativeSaveRecovery,recoverNativeDirectory} from '../project/native-save-recovery.js';
export function installNativeWorkspace(ide){
  // Called only by trusted embedding code, never from a project or MCP tool.
  ide.installControlAdapters=registry=>{if(ide.runState!=='design')throw Error('Stop execution before installing control adapters');if(!registry||typeof registry.create!=='function')throw TypeError('Trusted control adapter registry required');ide.controlRegistry=registry;for(const designer of ide.documents.designers.values()){designer.options.controlRegistry=registry;designer.render();}for(const editor of ide.documents.editors.values()){editor.controlRegistry=registry;editor.refreshObjects();}ide.renderToolbox();ide.inspector.render();};
  ide.showControlPropertyPages=async()=>{
    if(ide.runState!=='design')throw new Error('Stop execution before editing component properties');
    const selected=ide.designer.selected();if(selected.length!==1)throw new Error('Select one component');
    const model=selected[0],revision=ide.visualRevision,project=ide.project,registry=ide.controlRegistry;
    const changes=await registry.editProperties(model,{owner:ide.root.ownerDocument,ide});if(!changes)return false;
    if(ide.runState!=='design'||ide.project!==project||ide.visualRevision!==revision||ide.controlRegistry!==registry||ide.designer.selected().length!==1||ide.designer.selected()[0]!==model)throw new Error('Component selection or project changed while property pages were open');
    ide.setProperties(changes);return true;
  };
  ide.restoreNativeWindows=()=>{
    const state=ide.project.nativeWindowState;if(ide.runState!=='design'||!state||!state.current&&!state.records?.some(r=>!r.ambiguous))return false;
    const states=nativeDocumentWindows(ide.project).slice(0,128); // never spawn OS windows from imported files
    for(const doc of [...ide.docs])ide.closeDocument(doc.key);
    for(const w of states)ide.openDocument(w.id,w.view);
    ide.documents.mdi.restoreSnapshot(states);ide.documents.tabs();return true;
  };
  ide.captureNativeWindows=()=>{if(ide.runState!=='design')throw new Error('Stop execution before capturing native window state');const windows=ide.documents.mdi.snapshot().flatMap(w=>{const doc=ide.docs.find(d=>d.key===w.key);return doc?[{...w,id:doc.id,view:doc.view}]:[];});captureNativeWindowState(ide.project,windows);};
  const load=ide.loadProject.bind(ide),command=ide.command.bind(ide),menu=ide.menu.bind(ide);
  ide.loadProject=(project,...args)=>{const result=load(project,...args);if(!args[0]?.initial||!ide.savedDocumentLayout)ide.restoreNativeWindows();return result;};
  ide.menu=name=>{const items=menu(name);if(name==='File')items.push(null,{id:'recoverNativeSave',label:'Recover Native Folder Save…'});if(name==='Window')items.push(null,{id:'restoreNativeWindows',label:'Restore Native Document Windows',enabled:!!ide.project?.nativeWindowState},{id:'captureNativeWindows',label:'Save Current Native Document Windows'});return items;};
  ide.command=async(id,...args)=>{try{
    if(id==='restoreNativeWindows')return ide.restoreNativeWindows();
    if(id==='captureNativeWindows'){ide.captureNativeWindows();ide.markDirty();ide.status('Native document layout captured. Save the project to write its VBW companion.');return true;}
    if(id!=='recoverNativeSave')return command(id,...args);
    if(ide.runState!=='design')throw new Error('Stop execution before recovering a native folder');const host=ide.root.ownerDocument.defaultView;if(!host.showDirectoryPicker)throw new Error('Folder recovery requires a browser with directory-picker support');
    const handle=await host.showDirectoryPicker({mode:'readwrite'}),state=await inspectNativeSaveRecovery(handle);
    if(!state){await modal('Native Folder Recovery',{content:el('p',{},'There is no pending save journal in this folder.')});return false;}
    if(state.conflicts.length){await modal('Native Folder Recovery',{content:el('div',{},el('p',{},'External changes were found. No files will be overwritten. Keep the journal for manual inspection.'),el('pre',{},state.conflicts.join('\n')))});return false;}
    const action=await modal('Native Folder Recovery',{content:el('p',{},'A verified save journal covers '+state.files.length+' files. Restore the original bytes or complete the saved snapshot? Both operations recheck for external edits.'),buttons:[{label:'Restore Original',value:'rollback'},{label:'Complete Save',value:'complete'},{label:'Cancel',value:false}]});
    if(!action)return false;
    if(ide.runState!=='design')throw new Error('Stop execution before recovering a native folder');
    // Disk recovery invalidates the saved baseline even when memory did not change.
    // Invalidate before writes so partial/failed recovery also preserves discard protection.
    ide.savedJSON=null;ide.markDirty();
    const result=await recoverNativeDirectory(handle,{action});if(result.remaining.length)throw new Error('Recovery stopped at conflicting files: '+result.remaining.join(', '));ide.markDirty();ide.status(result.cleanupPending?'Recovery completed; journal cleanup still requires attention.':'Native folder recovery completed. Reopen the folder to synchronize; the current workspace remains unsaved.');return true;
  }catch(error){if(error.name!=='AbortError')await alertDialog(error.message,'Native Workspace');return false;}};
}
