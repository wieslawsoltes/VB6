import {attachExpressionAssistance} from './expression-assistance.js';
import {installReferenceIntelliSense} from './reference-intellisense.js';
import {hasUIDialog} from '../core/window-context.js';
import {CodeAssistance,SourceDragManager} from './assistance.js';
import {el} from '../core/core.js';
import {showMenu} from '../ide/ui.js';
import {positionAt,mapOffset} from './projection.js';

/** Editor commands and navigation share the IDE undo and active-document model. */
export function installEditorFeatures(ide){
  installReferenceIntelliSense(ide);
  ide.attachExpressionIntelliSense=input=>attachExpressionAssistance(input,ide);
  ide.definitionHistory=[];ide.sourceClipboard={text:''};ide.sourceDrag=new SourceDragManager(ide);
  const originalEditor=ide.documents.editor.bind(ide.documents);
  ide.documents.editor=module=>{const editor=originalEditor(module);if(editor.ideFeatures)return editor;editor.ideFeatures=true;editor.clipboardStore=ide.sourceClipboard;editor.assistance=new CodeAssistance(editor,ide,ide.sourceDrag);
    editor.on('definition',hit=>ide.navigateDefinition(hit));editor.on('last-position',()=>ide.lastDefinitionPosition());editor.on('status',text=>ide.status(text));
    editor.on('event',({object,event})=>ide.ensureEvent(object,event));
    editor.on('change',event=>{for(const item of ide.definitionHistory)if(item.id===module.id&&event.change)item.offset=mapOffset(event.change,item.offset);});
    editor.on('contextmenu',({x,y})=>showMenu([{label:'Cut',id:'cut',shortcut:'Ctrl+X',enabled:!editor.readOnly},{label:'Copy',id:'copy',shortcut:'Ctrl+C'},{label:'Paste',id:'paste',shortcut:'Ctrl+V',enabled:!editor.readOnly},null,{label:'List Members',id:'listMembers',shortcut:'Ctrl+J'},{label:'List Constants',id:'listConstants',shortcut:'Ctrl+Shift+J'},{label:'Quick Info',id:'quickInfo',shortcut:'Ctrl+I'},{label:'Parameter Info',id:'parameterInfo',shortcut:'Ctrl+Shift+I'},{label:'Complete Word',id:'completeWord',shortcut:'Ctrl+Space'},null,{label:'Definition',id:'goToDefinition',shortcut:'Shift+F2'},{label:'Last Position',id:'lastPosition',shortcut:'Ctrl+Shift+F2',enabled:!!ide.definitionHistory.length},null,{label:'Toggle Breakpoint',id:'breakpoint',shortcut:'F9'},{label:'Quick Watch…',id:'quickWatch',shortcut:'Shift+F9'},{label:'Add Watch…',id:'addWatch'},null,{label:'Comment Block',id:'comment'},{label:'Uncomment Block',id:'uncomment'},{label:'Indent',id:'indent',shortcut:'Ctrl+M'},{label:'Outdent',id:'outdent',shortcut:'Ctrl+Shift+M'}],x,y,id=>ide.command(id)));
    return editor;
  };
  ide.navigateDefinition=hit=>{if(!hit?.moduleId){ide.editor.showInfo('quick');ide.status(hit?'This definition belongs to a built-in browser adapter.':'Definition not found in the project.');return;}
    if(ide.activeModule)ide.definitionHistory.push({id:ide.activeModule.id,offset:ide.editor.cursor().offset});if(ide.definitionHistory.length>100)ide.definitionHistory.shift();ide.openDocument(hit.moduleId,'code',hit.line||1);ide.editor.input.focus();};
  ide.lastDefinitionPosition=()=>{const location=ide.definitionHistory.pop();if(!location)return;ide.openDocument(location.id,'code');const pos=positionAt(ide.editor.index,location.offset);ide.editor.goToLine(pos.line,pos.column);};
  const update=ide.updateCommandState.bind(ide);ide.updateCommandState=()=>{update();for(const editor of ide.documents.editors.values())if(ide.runState!=='paused'||!ide.appearance.autoDataTips)editor.assistance?.hide();};
  const baseCommand=ide.command.bind(ide);
  const commands={listMembers:()=>ide.editor.complete(),listConstants:()=>ide.editor.complete('constants'),quickInfo:()=>ide.editor.showInfo('quick'),parameterInfo:()=>ide.editor.showInfo('parameter'),completeWord:()=>ide.editor.completeWord(),goToDefinition:()=>ide.navigateDefinition(ide.editor.definition()),lastPosition:()=>ide.lastDefinitionPosition(),indent:()=>ide.editor.indentBlock(),outdent:()=>ide.editor.indentBlock(true)};
  ide.command=async id=>{if(commands[id]){if(ide.activeModule){if(ide.activeDoc.view!=='code')ide.openDocument(ide.activeModule.id,'code');commands[id]();}return;}return baseCommand(id);};
  const baseMenu=ide.menu.bind(ide);
  ide.menu=name=>{const items=baseMenu(name);if(name==='Edit'){
    for(const item of items){if(item?.id==='nextBookmark'||item?.id==='previousBookmark')delete item.shortcut;if(item?.items)for(const child of item.items)if(child?.id==='nextBookmark'||child?.id==='previousBookmark')delete child.shortcut;}
    items.push(null,{label:'List Members',id:'listMembers',shortcut:'Ctrl+J'},{label:'List Constants',id:'listConstants',shortcut:'Ctrl+Shift+J'},{label:'Quick Info',id:'quickInfo',shortcut:'Ctrl+I'},{label:'Parameter Info',id:'parameterInfo',shortcut:'Ctrl+Shift+I'},{label:'Complete Word',id:'completeWord',shortcut:'Ctrl+Space'},null,{label:'Indent',id:'indent',shortcut:'Ctrl+M'},{label:'Outdent',id:'outdent',shortcut:'Ctrl+Shift+M'});
  }if(name==='View')items.splice(3,0,{label:'Definition',id:'goToDefinition',shortcut:'Shift+F2'},{label:'Last Position',id:'lastPosition',shortcut:'Ctrl+Shift+F2',enabled:!!ide.definitionHistory.length});return items;};
  const baseKey=ide.keydown.bind(ide);ide.keydown=e=>{if(!e.defaultPrevented&&!hasUIDialog()&&e.key==='F2'&&e.shiftKey){if(e.altKey&&(e.ctrlKey||e.metaKey)){e.preventDefault();ide.nextBookmark(-1);return;}e.preventDefault();ide.command(e.ctrlKey||e.metaKey?'lastPosition':'goToDefinition');return;}if(!e.defaultPrevented&&e.key==='F2'&&e.altKey&&(e.ctrlKey||e.metaKey)){e.preventDefault();ide.nextBookmark(1);return;}return baseKey(e);};
}
