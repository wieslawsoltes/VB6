/** Serializable WinUI presentation values. The form model remains authoritative;
 * this bounded contract adds paint and theme branches without a second UI tree. */
export const WINUI3_THEMES = Object.freeze(['Default','Light','Dark','HighContrast']);
export const WINUI3_PROPERTY_NAMES = Object.freeze([
  'Background','Foreground','BorderBrush','BorderThickness','Padding','CornerRadius',
  'FontWeight','Opacity','TextWrapping','TextTrimming','HorizontalContentAlignment',
  'VerticalContentAlignment','IsIndeterminate','Header','OnContent','OffContent',
  'FontFamily','FontSize','BackgroundSizing','UseSystemFocusVisuals','FocusVisualMargin'
]);
const propertyNames = new Set(WINUI3_PROPERTY_NAMES);
const themes = new Set(WINUI3_THEMES);
const brushes = new Set(['Background','Foreground','BorderBrush']);
const thicknesses = new Set(['BorderThickness','Padding','CornerRadius','FocusVisualMargin']);
const enums = Object.freeze({
  TextWrapping:['NoWrap','Wrap','WrapWholeWords'],
  TextTrimming:['None','CharacterEllipsis','Clip'],
  BackgroundSizing:['InnerBorderEdge','OuterBorderEdge'],
  HorizontalContentAlignment:['Left','Center','Right','Stretch'],
  VerticalContentAlignment:['Top','Center','Bottom','Stretch']
});
const sources = Object.freeze({
  Page:['Form'],Window:['Form','MDIForm'],UserControl:['Form','PictureBox'],
  Canvas:['PictureBox'],Grid:['PictureBox'],StackPanel:['PictureBox'],Border:['PictureBox'],
  Button:['CommandButton'],HyperlinkButton:['CommandButton'],
  ToggleButton:['CheckBox'],ToggleSwitch:['CheckBox'],CheckBox:['CheckBox'],RadioButton:['OptionButton'],
  TextBlock:['Label'],TextBox:['TextBox'],PasswordBox:['TextBox'],RichEditBox:['RichTextBox'],
  ComboBox:['ComboBox'],ListBox:['ListBox'],ListView:['ListView'],TreeView:['TreeView'],
  ProgressBar:['ProgressBar'],Slider:['Slider'],ScrollBar:['HScrollBar','VScrollBar'],
  Image:['Image'],Rectangle:['Shape'],Ellipse:['Shape'],Line:['Line'],
  TabView:['SSTab','TabStrip'],NumberBox:['UpDown','TextBox']
});
const styles = new Set(['DefaultButtonStyle','AccentButtonStyle','SubtleButtonStyle','ButtonRevealStyle',
  'DefaultHyperlinkButtonStyle','DefaultToggleButtonStyle']);
const own = (object,key) => Object.hasOwn(object,key);
const fail = message => {throw new TypeError(message);};
function record(value,label) {
  if(!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype,null].includes(Object.getPrototypeOf(value))) fail(label+' must be a plain data object.');
  return value;
}
function text(value,label,limit=512) {
  if(typeof value !== 'string' || !value.length || value.length>limit || /[\u0000-\u001f]/u.test(value))
    fail(label+' contains invalid or excessive text.');
}
function valueFor(key,value,type) {
  if(!propertyNames.has(key))fail('Unsupported WinUI presentation property: '+key+'.');
  if(brushes.has(key)) {
    if(typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value))
      fail(key+' requires a canonical XAML hexadecimal color.');
  } else if(thicknesses.has(key)) {
    if(!Array.isArray(value) || value.length!==4 || value.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<(key==='FocusVisualMargin'?-20000:0)||v>20000))
      fail(key+' requires four finite DIP values in range.');
  } else if(key==='FontWeight') {
    if(!Number.isInteger(value)||value<1||value>1000)fail('FontWeight must be an integer between 1 and 1000.');
  } else if(key==='Opacity') {
    if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)fail('Opacity must be between 0 and 1.');
  } else if(key==='FontSize') {
    if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>20000)fail('FontSize requires a positive finite DIP value.');
  } else if(key==='FontFamily') {
    text(value,'FontFamily',1024);
  } else if(key==='UseSystemFocusVisuals') {
    if(typeof value!=='boolean')fail('UseSystemFocusVisuals requires a Boolean value.');
  } else if(key==='IsIndeterminate') {
    if(type!=='ProgressBar'||typeof value!=='boolean')fail('IsIndeterminate requires a ProgressBar and a Boolean value.');
  } else if(['Header','OnContent','OffContent'].includes(key)) {
    if(type!=='CheckBox'||typeof value!=='string'||value.length>16384||value.includes('\0'))
      fail(key+' requires bounded ToggleSwitch text.');
  } else if(!enums[key]?.includes(value))fail('Invalid WinUI '+key+' value.');
}

