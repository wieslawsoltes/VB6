/** Borrowed common-control event objects. A descriptor is (HWND, native item,
 * creation generation), never an HWND disguised as an Object. Descriptors are
 * activation-local, read-only and cannot escape through Set/Variant conversion.
 * Unicode text comes from the live common control, not the saved caption.
 * https://learn.microsoft.com/windows/win32/controls/nm-click-tree-view
 * https://learn.microsoft.com/windows/win32/controls/nm-click-list-view
 */
import {mem32} from './x86-operands.js';
import {MAX_NATIVE_STRING} from './storage.js';
const key=v=>String(v).toLowerCase(),at=(base,displacement=0)=>mem32({base,displacement});
const local=o=>at('ebp',o),arg=argument=>({argument}),mem=memory=>({memory});
const ownersOf=owner=>owner.group?[...owner.group.entries.values()]:[owner];
const families={TreeView:'node',ListView:'listitem',TabStrip:'tab',SSTab:'tab'};
const aliases={node:['object','node','mscomctllib.node','comctllib.node'],listitem:['object','listitem','mscomctllib.listitem','comctllib.listitem']};
export function nativeEventItemStorage(c,decl,module,proc){
  if(!decl.parameter||!proc||!module.form)return null;
  const controls=module.form.controls.filter(control=>key(proc.name)===key(control.name)+'_'+({TreeView:'nodeclick',ListView:'itemclick'}[control.type]||'!'));
  if(!controls.length)return null;
  const control=controls[0],index=control.properties.Index===undefined?0:1;
  if(proc.params[index]?.name!==decl.name)return null;
  const kind=families[control.type];
  if(proc.params.length!==index+1||!aliases[kind].includes(key(decl.type))||decl.bounds!=null||decl.optional||decl.paramArray||decl.autoNew)
    c.fail('Native '+proc.name+' requires one '+kind+' object argument after any control-array Index',module);
  return {...decl,type:'Object',nativeItem:{name:control.name,kind},nativeElementBytes:4,nativeCount:1,nativeBytes:4,nativeDataBytes:4};
}
export function prepareNativeItems(c,control){
  if(families[control.model.type])control.itemGeneration=c.slot('item-generation:'+control.module.name+':'+control.key);
}
export function createNativeItems(c,control){
  if(control.itemGeneration)c.x.inc(mem32({label:control.itemGeneration}));
}
export function nativeItemObject(c,node){
  if(node.kind==='id'){
    const variable=c.context?.locals.get(key(node.name));
    if(variable?.nativeItem){
      const owners=[...c.context.module.controls.values()].filter(o=>key(o.model.name)===key(variable.nativeItem.name));
      return {nativeItem:true,kind:variable.nativeItem.kind,variable,owners,module:c.context.module};
    }
  }
  if(node.kind==='member'&&key(node.name)==='selecteditem'){
    const owner=c.object(node.object),kind=families[owner?.model?.type];
    if(kind)return {nativeItem:true,kind,selected:true,owner,owners:ownersOf(owner),module:owner.module};
  }
  return null;
}
export function nativeItemType(c,node){
  if(node.kind==='member'&&['text','caption','key'].includes(key(node.name))&&c.object(node.object)?.nativeItem)return 'string';
  return null;
}
function descriptor(c,object){
  const x=c.x,slot=c.arrayWorkspace(12,'common-item');
  if(object.selected){
    c.ensure(object.owner);x.value(c.controlHandleRef(object.owner)).mov(local(slot.offset),'eax');
    x.api('user32.dll','SendMessageW',[c.controlHandleRef(object.owner),{node:0x110a,listitem:0x100c,tab:0x130b}[object.kind],object.kind==='node'?9:object.kind==='listitem'?-1:0,object.kind==='listitem'?2:0]);
    x.test().branch(object.kind==='node'?'e':'s','error:91').mov(local(slot.offset+4),'eax');
    const ready=x.unique();
    for(const owner of object.owners){const next=x.unique();x.value(mem(owner.handle)).cmp('eax',local(slot.offset)).branch('ne',next).value(mem(owner.itemGeneration)).mov(local(slot.offset+8),'eax').jump(ready).label(next);}
    x.jump('error:91').label(ready);
  }else{
    if(object.descriptorSlot)x.local(object.descriptorSlot.offset);
    else {x.value(arg(object.variable.offset));if(object.variable.byRef)x.mov('eax',at('eax'));}
    x.test().branch('e','error:91').mov('edx','eax');
    for(let i=0;i<12;i+=4)x.mov('eax',at('edx',i)).mov(local(slot.offset+i),'eax');
  }
  const valid=x.unique();
  for(const owner of object.owners){const next=x.unique();
    x.value(mem(owner.handle)).test().branch('e',next).cmp('eax',local(slot.offset)).branch('ne',next)
      .value(mem(owner.itemGeneration)).cmp('eax',local(slot.offset+8)).branch('e',valid).label(next);
  }
  x.jump('error:91').label(valid).api('user32.dll','IsWindow',[arg(slot.offset)]).test().branch('e','error:91');
  return slot;
}
export function bindNativeItem(c,object){
  return {...object,selected:false,descriptorSlot:descriptor(c,object)};
}
export function invalidateNativeItems(c,object){
  if(!['TreeView','ListView','TabStrip','SSTab'].includes(object.model?.type))return;
  const x=c.x,done=x.unique(),owners=ownersOf(object);
  x.value(c.controlHandleRef(object)).mov('edx','eax');
  for(const owner of owners){const next=x.unique();x.value(mem(owner.handle)).cmp('eax','edx').branch('ne',next).inc(mem32({label:owner.itemGeneration})).jump(done).label(next);}
  x.label(done);
}
export function getNativeItemProperty(c,object,property){
  if(!object.nativeItem)return false;
  if(!['text','caption','index','key'].includes(property))c.fail('Native common-control item property is not lowered: '+property);
  const slot=descriptor(c,object),x=c.x;
  if(['text','caption'].includes(property)){
    c.nativeItemTextKinds ||= new Set();c.nativeItemTextKinds.add(object.kind);
    const out=c.temporaryString();c.rawStorageAddress(out);x.push().push(arg(slot.offset+4)).push(arg(slot.offset)).call('native:item:text:'+object.kind);return true;
  }
  // Reject deleted native items even when a caller mutated the HWND directly.
  if(object.kind==='node'){
    const probe=c.arrayWorkspace(40,'item-probe');x.local(probe.offset).mov('edi','eax').mov('ecx',10).xor('eax','eax').cld().repStore(32);
    x.value(arg(slot.offset+4)).mov(local(probe.offset+4),'eax');
    x.api('user32.dll','SendMessageW',[arg(slot.offset),0x113e,0,{address:probe.offset}]).test().branch('e','error:91');
  }else{
    x.api('user32.dll','SendMessageW',[arg(slot.offset),object.kind==='tab'?0x1304:0x1004,0,0]).cmp('eax',local(slot.offset+4)).branch('le','error:91');
    if(property==='index'){x.value(arg(slot.offset+4)).inc('eax');return true;}
  }
  const done=x.unique();
  for(const owner of object.owners){
    const next=x.unique();x.value(mem(owner.handle)).cmp('eax',local(slot.offset)).branch('ne',next);
    const items=object.kind==='node'?owner.treePlan:object.kind==='listitem'?owner.items:owner.tabs;
    for(const [i,item]of items.entries()){
      const more=x.unique();x.value(arg(slot.offset+4));
      if(object.kind==='node')x.cmp('eax',mem32({label:item.handle}));else x.compare(i);
      x.branch('ne',more).value(property==='index'?(object.kind==='node'?item.index:i)+1:c.string((object.kind==='node'?item.value:item).Key||'')).jump(done).label(more);
    }
    x.jump('error:5').label(next);
  }
  x.jump('error:91').label(done);return true;
}
/** EAX contains NM_CLICK. The parent window procedure owns a 64-byte frame;
 * keep Index(-16), callback boundary(-12), item(-40..-32) and hit-test(-64..-52)
 * disjoint. Callees preserve ESI, which points to the incoming NMHDR. */
