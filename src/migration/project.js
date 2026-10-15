import {externalSymbolSnapshot,projectSymbolSnapshot} from '../language/symbol-snapshot.js';
import {createRuntimePlan} from './runtime-plan.js';
import {createRepresentationPlan} from './representations.js';
import {projectFile,entrySource,solutionFile} from './project-layout.js';
import {compileProject} from '../language/compiler.js';
import {sourceFiles, workspaceProjects} from '../project/formats.js';
import {normalizeOptions, validatePlugins, checkAbort, diagnostic, MigrationError, MIGRATION_VERSION, MIGRATION_SCHEMA} from './contracts.js';
import {key, identifier, qualified, safeFileName, xml} from './names.js';
import {emitModule} from './module-emitter.js';
import {emitForm} from './forms.js';
import {CAPABILITIES} from './registry.js';
import {migrationZip} from './archive.js';

const json=value=>JSON.stringify(value,null,2)+'\n';
function snapshot(project,options) {
  if(!project||typeof project!=='object'||!Array.isArray(project.modules))throw new TypeError('A VB6 project with a modules array is required');
  const bytes=new TextEncoder().encode(JSON.stringify(project));
  if(bytes.length>options.maxSourceBytes)throw new MigrationError('Project exceeds migration source-byte limit.');
  if(project.modules.length>2048)throw new MigrationError('Project exceeds migration module limit.');
  // No JSON serialization of generated code can execute VB6 source. Project
  // inputs are data. Plugins are separate, trusted JavaScript extension code.
  return JSON.parse(new TextDecoder().decode(bytes));
}
function invokeAll(plugins,hook,input,context) {
  for(const plugin of plugins){
    if(!plugin[hook])continue;
    if(plugin.requires)for(const feature of plugin.requires)context.runtimePlan.require(feature,{},'Extension: '+plugin.id);
    else if(hook==='finalize')context.runtimePlan.opaque(context,plugin.id);
    const value=plugin[hook](input,context);
    if(value&&typeof value.then==='function')throw new TypeError('Migration hooks are synchronous: '+plugin.id);
  }
}
function selectEntry(state) {
  if(state.target==='library')return null;
  const startup=String(state.project.startup||'Sub Main'),form=[...state.compiled.modules.values()].find(m=>m.form&&key(m.name)===key(startup));
  if(form)return {kind:'form',module:form.name};
  const mains=[...state.compiled.modules.values()].filter(m=>m.kind==='module'&&m.procedures.has('main'));
  if(mains.length!==1){state.diagnostics.push(diagnostic('MIG_STARTUP',mains.length?'Multiple Sub Main entry points; select an unambiguous startup module.':'No startup form or Sub Main was found.'));return null;}
  const procedure=mains[0].procedures.get('main');
  if(procedure.params.length||procedure.kind!=='sub')state.diagnostics.push(diagnostic('MIG_STARTUP_SIGNATURE','VB6 startup must be a parameterless Sub Main.',{source:mains[0].name,line:procedure.line}));
  return {kind:'main',module:mains[0].name};
}
function singleProject(project,options,plugins,compile) {
  checkAbort(options.signal);
  const symbols=projectSymbolSnapshot(project);
  const compilerInput={...project,symbolMetadata:{...symbols,globals:[...symbols.globals,...plugins.flatMap(plugin=>externalSymbolSnapshot(plugin.externalSymbols))]}};
  const compiled=compile(compilerInput,{retainSyntax:true}),diagnostics=compiled.diagnostics.map(d=>diagnostic('MIG_VB6_'+(d.number||'PARSE'),d.message,d,d.severity||'error'));
  for(const module of compiled.modules.values())for(const proc of module.procedures.values())if(proc.returnArray)diagnostics.push(diagnostic('MIG_ARRAY_RETURN','Typed array procedure returns require an explicit VB.NET array-return adapter; scalar emission is not a supported conversion.',{source:module.name,line:proc.line}));
  const target=options.target==='auto'?(project.modules.some(m=>m.form)?'winforms':project.modules.some(m=>/\bSub\s+Main\b/i.test(m.code||''))?'console':'library'):options.target;
  const assemblyName=safeFileName(options.assemblyName||project.name||'MigratedProject'),application='Application',files=Object.create(null),sourceMap=[],interfaces=new Set();
  for(const module of compiled.modules.values())for(const entry of module.interfaces)interfaces.add(key(entry.name));
  if(options.rootNamespace)qualified(options.rootNamespace);
  const state={project,compiled,target,options,plugins,diagnostics,interfaces,files,sourceMap,modernization:[]};state.entry=selectEntry(state);
  state.runtimePlan=createRuntimePlan(options,diagnostics);
  state.requireRuntime=(feature,location={},reason)=>state.runtimePlan.require(feature,location,reason);
  // VB.NET requires an accessible startup method. Keep the original private
  // Main and its in-module forwarding entry rather than changing source visibility.
  state.directEntry=options.codeStyle==='native'&&target==='console'&&state.entry?.kind==='main'&&compiled.modules.get(key(state.entry.module)).procedures.get('main').scope==='public';
  if(target==='winforms'&&state.entry?.kind==='main')diagnostics.push(diagnostic('MIG_MAIN_FORM_LIFETIME','Sub Main starts a WinForms loop around the first open form; review multi-form application shutdown semantics.'));

  invokeAll(plugins,'analyze',project,state);
  state.representations=createRepresentationPlan(state);
  if(state.representations.opaque)state.directEntry=false;
  if(target!=='winforms'&&project.modules.some(m=>m.form))diagnostics.push(diagnostic('MIG_UI_TARGET','Projects containing forms require the WinForms target.'));
  if(project.references?.length)diagnostics.push(diagnostic('MIG_REFERENCES','Original COM/type-library references are retained in the report; resolve each with a typed .NET/COM adapter before deployment.','', 'error'));
  if(project.resources)diagnostics.push(diagnostic('MIG_RESOURCE_TABLE','VB6 RES resources are retained; LoadRes* call-site and resource-ID conversion requires a resource adapter.'));
  for(const input of project.modules)if(input.nativeKind&&!['Module','Class','Form'].includes(input.nativeKind))diagnostics.push(diagnostic('MIG_NATIVE_MODULE_KIND','Native '+input.nativeKind+' modules require a dedicated .NET component adapter.',{source:input.name}));
  for(const module of compiled.modules.values()){
    checkAbort(options.signal);
    const path=application+'/'+safeFileName(module.name)+'.vb';
    try{
      const result=emitModule(state,module,path);put(path,result.code);sourceMap.push(...result.mappings);
      if(module.form){const designer=path.replace(/\.vb$/,'.Designer.vb'),form=emitForm(state,module,designer);put(designer,form.code);sourceMap.push(...form.mappings);}
    }catch(error){diagnostics.push(diagnostic('MIG_EMISSION',error.message,{source:module.name}));}
  }
  if(target!=='library'&&!state.directEntry)put(application+'/__vbEntry.vb',entrySource(state));
  put('global.json',json({sdk:{version:'10.0.100',rollForward:'latestFeature',allowPrerelease:false}}));
  if(options.includeOriginals){
    // A complete, lossless in-memory snapshot is retained even if a native-file
    // serializer cannot represent browser-only designer extensions.
    put('Originals/project.vb6web',json(project));
    for(const module of project.modules){const extension=module.kind==='form'?'.frm':module.kind==='class'?'.cls':'.bas';put('Originals/Code/'+safeFileName(module.name)+extension,module.code||'');}
    try{for(const [path,bytes] of Object.entries(sourceFiles(project)))put('Originals/Native/'+path.replace(/\\/g,'/'),bytes);}
    catch(error){diagnostics.push(diagnostic('MIG_NATIVE_SNAPSHOT','Native snapshot could not be serialized: '+error.message+'. Full browser snapshot and module source were retained.',{},'warning'));}
  }
  const extensionContext={...state,addFile:put,report:reportDraft(state,assemblyName)};
  invokeAll(plugins,'finalize',files,extensionContext);
  state.runtime=state.runtimePlan.materialize(target,put);
  put(application+'/'+assemblyName+'.vbproj',projectFile(state,assemblyName));
  put(assemblyName+'.slnx',solutionFile(state,assemblyName));
  // A review bundle contains original code, but never masquerades as a buildable
  // completed migration. Resolve diagnostics and deliberately edit this guard.
  const errors=diagnostics.filter(d=>d.severity==='error').length;
  put('Directory.Build.targets','<Project>\n'+(errors?'  <Target Name="RequireResolvedMigration" BeforeTargets="CoreCompile">\n    <Error Text="Migration has '+errors+' unresolved diagnostic(s). Resolve migration-report.json and remove this guard after review." />\n  </Target>\n':'')+'</Project>\n');
  const report={...reportDraft(state,assemblyName),success:errors===0,errors,warnings:diagnostics.filter(d=>d.severity==='warning').length,diagnostics,sourceModules:project.modules.map(m=>({name:m.name,kind:m.kind,converted:compiled.modules.has(key(m.name))})),references:project.references||[],conditionalConstants:project.settings?.conditionalConstants||{}};
  put('migration-report.json',json(report));put('source-map.json',json({schema:1,mappings:sourceMap}));
  put('README-MIGRATION.md',readme(report,assemblyName));
  // Validate plugin paths and collisions before returning any deliverable, not
  // only when the caller eventually asks for a ZIP.
  migrationZip(files);
  return {success:report.success,files,report,diagnostics,sourceMap,projectFile:application+'/'+assemblyName+'.vbproj'};
  function put(path,content){
    if(Object.keys(files).some(p=>p.normalize('NFC').toLowerCase()===path.normalize('NFC').toLowerCase()))throw new MigrationError('Generated path collision: '+path);
    if(typeof content!=='string'&&!(content instanceof Uint8Array))throw new TypeError('Generated files must contain text or bytes: '+path);
    files[path]=content;
  }
}
function reportDraft(state,name){return {schema:MIGRATION_SCHEMA,converter:{name:'@vb6-studio/vbnet-migration',version:MIGRATION_VERSION},project:name,target:state.target,targetFramework:state.target==='winforms'?'net10.0-windows':'net10.0',platform:state.options.platform,codeStyle:state.options.codeStyle,semanticPolicy:state.options.semanticPolicy,modernization:state.modernization,runtime:state.runtime,representations:state.representations?.decisions||[],validation:{generated:true,dotnetBuild:'not-run',behavioralEquivalence:'not-certified'},plugins:state.plugins.map(p=>p.id),capabilities:CAPABILITIES};}
function readme(report,name){return '# '+name+' — VB.NET migration\n\nTarget: **'+report.targetFramework+'**, platform **'+report.platform+'**.\n\nOutput: **'+report.codeStyle+'**, support: **'+report.runtime.policy+'** ('+report.runtime.sourceFiles+' VB files, '+report.runtime.sourceBytes+' source bytes).\n\n'+(report.modernization.length?'**Approved semantic changes:** '+report.modernization.map(item=>item.rule).filter((item,index,items)=>items.indexOf(item)===index).join(', ')+'. Review the recorded behavior changes.\n\n':'')+(report.success?'No blocking converter diagnostics. This is not a guarantee of build success or behavioral equivalence.':'**REVIEW BUNDLE: '+report.errors+' blocking diagnostics. The included MSBuild guard intentionally prevents compilation.**')+'\n\nInstall the .NET 10 SDK. WinForms applications run only on Windows.\n\n```sh\ndotnet build "'+name+'.slnx"\n'+(report.target!=='library'?'dotnet run --project "Application/'+name+'.vbproj"\n':'')+'```\n\nReview `migration-report.json` and `source-map.json`. All retained original modules, native files and resources are under `Originals/`; `project.vb6web` preserves the full input snapshot. Compatibility support follows the selected packaging policy; the report lists each required feature and its reason. Minimal output includes only selected authored source units. Package output references explicitly configured external packages and does not certify their availability. No VB6 project code is executed during conversion.\n\nThe converter preserves Integer/Long widths, eager Boolean operators, procedure-scope locals, lower-bound arrays, fixed strings and Currency through explicit generated code and helpers. Microsoft.VisualBasic supplies supported classic intrinsics. Exact Variant promotion, COM/OCX contracts, deterministic COM destruction, raw pointer APIs, binary record layout, graphics and unsupported control members require explicit review/adapters. Only the selected conditional-compilation configuration is converted; inactive source remains in Originals.\n\n`Option Strict Off` is the compatibility default; select strict mode to expose all required narrowing/late-binding conversions to the VB compiler. The report records generated output only; it never asserts that dotnet was run by the browser.\n';}

