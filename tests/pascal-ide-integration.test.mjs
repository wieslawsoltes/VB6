import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {LanguageClient} from '../src/editor/advanced/client.js';
import {messagePortTransport} from '../src/editor/advanced/rpc.js';
import {BuiltinLanguageServer} from '../src/editor/advanced/builtin-server.js';
import {EditorIntelligence} from '../src/editor/intelligence.js';
import {sourceCodeActions} from '../src/editor/source-actions.js';
import {handlerEdit} from '../src/editor/event-completion.js';
import {addProcedureSource} from '../src/ide/procedure-tools.js';
import {prepareProjectEdits} from '../src/editor/advanced/workspace.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {McpServer} from '../src/mcp/server.js';
import {McpClient} from './helpers/mcp-client.mjs';
import {LocalTransport} from './helpers/mcp-transports.mjs';
import {newProject,normalizeProject,createControl} from '../src/project/model.js';
import {moduleLanguage} from '../src/project/language.js';
import {Signal,History} from '../src/core/core.js';
import {compileProject} from '../src/language/compiler.js';

const code='unit EditorTest;\ninterface\nprocedure Add(var output: Integer; amount: Integer);\nimplementation\nvar total: Integer;\nprocedure Add(var output: Integer; amount: Integer);\nbegin\n  output := output + amount;\nend;\nprocedure Main;\nbegin\n  total := 1;\n  Add(total, 2);\n  // total is a comment\n  WriteLn(\'total\', total);\nend;\nend.\n';
const uri='file:///workspace/EditorTest.pas';
const at=(line,character)=>({textDocument:{uri},position:{line,character}});

test('Pascal LSP provides completion, source binding, signatures, references and safe versioned rename',async t=>{
  const {port1,port2}=new MessageChannel(),server=new BuiltinLanguageServer(messagePortTransport(port1),{diagnosticDelay:60000}),client=new LanguageClient(messagePortTransport(port2));
  t.after(()=>{client.dispose();server.dispose();});await client.initialize();client.open(uri,'pascal',code);
  const completion=await client.request('textDocument/completion',at(11,5));assert.ok(completion.items.some(item=>item.label==='total'));assert.ok(!completion.items.some(item=>item.detail==='VB6 snippet'));
  const hover=await client.request('textDocument/hover',at(11,4));assert.match(hover.contents.value,/total: Integer/);
  assert.equal(await client.request('textDocument/hover',at(13,7)),null);assert.equal(await client.request('textDocument/hover',at(14,13)),null);
  const definition=await client.request('textDocument/definition',at(11,4));assert.equal(definition[0].range.start.line,4);
  const references=await client.request('textDocument/references',{...at(11,4),context:{includeDeclaration:true}});assert.equal(references.length,4);
  const rename=await client.request('textDocument/rename',{...at(11,4),newName:'sum'});assert.equal(rename.documentChanges[0].textDocument.version,1);assert.equal(rename.documentChanges[0].edits.length,4);
  const signature=await client.request('textDocument/signatureHelp',at(12,13));assert.match(signature.signatures[0].label,/var output: Integer/);assert.equal(signature.activeParameter,1);
  const actions=await client.request('textDocument/codeAction',{textDocument:{uri},range:{start:{line:0,character:0},end:{line:0,character:0}},context:{diagnostics:[]}});assert.ok(actions.every(action=>!JSON.stringify(action).includes('Option Explicit')));
  const folds=await client.request('textDocument/foldingRange',{textDocument:{uri}});assert.ok(folds.some(fold=>fold.startLine===9&&fold.endLine===15));
  const semantic=await client.request('textDocument/semanticTokens/full',{textDocument:{uri}});assert.ok(semantic.data.length>0&&semantic.data.length%5===0);
  const hierarchy=await client.request('textDocument/prepareCallHierarchy',at(9,11));assert.equal(hierarchy[0].name,'Main');const calls=await client.request('callHierarchy/outgoingCalls',{item:hierarchy[0]});assert.ok(calls.some(call=>call.to.name==='Add'));
});

