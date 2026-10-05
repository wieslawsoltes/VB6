/** Statically designed control arrays, including Index event arguments. Each
 * element retains its own native HWND and ID; no flattened duplicate names. */
const key=value=>String(value).toLowerCase();
export const nativeControlArrayMethods={
  applyNativeControlFont(control){
    const p={...control.module.form.properties,...control.model.properties},x=this.x;
    const size=Number(p.FontSize||8.25),name=String(p.FontName||'MS Sans Serif');
    if(!Number.isFinite(size)||size<1||size>512)this.fail('Native font size must be 1..512 points');
    const font={name,size,weight:p.FontBold?700:400,italic:p.FontItalic?1:0,underline:p.FontUnderline?1:0,strike:p.FontStrikethrough?1:0};
    const cache=this.nativeFonts ||= new Map(),id=JSON.stringify(font);
    if(!cache.has(id))cache.set(id,this.slot('font:'+cache.size));
    const slot=cache.get(id),ready=x.unique(),created=x.unique();
    x.value({memory:slot}).test().branch('ne',ready);
    x.api('user32.dll','GetDC',[0]).emit(0x89,0xc3).push(90).emit(0x53).invoke('gdi32.dll','GetDeviceCaps').emit(0x89,0xc6);
    x.emit(0x53).push(0).invoke('user32.dll','ReleaseDC');
    x.push(7200).emit(0x56).push(Math.round(size*100)).invoke('kernel32.dll','MulDiv').emit(0xf7,0xd8,0x89,0xc7);
    x.push(this.string(name)).push(0).push(0).push(0).push(0).push(1).push(font.strike).push(font.underline).push(font.italic).push(font.weight).push(0).push(0).push(0).emit(0x57).invoke('gdi32.dll','CreateFontW').test().branch('ne',created);
    x.api('gdi32.dll','GetStockObject',[17]).label(created).store(slot).label(ready);
    x.push(1).push({memory:slot}).push(0x30).push({memory:control.handle}).invoke('user32.dll','SendMessageW');
  },
  nativeControlKey(model,module){
    const index=model.properties.Index;
    if(index===undefined)return key(model.name);
    if(!Number.isInteger(index)||index<0||index>32767)this.fail('Native control array Index must be 0..32767: '+model.name,module);
    return key(model.name)+':'+index;
  },
  registerNativeControl(module,control){
    const name=key(control.model.name),index=control.model.properties.Index;
    if(module.controls.has(control.key))this.fail('Duplicate native control or array index: '+control.key,module);
    if(index===undefined){if(module.controlArrays.has(name))this.fail('Mixed scalar/array control name: '+name,module);}
    else{
      if(module.controls.has(name))this.fail('Mixed scalar/array control name: '+name,module);
      let group=module.controlArrays.get(name);
      if(!group){group={controlArray:true,module,name:control.model.name,entries:new Map(),type:control.model.type};module.controlArrays.set(name,group);}
      if(group.type!==control.model.type)this.fail('Native control array elements must have the same type: '+name,module);
      group.entries.set(index,control);
    }
    module.controls.set(control.key,control);
  },
  indexedControl(node){
    if(node.kind!=='call')return null;
    let group;
    if(node.callee.kind==='id')group=this.context?.module.controlArrays.get(key(node.callee.name));
    else if(node.callee.kind==='member'&&node.callee.object.kind==='id')group=this.modules.get(key(node.callee.object.name))?.controlArrays.get(key(node.callee.name));
    if(!group)return null;
    if(node.args.length!==1)this.fail('Control array expects one Index: '+group.name);
    const cache=this.context.indexedControls ||= new WeakMap();
    if(!cache.has(node))cache.set(node,{indexed:true,module:group.module,group,indexExpression:node.args[0],model:group.entries.values().next().value.model,handleSlot:this.arrayWorkspace(4,'control-handle'),indexSlot:this.arrayWorkspace(4,'control-index')});
    return cache.get(node);
  },
  controlHandleRef(object){
    if(object.controlArray)this.fail('Control array requires an Index: '+object.name);
    return object.handleSlot ? object.handleSlot.label?{memory:object.handleSlot.label}:{argument:object.handleSlot.offset} : {memory:object.handle};
  },
  resolveControlHandle(object){
    const x=this.x,done=x.unique();this.numeric(object.indexExpression);x.push();this.rawStorageAddress(object.indexSlot);x.emit(0x59,0x89,0x08,0x89,0xc8);
    for(const [index,control]of object.group.entries){const next=x.unique();x.compare(index).branch('ne',next).value({memory:control.handle}).jump(done).label(next);}
    x.jump('error:340').label(done).push();this.rawStorageAddress(object.handleSlot);x.emit(0x59,0x89,0x08);
  },
  controlArrayProperty(object,property){
    if(object.controlArray){const indices=[...object.entries.keys()];if(!['count','lbound','ubound'].includes(property))this.fail('Control array requires an Index: '+object.name);this.x.value(property==='count'?indices.length:property==='lbound'?Math.min(...indices):Math.max(...indices));return true;}
    if(property==='index'&&object.model?.properties.Index!==undefined){if(object.indexed){this.ensure(object);const v=object.indexSlot;this.x.value(v.label?{memory:v.label}:{argument:v.offset});}else this.x.value(object.model.properties.Index);return true;}
    return false;
  },
  controlHandler(module,control,event){
    const name=control.model.name+'_'+event;
    if(control.model.properties.Index===undefined)return this.handler(module,name);
    this.x.value(control.model.properties.Index).emit(0x89,0x45,0xf0);
    this.handler(module,name,[{ref:-16}]);
  }
};
