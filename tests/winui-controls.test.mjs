import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {THEMES} from '../src/theme/theme.js';
import {WINUI_RESOURCES,xamlColorToCss} from '../src/theme/winui-resources.js';
import {winui3Resource,WINUI3_REFERENCE} from '../src/theme/winui3-resources.js';
import {WINUI_TOKEN_NAMES,WINUI_ALIASES,winuiThemeTokens} from '../tools/winui-theme-css.mjs';

const tokens=theme=>Object.fromEntries([...winuiThemeTokens(theme).matchAll(/--winui-([\w-]+): ([^;]+);/g)].map(([,key,value])=>[key,value]));
const rgbaHex=value=>value.length===7?value+'ff':value;
const nativeColor=(key,scheme)=>{
 const {type,value}=winui3Resource(key,scheme);
 if(type==='Color')return xamlColorToCss(value);
 assert.equal(type,'SolidColorBrush',key);
 assert.equal(value.opacity,1,key+' brush opacity');
 return xamlColorToCss(value.color);
};

// Compare control contracts to the independently extracted pinned XAML catalog,
// not merely to another copy of the CSS constants. Differences such as the
// disabled TreeView background and pressed switch stroke are native semantics.
const brushContracts={
 RangeTrack:'SliderTrackFill', RangeTrackDisabled:'SliderTrackFillDisabled', RangeThumbBorder:'SliderOuterThumbBackground',
 ProgressTrack:'ProgressBarBackground', ProgressPaused:'ProgressBarPausedForegroundColor', ProgressError:'ProgressBarErrorForegroundColor',
 SwitchOffBackground:'ToggleSwitchFillOff', SwitchOffBackgroundPointerOver:'ToggleSwitchFillOffPointerOver',
 SwitchOffBackgroundPressed:'ToggleSwitchFillOffPressed', SwitchOffBackgroundDisabled:'ToggleSwitchFillOffDisabled',
 SwitchOffBorder:'ToggleSwitchStrokeOffPressed', SwitchOffBorderDisabled:'ToggleSwitchStrokeOffDisabled',
 SwitchOffKnob:'ToggleSwitchKnobFillOff', SwitchOffKnobDisabled:'ToggleSwitchKnobFillOffDisabled',
 SwitchOnKnob:'ToggleSwitchKnobFillOnPressed', SwitchOnKnobDisabled:'ToggleSwitchKnobFillOnDisabled',
 ComboBackground:'ComboBoxBackgroundFocused', ComboBackgroundPointerOver:'ComboBoxBackgroundPointerOver',
 ComboBackgroundPressed:'ComboBoxBackgroundPressed', ComboBackgroundDisabled:'ComboBoxBackgroundDisabled',
 ComboForeground:'ComboBoxForeground', ComboForegroundPressed:'ComboBoxForegroundPressed', ComboForegroundDisabled:'ComboBoxForegroundDisabled',
 ComboGlyph:'ComboBoxDropDownGlyphForeground', ComboGlyphDisabled:'ComboBoxDropDownGlyphForegroundDisabled',
 ItemBackground:'ListViewItemBackground', ItemBackgroundPointerOver:'ListViewItemBackgroundPointerOver',
 ItemBackgroundPressed:'ListViewItemBackgroundPressed', SelectionBackground:'ListViewItemBackgroundSelected',
 ItemBackgroundSelectedPointerOver:'ListViewItemBackgroundSelectedPointerOver', ItemBackgroundSelectedPressed:'ListViewItemBackgroundSelectedPressed',
 TreeBackgroundSelectedDisabled:'TreeViewItemBackgroundSelectedDisabled', ItemForegroundDisabled:'TreeViewItemForegroundSelectedDisabled',
 TabBackground:'TabViewItemHeaderBackground', TabBackgroundSelected:'TabViewItemHeaderBackgroundSelected',
 TabBackgroundPointerOver:'TabViewItemHeaderBackgroundPointerOver', TabBackgroundPressed:'TabViewItemHeaderBackgroundPressed',
 TabForeground:'TabViewItemHeaderForeground', TabForegroundSelected:'TabViewItemHeaderForegroundSelected',
 TabForegroundPressed:'TabViewItemHeaderForegroundPressed', TabForegroundDisabled:'TabViewItemHeaderForegroundDisabled',
 MenuShortcutForeground:'MenuFlyoutItemKeyboardAcceleratorTextForeground', MenuSeparator:'MenuFlyoutSeparatorBackground'
};
for(const scheme of ['light','dark'])test(`composite ${scheme} brushes match their native control dictionaries`,()=>{
 for(const [css,native] of Object.entries(brushContracts)) {
  assert.ok(Object.hasOwn(WINUI_ALIASES,css),css);
  assert.equal(rgbaHex(WINUI_RESOURCES[scheme][WINUI_ALIASES[css]]),rgbaHex(nativeColor(native,scheme)),`${css} = ${native}`);
 }
});

