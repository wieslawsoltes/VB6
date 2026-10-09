/** Native ListBox/ComboBox indexed properties. The HWND owns strings and signed
 * LONG item data; compiler temporaries own all returned BSTRs. Never confuse a
 * legitimate ItemData=-1 with LB_ERR/CB_ERR: validate the index independently.
 * https://learn.microsoft.com/windows/win32/controls/lb-getitemdata
 * https://learn.microsoft.com/windows/win32/controls/lb-gettext
 * https://learn.microsoft.com/windows/win32/controls/lb-insertstring
 */
import {mem32} from './x86-operands.js';
import {planNativeArguments} from './call-plan.js';
import {MAX_NATIVE_STRING} from './storage.js';
const key=v=>String(v).toLowerCase(),isList=o=>['ListBox','ComboBox'].includes(o?.model?.type);
const at=(base,displacement=0)=>mem32({base,displacement}),local=n=>at('ebp',n),arg=argument=>({argument});
const mem=memory=>({memory});
// WinUser.h: LB_SETSEL=0x0185. 0x0183 is LB_SELITEMRANGEEX and has
// different wParam/lParam semantics (equal endpoints deselect the item).
// https://learn.microsoft.com/windows/win32/controls/lb-setsel
const LB_SETSEL=0x185;
const message={ListBox:{count:0x18b,getdata:0x199,setdata:0x19a,add:0x180,insert:0x181,remove:0x182,clear:0x184,length:0x18a,text:0x189,select:0x186,current:0x188,sort:2},
  ComboBox:{count:0x146,getdata:0x150,setdata:0x151,add:0x143,insert:0x14a,remove:0x144,clear:0x14b,length:0x149,text:0x148,select:0x14e,current:0x147,sort:0x100}};