test('Pascal forms share control completion, mutable event contracts, safe source actions and atomic workspace edits',()=>{
  const project=newProject('EditorForms',{language:'pascal'}),module=project.modules[0],service=new EditorIntelligence();module.form.controls.push(createControl('TextBox','Input1'));
  const items=service.completions(project,module,1,'Input1.',7).items;assert.ok(items.some(item=>item.name==='Text'));assert.ok(items.some(item=>item.name==='SelStart'));assert.ok(!items.some(item=>item.name==='Nodes'));
  const edit=handlerEdit(project,module,service,'Input1','KeyPress');assert.match(edit.text,/procedure Input1_KeyPress\(var KeyAscii: Integer\)/);assert.equal(module.code.slice(edit.start).trim(),'end.');
  const updated=prepareProjectEdits(project,[{uri:'pascal',before:module.code,after:module.code.slice(0,edit.start)+edit.text+module.code.slice(edit.end)}],new Map([['pascal',{moduleId:module.id,language:'pascal'}]]));
  assert.match(updated.modules[0].code,/Input1_KeyPress/);assert.doesNotMatch(module.code,/Input1_KeyPress/);assert.ok(compileProject(updated).valid);
  const index=service.index(module,project);assert.ok(sourceCodeActions(module,index).every(action=>action.kind!=='source.addOptionExplicit'));
  const added=addProcedureSource(module,{name:'Compute',type:'Function',scope:'Public'});assert.match(added.code,/interface\n\nfunction Compute: Variant;/);assert.match(added.code,/implementation[\s\S]*function Compute: Variant;/);assert.equal((added.code.match(/function Compute/g)||[]).length,2);
});

test('MCP language selection, mixed module creation, source metadata and event editing use the existing atomic workflow',async t=>{
  const ide=new Signal();Object.assign(ide,{project:newProject('AgentLanguages'),runState:'design',history:new History(),breakpoints:[],watches:[],output:[],immediateOutput:[],stack:[],docs:[],savedJSON:'',markDirty(){this.dirty=true;},record(before,label){this.history.record(before,this.project,label);this.markDirty();},loadProject(project){this.project=normalizeProject(project);this.history.reset();},syncBreakpoints(){},updateWatches(){},autosave(){},openDocument(){},requestRuntime:async()=>({}),sendRuntime(){}});
  const adapter=createIdeAdapter(ide,{approve:async()=>true}),server=new McpServer(adapter),client=new McpClient(new LocalTransport(server));adapter.setEnabled(true);t.after(async()=>{await client.close();server.close();adapter.dispose();});await client.connect();
  const call=async(name,args={})=>{const result=await client.callTool('vb6.'+name,args);if(result.isError)throw new Error(result.content[0].text);return result.structuredContent;},write=(name,args={})=>call(name,{expectedRevision:adapter.revision,...args});
  await write('project.new',{name:'PascalAgent',language:'pascal'});assert.equal(ide.project.language,'pascal');
  const details=await call('project.details');assert.deepEqual(details.supportedLanguages.map(language=>language.id),['vb6','pascal']);
  await write('module.add',{name:'SharedVB',kind:'module',language:'vb6'});assert.match(ide.project.modules[1].code,/Option Explicit/);assert.equal(moduleLanguage(ide.project.modules[1],ide.project),'vb6');
  await write('control.edit',{module:'Form1',action:'add',name:'Input1',type:'TextBox'});await write('procedure.event',{module:'Form1',id:'Input1',event:'KeyPress'});
  await write('code.transform',{module:'Form1',action:'format'});assert.match(ide.project.modules[0].code,/procedure Input1_KeyPress\(var KeyAscii: Integer\)/);assert.ok(compileProject(ide.project).valid);
  await write('module.metadata',{module:'Form1',sourcePath:'src/Form1.pas'});const source=await call('module.read',{module:'Form1'});assert.equal(source.language,'pascal');assert.equal(source.sourcePath,'src/Form1.pas');
  const before=ide.project.modules[0].code;await write('project.update',{language:'vb6'});assert.equal(ide.project.modules[0].code,before);assert.equal(moduleLanguage(ide.project.modules[0],ide.project),'pascal');
});
