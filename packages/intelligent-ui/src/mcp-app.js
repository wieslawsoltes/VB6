import {UIError, boundedData, record, safeUrl} from './safety.js';
import {normalizeContentBlocks, normalizeModelContext} from './content.js';
import {DISPLAY_MODES} from './display-mode.js';
import {UISurface, normalizeAction} from './surface.js';

export const MCP_APP_VERSION='2026-01-26';
/** App-side MCP Apps transport. The parent host remains responsible for sandboxing and authorization. */
export class McpAppClient {
  constructor({window=globalThis,hostOrigin='*',timeout=10000,onNotification=()=>{},onTeardown=()=>{},appInfo={name:'VB6 Intelligent UI',version:'0.1.0'},displayModes=DISPLAY_MODES,tools=[],onToolCall}={}){
    this.appInfo=boundedData(appInfo,2000);this.displayModes=[...displayModes];this.tools=new Map();this.onToolCall=onToolCall;this.active=new Map();this.life=new AbortController();this.setTools(tools);
    this.window=window;this.parent=window.parent;this.hostOrigin=hostOrigin;this.timeout=timeout;this.onNotification=onNotification;this.onTeardown=onTeardown;this.pending=new Map();this.sequence=0;this.ready=false;this.disposed=false;
    this.listener=event=>void this.receive(event);window.addEventListener('message',this.listener);
  }
  send(message){if(this.disposed)throw new UIError('disposed','MCP App transport is disposed.');this.parent.postMessage(message,this.hostOrigin);}
  request(method,params={}){if(this.disposed)return Promise.reject(new UIError('disposed','MCP App transport is disposed.'));if(this.pending.size>=32)return Promise.reject(new UIError('queue','MCP App request limit reached.'));const id='iui-'+(++this.sequence);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new UIError('timeout','MCP App host did not respond.'));},this.timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({jsonrpc:'2.0',id,method,params:boundedData(params,500000,{maxText:192000})});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});}
  notify(method,params){if(this.ready)this.send({jsonrpc:'2.0',method,params});}
  async connect(){if(this.parent===this.window)throw new UIError('host','Open this resource through an MCP Apps host.');const result=await this.request('ui/initialize',{appInfo:this.appInfo,appCapabilities:{availableDisplayModes:this.displayModes,...(this.onToolCall?{tools:{listChanged:true}}:{})},protocolVersion:MCP_APP_VERSION});if(result.protocolVersion!==MCP_APP_VERSION)throw new UIError('version','Unsupported MCP Apps protocol version.');this.context=result.hostContext||{};this.capabilities=result.hostCapabilities||{};this.ready=true;this.send({jsonrpc:'2.0',method:'ui/notifications/initialized'});return result;}
  async receive(event){
    if(this.disposed||event.source!==this.parent||this.hostOrigin!=='*'&&event.origin!==this.hostOrigin)return;let message;
    try{message=boundedData(event.data,600000,{maxText:250000});}catch{return;}if(!record(message)||message.jsonrpc!=='2.0')return;
    if(message.id!==undefined&&!message.method){const pending=this.pending.get(message.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(message.id);if(message.error)pending.reject(new UIError('host',String(message.error.message||'Host rejected the request.')));else pending.resolve(message.result);return;}
    if(message.method==='ping'&&message.id!==undefined){this.send({jsonrpc:'2.0',id:message.id,result:{}});return;}
    if(message.method==='ui/resource-teardown'&&message.id!==undefined){this.life.abort();try{const pending=this.onTeardown();if(pending?.then)await pending;}finally{this.send({jsonrpc:'2.0',id:message.id,result:{}});this.dispose();}return;}
    if(!this.ready)return;
    if(message.method==='ui/notifications/host-context-changed')this.context={...this.context,...message.params};
    if(message.id!==undefined){
      if(!(typeof message.id==='string'&&message.id.length<=128||Number.isSafeInteger(message.id))||this.active.has(message.id)||this.active.size>=16)return;
      const control=new AbortController();this.active.set(message.id,control);
      try{
        this.life.signal.throwIfAborted();let result;
        if(message.method==='tools/list'&&this.onToolCall)result={tools:[...this.tools.values()]};
        else if(message.method==='tools/call'&&this.onToolCall){
          const params=message.params||{};if(!this.tools.has(params.name)||!record(params.arguments||{}))throw new UIError('tool','Unknown app tool or invalid arguments.');
          result=await this.onToolCall(params.name,params.arguments||{},{signal:AbortSignal.any([this.life.signal,control.signal])});
          control.signal.throwIfAborted();this.life.signal.throwIfAborted();
          if(!record(result))throw new UIError('tool','App tool must return an MCP tool result.');
          if(result.content!==undefined)normalizeContentBlocks(result.content);
        }else throw new UIError('method','Unsupported app request.');
        this.send({jsonrpc:'2.0',id:message.id,result:boundedData(result,500000,{maxText:192000})});
      }catch(error){if(!this.disposed)this.send({jsonrpc:'2.0',id:message.id,error:{code:error.code==='method'?-32601:-32000,message:String(error.message||error).slice(0,1000)}});}
      finally{this.active.delete(message.id);}return;
    }
    if(message.method==='notifications/cancelled'){this.active.get(message.params?.requestId)?.abort();return;}
    if(message.method==='ui/notifications/tool-cancelled')this.life.abort();
    try{Promise.resolve(this.onNotification(message.method,message.params||{})).catch(()=>{});}catch{}
  }
  setTools(tools){
    const list=boundedData(tools,64000);if(!Array.isArray(list)||list.length>32||list.some(t=>!record(t)||typeof t.name!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(t.name)||!record(t.inputSchema))||new Set(list.map(t=>t.name)).size!==list.length)throw new UIError('tools','Invalid app tool catalog.');
    this.tools=new Map(list.map(t=>[t.name,t]));if(this.ready)this.notify('notifications/tools/list_changed',{});
  }
  sendMessage(content){return this.request('ui/message',{role:'user',content:normalizeContentBlocks(content,{allowEmpty:false})});}
  updateModelContext(context){return this.request('ui/update-model-context',normalizeModelContext(context));}
  requestDisplayMode(mode){
    if(!this.ready||!this.displayModes.includes(mode)||!this.context.availableDisplayModes?.includes(mode))return Promise.reject(new UIError('display','Display mode was not negotiated.'));
    return this.request('ui/request-display-mode',{mode});
  }
  downloadFile(contents){return this.request('ui/download-file',{contents:normalizeContentBlocks(contents,{types:['resource','resource_link'],allowEmpty:false})});}
  dispose(){if(this.disposed)return;this.disposed=true;this.life.abort();for(const control of this.active.values())control.abort();this.active.clear();this.window.removeEventListener('message',this.listener);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new UIError('disposed','MCP App transport closed.'));}this.pending.clear();}
}
export function startMcpApp({root=globalThis.document?.getElementById('intelligent-ui-root')}={}){
  if(!root)throw new UIError('root','MCP App root is missing.');const win=root.ownerDocument.defaultView;let surface,lastUI=null,cancelled=false,observer=null;
  const status=root.ownerDocument.createElement('p');status.textContent='Connecting to MCP Apps host…';root.append(status);const host=root.ownerDocument.createElement('div');root.append(host);
  const context=value=>{root.dataset.theme=value.theme||'light';const vars=value.styles?.variables||{};for(const [source,target] of [['--color-background-primary','--iui-bg'],['--color-text-primary','--iui-text'],['--color-border-primary','--iui-edge'],['--color-background-secondary','--iui-face']]){surface.viewport.style.removeProperty(target);if(typeof vars[source]==='string'&&win.CSS?.supports('color',vars[source]))surface.viewport.style.setProperty(target,vars[source]);}};
  const show=async ui=>{if(cancelled||!ui||typeof ui.source!=='string')return;if(lastUI&&lastUI.id!==ui.id){surface.dispose();surface=makeSurface();}lastUI=ui;await surface.update(ui.source,{data:ui.data||{},partial:false});surface.refreshReferences();status.textContent=ui.title||'Intelligent UI';};
  const client=new McpAppClient({window:win,onTeardown:()=>{observer?.disconnect();surface?.dispose();},onNotification:async(method,params)=>{
    if(cancelled&&method.startsWith('ui/notifications/tool-'))return;
    if(method==='ui/notifications/tool-input-partial'&&typeof params.arguments?.source==='string')await surface.update(params.arguments.source,{partial:true,data:params.arguments.data||{}});
    else if(method==='ui/notifications/tool-input'&&typeof params.arguments?.source==='string')await surface.update(params.arguments.source,{data:params.arguments.data||{}});
    else if(method==='ui/notifications/tool-result')await show(params.structuredContent?.ui);
    else if(method==='ui/notifications/tool-cancelled'){cancelled=true;status.textContent='Tool cancelled. Last UI retained; source and fallback remain available.';}
    else if(method==='ui/notifications/host-context-changed')context(client.context);
  }});
  const makeSurface=()=>new UISurface(host,{resolveReference:async id=>lastUI?.references?.[id]||null,onAction:async action=>{if(cancelled||!client.ready)throw new UIError('cancelled','This tool view is not active.');action=normalizeAction(action);let result;
    if(action.type==='message')result=await client.request('ui/message',{role:'user',content:[{type:'text',text:action.args[0]}]});
    else if(action.type==='context')result=await client.request('ui/update-model-context',{structuredContent:{intelligentUI:action.args[0]}});
    else if(action.type==='link')result=await client.request('ui/open-link',{url:safeUrl(action.args[0])});
    else if(action.type==='tool'){if(!client.capabilities.serverTools)throw new UIError('capability','Host does not support tool calls.');result=await client.request('tools/call',{name:action.args[0],arguments:action.args[1]});if(result.structuredContent?.ui)await show(result.structuredContent.ui);else if(lastUI)await surface.update(lastUI.source,{data:{...lastUI.data,actionResult:result.structuredContent||{content:result.content}}});}
    else if(action.type==='copy')await win.navigator.clipboard.writeText(action.args[0]);
    else throw new UIError('capability','This action is not supported by the MCP App host.');
    if(result?.isError)throw new UIError('host','Host declined the action.');
  },onUpdate:()=>client.notify('ui/notifications/size-changed',{height:Math.min(2000,Math.ceil(root.scrollHeight)),width:Math.ceil(root.clientWidth)})});
  surface=makeSurface();
  observer=win.ResizeObserver?new win.ResizeObserver(()=>client.notify('ui/notifications/size-changed',{height:Math.min(2000,Math.ceil(root.scrollHeight))})):null;observer?.observe(root);
  const ready=client.connect().then(info=>{context(info.hostContext||{});status.textContent='Waiting for tool data…';}).catch(error=>{status.textContent=error.message;});
  return {client,get surface(){return surface;},ready,dispose(){observer?.disconnect();surface.dispose();client.dispose();}};
}
