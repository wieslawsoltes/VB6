/** Native Automation DATE: civil date/time in eight bytes, not a JS timestamp.
 * Values use immutable Double snapshots; semantic Date type and range checking
 * stay distinct from their physical representation and the foreign ST(0) ABI. */
import {dateToSerial} from '../runtime/calendar.js';
const D='native:date:',N='native:number:',DLL='oleaut32.dll';
const key=value=>String(value).toLowerCase();
const arg=argument=>({argument}),addr=address=>({address});
const literal=value=>({kind:'literal',value});
const clock=new Set(['date','time','now','timer']);
const dateFunctions=new Set(['cdate','datevalue','timevalue','dateserial','timeserial','now','date','time']);
const parts={year:0,month:2,day:6,hour:8,minute:10,second:12};
const numbers=new Set(['byte','integer','long','boolean','single','double','currency','date']);

export const nativeDateMethods={
  dateLiteral(value) {
    let serial;
    try {serial=dateToSerial(value instanceof Date?value:new Date(value));}
    catch {this.fail('Native Date literal is invalid or outside years 100 through 9999');}
    return this.floatLiteral(serial);
  },
  dateType(node) {
    if(node.kind==='date'||node.kind==='literal'&&node.value instanceof Date)return 'date';
    if(node.kind==='id'&&clock.has(key(node.name))&&!this.variable(node)&&!this.resolveProcedure(node))return key(node.name)==='timer'?'single':'date';
    if(node.kind==='call'&&node.callee.kind==='id'){
      const name=key(node.callee.name);
      if(!this.variable(node.callee)&&!this.resolveProcedure(node.callee)){
        if(dateFunctions.has(name))return 'date';
        if(Object.hasOwn(parts,name)||name==='weekday')return 'integer';
        if(name==='isdate')return 'boolean';
        if(name==='timer')return 'single';
      }
    }
    if(node.kind==='unary'&&['+','-'].includes(node.op)&&this.type(node.expr)==='date')return 'date';
    if(node.kind==='binary'){
      const a=this.type(node.left),b=this.type(node.right);
      if((a==='date'||b==='date')&&numbers.has(a)&&numbers.has(b)){
        if(node.op==='+')return 'date';
        if(node.op==='-')return a==='date'&&b==='date'?'double':'date';
        if(['*','/','^'].includes(node.op))return 'double';
      }
    }
    return null;
  },
  dateExpression(node) {
    const type=this.type(node),x=this.x;
    this.expression(node);
    if(type==='date'){x.call(D+'validate');return;}
    if(!numbers.has(type)&&type!=='string')this.fail('CDate requires a supported scalar value');
    const out=this.floatWorkspace();
    x.push();this.rawStorageAddress(out);x.emit(0x59).push().emit(0x51)
      .call(D+(type==='string'?'parse':type==='currency'?'from-currency':['double','single'].includes(type)?'from-double':'from-int'));
  },
  storeDate(variable) {this.x.call(D+'validate');this.storeFloat(variable);},
  dateToString() {this.x.push().call(D+'string');this.ownString();},
  dateOperation(node) {
    const x=this.x;
    if(node.kind==='date'||node.kind==='literal'&&node.value instanceof Date){x.value(this.dateLiteral(node.value));return true;}
    if(node.kind==='unary'&&['+','-'].includes(node.op)&&this.type(node.expr)==='date'){
      this.dateExpression(node.expr);if(node.op==='-')this.floatUnary('negate');x.call(D+'validate');return true;
    }
    if(node.kind!=='binary')return false;
    const a=this.type(node.left),b=this.type(node.right),op=key(node.op);
    if(a!=='date'&&b!=='date')return false;
    if(!['+','-','*','/','^','=','<>','<','<=','>','>='].includes(op))return false;
    if(!numbers.has(a)||!numbers.has(b))this.fail('Use CDate explicitly in mixed native text/Date operations');
    this.floatExpression(node.left);x.push();this.floatExpression(node.right);x.emit(0x59);
    if(['=','<>','<','<=','>','>='].includes(op)){
      x.push().emit(0x51).call(N+'compare').compare(0);this.boolean(op);return true;
    }
    x.emit(0x51,0x50);const out=this.floatWorkspace();this.rawStorageAddress(out);
    x.emit(0x5a,0x59).push().emit(0x52,0x51).call(N+({'+':'add','-':'subtract','*':'multiply','/':'divide','^':'power'})[op]);
    if(this.type(node)==='date')x.call(D+'validate');return true;
  },
  dateBuiltin(node,name) {
    const x=this.x,args=node.args;
    if(!dateFunctions.has(name)&&!clock.has(name)&&!Object.hasOwn(parts,name)&&!['weekday','isdate'].includes(name))return false;
    if(this.variable(node.callee)||this.resolveProcedure(node.callee))return false;
    const out=()=>{const v=this.floatWorkspace();this.rawStorageAddress(v);return v;};
    if(clock.has(name)){
      if(args.length)this.fail(name+' takes no arguments');out();x.push().call(D+name);return true;
    }
    if(['dateserial','timeserial'].includes(name)){
      if(args.length!==3)this.fail(name+' expects three arguments');
      // Preserve source evaluation order; each argument has VB Integer range.
      for(const n of args){this.numeric(n);this.check('Integer');x.push();}
      out();x.emit(0x5a,0x59,0x5b).push().emit(0x52,0x51,0x53).call(D+name);return true;
    }
    if(name==='weekday'){
      if(args.length<1||args.length>2)this.fail('Weekday expects one or two arguments');
      this.dateExpression(args[0]);x.push();this.numeric(args[1]||literal(1));x.emit(0x59).push().emit(0x51).call(D+'weekday');return true;
    }
    if(args.length!==1)this.fail(name+' expects one argument');
    if(name==='isdate'){
      const type=this.type(args[0]);
      // IsDate inspects Date values or parseable strings, not every number that
      // CDate could convert. Still evaluate non-Date arguments exactly once.
      this.expression(args[0]);
      if(type==='string'||type==='date')x.push().call(D+(type==='string'?'is-string':'is-number'));
      else if(numbers.has(type))x.value(0);
      else this.fail('IsDate requires a supported scalar expression');
      return true;
    }
    if(name==='cdate'){this.dateExpression(args[0]);return true;}
    if(Object.hasOwn(parts,name)){
      this.dateExpression(args[0]);x.emit(0x89,0xc3).push(parts[name]).emit(0x53).call(D+'part');return true;
    }
    if(this.type(args[0])==='string'){
      this.expression(args[0]);x.push();out();x.emit(0x59).push().emit(0x51).call(D+name+'-parse');
    }else{
      this.dateExpression(args[0]);x.push();out();x.emit(0x59).push().emit(0x51).call(D+name);
    }
    return true;
  }
};

