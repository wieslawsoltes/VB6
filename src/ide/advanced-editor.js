import {el} from '../core/core.js';
import {modal,alertDialog} from './ui.js';
import {normalizeAdvancedEditorSettings,loadAdvancedEditorSettings,saveAdvancedEditorSettings,validateLanguageServerEndpoint} from '../editor/advanced/settings.js';
import {loadAdvancedEditorAssets} from '../editor/advanced/loader.js';

/** The only eagerly bundled part of the opt-in editor: settings and lifecycle.
 * SourceEditor remains the public IDE adapter in both modes. */
export function installAdvancedEditor(ide) {
  if(ide.advancedEditor)return ide.advancedEditor;
  const document=ide.root.ownerDocument,view=document.defaultView;
  let baseUrl;try{baseUrl=new URL('advanced-editor/',document.currentScript?.src||document.baseURI).href;}catch{baseUrl='file:///advanced-editor/';}
  let storage;try{storage=view.localStorage;}catch{}
  const controller={settings:loadAdvancedEditorSettings(storage),runtime:null,generation:0,pending:null};
  ide.advancedEditor=controller;
  controller.report=error=>{ide.status('Advanced editor: '+(error.message||error));};
  controller.configure=async(value,{persist=true}={})=>{
    const settings=normalizeAdvancedEditorSettings(value);
    for(const name of ['vb6Endpoint','xamlEndpoint'])settings[name]=validateLanguageServerEndpoint(settings[name],view.location.protocol);
    const generation=++controller.generation;
    controller.initializing?.abort();controller.initializing=null;
    controller.settings=settings;
    if(persist)try{saveAdvancedEditorSettings(storage,settings);}catch(error){controller.report(new Error('Options apply to this session only; browser storage is unavailable.'));}
    if(controller.runtime){controller.runtime.dispose();controller.runtime=null;}
    ide.root.dataset.advancedEditor='false';
    if(!settings.enabled){ide.status('Classic code editor enabled.');return false;}
    const initializing=new AbortController();controller.initializing=initializing;
    try {
      const assets=await loadAdvancedEditorAssets(document,baseUrl);
      if(generation!==controller.generation)return false;
      const runtime=await assets.create(ide,settings,assets,{signal:initializing.signal});
      if(generation!==controller.generation){runtime.dispose();return false;}
      controller.runtime=runtime;ide.root.dataset.advancedEditor='true';
      ide.status('Advanced VB6/XAML editor enabled.');return true;
    }catch(error){if(generation!==controller.generation)return false;controller.report(error);ide.root.dataset.advancedEditor='false';throw error;}
    finally{if(controller.initializing===initializing)controller.initializing=null;}
  };
  controller.options=async()=>{
    const fields={},settings=controller.settings,body=el('div',{class:'advanced-editor-options'});
    const checkbox=(key,label)=>{const input=el('input',{type:'checkbox','aria-label':label});input.checked=settings[key];fields[key]=input;body.append(el('label',{style:{display:'block',marginBottom:'8px'}},input,' '+label));};
    checkbox('enabled','Enable advanced code editor (experimental)');
    body.append(el('p',{},'Classic mode is the default. The advanced editor is loaded only after enabling it.'));
    for(const [key,label]of [['minimap','Minimap'],['stickyScroll','Sticky scope headers'],['wordWrap','Word wrap'],['ligatures','Font ligatures'],['semanticHighlighting','Semantic highlighting'],['inlayHints','Parameter name hints'],['codeLens','Reference CodeLens']])checkbox(key,label);
    const whitespace=el('select',{'aria-label':'Render whitespace'});for(const value of ['none','boundary','selection','trailing','all'])whitespace.append(el('option',{value},value));whitespace.value=settings.renderWhitespace;fields.renderWhitespace=whitespace;body.append(el('label',{},'Render whitespace ',whitespace));
    body.append(el('hr'),el('p',{},'Language servers: leave blank to use the bundled VB6 and XAML services locally in a worker. Configured servers receive project source. Connect only to servers you trust.'));
    for(const [key,label]of [['vb6Endpoint','VB6 language server WebSocket URL'],['xamlEndpoint','XAML language server WebSocket URL']]){
      const input=el('input',{type:'url',value:settings[key],placeholder:'Built-in (no network)','aria-label':label,style:{width:'100%',boxSizing:'border-box'}});fields[key]=input;body.append(el('label',{},label,input));
    }
    const read=()=>Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.type==='checkbox'?input.checked:input.value]));
    return modal('Advanced Editor Options',{width:570,content:body,buttons:[{label:'OK',value:true,primary:true,action:async()=>{await controller.configure(read());}},{label:'Cancel',value:false}]});
  };
  const menu=ide.menu.bind(ide),command=ide.command.bind(ide),update=ide.updateCommandState.bind(ide),appearance=ide.applyAppearance.bind(ide);
  ide.menu=name=>{const items=menu(name);if(name==='Tools')items.push(null,{id:'advancedEditorOptions',label:'Advanced Editor Options…'});
    if(name==='View'&&controller.runtime)items.push(null,{id:'advancedEditorMinimap',label:'Code Minimap',checked:controller.settings.minimap},{id:'advancedEditorPalette',label:'Editor Command Palette',shortcut:'F1'},{id:'advancedEditorSymbols',label:'Go to Project Symbol…',shortcut:'Ctrl+T'},{id:'advancedEditorCalls',label:'Call Hierarchy'},{id:'advancedEditorTypes',label:'Type Hierarchy'},{id:'advancedEditorSplit',label:'Split Code Editor',checked:controller.runtime?.active()?.views.length===2});return items;};
  ide.command=(id,...args)=>{if(id==='advancedEditorOptions')return controller.options();
    if(id==='advancedEditorMinimap')return controller.configure({...controller.settings,minimap:!controller.settings.minimap});
    if(['advancedEditorSymbols','advancedEditorCalls','advancedEditorTypes'].includes(id))return controller.runtime?.navigationTools.open(({advancedEditorSymbols:'symbols',advancedEditorCalls:'call',advancedEditorTypes:'type'})[id]);
    if(id==='advancedEditorSplit'){const surface=controller.runtime?.active();return surface?.setSplit(surface.views.length===1);}
    if(id==='advancedEditorPalette')return controller.runtime?.action('editor.action.quickCommand');
    const result=controller.runtime?.handleCommand(id);if(result?.handled)return result.value;
    return command(id,...args);
  };
  ide.updateCommandState=(...args)=>{const result=update(...args);controller.runtime?.scheduleSync();return result;};
  ide.applyAppearance=(...args)=>{const result=appearance(...args);controller.runtime?.appearance();return result;};
  // Save notifications are tied to actual persistence, not merely Ctrl+S.
  if(ide.saveProject){const save=ide.saveProject.bind(ide);ide.saveProject=async(...args)=>{const runtime=controller.runtime,snapshot=runtime?.willSave();const result=await save(...args);if(result===true&&runtime===controller.runtime)runtime?.didSave(snapshot);return result;};}
  view.addEventListener('pagehide',()=>{++controller.generation;controller.initializing?.abort();controller.initializing=null;controller.runtime?.dispose();controller.runtime=null;});
  if(controller.settings.enabled)controller.pending=controller.configure(controller.settings,{persist:false}).catch(controller.report);
  return controller;
}
