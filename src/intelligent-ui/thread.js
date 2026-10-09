import {UISurface} from '../../packages/intelligent-ui/src/surface.js';
import {splitUIMessage} from '../../packages/intelligent-ui/src/message.js';

const snapshots=new WeakMap();
/** Optional rich-content seam; ordinary Markdown and user messages are never interpreted. */
export class IntelligentThreadContent {
  constructor(view,host,markdown){this.view=view;this.host=host;this.markdown=markdown;this.entries=new Map();this.off=host.onChange(()=>{for(const record of view.nodes.values())record.version=-1;view.version=-1;view.update(view.thread,view.options);});}
  state(){let state=snapshots.get(this.view.thread);if(!state){state=new Map();snapshots.set(this.view.thread,state);}return state;}
  entry(item,record){let entry=this.entries.get(item.id);if(!entry){entry={thread:this.view.thread,record,parts:new Map(),taskId:this.view.options.taskId,epoch:this.host.adapter.workspaceEpoch};this.entries.set(item.id,entry);}return entry;}
  surface(entry,id,node,ui){
    const task=this.host.conversations.tasks.get(entry.taskId),thread=entry.thread,epoch=entry.epoch;
    const surface=new UISurface(node,{...this.host.surfaceOptions({owner:task?.agent.sessionKey,ui,assertLive:()=>{if(task!==this.host.conversations.active||task?.agent.thread!==thread)throw new Error('Switch to the owning task to use this view.');}}),snapshot:this.state().get(id),onAction:(action,view,context)=>{
      if(!task||task!==this.host.conversations.active||task.agent.thread!==thread||this.host.adapter.workspaceEpoch!==epoch)throw new Error('This UI belongs to a different task or project session.');
      if(ui){const current=this.host.adapter.intelligentUI.service.run('read',{id:ui.id},{sessionKey:task.agent.sessionKey});if(current.ui.revision!==ui.revision)throw new Error('This UI result is obsolete. Use its latest result.');}
      return this.host.action(action,{taskId:task.id,thread,epoch,signal:context.signal,origin:ui?.title||'Agent response',assertLive:()=>{if(surface.disposed)throw new Error('This UI was closed while review was pending.');if(ui&&this.host.adapter.intelligentUI.service.run('read',{id:ui.id},{sessionKey:task.agent.sessionKey}).ui.revision!==ui.revision)throw new Error('The UI changed while review was pending.');}});
    }});return surface;
  }
  renderAssistant(item,record){
    if(!this.host.enabled){this.remove(item.id);return false;}
    const parts=splitUIMessage(item.text);if(!parts.some(p=>p.kind==='ui')){this.remove(item.id);return false;}
    const entry=this.entry(item,record);if(!entry.mounted){record.body.replaceChildren();entry.mounted=true;}
    const keep=new Set();let previous=null,number=0;
    for(const part of parts){const id=item.id+':'+part.id;keep.add(id);let value=entry.parts.get(id);
      if(!value){const node=record.body.ownerDocument.createElement('div');value={node,kind:part.kind};entry.parts.set(id,value);}
      if(part.kind==='ui'&&++number<=8){if(!value.surface)value.surface=this.surface(entry,id,value.node);if(value.source!==part.source||value.partial!==part.partial){value.source=part.source;value.partial=part.partial;void value.surface.update(part.source,{partial:part.partial}).catch(()=>{});}}
      else if(value.text!==part.text||part.kind==='ui'){value.text=part.text;this.markdown(value.node,part.text||'Additional interactive blocks are shown as source:\n```\n'+part.source+'\n```');}
      const expected=previous?previous.nextSibling:record.body.firstChild;if(value.node!==expected)record.body.insertBefore(value.node,expected);previous=value.node;
    }
    for(const [id,value] of entry.parts)if(!keep.has(id)){value.surface?.dispose();value.node.remove();entry.parts.delete(id);}
    return true;
  }
  renderTool(item,record){
    if(!this.host.enabled||!/^vb6\.ui\.(present|update|read)$/.test(item.text)||item.status!=='complete'){this.remove(item.id);return;}
    let result;try{result=JSON.parse(item.result);}catch{return;}const ui=result?.ui;if(ui?.version!==1||typeof ui.source!=='string')return;
    const entry=this.entry(item,record),id=item.id+':tool',stamp=ui.id+':'+ui.revision;let value=entry.parts.get(id);
    if(value?.stamp===stamp)return;if(value){value.surface.dispose();value.node.remove();}
    const node=record.body.ownerDocument.createElement('div');node.className='agent-intelligent-result';record.body.append(node);const surface=this.surface(entry,id,node,ui);entry.parts.set(id,{node,surface,stamp});record.node.open=true;
    void surface.update(ui.source,{data:ui.data||{}}).catch(()=>{});
  }
  remove(id){const entry=this.entries.get(id);if(!entry)return;let state=snapshots.get(entry.thread);if(!state){state=new Map();snapshots.set(entry.thread,state);}
    for(const [key,value] of entry.parts){if(value.surface){const snapshot=value.surface.snapshot();if(snapshot)state.set(key,snapshot);value.surface.dispose();}value.node.remove();}
    // One task's cached local state is bounded separately from its public thread.
    while(state.size>32||JSON.stringify([...state]).length>500000)state.delete(state.keys().next().value);
    entry.record.formatted=false;this.entries.delete(id);
  }
  clear(){for(const id of [...this.entries.keys()])this.remove(id);}
  dispose(){this.clear();this.off();}
}
