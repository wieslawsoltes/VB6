import {normalizeContentBlocks, normalizeModelContext, CONTENT_TYPES} from './content.js';
import {AppDisplayController, DISPLAY_MODES} from './display-mode.js';
import {UIError, boundedData, record, safeUrl} from './safety.js';

const VERSION='2026-01-26';
const domainKeys=['connectDomains','resourceDomains','frameDomains','baseUriDomains'];
export function normalizeAppCsp(input={}) {
  input=boundedData(input,16000);if(!record(input))throw new UIError('csp','CSP metadata must be an object.');const result={};
  for(const key of Object.keys(input))if(!domainKeys.includes(key))throw new UIError('csp','Unknown CSP domain category.');
  for(const key of domainKeys){const values=input[key]||[];if(!Array.isArray(values)||values.length>16)throw new UIError('csp','Too many CSP origins.');result[key]=values.map(value=>{
    if(typeof value!=='string')throw new UIError('csp','Invalid CSP origin.');
    const wildcard=key==='resourceDomains'&&/^https?:\/\/\*\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\:\d{1,5})?\/?$/i.test(value);
    const candidate=wildcard?value.replace('*.','wildcard-check.'):value;let url;try{url=new URL(candidate);}catch{throw new UIError('csp','Invalid CSP origin.');}
    const schemes=key==='connectDomains'?['https:','http:','wss:','ws:']:['https:','http:'];
    if(!schemes.includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.origin==='null'||/[\s;'"<>*]/.test(candidate))throw new UIError('csp','CSP entries must be exact HTTP(S) origins (WS(S) for connections).');if(wildcard&&(/^(?:\d+\.)+\d+$/.test(url.hostname.slice(15))||url.hostname.slice(15).split('.').some(label=>! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))))throw new UIError('csp','Wildcard IP origins are not allowed.');return wildcard?url.origin.replace('wildcard-check.','*.'):url.origin;
  });}
  return result;
}
export function appProxyUrl(value,hostOrigin,csp={}) {
  const url=new URL(safeUrl(value));
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new UIError('sandbox_origin','Use HTTPS or an explicit loopback sandbox origin.');
  if(hostOrigin==='null'||!hostOrigin)throw new UIError('sandbox_origin','Isolated apps require an HTTP(S) IDE origin.');
  if(url.origin===new URL(safeUrl(hostOrigin)).origin)throw new UIError('sandbox_origin','Sandbox and IDE must have different origins.');
  url.search='';url.hash='';url.searchParams.set('parentOrigin',new URL(hostOrigin).origin);url.searchParams.set('csp',JSON.stringify(normalizeAppCsp(csp)));return url;
}
function callbackResult(value){return record(value)?value:value===false?{isError:true}:{};}

/** Host of one connection-bound MCP App, via a REQUIRED separate-origin proxy. */
export class McpAppHost {
  constructor(root,{proxyUrl,html,csp={},hostContext={},tools=[],resourceUris=[],callTool,readResource,onMessage,onContext,openLink,downloadFile,onLog=()=>{},onToolsChanged=()=>{},contentTypes=CONTENT_TYPES,displayModes=DISPLAY_MODES,approve=async()=>false,onError=()=>{},timeout=10000}={}) {
    if(typeof html!=='string'||html.length>250000)throw new UIError('resource','App HTML exceeds 250,000 characters.');
    this.root=root;this.window=root.ownerDocument.defaultView;this.doc=root.ownerDocument;this.csp=normalizeAppCsp(csp);this.proxy=appProxyUrl(proxyUrl,this.window.location.origin,this.csp);this.html=html;
    this.callbacks={callTool,readResource,onMessage,onContext,openLink,downloadFile,approve,onError,onLog,onToolsChanged};this.contentTypes=[...contentTypes];this.context=boundedData(hostContext,16000);this.tools=new Map(tools.map(tool=>[tool.name,tool]));this.resourceUris=new Set(resourceUris);
    this.pending=new Map();this.active=new Map();this.sequence=0;this.ready=false;this.initializing=false;this.disposed=false;this.inputSent=false;this.timeout=timeout;this.life=new AbortController();this.rate={start:Date.now(),count:0};
    this.frame=this.doc.createElement('iframe');this.frame.title='Isolated MCP App';this.frame.setAttribute('sandbox','allow-scripts allow-same-origin');this.frame.referrerPolicy='no-referrer';this.frame.style.cssText='width:100%;height:400px;border:0';
    this.listener=event=>void this.receive(event);this.window.addEventListener('message',this.listener);root.append(this.frame);
    this.display=new AppDisplayController(root,this.frame,{available:displayModes,onChange:mode=>{this.context.displayMode=mode;if(!this.disposed)this.notify('ui/notifications/host-context-changed',{displayMode:mode});}});
    this.timer=setTimeout(()=>{if(!this.ready){this.error(new UIError('timeout','Sandbox did not initialize. Check its URL, CSP headers and allowed parent origin.'));this.dispose();}},timeout);this.frame.src=this.proxy.href;
  }
  send(message) {if(this.disposed)throw new UIError('disposed','MCP App host is closed.');this.frame.contentWindow.postMessage(message,this.proxy.origin);}
  notify(method,params) {if(this.ready)this.send({jsonrpc:'2.0',method,params});}
  live() {this.life.signal.throwIfAborted();if(this.disposed)throw new UIError('disposed','MCP App host is closed.');}
  async authorize(method,params,signal=this.life.signal) {this.live();signal.throwIfAborted();if(this.approving)throw new UIError('busy','Another app action is awaiting approval.');this.approving=true;try{if(await this.callbacks.approve({method,params:boundedData(params,500000,{maxText:192000})},{signal})!==true)throw new UIError('denied','The user declined this app action.');this.live();signal.throwIfAborted();}finally{this.approving=false;}}
  error(error) {try{this.callbacks.onError(error);}catch{}}
  async receive(event) {
    if(this.disposed||event.source!==this.frame.contentWindow||event.origin!==this.proxy.origin)return;
    const now=Date.now();if(now-this.rate.start>1000)this.rate={start:now,count:0};if(++this.rate.count>120){this.error(new UIError('rate','App message limit exceeded.'));this.dispose();return;}
    let m;try{m=boundedData(event.data,600000,{maxText:250000});}catch{return;}if(!record(m)||m.jsonrpc!=='2.0')return;
    if(m.id!==undefined&&!m.method){const pending=this.pending.get(m.id);if(pending){clearTimeout(pending.timer);this.pending.delete(m.id);m.error?pending.reject(new UIError('app',String(m.error.message))):pending.resolve(m.result);}return;}
    if(m.method==='ui/notifications/sandbox-proxy-ready'){
      if(this.proxyReady)return;this.proxyReady=true;this.send({jsonrpc:'2.0',method:'ui/notifications/sandbox-resource-ready',params:{html:this.html,csp:this.csp}});return;
    }
    if(typeof m.method!=='string'||m.method.startsWith('ui/notifications/sandbox-'))return;
    if(m.id===undefined&&!['ui/notifications/initialized','ui/notifications/size-changed','ui/notifications/request-teardown','notifications/message','notifications/tools/list_changed','notifications/cancelled'].includes(m.method))return;
    if(m.id!==undefined&&!(typeof m.id==='string'&&m.id.length<=128||typeof m.id==='number'&&Number.isSafeInteger(m.id)))return;
    if(m.method==='notifications/cancelled'&&m.id===undefined){this.active.get(m.params?.requestId)?.abort();return;}
    const controller=new AbortController(),signal=AbortSignal.any([this.life.signal,controller.signal]);
    if(m.id!==undefined){if(this.active.has(m.id)||this.active.size>=16)return;this.active.set(m.id,controller);}
    try {
      const p=m.params||{};if(!record(p))throw new UIError('arguments','Request parameters must be an object.');let result;
      if(m.method==='ui/initialize'){
        if(!this.proxyReady||this.initializing||!record(p.appInfo)||typeof p.appInfo.name!=='string'||typeof p.appInfo.version!=='string'||!record(p.appCapabilities)||p.protocolVersion!==VERSION)throw new UIError('initialize','Invalid or repeated MCP App initialization.');
        const modes=this.display.negotiate(p.appCapabilities.availableDisplayModes);this.initializing=true;this.appCapabilities=p.appCapabilities;
        result={protocolVersion:VERSION,hostInfo:{name:'VB6 Intelligent UI Host',version:'0.1.0'},hostCapabilities:{...(this.callbacks.callTool?{serverTools:{}}:{}),...(this.callbacks.readResource?{serverResources:{}}:{}),...(this.callbacks.openLink?{openLinks:{}}:{}),...(this.callbacks.downloadFile?{downloadFile:{}}:{}),sandbox:{csp:this.csp,permissions:{}}},hostContext:{...this.context,displayMode:'inline',availableDisplayModes:modes}};
      } else if(m.method==='ui/notifications/initialized'){
        if(!this.initializing||this.ready||m.id!==undefined)return;this.ready=true;clearTimeout(this.timer);this.flush();return;
      } else {
        if(!this.ready)throw new UIError('initialize','Initialize the app first.');
        switch(m.method){
          case 'ping':result={};break;
          case 'ui/notifications/size-changed':if(Number.isFinite(p.height)){this.display.inlineHeight=Math.min(2000,Math.max(80,Math.ceil(p.height)))+'px';if(this.display.mode==='inline')this.frame.style.height=this.display.inlineHeight;};return;
          case 'ui/notifications/request-teardown':void this.teardown();return;
          case 'notifications/message':try{this.callbacks.onLog(boundedData(p,8000));}catch{}return;
          case 'notifications/tools/list_changed':if(this.appCapabilities?.tools?.listChanged)try{this.callbacks.onToolsChanged();}catch{}return;
          case 'tools/call':{
            const tool=this.tools.get(p.name);if(!tool||!(tool._meta?.ui?.visibility||['model','app']).includes('app')||!this.callbacks.callTool)throw new UIError('tool','Tool is not available to this app connection.');
            if(!record(p.arguments||{}))throw new UIError('arguments','Tool arguments must be an object.');await this.authorize(m.method,p,signal);result=await this.callbacks.callTool(p.name,p.arguments||{},{signal});break;
          }
          case 'resources/read':if(!this.resourceUris.has(p.uri)||!this.callbacks.readResource)throw new UIError('resource','Resource is not available to this app connection.');await this.authorize(m.method,p,signal);result=await this.callbacks.readResource(p.uri,{signal});break;
          case 'ui/message':if(p.role!=='user'||!this.callbacks.onMessage)throw new UIError('message','App messages are not enabled.');p.content=normalizeContentBlocks(p.content,{types:this.contentTypes,allowEmpty:false});await this.authorize(m.method,p,signal);result=callbackResult(await this.callbacks.onMessage(p,{signal}));break;
          case 'ui/update-model-context':if(!this.callbacks.onContext)throw new UIError('context','Context updates are not enabled.');const context=normalizeModelContext(p);if(context.content)normalizeContentBlocks(context.content,{types:this.contentTypes});await this.authorize(m.method,context,signal);result=callbackResult(await this.callbacks.onContext(context,{signal}));break;
          case 'ui/open-link':if(!this.callbacks.openLink)throw new UIError('link','Opening links is not enabled.');p.url=safeUrl(p.url);await this.authorize(m.method,p,signal);result=callbackResult(await this.callbacks.openLink(p.url,{signal}));break;
          case 'ui/download-file':if(!this.callbacks.downloadFile||!Array.isArray(p.contents)||p.contents.length>8)throw new UIError('download','Downloads are not enabled or exceed limits.');p.contents=normalizeContentBlocks(p.contents,{types:['resource','resource_link'],allowEmpty:false});for(const item of p.contents)if(item.type==='resource_link'&&!this.resourceUris.has(item.uri))throw new UIError('download','Unknown linked resource.');await this.authorize(m.method,p,signal);result=callbackResult(await this.callbacks.downloadFile(p,{signal}));break;
          case 'ui/request-display-mode':if(!DISPLAY_MODES.includes(p.mode))throw new UIError('display','Unsupported display mode.');if(this.display.available.includes(p.mode)&&this.display.supported.includes(p.mode))await this.authorize(m.method,p,signal);result={mode:this.setDisplayMode(p.mode)};break;
          default:throw new UIError('method','Unsupported MCP App request.');
        }
      }
      this.live();signal.throwIfAborted();if(m.id!==undefined)this.send({jsonrpc:'2.0',id:m.id,result:boundedData(result||{},500000,{maxText:192000})});
    }catch(error){if(!this.disposed&&m.id!==undefined)this.send({jsonrpc:'2.0',id:m.id,error:{code:error.code==='method'?-32601:-32000,message:String(error.message||error).slice(0,2000)}});}
    finally{this.active.delete(m.id);}
  }
  setDisplayMode(mode){this.live();return this.display.set(mode);}
  updateHostContext(context){this.context={...this.context,...boundedData(context,16000)};this.notify('ui/notifications/host-context-changed',context);}
  setToolInput(args,{partial=false}={}){if(this.inputSent)throw new UIError('input','Final tool input has already been sent.');this.input=boundedData(args,200000);this.partial=partial;this.flush();}
  setToolResult(result){const clean=boundedData(result,500000,{maxText:192000});if(clean.content!==undefined)normalizeContentBlocks(clean.content);this.result=clean;this.flush();}
  flush(){if(!this.ready)return;if(this.input!==undefined&&!this.inputSent){this.notify(this.partial?'ui/notifications/tool-input-partial':'ui/notifications/tool-input',{arguments:this.input});if(!this.partial)this.inputSent=true;}if(this.result&&this.inputSent){this.notify('ui/notifications/tool-result',this.result);this.result=null;}}
  cancel(){this.notify('ui/notifications/tool-cancelled',{});this.life.abort();for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(new UIError('cancelled','App was cancelled.'));}this.pending.clear();}
  request(method,params={}){if(!this.ready||this.disposed)return Promise.reject(new UIError('initialize','App is not initialized.'));if(this.pending.size>=16)return Promise.reject(new UIError('queue','Too many host requests.'));const id='host-'+(++this.sequence);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.notify('notifications/cancelled',{requestId:id,reason:'Host request timed out.'});reject(new UIError('timeout','App request timed out.'));},this.timeout);this.pending.set(id,{resolve,reject,timer});try{this.live();this.send({jsonrpc:'2.0',id,method,params:boundedData(params)});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});}
  listAppTools(){if(!this.appCapabilities?.tools)return Promise.reject(new UIError('capability','This app does not expose tools.'));return this.request('tools/list');}
  callAppTool(name,args={}){if(!this.appCapabilities?.tools)return Promise.reject(new UIError('capability','This app does not expose tools.'));return this.request('tools/call',{name,arguments:args});}
  async teardown(){try{if(this.ready)await Promise.race([this.request('ui/resource-teardown',{}),new Promise(resolve=>setTimeout(resolve,300))]);}catch{}finally{this.dispose();}}
  dispose(){if(this.disposed)return;this.disposed=true;clearTimeout(this.timer);this.life.abort();this.window.removeEventListener('message',this.listener);this.display.dispose();this.frame.remove();this.root.classList.remove('iui-app-fullscreen');for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new UIError('disposed','App host closed.'));}this.pending.clear();this.active.clear();}
}
