import test from 'node:test';
import assert from 'node:assert/strict';
import {createUIActionHandler} from '../src/intelligent-ui/actions.js';
import {AgentFollowups} from '../src/agents/followups.js';
import {UIModelContextStore,prepareDownloads} from '../packages/intelligent-ui/src/content.js';
import {readUIResource} from '../src/intelligent-ui/resources.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {CodingAgent} from '../src/agents/agent.js';
import {newProject} from '../src/project/model.js';
import {Signal} from '../src/core/core.js';
const image={type:'image',mimeType:'image/png',data:'AQID'};
function hostFixture(review=async()=>true){
 const task={id:'a',agent:{thread:{},uiContexts:new UIModelContextStore(),uiContextEpoch:1},followups:new AgentFollowups()};
 const host={enabled:true,adapter:{workspaceEpoch:1},conversations:{activeId:'a',active:task,tasks:new Map([['a',task]]),notify(){}}};
 const action=createUIActionHandler(host,{review,copy:async()=>{},openLink:async()=>{}});return {host,task,action};
}
test('reviewed rich actions preserve immutable attachment bytes until explicit queue removal',async()=>{
 const {task,action}=hostFixture();const input=structuredClone(image);await action({type:'messageContent',args:[[input]]});input.data='BAUG';
 assert.equal(task.followups.items[0].content[0].data,'AQID');assert.throws(()=>{task.followups.items[0].content[0].data='BAUG';});
 const item=task.followups.items[0];task.followups.removeAttachments(item.id,item.version);assert.equal(task.followups.items[0].content,undefined);assert.equal(task.followups.matches(item),false);
});
test('context updates replace one owning view, never queue messages, and empty context clears',async()=>{
 const {task,action}=hostFixture();for(const n of [1,2])await action({type:'context',args:[{structuredContent:{n}}]},{viewId:'view'});
 assert.equal(task.followups.items.length,0);assert.equal(task.agent.uiContexts.entries.size,1);assert.equal(task.agent.uiContexts.snapshot()[0].structuredContent.n,2);
 await action({type:'context',args:[{}]},{viewId:'view'});assert.equal(task.agent.uiContexts.entries.size,0);
 await assert.rejects(action({type:'context',args:[{}]}),/owning UI view/);
});
test('cancelled or switched-task approvals cannot queue content or set model context',async()=>{
 let allow;const {host,task,action}=hostFixture(()=>new Promise(r=>allow=r));const controller=new AbortController();
 const pending=action({type:'messageContent',args:[[image]]},{signal:controller.signal});controller.abort();allow(true);await assert.rejects(pending);assert.equal(task.followups.items.length,0);
 const next=action({type:'context',args:[{structuredContent:{n:1}}]},{viewId:'view'});host.conversations.active={};allow(true);await assert.rejects(next);assert.equal(task.agent.uiContexts.entries.size,0);
});
test('download resolution uses exact permission-checked readers and stages all files first',async()=>{
 let reads=0;const adapter={assertEnabled(){},tools:[{name:'vb6.code.read',execute:async(args,c)=>{reads++;assert.equal(c.sessionKey,'session');return {code:'Option Explicit',hasMore:false,revision:1,offset:0,nextOffset:15};}}]};
 const uri='vb6://module/Form1/source',context={sessionKey:'session'};
 const files=await prepareDownloads([{type:'resource_link',uri,name:'Form1.bas'}],{resourceUris:[uri],readResource:u=>readUIResource(adapter,u,context,[uri])});
 assert.equal(new TextDecoder().decode(files[0].bytes),'Option Explicit');assert.equal(reads,1);
 await assert.rejects(readUIResource(adapter,'vb6://output',context,[uri]),/outside/);assert.equal(reads,1);
 adapter.tools[0].execute=async()=>({code:'partial',hasMore:true});await assert.rejects(readUIResource(adapter,uri,context,[uri]),/Inconsistent/);
});
test('MCP resolved references are caller-private and immutable in existing UI documents',async t=>{
 const ide=new Signal();Object.assign(ide,{project:newProject('References'),runState:'design',markDirty(){},loadProject(p){this.project=p;}});
 const adapter=createIdeAdapter(ide,{approve:async()=>true});t.after(()=>adapter.dispose());adapter.setEnabled(true);
 adapter.intelligentUI.referenceProviders.register('trusted',{resolve:async()=>({kind:'citation',title:'Observed',provenance:{source:'Approved provider'},details:'Exact'})});
 const call=(name,args,principal='alice')=>adapter.tools.find(t=>t.name===name).execute(args,{principal,sessionKey:principal});
 const ref=await call('vb6.ui.resolveReference',{provider:'trusted',query:'topic'});assert.equal(adapter.intelligentUI.service.reference(ref.id,{principal:'bob'}),null);
 const result=await call('vb6.ui.present',{source:'<Cite ref="'+ref.id+'"/>'});assert.equal(result.ui.references[ref.id].title,'Observed');
 adapter.revokePrincipal('alice');assert.equal(adapter.intelligentUI.service.reference(ref.id,{principal:'alice'}),null);assert.equal(result.ui.references[ref.id].title,'Observed');
});
for(const provider of ['openai','anthropic','google'])test(provider+': real coding-agent request includes attachments and latest context without storing duplicate context',async t=>{
 const ide=new Signal();Object.assign(ide,{project:newProject('Content'),runState:'design',markDirty(){},loadProject(p){this.project=p;}});const adapter=createIdeAdapter(ide);t.after(()=>adapter.dispose());
 const agent=new CodingAgent(adapter);agent.uiContexts.set('view',{structuredContent:{selection:'new'}});let received;
 await agent.run({provider,model:'test',prompt:'Inspect',content:[image],mode:'readonly',transport:async(body,{receive})=>{received=body;if(provider==='openai')receive({status:'completed',output:[],usage:{input_tokens:1,output_tokens:1}});else if(provider==='anthropic')receive({content:[{type:'text',text:'Done'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}});else receive({candidates:[{content:{parts:[{text:'Done'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:1,candidatesTokenCount:1}});}});
 assert.match(JSON.stringify(received),/AQID/);assert.match(JSON.stringify(received),/Latest user-reviewed UI context/);assert.doesNotMatch(JSON.stringify(agent.history),/Latest user-reviewed UI context/);
 agent.reset();assert.equal(agent.uiContexts.entries.size,0);
});

test('source resource paging pins revisions and rejects a mixed or changed workspace',async()=>{
 let calls=0;const uri='vb6://module/Form1/source';const adapter={workspaceEpoch:1,assertEnabled(){},tools:[{name:'vb6.code.read',execute:async args=>{calls++;if(calls===1)return {revision:7,code:'a',offset:0,nextOffset:1,hasMore:true};assert.equal(args.expectedRevision,7);return {revision:7,code:'b',offset:1,nextOffset:2,hasMore:false};}}]};
 assert.equal((await readUIResource(adapter,uri,{},[uri])).contents[0].text,'ab');
 adapter.tools[0].execute=async()=>{adapter.workspaceEpoch++;return {revision:8,code:'x',offset:0,nextOffset:1,hasMore:false};};await assert.rejects(readUIResource(adapter,uri,{},[uri]),/Workspace changed/);
});

test('reference query denial uses the coding-agent terminal permission code',async t=>{
 const ide=new Signal();Object.assign(ide,{project:newProject('Denied'),runState:'design',markDirty(){},loadProject(p){this.project=p;}});
 let queries=0;const adapter=createIdeAdapter(ide,{approve:async()=>false});t.after(()=>adapter.dispose());adapter.setEnabled(true);
 adapter.intelligentUI.referenceProviders.register('trusted',{resolve:async()=>{queries++;return {kind:'citation',title:'Never called',provenance:{source:'provider'}};}});
 await assert.rejects(adapter.tools.find(t=>t.name==='vb6.ui.resolveReference').execute({provider:'trusted',query:'Denied query'},{principal:'caller'}),error=>error.code===-32001);
 assert.equal(queries,0);
});
