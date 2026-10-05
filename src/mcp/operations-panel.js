import {el} from '../core/core.js';

const button = (label, onclick) => el('button',{type:'button',onclick},label);
/** Local owner controls only. No task/credential enumeration is exposed over MCP. */
export class McpOperationsView {
  constructor(api) {
    this.api=api; this.disposed=false; this.pending=false;
    this.taskList=el('select',{size:6,'aria-label':'Retained MCP tasks'});
    this.artifactList=el('select',{size:6,'aria-label':'Retained MCP build artifacts'});
    this.taskDetails=el('pre',{class:'mcp-description',tabindex:0,'aria-label':'MCP task details'});
    this.artifactDetails=el('pre',{class:'mcp-description',tabindex:0,'aria-label':'MCP artifact details'});
    this.summary=el('span',{class:'tool-note',role:'status','aria-live':'polite'});
    this.cancel=button('Cancel selected task',()=>this.api.server.tasks.cancelLocal(this.taskList.value));
    this.clear=button('Clear finished tasks',()=>this.api.server.tasks.clearFinished());
    this.release=button('Release selected artifact',()=>this.api.adapter.releaseArtifactLocal(this.artifactList.value));
    this.releaseAll=button('Release all artifacts',()=>this.api.adapter.revokeArtifacts());
    const section=(title,list,detail,actions)=>el('fieldset',{},el('legend',{},title),
      el('div',{class:'mcp-operation-grid'},list,detail),el('div',{class:'mcp-actions'},...actions));
    this.root=el('div',{class:'mcp-page mcp-operations-page'},this.summary,
      section('Agent tasks',this.taskList,this.taskDetails,[this.cancel,this.clear]),
      section('Build downloads',this.artifactList,this.artifactDetails,[this.release,this.releaseAll]),
      el('p',{class:'tool-note'},'These controls belong to the local IDE owner. Task arguments, results, credentials and client identities are not displayed. Clearing a task or releasing an artifact makes its handle unavailable to agents. No generated program is run.'));
    this.taskList.addEventListener('change',()=>this.details()); this.artifactList.addEventListener('change',()=>this.details());
    this.offTasks=api.server.tasks.onChange(()=>this.schedule());
    this.offArtifacts=api.adapter.onArtifactsChange(()=>this.schedule()); this.refresh();
  }
  schedule() {
    if(this.disposed||this.pending)return;
    this.pending=true;
    queueMicrotask(()=>{this.pending=false;if(!this.disposed)this.refresh();});
  }
  renderList(list,items,key,label) {
    const previous=list.value;
    list.replaceChildren(...items.map(item=>el('option',{value:item[key]},label(item))));
    list.value=items.some(item=>item[key]===previous)?previous:items[0]?.[key]||'';
  }
  refresh() {
    if(this.disposed)return;
    this.tasks=this.api.server.tasks.inspect();this.artifacts=this.api.adapter.inspectArtifacts();
    const signature=JSON.stringify([this.tasks,this.artifacts]);if(signature===this.signature)return;this.signature=signature;
    this.renderList(this.taskList,this.tasks,'taskId',t=>t.toolName+' — '+t.status);
    this.renderList(this.artifactList,this.artifacts,'artifactId',a=>a.name+' — '+a.size.toLocaleString()+' bytes');
    const working=this.tasks.filter(t=>['working','input_required'].includes(t.status)).length;
    this.summary.textContent=this.tasks.length+' retained tasks ('+working+' active) · '+this.artifacts.length+' build artifacts';
    this.clear.disabled=!this.tasks.some(t=>!['working','input_required'].includes(t.status));this.releaseAll.disabled=!this.artifacts.length;
    this.details();
  }
  details() {
    const task=this.tasks?.find(t=>t.taskId===this.taskList.value),artifact=this.artifacts?.find(a=>a.artifactId===this.artifactList.value);
    this.taskDetails.textContent=task?JSON.stringify(task,null,2):'No retained task selected.';
    this.artifactDetails.textContent=artifact?JSON.stringify(artifact,null,2):'No build artifact selected.';
    this.cancel.disabled=!task||!['working','input_required'].includes(task.status);this.release.disabled=!artifact;
  }
  dispose() { this.disposed=true;this.offTasks?.();this.offArtifacts?.(); }
}
