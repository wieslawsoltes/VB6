import {uiDocument} from './window-context.js';
/** Small framework-independent primitives shared by the IDE and runtime. */
export class Signal {
  constructor() { this.listeners = new Map(); }
  on(type, fn) { const list = this.listeners.get(type) || new Set(); list.add(fn); this.listeners.set(type, list); return () => list.delete(fn); }
  emit(type, value) { for (const fn of this.listeners.get(type) || []) fn(value); }
  clear() { this.listeners.clear(); }
}
export class History extends Signal {
  constructor(limit=120,maxBytes=32*1024*1024){super();this.limit=limit;this.maxBytes=maxBytes;this.undoStack=[];this.redoStack=[];}
  trim(){let size=this.undoStack.reduce((n,e)=>n+(e.bytes??(e.before.length+e.after.length)*2),0);while(this.undoStack.length>1&&(this.undoStack.length>this.limit||size>this.maxBytes)){const e=this.undoStack.shift();size-=(e.bytes??(e.before.length+e.after.length)*2);}}
  record(before,after,label='Edit'){
    const a=JSON.stringify(before),b=JSON.stringify(after);if(a===b)return false;
    this.undoStack.push({before:a,after:b,label});this.redoStack=[];this.trim();this.emit('change');return true;
  }
  // Text edits keep only source strings; they never copy/serialize form trees or image assets.
  recordValue(key,before,after,apply,label='Edit',merge=false){
    if(before===after)return false;const last=this.undoStack.at(-1);
    if(merge&&last?.kind==='value'&&last.key===key)last.after=after;
    else this.undoStack.push({kind:'value',key,before,after,apply,label});
    this.redoStack=[];this.trim();this.emit('change');return true;
  }
  // Sparse edit history: memory is proportional to changed text, not module size.
  recordPatch(key,patch,apply,label='Edit',merge=false){
    if(patch.before===patch.after)return false;const item=structuredClone(patch),bytes=JSON.stringify(item).length*2,last=this.undoStack.at(-1);
    if(merge&&last?.kind==='patch'&&last.key===key&&last.patches.length<256){last.patches.push(item);last.bytes+=bytes;}
    else this.undoStack.push({kind:'patch',key,patches:[item],bytes,apply,label,before:'',after:''});
    this.redoStack=[];this.trim();this.emit('change');return true;
  }
  undo(current){const e=this.undoStack.at(-1);if(!e)return null;const value=e.kind==='patch'?e.apply(structuredClone(current),e.patches,true):e.kind==='value'?e.apply(structuredClone(current),e.before):JSON.parse(e.before);this.undoStack.pop();this.redoStack.push(e);this.emit('change');return value;}
  redo(current){const e=this.redoStack.at(-1);if(!e)return null;const value=e.kind==='patch'?e.apply(structuredClone(current),e.patches,false):e.kind==='value'?e.apply(structuredClone(current),e.after):JSON.parse(e.after);this.redoStack.pop();this.undoStack.push(e);this.emit('change');return value;}
  reset(){this.undoStack=[];this.redoStack=[];this.emit('change');}
}
export const clone = value => structuredClone(value);
export const lower = name => String(name).toLowerCase().replace(/[$%&!#@]$/, '');
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function debounce(fn, delay = 200) { let id; const f = (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), delay); }; f.cancel = () => clearTimeout(id); return f; }
export function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], {type}));
  const a = uiDocument().createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && (k.startsWith('aria-') || ['spellcheck','draggable','contenteditable'].includes(k))) node.setAttribute(k,String(v));
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}
export function safeName(name, fallback = 'Project1') { const s = String(name).replace(/[^\w .-]/g, '_').slice(0, 100); return s || fallback; }
export const VERSION = '0.6.0';