function send(c,s,msg,w=0,l=0){c.x.api('user32.dll','SendMessageW',[arg(s.offset),msg,w,l]);}
function snapshot(c,object,ensured=false){
  if(!ensured)c.ensure(object);
  const x=c.x,s=c.arrayWorkspace(12,'list-receiver'),done=x.unique();
  x.value(c.controlHandleRef(object)).mov(local(s.offset),'eax');
  for(const owner of object.group?[...object.group.entries.values()]:[object]){
    const next=x.unique();x.value(mem(owner.handle)).test().branch('e',next).cmp('eax',local(s.offset)).branch('ne',next)
      .value(owner.listInfo).mov(local(s.offset+4),'eax').mov('eax',at('eax')).mov(local(s.offset+8),'eax').jump(done).label(next);
  }
  x.jump('error:91').label(done);return s;
}
function guard(c,s){
  const x=c.x;x.mov('edx',local(s.offset+4)).mov('eax',at('edx')).cmp('eax',local(s.offset+8)).branch('ne','error:91')
    .mov('eax',at('edx',8)).mov('eax',at('eax')).cmp('eax',local(s.offset)).branch('ne','error:91')
    .api('user32.dll','IsWindow',[arg(s.offset)]).test().branch('e','error:91');
}
function storeResult(c,kind){const s=c.arrayWorkspace(4,kind);c.x.mov(local(s.offset),'eax');return s;}
function checkIndex(c,s,m,index,append=false,error=381){
  c.x.value(arg(index.offset)).test().branch('s','error:'+error);send(c,s,m.count);
  c.x.cmp('eax',local(index.offset)).branch(append?'l':'le','error:'+error);
}
function setNewIndex(c,s,index){c.x.mov('edx',local(s.offset+4)).value(index).mov(at('edx',4),'eax');}
function property(c,object,name,args,value){
  if(!isList(object)||!['list','itemdata','selected'].includes(name))return false;
  if(name==='selected'&&object.model.type!=='ListBox')c.fail('Selected(index) requires a native ListBox');
  const plan=planNativeArguments({name,params:[{name:'index'}]},args,m=>c.fail(m)),x=c.x,m=message[object.model.type];
  if(name==='list'&&value!==undefined)c.fail('Native List(index) assignment is not yet lowered; use AddItem/RemoveItem');
  const s=snapshot(c,object);c.numeric(plan.slots[0].node);const index=storeResult(c,'list-index');
  let candidate;
  if(value!==undefined){if(name==='selected')c.truth(value);else c.numeric(value);candidate=storeResult(c,'list-value');}
  guard(c,s);checkIndex(c,s,m,index);
  if(name==='list'){
    (c.nativeListTextKinds ||=new Set()).add(object.model.type);
    const out=c.temporaryString();c.rawStorageAddress(out);x.push().push(arg(index.offset)).push(arg(s.offset)).call('native:list:text:'+object.model.type);return true;
  }
  if(name==='itemdata'){
    send(c,s,value===undefined?m.getdata:m.setdata,arg(index.offset),candidate?arg(candidate.offset):0);
    if(candidate)x.compare(-1).branch('e','error:381');return true;
  }
  if(value===undefined){send(c,s,0x187,arg(index.offset));x.compare(-1).branch('e','error:381').test();c.boolean('<>');return true;}
  // LB_SETSEL only works for multi-select controls. Query actual style so a
  // statically indexed group can contain both single and multi-select entries.
  const single=x.unique(),done=x.unique();x.api('user32.dll','GetWindowLongW',[arg(s.offset),-16]).and('eax',0x808).test().branch('e',single);
  send(c,s,LB_SETSEL,arg(candidate.offset),arg(index.offset));x.compare(-1).branch('e','error:381').jump(done).label(single);
  const choose=x.unique();x.value(arg(candidate.offset)).test().branch('ne',choose);
  send(c,s,m.current);x.cmp('eax',local(index.offset)).branch('ne',done);send(c,s,m.select,-1);x.jump(done).label(choose);
  send(c,s,m.select,arg(index.offset));x.compare(-1).branch('e','error:381').label(done);return true;
}
export function prepareNativeList(c,control){
  if(!isList(control))return;
  const data=control.model.properties.ItemData;
  if(data!==undefined&&(!Array.isArray(data)||data.length>(control.model.properties.List||[]).length||data.some(n=>!Number.isInteger(n)||n< -2147483648||n>2147483647)))
    c.fail('Native ItemData must be signed LONGs corresponding to saved List entries',control.module);
  try{control.initialListSelection=nativeListInitialSelection(control.model.type,control.model.properties);}catch(error){c.fail(error.message,control.module);}
  control.listInfo='list-info:'+control.module.name+':'+control.key;
  c.data.align(4).label(control.listInfo).u32(0).u32(0xffffffff).reference(control.handle);
}
/** A VB ListIndex of -1 means no initial selection, never LB_SETSEL's
 * select-all sentinel. Only a real item can initialize a multi-select caret. */
