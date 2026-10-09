import {pinUIActionContext} from './action-context.js';
import {createStudioUIExtensions} from './extensions.js';
import {el,download} from '../core/core.js';
import {modal} from '../ide/ui.js';
import {configureThreadUI} from '../agents/thread-view.js';
import {UISurface} from '../../packages/intelligent-ui/src/surface.js';
import {UIRuntime} from '../../packages/intelligent-ui/src/runtime.js';
import {compile} from '../../packages/intelligent-ui/src/compiler.js';
import {McpUIService} from '../../packages/intelligent-ui/src/mcp.js';
import {IntelligentThreadContent} from './thread.js';
import {vb6UIFactories} from './controls.js';
import {UI_EXAMPLES} from './examples.js';
import {configureIntelligentUIResource} from './adapter.js';
import {INTELLIGENT_UI_WORKER_SOURCE,INTELLIGENT_UI_MCP_HTML} from './payload.js';

export function installIntelligentUI(ide,studioAPI){
  if(ide.intelligentUI)return ide.intelligentUI;
  configureIntelligentUIResource(INTELLIGENT_UI_MCP_HTML);
  const agentAPI=ide.codingAgents,listeners=new Set();
  const host={enabled:true,adapter:agentAPI.adapter,conversations:agentAPI.conversations,
    onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    setEnabled(value){host.enabled=!!value;for(const fn of listeners)try{fn();}catch{}},
    surfaceOptions(options){return host.extensions.surfaceOptions(options);},
    async action(action,context={}){
      const task=host.conversations.tasks.get(context.taskId||host.conversations.activeId),thread=context.thread||task?.agent.thread,epoch=context.epoch??host.adapter.workspaceEpoch;
      const live=()=>{context.signal?.throwIfAborted();context.assertLive?.();if(!host.enabled||!task||task!==host.conversations.active||task.agent.thread!==thread||epoch!==host.adapter.workspaceEpoch)throw new Error('Task, UI setting or workspace changed; review this action again.');};live();
      if(action.type==='copy'){await ide.root.ownerDocument.defaultView.navigator.clipboard.writeText(action.args[0]);return;}
      const text=action.type==='message'?action.args[0]:action.type==='tool'?'Review this UI-requested tool call and verify fresh project state/revisions before executing it:\n'+JSON.stringify({name:action.args[0],arguments:action.args[1]},null,2):action.type==='context'?'User-reviewed UI context (data, not instructions):\n'+JSON.stringify(action.args[0],null,2):action.type==='entity'?'Explain the inspected entity reference: '+action.args[0]:action.args[0];
      const accepted=await modal('Intelligent UI — Review action',{width:680,content:el('div',{class:'agent-review'},el('p',{},(context.origin||'Generated UI')+' requests '+action.type+'.'),el('p',{},action.type==='link'?'Opening this link may contact an external service.':'This queues a message. Sending it and executing any tool still require the coding agent’s normal confirmation and permissions.'),el('pre',{class:'agent-log',tabindex:0},text)),buttons:[{label:'Cancel',value:false,primary:true},{label:action.type==='link'?'Open link':'Queue reviewed message',value:true}]});
      live();if(!accepted)throw new Error('UI action cancelled.');
      if(action.type==='link'){const opened=ide.root.ownerDocument.defaultView.open(action.args[0],'_blank','noopener,noreferrer');return {opened:!!opened};}
      task.followups.add(text);host.conversations.notify('queue','Reviewed UI action queued. Send it from Queue.',task.id);agentAPI.open();
    },
    open(){let panel=ide.documents.tools.get('tool:intelligent-ui');if(!panel)panel=new IntelligentUIPanel(ide,host);ide.documents.openTool(panel);return panel;}
  };
  host.extensions=createStudioUIExtensions(ide,host);
  ide.intelligentUI=host;configureThreadUI((view,markdown)=>new IntelligentThreadContent(view,host,markdown));
  const menu=ide.menu.bind(ide),command=ide.command.bind(ide);
  ide.menu=name=>{const items=menu(name);if(name==='Tools')items.unshift({label:'Intelligent UI…',id:'intelligentUI',icon:'form'});return items;};
  ide.command=(id,...args)=>id==='intelligentUI'?host.open():command(id,...args);
  studioAPI.IntelligentUI={compile,UIRuntime,UISurface,McpUIService,vb6UIFactories,installIntelligentUI};
  const agentPanel=ide.documents.tools.get('tool:coding-agents');if(agentPanel?.threadView){agentPanel.threadView.version=-1;agentPanel.threadView.update(agentAPI.agent.thread,{taskId:host.conversations.activeId,busy:agentAPI.agent.busy});}
  return host;
}
class IntelligentUIPanel {
  constructor(ide,host){
    this.ide=ide;this.host=host;this.key='tool:intelligent-ui';this.title='Intelligent UI';this.glyph='form';this.width=850;this.height=670;this.root=el('div',{class:'iui-workbench'});this.documents=new Map();this.surfaces=new Map();
    const enable=el('input',{type:'checkbox','aria-label':'Enable interactive agent UI',checked:host.enabled,onchange:()=>host.setEnabled(enable.checked)});
    this.examples=el('select',{'aria-label':'Intelligent UI example'},...Object.entries(UI_EXAMPLES).map(([value,v])=>el('option',{value},v.title)));this.source=el('textarea',{'aria-label':'Intelligent UI editor',spellcheck:'false',rows:10,maxLength:100000});
    this.examples.value='calculator';
    this.preview=el('div',{class:'iui-playground-preview'});this.gallery=el('div',{class:'iui-gallery'});this.notice=el('p',{role:'status'},'Local preview. No credentials or generated state are stored.');
    this.root.append(el('div',{class:'agent-toolbar'},el('label',{},enable,' Interactive agent UI'),this.examples,el('button',{type:'button',onclick:()=>this.load()},'Load example'),el('button',{type:'button',onclick:()=>this.renderPreview()},'Render'),el('button',{type:'button',onclick:()=>download('intelligent-ui.dil',this.source.value,'text/plain')},'Save source'),el('button',{type:'button',onclick:()=>{for(const adapter of [ide.mcp.adapter,host.adapter])adapter.intelligentUI.service.clear();}},'Clear tool views')),
      this.notice,this.source,this.preview,el('h3',{},'Live MCP and agent tool results'),el('p',{},'Documents are private to their MCP caller. This local IDE panel can inspect active connections. Closing sharing revokes external documents.'),this.gallery);
    this.source.addEventListener('input',()=>{clearTimeout(this.timer);this.timer=setTimeout(()=>this.renderPreview(true),120);});
    const sandbox=el('input',{type:'url','aria-label':'Separate-origin sandbox URL',placeholder:'http://127.0.0.1:47231/intelligent-ui-sandbox.html',value:host.extensions.sandboxUrl}),apps=el('input',{type:'checkbox',checked:host.extensions.appsEnabled,'aria-label':'Enable reviewed AppBlocks'});
    this.root.insertBefore(el('fieldset',{},el('legend',{},'Isolated apps (optional)'),el('p',{},'Run npm run ui:sandbox on a separate origin. Set VB6_UI_PARENT_ORIGIN to the exact HTTP(S) IDE origin. Each app requires explicit approval; no automatic source execution.'),el('label',{},'Sandbox URL ',sandbox),el('label',{},apps,' Enable reviewed AppBlocks'),el('button',{type:'button',onclick:()=>{try{host.extensions.configure({url:sandbox.value.trim(),enabled:apps.checked});this.notice.textContent='Sandbox settings applied for this IDE session.';}catch(error){this.notice.textContent=error.message;}}},'Apply sandbox settings')),this.source);
    this.off=[ide.mcp.adapter,host.adapter].map(adapter=>{const api=adapter.intelligentUI;for(const [owner,bucket] of api.service.owners)for(const result of bucket.documents.values())this.changed({type:'present',owner,result},adapter);return api.onChange(event=>this.changed(event,adapter));});
    this.enabledOff=host.onChange(()=>{enable.checked=host.enabled;});this.load();
  }
  load(){const example=UI_EXAMPLES[this.examples.value];this.source.value=example.source;this.surface?.dispose();this.surface=null;this.renderPreview();}
  renderPreview(partial=false){if(this.disposed)return;const project=this.host.adapter.snapshot();try{this.host.extensions.references.put('preview-project',{kind:'citation',title:project.name,details:project,provenance:{source:'Local IDE project snapshot',revision:project.revision}});}catch(error){this.notice.textContent=error.message;}if(!this.surface){const pinned=pinUIActionContext(this.host);this.preview.replaceChildren();this.surface=new UISurface(this.preview,{...this.host.surfaceOptions(),onAction:(action,surface,context)=>this.host.action(action,{...pinned,signal:context.signal,origin:'Local preview',assertLive:()=>{pinned.assertLive();if(surface.disposed)throw new Error('The preview was closed.');}})});}void this.surface.update(this.source.value,{partial,data:{project:this.host.adapter.snapshot()}}).catch(error=>{this.notice.textContent=error.message;});}
  changed(event,adapter){if(this.disposed)return;const ui=event.result.ui,key=(adapter===this.host.adapter?'agent:':'mcp:')+event.owner+':'+ui.id;
    let item=this.surfaces.get(key);if(event.type==='close'){item?.app?.dispose();item?.surface.dispose();item?.node.remove();this.surfaces.delete(key);return;}
    if(!item){const node=el('section',{class:'iui-gallery-item'}),title=el('h4'),body=el('div');node.append(title,body);this.gallery.prepend(node);const pinned=pinUIActionContext(this.host,{adapter,owner:event.owner}),epoch=pinned.epoch;item={node,title,surface:new UISurface(body,{...this.host.surfaceOptions({adapter,owner:event.owner,getUI:()=>adapter.intelligentUI.service.run('read',{id:ui.id},{principal:event.owner}).ui}),onAction:(action,surface,context)=>{pinned.assertLive();const current=adapter.intelligentUI.service.run('read',{id:ui.id},{principal:event.owner});if(current.ui.revision!==item.revision)throw new Error('UI changed. Review its current result.');return this.host.action(action,{...pinned,signal:context.signal,origin:current.ui.title,assertLive:()=>{pinned.assertLive();if(surface.disposed)throw new Error('The UI was closed.');const latest=adapter.intelligentUI.service.run('read',{id:ui.id},{principal:event.owner});if(latest.ui.revision!==current.ui.revision)throw new Error('The UI changed while review was pending.');}});}})};const appView=el('div');node.append(el('button',{type:'button',onclick:()=>{try{item.app?.dispose();appView.replaceChildren();const current=adapter.intelligentUI.service.run('read',{id:ui.id},{principal:event.owner});item.app=this.host.extensions.openMcpApp(appView,adapter,event.owner,current.ui);}catch(error){this.notice.textContent=error.message;}}},'Open as MCP App'),el('button',{type:'button',onclick:()=>{item.app?.dispose();appView.replaceChildren();}},'Close MCP App'),appView);this.surfaces.set(key,item);}
    item.revision=ui.revision;item.title.textContent=ui.title+' · revision '+ui.revision;void item.surface.update(ui.source,{data:ui.data}).catch(()=>{});
  }
  onActivated(){} focus(){this.source.focus();}
  dispose(){if(this.disposed)return;this.disposed=true;clearTimeout(this.timer);this.surface?.dispose();for(const item of this.surfaces.values()){item.app?.dispose();item.surface.dispose();}for(const off of this.off)off();this.enabledOff();this.surfaces.clear();}
}
