import {XAML_NS, PRESENTATION_NS, qualifiedName} from './syntax.js';
const key = (uri, name) => uri + '\0' + name;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function safeMember(name) { if (forbidden.has(name)) throw new TypeError('Unsafe object member: ' + name); return name; }
function collectionMetadata(schema,type,name,member) {
  if(!member?.itemType||member.itemNamespaceURI)return member;
  for(let current=type,seen=new Set();current&&!seen.has(current);current=schema.baseType(current)) {
    seen.add(current);
    if(Object.hasOwn(current.members,name))return {...member,itemNamespaceURI:current.namespaceURI};
  }
  return member;
}
/** Schema metadata is host-supplied. The compiler does not depend on WinMD or CLR reflection. */
export class XamlSchemaContext {
  constructor() { this.types = new Map(); this.revision = 0; this.markupExtensionNamespaces = new Set([PRESENTATION_NS]); this.themeResourceKeys = new Set(); }
  registerType(namespaceURI, name, definition = {}) {
    safeMember(name);
    const members = Object.create(null);
    for (const [memberName, member] of Object.entries(definition.members ?? {})) {
      safeMember(memberName); members[memberName] = Object.freeze(typeof member === 'string' ? {type: member, kind: 'property'} : {kind: 'property', ...member});
    }
    const type = Object.freeze({namespaceURI, name, contentProperty: null, base: null, ...definition, members: Object.freeze(members)});
    this.types.set(key(namespaceURI, name), type); this.revision++; return type;
  }
  getType(namespaceURI, name) { return this.types.get(key(namespaceURI, name)); }
  resolveType(name, namespaces = {}) { const q = qualifiedName(name); return this.getType(namespaces[q.prefix] ?? '', q.localName); }
  baseType(type) { return typeof type.base === 'string' ? this.getType(type.namespaceURI, type.base) : type.base ? this.getType(type.base.namespaceURI, type.base.name) : null; }
  members(type) {
    const chain = [], seen = new Set();
    for (let current = type; current; current = this.baseType(current)) { if (seen.has(current)) throw new Error('Cyclic schema inheritance.'); seen.add(current); chain.unshift(current); }
    return Object.assign(Object.create(null), ...chain.map(t => t.members));
  }
  contentProperty(type) { for (let current = type, seen = new Set(); current && !seen.has(current); current = this.baseType(current)) { seen.add(current); if (current.contentProperty) return current.contentProperty; } return null; }
  runtimeNameProperty(type) { for (let current = type, seen = new Set(); current && !seen.has(current); current = this.baseType(current)) { seen.add(current); if (current.runtimeNameProperty !== undefined) return current.runtimeNameProperty; } return null; }
  member(type, name, namespaces = {}) {
    const q = qualifiedName(name), dot = q.localName.indexOf('.');
    if (dot >= 0) {
      const owner = this.getType(q.prefix ? namespaces[q.prefix] : (namespaces[''] ?? type.namespaceURI), q.localName.slice(0, dot));
      const memberName = q.localName.slice(dot + 1), member = owner && collectionMetadata(this,owner,memberName,this.members(owner)[memberName]);
      if (member && (member.attached || this.isAssignable(type, owner))) return {...member, name: memberName, owner: owner.name, namespaceURI: owner.namespaceURI, attached: !!member.attached};
      return null;
    }
    if (q.prefix && namespaces[q.prefix] !== type.namespaceURI) return null;
    const member = collectionMetadata(this,type,q.localName,this.members(type)[q.localName]);
    return member ? {...member, name: q.localName, owner: type.name, namespaceURI: type.namespaceURI} : null;
  }
  isAssignable(type, base) {
    const seen = new Set(); for (let current = type; current && !seen.has(current); current = this.baseType(current)) { if (current === base || current.assignableTo?.some(view => view.namespaceURI === base?.namespaceURI && view.name === base?.name)) return true; seen.add(current); } return false;
  }
  listTypes(namespaceURI) { return [...this.types.values()].filter(type => !namespaceURI || type.namespaceURI === namespaceURI); }
}
const enumeration = (...values) => ({type: 'Enum', values});
const collection = itemType => ({type: 'Object', collection: true, itemType});
const event = (...parameters) => ({type: 'String', kind: 'event', parameters});
const attached = (type, extra = {}) => ({type, attached: true, ...extra});
export const WINUI_CONTROLS_NS = 'using:Microsoft.UI.Xaml.Controls';
export function createWinUISchema() {
  const schema = new XamlSchemaContext(), add = (name, base, members = {}, contentProperty = null, extras = {}) => schema.registerType(PRESENTATION_NS, name, {base, members, contentProperty, ...extras});
  add('DependencyObject', null);
  add('UIElement', 'DependencyObject', {
    Visibility: enumeration('Visible', 'Collapsed'), Opacity: 'Double', IsHitTestVisible: 'Boolean', AllowDrop: 'Boolean', RenderTransform: 'Object', RenderTransformOrigin: 'Point', Clip: 'Object', CompositeMode: enumeration('Inherit', 'SourceOver', 'MinBlend'),
    PointerPressed: event('sender', 'e'), PointerReleased: event('sender', 'e'), PointerMoved: event('sender', 'e'), PointerEntered: event('sender', 'e'), PointerExited: event('sender', 'e'), Tapped: event('sender', 'e'), DoubleTapped: event('sender', 'e'), KeyDown: event('sender', 'e'), KeyUp: event('sender', 'e'), GotFocus: event('sender', 'e'), LostFocus: event('sender', 'e')
  });
  add('FrameworkElement', 'UIElement', {
    Name: 'String', Width: 'Length', Height: 'Length', MinWidth: 'Double', MinHeight: 'Double', MaxWidth: 'Length', MaxHeight: 'Length', Margin: 'Thickness', Tag: 'Object', DataContext: 'Object', Style: 'Object', Resources: {type: 'Object', dictionary: true},
    HorizontalAlignment: enumeration('Left', 'Center', 'Right', 'Stretch'), VerticalAlignment: enumeration('Top', 'Center', 'Bottom', 'Stretch'), FlowDirection: enumeration('LeftToRight', 'RightToLeft'), RequestedTheme: enumeration('Default', 'Light', 'Dark'), Language: 'String', Loaded: event('sender', 'e'), Unloaded: event('sender', 'e'), SizeChanged: event('sender', 'e')
  });
  const framework = schema.getType(PRESENTATION_NS, 'FrameworkElement');
  schema.registerType(PRESENTATION_NS, 'FrameworkElement', {...framework, runtimeNameProperty: 'Name'});
  add('Control', 'FrameworkElement', {
    Background: 'Brush', Foreground: 'Brush', BorderBrush: 'Brush', BorderThickness: 'Thickness', Padding: 'Thickness', CornerRadius: 'CornerRadius', FontFamily: 'String', FontSize: 'Double', FontWeight: 'FontWeight', FontStyle: enumeration('Normal', 'Italic', 'Oblique'), FontStretch: 'String', CharacterSpacing: 'Int32',
    BackgroundSizing:enumeration('InnerBorderEdge','OuterBorderEdge'),UseSystemFocusVisuals:'Boolean',FocusVisualMargin:'Thickness',
    IsEnabled: 'Boolean', IsTabStop: 'Boolean', TabIndex: 'Int32', Template: 'Object', HorizontalContentAlignment: enumeration('Left', 'Center', 'Right', 'Stretch'), VerticalContentAlignment: enumeration('Top', 'Center', 'Bottom', 'Stretch')
  });
  add('ContentControl', 'Control', {Content: 'Object', ContentTemplate: 'Object', ContentTemplateSelector: 'Object'}, 'Content');
  add('UserControl', 'Control', {Content: 'Object'}, 'Content');
  add('Page', 'UserControl', {TopAppBar: 'Object', BottomAppBar: 'Object', NavigationCacheMode: 'String'});
  add('Window', 'DependencyObject', {Title: 'String', Content: 'Object', Width: 'Double', Height: 'Double', Resources: {type: 'Object', dictionary: true}, Activated: event('sender', 'e'), Closed: event('sender', 'e')}, 'Content');
  add('Application', 'DependencyObject', {Resources: {type: 'Object', dictionary: true}, RequestedTheme: enumeration('Light', 'Dark')});
  add('Panel', 'FrameworkElement', {Children: collection('UIElement'), Background: 'Brush', Padding: 'Thickness', BorderBrush: 'Brush', BorderThickness: 'Thickness', CornerRadius: 'CornerRadius'}, 'Children');
  add('Canvas', 'Panel', {Left: attached('Double'), Top: attached('Double'), ZIndex: attached('Int32')});
  add('Grid', 'Panel', {RowDefinitions: collection('RowDefinition'), ColumnDefinitions: collection('ColumnDefinition'), RowSpacing: 'Double', ColumnSpacing: 'Double', Row: attached('Int32'), Column: attached('Int32'), RowSpan: attached('Int32'), ColumnSpan: attached('Int32')});
  add('StackPanel', 'Panel', {Orientation: enumeration('Horizontal', 'Vertical'), Spacing: 'Double'});
  add('RelativePanel', 'Panel', Object.fromEntries(['Above', 'Below', 'LeftOf', 'RightOf', 'AlignTopWith', 'AlignBottomWith', 'AlignLeftWith', 'AlignRightWith', 'AlignHorizontalCenterWith', 'AlignVerticalCenterWith'].map(n => [n, attached('Object')])));
  add('RowDefinition', 'DependencyObject', {Height: 'GridLength', MinHeight: 'Double', MaxHeight: 'Length'});
  add('ColumnDefinition', 'DependencyObject', {Width: 'GridLength', MinWidth: 'Double', MaxWidth: 'Length'});
  add('Border', 'FrameworkElement', {Child: 'Object', Background: 'Brush', BorderBrush: 'Brush', BorderThickness: 'Thickness', Padding: 'Thickness', CornerRadius: 'CornerRadius'}, 'Child');
  add('Viewbox', 'FrameworkElement', {Child: 'Object', Stretch: enumeration('None', 'Fill', 'Uniform', 'UniformToFill'), StretchDirection: enumeration('UpOnly', 'DownOnly', 'Both')}, 'Child');
  add('ButtonBase', 'ContentControl', {Click: event('sender', 'e'), Command: 'Object', CommandParameter: 'Object', ClickMode: enumeration('Release', 'Press', 'Hover')});
  add('Button', 'ButtonBase', {Flyout: 'Object'}); add('RepeatButton', 'ButtonBase', {Delay: 'Int32', Interval: 'Int32'});
  add('ToggleButton', 'ButtonBase', {IsChecked: {type: 'Boolean', nullable: true}, IsThreeState: 'Boolean', Checked: event('sender', 'e'), Unchecked: event('sender', 'e'), Indeterminate: event('sender', 'e')});
  add('CheckBox', 'ToggleButton'); add('RadioButton', 'ToggleButton', {GroupName: 'String'});
  add('ToggleSwitch', 'Control', {Header:'Object',IsOn:'Boolean',OnContent:'Object',OffContent:'Object',Toggled:event('sender','e')});
  add('HyperlinkButton', 'ButtonBase', {NavigateUri: 'String'});
  add('TextBlock', 'FrameworkElement', {Text: 'String', Foreground: 'Brush', FontFamily: 'String', FontSize: 'Double', FontWeight: 'FontWeight', FontStyle: enumeration('Normal', 'Italic', 'Oblique'), TextWrapping: enumeration('NoWrap', 'Wrap', 'WrapWholeWords'), TextTrimming: enumeration('None', 'CharacterEllipsis', 'WordEllipsis', 'Clip'), TextAlignment: enumeration('Left', 'Center', 'Right', 'Justify', 'DetectFromContent'), Inlines: collection('Inline'), IsTextSelectionEnabled: 'Boolean', MaxLines: 'Int32', LineHeight: 'Double',LineStackingStrategy:enumeration('MaxHeight','BlockLineHeight','BaselineToBaseline'),TextLineBounds:enumeration('Full','TrimToCapHeight','TrimToBaseline','Tight'),OpticalMarginAlignment:enumeration('None','TrimSideBearings')}, 'Inlines');
  add('TextBox', 'Control', {Text: 'String', Header: 'Object', PlaceholderText: 'String', AcceptsReturn: 'Boolean', IsReadOnly: 'Boolean', MaxLength: 'Int32', TextWrapping: enumeration('NoWrap', 'Wrap', 'WrapWholeWords'), TextAlignment: enumeration('Left', 'Center', 'Right', 'Justify', 'DetectFromContent'), SelectionStart: 'Int32', SelectionLength: 'Int32', TextChanged: event('sender', 'e'), SelectionChanged: event('sender', 'e'), BeforeTextChanging: event('sender', 'e')});
  add('PasswordBox', 'Control', {Password: 'String', PasswordChar: 'String', MaxLength: 'Int32', PlaceholderText: 'String', Header: 'Object', PasswordChanged: event('sender', 'e')});
  add('RichEditBox', 'Control', {Document: 'Object', Header: 'Object', IsReadOnly: 'Boolean', AcceptsReturn: 'Boolean', TextChanged: event('sender', 'e')});
  add('Inline', 'DependencyObject', {FontWeight: 'FontWeight', FontStyle: 'String', Foreground: 'Brush'});
  add('Run', 'Inline', {Text: 'String'}, 'Text'); add('LineBreak', 'Inline'); add('Span', 'Inline', {Inlines: collection('Inline')}, 'Inlines'); add('Bold', 'Span'); add('Italic', 'Span'); add('Underline', 'Span'); add('Hyperlink', 'Span', {NavigateUri: 'String', Click: event('sender', 'e')});
  add('ItemsControl', 'Control', {Items: collection('Object'), ItemsSource: 'Object', ItemTemplate: 'Object', ItemTemplateSelector: 'Object', ItemContainerStyle: 'Object', ItemsPanel: 'Object'}, 'Items');
  add('Selector', 'ItemsControl', {SelectedIndex: 'Int32', SelectedItem: 'Object', SelectedValue: 'Object', SelectedValuePath: 'String', DisplayMemberPath: 'String', SelectionChanged: event('sender', 'e')});
  add('ListBox', 'Selector', {SelectionMode: enumeration('Single', 'Multiple', 'Extended')}); add('ListBoxItem', 'ContentControl', {IsSelected: 'Boolean'});
  add('ComboBox', 'Selector', {IsEditable: 'Boolean', Text: 'String', PlaceholderText: 'String', Header: 'Object', IsDropDownOpen: 'Boolean'}); add('ComboBoxItem', 'ListBoxItem');
  add('ListView', 'Selector', {SelectionMode: enumeration('None', 'Single', 'Multiple', 'Extended'), IsItemClickEnabled: 'Boolean', ItemClick: event('sender', 'e')}); add('GridView', 'ListView'); add('ListViewItem', 'ListBoxItem');
  add('TreeView', 'Control', {RootNodes: collection('TreeViewNode'), ItemsSource: 'Object', ItemTemplate: 'Object', SelectionMode: enumeration('None', 'Single', 'Multiple'), SelectedItem: 'Object', SelectionChanged: event('sender', 'e')});
  add('TreeViewNode', 'DependencyObject', {Content: 'Object', Children: collection('TreeViewNode'), IsExpanded: 'Boolean'}, 'Content');
  add('RangeBase', 'Control', {Minimum: 'Double', Maximum: 'Double', Value: 'Double', SmallChange: 'Double', LargeChange: 'Double', ValueChanged: event('sender', 'e')});
  add('Slider', 'RangeBase', {Orientation: enumeration('Horizontal', 'Vertical'), StepFrequency: 'Double', TickFrequency: 'Double'}); add('ProgressBar', 'RangeBase', {IsIndeterminate: 'Boolean', ShowError: 'Boolean', ShowPaused: 'Boolean'});
  add('ScrollBar', 'RangeBase', {Orientation: enumeration('Horizontal', 'Vertical'), ViewportSize: 'Double', Scroll: event('sender', 'e')});
  add('ScrollViewer', 'ContentControl', {HorizontalScrollBarVisibility: enumeration('Disabled', 'Auto', 'Hidden', 'Visible'), VerticalScrollBarVisibility: enumeration('Disabled', 'Auto', 'Hidden', 'Visible'), HorizontalScrollMode: 'String', VerticalScrollMode: 'String', ZoomMode: 'String', ViewChanged: event('sender', 'e')});
  add('Image', 'FrameworkElement', {Source: 'ImageSource', Stretch: enumeration('None', 'Fill', 'Uniform', 'UniformToFill')});
  add('BitmapImage', 'DependencyObject', {UriSource: 'String', DecodePixelWidth: 'Int32', DecodePixelHeight: 'Int32'});
  add('Shape', 'FrameworkElement', {Fill: 'Brush', Stroke: 'Brush', StrokeThickness: 'Double', StrokeDashArray: 'DoubleCollection', Stretch: 'String'});
  add('Rectangle', 'Shape', {RadiusX: 'Double', RadiusY: 'Double'}); add('Ellipse', 'Shape'); add('Line', 'Shape', {X1: 'Double', Y1: 'Double', X2: 'Double', Y2: 'Double'}); add('Path', 'Shape', {Data: 'String'}); add('Polygon', 'Shape', {Points: 'String'}); add('Polyline', 'Shape', {Points: 'String'});
  add('Brush', 'DependencyObject', {Opacity: 'Double', Transform: 'Object', RelativeTransform: 'Object'}); add('SolidColorBrush', 'Brush', {Color: 'Color'});
  add('GradientBrush', 'Brush', {GradientStops: collection('GradientStop'), MappingMode: 'String', SpreadMethod: 'String'}, 'GradientStops');
  add('LinearGradientBrush', 'GradientBrush', {StartPoint: 'Point', EndPoint: 'Point'}); add('GradientStop', 'DependencyObject', {Color: 'Color', Offset: 'Double'});
  add('ResourceDictionary', 'DependencyObject', {Source: 'String', MergedDictionaries: collection('ResourceDictionary'), ThemeDictionaries: {type: 'Object', dictionary: true}, Items: {type: 'Object', dictionary: true}}, 'Items', {dictionary: true});
  add('XamlControlsResources', 'ResourceDictionary', {}, 'Items', {dictionary:true});
  add('Style', 'DependencyObject', {TargetType: 'Type', BasedOn: 'Object', Setters: collection('Setter')}, 'Setters');
  add('Setter', 'DependencyObject', {Property: 'String', Value: 'Object', Target: 'String'});
  add('FrameworkTemplate', 'DependencyObject', {Content: 'Object'}, 'Content', {template: true}); add('ControlTemplate', 'FrameworkTemplate', {TargetType: 'Type'}, 'Content', {template: true}); add('DataTemplate', 'FrameworkTemplate', {}, 'Content', {template: true}); add('ItemsPanelTemplate', 'FrameworkTemplate', {}, 'Content', {template: true});
  add('Binding', 'DependencyObject', {Path: 'String', Mode: enumeration('OneTime', 'OneWay', 'TwoWay'), ElementName: 'String', Source: 'Object', RelativeSource: 'Object', Converter: 'Object', ConverterParameter: 'Object', ConverterLanguage: 'String', FallbackValue: 'Object', TargetNullValue: 'Object', UpdateSourceTrigger: enumeration('Default', 'PropertyChanged', 'Explicit', 'LostFocus')});
  add('RelativeSource', 'DependencyObject', {Mode: enumeration('None', 'TemplatedParent', 'Self')});
  add('VisualStateManager', 'DependencyObject', {VisualStateGroups: attached('Object', {collection: true})});
  add('VisualStateGroup', 'DependencyObject', {Name: 'String', States: collection('VisualState'), Transitions: collection('VisualTransition')}, 'States');
  add('VisualState', 'DependencyObject', {Name: 'String', Storyboard: 'Object', Setters: collection('Setter'), StateTriggers: collection('StateTriggerBase')}, 'Storyboard');
  add('VisualTransition', 'DependencyObject', {From: 'String', To: 'String', GeneratedDuration: 'String', Storyboard: 'Object'}, 'Storyboard');
  add('StateTriggerBase', 'DependencyObject'); add('StateTrigger', 'StateTriggerBase', {IsActive: 'Boolean'}); add('AdaptiveTrigger', 'StateTriggerBase', {MinWindowWidth: 'Double', MinWindowHeight: 'Double'});
  add('Timeline', 'DependencyObject', {Duration: 'String', BeginTime: 'String', RepeatBehavior: 'String', AutoReverse: 'Boolean', SpeedRatio: 'Double', FillBehavior: enumeration('HoldEnd', 'Stop'), Completed: event('sender', 'e')});
  add('Storyboard', 'Timeline', {Children: collection('Timeline'), TargetName: attached('String'), TargetProperty: attached('String')}, 'Children');
  for (const [name, valueType] of [['DoubleAnimation', 'Double'], ['ColorAnimation', 'Color'], ['PointAnimation', 'Point']]) add(name, 'Timeline', {From: valueType, To: valueType, By: valueType, EasingFunction: 'Object', EnableDependentAnimation: 'Boolean'});
  add('Transform', 'DependencyObject'); add('TransformGroup', 'Transform', {Children: collection('Transform')}, 'Children');
  add('TranslateTransform', 'Transform', {X: 'Double', Y: 'Double'}); add('ScaleTransform', 'Transform', {ScaleX: 'Double', ScaleY: 'Double', CenterX: 'Double', CenterY: 'Double'}); add('RotateTransform', 'Transform', {Angle: 'Double', CenterX: 'Double', CenterY: 'Double'}); add('SkewTransform', 'Transform', {AngleX: 'Double', AngleY: 'Double', CenterX: 'Double', CenterY: 'Double'}); add('MatrixTransform', 'Transform', {Matrix: 'String'});
  add('ToolTipService', 'DependencyObject', {ToolTip: attached('Object'), Placement: attached('String'), IsEnabled: attached('Boolean')});
  add('AutomationProperties', 'DependencyObject', Object.fromEntries(['Name', 'AutomationId', 'HelpText', 'ItemType', 'ItemStatus', 'LabeledBy'].map(n => [n, attached('String')])));
  for (const name of ['String', 'Double', 'Int32', 'Boolean']) schema.registerType(XAML_NS, name, {primitive: name, contentProperty: '$value', members: {$value: name}});
  for (const name of ['Thickness', 'CornerRadius', 'Color', 'GridLength', 'Point']) schema.registerType(PRESENTATION_NS, name, {primitive: name, contentProperty: '$value', members: {$value: name}});
  // WinUI supports both presentation XML names and its public controls namespace.
  // Register real schema aliases with base identity retained, never local-name
  // matching that would accidentally lower a foreign Button to a native control.
  for(const name of ['XamlControlsResources','Page','UserControl','Control','ContentControl','Canvas','Grid','StackPanel','RelativePanel','Border','Viewbox','Button','RepeatButton','ToggleButton','CheckBox','RadioButton','ToggleSwitch','HyperlinkButton','TextBlock','TextBox','PasswordBox','RichEditBox','ItemsControl','ListBox','ListBoxItem','ComboBox','ComboBoxItem','ListView','ListViewItem','GridView','TreeView','TreeViewNode','Slider','ProgressBar','ScrollViewer','Image']) {
    const base=schema.getType(PRESENTATION_NS,name);
    schema.registerType(WINUI_CONTROLS_NS,name,{base:{namespaceURI:PRESENTATION_NS,name},dictionary:!!base.dictionary});
  }
  return schema;
}
export function convertValue(value, member = {type: 'String'}) {
  const type = member.type ?? 'String';
  if (value === null) { if (member.nullable || ['Object', 'String', 'Brush', 'ImageSource'].includes(type)) return null; throw new TypeError('Null is not valid for ' + type + '.'); }
  const text = String(value), trimmed = text.trim();
  if (type === 'String' || type === 'Object' || type === 'Type' || type === 'Brush' || type === 'ImageSource' || type === 'Color' || type === 'FontWeight') return text;
  if (type === 'Json') return JSON.parse(text);
  if (type === 'Boolean') { if (/^true$/i.test(trimmed)) return true; if (/^false$/i.test(trimmed)) return false; throw new TypeError('Expected True or False.'); }
  if (type === 'Enum') { const found = member.values?.find(v => v.toLowerCase() === trimmed.toLowerCase()); if (found !== undefined) return found; throw new TypeError('Expected ' + member.values.join(', ') + '.'); }
  if (type === 'Length' && /^(auto|infinity)$/i.test(trimmed)) return /^auto$/i.test(trimmed) ? 'Auto' : 'Infinity';
  if (['Double', 'Length', 'Int32', 'Number'].includes(type)) {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) throw new TypeError('Expected a finite ' + type + '.');
    const number = Number(trimmed); if (!Number.isFinite(number) || type === 'Int32' && (!Number.isInteger(number) || number < -2147483648 || number > 2147483647)) throw new TypeError('Value is outside ' + type + ' range.'); return number;
  }
  if (type === 'GridLength') {
    if (/^auto$/i.test(trimmed)) return {unit: 'auto', value: 1};
    const star = trimmed.endsWith('*'), n = star && trimmed === '*' ? 1 : convertValue(star ? trimmed.slice(0, -1) : trimmed, {type: 'Double'});
    if (n < 0) throw new TypeError('Grid length cannot be negative.'); return {unit: star ? 'star' : 'pixel', value: n};
  }
  if (['Thickness', 'CornerRadius', 'Point', 'DoubleCollection'].includes(type)) {
    const values = trimmed.split(/[\s,]+/).map(v => convertValue(v, {type: 'Double'}));
    const counts = type === 'Point' ? [2] : type === 'DoubleCollection' ? null : type === 'CornerRadius' ? [1, 4] : [1, 2, 4];
    if (counts && !counts.includes(values.length)) throw new TypeError('Expected ' + counts.join(', ') + ' numeric component(s).');
    if (type === 'Thickness') return values.length === 1 ? Array(4).fill(values[0]) : values.length === 2 ? [values[0], values[1], values[0], values[1]] : values;
    if (type === 'CornerRadius') return values.length === 1 ? Array(4).fill(values[0]) : values; return values;
  }
  if (typeof member.convert === 'function') return member.convert(value);
  return value;
}
