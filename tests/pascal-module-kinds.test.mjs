import test from 'node:test';
import assert from 'node:assert/strict';
import {createModule,newProject,normalizeProject} from '../src/project/model.js';
import {createModuleSource,moduleLanguage} from '../src/project/language.js';
import {Signal,History} from '../src/core/core.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {McpServer} from '../src/mcp/server.js';
import {McpClient} from './helpers/mcp-client.mjs';
import {LocalTransport} from './helpers/mcp-transports.mjs';
import {compileProject} from '../src/language/compiler.js';

test('Pascal class metadata is rejected while legacy VB classes and explicit mixed classes round-trip',()=>{
  assert.throws(()=>createModule('Unsupported','class',{language:'pascal'}),/Pascal class modules.*object types.*unit/);
  assert.throws(()=>createModuleSource('class','Unsupported','tp7'),/Pascal class modules/);
  const legacy=newProject('Legacy');legacy.modules.push(createModule('LegacyClass','class'));
  const restored=normalizeProject(legacy);assert.equal(restored.modules[1].language,undefined);assert.equal(moduleLanguage(restored.modules[1],restored),'vb6');
  const mixed=newProject('Mixed',{language:'pascal'});mixed.modules.push(createModule('VBClass','class',{language:'vb6'}));
  const saved=JSON.stringify(mixed),loaded=normalizeProject(JSON.parse(saved));
  assert.equal(loaded.modules[0].language,'pascal');assert.equal(loaded.modules[1].language,'vb6');assert.equal(loaded.modules[1].code,mixed.modules[1].code);
  assert.equal(compileProject(loaded).valid,true);
  for(const language of ['pascal',undefined]){
    const invalid=JSON.parse(saved);invalid.modules[1].language=language;
    const before=JSON.stringify(invalid);assert.throws(()=>normalizeProject(invalid),/Pascal class modules/);assert.equal(JSON.stringify(invalid),before);
  }
});

test('the Pascal project menu and actual Add Class command explicitly create a Visual Basic class',async()=>{
  // Import the real command implementation without creating a DOM workspace.
  const previous=globalThis.document;globalThis.document={getElementById:()=>null};
  let VB6Studio;
  try{({VB6Studio}=await import('../src/ide/main.js'));}
  finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
  const opened=[],history=[],ide={project:newProject('Mixed',{language:'pascal'}),runState:'design',appearance:{requireVariableDeclaration:true},
    record(before,label){history.push({before,label});},openDocument(id,view){opened.push({id,view});}};
  assert.equal(VB6Studio.prototype.projectMenu.call(ide).find(item=>item?.id==='addClass').label,'Add Visual Basic Class Module');
  await VB6Studio.prototype.command.call(ide,'addClass');
  const added=ide.project.modules.at(-1);assert.equal(added.kind,'class');assert.equal(added.language,'vb6');assert.match(added.code,/^Option Explicit/);
  assert.deepEqual(opened,[{id:added.id,view:'code'}]);assert.equal(history.length,1);
  await VB6Studio.prototype.command.call(ide,'addModule');
  assert.equal(ide.project.modules.at(-1).language,'pascal');assert.match(ide.project.modules.at(-1).code,/^unit Module1;/);
  assert.equal(compileProject(ide.project).valid,true);
  ide.project=newProject('Legacy');assert.equal(VB6Studio.prototype.projectMenu.call(ide).find(item=>item?.id==='addClass').label,'Add Class Module');
});

test('MCP rejects explicit and inherited Pascal classes before approval and preserves accepted VB source',async t=>{
  const ide=new Signal();Object.assign(ide,{project:newProject('AgentMixed',{language:'pascal'}),runState:'design',history:new History(),breakpoints:[],watches:[],output:[],immediateOutput:[],stack:[],docs:[],savedJSON:'',
    markDirty(){this.dirty=true;},record(before,label){this.history.record(before,this.project,label);this.markDirty();},loadProject(project){this.project=normalizeProject(project);this.history.reset();},
    syncBreakpoints(){},updateWatches(){},autosave(){},openDocument(){},requestRuntime:async()=>({}),sendRuntime(){}});
  let approvals=0;
  const adapter=createIdeAdapter(ide,{approve:async()=>{approvals++;return true;}}),server=new McpServer(adapter),client=new McpClient(new LocalTransport(server));
  adapter.setEnabled(true);t.after(async()=>{await client.close();server.close();adapter.dispose();});await client.connect();
  const call=async(name,args)=>{const result=await client.callTool('vb6.'+name,{expectedRevision:adapter.revision,...args});if(result.isError)throw new Error(result.content[0].text);return result.structuredContent;};
  for(const language of ['pascal',undefined]){
    const before=JSON.stringify(ide.project),revision=adapter.revision;
    await assert.rejects(call('module.add',{name:'Unsupported',kind:'class',...(language?{language}:{})}),/Pascal class modules/);
    assert.equal(JSON.stringify(ide.project),before);assert.equal(adapter.revision,revision);assert.equal(approvals,0);
  }
  await call('module.add',{name:'SharedClass',kind:'class',language:'vb6',code:'Public Value As Long'});
  const added=ide.project.modules.at(-1);assert.equal(added.language,'vb6');assert.equal(added.code,'Public Value As Long');assert.equal(approvals,1);
  await call('project.update',{language:'vb6'});await call('project.update',{language:'pascal'});
  assert.equal(ide.project.modules.at(-1).language,'vb6');assert.equal(ide.project.modules.at(-1).code,'Public Value As Long');
  assert.equal(compileProject(ide.project).valid,true);
});
