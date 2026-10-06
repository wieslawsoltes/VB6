/** Native calendar intervals. The arithmetic routines below are original private
 * compiler support code, lowered by our JavaScript frontend and x86 emitter. They
 * never invoke a VB compiler, Script Host, CLR, or an embedded JavaScript engine.
 * Contracts: Microsoft's DateAdd/DateDiff/DatePart and FormatDateTime references:
 * https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/dateadd-function
 * https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/datediff-function
 * https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/datepart-function
 * https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varformatdatetime
 */
import {compileProject} from '../language/compiler.js';
const key = value => String(value).toLowerCase();
const D = 'native:date:', DLL = 'oleaut32.dll';
const arg = argument => ({argument}), addr = address => ({address});
const store = (x, offset) => x.emit(0x89, 0x85).imm(offset);
const intervals = ['yyyy', 'q', 'm', 'y', 'd', 'w', 'ww', 'h', 'n', 's'];
const returns = {dateadd:'date', datediff:'long', datepart:'integer', formatdatetime:'string'};
export const NATIVE_DATE_CONSTANTS = Object.freeze({
  vbusesystem:0, vbsunday:1, vbmonday:2, vbtuesday:3, vbwednesday:4,
  vbthursday:5, vbfriday:6, vbsaturday:7, vbfirstjan1:1,
  vbfirstfourdays:2, vbfirstfullweek:3, vbgeneraldate:0,
  vblongdate:1, vbshortdate:2, vblongtime:3, vbshorttime:4
});

// All declarations are Private, and their compiler scope is isolated from the
// application. A user's Public Year/CDate/IntervalIndex cannot redirect these.
const source = String.raw`Option Explicit
Private Function Ordinal(ByVal value As Date) As Double
 Ordinal = CDbl(DateSerial(Year(value), Month(value), Day(value)))
End Function
Private Function Linear(ByVal value As Date) As Double
 Linear = Ordinal(value) + (CDbl(Hour(value)) * 3600 + Minute(value) * 60 + Second(value)) / 86400
End Function
Private Function Serial(ByVal value As Double) As Date
 Dim whole As Double
 If value < -657434 Or value >= 2958466 Then Err.Raise 5
 whole = Int(value)
 If whole < 0 Then
  Serial = CDate(whole - (value - whole))
 Else
  Serial = CDate(value)
 End If
End Function
Private Function MonthDays(ByVal y As Long, ByVal m As Long) As Long
 Select Case m
 Case 4, 6, 9, 11
  MonthDays = 30
 Case 2
  MonthDays = 28
  If y Mod 4 = 0 And (y Mod 100 <> 0 Or y Mod 400 = 0) Then MonthDays = 29
 Case Else
  MonthDays = 31
 End Select
End Function
Private Function DateAddCore(ByVal interval As String, ByVal number As Double, ByVal value As Date) As Date
 Dim unit As Long, y As Long, m As Long, d As Long, limit As Long
 Dim months As Double, result As Double, fraction As Double, largest As Double
 unit = IntervalIndex(interval)
 number = Round(number, 0)
 Select Case unit
 Case 0: largest = 10000
 Case 1: largest = 40000
 Case 2: largest = 120000
 Case 3, 4, 5: largest = 4000000
 Case 6: largest = 600000
 Case 7: largest = 100000000
 Case 8: largest = 6000000000#
 Case 9: largest = 400000000000#
 End Select
 If Abs(number) > largest Then Err.Raise 5
 If unit <= 2 Then
  months = CDbl(number)
  If unit = 0 Then months = months * 12
  If unit = 1 Then months = months * 3
  months = months + CDbl(Year(value)) * 12 + Month(value) - 1
  If months < 1200 Or months >= 120000 Then Err.Raise 5
  y = CLng(Int(months / 12))
  m = CLng(months - CDbl(y) * 12) + 1
  d = Day(value)
  limit = MonthDays(y, m)
  If d > limit Then d = limit
  fraction = (CDbl(Hour(value)) * 3600 + Minute(value) * 60 + Second(value)) / 86400
  result = CDbl(DateSerial(y, m, d)) + fraction
 Else
  result = CDbl(number)
  Select Case unit
  Case 6
   result = result * 7
  Case 7
   result = result / 24
  Case 8
   result = result / 1440
  Case 9
   result = result / 86400
  End Select
  result = Linear(value) + result
 End If
 DateAddCore = Serial(result)
End Function
Private Function DateDiffCore(ByVal interval As String, ByVal date1 As Date, ByVal date2 As Date, Optional ByVal firstdayofweek As Long = 1, Optional ByVal firstweekofyear As Long = 1) As Long
 Dim unit As Long, first As Long
 Dim a As Double, b As Double, result As Double
 unit = IntervalIndex(interval)
 If unit = 6 Then
  first = FirstDay(firstdayofweek)
  If firstweekofyear < 0 Or firstweekofyear > 3 Then Err.Raise 5
 End If
 Select Case unit
 Case 0
  result = Year(date2) - Year(date1)
 Case 1
  result = CDbl(Year(date2) - Year(date1)) * 4 + (Month(date2) - 1) \ 3 - (Month(date1) - 1) \ 3
 Case 2
  result = CDbl(Year(date2) - Year(date1)) * 12 + Month(date2) - Month(date1)
 Case Else
  a = Ordinal(date1)
  b = Ordinal(date2)
  Select Case unit
  Case 3, 4
   result = b - a
  Case 5
   result = Fix((b - a) / 7)
  Case 6
   result = Int((b + 7 - first) / 7) - Int((a + 7 - first) / 7)
  Case 7
   result = (b - a) * 24 + Hour(date2) - Hour(date1)
  Case 8
   result = (b - a) * 1440 + (Hour(date2) - Hour(date1)) * 60 + Minute(date2) - Minute(date1)
  Case 9
   result = (b - a) * 86400 + CDbl(Hour(date2) - Hour(date1)) * 3600 + (Minute(date2) - Minute(date1)) * 60 + Second(date2) - Second(date1)
  End Select
 End Select
 DateDiffCore = CLng(result)
End Function`;

