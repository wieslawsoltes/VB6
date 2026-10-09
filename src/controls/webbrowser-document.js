import {AutomationRegistry} from '../runtime/automation.js';
import {NOTHING, MISSING, VBArray, unbox, storageScalar} from '../runtime/values.js';
import {WEB_DOM_TYPES} from './webbrowser-dom-contract.js';
import {WEB_BROWSER_LIMITS as limits, WebBrowserError} from './webbrowser-contract.js';

/** Bounded, revocable Automation facades; the VM never receives a DOM node. */
export class WebBrowserDocument {
  constructor(request) {
    this.request = request; this.closed = false; this.objects = new Map();
    this.handles = new WeakMap(); this.sessions = []; this.registry = new AutomationRegistry();
  }
  assertOpen() { if (this.closed) throw new WebBrowserError('This WebBrowser document has been released',91); }
  encode(value, depth = 0) {
    this.assertOpen(); value = unbox(value);
    if (depth > 8) throw new WebBrowserError('Document argument nesting limit',7);
    if (value === MISSING || value === undefined) return {empty:true};
    if (value === NOTHING || value === null) return null;
    if (typeof value === 'string' && value.length <= limits.message || typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean') return value;
    if (value && this.handles.has(value)) return {handle:this.handles.get(value)};
    if (value instanceof VBArray) value = [...value];
    if (Array.isArray(value) && value.length <= 1024) return value.map(v => this.encode(v,depth+1));
    throw new WebBrowserError('Only this document\'s handles and bounded scalar values can be passed to the browser',13);
  }
  decode(value) {
    this.assertOpen();
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= limits.message) return value;
    if (value?.nothing === true && Object.keys(value).length === 1) return NOTHING;
    if (value?.empty === true && Object.keys(value).length === 1) return undefined;
    const id = value?.handle, type = value?.type;
    if (!Number.isSafeInteger(id) || id < 1 || id > limits.objects || !Object.hasOwn(WEB_DOM_TYPES,type) || Object.keys(value).length !== 2) throw new WebBrowserError('Invalid document response',440);
    if (this.objects.has(id)) {
      const entry = this.objects.get(id);
      if (entry.type !== type) throw new WebBrowserError('Document handle changed type',440);
      return entry.object;
    }
    if (this.objects.size >= limits.objects) throw new WebBrowserError('Document handle limit',7);
    // Keep the generic Automation session's limit intact. Each bounded shard
    // owns at most 128 facades; all shards revoke together on navigation.
    if (this.objects.size % 128 === 0) this.sessions.push(this.registry.createSession());
    const adapter = {
      metadata:{members:WEB_DOM_TYPES[type], ...(type === 'collection' ? {defaultMember:'Item'} : {})},
      invoke:async (name, mode, args) => {
        this.assertOpen();
        const result = await this.request({op:'invoke',handle:id,name,mode,args:args.map(arg => this.encode(arg))});
        this.assertOpen(); return {value:this.decode(result),args};
      },
      release:() => {},
      ...(type === 'collection' ? {enumerate:async () => {
        this.assertOpen(); const values = await this.request({op:'enumerate',handle:id});
        if (!Array.isArray(values) || values.length > limits.objects) throw new WebBrowserError('Document enumeration limit',7);
        return values.map(value => this.decode(value));
      }} : {})
    };
    adapter.invokeScalar=async (name,mode,args) => {
      const result=await adapter.invoke(name,mode,args);
      const scalar=WEB_DOM_TYPES[type].find(member=>member.name.toLowerCase()===String(name).toLowerCase())?.scalar;
      return mode===2&&scalar?{...result,value:storageScalar(result.value,scalar)}:result;
    };
    const object = this.sessions.at(-1).adopt(adapter);
    this.handles.set(object,id); this.objects.set(id,{object,type}); return object;
  }
  async script(script) { this.assertOpen(); if (typeof script !== 'string' || script.length > limits.message) throw new WebBrowserError('Invalid or excessive script',5); return this.decode(await this.request({op:'script',script})); }
  async message(message) { this.assertOpen(); if (typeof message !== 'string') throw new WebBrowserError('Expected a string',13); return this.decode(await this.request({op:'message',value:this.encode(message)})); }
  close() { if (this.closed) return; this.closed = true; for (const session of this.sessions) void session.close(); this.sessions = []; this.objects.clear(); this.handles = new WeakMap(); }
}
