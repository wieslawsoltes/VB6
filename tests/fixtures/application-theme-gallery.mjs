/** Owned deterministic visual/behavior fixture. Does not request native services. */
import {newProject,createControl,BASIC_CONTROL_TYPES,EXTENDED_CONTROL_TYPES} from '../../src/project/model.js';
export function applicationThemeGallery(theme='classic'){
 const project=newProject('ApplicationThemeGallery'),module=project.modules[0],form=module.form;
 project.id='application-theme-gallery';module.id='theme-form-module';form.id='theme-form';
 project.settings={...project.settings,renderer:'canvas2d',showGrid:false,theme};
 Object.assign(form.properties,{Caption:'Application themes — browser controls',StartUpPosition:0,Left:120,Top:120,ClientWidth:17850,ClientHeight:23550,Width:17970,Height:24000});
 const types=[...BASIC_CONTROL_TYPES,...EXTENDED_CONTROL_TYPES].filter(type=>type!=='Pointer');
 for(const [index,type] of types.entries()){
  const x=120+(index%4)*4425,y=450+Math.floor(index/4)*2280,c=createControl(type,type+'1',x,y);
  c.id='theme-control-'+type;
  const label=createControl('Label','lbl'+type,x,y-300);label.id='theme-label-'+type;label.properties.Caption=type;label.properties.FontBold=-1;form.controls.push(label);
  Object.assign(c.properties,{Width:4050,Height:1800,TabIndex:index});
  if(['Label','TextBox','CommandButton','CheckBox','OptionButton','ComboBox','DriveListBox','ProgressBar','StatusBar','Toolbar','DTPicker','Data','Adodc','Slider'].includes(type))c.properties.Height=420;
  if(type==='HScrollBar')c.properties.Height=255;
  if(type==='VScrollBar')c.properties.Width=255;
  if(type==='UpDown')Object.assign(c.properties,{Width:300,Height:600});
  if(['Timer','ImageList','CommonDialog'].includes(type))Object.assign(c.properties,{Width:420,Height:420});
  if(['ComboBox','ListBox','FileListBox','DirListBox'].includes(type))c.properties.List=['Alpha','Beta','Gamma','Delta'];
  if(type==='CommandButton')Object.assign(c.properties,{Caption:'&Apply',Default:-1});
  if(type==='CheckBox'||type==='OptionButton')c.properties.Value=1;
  if(type==='TextBox')Object.assign(c.properties,{Text:'Authored typeface',FontName:'Courier New',FontSize:10});
  if(type==='PictureBox')Object.assign(c.properties,{BackColor:-2147483643});
  if(type==='TreeView')c.properties.Nodes=[{Key:'root',Text:'Palette',Expanded:-1},{Key:'child',Parent:'root',Text:'Control'}];
  form.controls.push(c);
 }
 const rgb=createControl('CommandButton','cmdRGB',13500,21500);rgb.id='authored-rgb';Object.assign(rgb.properties,{Caption:'Authored RGB',Width:3000,BackColor:0x336699,ForeColor:0xffffff});form.controls.push(rgb);
 const menu=(name,parent,caption,extra={})=>({id:'theme-menu-'+name,name,type:'Menu',parent,properties:{Caption:caption,Enabled:-1,Visible:-1,...extra}});
 form.menus=[menu('mnuFile',null,'&File'),menu('mnuAction','mnuFile','&Action'),menu('mnuChecked','mnuFile','&Checked',{Checked:-1}),menu('mnuMore','mnuFile','&More'),menu('mnuNested','mnuMore','&Nested'),menu('mnuDisabled','mnuFile','Disabled',{Enabled:0})];
 module.code='Option Explicit\n\nPrivate Sub CommandButton1_Click()\n    Label1.Caption = "Clicked"\nEnd Sub\n';
 return project;
}
