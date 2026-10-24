import {el,download} from '../core/core.js';
import {serializeScreen,serializeANSI,serializeB800} from '../tui/screen.js';
import {registerModalContribution} from './modal-contributions.js';
import {modal} from './ui.js';
import {DOS_SETTINGS_KEY,TUI_PROFILES,loadDOSSettings,normalizeDOSSettings} from '../tui/cells.js';
import {DOMTuiRenderer} from '../tui/dom.js';
import {TuiControlRegistry} from '../tui/controls.js';
import {DOSShell} from './dos-shell.js';
/** IDE-global presentation preference. The form, VB6 source, project theme,
 * twips, history, control registry, docking model and event pipeline are shared. */
export function installDOSWorkspace(ide) {
  if(ide.dosMode)return ide.dosMode;
  const document=ide.root.ownerDocument,view=document.defaultView,registry=new TuiControlRegistry(),sessions=new Map();
  let revision=0,storage;try{storage=view.localStorage;}catch{}
  const workspace={settings:{formLayout:'readable',...loadDOSSettings(storage)},enabled:false,registry,sessions,disposed:false,ready:Promise.resolve()};ide.dosMode=workspace;
  const report=error=>ide.status('DOS workspace: '+(error.message||String(error)));
  const attach=doc=>{if(workspace.enabled&&(!sessions.has(doc)||sessions.get(doc).disposed)){const renderer=new DOMTuiRenderer(doc,{settings:workspace.settings,registry,onError:report,onDispose:()=>{if(sessions.get(doc)===renderer){sessions.delete(doc);workspace.shell?.detach(doc);}}});sessions.set(doc,renderer);}if(workspace.enabled)workspace.shell?.attach(doc);};
  const detach=doc=>{workspace.shell?.detach(doc);sessions.get(doc)?.dispose();sessions.delete(doc);};
  const save=()=>{try{storage?.setItem(DOS_SETTINGS_KEY,JSON.stringify(workspace.settings));}catch{report(new Error('Settings apply to this session; browser storage is unavailable.'));}};
  const disable=()=>{workspace.enabled=false;workspace.shell?.dispose();workspace.shell=null;for(const doc of [...sessions.keys()])detach(doc);workspace.functionBar=null;if(document.documentElement.getAttribute('data-ide-workspace')==='dos')document.documentElement.removeAttribute('data-ide-workspace');};
  const figma=ide.figmaMode,originalFigmaConfigure=figma?.configure;
  const configureFigma=originalFigmaConfigure?function(value,options){revision++;if(value?.mode!=='dos'&&workspace.enabled){disable();workspace.settings={...workspace.settings,mode:'classic'};if(options?.persist!==false)save();}return originalFigmaConfigure.call(figma,value,options);}:null;
  if(figma)figma.configure=configureFigma;
  workspace.configure=(value,{persist=true}={})=>{
    const settings=normalizeDOSSettings({...workspace.settings,...value}),request=++revision;
    const apply=async()=>{
      if(workspace.disposed||request!==revision)return false;
      if(settings.mode==='dos'){
        if(figma?.enabled)await originalFigmaConfigure.call(figma,{...figma.settings,mode:'classic'},{persist});
        if(workspace.disposed||request!==revision)return false;
        workspace.settings=settings;workspace.enabled=true;document.documentElement.setAttribute('data-ide-workspace','dos');
        if(!workspace.shell)workspace.shell=new DOSShell(ide,{onError:report});
        attach(document);for(const record of ide.browserWindows?.windows.values()||[])attach(record.doc);
        for(const renderer of sessions.values())renderer.configure(settings);
        workspace.functionBar=workspace.shell.documents.get(document)?.bar;workspace.shell.schedule();
      }else{disable();workspace.settings=settings;}
      if(persist)save();return true;
    };
    workspace.ready=workspace.ready.then(apply,apply);return workspace.ready;
  };
  function fields(content){
    const group=el('fieldset',{class:'options-group dos-workspace-options'},el('legend',{},'DOS / TUI presentation'));
    const profile=el('select',{'aria-label':'DOS palette'},...Object.entries(TUI_PROFILES).map(([id,p])=>el('option',{value:id},p.name)));
    const width=el('select',{'aria-label':'DOS cell width'},...[8,9,10,12].map(n=>el('option',{value:n},n+' px'))),height=el('select',{'aria-label':'DOS cell height'},...[14,16,18,20,24].map(n=>el('option',{value:n},n+' px')));
    const formLayout=el('select',{'aria-label':'DOS form display coordinates'},el('option',{value:'readable'},'Readable character coordinates'),el('option',{value:'authored'},'Authored pixel coordinates'));formLayout.value=workspace.settings.formLayout||'readable';
    const graphics=el('select',{'aria-label':'DOS graphics projection'},el('option',{value:'blocks'},'EGA half blocks'),el('option',{value:'braille'},'Braille cells'),el('option',{value:'native'},'Original graphics'));
    const editing=el('select',{'aria-label':'DOS text editing'},el('option',{value:'cells'},'Cell selection and caret'),el('option',{value:'native'},'Original native editor'));
    const designerGrid=el('select',{'aria-label':'DOS designer grid'},el('option',{value:'project'},'Project grid'),el('option',{value:'cells'},'Character cells'));designerGrid.value=workspace.settings.designerGrid||'project';
    graphics.value=workspace.settings.graphics||'blocks';editing.value=workspace.settings.editing||'cells';
    profile.value=workspace.settings.profile;width.value=workspace.settings.cellWidth;height.value=workspace.settings.cellHeight;
    for(const [label,select]of [['Palette',profile],['Cell width',width],['Cell height',height],['Graphics',graphics],['Text editing',editing],['Form display',formLayout],['Designer grid',designerGrid]])group.append(el('label',{class:'option-field'},el('span',{},label),select));
    group.append(el('p',{class:'option-note'},'Uses the same VB6 controls, properties, events, designer and debugger. Rich content remains native; this is a TUI presentation, not a DOS emulator.'));
    content.append(group);return ()=>({profile:profile.value,cellWidth:Number(width.value),cellHeight:Number(height.value),graphics:graphics.value,editing:editing.value,formLayout:formLayout.value,designerGrid:designerGrid.value});
  }
  const unregisterOptions=registerModalContribution('Options',({content,buttons})=>{
    const general=content?.querySelector('[data-tab-page="general"]');if(!general)return;
    let mode=general.querySelector('select[aria-label="Workspace mode"]');
    if(!mode){mode=el('select',{'aria-label':'Workspace mode'},el('option',{value:'classic'},'Classic VB6'));general.prepend(mode);}
    mode.append(el('option',{value:'dos'},'DOS / TUI'));if(workspace.enabled)mode.value='dos';
    const read=fields(general);
    for(const button of buttons)if(button.value===true){const original=button.action;button.action=async()=>{const requested=mode.value,settings=read(),result=await original?.();if(result!==false)await workspace.configure({...settings,mode:requested==='dos'?'dos':'classic'});return result;};}
  });
  workspace.options=()=>{const content=el('div'),mode=el('select',{'aria-label':'DOS workspace enabled'},el('option',{value:'classic'},'Classic VB6'),el('option',{value:'dos'},'DOS / TUI'));mode.value=workspace.enabled?'dos':'classic';content.append(mode);const read=fields(content);return modal('DOS Workspace Options',{width:520,content,buttons:[{label:'OK',value:true,primary:true,action:()=>workspace.configure({...read(),mode:mode.value})},{label:'Cancel',value:false}]});};
  const originalMenu=ide.menu,originalCommand=ide.command,originalTransform=ide.transformRuntimeDocument;
  const menu=function(name){const items=originalMenu.call(this,name);if(name==='View'){items.push(null,{id:'dosWorkspaceToggle',label:'DOS / TUI Workspace',checked:workspace.enabled});if(workspace.enabled)items.push({id:'dosNextPane',label:'Next Workspace Pane',shortcut:'F6'},{id:'dosPreviousPane',label:'Previous Workspace Pane',shortcut:'Shift+F6'});}if(name==='Tools')items.push(null,{id:'dosWorkspaceOptions',label:'DOS Workspace Options…'},{label:'Export DOS Screen',enabled:workspace.enabled,items:[{id:'dosExportJSON',label:'Cell snapshot (.json)'},{id:'dosExportANSI',label:'ANSI text (.ans)'},{id:'dosExportText',label:'Plain text (.txt)'},{id:'dosExportB800',label:'CP437 character/attribute dump'}]});return items;};
  const command=function(id,...args){const exports={dosExportJSON:'json',dosExportANSI:'ansi',dosExportText:'text',dosExportB800:'b800'};if(Object.hasOwn(exports,id))return workspace.exportScreen(exports[id]);if(id==='dosWorkspaceToggle')return workspace.configure({mode:workspace.enabled?'classic':'dos'});if(id==='dosWorkspaceOptions')return workspace.options();if(workspace.shell?.handles(id))return workspace.shell.command(id,...args);return originalCommand.call(this,id,...args);};
  const transform=function(html){html=originalTransform?originalTransform.call(this,html):html;if(!workspace.enabled)return html;const s=workspace.settings;return html.replace(/<html(?=[\s>])/i,`<html data-vb-dos="${s.profile}" data-dos-cell-width="${s.cellWidth}" data-dos-cell-height="${s.cellHeight}" data-dos-form-layout="${s.formLayout||'authored'}" data-dos-graphics="${s.graphics||'blocks'}" data-dos-editing="${s.editing||'cells'}"`);};
  ide.menu=menu;ide.command=command;ide.transformRuntimeDocument=transform;
  const host=ide.browserWindows,originalDecorate=host?.decorate;
  const decorate=host?function(record){const cleanup=originalDecorate?.call(this,record);attach(record.doc);return ()=>{detach(record.doc);cleanup?.();};}:null;
  if(host)host.decorate=decorate;
  workspace.exportScreen=(format='json')=>{
    const renderer=sessions.get(document);if(!renderer||!workspace.enabled)throw new Error('Enable DOS mode before exporting a screen');
    const buffer=renderer.screen();
    if(format==='json')return download('DOS-screen.json',serializeScreen(buffer),'application/json',{document});
    if(format==='ansi')return download('DOS-screen.ans',serializeANSI(buffer),'text/plain;charset=utf-8',{document});
    if(format==='text')return download('DOS-screen.txt',buffer.toText(),'text/plain;charset=utf-8',{document});
    if(format==='b800')return download('DOS-screen.b800',serializeB800(buffer),'application/octet-stream',{document});
    throw new TypeError('Unknown DOS screen format');
  };
  workspace.snapshot=()=>[...sessions.values()].flatMap(renderer=>renderer.snapshot());
  workspace.dispose=()=>{if(workspace.disposed)return;workspace.disposed=true;revision++;disable();unregisterOptions();if(ide.menu===menu)ide.menu=originalMenu;if(ide.command===command)ide.command=originalCommand;if(ide.transformRuntimeDocument===transform)ide.transformRuntimeDocument=originalTransform;if(figma?.configure===configureFigma)figma.configure=originalFigmaConfigure;if(host?.decorate===decorate)host.decorate=originalDecorate;view.removeEventListener('pagehide',pagehide);};
  const pagehide=event=>{if(!event.persisted)workspace.dispose();};view.addEventListener('pagehide',pagehide);
  workspace.configure(workspace.settings,{persist:false}).catch(report);return workspace;
}