const parameter = (name, type, optional = false) => ({name,type,byRef:false,bounds:null,optional,nativeCoerce:true});
function signature(name, params, returnType, defaults = []) {
  return {proc:{name,params,returnType,kind:'function'},label:D+name,nativeDefaults:new Map(defaults)};
}
const nativePart = signature('datepart', [parameter('interval','String'),parameter('date','Date'),parameter('firstdayofweek','Long',true),parameter('firstweekofyear','Long',true)], 'Integer', [['firstdayofweek',1],['firstweekofyear',1]]);
const nativeFormat = signature('formatdatetime', [parameter('date','Date'),parameter('namedformat','Long',true)], 'String', [['namedformat',0]]);

function ensureArithmeticModule(compiler) {
  if (compiler.dateIntervalModule) return compiler.dateIntervalModule;
  let name = 'VB6NativeCalendar', count = 0;
  while (compiler.modules.has(key(name))) name = 'VB6NativeCalendar' + (++count);
  const program = compileProject({name, startup:'Sub Main', modules:[{id:name,name,kind:'module',code:source}]});
  if (!program.valid) throw new Error('Invalid internal native calendar: ' + JSON.stringify(program.diagnostics));
  const module = program.modules.get(key(name)); module.nativeInternal = true;
  compiler.externals.set(key(name), new Map());
  const previousModule = compiler.preparingModule, previousProcedure = compiler.preparingProcedure;
  compiler.prepareModule(module);
  compiler.preparingModule = previousModule; compiler.preparingProcedure = previousProcedure;
  compiler.dateIntervalModule = compiler.modules.get(key(name));
  // Public intrinsic argument names need not expose internal implementation names.
  for (const [name, args] of [['dateaddcore',['interval','number','date']], ['datediffcore',['interval','date1','date2','firstdayofweek','firstweekofyear']]]) {
    const context = compiler.dateIntervalModule.procedures.get(name);
    context.nativeIntrinsicParams = context.proc.params.map((p,i) => ({...p,name:args[i],nativeCoerce:true}));
  }
  return compiler.dateIntervalModule;
}

export const nativeDateIntervalMethods = {
  dateIntervalType(node) {
    if (node.kind !== 'call' || node.callee.kind !== 'id') return null;
    const name = key(node.callee.name);
    return returns[name] && !this.variable(node.callee) && !this.resolveProcedure(node.callee) ? returns[name] : null;
  },
  dateIntervalBuiltin(node, name) {
    const x = this.x;
    if (this.context?.module.nativeInternal && ['intervalindex','firstday'].includes(name)) {
      if (name === 'intervalindex') this.textExpression(node.args[0]); else this.numeric(node.args[0]);
      x.push().call(D+name); return true;
    }
    if (!Object.hasOwn(returns,name) || this.variable(node.callee) || this.resolveProcedure(node.callee)) return false;
    let target;
    if (name === 'datepart') target = nativePart;
    else if (name === 'formatdatetime') target = nativeFormat;
    else {
      const context = ensureArithmeticModule(this).procedures.get(name+'core');
      target = {...context,proc:{...context.proc,name,params:context.nativeIntrinsicParams}};
    }
    this.nativeDateIntervalsUsed = true;
    this.nativeTypedCall(target,this.nativeCallPlan(target,node.args));
    return true;
  }
};