export function emitNativeDateHelpers(c) {
  const x=c.x,check=()=>x.call(N+'check');
  const zero=(offset,bytes)=>{for(let p=offset;p<offset+bytes;p+=4)x.value(0).emit(0x89,0x85).imm(p);};
  // Validate the finite eight-byte input in EAX without changing its representation.
  x.label(D+'validate').enter(8).emit(0x89,0xc3).call(N+'finite').push(addr(-8)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarDateFromR8');check();x.emit(0x89,0xd8).leave();
  for(const [name,symbol]of [['from-double','VarDateFromR8'],['from-currency','VarDateFromCy']]){
    x.label(D+name).enter().value(arg(8));if(name==='from-double')x.call(N+'finite');
    x.emit(0x89,0xc3).push(arg(12)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,symbol);check();x.value(arg(12)).call(D+'validate').leave(8);
  }
  x.label(D+'from-int').enter().api(DLL,'VarDateFromI4',[arg(8),arg(12)]);check();x.value(arg(12)).call(D+'validate').leave(8);
  for(const [name,flags]of [['parse',0],['datevalue-parse',2],['timevalue-parse',1]]){
    x.label(D+name).enter().push(arg(8)).call('native:string:numeric-text').api(DLL,'VarDateFromStr',[arg(8),0x400,0x100|flags,arg(12)]);check();x.value(arg(12)).call(D+'validate').leave(8);
  }
  x.label(D+'string').enter(4);zero(-4,4);x.value(arg(8)).call(D+'validate').emit(0x89,0xc3).push(addr(-4)).push(0x100).push(0x400).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarBstrFromDate');check();x.value(arg(-4)).leave(4);
  x.label(D+'unpack').enter().value(arg(8)).call(D+'validate').emit(0x89,0xc3).push(arg(12)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VariantTimeToSystemTime').test().branch('e','error:5').value(arg(12)).leave(8);
  x.label(D+'part').enter(16).push(addr(-16)).push(arg(8)).call(D+'unpack').value(arg(12)).emit(0x0f,0xb7,0x44,0x05,0xf0).leave(8);
  // Numeric DateValue truncates the signed day; TimeValue uses the absolute fraction.
  x.label(D+'datevalue').enter().push(arg(12)).push(arg(8)).call(N+'fix').call(D+'validate').leave(8);
  x.label(D+'timevalue').enter(8).push(addr(-8)).push(arg(8)).call(N+'fix').push(arg(12)).push(addr(-8)).push(arg(8)).call(N+'subtract').push(arg(12)).push(arg(12)).call(N+'abs').leave(8);
  // IsDate does not turn invalid data into a VB error; source evaluation errors still propagate.
  const bad=x.unique(),done=x.unique();
  x.label(D+'is-number').enter(8).value(arg(8)).emit(0x8b,0x50,4,0x81,0xe2).imm(0x7ff00000).emit(0x81,0xfa).imm(0x7ff00000).branch('e',bad);
  x.emit(0x89,0xc3).push(addr(-8)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarDateFromR8').test().emit(0x0f,0x99,0xc0,0x0f,0xb6,0xc0,0xf7,0xd8).jump(done).label(bad).value(0).label(done).leave(4);
  const invalid=x.unique(),stringDone=x.unique();
  x.label(D+'is-string').enter(8).api(DLL,'SysStringLen',[arg(8)]).test().branch('e',invalid).emit(0x89,0xc3).api('kernel32.dll','lstrlenW',[arg(8)]).emit(0x39,0xd8).branch('ne',invalid);
  x.api(DLL,'VarDateFromStr',[arg(8),0x400,0x100,addr(-8)]).test().emit(0x0f,0x99,0xc0,0x0f,0xb6,0xc0,0xf7,0xd8).jump(stringDone).label(invalid).value(0).label(stringDone).leave(4);
  // System clock getters are read-only. They do not set the OS date or time.
  for(const name of ['now','date','time','timer']){
    x.label(D+name).enter(32).api('kernel32.dll','GetLocalTime',[addr(-16)]);
    if(name==='timer'){
      x.emit(0x0f,0xb7,0x45,0xf8,0x69,0xc0).imm(3600000).emit(0x89,0xc3,0x0f,0xb7,0x45,0xfa,0x69,0xc0).imm(60000).emit(0x01,0xc3,0x0f,0xb7,0x45,0xfc,0x69,0xc0).imm(1000).emit(0x01,0xc3,0x0f,0xb7,0x45,0xfe,0x01,0xd8);
      x.emit(0x89,0xc3).push(arg(8)).emit(0x53).call(N+'from-int');
      x.push(arg(8)).push(c.floatLiteral(1000)).push(arg(8)).call(N+'divide').push(arg(8)).push(arg(8)).call(N+'single').leave(4);
    }else{
      x.api(DLL,'SystemTimeToVariantTime',[addr(-16),arg(8)]).test().branch('e','error:5');
      if(name!=='now')x.push(arg(8)).push(arg(8)).call(D+(name==='date'?'datevalue':'timevalue'));
      x.value(arg(8)).call(D+'validate').leave(4);
    }
  }
  const specified=x.unique(),weekdayDone=x.unique();
  x.label(D+'weekday').enter(20).push(addr(-16)).push(arg(8)).call(D+'unpack').value(arg(12)).compare(0).branch('l','error:5').compare(7).branch('g','error:5').test().branch('ne',specified);
  x.api('kernel32.dll','GetLocaleInfoW',[0x400,0x2000100c,addr(-20),2]).test().branch('e','error:5');
  x.value(arg(-20)).compare(6).branch('a','error:5').emit(0x83,0xc0,1,0x31,0xd2,0xb9).imm(7).emit(0xf7,0xf1,0x8d,0x42,1);
  x.label(specified).emit(0x89,0xc1,0x0f,0xb7,0x45,0xf4,0x83,0xc0,8,0x29,0xc8,0x31,0xd2,0xb9).imm(7).emit(0xf7,0xf1,0x8d,0x42,1).label(weekdayDone).leave(8);
  emitDateSerial(c);emitTimeSerial(c);
}

function emitDateSerial(c) {
  const x=c.x,fullYear=x.unique(),century=x.unique(),normalized=x.unique(),march=x.unique(),eraReady=x.unique();
  // Month normalization precedes the short-year window. Expanding first would
  // turn DateSerial(99,13,1) into 2000 rather than year 0100. The expanded year
  // must not exceed 9999 before the day offset. A sub-100 intermediate year may
  // still produce a valid final date after a large positive day offset.
  x.label(D+'dateserial').enter(24).value(arg(8)).emit(0x89,0xc3);
  // Legacy month decrement wraps as signed Integer before floor division.
  // In particular, month -32768 decrements to 32767, not a 32-bit -32769.
  // floor((month-1)/12), with a positive remainder in 0..11.
  x.value(arg(12)).emit(0x48,0x0f,0xbf,0xc0,0x99,0xb9).imm(12).emit(0xf7,0xf9,0x85,0xd2).branch('ns',normalized).emit(0x48,0x83,0xc2,12).label(normalized).emit(0x01,0xc3,0x42,0x89,0x55,0xf8);
  x.emit(0x89,0xd8).compare(100).branch('ge',fullYear);
  x.api('kernel32.dll','GetCalendarInfoW',[0x400,1,0x20000030,0,0,addr(-4)]).test().branch('e','error:5');
  x.value(arg(-4)).emit(0x31,0xd2,0xb9).imm(100).emit(0xf7,0xf1,0x6b,0xc0,100,0x39,0xd3).branch('le',century).emit(0x83,0xe8,100).label(century).emit(0x01,0xc3);
  x.label(fullYear).emit(0x89,0xd8).compare(1).branch('l','error:5').compare(9999).branch('g','error:5').emit(0x8b,0x55,0xf8);
  x.emit(0x83,0xfa,2).branch('g',march).emit(0x4b).label(march);
  // era=floor(year/400); yoe=year-era*400. Intermediate years fit signed Long.
  x.emit(0x89,0xd8,0x99,0xb9).imm(400).emit(0xf7,0xf9,0x85,0xd2).branch('ns',eraReady).emit(0x48,0x81,0xc2).imm(400);
  x.label(eraReady).emit(0x69,0xc0).imm(146097).emit(0x89,0x45,0xf4,0x89,0x55,0xf0,0x69,0xda).imm(365);
  x.emit(0x89,0xd0,0xc1,0xe8,2,0x01,0xc3).value(arg(-16)).emit(0x31,0xd2,0xb9).imm(100).emit(0xf7,0xf1,0x29,0xc3);
  const pastFeb=x.unique(),monthReady=x.unique();x.value(arg(-8)).compare(2).branch('g',pastFeb).emit(0x83,0xc0,9).jump(monthReady).label(pastFeb).emit(0x83,0xe8,3).label(monthReady);
  x.emit(0x69,0xc0).imm(153).emit(0x83,0xc0,2,0x31,0xd2,0xb9).imm(5).emit(0xf7,0xf1,0x01,0xd8,0x03,0x45,0xf4,0x03,0x45,16,0x2d).imm(693900);
  x.compare(-657434).branch('l','error:5').compare(2958465).branch('g','error:5').emit(0x89,0xc3).push(arg(20)).emit(0x53).call(N+'from-int').leave(16);
}
function emitTimeSerial(c) {
  const x=c.x;
  x.label(D+'timeserial').enter(8).value(arg(8)).emit(0x69,0xc0).imm(3600).emit(0x89,0xc3).value(arg(12)).emit(0x6b,0xc0,60,0x01,0xc3).value(arg(16)).emit(0x01,0xc3).push(addr(-8)).emit(0x53).call(N+'from-int').push(arg(20)).push(c.floatLiteral(86400)).push(addr(-8)).call(N+'divide').call(D+'validate').leave(16);
}
