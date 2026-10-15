import {showColor,showFont} from './common-dialogs.js';
import {dialogCancelled} from './common-dialog-contract.js';
import {DateViewController} from './date-view.js';
import {ToolbarController,StatusBarController} from './bar-controls.js';
import {GridViewController} from './grid-view.js';
import {GRID_TYPES,CELL_KEYS,initializeGrid,gridIndex,gridIndexed,setGridProperty,cellStyle,gridClip,setGridClip,setGridText,addGridItem,removeGridItem} from './grid-state.js';
import {TreeViewController} from './tree-view.js';
import {ListViewController} from './list-view.js';
import {LIST_TYPES,initializeList,sortList,addListItem,removeListItem,clearList,setListIndex,setListIndexed,listIndex} from './list-state.js';
import {validateCollectionProperty} from './control-contract.js';
import {applyRangeOrientation,handleRangeEndpointKey} from './range-orientation.js';
import {commandPaint,groupPaint,comboPaint,rangeProgress} from '../theme/control-paint.js';
import {controlThemeColor,controlThemePaint} from '../theme/control-theme-color.js';
import {resolveRuntimeParent,validateRuntimeContainer,runtimeRemovalPlan} from './container-lifecycle.js';
import {controlParents,tabPagePlan} from './tab-model.js';
import {buildTabs,refreshTabs,mountTabPages,getTabProperty,setTabProperty,setIndexedTab,bindTabChild,unbindTabChild} from './tabs.js';
import {layoutDefaults,layoutKey,layoutProperty,setLayoutProperty} from '../layout/contract.js';
import {FormLayout} from '../layout/runtime.js';
import {bindMouseInput,bindKeyboardInput,ownsInputEvent,acceptsInput,inputScaleFactor} from './input.js';
import {installFormWindow} from './form-window.js';
import {ClassicCombo,ClassicUpDown} from './native-widgets.js';
import {ClassicScrollbar} from './scrollbar.js';
import {showMenu as openClassicMenu,closeMenu,menuIsOpen} from '../theme/menu.js';
import {RichTextController,RICH_SELECTION_PROPERTIES} from './richtext.js';
import {parseRTF} from './rtf.js';
import { el, lower, clone } from '../core/core.js';
import { VBError } from '../language/lexer.js';
import { NOTHING, Ref, Cell, truth, VBArray, vbString } from '../runtime/values.js';
import { MemoryRecordset } from '../runtime/library.js';
import { GraphicsSurface } from '../graphics/surface.js';
import { cssColor as oleColor, fontFamily, getTheme } from '../theme/theme.js';
import { icon, controlIcon } from '../theme/icons.js';
import { CONTROL_DEFAULTS, createControl, newId } from '../project/model.js';
import { controlInteger, ControlCollection, TreeNodes, ListItems, ColumnHeaders, ToolbarButtons, StatusPanels, TabItems, ImageItems, ControlArray } from './collections.js';