export function nativeListInitialSelection(type,properties){
  if(properties.ListIndex===undefined)return [];
  const index=Number(properties.ListIndex);
  if(!Number.isInteger(index)||index< -1||index>=(properties.List||[]).length)
    throw new TypeError('Native initial ListIndex must be -1 or an existing zero-based item');
  if(type==='ListBox'&&properties.MultiSelect)return index===-1?[]:[[LB_SETSEL,1,index],[0x19e,index,0]];
  return [[type==='ListBox'?0x186:0x14e,index,0]];
}
export function createNativeList(c,control){
  if(!isList(control))return;
  const x=c.x,p=control.model.properties,m=message[control.model.type];
  x.inc(mem32({label:control.listInfo})).value(-1).store(control.listInfo,4);
  for(const [index,item]of (p.List||[]).entries()){
    x.api('user32.dll','SendMessageW',[mem(control.handle),m.add,0,c.string(item)]).test().branch('s','error:7');
    // Use Windows' returned index: the saved list may be sorted on insertion.
    x.mov('ecx','eax').push(p.ItemData?.[index]??0).pushOperand('ecx').push(m.setdata).push(mem(control.handle)).invoke('user32.dll','SendMessageW').compare(-1).branch('e','error:381');
  }
  for(const [msg,wp,lp]of control.initialListSelection)x.api('user32.dll','SendMessageW',[mem(control.handle),msg,wp,lp]);
}
export const nativeListMethods={
  nativeListType(node){
    if(node.kind!=='call'||node.callee.kind!=='member'||!isList(this.object(node.callee.object)))return null;
    return {list:'string',itemdata:'long',selected:'boolean'}[key(node.callee.name)]||null;
  },
  nativeListAssignment(target,value){
    if(target.kind!=='call'||target.callee.kind!=='member')return false;
    return property(this,this.object(target.callee.object),key(target.callee.name),target.args,value);
  },
  nativeListProperty(object,name,value){
    if(!isList(object)||name!=='newindex')return false;
    if(value!==undefined)this.fail('Native NewIndex is read-only');
    const s=snapshot(this,object);guard(this,s);this.x.mov('eax',local(s.offset+4)).mov('eax',at('eax',4));return true;
  },
  nativeListMethod(object,name,args){
    if(!isList(object))return false;
    if(property(this,object,name,args))return true;
    if(!['additem','removeitem','clear'].includes(name))return false;
    const params=name==='additem'?[{name:'item'},{name:'index',optional:true}]:name==='removeitem'?[{name:'index'}]:[];
    const plan=planNativeArguments({name,params},args,m=>this.fail(m)),s=snapshot(this,object),x=this.x,m=message[object.model.type],slots=[];
    for(const entry of plan.order){
      if(entry.omitted){slots[entry.index]=null;continue;}
      if(name==='additem'&&entry.index===0)this.textExpression(entry.node);else this.numeric(entry.node);
      slots[entry.index]=storeResult(this,'list-argument');
    }
    guard(this,s);
    if(name==='clear'){send(this,s,m.clear);guard(this,s);setNewIndex(this,s,-1);return true;}
    if(name==='removeitem'){checkIndex(this,s,m,slots[0]);send(this,s,m.remove,arg(slots[0].offset));x.compare(-1).branch('e','error:381');return true;}
    if(slots[1])checkIndex(this,s,m,slots[1],true,380);
    const added=x.unique();
    if(slots[1]){
      const sorted=x.unique();x.api('user32.dll','GetWindowLongW',[arg(s.offset),-16]).and('eax',m.sort).test().branch('ne',sorted);
      send(this,s,m.insert,arg(slots[1].offset),arg(slots[0].offset));x.jump(added).label(sorted);
    }
    send(this,s,m.add,0,arg(slots[0].offset));x.label(added).test().branch('s','error:7');
    const index=storeResult(this,'list-new-index');guard(this,s);setNewIndex(this,s,arg(index.offset));return true;
  }
};
export function emitNativeListHelpers(c){
  const x=c.x;
  for(const type of c.nativeListTextKinds||[]){
    const m=message[type],ready=x.unique();
    // Standard HWND list controls use a same-thread, synchronous get-length /
    // get-text pair. Allocate the capacity reported by Windows, which can exceed
    // the actual UTF-16 length when ANSI/Unicode messages have been mixed.
    x.label('native:list:text:'+type).enter().value(arg(16)).mov('esi','eax').pushOperand(at('esi')).invoke('oleaut32.dll','SysFreeString').mov(at('esi'),0);
    x.api('user32.dll','SendMessageW',[arg(8),m.length,arg(12),0]).compare(-1).branch('e','error:381').compare(MAX_NATIVE_STRING).branch('a','error:7').mov('ebx','eax')
      .push().push(0).invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7').mov(at('esi'),'eax').mov('edi','eax');
    x.pushOperand('edi').push(arg(12)).push(m.text).push(arg(8)).invoke('user32.dll','SendMessageW').compare(-1).branch('e','error:381').cmp('eax','ebx').branch('a','error:5').branch('e',ready)
      .push().pushOperand('edi').pushOperand('esi').invoke('oleaut32.dll','SysReAllocStringLen').test().branch('e','error:7');
    x.label(ready).mov('eax',at('esi')).leave(12);
  }
}
