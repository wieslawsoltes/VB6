/** Serializable WinUI presentation values. The form model remains authoritative;
 * this bounded contract adds paint and theme branches without a second UI tree. */
export const WINUI3_THEMES = Object.freeze(['Default','Light','Dark','HighContrast']);
export const WINUI3_STATES = Object.freeze(['PointerOver','Pressed','Focused','Disabled',
  'Checked','CheckedPointerOver','CheckedPressed','CheckedDisabled',
  'Indeterminate','IndeterminatePointerOver','IndeterminatePressed','IndeterminateDisabled']);
export const WINUI3_PROPERTY_NAMES = Object.freeze([
  'Background','Foreground','BorderBrush','BorderThickness','Padding','CornerRadius',
  'FontWeight','Opacity','TextWrapping','TextTrimming','HorizontalContentAlignment',
  'VerticalContentAlignment','IsIndeterminate','Header','OnContent','OffContent',
  'FontFamily','FontSize','BackgroundSizing','UseSystemFocusVisuals','FocusVisualMargin'
]);
const propertyNames = new Set(WINUI3_PROPERTY_NAMES);
const themes = new Set(WINUI3_THEMES);
const states = new Set(WINUI3_STATES);
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
/** Deliberately data-only brushes. The supported axis-aligned subset preserves
 * every gradient in the pinned WinUI dictionaries, including absolute ramps
 * reflected around the control bounds. Unsupported transforms are rejected. */
