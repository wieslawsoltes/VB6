import {BUILTIN_SIGNATURES} from '../runtime/signatures.js';
import {VB_CONSTANTS} from '../runtime/constants.js';
import {DATA_CONSTANTS} from '../data/common.js';
import {CONTROL_DEFAULTS,createControl,createForm} from '../project/model.js';
import {splitArguments,symbolKey} from './source-context.js';

/** Declarative editor metadata, never reflection over live runtime objects.
 * Adding a catalog entry does not grant native COM/OCX execution capability. */
export const PRIMITIVE_TYPES = Object.freeze('Boolean Byte Currency Date Double Integer Long Object Single String Variant'.split(' '));
export const CONSTANT_VALUES = Object.freeze({...VB_CONSTANTS,...DATA_CONSTANTS});
export const constantSymbol = (name,value,type='Long') => ({name,kind:'constant',type,value,signature:name+' = '+JSON.stringify(value)});
export const CONSTANT_SYMBOLS = Object.freeze(Object.entries(CONSTANT_VALUES).map(([name,value])=>constantSymbol(name,value,typeof value==='string'?'String':'Long')));
const groups = {
  VbMsgBoxStyle:/^vb(?:OKOnly|OKCancel|AbortRetryIgnore|YesNoCancel|YesNo|RetryCancel|Critical|Question|Exclamation|Information|DefaultButton\d|ApplicationModal|SystemModal|MsgBox.*)$/,
  VbMsgBoxResult:/^vb(?:OK|Cancel|Abort|Retry|Ignore|Yes|No)$/,
  VbCompareMethod:/^vb(?:BinaryCompare|TextCompare|UseCompareOption)$/,
  VbDayOfWeek:/^vb(?:UseSystem|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/,
  VbFirstWeekOfYear:/^vb(?:UseSystem|FirstJan1|FirstFourDays|FirstFullWeek)$/,
  VbStrConv:/^vb(?:UpperCase|LowerCase|ProperCase)$/,
  VbCallType:/^vb(?:Method|Get|Let|Set)$/,
  VbScaleMode:/^vb(?:User|Twips|Points|Pixels|Characters|Inches|Millimeters|Centimeters)$/,
  FormShowConstants:/^vb(?:Modal|Modeless)$/,
  WindowStateConstants:/^vb(?:Normal|Minimized|Maximized)$/,
  AlignmentConstants:/^vb(?:LeftJustify|RightJustify|Center)$/,
  CheckBoxConstants:/^vb(?:Unchecked|Checked|Grayed)$/,
  ColorConstants:/^vb(?:Black|Red|Green|Yellow|Blue|Magenta|Cyan|White|ButtonFace|WindowBackground|WindowText|ButtonText)$/,
  KeyCodeConstants:/^vbKey/,
  'ADODB.CursorTypeEnum':/^adOpen/,
  'ADODB.LockTypeEnum':/^adLock/,
  'ADODB.CursorLocationEnum':/^adUse/,
  'ADODB.ObjectStateEnum':/^adState/,
  'ADODB.CommandTypeEnum':/^adCmd/,
  'ADODB.ParameterDirectionEnum':/^adParam/,
  'ADODB.DataTypeEnum':/^ad(?:SmallInt|Integer|Single|Double|Currency|Date|Boolean|Variant|UnsignedTinyInt|BigInt|Binary|Char|WChar|VarChar|LongVarChar|VarWChar|LongVarWChar|VarBinary|LongVarBinary)$/,
};
export const ENUM_TYPES = new Map(Object.entries(groups).map(([name,pattern])=>[symbolKey(name),{name,kind:'enum',members:CONSTANT_SYMBOLS.filter(s=>pattern.test(s.name)).map(s=>({...s,type:name,parentType:name}))}]));
ENUM_TYPES.set('boolean',{name:'Boolean',kind:'enum',members:[constantSymbol('False',0,'Boolean'),constantSymbol('True',-1,'Boolean')]});

export function member(name,type='Variant',params=null,extra={}) {
  const values = params===null ? null : Array.isArray(params)?params:splitArguments(params);
  return {name,kind:values===null?'property':'method',type,signature:name+(values?'('+values.join(', ')+')':'')+(type==='Void'?'':' As '+type),...(values?{params:values}:{}),...extra};
}
const props = (type,names) => names.split(' ').filter(Boolean).map(name=>member(name,type));
const method = (name,params='',type='Void',extra={})=>member(name,type,params,extra);
const catalog = new Map();
function add(name,members,extra={}) {
  const result={name,kind:'class',type:name,members,...extra};catalog.set(symbolKey(name),result);return result;
}
add('ErrObject',[
  ...props('Long','Number HelpContext LastDLLError'),...props('String','Description Source HelpFile'),
  method('Clear'),method('Raise','Number As Long, Optional Source As String, Optional Description As String, Optional HelpFile As String, Optional HelpContext As Long'),
],{defaultMember:'Number'});
add('App',[...props('String','Title EXEName Path'),...props('Integer','Major Minor Revision'),...props('Boolean','PrevInstance TaskVisible')]);
add('Screen',[...props('Single','Width Height TwipsPerPixelX TwipsPerPixelY'),member('MousePointer','Integer'),member('ActiveForm','Form')]);
add('Clipboard',[method('Clear'),method('SetText','Text As String'),method('GetText','','String')]);
add('Debug',[method('Print','ParamArray OutputList() As Variant')]);
add('Collection',[member('Count','Long'),method('Add','Item As Variant, Optional Key As String, Optional Before As Variant, Optional After As Variant'),method('Item','Index As Variant','Variant'),method('Remove','Index As Variant')],{defaultMember:'Item'});
add('Scripting.Dictionary',[
  member('Count','Long'),member('CompareMode','VbCompareMethod'),method('Add','Key As Variant, Item As Variant'),method('Item','Key As Variant','Variant'),method('Exists','Key As Variant','Boolean'),method('Keys','','Variant',{array:true}),method('Items','','Variant',{array:true}),method('Remove','Key As Variant'),method('RemoveAll'),
],{defaultMember:'Item',aliases:['Dictionary']});
add('ADODB.Recordset',[
  member('Fields','ADODB.Fields'),member('ActiveConnection','ADODB.Connection'),member('State','ADODB.ObjectStateEnum'),member('CursorType','ADODB.CursorTypeEnum'),member('LockType','ADODB.LockTypeEnum'),member('CursorLocation','ADODB.CursorLocationEnum'),
  ...props('Boolean','BOF EOF'),...props('Long','RecordCount AbsolutePosition EditMode'),...props('String','Filter Sort'),member('Bookmark'),
  method('Open','Optional Source As Variant, Optional ActiveConnection As Variant, Optional CursorType As ADODB.CursorTypeEnum, Optional LockType As ADODB.LockTypeEnum, Optional Options As ADODB.CommandTypeEnum'),method('Close'),method('MoveFirst'),method('MoveLast'),method('MoveNext'),method('MovePrevious'),method('Move','NumRecords As Long, Optional Start As Variant'),method('AddNew','Optional FieldList As Variant, Optional Values As Variant'),method('Update','Optional FieldList As Variant, Optional Values As Variant'),method('CancelUpdate'),method('Delete','Optional AffectRecords As Long = 1'),method('GetRows','Optional Rows As Long = -1, Optional Start As Variant, Optional Fields As Variant','Variant',{array:true}),method('GetString','Optional StringFormat As Long = 2, Optional NumRows As Long = -1, Optional ColumnDelimiter As String, Optional RowDelimiter As String, Optional NullExpr As String','String'),method('Find','Criteria As String, Optional SkipRecords As Long, Optional SearchDirection As Long = 1, Optional Start As Variant'),method('Item','Index As Variant','Variant'),
],{defaultMember:'Item'});
add('ADODB.Fields',[member('Count','Long'),method('Item','Index As Variant','ADODB.Field'),method('Append','Name As String, Optional Type As ADODB.DataTypeEnum = 200, Optional DefinedSize As Long')],{defaultMember:'Item'});
add('ADODB.Field',[member('Name','String'),member('Type','ADODB.DataTypeEnum'),member('DefinedSize','Long'),member('Value'),member('OriginalValue')],{defaultMember:'Value'});
add('ADODB.Connection',[
  ...props('String','ConnectionString Provider'),...props('Long','CommandTimeout ConnectionTimeout Mode'),member('State','ADODB.ObjectStateEnum'),member('Errors','ADODB.Errors'),
  method('Open','Optional ConnectionString As String, Optional UserID As String, Optional Password As String, Optional Options As Long'),method('Close'),method('Execute','CommandText As String, Optional ByRef RecordsAffected As Long, Optional Options As ADODB.CommandTypeEnum = 1','ADODB.Recordset'),method('BeginTrans','','Long'),method('CommitTrans'),method('RollbackTrans'),method('Cancel'),method('OpenSchema','Schema As Long, Optional Restrictions As Variant','ADODB.Recordset'),method('SetHeader','Name As String, Value As String'),
]);
add('ADODB.Command',[
  member('ActiveConnection','ADODB.Connection'),member('CommandText','String'),member('CommandTimeout','Long'),member('CommandType','ADODB.CommandTypeEnum'),member('Parameters','ADODB.Parameters'),method('CreateParameter','Optional Name As String, Optional Type As ADODB.DataTypeEnum = 202, Optional Direction As ADODB.ParameterDirectionEnum = 1, Optional Size As Long, Optional Value As Variant','ADODB.Parameter'),method('Execute','Optional ByRef RecordsAffected As Long, Optional Parameters As Variant, Optional Options As Long','ADODB.Recordset'),method('Cancel'),
]);
add('ADODB.Parameter',[member('Name','String'),member('Type','ADODB.DataTypeEnum'),member('Direction','ADODB.ParameterDirectionEnum'),member('Size','Long'),member('Value')],{defaultMember:'Value'});
add('ADODB.Parameters',[member('Count','Long'),method('Item','Index As Variant','ADODB.Parameter'),method('Append','Object As ADODB.Parameter'),method('Delete','Index As Variant')],{defaultMember:'Item'});
add('ADODB.Errors',[member('Count','Long'),method('Item','Index As Variant','ADODB.Error'),method('Clear')],{defaultMember:'Item'});
add('ADODB.Error',[...props('String','Description Source SQLState'),...props('Long','Number NativeError')]);
add('DAO.Database',[member('Name','String'),method('OpenRecordset','Name As String, Optional Type As Long, Optional Options As Long','ADODB.Recordset'),method('Execute','Query As String, Optional Options As Long'),method('Close'),method('BeginTrans'),method('CommitTrans'),method('Rollback')]);
add('DAO.DBEngine',[method('OpenDatabase','Name As String, Optional Options As Variant, Optional ReadOnly As Boolean, Optional Connect As String','DAO.Database')]);

const collectionSpecs = [
  ['Nodes','Node','Optional Relative As Variant, Optional Relationship As Long, Optional Key As String, Optional Text As String, Optional Image As Variant, Optional SelectedImage As Variant'],
  ['ListItems','ListItem','Optional Index As Long, Optional Key As String, Optional Text As String, Optional Icon As Variant, Optional SmallIcon As Variant'],
  ['ColumnHeaders','ColumnHeader','Optional Index As Long, Optional Key As String, Optional Text As String, Optional Width As Single = 1440, Optional Alignment As AlignmentConstants'],
  ['Buttons','Button','Optional Index As Long, Optional Key As String, Optional Caption As String, Optional Style As Long, Optional Image As Variant'],
  ['Panels','Panel','Optional Index As Long, Optional Key As String, Optional Text As String, Optional Style As Long'],
  ['Tabs','Tab','Optional Index As Long, Optional Key As String, Optional Caption As String, Optional Image As Variant'],
  ['ListImages','ListImage','Optional Index As Long, Optional Key As String, Optional Picture As Variant'],
];
for (const [name,item,args] of collectionSpecs) add(name,[member('Count','Long'),method('Item','Index As Variant',item),method('Add',args,item),method('Remove','Index As Variant'),method('Clear')],{defaultMember:'Item'});
add('Node',[...props('String','Key Text Tag'),...props('Long','Index Children'),...props('Boolean','Expanded Selected'),member('Parent','Node'),member('Child','Node'),member('Image'),member('SelectedImage'),method('EnsureVisible')]);
add('ListItem',[...props('String','Key Text Tag'),member('Index','Long'),...props('Boolean','Selected Checked'),member('Icon'),member('SmallIcon'),member('SubItems','String','Index As Long'),method('EnsureVisible')]);
add('ColumnHeader',[...props('String','Key Text'),member('Index','Long'),member('Alignment','AlignmentConstants'),member('Width','Single')]);
add('Button',[...props('String','Key Caption Tag ToolTipText'),...props('Long','Index Style Value'),...props('Boolean','Enabled Visible'),member('Image')]);
add('Panel',[...props('String','Key Text'),...props('Long','Index Style'),member('Width','Single'),member('Alignment','AlignmentConstants'),...props('Boolean','Enabled Visible')]);
add('Tab',[...props('String','Key Caption Tag'),member('Index','Long'),member('Image')]);
add('ListImage',[...props('String','Key Tag'),member('Index','Long'),member('Picture')]);

const booleanProps = new Set('Visible Enabled TabStop FontBold FontItalic FontUnderline FontStrikethru Locked MultiLine Sorted Default Cancel KeyPreview AutoRedraw FullRowSelect Checkboxes ReadOnly Stretch'.toLowerCase().split(' '));
const geometryProps = new Set('Left Top Width Height ClientWidth ClientHeight ScaleLeft ScaleTop ScaleWidth ScaleHeight FontSize SelFontSize CurrentX CurrentY'.toLowerCase().split(' '));
const propertyTypes = {scalemode:'VbScaleMode',windowstate:'WindowStateConstants',alignment:'AlignmentConstants',forecolor:'ColorConstants',backcolor:'ColorConstants',fillcolor:'ColorConstants',cursortype:'ADODB.CursorTypeEnum',locktype:'ADODB.LockTypeEnum',commandtype:'ADODB.CommandTypeEnum'};
const controlExtra = {
  Form:[method('Show','Optional Modal As FormShowConstants, Optional Owner As Form'),method('Hide')],
  ListBox:[method('AddItem','Item As String, Optional Index As Integer'),method('RemoveItem','Index As Integer'),method('Clear'),member('List','String','Index As Integer'),member('Selected','Boolean','Index As Integer'),member('ItemData','Long','Index As Integer'),member('ListCount','Long'),member('ListIndex','Long')],
  TextBox:[member('SelStart','Long'),member('SelLength','Long'),member('SelText','String')],
  RichTextBox:[method('LoadFile','FileName As String, Optional FileType As Long'),method('SaveFile','FileName As String, Optional FileType As Long'),method('Find','String As String, Optional Start As Long, Optional End As Long, Optional Options As Long','Long')],
  CommonDialog:['ShowOpen','ShowSave','ShowColor','ShowFont'].map(name=>method(name)),
  TreeView:[member('Nodes','Nodes'),member('SelectedItem','Node')],
  ListView:[member('ListItems','ListItems'),member('ColumnHeaders','ColumnHeaders'),member('SelectedItem','ListItem'),method('FindItem','Text As String','ListItem')],
  Toolbar:[member('Buttons','Buttons')],StatusBar:[member('Panels','Panels')],TabStrip:[member('Tabs','Tabs')],ImageList:[member('ListImages','ListImages')],
  Data:[member('Recordset','ADODB.Recordset'),method('Refresh')],Adodc:[member('Recordset','ADODB.Recordset'),method('Refresh')],
  MSFlexGrid:[member('TextMatrix','String','Row As Long, Col As Long'),member('ColWidth','Single','Col As Long'),member('RowHeight','Single','Row As Long')],
};
controlExtra.ComboBox=controlExtra.ListBox;
controlExtra.RichTextBox.push(...controlExtra.TextBox);
controlExtra.MSHFlexGrid=controlExtra.MSFlexGrid;
const drawing=['Form','PictureBox'];
for (const type of ['Form',...Object.keys(CONTROL_DEFAULTS).filter(name=>name!=='OLE')]) {
  const model = type==='Form'?createForm().form.properties:createControl(type).properties;
  const members = Object.entries(model).filter(([name])=>!['Items','Columns'].includes(name)).map(([name,value])=>member(name,propertyTypes[name.toLowerCase()]||(name==='Value'&&type==='CheckBox'?'CheckBoxConstants':booleanProps.has(name.toLowerCase())?'Boolean':geometryProps.has(name.toLowerCase())?'Single':typeof value==='number'?'Long':typeof value==='string'?'String':'Variant')));
  members.push(method('Move','Left As Single, Optional Top As Single, Optional Width As Single, Optional Height As Single'),method('SetFocus'),method('Refresh'),method('ZOrder','Optional Position As Long'));
  if (drawing.includes(type)) members.push(method('Print','ParamArray OutputList() As Variant'),method('Cls'),method('PSet','X As Single, Y As Single, Optional Color As ColorConstants'),...props('Single','CurrentX CurrentY'));
  members.push(...(controlExtra[type]||[]));
  add(type,[...new Map(members.map(m=>[symbolKey(m.name),m])).values()],{aliases:['VB.'+type]});
}
add('MDIForm',[...catalog.get('form').members,member('ActiveForm','Form'),method('Arrange','Arrangement As Long')],{aliases:['VB.MDIForm']});

add('Forms',[member('Count','Long'),method('Item','Index As Variant','Form')],{defaultMember:'Item'});
add('Menu',[...props('String','Caption Name'),...props('Boolean','Enabled Visible Checked'),member('Index','Integer')]);

const builtinExtras={Array:'ParamArray ArgList() As Variant',Choose:'Index As Single, ParamArray Choice() As Variant',Switch:'ParamArray VarExpr() As Variant',CallByName:'Object As Object, ProcName As String, CallType As VbCallType, ParamArray Args() As Variant'};
const argEnums={MsgBox:{buttons:'VbMsgBoxStyle'},StrComp:{compare:'VbCompareMethod'},InStr:{compare:'VbCompareMethod'},InStrRev:{compare:'VbCompareMethod'},Replace:{compare:'VbCompareMethod'},Split:{compare:'VbCompareMethod'},Filter:{compare:'VbCompareMethod'},DateDiff:{firstdayofweek:'VbDayOfWeek',firstweekofyear:'VbFirstWeekOfYear'},DatePart:{firstdayofweek:'VbDayOfWeek',firstweekofyear:'VbFirstWeekOfYear'},Weekday:{firstdayofweek:'VbDayOfWeek'},WeekdayName:{firstdayofweek:'VbDayOfWeek'},StrConv:{conversion:'VbStrConv'}};
const returnTypes={CBool:'Boolean',CByte:'Byte',CInt:'Integer',CLng:'Long',CSng:'Single',CDbl:'Double',CCur:'Currency',CDate:'Date',CStr:'String',CDec:'Variant',MsgBox:'VbMsgBoxResult',InputBox:'String',Now:'Date',Date:'Date',Time:'Date',DateSerial:'Date',TimeSerial:'Date',DateValue:'Date',TimeValue:'Date',DateAdd:'Date',DateDiff:'Long',DatePart:'Integer',Timer:'Single',RGB:'ColorConstants',QBColor:'ColorConstants',LBound:'Long',UBound:'Long',Len:'Long',LenB:'Long',Asc:'Integer',AscW:'Integer',InStr:'Long',InStrRev:'Long',StrComp:'Integer',TypeName:'String',VarType:'Integer',CreateObject:'Object',LoadResString:'String',LoadResData:'Byte',LoadResPicture:'Object'};
export const BUILTIN_SYMBOLS = Object.entries({...BUILTIN_SIGNATURES,...builtinExtras}).map(([name,args])=>{
  const params=splitArguments(args).map(p=>{
    const optional=p.endsWith('?'),n=p.replace(/\?$/,'');
    return /\s+As\s+/i.test(p)?p:(optional?'Optional ':'')+n+' As '+(argEnums[name]?.[n]||'Variant');
  });
  const type=returnTypes[name]||(/^Is/.test(name)?'Boolean':'Variant');
  return member(name,type,params,{kind:'function',array:['Array','Split','Filter','LoadResData'].includes(name)});
});
for (const name of 'Error Left Right Mid Trim LTrim RTrim UCase LCase Space String Chr ChrW Str Hex Oct Format Input Dir Environ Command'.split(' ')) {
  const base=BUILTIN_SYMBOLS.find(s=>s.name===name);if(base)BUILTIN_SYMBOLS.push({...base,name:name+'$',type:'String',signature:base.signature.replace(name,name+'$').replace(/ As \w+$/,' As String')});
}
export const GLOBAL_OBJECTS = ['App','Screen','Clipboard','Debug'].map(name=>({name,type:name,kind:'object',signature:name+' As '+name})).concat({name:'Err',type:'ErrObject',kind:'object',signature:'Err As ErrObject'},{name:'DBEngine',type:'DAO.DBEngine',kind:'object'});
export const TYPE_CATALOG = catalog;
export function builtinType(name) {
  const key=symbolKey(name);
  return catalog.get(key)||[...catalog.values()].find(t=>(t.aliases||[]).some(a=>symbolKey(a)===key))||ENUM_TYPES.get(key)||[...ENUM_TYPES.values()].find(t=>symbolKey(t.name.split('.').at(-1))===key)||null;
}

// The VFS adapter exposes only the operations actually implemented by
// VirtualFileSystem; native filesystem access is never implied by this list.
add('Scripting.FileSystemObject',[
  method('FileExists','FileSpec As String','Boolean'),method('FolderExists','FolderSpec As String','Boolean'),
  method('CreateTextFile','FileName As String, Optional Overwrite As Boolean = True','Scripting.TextStream'),
  method('OpenTextFile','FileName As String, Optional IOMode As Long = 1, Optional Create As Boolean = False','Scripting.TextStream'),
  method('DeleteFile','FileSpec As String'),method('CopyFile','Source As String, Destination As String'),method('GetFile','FileSpec As String','Scripting.File'),
  ...['GetAbsolutePathName','GetFileName','GetBaseName'].map(name=>method(name,'Path As String','String')),
  method('BuildPath','Path As String, Name As String','String'),method('CreateFolder','Path As String'),
]);
add('Scripting.TextStream',[member('AtEndOfStream','Boolean'),method('ReadLine','','String'),method('Read','Characters As Long','String'),method('ReadAll','','String'),method('Write','Text As String'),method('WriteLine','Text As String'),method('Close')]);
add('Scripting.File',[member('Name','String'),member('Path','String'),member('Size','Long')]);
add('DataEnvironment',[
  member('Connections','DataEnvironment.Connections'),member('Commands','DataEnvironment.Commands'),
  method('SetCredential','Name As String, Value As String'),method('ClearCredentials'),
],{kind:'type'});
add('DataEnvironment.Connections',[member('Count','Long'),method('Item','Index As Variant','ADODB.Connection')],{defaultMember:'Item'});
add('DataEnvironment.Commands',[member('Count','Long'),method('Item','Index As Variant','ADODB.Command')],{defaultMember:'Item'});
GLOBAL_OBJECTS.push({name:'DataEnvironment1',type:'DataEnvironment',kind:'object'},{name:'DataEnvironment',type:'DataEnvironment',kind:'object'});
BUILTIN_SYMBOLS.push(method('OpenDatabase','Name As String, Optional Options As Variant, Optional ReadOnly As Boolean, Optional Connect As String','DAO.Database',{kind:'function'}));

/** Configured data-environment names are design-time metadata, not live
 * connection/credential values. This never opens a database or an HTTP client. */
export function runtimeType(project,name){
  const key=symbolKey(name),alias={'dao.recordset':'ADODB.Recordset','vb6.data.connection':'ADODB.Connection','vb6.data.command':'ADODB.Command'}[key];
  if(alias)return builtinType(alias);
  if(key!=='dataenvironment')return null;
  const members=[...builtinType('DataEnvironment').members],data=project.dataSources||{};
  for(const c of data.connections||[])if(c.name)members.push(member(c.name,'ADODB.Connection'));
  const types={2:'Integer',3:'Long',4:'Single',5:'Double',6:'Currency',7:'Date',11:'Boolean',17:'Byte',200:'String',201:'String',202:'String',203:'String'};
  for(const c of data.commands||[])if(c.name){
    members.push(method(c.name,(c.parameters||[]).map(p=>'Optional '+p.name+' As '+(types[p.type]||'Variant')),'ADODB.Recordset'),member('rs'+c.name,'ADODB.Recordset'));
  }
  return {...builtinType('DataEnvironment'),members};
}

// Client-cursor operations supported by the connected/batch data runtime.
const rsType=builtinType('ADODB.Recordset');
rsType.members=rsType.members.filter(m=>m.name!=='Filter').concat(member('Filter','Variant'),
  ...props('Long','PageSize PageCount AbsolutePage Status'),
  method('Clone','Optional LockType As ADODB.LockTypeEnum = -1','ADODB.Recordset'),
  method('UpdateBatch','Optional AffectRecords As Long = 3'),method('CancelBatch','Optional AffectRecords As Long = 3'),
  method('Resync','Optional AffectRecords As Long = 3, Optional ResyncValues As Long = 2'),
  method('Requery'),method('Supports','CursorOptions As Long','Boolean'));
builtinType('ADODB.Field').members.push(member('UnderlyingValue'),member('ActualSize','Long'),method('GetChunk','Length As Long','Variant'),method('AppendChunk','Data As Variant'));
