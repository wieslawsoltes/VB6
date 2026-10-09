/** This function runs INSIDE an opaque-origin iframe, never in the IDE. Keep it
 * closure-free: the shared allowlist/limits are passed as serialized data.
 * HTML executes using the browser parser. No downloaded code is evaluated in
 * the parent, and no parent DOM, storage, native or application capability is
 * sent through the port.
 */
export function webBrowserAgent(types, limits, nonce, logicalURL, silent) {
  'use strict';
  const scope = window, doc = document, parentWindow = parent;
  const objects = new Map(), identities = new WeakMap(), pending = new Map();
  let sequence = 0, port = null, observer = null, wired = false, closed = false, lastTitle = null;
  const dialogs = {alert:scope.alert.bind(scope),confirm:scope.confirm.bind(scope),prompt:scope.prompt.bind(scope)};
  scope.alert = (...args) => { if(!silent)return dialogs.alert(...args); };
  scope.confirm = (...args) => silent ? false : dialogs.confirm(...args);
  scope.prompt = (...args) => silent ? null : dialogs.prompt(...args);
  scope.open = (url='about:blank',target='_blank') => { navigation(url||'about:blank',target||'_blank'); return null; };
  const leaving = () => { if(wired)send({event:'leaving'}); };
  const members = new Map(Object.entries(types).map(([type, list]) => [type, new Map(list.map(m => [m.name.toLowerCase(), m]))]));
  const send = value => { if (port && !closed) port.postMessage(value); };
  const fault = (message, number = 438) => Object.assign(new Error(message), {number});
  function identify(value) {
    if (value === null || value === undefined) return null;
    if (value === scope) return 'window';
    if (value === scope.location) return 'location';
    if (value.nodeType === 9) return value === doc ? 'document' : null;
    if (value.nodeType === 2) return 'attribute';
    if (value.nodeType && value.ownerDocument === doc) return 'element';
    if (value instanceof CSSStyleDeclaration) return 'style';
    if (value === doc.all || value instanceof HTMLCollection || value instanceof NodeList || value instanceof NamedNodeMap || Array.isArray(value)) return 'collection';
    return null;
  }
  function encode(value, result = 'value') {
    if (value === undefined) return result === 'object' ? {nothing:true} : {empty: true};
    if (value === null) return {nothing: true};
    if (['string','number','boolean'].includes(typeof value)) {
      if (typeof value === 'string' && value.length > limits.message || typeof value === 'number' && !Number.isFinite(value)) throw fault('DOM result exceeds limits', 7);
      return value;
    }
    const type = identify(value);
    if (!type) throw fault('This browser object is not part of the document automation contract');
    let id = identities.get(value);
    if (!id) {
      if (objects.size >= limits.objects) throw fault('DOM handle limit reached; navigate to release document handles', 7);
      id = ++sequence; identities.set(value, id); objects.set(id, {value, type});
    }
    return {handle: id, type};
  }
  function decode(value, depth = 0) {
    if (depth > 8) throw fault('DOM argument nesting limit', 7);
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') { if (value.length > limits.message) throw fault('DOM argument exceeds limits', 7); return value; }
    if (Array.isArray(value)) { if (value.length > 1024) throw fault('DOM argument array limit', 7); return value.map(v => decode(v, depth+1)); }
    if (value && Object.keys(value).length === 1 && Number.isSafeInteger(value.handle) && objects.has(value.handle)) return objects.get(value.handle).value;
    if (value?.empty === true && Object.keys(value).length === 1) return undefined;
    throw fault('Invalid DOM argument', 5);
  }
  function snapshot() { return {url: logicalURL, title: doc.title.slice(0,limits.url), readyState: doc.readyState}; }
  function status() { send({event: 'state', ...snapshot()}); }
  function wire() {
    // document.open removes Window/Document event listeners, but the port's
    // listener and this closure remain. Reattach after close without leaking.
    observer?.disconnect();
    if (doc.documentElement) {
      observer = new MutationObserver(() => { if (!wired) return; const title = doc.title; if (title !== lastTitle) { lastTitle = title; send({event:'title', title:title.slice(0,limits.url)}); } });
      observer.observe(doc.documentElement,{subtree:true,childList:true,characterData:true});
    }
    doc.addEventListener('click', click);
    doc.addEventListener('submit', submit, true);
    doc.addEventListener('readystatechange', status);
    scope.addEventListener('load', status);
    scope.addEventListener('pagehide', leaving);
    wired = true;
  }
  function navigation(url, target = '', replace = false) {
    send({event:'navigate', url:String(url), target:String(target), replace});
  }
  function click(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target?.closest?.('a[href],area[href]');
    if (!anchor || anchor.hasAttribute('download')) return;
    event.preventDefault();
    navigation(anchor.getAttribute('href').startsWith('#') ? logicalURL.split('#')[0]+anchor.getAttribute('href') : anchor.href, event.ctrlKey || event.metaKey || event.shiftKey ? '_blank' : anchor.target);
  }
  function submit(event) {
    // The browser handles genuine HTML form submission, including multipart
    // encoding, validation, cookies and origin policy. The parent is notified
    // that the prior automation document is about to leave, not given its data.
    if (!event.defaultPrevented) send({event:'leaving', url:String(event.target?.action || logicalURL)});
  }
  async function execute(request) {
    if (request.op === 'fragment') {
      if(typeof request.url!=='string'||request.url.length>limits.url||request.url.split('#')[0]!==logicalURL.split('#')[0])throw fault('Invalid same-document navigation',5);
      logicalURL=request.url;scope.location.hash=new URL(logicalURL).hash;return {empty:true};
    }
    if (request.op === 'command') {
      const command=Number(request.command),name=({11:'cut',12:'copy',13:'paste',15:'undo',16:'redo',17:'selectAll'})[command];
      const supported=command===6?typeof scope.print==='function':!!name&&typeof doc.execCommand==='function'&&doc.queryCommandSupported?.(name)===true;
      const enabled=supported&&(command===6?!silent:doc.queryCommandEnabled?.(name)===true);
      if(request.query===true)return (supported?1:0)|(enabled?2:0);
      if(request.query!==false||!enabled)throw fault('Browser command is unavailable or requires a user gesture/permission',445);
      if(command===6){scope.print();return {empty:true};}
      if(!doc.execCommand(name,false,null))throw fault('Browser rejected the editing command',445);
      return {empty:true};
    }
    if (request.op === 'silent') { if(typeof request.value!=='boolean')throw fault('Invalid Silent flag',5); silent=request.value; return {empty:true}; }
    if (request.op === 'root') return encode(doc,'object');
    if (request.op === 'script') {
      if (typeof request.script !== 'string' || request.script.length > limits.message) throw fault('Script exceeds limit', 5);
      // Indirect eval is confined to this opaque-origin child realm. CSP may
      // deny it; propagate that rejection rather than changing CSP or sandbox.
      const value = await (0, eval)(request.script);
      return encode(value);
    }
    if (request.op === 'message') { scope.dispatchEvent(new MessageEvent('message',{data:decode(request.value),origin:'null',source:parentWindow})); return {empty:true}; }
    const object = objects.get(request.handle);
    if (request.op === 'enumerate') {
      if (object?.type !== 'collection' || object.value.length > limits.objects) throw fault('Document enumeration limit or non-collection',7);
      return Array.from(object.value, value => encode(value,'object'));
    }
    const member = members.get(object?.type)?.get(String(request.name).toLowerCase());
    if (!object || !member || !member.modes.includes(request.mode) || !Array.isArray(request.args)) throw fault('DOM member or invocation mode is not supported');
    const args = request.args.map(v => decode(v));
    if (args.length > member.params.length + (request.mode === 4 || request.mode === 8 ? 1 : 0)) throw fault('Wrong number of DOM arguments',450);
    const target = object.value, name = member.dom;
    if (object.type === 'location') {
      if (request.mode === 2) return encode(name === 'href' ? logicalURL : new URL(logicalURL, 'https://localhost/')[name]);
      if (request.mode === 4 || request.mode === 8) { const url = new URL(logicalURL, 'https://localhost/'); url[name] = args[0]; navigation(url.href); return {empty:true}; }
      navigation(name === 'reload' ? logicalURL : args[0], '', name === 'replace'); return {empty:true};
    }
    if (object.type === 'window' && name === 'execScript') {
      if (args[1] && !/^(?:javascript|jscript)$/i.test(args[1])) throw fault('VBScript is not supported by an HTML5 engine',445);
      return execute({op:'script',script:args[0]});
    }
    if (object.type === 'document' && request.mode === 2 && name === 'URL') return logicalURL;
    if (object.type === 'document' && name === 'open' && request.mode === 1) {
      if (args[0] && String(args[0]).toLowerCase() !== 'text/html') throw fault('Document.Open supports text/html',5);
      wired = false; observer?.disconnect(); doc.open(); return {empty:true};
    }
    if (object.type === 'document' && ['write','writeln'].includes(name) && request.mode === 1) {
      const text = Array.isArray(args[0]) ? args[0].join('') : String(args[0] ?? '');
      if (text.length > limits.html) throw fault('Document.Write exceeds limit',7);
      // Real document.write preserves HTML parsing and script semantics. Port
      // listeners survive document.open/close; no innerHTML script simulation.
      doc[name](text); return {empty:true};
    }
    if (object.type === 'document' && name === 'close' && request.mode === 1) { doc.close(); wire(); status(); return {empty:true}; }
    if (object.type === 'collection' && request.mode === 1) {
      let value;
      if (name === 'tags') value = Array.from(target).filter(item => String(item.tagName).toLowerCase() === String(args[0]).toLowerCase());
      else if (name === 'namedItem' || typeof args[0] === 'string' && !/^\d+$/.test(args[0])) {
        const matches = Array.from(target).filter(item => item.id === args[0] || item.getAttribute?.('name') === args[0] || item.name === args[0]);
        value = args[1] === undefined ? name === 'item' && matches.length > 1 ? matches : matches[0] : matches[Number(args[1])];
      } else value = target[Number(args[0])];
      return value === undefined ? {nothing:true} : encode(value,'object');
    }
    if (object.type === 'element' && ['getAttribute','removeAttribute','setAttribute'].includes(name)) {
      const index=name==='setAttribute'?2:1;
      if(args[index]!==undefined&&Number(args[index])!==0)throw fault('IE-specific attribute flags are not available in an HTML5 DOM',445);
      args.splice(index);
    }
    if (request.mode === 2) return encode(target[name], member.result);
    if (request.mode === 4 || request.mode === 8) { target[name] = args[0]; return {empty:true}; }
    if (typeof target[name] !== 'function') throw fault('This HTML5 engine does not implement '+member.name,445);
    return encode(await target[name](...args),member.result);
  }
  function connect(event) {
    if (closed || port || event.source !== parentWindow || event.data?.channel !== 'vb6-webbrowser-connect' || event.data.nonce !== nonce || event.ports.length !== 1) return;
    port = event.ports[0];
    port.onmessage = async event => {
      const request = event.data;
      if (!request || !Number.isSafeInteger(request.id) || request.id <= 0) return;
      if (pending.size >= limits.rpc) { send({id:request.id,error:{message:'Document RPC limit',number:7}}); return; }
      if (pending.has(request.id)) return;
      pending.set(request.id,true);
      try { const value = await execute(request); send({id:request.id,value}); }
      catch (error) { send({id:request.id,error:{message:String(error?.message || error).slice(0,2048),number:error?.number || 440}}); }
      finally { pending.delete(request.id); }
    };
    port.start(); wire(); send({event:'connected',root:encode(doc,'object'),...snapshot()});
  }
  scope.addEventListener('message',connect);
  parentWindow.postMessage({channel:'vb6-webbrowser-ready',nonce},'*');
}
