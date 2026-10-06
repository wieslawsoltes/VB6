import {Win32Error,integer,unsigned} from './core.js';
import {registerAW,units} from './services-utils.js';
/** Process-private atom table and registered-window properties.
 * https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-globaladdatoma
 * https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setpropa
 * https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumpropsexa */
export function installWindowProperties(w){
  const m=w.memory,h=w.handles,atoms=new Map(),byName=new Map();let next=0xc000;
  const notes='Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API.';
  const aw=(dll,name,arity,fn,options={})=>registerAW(w,dll,name,arity,fn,{notes,...options});
  function parsed(p,wide){
    if(typeof p==='number'&&p<=0xffff){if(p<1||p>=0xc000)throw new Win32Error('Invalid integer atom');return p;}
    const name=m.string(p,wide);if(!name||units(m,name,wide)>255)throw new Win32Error('Atom name length must be 1..255');
    if(/^#\d+$/.test(name))return integer(Number(name.slice(1)),1,0xbfff);return name;
  }
  function find(name){if(typeof name==='number')return name;const id=byName.get(name.toLowerCase());if(!id)throw new Win32Error('Atom not found',2);return id;}
  function retain(name){
    if(typeof name==='number')return name;
    const old=byName.get(name.toLowerCase());if(old){atoms.get(old).refs++;return old;}
    if(atoms.size>=0x4000)throw new Win32Error('Atom table is full',8);
    while(atoms.has(next))next=next===0xffff?0xc000:next+1;
    const id=next;atoms.set(id,{name,refs:1});byName.set(name.toLowerCase(),id);next=next===0xffff?0xc000:next+1;return id;
  }
  function release(id){id=integer(id,1,0xffff);if(id<0xc000)return;const atom=atoms.get(id);if(!atom)throw new Win32Error('Invalid string atom',6);if(--atom.refs===0){atoms.delete(id);byName.delete(atom.name.toLowerCase());}}
  const atomName=id=>{id=integer(id,1,0xffff);if(id<0xc000)return '#'+id;const atom=atoms.get(id);if(!atom)throw new Win32Error('Invalid string atom',6);return atom.name;};
  aw('kernel32','GlobalAddAtom',1,(wide,p)=>retain(parsed(p,wide)));
  aw('kernel32','GlobalFindAtom',1,(wide,p)=>find(parsed(p,wide)));
  aw('kernel32','GlobalGetAtomName',3,(wide,id,out,capacity)=>{capacity=integer(capacity,1,0x7fffffff);return m.putString(out,atomName(id),capacity,wide);});
  w.register('kernel32','GlobalDeleteAtom',id=>{release(id);return 0;},{arity:1,notes});
  const windows=new Map();
  function props(handle){handle=Number(handle);if(!h.has(handle,'window'))throw new Win32Error('Invalid window handle',1400);let map=windows.get(handle);if(!map)windows.set(handle,map=new Map());return map;}
  function propertyName(p,wide){if(typeof p==='number'&&p>0&&p<=0xffff)return p<0xc000?p:atomName(p);return parsed(p,wide);}
  function propertyKey(name){return typeof name==='number'?'#'+name:'s:'+name.toLowerCase();}
  aw('user32','SetProp',3,(wide,handle,p,data)=>{
    const map=props(handle),name=propertyName(p,wide),key=propertyKey(name);data=unsigned(data);
    const old=map.get(key);if(old){old.data=data;return 1;}
    if(map.size>=integer(w.options.maxWindowProperties??1024,1,65536))throw new Win32Error('Window property quota exceeded',8);
    const id=retain(name);map.set(key,{name,id,data,integer:typeof name==='number'});return 1;
  });
  aw('user32','GetProp',2,(wide,handle,p)=>{const map=props(handle);return map.get(propertyKey(propertyName(p,wide)))?.data??0;});
  aw('user32','RemoveProp',2,(wide,handle,p)=>{const map=props(handle),key=propertyKey(propertyName(p,wide)),entry=map.get(key);if(!entry)return 0;map.delete(key);release(entry.id);return entry.data;});
  aw('user32','EnumPropsEx',3,async(wide,handle,callback,data)=>{
    const map=props(handle),fn=h.get(callback,'callback'),snapshot=[...map];let result=-1;
    for(const [key,entry]of snapshot){if(w.disposed||!h.has(handle,'window'))break;if(map.get(key)!==entry)continue;
      let pointer=entry.integer?entry.id:m.allocString(entry.name,wide);
      try{result=Number(await fn(handle,pointer,entry.data,data))|0;if(!result)break;}
      finally{if(!entry.integer&&!w.disposed)m.free(pointer);}
    }return result;
  },{failure:-1});
  w.releaseWindowProperties=handle=>{const map=windows.get(Number(handle));if(map){for(const entry of map.values())release(entry.id);windows.delete(Number(handle));}};
  w.disposeWindowProperties=()=>{windows.clear();atoms.clear();byName.clear();};
}
