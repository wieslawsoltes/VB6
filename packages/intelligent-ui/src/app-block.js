import {UIError} from './safety.js';
import {McpAppHost,appProxyUrl} from './app-host.js';

/** Trusted bootstrap. App source remains confined to the opaque inner document. */
function bootstrap(){
  let id=0,ready=false,closed=false;const pending=new Map();
  const send=(method,params={})=>{if(closed||pending.size>=16)return Promise.reject(new Error('App bridge unavailable.'));return new Promise((resolve,reject)=>{const key='raw-'+(++id),timer=setTimeout(()=>{pending.delete(key);parent.postMessage({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:key}},'*');reject(new Error('Host response timed out.'));},10000);pending.set(key,{resolve,reject,timer});parent.postMessage({jsonrpc:'2.0',id:key,method,params},'*');});};
  function theme(context={}){const values=context.styles?.variables||{};for(const [key,target] of [['--color-background-primary','--viz-panel'],['--color-text-primary','--viz-text'],['--color-background-secondary','--viz-background'],['--color-border-primary','--viz-border']])if(typeof values[key]==='string'&&CSS.supports('color',values[key]))document.documentElement.style.setProperty(target,values[key]);}
  addEventListener('message',event=>{if(event.source!==parent||event.data?.jsonrpc!=='2.0')return;const m=event.data,p=pending.get(m.id);if(p&&!m.method){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);return;}if(m.method==='ui/notifications/host-context-changed')theme(m.params);if(m.method==='ui/resource-teardown'||m.method==='ui/notifications/tool-cancelled'){closed=true;observer?.disconnect();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('App closed.'));}pending.clear();if(m.id!==undefined)parent.postMessage({jsonrpc:'2.0',id:m.id,result:{}},'*');}});
  const call=(method,params)=>ready?send(method,params):Promise.reject(new Error('App host is not ready.'));
  globalThis.GenUI=Object.freeze({sendMessage:content=>call('ui/message',{role:'user',content}),downloadFiles:contents=>call('ui/download-file',{contents}),issueNewTurn:text=>call('ui/message',{role:'user',content:[{type:'text',text:String(text)}]}),openUrl:url=>call('ui/open-link',{url:String(url)}),callTool:(name,args)=>call('tools/call',{name,arguments:args}),updateContext:structuredContent=>call('ui/update-model-context',{structuredContent}),requestDisplayMode:mode=>call('ui/request-display-mode',{mode}),copy:()=>Promise.reject(new Error('Copy manually inside the isolated app. Host clipboard access is not granted.'))});
  let observer;send('ui/initialize',{appInfo:{name:'Isolated AppBlock',version:'0.1.0'},appCapabilities:{availableDisplayModes:['inline','fullscreen','pip']},protocolVersion:'2026-01-26'}).then(result=>{ready=true;theme(result.hostContext);parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*');observer=new ResizeObserver(()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/size-changed',params:{height:Math.min(2000,document.documentElement.scrollHeight)}},'*'));observer.observe(document.body);}).catch(()=>{});
}
export function appBlockDocument(html){
  if(typeof html!=='string'||html.length>100000)throw new UIError('app_source','AppBlock exceeds its source limit.');
  const script='('+bootstrap.toString()+')();';
  return '<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--viz-panel:#fff;--viz-text:#111;--viz-background:#c0c0c0;--viz-border:#808080}body{margin:8px;font:13px/1.45 system-ui;background:var(--viz-panel);color:var(--viz-text)}button,input,select,textarea{font:inherit}*{box-sizing:border-box}</style><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>'+html;
}
export function createAppBlockFactory({proxyUrl,approveApp=async()=>false,approveAction=async()=>false,onAction=()=>{},hostContext=()=>({}),subscribeLifecycle}={}) {
  return ({document,onAction:dispatchAction=onAction})=>{
    const node=document.createElement('section'),notice=document.createElement('p'),run=document.createElement('button'),stop=document.createElement('button'),view=document.createElement('div');run.type=stop.type='button';run.textContent='Run isolated app';stop.textContent='Stop app';stop.hidden=true;node.append(notice,run,stop,view);let props={},generation=0,app=null,disposed=false;const observer=document.defaultView.MutationObserver?new document.defaultView.MutationObserver(()=>app?.updateHostContext(hostContext())):null;observer?.observe(document.documentElement,{attributes:true});
    const end=()=>{app?.dispose();app=null;view.replaceChildren();run.disabled=false;stop.hidden=true;};
    const error=e=>{notice.textContent=e.message||String(e);};
    const off=subscribeLifecycle?.(()=>{generation++;end();notice.textContent='App stopped because its host context changed. Review before running again.';});
    run.onclick=async()=>{
      const token=generation,snapshot={html:props.html,title:props.title||'AppBlock'};run.disabled=true;
      try{const url=typeof proxyUrl==='function'?proxyUrl():proxyUrl;appProxyUrl(url,document.defaultView.location.origin);
        if(await approveApp({...snapshot,proxyUrl:url})!==true)throw new UIError('denied','App execution declined.');if(disposed||generation!==token)return;end();
        app=new McpAppHost(view,{proxyUrl:url,html:appBlockDocument(snapshot.html),hostContext:hostContext(),approve:approveAction,
          onMessage:(p,context)=>dispatchAction(p.content.every(c=>c.type==='text')?{type:'message',args:[p.content.map(c=>c.text).join('\n')]}:{type:'messageContent',args:[p.content]},context),onContext:(p,context)=>dispatchAction({type:'context',args:[p]},context),openLink:(url,context)=>dispatchAction({type:'link',args:[url]},context),onError:error});
        run.disabled=true;stop.hidden=false;notice.textContent='Running on a separate origin. No project, clipboard or tool capability is granted to this app.';
      }catch(e){if(!disposed&&generation===token){error(e);run.disabled=false;}}
    };
    stop.onclick=()=>{generation++;end();notice.textContent='App stopped. Its private state was discarded.';};
    return {node,childHost:document.createElement('span'),update(value){const changed=props.html!==value.html;props=value;if(changed){generation++;end();notice.textContent='Review before running arbitrary app code. A separate-origin sandbox service is required; browser isolation is not an operating-system network firewall.';}},dispose(){disposed=true;generation++;observer?.disconnect();off?.();end();}};
  };
}
