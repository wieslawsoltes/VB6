import {nativeItemObject,prepareNativeItems,createNativeItems,getNativeItemProperty,invalidateNativeItems} from './control-items.js';
/** Persisted common-control content and collection-wide native operations. Item
 * objects are not silently approximated as HWNDs: unlowered member calls fail. */
const mem=memory=>({memory}),key=s=>String(s).toLowerCase();
// Allocate strings before writing .rdata records: string() appends to the same
// section and would otherwise insert a BSTR header inside a native pointer field.
const collections={TreeView:['nodes'],ListView:['listitems','columnheaders'],StatusBar:['panels'],Toolbar:['buttons'],TabStrip:['tabs'],SSTab:['tabs']};
export function nativeTreePlan(nodes){
  if(!Array.isArray(nodes)||nodes.length>10000)throw new TypeError('Native TreeView requires at most 10000 saved nodes');
  const keys=new Map(),result=nodes.map((value,index)=>({value,index,parent:null,depth:0}));
  for(const item of result){const id=key(item.value.Key||'');if(id){if(keys.has(id))throw new TypeError('Duplicate native tree node key: '+id);keys.set(id,item);}}
  for(const item of result){const relative=item.value.Parent;if(relative!==undefined&&relative!==null&&relative!==''){item.parent=typeof relative==='number'?result[relative-1]:keys.get(key(relative));if(!item.parent)throw new TypeError('Missing native tree parent: '+relative);}}
  for(const item of result){const chain=[],seen=new Set();let node=item;while(node&&!node.depth){if(seen.has(node))throw new TypeError('Cyclic native tree nodes');seen.add(node);chain.push(node);node=node.parent;}let depth=node?.depth||0;for(const entry of chain.reverse())entry.depth=++depth;}
  return result.sort((a,b)=>a.depth-b.depth||a.index-b.index);
}
export const nativeControlCollectionMethods={
  nativeControlCollectionObject(node){
    const item=nativeItemObject(this,node);if(item)return item;
    if(node.kind!=='member'||!['nodes','listitems','columnheaders','panels','buttons','tabs'].includes(key(node.name)))return null;
    const owner=this.object(node.object),kind=key(node.name);if(!collections[owner?.model?.type]?.includes(kind))return null;
    return {nativeCollection:true,owner,kind,module:owner.module};
  },
  prepareNativeControlCollections(control){
    prepareNativeItems(this,control);
    const p=control.model.properties;
    try{if(control.model.type==='TreeView'){
      control.treePlan=nativeTreePlan(p.Nodes||[]);
      // Procedures (including Node.Key/Index) are emitted before form creation.
      // Reserve handle identities now; allocating them during HWND creation
      // made the earlier comparison encode an absolute read from address zero.
      for(const item of control.treePlan)item.handle=this.slot('tree-item:'+control.module.name+':'+control.key+':'+item.index);
    }}catch(error){this.fail(control.model.name+': '+error.message,control.module);}
    if(control.model.type==='ListView'){
      control.columns=p.Columns||p.ColumnHeaders||[];control.items=p.Items||p.ListItems||[];
      if(!Array.isArray(control.columns)||!Array.isArray(control.items)||control.columns.length>1000||control.items.length>10000)this.fail('Native ListView collection limit exceeded',control.module);
      if(p.Sorted&&p.SortKey)this.fail('Native ListView subitem sorting is not yet lowered',control.module);
    }
    if(control.model.type==='StatusBar'&&(!Array.isArray(p.Panels||[])||(p.Panels||[]).length>256))this.fail('Native StatusBar supports at most 256 panels',control.module);
    if(control.model.type==='Toolbar'&&(!Array.isArray(p.Buttons||[])||(p.Buttons||[]).length>10000))this.fail('Native Toolbar supports at most 10000 saved buttons',control.module);
  },
  createNativeControlCollections(control){
    createNativeItems(this,control);
    const {model,module}=control,p=model.properties,type=model.type,x=this.x;
    const send=(msg,w=0,l=0)=>x.api('user32.dll','SendMessageW',[mem(control.handle),msg,w,l]);
    if(type==='TreeView'){
      const plan=control.treePlan;
      for(const item of plan){
        const data='tree-insert:'+module.name+':'+control.key+':'+item.index,image=this.nativeBoundImageIndex(control,item.value.Image),selected=this.nativeBoundImageIndex(control,item.value.SelectedImage??item.value.Image);
        this.data.align(4).label(data).u32(0xffff0000).u32(0xffff0002).u32(1|(image<0?0:2)|(selected<0?0:32)).u32(0).u32(0).u32(0).reference(this.string(item.value.Text||'')).u32(0).u32(image).u32(selected).u32(0).u32(0);
        if(item.parent)x.value(mem(item.parent.handle)).store(data);
        send(0x1132,0,data);x.test().branch('e','error:7').store(item.handle);
      }
      for(const item of plan)if(item.value.Expanded!==0)send(0x1102,2,mem(item.handle));
    }
    if(type==='ListView'){
      const columns=control.columns.length?control.columns:[{Text:'Name',Width:p.Width}];
      for(const [index,column]of columns.entries()){
        const data='list-column:'+module.name+':'+control.key+':'+index,caption=this.string(column.Text??'');
        this.ro.align(4).label(data).u32(15).u32(Number(column.Alignment)||0).u32(this.pixels(column.Width??1440)).reference(caption).u32(0).u32(index);
        send(0x1061,index,data);x.compare(-1).branch('e','error:7');
      }
      for(const [index,item]of control.items.entries()){
        const data='list-item:'+module.name+':'+control.key+':'+index,caption=this.string(item.Text??''),image=this.nativeBoundImageIndex(control,item.SmallIcon??item.Icon,item.SmallIcon!==undefined?'smallicons':'icons');
        this.ro.align(4).label(data).u32(image<0?1:3).u32(index).u32(0).u32(0).u32(0).reference(caption).u32(0).u32(image).u32(0).u32(0);
        send(0x104d,0,data);x.compare(-1).branch('e','error:7');
        for(const [subIndex,text]of (item.SubItems||item.subItems||[]).entries()){
          const sub=data+':'+subIndex,caption=this.string(text);this.ro.align(4).label(sub).u32(1).u32(index).u32(subIndex+1).u32(0).u32(0).reference(caption).u32(0).u32(0).u32(0).u32(0);
          send(0x1074,index,sub);x.test().branch('e','error:5');
        }
      }
    }
    if(type==='StatusBar'&&p.Panels?.length){
      const parts='status-parts:'+module.name+':'+control.key;let right=0;
      this.ro.align(4).label(parts);for(const panel of p.Panels){right+=this.pixels(panel.Width??1440);this.ro.u32(right);}
      send(0x409,0);send(0x404,p.Panels.length,parts);x.value(p.Panels.length).store(control.state,24);
      for(const [index,panel]of p.Panels.entries())send(0x40b,index,this.string((panel.Alignment===1?'\t\t':panel.Alignment===2?'\t':'')+(panel.Text||'')));
    }
    if(type==='Toolbar'&&p.Buttons?.length){
      // Intern every caption before starting the contiguous TBBUTTON array.
      const captions=p.Buttons.map(button=>this.string(button.Caption||button.Key||''));
      const data='toolbar-buttons:'+module.name+':'+control.key;this.ro.align(4).label(data);
      module.nextToolbarId ||= 20001;
      for(const [index,button] of p.Buttons.entries()){if(module.nextToolbarId>60000)this.fail('Native toolbar command ID limit exceeded',module);this.ro.u32(button.Style===3?8:button.Image===undefined?-2:this.nativeBoundImageIndex(control,button.Image)).u32(module.nextToolbarId++).emit((button.Enabled===0?0:4)|(button.Visible===0?8:0)|(button.Value?1:0),button.Style===3?1:16|(button.Style===1?2:button.Style===2?6:0),0,0).u32(0).reference(captions[index]);}
      send(0x444,p.Buttons.length,data);x.test().branch('e','error:7'); // TB_ADDBUTTONSW
    }
  },
  getNativeCollectionProperty(object,property){
    if(getNativeItemProperty(this,object,property))return true;
    if(!object.nativeCollection)return false;
    if(property!=='count')this.fail('Native collection property is not lowered: '+object.kind+'.'+property);
    const x=this.x,owner=object.owner;this.ensure(owner);
    if(object.kind==='panels'){this.nativeControlState(owner);x.emit(0x8b,0x40,24);return true;}
    if(object.kind==='columnheaders'){x.api('user32.dll','SendMessageW',[this.controlHandleRef(owner),0x101f,0,0]).emit(0x89,0xc3).push(0).push(0).push(0x1200).emit(0x53).invoke('user32.dll','SendMessageW');return true;}
    x.api('user32.dll','SendMessageW',[this.controlHandleRef(owner),{nodes:0x1105,listitems:0x1004,buttons:0x418,tabs:0x1304}[object.kind],0,0]);return true;
  },
  nativeCollectionMethod(object,method,args){
    if(!object.nativeCollection)return false;
    if(method!=='clear'||args.length)this.fail('Native collection method is not lowered: '+object.kind+'.'+method);
    const owner=object.owner,x=this.x;this.ensure(owner);
    const send=(msg,w=0,l=0)=>x.api('user32.dll','SendMessageW',[this.controlHandleRef(owner),msg,w,l]);
    if(['nodes','listitems','tabs'].includes(object.kind))invalidateNativeItems(this,owner);
    if(object.kind==='nodes')send(0x1101,0,0xffff0000);
    if(object.kind==='listitems')send(0x1009);
    if(object.kind==='tabs'){send(0x1309);x.api('user32.dll','SendMessageW',[mem(owner.module.handle),0x8003,0,this.controlHandleRef(owner)]);}
    if(object.kind==='panels'){send(0x409,1);this.nativeControlState(owner);x.emit(0xc7,0x40,24,0,0,0,0);}
    if(object.kind==='buttons'||object.kind==='columnheaders'){const loop=x.unique();x.label(loop);send(object.kind==='buttons'?0x416:0x101c,0,0);x.test().branch('ne',loop);}
    return true;
  }
};
