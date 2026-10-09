import {UIError, boundedData, record, safeUrl} from './safety.js';
import {normalizeAppCsp} from './app-host.js';

/** Also used by the companion HTTP server: policy is enforced by headers, not just HTML. */
export function sandboxCsp(input={}, {proxy=false,parentOrigin}={}) {
  const csp=normalizeAppCsp(input),domains=key=>csp[key].length?csp[key].join(' '):"'none'";
  const frame=proxy?["'self'",...csp.frameDomains].join(' '):domains('frameDomains');
  const values=["default-src 'none'", "script-src 'unsafe-inline' "+(csp.resourceDomains.join(' ')||''), "style-src 'unsafe-inline' "+(csp.resourceDomains.join(' ')||''), "img-src data: "+csp.resourceDomains.join(' '), 'font-src '+domains('resourceDomains'), 'media-src '+domains('resourceDomains'), 'connect-src '+domains('connectDomains'),'frame-src '+frame,'base-uri '+domains('baseUriDomains'),"object-src 'none'","form-action 'none'","worker-src 'none'"];
  if(parentOrigin){const url=new URL(safeUrl(parentOrigin));if(url.origin!==parentOrigin)throw new UIError('origin','Expected a bare parent origin.');values.push('frame-ancestors '+url.origin);}
  return values.map(s=>s.trim()).join('; ');
}
export function startSandboxProxy(window=globalThis) {
  const params=new URL(window.location.href).searchParams,parentOrigin=params.get('parentOrigin');
  if(window.parent===window||!parentOrigin||parentOrigin==='null'||new URL(safeUrl(parentOrigin)).origin===window.location.origin)throw new UIError('sandbox_origin','Sandbox must be embedded by a different HTTP(S) origin.');
  const csp=normalizeAppCsp(JSON.parse(params.get('csp')||'{}')),document=window.document;
  const frame=document.createElement('iframe');frame.title='Untrusted app view';frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';frame.style.cssText='width:100%;height:100vh;border:0';document.body.append(frame);
  let loaded=false,closed=false,seen={time:Date.now(),count:0};
  const listener=event=>{
    if(closed)return;let message;try{message=boundedData(event.data,600000,{maxText:250000});}catch{return;}if(!record(message)||message.jsonrpc!=='2.0')return;
    if(event.source===window.parent&&event.origin===parentOrigin){
      if(message.method==='ui/notifications/sandbox-resource-ready'){
        if(loaded||typeof message.params?.html!=='string'||message.params.html.length>250000)return;
        // Metadata cannot change the policy already selected and enforced by HTTP headers.
        if(JSON.stringify(normalizeAppCsp(message.params.csp||{}))!==JSON.stringify(csp))return;
        loaded=true;const policy=sandboxCsp(csp).replace(/&/g,'&amp;').replace(/"/g,'&quot;');frame.srcdoc='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'+policy+'">'+message.params.html;
      }else if(!message.method?.startsWith('ui/notifications/sandbox-'))frame.contentWindow.postMessage(message,'*');
    }else if(event.source===frame.contentWindow&&event.origin==='null'&&loaded&&!message.method?.startsWith('ui/notifications/sandbox-')){
      const now=Date.now();if(now-seen.time>1000)seen={time:now,count:0};if(++seen.count>120){closed=true;frame.remove();return;}window.parent.postMessage(message,parentOrigin);
    }
  };
  window.addEventListener('message',listener);window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/sandbox-proxy-ready',params:{}},parentOrigin);
  return {dispose(){closed=true;window.removeEventListener('message',listener);frame.remove();}};
}
