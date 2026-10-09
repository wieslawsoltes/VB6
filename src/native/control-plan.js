import {NATIVE_GRID_TYPES} from './control-grid-contract.js';
import {NATIVE_CONTROL_CATALOG} from './control-catalog.js';
const edit = new Set(['TextBox','RichTextBox']);
export const NATIVE_SCROLL_CONTROLS = new Set(['HScrollBar','VScrollBar']);
export const NATIVE_RANGE_CONTROLS = new Set([...NATIVE_SCROLL_CONTROLS,'ProgressBar','Slider','UpDown']);
export const NATIVE_DATE_CONTROLS = new Set(['DTPicker','MonthView']);
export const NATIVE_TAB_CONTROLS = new Set(['TabStrip','SSTab']);
export const NATIVE_DRAW_CONTROLS = new Set(['PictureBox','Image','Shape','Line']);
export const NATIVE_INPUT_EVENTS = Object.freeze(['gotfocus','lostfocus','keydown','keyup','keypress','mousedown','mouseup','mousemove']);
/** Creation styles are derived from authored values, not a screenshot template. */
export function nativeControlStyle(type,p) {
  if(!NATIVE_CONTROL_CATALOG[type])throw new TypeError('Unsupported native control: '+type);
  let style=0x40000000|(p.Visible===0?0:0x10000000)|(p.Enabled===0?0x08000000:0)|(p.TabStop===0?0:0x10000),ex=0;
  const align=({0:0,1:2,2:1})[Number(p.Alignment||0)]||0;
  if(edit.has(type)) {
    ex=p.BorderStyle===0?0:0x200;style|=align|(p.MultiLine?0x4|0x40|0x1000:0x80);
    if(p.Locked)style|=0x800;if(p.PasswordChar)style|=0x20;
    if(Number(p.ScrollBars)&1)style|=0x100000;if(Number(p.ScrollBars)&2)style|=0x200000;
  }
  if(type==='CommandButton')style|=0x4000|(p.Default?1:0);
  if(type==='Label')style=style&~0x10000|0x100|align;
  if(type==='CheckBox')style|=0x4000|(p.TripleState?6:3);
  if(type==='OptionButton')style|=0x4000|9;
  if(type==='Frame')style=style&~0x10000|7|0x02000000;
  if(type==='ListBox'||type==='FileListBox'||type==='DirListBox') {
    ex=p.BorderStyle===0?0:0x200;style|=1|0x200000|(p.Sorted?2:0);
    if(Number(p.MultiSelect)===1)style|=8;else if(Number(p.MultiSelect)===2)style|=0x800;
  }
  if(type==='ComboBox'||type==='DriveListBox')style|=0x200000|(type==='DriveListBox'?3:[1,2].includes(Number(p.Style))?Number(p.Style)===1?1:3:2)|(p.Sorted?0x100:0);
  if(type==='VScrollBar')style|=1;
  if(type==='ProgressBar') {style&=~0x10000;if(p.Scrolling===1)style|=1;if(p.Orientation===1)style|=4;}
  if(type==='Slider') {style|=1;if(p.Orientation===1)style|=2;if(p.TickStyle===1)style|=4;if(p.TickStyle===2)style|=8;if(p.TickStyle===3)style=style&~1|16;}
  if(type==='UpDown') {style|=0x20;if(p.Wrap)style|=1;if(p.Orientation===1)style|=0x40;}
  if(type==='TreeView') {ex=0x200;style|=1|2|0x20;if(p.LineStyle)style|=4;}
  if(type==='ListView') {ex=0x200;style|=({0:0,1:2,2:3,3:1})[Number(p.View??3)]??1;style|=8|0x40;} // LVS_SHAREIMAGELISTS: the ImageList object, not the view, owns its handle.
  if(type==='StatusBar')style=style&~0x10000|0x80|0x40|8; // CCS_NORESIZE, NOPARENTALIGN, NODIVIDER: layout owns bounds.
  if(type==='Toolbar')style|=0x80|0x40|8|0x800|0x1000;
  if(NATIVE_TAB_CONTROLS.has(type)) {style|=0x02000000;if(p.TabOrientation===1)style|=2;if(p.TabOrientation===2)style|=0x80;if(p.TabOrientation===3)style|=0x82;if(p.MultiRow)style|=0x200;}
  if(type==='DTPicker')style|=p.Format===1?4:p.Format===2?9:0;
  if(type==='MonthView')style|=p.ShowWeekNumbers?4:0;
  if(NATIVE_DRAW_CONTROLS.has(type)) {style=style&~0x10000|0x10d;if(type==='PictureBox'){style|=0x02000000;if(p.BorderStyle!==0)ex=0x200;}}
  if(NATIVE_CONTROL_CATALOG[type].container)ex|=0x10000; // WS_EX_CONTROLPARENT: nested dialog-key navigation.
  if(type==='MSChart')style|=0x100;
  if(NATIVE_GRID_TYPES.has(type)){style|=0x100|0x02000000;ex|=0x200;if((p.ScrollBars??3)&1)style|=0x100000;if((p.ScrollBars??3)&2)style|=0x200000;}
  return {style:style>>>0,ex};
}
export function nativeCommandEvents(type) {
  if(edit.has(type))return [[0x300,'Change']];
  if(type==='ComboBox'||type==='DriveListBox')return [[1,'Click'],[5,'Change']];
  if(['ListBox','FileListBox','DirListBox'].includes(type))return [[1,'Click'],[2,'DblClick']];
  if(['CommandButton','CheckBox','OptionButton'].includes(type))return [[0,'Click'],[5,'DblClick']];
  if(['Label','PictureBox','Image','Shape','Line','MSChart'].includes(type))return [[0,'Click'],[1,'DblClick']];
  return [];
}
export function nativeControlEvents(type) {
  if(type==='Timer')return ['timer'];
  if(type==='CommonDialog'||type==='ImageList')return [];
  const events=[...NATIVE_INPUT_EVENTS,...nativeCommandEvents(type).map(([,name])=>name.toLowerCase())];
  if(NATIVE_SCROLL_CONTROLS.has(type)||type==='Slider')events.push('change','scroll');
  if(type==='UpDown')events.push('change');
  if(type==='RichTextBox')events.push('selchange');
  if(NATIVE_DATE_CONTROLS.has(type))events.push('change');
  if(NATIVE_TAB_CONTROLS.has(type))events.push('click');
  if(['TreeView','ListView','StatusBar'].includes(type))events.push('click','dblclick');
  if(type==='PictureBox')events.push('paint');
  if(type==='TreeView')events.push('nodeclick');
  if(type==='ListView')events.push('itemclick');
  if(NATIVE_GRID_TYPES.has(type))events.push('rowcolchange','selchange','scroll','click','dblclick','beforecolupdate','aftercolupdate','validate');
  return [...new Set(events)];
}
/** Resolve parent identity, including children of an indexed container; reject
 * unsupported parents/cycles rather than positioning children on the form. */
