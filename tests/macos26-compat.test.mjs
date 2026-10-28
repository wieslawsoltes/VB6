import test from 'node:test';
import assert from 'node:assert/strict';
import {MACOS26_COLOR_ROLES,MACOS26_RESOURCES,MACOS26_REFERENCE,macos26ColorFallback,macos26Resource} from '../src/theme/macos26-resources.js';
import {MACOS26_CONTROL_SIZES,MACOS26_PROPERTIES,macos26PropertyChoices,validateMacOS26Properties,validateMacOS26ToolbarButtons,clearMacOS26ColorRoles,macos26ControlAttributes} from '../src/theme/macos26-compat.js';
import {newProject,createControl,normalizeProject} from '../src/project/model.js';
import {designerPropertyValues,editDesignerProperties} from '../src/designer/property-model.js';
import {ApplicationThemeController,copyApplicationTheme} from '../src/theme/application-appearance.js';
import {IdeThemeController} from '../src/theme/ide-appearance.js';
import {THEME_MEDIA_QUERIES} from '../src/theme/environment.js';

test('Tahoe resources preserve distinct accent and selection roles and immutable provenance',()=>{
  assert.equal(MACOS26_REFERENCE.release,26);assert.equal(MACOS26_REFERENCE.design,'WWDC25');
  assert.equal(MACOS26_REFERENCE.figmaAssetsImported,false);
  assert.equal(MACOS26_REFERENCE.nativePixelParityCertified,false);
  for(const scheme of ['light','dark']) {
    assert.deepEqual(Object.keys(MACOS26_RESOURCES[scheme]),Object.keys(MACOS26_COLOR_ROLES));
    assert.notEqual(macos26Resource('controlAccentColor',scheme),macos26Resource('selectedContentBackgroundColor',scheme));
    for(const key of Object.keys(MACOS26_COLOR_ROLES)) {
      assert.equal(Number.isInteger(macos26ColorFallback(key)),true);
      assert.match(macos26Resource(key,scheme),/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i);
      assert.ok(Object.isFrozen(MACOS26_COLOR_ROLES[key]));
    }
    assert.ok(Object.isFrozen(MACOS26_RESOURCES[scheme]));
  }
  for(const key of ['__proto__','constructor','unknown','labelColor; url(x)'])assert.throws(()=>macos26ColorFallback(key),TypeError);
  assert.throws(()=>macos26Resource('labelColor','auto'),TypeError);
});

for(const size of MACOS26_CONTROL_SIZES)test('control size '+size+' leaves authored geometry untouched',()=>{
  const p={Left:17,Top:31,Width:93,Height:55,FontName:'Custom Font',FontSize:17,MacOSControlSize:size};
  const before=structuredClone(p);validateMacOS26Properties(p,'CommandButton');assert.deepEqual(p,before);
  assert.equal(macos26ControlAttributes(p)['data-macos-control-size'],size);
});

for(const [type,p] of [
  ['Label',{MacOSControlStyle:'default'}],['CommandButton',{MacOSControlStyle:'switch'}],
  ['CommandButton',{MacOSControlStyle:'segmented'}],['TextBox',{MacOSControlStyle:'segmented'}],
  ['SSTab',{MacOSControlStyle:'segmented',TabOrientation:2}],['TabStrip',{MacOSControlStyle:'segmented',TabOrientation:3}],
  ['CheckBox',{MacOSControlStyle:'switch',Value:2}],['CheckBox',{MacOSControlStyle:'switch',Value:0.5}],
  ['TextBox',{MacOSControlStyle:'search',MultiLine:-1}],['TextBox',{MacOSControlStyle:'search',PasswordChar:'*'}],
  ['Slider',{MacOSMaterial:'sidebar'}],['Label',{MacOSIndeterminate:-1}],
  ['ProgressBar',{MacOSIndeterminate:true}],['ProgressBar',{MacOSIndeterminate:1}],
  ['Label',{PlaceholderText:'placeholder'}],['TextBox',{MacOSControlSize:'medium'}],
  ['TextBox',{MacOSForegroundRole:'__proto__'}],['TextBox',{MacOSAccessibilityHelp:'a\0b'}],
  ['TextBox',{MacOSAccessibilityIdentifier:'x'.repeat(1025)}],['TextBox',{PlaceholderText:42}]
])test('reject incompatible or malformed appearance '+type+' '+JSON.stringify(p).slice(0,100),()=>{
  assert.throws(()=>validateMacOS26Properties(p,type),TypeError);
});

