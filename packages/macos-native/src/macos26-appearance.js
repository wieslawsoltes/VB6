import {MACOS26_PROPERTIES, MACOS26_PROPERTY_DEFAULTS, validateMacOS26Property} from '../../../src/theme/macos26-compat.js';
import {MacOSCompileError} from './target.js';

/** Appearance capabilities of the actual AppKit host. This is separate from the
 * browser contract: retaining a scalar in ControlSpec is not an implementation. */
const canonical = new Map(MACOS26_PROPERTIES.map(name => [name.toLowerCase(), name]));
const sized = new Set(['CommandButton','Label','TextBox','CheckBox','OptionButton','ComboBox','DriveListBox','ListBox','FileListBox','DirListBox','TreeView','ListView','MSFlexGrid','MSHFlexGrid','DataGrid','HScrollBar','VScrollBar','Slider','UpDown','ProgressBar','DTPicker','MonthView','TabStrip','SSTab','Toolbar','StatusBar']);
const backgrounds = new Set(['Form','MDIForm','Label','TextBox','RichTextBox','ComboBox','DriveListBox','Frame','PictureBox','Image','ListBox','FileListBox','DirListBox','TreeView','ListView','MSFlexGrid','MSHFlexGrid','DataGrid','Toolbar','StatusBar','MSChart','CommandButton']);
const foregrounds = new Set(['Form','MDIForm','CommandButton','CheckBox','OptionButton','Label','TextBox','RichTextBox','ComboBox','DriveListBox','Frame','PictureBox','ListBox','FileListBox','DirListBox','TreeView','ListView','MSFlexGrid','MSHFlexGrid','DataGrid','Toolbar','StatusBar','MSChart']);
const nonvisual = new Set(['Timer','ImageList','CommonDialog','Menu','Data','Adodc']);
const plainBackground = new Set(['automatic','push','default','destructive']);
const nativeMaterials = new Set(['Form','MDIForm','PictureBox','Frame','Toolbar','StatusBar','ListBox','TreeView','ListView']);
const own = (value, key) => Object.hasOwn(value, key);

function propertiesOf(properties, source, control) {
  const result = {}, seen = new Set();
  for (const [name,value] of Object.entries(properties || {})) {
    const key = name.toLowerCase(), authored = canonical.get(key);
    if (key.startsWith('macos') && !authored)
      throw new MacOSCompileError('Unsupported native appearance property ' + control + '.' + name, source, 1, 'MAC260');
    if (authored) {
      if (seen.has(authored)) throw new MacOSCompileError('Duplicate native appearance property ' + control + '.' + authored, source, 1, 'MAC260');
      seen.add(authored); result[authored] = value;
    }
    if (key === 'multiline') result.MultiLine = value;
    if (key === 'passwordchar') result.PasswordChar = value;
    if (key === 'value') result.Value = value;
  }
  return result;
}

export function macOSAppearanceReport(project, options) {
  const controls = [], diagnostics = [];
  const minimum = Number(String(options.minimumVersion).split('.')[0]);
  for (const module of project.modules) if (module.form) {
    for (const control of [module.form, ...(module.form.controls || []), ...(module.form.menus || []).map(menu => ({...menu,type:'Menu'}))]) {
      const type = control.type || 'Form', name = control.name || module.name;
      const properties = propertiesOf(control.properties, module.name, name), active = [];
      const fail = (key,message,code='MAC261') => {
        const error = new MacOSCompileError(name + '.' + key + ': ' + message, module.name, 1, code);
        error.diagnostics[0].control = name; error.diagnostics[0].property = key; throw error;
      };
      for (const key of MACOS26_PROPERTIES) if (own(properties,key) && properties[key] !== undefined) {
        const value = properties[key];
        try { validateMacOS26Property(key,value,type,properties); }
        catch (error) { fail(key,error.message,'MAC260'); }
        if (value === MACOS26_PROPERTY_DEFAULTS[key]) continue;
        if (nonvisual.has(type)) fail(key,type + ' does not expose native appearance controls.');
        if (key === 'MacOSControlSize') {
          if (!sized.has(type) || type === 'TextBox' && Number(properties.MultiLine))
            fail(key,'This native view does not support a non-default control size.');
          if (value === 'extraLarge' && minimum < 26)
            fail(key,'extraLarge requires a minimum macOS version of 26.0 or later.','MAC262');
        }
        if (key === 'MacOSBackgroundRole' && (!backgrounds.has(type) || type === 'CommandButton' && !plainBackground.has(properties.MacOSControlStyle || 'automatic')))
          fail(key,'The selected native widget/style has no independently colorable background.');
        if (key === 'MacOSForegroundRole' && !foregrounds.has(type))
          fail(key,'The selected native widget/style has no independently colorable foreground.');
        if (key === 'MacOSMaterial' && !nativeMaterials.has(type))
          fail(key,'The native view cannot expose a material background while preserving its current navigation.');
        active.push(key);
      }
      if (properties.MacOSControlStyle === 'switch' && ![0,1].includes(Number(properties.Value ?? 0)))
        fail('MacOSControlStyle','A native switch requires the binary CheckBox Value 0 or 1; mixed and fractional values are not supported.','MAC263');
      if (!active.length) continue;
      const material = properties.MacOSMaterial || 'none';
      const entry = {source:module.name,control:name,type,properties:active,minimumVersion:properties.MacOSControlSize === 'extraLarge' ? '26.0' : '11.0'};
      if (material !== 'none') {
        entry.material = {role:material,macOS26:material === 'content' ? 'NSVisualEffectView' : 'NSGlassEffectView',earlier:'NSVisualEffectView',sdk26Required:material !== 'content',olderSDK:'NSVisualEffectView',structure:'existing-control-container'};
        if (material !== 'content' && minimum < 26) diagnostics.push({severity:'warning',code:'MAC264',source:module.name,line:1,control:name,property:'MacOSMaterial',message:name + ': ' + material + ' uses native Liquid Glass on macOS 26 when built with SDK 26 or later; macOS 11–25 uses the corresponding NSVisualEffectView material.'});
      }
      if (properties.MacOSControlStyle === 'switch') {entry.widget = 'NSSwitch';entry.caption = 'adjacent native label';}
      if (properties.MacOSControlStyle === 'search') entry.widget = 'NSSearchField';
      controls.push(entry);
    }
  }
  return {contract:'macos-tahoe-26',controls,diagnostics};
}
