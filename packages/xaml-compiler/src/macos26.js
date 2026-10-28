import {PRESENTATION_NS} from './syntax.js';
import {createWinUISchema} from './schema.js';

/** Versioned, independently implemented authoring vocabulary. This namespace
 * describes macOS-shaped controls; it is not an Apple XAML, AppKit or SwiftUI ABI.
 * Hosts decide how the construction IR maps to their actual controls. */
export const MACOS26_NS = 'urn:vb6:macos26';
export const MACOS26_CONTROL_SIZES = Object.freeze(['mini','small','regular','large','extraLarge']);
export const MACOS26_CONTROL_STYLES = Object.freeze(['automatic','push','default','destructive','borderless','inline','circular','help','switch','search','segmented']);
export const MACOS26_MATERIALS = Object.freeze(['none','content','sidebar','titlebar','toolbar','menu','popover','sheet','hud']);
export const MACOS26_SEMANTIC_COLORS = Object.freeze([
  'windowBackgroundColor','controlBackgroundColor','textBackgroundColor',
  'labelColor','secondaryLabelColor','tertiaryLabelColor','disabledControlTextColor',
  'controlTextColor','textColor','controlAccentColor','selectedContentBackgroundColor',
  'selectedTextBackgroundColor','selectedTextColor','unemphasizedSelectedContentBackgroundColor',
  'unemphasizedSelectedTextColor','separatorColor','gridColor','linkColor',
  'accentPressedColor','destructiveColor','destructivePressedColor','focusIndicatorColor'
]);

const enumMember = values => ({type:'Enum',values});
const alias = (type,aliasFor,extra={}) => ({type,aliasFor,...extra});
const event = aliasFor => ({type:'String',kind:'event',parameters:['sender','e'],...(aliasFor?{aliasFor}:{})});
const collection = itemType => ({type:'Object',collection:true,itemType,itemNamespaceURI:MACOS26_NS});
const appearance = () => ({
  ControlSize:{...enumMember(MACOS26_CONTROL_SIZES),aliasFor:'MacOSControlSize'},
  ControlStyle:{...enumMember(MACOS26_CONTROL_STYLES),aliasFor:'MacOSControlStyle'},
  Material:{...enumMember(MACOS26_MATERIALS),aliasFor:'MacOSMaterial'},
  BackgroundRole:{...enumMember(MACOS26_SEMANTIC_COLORS),aliasFor:'MacOSBackgroundRole'},
  ForegroundRole:{...enumMember(MACOS26_SEMANTIC_COLORS),aliasFor:'MacOSForegroundRole'},
  AccessibilityLabel:alias('String','MacOSAccessibilityLabel'),
  AccessibilityHelp:alias('String','MacOSAccessibilityHelp'),
  AccessibilityIdentifier:alias('String','MacOSAccessibilityIdentifier')
});
const title = () => ({Title:alias('Object','Content')});
const field = () => ({StringValue:alias('String','Text'),PlaceholderString:alias('String','PlaceholderText')});
const check = () => ({...title(),IsOn:alias('Boolean','IsChecked'),Action:event('Click')});

// Descriptors also let the VB6 adapter share the audited control/type mapping.
// Collection items below are separate schema values, never empty VB6 controls.
export const MACOS26_CONTROLS = Object.freeze(Object.fromEntries(Object.entries({
  Window:['Page','Form'], View:['Canvas','PictureBox'], Canvas:['Canvas','PictureBox'],
  StackView:['StackPanel','PictureBox'], Grid:['Grid','PictureBox'],
  Button:['Button','CommandButton'], Label:['TextBlock','Label'],
  TextField:['TextBox','TextBox'], SecureField:['PasswordBox','TextBox'], SearchField:['TextBox','TextBox'],
  TextEditor:['TextBox','TextBox'], CheckBox:['CheckBox','CheckBox'], RadioButton:['RadioButton','OptionButton'],
  Switch:['CheckBox','CheckBox'], PopUpButton:['ComboBox','ComboBox'], ComboBox:['ComboBox','ComboBox'],
  Slider:['Slider','Slider'], ScrollBar:['ScrollBar','HScrollBar'], ProgressIndicator:['ProgressBar','ProgressBar'],
  Stepper:['RangeBase','UpDown'], List:['ListBox','ListBox'], Table:['Control','ListView'],
  Outline:['Control','TreeView'], TabView:['Control','SSTab'], SegmentedControl:['Control','Toolbar'], Box:['ContentControl','Frame'],
  Image:['Image','Image'], DatePicker:['Control','DTPicker'], Separator:['Line','Line']
}).map(([name,[presentationType,nativeType]])=>[name,Object.freeze({presentationType,nativeType})])));