for (const type of ['Toolbar','TabStrip','SSTab']) test(type+' offers segmented authoring without modifying geometry',()=>{
  const project=newProject(),form=project.modules[0].form,control=createControl(type,'Navigation');
  form.controls.push(control);
  const before=structuredClone(control),values=designerPropertyValues(control,form,null,{macos26:true});
  assert.equal(values.MacOSControlStyle,'automatic');
  assert.deepEqual(macos26PropertyChoices('MacOSControlStyle',type),['automatic','segmented']);
  const next=editDesignerProperties(form,[control.id],{MacOSControlStyle:'segmented'});
  assert.equal(next.controls[0].properties.MacOSControlStyle,'segmented');
  for(const key of ['Left','Top','Width','Height','FontName','FontSize']) assert.equal(next.controls[0].properties[key],control.properties[key]);
  assert.deepEqual(control,before);
});

for (const style of [0,1,2]) test('segmented Toolbar tracking mode '+style+' preserves portable records',()=>{
  const buttons=[{Key:'first',Caption:'First',Style:style,Value:style===0?0:1},
    {Key:'second',Caption:'Second',Style:style,Value:style===1?1:0,Visible:0,Enabled:0}];
  const before=structuredClone(buttons),properties={MacOSControlStyle:'segmented',Buttons:buttons};
  assert.equal(validateMacOS26ToolbarButtons(buttons),buttons);
  assert.equal(validateMacOS26Properties(properties,'Toolbar'),properties);
  assert.deepEqual(buttons,before);
  const project=newProject(),control=createControl('Toolbar','Modes');
  Object.assign(control.properties,properties);project.modules[0].form.controls.push(control);
  assert.deepEqual(normalizeProject(project).modules[0].form.controls[0].properties.Buttons,buttons);
});

for(const buttons of [null,{},'buttons',[null],[[]],[{Style:3}],[{Style:4}],[{Style:5}],
  [{Style:1.5}],[{Style:NaN}],[{Style:0},{Style:1}],[{Style:1,Value:-1}],
  [{Style:2,Value:0.5}],[{Style:0,Value:1}],
  [{Style:2,Value:1},{Style:2,Value:1,Visible:0}],new Array(32768).fill({Style:0})
])test('segmented Toolbar rejects unrepresentable collection '+JSON.stringify(buttons).slice(0,90),()=>{
  const before=structuredClone(buttons);
  assert.throws(()=>validateMacOS26Properties({MacOSControlStyle:'segmented',Buttons:buttons},'Toolbar'),TypeError);
  assert.deepEqual(buttons,before);
});

test('segmented validation permits incremental empty toolbars and leaves ordinary legacy styles available',()=>{
  assert.deepEqual(validateMacOS26ToolbarButtons(),[]);
  const properties={MacOSControlStyle:'automatic',Buttons:[{Style:3},{Style:5}]};
  assert.equal(validateMacOS26Properties(properties,'Toolbar'),properties);
  assert.throws(()=>validateMacOS26Properties({...properties,MacOSControlStyle:'segmented'},'Toolbar'),/Style/);
});

test('explicit OLE/RGB edits clear bindings even at the same numeric value',()=>{
  const p={BackColor:-2147483633,ForeColor:-2147483630,MacOSBackgroundRole:'windowBackgroundColor',MacOSForegroundRole:'labelColor'};
  clearMacOS26ColorRoles(p,{BackColor:p.BackColor});assert.equal(p.MacOSBackgroundRole,undefined);assert.equal(p.MacOSForegroundRole,'labelColor');
  clearMacOS26ColorRoles(p,{ForeColor:0});assert.equal(p.MacOSForegroundRole,undefined);
  p.MacOSForegroundRole='secondaryLabelColor';clearMacOS26ColorRoles(p,{ForeColor:0,MacOSForegroundRole:'secondaryLabelColor'});
  assert.equal(p.MacOSForegroundRole,'secondaryLabelColor');
});

