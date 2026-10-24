import {LinuxCompileError,linuxToolkit} from './target.js';
/** Explicit GTK implementations and compatibility adapters. This is not a DLL
 * loader: unimplemented controls and foreign signatures fail before exporting. */
export const LINUX_CONTROLS=Object.freeze({
  Form:'GtkWindow',MDIForm:'GtkWindow',Menu:'GtkMenuItem',CommandButton:'GtkButton',
  CheckBox:'GtkCheckButton',OptionButton:'GtkRadioButton',Label:'GtkLabel',TextBox:'GtkEntry/GtkTextView',
  RichTextBox:'GtkTextView',Frame:'GtkFrame',PictureBox:'GtkFixed/Cairo',Image:'GtkDrawingArea/GdkPixbuf',
  Line:'GtkDrawingArea',Shape:'GtkDrawingArea',ComboBox:'GtkComboBoxText',ListBox:'GtkTreeView',
  DriveListBox:'GtkComboBoxText',DirListBox:'GtkTreeView',FileListBox:'GtkTreeView',
  HScrollBar:'GtkScrollbar',VScrollBar:'GtkScrollbar',Slider:'GtkScale',UpDown:'GtkSpinButton',
  ProgressBar:'GtkProgressBar',DTPicker:'GtkCalendar',MonthView:'GtkCalendar',
  TreeView:'GtkTreeView',ListView:'GtkTreeView',MSFlexGrid:'GtkTreeView',MSHFlexGrid:'GtkTreeView',DataGrid:'GtkTreeView',
  TabStrip:'GtkNotebook',SSTab:'GtkNotebook',Toolbar:'GtkToolbar',StatusBar:'GtkBox/GtkButton',
  ImageList:'GdkPixbuf',Timer:'GLib timeout',CommonDialog:'GtkFileChooserDialog',MSChart:'GtkDrawingArea/Cairo'
});
export const LINUX_GTK4_CONTROLS=Object.freeze({...LINUX_CONTROLS,
  Menu:'GMenu/GtkPopoverMenuBar',OptionButton:'GtkCheckButton',Toolbar:'GtkBox/GtkButton'
});
const signatures={
  kernel32:{GetTickCount:0,Sleep:1,GetCurrentProcessId:0,GetCurrentThreadId:0,
    GetLastError:0,SetLastError:1,MulDiv:3,GetModuleHandle:1},
  user32:{IsWindow:1,IsWindowVisible:1,IsWindowEnabled:1,EnableWindow:2,ShowWindow:2,
    SetWindowText:2,GetWindowText:3,GetWindowTextLength:1,GetClientRect:2,GetWindowRect:2,
    MoveWindow:6,SetFocus:1,GetFocus:0,GetActiveWindow:0,SetActiveWindow:1,DestroyWindow:1,
    GetParent:1,SetTimer:4,KillTimer:2,MessageBeep:1,MessageBox:4,GetSystemMetrics:1,
    GetSysColor:1,InvalidateRect:3,UpdateWindow:1,GetDC:1,ReleaseDC:2},
  gdi32:{GetStockObject:1,CreatePen:3,CreateSolidBrush:1,DeleteObject:1,SelectObject:2,
    SetTextColor:2,SetBkColor:2,SetBkMode:2,MoveToEx:4,LineTo:3,Rectangle:5,Ellipse:5,SetPixel:4,TextOut:5}
};
export const LINUX_API_SIGNATURES=Object.freeze(Object.fromEntries(Object.entries(signatures).map(([name,table])=>[name,Object.freeze(table)])));
const textAdapters=new Set(['GetModuleHandle','SetWindowText','GetWindowText','GetWindowTextLength','MessageBox','TextOut']);
export function resolveLinuxDeclaration(procedure,module=''){
  if(procedure.returnArray)throw new LinuxCompileError('Declare array returns require an explicit native array ABI',module,procedure.line,'LIN213');
  const external=procedure.external,library=String(external.library).toLowerCase().replace(/\.dll$/,''),requested=String(external.entry),table=LINUX_API_SIGNATURES[library];
  let name=table&&Object.keys(table).find(name=>name.toLowerCase()===requested.toLowerCase()),wide=false;
  if(!name&&/[AW]$/i.test(requested)){name=table&&Object.keys(table).find(name=>textAdapters.has(name)&&name.toLowerCase()===requested.slice(0,-1).toLowerCase());wide=/W$/i.test(requested);}
  if(!name)throw new LinuxCompileError(`No native Linux adapter for Declare ${procedure.name} Lib "${external.library}" Alias "${requested}"`,module,procedure.line,'LIN210');
  if(procedure.params.length!==table[name])throw new LinuxCompileError(`Declare ${procedure.name} requires ${table[name]} parameters for ${name}`,module,procedure.line,'LIN211');
  const forbidden=procedure.params.find(p=>p.paramArray||p.autoNew||p.bounds!==null&&p.bounds!==undefined||['object','variant'].includes(p.type.toLowerCase()));
  if(forbidden)throw new LinuxCompileError(`Declare parameter ${forbidden.name} requires a native scalar, String, Any buffer, or UDT contract`,module,procedure.line,'LIN212');
  return Object.freeze({library,name,wide,id:`${library}.${name}${wide?'W':''}`});
}
export function linuxControlReport(project,toolkit='gtk3'){
  const definition=linuxToolkit(toolkit),catalog=toolkit==='gtk4'?LINUX_GTK4_CONTROLS:LINUX_CONTROLS;
  const used=new Set();
  for(const module of project.modules)if(module.form){
    for(const control of [module.form,...(module.form.controls||[]),...(module.form.menus||[]).map(m=>({...m,type:'Menu'}))]){
      const type=control.type||'Form';if(!Object.hasOwn(catalog,type))throw new LinuxCompileError(`Control ${control.name||module.name} (${type}) has no ${definition.controls} implementation`,module.name,1,'LIN220');used.add(type);
    }
  }
  return [...used].sort().map(type=>({type,native:catalog[type]}));
}