export function validateWinUI3Brush(value,{foreground=false}={}) {
  if(typeof value==='string') {
    if(!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value))
      fail('WinUI brush requires a canonical XAML hexadecimal color.');
    return value;
  }
  record(value,'WinUI brush');
  if(foreground||value.kind!=='LinearGradientBrush')fail('A gradient brush is supported only for Background and BorderBrush.');
  if(Object.keys(value).some(k=>!['kind','startPoint','endPoint','mappingMode','spreadMethod','opacity','relativeTransform','gradientStops'].includes(k)))
    fail('Unknown linear gradient brush field.');
  const finite=(v,limit=20000)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=limit;
  for(const point of [value.startPoint,value.endPoint])
    if(!Array.isArray(point)||point.length!==2||point.some(v=>!finite(v)))fail('Gradient points require two finite DIP or relative coordinates.');
  const dx=value.endPoint[0]-value.startPoint[0],dy=value.endPoint[1]-value.startPoint[1];
  if((dx===0)===(dy===0))fail('Linear gradients require a nonzero, axis-aligned direction.');
  if(!['Absolute','RelativeToBoundingBox'].includes(value.mappingMode)||value.spreadMethod!=='Pad')
    fail('Linear gradients support Absolute or RelativeToBoundingBox mapping and Pad spread.');
  if(!finite(value.opacity,1)||value.opacity<0)fail('Gradient opacity must be between 0 and 1.');
  if(value.relativeTransform!==null) {
    const transform=record(value.relativeTransform,'Gradient relative transform');
    if(transform.type!=='ScaleTransform'||Object.keys(transform).some(k=>!['type','scaleX','scaleY','centerX','centerY'].includes(k))||
      !['scaleX','scaleY','centerX','centerY'].every(k=>finite(transform[k]))||transform[dx?'scaleX':'scaleY']===0)
      fail('A gradient supports a finite, nondegenerate relative ScaleTransform.');
  }
  if(!Array.isArray(value.gradientStops)||value.gradientStops.length<2||value.gradientStops.length>256)
    fail('A linear gradient requires 2 through 256 stops.');
  for(const stop of value.gradientStops) {
    record(stop,'Gradient stop');
    if(Object.keys(stop).some(k=>!['offset','color'].includes(k))||!finite(stop.offset,1)||stop.offset<0)
      fail('A gradient stop requires an offset between 0 and 1.');
    validateWinUI3Brush(stop.color,{foreground:true});
  }
  return value;
}
function valueFor(key,value,type) {
  if(!propertyNames.has(key))fail('Unsupported WinUI presentation property: '+key+'.');
  if(brushes.has(key)) {
    validateWinUI3Brush(value,{foreground:key==='Foreground'});
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
  for(const key of Object.keys(value))if(!['version','sourceType','requestedTheme','style','properties','resources','states'].includes(key))
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
    resourceFor(key,entry,type);
  }
  for(const [state,entries] of Object.entries(record(value.states??{},'WinUI states'))) {
    if(!states.has(state))fail('Unsupported WinUI visual state: '+state+'.');
    if(/^(Checked|Indeterminate)/.test(state)&&value.sourceType!=='ToggleButton')fail('Checked and indeterminate template states require a ToggleButton.');
    for(const [key,item] of Object.entries(record(entries,'WinUI state values'))) {
      if(!brushes.has(key))fail('Unsupported WinUI state target: '+key+'.');
      if(item&&typeof item==='object'&&own(item,'values'))resourceFor(key,item,type);
      else valueFor(key,item,type);
    }
  }
  return value;
}
function resourceFor(key,entry,type) {
  record(entry,'WinUI resource');
  if(Object.keys(entry).some(k=>!['key','values'].includes(k)))fail('Unknown WinUI resource metadata.');
  text(entry.key,'WinUI resource key');
  const branches=record(entry.values,'WinUI resource branches'),keys=Object.keys(branches);
  if(!keys.length||keys.some(k=>!themes.has(k)))fail('Invalid WinUI theme resource branches.');
  if(!own(branches,'Default')&&!own(branches,'Light')&&!own(branches,'Dark'))fail('A WinUI theme resource requires a normal-theme fallback.');
  for(const item of Object.values(branches))valueFor(key,item,type);
}
const branch=(entry,theme)=>entry.values[theme]??entry.values.Default??entry.values.Light??entry.values.Dark;
export function validateWinUI3Properties(properties={},type) {
  if(own(properties,'WinUI3'))validateWinUI3Appearance(properties.WinUI3,type);
  if(properties.WinUI3?.sourceType==='ToggleSwitch'&&![0,1].includes(Number(properties.Value??0)))
    fail('ToggleSwitch requires the binary CheckBox Value 0 or 1.');
  return properties;
}
export function winui3ThemeValues(appearance,theme='Light') {
  const values={...appearance?.properties};
  for(const [key,entry] of Object.entries(appearance?.resources??{})) {
    values[key]=branch(entry,theme);
  }
  return values;
}
export function winui3StateValues(appearance,theme='Light') {
  return Object.fromEntries(Object.entries(appearance?.states??{}).map(([name,values])=>[name,
    Object.fromEntries(Object.entries(values).map(([key,item])=>[key,item&&typeof item==='object'&&own(item,'values')?branch(item,theme):item]))]));
}
/** XAML #ARGB/#AARRGGBB -> CSS #RGBA/#RRGGBBAA. Alpha is never discarded. */
export function winui3CssColor(value) {
  if(typeof value!=='string'||!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/iu.test(value))
    fail('Invalid WinUI color.');
  const color=value.slice(1).toLowerCase();
  return '#'+(color.length===4?color.slice(1)+color[0]:color.length===8?color.slice(2)+color.slice(0,2):color);
}
/** Coordinates shared by CSS and retained Canvas paint. RelativeTransform is
 * applied after MappingMode, using the complete painted element bounds. */
