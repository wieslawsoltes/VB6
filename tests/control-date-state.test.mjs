import test from 'node:test';
import assert from 'node:assert/strict';
import {DateControlState,calendarDays,dateKey,monthCode,monthDate} from '../src/controls/date-state.js';
import {dateFormatTokens,formatDateParts,parseDateText} from '../src/controls/date-format.js';
import {asDate,dateOrdinal} from '../src/runtime/calendar.js';
const error=n=>e=>e.number===n;
const create=(type='DTPicker',props={},change=()=>{},before=()=>{})=>new DateControlState(type,{Value:'2024-02-29 13:07:09',...props},change,before);
test('date parts and OLE serials derive from the same validated copied Value',()=>{
 const s=create();assert.equal(s.get('Year'),2024);assert.equal(s.get('Month'),2);assert.equal(s.get('Day'),29);assert.equal(s.get('Hour'),13);assert.equal(s.get('Minute'),7);assert.equal(s.get('Second'),9);assert.equal(s.get('DayOfWeek'),5);
 const copy=s.get('Value');copy.setFullYear(2099);assert.equal(s.get('Year'),2024);s.set('Value',-1.5);assert.equal(dateKey(s.get('Value')),'1899-12-29');assert.equal(s.get('Hour'),12);
});
test('Year and Month clamp leap days but Day refuses rollover atomically',()=>{
 const s=create();s.set('Year',2025);assert.equal(dateKey(s.get('Value')),'2025-02-28');s.set('Month',1);s.set('Day',31);s.set('Month',4);assert.equal(dateKey(s.get('Value')),'2025-04-30');const revision=s.revision;
 assert.throws(()=>s.set('Day',31),error(380));assert.throws(()=>s.set('Month',0),error(380));assert.throws(()=>s.set('Hour',24),error(380));assert.equal(s.revision,revision);
});
test('MinDate and MaxDate reject inversion and clamp Value as one notification',()=>{
 const events=[],s=create('DTPicker',{},e=>events.push(e));s.set('MinDate','2025-01-01');assert.equal(dateKey(s.get('Value')),'2025-01-01');assert.equal(events.length,1);assert.ok(events[0].valueChanged);
 assert.throws(()=>s.set('MaxDate','2024-01-01'),error(380));assert.throws(()=>s.set('Value','2024-12-31'),error(380));assert.equal(events.length,1);
 s.set('MaxDate','2025-01-02');const before=s.get('Value');assert.throws(()=>s.set('Value','2025-02-30'),error(380));assert.deepEqual(s.get('Value'),before);
});
test('nullable checkbox restores last valid date and validates before data binding writes',()=>{
 const writes=[],s=create('DTPicker',{CheckBox:-1},()=>{},value=>writes.push(value));s.set('Value',null);assert.equal(s.get('Value'),null);assert.equal(s.get('Hour'),null);s.set('CheckBox',0);assert.equal(s.get('Hour'),13);assert.equal(writes.length,2);assert.throws(()=>s.set('Value',null),error(380));assert.equal(writes.length,2);
 const rejected=create('DTPicker',{},()=>{},()=>{throw Error('provider rejected');});assert.throws(()=>rejected.set('Value','2026-01-01'),/provider/);assert.equal(rejected.get('Year'),2024);assert.equal(rejected.revision,0);
});
test('binding refresh does not write back to its source or emit when unchanged',()=>{
 let writes=0,events=0;const s=create('DTPicker',{},()=>events++,()=>writes++);s.set('Value','2026-01-01',{fromBinding:true});s.set('Value','2026-01-01',{fromBinding:true});assert.equal(events,1);assert.equal(writes,0);
});
test('MonthView single selection, inclusive bounded ranges, and MaxSelCount validation',()=>{
 const s=create('MonthView',{MultiSelect:-1});s.select('2024-03-01');s.select('2024-03-20',{extend:true});assert.equal(dateKey(s.get('SelStart')),'2024-03-01');assert.equal(dateKey(s.get('SelEnd')),'2024-03-07');assert.equal(dateKey(s.focus),'2024-03-07');
 assert.throws(()=>s.set('MaxSelCount',6),error(380));assert.equal(s.get('MaxSelCount'),7);s.select('2024-02-20',{extend:true});assert.equal(dateKey(s.get('SelStart')),'2024-02-24');assert.equal(dateKey(s.get('SelEnd')),'2024-03-01');
 s.set('MultiSelect',0);assert.deepEqual(s.get('SelStart'),s.get('SelEnd'));assert.throws(()=>s.set('SelEnd','2024-03-01'),error(380));
});
test('programmatic selection endpoints, date bounds, and focus remain coherent',()=>{
 const s=create('MonthView',{MultiSelect:-1});s.set('SelStart','2024-03-02');s.set('SelEnd','2024-03-04');assert.equal(dateKey(s.focus),'2024-03-04');const end=s.get('SelEnd');assert.throws(()=>s.set('SelEnd','2024-03-01'),error(380));assert.deepEqual(s.get('SelEnd'),end);
 s.set('MinDate','2024-03-03');assert.equal(dateKey(s.get('Value')),'2024-03-03');assert.equal(dateKey(s.get('SelStart')),'2024-03-03');
});
test('one to twelve calendar panels have strict rows/columns and locale week start',()=>{
 const s=create('MonthView');s.set('MonthRows',3);s.set('MonthColumns',4);assert.equal(s.panels().length,12);assert.throws(()=>s.set('MonthColumns',5),error(380));assert.equal(s.get('MonthColumns'),4);
 const sunday=calendarDays(asDate('2026-10-01'),1,1)[0],monday=calendarDays(asDate('2026-10-01'),1,2)[0];assert.equal(dateKey(sunday.days[0]),'2026-09-27');assert.equal(dateKey(monday.days[0]),'2026-09-28');assert.equal(sunday.days.length,42);
});
test('navigation changes displayed months without changing selected date; endpoints stay civil',()=>{
 let changes=0;const s=create('MonthView',{MinDate:'2024-01-01',MaxDate:'2024-12-31'},()=>changes++);const value=s.get('Value');s.moveView(20);assert.equal(s.firstMonth,monthCode(asDate('2024-12-01')));assert.deepEqual(s.get('Value'),value);assert.equal(changes,1);s.moveView(1);assert.equal(changes,1);
 for(const Value of ['0100-01-01','9999-12-31']){const edge=create('MonthView',{Value,MonthRows:3,MonthColumns:4});assert.equal(edge.panels().length,12);for(const panel of edge.panels()){assert.ok(panel.month.getFullYear()>=100&&panel.month.getFullYear()<=9999);for(const day of panel.days)if(day)assert.ok(day.getFullYear()>=100&&day.getFullYear()<=9999);}}
 assert.equal(dateKey(monthDate(monthCode(asDate('0100-01-01')))),'0100-01-01');
});
test('visible days are one sorted unique contiguous span and DayBold resets on navigation',()=>{
 const s=create('MonthView',{MonthColumns:2});const days=s.visibleDays();assert.equal(new Set(days.map(dateOrdinal)).size,days.length);assert.equal(dateOrdinal(days.at(-1))-dateOrdinal(days[0])+1,days.length);
 s.setDayBold(days[0],true);assert.equal(s.dayBold(days[0]),-1);assert.throws(()=>s.setDayBold('2050-01-01',true),error(380));s.moveView(1);assert.equal(s.dayBold(days[0]),0);
});
test('custom picker tokens distinguish month/minute, hours, quoted literals and callbacks',()=>{
 const base=asDate('2024-02-29 13:07:09'),map=new Map([['XX','Thursday callback']]);assert.equal(formatDateParts(base,3,"yyyy-MM-dd 'at' HH:mm:ss tt XX",'en-US',map).text,'2024-02-29 at 13:07:09 PM Thursday callback');assert.equal(formatDateParts(base,3,'y yy yyy h hh H HH t tt','en-US').text,'4 24 2024 1 01 13 13 P PM');assert.equal(formatDateParts(base,3,"'It''s' dddd",'en-US').text,"It's Thursday");
 assert.throws(()=>dateFormatTokens("'unclosed"),error(380));assert.throws(()=>dateFormatTokens('MMMMM'),error(380));assert.throws(()=>dateFormatTokens('X'.repeat(65)),error(380));
});
for(const locale of ['en-US','pl-PL','de-DE','ar-EG'])for(const format of [0,1,2,3])test(`picker parse/format round trip ${locale} format ${format}`,()=>{
 const base=asDate('2024-02-29 13:07:09'),pattern="dd MMMM yyyy 'at' HH:mm:ss",text=formatDateParts(base,format,pattern,locale).text,parsed=parseDateText(text,base,format,pattern,locale);assert.deepEqual(parsed,base);
});
test('date parsing rejects non-existent days and invalid edited tokens without rollover',()=>{
 const base=asDate('2024-01-31 13:07:09');for(const text of ['2024-02-30','2024-13-01','2024-03-00','2024-03-01 24:00:00'])assert.throws(()=>parseDateText(text,base));assert.throws(()=>parseDateText('99',base,3,'y'),error(380));
 assert.equal(dateKey(parseDateText('02/29/24',base,1,'','en-US')),'2024-02-29');assert.equal(parseDateText('12:00:00 AM',base,3,'hh:mm:ss tt','en-US').getHours(),0);assert.equal(parseDateText('12:00:00 PM',base,3,'hh:mm:ss tt','en-US').getHours(),12);
});