export const NONVISUAL_TYPES=new Set(['Timer','ImageList','CommonDialog']);
export const DEFAULT_EVENTS={Form:'Load',MDIForm:'Load',CommandButton:'Click',TextBox:'Change',RichTextBox:'Change',ListBox:'Click',ComboBox:'Click',Timer:'Timer',HScrollBar:'Change',VScrollBar:'Change',TreeView:'NodeClick',ListView:'ItemClick',ProgressBar:'MouseDown',Slider:'Change',Toolbar:'ButtonClick',TabStrip:'Click',SSTab:'Click',DTPicker:'Change',MonthView:'DateClick',MSFlexGrid:'Click',PictureBox:'Click'};
export const CONTROL_EVENTS=['Click','DblClick','MouseDown','MouseMove','MouseUp','KeyDown','KeyPress','KeyUp','GotFocus','LostFocus'];
const stripMnemonic=text=>String(text??'').replace(/&&/g,'\0').replace(/&/g,'').replace(/\0/g,'&');
// Retain unchanged caption/option DOM; see docs/HTML-RENDERING-PERFORMANCE.md.
const mnemonicCache=new WeakMap(),optionCache=new WeakMap();
function updateMnemonic(node,text){text=String(text??'');if(mnemonicCache.get(node)===text)return;mnemonicCache.set(node,text);node.replaceChildren();let plain='';for(let i=0;i<text.length;i++){if(text[i]==='&'&&text[i+1]){if(text[i+1]==='&'){plain+='&';i++;}else{if(plain)node.append(plain);plain='';node.append(el('u',{},text[++i]));}}else plain+=text[i];}if(plain)node.append(plain);}
function selectOptions(node,items,index){const labels=items.map(String),previous=optionCache.get(node);if(!previous||previous.length!==labels.length||labels.some((v,i)=>v!==previous[i])){node.replaceChildren(...labels.map((text,i)=>el('option',{value:i},text)));optionCache.set(node,labels);}if(node.selectedIndex!==index)node.selectedIndex=index;}
function units(mode){return ({0:1,1:15,2:.75,3:1,4:8,5:1/96,6:25.4/96,7:2.54/96})[Number(mode)]||15;}
function safeImage(picture,assets={}){if(typeof picture==='string'){if(/^data:image\//i.test(picture)||/^blob:/i.test(picture))return picture;const a=assets[picture];if(a?.encoding==='base64'){const ext=picture.split('.').at(-1).toLowerCase(),mime={png:'png',jpg:'jpeg',jpeg:'jpeg',gif:'gif',bmp:'bmp',svg:'svg+xml',webp:'webp',ico:'x-icon'}[ext];return mime?'data:image/'+mime+';base64,'+a.data:'';}}return '';}

export class BrowserControl {
  constructor(model,{controlRegistry=null,design=false,vm=null,instance=null,form=null,anchoring=false,assets={},backend='auto',onBackend=()=>{}}={}) {
    this.anchoring=(anchoring===true||form?.anchoring===true||vm?.program?.settings?.anchoring===true);this.controlRegistry=controlRegistry||vm?.host?.controlRegistry;this.__control=true;this.__type=model.type;this.model=model;this.design=design;this.vm=vm;this.instance=instance;this.form=form;this.assets=assets;this.backend=backend;this.onBackend=onBackend;this.disposed=false;this.type=model.type;
    this.props={Left:0,Top:0,Width:1800,Height:450,Visible:-1,Enabled:-1,FontName:'MS Sans Serif',FontSize:8.25,FontBold:0,FontItalic:0,BackColor:-2147483633,ForeColor:-2147483640,TabIndex:0,TabStop:-1,ToolTipText:'',Tag:'',...clone(CONTROL_DEFAULTS[model.type]||{}),...(this.controlRegistry?.defaults?.(model.type)||{}),...clone(model.properties||{}),Name:model.name};
    for(const key of Object.keys(this.props))if(layoutKey(key))delete this.props[key];
    if(this.anchoring)for(const [key,value]of Object.entries(layoutDefaults(model)))this.props[key]=layoutProperty(key,model.properties?.[key]??value,model.properties||{});
    for(const [key,value]of Object.entries(this.props))if(value?.resource)this.props[key]=CONTROL_DEFAULTS[model.type]?.[key]??'';
    this.node=el('div',{class:'vb-control','data-control':model.name,'data-control-id':model.id,'data-type':model.type,tabindex:0});this.node.style.touchAction=design?'none':'auto';this.input=null;this.childHost=this.node;this.items=[...(this.props.List||[])];this.itemData=[];this.selectedIndices=new Set();this.gridData=clone(this.props.GridData||[]);this._colWidths=[];this.currentX=0;this.currentY=0;
    const props=new Set([...RICH_SELECTION_PROPERTIES,...Object.keys(this.props),'Text','Caption','Value','ListIndex','Enabled','Visible','Left','Top','Width','Height','BackColor','ForeColor','FontName','FontSize','FontBold','FontItalic','FontUnderline','TabIndex','TabStop','ToolTipText','Tag','MaxLength','Locked','PasswordChar','Default','Cancel','Min','Max','Rows','Cols','FixedRows','FixedCols','Row','Col','RowSel','ColSel','FormatString','SimpleText','Tab','Interval','ScaleMode','ScaleLeft','ScaleTop','ScaleWidth','ScaleHeight','DrawWidth','FillStyle','FillColor','BorderWidth','Alignment','Sorted','SortKey','SortOrder','FullRowSelect','View','Path','Pattern','Drive','DataSource','RecordSource','DatabaseName','Connect','ConnectionString','CommandType','CursorType','LockType','ReadOnly','RecordsetType','DataMember','DataField','SelBold','SelItalic','SelUnderline','SelColor','SelFontName','SelFontSize','Picture','Stretch','ChartType','RowCount','ColumnCount','RowLabel','ColumnLabel','Data','CancelError','FileName','Filter','FilterIndex','DialogTitle','Flags','FontStrikethru','TextRTF','MultiLine','ScrollBars']);
    for(const key of props)if(!['Nodes','Tabs','Panels','Buttons','ListItems','ColumnHeaders','ListImages'].includes(key)&&!(key in this))Object.defineProperty(this,key,{enumerable:true,configurable:true,get:()=>this.get(key),set:value=>this.set(key,value)});
    if(this.anchoring&&form)Object.defineProperty(this,'Container',{enumerable:true,get:()=>this.get('Container'),set:value=>this.set('Container',value)});
    if(this.anchoring&&['Form','MDIForm','Frame','PictureBox','TabStrip','SSTab'].includes(this.type)) {
      this.PerformLayout=()=>this.form?.layoutController?.perform();
      this.SuspendLayout=()=>this.form?.layoutController?.suspend();
      this.ResumeLayout=(perform=true)=>this.form?.layoutController?.resume(perform);
    }
    this.build();initializeList(this);initializeGrid(this);this.attachEvents();this.refresh();
    if(!this.design&&this.vm?.win32){
      Object.defineProperty(this,'hWnd',{enumerable:true,value:this.vm.win32.registerControl(this)});
      if(['Form','MDIForm','PictureBox'].includes(this.type))Object.defineProperty(this,'hDC',{enumerable:true,get:()=>{
        const api=this.vm.win32.api;if(this.disposed||api.disposed)return 0;
        if(!api.handles.has(this._gdiDC,'dc'))this._gdiDC=api.invoke('user32','GetDC',[this.hWnd]);
        return this._gdiDC;
      }});
    }
  }
  get(key){
    if(this.dateView?.state.handles(key))return this.dateView.get(key);
    if(GRID_TYPES.has(this.type)&&CELL_KEYS.has(key)){const state=cellStyle(this,this.props.Row,this.props.Col);return state[key]??this.props[key];}
    const tabValue=getTabProperty(this,key);if(tabValue!==undefined)return tabValue;
    if(key==='Container'&&this.anchoring&&this.form&&this.form!==this)return resolveRuntimeParent(this.form,this.model)||this.form;
    if(layoutKey(key)&&(!this.anchoring||!Object.hasOwn(layoutDefaults(this.model),key)))throw new VBError("Object does not support this property: "+key,438);
    if(key==='Text'){
      if(['ListBox','ComboBox','FileListBox','DirListBox','DriveListBox'].includes(this.type)&&Number(this.props.ListIndex)>=0)return this.items[Number(this.props.ListIndex)]??'';
      if(['MSFlexGrid','MSHFlexGrid','DataGrid'].includes(this.type))return this.TextMatrix(this.props.Row||0,this.props.Col||0);
      if(this.type==='RichTextBox')return this.rich?.text??this.props.Text??'';
    }
    if(key==='Value'&&['DTPicker','MonthView'].includes(this.type)){const value=this.props.Value;if(value instanceof Date)return value;return new Date(String(value)+'T00:00:00');}
    if(key==='DataSource')return this._dataSource;
    if(key==='Data'&&this.type==='MSChart')return this.gridData[(this.props.Row||1)-1]?.[(this.props.Column||1)-1]||0;
    if(key==='ScaleWidth')return this.props.ScaleWidth??(this.content||this.node).clientWidth*inputScaleFactor(this.props.ScaleMode??1);
    if(key==='ScaleHeight')return this.props.ScaleHeight??(this.content||this.node).clientHeight*inputScaleFactor(this.props.ScaleMode??1,true);
    if(key==='TextRTF')return this.rich?.rtf||'';
    if(this.type==='RichTextBox'&&RICH_SELECTION_PROPERTIES.includes(key)){const value=this.rich.style(key);return value===null?null:['SelIndent','SelHangingIndent','SelRightIndent'].includes(key)?value/15*units(this.form?.props.ScaleMode||1):value;}
    return this.props[key]??(['Text','Caption','ToolTipText','Tag','Path','Pattern','SimpleText','FileName','DialogTitle'].includes(key)?'':0);
  }
  set(key,value,fromDOM=false){
    if(this.disposed)return;
    if(fromDOM&&!acceptsInput(this)){this.invalidate();return;}
    if(setTabProperty(this,key,value))return;
    if(key==='Container'&&this.anchoring&&this.form&&this.form!==this){
      const owner=this.form,parent=validateRuntimeContainer(owner,this,value===owner?null:value);
      bindTabChild(this,parent);
      this.model={...this.model,parent:parent?.model.name??null,nativeParentId:parent?.model.id??null};
      (parent?.childHost||owner.content).append(this.node);this.refresh();owner.layoutController?.edit(this,'Container');return;
    }
    if(layoutKey(key)){if(!this.anchoring||!Object.hasOwn(layoutDefaults(this.model),key))throw new VBError("Object does not support this property: "+key,438);setLayoutProperty(this,key,value);(this.form||this).layoutController?.edit(this,key);this.invalidate();return;}
    if(key==='DataSource'){this.bindRecordset(value);return;}
    if(key==='DataField'||key==='DataMember'){this.props[key]=value;if(this._dataSource)this.bindRecordset(this._dataSource);return;}
    if(this.dateView?.state.handles(key)){this.dateView.set(key,value);return;}
    if(this._boundRS&&this.props.DataField&&['Text','Value'].includes(key)&&!this.design){this._boundRS.Fields.Item(this.props.DataField).Value=value;}
    if(this._boundRS&&['Rows','Cols','FixedRows','FixedCols','FormatString'].includes(key))throw new VBError('Bound grid dimensions and headers belong to the Recordset',445);
    if(setGridProperty(this,key,value))return;
    if(key==='Picture'){this.props.Picture=value;if(this.surface||value&&['Form','MDIForm'].includes(this.type))this.ensureSurface().setPicture(safeImage(value,this.assets));this.invalidate();return;}
    if(key==='TextRTF'&&this.rich){this.rich.setRTF(value);return;}
    if(key==='Text'&&this.rich){this.rich.setText(value);return;}
    if(this.rich&&RICH_SELECTION_PROPERTIES.includes(key)){if(['SelIndent','SelHangingIndent','SelRightIndent'].includes(key))value=Math.round(Number(value)/units(this.form?.props.ScaleMode||1)*15);this.rich.format(key,value);return;}
    if(key==='Text'&&GRID_TYPES.has(this.type)){setGridText(this,value);return;}
    if(key==='Data'&&this.type==='MSChart'){const row=(this.props.Row||1)-1,col=(this.props.Column||1)-1;this.gridData[row] ||= [];this.gridData[row][col]=Number(value);this.invalidate();return;}
    if(key==='ListIndex'&&LIST_TYPES.has(this.type)){const previous=this.props.ListIndex;setListIndex(this,value);if(previous!==this.props.ListIndex){this.invalidate();if(!fromDOM)this.event('Click');}return;}
    value=validateCollectionProperty(this.type,key,value);
    if(key==='Sorted'&&this.type==='TreeView'){this.props.Sorted=value;if(value)this.Nodes.sort();return;}
    if(key==='Sorted'&&LIST_TYPES.has(this.type)){const previous=this.props.Sorted;this.props.Sorted=value;if(value&&!previous)sortList(this);return;}
    if(key==='Value'&&['HScrollBar','VScrollBar','Slider','ProgressBar','UpDown'].includes(this.type)){value=Number(value);if(!Number.isFinite(value)||value<Math.min(Number(this.props.Min),Number(this.props.Max))||value>Math.max(Number(this.props.Min),Number(this.props.Max)))throw new VBError('Invalid property value: Value',380);}
    if(['Rows','Cols','RowCount','ColumnCount'].includes(key))value=controlInteger(value,0,10000);
    if(key==='Interval')value=controlInteger(value,0,65535);
    if(this.type==='ImageList'&&['ImageWidth','ImageHeight'].includes(key)){value=controlInteger(value,1,4096);this.props[key]=value;this.ListImages.changed();return;}
    if(this.anchoring&&['Left','Top','Width','Height','ClientWidth','ClientHeight'].includes(key)) {
      value=Number(value);if(!Number.isFinite(value)||Math.abs(value)>300000||/Width|Height/.test(key)&&value<0)throw new VBError('Invalid geometry: '+key,380);
    }
    const previous=this.props[key];this.props[key]=value;if(previous===value)return;
    if(this.anchoring&&['Form','MDIForm'].includes(this.type)&&['Width','Height','ClientWidth','ClientHeight'].includes(key)){const axis=key.endsWith('Width')?'Width':'Height';this.props[axis]=value;this.props['Client'+axis]=value;this.layoutController?.arrange();}
    else if(this.anchoring&&['Left','Top','Width','Height','Visible'].includes(key))this.form?.layoutController?.edit(this,key);
    if(key==='Value'&&this.type==='OptionButton'&&truth(value))for(const c of this.form?.controls||[])if(c!==this&&c.type==='OptionButton'&&(c.model.parent||null)===(this.model.parent||null)){c.props.Value=0;c.invalidate();}
    if(key==='Text'&&this.type==='ComboBox'){const i=this.items.indexOf(String(value));setListIndex(this,i);}
    if(this.type==='Timer'&&['Interval','Enabled'].includes(key))this.updateTimer();
    if(this.rich&&['Locked','Enabled','MaxLength'].includes(key)){this.rich.readOnly=this.design||truth(this.props.Locked)||!truth(this.props.Enabled);this.rich.maxLength=Number(this.props.MaxLength)||0;}
    if(!fromDOM)this.invalidate();
    if(key==='Text'||key==='Value'&&!['CheckBox','OptionButton','ProgressBar'].includes(this.type))this.event('Change');
    if(key==='ListIndex'&&!fromDOM)this.event('Click');
  }
  invalidate(){if(this.pending||this.disposed)return;this.pending=true;this.raf=requestAnimationFrame(()=>{this.pending=false;if(!this.disposed)this.refresh();});}
  event(name,args=[],coalesce=false){if(this.design||!this.vm||this.disposed)return Promise.resolve();const allArgs=this.props.Index!==undefined?[Number(this.props.Index),...args]:args;return this.vm.dispatch(this.instance,this.model.name+'_'+name,allArgs,{coalesce});}
  attachEvents(){
    if(this.design)return;
    bindMouseInput(this);if(!this.form)bindKeyboardInput(this);
    this.node.addEventListener('click',e=>{if(!ownsInputEvent(this,e)||e.vbHandled)return;if(!['TreeView','ListView','Toolbar','TabStrip','SSTab','MonthView','ListBox','ComboBox','FileListBox','DirListBox','DriveListBox'].includes(this.type))this.event('Click');});
    this.node.addEventListener('dblclick',e=>{if(ownsInputEvent(this,e))this.event('DblClick');});
    this.node.addEventListener('focusin',e=>{if(ownsInputEvent(this,e))this.event('GotFocus');});
    this.node.addEventListener('focusout',e=>{if(ownsInputEvent(this,e))this.event('LostFocus');});
  }
  build(){const n=this.node,p=this.props;const addClass=c=>n.classList.add(c);
    switch(this.type){
      case 'CommandButton':addClass('vb-command');n.setAttribute('role','button');break;
      case 'Label':addClass('vb-label');break;
      case 'TextBox':this.input=el(p.MultiLine?'textarea':'input',{class:'vb-text-input',type:p.PasswordChar?'password':'text','aria-label':this.model.name});n.append(this.input);this.input.addEventListener('input',()=>this.set('Text',this.input.value,true));break;
      case 'Frame':addClass('vb-frame');this.legend=el('span',{class:'vb-frame-legend'});this.childHost=el('div',{class:'vb-frame-client'});n.append(this.legend,this.childHost);break;
      case 'CheckBox':case 'OptionButton':addClass('vb-check');this.input=el('input',{type:this.type==='CheckBox'?'checkbox':'radio',name:'radio_'+(this.form?.model.name||'form')+'_'+(this.model.parent||'root'),'aria-label':p.Caption||this.model.name});this.label=el('span');n.append(this.input,this.label);this.input.addEventListener('change',()=>this.set('Value',this.input.checked?this.type==='CheckBox'?1:-1:0,true));n.addEventListener('click',e=>{if(e.target!==this.input){e.vbHandled=true;this.input.click();e.stopPropagation();}});break;
      case 'ListBox':case 'FileListBox':case 'DirListBox':case 'DriveListBox':this.input=el('select',{class:this.type==='DriveListBox'?'vb-combo':'vb-list',size:this.type==='DriveListBox'?1:2,multiple:this.type==='ListBox'&&p.MultiSelect,'aria-label':this.model.name});n.append(this.input);this.input.addEventListener('change',()=>{if(!acceptsInput(this)){this.invalidate();return;}this.props.ListIndex=this.input.selectedIndex;this.selectedIndices=new Set([...this.input.selectedOptions].map(o=>Number(o.value)));this.event('Click');if(this.type!=='ListBox')this.event('Change');});if(this.type==='DriveListBox')this.items=['C: [Virtual disk]'];if(this.type==='DirListBox')this.items=this.vm?[...this.vm.fs.directories]:['/','/Documents','/Projects'];if(this.type==='FileListBox')this.items=this.vm?[...this.vm.fs.files.keys()].filter(k=>k.startsWith(p.Path||'/')):['Readme.txt','Sample.vbp'];break;
      case 'ComboBox':this.combo=new ClassicCombo(n,()=>this.props,()=>this.items,text=>this.set('Text',text,true),index=>{if(!acceptsInput(this)){this.invalidate();return;}setListIndex(this,index);this.props.Text=this.items[index]||'';this.combo.input.value=this.props.Text;this.event('Click');this.event('Change');this.invalidate();},{design:this.design});this.input=this.combo.input;break;
      case 'PictureBox':addClass('vb-picture');break;
      case 'Image':addClass('vb-image');this.image=el('img',{alt:''});this.placeholder=el('div',{class:'vb-image-placeholder'});n.append(this.image,this.placeholder);break;
      case 'Shape':addClass('vb-shape');this.shape=el('div',{class:'vb-shape-inner'});n.append(this.shape);break;
      case 'Line':this.shape=el('div',{style:{height:'1px',width:'100%',background:'#000'}});n.append(this.shape);break;
      case 'Timer':case 'ImageList':case 'CommonDialog':addClass('vb-nonvisual');n.replaceChildren(controlIcon(this.type));if(this.type==='ImageList'){this.ListImages=new ImageItems(()=>this.invalidate());for(const item of p.ListImages||[])this.ListImages.Add(undefined,item.Key,item.Picture);}break;
      case 'ProgressBar':this.track=el('div',{class:'vb-progress'});this.fill=el('div',{class:'vb-progress-fill'});this.track.append(this.fill);n.append(this.track);break;
      case 'HScrollBar':case 'VScrollBar':this.scrollbar=new ClassicScrollbar(n,()=>this.props,(value,phase)=>{if(!acceptsInput(this)){this.invalidate();return;}if(phase==='scroll'){this.props.Value=value;this.event('Scroll',[],true);}else if(phase==='commit')this.event('Change');else this.set('Value',value,true);},{vertical:this.type==='VScrollBar',design:this.design});break;
      case 'Slider':this.input=el('input',{type:'range',class:'vb-range'+(this.type==='VScrollBar'?' vb-vrange':''),'aria-label':this.model.name});n.append(this.input);this.input.addEventListener('keydown',e=>{if(!this.design&&acceptsInput(this))handleRangeEndpointKey(this.input,e);});this.input.addEventListener('input',()=>{this.set('Value',Number(this.input.value),true);this.input.style.setProperty('--vb-range-progress',rangeProgress(this.input.min,this.input.max,this.input.value));this.event('Scroll',[],true);});break;
      case 'UpDown':this.stepper=new ClassicUpDown(n,()=>this.props,(value,direction)=>{this.set('Value',value,true);this.event(direction>0?'UpClick':'DownClick');},{design:this.design});break;
      case 'TreeView':this.buildTree();break;
      case 'ListView':this.buildListView();break;
      case 'StatusBar':this.barView=new StatusBarController(this,safeImage);break;
      case 'Toolbar':this.barView=new ToolbarController(this,safeImage);break;
      case 'TabStrip':case 'SSTab':buildTabs(this);break;
      case 'RichTextBox':this.input=el('div',{class:'vb-richtext',contenteditable:!this.design,'aria-label':this.model.name,role:'textbox',style:{width:'100%',height:'100%'}});n.append(this.input);this.rich=new RichTextController(this.input,{text:p.Text,rtf:p.TextRTF,defaults:{fontName:p.FontName,fontSize:Number(p.FontSize),bold:truth(p.FontBold),italic:truth(p.FontItalic),underline:truth(p.FontUnderline),color:oleColor(p.ForeColor)},readOnly:this.design||truth(p.Locked)||!truth(p.Enabled),maxLength:Number(p.MaxLength)||0,onChange:()=>{this.props.Text=this.rich.text;this.event('Change');},onSelection:()=>this.event('SelChange',[],true)});break;
      case 'MSFlexGrid':case 'MSHFlexGrid':case 'DataGrid':this.buildGrid();break;
      case 'DTPicker':case 'MonthView':this.dateView=new DateViewController(this);break;
      case 'MSChart':this.props.Column=1;break;
      case 'Data':case 'Adodc':this.buildDataControl();break;
      default:addClass('vb-unsupported');n.textContent=this.type+' — native control not implemented';break;
    }
  }
  refresh(){if(this.disposed)return;const n=this.node,p=this.props;Object.assign(n.style,{left:Number(p.Left||0)/15+'px',top:Number(p.Top||0)/15+'px',width:Math.max(1,Number(p.Width||0)/15)+'px',height:Math.max(1,Number(p.Height||0)/15)+'px',fontFamily:fontFamily(p.FontName),fontSize:Number(p.FontSize||8.25)*96/72+'px',fontWeight:truth(p.FontBold)?'bold':'normal',fontStyle:truth(p.FontItalic)?'italic':'normal',textDecoration:truth(p.FontUnderline)?'underline':'none',color:this.type==='CommandButton'?controlThemeColor(p.ForeColor,'commandForeground','#000'):oleColor(p.ForeColor, '#000')});
    const hidden=!!this._tabOwner&&this._tabPage!==Number(this._tabOwner.props.Tab||0)||!this.design&&(!truth(p.Visible)||NONVISUAL_TYPES.has(this.type)),disabled=!truth(p.Enabled),title=String(p.ToolTipText||''),tabIndex=truth(p.TabStop)?Number(p.TabIndex)||0:-1,label=stripMnemonic(p.Caption||this.model.name);
    if(n.hidden!==hidden)n.hidden=hidden;n.classList.toggle('disabled',disabled);if(n.title!==title)n.title=title;if(n.tabIndex!==(this.input?-1:tabIndex))n.tabIndex=this.input?-1:tabIndex;if(n.getAttribute('aria-label')!==label)n.setAttribute('aria-label',label);
    if(this.input){if(!['Slider','UpDown','CheckBox','OptionButton'].includes(this.type))this.input.style.backgroundColor=['TextBox','ComboBox','DTPicker'].includes(this.type)?controlThemeColor(p.BackColor,'inputBackground'):oleColor(p.BackColor);this.input.style.color=['TextBox','ComboBox','DTPicker'].includes(this.type)?controlThemeColor(p.ForeColor,'inputForeground'):oleColor(p.ForeColor);if(this.input.disabled!==disabled)this.input.disabled=disabled;if(this.input.tabIndex!==tabIndex)this.input.tabIndex=tabIndex;}
    if(['Frame','TextBox','PictureBox','CommandButton','Label','RichTextBox'].includes(this.type))n.style.background=Number(p.BackStyle)===0&&this.type==='Label'?'transparent':this.type==='CommandButton'?controlThemeColor(p.BackColor,'commandBackground'):this.type==='TextBox'?controlThemeColor(p.BackColor,'inputHostBackground'):oleColor(p.BackColor);
    switch(this.type){
      case 'CommandButton':{updateMnemonic(n,p.Caption);n.classList.toggle('default-button',!!p.Default);const paint=commandPaint(p.BackColor,p.ForeColor);n.style.background=controlThemePaint(p.BackColor,'commandBackground',paint.background);n.style.color=controlThemePaint(p.ForeColor,'commandForeground',paint.color);break;}
      case 'Label':updateMnemonic(n,p.Caption);n.style.justifyContent=['flex-start','flex-end','center'][Number(p.Alignment)||0];n.style.textAlign=['left','right','center'][Number(p.Alignment)||0];break;
      case 'Frame':{updateMnemonic(this.legend,p.Caption);const paint=groupPaint(p.BackColor,p.ForeColor);n.style.background=paint.background;this.legend.style.background=paint.legendBackground;break;}
      case 'TextBox':if(this.input.value!==String(p.Text??''))this.input.value=String(p.Text??'');this.input.readOnly=truth(p.Locked);if(p.MaxLength>0)this.input.maxLength=Number(p.MaxLength);else this.input.removeAttribute('maxlength');this.input.style.textAlign=['left','right','center'][Number(p.Alignment)||0];this.input.style.backgroundColor=controlThemeColor(p.BackColor,'inputBackground');break;
      case 'CheckBox':case 'OptionButton':updateMnemonic(this.label,p.Caption);this.input.checked=truth(p.Value);this.input.indeterminate=Number(p.Value)===2;break;
      case 'ListBox':case 'FileListBox':case 'DirListBox':case 'DriveListBox':if(this.listRevision!==this.itemsRevision||this.lastListCount!==this.items.length){selectOptions(this.input,this.items,Number(p.ListIndex));this.listRevision=this.itemsRevision;this.lastListCount=this.items.length;}if(!p.MultiSelect)this.input.selectedIndex=Number(p.ListIndex);else for(const option of this.input.options)option.selected=this.selectedIndices.has(Number(option.value));break;
      case 'ComboBox':this.combo.refresh();this.input.style.backgroundColor=controlThemePaint(p.BackColor,'inputBackground',comboPaint(p.BackColor,p.ForeColor,p.Style));break;
      case 'PictureBox':if(p.Picture||this.surface){const surface=this.ensureSurface();surface.background=p.BackColor;surface.setPicture(safeImage(p.Picture,this.assets));surface.invalidate();}break;
      case 'Image':{const source=safeImage(p.Picture,this.assets);if(source)this.image.src=source;else this.image.removeAttribute('src');this.image.hidden=!source;this.placeholder.hidden=!!source||!this.design;this.image.style.objectFit=truth(p.Stretch)?'fill':'none';break;}
      case 'Shape':this.shape.style.borderColor=oleColor(p.BorderColor||0);this.shape.style.borderRadius=[2,3].includes(Number(p.Shape))?'50%':[4,5].includes(Number(p.Shape))?'10px':'0';this.shape.style.background=Number(p.FillStyle)===1?'transparent':oleColor(p.FillColor);break;
      case 'Line':this.shape.style.background=oleColor(p.BorderColor);this.shape.style.height=Math.max(1,Number(p.BorderWidth)||1)+'px';break;
      case 'ProgressBar':this.fill.style.width=Math.max(0,Math.min(100,(Number(p.Value)-Number(p.Min))/(Number(p.Max)-Number(p.Min)||1)*100))+'%';break;
      case 'HScrollBar':case 'VScrollBar':this.scrollbar.refresh();break;
      case 'UpDown':this.stepper.refresh();break;
      case 'Slider':this.input.min=p.Min;this.input.max=p.Max;this.input.step=p.SmallChange||1;this.input.value=p.Value;applyRangeOrientation(this.input,Number(p.Orientation)===1);this.input.style.setProperty('--vb-range-progress',rangeProgress(this.input.min,this.input.max,this.input.value));break;
      case 'TreeView':this.refreshTree();break;
      case 'ListView':this.refreshListView();break;
      case 'StatusBar':this.barView.refresh();break;
      case 'Toolbar':this.barView.refresh();break;
      case 'TabStrip':case 'SSTab':refreshTabs(this,value=>safeImage(value,this.assets));break;
      case 'RichTextBox':this.rich.readOnly=this.design||truth(p.Locked)||!truth(p.Enabled);this.input.contentEditable=String(!this.rich.readOnly);break;
      case 'MSFlexGrid':case 'MSHFlexGrid':case 'DataGrid':this.refreshGrid();break;
      case 'DTPicker':case 'MonthView':this.dateView.refresh();break;
      case 'MSChart':this.refreshChart();break;
      case 'Data':case 'Adodc':this.dataLabel.textContent=p.Caption||'Data';break;
    }
  }
  defaultValue(){if(['TextBox','RichTextBox','ComboBox','ListBox','FileListBox','DirListBox','DriveListBox','MSFlexGrid','MSHFlexGrid','DataGrid'].includes(this.type))return this.get('Text');if(['CheckBox','OptionButton','HScrollBar','VScrollBar','Slider','ProgressBar','UpDown','DTPicker'].includes(this.type))return this.get('Value');return this.get('Caption');}
  defaultRef(){const key=['TextBox','RichTextBox','ComboBox','ListBox','FileListBox','MSFlexGrid','MSHFlexGrid','DataGrid'].includes(this.type)?'Text':['CheckBox','OptionButton','HScrollBar','VScrollBar','Slider','ProgressBar','UpDown','DTPicker'].includes(this.type)?'Value':'Caption';return new Ref(()=>this.get(key),v=>this.set(key,v));}
  AddItem(text,index){if(this._boundRS)throw new VBError('Use Recordset.AddNew to add a bound row',445);if(GRID_TYPES.has(this.type)){addGridItem(this,text,index);return;}addListItem(this,text,index);}
  RemoveItem(index){if(this._boundRS)throw new VBError('Use Recordset.Delete to delete a bound row',445);if(GRID_TYPES.has(this.type)){removeGridItem(this,index);return;}removeListItem(this,index);}
  Clear(){if(this._boundRS)throw new VBError('Clear is not supported on bound grids',445);if(LIST_TYPES.has(this.type)){clearList(this);return;}this.gridData=[];this._cellStyles?.clear();this.invalidate();}
  get ListCount(){return this.items.length;}get SelCount(){return this.selectedIndices.size;}get NewIndex(){return this._newIndex??-1;}
  List(index){return this.items[listIndex(this,index)];}
  ItemData(index){return this.itemData[listIndex(this,index)]??0;}
  Selected(index){return this.selectedIndices.has(listIndex(this,index))?-1:0;}
  TextMatrix(row,col){row=Number(row);col=Number(col);if(!Number.isInteger(row)||!Number.isInteger(col)||row<0||col<0||row>=this.props.Rows||col>=this.props.Cols)throw new VBError('Invalid row or column',381);return this.gridValue(row,col);}
  ColWidth(index){return this._colWidths[gridIndex(this,'colwidth',index)]??1200;}
  RowHeight(index){return this._rowHeights[gridIndex(this,'rowheight',index)]??315;}
  RowData(index){return this._rowData[gridIndex(this,'rowdata',index)]??0;}
  ColData(index){return this._colData[gridIndex(this,'coldata',index)]??0;}
  ColAlignment(index){return this._colAlignment[gridIndex(this,'colalignment',index)]??9;}
  ColAlignmentFixed(index){return this._colAlignmentFixed[gridIndex(this,'colalignmentfixed',index)]??9;}
  RowPos(index){return this.gridView?.position('row',index)??0;}
  ColPos(index){return this.gridView?.position('col',index)??0;}
  get TopRow(){return this.gridView?.getTop('row')??0;}set TopRow(value){this.gridView?.setTop('row',value);}
  get LeftCol(){return this.gridView?.getTop('col')??0;}set LeftCol(value){this.gridView?.setTop('col',value);}
  get MouseRow(){return this.gridView?.lastMouse.row??-1;}get MouseCol(){return this.gridView?.lastMouse.col??-1;}
  TextArray(index){index=controlInteger(index,0,this.props.Rows*this.props.Cols-1,381);return this.TextMatrix(Math.floor(index/this.props.Cols),index%this.props.Cols);}

  setIndexed(name,args,value){if(setIndexedTab(this,name,args,value))return;const key=lower(name);if(key==='daybold'&&this.type==='MonthView'){if(args.length!==1)throw new VBError('Wrong number of arguments',450);this.dateView.state.setDayBold(args[0],value);return;}if(GRID_TYPES.has(this.type)&&gridIndexed(this,key,args,value))return;if(key==='textarray'&&GRID_TYPES.has(this.type)){if(args.length!==1)throw new VBError('Wrong number of arguments',450);const index=controlInteger(args[0],0,this.props.Rows*this.props.Cols-1,381);this.setIndexed('TextMatrix',[Math.floor(index/this.props.Cols),index%this.props.Cols],value);return;}if(LIST_TYPES.has(this.type)&&setListIndexed(this,key,args,value))return;if(key==='textmatrix'){const [r,c]=args.map(Number);this.TextMatrix(r,c);if(this._boundRS){if(r===0)throw new VBError('Bound column headers are read-only',445);this._boundRS.setRowValue(this._boundRows[r-1],c,value);}else{this.gridData[r] ||= [];this.gridData[r][c]=String(value);}}else throw new VBError('Unknown indexed property: '+name,438);this.invalidate();}
  VisibleDays(index){if(this.type!=='MonthView')throw new VBError('VisibleDays requires MonthView',438);return this.dateView.visibleDays(index);}
  DayBold(date){if(this.type!=='MonthView')throw new VBError('DayBold requires MonthView',438);return this.dateView.state.dayBold(date);}
  get Clip(){return gridClip(this);}
  set Clip(value){setGridClip(this,value);}
  get SelStart(){if(this.type==='MonthView')return this.dateView.get('SelStart');if(this.rich){this.rich.readSelection();return this.rich.start;}return this.input?.selectionStart||0;}set SelStart(v){if(this.type==='MonthView'){this.dateView.set('SelStart',v);return;}v=Number(v);if(!Number.isInteger(v)||v<0)throw new VBError('Invalid selection start',380);if(this.rich)this.rich.select(Math.min(v,this.rich.text.length));else this.input?.setSelectionRange?.(v,v);}
  get SelLength(){if(this.rich){this.rich.readSelection();return this.rich.end-this.rich.start;}return (this.input?.selectionEnd||0)-(this.input?.selectionStart||0);}set SelLength(v){v=Number(v);if(!Number.isInteger(v)||v<0)throw new VBError('Invalid selection length',380);if(this.rich)this.rich.select(this.rich.start,Math.min(this.rich.text.length,this.rich.start+v));else this.input?.setSelectionRange?.(this.SelStart,this.SelStart+v);}
  get SelText(){if(this.rich){this.rich.readSelection();return this.rich.selectedText;}return String(this.props.Text||'').slice(this.SelStart,this.SelStart+this.SelLength);}set SelText(value){if(this.rich)this.rich.replaceSelection(String(value));else if(this.input?.setRangeText){this.input.setRangeText(String(value),this.SelStart,this.SelStart+this.SelLength,'end');this.set('Text',this.input.value,true);}}
  get SelRTF(){if(!this.rich)throw new VBError('SelRTF requires RichTextBox',438);return this.rich.selectedRTF;}set SelRTF(value){if(!this.rich)throw new VBError('SelRTF requires RichTextBox',438);this.rich.replaceSelection(parseRTF(String(value),this.rich.defaults));}
  get CanUndo(){return this.rich?.undoStack.length?-1:0;}get CanRedo(){return this.rich?.redoStack.length?-1:0;}
  Undo(){return this.rich?.undo()?-1:0;}Redo(){return this.rich?.redo()?-1:0;}
  Find(text,start=0,end=-1,options=0){if(!this.rich)throw new VBError('Find requires RichTextBox',438);return this.rich.find(text,start,end,options);}
  GetLineFromChar(index){if(!this.rich)throw new VBError('GetLineFromChar requires RichTextBox',438);index=Number(index);this.rich.document.checkRange(index);return this.rich.text.slice(0,index).split('\r\n').length-1;}
  get RTFWarnings(){return this.rich?.document.warnings.join('\r\n')||'';}
  SetFocus(){(this.input||this.viewport||this.node).focus();}Refresh(){if(['Data','Adodc'].includes(this.type)&&!this.design)return this.refreshDataControl();this.refresh();this.surface?.render();}Move(left,top,width,height){
    const values={Left:Number(left),...(top===undefined?{}:{Top:Number(top)}),...(width===undefined?{}:{Width:Number(width)}),...(height===undefined?{}:{Height:Number(height)})};
    if(this.anchoring)for(const [key,value]of Object.entries(values))if(!Number.isFinite(value)||Math.abs(value)>300000||/Width|Height/.test(key)&&value<0)throw new VBError('Invalid geometry: '+key,380);
    Object.assign(this.props,values);
    if(this.anchoring&&['Form','MDIForm'].includes(this.type)){if(width!==undefined)this.props.ClientWidth=Number(width);if(height!==undefined)this.props.ClientHeight=Number(height);this.layoutController?.arrange();}
    else this.form?.layoutController?.edit(this,'Width');this.invalidate();}ZOrder(position=0){if(position===0)this.node.parentNode?.append(this.node);else this.node.parentNode?.prepend(this.node);}
  Cls(){this.surface?.clear();this.currentX=0;this.currentY=0;}
  get CurrentX(){return this.currentX;}set CurrentX(v){this.currentX=Number(v);}get CurrentY(){return this.currentY;}set CurrentY(v){this.currentY=Number(v);}
  ensureSurface(){if(!this.surface){this.node.style.position='absolute';this.surface=new GraphicsSurface(this.node,{backend:this.backend,background:this.props.BackColor,onBackend:this.onBackend});this.surface.setPicture(safeImage(this.props.Picture,this.assets));}return this.surface;}
  draw(kind,coords,color=0,fill=false){const scale=units(this.props.ScaleMode||1),translated=coords.map((n,i)=>(n-(i%2?(this.props.ScaleTop||0):(this.props.ScaleLeft||0)))/scale);if(kind==='circle')translated[2]=coords[2]/scale;this.ensureSurface().add(kind,translated,color,fill,Number(this.props.DrawWidth)||1);}
  Print(...values){const scale=units(this.props.ScaleMode||1);this.ensureSurface().text(values.map(v=>String(v??'')).join(' '),this.currentX/scale,this.currentY/scale,this.props.ForeColor,`${this.props.FontBold?'bold ':''}${Number(this.props.FontSize)*96/72}px Arial`);this.currentY+=Number(this.props.FontSize)*96/72*scale*1.3;}
  Scale(x1,y1,x2,y2){this.props.ScaleLeft=x1;this.props.ScaleTop=y1;this.props.ScaleWidth=x2-x1;this.props.ScaleHeight=y2-y1;this.props.ScaleMode=0;}
  updateTimer(){clearInterval(this.timerId);this.timerId=null;if(this.design||this.disposed||!this.form?.shown||!truth(this.props.Enabled)||!this.props.Interval)return;this.timerId=setInterval(()=>this.event('Timer',[],true),Math.max(10,Number(this.props.Interval)));}
  buildDataControl(){
    this._recordset=this.vm?.data?.createObject('ADODB.Recordset')||new MemoryRecordset();
    Object.defineProperty(this,'Recordset',{configurable:true,get:()=>this._recordset,set:rs=>{
      if(!(rs instanceof MemoryRecordset))throw new VBError('Expected a Recordset',13);
      this._recordset=rs;
      for(const control of this.form?.controls||[])if(control._dataSource===this)control.bindRecordset(this);
    }});
    this.dataLabel=el('span',{style:{flex:'1',textAlign:'center'}});this.node.classList.add('vb-toolbar');
    for(const [caption,action]of [['|◀','MoveFirst'],['◀','MovePrevious'],['▶','MoveNext'],['▶|','MoveLast']]){
      const button=el('button',{text:caption,'aria-label':action,onclick:async()=>{try{await this.Recordset[action]();await this.event('Reposition');}catch(error){this.LastDataError=error.message;this.node.title=error.message;}}});
      this.node.append(button);if(action==='MovePrevious')this.node.append(this.dataLabel);
    }
  }
  async refreshDataControl(){
    if(!this.vm?.data)return;
    const source=this.props.ConnectionString||this.props.Connect||this.props.DatabaseName;
    if(!source)return;
    const cn=this.vm.data.connection();
    try{
      cn.Mode=this.props.ReadOnly?1:3;
      await cn.Open(this.props.ConnectionString||this.props.Connect||(/=/.test(source)?source:{provider:'sqlite',database:source}));
      const rs=this.vm.data.createObject('ADODB.Recordset');
      const type=this.type==='Data'?(/^\s*(SELECT|WITH)\b/i.test(this.props.RecordSource)?1:2):Number(this.props.CommandType||1);
      await rs.Open(this.props.RecordSource,cn,3,this.props.ReadOnly?1:Number(this.props.LockType||(type===2?3:1)),type);
      const previous=this._dataConnection;this._dataConnection=cn;this.Recordset=rs;await previous?.Close();await this.event('Reposition');return rs;
    }catch(error){await cn.Close();throw error;}
  }
  UpdateRecord(){return this.Recordset?.Update();}
  bindRecordset(source){
    const rs=source?.Recordset||(this.props.DataMember?source?.['rs'+this.props.DataMember]:null)||source,unbinding=source===NOTHING||source===null||source==='';
    if(!unbinding&&!(rs instanceof MemoryRecordset))throw new VBError('DataSource must be a Recordset, data control or Data Environment member',13);
    if(!['MSFlexGrid','MSHFlexGrid','DataGrid','TextBox','Label','CheckBox','ComboBox','DTPicker'].includes(this.type))throw new VBError('This control does not support field binding',445);
    this._unsubscribeData?.();this._unsubscribeData=null;this._boundRS=unbinding?null:rs;this._dataSource=source;this.gridEditor=null;
    if(unbinding){this.gridData=[];this.props.Rows=2;this.props.Cols=2;this._boundRows=null;this.invalidate();return;}
    this._unsubscribeData=rs.subscribe(change=>this.refreshBinding(change.kind));
    if(this.input&&!this._boundBlur){this._boundBlur=()=>Promise.resolve().then(()=>this._boundRS?.Update?.()).catch(error=>{this.LastDataError=error.message;this.node.title=error.message;});this.input.addEventListener('blur',this._boundBlur);}
    this.refreshBinding('bind');
  }
  refreshBinding(kind){
    const rs=this._boundRS;if(!rs||this.disposed)return;
    if(!['MSFlexGrid','MSHFlexGrid','DataGrid'].includes(this.type)){const field=this.props.DataField;if(!field)return;const value=rs.State&&!rs.BOF&&!rs.EOF?rs.Fields.Item(field).Value:null;if(this.dateView){if(value!==null)this.dateView.set('Value',value,{fromBinding:true,silent:true});else if(this.props.CheckBox)this.dateView.set('Value',null,{fromBinding:true,silent:true});else{this.LastDataError='A Null date requires CheckBox = True';}return;}this.props[this.type==='Label'?'Caption':['CheckBox','DTPicker'].includes(this.type)?'Value':'Text']=value??(this.type==='CheckBox'?0:'');this.invalidate();return;}
    this._boundRows=rs.State?rs.view():[];this.props.Rows=this._boundRows.length+1;this.props.Cols=rs.columns.length;this.props.FixedRows=1;
    const previous=this.props.Row;this.props.Row=this.props.RowSel=rs.State&&!rs.BOF&&!rs.EOF?rs.position+1:0;this.props.Col=Math.max(0,Math.min(Number(this.props.Col)||0,rs.columns.length-1));
    if(kind!=='move'||previous!==this.props.Row)this.invalidate();
  }
  gridValue(row,col){if(this._boundRS)return row===0?this._boundRS.columns[col]?.Name??'':String(this._boundRows?.[row-1]?.[this._boundRS.columns[col]?.Name]??'');return this.gridData[row]?.[col]??'';}
  syncGridCursor(){if(this._boundRS?.State&&this.props.Row>0&&this.props.Row<=this._boundRows.length&&this._boundRS.position!==this.props.Row-1)this._boundRS.AbsolutePosition=this.props.Row;}
  beginGridEdit(td,row,col){
    if(!acceptsInput(this)||this.gridEditor||truth(this.props.Locked)||truth(this.props.ReadOnly)||this._boundRS?.LockType===1)return;
    const source=this._boundRS,record=this._boundRows?.[row-1],old=source?record?.[source.columns[col]?.Name]:this.gridValue(row,col),input=el('input',{class:'vb-grid-editor','aria-label':'Edit row '+row+', column '+col,value:this.gridValue(row,col)});
    const editor={input,row,col};this.gridEditor=editor;td.replaceChildren(input);input.focus();input.select();let done=false;
    const commit=async()=>{if(done)return;done=true;try{
      const cancel=new Cell('Integer',0);await this.event('BeforeColUpdate',[col,old,{ref:cancel}]);if(!cancel.get())await this.event('Validate',[{ref:cancel}]);
      if(cancel.get()||this.disposed||this.vm?.state==='error')return;
      if(source!==this._boundRS)throw new VBError('DataSource changed during editing',3197);
      if(source)await source.setRowValue(record,col,input.value,old);else{if(row>=this.props.Rows||col>=this.props.Cols||this.gridValue(row,col)!==old)throw new VBError('The grid cell changed during editing',3197);this.gridData[row] ||= [];this.gridData[row][col]=input.value;}
      this.LastDataError='';this.node.removeAttribute('data-error');this.node.title=String(this.props.ToolTipText||'');
      await this.event('AfterColUpdate',[col]);
    }catch(error){this.LastDataError=error.message;this.node.dataset.error=error.message;this.node.title='Edit rejected: '+error.message;}
    finally{if(this.gridEditor===editor)this.gridEditor=null;if(!this.disposed)this.paintGridRows();}};
    input.addEventListener('blur',commit);input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();event.stopPropagation();commit();}else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();done=true;this.gridEditor=null;this.paintGridRows();}});
  }
  applyRichFormat(key,value){this.rich?.format(key,value);}
  LoadFile(path,fileType=0){if(!this.vm)throw new VBError('Runtime not active',5);if(this.rich){if(![0,1].includes(Number(fileType)))throw new VBError('Invalid rich text file type',380);this.set(Number(fileType)===0?'TextRTF':'Text',this.vm.fs.read(path));}else this.set('Text',this.vm.fs.read(path));}
  SaveFile(path,fileType=0){if(!this.vm)throw new VBError('Runtime not active',5);if(this.rich&&![0,1].includes(Number(fileType)))throw new VBError('Invalid rich text file type',380);this.vm.fs.write(path,this.rich&&Number(fileType)===0?this.get('TextRTF'):this.get('Text'));}
  async ShowOpen(){const result=await this.vm?.host.openFile?.(this.props);if(!result){return dialogCancelled(this);}if(this.disposed)return;this.props.FileName=result.name;this.props.FileTitle=String(result.name).split(/[\\/]/).at(-1);if(result.bytes)this.vm.fs.writeBytes(result.name,result.bytes);else this.vm.fs.write(result.name,result.text);}
  async ShowSave(){const name=await this.vm?.host.inputBox?.('File name:',this.props.DialogTitle||'Save As',this.props.FileName||'Untitled.txt');if(!name){return dialogCancelled(this);}if(this.disposed)return;this.props.FileName=name;this.props.FileTitle=String(name).split(/[\\/]/).at(-1);this.vm?.host.saveFile?.(name,this.vm.fs.exists(name)?this.vm.fs.readBytes(name):'');}
  async ShowColor(){return showColor(this);}
  async ShowFont(){return showFont(this);}
  dispose(){unbindTabChild(this);this.vm?.win32?.unregisterControl(this.hWnd);this._unsubscribeData?.();this._unsubscribeData=null;this.gridEditor=null;this.disposed=true;if(this.ListImages){this.ListImages.changed();this.ListImages.listeners.clear();}this.collectionView?.dispose();this.gridView?.dispose();this.barView?.dispose();this.dateView?.dispose();cancelAnimationFrame(this.raf);clearInterval(this.timerId);this.surface?.dispose();this.rich?.dispose();this.scrollbar?.dispose();this.combo?.dispose();this.stepper?.dispose();this.node.remove();}
  buildTree(){this.collectionView=new TreeViewController(this,safeImage);}
  get SelectedItem(){if(this.type==='TreeView')return this.Nodes.selected;if(this.type==='ListView')return this.ListItems.selected;if(this.type==='TabStrip')return this.Tabs.items[this.props.Tab||0]||null;return null;}
  set SelectedItem(item){
    if(item?.__nothing)item=null;
    if(this.type==='TreeView')this.Nodes.select(item);
    else if(this.type==='ListView'){if(item)this.ListItems.select(item,true,false);else this.ListItems.clearSelection();}
    else if(this.type==='TabStrip'){if(!this.Tabs.items.includes(item))throw new VBError('Invalid tab',380);this.set('Tab',this.Tabs.items.indexOf(item));}
    this.invalidate();
  }
  refreshTree(){this.collectionView.refresh();}
  paintTreeRows(){this.collectionView.paint();}
  buildListView(){this.collectionView=new ListViewController(this,safeImage);}
  refreshListView(){this.collectionView.refresh();}
  paintListRows(){this.collectionView.paint();}
  FindItem(text,where=0,index=1,match=0){return this.collectionView?.find?.(text,where,index,match)||null;}
  HitTest(x,y){return this.collectionView?.hitTest(x,y)||null;}
  GetFirstVisible(){return this.collectionView?.firstVisible()||null;}
  GetVisibleCount(){return this.collectionView?.visibleCount()||0;}
  StartLabelEdit(){if(!this.collectionView)throw new VBError('Label editing is not supported',438);return this.collectionView.startEdit(true);}

  buildGrid(){this.gridView=new GridViewController(this);}
  refreshGrid(){this.gridView.refresh();}
  gridColumns(){return this.gridView.geometry().col;}
  ensureGridCellVisible(){this.gridView.scrollToCell();}
  paintGridRows(){this.gridView.paint();}
  refreshMonth(){this.dateView?.refresh();}
  refreshChart(){if(!this.node.isConnected&&!this.design)return;const surface=this.ensureSurface();surface.background=this.props.BackColor;surface.clear();const w=Number(this.props.Width)/15,h=Number(this.props.Height)/15,values=(this.gridData.length?this.gridData.map(r=>Number(r[0])||0):[24,38,31,55,42]),max=Math.max(1,...values),left=34,top=18,bottom=h-24,right=w-16;for(let i=0;i<=4;i++){const y=bottom-(bottom-top)*i/4;surface.add('line',[left,y,right,y],-2147483632);surface.text(String(Math.round(max*i/4)),3,y-6,this.props.ForeColor,'10px Arial');}surface.add('line',[left,top,left,bottom],this.props.ForeColor);surface.add('line',[left,bottom,right,bottom],this.props.ForeColor);const step=(right-left)/Math.max(1,values.length);values.forEach((v,i)=>{const x=left+i*step+step*.2,y=bottom-(bottom-top)*v/max;if(Number(this.props.ChartType)===3&&i>0){const prev=values[i-1];surface.add('line',[left+(i-.5)*step,bottom-(bottom-top)*prev/max,left+(i+.5)*step,y],16711680,false,2);}else surface.add('rect',[x,y,x+step*.6,bottom-1],-2147483635,true);surface.text(String(i+1),left+(i+.5)*step-3,bottom+6,this.props.ForeColor,'10px Arial');});}
}