test('TextBox disabled text keeps the source-specific low color bits in both schemes',()=>{
 for(const [id,scheme,expected] of [['fluent','light','#0101015c'],['fluent-dark','dark','#fefefe5d']]) {
  const value=tokens(THEMES[id]).TextControlForegroundDisabled;
  assert.equal(value,expected);assert.equal(value,nativeColor('TextControlForegroundDisabled',scheme));
  assert.notEqual(value,WINUI_RESOURCES[scheme].TextFillColorDisabled,'Control override is distinct from common disabled text');
 }
});

test('native progress and slider metrics fit within unchanged authored control slots',()=>{
 const values=tokens(THEMES.fluent);
 for(const [css,native] of Object.entries({ProgressTrackHeight:'ProgressBarTrackHeight',ProgressFillHeight:'ProgressBarMinHeight',RangeTrackHeight:'SliderTrackThemeHeight'}))
  assert.equal(parseFloat(values[css]),winui3Resource(native).value,`${css} = ${native}`);
 for(const [css,native] of Object.entries({ProgressRadius:'ProgressBarCornerRadius',ProgressTrackRadius:'ProgressBarTrackCornerRadius',RangeThumbRadius:'SliderThumbCornerRadius',ComboItemRadius:'ComboBoxItemCornerRadius'})) {
  const radius=winui3Resource(native).value;assert.ok(radius.every(v=>v===radius[0]),native+' uniform corners');
  assert.equal(parseFloat(values[css]),radius[0]);
 }
 assert.equal(parseFloat(values.RangeThumbSize),winui3Resource('SliderHorizontalThumbWidth').value+4,'18-DIP Thumb plus two -2-DIP Border margins');
 assert.equal(parseFloat(values.RangeThumbSize),winui3Resource('SliderVerticalThumbHeight').value+4);
 const inner=winui3Resource('SliderInnerThumbWidth').value,outer=parseFloat(values.RangeThumbSize);
 for(const [css,scale] of [['RangeThumbRingRest',.86],['RangeThumbRingPointerOver',1.167],['RangeThumbRingPressed',.71],['RangeThumbRingDisabled',1.167]])
  assert.ok(Math.abs(outer-parseFloat(values[css])*2-inner*scale)<1e-9,`${css}: native ellipse state scale`);
 assert.equal(parseFloat(values.ProgressFillHeight),3);
 assert.equal(parseFloat(values.ProgressTrackHeight),1);
 assert.equal(WINUI3_REFERENCE.nativePixelParityCertified,false);
});

test('Switch states fit the 40-DIP native rail, including pressed width and RTL travel',()=>{
 const value=tokens(THEMES.fluent),read=key=>parseFloat(value[key]);
 assert.equal(read('SwitchWidth'),40);assert.equal(read('SwitchHeight'),20);assert.equal(read('SwitchTravel'),20);
 for(const [width,height,inset] of [['SwitchKnobSize','SwitchKnobSize','SwitchKnobInset'],['SwitchKnobHoverSize','SwitchKnobHoverSize','SwitchKnobHoverInset'],['SwitchKnobPressedWidth','SwitchKnobPressedHeight','SwitchKnobPressedInset']]) {
  assert.ok(read(height)<read('SwitchHeight'));
  assert.ok(read(width)+2*read(inset)<=read('SwitchWidth'));
 }
 assert.equal(read('SwitchKnobSize'),12);assert.equal(read('SwitchKnobHoverSize'),14);
 assert.equal(read('SwitchKnobPressedWidth'),17);assert.equal(read('SwitchKnobPressedHeight'),14);
 assert.equal(read('SwitchMixedTravel'),read('SwitchTravel')/2);
});

test('all composite state and geometry resources reset at every independent family boundary',()=>{
 const used=new Set([...Object.keys(brushContracts),...WINUI_TOKEN_NAMES.filter(name=>/^(Switch|Combo|Range|Progress|Tab|Tree|Item|Menu|Selection)/.test(name))]);
 for(const theme of Object.values(THEMES)) {
  const value=tokens(theme);
  for(const name of used) {
   assert.ok(Object.hasOwn(value,name),theme.id+': '+name);
   assert.equal(value[name]==='initial',theme.family!=='fluent',theme.id+': '+name);
  }
 }
 const css=fs.readFileSync(new URL('../src/theme/winui-controls.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/data-vb-theme-family|data-ide-theme|@font-face|@import|https?:/);
 const local=new Set([...css.matchAll(/--winui-([\w-]+)\s*:/g)].map(([,key])=>key));
 for(const [,key] of css.matchAll(/var\(--winui-([\w-]+)/g))assert.ok(WINUI_TOKEN_NAMES.includes(key)||local.has(key),'Unbound control paint '+key);
});
