/** Retained, bounded calendar and date editor shared by MonthView and DTPicker. */
import {el,lower} from '../core/core.js';
import {Cell,VBArray} from '../runtime/values.js';
import {VBError} from '../language/lexer.js';
import {asDate,dateAdd,dateOrdinal,datePart} from '../runtime/calendar.js';
import {cssColor,getTheme} from '../theme/theme.js';
import {bindApplicationTheme} from '../theme/application-appearance.js';
import {DateControlState,dateKey,monthDate} from './date-state.js';
import {dateFormatTokens,formatDateParts,parseDateText} from './date-format.js';
import {acceptsInput} from './input.js';
import {controlInteger} from './collections.js';
import {attr,text,style,reconcile} from './collection-view.js';
const report=(control,error)=>{control.LastControlError=error.message;attr(control.node,'data-error',error.message);};
const locale=control=>control.node.ownerDocument.documentElement.lang||control.node.ownerDocument.defaultView.navigator.language||'en-US';
const eventExists=(control,name)=>control.instance?.module?.procedures.has(lower(control.model.name+'_'+name));
const withTime=(date,base)=>{const result=asDate(date);if(base)result.setHours(base.getHours(),base.getMinutes(),base.getSeconds(),base.getMilliseconds());return result;};

class CalendarView {
  constructor(owner,host,{popup=false,onChoose=()=>{},onClose=()=>{}}={}){
    Object.assign(this,{owner,host,popup,onChoose,onClose});this.control=owner.control;this.state=owner.state;this.panels=[];this.host.classList.add('vb-calendar');this.host.setAttribute('role','group');attr(host,'aria-label',this.control.model.name+' calendar');
    this.months=el('div',{class:'vb-calendar-months'});this.today=el('button',{type:'button',class:'vb-calendar-today'});host.append(this.months,this.today);
    this.today.addEventListener('click',()=>this.choose(new Date(),false));this.host.addEventListener('keydown',event=>this.keydown(event));
  }
  makePanel(){
    const node=el('section',{class:'vb-calendar-panel'}),header=el('div',{class:'vb-month-header'}),previous=el('button',{type:'button',text:'◀','aria-label':'Previous month'}),caption=el('button',{type:'button',class:'vb-calendar-caption'}),next=el('button',{type:'button',text:'▶','aria-label':'Next month'}),table=el('table',{role:'grid'}),thead=el('thead'),head=el('tr'),tbody=el('tbody'),labels=[],rows=[];
    header.append(previous,caption,next);thead.append(head);table.append(thead,tbody);node.append(header,table);
    previous.addEventListener('click',()=>this.move(-1));next.addEventListener('click',()=>this.move(1));caption.addEventListener('click',()=>this.jump());
    for(let column=0;column<8;column++){const label=el('th',{scope:'col'});labels.push(label);head.append(label);}
    const entry={node,header,previous,caption,next,table,labels,rows};
    for(let week=0;week<6;week++){const row=el('tr'),number=el('th',{scope:'row',class:'vb-calendar-week'}),days=[];row.append(number);tbody.append(row);
      for(let column=0;column<7;column++){const cell=el('td'),button=el('button',{type:'button',class:'vb-calendar-day',role:'gridcell',tabindex:-1}),day={cell,button,date:null,inMonth:false};cell.append(button);row.append(cell);days.push(day);
        button.addEventListener('click',event=>{if(day.date)this.choose(day.date,event.shiftKey);});button.addEventListener('dblclick',()=>{if(day.date&&acceptsInput(this.control)&&this.control.type==='MonthView')this.control.event('DateDblClick',[withTime(day.date,this.state.props.Value)]);});
      }rows.push({row,number,days});
    }return entry;
  }
  move(direction){if(!acceptsInput(this.control))return;this.state.moveView(direction*(Number(this.state.props.ScrollRate)||1));this.paint();}
  jump(){
    if(!acceptsInput(this.control)||this.jumpEditor)return;const p=this.state.props,header=this.panels[0]?.header;if(!header)return;
    const box=el('form',{class:'vb-calendar-jump'}),month=el('select',{'aria-label':'Month'}),year=el('input',{type:'number','aria-label':'Year',min:p.MinDate.getFullYear(),max:p.MaxDate.getFullYear(),value:Math.floor(this.state.firstMonth/12)}),ok=el('button',{type:'submit',text:'Go'});
    for(let i=0;i<12;i++)month.append(el('option',{value:i,text:new Date(2000,i,1).toLocaleDateString(locale(this.control),{month:'long'})}));month.value=String(this.state.firstMonth%12);box.append(month,year,ok);header.after(box);this.jumpEditor=box;
    const close=()=>{box.remove();if(this.jumpEditor===box)this.jumpEditor=null;};
    box.addEventListener('submit',event=>{event.preventDefault();if(!acceptsInput(this.control)){close();return;}try{const y=controlInteger(year.value,p.MinDate.getFullYear(),p.MaxDate.getFullYear());this.state.moveView(y*12+Number(month.value)-this.state.firstMonth);close();this.paint();}catch(error){year.setCustomValidity(error.message);year.reportValidity();}});
    year.addEventListener('input',()=>year.setCustomValidity(''));box.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}});year.focus();year.select();
  }
  choose(value,extend){
    if(!acceptsInput(this.control))return;try{const date=withTime(value,this.state.props.Value||this.state.lastValue);this.state.select(date,{extend});this.paint();if(this.control.type==='MonthView')this.control.event('DateClick',[this.state.clamp(date)]);this.onChoose();}catch(error){report(this.control,error);}
  }
  keydown(event){
    if(event.defaultPrevented||event.isComposing||!acceptsInput(this.control)||event.target.closest('.vb-calendar-jump'))return;
    const s=this.state,base=s.focus||s.props.Value||s.lastValue;let date=null;
    try{switch(event.key){
      case 'ArrowLeft':date=dateAdd('d',-1,base);break;case 'ArrowRight':date=dateAdd('d',1,base);break;case 'ArrowUp':date=dateAdd('d',-7,base);break;case 'ArrowDown':date=dateAdd('d',7,base);break;
      case 'PageUp':case 'PageDown':date=dateAdd('m',(event.key==='PageUp'?-1:1)*(event.ctrlKey?s.monthCount:1),base);break;
      case 'Home':date=asDate(base);date.setDate(1);break;case 'End':date=asDate(base);date.setMonth(date.getMonth()+1,0);break;
      case 'Enter':case ' ':event.preventDefault();this.choose(base,event.shiftKey);return;
      case 'Escape':if(this.popup){event.preventDefault();event.stopPropagation();this.onClose();}return;
      default:return;
    }}catch(error){if([5,6].includes(error.number)){event.preventDefault();return;}throw error;}
    if(date){event.preventDefault();event.stopPropagation();try{s.select(date,{extend:event.shiftKey});this.paint();this.focus();}catch(error){report(this.control,error);}}
  }
  focus(){this.focusButton?.focus({preventScroll:true});}
  paint(){
    if(this.control.disposed)return;const s=this.state,p=s.props,values=s.panels(),lang=locale(this.control),disabled=this.control.design||!p.Enabled,selected=p.Value===null?null:dateOrdinal(p.SelStart||p.Value),end=p.Value===null?null:dateOrdinal(p.SelEnd||p.Value),focus=dateOrdinal(s.focus||s.lastValue),today=dateOrdinal(new Date()),minimum=dateOrdinal(p.MinDate),maximum=dateOrdinal(p.MaxDate),weekStart=Number(p.StartOfWeek)||1;
    while(this.panels.length<values.length){const panel=this.makePanel();this.panels.push(panel);this.months.append(panel.node);}while(this.panels.length>values.length)this.panels.pop().node.remove();
    style(this.months,{gridTemplateColumns:`repeat(${this.popup?1:Number(p.MonthColumns)||1},minmax(0,1fr))`});
    const background=this.popup?p.CalendarBackColor:p.MonthBackColor,titleBackground=this.popup?p.CalendarTitleBackColor:p.TitleBackColor,titleForeground=this.popup?p.CalendarTitleForeColor:p.TitleForeColor,trailing=this.popup?p.CalendarTrailingForeColor:p.TrailingForeColor;
    style(this.host,{backgroundColor:cssColor(background),color:cssColor(this.popup?p.CalendarForeColor:p.ForeColor)});this.focusButton=null;let fallback=null;
    for(let i=0;i<values.length;i++){
      const value=values[i],panel=this.panels[i];text(panel.caption,value.month.toLocaleDateString(lang,{month:'long',year:'numeric'}));style(panel.header,{backgroundColor:cssColor(titleBackground),color:cssColor(titleForeground)});attr(panel.table,'aria-label',panel.caption.textContent);attr(panel.table,'aria-multiselectable',!!p.MultiSelect);
      panel.previous.disabled=disabled||s.firstMonth<=s.clampMonth(-Infinity);panel.next.disabled=disabled||s.firstMonth>=s.clampMonth(Infinity);panel.caption.disabled=disabled;attr(panel.previous,'hidden',i===0?null:'');attr(panel.next,'hidden',i===values.length-1?null:'');
      for(let j=0;j<8;j++){const label=panel.labels[j];attr(label,'hidden',j===0&&!p.ShowWeekNumbers?'':null);text(label,j===0?'#':new Date(2023,0,weekStart+(j-1)).toLocaleDateString(lang,{weekday:'short'}));}
      for(let week=0;week<6;week++){const row=panel.rows[week],first=value.days[week*7];attr(row.number,'hidden',p.ShowWeekNumbers?null:'');text(row.number,first?datePart('ww',first,weekStart,2):'');
        for(let column=0;column<7;column++){const day=row.days[column],date=value.days[week*7+column],button=day.button;day.date=date;day.inMonth=!!date&&date.getMonth()===value.month.getMonth();const ordinal=date?dateOrdinal(date):null,valid=ordinal!==null&&ordinal>=minimum&&ordinal<=maximum;
          text(button,date?date.getDate():'');attr(button,'data-date',date?dateKey(date):null);attr(button,'aria-label',date?date.toLocaleDateString(lang,{dateStyle:'full'}):'Outside supported date range');attr(button,'aria-selected',selected!==null&&ordinal>=selected&&ordinal<=end);attr(button,'aria-current',ordinal===today?'date':null);button.disabled=disabled||!valid;button.tabIndex=-1;button.classList.toggle('selected',selected!==null&&ordinal>=selected&&ordinal<=end);button.classList.toggle('today',!!p.ShowTodayCircle&&ordinal===today);button.classList.toggle('trailing',!day.inMonth);style(button,{fontWeight:date&&s.dayBold(date)?'bold':'',color:day.inMonth?'':cssColor(trailing)});
          if(valid&&!fallback)fallback=button;if(valid&&ordinal===focus&&day.inMonth)this.focusButton=button;
        }
      }
    }
    this.focusButton||=fallback;if(this.focusButton&&!disabled)this.focusButton.tabIndex=Number(p.TabStop)===0?-1:Number(p.TabIndex)||0;const showToday=this.popup||!!p.ShowToday;attr(this.today,'hidden',showToday?null:'');this.today.disabled=disabled||today<minimum||today>maximum;text(this.today,new Date().toLocaleDateString(lang,{dateStyle:'long'}));attr(this.today,'aria-label','Select today');this.owner.requestBold?.();
  }
  dispose(){this.jumpEditor?.remove();this.panels=[];this.host.replaceChildren();}
}