export class BrowserForm extends BrowserControl {
  async initializeDataBindings(){
    for(const control of this.controls)if(['Data','Adodc'].includes(control.type)&&control.props.RecordSource)await control.Refresh();
    for(const control of this.controls){
      const source=control.props.DataSource;if(!source||!['TextBox','Label','CheckBox','ComboBox','DTPicker','DataGrid','MSFlexGrid','MSHFlexGrid'].includes(control.type))continue;
      if(typeof source!=='string')continue;
      const target=this.controlMap.get(source.toLowerCase())||this.vm.library.get(source.toLowerCase());
      if(!target)throw new VBError('DataSource not found: '+source,3265);control.bindRecordset(target);
    }
  }
  static frontSequence=0;
  constructor(model,options={}){const p=model.properties||{},normalized={...model,properties:{...p,Width:p.ClientWidth??p.Width??9000,Height:p.ClientHeight??p.Height??6000}};super(normalized,options);this.originalModel=model;this.controls=[];this.controlMap=new Map();this.shown=false;this.form=this;this.mountControls(model.controls||[]);if(this.anchoring&&!this.design)this.layoutController=new FormLayout(this);const form=this;this.Controls={get Count(){return form.controls.length;},Item:key=>{const control=typeof key==='number'?form.controls[key]:form.controlMap.get(lower(key));if(!control)throw new VBError('Control not found: '+key,35601);return control;},Add:(type,name,container)=>form.addControl(type,name,container),Remove:key=>form.removeControl(typeof key==='string'?form.controlMap.get(lower(key)):key),[Symbol.iterator]:()=>form.controls.values()};this.Controls.Add.vbRawArgs=true;this.Controls.Remove.vbRawArgs=true;this.attachWindowDragging();if(!this.design){this.node.addEventListener('pointerdown',()=>this.activateChrome(),true);this.node.addEventListener('focusin',()=>this.activateChrome());}if(this.props.Picture)this.ensureSurface().setPicture(safeImage(this.props.Picture,this.assets));}
  build(){this.node.className='vb-form';this.node.setAttribute('role','dialog');this.titleBar=el('div',{class:'vb-form-title'});this.captionNode=el('span',{class:'caption'});this.closeButton=el('button',{class:'vb-window-button','data-caption-action':'close',title:'Close','aria-label':'Close',onclick:()=>this.vm?.requestUnload(this.instance)});this.closeButton.append(icon('close'));this.minButton=el('button',{class:'vb-window-button','data-caption-action':'minimize',title:'Minimize','aria-label':'Minimize',onclick:()=>this.toggleMinimize()},icon('minimize'));this.maxButton=el('button',{class:'vb-window-button','data-caption-action':'maximize',title:'Maximize','aria-label':'Maximize',onclick:()=>this.toggleMaximize()},icon('maximize'));this.titleBar.append(el('span',{class:'vb-form-icon'},icon('form',16)),this.captionNode,this.minButton,this.maxButton,this.closeButton);this.menuBar=el('div',{class:'vb-form-menu'});this.content=el('div',{class:'vb-form-content'});this.childHost=this.content;this.node.append(this.titleBar,this.menuBar,this.content);this.form=this;}
  attachEvents(){if(this.design)return;bindMouseInput(this);bindKeyboardInput(this);this.content.addEventListener('click',e=>{if(ownsInputEvent(this,e))this.event('Click');});this.content.addEventListener('dblclick',e=>{if(ownsInputEvent(this,e))this.event('DblClick');});this.node.addEventListener('keydown',e=>{if(e.defaultPrevented||!acceptsInput(this))return;if(e.key==='F10'){e.preventDefault();this.menuBar.querySelector('button:not(:disabled)')?.click();return;}if(e.key==='Enter'&&!e.target.matches('textarea,[contenteditable]')){const control=this.controls?.find(c=>c.type==='CommandButton'&&c.node.contains(e.target)&&acceptsInput(c))||this.controls?.find(c=>c.type==='CommandButton'&&c.Default&&acceptsInput(c));if(control){e.preventDefault();control.event('Click');}}if(e.key==='Escape'){const control=this.controls?.find(c=>c.type==='CommandButton'&&c.Cancel&&acceptsInput(c));if(control){e.preventDefault();control.event('Click');}}if(e.altKey&&e.key.length===1){const key=e.key.toLowerCase(),match=text=>{const value=String(text||'').replace(/&&/g,'');return /&./.test(value)&&value.match(/&./)[0][1].toLowerCase()===key;};const control=this.controls?.find(c=>acceptsInput(c)&&match(c.props.Caption));if(control){e.preventDefault();if(control.type==='Label'){this.controls.filter(c=>c.TabStop&&acceptsInput(c)&&c.TabIndex>control.TabIndex).sort((a,b)=>a.TabIndex-b.TabIndex)[0]?.SetFocus();}else{control.SetFocus();control.node.click();}}else{const menus=(this.originalModel?.menus||[]).filter(m=>!m.parent&&m.properties.Visible!==0);const i=menus.findIndex(m=>match(m.properties.Caption));if(i>=0){e.preventDefault();this.menuBar.children[i]?.click();}}}});}
  event(name,args=[],coalesce=false){if(this.design||!this.vm||this.disposed)return Promise.resolve();return this.vm.dispatch(this.instance,(this.type==='MDIForm'?'MDIForm_':'Form_')+name,args,{coalesce});}
  refresh(){if(!this.content)return;this.layoutController?.arrange();const p=this.props,w=Number(p.ClientWidth??p.Width??9000)/15,h=Number(p.ClientHeight??p.Height??6000)/15;this.captionNode.textContent=p.Caption||this.model.name;this.node.setAttribute('aria-label',this.captionNode.textContent);this.node.style.fontFamily=fontFamily(p.FontName);this.node.style.fontSize=Number(p.FontSize||8.25)*96/72+'px';this.node.style.width=w+8+'px';this.node.style.height='auto';this.content.style.width=w+'px';this.content.style.height=h+'px';this.content.style.background=oleColor(p.BackColor);this.node.hidden=!this.design&&!this.shown;this.node.style.left=Number(p.Left||0)/15+'px';this.node.style.top=Number(p.Top||0)/15+'px';const border=Number(p.BorderStyle??2);this.titleBar.hidden=border===0;this.node.classList.toggle('vb-borderless',border===0);this.node.classList.toggle('vb-tool-window',border===4||border===5);this.node.style.width=w+(border===0?0:8)+'px';this.minButton.hidden=p.ControlBox===0||border===3||border>=4;this.maxButton.hidden=p.ControlBox===0||border===3||border>=4;this.closeButton.hidden=p.ControlBox===0;this.minButton.disabled=p.MinButton===0;this.maxButton.disabled=p.MaxButton===0;this.node.classList.toggle('vb-fixed-window',![2,5].includes(border)||this.minimized||!!this.savedBounds);this.renderMenus();if(this.surface){this.surface.background=p.BackColor;this.surface.invalidate();}}
  renderMenus(){const menus=this.originalModel?.menus||this.model.menus||[],signature=JSON.stringify(menus);if(this.menuSnapshot===signature)return;this.menuSnapshot=signature;const roots=menus.filter(m=>!m.parent&&m.properties.Visible!==0);this.menuBar.hidden=!roots.length;this.menuBar.setAttribute('role','menubar');this.menuBar.replaceChildren(...roots.map((menu,index)=>{const button=el('button',{role:'menuitem','aria-haspopup':menus.some(m=>m.parent===menu.name)||menu.properties.WindowList?'menu':null,'aria-expanded':'false',disabled:menu.properties.Enabled===0});updateMnemonic(button,menu.properties.Caption||menu.name);button.addEventListener('click',()=>{const children=menus.filter(m=>m.parent===menu.name&&m.properties.Visible!==0);if(!children.length&&!menu.properties.WindowList){this.vm?.dispatch(this.instance,menu.name+'_Click',[]);return;}this.showMenu(children,button,menus,index);});button.addEventListener('pointerenter',()=>{if(menuIsOpen()&&!button.disabled)button.click();});button.addEventListener('keydown',e=>{if(['ArrowDown','Enter',' '].includes(e.key)){e.preventDefault();e.stopPropagation();button.click();}});return button;}));}
  showMenu(items,anchor,all,index=0){const map=values=>values.filter(m=>m.properties.Visible!==0).map(item=>item.properties.Caption==='-'?null:{label:item.properties.Caption||item.name,enabled:item.properties.Enabled!==0,checked:item.properties.Checked?true:undefined,items:all.some(m=>m.parent===item.name&&m.properties.Visible!==0)?()=>map(all.filter(m=>m.parent===item.name)):undefined,action:()=>this.vm?.dispatch(this.instance,item.name+'_Click',[])});const rect=anchor.getBoundingClientRect();const values=map(items),root=all.filter(m=>!m.parent&&m.properties.Visible!==0)[index];if(root?.properties.WindowList&&this.mdiController){const windows=this.mdiController.windowItems();if(values.length&&windows.length)values.push(null);values.push(...windows);}openClassicMenu(values,rect.left,rect.bottom,null,{opener:anchor,runtime:true,theme:getTheme(this.node).id,focusFirst:true,onSwitch:direction=>{const list=[...this.menuBar.children];for(let n=1;n<=list.length;n++){const next=list[(index+direction*n+list.length*2)%list.length];if(!next.disabled){next.click();break;}}}});}