/** Validate before assigning, normalizing or executing project data. In
 * particular resource text can never become a CSS declaration or a URL. */
export function validateWinUI3Appearance(value,type) {
  if(value===undefined||value===null)return value;
  record(value,'WinUI3');
  for(const key of Object.keys(value))if(!['version','sourceType','requestedTheme','style','properties','resources'].includes(key))
    fail('Unknown WinUI3 metadata field: '+key+'.');
  if(value.version!==1)fail('Unsupported WinUI3 presentation version.');
  if(typeof value.sourceType!=='string'||!own(sources,value.sourceType)||!sources[value.sourceType].includes(type))
    fail('WinUI source type does not match the native '+type+' control.');
  if(value.requestedTheme!==undefined&&!['Default','Light','Dark'].includes(value.requestedTheme))
    fail('RequestedTheme must be Default, Light or Dark.');
  if(value.style!==undefined) {
    text(value.style,'WinUI style');
    // A user style may have any resource key; it does not grant a runtime
    // template. Only known names have built-in state paint below.
  }
  for(const [key,item] of Object.entries(record(value.properties??{},'WinUI properties')))valueFor(key,item,type);
  if(value.sourceType!=='ToggleSwitch'&&['Header','OnContent','OffContent'].some(key=>own(value.properties??{},key)||own(value.resources??{},key)))
    fail('Header, OnContent and OffContent require a ToggleSwitch.');
  const resources=record(value.resources??{},'WinUI resources');
  for(const [key,entry] of Object.entries(resources)) {
    if(!propertyNames.has(key))fail('Unsupported WinUI resource target: '+key+'.');
    record(entry,'WinUI resource');
    if(Object.keys(entry).some(k=>!['key','values'].includes(k)))fail('Unknown WinUI resource metadata.');
    text(entry.key,'WinUI resource key');
    const branches=record(entry.values,'WinUI resource branches'),keys=Object.keys(branches);
    if(!keys.length||keys.some(k=>!themes.has(k)))fail('Invalid WinUI theme resource branches.');
    if(!own(branches,'Default')&&!own(branches,'Light')&&!own(branches,'Dark'))fail('A WinUI theme resource requires a normal-theme fallback.');
    for(const item of Object.values(branches))valueFor(key,item,type);
  }
  return value;
}
export function validateWinUI3Properties(properties={},type) {
  if(own(properties,'WinUI3'))validateWinUI3Appearance(properties.WinUI3,type);
  if(properties.WinUI3?.sourceType==='ToggleSwitch'&&![0,1].includes(Number(properties.Value??0)))
    fail('ToggleSwitch requires the binary CheckBox Value 0 or 1.');
  return properties;
}
export function winui3ThemeValues(appearance,theme='Light') {
  const values={...appearance?.properties};
  for(const [key,entry] of Object.entries(appearance?.resources??{})) {
    const branches=entry.values;
    values[key]=branches[theme]??branches.Default??branches.Light??branches.Dark;
  }
  return values;
}
/** XAML #ARGB/#AARRGGBB -> CSS #RGBA/#RRGGBBAA. Alpha is never discarded. */
export function winui3CssColor(value) {
  if(typeof value!=='string'||!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value))
    fail('Invalid WinUI color.');
  const color=value.slice(1).toLowerCase();
  return '#'+(color.length===4?color.slice(1)+color[0]:color.length===8?color.slice(2)+color.slice(0,2):color);
}
export function winui3CssThickness(value) {
  return [value[1],value[2],value[3],value[0]].map(v=>v+'px').join(' ');
}
export function winui3BuiltinStyle(style) {return styles.has(style)?style:null;}

/** Explicit VB property edits relinquish the corresponding presentation value,
 * including same-value edits. A simultaneous WinUI3 replacement is explicit. */
export function clearWinUI3Overrides(properties,changes) {
  const appearance=properties.WinUI3;
  if(!appearance||own(changes,'WinUI3'))return;
  const map={BackColor:'Background',ForeColor:'Foreground',FontBold:'FontWeight',FontName:'FontFamily',FontSize:'FontSize'};
  for(const [native,key] of Object.entries(map))if(own(changes,native)) {
    delete appearance.properties?.[key];delete appearance.resources?.[key];
  }
}
export const WinUI3=Object.freeze({WINUI3_THEMES,WINUI3_PROPERTY_NAMES,
  validateWinUI3Appearance,validateWinUI3Properties,winui3ThemeValues,winui3CssColor});