export function nativeItemClick(c,module,control,zero){
  const kind=families[control.model.type],event={node:'NodeClick',listitem:'ItemClick'}[kind];
  if(!event||!c.hasNativeControlEvent(module,control,event))return;
  const x=c.x,proc=module.procedures.get(key(control.model.name+'_'+event)),p=proc.proc.params.at(-1);
  if(!p||!proc.locals.get(key(p.name))?.nativeItem)c.fail('Native item event requires an object argument',module);
  x.value(mem(control.handle)).mov(local(-40),'eax').value(mem(control.itemGeneration)).mov(local(-32),'eax');
  const noItem=x.unique();
  if(kind==='listitem'){
    const found=x.unique();x.mov('eax',at('esi',12)).test().branch('ns',found);
    // NMITEMACTIVATE.iItem is not valid for every report-view subitem click.
    // Hit-test ptAction in client coordinates rather than inventing selection.
    x.mov('eax',at('esi',32)).mov(local(-64),'eax').mov('eax',at('esi',36)).mov(local(-60),'eax');
    for(const offset of [-56,-52,-48,-44])x.mov(local(offset),0);
    x.api('user32.dll','SendMessageW',[arg(-40),0x1039,0,{address:-64}]).test().branch('s',noItem).label(found);
  }
  else {
    x.api('user32.dll','GetMessagePos').mov('edx','eax').emit(0x0f,0xbf,0xc0).mov(local(-64),'eax').shift('sar','edx',16).mov(local(-60),'edx');
    x.api('user32.dll','ScreenToClient',[arg(-40),{address:-64}]).test().branch('e',noItem)
      .api('user32.dll','SendMessageW',[arg(-40),0x1111,0,{address:-64}]).test().branch('e',noItem);
    x.mov('edx',local(-56)).and('edx',0x46).testOperand('edx','edx').branch('e',noItem);
  }
  x.mov(local(-36),'eax');
  if(p.byRef){x.local(-40).mov(local(-44),'eax');c.controlHandler(module,control,event,[{ref:-44,types:aliases[kind]}]);}
  else c.controlHandler(module,control,event,[{address:-40}]);
  // A callback may close/reopen its form. Never send a second event to a new HWND.
  x.value(mem(control.handle)).cmp('eax',local(-40)).branch('ne',zero).value(mem(control.itemGeneration)).cmp('eax',local(-32)).branch('ne',zero).label(noItem);
}
export function emitNativeItemTextHelpers(c){
  const x=c.x;
  for(const kind of c.nativeItemTextKinds||[]){
    const loop=x.unique(),scan=x.unique(),counted=x.unique(),copy=x.unique(),grow=x.unique(),size=x.unique();
    // TVITEMW=40, LVITEMW=40, TCITEMW=28. All fields are initialized per retry.
    const text=kind==='node'?-24:kind==='listitem'?-20:-28,length=text+4;
    x.label('native:item:text:'+kind).enter(40).value(arg(16)).mov('esi','eax').mov('ebx',32);
    if(kind!=='node')x.value(arg(12)).test().branch('s','error:91').api('user32.dll','SendMessageW',[arg(8),kind==='tab'?0x1304:0x1004,0,0]).cmp('eax',local(12)).branch('le','error:91');
    x.label(loop).pushOperand(at('esi')).invoke('oleaut32.dll','SysFreeString').mov(at('esi'),0);
    x.local(-40).mov('edi','eax').mov('ecx',10).xor('eax','eax').cld().repStore(32).mov(local(-40),1);
    if(kind==='node')x.value(arg(12)).mov(local(-36),'eax');
    x.pushOperand('ebx').push(0).invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7').mov(at('esi'),'eax').mov(local(text),'eax').mov(local(length),'ebx');
    // The sentinel bounds even an empty/malformed native text response.
    x.mov('edx','eax').lea('ecx',at('ebx',-1)).emit(0x66,0xc7,0x04,0x4a,0,0);
    x.api('user32.dll','SendMessageW',[arg(8),{node:0x113e,listitem:0x1073,tab:0x133c}[kind],kind==='node'?0:arg(12),{address:-40}]);
    if(kind!=='listitem')x.test().branch('e','error:91');
    x.value(arg(text)).mov('edx','eax').xor('ecx','ecx').test().branch('e',copy).compare(-1).branch('e','error:5');
    x.label(scan).emit(0x66,0x83,0x3c,0x4a,0).branch('e',counted).inc('ecx').cmp('ecx',MAX_NATIVE_STRING+1).branch('a','error:7').jump(scan);
    x.label(counted).cmp('edx',at('esi')).branch('ne',copy).lea('eax',at('ebx',-1)).cmp('ecx','eax').branch('ae',grow);
    x.label(copy).cmp('ecx',MAX_NATIVE_STRING).branch('a','error:7').pushOperand('ecx').pushOperand('edx').pushOperand('esi').invoke('oleaut32.dll','SysReAllocStringLen').test().branch('e','error:7').mov('eax',at('esi')).leave(12);
    x.label(grow).cmp('ebx',MAX_NATIVE_STRING+2).branch('ae','error:7').shift('shl','ebx',1).cmp('ebx',MAX_NATIVE_STRING+2).branch('be',size).mov('ebx',MAX_NATIVE_STRING+2).label(size).jump(loop);
  }
}
