import {installDataTools} from './agent-data.js';
import {installBuildTools} from './agent-build.js';
import {mergedProject} from '../project/import-merge.js';
import {normalizedEntries, listProjectEntries} from '../project/native-project.js';
import {NATIVE_ENCODINGS} from '../project/native-text.js';
import {clone} from '../core/core.js';
import {newProject, normalizeProject} from '../project/model.js';
import {importFiles, sourceFiles} from '../project/formats.js';
import {readZip, writeZip} from '../project/zip.js';
import {toBase64, fromBase64, cleanProjectPath} from '../project/frx.js';
import {resourceKey, listResourceStrings, writeRES} from '../project/res.js';
import {EditorIntelligence, scanDeclarations} from '../editor/intelligence.js';
import {readProcedureAttributes} from '../ide/procedure-tools.js';
import {VirtualFileSystem} from '../runtime/filesystem.js';
import {McpError, checkAbort, awaitAbort, validateArguments} from './protocol.js';
import {AGENT_SCOPES, agentScope} from './agent-permissions.js';
import {editProject, sourceEdits, moduleOf, formOf, nodeOf, filePath, decodeFile, identifier, CONTROL_TYPES, fail} from './agent-project.js';
import {installWorkbenchTools} from './agent-workbench.js';

import {S, TEXT, B, N, E, A, O, OBJ, REV} from './agent-schema.js';

