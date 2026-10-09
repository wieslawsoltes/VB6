import {pinUIActionContext} from './action-context.js';
import {el} from '../core/core.js';
import {modal} from '../ide/ui.js';
import {UIReferenceStore} from '../../packages/intelligent-ui/src/references.js';
import {McpAppHost,appProxyUrl} from '../../packages/intelligent-ui/src/app-host.js';
import {createAppBlockFactory} from '../../packages/intelligent-ui/src/app-block.js';
import {vb6UIFactories} from './controls.js';
import {INTELLIGENT_UI_WORKER_SOURCE,INTELLIGENT_UI_MCP_HTML} from './payload.js';

/** Host-owned capabilities. Source, data and tool arguments cannot alter this policy. */
export function createStudioUIExtensions(ide,host){
  const references=new UIReferenceStore(),apps=new Set(),listeners=new Set();
  let sandboxUrl='',appsEnabled=false,epoch=host.adapter.workspaceEpoch;
  const notify=()=>{for(const app of apps)app.dispose();apps.clear();for(const listener of listeners)listener();};
  host.onChange(notify);
  host.adapter.onChange(()=>{if(epoch!==host.adapter.workspaceEpoch){epoch=host.adapter.workspaceEpoch;references.clear();notify();}});
  const review=async(title,description,value,{signal}={})=>{
    signal?.throwIfAborted();const captured=host.adapter.workspaceEpoch;
    const allowed=await modal(title,{width:700,content:el('div',{},el('p',{},description),el('pre',{class:'agent-log',tabindex:0},value)),buttons:[{label:'Cancel',value:false,primary:true},{label:'Allow once',value:true}]});
    signal?.throwIfAborted();if(!host.enabled||captured!==host.adapter.workspaceEpoch)throw new Error('The project or UI setting changed during approval.');return allowed===true;
  };
  const context=()=>{
    const win=ide.root.ownerDocument.defaultView,style=win.getComputedStyle(ide.root),variables={};
    for(const [vb,key,fallback] of [['--vb-window','--color-background-primary','#fff'],['--vb-window-text','--color-text-primary','#111'],['--vb-face','--color-background-secondary','#c0c0c0'],['--vb-shadow','--color-border-primary','#808080']])variables[key]=style.getPropertyValue(vb).trim()||fallback;
    return {theme:ide.root.ownerDocument.documentElement.dataset.ideTheme?.includes('dark')?'dark':'light',styles:{variables},platform:'web',locale:win.navigator.language,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone};
  };
  const proxy=()=>{if(!appsEnabled)throw new Error('Enable reviewed AppBlocks in Tools → Intelligent UI first.');return appProxyUrl(sandboxUrl,ide.root.ownerDocument.defaultView.location.origin).href;};
  const subscribeLifecycle=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
  const api={references,get sandboxUrl(){return sandboxUrl;},get appsEnabled(){return appsEnabled;},
    configure({url='',enabled=false}={}){
      if(url)appProxyUrl(url,ide.root.ownerDocument.defaultView.location.origin);
      if(enabled&&!url)throw new Error('A separate-origin sandbox URL is required.');
      sandboxUrl=url;appsEnabled=enabled===true;notify();
    },
    surfaceOptions({adapter=host.adapter,owner,ui,getUI,assertLive=()=>{}}={}){
      const captured=host.adapter.workspaceEpoch;
      const live=()=>{if(captured!==host.adapter.workspaceEpoch||!host.enabled)throw new Error('This UI belongs to an inactive project session.');assertLive();};
      const source=()=>getUI?.()||ui;
      return {workerSource:INTELLIGENT_UI_WORKER_SOURCE,
        resolveReference:async(id,{signal})=>{
          signal?.throwIfAborted();live();if(!id)return null;
          const current=source();if(current)return current.references?.[id]||null;
          return owner?adapter.intelligentUI.service.reference(id,{principal:owner}):references.get(id);
        },
        subscribeReferences:listener=>{const off=references.subscribe(listener),offAdapter=adapter.intelligentUI.onChange(event=>{if(!owner||event.owner===owner)listener({id:null});});return()=>{off();offAdapter();};},
        approveResource:async url=>{live();const allowed=await review('Intelligent UI — Load image','Loading contacts this exact external URL. The browser may send credentials already associated with its origin; no IDE tokens are added.',url);live();return allowed;},
        factories:{...vb6UIFactories(),AppBlock:createAppBlockFactory({proxyUrl:proxy,hostContext:context,subscribeLifecycle,
          approveApp:async app=>{live();const allowed=await review('Intelligent UI — Run isolated app','Run this HTML/JavaScript in a separate-origin sandbox. It cannot access the IDE DOM or project. Browser isolation is not an OS network firewall or a CPU-availability guarantee.',app.title+'\n'+app.proxyUrl+'\n\n'+app.html);live();return allowed;},
          // Message/link/context intents still go through the surface's exact task/revision guard and review dialog.
          approveAction:async(action,options)=>{live();if(action.method==='ui/request-display-mode'){const allowed=await review('Isolated app — Display mode','Allow this display mode change?',JSON.stringify(action.params),options);live();return allowed;}return true;}
        })}
      };
    },
    openMcpApp(root,adapter,owner,ui){
      const url=proxy(),pinned=pinUIActionContext(host,{adapter,owner}),captured=pinned.epoch;let app;
      const live=()=>{pinned.assertLive();app?.live();if(!host.enabled||captured!==host.adapter.workspaceEpoch)throw new Error('App project context was revoked.');const current=adapter.intelligentUI.service.run('read',{id:ui.id},{principal:owner});if(current.ui.revision!==ui.revision)throw new Error('This app result is obsolete. Open the latest revision.');};live();
      app=new McpAppHost(root,{proxyUrl:url,html:INTELLIGENT_UI_MCP_HTML,hostContext:context(),tools:adapter.enabled?adapter.tools:[],
        ...(adapter.enabled?{callTool:async(name,args,{signal})=>{live();const tool=adapter.tools.find(t=>t.name===name);if(!tool)throw new Error('Unknown connection tool.');const result=await tool.execute(args,pinned.transportContext(signal));return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};}}:{}),
        approve:async(action,options)=>{live();const allowed=await review('MCP App — Review request','Approve this exact request once. Normal IDE permissions, sharing and project revision checks still apply.',JSON.stringify(action,null,2),options);live();return allowed;},
        onMessage:p=>{live();return host.action({type:'message',args:[p.content.map(c=>c.text).join('\n')]},{...pinned,origin:ui.title,assertLive:live});},
        onContext:p=>{live();return host.action({type:'context',args:[p.structuredContent||{content:p.content}]},{...pinned,origin:ui.title,assertLive:live});},
        openLink:url=>{live();return host.action({type:'link',args:[url]},{...pinned,origin:ui.title,assertLive:live});},
        onError:error=>{const p=root.ownerDocument.createElement('p');p.textContent=error.message;root.append(p);}
      });
      const off=adapter.intelligentUI.onChange(event=>{if(event.owner===owner&&event.result.ui.id===ui.id){app.dispose();apps.delete(app);}}),dispose=app.dispose.bind(app);
      app.dispose=()=>{off();apps.delete(app);dispose();};apps.add(app);app.setToolInput({source:ui.source,data:ui.data});app.setToolResult({content:[{type:'text',text:'Interactive UI result'}],structuredContent:{ui}});return app;
    }
  };return api;
}
