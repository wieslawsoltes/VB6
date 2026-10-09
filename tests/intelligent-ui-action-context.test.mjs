import test from 'node:test';
import assert from 'node:assert/strict';
import {pinUIActionContext} from '../src/intelligent-ui/action-context.js';
import {DOMRenderer} from '../packages/intelligent-ui/src/renderer.js';
import {UISurface} from '../packages/intelligent-ui/src/surface.js';
import {AgentPermissionSession} from '../src/agents/permissions.js';
import {createIdeAdapter} from '../src/mcp/ide-adapter.js';
import {newProject} from '../src/project/model.js';
import {Signal} from '../src/core/core.js';

function fixture(adapter={workspaceEpoch:1}) {
  const a={id:'a',agent:{sessionKey:'agent-a',thread:{}}},b={id:'b',agent:{sessionKey:'agent-b',thread:{}}};
  const host={enabled:true,adapter,conversations:{tasks:new Map([['a',a],['b',b]]),active:a}};
  return {host,a,b};
}
test('app actions resolve the originating agent task, not whichever task is active later',()=>{
  const {host,a,b}=fixture(),context=pinUIActionContext(host,{owner:'agent-a'});
  context.assertLive();assert.equal(context.taskId,a.id);assert.equal(context.thread,a.agent.thread);
  host.conversations.active=b;assert.throws(context.assertLive,/different task/);
  const oldView=pinUIActionContext(host,{owner:'agent-a'});assert.equal(oldView.taskId,'a');assert.throws(oldView.assertLive);
  assert.throws(pinUIActionContext(host,{owner:'unknown-agent'}).assertLive);
  host.conversations.active=a;context.assertLive();
});
test('external-connection app follow-ups pin the task selected when the view opens',()=>{
  const {host,a,b}=fixture(),context=pinUIActionContext(host,{adapter:{},owner:'external'});
  assert.equal(context.taskId,a.id);host.conversations.active=b;assert.throws(context.assertLive);
});
for(const change of ['reset','delete','reload','disable'])test('app action pin revokes after '+change,()=>{
  const {host,a}=fixture(),context=pinUIActionContext(host,{owner:'agent-a'});
  if(change==='reset')a.agent.thread={};else if(change==='delete')host.conversations.tasks.delete('a');
  else if(change==='reload')host.adapter.workspaceEpoch++;else host.enabled=false;
  assert.throws(context.assertLive);
});
test('pinned transport preserves the exact session key needed by real agent tool policy',async t=>{
  const ide=new Signal();Object.assign(ide,{project:newProject('UI policy'),runState:'design',markDirty(){},loadProject(p){this.project=p;}});
  const adapter=createIdeAdapter(ide),{host}=fixture(adapter);adapter.setEnabled(true);
  const policy=new AgentPermissionSession({mode:'readonly',permissionMinutes:1},{tools:adapter.tools,projectId:ide.project.id,sessionKey:'agent-a'});
  adapter.permissions.usePolicy(policy);t.after(()=>{policy.revoke();adapter.dispose();});
  const context=pinUIActionContext(host,{owner:'agent-a'}),tool=adapter.tools.find(t=>t.name==='vb6.project.get');
  await assert.rejects(tool.execute({}, {principal:'agent-a'}),/another project or task/);
  const result=await tool.execute({},context.transportContext());assert.equal(result.name,'UI policy');
  const controller=new AbortController();controller.abort();assert.throws(()=>context.transportContext(controller.signal));
});
test('renderer returns the original action outcome rather than acknowledging pending approvals',async()=>{
  let allow;const events=[];const renderer={onAction:()=>new Promise((resolve,reject)=>{allow=reject;}),onError:error=>events.push(error.message)};
  let settled=false;const promise=DOMRenderer.prototype.action.call(renderer,{type:'message',args:['review']});
  promise.then(()=>{settled=true;},()=>{settled=true;});await Promise.resolve();assert.equal(settled,false);
  allow(new Error('Denied by user'));await assert.rejects(promise,/Denied/);assert.deepEqual(events,['Denied by user']);
});
test('surface action forwards trusted cancellation without accepting model authority',async()=>{
  const controller=new AbortController();let seen;
  const surface={disposed:false,options:{onAction:(action,view,context)=>{seen=context;return 42;}}};
  assert.equal(UISurface.prototype.action.call(surface,{type:'message',args:['review']},{signal:controller.signal,grantAll:true}),42);
  assert.equal(seen.signal,controller.signal);assert.equal(seen.grantAll,undefined);
  controller.abort();assert.throws(()=>UISurface.prototype.action.call(surface,{type:'message',args:['review']},{signal:controller.signal}));
});
