import {UIReferenceProviders} from '../../packages/intelligent-ui/src/reference-providers.js';
import {McpUIService,MCP_UI_META,MCP_UI_URI,UI_TOOL_SCHEMAS,UI_TOOL_REQUIRED,UI_TOOL_DESCRIPTIONS} from '../../packages/intelligent-ui/src/mcp.js';
import {McpError,checkAbort} from '../mcp/protocol.js';

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
  const referenceProviders=new UIReferenceProviders({approve:(request,context)=>adapter.approveAgentOperation?.({name:'vb6.ui.resolveReference',arguments:request,peer:context.owner,projectName:adapter.snapshot().name},context)||false});
  let referenceSequence=0;
  const api={service,referenceProviders,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},ensureWorkspace(){if(epoch!==adapter.workspaceEpoch){service.clear();referenceProviders.cancelAll();epoch=adapter.workspaceEpoch;}}};
  adapter.intelligentUI=api;
  for(const method of Object.keys(UI_TOOL_SCHEMAS)){
    tool('vb6.ui.'+method,UI_TOOL_DESCRIPTIONS[method],UI_TOOL_SCHEMAS[method],UI_TOOL_REQUIRED[method],(args,context)=>{api.ensureWorkspace();const result=service.run(method,args,context);return method==='catalog'?{...result,referenceProviders:referenceProviders.list()}:result;});
    const descriptor=adapter.tools.at(-1);descriptor.annotations.idempotentHint=['catalog','read','list'].includes(method);
    if(['present','update','read'].includes(method))descriptor._meta=MCP_UI_META;
  }
  tool('vb6.ui.resolveReference','Resolve an image, entity or citation using an explicitly configured host provider. Requires exact query approval; may contact an external provider. Returned provenance comes from the trusted provider, not generated markup.',{provider:{type:'string',minLength:1,maxLength:64},query:{type:'string',minLength:1,maxLength:2000}},['provider','query'],async(args,context)=>{
    api.ensureWorkspace();const start=adapter.workspaceEpoch,owner=service.identity(context);
    if(adapter.permissions?.policy?.config.approvalPolicy==='never')throw new McpError(-32001,'Reference queries require exact local approval; Never ask denies this operation.');
    let reference;try{reference=await referenceProviders.resolve(args.provider,args.query,{owner,signal:context.signal});}
    catch(error){if(error.code==='denied')throw new McpError(-32001,'The local user declined the reference query.');throw error;}
    checkAbort(context.signal);adapter.assertEnabled();if(start!==adapter.workspaceEpoch)throw new Error('Reference workspace changed.');
    const id='host-ref-'+(++referenceSequence);service.publishReference(id,reference,context);return {id,reference};
  },{open:true});
  const resources=adapter.resources.bind(adapter),readResource=adapter.readResource.bind(adapter);
  adapter.resources=async()=>[...await resources(),...service.resources()];
  adapter.readResource=async(uri,context={})=>{if(uri!==MCP_UI_URI)return readResource(uri,context);adapter.assertEnabled();checkAbort(context.signal);service.resourceHtml=resourceHtml;return service.readResource(uri);};
  const revoke=adapter.revokePrincipal?.bind(adapter),revokeAll=adapter.revokeArtifacts?.bind(adapter),dispose=adapter.dispose.bind(adapter);
  adapter.revokePrincipal=owner=>{referenceProviders.revoke(owner);service.revoke(owner);return revoke?.(owner);};
  adapter.revokeArtifacts=()=>{referenceProviders.cancelAll();service.clear();return revokeAll?.();};
  const off=adapter.onChange(()=>api.ensureWorkspace());
  adapter.dispose=()=>{off();referenceProviders.dispose();service.dispose();listeners.clear();dispose();};
  return api;
}
