/** Explicit MSHTML-style facades. Neither side traverses a browser object's
 * prototype by a caller-supplied name. Names/operations are shared with the
 * isolated document agent, not discovered by executing imported VB code.
 */
const property = (name, dom = name[0].toLowerCase() + name.slice(1), write = false, result = 'value') => ({name, dom, modes: write ? [2,4,8] : [2], params: [], result});
const method = (name, params = [], result = 'value', dom = name[0].toLowerCase() + name.slice(1)) => ({name, dom, modes: [1], params: params.map(name => ({name: name.replace(/\?$/, ''), optional: name.endsWith('?')})), result});
const props = (names, write = false) => names.split(' ').map(name => property(name, undefined, write));
const objects = names => names.split(' ').map(name => property(name, undefined, false, 'object'));
export const WEB_DOM_TYPES = Object.freeze({
  document: [
    property('URL','URL'), ...props('Title DesignMode',true), ...props('ReadyState CharacterSet ContentType CompatMode'),
    ...objects('Body Head DocumentElement ActiveElement Forms Images Links Anchors Scripts All'),
    property('ParentWindow','defaultView',false,'object'), property('DefaultView','defaultView',false,'object'), property('Location','location',false,'object'),
    method('Open',['Mime?','Replace?']), method('Write',['Text']), method('Writeln',['Text']), method('Close'),
    method('CreateElement',['Tag'],'object'), method('CreateTextNode',['Text'],'object'),
    method('GetElementById',['Id'],'object'), method('GetElementsByName',['Name'],'object'), method('GetElementsByTagName',['Tag'],'object'),
    method('QuerySelector',['Selector'],'object'), method('QuerySelectorAll',['Selector'],'object'),
    method('ExecCommand',['Command','ShowUI?','Value?']), method('QueryCommandSupported',['Command']),
    method('QueryCommandEnabled',['Command']), method('QueryCommandState',['Command']), method('QueryCommandValue',['Command']), method('HasFocus')
  ],
  element: [
    ...props('Id ClassName InnerHTML OuterHTML InnerText TextContent NodeValue Title Value Checked Disabled Name Type Src Href Target Selected SelectedIndex Multiple ReadOnly ContentEditable TabIndex ScrollTop ScrollLeft Hidden Text HtmlFor Width Height',true),
    ...props('TagName NodeName NodeType OffsetWidth OffsetHeight OffsetLeft OffsetTop ClientWidth ClientHeight ScrollWidth ScrollHeight'),
    ...objects('OwnerDocument ParentElement ParentNode Children ChildNodes FirstChild LastChild NextSibling PreviousSibling FirstElementChild LastElementChild NextElementSibling PreviousElementSibling Attributes Style Options Elements Form'),
    method('GetAttribute',['Name','Flags?']),method('SetAttribute',['Name','Value','Flags?']),method('RemoveAttribute',['Name','Flags?']),method('HasAttribute',['Name']),
    method('Click'),method('Focus'),method('Blur'),method('Select'),method('SetSelectionRange',['Start','End','Direction?']),
    method('AppendChild',['Node'],'object'),method('InsertBefore',['Node','Before'],'object'),method('RemoveChild',['Node'],'object'),method('ReplaceChild',['Node','Old'],'object'),method('CloneNode',['Deep?'],'object'),method('Remove'),
    method('InsertAdjacentHTML',['Position','HTML']),method('GetElementsByTagName',['Tag'],'object'),method('QuerySelector',['Selector'],'object'),method('QuerySelectorAll',['Selector'],'object'),method('Matches',['Selector']),method('Contains',['Node']),method('ScrollIntoView',['AlignToTop?'])
  ],
  collection: [property('Length','length'),property('Count','length'),method('Item',['Index','SubIndex?'],'object'),method('NamedItem',['Name'],'object'),method('Tags',['Name'],'object')],
  style: [...props('CssText Color BackgroundColor Background Display Visibility Position Left Top Right Bottom Width Height Margin Padding Border Font FontFamily FontSize FontWeight FontStyle TextAlign Overflow Opacity',true),method('SetProperty',['Name','Value','Priority?']),method('GetPropertyValue',['Name']),method('RemoveProperty',['Name'])],
  window: [...objects('Document Location'),...props('Name Status',true),property('Closed','closed'),method('ExecScript',['Script','Language?']),method('Print'),method('ScrollTo',['X','Y']),method('ScrollBy',['X','Y']),method('Focus'),method('Blur')],
  location: [...props('Href Protocol Host Hostname Port Pathname Search Hash',true),property('Origin','origin'),method('Assign',['URL']),method('Replace',['URL']),method('Reload')],
  attribute: [...props('Name Specified'),property('Value','value',true),property('NodeValue','nodeValue',true)]
});
const longMembers=new Set('SelectedIndex TabIndex ScrollTop ScrollLeft NodeType OffsetWidth OffsetHeight OffsetLeft OffsetTop ClientWidth ClientHeight ScrollWidth ScrollHeight Width Height'.split(' '));
for (const [kind,members] of Object.entries(WEB_DOM_TYPES)) {
  for (const m of members) { if (kind==='collection'&&['Length','Count'].includes(m.name)||kind==='element'&&longMembers.has(m.name)) m.scalar='Long'; m.params.forEach(Object.freeze); Object.freeze(m.params); Object.freeze(m.modes); Object.freeze(m); }
  Object.freeze(members);
}
