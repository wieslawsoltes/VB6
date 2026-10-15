/** Public metadata for the browser common-control implementation. */
import {CONTROL_EVENT_SIGNATURES} from '../controls/compatibility-contract.js';
export function installControlTypeCatalog({add,get,member,method,props,enumType}){
  const extend=(name,items)=>{const type=get(name);type.members=[...new Map([...type.members,...items].map(item=>[item.name.toLowerCase()+(item.kind==='event'?':event':''),item])).values()];};
  const indexed=(name,type,args)=>member(name,type,args,{kind:'property'});
  for(const [name,item,args]of [
    ['ListSubItems','ListSubItem','Optional Index As Long, Optional Key As String, Optional Text As String, Optional ReportIcon As Variant, Optional ToolTipText As String'],
    ['ButtonMenus','ButtonMenu','Optional Index As Long, Optional Key As String, Optional Text As String']
  ])add(name,[member('Count','Long',null,{readOnly:true}),indexed('Item',item,'Index As Variant'),method('Add',args,item),method('Remove','Index As Variant'),method('Clear')],{defaultMember:'Item',creatable:false});
  add('ListSubItem',[...props('String','Key Text Tag ToolTipText'),member('Index','Long',null,{readOnly:true}),member('ReportIcon'),member('Bold','Boolean'),member('ForeColor','ColorConstants')],{creatable:false});
  add('ButtonMenu',[...props('String','Key Text Tag'),member('Index','Long',null,{readOnly:true}),...props('Boolean','Enabled Visible Checked')],{creatable:false});
  extend('Node',[
    ...props('Boolean','Bold Checked Sorted'),...props('ColorConstants','ForeColor BackColor'),member('FullPath','String',null,{readOnly:true}),member('ExpandedImage'),
    ...['Root','FirstSibling','LastSibling','Next','Previous'].map(name=>member(name,'Node',null,{readOnly:true})),
    method('Move','Optional Relative As Variant, Optional Relationship As TreeRelationshipConstants = 4'),method('EnsureVisible','','Boolean'),
  ]);
  extend('Nodes',[method('Add','Optional Relative As Variant, Optional Relationship As TreeRelationshipConstants = 2, Optional Key As String, Optional Text As String, Optional Image As Variant, Optional SelectedImage As Variant','Node')]);
  extend('ListItem',[member('ListSubItems','ListSubItems'),indexed('SubItems','String','Index As Long'),...props('String','ToolTipText'),member('Bold','Boolean'),member('ForeColor','ColorConstants')]);
  extend('ColumnHeader',[...props('String','Tag'),member('Icon'),member('SubItemIndex','Long',null,{readOnly:true}),member('Alignment','ListColumnAlignmentConstants')]);
  extend('ColumnHeaders',[method('Add','Optional Index As Long, Optional Key As String, Optional Text As String, Optional Width As Single = 1440, Optional Alignment As ListColumnAlignmentConstants, Optional Icon As Variant','ColumnHeader')]);
  extend('Button',[member('ButtonMenus','ButtonMenus'),member('Style','ToolbarStyleConstants'),member('Value','ToolbarValueConstants'),member('MixedState','Boolean'),member('Description','String'),...props('Single','Width Height Left Top')]);
  extend('Panel',[...props('String','Tag ToolTipText'),member('Style','PanelStyleConstants'),member('AutoSize','PanelAutoSizeConstants'),member('MinWidth','Single'),member('Bevel','PanelBevelConstants'),member('Alignment','PanelAlignmentConstants'),member('Picture')]);
  extend('Tab',[...props('Boolean','Enabled Visible'),member('ToolTipText','String')]);
  for(const type of ['Nodes','ListItems','ColumnHeaders','Buttons','Panels','Tabs','ListImages','ListSubItems','ButtonMenus'])extend(type,[member('Count','Long',null,{readOnly:true})]);
  for(const type of ['Node','ListItem','ColumnHeader','Button','Panel','Tab','ListImage'])extend(type,[member('Index','Long',null,{readOnly:true})]);
  for(const type of ['TreeView','ListView'])extend(type,[method('HitTest','X As Single, Y As Single',type==='TreeView'?'Node':'ListItem'),method('GetFirstVisible','',type==='TreeView'?'Node':'ListItem'),method('GetVisibleCount','','Long'),method('StartLabelEdit'),...props('Boolean','HideSelection CheckBoxes HotTracking')]);
  extend('TreeView',[member('Style','TreeStyleConstants'),member('ImageList','ImageList'),member('Indentation','Single')]);
  extend('ListView',[method('FindItem','Text As String, Optional Where As ListFindConstants, Optional Index As Long = 1, Optional Match As ListMatchConstants','ListItem'),...props('Boolean','MultiSelect HideColumnHeaders AllowColumnReorder GridLines'),member('Icons','ImageList'),member('SmallIcons','ImageList')]);
  for(const type of ['ListBox','ComboBox','FileListBox','DirListBox','DriveListBox']){
    if(!get(type))continue;
    extend(type,[method('AddItem','Item As String, Optional Index As Integer'),method('RemoveItem','Index As Integer'),method('Clear'),indexed('List','String','Index As Integer'),indexed('ItemData','Long','Index As Integer'),indexed('Selected','Boolean','Index As Integer'),member('ListCount','Integer',null,{readOnly:true}),member('NewIndex','Integer',null,{readOnly:true}),member('SelCount','Integer',null,{readOnly:true})]);
  }
  for(const type of ['MSFlexGrid','MSHFlexGrid','DataGrid'])extend(type,[
    ...props('Long','Row Col RowSel ColSel Rows Cols FixedRows FixedCols'),member('Clip','String'),member('Text','String'),
    indexed('TextMatrix','String','Row As Long, Col As Long'),indexed('TextArray','String','Index As Long'),
    ...['RowHeight','ColWidth','RowPos','ColPos'].map(name=>indexed(name,'Single',(name.startsWith('Row')?'Row':'Col')+' As Long')),
    ...['RowData','ColData'].map(name=>indexed(name,'Long',(name.startsWith('Row')?'Row':'Col')+' As Long')),
    ...['ColAlignment','ColAlignmentFixed'].map(name=>indexed(name,'GridAlignmentConstants','Col As Long')),
    member('FillStyle','GridFillConstants'),member('SelectionMode','GridSelectionConstants'),member('CellAlignment','GridAlignmentConstants'),...props('ColorConstants','CellBackColor CellForeColor'),
    ...props('Boolean','CellFontBold CellFontItalic CellFontUnderline CellFontStrikeThrough WordWrap AllowBigSelection'),member('CellFontSize','Single'),member('CellFontName','String'),
    method('AddItem','Item As String, Optional Index As Long'),method('RemoveItem','Index As Long'),method('Clear')
  ]);
  extend('DTPicker',[member('Value','Variant'),member('Format','DateFormatConstants'),...props('Date','MinDate MaxDate'),...props('Boolean','CheckBox UpDown'),...props('Variant','Year Month Day DayOfWeek Hour Minute Second')]);
  extend('MonthView',[...props('Date','Value MinDate MaxDate SelStart SelEnd'),...props('Boolean','MultiSelect ShowToday ShowWeekNumbers ShowTodayCircle'),...props('Integer','Year Month Day DayOfWeek'),member('StartOfWeek','MonthWeekdayConstants'),indexed('DayBold','Boolean','Date As Date'),indexed('VisibleDays','Date','Index As Integer')]);
  extend('CommonDialog',[...props('Boolean','CancelError FontBold FontItalic FontUnderline FontStrikethru'),...props('Single','Min Max FontSize'),...props('String','FontName FileTitle DefaultExt InitDir'),member('Color','ColorConstants')]);
  extend('Toolbar',[member('ImageList','ImageList'),member('TextAlignment','ToolbarTextAlignmentConstants'),...props('Single','ButtonWidth ButtonHeight'),member('Wrappable','Boolean')]);
  for(const [type,events]of Object.entries(CONTROL_EVENT_SIGNATURES))extend(type,Object.entries(events).map(([name,signature])=>({name,kind:'event',type:'Void',signature:name+'('+signature+')',params:signature?signature.split(', '):[]})));
  for(const [name,pattern]of Object.entries({
    TreeRelationshipConstants:/^tvw(?:First|Last|Next|Previous|Child)$/,TreeStyleConstants:/^tvw(?:TextOnly|PictureText|PlusMinusText|PlusPictureText|Treelines.*)$/,
    ListColumnAlignmentConstants:/^lvwColumn/,ListFindConstants:/^lvw(?:Text|SubItem|Tag)$/,ListMatchConstants:/^lvw(?:Whole|Partial)$/,
    ToolbarStyleConstants:/^tbr(?:Default|Check|ButtonGroup|Separator|Placeholder|Dropdown)$/,ToolbarValueConstants:/^tbr(?:Unpressed|Pressed)$/,ToolbarTextAlignmentConstants:/^tbrTextAlign/,
    PanelStyleConstants:/^sbr(?:Text|Caps|Num|Ins|Scrl|Time|Date)$/,PanelAutoSizeConstants:/^sbr(?:NoAutoSize|Spring|Contents)$/,PanelAlignmentConstants:/^sbr(?:Left|Center|Right)$/,PanelBevelConstants:/^sbr(?:NoBevel|Inset|Raised)$/,
    GridAlignmentConstants:/^flexAlign/,GridFillConstants:/^flexFill/,GridSelectionConstants:/^flexSelection/,DateFormatConstants:/^dtp/,MonthWeekdayConstants:/^mvw/
  }))enumType(name,pattern);
}
