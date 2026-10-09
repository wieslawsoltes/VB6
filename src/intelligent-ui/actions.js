import {normalizeContentBlocks, normalizeModelContext, contentSummary} from '../../packages/intelligent-ui/src/content.js';
import {safeUrl} from '../../packages/intelligent-ui/src/safety.js';

/** Review once, then recheck task/view/signal immediately before every effect. */
export function createUIActionHandler(host,{review,copy,openLink,openAgent=()=>{}}){
  return async(action,context={})=>{
    const task=host.conversations.tasks.get(context.taskId||host.conversations.activeId),thread=context.thread||task?.agent.thread,epoch=context.epoch??host.adapter.workspaceEpoch;
    const live=()=>{context.signal?.throwIfAborted();context.assertLive?.();if(!host.enabled||!task||task!==host.conversations.active||task.agent.thread!==thread||epoch!==host.adapter.workspaceEpoch)throw new Error('Task, UI setting or workspace changed; review this action again.');};live();
    if(action.type==='copy'){await copy(action.args[0]);return {};}
    let content=null,value=null;
    if(action.type==='messageContent')content=normalizeContentBlocks(action.args[0],{allowEmpty:false});
    if(action.type==='context'){
      const v=action.args[0];value=normalizeModelContext(v&&('content'in v||'structuredContent'in v)?v:{structuredContent:v});
      if(!context.viewId)throw new Error('Model context requires an owning UI view.');
    }
    const url=action.type==='link'?safeUrl(action.args[0]):null;
    const text=content?contentSummary(content):value?JSON.stringify(value.structuredContent||{},null,2)+(value.content?'\n'+contentSummary(value.content):''):action.type==='message'?action.args[0]:action.type==='tool'?'Review this UI-requested tool call and verify fresh project state/revisions before executing it:\n'+JSON.stringify({name:action.args[0],arguments:action.args[1]},null,2):action.type==='entity'?'Explain the inspected entity reference: '+action.args[0]:url;
    if(typeof text!=='string')throw new Error('Unsupported UI action.');
    const contextRevision=task.agent.uiContexts?.revision;
    const accepted=await review({type:action.type,origin:context.origin||'Generated UI',text,content,context:value,signal:context.signal});
    live();if(!accepted)throw new Error('UI action cancelled.');
    if(url){await openLink(url);return {};}
    if(value){
      if(task.agent.uiContexts.revision!==contextRevision)throw new Error('UI context changed during approval; review it again.');
      if(task.agent.uiContextEpoch!==epoch){task.agent.uiContexts.clear();task.agent.uiContextEpoch=epoch;}
      // Empty content/context clears a view; it does not create a queued prompt.
      if(!value.content?.length&&!Object.keys(value.structuredContent||{}).length)task.agent.uiContexts.delete(context.viewId);
      else task.agent.uiContexts.set(context.viewId,value);
      host.conversations.notify('context','Reviewed UI context replaced for the next confirmed run.',task.id);return {};
    }
    task.followups.add(content?'User-reviewed app content.':text,content?{content}:{});
    host.conversations.notify('queue','Reviewed UI action queued. Send it from Queue.',task.id);openAgent();return {};
  };
}
