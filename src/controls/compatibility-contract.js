/** One source of truth for the public control contracts used by the VM/editor.
 * These describe implemented browser behavior, not permission to host native OCXs.
 */
export const CONTROL_CONSTANTS=Object.freeze({
  tvwFirst:0,tvwLast:1,tvwNext:2,tvwPrevious:3,tvwChild:4,
  tvwTextOnly:0,tvwPictureText:1,tvwPlusMinusText:2,tvwPlusPictureText:3,
  tvwTreelinesText:4,tvwTreelinesPictureText:5,tvwTreelinesPlusMinusText:6,tvwTreelinesPlusMinusPictureText:7,
  tvwAutomatic:0,tvwManual:1,tvwTreeLines:0,tvwRootLines:1,
  lvwIcon:0,lvwSmallIcon:1,lvwList:2,lvwReport:3,lvwAscending:0,lvwDescending:1,
  lvwText:0,lvwSubItem:1,lvwTag:2,lvwWhole:0,lvwPartial:1,lvwAutomatic:0,lvwManual:1,
  lvwColumnLeft:0,lvwColumnRight:1,lvwColumnCenter:2,
  tbrDefault:0,tbrCheck:1,tbrButtonGroup:2,tbrSeparator:3,tbrPlaceholder:4,tbrDropdown:5,
  tbrUnpressed:0,tbrPressed:1,tbrTextAlignBottom:0,tbrTextAlignRight:1,
  sbrNormal:0,sbrSimple:1,sbrNoAutoSize:0,sbrSpring:1,sbrContents:2,
  sbrText:0,sbrCaps:1,sbrNum:2,sbrIns:3,sbrScrl:4,sbrTime:5,sbrDate:6,
  sbrLeft:0,sbrCenter:1,sbrRight:2,sbrNoBevel:0,sbrInset:1,sbrRaised:2,
  flexFillSingle:0,flexFillRepeat:1,flexSelectionFree:0,flexSelectionByRow:1,flexSelectionByColumn:2,
  flexAlignLeftTop:0,flexAlignLeftCenter:1,flexAlignLeftBottom:2,
  flexAlignCenterTop:3,flexAlignCenterCenter:4,flexAlignCenterBottom:5,
  flexAlignRightTop:6,flexAlignRightCenter:7,flexAlignRightBottom:8,flexAlignGeneral:9,
  dtpLongDate:0,dtpShortDate:1,dtpTime:2,dtpCustom:3,
  mvwSunday:1,mvwMonday:2,mvwTuesday:3,mvwWednesday:4,mvwThursday:5,mvwFriday:6,mvwSaturday:7,
});
const labelEvents={BeforeLabelEdit:'Cancel As Integer',AfterLabelEdit:'Cancel As Integer, NewString As String'};
export const CONTROL_EVENT_SIGNATURES=Object.freeze({
  TreeView:{...labelEvents,NodeClick:'ByVal Node As Node',NodeCheck:'ByVal Node As Node',Expand:'ByVal Node As Node',Collapse:'ByVal Node As Node'},
  ListView:{...labelEvents,ItemClick:'ByVal Item As ListItem',ItemCheck:'ByVal Item As ListItem',ColumnClick:'ByVal ColumnHeader As ColumnHeader'},
  Toolbar:{ButtonClick:'ByVal Button As Button',ButtonDropDown:'ByVal Button As Button',ButtonMenuClick:'ByVal ButtonMenu As ButtonMenu'},
  StatusBar:{PanelClick:'ByVal Panel As Panel',PanelDblClick:'ByVal Panel As Panel'},
  MonthView:{Change:'',DateClick:'ByVal DateClicked As Date',DateDblClick:'ByVal DateClicked As Date',SelChange:'ByVal StartDate As Date, ByVal EndDate As Date',GetDayBold:'ByVal StartDate As Date, ByVal Count As Integer, State() As Boolean'},
  DTPicker:{Change:'',DropDown:'',CloseUp:'',Format:'ByVal CallbackField As String, FormattedString As String',FormatSize:'ByVal CallbackField As String, Size As Long'},
  MSFlexGrid:{RowColChange:'',SelChange:''},
  MSHFlexGrid:{RowColChange:'',SelChange:''},
  DataGrid:{RowColChange:'',SelChange:'',BeforeColUpdate:'ByVal ColIndex As Integer, OldValue As Variant, Cancel As Integer',AfterColUpdate:'ByVal ColIndex As Integer'},
});
export function controlEventSignature(type,event){return CONTROL_EVENT_SIGNATURES[type]?.[event];}
export const CONTROL_INDEXED_PROPERTIES=Object.freeze(['Item','List','Selected','ItemData','SubItems','TextMatrix','TextArray','ColWidth','RowHeight','ColAlignment','ColAlignmentFixed','ColData','RowData','ColPos','RowPos','DayBold','VisibleDays']);
const indexedNames=new Set(CONTROL_INDEXED_PROPERTIES.map(name=>name.toLowerCase()));
export function controlIndexedProperty(name){return indexedNames.has(name);}
const itemTypes=new WeakMap();
export function markControlItem(item,type){itemTypes.set(item,type);Object.defineProperty(item,'__type',{value:type,configurable:false});return item;}
export function controlItemScalarType(item,name){
  if(!itemTypes.has(item))return null;
  if(['selected','checked','expanded','sorted','enabled','visible','bold','mixedstate'].includes(name))return 'boolean';
  if(['width','height','left','top','minwidth'].includes(name))return 'single';
  if(['index','children','subitemindex','position'].includes(name))return 'long';
  if(['style','alignment','value','autosize','bevel'].includes(name))return 'integer';
  if(['forecolor','backcolor'].includes(name))return 'long';
  return null;
}