  mountControls(models){const adapters=new Map();for(const model of models){const control=createBrowserControl(model,{controlRegistry:this.controlRegistry,design:this.design,vm:this.vm,instance:this.instance,form:this,assets:this.assets,backend:this.backend,onBackend:this.onBackend});this.controls.push(control);adapters.set(lower(model.name),control);adapters.set(model.id,control);if(model.properties?.Index!==undefined){let array=this.controlMap.get(lower(model.name));if(!(array instanceof ControlArray)){array=new ControlArray(index=>this.loadArrayElement(array,model,index),index=>this.removeControl(array.Item(index)));this.controlMap.set(lower(model.name),array);}array.items.set(Number(model.properties.Index),control);}else this.controlMap.set(lower(model.name),control);}
    const parents=controlParents({controls:models});
    for(const control of this.controls){const parent=adapters.get(parents.get(control.model.id)?.id);(parent?.childHost||this.content).append(control.node);if(control.type==='MSChart')control.invalidate();}
    mountTabPages(this);
    for(const menu of this.originalModel?.menus||this.model.menus||[]){const object={};for(const [key,value]of Object.entries(menu.properties||{})){let state=value;Object.defineProperty(object,key,{enumerable:true,get:()=>state,set:v=>{state=v;menu.properties[key]=v;this.renderMenus();}});}this.controlMap.set(lower(menu.name),object);}
  }
  mountDynamic(model){
    if(this.controls.length>=10000)throw new VBError('Control limit exceeded (10,000)',7);
    const parent=validateRuntimeContainer(this,null,resolveRuntimeParent(this,model));
    const control=createBrowserControl(model,{controlRegistry:this.controlRegistry,design:this.design,vm:this.vm,instance:this.instance,form:this,assets:this.assets,backend:this.backend,onBackend:this.onBackend});
    try{bindTabChild(control,parent,model.properties?.TabPage);}catch(error){control.dispose();throw error;}
    control.dynamic=true;this.controls.push(control);(parent?.childHost||this.content).append(control.node);this.layoutController?.rebuild();this.layoutController?.arrange();control.invalidate();control.updateTimer();return control;
  }
  loadArrayElement(array,template,index){
    if(!Number.isInteger(index)||index<0||index>32767)throw new VBError('Invalid control array index',380);
    if(array.items.has(index))throw new VBError('Object already loaded',360);
    const model=clone(template);model.id=newId();model.properties.Index=index;model.properties.Visible=0;
    const binding=tabPagePlan(this.originalModel||this.model).bindings.get(template.id);
    if(binding){model.properties.Left=binding.left;model.properties.TabPage=binding.page;}
    // Loaded container copies have no children yet. They must not retain the
    // template's raw name-based child ownership records.
    if(model.type==='SSTab'){
      for(const key of Object.keys(model.properties))if(/^Tab\(\d+\)\.Control(?:\(\d+\)|Count|Enabled)$/i.test(key))delete model.properties[key];
      if(Array.isArray(model.properties.Tabs))for(const entry of model.properties.Tabs)delete entry.Controls;
    }
    const control=this.mountDynamic(model);array.items.set(index,control);return control;
  }
  addControl(progId,name,container){
    const type=this.controlRegistry?.has(String(progId))?String(progId):Object.keys(CONTROL_DEFAULTS).find(t=>lower(t)===lower(String(progId).split('.').at(-1)));
    if(!type||type==='OLE')throw new VBError('No browser control adapter for '+progId,429);
    if(!/^[A-Za-z_]\w*$/.test(String(name))||this.controlMap.has(lower(name)))throw new VBError('Control name must be a unique identifier',730);
    let parent=null;if(container){const value=typeof container==='string'?this.controlMap.get(lower(container)):container?.__vbInstance?container.formObject:container;
      if(!value)throw new VBError('Invalid control container',380);
      if(value!==this)parent=validateRuntimeContainer(this,null,value);
    }
    const model=createControl(type,String(name));model.properties={...model.properties,...(this.controlRegistry?.defaults?.(type)||{}),Name:String(name)};
    model.parent=parent?.model.name??null;model.nativeParentId=parent?.model.id??null;model.properties.Visible=0;
    const control=this.mountDynamic(model);this.controlMap.set(lower(name),control);this.instance?.fields.set(lower(name),new Cell('Object',control));return control;
  }
  removeControl(control){
    const order=runtimeRemovalPlan(this,control),remove=new Set(order);
    this.controls=this.controls.filter(c=>!remove.has(c));
    for(const child of order){
      const name=lower(child.model.name),array=this.controlMap.get(name);
      if(array instanceof ControlArray)array.items.delete(Number(child.props.Index));
      else{this.controlMap.delete(name);this.instance?.fields.delete(name);}
      child.dispose();
    }
    this.layoutController?.rebuild();this.layoutController?.arrange();
  }
  activateChrome(){if(this.design)return;if(!this.node.inert)this.node.style.zIndex=String((this.node.getAttribute('aria-modal')==='true'?200000:0)+ ++BrowserForm.frontSequence);for(const node of this.node.parentElement?.querySelectorAll(':scope > .vb-form')||[])node.classList.toggle('vb-inactive',node!==this.node);}
  Show(){this.activateChrome(false);this.shown=true;this.node.hidden=false;this.refresh();if(!this.windowStateApplied){this.windowStateApplied=true;this.WindowState=Number(this.props.WindowState)||0;}for(const c of this.controls)c.updateTimer();this.node.style.zIndex=String(++BrowserForm.frontSequence);this.event('Paint');const first=this.controls.filter(c=>c.TabStop&&acceptsInput(c)&&!NONVISUAL_TYPES.has(c.type)).sort((a,b)=>a.TabIndex-b.TabIndex)[0];(first||this).SetFocus();}
  Hide(){this.shown=false;this.node.hidden=true;this.suspendTimers();const siblings=[...(this.node.parentElement?.querySelectorAll(':scope > .vb-form:not([hidden])')||[])].sort((a,b)=>Number(b.style.zIndex)-Number(a.style.zIndex));siblings.forEach((node,index)=>node.classList.toggle('vb-inactive',index!==0));}
  suspendTimers(){for(const c of this.controls){clearInterval(c.timerId);c.timerId=null;}}
  chromeHeight(){return (this.titleBar.hidden?0:20)+(this.menuBar.hidden?0:19)+(Number(this.props.BorderStyle)===0?0:8);}
  get WindowState(){return this.minimized?1:this.savedBounds?2:0;}
  set WindowState(value){value=Number(value);if(!Number.isInteger(value)||value<0||value>2)throw new VBError('Invalid WindowState',380);if(value===0){if(this.minimized)this.toggleMinimize();if(this.savedBounds)this.toggleMaximize();}else if(value===1){if(!this.minimized)this.toggleMinimize();}else{if(this.minimized)this.toggleMinimize();if(!this.savedBounds)this.toggleMaximize();}}
  get MDIChild(){return Number(this.props.MDIChild)?-1:0;}
  set MDIChild(value){if(!this.design)throw new VBError('MDIChild is read-only at runtime',383);this.props.MDIChild=value;}
  attachWindowDragging(){installFormWindow(this);}
  toggleMinimize(){this.minimized=!this.minimized;this.node.classList.toggle('vb-minimized',this.minimized);this.minButton.replaceChildren(icon(this.minimized?'restore':'minimize'));this.minButton.title=this.minimized?'Restore':'Minimize';this.minButton.setAttribute('aria-label',this.minButton.title);this.props.WindowState=this.WindowState;this.refresh();this.event('Resize');}
  toggleMaximize(){if(this.minimized)this.toggleMinimize();if(this.savedBounds){Object.assign(this.props,this.savedBounds);this.savedBounds=null;}else{this.savedBounds={ClientWidth:this.props.ClientWidth,ClientHeight:this.props.ClientHeight,Left:this.props.Left,Top:this.props.Top};this.props.ClientWidth=Math.max(100,this.node.parentNode.clientWidth-8)*15;this.props.ClientHeight=Math.max(100,this.node.parentNode.clientHeight-this.chromeHeight())*15;this.props.Left=0;this.props.Top=0;}this.refresh();this.maxButton.replaceChildren(icon(this.savedBounds?'restore':'maximize'));this.maxButton.title=this.savedBounds?'Restore':'Maximize';this.maxButton.setAttribute('aria-label',this.maxButton.title);this.props.WindowState=this.WindowState;this.mdiController?.layout();this.event('Resize');}
  ensureSurface(){if(!this.surface){this.surface=new GraphicsSurface(this.content,{backend:this.backend,background:this.props.BackColor,onBackend:this.onBackend});this.surface.setPicture(safeImage(this.props.Picture,this.assets));}return this.surface;}
  dispose(){this.layoutController?.dispose();this.cancelWindowInteraction?.();for(const c of this.controls||[])c.dispose();super.dispose();}
}

export function createBrowserControl(model,options={}){const custom=(options.controlRegistry||options.vm?.host?.controlRegistry)?.create(model,options);if(custom)return custom;return model.type==='Form'||model.type==='MDIForm'?new BrowserForm(model,options):new BrowserControl(model,options);}
