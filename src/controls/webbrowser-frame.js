import {webBrowserAgent} from './webbrowser-agent.js';
import {WEB_DOM_TYPES} from './webbrowser-dom-contract.js';
import {WEB_BROWSER_LIMITS as limits, WebBrowserError} from './webbrowser-contract.js';
import {WebBrowserDocument} from './webbrowser-document.js';

const json = value => JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export function webBrowserSource(html, nonce, url, silent = false) {
  const bootstrap = '(' + webBrowserAgent.toString() + ')(' + [WEB_DOM_TYPES,limits,nonce,url,silent].map(json).join(',') + ');';
  // The agent is trusted source, but it is still an HTML raw-text script token.
  if (/<\/script/i.test(bootstrap)) throw new WebBrowserError('Unsafe browser bootstrap',5);
  const base = /^https?:/i.test(url) ? '<base href="'+url.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')+'">' : '';
  return '<!doctype html><meta charset="utf-8">'+base+'<script>'+bootstrap+'<'+'/script>'+html.replace(/^\s*<!doctype[^>]*>/i,'');
}

/** One navigation, one isolated browsing context. No allow-same-origin, no
 * shell integration, no fetch/proxy rewriting of external pages. */
export class WebBrowserFrame {
  constructor(host, entry, receive) {
    this.host=host; this.entry=entry; this.receive=receive; this.closed=false;
    this.pending=new Map(); this.next=0; this.port=null; this.document=null; this.root=null;
    this.loaded=false; this.connected=false; this.leaving=false;
    this.window=host.ownerDocument.defaultView;
    const random=new Uint32Array(4); this.window.crypto.getRandomValues(random);
    this.nonce=Array.from(random,n=>n.toString(16).padStart(8,'0')).join('');
    const frame=host.ownerDocument.createElement('iframe'); this.node=frame;
    frame.title='WebBrowser HTML5 document'; frame.setAttribute('sandbox','allow-scripts allow-forms'+(entry.silent?'':' allow-modals'));
    frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
    frame.setAttribute('allow','camera \'none\'; microphone \'none\'; geolocation \'none\'; clipboard-read \'none\'; clipboard-write \'none\'');
    Object.assign(frame.style,{display:'block',border:'0',width:'100%',height:'100%',background:'white'});
    this.onMessage=event=>this.connect(event);
    this.window.addEventListener('message',this.onMessage);
    frame.addEventListener('load',()=>{
      if(this.closed)return;
      if(this.loaded||this.leaving){
        // Document.open/write/close fires another iframe load in the SAME
        // realm. Retain handles only when that realm's private port answers.
        this.finishTimer();
        if(this.connected&&!this.leaving&&this.document)void this.request({op:'root'}).then(()=>{if(!this.closed&&!this.leaving)receive({event:'complete',opaque:false});},()=>{if(!this.closed){this.revoke();receive({event:'leaving'});}});
        else{this.revoke();receive({event:'leaving'});}
        return;
      }
      this.loaded=true;
      if(entry.html === null) { this.finishTimer(); receive({event:'complete',opaque:true}); }
      else if(this.connected) { this.finishTimer(); receive({event:'complete',opaque:false}); }
    });
    // Browsers deliberately hide iframe HTTP errors. Only use an actual error
    // event/timeout, never invent a network status from an inaccessible DOM.
    frame.addEventListener('error',()=>this.fail(new WebBrowserError('Browser frame load failed',440,'WEBBROWSER_LOAD_FAILED')));
    if(entry.html === null) frame.src=entry.url;
    else frame.srcdoc=webBrowserSource(entry.html,this.nonce,entry.url,entry.silent===true);
    this.timer=this.window.setTimeout(()=>this.fail(new WebBrowserError('Browser navigation or document bridge timed out; CSP or embedding policy may have blocked it',440,'WEBBROWSER_TIMEOUT')),limits.loadTimeout);
    host.replaceChildren(frame);
  }
  finishTimer(){this.window.clearTimeout(this.timer);this.timer=null;}
  connect(event){
    if(this.closed||this.leaving||this.port||this.entry.html===null||event.source!==this.node.contentWindow||event.origin!=='null'||event.data?.channel!=='vb6-webbrowser-ready'||event.data.nonce!==this.nonce)return;
    const channel=new this.window.MessageChannel();this.port=channel.port1;
    this.document=new WebBrowserDocument(request=>this.request(request));
    this.port.onmessage=event=>{
      if(this.closed)return; const data=event.data;
      if(!data||typeof data!=='object')return;
      if(Number.isSafeInteger(data.id)) {
        const pending=this.pending.get(data.id);if(!pending)return;
        this.pending.delete(data.id);this.window.clearTimeout(pending.timer);
        if(data.error)pending.reject(new WebBrowserError(String(data.error.message||'Document operation failed').slice(0,2048),Number.isInteger(data.error.number)?data.error.number:440));
        else pending.resolve(data.value);return;
      }
      if(data.event==='connected'&&!this.connected) {
        try { this.root=this.document.decode(data.root); }
        catch(error){this.fail(error);return;}
        this.connected=true;this.receive({event:'document',document:this.root});
        if(typeof data.title==='string')this.receive({event:'title',title:data.title.slice(0,limits.url)});
        if(this.loaded||data.readyState==='complete'){this.finishTimer();this.receive({event:'complete',opaque:false});}
      } else if(data.event==='state'&&data.readyState==='complete'&&this.connected) {
        this.finishTimer();this.receive({event:'complete',opaque:false});
      } else if(data.event==='title'&&typeof data.title==='string')this.receive({event:'title',title:data.title.slice(0,limits.url)});
      else if(data.event==='navigate'&&typeof data.url==='string'&&data.url.length<=limits.url&&typeof data.target==='string'&&data.target.length<=255)this.receive({event:'navigate',url:data.url,target:data.target,replace:data.replace===true});
      else if(data.event==='leaving') { this.revoke();this.receive({event:'leaving'}); }
    };
    this.port.start();this.node.contentWindow.postMessage({channel:'vb6-webbrowser-connect',nonce:this.nonce},'*',[channel.port2]);
  }
  request(request){
    if(this.closed||!this.port)return Promise.reject(new WebBrowserError('Document is unavailable or released',91));
    if(this.pending.size>=limits.rpc)return Promise.reject(new WebBrowserError('Document request limit',7));
    return new Promise((resolve,reject)=>{
      const id=++this.next,timer=this.window.setTimeout(()=>{this.pending.delete(id);reject(new WebBrowserError('Document operation timed out',440,'WEBBROWSER_RPC_TIMEOUT'));},limits.rpcTimeout);
      this.pending.set(id,{resolve,reject,timer});
      try{this.port.postMessage({...request,id});}catch(error){this.window.clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  async fragment(url){await this.request({op:'fragment',url});this.entry={...this.entry,url};}
  setSilent(value){
    // The sandbox also suppresses native modal UI for opaque external pages.
    this.node.setAttribute('sandbox','allow-scripts allow-forms'+(value?'':' allow-modals'));
    if(this.connected&&!this.leaving)void this.request({op:'silent',value:!!value}).catch(()=>{});
  }
  revoke(){
    this.leaving=true;this.document?.close();this.document=null;this.root=null;this.port?.close();this.port=null;
    for(const {reject,timer}of this.pending.values()){this.window.clearTimeout(timer);reject(new WebBrowserError('The document navigated outside its automation context',91));}
    this.pending.clear();
  }
  fail(error){if(this.closed)return;this.finishTimer();this.receive({event:'error',error});}
  stop(){this.close();}
  close(){
    if(this.closed)return;this.closed=true;this.finishTimer();
    this.window.removeEventListener('message',this.onMessage);this.port?.close();this.document?.close();
    for(const {reject,timer}of this.pending.values()){this.window.clearTimeout(timer);reject(new WebBrowserError('Document released by navigation, Stop or disposal',91));}
    this.pending.clear();this.node.remove();
  }
}
