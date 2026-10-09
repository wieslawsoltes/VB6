import {nativeListMethods,prepareNativeList,createNativeList} from './control-lists.js';
import {initializeNativeObjectTag,disposeNativeStandaloneTags} from './control-metadata.js';
import {nativeTabPageMethods} from './control-tabs.js';
import {nativeChartMethods} from './control-chart.js';
import {nativeGridMethods} from './control-grid.js';
import {nativeImageListMethods} from './control-imagelist.js';
import {nativePictureMethods} from './control-pictures.js';
import {nativeDialogMethods} from './control-dialogs.js';
import {nativeSelectionFormatMethods} from './control-format.js';
/** Native HWND lowering. Runtime instructions are emitted per used control family;
 * this module itself is compiler code and is never embedded in a PE32 image. */
import {NATIVE_CONTROL_CATALOG,nativeControlDependencies} from './control-catalog.js';
import {nativeControlStyle,nativeControlOrder,nativeControlEvents,nativeCommandEvents,nativeDateFields,NATIVE_RANGE_CONTROLS,NATIVE_SCROLL_CONTROLS,NATIVE_DATE_CONTROLS,NATIVE_TAB_CONTROLS,NATIVE_DRAW_CONTROLS,NATIVE_INPUT_EVENTS} from './control-plan.js';
import {nativeControlFontMethods} from './control-fonts.js';
import {nativeControlFileMethods,NATIVE_FILE_CONTROLS} from './control-files.js';
import {nativeControlCollectionMethods} from './control-collections.js';
import {nativeControlPropertyMethods} from './control-properties.js';
import {nativeControlEventMethods} from './control-events.js';
import {nativeControlDrawingMethods} from './control-drawing.js';
import {nativeControlTextMethods} from './control-text.js';
import {nativeRichTextMethods} from './control-richtext.js';
const mem=memory=>({memory}),key=s=>String(s).toLowerCase();
export const NATIVE_CONTROL_STATE=Object.freeze({min:0,max:4,value:8,smallchange:12,largechange:16,tickfrequency:20,tab:24,tag:28,backcolor:32,forecolor:36,fillcolor:40,fillstyle:44,shape:48,bordercolor:52,borderwidth:56,borderstyle:60,brush:64,backstyle:68,font:72});
export const nativeControlMethods={
  ...nativeListMethods,...nativeTabPageMethods,...nativeChartMethods,...nativeGridMethods,...nativeImageListMethods,...nativePictureMethods,...nativeDialogMethods,...nativeSelectionFormatMethods,...nativeControlTextMethods,...nativeRichTextMethods,...nativeControlFontMethods,...nativeControlFileMethods,...nativeControlCollectionMethods,...nativeControlPropertyMethods,...nativeControlEventMethods,...nativeControlDrawingMethods,
  nativeControlEvents,nativeCommandEvents,
  nativeControlDescriptor(model,module){
    const descriptor=NATIVE_CONTROL_CATALOG[model.type];
    if(!descriptor)this.fail('Unsupported native control: '+model.type+'; no freestanding Win32 implementation is installed',module);
    if((model.properties.Picture||model.properties.Icon)&&!['Image','PictureBox'].includes(model.type))this.fail('Native picture/icon resources on '+model.type+' are not yet lowered',module);
    if(model.properties.Icon)this.fail('Only a native Form exposes Icon',module);
    if(NATIVE_RANGE_CONTROLS.has(model.type)) {
      const p=model.properties,min=Number(p.Min??0),max=Number(p.Max??100),value=Number(p.Value??0);
      for(const [name,n]of [['Min',min],['Max',max],['Value',value]])if(!Number.isInteger(n)||n< -2147483648||n>2147483647)this.fail(model.name+'.'+name+' must be a signed 32-bit integer',module);
      if(min>max)this.fail(model.name+': reversed native ranges are not yet supported',module);
      if(value<min||value>max)this.fail(model.name+'.Value is outside Min..Max',module);
    }
    return descriptor;
  },
  prepareNativeControl(control){
    const {model,module}=control,p=model.properties,descriptor=NATIVE_CONTROL_CATALOG[model.type];control.nativeDescriptor=descriptor;
    if(model.type==='Timer')return;
    const events=nativeControlEvents(model.type),handlers=module.procedures;
    const input=NATIVE_INPUT_EVENTS.some(e=>handlers.has(key(model.name)+'_'+e));
    if(!descriptor.nonvisual&&(descriptor.container||descriptor.kernel||input))control.oldProcedure=this.slot('control-old-procedure:'+module.name+':'+control.key);
    control.state='control-state:'+module.name+':'+control.key;
    this.data.align(4).label(control.state);
    const values=[Number(p.Min??0),Number(p.Max??100),NATIVE_RANGE_CONTROLS.has(model.type)?Number(p.Value??0):0,Number(p.SmallChange??p.Increment??1),Number(p.LargeChange??1),Number(p.TickFrequency??1),Number(p.Tab??0),0,Number(p.BackColor??-2147483633),Number(p.ForeColor??-2147483640),Number(p.FillColor??16777215),Number(p.FillStyle??1),Number(p.Shape??0),Number(p.BorderColor??0),Number(p.BorderWidth??1),Number(p.BorderStyle??1),0,Number(p.BackStyle??1),0];
    if(NATIVE_FILE_CONTROLS.has(model.type))values[0]=values[1]=values[2]=0;
    for(const n of values){if(!Number.isInteger(n)||n< -2147483648||n>4294967295)this.fail('Invalid native control property on '+model.name,module);this.data.u32(n);}
    // Recreate restores authored values, not stale state from an unloaded HWND.
    control.initialState=values;
    this.prepareNativeImageList(control);this.prepareNativeControlPictures(control);this.prepareNativeDialog(control);this.prepareNativeGrid(control);this.prepareNativeChart(control);
    if(NATIVE_DATE_CONTROLS.has(model.type)) {
      let fields;try{fields=nativeDateFields(p.Value);}catch(error){this.fail(model.name+': '+error.message,module);}
      control.dateSeed='control-date:'+module.name+':'+control.key;this.ro.align(4).label(control.dateSeed);for(const n of fields)this.ro.u16(n);
    }
    if(NATIVE_TAB_CONTROLS.has(model.type)) {
      const tabs=Array.isArray(p.Tabs)?p.Tabs:Array.from({length:Number(p.Tabs)||3},(_,i)=>({Caption:'Tab '+(i+1)}));
      if(tabs.length>32767||!Number.isInteger(Number(p.Tab??0))||Number(p.Tab??0)<0||Number(p.Tab??0)>=tabs.length)this.fail('Invalid native tab count or selected Tab: '+model.name,module);
      control.tabs=tabs;
    }
    this.prepareNativeControlCollections(control);prepareNativeList(this,control);
    if(p.ToolTipText)control.tooltip=String(p.ToolTipText);
    control.events=events;
  },
  initializeNativeControlLibraries(){
    const controls=[...this.modules.values()].flatMap(m=>[...m.controls.values()]),deps=nativeControlDependencies(controls.map(c=>c.model.type));
    let mask=deps.commonControls;if(controls.some(c=>c.tooltip))mask|=4;
    this.nativeControlDependencies={commonControls:mask,libraries:[...deps.libraries]};
    if(mask){const label='native:common-controls';this.ro.align(4).label(label).u32(8).u32(mask);this.x.api('comctl32.dll','InitCommonControlsEx',[label]).test().branch('e','error:7');}
    // Restrict the search to System32. No project path or current-directory DLL
    // can substitute for the operating system's RichEdit implementation.
    for(const library of deps.libraries)this.x.api('kernel32.dll','LoadLibraryExW',[this.string(library),0,0x800]).test().branch('e','error:7');
  },
  createNativeControls(module){
    const x=this.x;let order;
    initializeNativeObjectTag(this,module);
    try{order=nativeControlOrder(module.controls.values());}catch(error){this.fail(error.message,module);}
    for(const control of order.ordered){
      const {model}=control,p=model.properties,type=model.type;
      if(type==='Timer'){initializeNativeObjectTag(this,control);this.timer(control);continue;}
      const descriptor=control.nativeDescriptor,{style,ex}=nativeControlStyle(type,p),parent=order.parents.get(control)||module;
      control.nativeParent=parent;
      for(let i=0;i<control.initialState.length;i++)x.value(control.initialState[i]).store(control.state,i*4);
      if(descriptor.nonvisual){this.initializeNativeImageList(control);this.initializeNativeDialog(control);continue;}
      const drop=(type==='ComboBox'&&Number(p.Style)!==1)||type==='DriveListBox'?160:0;
      x.api('user32.dll','CreateWindowExW',[ex,this.string(descriptor.className),this.string(p.Text??p.Caption??''),style,this.pixels(p.Left??0),this.pixels(p.Top??0),this.pixels(p.Width??1440),this.pixels(p.Height??420)+drop,mem(parent.handle),control.id,mem('instance'),0]).test().branch('e','error:7').store(control.handle);
      x.api('user32.dll','SetWindowLongW',[mem(control.handle),-21,control.state]);this.initializeNativeTabPage(control);
      if(control.oldProcedure)x.api('user32.dll','SetWindowLongW',[mem(control.handle),-4,'control-procedure:'+module.name+':'+control.key]).test().branch('e','error:7').store(control.oldProcedure);
      this.applyNativeControlFont(control);this.initializeNativeControlFont(control);
      const send=(msg,w=0,l=0)=>x.api('user32.dll','SendMessageW',[mem(control.handle),msg,w,l]);
      initializeNativeObjectTag(this,control);
      if(['TextBox','RichTextBox'].includes(type)) {
        if(p.MaxLength)send(type==='RichTextBox'?0x435:0xc5,type==='RichTextBox'?0:Number(p.MaxLength),type==='RichTextBox'?Number(p.MaxLength):0);
        if(p.PasswordChar)send(0xcc,String(p.PasswordChar).charCodeAt(0),0);
        if(type==='RichTextBox')send(0x445,0,1|0x80000); // ENM_CHANGE | ENM_SELCHANGE
      }
      if(['CheckBox','OptionButton'].includes(type))send(0xf1,type==='OptionButton'?(p.Value?1:0):Number(p.Value||0));
      if(['ListBox','ComboBox'].includes(type)) {
        createNativeList(this,control);
      }
      if(NATIVE_SCROLL_CONTROLS.has(type)) {
        x.api('user32.dll','SetScrollRange',[mem(control.handle),2,Number(p.Min??0),Number(p.Max??32767),1]);
        x.api('user32.dll','SetScrollPos',[mem(control.handle),2,Number(p.Value??0),1]);
      }
      if(type==='ProgressBar'){send(0x406,Number(p.Min??0),Number(p.Max??100));send(0x402,Number(p.Value??0));}
      if(type==='Slider'){send(0x407,0,Number(p.Min??0));send(0x408,0,Number(p.Max??10));send(0x414,Number(p.TickFrequency??1),0);send(0x417,0,Number(p.SmallChange??1));send(0x415,0,Number(p.LargeChange??1));send(0x405,1,Number(p.Value??0));}
      if(type==='UpDown'){send(0x46f,Number(p.Min??0),Number(p.Max??100));send(0x471,0,Number(p.Value??0));const accel='control-accel:'+module.name+':'+control.key;this.ro.align(4).label(accel).u32(0).u32(Number(p.Increment??1));send(0x46b,1,accel);}
      if(type==='ListView')send(0x1036,0x21,(p.FullRowSelect?0x20:0)|(p.GridLines?1:0));
      if(type==='StatusBar'){send(0x409,1);send(0x40b,255,this.string(p.SimpleText??''));}
      if(type==='Toolbar')send(0x41e,20);
      if(NATIVE_TAB_CONTROLS.has(type)) {
        for(const [index,tab]of control.tabs.entries()){const data='control-tab:'+module.name+':'+control.key+':'+index,caption=this.string(tab.Caption??''),image=this.nativeBoundImageIndex(control,tab.Image);this.ro.align(4).label(data).u32(image<0?1:3).u32(0).u32(0).reference(caption).u32(0).u32(image).u32(0);send(0x133e,index,data);}
        send(0x130c,Number(p.Tab??0));
      }
      if(NATIVE_DATE_CONTROLS.has(type)){send(type==='DTPicker'?0x1002:0x1002,0,control.dateSeed);if(type==='DTPicker'&&p.CustomFormat)send(0x1032,0,this.string(p.CustomFormat));}
      this.initializeNativeGrid(control);this.initializeNativeChart(control);this.initializeNativeControlPictures(control);this.createNativeControlCollections(control);this.createNativeFileControl(control);this.initializeNativeRichText(control);
      if(control.tooltip)this.createNativeTooltip(module,control);
    }
    this.initializeNativeImageBindings(module);
    for(const control of module.controls.values())this.applyNativeTabPages(control);
  },
  createNativeTooltip(module,control){
    const x=this.x;
    if(!module.tooltip){module.tooltip=this.slot('control-tooltip:'+module.name);x.api('user32.dll','CreateWindowExW',[0x8,this.string('tooltips_class32'),0,0x80000003,0,0,0,0,mem(module.handle),0,mem('instance'),0]).test().branch('e','error:7').store(module.tooltip);}
    const info='control-tooltip-info:'+module.name+':'+control.key;
    this.data.align(4).label(info).u32(48).u32(17).u32(0).u32(0).zero(16).u32(0).reference(this.string(control.tooltip)).u32(0).u32(0);
    x.value(mem(module.handle)).store(info,8).value(mem(control.handle)).store(info,12).api('user32.dll','SendMessageW',[mem(module.tooltip),0x432,0,info]).test().branch('e','error:7');
  },
  nativeControlState(object){
    // Scalars use a relocated address; dynamically indexed controls resolve
    // their own HWND user-data, never the first element's design values.
    if(['CommonDialog','ImageList'].includes(object.model?.type)){this.x.value(this.controlHandleRef(object));return;}
    if(!object.indexed&&!object.boundIndex&&object.state)this.x.value(object.state);
    else this.x.api('user32.dll','GetWindowLongW',[this.controlHandleRef(object),-21]).test().branch('e','error:5');
  },
  disposeNativeControls(module){
    const x=this.x;
    disposeNativeStandaloneTags(this,module);
    if(module.tooltip){const skip=x.unique();x.value(mem(module.tooltip)).test().branch('e',skip).push().invoke('user32.dll','DestroyWindow').value(0).store(module.tooltip).label(skip);}
    for(const control of module.controls.values())if(control.state){
      this.disposeNativeGrid(control);this.disposeNativeChart(control);this.disposeNativeImageList(control);this.disposeNativePictures(control);this.disposeNativeDialog(control);this.disposeNativeFileControl(control);this.disposeNativeControlFont(control);
      for(const [offset,dll,fn]of [[28,'oleaut32.dll','SysFreeString'],[64,'gdi32.dll','DeleteObject']]){const skip=x.unique();x.value({memory:control.state,addend:offset}).test().branch('e',skip).push().invoke(dll,fn).value(0).store(control.state,offset).label(skip);}
    }
  },
  nativeControlsReport(){
    const types=[...new Set([...this.modules.values()].flatMap(m=>[...m.controls.values()].map(c=>c.model.type)))].sort();
    return {types,dependencies:this.nativeControlDependencies,implementation:'Win32 HWND/common-controls/GDI',embeddedRuntime:false,runtime:{tabPages:this.nativeTabPages.length,charts:this.chartModule?{instances:this.nativeCharts.length,features:[...this.chartFeatures].sort(),procedures:this.chartEmitted}:null,grids:this.gridModule?{kernel:'private VB-to-x86',instances:this.nativeGridControls.length,features:[...this.gridFeatures].sort(),procedures:this.gridEmitted}:null,imageLists:[...(this.nativeImageListFeatures||[])].sort(),pictures:[...(this.nativePictureFeatures||[])].sort(),pictureBytes:[...(this.nativePictures?.values()||[])].reduce((n,p)=>n+p.length,0),dialogs:[...(this.nativeDialogs||[])].sort(),selectionFormatting:[...(this.nativeSelectionFormats||[])].sort(),richTextFeatures:[...(this.nativeRichTextFeatures||[])].sort(),mutableFonts:!!this.nativeMutableFonts,fileFamilies:[...(this.nativeFileFamilies||[])].sort(),ownerDrawingFamilies:[...(this.nativeDrawingFamilies||[])].sort()}};
  }
};
