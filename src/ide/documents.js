import {textChange} from '../editor/projection.js';
import {el,clone,lower} from '../core/core.js';
import {findModule} from '../project/model.js';
import {FormDesigner} from '../designer/designer.js';
import {SourceEditor} from '../editor/editor.js';
import {DEFAULT_EVENTS} from '../controls/controls.js';
import {MdiHost} from './mdi.js';
import {mapBookmarks} from '../editor/navigation.js';
import {icon,showMenu} from './ui.js';

/** Owns live MDI children. Inactive windows retain their editor selection, scroll and designer state. */
export class IdeDocuments {
  constructor(ide){this.ide=ide;this.tools=new Map();this.designers=new Map();this.editors=new Map();this.fallbackDesigner=new FormDesigner(el('div'));this.fallbackEditor=new SourceEditor(el('div'));ide.designer=this.fallbackDesigner;ide.editor=this.fallbackEditor;this.mdi=new MdiHost(ide.documentArea,{onActivate:key=>{const doc=ide.docs.find(d=>d.key===key);if(doc)this.activate(doc);},onClose:key=>ide.closeDocument(key),onChange:()=>ide.autosave()});}
  designer(module){let value=this.designers.get(module.id);if(value)return value;const pane=el('div',{class:'designer-pane'});value=new FormDesigner(pane);value.pane=pane;this.designers.set(module.id,value);const ide=this.ide;
    value.on('selection',()=>{if(ide.activeModule?.id!==module.id)return;ide.inspector.render();const items=value.selected();ide.propertyCaption.querySelector('strong').textContent='Properties - '+(items.length===1?items[0].name:items.length>1?'Multiple Controls':ide.activeModule?.name||'');});
    value.on('change',change=>{if(ide.runState!=='design')return;const before=clone(ide.project),target=findModule(before,module.id);if(!target)return;target.form=change.before;ide.record(before,change.label,false);this.editors.get(module.id)?.refreshObjects();ide.inspector.render();ide.updateLayoutMini();});
    value.on('tool',type=>{ide.toolboxGrid.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.controlType===type));ide.status(type==='Pointer'?'Ready':'Draw '+type+' on the form.');});
    value.on('backend',backend=>{if(ide.activeModule?.id===module.id)ide.statusBackend.textContent=backend;});value.on('position',p=>ide.statusPosition.textContent=p.x+', '+p.y);
    value.on('event',({control})=>ide.ensureEvent(control?.name||'Form',DEFAULT_EVENTS[control?.type||'Form']||'Click'));
    value.on('contextmenu',e=>showMenu(ide.designerMenu(),e.x,e.y,id=>ide.command(id)));
    return value;
  }
  editor(module){let value=this.editors.get(module.id);if(value)return value;const pane=el('div',{class:'code-pane'});value=new SourceEditor(pane);value.pane=pane;this.editors.set(module.id,value);const ide=this.ide;
    value.on('change',event=>{if(ide.runState!=='design'&&ide.runState!=='paused')return;if(ide.runState==='paused'){ide.pendingEdits=true;ide.editRevision=(ide.editRevision||0)+1;ide.status('Code changes pending - F5 applies changes and continues.');}const beforeMarks=event.module.bookmarks||[],change=event.change||textChange(event.oldText,event.newText);event.module.bookmarks=mapBookmarks(event.oldText,event.newText,beforeMarks);event.module.code=event.newText;
      const id=event.module.id,now=performance.now(),patch={start:change.start,before:event.oldText.slice(change.start,change.oldEnd),after:event.newText.slice(change.start,change.newEnd),beforeMarks,afterMarks:event.module.bookmarks};
      ide.history.recordPatch(id,patch,(project,patches,undo)=>{const target=findModule(project,id);if(!target)throw new Error('Undo module is missing.');for(const p of undo?[...patches].reverse():patches){const old=undo?p.after:p.before,next=undo?p.before:p.after;if(target.code.slice(p.start,p.start+old.length)!==old)throw new Error('The source changed outside the undo history.');target.code=target.code.slice(0,p.start)+next+target.code.slice(p.start+old.length);target.bookmarks=[...(undo?p.beforeMarks:p.afterMarks)];}return project;},'Edit '+event.module.name,event.kind==='typing'&&ide.lastTypingModule===id&&now-(ide.lastTyped||0)<700);
      ide.lastTyped=event.kind==='typing'?now:0;ide.lastTypingModule=event.kind==='typing'?id:null;ide.markDirty(true);});
    value.on('event',({object,event})=>{if(ide.runState!=='design'||value.readOnly)return;ide.openDocument(module.id,'code');ide.ensureEvent(object,event);});
    value.on('cursor',c=>{if(ide.activeModule?.id===module.id)ide.statusCursor.textContent='Ln '+c.line+', Col '+c.column;});value.on('breakpoint',bp=>ide.toggleBreakpoint(bp.module,bp.line));value.on('bookmark',bp=>ide.toggleBookmark(module.id,bp.line));value.on('object',name=>{if(name!=='(General)')ide.eventDialog(name);});return value;
  }
  ensure(doc){const ide=this.ide,module=findModule(ide.project,doc.id);if(!module)return null;let win=this.mdi.windows.get(doc.key);const editor=this.editor(module);const appearanceKey=JSON.stringify(ide.appearance);if(editor.appearanceKey!==appearanceKey){editor.setAppearance?.(ide.appearance);editor.appearanceKey=appearanceKey;}editor.showLineNumbers=!!ide.project.settings.lineNumbers;
    if(editor.module!==module||editor.text!==module.code)editor.setDocument(module,ide.project);else editor.refreshObjects();
    editor.setBreakpoints(ide.breakpoints);editor.setDiagnostics(ide.diagnostics);editor.setReadOnly(ide.runState==='running');
    let designer;if(module.form){designer=this.designer(module);if(designer.module!==module||designer.modelRevision!==ide.visualRevision){designer.setDocument(module,ide.project);designer.modelRevision=ide.visualRevision;}designer.root.inert=ide.runState!=='design';}
    if(!win){const width=doc.view==='form'?Math.min(760,Math.max(380,(Number(module.form?.properties.ClientWidth)||4800)/15+50)):660,height=doc.view==='form'?Math.min(610,Math.max(300,(Number(module.form?.properties.ClientHeight)||3600)/15+90)):440;win=this.mdi.add(doc.key,this.title(doc),doc.view==='form'?designer.pane:editor.pane,{width,height,glyph:doc.view==='form'?'form':'code'});}else win.label.textContent=this.title(doc);return win;
  }
  title(doc){const module=findModule(this.ide.project,doc.id);return `${this.ide.project.name} - ${module?.name||''} (${doc.view==='form'?'Form':'Code'})`;}
  activate(doc,{render=true}={}){const ide=this.ide,module=findModule(ide.project,doc.id);if(!module)return;ide.activeDoc=doc;const win=this.ensure(doc);if(!win)return;this.mdi.activate(doc.key,false);ide.editor=this.editor(module);ide.designer=module.form?this.designer(module):this.fallbackDesigner;ide.editor.input.dataset.activeEditor='true';for(const e of this.editors.values())if(e!==ide.editor)delete e.input.dataset.activeEditor;ide.designerPane=ide.designer.pane;ide.codePane=ide.editor.pane;ide.documentTitle=win.header;ide.documentLabel=win.label;ide.zoomSelect.value=String(ide.designer.zoom||1);if(render){this.tabs();ide.renderProjectTree();ide.inspector.render();ide.updateTitle();ide.updateLayoutMini();ide.updateCommandState();}this.markActiveChrome();}
  markActiveChrome(){for(const win of this.mdi.windows.values())win.node.classList.toggle('mdi-code',win.key.endsWith(':code'));}
  tabs(){const ide=this.ide;ide.documentTabs.replaceChildren(...ide.docs.filter(doc=>findModule(ide.project,doc.id)).map(doc=>el('button',{class:'document-tab'+(doc.key===ide.activeDoc?.key?' active':''),role:'tab','aria-selected':doc.key===ide.activeDoc?.key,'data-document':doc.key,onclick:e=>{if(e.target.closest('.tab-close'))ide.closeDocument(doc.key);else ide.openDocument(doc.id,doc.view);}},icon(doc.view==='form'?'form':'code'),findModule(ide.project,doc.id).name+(doc.view==='form'?' (Form)':' (Code)'),el('span',{class:'tab-close',title:'Close document'},icon('close',12)))));}
  sync(){const ide=this.ide,activeTool=this.tools.has(this.mdi.active)?this.mdi.active:null,keys=new Set([...ide.docs.map(d=>d.key),...this.tools.keys()]);for(const key of this.mdi.windows.keys())if(!keys.has(key))this.mdi.remove(key);for(const doc of ide.docs)this.ensure(doc);if(ide.activeDoc)this.activate(ide.activeDoc);else {this.tabs();ide.designer=this.fallbackDesigner;ide.editor=this.fallbackEditor;}for(const tool of this.tools.values())tool.refresh?.();if(activeTool)this.mdi.activate(activeTool,false);this.readOnly();}
  readOnly(){const ide=this.ide;for(const editor of this.editors.values())editor.setReadOnly(ide.runState==='running');for(const designer of this.designers.values())designer.root.inert=ide.runState!=='design';}
  openTool(tool){if(!this.tools.has(tool.key)){this.tools.set(tool.key,tool);this.mdi.add(tool.key,tool.title,tool.root,{width:tool.width,height:tool.height,glyph:tool.glyph});}const win=this.mdi.windows.get(tool.key);if(win.minimized)this.mdi.restore(tool.key);this.mdi.activate(tool.key);tool.refresh?.();this.ide.autosave();return tool;}
  closeTool(key){const tool=this.tools.get(key);if(!tool)return false;tool.dispose?.();this.tools.delete(key);this.mdi.remove(key);if(this.ide.activeDoc)this.activate(this.ide.activeDoc);this.ide.autosave();return true;}
  close(key){this.mdi.remove(key);}
  reset(){for(const tool of this.tools.values())tool.dispose?.();this.tools.clear();this.mdi.clear();for(const e of this.editors.values())e.dispose();for(const d of this.designers.values())d.dispose();this.editors.clear();this.designers.clear();this.ide.designer=this.fallbackDesigner;this.ide.editor=this.fallbackEditor;}
}
