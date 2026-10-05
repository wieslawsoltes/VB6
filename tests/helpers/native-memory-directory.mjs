import {bytesOf} from '../../src/project/native-text.js';
const missing=()=>Object.assign(new Error('Not found'),{name:'NotFoundError'});
export class MemoryDirectory {
  constructor(files={},root=null,path=''){
    this.root=root||this;this.path=path;this.kind='directory';this.name=path.split('/').at(-1);
    if(!root){this.files=new Map(Object.entries(files).map(([p,b])=>[p,bytesOf(b).slice()]));this.dirs=new Set(['']);this.writes=[];for(const p of this.files.keys()){let d=p.split('/');d.pop();while(d.length){this.dirs.add(d.join('/'));d.pop();}}}
  }
  child(n){if(!n||n.includes('/')||n==='.'||n==='..')throw Error('Invalid child name');return this.path?this.path+'/'+n:n;}
  async isSameEntry(h){return h.root===this.root&&h.path===this.path;}
  async getDirectoryHandle(n,{create=false}={}){const p=this.child(n);if(this.root.files.has(p))throw Error('File exists');if(!this.root.dirs.has(p)){if(!create)throw missing();this.root.dirs.add(p);}return new MemoryDirectory({},this.root,p);}
  async getFileHandle(n,{create=false}={}){const p=this.child(n),r=this.root;if(r.dirs.has(p))throw Error('Directory exists');if(!r.files.has(p)){if(!create)throw missing();r.files.set(p,new Uint8Array());}return {kind:'file',name:n,async getFile(){if(!r.files.has(p))throw missing();r.onRead?.(p);const b=r.files.get(p).slice();return {size:b.length,arrayBuffer:async()=>b.buffer};},async createWritable(){let data;return {async write(b){r.beforeWrite?.(p);data=bytesOf(b).slice();},async close(){r.beforeClose?.(p);r.files.set(p,data);r.writes.push(p);r.afterWrite?.(p);},async abort(){}};}};}
  async removeEntry(n,{recursive=false}={}){const p=this.child(n),r=this.root;r.beforeRemove?.(p);if(r.files.has(p)){r.files.delete(p);return;}if(!r.dirs.has(p))throw missing();const children=[...r.files.keys(),...r.dirs.keys()].filter(s=>s.startsWith(p+'/'));if(children.length&&!recursive)throw Error('Not empty');for(const s of children){r.files.delete(s);r.dirs.delete(s);}r.dirs.delete(p);}
  async *values(){const prefix=this.path?this.path+'/':'';for(const p of this.root.dirs)if(p!==this.path&&p.startsWith(prefix)&&!p.slice(prefix.length).includes('/'))yield new MemoryDirectory({},this.root,p);for(const p of this.root.files.keys())if(p.startsWith(prefix)&&!p.slice(prefix.length).includes('/'))yield this.getFileHandle(p.slice(prefix.length));}
}
