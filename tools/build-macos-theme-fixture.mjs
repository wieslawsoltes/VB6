/** Browser counterparts use the actual public runtime and authored VB controls.
 * The fixture only supplies content/geometry. It contains no substitute skins,
 * capture-only control CSS, copied native pixels, or glyph/antialias masks.
 */
import fs from 'node:fs';
import {newProject,createControl} from '../src/project/model.js';
import {exportApplication} from '../src/exporter/exporter.js';
const root=new URL('../reports/macos-theme-browser/',import.meta.url);
fs.mkdirSync(root,{recursive:true});
const project=newProject('MacOSReference');
project.id='macos-reference';project.settings={...project.settings,theme:'macos26',renderer:'canvas2d',themeOptions:{reduceMotion:true}};
const module=project.modules[0];module.id='reference-module';module.code='Option Explicit\n';
const form=module.form;form.id='reference-form';
Object.assign(form.properties,{Caption:'VB6 — macOS 26 native reference',ClientWidth:14700,ClientHeight:12600,Width:14700,Height:12600,Left:0,Top:0,StartUpPosition:0,BorderStyle:0,FontName:'-apple-system',FontSize:9.75});
form.controls=[];form.menus=[];
const specimens=[];
function add(name,type,properties={},height=28){
 const index=specimens.length,x=20+index%3*320,y=34+Math.floor(index/3)*116;
 const label=createControl('Label','label'+index,x*15,(y-22)*15);label.id='reference-label-'+index;
 Object.assign(label.properties,{Caption:name,Width:4200,Height:270,FontName:'-apple-system',FontSize:8.25,ForeColor:-2147483630,TabStop:0});
 const control=createControl(type,'specimen'+index,x*15,y*15);control.id='reference-control-'+index;
 Object.assign(control.properties,{Width:4200,Height:height*15,FontName:'-apple-system',FontSize:9.75,TabIndex:index,...properties});
 form.controls.push(label,control);specimens.push({name,type,control:control.name,frame:{x,y,width:280,height}});
}
add('default-button','CommandButton',{Caption:'Apply',Default:-1});
add('secondary-button','CommandButton',{Caption:'Cancel'});
add('disabled-button','CommandButton',{Caption:'Unavailable',Enabled:0});
add('check-off','CheckBox',{Caption:'Check box',Value:0});
add('check-on','CheckBox',{Caption:'Check box',Value:1});
add('check-mixed','CheckBox',{Caption:'Check box',Value:2});
add('radio-on','OptionButton',{Caption:'Option button',Value:-1});
add('text-field','TextBox',{Text:'Editable text'});
add('combo-box','ComboBox',{List:['Alpha','Beta','Gamma'],ListIndex:0});
add('popup-button','ComboBox',{List:['Alpha','Beta','Gamma'],ListIndex:0,Style:2});
add('segmented-control','TabStrip',{Tabs:[{Caption:'First'},{Caption:'Second'},{Caption:'Third'}],TabHeight:360});
add('slider','Slider',{Min:0,Max:100,Value:50});
add('progress','ProgressBar',{Min:0,Max:100,Value:50});
add('date-picker','DTPicker',{Value:'2026-01-01'});
// VB6 has no NSSearchField intrinsic: a real TextBox is reported as an adapter
// gap, not secretly replaced with capture-only search-field artwork.
add('search-field','TextBox',{Text:''});
add('group-box','Frame',{Caption:'Group'},80);
add('rich-text','RichTextBox',{Text:'Styled text\nA second line\nA third line'},80);
add('table-view','ListView',{Columns:[{Key:'name',Text:'Name',Width:2010},{Key:'state',Text:'State',Width:2010}],Items:[{Key:'palette',Text:'Palette',SubItems:['Ready']},{Key:'control',Text:'Control',SubItems:['Selected']},{Key:'window',Text:'Window',SubItems:['Active']}]},80);
add('tab-view','SSTab',{Tabs:[{Caption:'First'},{Caption:'Second'}],TabHeight:360},80);
add('separator','Line',{BorderColor:-2147483632},1);
add('stepper','UpDown',{Min:0,Max:10,Value:5});
fs.writeFileSync(new URL('fixture.html',root),exportApplication(project,{persist:false}));
fs.writeFileSync(new URL('fixture.json',root),JSON.stringify({schema:1,width:980,height:840,specimens,adaptationGaps:['search-field: VB6 TextBox does not expose NSSearchField affordances','date-picker: HTML date entry follows browser locale and native picker','window: browser frame keeps authored VB6 non-client compatibility geometry']},null,2)+'\n');
