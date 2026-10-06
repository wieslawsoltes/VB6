import {validateLayout} from '../layout/contract.js';
import {normalizeDataSources} from '../data/common.js';
import { clone, lower, safeName } from '../core/core.js';
import {normalizeResources} from './res.js';
import { VBError } from '../language/lexer.js';
export const PROJECT_SCHEMA=1;
let sequence=0;
export const newId=()=>`id_${Date.now().toString(36)}_${(++sequence).toString(36)}`;
export const BASIC_CONTROL_TYPES=['Pointer','PictureBox','Label','TextBox','Frame','CommandButton','CheckBox','OptionButton','ComboBox','ListBox','HScrollBar','VScrollBar','Timer','DriveListBox','DirListBox','FileListBox','Shape','Line','Image','Data','OLE'];
export const EXTENDED_CONTROL_TYPES=['TreeView','ListView','ProgressBar','Slider','StatusBar','Toolbar','TabStrip','SSTab','RichTextBox','MSFlexGrid','MSHFlexGrid','DataGrid','DTPicker','MonthView','UpDown','ImageList','CommonDialog','MSChart','Adodc'];
export const CONTROL_DEFAULTS={
  Label:{Caption:'Label',Width:1440,Height:300,BackStyle:0,Alignment:0},TextBox:{BackColor:-2147483643,Text:'',Width:1800,Height:315,MultiLine:0,ScrollBars:0,MaxLength:0,PasswordChar:'',Locked:0,Alignment:0},CommandButton:{Caption:'Command',Width:1440,Height:420,Default:0,Cancel:0},Frame:{Caption:'Frame',Width:3300,Height:1800},CheckBox:{Caption:'Check',Value:0,Width:1800,Height:300},OptionButton:{Caption:'Option',Value:0,Width:1800,Height:300},ComboBox:{BackColor:-2147483643,Text:'',List:[],Width:2100,Height:315,Style:0,ListIndex:-1},ListBox:{BackColor:-2147483643,List:[],Width:2400,Height:1800,ListIndex:-1,MultiSelect:0,Sorted:0},PictureBox:{Width:2400,Height:1800,BackColor:-2147483633,ScaleMode:3,AutoRedraw:-1,BorderStyle:1},Image:{Width:1440,Height:1440,Stretch:-1},Shape:{Width:1440,Height:900,Shape:0,FillStyle:1,FillColor:16777215,BorderColor:0},Line:{Width:1440,Height:15,BorderColor:0,BorderWidth:1},Timer:{Interval:1000,Enabled:0,Width:420,Height:420},HScrollBar:{Width:2400,Height:255,Min:0,Max:32767,Value:0,SmallChange:1,LargeChange:100},VScrollBar:{Width:255,Height:2400,Min:0,Max:32767,Value:0,SmallChange:1,LargeChange:100},ProgressBar:{Width:2700,Height:315,Min:0,Max:100,Value:30},Slider:{Width:2700,Height:450,Min:0,Max:10,Value:3,TickFrequency:1},TreeView:{BackColor:-2147483643,Width:2700,Height:2100,LineStyle:1},ListView:{BackColor:-2147483643,Width:3600,Height:2100,View:3,FullRowSelect:-1,GridLines:0},StatusBar:{Width:5400,Height:315,SimpleText:'Ready',Style:1},Toolbar:{Width:5400,Height:450},TabStrip:{Width:4500,Height:2400},SSTab:{Width:4500,Height:2400,Tab:0,Tabs:3},RichTextBox:{BackColor:-2147483643,Width:3600,Height:2100,Text:'Rich text',MultiLine:-1,ScrollBars:3},MSFlexGrid:{Width:4200,Height:2100,Rows:5,Cols:3,FixedRows:1,FixedCols:1,Row:1,Col:1},MSHFlexGrid:{Width:4200,Height:2100,Rows:5,Cols:3,FixedRows:1,FixedCols:1,Row:1,Col:1},DataGrid:{Width:4200,Height:2100,Rows:5,Cols:3},DTPicker:{BackColor:-2147483643,Width:2400,Height:330,Value:'2026-10-03',Format:0},MonthView:{BackColor:-2147483643,Width:3300,Height:2700,Value:'2026-10-03'},UpDown:{Width:255,Height:450,Min:0,Max:100,Value:0,Increment:1,Wrap:0,Orientation:0},ImageList:{Width:420,Height:420,ImageWidth:16,ImageHeight:16},CommonDialog:{Width:420,Height:420,Filter:'Text files|*.txt|All files|*.*',FileName:'',DialogTitle:'Open'},MSChart:{BackColor:-2147483643,Width:4200,Height:2550,ChartType:1,RowCount:5,ColumnCount:1},FileListBox:{BackColor:-2147483643,Width:2400,Height:1500,Pattern:'*.*',Path:'/'},DirListBox:{BackColor:-2147483643,Width:2400,Height:1500,Path:'/'},DriveListBox:{BackColor:-2147483643,Width:2400,Height:315,Drive:'C:'},Data:{Width:2400,Height:315,Caption:'Data',DatabaseName:'',Connect:'',RecordSource:'',RecordsetType:2,ReadOnly:0},Adodc:{Width:2400,Height:315,Caption:'Adodc',ConnectionString:'',RecordSource:'',CommandType:1,CursorType:3,LockType:3,ReadOnly:0},OLE:{Width:1800,Height:1200,Caption:'OLE (unsupported)'}
};
export function createControl(type,name=null,left=300,top=300){const id=newId();return {id,name:name||type+'1',type,parent:null,properties:{Name:name||type+'1',Left:left,Top:top,Width:1800,Height:450,Visible:-1,Enabled:-1,TabIndex:0,TabStop:['Label','Frame','Shape','Line','Image','StatusBar','ProgressBar','Timer','ImageList','CommonDialog'].includes(type)?0:-1,FontName:'MS Sans Serif',FontSize:8.25,FontBold:0,FontItalic:0,ForeColor:-2147483640,BackColor:-2147483633,ToolTipText:'',Tag:'',...clone(CONTROL_DEFAULTS[type]||{})}};}
export function createForm(name='Form1',caption=name){return {id:newId(),name,kind:'form',code:`Option Explicit\n\nPrivate Sub Form_Load()\n    \nEnd Sub\n`,form:{id:newId(),name,type:'Form',properties:{Name:name,Caption:caption,ClientWidth:9000,ClientHeight:6000,Width:9120,Height:6450,Left:300,Top:300,StartUpPosition:2,BorderStyle:2,BackColor:-2147483633,ForeColor:-2147483640,FontName:'MS Sans Serif',FontSize:8.25,FontBold:0,FontItalic:0,ScaleMode:1,KeyPreview:0,Visible:-1,Enabled:-1},controls:[],menus:[]}};}
export function newProject(name='Project1'){const form=createForm();return {schema:PROJECT_SCHEMA,id:newId(),name,description:'',startup:form.name,modules:[form],settings:{anchoring:false,snapToGrid:true,gridSize:120,showGrid:true,renderer:'auto',tabWidth:4,requireVariableDeclaration:true},references:[],assets:{},vfs:{files:{},directories:['/']},appSettings:{}};}
function validateForm(form,moduleName){
  if(!form||typeof form!=='object'||Array.isArray(form))throw new VBError('Invalid form model: '+moduleName,1002);
  form.id ||= newId();form.name=moduleName;form.properties ||= {};form.controls ||= [];form.menus ||= [];
  if(!Array.isArray(form.controls)||!Array.isArray(form.menus))throw new VBError('Form controls and menus must be arrays',1002);
  if(form.controls.length>10000||form.menus.length>10000)throw new VBError('Form exceeds 10,000-control or menu limit',7);
  const ids=new Set(),controls=new Map(),menus=new Map(),allNames=new Set();
  const validateNode=node=>{
    if(!node||typeof node.name!=='string'||!/^[A-Za-z_]\w*$/.test(node.name))throw new VBError('Invalid control or menu name: '+node?.name,1002);
    if(typeof node.type!=='string')throw new VBError('Missing control type: '+node.name,1002);
    if(!node.id||ids.has(node.id))node.id=newId();ids.add(node.id);node.properties ||= {};
    if(typeof node.properties!=='object'||Array.isArray(node.properties))throw new VBError('Invalid properties: '+node.name,1002);
    for(const key of ['Left','Top','Width','Height','ClientWidth','ClientHeight'])if(node.properties[key]!==undefined){const n=Number(node.properties[key]);if(!Number.isFinite(n)||Math.abs(n)>300000||/Width|Height/.test(key)&&n<0)throw new VBError('Invalid geometry: '+node.name+'.'+key,380);node.properties[key]=n;}
  };
  validateNode(form);
  for(const c of form.controls){validateNode(c);const key=lower(c.name),items=controls.get(key)||[];
    if(c.properties.Index!==undefined){const index=Number(c.properties.Index);if(!Number.isInteger(index)||index<0||index>32767)throw new VBError('Invalid control array index: '+c.name,380);c.properties.Index=index;}
    if(items.some(item=>item.properties.Index===undefined||c.properties.Index===undefined||item.properties.Index===c.properties.Index||item.type!==c.type))throw new VBError('Duplicate or incompatible control array name/index: '+c.name,1002);
    items.push(c);controls.set(key,items);allNames.add(key);
  }
  for(const m of form.menus){validateNode(m);const key=lower(m.name),items=menus.get(key)||[];if(controls.has(key))throw new VBError('Duplicate menu or control name: '+m.name,1002);if(m.properties.Index!==undefined){const index=Number(m.properties.Index);if(!Number.isInteger(index)||index<0||index>32767)throw new VBError('Invalid menu array index: '+m.name,380);m.properties.Index=index;}if(items.some(item=>item.properties.Index===undefined||m.properties.Index===undefined||item.properties.Index===m.properties.Index))throw new VBError('Duplicate menu or control name/index: '+m.name,1002);items.push(m);menus.set(key,items);allNames.add(key);}
  for(const [nodes,lookup]of [[form.controls,controls],[form.menus,menus]])for(const node of nodes){const seen=new Set([node.id]);let current=node;
    while(current.parent){const key=lower(current.parent);const result=lookup.get(key);if(!result)throw new VBError('Missing parent '+current.parent+' for '+node.name,1002);const parent=Array.isArray(result)?result.find(p=>p.id===current.nativeParentId)||result[0]:result;if(seen.has(parent.id))throw new VBError('Cyclic parent relationship: '+node.name,1002);seen.add(parent.id);current.parent=parent.name;current=parent;}
  }
}
export function normalizeProject(value){
  if(!value||typeof value!=='object'||!Array.isArray(value.modules))throw new VBError('Not a VB6 Studio project',1002);
  if(value.schema!==PROJECT_SCHEMA)throw new VBError('Unsupported project schema: '+value.schema,1002);
  if(!value.modules.length&&!value.nativeProject||value.modules.length>1000)throw new VBError('Project must contain 1–1,000 modules',7);
  const project=clone(value);project.id ||= newId();project.name=project.nativeProject?.document?String(project.name).slice(0,100):safeName(project.name);project.settings={...newProject().settings,...project.settings};project.references ||= [];project.assets ||= {};project.vfs ||= {files:{}};project.appSettings ||= {};
  const names=new Set(),ids=new Set();for(const m of project.modules){
    if(!m||typeof m.name!=='string'||!/^[A-Za-z_]\w*$/.test(m.name))throw new VBError('Invalid module name: '+m?.name,1002);
    if(names.has(lower(m.name)))throw new VBError('Duplicate module: '+m.name,1002);names.add(lower(m.name));
    if(!m.id||ids.has(m.id))m.id=newId();ids.add(m.id);m.kind ||= 'module';if(!['form','module','class'].includes(m.kind))throw new VBError('Unsupported module kind: '+m.kind,1002);
    m.code=String(m.code||'');if(m.code.length>5000000)throw new VBError('Module exceeds 5,000,000-character source limit',7);
    if(m.kind==='form'&&!m.form)throw new VBError('Form module is missing its form model: '+m.name,1002);if(m.form)validateForm(m.form,m.name);
  }
  if(!Number.isInteger(Number(project.settings.tabWidth))||Number(project.settings.tabWidth)<1||Number(project.settings.tabWidth)>32)project.settings.tabWidth=4;else project.settings.tabWidth=Number(project.settings.tabWidth);
  const grid=Number(project.settings.gridSize);project.settings.gridSize=Number.isFinite(grid)?Math.max(15,Math.min(1200,grid)):120;
  project.settings.renderer=project.settings.renderer==='canvas2d'?'canvas2d':'auto';
  if(project.dataSources)project.dataSources=normalizeDataSources(project.dataSources);
  if(project.resources)project.resources=normalizeResources(project.resources);
  project.settings.anchoring=project.settings.anchoring===true;validateLayout(project);
  return project;
}
export function uniqueName(project,base='Form',module=null){const names=new Set(module?module.form.controls.map(c=>lower(c.name)):project.modules.map(m=>lower(m.name)));let n=1;while(names.has(lower(base+n)))n++;return base+n;}
export function findModule(project,idOrName){return project.modules.find(m=>m.id===idOrName||lower(m.name)===lower(idOrName));}
export function projectStats(project){return {modules:project.modules.length,forms:project.modules.filter(m=>m.kind==='form').length,controls:project.modules.reduce((n,m)=>n+(m.form?.controls.length||0),0),lines:project.modules.reduce((n,m)=>n+m.code.split('\n').length,0)};}
