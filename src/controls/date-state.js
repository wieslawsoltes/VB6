/** Civil dates/OLE DATE, atomic bounds and bounded contiguous calendar selection. */
import {VBError} from '../language/lexer.js';
import {asDate,dateAdd,dateOrdinal,serialToDate} from '../runtime/calendar.js';
import {controlInteger} from './collections.js';
import {dateFormatTokens} from './date-format.js';
export const DATE_TYPES=new Set(['DTPicker','MonthView']);
const bounds={MinDate:'0100-01-01',MaxDate:'9999-12-31 23:59:59'};
export const DATE_DEFAULTS={
  DTPicker:{...bounds,Format:0,CustomFormat:'',CheckBox:0,UpDown:0,CalendarBackColor:-2147483643,CalendarForeColor:-2147483640,CalendarTitleBackColor:-2147483635,CalendarTitleForeColor:-2147483634,CalendarTrailingForeColor:-2147483631,Day:1,Month:1,Year:2026,DayOfWeek:1,Hour:0,Minute:0,Second:0},
  MonthView:{...bounds,MultiSelect:0,MaxSelCount:7,MonthRows:1,MonthColumns:1,StartOfWeek:1,ScrollRate:1,ShowToday:-1,ShowWeekNumbers:0,ShowTodayCircle:-1,MonthBackColor:-2147483643,TitleBackColor:-2147483635,TitleForeColor:-2147483634,TrailingForeColor:-2147483631,SelStart:null,SelEnd:null,Day:1,Month:1,Year:2026,DayOfWeek:1}
};
const parts={Day:[1,31],Month:[1,12],Year:[100,9999],DayOfWeek:[1,7],Hour:[0,23],Minute:[0,59],Second:[0,59]};
const dateKeys=new Set(['Value','MinDate','MaxDate','SelStart','SelEnd']);
const fail=message=>{throw new VBError(message||'Invalid date property value',380);};
const copy=value=>value===null?null:new Date(value);
const equal=(a,b)=>a instanceof Date&&b instanceof Date?a.getTime()===b.getTime():Object.is(a,b);
export const monthCode=date=>date.getFullYear()*12+date.getMonth();
export function monthDate(code){const date=new Date(0);date.setFullYear(Math.floor(code/12),code%12,1);date.setHours(0,0,0,0);return date;}
export function dateKey(date){return [String(date.getFullYear()).padStart(4,'0'),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
export function calendarDays(firstMonth,count=1,startOfWeek=1){
  count=controlInteger(count,1,12);startOfWeek=controlInteger(startOfWeek,1,7);const panels=[];
  for(let i=0;i<count;i++){const first=monthDate(monthCode(firstMonth)+i),start=dateOrdinal(first)-(first.getDay()-(startOfWeek-1)+7)%7,days=[];for(let day=0;day<42;day++){const ordinal=start+day;days.push(ordinal<=-657435||ordinal>=2958466?null:serialToDate(ordinal));}panels.push({month:first,days});}return panels;
}
export class DateControlState{
  constructor(type,properties,changed=()=>{},beforeChange=()=>{}){
    this.type=type;this.props=properties;this.changed=changed;this.beforeChange=beforeChange;this.bold=new Map();this.revision=0;
    for(const [key,value]of Object.entries(DATE_DEFAULTS[type]))if(properties[key]===undefined)properties[key]=value;
    properties.MinDate=asDate(properties.MinDate);properties.MaxDate=asDate(properties.MaxDate);if(properties.MinDate>properties.MaxDate)fail('MinDate exceeds MaxDate');
    properties.Value=properties.Value===null&&type==='DTPicker'&&properties.CheckBox?null:asDate(properties.Value);if(properties.Value!==null&&!this.inRange(properties.Value))fail('Initial date is outside MinDate and MaxDate');
    const seed=properties.Value||this.clamp(new Date());this.lastValue=copy(seed);this.focus=copy(seed);this.anchor=copy(seed);this.firstMonth=monthCode(seed);
    if(type==='MonthView'){properties.SelStart=properties.SelStart===null?copy(seed):this.validate(properties.SelStart);properties.SelEnd=properties.SelEnd===null?copy(properties.SelStart):this.validate(properties.SelEnd);this.validateSelection(properties.SelStart,properties.SelEnd);this.validateMonths(properties.MonthRows,properties.MonthColumns);}this.firstMonth=this.clampMonth(this.firstMonth);
  }
  handles(key){return key==='Value'||Object.hasOwn(DATE_DEFAULTS[this.type],key);}
  inRange(date){return date>=this.props.MinDate&&date<=this.props.MaxDate;}
  clamp(value){const date=asDate(value);return copy(date<this.props.MinDate?this.props.MinDate:date>this.props.MaxDate?this.props.MaxDate:date);}
  validate(value){let date;try{date=asDate(value);}catch(error){if(error.number===94)throw error;fail('Invalid date');}if(!this.inRange(date))fail('Date is outside MinDate and MaxDate');return date;}
  get(key){const p=this.props,date=p.Value;if(Object.hasOwn(parts,key)){if(date===null)return null;return ({Day:()=>date.getDate(),Month:()=>date.getMonth()+1,Year:()=>date.getFullYear(),DayOfWeek:()=>date.getDay()+1,Hour:()=>date.getHours(),Minute:()=>date.getMinutes(),Second:()=>date.getSeconds()})[key]();}return dateKeys.has(key)?copy(p[key]):p[key];}
  validateMonths(rows,columns){rows=controlInteger(rows,1,12);columns=controlInteger(columns,1,12);if(rows*columns>12)fail('MonthView can display at most twelve months');}
  validateSelection(start,end,max=this.props.MaxSelCount){if(start>end)fail('SelEnd precedes SelStart');if(dateOrdinal(end)-dateOrdinal(start)+1>max)fail('Selection exceeds MaxSelCount');}
  part(key,value){value=controlInteger(value,...parts[key]);const current=this.props.Value||this.lastValue;let date=copy(current);
    if(key==='Year')date=dateAdd('yyyy',value-current.getFullYear(),current);else if(key==='Month')date=dateAdd('m',value-current.getMonth()-1,current);else if(key==='DayOfWeek')date=dateAdd('d',value-current.getDay()-1,current);
    else if(key==='Day'){date.setDate(value);if(date.getMonth()!==current.getMonth())fail('Day does not exist in the selected month');}
    else if(key==='Hour')date.setHours(value);else if(key==='Minute')date.setMinutes(value);else if(key==='Second')date.setSeconds(value);
    return this.validate(date);
  }
  commit(updates,{silent=false,fromBinding=false,focus,anchor}={}){
    const p=this.props,changed=Object.keys(updates).filter(key=>!equal(p[key],updates[key]));if(!changed.length){if(focus)this.focus=copy(focus);if(anchor)this.anchor=copy(anchor);return false;}
    const valueChanged=changed.includes('Value');if(valueChanged&&!fromBinding)this.beforeChange(copy(updates.Value));
    const stillChanged=changed.filter(key=>!equal(p[key],updates[key]));for(const key of stillChanged)p[key]=dateKeys.has(key)?copy(updates[key]):updates[key];
    if(p.Value!==null){this.lastValue=copy(p.Value);if(focus||valueChanged)this.focus=copy(focus||p.Value);}if(anchor)this.anchor=copy(anchor);else if(valueChanged&&p.Value)this.anchor=copy(p.Value);
    if(focus)this.focus=copy(focus);if(valueChanged)this.ensureVisible(this.focus);this.firstMonth=this.clampMonth(this.firstMonth);
    if(stillChanged.length){this.revision++;this.changed({keys:stillChanged,valueChanged:stillChanged.includes('Value'),selectionChanged:stillChanged.some(key=>key==='SelStart'||key==='SelEnd'),silent});}return true;
  }
  set(key,value,options={}){
    if(!this.handles(key))return false;const p=this.props,updates={};
    if(Object.hasOwn(parts,key)){value=this.part(key,value);key='Value';}
    if(key==='Value'){
      if(value===null){if(this.type!=='DTPicker'||!p.CheckBox)fail('Null date requires CheckBox = True');updates.Value=null;}
      else{updates.Value=this.validate(value);if(this.type==='MonthView'){updates.SelStart=copy(updates.Value);updates.SelEnd=copy(updates.Value);}}
    }else if(key==='MinDate'||key==='MaxDate'){
      value=asDate(value);if(key==='MinDate'&&value>p.MaxDate||key==='MaxDate'&&value<p.MinDate)fail('MinDate exceeds MaxDate');updates[key]=value;
      const min=key==='MinDate'?value:p.MinDate,max=key==='MaxDate'?value:p.MaxDate,clamp=date=>date===null?null:copy(date<min?min:date>max?max:date);
      updates.Value=clamp(p.Value);if(this.type==='MonthView'){updates.SelStart=clamp(p.SelStart);updates.SelEnd=clamp(p.SelEnd);}
    }else if(key==='SelStart'||key==='SelEnd'){
      if(!p.MultiSelect)fail('Date range requires MultiSelect = True');value=this.validate(value);const start=key==='SelStart'?value:p.SelStart,end=key==='SelEnd'?value:value>p.SelEnd?value:p.SelEnd;this.validateSelection(start,end);updates.SelStart=start;updates.SelEnd=end;updates.Value=copy(start);options={...options,focus:key==='SelEnd'?end:start};
    }else if(key==='MultiSelect'){updates.MultiSelect=value?-1:0;if(!value){updates.SelStart=copy(p.Value);updates.SelEnd=copy(p.Value);}}
    else if(key==='CheckBox'){updates.CheckBox=value?-1:0;if(!value&&p.Value===null)updates.Value=this.clamp(this.lastValue);}
    else if(key==='MaxSelCount'){value=controlInteger(value,1,32767);this.validateSelection(p.SelStart,p.SelEnd,value);updates[key]=value;}
    else if(key==='MonthRows'||key==='MonthColumns'){value=controlInteger(value,1,12);this.validateMonths(key==='MonthRows'?value:p.MonthRows,key==='MonthColumns'?value:p.MonthColumns);updates[key]=value;}
    else if(key==='StartOfWeek')updates[key]=controlInteger(value,1,7);
    else if(key==='ScrollRate')updates[key]=controlInteger(value,1,120);
    else if(key==='Format')updates[key]=controlInteger(value,0,3);
    else if(key==='CustomFormat'){dateFormatTokens(value);updates[key]=String(value);}
    else if(key.includes('Color'))updates[key]=controlInteger(value,-2147483648,16777215);
    else updates[key]=value?-1:0;
    this.commit(updates,options);return true;
  }
  select(value,{extend=false,silent=false}={}){
    const p=this.props,date=this.clamp(value);if(!p.MultiSelect||!extend){this.set('Value',date,{silent});this.focus=copy(date);this.anchor=copy(date);return;}
    const anchor=this.clamp(this.anchor),distance=dateOrdinal(date)-dateOrdinal(anchor),end=Math.abs(distance)>=p.MaxSelCount?dateAdd('d',Math.sign(distance)*(p.MaxSelCount-1),anchor):date,start=anchor<end?anchor:end,finish=anchor<end?end:anchor;
    this.commit({Value:copy(start),SelStart:copy(start),SelEnd:copy(finish)},{silent,focus:end,anchor});this.ensureVisible(end);
  }
  get monthCount(){return this.type==='MonthView'?this.props.MonthRows*this.props.MonthColumns:1;}
  clampMonth(code){const min=monthCode(this.props.MinDate),max=Math.max(min,monthCode(this.props.MaxDate)-this.monthCount+1);return Math.max(min,Math.min(max,code));}
  ensureVisible(date){const month=monthCode(date);if(month<this.firstMonth)this.firstMonth=this.clampMonth(month);else if(month>=this.firstMonth+this.monthCount)this.firstMonth=this.clampMonth(month-this.monthCount+1);}
  moveView(count){count=controlInteger(count,-120000,120000);const next=this.clampMonth(this.firstMonth+count);if(next!==this.firstMonth){this.firstMonth=next;this.bold.clear();this.revision++;this.changed({keys:[],valueChanged:false,selectionChanged:false,viewChanged:true});}return next;}
  panels(){return calendarDays(monthDate(this.firstMonth),this.monthCount,this.props.StartOfWeek||1);}
  visibleDays(){const seen=new Map();for(const panel of this.panels())for(const date of panel.days)if(date)seen.set(dateOrdinal(date),date);return [...seen.values()].sort((a,b)=>a-b);}
  dayBold(value){return this.bold.get(dateOrdinal(asDate(value)))?-1:0;}
  setDayBold(value,bold){const date=asDate(value),key=dateOrdinal(date);if(!this.visibleDays().some(day=>dateOrdinal(day)===key))fail('DayBold requires a visible date');if(bold)this.bold.set(key,true);else this.bold.delete(key);this.changed({keys:['DayBold'],valueChanged:false,selectionChanged:false});}
}
