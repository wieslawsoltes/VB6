import {PRESENTATION_NS,WINUI_CONTROLS_NS} from '../../packages/xaml-compiler/src/index.js';
import {WINUI3_RESOURCE_KEYS,WINUI3_DICTIONARY_SOURCES,winui3ResourceDefinition,WinUI3ResourceError} from '../theme/winui3-resources.js';
import {THEMES} from '../theme/theme.js';

const tokens=new WeakSet();
export const WINUI3_THEMES=Object.freeze(['Default','Light','Dark','HighContrast']);
export const isWinUI3Namespace=uri=>uri===PRESENTATION_NS||uri===WINUI_CONTROLS_NS;
export const isWinUI3ThemeResource=value=>tokens.has(value);
export function winui3ThemeResource(key,values) {
  const token=Object.freeze({kind:'WinUI3ThemeResource',key,values:Object.freeze(Object.fromEntries(WINUI3_THEMES.map(theme=>[theme,Array.isArray(values[theme])?Object.freeze([...values[theme]]):values[theme]])))});
  tokens.add(token);return token;
}
export const winui3ThemeValue=(value,theme='Light')=>isWinUI3ThemeResource(value)?value.values[theme]:value;
export const mapWinUI3Value=(value,convert)=>isWinUI3ThemeResource(value)?winui3ThemeResource(value.key,Object.fromEntries(WINUI3_THEMES.map(theme=>[theme,convert(value.values[theme])]))):convert(value);