/** Register into an existing schema without replacing its presentation types. */
export function registerMacOS26Schema(schema) {
  if(!schema?.getType(PRESENTATION_NS,'FrameworkElement'))throw new TypeError('macOS 26 schema requires the presentation base types.');
  schema.markupExtensionNamespaces.add(MACOS26_NS);
  for(const role of MACOS26_SEMANTIC_COLORS)schema.themeResourceKeys.add('macOS.'+role);
  const extras = {
    Window:{Title:'String'}, StackView:{Axis:alias('Enum','Orientation',{values:['Horizontal','Vertical']})},
    Button:{...title(),IsDefault:'Boolean',IsCancel:'Boolean',Action:event('Click')},
    Label:{StringValue:alias('String','Text')}, TextField:field(), SearchField:field(),
    SecureField:{StringValue:alias('String','Password'),PlaceholderString:alias('String','PlaceholderText')},
    TextEditor:field(), CheckBox:check(), RadioButton:check(), Switch:check(),
    PopUpButton:{StringValue:alias('String','Text')}, ComboBox:field(),
    Stepper:{Increment:'Double',Wrap:'Boolean',Orientation:enumMember(['Horizontal','Vertical'])},
    Table:{Columns:collection('TableColumn'),Rows:collection('TableRow'),SelectionChanged:event(),ColumnClick:event()},
    Outline:{Nodes:collection('OutlineNode'),SelectionChanged:event()},
    TabView:{Items:collection('TabItem'),SelectedIndex:'Int32',SelectionChanged:event()},
    SegmentedControl:{Segments:collection('Segment'),SelectionMode:enumMember(['Single','Multiple','Momentary']),SelectedIndex:'Int32',SelectionChanged:event(),Action:event('Click')},
    Box:{Title:'String'}, DatePicker:{Date:'String',DateValue:alias('String','Date'),DateChanged:event('ValueChanged')}
  };
  for(const [name,definition] of Object.entries(MACOS26_CONTROLS)) {
    schema.registerType(MACOS26_NS,name,{
      base:{namespaceURI:PRESENTATION_NS,name:definition.presentationType},
      members:{...appearance(),...extras[name]},
      ...(['Table','Outline','TabView','SegmentedControl'].includes(name)?{contentProperty:{Table:'Rows',Outline:'Nodes',TabView:'Items',SegmentedControl:'Segments'}[name]}:{})
    });
  }
  const add=(name,members,contentProperty=null,base='DependencyObject')=>schema.registerType(MACOS26_NS,name,{base:{namespaceURI:PRESENTATION_NS,name:base},members,contentProperty});
  for(const name of ['RowDefinition','ColumnDefinition'])add(name,{},null,name);
  add('ListItem',{},'Content','ListBoxItem');
  add('MenuItem',{},'Content','ComboBoxItem');
  add('TableColumn',{Key:'String',Title:'String',Width:'Double',TextAlignment:enumMember(['Left','Center','Right'])});
  add('TableRow',{Key:'String',Text:'String',SubItems:{type:'Object',collection:true}},'SubItems');
  add('OutlineNode',{Key:'String',Text:'String',Title:alias('String','Text'),IsExpanded:'Boolean',Children:collection('OutlineNode')},'Children');
  add('TabItem',{Title:'String',IsEnabled:'Boolean',IsSelected:'Boolean',Visibility:enumMember(['Visible','Collapsed']),Content:'Object'},'Content');
  add('Segment',{Key:'String',Title:'String',IsEnabled:'Boolean',Visibility:enumMember(['Visible','Collapsed']),IsSelected:'Boolean',ToolTip:'String'},'Title');
  add('Appearance',Object.fromEntries(Object.entries(appearance()).filter(([name])=>!name.startsWith('Accessibility')).map(([name,member])=>[name,{...member,attached:true}])));
  add('Accessibility',Object.fromEntries(['Label','Help','Identifier'].map(name=>[name,{...alias('String','MacOSAccessibility'+name),attached:true}])));
  return schema;
}

export function createMacOS26Schema() { return registerMacOS26Schema(createWinUISchema()); }