/** Reentrant, synchronous, no host APIs. Plugins are trusted code, not project data. */
export function createVbNetMigrator({plugins=[],compile=compileProject}={}) {
  const registered=validatePlugins(plugins);
  if(typeof compile!=='function')throw new TypeError('compile must be a function');
  function convertProject(input,settings={}){
    const options=normalizeOptions(settings),active=validatePlugins([...registered,...options.plugins]);
    checkAbort(options.signal);const project=snapshot(input,options),projects=workspaceProjects(project);
    if(projects.length===1)return singleProject(projects[0],options,active,compile);
    const files=Object.create(null),diagnostics=[],reports=[],map=[],prefixes=new Set();
    for(const child of projects){
      const prefix=safeFileName(child.name);if(prefixes.has(prefix.toLowerCase()))throw new MigrationError('Workspace project-name collision: '+prefix);prefixes.add(prefix.toLowerCase());
      const result=singleProject(child,options,active,compile);
      for(const [path,contents] of Object.entries(result.files))files[prefix+'/'+path]=contents;
      reports.push(result.report);diagnostics.push(...result.diagnostics.map(d=>({...d,project:child.name})));map.push(...result.sourceMap.map(m=>({...m,generatedFile:prefix+'/'+m.generatedFile})));
    }
    diagnostics.push(diagnostic('MIG_WORKSPACE_LINKS','Workspace projects were all converted. Resolve cross-project references, COM identity and build order before treating the group as an integrated solution.'));
    // MSBuild stops searching at the closest Directory.Build.targets. Every
    // child needs the workspace guard as well as the root review directory.
    for(const prefix of prefixes){
      const path=Object.keys(files).find(p=>p.toLowerCase()===prefix+'/directory.build.targets');
      if(path)files[path]=files[path].replace('</Project>','  <Target Name="RequireResolvedWorkspace" BeforeTargets="CoreCompile"><Error Text="Resolve workspace reference migration before building." /></Target>\n</Project>');
    }
    const report={schema:MIGRATION_SCHEMA,success:false,errors:diagnostics.filter(d=>d.severity==='error').length,warnings:diagnostics.filter(d=>d.severity==='warning').length,projects:reports,diagnostics,validation:{dotnetBuild:'not-run',behavioralEquivalence:'not-certified'}};
    files['migration-report.json']=json(report);files['source-map.json']=json({schema:1,mappings:map});
    files['Directory.Build.targets']='<Project><Target Name="RequireResolvedWorkspace" BeforeTargets="CoreCompile"><Error Text="Resolve workspace reference migration before building." /></Target></Project>\n';
    migrationZip(files);return {success:false,files,report,diagnostics,sourceMap:map,projectFile:null};
  }
  function exportProject(input,options={}){
    const result=convertProject(input,options);
    if(!result.success&&!options.includeUnresolved)throw new MigrationError('Migration has unresolved diagnostics; export an explicit review bundle or install adapters.',result.diagnostics);
    return {...result,bytes:migrationZip(result.files),fileName:safeFileName(input.name||'Project')+'-net10'+(result.success?'':'-review')+'.zip'};
  }
  return Object.freeze({convertProject,exportProject});
}
export function convertVbNetProject(project,options={}) { return createVbNetMigrator().convertProject(project,options); }
export function exportVbNetProject(project,options={}) { return createVbNetMigrator().exportProject(project,options); }