export function nativeControlOrder(controls) {
  const list=[...controls],parents=new Map(),depths=new Map();
  for(const control of list) {
    const model=control.model;
    if(!model.parent){parents.set(control,null);continue;}
    const candidates=list.filter(c=>c.model.name.toLowerCase()===model.parent.toLowerCase());
    const parent=model.nativeParentId?candidates.find(c=>c.model.id===model.nativeParentId):candidates.length===1?candidates[0]:null;
    if(!parent||!NATIVE_CONTROL_CATALOG[parent.model.type]?.container)throw new TypeError('Invalid or ambiguous native container for '+model.name+': '+model.parent);
    parents.set(control,parent);
  }
  const depth=control=>{if(depths.has(control))return depths.get(control);const path=[],seen=new Set();let node=control;
    while(node&&!depths.has(node)){if(seen.has(node))throw new TypeError('Cyclic native control containment');seen.add(node);path.push(node);node=parents.get(node);}
    let d=node?depths.get(node):0;for(const item of path.reverse())depths.set(item,++d);return depths.get(control);};
  for(const control of list)depth(control);
  return {parents,ordered:list.sort((a,b)=>depths.get(a)-depths.get(b)||Number(a.model.properties.TabIndex||0)-Number(b.model.properties.TabIndex||0))};
}
export function nativeDateFields(value) {
  // Date-only values must not pass through the machine's local timezone.
  const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if(!match)throw new TypeError('Native date control requires an ISO date/time design value');
  const [,ys,ms,ds,hs='0',ns='0',ss='0']=match,[y,m,d,h,n,s]=[ys,ms,ds,hs,ns,ss].map(Number);
  const date=new Date(Date.UTC(y,m-1,d,h,n,s));
  if(y<1601||y>9999||date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d||h>23||n>59||s>59)throw new TypeError('Invalid native date control value');
  return [y,m,date.getUTCDay(),d,h,n,s,0];
}