export function emitNativeDateIntervalHelpers(c) {
  if (!c.nativeDateIntervalsUsed) return;
  const x=c.x, check=()=>x.call('native:number:check');
  // Exact BSTR length and ASCII case folding: no NUL-prefix acceptance or
  // locale-dependent folding of non-ASCII characters into interval tokens.
  x.label(D+'intervalindex').enter().api(DLL,'SysStringLen',[arg(8)]).emit(0x89,0xc3);
  for (let i=0;i<intervals.length;i++) {
    const token=intervals[i], next=x.unique();
    x.emit(0x89,0xd8).compare(token.length).branch('ne',next).value(arg(8)).emit(0x89,0xc6);
    for(let j=0;j<token.length;j++) x.emit(0x0f,0xb7,0x86).imm(j*2).emit(0x83,0xc8,32).compare(token.charCodeAt(j)).branch('ne',next);
    x.value(i).leave(4).label(next);
  }
  x.jump('error:5');
  const explicit=x.unique();
  x.label(D+'firstday').enter(4).value(arg(8)).compare(0).branch('l','error:5').compare(7).branch('g','error:5').test().branch('ne',explicit);
  x.api('kernel32.dll','GetLocaleInfoW',[0x400,0x2000100c,addr(-4),2]).test().branch('e','error:5');
  x.value(arg(-4)).compare(6).branch('a','error:5').emit(0x83,0xc0,1,0x31,0xd2,0xb9).imm(7).emit(0xf7,0xf1,0x8d,0x42,1);
  x.label(explicit).leave(4);

  // A local, non-owning VT_DATE VARIANT points at no application memory. Only
  // the returned BSTR is owned; cleanup occurs even if numeric conversion fails.
  const variant = dateOffset => {
    x.value(7);store(x,-16);x.value(0);store(x,-12);
    x.value(arg(dateOffset));store(x,-8);x.value(arg(dateOffset+4));store(x,-4);
  };
  x.label(D+'formatdatetime').enter(20).value(arg(16)).compare(0).branch('l','error:5').compare(4).branch('g','error:5');
  variant(8); x.value(0);store(x,-20);
  x.api(DLL,'VarFormatDateTime',[addr(-16),arg(16),0,addr(-20)]);check();x.value(arg(-20)).leave(12);

  x.label(D+'datepart').enter(36).push(arg(8)).call(D+'intervalindex');
  // Keep the interval index until irrelevant week arguments have been ignored.
  // Installed OleAut32 VarFormat accepts VB's Sunday=1 convention despite the
  // contradictory first-day table in its tokenization documentation. Native
  // execution compares every weekday/week convention with the independent host.
  const ordinary=x.unique(), conventionsReady=x.unique();
  store(x,-36);
  x.compare(5).branch('l',ordinary).compare(6).branch('g',ordinary);
  x.push(arg(20)).call(D+'firstday');store(x,-28);
  x.value(arg(24)).compare(0).branch('l','error:5').compare(3).branch('g','error:5');store(x,-32);
  x.jump(conventionsReady).label(ordinary).value(1);store(x,-28);store(x,-32);
  x.label(conventionsReady).value(arg(-36));
  x.emit(0x8b,0x04,0x85).addr(D+'interval-formats');store(x,-24);
  variant(12);x.value(0);store(x,-20);
  x.api(DLL,'VarFormat',[addr(-16),arg(-24),arg(-28),arg(-32),0,addr(-20)]);check();
  x.api(DLL,'VarI4FromStr',[arg(-20),0x400,0,addr(-32)]).push().api(DLL,'SysFreeString',[arg(-20)]).emit(0x58);check();x.value(arg(-32)).leave(20);
  const formats=intervals.map(token=>c.string(token));
  c.ro.align(4).label(D+'interval-formats');
  // Materialize strings first: adding one inside this table would corrupt it.
  for(const label of formats)c.ro.reference(label,'va');
}