export class DateViewController{
  constructor(control){
    this.control=control;this.callbacks=new Map();this.formatEpoch=0;this.boldEpoch=0;
    this.state=new DateControlState(control.type,control.props,change=>this.changed(change),value=>{if(control._boundRS&&control.props.DataField&&!control.design)control._boundRS.Fields.Item(control.props.DataField).Value=value;});
    if(control.type==='MonthView'){control.node.classList.add('vb-month');this.calendar=new CalendarView(this,control.node);}
    else{
      control.node.classList.add('vb-date-picker');this.check=el('input',{type:'checkbox',class:'vb-date-check','aria-label':'Enable date'});this.input=control.input=el('input',{type:'text',class:'vb-date-input','aria-label':control.model.name,autocomplete:'off',spellcheck:false});this.arrow=el('button',{type:'button',class:'vb-date-arrow',text:'▾','aria-label':'Open calendar',tabindex:-1});this.spin=el('span',{class:'vb-date-spin'});this.up=el('button',{type:'button',text:'▴','aria-label':'Increment date field',tabindex:-1});this.down=el('button',{type:'button',text:'▾','aria-label':'Decrement date field',tabindex:-1});this.spin.append(this.up,this.down);control.node.append(this.check,this.input,this.arrow,this.spin);
      this.check.addEventListener('change',()=>{if(!acceptsInput(control)){this.refresh();return;}this.set('Value',this.check.checked?this.state.clamp(this.state.lastValue):null);});
      for(const button of [this.arrow,this.up,this.down])button.addEventListener('pointerdown',event=>event.preventDefault());this.arrow.addEventListener('click',()=>this.popup?this.close():this.open());this.up.addEventListener('click',()=>this.step(1));this.down.addEventListener('click',()=>this.step(-1));
      this.input.addEventListener('input',()=>{if(acceptsInput(control)){this.dirty=true;attr(this.input,'aria-invalid',null);}});this.input.addEventListener('blur',()=>this.commitInput());this.input.addEventListener('keydown',event=>this.keydown(event));
    }
  }
  changed(change){
    if(change.valueChanged){this.dirty=false;this.formatKey=null;}this.control.invalidate();
    if(!change.silent){if(change.valueChanged)this.control.event('Change');if(change.selectionChanged&&this.control.type==='MonthView')this.control.event('SelChange',[this.state.get('SelStart'),this.state.get('SelEnd')]);}
  }
  get(key){return this.state.get(key);}set(key,value,options){return this.state.set(key,value,options);}
  visibleDays(index){const days=this.state.visibleDays();return asDate(days[controlInteger(index,1,days.length)-1]);}
  requestBold(){
    const c=this.control;if(c.type!=='MonthView'||c.design||!eventExists(c,'GetDayBold'))return;const days=this.state.visibleDays(),key=days.map(dateKey).join('|');if(key===this.boldKey)return;this.boldKey=key;const epoch=++this.boldEpoch,array=new VBArray([[0,days.length-1]],'Boolean'),cell=new Cell('Variant',array);array.dynamic=true;
    c.event('GetDayBold',[days[0],days.length,{ref:cell}]).then(()=>{
      if(c.disposed||epoch!==this.boldEpoch||key!==this.state.visibleDays().map(dateKey).join('|'))return;const values=cell.get();if(!(values instanceof VBArray)||values.bounds.length!==1||values.bounds[0][0]!==0||values.data.length<days.length)throw new VBError('GetDayBold must return a zero-based Boolean array for all visible days',9);
      for(let i=0;i<days.length;i++){const date=dateOrdinal(days[i]);if(values.get(i))this.state.bold.set(date,true);else this.state.bold.delete(date);}c.invalidate();
    }).catch(error=>report(c,error));
  }
  requestFormat(){
    const c=this.control,p=c.props;if(p.Format!==3||c.design)return;const tokens=[...new Set(dateFormatTokens(p.CustomFormat).filter(part=>part.field==='callback').map(part=>part.token))],key=JSON.stringify([p.Value?.getTime(),p.CustomFormat,locale(c)]);if(key===this.formatKey)return;this.formatKey=key;const epoch=++this.formatEpoch;
    if(!tokens.length){this.callbacks.clear();return;}const values=new Map();
    (async()=>{for(const token of tokens){const size=new Cell('Long',0),value=new Cell('String','');await c.event('FormatSize',[token,{ref:size}]);await c.event('Format',[token,{ref:value}]);if(c.disposed||epoch!==this.formatEpoch)return;controlInteger(size.get(),0,32767);values.set(token,value.get());}if(!c.disposed&&epoch===this.formatEpoch){this.callbacks=values;c.invalidate();}})().catch(error=>report(c,error));
  }
  formatted(){const p=this.control.props;return formatDateParts(p.Value,p.Format,p.CustomFormat,locale(this.control),this.callbacks);}
  refresh(){
    const c=this.control,p=c.props;attr(c.node,'tabindex',-1);if(this.calendar){this.calendar.paint();return;}
    const disabled=c.design||!p.Enabled;this.check.disabled=disabled;this.check.checked=p.Value!==null;attr(this.check,'hidden',p.CheckBox?null:'');this.input.disabled=disabled||p.Value===null;this.arrow.disabled=this.up.disabled=this.down.disabled=disabled;attr(this.spin,'hidden',p.UpDown?null:'');attr(this.arrow,'hidden',p.UpDown?'':null);attr(this.input,'aria-haspopup',p.UpDown?null:'dialog');attr(this.input,'aria-expanded',this.popup?'true':'false');
    if(!this.dirty){const formatted=this.formatted();if(this.input.value!==formatted.text)this.input.value=formatted.text;this.parts=formatted.parts;attr(this.input,'aria-invalid',null);}this.requestFormat();
    if(this.popup){if(!acceptsInput(c)||p.UpDown)this.close(false);else this.popupCalendar.paint();}
  }
  commitInput(){
    if(!this.dirty||!acceptsInput(this.control))return true;try{const p=this.control.props,date=parseDateText(this.input.value,p.Value||this.state.lastValue,p.Format,p.CustomFormat,locale(this.control),this.callbacks);this.state.set('Value',date);this.dirty=false;this.refresh();return true;}catch(error){report(this.control,error);attr(this.input,'aria-invalid','true');return false;}
  }
  step(direction){
    if(!acceptsInput(this.control)||!this.commitInput())return;const position=this.input.selectionStart||0,parts=this.formatted().parts,part=parts.find(part=>position>=part.start&&position<part.end&&part.field!=='literal')||parts.find(part=>!['literal','weekday','callback'].includes(part.field)),interval={year:'yyyy',month:'m',day:'d',hour:'h',minute:'n',second:'s',dayPeriod:'h'}[part?.field]||'d';
    try{const next=dateAdd(interval,direction*(part?.field==='dayPeriod'?12:1),this.control.props.Value||this.state.lastValue);this.state.set('Value',this.state.clamp(next));this.refresh();const active=this.parts?.find(p=>p.field===part?.field);this.input.focus();if(active)this.input.setSelectionRange(active.start,active.end);}catch(error){if(![5,6].includes(error.number))report(this.control,error);}
  }
  keydown(event){
    if(event.defaultPrevented||event.isComposing||!acceptsInput(this.control))return;
    if(event.key==='F4'||event.altKey&&event.key==='ArrowDown'){event.preventDefault();event.stopPropagation();this.popup?this.close():this.open();}
    else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();this.step(event.key==='ArrowUp'?1:-1);}
    else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();this.commitInput();}
    else if(event.key==='Escape'&&this.dirty){event.preventDefault();event.stopPropagation();this.dirty=false;this.refresh();}
  }
  open(){
    const c=this.control;if(this.popup||!acceptsInput(c)||c.props.UpDown||!this.commitInput())return;this.state.ensureVisible(this.state.focus);const doc=c.node.ownerDocument,win=doc.defaultView;this.popup=el('div',{class:'vb-date-popup',role:'dialog','aria-label':c.model.name+' calendar','data-vb-theme':getTheme(c.node).id});this.releaseTheme=bindApplicationTheme(c.node,this.popup);this.popupCalendar=new CalendarView(this,this.popup,{popup:true,onChoose:()=>this.close(),onClose:()=>this.close()});doc.body.append(this.popup);this.popupCalendar.paint();const rect=c.node.getBoundingClientRect(),box=this.popup.getBoundingClientRect(),width=Math.min(box.width,win.innerWidth-4),height=Math.min(box.height,win.innerHeight-4);style(this.popup,{left:Math.max(2,Math.min(rect.left,win.innerWidth-width-2))+'px',top:Math.max(2,rect.bottom+height>win.innerHeight?rect.top-height:rect.bottom)+'px',maxWidth:Math.max(0,win.innerWidth-4)+'px',maxHeight:Math.max(0,win.innerHeight-4)+'px',font:getComputedStyle(this.input).font});
    this.popupAbort=new win.AbortController();const signal=this.popupAbort.signal;doc.addEventListener('pointerdown',event=>{if(!c.node.contains(event.target)&&!this.popup?.contains(event.target))this.close(false);},{capture:true,signal});win.addEventListener('resize',()=>this.close(false),{signal});win.addEventListener('blur',()=>this.close(false),{signal});this.popup.addEventListener('keydown',event=>{if(event.key==='Tab')this.close(false);},{signal});attr(this.input,'aria-expanded','true');this.popupCalendar.focus();c.event('DropDown');
  }
  close(focus=true){if(!this.popup)return;this.popupAbort.abort();this.releaseTheme?.();this.popupCalendar.dispose();this.popup.remove();this.popup=null;this.popupCalendar=null;attr(this.input,'aria-expanded','false');if(focus&&acceptsInput(this.control))this.input.focus();if(!this.control.disposed)this.control.event('CloseUp');}
  dispose(){this.formatEpoch++;this.boldEpoch++;this.close(false);this.calendar?.dispose();}
}