const colors=Object.freeze({transparent:'#00FFFFFF',black:'#FF000000',white:'#FFFFFFFF',red:'#FFFF0000',green:'#FF008000',blue:'#FF0000FF',yellow:'#FFFFFF00',gray:'#FF808080',grey:'#FF808080',silver:'#FFC0C0C0',maroon:'#FF800000',purple:'#FF800080',fuchsia:'#FFFF00FF',lime:'#FF00FF00',olive:'#FF808000',navy:'#FF000080',teal:'#FF008080',aqua:'#FF00FFFF',orange:'#FFFFA500'});
export function winui3Color(value) {
  if(typeof value!=='string')throw new TypeError('WinUI paint requires a XAML color string.');
  const text=colors[value.toLowerCase()]??value;
  if(/^#[\da-f]{3}$/i.test(text))return '#FF'+[...text.slice(1)].map(c=>c+c).join('').toUpperCase();
  if(/^#[\da-f]{4}$/i.test(text))return '#'+[...text.slice(1)].map(c=>c+c).join('').toUpperCase();
  if(/^#[\da-f]{6}$/i.test(text))return '#FF'+text.slice(1).toUpperCase();
  if(/^#[\da-f]{8}$/i.test(text))return text.toUpperCase();
  throw new TypeError('WinUI paint requires #RGB, #ARGB, #RRGGBB, #AARRGGBB or a supported XAML named color.');
}
export const winui3OleColor=value=>{const hex=winui3Color(value?.kind==='LinearGradientBrush'?value.gradientStops[0]?.color:value);return parseInt(hex.slice(3,5),16)|(parseInt(hex.slice(5,7),16)<<8)|(parseInt(hex.slice(7,9),16)<<16);};
export function winui3BrushColor(color,opacity=1) {
  if(typeof opacity!=='number'||!Number.isFinite(opacity)||opacity<0||opacity>1)throw new TypeError('SolidColorBrush.Opacity must be between 0 and 1.');
  if(color?.kind==='MacOS26Color') {
    if(opacity!==1)throw new TypeError('A macOS semantic brush requires unit opacity.');
    return color;
  }
  return mapWinUI3Value(color,value=>{const hex=winui3Color(value),alpha=Math.round(parseInt(hex.slice(1,3),16)*opacity);return '#'+alpha.toString(16).padStart(2,'0').toUpperCase()+hex.slice(3);});
}
export function winui3FontWeight(value) {
  const names={thin:100,extralight:200,ultralight:200,light:300,semilight:350,normal:400,regular:400,medium:500,demibold:600,semibold:600,bold:700,extrabold:800,ultrabold:800,black:900,heavy:900,extrablack:950,ultrablack:950};
  const weight=Object.hasOwn(names,String(value).toLowerCase())?names[String(value).toLowerCase()]:Number(value);
  if(!Number.isInteger(weight)||weight<1||weight>999)throw new TypeError('FontWeight must be a named WinUI weight or an integer from 1 through 999.');
  return weight;
}

export function winui3LinearBrush(node,read) {
  const props=Object.fromEntries(node.properties.map(p=>[p.member.name,p]));
  if(node.properties.some(p=>p.member.attached||!['StartPoint','EndPoint','MappingMode','SpreadMethod','Opacity','RelativeTransform','GradientStops'].includes(p.member.name)))throw new TypeError('LinearGradientBrush contains an unsupported property or transform.');
  const values=Object.fromEntries(Object.entries(props).filter(([name])=>!['GradientStops','RelativeTransform'].includes(name)).map(([name,p])=>[name,read(p.value)]));
  const stops=props.GradientStops?.value;
  if(stops?.kind!=='Collection'||stops.items.length<2||stops.items.length>256)throw new TypeError('LinearGradientBrush requires 2 through 256 GradientStop entries.');
  const gradients=stops.items.map(stop=>{
    if(stop.kind!=='Object'||stop.type.namespaceURI!==PRESENTATION_NS||stop.type.name!=='GradientStop'||stop.properties.some(p=>!['Color','Offset'].includes(p.member.name)))throw new TypeError('GradientStops requires static GradientStop objects.');
    const p=Object.fromEntries(stop.properties.map(p=>[p.member.name,p]));
    if(!p.Color||!p.Offset)throw new TypeError('GradientStop requires Color and Offset.');
    return {color:read(p.Color.value),offset:read(p.Offset.value)};
  });
  let transform=null;
  if(props.RelativeTransform) {
    const node=props.RelativeTransform.value;
    if(node.kind!=='Object'||node.type.namespaceURI!==PRESENTATION_NS||node.type.name!=='ScaleTransform'||node.properties.some(p=>p.member.attached||!['ScaleX','ScaleY','CenterX','CenterY'].includes(p.member.name)))throw new TypeError('LinearGradientBrush supports only a scalar relative ScaleTransform.');
    transform={type:'ScaleTransform',scaleX:1,scaleY:1,centerX:0,centerY:0};
    for(const p of node.properties){const value=read(p.value);if(isWinUI3ThemeResource(value))throw new TypeError('Gradient transforms cannot be live resources.');transform[p.member.name[0].toLowerCase()+p.member.name.slice(1)]=value;}
  }
  const resourceValues=[...Object.values(values),...gradients.flatMap(stop=>[stop.color,stop.offset])].filter(isWinUI3ThemeResource);
  const build=theme=>({kind:'LinearGradientBrush',startPoint:winui3ThemeValue(values.StartPoint,theme)??[0,0],endPoint:winui3ThemeValue(values.EndPoint,theme)??[1,1],mappingMode:winui3ThemeValue(values.MappingMode,theme)??'RelativeToBoundingBox',spreadMethod:winui3ThemeValue(values.SpreadMethod,theme)??'Pad',opacity:winui3ThemeValue(values.Opacity,theme)??1,relativeTransform:transform,
    gradientStops:gradients.map(stop=>({offset:winui3ThemeValue(stop.offset,theme),color:winui3Color(winui3ThemeValue(stop.color,theme))}))});
  return resourceValues.length?winui3ThemeResource(resourceValues[0].key,Object.fromEntries(WINUI3_THEMES.map(theme=>[theme,build(theme)]))):build('Light');
}

const literal=value=>({kind:'Literal',value});
const member=(owner,name,type='Object',extra={})=>({namespaceURI:PRESENTATION_NS,owner,name,type,kind:'property',...extra});
const source={start:0,end:0};
const object=(name,properties,extra={})=>({kind:'Object',id:-1,type:{namespaceURI:PRESENTATION_NS,name},properties,source,directives:{},scope:0,name:null,...extra});
const property=(owner,name,value,type='Object',extra={})=>({member:member(owner,name,type,extra),value,source});

/** Built-in template identities are implemented by the browser control adapter.
 * Only these audited public styles may use that template bridge. A random Style
 * or ControlTemplate from a dictionary is never treated as an equivalent UI. */
export const WINUI3_STYLE_TARGETS=Object.freeze({
  DefaultButtonStyle:'Button',AccentButtonStyle:'Button',SubtleButtonStyle:'Button',DefaultHyperlinkButtonStyle:'HyperlinkButton',
  DefaultToggleButtonStyle:'ToggleButton',DefaultToggleSwitchStyle:'ToggleSwitch',DefaultCheckBoxStyle:'CheckBox',DefaultRadioButtonStyle:'RadioButton',
  DefaultTextBoxStyle:'TextBox',DefaultPasswordBoxStyle:'PasswordBox',DefaultComboBoxStyle:'ComboBox',
  DefaultListBoxStyle:'ListBox',DefaultSliderStyle:'Slider',DefaultProgressBarStyle:'ProgressBar',
  CaptionTextBlockStyle:'TextBlock',BodyTextBlockStyle:'TextBlock',BodyStrongTextBlockStyle:'TextBlock',BodyLargeTextBlockStyle:'TextBlock',BodyLargeStrongTextBlockStyle:'TextBlock',SubtitleTextBlockStyle:'TextBlock',TitleTextBlockStyle:'TextBlock',TitleLargeTextBlockStyle:'TextBlock',DisplayTextBlockStyle:'TextBlock',BaseTextBlockStyle:'TextBlock'
});
const themeName=theme=>({Default:'dark',Light:'light',Dark:'dark',HighContrast:'highContrast'}[theme]??theme);
/** Browser-host defaults are explicit application policy, not an inferred OS
 * accent, font or accessibility palette. Actual pinned dictionary data remains
 * separately attributable to its upstream source. */
export const WINUI3_HOST_RESOURCES=Object.freeze({
  ContentControlThemeFontFamily:Object.freeze({type:'FontFamily',value:'Segoe UI Variable'}),
  ControlContentThemeFontSize:Object.freeze({type:'Double',value:14})
});
export function winui3HostResourceOptions(theme='Light') {
  const profile=THEMES[theme==='HighContrast'?'contrast':theme==='Default'||theme==='Dark'?'fluent-dark':'fluent'].colors;
  const light=winui3Color(THEMES.fluent.colors.selection),dark=winui3Color(THEMES['fluent-dark'].colors.selection);
  const mix=(from,to,amount)=>'#FF'+[3,5,7].map(offset=>Math.round(parseInt(from.slice(offset,offset+2),16)*(1-amount)+parseInt(to.slice(offset,offset+2),16)*amount).toString(16).padStart(2,'0')).join('').toUpperCase();
  // Explicit browser-host ramp policy: retain the application's standard light
  // and dark accent anchors; darken the light anchor by 15%/30% for Dark2/Dark3,
  // interpolate both anchors halfway for Light1 and tint the dark anchor 35%
  // toward white for Light3. This is reproducible sRGB-channel interpolation,
  // not Windows UISettings, a perceptual ramp or a claim about the user's OS.
  return {accentColors:{SystemAccentColor:winui3Color(profile.selection),SystemAccentColorDark1:light,SystemAccentColorDark2:mix(light,'#FF000000',0.15),SystemAccentColorDark3:mix(light,'#FF000000',0.30),SystemAccentColorLight1:mix(light,dark,0.5),SystemAccentColorLight2:dark,SystemAccentColorLight3:mix(dark,'#FFFFFFFF',0.35)},
    systemColors:Object.fromEntries(Object.entries({SystemColorButtonFaceColor:'face',SystemColorButtonTextColor:'text',SystemColorGrayTextColor:'gray',SystemColorHighlightColor:'selection',SystemColorHighlightTextColor:'selectionText',SystemColorHotlightColor:'link',SystemColorWindowColor:'window',SystemColorWindowTextColor:'windowText'}).map(([key,role])=>[key,winui3Color(profile[role])])),hostResources:WINUI3_HOST_RESOURCES};
}
const resourceKeys=new Set(WINUI3_RESOURCE_KEYS);
export function winui3BuiltinResource(key,theme,policy) {
  const options={...winui3HostResourceOptions(theme),...(policy?.density?{density:policy.density}:{})};
  if(!resourceKeys.has(key)) {
    for(const map of [options.accentColors,options.systemColors])if(Object.hasOwn(map,key))return literal(map[key]);
    return Object.hasOwn(WINUI3_HOST_RESOURCES,key)?literal(WINUI3_HOST_RESOURCES[key].value):undefined;
  }
  let definition;
  try{definition=winui3ResourceDefinition(key,themeName(theme),{...options,...(policy?.source?{source:policy.source}:{})});}
  catch(e){if(e instanceof WinUI3ResourceError&&e.code==='WINUI3_RESOURCE_NOT_FOUND')return undefined;throw e;}
  if(definition.unsupported)throw new TypeError('Built-in WinUI resource '+key+': '+definition.unsupported);
  const {type,value}=definition;
  // Preserve every source expression. Resolving inside the catalog would hide
  // lexical resource shadows and turn a StaticResource brush with a nested
  // ThemeResource color into an incorrectly frozen literal.
  if(type==='StaticResource')return {kind:'Resource',key:value,theme:false};
  if(type==='SolidColorBrush')return object('SolidColorBrush',[property('SolidColorBrush','Color',value.color,'Color'),property('SolidColorBrush','Opacity',value.opacity,'Double')]);
  if(type==='LinearGradientBrush') {
    if(value.colorInterpolationMode&&value.colorInterpolationMode!=='SRgbLinearInterpolation')throw new TypeError('LinearGradientBrush color interpolation requires an implemented renderer.');
    const props=[property('LinearGradientBrush','StartPoint',literal(value.startPoint),'Point'),property('LinearGradientBrush','EndPoint',literal(value.endPoint),'Point'),property('LinearGradientBrush','MappingMode',literal(value.mappingMode)),property('LinearGradientBrush','SpreadMethod',literal(value.spreadMethod)),property('LinearGradientBrush','Opacity',value.opacity,'Double'),
      property('LinearGradientBrush','GradientStops',{kind:'Collection',items:value.gradientStops.map(stop=>object('GradientStop',[property('GradientStop','Color',stop.color,'Color'),property('GradientStop','Offset',literal(stop.offset),'Double')]))})];
    if(value.relativeTransform)props.push(property('LinearGradientBrush','RelativeTransform',object('ScaleTransform',Object.entries(value.relativeTransform).filter(([name])=>name!=='type').map(([name,value])=>property('ScaleTransform',name[0].toUpperCase()+name.slice(1),literal(value),'Double')))));
    return object('LinearGradientBrush',props);
  }
  if(type==='Style') {
    if(!Object.hasOwn(WINUI3_STYLE_TARGETS,key))throw new TypeError('Built-in WinUI style '+key+' requires a supported control template bridge.');
    const expected=WINUI3_STYLE_TARGETS[key];
    if(value.targetType!==expected)throw new TypeError('Pinned WinUI style target mismatch for '+key+'.');
    const unsupported=value.unsupported??definition.unsupported??[];
    if(unsupported.some(item=>item.property!=='Template'))throw new TypeError('Built-in WinUI style '+key+' contains an unsupported setter: '+unsupported.filter(item=>item.property!=='Template').map(item=>item.property).join(', ')+'.');
    const setters=value.setters.filter(setter=>setter.property!=='Template').map(setter=>object('Setter',[property('Setter','Property',literal(setter.property),'String'),property('Setter','Value',setter.value)]));
    const props=[property('Style','TargetType',literal(expected),'Type'),property('Style','Setters',{kind:'Collection',items:setters})];
    if(value.basedOn)props.push(property('Style','BasedOn',value.basedOn));
    return object('Style',props,{builtinStyle:key});
  }
  if(['Color','Double','Int32','Boolean','String','Thickness','CornerRadius','GridLength','Point','FontFamily','FontWeight'].includes(type))return literal(value);
  throw new TypeError('Built-in WinUI resource '+key+' has unsupported '+type+' construction.');
}
export function winui3BuiltinDictionary(node) {
  if(!isWinUI3Namespace(node.type.namespaceURI))return false;
  const sourceProperty=node.properties.find(p=>p.member.name==='Source');
  if(node.type.name==='XamlControlsResources') {
    if(node.properties.length)throw new TypeError('XamlControlsResources is the pinned built-in dictionary; custom properties or inline resources are not accepted.');
    return true;
  }
  if(!sourceProperty)return false;
  if(sourceProperty.value.kind!=='Literal'||typeof sourceProperty.value.value!=='string'||!WINUI3_DICTIONARY_SOURCES.includes(sourceProperty.value.value))throw new TypeError('External resource dictionary Source is not an allowlisted pinned WinUI dictionary; no external data was read.');
  if(node.properties.length!==1)throw new TypeError('A pinned Source dictionary cannot also declare inline or merged resources.');
  return sourceProperty.value.value.endsWith('/DensityStyles/Compact.xaml')?{density:'compact',source:'src/controls/dev/dll/DensityStyles/Compact.xaml'}:true;
}
export const WINUI3_CONTROL_ALIASES=Object.freeze({ToggleSwitch:'CheckBox',ToggleButton:'CheckBox',HyperlinkButton:'CommandButton'});
export const WINUI3_DEFAULT_STYLES=Object.freeze({Button:'DefaultButtonStyle',ToggleButton:'DefaultToggleButtonStyle',HyperlinkButton:'DefaultHyperlinkButtonStyle',TextBlock:'BodyTextBlockStyle'});
export function winui3DefaultStyle(node,scopes) {
  if(!isWinUI3Namespace(node.type.namespaceURI)||!Object.hasOwn(WINUI3_DEFAULT_STYLES,node.type.name))return undefined;
  const active=(scope,seen=new Set())=>{
    if(seen.has(scope))return false;seen.add(scope);
    const selected=scope.themes.get(scopes[0]?.theme??'Light')??scope.themes.get('Default');
    return !!scope.builtin||scope.merged.some(child=>active(child,seen))||!!selected&&active(selected,seen);
  };
  if(!scopes.some(scope=>active(scope)))return undefined;
  return {kind:'Resource',key:WINUI3_DEFAULT_STYLES[node.type.name],theme:false};
}
export function winui3StateResources(node,appearance,statics,scopes) {
  if(!['Button','ToggleButton','HyperlinkButton','TextBox','PasswordBox','ComboBox'].includes(node.type.name))return undefined;
  const prefix=appearance.style==='AccentButtonStyle'?'AccentButton':appearance.style==='SubtleButtonStyle'?'SubtleButton':['TextBox','PasswordBox'].includes(node.type.name)?'TextControl':node.type.name;
  const names=['PointerOver','Pressed','Disabled',...(['TextBox','PasswordBox','ComboBox'].includes(node.type.name)?['Focused']:[]),...(node.type.name==='ToggleButton'?['Checked','CheckedPointerOver','CheckedPressed','CheckedDisabled','Indeterminate','IndeterminatePointerOver','IndeterminatePressed','IndeterminateDisabled']:[])],states={};
  for(const state of names)for(const property of ['Background','Foreground','BorderBrush']) {
    const key=prefix+property+state;
    if(!statics.lookup(key,scopes))continue;
    const value=statics.convert({kind:'Resource',key,theme:true},{type:'Brush'},scopes);
    if(!isWinUI3ThemeResource(value))throw new TypeError('A WinUI state resource must resolve to a live theme value.');
    const converted=mapWinUI3Value(value,v=>validateWinUI3LoweredValue(property,v));
    (states[state]??={})[property]={key,values:{...converted.values}};
  }
  return Object.keys(states).length?states:undefined;
}
export function winui3Event(node,name) {
  if(!isWinUI3Namespace(node.type.namespaceURI))return null;
  if(node.type.name==='ToggleSwitch'&&name==='Toggled')return 'Click';
  if(name==='Tapped')return 'Click';
  if(name==='DoubleTapped')return 'DblClick';
  return null;
}

export const WINUI3_RENDERED_PROPERTIES=new Set(['Background','Foreground','BorderBrush','BorderThickness','Padding','CornerRadius','FontFamily','FontSize','FontWeight','Opacity','TextWrapping','TextTrimming','HorizontalContentAlignment','VerticalContentAlignment','IsIndeterminate','OnContent','OffContent','Header','BackgroundSizing','UseSystemFocusVisuals','FocusVisualMargin']);
export function validateWinUI3LoweredValue(key,value) {
  if(['Background','Foreground','BorderBrush'].includes(key)) {
    if(value?.kind==='LinearGradientBrush') {if(key==='Foreground')throw new TypeError('Gradient text foreground requires an implemented glyph-mask renderer.');return structuredClone(value);}
    return winui3Color(value);
  }
  if(key==='FontWeight')return winui3FontWeight(value);
  if(key==='FontFamily') {if(typeof value!=='string'||!value.trim()||value.length>1024||/[\u0000-\u001f]/u.test(value))throw new TypeError('FontFamily requires a bounded font family name.');return value==='XamlAutoFontFamily'?'Segoe UI Variable':value;}
  if(key==='FontSize'&&(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>20000))throw new TypeError('FontSize requires a finite positive DIP value.');
  if(['Padding','BorderThickness','CornerRadius','FocusVisualMargin'].includes(key)) {
    if(!Array.isArray(value)||value.length!==4||value.some(n=>typeof n!=='number'||!Number.isFinite(n)||(key!=='FocusVisualMargin'&&n<0)||Math.abs(n)>20000))throw new TypeError(key+' requires four finite '+(key==='FocusVisualMargin'?'':'nonnegative ')+'DIPs within geometry limits.');
    return [...value];
  }
  if(key==='Opacity'&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1))throw new TypeError('Opacity must be between 0 and 1.');
  if(key==='IsIndeterminate'&&typeof value!=='boolean')throw new TypeError('IsIndeterminate must be Boolean.');
  if(key==='UseSystemFocusVisuals'&&typeof value!=='boolean')throw new TypeError('UseSystemFocusVisuals must be Boolean.');
  if(key==='TextTrimming'&&value==='WordEllipsis')throw new TypeError('WordEllipsis requires word-aware text measurement; CharacterEllipsis is supported.');
  if(['OnContent','OffContent','Header'].includes(key)&&typeof value!=='string')throw new TypeError(key+' supports string content; object/template content requires a native content presenter.');
  return value;
}