test('designer provides macOS property editors without changing unselected controls or default projects',()=>{
  const form=newProject().modules[0].form,c=createControl('TextBox','Search'),other=createControl('TextBox','Other');form.controls.push(c,other);
  assert.ok(!Object.hasOwn(designerPropertyValues(c,form),'MacOSControlSize'));
  const values=designerPropertyValues(c,form,null,{macos26:true});assert.equal(values.MacOSControlSize,'regular');assert.equal(values.PlaceholderText,'');
  assert.ok(!Object.hasOwn(c.properties,'MacOSControlSize'));
  const next=editDesignerProperties(form,[c.id],{MacOSControlStyle:'search',PlaceholderText:'Search controls',MacOSAccessibilityLabel:'Control search'});
  assert.equal(next.controls[0].properties.MacOSControlStyle,'search');assert.deepEqual(next.controls[1],other);
  assert.equal(c.properties.MacOSControlStyle,undefined);
  const saved=structuredClone(next);assert.throws(()=>editDesignerProperties(next,[c.id,other.id],{MacOSControlStyle:'switch'}));assert.deepEqual(next,saved);
});

test('project validation preserves scalar metadata and refuses invalid requests without mutating source',()=>{
  const project=newProject(),c=createControl('CommandButton','Save');project.modules[0].form.controls.push(c);
  Object.assign(c.properties,{MacOSControlSize:'large',MacOSControlStyle:'default',MacOSForegroundRole:'labelColor'});
  const copy=normalizeProject(project);assert.deepEqual(copy.modules[0].form.controls[0].properties,c.properties);
  c.properties.MacOSControlStyle='search';const before=structuredClone(project);
  assert.throws(()=>normalizeProject(project),/Save.*MacOSControlStyle/);assert.deepEqual(project,before);
});

class Media extends EventTarget {
  matches=false;listeners=0;
  addEventListener(...args){if(args[0]==='change')this.listeners++;super.addEventListener(...args);}
  removeEventListener(...args){if(args[0]==='change')this.listeners--;super.removeEventListener(...args);}
  set(value){this.matches=value;this.dispatchEvent(new Event('change'));}
}
class Root extends EventTarget {
  constructor(document){super();this.ownerDocument=document;this.attributes=new Map();}
  getAttribute(k){return this.attributes.get(k)??null;}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  removeAttribute(k){this.attributes.delete(k);}
}
function environment(){
  const media=Object.fromEntries(Object.keys(THEME_MEDIA_QUERIES).map(key=>[key,new Media()]));
  const view=new EventTarget();view.CustomEvent=CustomEvent;
  view.matchMedia=query=>media[Object.keys(THEME_MEDIA_QUERIES).find(key=>THEME_MEDIA_QUERIES[key]===query)];
  const document={defaultView:view};document.documentElement=new Root(document);
  return {document,media,root:()=>new Root(document)};
}

test('shared live media preferences reach independent IDE/application roots without persisting OS state',()=>{
  const {document,media,root}=environment(),app=root(),portal=root(),ide=new IdeThemeController(document),controller=new ApplicationThemeController(app);
  ide.apply({theme:'macos26',followSystemTheme:true});controller.apply({theme:'macos26-dark'});
  for(const m of Object.values(media))assert.equal(m.listeners,1,'one native subscription per window/query');
  media.dark.set(true);assert.equal(document.documentElement.getAttribute('data-ide-theme'),'macos26-dark');assert.equal(app.getAttribute('data-vb-theme'),'macos26-dark');
  media.reducedTransparency.set(true);media.moreContrast.set(true);media.reducedMotion.set(true);
  assert.equal(app.getAttribute('data-vb-reduce-transparency'),'true');assert.equal(app.getAttribute('data-vb-increase-contrast'),'true');
  assert.equal(document.documentElement.getAttribute('data-ide-increase-contrast'),'true');
  assert.equal(controller.appearance.themeOptions.reduceTransparency,false);assert.equal(ide.appearance.reduceTransparency,false);
  copyApplicationTheme(app,portal);assert.equal(portal.getAttribute('data-vb-increase-contrast'),'true');
  controller.dispose();for(const m of Object.values(media))assert.equal(m.listeners,1);
  ide.dispose();for(const m of Object.values(media))assert.equal(m.listeners,0);
});

test('explicit increased contrast persists but never crosses independent application roots',()=>{
  const {root}=environment(),a=root(),b=root(),left=new ApplicationThemeController(a),right=new ApplicationThemeController(b);
  left.apply({theme:'macos26',themeOptions:{increaseContrast:true}});right.apply({theme:'macos26'});
  assert.equal(a.getAttribute('data-vb-increase-contrast'),'true');assert.equal(b.getAttribute('data-vb-increase-contrast'),'false');
  assert.equal(left.appearance.themeOptions.increaseContrast,true);
  left.dispose();right.dispose();
});
