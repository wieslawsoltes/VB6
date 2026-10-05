import {clone} from '../core/core.js';
import {normalizeProject, createControl} from '../project/model.js';
import {normalizeAppearance} from '../theme/theme.js';
import {snapshotEditorView, restoreEditorView} from '../editor/view-state.js';
import {COMMANDS, CommandBarLayout} from '../ide/command-bar-model.js';
import {normalizeWindowProfile} from '../ide/window-profile.js';
import {McpError, checkAbort, awaitAbort} from './protocol.js';
import {moduleOf, formOf, nodeOf, CONTROL_TYPES, fail} from './agent-project.js';
import {S, TEXT, B, N, E, A, O, OBJ, REV} from './agent-schema.js';
import {CONTROL_EVENTS, DEFAULT_EVENTS} from '../controls/controls.js';
import {buildObjectCatalog, searchCatalog} from '../ide/object-catalog.js';

const SAFE_COMMANDS = Object.freeze(['viewCode','viewForm','projectExplorer','properties','objectBrowser','immediate','locals','watch','callStack','errors','output','breakpoints','toolbox','formLayout','toggleFolders','findProject','replaceProject','colorPalette','resourceEditor','cascade','tileHorizontal','tileVertical','closeAll','resetLayout','showRuntime']);
const COMMAND_ROUTES = Object.freeze({
  renameModule:'vb6.module.rename',removeModule:'vb6.module.remove',defaultEvent:'vb6.procedure.event',addMDIForm:'vb6.module.add / vb6.form.update',virtualFiles:'vb6.files.list',closeProject:'vb6.project.new',findNext:'vb6.workspace.search / vb6.editor.set',clearBookmarks:'vb6.bookmarks.set',goTo:'vb6.document.open',formatCode:'vb6.code.transform',renameSymbol:'vb6.code.transform',snapToGrid:'vb6.project.update',conditionalBreakpoint:'vb6.breakpoints.set',startWithBreak:'vb6.runtime.start',applyEdits:'vb6.debug.applyEdits',setNextStatement:'vb6.debug.setNextStatement',evaluateExpression:'vb6.debug.evaluate',cancelEvaluation:'vb6.debug.cancelEvaluation',tile:'vb6.windows.set',saveWindowLayout:'vb6.workspace.saveLayout',windowLayoutManager:'vb6.workspace.layouts',restoreWindowLayout:'vb6.workspace.layout',resourceEditor:'vb6.resources.list',

  exportWin32:'vb6.build.create',saveNative:'vb6.build.create',saveNativeFolder:'vb6.build.create',saveWebProject:'vb6.build.create',nativeSettings:'vb6.project.update',nativeGroup:'vb6.project.group / vb6.project.select / vb6.project.startup',
  new:'vb6.project.new',open:'vb6.project.import',openFolder:'vb6.project.import',addFiles:'vb6.project.import',save:'vb6.project.export',saveAs:'vb6.project.update',saveModule:'vb6.project.files',exportHTML:'vb6.project.export',exportSources:'vb6.project.archive',
  undo:'vb6.history.apply',redo:'vb6.history.apply',cut:'vb6.editor.edit',copy:'vb6.editor.get',paste:'vb6.editor.edit',delete:'vb6.editor.edit',selectAll:'vb6.editor.set',find:'vb6.workspace.search',replace:'vb6.code.edit',indent:'vb6.editor.edit',outdent:'vb6.editor.edit',comment:'vb6.editor.edit',uncomment:'vb6.editor.edit',
  toggleBookmark:'vb6.bookmarks.set',nextBookmark:'vb6.editor.set',previousBookmark:'vb6.editor.set',goToDefinition:'vb6.code.complete',lastPosition:'vb6.editor.set',listMembers:'vb6.code.complete',listConstants:'vb6.code.complete',quickInfo:'vb6.code.complete',parameterInfo:'vb6.code.complete',completeWord:'vb6.code.complete',
  run:'vb6.runtime.start / vb6.debug.command',pause:'vb6.debug.command',stop:'vb6.runtime.stop',stepInto:'vb6.debug.command',stepOver:'vb6.debug.command',stepOut:'vb6.debug.command',runToCursor:'vb6.debug.runToCursor',showNextStatement:'vb6.debug.snapshot / vb6.document.open',breakpoint:'vb6.breakpoints.set',clearBreakpoints:'vb6.breakpoints.set',addWatch:'vb6.watches.set',quickWatch:'vb6.debug.inspect',checkSyntax:'vb6.project.compile',
  showGrid:'vb6.project.update',lockControls:'vb6.designer.set',menuEditor:'vb6.menu.edit',tabOrder:'vb6.control.edit',printCode:'vb6.module.read',addProcedure:'vb6.procedure.add',procedureAttributes:'vb6.procedure.attributes',addForm:'vb6.module.add',addModule:'vb6.module.add',addClass:'vb6.module.add',components:'vb6.designer.catalog',references:'vb6.references.set',projectProperties:'vb6.project.update',options:'vb6.workspace.configure',help:'vb6.agent.capabilities',customizeToolbars:'vb6.toolbars.set'
});
const EDIT_COMMANDS=['insert','delete','indent','outdent','comment','uncomment','format'];

