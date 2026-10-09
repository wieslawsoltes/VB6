import {nativeItemType} from './control-items.js';
import {nativeMetadataType,getNativeMetadataProperty,setNativeMetadataProperty} from './control-metadata.js';
import {NATIVE_RANGE_CONTROLS,NATIVE_SCROLL_CONTROLS,NATIVE_DATE_CONTROLS,NATIVE_TAB_CONTROLS,NATIVE_DRAW_CONTROLS} from './control-plan.js';
const mem=memory=>({memory}),lit=value=>({kind:'literal',value}),key=s=>String(s).toLowerCase();
const rangeFields={min:0,max:4,value:8,smallchange:12,largechange:16,tickfrequency:20,increment:12};
const colorFields={backcolor:32,forecolor:36,fillcolor:40,fillstyle:44,shape:48,bordercolor:52,borderwidth:56,borderstyle:60,backstyle:68};
const editable=new Set(['TextBox','RichTextBox']);
export const nativeControlPropertyMethods={
  nativeControlType(node){
    const listType=this.nativeListType(node);if(listType)return listType;
    const itemType=nativeItemType(this,node);if(itemType)return itemType;
    const metadata=nativeMetadataType(this,node);if(metadata)return metadata;
    const gridType=this.nativeTabTextType(node)||this.gridType(node)||this.chartType(node);if(gridType)return gridType;
    if(node.kind==='call'&&node.callee.kind==='id'&&String(node.callee.name).toLowerCase()==='loadresstring')return 'string';
    const imageType=this.nativeImageListType(node);if(imageType)return imageType;
    const dialogType=this.nativeDialogType(node);if(dialogType)return dialogType;
    const formatType=this.nativeSelectionFormatType(node);if(formatType)return formatType;
    if(node.kind!=='member')return null;
    const object=this.object(node.object);if(!object?.model)return null;
    const property=key(node.name),type=object.model.type;
    if(['textrtf','selrtf','simpletext','seltext','passwordchar','customformat','fontname','path','pattern','drive','filename'].includes(property))return 'string';
    if(property==='fontsize')return 'double';
    if(NATIVE_DATE_CONTROLS.has(type)&&property==='value')return 'date';
    return null;
  },
  nativeControlRect(object){
    const rect=this.arrayWorkspace(16,'control-rect'),x=this.x;this.rawStorageAddress(rect);x.push().push(this.controlHandleRef(object)).invoke('user32.dll','GetWindowRect').test().branch('e','error:5');
    if(!object.form){x.api('user32.dll','GetParent',[this.controlHandleRef(object)]).emit(0x89,0xc3).push(2);this.rawStorageAddress(rect);x.push().emit(0x53).push(0).invoke('user32.dll','MapWindowPoints');}
    return rect;
  },
  getNativeControlProperty(object,property){
    if(this.nativeListProperty(object,property))return true;
    if(getNativeMetadataProperty(this,object,property))return true;
    if(property==='tabcaption'&&this.nativeTabText(object,null))return true;
    if(this.nativeTabVisibility(object,property))return true;
    if(this.getNativeChartProperty(object,property)||this.getNativeGridProperty(object,property)||this.getNativeImageListProperty(object,property)||this.getNativePictureProperty(object,property)||this.getNativeDialogProperty(object,property)||this.getNativeSelectionFormat(object,property)||this.getNativeRichTextProperty(object,property)||this.getNativeCollectionProperty(object,property)||this.getNativeFileProperty(object,property)||this.getNativeFontProperty(object,property))return true;
    if(object.model?.type==='ListBox'&&property==='text'){this.ensure(object);this.nativeListText(object);return true;}
    const type=object.model?.type,x=this.x;
    if(type==='Timer')return false;
    if(editable.has(type)&&property==='text'){this.ensure(object);this.readNativeControlText(object);return true;}
    if(['left','top','width','height'].includes(property)) {
      this.ensure(object);const rect=this.nativeControlRect(object),axis=['top','height'].includes(property)?4:0;this.rawStorageAddress(rect);
      if(property==='width'||property==='height')x.emit(0x8b,0x48,axis+8,0x2b,0x48,axis,0x89,0xc8);else x.emit(0x8b,0x40,axis);
      x.emit(0x6b,0xc0,15);return true;
    }
    if(!type)return false;
    if(NATIVE_RANGE_CONTROLS.has(type)&&Object.hasOwn(rangeFields,property)) {
      this.ensure(object);
      if(property!=='value'){this.nativeControlState(object);x.emit(0x8b,0x40,rangeFields[property]);}
      else if(NATIVE_SCROLL_CONTROLS.has(type))x.api('user32.dll','GetScrollPos',[this.controlHandleRef(object),2]);
      else x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),type==='ProgressBar'?0x408:type==='Slider'?0x400:0x472,0,0]);
      return true;
    }
    if(Object.hasOwn(colorFields,property)&&(NATIVE_DRAW_CONTROLS.has(type)||['backcolor','forecolor','backstyle'].includes(property))){this.ensure(object);this.nativeControlState(object);x.emit(0x8b,0x40,colorFields[property]);return true;}
    if(NATIVE_TAB_CONTROLS.has(type)&&property==='tab'){this.ensure(object);x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0x130b,0,0]);return true;}
    if(NATIVE_TAB_CONTROLS.has(type)&&property==='tabs'){this.ensure(object);x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0x1304,0,0]);return true;}
    if(NATIVE_DATE_CONTROLS.has(type)&&property==='value') {
      this.ensure(object);const time=this.arrayWorkspace(16,'control-systemtime'),out=this.floatWorkspace();this.rawStorageAddress(time);x.push().push(0).push(0x1001).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');
      x.test().branch(type==='DTPicker'?'ne':'e','error:13');this.rawStorageAddress(out);x.push();this.rawStorageAddress(time);x.push().invoke('oleaut32.dll','SystemTimeToVariantTime').test().branch('e','error:13');this.rawStorageAddress(out);return true;
    }
    if(type==='StatusBar'&&property==='simpletext') {
      this.ensure(object);const buffer=this.buffer();x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0x40c,255,0]).emit(0x25).imm(65535).compare(4095).branch('g','error:7');
      x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0x40d,255,buffer]).push(buffer).invoke('oleaut32.dll','SysAllocString');this.ownString();return true;
    }
    if(editable.has(type)) {
      this.ensure(object);
      if(property==='maxlength'){x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0xd5,0,0]);return true;}
      if(property==='locked'||property==='multiline'){x.api('user32.dll','GetWindowLongW',[this.controlHandleRef(object),-16]).emit(0x25).imm(property==='locked'?0x800:4).test();this.boolean('<>');return true;}
      if(property==='passwordchar'){const buffer=this.arrayWorkspace(4,'password-char');x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0xd2,0,0]).push();this.rawStorageAddress(buffer);x.emit(0x59,0x89,0x08).push().invoke('oleaut32.dll','SysAllocString');this.ownString();return true;}
      if(type==='RichTextBox'&&property==='seltext'){this.readNativeRichSelection(object);return true;}
      if(['selstart','sellength','seltext'].includes(property)) {
        const selection=this.arrayWorkspace(8,'control-selection');this.rawStorageAddress(selection);x.emit(0x89,0xc3,0x83,0xc0,4).push().emit(0x53).push(0xb0).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');
        this.rawStorageAddress(selection);
        if(property==='selstart'){x.emit(0x8b,0x00);return true;}
        if(property==='sellength'){x.emit(0x8b,0x48,4,0x2b,0x08,0x89,0xc8);return true;}
        this.readNativeControlText(object);x.emit(0x89,0xc6).push().invoke('oleaut32.dll','SysStringLen').emit(0x89,0xc7);this.rawStorageAddress(selection);
        // Selection was captured before WM_GETTEXT, which can reenter. Reject a
        // stale range instead of reading beyond the now-shorter BSTR snapshot.
        x.emit(0x8b,0x18,0x8b,0x48,4,0x85,0xdb).branch('s','error:5').emit(0x39,0xd9).branch('l','error:5').emit(0x39,0xf9).branch('a','error:5').emit(0x29,0xd9,0x51,0x8d,0x04,0x5e).push().invoke('oleaut32.dll','SysAllocStringLen').test().branch('e','error:7');this.ownString();return true;
      }
    }
    if(type==='ListBox'&&property==='selcount'){this.ensure(object);x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0x190,0,0]);return true;}
    if(type==='ListView'&&['view','fullrowselect','gridlines'].includes(property)){this.ensure(object);x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),property==='view'?0x108f:0x1037,0,0]);if(property!=='view'){x.emit(0x25).imm(property==='gridlines'?1:0x20).test();this.boolean('<>');}else{const done=x.unique(),small=x.unique(),list=x.unique();x.compare(1).branch('e',small).compare(2).branch('e',list).compare(3).branch('ne',done).value(2).jump(done).label(small).value(3).jump(done).label(list).value(1).label(done);}return true;}
    return false;
  },
  setNativeControlProperty(object,property,expr){
    if(object.nativeItem)this.fail('Native common-control item properties are currently read-only');
    if(this.nativeListProperty(object,property,expr))return true;
    if(setNativeMetadataProperty(this,object,property,expr))return true;
    if(property==='tabcaption'&&this.nativeTabText(object,null,expr,true))return true;
    if(this.nativeTabVisibility(object,property,expr))return true;
    if(this.setNativeChartProperty(object,property,expr)||this.setNativeGridProperty(object,property,expr)||this.setNativeImageBinding(object,property,expr)||this.setNativeImageListProperty(object,property,expr)||this.setNativePictureProperty(object,property,expr)||this.setNativeDialogProperty(object,property,expr)||this.setNativeSelectionFormat(object,property,expr)||this.setNativeRichTextProperty(object,property,expr)||this.setNativeFileProperty(object,property,expr)||this.setNativeFontProperty(object,property,expr))return true;
    const type=object.model?.type,x=this.x;
    if(type==='Timer')return false;
    if(['left','top','width','height'].includes(property)) {
      this.numeric({kind:'binary',op:'/',left:expr,right:lit(15)});x.push();const rect=this.nativeControlRect(object);this.rawStorageAddress(rect);x.emit(0x89,0xc3,0x58);
      if(property==='width'||property==='height')x.compare(0).branch('l','error:5');
      const offsets={left:0,top:4,width:8,height:12};
      if(property==='left'||property==='top')x.emit(0x8b,0x4b,offsets[property],0x89,0x43,offsets[property],0x29,0xc8,0x01,0x43,offsets[property]+8);
      else x.emit(0x8b,0x4b,offsets[property]-8,0x01,0xc8,0x89,0x43,offsets[property]);
      x.emit(0x8b,0x43,12,0x2b,0x43,4,0x8b,0x4b,8,0x2b,0x0b,0x89,0xc2);x.push(0x14).emit(0x52,0x51,0xff,0x73,4,0xff,0x33).push(0).push(this.controlHandleRef(object)).invoke('user32.dll','SetWindowPos').test().branch('e','error:5');return true;
    }
    if(!type)return false;
    if(NATIVE_RANGE_CONTROLS.has(type)&&Object.hasOwn(rangeFields,property)) {
      this.nativeRangeHelpers ||= new Set();this.nativeRangeHelpers.add(type);
      this.numeric(expr);x.push().push(rangeFields[property]).push(this.controlHandleRef(object)).call('native:control:set-range:'+type);
      const done=x.unique();x.test().branch('e',done).api('user32.dll','SendMessageW',[mem(object.module.handle),0x8002,0,this.controlHandleRef(object)]).label(done);return true;
    }
    if(Object.hasOwn(colorFields,property)&&(NATIVE_DRAW_CONTROLS.has(type)||['backcolor','forecolor','backstyle'].includes(property))) {
      this.numeric(expr);if(property==='shape')x.compare(0).branch('l','error:5').compare(5).branch('g','error:5');if(property==='fillstyle')x.compare(0).branch('l','error:5').compare(7).branch('g','error:5');if(property==='borderwidth')x.compare(1).branch('l','error:5').compare(32767).branch('g','error:5');
      x.push();this.nativeControlState(object);x.emit(0x59,0x89,0x48,colorFields[property]);
      if(property==='backcolor'){x.emit(0xff,0x70,64,0xc7,0x40,64,0,0,0,0).invoke('gdi32.dll','DeleteObject');}
      x.api('user32.dll','InvalidateRect',[this.controlHandleRef(object),0,1]);return true;
    }
    if(type==='StatusBar'&&property==='simpletext'){this.textExpression(expr);x.push().push(255).push(0x40b).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;}
    if(NATIVE_TAB_CONTROLS.has(type)&&property==='tab') {
      this.numeric(expr);x.compare(0).branch('l','error:5').push();x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0x1304,0,0]).emit(0x59,0x39,0xc1).branch('ge','error:5').push(0).emit(0x51).push(0x130c).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');
      x.api('user32.dll','SendMessageW',[mem(object.module.handle),0x8003,0,this.controlHandleRef(object)]);return true;
    }
    if(NATIVE_DATE_CONTROLS.has(type)&&property==='value') {
      const time=this.arrayWorkspace(16,'control-systemtime');this.dateExpression(expr);x.emit(0x89,0xc3);this.rawStorageAddress(time);x.push().emit(0xff,0x73,4,0xff,0x33).invoke('oleaut32.dll','VariantTimeToSystemTime').test().branch('e','error:13');
      this.rawStorageAddress(time);x.push().push(0).push(0x1002).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW').test().branch('e','error:5');return true;
    }
    if(type==='DTPicker'&&property==='customformat'){this.textExpression(expr);x.push().push(0).push(0x1032).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;}
    if(editable.has(type)) {
      if(property==='seltext'){this.textExpression(expr);x.push().push(1).push(0xc2).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;}
      if(property==='locked'){this.numeric(expr);this.check('Boolean');x.emit(0xf7,0xd8,0x89,0xc3).push(0).emit(0x53).push(0xcf).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;}
      if(property==='maxlength'){this.numeric(expr);x.compare(0).branch('l','error:5');if(type==='RichTextBox')x.push().push(0).push(0x435);else x.emit(0x89,0xc3).push(0).emit(0x53).push(0xc5);x.push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;}
      if(property==='passwordchar'){this.textExpression(expr);x.emit(0x0f,0xb7,0x18).push(0).emit(0x53).push(0xcc).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;}
      if(property==='selstart'){this.numeric(expr);x.compare(0).branch('l','error:5').emit(0x50,0x50).push(0xb1).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;}
      if(property==='sellength'){this.numeric(expr);x.compare(0).branch('l','error:5').push();const sel=this.arrayWorkspace(4,'control-selstart');x.push(0);this.rawStorageAddress(sel);x.push().push(0xb0).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');this.rawStorageAddress(sel);x.emit(0x8b,0x00,0x59,0x01,0xc1).branch('o','error:6').emit(0x51,0x50).push(0xb1).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;}
    }
    if(type==='ListView'&&['view','fullrowselect','gridlines'].includes(property)) {
      this.numeric(expr);
      if(property==='view'){const table='native:control:listview-modes';if(!this.ro.labels.has(table))this.ro.align(4).label(table).u32(0).u32(2).u32(3).u32(1);x.compare(0).branch('l','error:5').compare(3).branch('g','error:5').emit(0x8b,0x1c,0x85).addr(table).push(0).emit(0x53).push(0x108e);}
      else {this.check('Boolean');x.emit(0x25).imm(property==='gridlines'?1:0x20).push().push(property==='gridlines'?1:0x20).push(0x1036);}
      x.push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW');return true;
    }
    return false;
  },
  nativeControlMethod(object,method,args){
    if(object.nativeItem)this.fail('Native common-control item method is not lowered: '+method);
    if(this.nativeListMethod(object,method,args))return true;
    if(this.nativeTabTextMethod(object,method,args)||this.nativeGridMethod(object,method,args))return true;
    if(this.nativeImageListMethod(object,method,args)||this.nativeDialogMethod(object,method,args)||this.nativeRichTextMethod(object,method,args)||this.nativeCollectionMethod(object,method,args)||this.nativeFileMethod(object,method,args))return true;
    const type=object.model?.type,x=this.x;
    if(!type||type==='Timer')return false;
    if(method==='refresh'&&!args.length){this.ensure(object);x.api('user32.dll','InvalidateRect',[this.controlHandleRef(object),0,1]).api('user32.dll','UpdateWindow',[this.controlHandleRef(object)]);return true;}
    if(method==='zorder'&&args.length<=1){this.ensure(object);this.numeric(args[0]||lit(0));x.compare(0).branch('l','error:5').compare(1).branch('g','error:5').emit(0x89,0xc3).push(0x13).push(0).push(0).push(0).push(0).emit(0x53).push(this.controlHandleRef(object)).invoke('user32.dll','SetWindowPos');return true;}
    if(method==='move'&&args.length>=2&&args.length<=4){this.ensure(object);const values=args.map(expr=>{const slot=this.arrayWorkspace(4,'control-move');this.numeric({kind:'binary',op:'/',left:expr,right:lit(15)});x.push();this.rawStorageAddress(slot);x.emit(0x59,0x89,0x08);return slot;});const rect=this.nativeControlRect(object);x.push(0x14);for(const [i,offset]of [[3,12],[2,8]]){if(values[i]){this.rawStorageAddress(values[i]);x.emit(0x8b,0x00).compare(0).branch('l','error:5');}else{this.rawStorageAddress(rect);x.emit(0x8b,0x48,offset,0x2b,0x48,offset-8,0x89,0xc8);}x.push();}for(const i of [1,0]){this.rawStorageAddress(values[i]);x.emit(0xff,0x30);}x.push(0).push(this.controlHandleRef(object)).invoke('user32.dll','SetWindowPos').test().branch('e','error:5');return true;}
    if(editable.has(type)&&['cut','copy','paste','undo'].includes(method)&&!args.length){this.ensure(object);x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),{cut:0x300,copy:0x301,paste:0x302,undo:0x304}[method],0,0]);return true;}
    return false;
  },
  emitNativeRangeHelpers(){
    const x=this.x;
    for(const type of this.nativeRangeHelpers||[]) {
      const set=x.unique(),apply=x.unique(),finish=x.unique(),unchanged=x.unique(),minimum=x.unique(),maximum=x.unique(),other=x.unique();
      x.label('native:control:set-range:'+type).enter(4).api('user32.dll','GetWindowLongW',[{argument:8},-21]).test().branch('e','error:5').emit(0x89,0xc6).value({argument:16}).emit(0x89,0xc7).value({argument:12});
      x.compare(0).branch('e',minimum).compare(4).branch('e',maximum).compare(8).branch('ne',other);
      x.emit(0x3b,0x7e,0).branch('l','error:5').emit(0x3b,0x7e,4).branch('g','error:5').jump(set);
      x.label(minimum).emit(0x3b,0x7e,4).branch('g','error:5').jump(set);
      x.label(maximum).emit(0x3b,0x7e,0).branch('l','error:5').jump(set);
      x.label(other).emit(0x85,0xff).branch('s','error:5');
      x.label(set).emit(0x8b,0x4e,8,0x89,0x4d,0xfc,0x89,0x3c,0x06);
      x.emit(0x8b,0x46,8,0x3b,0x46,0);const above=x.unique(),below=x.unique();x.branch('ge',above).emit(0x8b,0x46,0).label(above).emit(0x3b,0x46,4).branch('le',below).emit(0x8b,0x46,4).label(below).emit(0x89,0x46,8);
      const send=(msg,wOffset,lOffset,w=0,l=0)=>{if(lOffset!==null)x.emit(0xff,0x76,lOffset);else x.push(l);if(wOffset!==null)x.emit(0xff,0x76,wOffset);else x.push(w);x.push(msg).push({argument:8}).invoke('user32.dll','SendMessageW');};
      if(NATIVE_SCROLL_CONTROLS.has(type)){x.push(1).emit(0xff,0x76,4,0xff,0x36).push(2).push({argument:8}).invoke('user32.dll','SetScrollRange');x.push(1).emit(0xff,0x76,8).push(2).push({argument:8}).invoke('user32.dll','SetScrollPos');}
      if(type==='ProgressBar'){send(0x406,0,4);send(0x402,8,null);}
      if(type==='Slider'){send(0x407,null,0);send(0x408,null,4);send(0x414,20,null);send(0x417,null,12);send(0x415,null,16);send(0x405,null,8,1);}
      if(type==='UpDown'){send(0x46f,0,4);send(0x471,null,8);const accel=this.slot('native:control:accel-runtime',0);this.data.u32(1);x.emit(0x8b,0x46,12).store(accel,4);x.api('user32.dll','SendMessageW',[{argument:8},0x46b,1,accel]);}
      x.emit(0x8b,0x46,8,0x3b,0x45,0xfc).branch('e',unchanged).value(1).jump(finish).label(unchanged).value(0).label(finish).leave(12);
    }
  }
};