/** Full structured workbench surface. No arbitrary method names, DOM selectors or JavaScript evaluation. */
export function installAgentTools(ide, adapter, {tool, consent, commit, changed, checkRevision, debugSnapshot}) {
  const intelligence = new EditorIntelligence();
  const output = value=>({revision:adapter.revision,eventSequence:adapter.eventSequence,...value});
  const extraResources = new Map();
  const page = (items,args={})=>({items:items.slice(args.offset||0,(args.offset||0)+(args.limit||100)),total:items.length,offset:args.offset||0,hasMore:(args.offset||0)+(args.limit||100)<items.length});
  const add = (name, description, properties, required, execute, options={})=>{
    const full='vb6.'+name;
    tool(full,description,properties,required,execute,options);
    // Embedders invoking a descriptor directly get exactly the same validation as JSON-RPC.
    const def=adapter.tools.at(-1), run=def.execute;
    def.execute=(args,ctx={})=>{validateArguments(args,def.inputSchema);return run(args,ctx);};
  };
  const mutate = (name, description, properties, required=[], {design=true,destructive=false}={})=>add(name,description,{...properties,expectedRevision:REV},[...required,'expectedRevision'],async(args,ctx)=>{
    if (!design && !['design','paused'].includes(ide.runState)) throw new McpError(-32000,'Pause or stop before changing source.');
    const oldModuleName=name==='module.rename'?moduleOf(ide.project,args.module).name:null;
    const candidate=editProject(ide.project,name,args); // Validate before asking for authority.
    await consent('vb6.'+name,args,ctx,{design}); checkAbort(ctx.signal);checkRevision(args.expectedRevision);
    if (!design && ide.runState==='paused') {ide.pendingEdits=true;ide.editRevision=(ide.editRevision||0)+1;}
    const result=commit(candidate,'MCP: '+name);
    if(name==='module.rename') {
      const before=oldModuleName,after=args.name;
      for(const bp of ide.breakpoints||[]) if(bp.module.toLowerCase()===String(before).toLowerCase()) bp.module=after;
      ide.syncBreakpoints?.();
      const watches=ide.debuggerWindows?.snapshot();
      if(watches){for(const w of watches)if(w.module?.toLowerCase()===before.toLowerCase())w.module=after;ide.debuggerWindows.restore(watches);ide.updateWatches?.();}
    }
    return {...result,revision:adapter.revision};
  },{write:true,destructive});
  const resource = (uri,name,read)=>extraResources.set(uri,{name,read});
  add('agent.capabilities','Discover the entire supported agent surface, scope categories, current authority, command routing, and explicit host-only boundaries.',{},[],()=>output({
    apiVersion:1,permissions:adapter.permissions?.snapshot(ide.project.id),scopes:AGENT_SCOPES,
    tools:adapter.tools.map(t=>({name:t.name,scope:agentScope(t.name),readOnly:t.annotations.readOnlyHint})),
    limits:{sourceOffsets:'zero-based UTF-16, end-exclusive',toolMessageBytes:8*1024*1024,sourceReadLines:1000,sourceReadCodeUnits:262144,defaultPage:100},
    boundaries:['No arbitrary JavaScript, shell, DOM or MCP permission/credential control.','Host file dialogs, clipboard, printing and popup creation require local browser interaction.','Native project formats and debugger live-edit semantics follow the existing IDE implementation.'],
    workflow:'Read project.get. Pass expectedRevision for every mutation. Read debug.snapshot for pauseId. Code edits while paused are staged until debug.applyEdits. Runtime input is queued; use agent.wait then inspect. Read commands.list for structured alternatives to native UI dialogs.'
  }));
  add('agent.wait','Wait for revision, observed event sequence, or runtime-state change, without polling the whole project. Returns on change, timeout or cancellation.',{afterRevision:REV,afterEvent:REV,afterPause:N(),state:E(['design','running','paused']),timeoutMs:N(0,30000)},[],async(args,ctx)=>{
    const ready=()=> (!args.state||ide.runState===args.state)&&(args.afterRevision===undefined||adapter.revision!==args.afterRevision)&&(args.afterEvent===undefined||adapter.eventSequence!==args.afterEvent)&&(args.afterPause===undefined||(ide.debuggerWindows?.pauseId||0)!==args.afterPause);
    if(!ready()) await new Promise((resolve,reject)=>{
      let timer;const finish=()=>{clearTimeout(timer);off();ctx.signal?.removeEventListener('abort',abort);resolve();},abort=()=>{clearTimeout(timer);off();reject(new McpError(-32800,'Request cancelled.'));};
      const off=adapter.onChange(()=>{if(ready())finish();});timer=setTimeout(finish,args.timeoutMs??10000);ctx.signal?.addEventListener('abort',abort,{once:true});if(ctx.signal?.aborted)abort();else if(ready())finish();
    });
    checkAbort(ctx.signal);return output({...adapter.snapshot(),matched:ready()});
  });
  add('project.details','Read project settings, references, native metadata and module identities without embedding all source and binary data.',{},[],()=>output({project:{...adapter.snapshot(),description:ide.project.description,settings:clone(ide.project.settings),references:clone(ide.project.references),nativeProject:clone(ide.project.nativeProject||null)}}));
  mutate('project.update','Update project name, description, startup, settings and preserved native metadata. Validated and undoable.',{name:S,description:{type:'string',maxLength:10000},startup:S,settings:OBJ,nativeProject:OBJ});
  add('project.new','Create a new project with one form. Replaces the workspace after approval; its previous project can be recovered through undo.',{name:S,expectedRevision:REV},['name','expectedRevision'],async(args,ctx)=>{
    identifier(args.name);await consent('vb6.project.new',args,ctx); checkAbort(ctx.signal);checkRevision(args.expectedRevision);return replace(newProject(args.name),'MCP: new project');
  },{write:true,destructive:true});
  function replace(project,label) {const before=clone(ide.project),saved=ide.savedJSON;ide.loadProject(project);ide.savedJSON=saved;ide.record(before,label);changed();return adapter.snapshot();}
  const fileEntry=O({path:S,content:TEXT,encoding:E(['utf8','base64'])},['path','content']);
  async function incoming(args) {
    if (!!args.files === !!args.zip) fail('Provide files or zip, not both.');
    return normalizedEntries(args.zip ? await readZip(decodeFile(args.zip, 'base64'), {maxExpandedBytes: 20000000, maxFiles: 2000}) : args.files.map(f => [f.path, decodeFile(f.content, f.encoding)]));
  }
  add('project.entries', 'Inspect supplied files or ZIP and list selectable native, group and web project entry paths before importing. Reads supplied data only.', {files:A(fileEntry,2000),zip:TEXT}, [], async (args,ctx) => {
    const entries = await incoming(args); checkAbort(ctx.signal); return output({entries: listProjectEntries(entries), encodings: NATIVE_ENCODINGS});
  });
  add('project.import','Open or add original VB6/native or web source files, or a base64 ZIP. Uses the existing importer and reports format diagnostics. Does not access the host filesystem.',{files:A(fileEntry,2000),zip:TEXT,add:B,entryPath:S,encoding:E(NATIVE_ENCODINGS),basenameFallback:B,expectedRevision:REV},['expectedRevision'],async(args,ctx)=>{
    if(!!args.files===!!args.zip) fail('Provide files or zip, not both.');
    await consent('vb6.project.import',args,ctx); checkAbort(ctx.signal);checkRevision(args.expectedRevision);
    const entries = await incoming(args);
    const result=await importFiles(entries, {entryPath:args.entryPath,encoding:args.encoding,basenameFallback:args.basenameFallback});checkAbort(ctx.signal);adapter.assertEnabled();checkRevision(args.expectedRevision);
    if(args.add) commit(mergedProject(ide.project,result.project),'MCP: import modules');
    else replace(result.project,'MCP: import workspace');
    return output({project:adapter.snapshot(),diagnostics:result.diagnostics,entryPath:result.entryPath,format:result.format});
  },{write:true,destructive:true});
  add('project.files','List or read original/native-style exported project files without downloads. Read binary resources as base64; text uses UTF-8.',{path:S,offset:N(),limit:N(1,1000),byteOffset:N(0,50000000),byteCount:N(1,262144)},[],args=>{
    const files=sourceFiles(ide.project);
    if(args.path){const path=cleanProjectPath(args.path);if(!Object.hasOwn(files,path))fail('Unknown exported file.');const value=files[path];if(args.byteOffset!==undefined||args.byteCount!==undefined){const bytes=typeof value==='string'?new TextEncoder().encode(value):value,offset=args.byteOffset||0;if(offset>bytes.length)fail('Offset outside exported file.');const chunk=bytes.slice(offset,offset+(args.byteCount||65536));return output({path,encoding:'base64',content:toBase64(chunk),offset,total:bytes.length,hasMore:offset+chunk.length<bytes.length});}return output({path,encoding:typeof value==='string'?'utf8':'base64',content:typeof value==='string'?value:toBase64(value)});}
    return output(page(Object.entries(files).map(([path,value])=>({path,size:value.length,encoding:typeof value==='string'?'utf8':'base64'})),args));
  });
  add('project.archive','Return a source/workspace ZIP as base64 data, never an automatic download. Native export has the same compatibility limits as the IDE.',{},[],()=>{const files=sourceFiles(ide.project);files[ide.project.name+'.vb6web']=JSON.stringify(ide.project);return output({name:ide.project.name+'.zip',encoding:'base64',data:toBase64(writeZip(files))});});
  add('references.get','Read project reference and OCX declarations. This does not load native COM libraries.',{},[],()=>output({references:clone(ide.project.references)}));
  mutate('references.set','Replace preserved reference/OCX declarations, without downloading or executing native libraries.',{references:A(OBJ,1000)},['references']);
  mutate('module.rename','Rename a module/form and its source identifier references, preserving strings and comments. This is lexical, not whole-program semantic refactoring.',{module:S,name:S},['module','name']);
  mutate('module.metadata','Edit module attributes, native path, class header and source encoding metadata.',{module:S,attributes:A(S),nativeClassHeader:S,sourcePath:S,sourceEncoding:E(['utf-8','windows-1252'])},['module']);
  add('code.edit','Apply disjoint source edits across modules atomically, with one undo transaction. All UTF-16 ranges refer to the original source. Paused-runtime edits remain staged.',{edits:A(O({module:S,start:N(0,5000000),end:N(0,5000000),text:TEXT,expectedText:TEXT},['module','start','end','text']),1000),expectedRevision:REV},['edits','expectedRevision'],async(args,ctx)=>{
    if(!['design','paused'].includes(ide.runState)) throw new McpError(-32000,'Pause or stop before editing code.');
    const next=sourceEdits(ide.project,args.edits);await consent('vb6.code.edit',args,ctx,{design:false}); checkAbort(ctx.signal);checkRevision(args.expectedRevision);
    if(ide.runState==='paused'){ide.pendingEdits=true;ide.editRevision=(ide.editRevision||0)+1;}
    return commit(next,'MCP: atomic source edits');
  },{write:true});
  mutate('code.transform','Format source or lexically rename an identifier. Omitting module applies to all modules. Strings/comments are preserved by rename; it is not semantic rename.',{module:S,action:E(['format','rename']),from:S,to:S},['action'],{design:false});
  add('code.read','Read a bounded UTF-16 source range, including very long single lines. Supply the same expectedRevision for every chunk to avoid mixing edits. Offset and nextOffset are zero-based and end-exclusive.',{module:S,offset:N(0,5000000),count:N(1,262144),expectedRevision:REV},['module'],args=>{
    if(args.expectedRevision!==undefined)checkRevision(args.expectedRevision);
    const m=moduleOf(ide.project,args.module),offset=args.offset??0;
    if(offset>m.code.length)fail('Source offset is beyond the end of the module.');
    const code=m.code.slice(offset,offset+(args.count??65536)),nextOffset=offset+code.length;
    return output({module:m.name,moduleId:m.id,offset,nextOffset,totalCodeUnits:m.code.length,code,hasMore:nextOffset<m.code.length,offsetEncoding:'utf-16'});
  });
  add('code.symbols','Read declaration symbols and procedure signatures, with module scoping, literal filtering and pagination.',{module:S,query:S,offset:N(),limit:N(1,1000)},[],args=>output(page((args.module?[moduleOf(ide.project,args.module)]:ide.project.modules).flatMap(m=>scanDeclarations(m).symbols.map(s=>({...s,module:m.name}))).filter(s=>!args.query||s.name.toLowerCase().includes(args.query.toLowerCase())),args)));
  add('code.complete','Return declaration-aware completion, quick info or parameter info at a UTF-16 source offset without changing editor selection.',{module:S,offset:N(0,5000000),kind:E(['completions','constants','resolve','parameters']),expression:S},['module','offset'],args=>{
    const m=moduleOf(ide.project,args.module);if(args.offset>m.code.length)fail('Offset outside module.');const line=m.code.slice(0,args.offset).split('\n').length;
    const result=args.kind==='resolve'?intelligence.resolve(ide.project,m,line,args.expression||''):args.kind==='parameters'?intelligence.parameterInfo(ide.project,m,line,m.code,args.offset):intelligence.completions(ide.project,m,line,m.code,args.offset,{constants:args.kind==='constants'});
    return output({result});
  });
  mutate('procedure.add','Add a Sub, Function or Property using the existing declaration generator.',{module:S,name:S,type:E(['Sub','Function','Property']),scope:E(['Public','Private']),staticLocals:B},['module','name']);
  add('procedure.get','Read procedure declarations and native attributes.',{module:S,name:S},['module'],args=>{const m=moduleOf(ide.project,args.module);return output({procedures:scanDeclarations(m).procedures.filter(p=>!args.name||p.name.toLowerCase()===args.name.toLowerCase()).map(p=>({...p,attributes:readProcedureAttributes(m,p.name)}))});});
  mutate('procedure.attributes','Update a procedure description, HelpID, member ID and flags.',{module:S,name:S,attributes:OBJ},['module','name','attributes']);
  mutate('procedure.event','Generate a typed event handler for a form or control. Control arrays include the Index argument.',{module:S,id:S,event:S},['module','event']);
  add('bookmarks.get','Read one module’s source bookmarks.',{module:S},['module'],args=>output({lines:clone(moduleOf(ide.project,args.module).bookmarks||[])}));
  mutate('bookmarks.set','Replace source bookmarks with validated one-based lines.',{module:S,lines:A(N(1,5000000))},['module','lines']);
  mutate('form.properties','Patch form designer properties without replacing controls. Use module.rename to change identity.',{module:S,properties:OBJ,remove:A(S,100)},['module','properties']);
  const nodeArgs={module:S,action:E(['add','update','remove','rename','reparent','reorder']),id:S,name:S,type:E(CONTROL_TYPES),parent:S,properties:OBJ,remove:A(S,100),cascade:B,index:N(0,9999)};
  mutate('control.edit','Add/update/remove/rename/reparent/reorder a control. Use stable IDs for array elements. Removal of children requires cascade:true.',nodeArgs,['module','action']);
  mutate('menu.edit','Add/update/remove/rename/reparent/reorder menu designer entries. Parent names and cycles are validated.',{...nodeArgs,type:E(['Menu'])},['module','action']);
  mutate('designer.format','Apply container-local spacing, grid sizing, centering and largest/smallest sizing with undo.',{module:S,ids:A(S),primaryId:S,command:E(['horizontalEqual','horizontalIncrease','horizontalDecrease','horizontalRemove','verticalEqual','verticalIncrease','verticalDecrease','verticalRemove','centerHorizontalInForm','centerVerticalInForm','sizeToGrid','sizeToWidest','sizeToNarrowest','sizeToTallest','sizeToShortest'])},['module','ids','command']);
  add('files.list','List virtual project files and directories. This never reads the operating-system filesystem.',{offset:N(),limit:N(1,1000)},[],args=>{const fs=new VirtualFileSystem(ide.project.vfs);return output({...page([...fs.files].map(([path,v])=>({path,size:v.length,binary:v instanceof Uint8Array})),args),directories:[...fs.directories].slice(0,2000)});});
  add('files.read','Read a bounded range of a virtual file: UTF-16 text units or binary bytes. Binary results use base64.',{path:S,offset:N(),count:N(1,1000000)},['path'],args=>{const fs=new VirtualFileSystem(ide.project.vfs),v=fs.entry(filePath(args.path)),offset=args.offset||0,count=args.count||100000;return output({path:args.path,encoding:v instanceof Uint8Array?'base64':'utf8',content:v instanceof Uint8Array?toBase64(v.slice(offset,offset+count)):v.slice(offset,offset+count),offset,total:v.length,hasMore:offset+count<v.length});});
  mutate('files.write','Write text or base64 bytes to the project’s isolated virtual disk, with undo.',{path:S,content:TEXT,encoding:E(['utf8','base64'])},['path','content']);
  mutate('files.manage','Remove, rename or copy a virtual file; create/remove empty virtual directories.',{action:E(['remove','rename','copy','mkdir','rmdir']),path:S,destination:S},['action','path'],{destructive:true});
  add('assets.list','List project raster assets without embedding image data.',{},[],()=>output({assets:Object.entries(ide.project.assets).map(([path,v])=>({path,size:String(v).length}))}));
  add('assets.read','Read one exact project asset as inert data.',{path:S},['path'],args=>{const path=cleanProjectPath(args.path);if(!Object.hasOwn(ide.project.assets,path))fail('Asset not found.');return output({path,data:ide.project.assets[path]});});
  mutate('assets.write','Add/replace an offline raster data URL. Remote URLs, SVG and active HTML are rejected.',{path:S,data:TEXT},['path','data']);
  mutate('assets.remove','Remove an asset. Existing picture references may then become unresolved.',{path:S},['path'],{destructive:true});
  add('appSettings.get','Read project application settings, distinct from private IDE/MCP settings.',{},[],()=>output({settings:clone(ide.project.appSettings)}));
  mutate('appSettings.set','Replace the project’s VB application settings with undo. Does not change MCP permissions.',{settings:OBJ},['settings']);
  add('resources.list','List native resource keys/types/languages and byte sizes without binary payloads.',{offset:N(),limit:N(1,1000)},[],args=>output({...page((ide.project.resources?.entries||[]).map(({data,...e})=>({...e,key:resourceKey(e),bytes:Math.floor(data.length*3/4)-(data.endsWith('==')?2:data.endsWith('=')?1:0)})),args),fileName:ide.project.resources?.fileName}));
  add('resources.read','Read the exact base64 bytes and metadata for one native resource key.',{key:S},['key'],args=>{const e=ide.project.resources?.entries.find(e=>resourceKey(e)===args.key);if(!e)fail('Unknown resource key.');return output({entry:clone(e)});});
  add('resources.strings','Read decoded native string table entries.',{offset:N(),limit:N(1,1000)},[],args=>output(page(listResourceStrings(ide.project.resources),args)));
  mutate('resources.write','Add/replace a native resource entry (type, name, language, base64 data and optional header metadata).',{entry:OBJ},['entry']);
  mutate('resources.remove','Remove one native resource key with undo.',{key:S},['key'],{destructive:true});
  mutate('resources.string','Set one native string-table entry, preserving adjacent entries.',{id:N(0,65535),text:{type:'string',maxLength:65535},language:N(0,65535)},['id','text']);
  mutate('resources.import','Import an original Win32 RES file supplied as base64 data.',{data:TEXT,fileName:S},['data']);
  add('resources.export','Export original/current Win32 RES bytes as base64, without a browser download.',{},[],()=>{if(!ide.project.resources)fail('No resource file.');return output({fileName:ide.project.resources.fileName,data:toBase64(writeRES(ide.project.resources)),encoding:'base64'});});

  installDataTools(ide,adapter,{add,output,consent,commit,checkRevision,page,resource});
  installBuildTools(ide,adapter,{add,output,consent,commit,changed,checkRevision});
  installWorkbenchTools(ide,adapter,{add,output,consent,commit,changed,debugSnapshot,page,resource});
  resource('vb6://agent/capabilities','Agent capabilities',()=>adapter.tools.find(t=>t.name==='vb6.agent.capabilities').execute({},{}));
  resource('vb6://project/settings','Project settings',()=>output({settings:clone(ide.project.settings),references:clone(ide.project.references)}));
  resource('vb6://files','Virtual file inventory',()=>adapter.tools.find(t=>t.name==='vb6.files.list').execute({},{}));
  resource('vb6://resources','Native resource inventory',()=>adapter.tools.find(t=>t.name==='vb6.resources.list').execute({},{}));
  const resources=adapter.resources.bind(adapter),read=adapter.readResource.bind(adapter);
  adapter.resources=async()=>[...await resources(),...[...extraResources].map(([uri,r])=>({uri,name:r.name,mimeType:'application/json'}))];
  adapter.readResource=async(uri,ctx={})=>{adapter.assertEnabled();checkAbort(ctx.signal);const r=extraResources.get(uri);return r?[{uri,mimeType:'application/json',text:JSON.stringify(await r.read(),null,2)}]:read(uri,ctx);};
}