export function installWorkbenchTools(ide,adapter,{add,output,consent,commit,changed,debugSnapshot,page,resource}) {
  const requireAPI=(object,key)=>{if(typeof object?.[key]!=='function')throw new McpError(-32601,'This host does not implement '+key+'.');return object[key].bind(object);};
  const mutate=(name,description,props,required,fn,{design=false,destructive=false,open=false}={})=>add(name,description,{...props,expectedRevision:REV},[...required,'expectedRevision'],async(args,ctx)=>{
    await consent('vb6.'+name,args,ctx,{design});checkAbort(ctx.signal);if(args.expectedRevision!==adapter.revision)throw new McpError(-32002,'Project changed before mutation.',{actualRevision:adapter.revision});changed();const result=await fn(args,ctx);return output(result??{});
  },{write:true,destructive,open});
  const documents=()=>({windows:ide.documents?.mdi.snapshot()||[],active:ide.activeDoc?.key||null,documents:clone(ide.docs||[]),tools:[...(ide.documents?.tools?.keys()||[])].filter(k=>k!=='tool:mcp')});
  function editorFor(module,open=false) {const m=moduleOf(ide.project,module);if(open)ide.openDocument(m.id,'code');const e=ide.documents?.editors?.get(m.id);if(!e)fail('Open the code document first.');return e;}
  const editorState=module=>{const e=editorFor(module);return output({module:e.module.name,selection:e.selectionBounds(),cursor:e.cursor(),view:snapshotEditorView(e),readOnly:!!e.readOnly,selectedText:e.text.slice(e.selectionBounds().start,Math.min(e.selectionBounds().end,e.selectionBounds().start+100000)),selectionTruncated:e.selectionBounds().end-e.selectionBounds().start>100000});};
  const debuggerState=()=>({...debugSnapshot(),pauseId:ide.debuggerWindows?.pauseId||0,frameIndex:ide.debuggerWindows?.frameIndex??null,pendingEdits:!!ide.pendingEdits,evaluating:!!ide.evaluating,execution:clone(ide.debuggerWindows?.execution||null)});
  function pause(args) {
    if(ide.runState!=='paused')throw new McpError(-32000,'Pause the application first.');
    if(args.pauseId!==ide.debuggerWindows?.pauseId)throw new McpError(-32002,'Stale pauseId. Read debug.snapshot again.');
    if(args.frameIndex!==undefined&&!ide.stack?.some((f,i)=>(f.index??i)===args.frameIndex))fail('Unknown stack frame.');
  }
  async function runtime(command,args,ctx) {
    const frame=ide.runtimeFrame;if(!frame)throw new McpError(-32000,'No running application.');
    const result=await awaitAbort(requireAPI(ide,'requestRuntime')(command,{...args,agentGuard:{state:ide.runState,pauseId:ide.debuggerWindows?.pauseId}}),ctx.signal);
    checkAbort(ctx.signal);adapter.assertEnabled();if(frame!==ide.runtimeFrame)throw new McpError(-32002,'Runtime was replaced while the operation was pending.');return result;
  }
  add('objects.catalog','Query Object Browser declarations, library signatures and authored control properties without executing code.',{query:S,library:S,showPrivate:B,offset:N(),limit:N(1,1000)},[],args=>output(page(searchCatalog(buildObjectCatalog(ide.project),args.query||'',args.library||'*',args.showPrivate!==false),args)));
  add('documents.list','List open code/designer documents and modeless tools, without MCP secrets.',{},[],()=>output(documents()));
  mutate('documents.close','Close one code/designer document or a non-security modeless tool. Source stays in the project.',{key:S},['key'],args=>{if(args.key==='tool:mcp')fail('The MCP permission window is local-only.');if(!(ide.docs||[]).some(d=>d.key===args.key)&&!ide.documents?.tools.has(args.key))fail('Unknown document.');ide.closeDocument(args.key);return documents();});
  mutate('documents.set','Activate, minimize, maximize, restore or position an existing document/modeless tool. MCP security tooling is excluded and no OS popup is created.',{key:S,action:E(['activate','minimize','maximize','restore','bounds']),bounds:O({x:N(),y:N(),width:N(120,100000),height:N(80,100000)},['x','y','width','height'])},['key','action'],args=>{
    if(args.key==='tool:mcp')fail('MCP security tooling is local-only.');const mdi=ide.documents.mdi,win=mdi.windows.get(args.key);if(!win)fail('Unknown window.');
    if(ide.browserWindows?.has('document:'+args.key))fail('Return this browser window to the IDE before setting in-page bounds.');
    if(args.action==='bounds'){if(!args.bounds)fail('Supply bounds.');mdi.restoreSnapshot([{key:args.key,rect:args.bounds}]);}
    else if(args.action==='maximize'){if(!win.maximized)mdi.maximize(args.key);}
    else if(args.action==='minimize'){if(!win.minimized)mdi.minimize(args.key);}
    else mdi[args.action](args.key);ide.autosave();return documents();
  });
  add('project.explorer','Read the active project node, expanded module folders and toolbox category.',{},[],()=>output({activeModule:ide.activeModule?.name||null,expandedFolders:[...(ide.expandedFolders||[])],showFolders:!ide.noFolders,toolboxMode:ide.toolboxMode||'basic'}));
  mutate('project.explorerSet','Control project explorer folders and toolbox categories without changing project code.',{expandedFolders:A(E(['form','module','class']),3),showFolders:B,toolboxMode:E(['basic','extended','all'])},[],args=>{
    if(args.expandedFolders)ide.expandedFolders=new Set(args.expandedFolders);if(args.showFolders!==undefined)ide.noFolders=!args.showFolders;if(args.toolboxMode)ide.toolboxMode=args.toolboxMode;ide.renderProjectTree();ide.renderToolbox();ide.autosave();return {};
  });
  add('editor.get','Read cursor, full-source selection and split/procedure-view metadata for an open module.',{module:S},['module'],args=>editorState(args.module));
  mutate('editor.set','Open a module and set its selection, split panes, procedure/full-module view and scroll metadata using UTF-16 offsets.',{module:S,start:N(0,5000000),end:N(0,5000000),view:OBJ},['module'],args=>{
    const m=moduleOf(ide.project,args.module);if((args.start??0)>m.code.length||(args.end??args.start??0)>m.code.length||(args.end??args.start??0)<(args.start??0))fail('Selection outside source.');
    const e=editorFor(args.module,true);
    if(args.view)restoreEditorView(e,args.view);
    if(args.start!==undefined){const state=snapshotEditorView(e);Object.assign(state.panes[state.active],{start:args.start,end:args.end??args.start});restoreEditorView(e,state);}
    e.input.focus();ide.autosave?.();return editorState(args.module);
  });
  mutate('editor.edit','Edit the selected module with explicit text or block operations. No host clipboard access; text must be supplied. Paused changes remain staged.',{module:S,command:E(EDIT_COMMANDS),text:TEXT,start:N(0,5000000),end:N(0,5000000)},['module','command'],args=>{
    if(ide.runState==='running')throw new McpError(-32000,'Pause or stop before editing.');
    const m=moduleOf(ide.project,args.module);if((args.start??0)>m.code.length||(args.end??args.start??0)>m.code.length||(args.end??args.start??0)<(args.start??0))fail('Selection outside source.');
    const e=editorFor(args.module,true);
    if(args.start!==undefined){const state=snapshotEditorView(e);Object.assign(state.panes[state.active],{start:args.start,end:args.end??args.start});restoreEditorView(e,state);}
    e.input.focus();
    if(args.command==='insert'){if(args.text===undefined)fail('Insertion requires text.');e.replaceSelection(args.text);}
    else if(args.command==='delete')e.replaceSelection('');
    else if(args.command==='indent'||args.command==='outdent')e.indentBlock(args.command==='outdent');
    else e.edit(args.command);
    return editorState(args.module);
  });
  add('history.get','Read undo/redo labels and counts without embedding project snapshots.',{},[],()=>output({undo:(ide.history?.undoStack||[]).map(e=>e.label),redo:(ide.history?.redoStack||[]).map(e=>e.label)}));
  mutate('history.apply','Undo or redo one project edit, using the IDE’s existing history.',{direction:E(['undo','redo'])},['direction'],async args=>{await ide.command(args.direction);return adapter.snapshot();},{design:true});
  add('designer.catalog','Read every supported control type and property defaults from the current project models.',{},[],()=>output({types:CONTROL_TYPES,controls:CONTROL_TYPES.map(type=>({type,defaults:createControl(type).properties,defaultEvent:DEFAULT_EVENTS[type]||'Click'})),events:CONTROL_EVENTS,units:'twips',note:'Native OCX declarations are preserved; loading native COM binaries is not implemented by the browser runtime.'}));
  add('designer.get','Read selected control IDs, zoom/tool/lock/tab-order state and the full form model.',{module:S},['module'],args=>{const m=moduleOf(ide.project,args.module),d=ide.documents?.designers.get(m.id);return output({form:clone(formOf(ide.project,args.module)),selection:[...(d?.selection||[])],zoom:d?.zoom??1,tool:d?.tool||'Pointer',locked:!!d?.locked,tabOrder:!!d?.showTabOrder});});
  mutate('designer.set','Set the active form, selected control IDs, drawing tool, zoom, lock and tab-order mode.',{module:S,ids:A(S),zoom:{type:'number',minimum:.25,maximum:4},tool:E(['Pointer',...CONTROL_TYPES]),locked:B,tabOrder:B},['module'],args=>{
    const m=moduleOf(ide.project,args.module),f=formOf(ide.project,args.module);for(const id of args.ids||[])if(nodeOf(f,id)===f)fail('Selection accepts controls only.');
    ide.openDocument(m.id,'form');const d=ide.designer;
    if(args.ids)d.select(args.ids.map(id=>nodeOf(f,id).id));if(args.zoom!==undefined)d.setZoom(args.zoom);if(args.tool!==undefined)d.setTool(args.tool);if(args.locked!==undefined)d.locked=args.locked;if(args.tabOrder!==undefined){d.showTabOrder=args.tabOrder;d.tabOrderIndex=0;}d.renderSelection();return {module:m.name,selection:[...d.selection]};
  },{design:true});
  mutate('designer.align','Align, size, distribute, snap or reorder selected controls using existing designer geometry.',{module:S,ids:A(S),command:E(['left','right','top','bottom','centerHorizontal','centerVertical','sameWidth','sameHeight','sameSize','distributeHorizontal','distributeVertical','front','back','snap','centerInForm'])},['module','ids','command'],args=>{
    const m=moduleOf(ide.project,args.module),f=formOf(ide.project,args.module),nodes=args.ids.map(id=>nodeOf(f,id));if(nodes.includes(f)||!nodes.length)fail('Choose controls.');
    if(nodes.some(n=>(n.parent||'')!==(nodes[0].parent||'')))fail('Select controls in one container.');
    ide.openDocument(m.id,'form');if(ide.designer.locked)fail('Designer is locked.');ide.designer.select(nodes.map(n=>n.id));ide.designer.align(args.command);return {form:clone(formOf(ide.project,args.module))};
  },{design:true});
  add('workspace.get','Read appearance, document/window geometry, dock layout, toolbar state and named layout names. Excludes MCP UI and credentials.',{},[],()=>output({appearance:clone(ide.appearance||{}),documents:documents(),layout:ide.captureWindowLayout?.()||null,namedLayouts:Object.keys(ide.namedLayouts||{})}));
  mutate('workspace.configure','Set recognized IDE appearance and editor options. Unknown options are rejected; MCP permissions are never configurable here.',{appearance:OBJ},['appearance'],args=>{
    const allowed=new Set([...Object.keys(normalizeAppearance()),'codeColors']);for(const key of Object.keys(args.appearance))if(!allowed.has(key))fail('Unknown appearance option: '+key);
    if(args.appearance.windowMode!==undefined&&!['mdi','hybrid'].includes(args.appearance.windowMode))fail('Supported window modes are mdi and hybrid.');
    ide.appearance=normalizeAppearance({...ide.appearance,...args.appearance});requireAPI(ide,'applyAppearance')();return {appearance:clone(ide.appearance)};
  });
  mutate('workspace.layout','Restore a fully validated layout, including docking, toolbars and editor views. Browser-window restoration remains gesture-controlled.',{layout:OBJ},['layout'],args=>{const p=normalizeWindowProfile(args.layout,ide.docking.model.windows.keys());return {layout:requireAPI(ide,'applyWindowLayout')(p)};});
  add('workspace.layouts','Read named layout descriptors.',{},[],()=>output({layouts:clone(ide.namedLayouts||{})}));
  mutate('workspace.saveLayout','Save/replace the current layout under a bounded name.',{name:{type:'string',minLength:1,maxLength:64}},['name'],args=>{
    if(!args.name.trim())fail('Name cannot be blank.');if(!Object.hasOwn(ide.namedLayouts,args.name)&&Object.keys(ide.namedLayouts).length>=20)fail('At most 20 layouts.');
    Object.defineProperty(ide.namedLayouts,args.name,{value:ide.captureWindowLayout(),enumerable:true,configurable:true,writable:true});ide.autosave();return {name:args.name};
  });
  mutate('workspace.deleteLayout','Delete one named layout.',{name:S},['name'],args=>{if(!Object.hasOwn(ide.namedLayouts,args.name))fail('Unknown layout.');delete ide.namedLayouts[args.name];ide.autosave();return {deleted:args.name};},{destructive:true});
  mutate('windows.set','Show/hide/activate/dock/float a registered IDE tool group, return detached windows, or arrange MDI documents. Does not open browser popups.',{action:E(['show','hide','activate','dock','float','dockable','returnAll','arrange']),id:S,value:B,edge:E(['left','right','top','bottom']),target:S,arrangement:E(['cascade','horizontal','vertical'])},['action'],args=>{
    if(args.action==='returnAll'){ide.browserWindows?.attachAll('mcp');return {};}
    if(args.action==='arrange'){ide.documents.mdi.arrange(args.arrangement||'cascade');return {};}
    if(!ide.docking?.model.windows.has(args.id))fail('Unknown dock window ID.');
    if(args.action==='dockable'){ide.docking.model.setDockable(args.id,args.value!==false);ide.docking.render();ide.docking.changed();}
    else if(args.action==='dock'){if(args.target&&!ide.docking.model.groups.has(args.target))fail('Unknown target group.');if(!ide.docking.dock(args.id,args.edge||'right',args.target||null))fail('This window cannot be docked; enable dockable first.');}
    else if(args.action==='float')ide.docking.float(args.id);
    else if(args.action==='activate')ide.docking.activate(args.id);
    else ide.docking.show(args.id,args.action==='show');
    return {docking:ide.docking.snapshot()};
  });
  add('toolbars.get','Read toolbar descriptors and the complete public command catalog.',{},[],()=>output({layout:ide.commandBars?.snapshot()||null,commands:COMMANDS}));
  mutate('toolbars.set','Replace the complete toolbar layout. Validates command IDs, bounds and custom bar names before changing the UI.',{layout:OBJ},['layout'],args=>{const model=new CommandBarLayout();model.restore(args.layout);ide.commandBars.restore(model.snapshot());return {layout:ide.commandBars.snapshot()};});
  function menus() {
    const result=[];let visited=0;
    const walk=(items,path,depth)=>{if(depth>8)return;for(const item of items||[]){if(!item||++visited>500)continue;const location=[...path,String(item.label||'')];if(item.id){const id=item.id,tool=SAFE_COMMANDS.includes(id)?'vb6.commands.execute':id.startsWith('align:')?'vb6.designer.align':id.startsWith('format:')?'vb6.designer.format':COMMAND_ROUTES[id]||null;result.push({path:location,id,enabled:item.enabled!==false,checked:item.checked===true,tool,localOnly:!tool});}try{if(item.items)walk(typeof item.items==='function'?item.items():item.items,location,depth+1);}catch{}}};
    for(const name of ['File','Edit','View','Project','Format','Debug','Run','Tools','Window','Help'])walk(ide.menu?.(name)||[],[name],0);return result;
  }
  add('commands.list','Map every catalog command to its structured MCP replacement or direct UI command. Native/security UI actions cannot be blindly clicked by agents.',{},[],()=>output({menus:menus(),commands:COMMANDS.map(c=>({...c,direct:SAFE_COMMANDS.includes(c.id),tool:SAFE_COMMANDS.includes(c.id)?'vb6.commands.execute':c.id.startsWith('align:')?'vb6.designer.align':COMMAND_ROUTES[c.id]||null})),directCommands:SAFE_COMMANDS,localOnly:['MCP sharing, consent, credentials and delegated permissions','Host filesystem chooser, OS clipboard, print and full screen','Opening a new detached browser window (user gesture)']}));
  mutate('commands.execute','Execute a supported non-modal UI command from commands.list. Does not expose arbitrary command names or security dialogs.',{command:E(SAFE_COMMANDS)},['command'],async args=>{await ide.command(args.command);return documents();});
  // Upgrade the existing snapshot without breaking its name or legacy callers.
  const oldSnapshot=adapter.tools.find(t=>t.name==='vb6.debug.snapshot');if(oldSnapshot)oldSnapshot.execute=async()=>{adapter.assertEnabled();return debuggerState();};
  add('debug.frames','Read stack frames, selected frame and pause identity without evaluating source.',{},[],()=>output({pauseId:ide.debuggerWindows?.pauseId||0,frameIndex:ide.debuggerWindows?.frameIndex??null,frames:clone(ide.stack||[])}));
  const frameProps={pauseId:REV,frameIndex:N(0,10000)};
  add('debug.inspect','Inspect stored locals, fields, records or array children without invoking user functions/getters. Requires current pause identity; results are paginated.',{...frameProps,expression:{type:'string',minLength:1,maxLength:4096},offset:N(),limit:N(1,1000)},['pauseId','expression'],async(args,ctx)=>{
    pause(args);const result=await runtime('debugInspect',args,ctx);pause(args);return output({result});
  });
  add('debug.locals','Read typed local storage for one stack frame; no user code is executed.',frameProps,['pauseId'],async(args,ctx)=>{pause(args);const result=await runtime('debugLocals',args,ctx);pause(args);return output(result);});
  mutate('debug.selectFrame','Select a valid paused stack frame, updating the Locals and Watch tools and source navigation.',frameProps,['pauseId','frameIndex'],async(args,ctx)=>{pause(args);await requireAPI(ide.debuggerWindows,'selectFrame')(args.frameIndex);checkAbort(ctx.signal);pause(args);return debuggerState();});
  mutate('debug.assign','Assign a typed literal into paused local/field/array storage. Does not evaluate arbitrary JavaScript.',{...frameProps,expression:{type:'string',maxLength:4096},value:{type:'string',maxLength:10000}},['pauseId','expression','value'],async(args,ctx)=>{pause(args);const result=await runtime('debugAssign',args,ctx);ide.locals=result.locals||ide.locals;ide.updateWatches?.();ide.renderDebug?.();return {result};},{open:true});
  for(const name of ['runToCursor','setNextStatement'])mutate('debug.'+name,name==='runToCursor'?'Resume until a selected executable source line. Uses the current runtime code; apply pending edits explicitly first.':'Move the paused instruction pointer within the existing VM’s supported safe regions.',{...frameProps,module:S,line:N(1,5000000)},['pauseId','module','line'],async(args,ctx)=>{pause(args);moduleOf(ide.project,args.module);if(ide.pendingEdits)fail('Apply pending source edits before changing execution position.');return {result:await runtime(name,args,ctx)};},{open:true});
  mutate('debug.applyEdits','Apply staged source edits to the paused VM. Unsafe topology/signature changes are rejected by the existing live-edit engine.',{pauseId:REV},['pauseId'],async(args,ctx)=>{pause(args);return {result:await awaitAbort(requireAPI(ide,'applyCodeChanges')(),ctx.signal)||null,pendingEdits:!!ide.pendingEdits};},{open:true});
  mutate('debug.immediate','Execute a VB Immediate statement in the paused frame. May mutate state or execute VB code; cancellation and the VM evaluation budget still apply.',{...frameProps,text:{type:'string',minLength:1,maxLength:10000}},['pauseId','text'],async(args,ctx)=>{
    pause(args);const cancel=()=>ide.sendRuntime('cancelEvaluation');ctx.signal?.addEventListener('abort',cancel,{once:true});
    try {const result=await runtime('agentImmediate',args,ctx);ide.locals=result.locals;ide.updateWatches?.();ide.renderDebug?.();return {result};}
    finally {ctx.signal?.removeEventListener('abort',cancel);}
  },{open:true});
  // Cancellation is deliberately outside the revision/approval queue: it stops work, never grants authority.
  add('debug.cancelEvaluation','Cancel an in-flight explicit evaluation. No approval queue or revision dependency; effects already committed are retained.',{},[],async(args,ctx)=>output({result:await runtime('cancelEvaluation',{},ctx)}),{write:true});
  add('watches.get','Read expressions, breakpoint watch definitions and evaluated values.',{},[],()=>output({definitions:ide.debuggerWindows?.snapshot()||[],expressions:clone(ide.watches||[]),values:clone(ide.watchValues||[])}));
  mutate('watches.set','Replace watch expressions and expression/change/true modes, optionally scoped to a module/procedure. Automatic watches do not execute project code.',{watches:A(O({expression:{type:'string',minLength:1,maxLength:4096},mode:E(['expression','change','true']),module:S,procedure:S},['expression']),100)},['watches'],args=>{
    if(new Set(args.watches.map(w=>w.expression)).size!==args.watches.length)fail('Duplicate watch expressions.');for(const w of args.watches)if(w.module)moduleOf(ide.project,w.module);
    ide.watches=args.watches.map(w=>w.expression);ide.debuggerWindows.restore(args.watches.map((w,i)=>({...w,id:'agent-watch-'+i,mode:w.mode||'expression'})));ide.updateWatches();ide.autosave();return {definitions:ide.debuggerWindows.snapshot()};
  });
  add('output.read','Read bounded output, Immediate or diagnostics entries with offset/limit.',{kind:E(['output','immediate','diagnostics']),offset:N(),limit:N(1,1000)},[],args=>output(page(clone(args.kind==='immediate'?ide.immediateOutput||[]:args.kind==='diagnostics'?ide.diagnostics||[]:ide.output||[]),args)));
  mutate('output.clear','Clear Output and/or Immediate display, not files or source.',{kind:E(['output','immediate','both'])},['kind'],args=>{if(args.kind!=='immediate')ide.output=[];if(args.kind!=='output')ide.immediateOutput=[];ide.renderDebug();return {};});
  add('runtime.inspect','Inspect live form instances, their controls, observable properties and runtime dialogs using opaque IDs. Only the sandboxed application is inspected.',{offset:N(),limit:N(1,200)},[],async(args,ctx)=>output({runtime:await runtime('agentInspect',args,ctx)}));
  mutate('runtime.interact','Interact with a running form/control or application dialog using IDs returned by runtime.inspect: click, focus, set a property, call an allowlisted control method, indexedGet/indexedSet, event, menu command or dialog reply. It cannot touch IDE/MCP dialogs.',{target:S,action:E(['click','focus','set','event','dialog','menu','call','indexedGet','indexedSet']),method:S,property:S,value:{},event:S,arguments:A({},16),button:N(0,20)},['target','action'],async(args,ctx)=>({result:await runtime('agentInteract',args,ctx)}),{open:true});
  add('runtime.snapshot','Read the running application’s isolated virtual disk and VB settings, without changing the project.',{},[],async(args,ctx)=>output({snapshot:await runtime('agentSnapshot',{},ctx)}));
  mutate('runtime.capture','Copy the running application’s virtual disk/settings into the project with undo. Does not read host files.',{},[],async(args,ctx)=>{const expected=adapter.revision,result=await runtime('agentSnapshot',{},ctx);if(expected!==adapter.revision)throw new McpError(-32002,'Project changed during capture.');const next=clone(ide.project);next.vfs=result.vfs;next.appSettings=result.settings;return commit(normalizeProject(next),'MCP: capture runtime files');});
  resource('vb6://workspace','IDE workspace',()=>output({documents:documents(),layout:ide.captureWindowLayout?.()||null,appearance:clone(ide.appearance||{})}));
  resource('vb6://watches','Debugger watches',()=>output({definitions:ide.debuggerWindows?.snapshot()||[],values:clone(ide.watchValues||[])}));
  resource('vb6://history','Undo/redo history',()=>output({undo:(ide.history?.undoStack||[]).map(e=>e.label),redo:(ide.history?.redoStack||[]).map(e=>e.label)}));
}
