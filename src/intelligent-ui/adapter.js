import {McpUIService,MCP_UI_META,MCP_UI_URI,UI_TOOL_SCHEMAS,UI_TOOL_REQUIRED,UI_TOOL_DESCRIPTIONS} from '../../packages/intelligent-ui/src/mcp.js';
import {checkAbort} from '../mcp/protocol.js';

let resourceHtml='';
export function configureIntelligentUIResource(html){resourceHtml=html;}
const inspections=new Set(['vb6.project.get','vb6.module.read','vb6.form.get','vb6.project.compile','vb6.workspace.search','vb6.debug.snapshot']);
/** Called only after a permission-checked inspection has completed successfully. */
export function captureIntelligentUI(adapter,name,result,context){
  if(!inspections.has(name)||!adapter.intelligentUI)return;
  try{adapter.intelligentUI.ensureWorkspace();adapter.intelligentUI.service.capture(name,result,context);}catch{/* Optional display data cannot fail an inspection or exceed its own bounds. */}
}
export function installIntelligentUITools(adapter,{tool}){
  if(adapter.intelligentUI)return adapter.intelligentUI;
  const listeners=new Set();let epoch=adapter.workspaceEpoch;
  const service=new McpUIService({onChange:event=>{for(const fn of listeners)try{fn(event);}catch{}}});
  const api={service,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},ensureWorkspace(){if(epoch!==adapter.workspaceEpoch){service.clear();epoch=adapter.workspaceEpoch;}}};
  adapter.intelligentUI=api;
  for(const method of Object.keys(UI_TOOL_SCHEMAS)){
    tool('vb6.ui.'+method,UI_TOOL_DESCRIPTIONS[method],UI_TOOL_SCHEMAS[method],UI_TOOL_REQUIRED[method],(args,context)=>{api.ensureWorkspace();return service.run(method,args,context);});
    const descriptor=adapter.tools.at(-1);descriptor.annotations.idempotentHint=['catalog','read','list'].includes(method);
    if(['present','update','read'].includes(method))descriptor._meta=MCP_UI_META;
  }
  const resources=adapter.resources.bind(adapter),readResource=adapter.readResource.bind(adapter);
  adapter.resources=async()=>[...await resources(),...service.resources()];
  adapter.readResource=async(uri,context={})=>{if(uri!==MCP_UI_URI)return readResource(uri,context);adapter.assertEnabled();checkAbort(context.signal);service.resourceHtml=resourceHtml;return service.readResource(uri);};
  const revoke=adapter.revokePrincipal?.bind(adapter),revokeAll=adapter.revokeArtifacts?.bind(adapter),dispose=adapter.dispose.bind(adapter);
  adapter.revokePrincipal=owner=>{service.revoke(owner);return revoke?.(owner);};
  adapter.revokeArtifacts=()=>{service.clear();return revokeAll?.();};
  const off=adapter.onChange(()=>api.ensureWorkspace());
  adapter.dispose=()=>{off();service.dispose();listeners.clear();dispose();};
  return api;
}