export function winui3GradientPoints(brush,width,height) {
  const transform=brush.relativeTransform;
  return [brush.startPoint,brush.endPoint].flatMap(point=>point.map((v,i)=>{
    const extent=i?height:width,scale=transform?.[i?'scaleY':'scaleX']??1,center=transform?.[i?'centerY':'centerX']??0;
    return v*(brush.mappingMode==='Absolute'?1:extent)*scale+extent*center*(1-scale);
  }));
}
export function winui3GradientStopColor(color,opacity=1) {
  const css=winui3CssColor(color);if(opacity===1)return css;
  const hex=css.length<=5?[...css.slice(1)].map(v=>v+v).join(''):css.slice(1);
  return 'rgba('+[parseInt(hex.slice(0,2),16),parseInt(hex.slice(2,4),16),parseInt(hex.slice(4,6),16),
    Number(((hex.length===8?parseInt(hex.slice(6,8),16)/255:1)*opacity).toFixed(8))].join(', ')+')';
}
export function winui3CssBrush(brush) {
  if(typeof brush==='string')return winui3CssColor(brush);
  const axis=brush.startPoint[0]===brush.endPoint[0]?1:0,transform=brush.relativeTransform;
  const scale=transform?.[axis?'scaleY':'scaleX']??1,center=transform?.[axis?'centerY':'centerX']??0;
  const delta=brush.endPoint[axis]-brush.startPoint[axis],reverse=delta*scale<0;
  const direction=axis?(reverse?'top':'bottom'):(reverse?'left':'right');
  const format=n=>String(Number(n.toFixed(8)));
  const stops=[...brush.gradientStops].sort((a,b)=>a.offset-b.offset).map(stop=>{
    const at=(brush.startPoint[axis]+delta*stop.offset)*scale,translate=center*(1-scale);
    const relative=brush.mappingMode!=='Absolute';
    const percent=relative?(reverse?1-at-translate:at+translate)*100:(reverse?1-translate:translate)*100;
    const pixels=relative?0:(reverse?-at:at);
    const position=!pixels?format(percent)+'%':!percent?format(pixels)+'px':'calc('+format(percent)+'% '+(pixels<0?'-':'+')+' '+format(Math.abs(pixels))+'px)';
    return winui3GradientStopColor(stop.color,brush.opacity)+' '+position;
  });
  return 'linear-gradient(to '+direction+', '+stops.join(', ')+')';
}
export function winui3CssThickness(value) {
  return [value[1],value[2],value[3],value[0]].map(v=>v+'px').join(' ');
}
export function winui3BuiltinStyle(style) {return styles.has(style)?style:null;}

const nativeOverrides=Object.freeze({BackColor:'Background',ForeColor:'Foreground',FontBold:'FontWeight',FontName:'FontFamily',FontSize:'FontSize',
  LayoutPadding:'Padding',LayoutPaddingLeft:'Padding',LayoutPaddingTop:'Padding',LayoutPaddingRight:'Padding',LayoutPaddingBottom:'Padding'});
/** The inspector must commit an explicit same-value edit while a typed value or
 * state still owns its paint. A plain native value remains a no-op. */
export function hasWinUI3Override(properties,nativeKey) {
  const appearance=properties?.WinUI3,key=nativeOverrides[nativeKey];
  return !!(appearance&&key&&(own(appearance.properties??{},key)||own(appearance.resources??{},key)||
    Object.values(appearance.states??{}).some(values=>own(values,key))));
}
/** Explicit VB property edits relinquish the corresponding presentation value,
 * including same-value edits. A simultaneous WinUI3 replacement is explicit. */
export function clearWinUI3Overrides(properties,changes) {
  const appearance=properties.WinUI3;
  if(!appearance||own(changes,'WinUI3'))return;
  for(const [native,key] of Object.entries(nativeOverrides))if(own(changes,native)) {
    delete appearance.properties?.[key];delete appearance.resources?.[key];
    for(const values of Object.values(appearance.states??{}))delete values[key];
  }
}
export const WinUI3=Object.freeze({WINUI3_THEMES,WINUI3_STATES,WINUI3_PROPERTY_NAMES,
  validateWinUI3Appearance,validateWinUI3Properties,validateWinUI3Brush,winui3ThemeValues,winui3StateValues,winui3CssColor,winui3CssBrush});
