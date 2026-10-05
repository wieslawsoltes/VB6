/* VB6 Studio Web 0.5.0 - MIT. Generated from modular sources. */
(()=>{'use strict';
const __modules=[];

/* ../language/errors.js */
__modules[0]=(()=>{

class VBError extends Error {
  constructor(message, number = 5, source = null, line = 0, column = 0) { super(message); this.name = 'VBError'; this.number = number; this.source = source; this.line = line; this.column = column; }
}

return {VBError};
})();

/* ../runtime/calendar.js */
__modules[1]=(()=>{
const {VBError}=__modules[0];
/** Gregorian/OLE DATE support. Numeric dates encode civil time, not UTC instants.
 * System-default week settings deliberately use the documented invariant defaults
 * (Sunday / week containing January 1); no Windows NLS API is available here.
 */

const DAY=86400000;
const EPOCH=Date.UTC(1899,11,30);
function round(value){const n=Number(value);if(!Number.isFinite(n))throw new VBError('Type mismatch',13);const floor=Math.floor(n),f=n-floor;return f===.5?(floor%2===0?floor:floor+1):Math.round(n);}
function integer(value){if(value===null)throw new VBError('Invalid use of Null',94);return round(value===undefined?0:value);}
function utcCivil(y,m,d,h=0,n=0,s=0,ms=0){const x=new Date(0);x.setUTCFullYear(y,m,d);x.setUTCHours(h,n,s,ms);return x.getTime();}
function localCivil(y,m,d,h=0,n=0,s=0,ms=0){const x=new Date(0);x.setFullYear(y,m,d);x.setHours(h,n,s,ms);return x;}
function validateDate(date){if(!(date instanceof Date)||!Number.isFinite(date.getTime())||date.getFullYear()<100||date.getFullYear()>9999)throw new VBError('Invalid procedure call or argument',5);return date;}
function dateOrdinal(date){return Math.round((utcCivil(date.getFullYear(),date.getMonth(),date.getDate())-EPOCH)/DAY);}
function civilMillis(date){return utcCivil(date.getFullYear(),date.getMonth(),date.getDate(),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds())-EPOCH;}
function dateToSerial(date){validateDate(date);const day=dateOrdinal(date),fraction=(date.getHours()*3600000+date.getMinutes()*60000+date.getSeconds()*1000+date.getMilliseconds())/DAY;return day<0?day-fraction:day+fraction;}
function serialToDate(value){
  if(!Number.isFinite(value)||value<=-657435||value>=2958466)throw new VBError('Overflow',6);
  const whole=Math.trunc(value),fraction=Math.abs(value-whole),utc=new Date(EPOCH+whole*DAY+Math.round(fraction*DAY));
  return validateDate(localCivil(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate(),utc.getUTCHours(),utc.getUTCMinutes(),utc.getUTCSeconds(),utc.getUTCMilliseconds()));
}
function asDate(value){
  if(value instanceof Date)return validateDate(new Date(value));
  if(value===null)throw new VBError('Invalid use of Null',94);
  if(value===undefined)return serialToDate(0);
  if(typeof value==='number')return serialToDate(value);
  if(typeof value!=='string')throw new VBError('Type mismatch',13);
  const text=value.trim();if(!text)throw new VBError('Type mismatch',13);
  let y,m,d,h=0,n=0,s=0,ms=0,match;
  if((match=text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/))){[,y,m,d,h=0,n=0,s=0,ms=0]=match;}
  else if((match=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i))){[,m,d,y,h=0,n=0,s=0]=match;y=Number(y);if(y<100)y+=y<30?2000:1900;if(match[7]){if(+h<1||+h>12)throw new VBError('Type mismatch',13);h=+h%12+(/^PM$/i.test(match[7])?12:0);}}
  else if((match=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?\s*(AM|PM)?$/i))){[,h,n,s=0,ms=0]=match;[y,m,d]=[1899,12,30];if(match[5]){if(+h<1||+h>12)throw new VBError('Type mismatch',13);h=+h%12+(/^PM$/i.test(match[5])?12:0);}}
  else {const parsed=new Date(text);if(!Number.isFinite(parsed.getTime()))throw new VBError('Type mismatch',13);return validateDate(parsed);}
  [y,m,d,h,n,s]=[y,m,d,h,n,s].map(Number);ms=Number(String(ms).padEnd(3,'0'));
  if(m<1||m>12||d<1||d>daysInMonth(y,m-1)||h<0||h>23||n>59||s>59)throw new VBError('Type mismatch',13);
  return validateDate(localCivil(y,m-1,d,h,n,s,ms));
}
function daysInMonth(y,m){const x=new Date(utcCivil(y,m+1,0));return x.getUTCDate();}
function interval(value){if(value===null)throw new VBError('Invalid use of Null',94);const key=String(value).toLowerCase();if(!['yyyy','q','m','y','d','w','ww','h','n','s'].includes(key))throw new VBError('Invalid interval',5);return key;}
function firstDay(value=1){const n=integer(value);if(n<0||n>7)throw new VBError('Invalid first day of week',5);return (n||1)-1;}
function firstWeek(value=1){const n=integer(value);if(n<0||n>3)throw new VBError('Invalid first week of year',5);return n||1;}
function startWeek(ordinal,first){const dow=((ordinal+6)%7+7)%7;return ordinal-(dow-first+7)%7;}
function firstYearWeek(year,first,rule){const jan=Math.round((utcCivil(year,0,1)-EPOCH)/DAY),start=startWeek(jan,first);return rule===1?start:rule===2?(jan-start<=3?start:start+7):(jan===start?start:start+7);}
function dateAdd(part,amount,value){
  part=interval(part);const count=integer(amount);if(count< -2147483648||count>2147483647)throw new VBError('Overflow',6);const date=asDate(value);
  if(['yyyy','q','m'].includes(part)){
    const months=date.getFullYear()*12+date.getMonth()+count*(part==='yyyy'?12:part==='q'?3:1),year=Math.floor(months/12),month=((months%12)+12)%12;
    if(year<100||year>9999)throw new VBError('Invalid procedure call or argument',5);
    return validateDate(localCivil(year,month,Math.min(date.getDate(),daysInMonth(year,month)),date.getHours(),date.getMinutes(),date.getSeconds(),date.getMilliseconds()));
  }
  const unit={y:DAY,d:DAY,w:DAY,ww:7*DAY,h:3600000,n:60000,s:1000}[part],utc=new Date(EPOCH+civilMillis(date)+count*unit);
  return validateDate(localCivil(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate(),utc.getUTCHours(),utc.getUTCMinutes(),utc.getUTCSeconds(),utc.getUTCMilliseconds()));
}
function dateDiff(part,left,right,first=1,week=1){
  part=interval(part);first=firstDay(first);firstWeek(week);const a=asDate(left),b=asDate(right);
  if(part==='yyyy')return b.getFullYear()-a.getFullYear();
  if(part==='q')return (b.getFullYear()-a.getFullYear())*4+Math.floor(b.getMonth()/3)-Math.floor(a.getMonth()/3);
  if(part==='m')return (b.getFullYear()-a.getFullYear())*12+b.getMonth()-a.getMonth();
  const ad=dateOrdinal(a),bd=dateOrdinal(b);
  if(part==='w')return Math.trunc((bd-ad)/7)||0;
  if(part==='ww')return (startWeek(bd,first)-startWeek(ad,first))/7;
  const units={y:DAY,d:DAY,h:3600000,n:60000,s:1000},unit=units[part];return Math.floor(civilMillis(b)/unit)-Math.floor(civilMillis(a)/unit);
}
function datePart(part,value,first=1,week=1){
  part=interval(part);first=firstDay(first);week=firstWeek(week);const d=asDate(value),ordinal=dateOrdinal(d);
  switch(part){case 'yyyy':return d.getFullYear();case 'q':return Math.floor(d.getMonth()/3)+1;case 'm':return d.getMonth()+1;case 'd':return d.getDate();case 'y':return ordinal-Math.round((utcCivil(d.getFullYear(),0,1)-EPOCH)/DAY)+1;case 'w':return (d.getDay()-first+7)%7+1;case 'h':return d.getHours();case 'n':return d.getMinutes();case 's':return d.getSeconds();case 'ww':{let start=firstYearWeek(d.getFullYear(),first,week);if(ordinal<start)start=firstYearWeek(d.getFullYear()-1,first,week);return Math.floor((ordinal-start)/7)+1;}}
}
function dateSerial(year,month,day){[year,month,day]=[year,month,day].map(integer);if([year,month,day].some(n=>n< -32768||n>32767))throw new VBError('Overflow',6);if(year>=0&&year<100)year+=year<30?2000:1900;return validateDate(localCivil(year,month-1,day));}
function timeSerial(hour,minute,second){[hour,minute,second]=[hour,minute,second].map(integer);if([hour,minute,second].some(n=>n< -32768||n>32767))throw new VBError('Overflow',6);return validateDate(localCivil(1899,11,30,hour,minute,second));}
function weekday(value,first=1){return (asDate(value).getDay()-firstDay(first)+7)%7+1;}
function monthName(month,abbreviate=0){month=integer(month);if(month<1||month>12)throw new VBError('Invalid procedure call',5);return localCivil(2000,month-1,1).toLocaleString('en-US',{month:abbreviate?'short':'long'});}
function weekdayName(day,abbreviate=0,first=1){day=integer(day);if(day<1||day>7)throw new VBError('Invalid procedure call',5);return localCivil(2023,0,1+day-1+firstDay(first)).toLocaleString('en-US',{weekday:abbreviate?'short':'long'});}

return {validateDate,dateOrdinal,dateToSerial,serialToDate,asDate,dateAdd,dateDiff,datePart,dateSerial,timeSerial,weekday,monthName,weekdayName};
})();

/* ../language/lexer.js */
__modules[2]=(()=>{
const {asDate}=__modules[1];
const {VBError}=__modules[0];

/** VB lexical scanner. Tokens retain original source offsets for editor/debugger use. */


function tokenize(text) {
  const out = []; let i = 0;
  const push = (type, value, start, raw = text.slice(start, i)) => out.push({type, value, start, end: i, raw});
  while (i < text.length) {
    const start = i, c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") break;
    if (c === '"') {
      i++; let s = '', closed = false;
      while (i < text.length) { if (text[i] === '"') { if (text[i+1] === '"') { s += '"'; i += 2; } else { i++; closed = true; break; } } else s += text[i++]; }
      if (!closed) throw new VBError('Expected closing quotation mark', 1002, null, 0, start + 1);
      push('string', s, start); continue;
    }
    if (c === '#' && text.indexOf('#', i + 1) >= 0) {
      const end = text.indexOf('#', i + 1); i = end + 1; const d = asDate(text.slice(start + 1, end));
      if (isNaN(d)) throw new VBError('Invalid date literal', 13); push('date', d.toISOString(), start); continue;
    }
    if (c === '&' && /[hHoO]/.test(text[i+1] || '')) {
      const base = text[i+1].toLowerCase() === 'h' ? 16 : 8; i += 2; const digits = i;
      while (i < text.length && (base === 16 ? /[0-9a-f]/i : /[0-7]/).test(text[i])) i++;
      if (i === digits) throw new VBError('Expected digits in numeric literal', 1002);
      let n = parseInt(text.slice(digits, i), base); if (n > 2147483647) n -= 4294967296;
      if (text[i] === '&') i++; push('number', n, start); continue;
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(text[i+1] || ''))) {
      const m = text.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]?\d+)?/); i += m[0].length;
      if (/[%&!#@]/.test(text[i] || '\0')) i++;
      push('number', Number(m[0].replace(/[dD]/, 'e')), start); continue;
    }
    if (/[a-z_\u0080-\uffff]/i.test(c) || c === '[') {
      let name;
      if (c === '[') { const end = text.indexOf(']', i); if (end < 0) throw new VBError('Expected ]', 1002); name = text.slice(i+1, end); i = end+1; }
      else { i++; while (i < text.length && /[\w\u0080-\uffff]/.test(text[i])) i++; if (/[$%&!#@]/.test(text[i] || '\0')) i++; name = text.slice(start,i); }
      if (name.toLowerCase() === 'rem' && (!out.length || out.at(-1).value === ':')) break;
      push('id', name, start); continue;
    }
    const pair = text.slice(i,i+2);
    if (['<=','>=','<>',':='].includes(pair)) { i += 2; push('op', pair, start); continue; }
    if ('+-*/\\^&=<>(),.;:#!'.includes(c)) { i++; push('op',c,start); continue; }
    throw new VBError(`Unexpected character '${c}'`, 1002, null, 0, start + 1);
  }
  out.push({type:'eof',value:'<eof>',start:i,end:i,raw:''}); return out;
}
function splitTop(text, separator = ',') {
  const result = []; let start = 0, depth = 0, quoted = false, date = false;
  for (let i=0;i<text.length;i++) {
    const c = text[i];
    if (c === '"' && !date) { if (quoted && text[i+1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && c === '#' && (date || text.indexOf('#',i+1) >= 0)) date = !date;
    else if (!quoted && !date) {
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === separator && depth === 0 && !(separator === ':' && text[i+1] === '=')) { result.push(text.slice(start,i).trim()); start = i+1; }
    }
  }
  result.push(text.slice(start).trim()); return result;
}
function logicalLines(source) {
  const out=[]; let carry='', lineStart=0;
  source.replace(/\r\n?/g,'\n').split('\n').forEach((raw,index) => {
    if (!carry) lineStart=index+1;
    // Strip comments only outside string/date literals.
    let s='', q=false;
    for(let i=0;i<raw.length;i++) { const c=raw[i]; if(c==='"') { if(q && raw[i+1]==='"'){s+='""'; i++; continue;} q=!q; } if(c==="'"&&!q) break; s+=c; }
    if (/^\s*Rem(?:\s|$)/i.test(s)) s='';
    if (/\s_\s*$/.test(s)) { carry += s.replace(/\s_\s*$/,' ') ; return; }
    s = (carry+s).trim(); carry='';
    if (!s) return;
    // Numeric line labels are distinct from source line numbers. Strip them before
    // recognizing a single-line If, whose complete consequent owns its colons.
    const numbered=s.match(/^(\d+)(?=\s|:|$)\s*:?\s*/);
    if(numbered){out.push({text:numbered[1],line:lineStart,label:true});s=s.slice(numbered[0].length);if(!s)return;}
    const named=s.match(/^([A-Za-z_]\w*)\s*:(?!=)\s*/);
    if(named){out.push({text:named[1],line:lineStart,label:true});s=s.slice(named[0].length);if(!s)return;}
    // Single-line If owns its colon-separated consequent statements.
    if (/^If\b/i.test(s) && /\bThen\s+\S/i.test(s)) { out.push({text:s,line:lineStart}); return; }
    const parts=splitTop(s,':');
    for(let j=0;j<parts.length;j++) if(parts[j]) out.push({text:parts[j],line:lineStart,label:j===0&&parts.length>1&&/^[A-Za-z_]\w*$/.test(parts[j])});
  });
  if(carry) throw new VBError('Unfinished line continuation',1002,null,lineStart);
  return out;
}

return {tokenize,splitTop,logicalLines,VBError};
})();

/* ../runtime/decimal.js */
__modules[3]=(()=>{
const {VBError}=__modules[0];

const MAX=(1n<<96n)-1n;
const abs=n=>n<0n?-n:n;
const ten=n=>10n**BigInt(n);
function rounded(n,d){if(d===0n)throw new VBError('Division by zero',11);const negative=(n<0n)!==(d<0n);n=abs(n);d=abs(d);let q=n/d,r=n%d;if(r*2n>d||r*2n===d&&q%2n!==0n)q++;return negative?-q:q;}
function fit(raw,scale){
  if(!Number.isInteger(scale)||scale<0||scale>4096)throw new VBError('Invalid Decimal scale',5);
  // Each candidate rounds the original coefficient, never a previously rounded
  // value: repeated one-digit reduction produces incorrect double rounding.
  for(let drop=Math.max(0,scale-28);drop<=scale;drop++){
    const value=drop?rounded(raw,ten(drop)):raw;
    if(abs(value)<=MAX){raw=value;scale-=drop;while(scale>0&&raw%10n===0n){raw/=10n;scale--;}return [raw,scale];}
  }
  throw new VBError('Overflow',6);
}
function parse(value){
  if(value instanceof VBDecimal)return [value.coefficient,value.scale];
  if(value===undefined)return [0n,0];
  if(value===null)throw new VBError('Invalid use of Null',94);
  if(typeof value==='boolean')return [value?-1n:0n,0];
  if(typeof value==='bigint')return fit(value,0);
  if(typeof value==='number'){
    if(!Number.isFinite(value))throw new VBError('Overflow',6);
    // OLE Double-to-Decimal conversion uses fifteen significant decimal digits.
    value=value.toPrecision(15);
  }
  if(typeof value!=='string')throw new VBError('Type mismatch',13);
  if(value.length>4096)throw new VBError('Decimal input exceeds conversion limit',7);
  const m=value.trim().match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eEdD]([+-]?\d+))?$/);
  if(!m)throw new VBError('Type mismatch',13);
  const parts=m[2].split('.'),digits=(parts.join('').replace(/^0+/,'')||'0'),exponent=Number(m[3]||0);
  if(digits==='0')return [0n,0];
  if(!Number.isSafeInteger(exponent))throw new VBError('Overflow',6);
  let scale=(parts[1]?.length||0)-exponent,raw=BigInt(digits)*(m[1]==='-'?-1n:1n);
  if(scale<0){if(digits.length-scale>29)throw new VBError('Overflow',6);raw*=ten(-scale);scale=0;}
  if(scale-digits.length>28)return [0n,0];
  return fit(raw,scale);
}
/** Immutable Variant/Decimal: a signed coefficient with 96 magnitude bits and
 * 0..28 decimal places. Arithmetic and comparisons never pass through Number. */
class VBDecimal {
  constructor(value=0){[this.coefficient,this.scale]=parse(value);Object.freeze(this);}
  static fromParts(coefficient,scale){const d=Object.create(VBDecimal.prototype);[d.coefficient,d.scale]=fit(BigInt(coefficient),scale);return Object.freeze(d);}
  static fromBytes(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length!==16)throw new VBError('Invalid Decimal payload length',5);
    const v=new DataView(bytes.buffer,bytes.byteOffset,16),scale=v.getUint8(2),sign=v.getUint8(3);
    if(scale>28||(sign!==0&&sign!==128))throw new VBError('Invalid Decimal payload',5);
    const raw=(BigInt(v.getUint32(4,true))<<64n)|v.getBigUint64(8,true);
    return VBDecimal.fromParts(sign?-raw:raw,scale);
  }
  toBytes(){const bytes=new Uint8Array(16),v=new DataView(bytes.buffer),raw=abs(this.coefficient);v.setUint8(2,this.scale);v.setUint8(3,this.coefficient<0n?128:0);v.setUint32(4,Number(raw>>64n),true);v.setBigUint64(8,raw&((1n<<64n)-1n),true);return bytes;}
  toString(){const negative=this.coefficient<0n,n=abs(this.coefficient).toString().padStart(this.scale+1,'0');return (negative?'-':'')+(this.scale?n.slice(0,-this.scale)+'.'+n.slice(-this.scale):n);}
  valueOf(){return Number(this.coefficient)/10**this.scale;}
  toJSON(){return {__decimal:this.toString()};}
  negate(){return VBDecimal.fromParts(-this.coefficient,this.scale);}
  absolute(){return this.coefficient<0n?this.negate():this;}
  integer(floor=false){let q=this.coefficient/ten(this.scale);if(floor&&this.coefficient<0n&&this.coefficient%ten(this.scale)!==0n)q--;return VBDecimal.fromParts(q,0);}
  roundedInteger(){return rounded(this.coefficient,ten(this.scale));}
  round(digits=0){if(!Number.isInteger(digits)||digits<0||digits>28)throw new VBError('Invalid procedure call',5);return digits>=this.scale?this:VBDecimal.fromParts(rounded(this.coefficient,ten(this.scale-digits)),digits);}
  compare(other){other=new VBDecimal(other);const a=this.coefficient*ten(other.scale),b=other.coefficient*ten(this.scale);return a<b?-1:a>b?1:0;}
  add(other){other=new VBDecimal(other);const scale=Math.max(this.scale,other.scale);return VBDecimal.fromParts(this.coefficient*ten(scale-this.scale)+other.coefficient*ten(scale-other.scale),scale);}
  subtract(other){return this.add(new VBDecimal(other).negate());}
  multiply(other){other=new VBDecimal(other);return VBDecimal.fromParts(this.coefficient*other.coefficient,this.scale+other.scale);}
  divide(other){
    other=new VBDecimal(other);if(other.coefficient===0n)throw new VBError('Division by zero',11);
    // Pick the maximum representable precision directly from the exact ratio.
    const numerator=this.coefficient*ten(other.scale),denominator=other.coefficient*ten(this.scale);
    for(let scale=28;scale>=0;scale--){const raw=rounded(numerator*ten(scale),denominator);if(abs(raw)<=MAX)return VBDecimal.fromParts(raw,scale);}
    throw new VBError('Overflow',6);
  }
}

return {VBDecimal};
})();

/* ../core/window-context.js */
__modules[4]=(()=>{

/** Documents belonging to one live IDE session. No global DOM monkey-patching. */
const documents = new Set();
let current = null;
function registerUIDocument(doc) {
  documents.add(doc);
  const activate = () => { current = doc; };
  doc.addEventListener('focusin', activate, true);
  doc.addEventListener('pointerdown', activate, true);
  return () => {
    documents.delete(doc);
    doc.removeEventListener('focusin', activate, true);
    doc.removeEventListener('pointerdown', activate, true);
    if (current === doc) current = null;
  };
}
function uiDocuments() {
  return [...new Set([...(typeof document === 'undefined' ? [] : [document]), ...documents])];
}
function uiDocument(node) {
  if (node?.ownerDocument) return node.ownerDocument;
  return current || uiDocuments().find(doc => doc.hasFocus()) || document;
}
function hasUIDialog() {
  return uiDocuments().some(doc => doc.querySelector('.ide-modal-cover'));
}

return {registerUIDocument,uiDocuments,uiDocument,hasUIDialog};
})();

/* ../core/core.js */
__modules[5]=(()=>{
const {uiDocument}=__modules[4];

/** Small framework-independent primitives shared by the IDE and runtime. */
class Signal {
  constructor() { this.listeners = new Map(); }
  on(type, fn) { const list = this.listeners.get(type) || new Set(); list.add(fn); this.listeners.set(type, list); return () => list.delete(fn); }
  emit(type, value) { for (const fn of this.listeners.get(type) || []) fn(value); }
  clear() { this.listeners.clear(); }
}
class History extends Signal {
  constructor(limit=120,maxBytes=32*1024*1024){super();this.limit=limit;this.maxBytes=maxBytes;this.undoStack=[];this.redoStack=[];}
  trim(){let size=this.undoStack.reduce((n,e)=>n+(e.bytes??(e.before.length+e.after.length)*2),0);while(this.undoStack.length>1&&(this.undoStack.length>this.limit||size>this.maxBytes)){const e=this.undoStack.shift();size-=(e.bytes??(e.before.length+e.after.length)*2);}}
  record(before,after,label='Edit'){
    const a=JSON.stringify(before),b=JSON.stringify(after);if(a===b)return false;
    this.undoStack.push({before:a,after:b,label});this.redoStack=[];this.trim();this.emit('change');return true;
  }
  // Text edits keep only source strings; they never copy/serialize form trees or image assets.
  recordValue(key,before,after,apply,label='Edit',merge=false){
    if(before===after)return false;const last=this.undoStack.at(-1);
    if(merge&&last?.kind==='value'&&last.key===key)last.after=after;
    else this.undoStack.push({kind:'value',key,before,after,apply,label});
    this.redoStack=[];this.trim();this.emit('change');return true;
  }
  // Sparse edit history: memory is proportional to changed text, not module size.
  recordPatch(key,patch,apply,label='Edit',merge=false){
    if(patch.before===patch.after)return false;const item=structuredClone(patch),bytes=JSON.stringify(item).length*2,last=this.undoStack.at(-1);
    if(merge&&last?.kind==='patch'&&last.key===key&&last.patches.length<256){last.patches.push(item);last.bytes+=bytes;}
    else this.undoStack.push({kind:'patch',key,patches:[item],bytes,apply,label,before:'',after:''});
    this.redoStack=[];this.trim();this.emit('change');return true;
  }
  undo(current){const e=this.undoStack.at(-1);if(!e)return null;const value=e.kind==='patch'?e.apply(structuredClone(current),e.patches,true):e.kind==='value'?e.apply(structuredClone(current),e.before):JSON.parse(e.before);this.undoStack.pop();this.redoStack.push(e);this.emit('change');return value;}
  redo(current){const e=this.redoStack.at(-1);if(!e)return null;const value=e.kind==='patch'?e.apply(structuredClone(current),e.patches,false):e.kind==='value'?e.apply(structuredClone(current),e.after):JSON.parse(e.after);this.redoStack.pop();this.undoStack.push(e);this.emit('change');return value;}
  reset(){this.undoStack=[];this.redoStack=[];this.emit('change');}
}
const clone = value => structuredClone(value);
const lower = name => String(name).toLowerCase().replace(/[$%&!#@]$/, '');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function debounce(fn, delay = 200) { let id; const f = (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), delay); }; f.cancel = () => clearTimeout(id); return f; }
function download(name, data, type = 'application/octet-stream') {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], {type}));
  const a = uiDocument().createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && (k.startsWith('aria-') || ['spellcheck','draggable','contenteditable'].includes(k))) node.setAttribute(k,String(v));
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) if (child != null) node.append(child.nodeType ? child : document.createTextNode(String(child)));
  return node;
}
function safeName(name, fallback = 'Project1') { const s = String(name).replace(/[^\w .-]/g, '_').slice(0, 100); return s || fallback; }
const VERSION = '0.6.0';

return {Signal,History,clone,lower,escapeHTML,debounce,download,el,safeName,VERSION};
})();

/* ../runtime/values.js */
__modules[6]=(()=>{
const {VBDecimal}=__modules[3];
const {asDate,dateToSerial}=__modules[1];
const { VBError }=__modules[2];
const { lower }=__modules[5];


function bankersRound(n) { if(!Number.isFinite(n))throw new VBError('Overflow',6);const floor=Math.floor(n), f=n-floor;return f===0.5?(floor%2===0?floor:floor+1):Math.round(n); }
const NOTHING = Object.freeze({__nothing:true});
const MISSING = Object.freeze({__missing:true});
/** Variant/Error is a value, not a thrown exception or a host object. */
class VBErrorValue {
  constructor(number){number=bankersRound(numeric(number));if(number<0||number>65535)throw new VBError('Overflow',6);this.number=number;Object.freeze(this);}
  toString(){return 'Error '+this.number;}
}
const explicitErrorValue=value=>value instanceof VBErrorValue?value.number:value;

/** Stable typed view: interface-only dispatch without copying object identity. */
class VBInterfaceView {
  constructor(target,name){this.target=target;this.interfaceName=name;this.__vbInterface=true;this.__type=target.__type;Object.freeze(this);}
}
const objectIdentity=value=>value?.__vbInterface?value.target:value;
function objectSupports(value,name){const target=objectIdentity(value),type=lower(name).replace(/^vb\./,'');return !!target?.__vbInstance&&(lower(target.module.name)===type||Object.hasOwn(target.module.interfaceBindings||{},type));}
function interfaceView(value,type){const target=objectIdentity(value),key=lower(type);if(lower(target.module.name)===key)return target;if(!Object.hasOwn(target.module.interfaceBindings||{},key))throw new VBError('Type mismatch: object does not implement '+type,13);target.interfaceViews ||= new Map();if(!target.interfaceViews.has(key))target.interfaceViews.set(key,new VBInterfaceView(target,key));return target.interfaceViews.get(key);}
const isNothing = value => value === NOTHING;
function truth(value){if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);if(value===MISSING)throw new VBError('Argument not optional',449);if(value===NOTHING)throw new VBError('Object variable not set',91);return value != null && value !== undefined && (typeof value === 'string' ? value !== '' : Number(value) !== 0);}
function numeric(value) { if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13); if(value===MISSING)throw new VBError('Argument not optional',449); if(isNothing(value))throw new VBError('Object variable or With block variable not set',91); if(value===undefined)return 0;if(value===null)throw new VBError('Invalid use of Null',94);if(value instanceof Date)return dateToSerial(value);const n=Number(value);if(!Number.isFinite(n))throw new VBError('Type mismatch',13);return n; }
function decimal(value){
  if(value instanceof VBDecimal)return value;
  if(value instanceof VBCurrency)return VBDecimal.fromParts(value.raw,4);
  if(value===MISSING)throw new VBError('Argument not optional',449);
  if(value===NOTHING)throw new VBError('Object variable not set',91);
  if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  return new VBDecimal(value instanceof Date?numeric(value):value);
}
function vbString(value) { if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13); if(value===MISSING)throw new VBError('Argument not optional',449); if(isNothing(value))throw new VBError('Object variable or With block variable not set',91); if(value===undefined)return '';if(value===null)throw new VBError('Invalid use of Null',94);if(value instanceof Date)return value.toLocaleString();if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();return String(value); }
/** Round an exact rational to the nearest integer, ties to even. */
function roundRatio(numerator, denominator) {
  if (denominator === 0n) throw new VBError('Division by zero',11);
  const negative=(numerator<0n)!==(denominator<0n);
  let a=numerator<0n?-numerator:numerator, b=denominator<0n?-denominator:denominator;
  let q=a/b, remainder=a%b;
  if(remainder*2n>b || (remainder*2n===b && q%2n!==0n))q++;
  return negative?-q:q;
}
/** Parse invariant decimal Currency without passing through IEEE-754 first. */
function currencyRaw(value) {
  if(value instanceof VBCurrency)return value.raw;
  if(value===undefined)return 0n;
  if(value===null)throw new VBError('Invalid use of Null',94);
  if(isNothing(value))throw new VBError('Object variable not set',91);
  if(value instanceof Date)value=numeric(value);
  if(typeof value==='boolean')value=value?-1:0;
  const text=String(value).trim();
  const m=text.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eEdD]([+-]?\d+))?$/);
  if(!m)throw new VBError('Type mismatch',13);
  const exponent=Number(m[3]||0), parts=m[2].split('.'), digits=(parts.join('').replace(/^0+/,'')||'0');
  if(digits.length>1024 || Math.abs(exponent)>1024)throw new VBError('Overflow',6);
  let n=BigInt(digits);if(m[1]==='-')n=-n;
  const power=4+exponent-(parts[1]?.length||0);
  return power>=0?n*10n**BigInt(power):roundRatio(n,10n**BigInt(-power));
}
class VBCurrency {
  constructor(value=0,raw=false) {
    this.raw=raw?BigInt(value):currencyRaw(value);
    if(this.raw<-(1n<<63n)||this.raw>(1n<<63n)-1n)throw new VBError('Overflow',6);
    Object.freeze(this);
  }
  valueOf(){return Number(this.raw)/10000;}
  toString(){const n=this.raw<0n?-this.raw:this.raw;const fraction=String(n%10000n).padStart(4,'0').replace(/0+$/,'');return (this.raw<0n?'-':'')+String(n/10000n)+(fraction?'.'+fraction:'');}
  toJSON(){return {__currency:this.raw.toString()};}
  round(digits=0){digits=bankersRound(numeric(digits));if(digits<0||digits>28)throw new VBError('Invalid procedure call',5);if(digits>=4)return this;const scale=10n**BigInt(4-digits);return new VBCurrency(roundRatio(this.raw,scale)*scale,true);}
}
/** Value-copy semantics for records, arrays and dates. Native object references stay shared. */
function makeRecord(name,fields){
  const result={__type:name};Object.defineProperty(result,'__fields',{value:fields});
  for(const [key,cell]of fields){if(['__type','__fields','__proto__','constructor','prototype'].includes(key))throw new VBError('Reserved record member: '+key,1002);Object.defineProperty(result,key,{enumerable:true,get:()=>cell.get(),set:value=>cell.set(value)});}return result;
}
function cloneValue(value,seen=new Map(),depth=0){
  if(depth>64)throw new VBError('Value nesting exceeds runtime limit',7);
  if(value instanceof Date)return new Date(value);
  if(!value||typeof value!=='object'||value===NOTHING||value instanceof VBCurrency)return value;
  if(seen.has(value))return seen.get(value);
  if(value instanceof VBArray){const copy=Object.create(VBArray.prototype);seen.set(value,copy);copy.type=value.type;copy.bounds=value.bounds.map(b=>[...b]);copy.dynamic=value.dynamic;copy.elementFactory=value.elementFactory;copy.fixedLength=value.fixedLength;copy.data=value.data.map(v=>cloneValue(v,seen,depth+1));return copy;}
  if(value.__fields instanceof Map){const fields=new Map(),copy=makeRecord(value.__type,fields);seen.set(value,copy);for(const [name,cell] of value.__fields){const field=Object.create(Cell.prototype);Object.assign(field,{type:cell.type,constant:false,fixedLength:cell.fixedLength,isArray:cell.isArray,elementType:cell.elementType,_value:cloneValue(cell.get(),seen,depth+1)});fields.set(name,field);Object.defineProperty(copy,name,{enumerable:true,get:()=>field.get(),set:v=>field.set(v)});}return copy;}
  return value;
}
function matchingRecord(target,source){
  if(lower(target.__type)!==lower(source.__type)||target.__fields.size!==source.__fields.size)return false;
  for(const [key,cell]of target.__fields){const next=source.__fields.get(key);if(!next||lower(cell.type)!==lower(next.type)||cell.fixedLength!==next.fixedLength||!!cell.isArray!==!!next.isArray)return false;if(cell.get()?.__fields&&(!next.get()?.__fields||!matchingRecord(cell.get(),next.get())))return false;}return true;
}
function commitRecord(target,source){for(const [key,cell]of target.__fields){const next=source.__fields.get(key).get();if(cell.get()?.__fields&&next?.__fields)commitRecord(cell.get(),next);else if(cell.get() instanceof VBArray&&next instanceof VBArray){const array=cell.get();array.bounds=next.bounds;array.data=next.data;array.elementFactory=next.elementFactory;array.fixedLength=next.fixedLength;array.dynamic=next.dynamic;}else cell._value=next;}return target;}
function defaultValue(type='Variant') { switch(lower(type)){case 'string':return '';case 'boolean':case 'byte':case 'integer':case 'long':case 'single':case 'double':return 0;case 'currency':return new VBCurrency();case 'date':return new Date(1899,11,30);case 'object':return NOTHING;default:return undefined;} }
function coerce(value,type='Variant',fixedLength=null) {
  type=lower(type);
  if(type==='variant')return cloneValue(value);
  if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  if(value===MISSING)throw new VBError('Argument not optional',449);
  if(type==='object'){if(value===NOTHING || value&&typeof value==='object'&&!(value instanceof Date)&&!(value instanceof VBCurrency)&&!(value instanceof VBDecimal)&&!(value instanceof VBArray)&&!value.__fields)return value;throw new VBError(value===null?'Invalid use of Null':'Object required',value===null?94:424);}
  if(type==='string'){const s=vbString(value);return fixedLength==null?s:s.padEnd(fixedLength,' ').slice(0,fixedLength);}
  if(type==='date')return asDate(value);
  if(type==='decimal')return decimal(value);
  if(type==='currency')return value instanceof VBCurrency?value:new VBCurrency(value);
  if(type==='boolean'){if(typeof value==='string'&&/^(true|false)$/i.test(value))return /^true$/i.test(value)?-1:0;return numeric(value)!==0?-1:0;}
  if(['byte','integer','long'].includes(type)){const n=value instanceof VBDecimal?Number(value.roundedInteger()):bankersRound(numeric(value)),bounds={byte:[0,255],integer:[-32768,32767],long:[-2147483648,2147483647]}[type];if(n<bounds[0]||n>bounds[1])throw new VBError('Overflow',6);return n;}
  if(type==='single'){const n=Math.fround(numeric(value));if(!Number.isFinite(n))throw new VBError('Overflow',6);return n;}
  if(type==='double')return numeric(value);
  if(value?.__fields){if(lower(value.__type)!==type)throw new VBError('Type mismatch',13);return cloneValue(value);}
  if(value?.__vbInstance||value?.__vbInterface)return interfaceView(value,type);
  return value;
}
class Cell {
  constructor(type='Variant',value=defaultValue(type),constant=false,fixedLength=null){this.type=type;this.constant=constant;this.fixedLength=fixedLength;this._value=coerce(value,type,fixedLength);}
  get(){return this._value;}
  set(value){if(this.constant)throw new VBError('Assignment to constant not permitted',500);const next=coerce(value,this.type,this.fixedLength);if(this.isArray){if(!(next instanceof VBArray)||lower(next.type)!==lower(this.elementType))throw new VBError('Array type mismatch',13);}if(this._value?.__fields){if(!next?.__fields||!matchingRecord(this._value,next))throw new VBError('User-defined type mismatch',13);return commitRecord(this._value,next);}this._value=next;return this._value;}
}
/** Lazily creates As New variables; assigning Nothing resets the factory. */
class LazyCell extends Cell {
  constructor(type,factory){super(type,NOTHING);this.factory=factory;this.pending=null;}
  async get(){if(this._value!==NOTHING)return this._value;if(!this.pending){this.pending=Promise.resolve().then(this.factory).then(value=>{this._value=value;return value;}).finally(()=>{this.pending=null;});}return this.pending;}
  set(value){if(this.pending)throw new VBError('Cannot replace an object during initialization',5);return super.set(value);}
  peek(){return this._value;}
}
class Ref {
  constructor(get,set,type='Variant',fixedLength=null){this.get=get;this.set=set;this.type=type;this.fixedLength=fixedLength;}
}
class VBArray {
  constructor(bounds=[],type='Variant',elementFactory=null,fixedLength=null){this.elementFactory=elementFactory;this.fixedLength=fixedLength;this.type=type;if(bounds.length>60)throw new VBError('An array cannot exceed 60 dimensions',9);this.bounds=bounds.map(([l,u])=>{const b=[bankersRound(numeric(l)),bankersRound(numeric(u))];if(b.some(n=>n< -2147483648||n>2147483647))throw new VBError('Array bound overflow',6);return b;});this.dynamic=!bounds.length;this.allocate();}
  allocate(){let n=this.bounds.length?1:0;for(const [l,u]of this.bounds){if(u<l)throw new VBError('Subscript out of range',9);n*=u-l+1;if(n>1000000)throw new VBError('Array allocation exceeds browser runtime limit (1,000,000 elements)',7);}this.data=Array.from({length:n},()=>this.elementFactory?this.elementFactory():coerce(defaultValue(this.type),this.type,this.fixedLength));}
  offset(indices){if(indices.length!==this.bounds.length||!indices.length)throw new VBError('Subscript out of range',9);let offset=0;for(let d=0;d<indices.length;d++){const [l,u]=this.bounds[d],i=bankersRound(numeric(indices[d]));if(i<l||i>u)throw new VBError('Subscript out of range',9);offset=offset*(u-l+1)+i-l;}return offset;}
  get(...indices){return this.data[this.offset(indices)];}
  set(indices,value){const offset=this.offset(indices),next=coerce(value,this.type,this.fixedLength);if(this.data[offset]?.__fields&&next?.__fields){if(!matchingRecord(this.data[offset],next))throw new VBError('User-defined type mismatch',13);commitRecord(this.data[offset],next);}else this.data[offset]=next;return value;}
  redim(bounds,preserve=false){
    const normalized=bounds.map(([l,u])=>[bankersRound(numeric(l)),bankersRound(numeric(u))]),old=this.bounds;
    if(preserve&&old.length&&(old.length!==normalized.length||old.some(([l,u],i)=>l!==normalized[i][0]||(i<old.length-1&&u!==normalized[i][1]))))throw new VBError('ReDim Preserve can change only the upper bound of the last dimension',9);
    if(!this.dynamic)throw new VBError('This array is fixed or temporarily locked',10);
    const next=new VBArray(normalized,this.type,this.elementFactory,this.fixedLength);next.dynamic=true;
    if(preserve&&old.length){for(const indices of this.indices()){if(indices.every((n,d)=>n<=normalized[d][1]))next.set(indices,this.get(...indices));}}
    this.bounds=next.bounds;this.data=next.data;return this;
  }
  erase(){if(this.dynamic){this.bounds=[];this.data=[];}else this.data=this.data.map(()=>this.elementFactory?this.elementFactory():coerce(defaultValue(this.type),this.type,this.fixedLength));}
  *indices(){if(!this.bounds.length||!this.data.length)return;const at=this.bounds.map(([l])=>l);for(;;){yield [...at];let d=0;for(;d<at.length;d++){if(++at[d]<=this.bounds[d][1])break;at[d]=this.bounds[d][0];}if(d===at.length)return;}}
  *[Symbol.iterator](){for(const at of this.indices())yield this.get(...at);}
  static from(values,base=0){const a=Object.create(VBArray.prototype);a.type='Variant';a.bounds=[[base,base+values.length-1]];a.dynamic=true;a.data=[...values];return a;}
}
class VBCollection {
  constructor(){this.items=[];this.keys=new Map();}
  get Count(){return this.items.length;}
  Add(item,key,before,after){if(key!==undefined&&key!==''&&this.keys.has(String(key).toLowerCase()))throw new VBError('This key is already associated with an element of this collection',457);let index=this.items.length;if(before!==undefined)index=this.index(before);if(after!==undefined)index=this.index(after)+1;const entry={item,key:key===undefined?null:String(key).toLowerCase()};this.items.splice(index,0,entry);if(entry.key!==null)this.keys.set(entry.key,entry);return item;}
  index(key){if(typeof key==='number'){if(key<1||key>this.items.length)throw new VBError('Subscript out of range',9);return Math.trunc(key)-1;}const entry=this.keys.get(String(key).toLowerCase());if(!entry)throw new VBError('Invalid procedure call or argument',5);return this.items.indexOf(entry);}
  Item(key){return this.items[this.index(key)].item;}
  Remove(key){const i=this.index(key),entry=this.items[i];this.items.splice(i,1);if(entry.key!==null)this.keys.delete(entry.key);}
  [Symbol.iterator](){return this.items.map(x=>x.item)[Symbol.iterator]();}
}
class VBDictionary {
  constructor(){this.map=new Map();this.CompareMode=0;}
  normalize(k){return this.CompareMode===1&&typeof k==='string'?k.toLowerCase():k;}
  get Count(){return this.map.size;}
  Add(k,v){const key=this.normalize(k);if(this.map.has(key))throw new VBError('Key already exists',457);this.map.set(key,{key:k,value:v});}
  Item(k){return this.map.get(this.normalize(k))?.value;}
  setItem(k,v){this.map.set(this.normalize(k),{key:k,value:v});}
  Exists(k){return this.map.has(this.normalize(k))?-1:0;}
  Remove(k){if(!this.map.delete(this.normalize(k)))throw new VBError('Key not found',5);}
  RemoveAll(){this.map.clear();}
  Keys(){return VBArray.from([...this.map.values()].map(v=>v.key));}
  Items(){return VBArray.from([...this.map.values()].map(v=>v.value));}
  [Symbol.iterator](){return this.Keys()[Symbol.iterator]();}
}
function unary(op,value){if(value===null)return null;if(value instanceof VBDecimal){if(op==='-')return value.negate();if(op==='+')return value;}if(value instanceof VBCurrency){if(op==='-')return new VBCurrency(-value.raw,true);if(op==='+')return value;}if(op==='not')return ~bankersRound(numeric(value));if(op==='-')return -numeric(value);return numeric(value);}
function binary(op,a,b,compare='binary') {
  if(a instanceof VBErrorValue||b instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  if(op==='is'){const object=v=>v===NOTHING||v&&typeof v==='object'&&!(v instanceof Date)&&!(v instanceof VBCurrency)&&!(v instanceof VBDecimal)&&!(v instanceof VBArray)&&!v.__fields;if(!object(a)||!object(b))throw new VBError('Object required',424);return objectIdentity(a)===objectIdentity(b)?-1:0;}
  if(isNothing(a)||isNothing(b))throw new VBError('Object variable not set',91);
  if(op==='&')return a===null&&b===null?null:(a==null?'':vbString(a))+(b==null?'':vbString(b));
  if(a===null||b===null){if(op==='and'&&(a===0||b===0))return 0;if(op==='or'&&(a===-1||b===-1))return -1;if(op==='imp'&&(a===0||b===-1))return -1;return null;}
  if(['=','<>','<','>','<=','>=','like'].includes(op)) {
    if(a===undefined)a=typeof b==='string'?'':0;if(b===undefined)b=typeof a==='string'?'':0;
    if(op!=='like'&&(a instanceof VBDecimal||b instanceof VBDecimal)){const c=decimal(a).compare(decimal(b));return ({'=':c===0,'<>':c!==0,'<':c<0,'>':c>0,'<=':c<=0,'>=':c>=0}[op])?-1:0;}
    if(a instanceof VBCurrency&&b instanceof VBCurrency){a=a.raw;b=b.raw;}else{if(a instanceof VBCurrency)a=numeric(a);if(b instanceof VBCurrency)b=numeric(b);}
    if(a instanceof Date)a=numeric(a);if(b instanceof Date)b=numeric(b);
    if(compare==='text'&&typeof a==='string'&&typeof b==='string'){a=a.toLocaleLowerCase();b=b.toLocaleLowerCase();}
    if(op==='like'){let pattern='^';for(let i=0;i<String(b).length;i++){const c=String(b)[i];if(c==='*')pattern+='.*';else if(c==='?')pattern+='.';else if(c==='#')pattern+='[0-9]';else if(c==='['){const end=String(b).indexOf(']',i+1);if(end<0)throw new VBError('Invalid pattern string',93);let part=String(b).slice(i+1,end);if(part[0]==='!')part='^'+part.slice(1);pattern+='['+part+']';i=end;}else pattern+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}return new RegExp(pattern+'$',compare==='text'?'i':'').test(String(a))?-1:0;}
    return ({'=':()=>a==b,'<>':()=>a!=b,'<':()=>a<b,'>':()=>a>b,'<=':()=>a<=b,'>=':()=>a>=b}[op]())?-1:0;
  }
  if(op==='+'&&typeof a==='string'&&typeof b==='string')return a+b;
  if((a instanceof VBDecimal||b instanceof VBDecimal)&&['+','-','*','/'].includes(op)){const x=decimal(a),y=decimal(b);return op==='+'?x.add(y):op==='-'?x.subtract(y):op==='*'?x.multiply(y):x.divide(y);}
  if(a instanceof VBCurrency&&b instanceof VBCurrency){if(op==='+')return new VBCurrency(a.raw+b.raw,true);if(op==='-')return new VBCurrency(a.raw-b.raw,true);if(op==='*')return new VBCurrency(roundRatio(a.raw*b.raw,10000n),true);}
  const x=numeric(a),y=numeric(b);let n;
  switch(op){case '+':n=x+y;break;case '-':n=x-y;break;case '*':n=x*y;break;case '/':if(y===0)throw new VBError('Division by zero',11);n=x/y;break;case '\\':if(bankersRound(y)===0)throw new VBError('Division by zero',11);n=Math.trunc(bankersRound(x)/bankersRound(y));break;case 'mod':if(bankersRound(y)===0)throw new VBError('Division by zero',11);n=bankersRound(x)%bankersRound(y);break;case '^':n=x**y;break;case 'and':return bankersRound(x)&bankersRound(y);case 'or':return bankersRound(x)|bankersRound(y);case 'xor':return bankersRound(x)^bankersRound(y);case 'eqv':return ~(bankersRound(x)^bankersRound(y));case 'imp':return (~bankersRound(x))|bankersRound(y);default:throw new VBError(`Unknown operator ${op}`,1002);}
  if(!Number.isFinite(n))throw new VBError('Overflow',6);return n;
}
function describe(value){if(value instanceof VBErrorValue)return value.toString();if(value===MISSING)return '<Missing>'; if(value===undefined)return 'Empty';if(value===null)return 'Null';if(value===NOTHING)return 'Nothing';if(value instanceof VBArray)return `Array(${value.bounds.map(([l,u])=>`${l} To ${u}`).join(', ')})`;if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();if(typeof value==='string')return '"'+value+'"';if(value instanceof Date)return '#'+value.toLocaleString()+'#';if(typeof value==='object')return value.__type||value.constructor?.name||'Object';return String(value);}

return {bankersRound,NOTHING,MISSING,VBErrorValue,explicitErrorValue,VBInterfaceView,objectIdentity,objectSupports,interfaceView,isNothing,truth,numeric,decimal,vbString,roundRatio,VBCurrency,makeRecord,cloneValue,defaultValue,coerce,Cell,LazyCell,Ref,VBArray,VBCollection,VBDictionary,unary,binary,describe,VBDecimal};
})();

/* ../data/common.js */
__modules[7]=(()=>{
const {VBError}=__modules[2];
const {VBArray, VBCurrency, VBDecimal}=__modules[6];


const DATA_LIMITS = Object.freeze({rows:100000, cells:1000000, bytes:20*1024*1024, pages:100});
const DATA_CONSTANTS = Object.freeze({
  adStateClosed:0, adStateOpen:1, adStateConnecting:2, adStateExecuting:4,
  adOpenForwardOnly:0, adOpenKeyset:1, adOpenDynamic:2, adOpenStatic:3,
  adLockReadOnly:1, adLockPessimistic:2, adLockOptimistic:3, adLockBatchOptimistic:4,
  adUseServer:2, adUseClient:3, adCmdText:1, adCmdTable:2, adCmdStoredProc:4,
  adExecuteNoRecords:128, adParamInput:1, adParamOutput:2, adParamInputOutput:3,
  adParamReturnValue:4, adSchemaTables:20, adSchemaColumns:4,
  adModeRead:1, adModeWrite:2, adModeReadWrite:3,
  adSmallInt:2, adInteger:3, adSingle:4, adDouble:5, adCurrency:6,
  adDate:7, adBoolean:11, adVariant:12, adUnsignedTinyInt:17, adBigInt:20,
  adBinary:128, adChar:129, adWChar:130, adVarChar:200, adLongVarChar:201,
  adVarWChar:202, adLongVarWChar:203, adVarBinary:204, adLongVarBinary:205,
  dbOpenSnapshot:4, dbOpenDynaset:2, dbOpenTable:1, dbReadOnly:4,
});
function dataError(message, number=3001){return new VBError(message,number,'VB6.Data');}
function assertData(condition,message,number=3001){if(!condition)throw dataError(message,number);}
function after(value,callback){return value && typeof value.then==='function'?value.then(callback):callback(value);}
function dataList(value){return value instanceof VBArray?[...value]:Array.isArray(value)?value:value===undefined?[]:[value];}
function sqlValue(value){
  if(value==null)return null;
  if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();
  if(value instanceof Date)return value.toISOString();
  if(value instanceof VBArray)return Uint8Array.from([...value]);
  if(value instanceof Uint8Array)return value;
  if(typeof value==='boolean')return value?1:0;
  assertData(typeof value==='string'||typeof value==='number','Unsupported parameter value',13);
  assertData(typeof value!=='number'||Number.isFinite(value),'Non-finite data value',13);
  return value;
}
function quoteIdentifier(value){return '"'+String(value).replace(/"/g,'""')+'"';}
function sameValue(a,b){
  if(a instanceof Uint8Array&&b instanceof Uint8Array)return a.length===b.length&&a.every((v,i)=>v===b[i]);
  if(a instanceof Date&&b instanceof Date)return +a===+b;
  return Object.is(a,b);
}
/** ADO/ODBC strings: quotes, braces, escaped delimiters, case-insensitive keys. */
function parseConnectionString(text){
  const result=Object.create(null);text=String(text??'');let i=0;
  assertData(text.length<=32768,'Connection string is too long',7);
  while(i<text.length){
    while(/[;\s]/.test(text[i]||'')&&i<text.length)i++;
    if(i===text.length)break;
    const start=i;while(i<text.length&&text[i]!=='='&&text[i]!==';')i++;
    assertData(text[i]==='=','Expected key=value in connection string');
    const key=text.slice(start,i++).trim().toLowerCase();assertData(key,'Empty connection property');
    while(/\s/.test(text[i]||'')&&i<text.length)i++;
    let value='';const opening=text[i],closing=opening==='{'?'}':opening;
    if(['"',"'",'{'].includes(opening)){
      i++;let closed=false;
      while(i<text.length){const ch=text[i++];if(ch===closing){if(text[i]===closing){value+=closing;i++;}else{closed=true;break;}}else value+=ch;}
      assertData(closed,'Unterminated connection-string value');
      while(/\s/.test(text[i]||'')&&i<text.length)i++;
      assertData(i===text.length||text[i]===';','Unexpected text after quoted value');
    }else{const start=i;while(i<text.length&&text[i]!==';')i++;value=text.slice(start,i).trim();}
    assertData(!Object.hasOwn(result,key),'Duplicate connection property: '+key);
    result[key]=value;
  }
  return result;
}
function connectionConfiguration(value,profiles=[]){
  if(value&&typeof value==='object')return structuredClone(value);
  const text=String(value??'');const named=profiles.find(p=>p.name.toLowerCase()===text.toLowerCase());
  if(named)return structuredClone(named);
  const fields=parseConnectionString(text);
  if(fields.name){const profile=profiles.find(p=>p.name.toLowerCase()===fields.name.toLowerCase());assertData(profile,'Data connection not found',3706);return structuredClone(profile);}
  const provider=(fields.provider||'SQLite').toLowerCase();
  const result={provider,database:fields['data source']||fields.database||':memory:'};
  if(['rest','json','odata','graphql','gateway'].includes(provider))result.url=fields['data source']||fields.url||'';
  if(fields['rows path'])result.rowsPath=fields['rows path'];
  if(fields['credential reference'])result.credentialRef=fields['credential reference'];
  if(fields.profile)result.profile=fields.profile;
  if(fields['read only'])result.readOnly=/^(true|yes|1)$/i.test(fields['read only']);
  return result;
}
const SECRET=/^(?:(?:x|proxy)[-_ ]?)?(password|pwd|token|secret|authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|cookie|set[-_ ]?cookie)$/i;
function assertPublicConfiguration(config){
  function check(value){
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      assertData(!SECRET.test(key)||item==null||item==='','Store credentials at runtime, not in project data connections',70);
      if(typeof item==='string'&&/connectionstring/i.test(key)){
        for(const [part,v] of Object.entries(parseConnectionString(item)))assertData(!SECRET.test(part)||!v,'Remove credentials from connection strings before saving',70);
      }
      if(typeof item==='string'&&/^(url|endpoint|nexturl|baseurl)$/i.test(key)&&item){
        const u=new URL(item,'http://project.invalid');assertData(!u.username&&!u.password,'Credentials in URLs cannot be shipped',70);
        for(const param of u.searchParams.keys())assertData(!SECRET.test(param),'Secret query parameters cannot be shipped',70);
      }
      check(item);
    }
  }
  check(config);return config;
}
function normalizeDataSources(value){
  if(!value)return {version:1,connections:[],commands:[]};
  assertData(value.version===1,'Unsupported data-source configuration version');
  assertData(Array.isArray(value.connections)&&Array.isArray(value.commands),'Invalid data-source configuration');
  assertData(value.connections.length<=256&&value.commands.length<=2048,'Too many data objects',7);
  const result=structuredClone(value),names=new Set(['connections','commands','setcredential','clearcredentials','constructor','prototype','__type']);
  for(const entry of [...result.connections,...result.commands]){
    assertData(/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(entry.name),'Use a Visual Basic identifier for data objects');
    const key=entry.name.toLowerCase();assertData(!names.has(key),'Duplicate data object: '+entry.name);names.add(key);
  }
  for(const command of result.commands){
    assertData(!names.has(('rs'+command.name).toLowerCase()),'A generated recordset name conflicts with a data object');names.add(('rs'+command.name).toLowerCase());
    assertData(result.connections.some(c=>c.name.toLowerCase()===String(command.connection).toLowerCase()),'Command connection does not exist');
    assertData(!command.parameters||Array.isArray(command.parameters)&&command.parameters.length<=1024,'Invalid command parameters');
    const parameters=new Set();for(const p of command.parameters||[]){assertData(/^[A-Za-z][A-Za-z0-9_]*$/.test(p.name)&&!parameters.has(p.name.toLowerCase()),'Invalid or duplicate parameter name');parameters.add(p.name.toLowerCase());}
  }
  for(const connection of result.connections){
    assertData(typeof connection.provider==='string'&&connection.provider,'A provider is required');
    if(connection.fields){assertData(Array.isArray(connection.fields)&&connection.fields.length<=1024,'Invalid field mapping');const fields=new Set();for(const f of connection.fields){assertData(typeof f.name==='string'&&f.name&&!fields.has(f.name.toLowerCase()),'Duplicate or empty field mapping');fields.add(f.name.toLowerCase());pathValue({},f.path||f.name);}}
    if(connection.timeout!=null)assertData(Number.isFinite(Number(connection.timeout))&&Number(connection.timeout)>0&&Number(connection.timeout)<=600,'Invalid connection timeout');
  }
  return assertPublicConfiguration(result);
}
function safeHttpURL(value,base){
  let url;try{url=new URL(value,base);}catch{throw dataError('Invalid HTTP data-source URL');}
  assertData(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'Only HTTP(S) URLs without embedded credentials are supported',70);
  url.hash='';return url;
}
function pathValue(value,path=''){
  if(!path)return value;
  if(value&&Object.hasOwn(Object(value),path))return value[path];
  const parts=String(path).replace(/^\$\.?/,'').split('.');
  for(const key of parts){assertData(key&&!['__proto__','constructor','prototype'].includes(key),'Invalid JSON field path');value=value!=null&&Object.hasOwn(Object(value),key)?value[key]:undefined;}
  return value;
}
function columnType(value){
  if(value instanceof Uint8Array)return 204;
  if(value instanceof Date)return 7;
  if(typeof value==='boolean')return 11;
  if(typeof value==='number')return Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?3:5;
  if(value===null||value===undefined)return 12;
  return typeof value==='string'?202:12;
}
function resultFromRows(rows,fields){
  assertData(Array.isArray(rows),'Data response must contain an array of records',13);
  assertData(rows.length<=DATA_LIMITS.rows,'Row limit exceeded',7);
  assertData(rows.every(r=>r&&typeof r==='object'&&!Array.isArray(r)),'Every record must be a JSON object',13);
  const keys=new Set();if(!fields?.length)for(const row of rows)for(const key of Object.keys(row)){keys.add(key);assertData(keys.size<=1024,'Column limit exceeded',7);}
  const names=fields?.length?fields.map(f=>f.name):[...keys];
  assertData(names.length<=1024&&names.length*rows.length<=DATA_LIMITS.cells,'Result allocation limit exceeded',7);
  const columns=names.map((name,index)=>{
    const definition=fields?.[index],path=definition?.path||name;
    const samples=rows.map(row=>pathValue(row,path)).filter(v=>v!=null);
    const types=new Set(samples.map(columnType));
    let type=types.size===1?[...types][0]:[...types].every(t=>[3,5].includes(t))?5:12;
    if(definition?.type!=null)type=Number(definition.type);
    return {Name:name,Type:type,DefinedSize:definition?.size||0,path};
  });
  const values=rows.map(row=>columns.map(col=>pathValue(row,col.path)??null));
  return {columns,values,rowsAffected:0};
}

return {DATA_LIMITS,DATA_CONSTANTS,dataError,assertData,after,dataList,sqlValue,quoteIdentifier,sameValue,parseConnectionString,connectionConfiguration,assertPublicConfiguration,normalizeDataSources,safeHttpURL,pathValue,columnType,resultFromRows};
})();

/* ../runtime/binary-codec.js */
__modules[8]=(()=>{
const {VBError}=__modules[2];
const {VBArray,VBCurrency,VBDecimal,VBErrorValue,NOTHING,coerce,numeric,vbString,Cell,makeRecord : buildRecord}=__modules[6];


// Classic VB files use an ANSI code page. This browser runtime explicitly uses
// Windows-1252 rather than silently writing UTF-8 or host-locale-dependent bytes.
const c1=[0x20AC,0x81,0x201A,0x192,0x201E,0x2026,0x2020,0x2021,0x2C6,0x2030,0x160,0x2039,0x152,0x8D,0x17D,0x8F,0x90,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x2DC,0x2122,0x161,0x203A,0x153,0x9D,0x17E,0x178];
const charCodes=Array.from({length:256},(_,i)=>i>=128&&i<160?c1[i-128]:i);
const encodeMap=new Map(charCodes.map((code,i)=>[String.fromCharCode(code),i]));
function encodeANSI(text){return Uint8Array.from(String(text),c=>{const b=encodeMap.get(c);if(b===undefined)throw new VBError('Character is not representable in the Windows-1252 file encoding',5);return b;});}
function decodeANSI(bytes){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...Array.from(bytes.subarray(i,i+8192),byte=>charCodes[byte]));return result;}
const TYPES={byte:[1,'Uint8'],integer:[2,'Int16'],long:[4,'Int32'],single:[4,'Float32'],double:[8,'Float64'],boolean:[2,'Int16'],date:[8,'Float64'],currency:[8,'BigInt64']};
const VARTYPES={0:'Empty',1:'Null',2:'Integer',3:'Long',4:'Single',5:'Double',6:'Currency',7:'Date',8:'String',10:'Error',11:'Boolean',14:'Decimal',17:'Byte'};
const MAX_BYTES=20*1024*1024;

/** Builds a typed UDT value with non-enumerable field metadata. */
function makeRecord(name,fields){return buildRecord(name,fields);}
function recordLength(value){
  if(!value?.__fields)throw new VBError('User-defined type required',13);
  let n=0;
  for(const [,cell]of value.__fields){const v=cell.get(),type=String(cell.type).toLowerCase();if(v?.__fields)n+=recordLength(v);else if(v instanceof VBArray){for(const element of v.data)n+=element?.__fields?recordLength(element):TYPES[v.type.toLowerCase()]?.[0]||String(element??'').length;}else if(type==='string')n+=cell.fixedLength??String(v??'').length;else if(TYPES[type])n+=TYPES[type][0];else if(type==='variant')n+=16;else throw new VBError('Unsupported record field: '+cell.type,458);}
  return n;
}
class Writer {
  constructor(){this.chunks=[];this.length=0;}
  write(bytes){if(this.length+bytes.length>MAX_BYTES)throw new VBError('Binary record exceeds 20 MiB limit',7);this.chunks.push(bytes);this.length+=bytes.length;}
  number(type,value){const [size,method]=TYPES[type],bytes=new Uint8Array(size);new DataView(bytes.buffer)['set'+method](0,value,true);this.write(bytes);}
  finish(){const bytes=new Uint8Array(this.length);let p=0;for(const b of this.chunks){bytes.set(b,p);p+=b.length;}return bytes;}
}
class Reader {
  constructor(bytes){this.bytes=bytes;this.position=0;}
  read(length){if(!Number.isInteger(length)||length<0||this.position+length>this.bytes.length)throw new VBError('Input past end of file',62);const result=this.bytes.subarray(this.position,this.position+length);this.position+=length;return result;}
  number(type){const [size,method]=TYPES[type],b=this.read(size);return new DataView(b.buffer,b.byteOffset,b.byteLength)['get'+method](0,true);}
}
function variantType(value){if(value instanceof VBDecimal)return 14;if(value instanceof VBErrorValue)return 10;if(value===undefined)return 0;if(value===null)return 1;if(value instanceof VBCurrency)return 6;if(value instanceof Date)return 7;if(typeof value==='string')return 8;if(typeof value==='boolean')return 11;if(typeof value==='number')return 5;throw new VBError('Cannot serialize objects or scalar Variants containing arrays',458);}
function* arrayIndices(bounds){if(!bounds.length)return;const idx=bounds.map(([l])=>l);while(true){yield [...idx];let d=0;for(;d<bounds.length;d++){if(++idx[d]<=bounds[d][1])break;idx[d]=bounds[d][0];}if(d===bounds.length)break;}}
function put(writer,value,schema,mode,inRecord=false,depth=0){
  if(depth>32)throw new VBError('Record nesting exceeds runtime limit',7);
  const type=String(schema.type||'Variant').toLowerCase();
  if(value instanceof VBArray){
    if(!schema.isArray)throw new VBError('Scalar Variant containing an array is not supported by Put',458);
    if(!value.bounds.length)throw new VBError('Subscript out of range',9);
    if(value.dynamic&&(mode==='random'||inRecord)){writer.number('integer',value.bounds.length);for(const [lo,hi]of value.bounds){writer.number('long',hi-lo+1);writer.number('long',lo);}}
    for(const indices of arrayIndices(value.bounds))put(writer,value.get(...indices),{type:value.type,fixedLength:value.fixedLength},mode,inRecord,depth+1);
    return;
  }
  if(value?.__fields){for(const [,cell]of value.__fields)put(writer,cell.get(),cell,mode,true,depth+1);return;}
  if(value===NOTHING||type==='object')throw new VBError('Objects cannot be written with Put',458);
  if(type==='variant'){const kind=variantType(value);writer.number('integer',kind);if(kind<2)return;put(writer,value,{type:VARTYPES[kind]},mode,kind===8||inRecord,depth+1);return;}
  if(type==='decimal'){writer.write(coerce(value,'Decimal').toBytes());return;}
  if(type==='error'){writer.number('long',value.number);return;}
  if(type==='string'){
    const text=coerce(value,'String',schema.fixedLength),bytes=encodeANSI(text);
    if(schema.fixedLength==null&&(mode==='random'||inRecord)){if(bytes.length>65535)throw new VBError('String exceeds 16-bit record descriptor',63);writer.number('integer',bytes.length>32767?bytes.length-65536:bytes.length);}
    writer.write(bytes);return;
  }
  if(!TYPES[type])throw new VBError('Unsupported file data type: '+schema.type,458);
  const coerced=coerce(value,type);
  writer.number(type,type==='currency'?coerced.raw:type==='date'?numeric(coerced):coerced);
}
function get(reader,schema,current,mode,inRecord=false,depth=0){
  if(depth>32)throw new VBError('Record nesting exceeds runtime limit',7);
  const type=String(schema.type||'Variant').toLowerCase();
  if(current instanceof VBArray||schema.isArray){
    if(!schema.isArray)throw new VBError('Scalar Variant containing an array is not supported by Get',458);
    let bounds=current?.bounds||[],dynamic=current?.dynamic??true,elementType=current?.type||schema.elementType||'Variant';
    if(dynamic&&(mode==='random'||inRecord)){
      const rank=reader.number('integer');if(rank<1||rank>32)throw new VBError('Invalid array descriptor',63);
      bounds=[];for(let i=0;i<rank;i++){const size=reader.number('long'),lower=reader.number('long');if(size<1)throw new VBError('Invalid array descriptor',63);bounds.push([lower,lower+size-1]);}
    }
    if(!bounds.length)throw new VBError('Dimension the array before Binary Get',9);
    const result=new VBArray(bounds,elementType,current?.elementFactory,current?.fixedLength);result.dynamic=dynamic;
    for(const idx of arrayIndices(bounds))result.set(idx,get(reader,{type:elementType,fixedLength:current?.fixedLength},result.get(...idx),mode,inRecord,depth+1));
    return result;
  }
  if(current?.__fields){const fields=new Map();for(const [name,cell]of current.__fields){const value=get(reader,cell,cell.get(),mode,true,depth+1),next=new Cell(cell.type,value,false,cell.fixedLength);next.isArray=cell.isArray;next.elementType=cell.elementType;fields.set(name,next);}return makeRecord(current.__type,fields);}
  if(type==='object'||current===NOTHING)throw new VBError('Objects cannot be read with Get',458);
  if(type==='variant'){
    const kind=reader.number('integer');if(kind===0)return undefined;if(kind===1)return null;if(!VARTYPES[kind])throw new VBError('Unsupported Variant file descriptor: '+kind,458);
    return get(reader,{type:VARTYPES[kind]},undefined,mode,kind===8||inRecord,depth+1);
  }
  if(type==='decimal')return VBDecimal.fromBytes(reader.read(16));
  if(type==='error')return new VBErrorValue(reader.number('long'));
  if(type==='string'){
    const length=schema.fixedLength??((mode==='random'||inRecord)?reader.number('integer')&65535:vbString(current).length);
    return decodeANSI(reader.read(length));
  }
  if(!TYPES[type])throw new VBError('Unsupported file data type: '+schema.type,458);
  const value=reader.number(type);return type==='currency'?new VBCurrency(value,true):coerce(value,type);
}
function encodeVariable(value,schema={},mode='binary'){const writer=new Writer();put(writer,value,schema,mode);return writer.finish();}
function decodeVariable(bytes,schema={},current,mode='binary'){const reader=new Reader(bytes),value=get(reader,schema,current,mode);return {value,bytesRead:reader.position};}

return {encodeANSI,decodeANSI,makeRecord,recordLength,encodeVariable,decodeVariable};
})();

/* ../project/binary-assets.js */
__modules[9]=(()=>{
const {VBError}=__modules[2];

const MAX_RESOURCE_BYTES=20*1024*1024;
const fail=message=>{throw new VBError(message,1002);};
function fromBase64(data){if(typeof data!=='string'||data.length>MAX_RESOURCE_BYTES*4/3+8)fail('invalid or oversized base64 resource');let binary;try{binary=atob(data);}catch{fail('invalid base64');}return Uint8Array.from(binary,c=>c.charCodeAt(0));}
function toBase64(bytes){if(bytes.length>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');let result='';for(let at=0;at<bytes.length;at+=8192)result+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(result);}

return {fromBase64,toBase64};
})();

/* ../project/native-text.js */
__modules[10]=(()=>{
const {decodeANSI,encodeANSI}=__modules[8];
const {VBError}=__modules[2];
const {fromBase64,toBase64}=__modules[9];
/** Native project text: preserve bytes, BOMs and line endings; never replace unmappable characters. */



const NATIVE_ENCODINGS=['auto','windows-1252','windows-1250','windows-1251','windows-1253','windows-1254','windows-1255','windows-1256','windows-1257','windows-1258','windows-874','shift_jis','gbk','big5','euc-kr','utf-8','utf-16le','utf-16be'];
const encoders=new Map();
const fail=message=>{throw new VBError(message,1002);};
function bytesOf(value){if(typeof value==='string')return new TextEncoder().encode(value);if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);if(value instanceof ArrayBuffer)return new Uint8Array(value);if(Array.isArray(value))return Uint8Array.from(value);fail('Expected text, an ArrayBuffer or a byte array');}
function equalBytes(a,b){a=bytesOf(a);b=bytesOf(b);return a.length===b.length&&a.every((v,i)=>v===b[i]);}
function linesOf(text){return String(text).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean)||[];}
function lineBody(line){return line.replace(/[\r\n]+$/,'');}
function lineEnding(line){return line.slice(lineBody(line).length);}
function preferredEOL(text){return text.match(/\r\n|\r|\n/)?.[0]||'\r\n';}
function unquote(value){const s=String(value).trim();return /^"(?:[^"]|"")*"$/.test(s)?s.slice(1,-1).replace(/""/g,'"'):s;}
function nativePathValue(value){return /[\s"';]/.test(value)?quote(value):value;}
function quote(value){return '"'+String(value).replace(/"/g,'""')+'"';}
/** Manifest paths may contain literal apostrophes; only whitespace-delimited ones start comments there. */
function commentAt(value,manifest=false){let quoted=false;for(let i=0;i<value.length;i++){if(value[i]==='"'){if(quoted&&value[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(value[i]==="'"&&!quoted&&(!manifest||i>0&&/[ \t]/.test(value[i-1])))return i;}return -1;}
function replaceLineValue(line,value,manifest=false){const body=lineBody(line),match=body.match(/^(\s*[^=]+?\s*=\s*)(.*)$/);if(!match)return line;const at=commentAt(match[2],manifest),tail=at<0?'':match[2].slice(at),space=at<0?'':match[2].slice(0,at).match(/\s*$/)[0];return match[1]+value+space+tail+lineEnding(line);}

function decodeNativeBytes(bytes,encoding){return new TextDecoder(encoding).encoding==='windows-1252'?decodeANSI(bytes):new TextDecoder(encoding,{fatal:true,ignoreBOM:true}).decode(bytes);}
function decodeNativeText(input,{encoding='auto'}={}){
  // String callers have no original byte encoding; keep the legacy CRLF export convention.
  if(typeof input==='string')return {text:input.replace(/\r\n|\r|\n/g,'\r\n'),encoding:'utf-8',bom:false};
  const bytes=bytesOf(input);let label=encoding,bom=false,skip=0;
  if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf){label='utf-8';bom=true;skip=3;}
  else if(bytes[0]===0xff&&bytes[1]===0xfe){label='utf-16le';bom=true;skip=2;}
  else if(bytes[0]===0xfe&&bytes[1]===0xff){label='utf-16be';bom=true;skip=2;}
  else if(label==='auto'){label='windows-1252';if(bytes.some(b=>b>=128))try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);label='utf-8';}catch{}}
  try{const decoder=new TextDecoder(label,{fatal:true,ignoreBOM:true});return {text:decodeNativeBytes(bytes.subarray(skip),decoder.encoding),encoding:decoder.encoding,bom,bytes:toBase64(bytes)};}
  catch(error){fail('Cannot decode native source as '+label+': '+error.message);}
}
function legacyEncoder(label){
  if(encoders.has(label))return encoders.get(label);
  const decoder=new TextDecoder(label,{fatal:true,ignoreBOM:true}),map=new Map();
  const add=bytes=>{try{const text=decoder.decode(bytes);if([...text].length===1&&text!=='\ufffd'&&!map.has(text))map.set(text,bytes.slice());}catch{}};
  for(let a=0;a<256;a++)add(Uint8Array.of(a));
  if(['shift_jis','gbk','big5','euc-kr'].includes(decoder.encoding))for(let a=0x81;a<=0xfe;a++)for(let b=0x40;b<=0xff;b++)add(Uint8Array.of(a,b));
  encoders.set(label,map);return map;
}
function encodeNativeText(text,document={encoding:'windows-1252',bom:false},override){
  document ||= {encoding:'windows-1252',bom:false};
  const encoding=override&&override!=='auto'?new TextDecoder(override).encoding:document.encoding||'windows-1252';
  if((!override||override==='auto')&&text===document.text&&document.bytes!==undefined)return fromBase64(document.bytes);
  if(encoding==='utf-8'){
    if(!document.bom)return text;
    const data=new TextEncoder().encode(text),bytes=new Uint8Array(data.length+3);bytes.set([239,187,191]);bytes.set(data,3);return bytes;
  }
  if(/^utf-16(?:le|be)$/.test(encoding)){
    const skip=document.bom?2:0,bytes=new Uint8Array(text.length*2+skip),view=new DataView(bytes.buffer),little=encoding==='utf-16le';if(skip)view.setUint16(0,0xfeff,little);for(let i=0;i<text.length;i++)view.setUint16(skip+i*2,text.charCodeAt(i),little);return bytes;
  }
  if(new TextDecoder(encoding).encoding==='windows-1252'){const bytes=encodeANSI(text);return bytes.every(b=>b<128)?text:bytes;}
  const map=legacyEncoder(encoding),parts=[];let length=0;
  for(const char of text){const data=map.get(char);if(!data)fail('Character '+quote(char)+' is not representable in '+encoding+'. Choose a matching native source encoding; no file was written.');parts.push(data);length+=data.length;}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  // ASCII text remains string-compatible with the existing sourceFiles API.
  return bytes.every(b=>b<128)?text:bytes;
}

return {NATIVE_ENCODINGS,bytesOf,equalBytes,linesOf,lineBody,lineEnding,preferredEOL,unquote,nativePathValue,quote,commentAt,replaceLineValue,decodeNativeBytes,decodeNativeText,encodeNativeText};
})();

/* ../project/frx.js */
__modules[11]=(()=>{
const {VBError}=__modules[2];
const {decodeNativeBytes,encodeNativeText,bytesOf}=__modules[10];
/** Bounded FRX records; no COM deserialization, native code, or remote resource loads. */


const MAX_RESOURCE_BYTES=20*1024*1024;
const fail=message=>{throw new VBError('FRX: '+message,1002);};
function cleanProjectPath(path){
  path=String(path).replace(/\\/g,'/');if(!path||path.length>4096||/^[\/]|:|[\x00-\x1f]/i.test(path))fail('unsafe project path: '+path);
  const out=[];for(const part of path.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!out.length)fail('path escapes project root: '+path);out.pop();}else out.push(part);}if(!out.length)fail('empty project path');return out.join('/');
}
function relativeProjectPath(fromFile,toFile){const a=cleanProjectPath(fromFile).split('/');a.pop();const b=cleanProjectPath(toFile).split('/');while(a.length&&b.length&&a[0].toLowerCase()===b[0].toLowerCase()){a.shift();b.shift();}return [...a.map(()=> '..'),...b].join('\\');}
function resolveProjectPath(paths,owner,reference,{basenameFallback=false}={}){
  if(/^[\\/]|^[a-z]:|\0/i.test(String(reference)))fail('unsafe resource reference: '+reference);
  const names=[...paths],parent=String(owner||'').replace(/\\/g,'/').split('/').slice(0,-1).join('/');
  const candidate=cleanProjectPath((parent?parent+'/':'')+reference),matches=names.filter(n=>n.toLowerCase()===candidate.toLowerCase());
  if(matches.length>1)fail('ambiguous case-insensitive file: '+candidate);if(matches.length)return matches[0];
  if(basenameFallback){const base=String(reference).replace(/\\/g,'/').split('/').at(-1).toLowerCase(),found=names.filter(n=>n.split('/').at(-1).toLowerCase()===base);if(found.length>1)fail('ambiguous file name: '+reference);return found[0]||null;}return null;
}
function fromBase64(data){if(typeof data!=='string'||data.length>MAX_RESOURCE_BYTES*4/3+8)fail('invalid or oversized base64 resource');let binary;try{binary=atob(data);}catch{fail('invalid base64');}return Uint8Array.from(binary,c=>c.charCodeAt(0));}
function toBase64(bytes){if(bytes.length>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');let result='';for(let at=0;at<bytes.length;at+=8192)result+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(result);}
function view(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function range(bytes,offset,length){if(!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<0||offset+length>bytes.length)fail('truncated record or out-of-range offset');}
function resourceOffset(value){if(typeof value==='number'){if(Number.isInteger(value)&&value>=0)return value;}else if(/^[0-9a-f]{1,8}$/i.test(value||''))return parseInt(value,16);fail('invalid hexadecimal resource offset');}
/** Decode only the record identified by the property; never guess by scanning untrusted bytes. */
function readFRXRecord(input,offset,property='Text',{encoding='windows-1252'}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');offset=resourceOffset(offset);range(bytes,offset,1);const v=view(bytes),remaining=bytes.length-offset;
  if(property==='List'){
    range(bytes,offset,4);const count=v.getUint16(offset,true),signature=v.getUint16(offset+2,true);if(![3,7].includes(signature))fail('unsupported list signature');let cursor=offset+4;const items=[];
    for(let i=0;i<count;i++){range(bytes,cursor,2);const size=v.getUint16(cursor,true);cursor+=2;range(bytes,cursor,size);items.push(decodeNativeBytes(bytes.subarray(cursor,cursor+size),encoding));cursor+=size;}return {kind:'list',items,signature,bytesRead:cursor-offset};
  }
  if(remaining>=12&&v.getUint32(offset+4,true)===0x746c){const size=v.getUint32(offset,true),payload=v.getUint32(offset+8,true);if(size!==payload+8)fail('inconsistent picture lengths');range(bytes,offset+12,payload);return {kind:'picture',bytes:bytes.slice(offset+12,offset+12+payload),bytesRead:12+payload};}
  let header=1,length=bytes[offset],kind='text8';
  if(property==='LongText'||bytes[offset]===255&&remaining>=4&&v.getUint32(offset,true)===remaining-4){range(bytes,offset,4);header=4;length=v.getUint32(offset,true);kind='text32';}
  else if(bytes[offset]===255){range(bytes,offset,3);header=3;length=v.getUint16(offset+1,true);kind='text16';}
  else if(remaining>=4&&bytes.subarray(offset,offset+4).includes(0)){header=4;length=v.getUint32(offset,true);kind='text32';}
  range(bytes,offset+header,length);return {kind,bytes:bytes.slice(offset+header,offset+header+length),bytesRead:header+length};
}
function writeFRXRecord(value,kind='text32',{signature=3,encoding='windows-1252'}={}){
  if(kind==='list'){
    if(!Array.isArray(value)||value.length>65535)fail('list must contain at most 65,535 items');const encoded=value.map(item=>bytesOf(encodeNativeText(String(item),{encoding})));for(const b of encoded)if(b.length>65535)fail('list item exceeds 65,535 bytes');const size=4+encoded.reduce((n,b)=>n+2+b.length,0);if(size>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');const out=new Uint8Array(size),v=view(out);v.setUint16(0,value.length,true);v.setUint16(2,[3,7].includes(signature)?signature:3,true);let at=4;for(const b of encoded){v.setUint16(at,b.length,true);out.set(b,at+2);at+=2+b.length;}return out;
  }
  const bytes=kind==='picture'?new Uint8Array(value):bytesOf(encodeNativeText(String(value),{encoding}));if(bytes.length>MAX_RESOURCE_BYTES-12)fail('resource exceeds 20 MiB limit');let header=kind==='picture'?12:kind==='text8'&&bytes.length<255?1:kind==='text16'&&bytes.length<=65535?3:4;const out=new Uint8Array(header+bytes.length),v=view(out);if(header===12){v.setUint32(0,bytes.length+8,true);v.setUint32(4,0x746c,true);v.setUint32(8,bytes.length,true);}else if(header===4)v.setUint32(0,bytes.length,true);else if(header===3){out[0]=255;v.setUint16(1,bytes.length,true);}else out[0]=bytes.length;out.set(bytes,header);return out;
}
function rasterDataURL(input){
  let bytes=input,mime='';const b=bytes,v=view(bytes),starts=hex=>hex.every((n,i)=>b[i]===n);
  if(starts([137,80,78,71,13,10,26,10]))mime='image/png';
  else if(starts([255,216,255]))mime='image/jpeg';
  else if(starts([71,73,70,56])&&[55,57].includes(b[4])&&b[5]===97)mime='image/gif';
  else if(starts([66,77]))mime='image/bmp';
  else if(starts([0,0,1,0]))mime='image/x-icon';
  else if(b.length>=40&&[40,108,124].includes(v.getUint32(0,true))){
    const header=v.getUint32(0,true),bits=v.getUint16(14,true),compression=v.getUint32(16,true);if(![1,4,8,16,24,32].includes(bits)||![0,3,6].includes(compression))return null;
    const colors=v.getUint32(32,true)||(bits<=8?1<<bits:0),extra=header===40?(compression===3?12:compression===6?16:0):0,pixelOffset=14+header+colors*4+extra;
    if(colors>256||pixelOffset>bytes.length+14)return null;const bmp=new Uint8Array(bytes.length+14),w=view(bmp);w.setUint16(0,0x4d42,true);w.setUint32(2,bmp.length,true);w.setUint32(10,pixelOffset,true);bmp.set(bytes,14);bytes=bmp;mime='image/bmp';
  }
  return mime?'data:'+mime+';base64,'+toBase64(bytes):null;
}
function rasterBytes(url){const match=String(url).match(/^data:image\/(?:png|jpeg|gif|bmp|x-icon|vnd\.microsoft\.icon);base64,([A-Za-z0-9+/=]+)$/i);if(!match)fail('native Picture export requires an embedded PNG, JPEG, GIF, BMP, or ICO');const bytes=fromBase64(match[1]);if(!rasterDataURL(bytes))fail('unsupported raster signature');return bytes;}
const TEXT_PROPERTIES=new Set(['text','caption','tooltiptext','textrtf','linktopic','tag']);
function hydrateResources(project,diagnostics=[]){
  const cache=new Map(),paths=Object.keys(project.assets||{});
  for(const module of project.modules){if(!module.form)continue;for(const node of [module.form,...module.form.controls,...module.form.menus])for(const [key,reference]of Object.entries(node.properties||{})){
    if(!reference?.resource)continue;try{
      const path=resolveProjectPath(paths,module.sourcePath||module.name+'.frm',reference.resource);
      if(!path)fail('missing resource file '+reference.resource);if(!cache.has(path))cache.set(path,fromBase64(project.assets[path].data));
      const lower=key.toLowerCase();if(!TEXT_PROPERTIES.has(lower)&&!['list','picture','icon','mouseicon'].includes(lower))fail('property '+key+' is retained as an opaque resource');
      const record=readFRXRecord(cache.get(path),reference.offset,lower==='list'?'List':reference.text?'LongText':key,{encoding:module.resourceEncoding||'windows-1252'});let value;
      if(lower==='list')value=record.items;else if(['picture','icon','mouseicon'].includes(lower)){if(record.kind!=='picture')fail('picture header not supported');value=rasterDataURL(record.bytes);if(!value)fail('native/OLE/metafile picture retained; no raster browser decoder');}
      else {if(record.kind==='picture')fail('text references a picture record');value=decodeNativeBytes(record.bytes,module.resourceEncoding||'windows-1252');}
      node.resourceBindings ||= {};node.resourceBindings[key]={reference:{...reference},assetPath:path,kind:record.kind,signature:record.signature,encoding:module.resourceEncoding||'windows-1252',originalValue:structuredClone(value)};node.properties[key]=value;
    }catch(error){diagnostics.push({severity:'warning',source:module.name,message:node.name+'.'+key+': '+error.message+' (original bytes and reference retained).'});}
  }}return project;
}
/** Native export is copy-on-write: original blobs never move; edited entries append. */
function prepareResources(project){
  const modules=structuredClone(project.modules),files=Object.create(null);for(const [path,asset]of Object.entries(project.assets||{})){cleanProjectPath(path);if(asset.encoding==='base64')files[path]=fromBase64(asset.data);}
  const append=(path,value,kind,options)=>{path=cleanProjectPath(path);const record=writeFRXRecord(value,kind,options),before=files[path]||new Uint8Array();if(before.length+record.length>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');const all=new Uint8Array(before.length+record.length);all.set(before);all.set(record,before.length);files[path]=all;return before.length.toString(16).toUpperCase().padStart(4,'0');};
  for(const module of modules){if(!module.form)continue;const source=module.sourcePath||module.name+'.frm';for(const node of [module.form,...module.form.controls,...module.form.menus])for(const [key,value]of Object.entries(node.properties||{})){
    if(value?.resource){
      const originalSource=module.nativeSource?.path||project.nativeProject?.files?.find(file=>file.moduleId===module.id)?.resolved||source;
      const references=module.nativeSource?.resourceReferences;
      const oldReference=Array.isArray(references)?references.find(r=>r.id===node.id&&r.key===key)?.value:undefined;
      // An explicitly edited/new reference is relative to the current module.
      if(Array.isArray(references)&&JSON.stringify(oldReference)!==JSON.stringify(value))continue;
      if(originalSource!==source){
        const assetPath=resolveProjectPath(Object.keys(files),originalSource,value.resource);
        if(!assetPath)fail('cannot relocate missing opaque resource '+node.name+'.'+key+'; keep the original source path or supply its companion file');
        node.properties[key]={...value,resource:relativeProjectPath(source,assetPath)};
      }
      continue;
    }const binding=node.resourceBindings?.[key],same=binding&&JSON.stringify(value)===JSON.stringify(binding.originalValue);if(same){const reference={...binding.reference};let resolved;try{resolved=resolveProjectPath(Object.keys(files),source,reference.resource);}catch{}if(resolved?.toLowerCase()!==binding.assetPath.toLowerCase())reference.resource=relativeProjectPath(source,binding.assetPath);node.properties[key]=reference;continue;}
    const lower=key.toLowerCase(),picture=['picture','icon','mouseicon'].includes(lower),list=lower==='list'&&Array.isArray(value),text=TEXT_PROPERTIES.has(lower)&&typeof value==='string';
    if(!binding&&!list&&!(picture&&value)&&!(text&&(/[\r\n]/.test(value)||value.length>255)))continue;
    if(picture&&!value){delete node.properties[key];continue;}if(!list&&!picture&&!text)fail('cannot serialize edited opaque resource '+node.name+'.'+key);
    const path=binding?.assetPath||source.replace(/\.(frm|ctl|pag|dob|dsr)$/i,(_,ext)=>'.'+({frm:'frx',ctl:'ctx',pag:'pgx',dob:'dox',dsr:'dsx'})[ext.toLowerCase()]),kind=picture?'picture':list?'list':'text32',offset=append(path,picture?rasterBytes(value):value,kind,{signature:binding?.signature,encoding:binding?.encoding||module.resourceEncoding||'windows-1252'});
    node.properties[key]={resource:relativeProjectPath(source,path),offset,...(text?{text:true}:{})};
  }}return {modules,files};
}

return {MAX_RESOURCE_BYTES,cleanProjectPath,relativeProjectPath,resolveProjectPath,fromBase64,toBase64,resourceOffset,readFRXRecord,writeFRXRecord,rasterDataURL,rasterBytes,hydrateResources,prepareResources};
})();

/* ../project/res.js */
__modules[12]=(()=>{
const {VBError}=__modules[2];
const {cleanProjectPath,fromBase64,toBase64,MAX_RESOURCE_BYTES}=__modules[11];
/** Windows 32-bit .res containers. Payloads remain opaque unless explicitly edited. */


const RESOURCE_TYPES=Object.freeze({1:'Cursor',2:'Bitmap',3:'Icon',4:'Menu',5:'Dialog',6:'String',7:'Font directory',8:'Font',9:'Accelerator',10:'Custom data',11:'Message table',12:'Cursor group',14:'Icon group',16:'Version',24:'Manifest'});
const resourceKey=entry=>JSON.stringify([entry.type,entry.name,entry.language||0]);
const fail=message=>{throw new VBError('RES: '+message,1002);};
const align=n=>Math.ceil(n/4)*4;
function uint(value,bits,label){if(!Number.isInteger(value)||value<0||value>2**bits-1)fail('Invalid '+label);return value;}
function identifier(value){if(typeof value==='number')return uint(value,16,'resource identifier');if(typeof value!=='string'||!value||value.length>1024||value.includes('\0')||value.charCodeAt(0)===65535)fail('Invalid resource name');return value;}
function signature(entry){return JSON.stringify([entry.type,entry.name,entry.language,entry.flags,entry.dataVersion,entry.version,entry.characteristics,entry.data]);}
function normalizeResources(model){
  if(!model||!Array.isArray(model.entries)||model.entries.length>10000)fail('Expected up to 10,000 resource entries');
  let total=32;const seen=new Set(),entries=model.entries.map(input=>{
    if(!input||typeof input.data!=='string')fail('Missing resource data');
    if(input.data.length>MAX_RESOURCE_BYTES*4/3+4)fail('Resource exceeds 20 MiB');
    const entry={type:identifier(input.type),name:identifier(input.name),language:uint(input.language??0,16,'language'),flags:uint(input.flags??0x30,16,'memory flags'),dataVersion:uint(input.dataVersion??0,32,'data version'),version:uint(input.version??0,32,'version'),characteristics:uint(input.characteristics??0,32,'characteristics'),data:toBase64(fromBase64(input.data))};
    if(entry.type===0&&entry.name===0&&!entry.data)fail('Null resource is a container header, not an entry');
    total+=Math.ceil(entry.data.length*3/4)+64+(typeof entry.type==='string'?entry.type.length*2:0)+(typeof entry.name==='string'?entry.name.length*2:0);if(total>MAX_RESOURCE_BYTES)fail('Resource file exceeds 20 MiB');
    const key=resourceKey(entry);if(seen.has(key))fail('Duplicate resource type, name and language');seen.add(key);return entry;
  });
  const result={fileName:cleanProjectPath(model.fileName||'Project.res'),entries};
  if(!/\.res$/i.test(result.fileName))fail('Resource file name must end in .res');
  if(model.original!==undefined){if(typeof model.original!=='string'||model.original.length>MAX_RESOURCE_BYTES*4/3+4)fail('Invalid original resource file');result.original=model.original;}
  return result;
}
function parse(bytes){
  if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes);
  if(bytes.length>MAX_RESOURCE_BYTES)fail('Resource file exceeds 20 MiB');
  if(bytes.length<32)fail('Truncated or non-Win32 resource container');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),records=[];let offset=0;
  while(offset<bytes.length){
    if(offset%4||offset+8>bytes.length)fail('Truncated or misaligned header');
    const start=offset,size=view.getUint32(start,true),headerSize=view.getUint32(start+4,true),headerEnd=start+headerSize;
    if(headerSize<24||headerSize%4||headerEnd>bytes.length||size>bytes.length-headerEnd)fail('Invalid resource header or payload bounds');
    let at=start+8;
    const readName=()=>{if(at+2>headerEnd)fail('Truncated identifier');let word=view.getUint16(at,true);at+=2;if(word===65535){if(at+2>headerEnd)fail('Truncated ordinal');word=view.getUint16(at,true);at+=2;return word;}let text='';while(word){text+=String.fromCharCode(word);if(text.length>1024||at+2>headerEnd)fail('Unterminated or oversized name');word=view.getUint16(at,true);at+=2;}return text;};
    const type=readName(),name=readName();at=align(at);if(at+16>headerEnd)fail('Missing fixed header fields');
    const entry={type,name,dataVersion:view.getUint32(at,true),flags:view.getUint16(at+4,true),language:view.getUint16(at+6,true),version:view.getUint32(at+8,true),characteristics:view.getUint32(at+12,true),data:toBase64(bytes.subarray(headerEnd,headerEnd+size))};
    const end=align(headerEnd+size);if(end>bytes.length)fail('Truncated data alignment padding');
    records.push({entry,start,end});if(records.length>10001)fail('More than 10,000 resources');offset=end;
  }
  const prefix=records[0];if(!prefix||prefix.entry.type!==0||prefix.entry.name!==0||prefix.entry.data!=='')fail('Missing Win32 null-resource header');
  return {records:records.slice(1),prefix};
}
function readRES(bytes,fileName='Project.res'){
  bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);const parsed=parse(bytes);
  return normalizeResources({fileName,entries:parsed.records.map(r=>r.entry),original:toBase64(bytes)});
}
function recordBytes(entry){
  const nameLength=value=>typeof value==='number'?4:(value.length+1)*2;
  const fixed=align(8+nameLength(entry.type)+nameLength(entry.name)),headerSize=fixed+16,data=fromBase64(entry.data),out=new Uint8Array(align(headerSize+data.length)),view=new DataView(out.buffer);
  view.setUint32(0,data.length,true);view.setUint32(4,headerSize,true);let at=8;
  for(const value of [entry.type,entry.name]){if(typeof value==='number'){view.setUint16(at,65535,true);view.setUint16(at+2,value,true);at+=4;}else{for(let i=0;i<value.length;i++){view.setUint16(at,value.charCodeAt(i),true);at+=2;}at+=2;}}
  view.setUint32(fixed,entry.dataVersion,true);view.setUint16(fixed+4,entry.flags,true);view.setUint16(fixed+6,entry.language,true);view.setUint32(fixed+8,entry.version,true);view.setUint32(fixed+12,entry.characteristics,true);out.set(data,headerSize);return out;
}
function writeRES(model){
  model=normalizeResources(model);let original,parsed;
  if(model.original){original=fromBase64(model.original);parsed=parse(original);}
  const old=new Map((parsed?.records||[]).map(r=>[resourceKey(r.entry),r]));
  if(parsed&&parsed.records.length===model.entries.length&&parsed.records.every((r,i)=>signature(r.entry)===signature(model.entries[i])))return original.slice();
  const nullEntry={type:0,name:0,language:0,flags:0,dataVersion:0,version:0,characteristics:0,data:''};
  const chunks=[parsed?original.slice(0,parsed.prefix.end):recordBytes(nullEntry)];
  for(const entry of model.entries){const prior=old.get(resourceKey(entry));chunks.push(prior&&signature(prior.entry)===signature(entry)?original.slice(prior.start,prior.end):recordBytes(entry));}
  const length=chunks.reduce((n,c)=>n+c.length,0);if(length>MAX_RESOURCE_BYTES)fail('Resource file exceeds 20 MiB');const out=new Uint8Array(length);let at=0;for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}return out;
}
function decodeStringTable(bytes){
  bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),strings=[];let at=0;
  for(let slot=0;slot<16;slot++){if(at+2>bytes.length)fail('Truncated string-table length');const length=view.getUint16(at,true);at+=2;if(at+length*2>bytes.length)fail('Truncated string-table text');let value='';for(let i=0;i<length;i++)value+=String.fromCharCode(view.getUint16(at+i*2,true));strings.push(value);at+=length*2;}
  if(at!==bytes.length)fail('Trailing bytes in string-table block');return strings;
}
function encodeStringTable(strings){
  if(!Array.isArray(strings)||strings.length!==16||strings.some(s=>typeof s!=='string'||s.length>65535))fail('Expected sixteen strings, each at most 65,535 UTF-16 code units');
  const bytes=new Uint8Array(32+strings.reduce((n,s)=>n+s.length*2,0)),view=new DataView(bytes.buffer);let at=0;
  for(const s of strings){view.setUint16(at,s.length,true);at+=2;for(let i=0;i<s.length;i++){view.setUint16(at,s.charCodeAt(i),true);at+=2;}}return bytes;
}
/** Pure transactions: validation failure never mutates the source resource model. */
function setResource(model,entry,{replace=true}={}){
  const next=normalizeResources(model||{entries:[]});entry=normalizeResources({entries:[entry]}).entries[0];const index=next.entries.findIndex(e=>resourceKey(e)===resourceKey(entry));if(index>=0){if(!replace)fail('Resource already exists');next.entries[index]=entry;}else next.entries.push(entry);return normalizeResources(next);
}
function removeResource(model,key){const next=normalizeResources(model);next.entries=next.entries.filter(e=>resourceKey(e)!==key);return next;}
function setResourceString(model,id,text,language=0){
  id=uint(id,16,'string ID');language=uint(language,16,'language');if(typeof text!=='string'||text.length>65535)fail('Invalid string value');
  const next=normalizeResources(model||{entries:[]}),name=(id>>4)+1,prior=next.entries.find(e=>e.type===6&&e.name===name&&e.language===language),strings=prior?decodeStringTable(fromBase64(prior.data)):Array(16).fill('');strings[id&15]=text;
  return setResource(next,{...prior,type:6,name,language,data:toBase64(encodeStringTable(strings))});
}
function listResourceStrings(model){const result=[];for(const entry of model?.entries||[])if(entry.type===6&&Number.isInteger(entry.name)&&entry.name>=1&&entry.name<=4096){const strings=decodeStringTable(fromBase64(entry.data));strings.forEach((text,slot)=>{if(text)result.push({id:(entry.name-1)*16+slot,text,language:entry.language,key:resourceKey(entry)});});}return result;}

return {RESOURCE_TYPES,resourceKey,normalizeResources,readRES,writeRES,decodeStringTable,encodeStringTable,setResource,removeResource,setResourceString,listResourceStrings};
})();

/* ../project/model.js */
__modules[13]=(()=>{
const {normalizeDataSources}=__modules[7];
const { clone, lower, safeName }=__modules[5];
const {normalizeResources}=__modules[12];
const { VBError }=__modules[2];




const PROJECT_SCHEMA=1;
let sequence=0;
const newId=()=>`id_${Date.now().toString(36)}_${(++sequence).toString(36)}`;
const BASIC_CONTROL_TYPES=['Pointer','PictureBox','Label','TextBox','Frame','CommandButton','CheckBox','OptionButton','ComboBox','ListBox','HScrollBar','VScrollBar','Timer','DriveListBox','DirListBox','FileListBox','Shape','Line','Image','Data','OLE'];
const EXTENDED_CONTROL_TYPES=['TreeView','ListView','ProgressBar','Slider','StatusBar','Toolbar','TabStrip','SSTab','RichTextBox','MSFlexGrid','MSHFlexGrid','DataGrid','DTPicker','MonthView','UpDown','ImageList','CommonDialog','MSChart','Adodc'];
const CONTROL_DEFAULTS={
  Label:{Caption:'Label',Width:1440,Height:300,BackStyle:0,Alignment:0},TextBox:{BackColor:-2147483643,Text:'',Width:1800,Height:315,MultiLine:0,ScrollBars:0,MaxLength:0,PasswordChar:'',Locked:0,Alignment:0},CommandButton:{Caption:'Command',Width:1440,Height:420,Default:0,Cancel:0},Frame:{Caption:'Frame',Width:3300,Height:1800},CheckBox:{Caption:'Check',Value:0,Width:1800,Height:300},OptionButton:{Caption:'Option',Value:0,Width:1800,Height:300},ComboBox:{BackColor:-2147483643,Text:'',List:[],Width:2100,Height:315,Style:0,ListIndex:-1},ListBox:{BackColor:-2147483643,List:[],Width:2400,Height:1800,ListIndex:-1,MultiSelect:0,Sorted:0},PictureBox:{Width:2400,Height:1800,BackColor:-2147483633,ScaleMode:3,AutoRedraw:-1,BorderStyle:1},Image:{Width:1440,Height:1440,Stretch:-1},Shape:{Width:1440,Height:900,Shape:0,FillStyle:1,FillColor:16777215,BorderColor:0},Line:{Width:1440,Height:15,BorderColor:0,BorderWidth:1},Timer:{Interval:1000,Enabled:0,Width:420,Height:420},HScrollBar:{Width:2400,Height:255,Min:0,Max:32767,Value:0,SmallChange:1,LargeChange:100},VScrollBar:{Width:255,Height:2400,Min:0,Max:32767,Value:0,SmallChange:1,LargeChange:100},ProgressBar:{Width:2700,Height:315,Min:0,Max:100,Value:30},Slider:{Width:2700,Height:450,Min:0,Max:10,Value:3,TickFrequency:1},TreeView:{BackColor:-2147483643,Width:2700,Height:2100,LineStyle:1},ListView:{BackColor:-2147483643,Width:3600,Height:2100,View:3,FullRowSelect:-1,GridLines:0},StatusBar:{Width:5400,Height:315,SimpleText:'Ready',Style:1},Toolbar:{Width:5400,Height:450},TabStrip:{Width:4500,Height:2400},SSTab:{Width:4500,Height:2400,Tab:0,Tabs:3},RichTextBox:{BackColor:-2147483643,Width:3600,Height:2100,Text:'Rich text',MultiLine:-1,ScrollBars:3},MSFlexGrid:{Width:4200,Height:2100,Rows:5,Cols:3,FixedRows:1,FixedCols:1,Row:1,Col:1},MSHFlexGrid:{Width:4200,Height:2100,Rows:5,Cols:3,FixedRows:1,FixedCols:1,Row:1,Col:1},DataGrid:{Width:4200,Height:2100,Rows:5,Cols:3},DTPicker:{BackColor:-2147483643,Width:2400,Height:330,Value:'2026-10-03',Format:0},MonthView:{BackColor:-2147483643,Width:3300,Height:2700,Value:'2026-10-03'},UpDown:{Width:255,Height:450,Min:0,Max:100,Value:0,Increment:1,Wrap:0,Orientation:0},ImageList:{Width:420,Height:420,ImageWidth:16,ImageHeight:16},CommonDialog:{Width:420,Height:420,Filter:'Text files|*.txt|All files|*.*',FileName:'',DialogTitle:'Open'},MSChart:{BackColor:-2147483643,Width:4200,Height:2550,ChartType:1,RowCount:5,ColumnCount:1},FileListBox:{BackColor:-2147483643,Width:2400,Height:1500,Pattern:'*.*',Path:'/'},DirListBox:{BackColor:-2147483643,Width:2400,Height:1500,Path:'/'},DriveListBox:{BackColor:-2147483643,Width:2400,Height:315,Drive:'C:'},Data:{Width:2400,Height:315,Caption:'Data',DatabaseName:'',Connect:'',RecordSource:'',RecordsetType:2,ReadOnly:0},Adodc:{Width:2400,Height:315,Caption:'Adodc',ConnectionString:'',RecordSource:'',CommandType:1,CursorType:3,LockType:3,ReadOnly:0},OLE:{Width:1800,Height:1200,Caption:'OLE (unsupported)'}
};
function createControl(type,name=null,left=300,top=300){const id=newId();return {id,name:name||type+'1',type,parent:null,properties:{Name:name||type+'1',Left:left,Top:top,Width:1800,Height:450,Visible:-1,Enabled:-1,TabIndex:0,TabStop:['Label','Frame','Shape','Line','Image','StatusBar','ProgressBar','Timer','ImageList','CommonDialog'].includes(type)?0:-1,FontName:'MS Sans Serif',FontSize:8.25,FontBold:0,FontItalic:0,ForeColor:-2147483640,BackColor:-2147483633,ToolTipText:'',Tag:'',...clone(CONTROL_DEFAULTS[type]||{})}};}
function createForm(name='Form1',caption=name){return {id:newId(),name,kind:'form',code:`Option Explicit\n\nPrivate Sub Form_Load()\n    \nEnd Sub\n`,form:{id:newId(),name,type:'Form',properties:{Name:name,Caption:caption,ClientWidth:9000,ClientHeight:6000,Width:9120,Height:6450,Left:300,Top:300,StartUpPosition:2,BorderStyle:2,BackColor:-2147483633,ForeColor:-2147483640,FontName:'MS Sans Serif',FontSize:8.25,FontBold:0,FontItalic:0,ScaleMode:1,KeyPreview:0,Visible:-1,Enabled:-1},controls:[],menus:[]}};}
function newProject(name='Project1'){const form=createForm();return {schema:PROJECT_SCHEMA,id:newId(),name,description:'',startup:form.name,modules:[form],settings:{snapToGrid:true,gridSize:120,showGrid:true,renderer:'auto',tabWidth:4,requireVariableDeclaration:true},references:[],assets:{},vfs:{files:{},directories:['/']},appSettings:{}};}
function validateForm(form,moduleName){
  if(!form||typeof form!=='object'||Array.isArray(form))throw new VBError('Invalid form model: '+moduleName,1002);
  form.id ||= newId();form.name=moduleName;form.properties ||= {};form.controls ||= [];form.menus ||= [];
  if(!Array.isArray(form.controls)||!Array.isArray(form.menus))throw new VBError('Form controls and menus must be arrays',1002);
  if(form.controls.length>10000||form.menus.length>10000)throw new VBError('Form exceeds 10,000-control or menu limit',7);
  const ids=new Set(),controls=new Map(),menus=new Map(),allNames=new Set();
  const validateNode=node=>{
    if(!node||typeof node.name!=='string'||!/^[A-Za-z_]\w*$/.test(node.name))throw new VBError('Invalid control or menu name: '+node?.name,1002);
    if(typeof node.type!=='string')throw new VBError('Missing control type: '+node.name,1002);
    if(!node.id||ids.has(node.id))node.id=newId();ids.add(node.id);node.properties ||= {};
    if(typeof node.properties!=='object'||Array.isArray(node.properties))throw new VBError('Invalid properties: '+node.name,1002);
    for(const key of ['Left','Top','Width','Height','ClientWidth','ClientHeight'])if(node.properties[key]!==undefined){const n=Number(node.properties[key]);if(!Number.isFinite(n)||Math.abs(n)>300000||/Width|Height/.test(key)&&n<0)throw new VBError('Invalid geometry: '+node.name+'.'+key,380);node.properties[key]=n;}
  };
  validateNode(form);
  for(const c of form.controls){validateNode(c);const key=lower(c.name),items=controls.get(key)||[];
    if(c.properties.Index!==undefined){const index=Number(c.properties.Index);if(!Number.isInteger(index)||index<0||index>32767)throw new VBError('Invalid control array index: '+c.name,380);c.properties.Index=index;}
    if(items.some(item=>item.properties.Index===undefined||c.properties.Index===undefined||item.properties.Index===c.properties.Index||item.type!==c.type))throw new VBError('Duplicate or incompatible control array name/index: '+c.name,1002);
    items.push(c);controls.set(key,items);allNames.add(key);
  }
  for(const m of form.menus){validateNode(m);const key=lower(m.name),items=menus.get(key)||[];if(controls.has(key))throw new VBError('Duplicate menu or control name: '+m.name,1002);if(m.properties.Index!==undefined){const index=Number(m.properties.Index);if(!Number.isInteger(index)||index<0||index>32767)throw new VBError('Invalid menu array index: '+m.name,380);m.properties.Index=index;}if(items.some(item=>item.properties.Index===undefined||m.properties.Index===undefined||item.properties.Index===m.properties.Index))throw new VBError('Duplicate menu or control name/index: '+m.name,1002);items.push(m);menus.set(key,items);allNames.add(key);}
  for(const [nodes,lookup]of [[form.controls,controls],[form.menus,menus]])for(const node of nodes){const seen=new Set([node.id]);let current=node;
    while(current.parent){const key=lower(current.parent);const result=lookup.get(key);if(!result)throw new VBError('Missing parent '+current.parent+' for '+node.name,1002);const parent=Array.isArray(result)?result.find(p=>p.id===current.nativeParentId)||result[0]:result;if(seen.has(parent.id))throw new VBError('Cyclic parent relationship: '+node.name,1002);seen.add(parent.id);current.parent=parent.name;current=parent;}
  }
}
function normalizeProject(value){
  if(!value||typeof value!=='object'||!Array.isArray(value.modules))throw new VBError('Not a VB6 Studio project',1002);
  if(value.schema!==PROJECT_SCHEMA)throw new VBError('Unsupported project schema: '+value.schema,1002);
  if(!value.modules.length&&!value.nativeProject||value.modules.length>1000)throw new VBError('Project must contain 1–1,000 modules',7);
  const project=clone(value);project.id ||= newId();project.name=project.nativeProject?.document?String(project.name).slice(0,100):safeName(project.name);project.settings={...newProject().settings,...project.settings};project.references ||= [];project.assets ||= {};project.vfs ||= {files:{}};project.appSettings ||= {};
  const names=new Set(),ids=new Set();for(const m of project.modules){
    if(!m||typeof m.name!=='string'||!/^[A-Za-z_]\w*$/.test(m.name))throw new VBError('Invalid module name: '+m?.name,1002);
    if(names.has(lower(m.name)))throw new VBError('Duplicate module: '+m.name,1002);names.add(lower(m.name));
    if(!m.id||ids.has(m.id))m.id=newId();ids.add(m.id);m.kind ||= 'module';if(!['form','module','class'].includes(m.kind))throw new VBError('Unsupported module kind: '+m.kind,1002);
    m.code=String(m.code||'');if(m.code.length>5000000)throw new VBError('Module exceeds 5,000,000-character source limit',7);
    if(m.kind==='form'&&!m.form)throw new VBError('Form module is missing its form model: '+m.name,1002);if(m.form)validateForm(m.form,m.name);
  }
  if(!Number.isInteger(Number(project.settings.tabWidth))||Number(project.settings.tabWidth)<1||Number(project.settings.tabWidth)>32)project.settings.tabWidth=4;else project.settings.tabWidth=Number(project.settings.tabWidth);
  const grid=Number(project.settings.gridSize);project.settings.gridSize=Number.isFinite(grid)?Math.max(15,Math.min(1200,grid)):120;
  project.settings.renderer=project.settings.renderer==='canvas2d'?'canvas2d':'auto';
  if(project.dataSources)project.dataSources=normalizeDataSources(project.dataSources);
  if(project.resources)project.resources=normalizeResources(project.resources);
  return project;
}
function uniqueName(project,base='Form',module=null){const names=new Set(module?module.form.controls.map(c=>lower(c.name)):project.modules.map(m=>lower(m.name)));let n=1;while(names.has(lower(base+n)))n++;return base+n;}
function findModule(project,idOrName){return project.modules.find(m=>m.id===idOrName||lower(m.name)===lower(idOrName));}
function projectStats(project){return {modules:project.modules.length,forms:project.modules.filter(m=>m.kind==='form').length,controls:project.modules.reduce((n,m)=>n+(m.form?.controls.length||0),0),lines:project.modules.reduce((n,m)=>n+m.code.split('\n').length,0)};}

return {PROJECT_SCHEMA,newId,BASIC_CONTROL_TYPES,EXTENDED_CONTROL_TYPES,CONTROL_DEFAULTS,createControl,createForm,newProject,normalizeProject,uniqueName,findModule,projectStats};
})();

/* ../runtime/constants.js */
__modules[14]=(()=>{

/** Shared immutable compiler/runtime intrinsic constants. */
const VB_CONSTANTS = {
  vbTrue:-1,vbFalse:0,vbCr:'\r',vbLf:'\n',vbCrLf:'\r\n',vbNewLine:'\r\n',vbTab:'\t',vbNullChar:'\0',vbNullString:'',vbBack:'\b',vbFormFeed:'\f',vbVerticalTab:'\v',
  vbBlack:0,vbRed:255,vbGreen:65280,vbYellow:65535,vbBlue:16711680,vbMagenta:16711935,vbCyan:16776960,vbWhite:16777215,
  vbButtonFace:-2147483633,vbWindowBackground:-2147483643,vbWindowText:-2147483640,vbButtonText:-2147483630,
  vbOKOnly:0,vbOKCancel:1,vbAbortRetryIgnore:2,vbYesNoCancel:3,vbYesNo:4,vbRetryCancel:5,vbCritical:16,vbQuestion:32,vbExclamation:48,vbInformation:64,vbDefaultButton1:0,vbDefaultButton2:256,vbDefaultButton3:512,
  vbOK:1,vbCancel:2,vbAbort:3,vbRetry:4,vbIgnore:5,vbYes:6,vbNo:7,vbModal:1,vbModeless:0,
  vbCascade:0,vbTileHorizontal:1,vbTileVertical:2,vbArrangeIcons:3,vbNormal:0,vbMinimized:1,vbMaximized:2,vbFormControlMenu:0,vbFormCode:1,vbFormMDIForm:4,vbResBitmap:0,vbResIcon:1,vbResCursor:2,vbEmpty:0,vbNull:1,vbInteger:2,vbLong:3,vbSingle:4,vbDouble:5,vbCurrency:6,vbDate:7,vbString:8,vbObject:9,vbError:10,vbBoolean:11,vbVariant:12,vbDecimal:14,vbByte:17,vbArray:8192,
  vbMethod:1,vbGet:2,vbLet:4,vbSet:8,vbUseSystem:0,vbFirstJan1:1,vbFirstFourDays:2,vbFirstFullWeek:3,
  vbBinaryCompare:0,vbTextCompare:1,vbUseCompareOption:-1,vbUpperCase:1,vbLowerCase:2,vbProperCase:3,vbSunday:1,vbMonday:2,vbTuesday:3,vbWednesday:4,vbThursday:5,vbFriday:6,vbSaturday:7,
  vbTwips:1,vbPoints:2,vbPixels:3,vbCharacters:4,vbInches:5,vbMillimeters:6,vbCentimeters:7,vbUser:0,
  vbUnchecked:0,vbChecked:1,vbGrayed:2,vbNormal:0,vbMinimized:1,vbMaximized:2,vbLeftJustify:0,vbRightJustify:1,vbCenter:2,
  vbKeyBack:8,vbKeyTab:9,vbKeyReturn:13,vbKeyShift:16,vbKeyControl:17,vbKeyMenu:18,vbKeyEscape:27,vbKeySpace:32,vbKeyPageUp:33,vbKeyPageDown:34,vbKeyEnd:35,vbKeyHome:36,vbKeyLeft:37,vbKeyUp:38,vbKeyRight:39,vbKeyDown:40,vbKeyInsert:45,vbKeyDelete:46,
  vbObjectError:-2147221504,adOpenForwardOnly:0,adOpenKeyset:1,adOpenDynamic:2,adOpenStatic:3,adLockReadOnly:1,adLockOptimistic:3,adUseClient:3,adStateClosed:0,adStateOpen:1,adVarChar:200,adInteger:3,adDouble:5,adSmallInt:2,adSingle:4,adCurrency:6,adDate:7,adBoolean:11,adUnsignedTinyInt:17,adVarWChar:202,adLongVarWChar:203,adEditNone:0,adEditInProgress:1,adEditAdd:2,adFilterNone:0,adAffectCurrent:1,adGetRowsRest:-1,adPosUnknown:-1,adPosBOF:-2,adPosEOF:-3,
  rtfRTF:0,rtfText:1,rtfLeft:0,rtfRight:1,rtfCenter:2,rtfJustify:3,rtfWholeWord:2,rtfMatchCase:4,rtfNoHighlight:8,
  tvwChild:4,lvwIcon:0,lvwSmallIcon:1,lvwList:2,lvwReport:3,ccFixedSingle:1,ccFlat:0,cc3D:1,sbrText:0,
};
for(let i=0;i<26;i++)VB_CONSTANTS['vbKey'+String.fromCharCode(65+i)]=65+i;
for(let i=1;i<=16;i++)VB_CONSTANTS['vbKeyF'+i]=111+i;
Object.freeze(VB_CONSTANTS);

return {VB_CONSTANTS};
})();

/* ../language/binding.js */
__modules[15]=(()=>{
const {VBError}=__modules[0];
const {lower}=__modules[5];
const {VB_CONSTANTS}=__modules[14];
const {VBCurrency,coerce,unary,binary}=__modules[6];




/** Side-effect-free project constant binding. Cached parsed modules keep their
 * ASTs: binding maps are rebuilt on every cross-module validation, so editing a
 * dependency cannot leave worker diagnostics or execution with old values. */
function bindConstants(modules) {
  const diagnostics=[], scopes=new Map(), cache=new Map(), active=new Set();
  const intrinsic=new Map(Object.entries(VB_CONSTANTS).map(([k,v])=>[lower(k),v]));
  let steps=0;
  const report=(e,m,line)=>diagnostics.push({severity:'error',number:e.number||1002,message:e.message,source:e.source||m.name,line:e.line||line||1,column:1});
  const fail=message=>{throw new VBError(message,1002);};
  for(const m of modules.values()){
    const globals=new Map(),locals=new Map();scopes.set(m,{globals,locals});
    m.constantBindings=new Map();m.enumBindings=new Map();m.globalEnumMembers=new Map();m.importedConstantBindings=new Map();
    for(const d of m.declarations){const key=lower(d.name);if(globals.has(key))report(new VBError('Ambiguous name detected: '+d.name,1002),m,d.line);else globals.set(key,{m,d});
      if(d.constant&&!d.enumName&&d.scope!=='private'&&m.kind!=='module')report(new VBError('Public constants are not permitted in object modules',1002),m,d.line);
    }
    for(const p of m.procedures.values()){
      const names=new Map(p.params.map(d=>[lower(d.name),{m,p,d}]));locals.set(p,names);p.constantBindings=new Map();p.defaultBindings=new Map();
      for(const ins of p.code)if(ins.op==='dim')for(const d of ins.decls){const key=lower(d.name);if(names.has(key))report(new VBError('Duplicate declaration: '+d.name,1002),m,ins.line);else names.set(key,{m,p,d,line:ins.line});}
    }
  }
  function resolve(name,m,p){
    const key=lower(name),scope=scopes.get(m),local=scope.locals.get(p)?.get(key)||scope.globals.get(key);
    if(local){if(!local.d.constant)fail('Constant expression required: '+name);return bind(local);}
    const publicMatches=[];
    for(const other of modules.values())if(other!==m){const entry=scopes.get(other).globals.get(key);if(entry?.d.constant&&entry.d.scope!=='private'&&(other.kind==='module'||entry.d.enumName))publicMatches.push(entry);}
    if(publicMatches.length>1)fail('Ambiguous constant: '+name);
    if(publicMatches.length)return bind(publicMatches[0]);
    if(intrinsic.has(key))return intrinsic.get(key);
    fail('Constant not defined: '+name);
  }
  function enumDefinition(name,m){
    const key=lower(name),own=Object.values(m.enums).find(e=>lower(e.name)===key);
    if(own)return {m,e:own};
    const matches=[];for(const other of modules.values())if(other!==m)for(const e of Object.values(other.enums))if(e.scope!=='private'&&lower(e.name)===key)matches.push({m:other,e});
    if(matches.length>1)fail('Ambiguous enum type: '+name);return matches[0];
  }
  function evaluate(node,m,p,depth=0){
    if(!node||++steps>100000||depth>256)fail('Constant expression complexity limit exceeded');
    const ev=n=>evaluate(n,m,p,depth+1);
    switch(node.kind){
      case 'literal':if(node.value===null)fail('Invalid use of Null in constant expression');return node.value;
      case 'date':return new Date(node.value);
      case 'currency':return new VBCurrency(node.value);
      case 'group':return ev(node.expr);
      case 'id':return resolve(node.name,m,p);
      case 'unary':if(node.op==='-'&&node.expr.kind==='currency')return new VBCurrency('-'+node.expr.value);return unary(node.op,ev(node.expr));
      case 'binary':if(node.op==='is')fail('Object identity is not a constant expression');{const value=binary(node.op,ev(node.left),ev(node.right),m.optionCompare);if(typeof value==='string'&&value.length>1048576)fail('Constant string exceeds 1 MiB compiler limit');return value;}
      case 'member':{
        if(node.object.kind!=='id')fail('Constant expression required');
        const owner=modules.get(lower(node.object.name));
        if(owner){const entry=scopes.get(owner).globals.get(lower(node.name));if(!entry?.d.constant||owner!==m&&entry.d.scope==='private')fail('Constant is not accessible: '+node.name);return bind(entry);}
        const type=enumDefinition(node.object.name,m);
        if(type&&type.e.members.some(n=>lower(n)===lower(node.name)))return bind(scopes.get(type.m).globals.get(lower(node.name)));
        fail('Constant member not defined: '+node.name);break;
      }
      default:fail('Constant expression cannot invoke functions, allocate objects, or read variables');
    }
  }
  function bind(entry){
    if(cache.has(entry))return cache.get(entry);
    if(active.size>=256)fail('Constant dependency depth limit exceeded');
    if(active.has(entry))fail('Circular constant dependency: '+entry.d.name);
    active.add(entry);
    try{
      const {m,p,d}=entry;let value=evaluate(d.initial,m,p);
      const type=d.explicitType||lower(d.type)!=='variant'?d.type:value instanceof VBCurrency?'Currency':value instanceof Date?'Date':typeof value==='string'?'String':Number.isInteger(value)&&value>=-32768&&value<=32767?'Integer':Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?'Long':'Double';
      if(!['byte','integer','long','single','double','currency','date','string','boolean','variant'].includes(lower(type)))fail('Invalid constant type: '+type);
      value=coerce(value,type);cache.set(entry,value);(p?p.constantBindings:m.constantBindings).set(lower(d.name),value);return value;
    }finally{active.delete(entry);}
  }
  for(const m of modules.values()){
    const scope=scopes.get(m);
    for(const entry of [...scope.globals.values(),...[...scope.locals.values()].flatMap(v=>[...v.values()])])if(entry.d.constant)try{bind(entry);}catch(e){report(e,m,entry.line||entry.d.line);}
    for(const p of m.procedures.values())for(const param of p.params)if(param.initial)try{p.defaultBindings.set(lower(param.name),evaluate(param.initial,m,null));}catch(e){report(e,m,p.line);}
  }
  // Public constant values exist before runtime field initialization. Preserve
  // ambiguity rather than selecting whichever module happens to be first.
  for(const m of modules.values())for(const owner of modules.values())if(owner!==m)
    for(const d of owner.declarations)if(d.constant&&d.scope!=='private'&&(owner.kind==='module'||d.enumName)){
      const key=lower(d.name);m.importedConstantBindings.set(key,m.importedConstantBindings.has(key)?{ambiguous:true}:{value:owner.constantBindings.get(key)});
    }
  // Resolved enum namespaces are immutable and never expose host reflection.
  for(const m of modules.values()){
    for(const owner of modules.values())for(const e of Object.values(owner.enums))if(owner===m||e.scope!=='private'){
      if(owner!==m&&e.scope!=='private')for(const n of e.members){const k=lower(n);m.globalEnumMembers.set(k,m.globalEnumMembers.has(k)?{ambiguous:true}:{value:owner.constantBindings.get(k)});}
      const key=lower(e.name),existing=m.enumBindings.get(key);
      if(existing&&existing.owner!==m.name&&owner!==m){m.enumBindings.set(key,{ambiguous:true});continue;}
      if(existing&&existing.owner===m.name)continue;
      const values=Object.create(null);for(const n of e.members)values[lower(n)]=owner.constantBindings.get(lower(n));
      m.enumBindings.set(key,Object.freeze({__vbEnum:true,owner:owner.name,values:Object.freeze(values)}));
    }
    const storage=d=>{delete d.storageType;try{if(enumDefinition(d.type,m))d.storageType='Long';}catch(e){report(e,m,d.line);}};
    for(const d of m.declarations)storage(d);
    for(const fields of Object.values(m.types))for(const d of fields)storage(d);
    for(const p of m.procedures.values()){
      delete p.storageReturnType;try{if(enumDefinition(p.returnType,m))p.storageReturnType='Long';}catch(e){report(e,m,p.line);}
      for(const d of p.params){storage(d);if(d.storageType&&p.defaultBindings.has(lower(d.name)))try{p.defaultBindings.set(lower(d.name),coerce(p.defaultBindings.get(lower(d.name)),d.storageType));}catch(e){report(e,m,p.line);}}
      for(const ins of p.code)if(ins.op==='dim'||ins.op==='redim')for(const d of ins.decls)storage(d);
    }
  }
  return diagnostics;
}

return {bindConstants};
})();

/* ../language/default-types.js */
__modules[16]=(()=>{
const {VBError}=__modules[2];

/** VB6 module-scoped default types. Later VB.NET-only integer types are not accepted. */
const DEFAULT_TYPE_NAMES=Object.freeze({defbool:'Boolean',defbyte:'Byte',defint:'Integer',deflng:'Long',defcur:'Currency',defsng:'Single',defdbl:'Double',defdate:'Date',defstr:'String',defobj:'Object',defvar:'Variant'});
function addDefaultTypes(table,statement){
  const match=String(statement).match(/^(Def\w+)\s+(.+)$/i),type=match&&DEFAULT_TYPE_NAMES[match[1].toLowerCase()];
  if(!type)throw new VBError('Unsupported default-type declaration',1002);
  const changes=[];
  for(const part of match[2].split(',')){
    const range=part.trim().match(/^([A-Za-z])(?:\s*-\s*([A-Za-z]))?$/);
    if(!range)throw new VBError('Expected a single letter or ascending letter range',1002);
    const a=range[1].toLowerCase().charCodeAt(0),b=(range[2]||range[1]).toLowerCase().charCodeAt(0);
    if(b<a)throw new VBError('Default-type letter range must be ascending',1002);
    for(let c=a;c<=b;c++){const key=String.fromCharCode(c);if(Object.hasOwn(table,key)||changes.includes(key))throw new VBError('Duplicate default-type letter: '+key,1002);changes.push(key);}
  }
  for(const key of changes)table[key]=type;
  return table;
}
function defaultIdentifierType(name,table={}){
  return ({'$':'String','%':'Integer','&':'Long','!':'Single','#':'Double','@':'Currency'}[String(name).at(-1)]||table[String(name).charAt(0).toLowerCase()]||'Variant');
}

return {DEFAULT_TYPE_NAMES,addDefaultTypes,defaultIdentifierType};
})();

/* ../language/interfaces.js */
__modules[17]=(()=>{
const {lower}=__modules[5];

const json=x=>JSON.stringify(x);
function shape(p){return {kind:p.kind,accessor:p.accessor,type:lower(p.returnType),params:p.params.map(a=>({type:lower(a.type),byRef:a.byRef,optional:a.optional,paramArray:a.paramArray,array:a.bounds!==null,initial:a.initial}))};}
function argument(type){return {name:'value',type,byRef:true,optional:false,paramArray:false,bounds:null,initial:null};}
/** Bind the project-defined public contract to private Interface_Member methods.
 * No native type library, inheritance or COM ABI is implied. */
function validateInterfaces(modules){
 const errors=[];const diagnostic=(m,message,line=1)=>errors.push({severity:'error',message,number:1002,source:m.name,line,column:1});
 for(const module of modules.values()){
  module.interfaceBindings=Object.create(null);
  for(const contract of module.interfaces||[]){
   const iface=modules.get(lower(contract.name));
   if(!iface||iface.kind!=='class'){diagnostic(module,'Project class interface not found: '+contract.name,contract.line);continue;}
   if(iface===module){diagnostic(module,'A class cannot implement itself',contract.line);continue;}
   const expected=[...iface.procedures].filter(([,p])=>p.scope==='public').map(([key,p])=>({key,signature:p}));
   for(const d of iface.declarations.filter(d=>d.scope==='public'&&!d.constant)){
    if(d.bounds!==null){diagnostic(module,'Array fields in implemented interfaces are not supported: '+iface.name+'.'+d.name,contract.line);continue;}
    const object=!['variant','string','boolean','byte','integer','long','single','double','currency','date'].includes(lower(d.type));
    expected.push({key:lower(d.name)+':get',signature:{kind:'property',accessor:'get',name:d.name,returnType:d.type,params:[]}});
    expected.push({key:lower(d.name)+':'+(object?'set':'let'),signature:{kind:'property',accessor:object?'set':'let',name:d.name,returnType:'Variant',params:[argument(d.type)]}});
   }
   const members=Object.create(null);
   for(const {key,signature}of expected){
    const implementationKey=lower(iface.name)+'_'+key,implementation=module.procedures.get(implementationKey);
    if(!implementation){diagnostic(module,'Class must implement '+iface.name+'.'+signature.name+(signature.accessor?' ('+signature.accessor+')':''),contract.line);continue;}
    // Sub / Let / Set have no observable return type. Parameter identifiers are
    // allowed to differ; named invocation binds against the interface signature.
    const left=shape(signature),right=shape(implementation);
    if(['sub'].includes(signature.kind)||['let','set'].includes(signature.accessor)){delete left.type;delete right.type;}
    if(json(left)!==json(right)){diagnostic(module,'Interface procedure declaration does not match: '+implementation.name,implementation.line);continue;}
    members[key]={procedure:implementationKey,signature};
   }
   module.interfaceBindings[lower(iface.name)]={name:iface.name,members,defaultMember:iface.defaultMember||null};
  }
 }
 return errors;
}

return {validateInterfaces};
})();

/* ../language/expression.js */
__modules[18]=(()=>{
const { tokenize, VBError }=__modules[2];

const PRECEDENCE = {imp:1,eqv:2,xor:3,or:4,and:5,'=':7,'<>':7,'<':7,'>':7,'<=':7,'>=':7,is:7,like:7,'&':8,'+':9,'-':9,mod:10,'\\':11,'*':12,'/':12,'^':14};
class ExpressionParser {
  constructor(text) { this.text=text; this.tokens=tokenize(text); this.i=0; }
  peek() { return this.tokens[this.i]; }
  take() { return this.tokens[this.i++]; }
  match(v) { if(['op','id'].includes(this.peek().type)&&String(this.peek().value).toLowerCase()===v.toLowerCase()) { this.i++; return true; } return false; }
  expect(v) { if(!this.match(v)) throw new VBError(`Expected '${v}' in ${this.text}`,1002,null,0,this.peek().start+1); }
  // Argument nodes preserve omitted values and source evaluation order. Named
  // arguments are rebound to declaration slots only after target resolution.
  argument() {
    if(this.peek().type==='eof'||this.peek().type==='op'&&[',',')'].includes(this.peek().value))return {kind:'missing'};
    if(this.peek().type==='id'&&this.tokens[this.i+1]?.value===':='){
      const name=this.take().value;this.take();return {kind:'named',name,expr:this.expression()};
    }
    return this.expression();
  }
  qualifiedName() {
    const first=this.take();if(first.type!=='id')throw new VBError('Expected type name',1002);
    let name=first.value;while(this.match('.')){const part=this.take();if(part.type!=='id')throw new VBError('Expected type name',1002);name+='.'+part.value;}return name;
  }
  expression(min=0) {
    let node; const t=this.take(); const value=String(t.value).toLowerCase();
    if(t.type==='number'&&t.raw.endsWith('@'))node={kind:'currency',value:t.raw.slice(0,-1)};
    else if(t.type==='number'||t.type==='string') node={kind:'literal',value:t.value};
    else if(t.type==='date') node={kind:'date',value:t.value};
    else if(value==='('){node=this.expression();this.expect(')');node={kind:'group',expr:node};}
    else if(value==='+'||value==='-'||value==='not') node={kind:'unary',op:value,expr:this.expression(value==='not'?6:13)};
    else if(value==='new')node={kind:'new',name:this.qualifiedName()};
    else if(value==='typeof'){const expr=this.expression(8);this.expect('is');node={kind:'typeof',expr,name:this.qualifiedName()};}
    else if(value==='.') { const name=this.take();if(name.type!=='id')throw new VBError('Expected member name',1002);node={kind:'member',object:{kind:'with'},name:name.value}; }
    else if(t.type==='id') {
      if(value==='true')node={kind:'literal',value:-1};
      else if(value==='false')node={kind:'literal',value:0};
      else if(value==='null')node={kind:'literal',value:null};
      else if(value==='nothing')node={kind:'nothing'};
      else if(value==='empty')node={kind:'empty'};
      else node={kind:'id',name:t.value};
    } else throw new VBError(`Expected expression, found '${t.raw || t.value}'`,1002,null,0,t.start+1);
    while(true) {
      if(this.match('.')){const name=this.take();if(name.type!=='id')throw new VBError('Expected property or method name',1002); node={kind:'member',object:node,name:name.value};continue;}
      if(this.match('!')){const name=this.take(); node={kind:'call',callee:node,args:[{kind:'literal',value:name.value}]};continue;}
      if(this.match('(')) {
        const args=[];
        if(!this.match(')')) { do{args.push(this.argument());}while(this.match(',')); this.expect(')'); }
        node={kind:'call',callee:node,args}; continue;
      }
      const op=String(this.peek().value).toLowerCase(), prec=['op','id'].includes(this.peek().type)?PRECEDENCE[op]:undefined;
      if(prec===undefined||prec<min)break;
      this.take(); node={kind:'binary',op,left:node,right:this.expression(op==='^'?prec:prec+1)};
    }
    return node;
  }
  parse() { const node=this.expression();if(this.peek().type!=='eof')throw new VBError(`Unexpected '${this.peek().raw}' in expression`,1002,null,0,this.peek().start+1);return node; }
}
const parseExpression = text => new ExpressionParser(text.trim()).parse();
function parseCall(text) {
  const p=new ExpressionParser(text); let callee=p.take(); let node;
  if(callee.value==='.') { const name=p.take();node={kind:'member',object:{kind:'with'},name:name.value}; }
  else if(callee.type==='id') node={kind:'id',name:callee.value};
  else throw new VBError('Expected procedure name',1002);
  while(p.match('.')){const name=p.take();node={kind:'member',object:node,name:name.value};}
  if(p.peek().type==='eof') return {kind:'call',callee:node,args:[]};
  const rest=text.slice(p.peek().start).trim();
  if(rest.startsWith('(')) return parseExpression(text);
  const args=[];do{args.push(p.argument());}while(p.match(','));
  if(p.peek().type!=='eof')throw new VBError(`Unexpected '${p.peek().raw}' in argument list`,1002);
  return {kind:'call',callee:node,args};
}

return {ExpressionParser,parseExpression,parseCall};
})();

/* ../language/conditional.js */
__modules[19]=(()=>{
const { VBError }=__modules[2];
const { parseExpression }=__modules[18];
const { binary, unary, truth }=__modules[6];



/** Conditional compilation is resolved before lexing; removed lines remain blank. */
function preprocess(source, constants = {}, sourceName = '') {
  const values = new Map(Object.entries({VBWEB:-1, VBA7:0, Win32:0, Win64:0, Mac:0, ...constants}).map(([k,v])=>[k.toLowerCase(),v]));
  const frames=[];
  const enabled=()=>frames.every(f=>f.active);
  const evaluate=node=>{
    if(node.kind==='literal')return node.value;
    if(node.kind==='empty')return undefined;
    if(node.kind==='id')return values.get(node.name.toLowerCase());
    if(node.kind==='group')return evaluate(node.expr);
    if(node.kind==='unary')return unary(node.op,evaluate(node.expr));
    if(node.kind==='binary')return binary(node.op,evaluate(node.left),evaluate(node.right));
    throw new VBError('Conditional expressions must be constant expressions',1002);
  };
  const result=String(source).replace(/\r\n?/g,'\n').split('\n').map((line,i)=>{
    if(!/^\s*#(?:Const|If|ElseIf|Else|End)\b/i.test(line))return enabled()?line:'';
    const text=line.trim().replace(/\s+'[^\n]*$/,'');let m;
    try {
      if((m=text.match(/^#Const\s+(\w+)\s*=\s*(.+)$/i))){if(enabled())values.set(m[1].toLowerCase(),evaluate(parseExpression(m[2])));}
      else if((m=text.match(/^#If\s+(.+)\s+Then\s*$/i))){const parent=enabled(),active=parent&&truth(evaluate(parseExpression(m[1])));frames.push({parent,active,taken:active,hadElse:false,line:i+1});}
      else if((m=text.match(/^#ElseIf\s+(.+)\s+Then\s*$/i))){const f=frames.at(-1);if(!f||f.hadElse)throw new VBError('Unexpected #ElseIf',1002);f.active=f.parent&&!f.taken&&truth(evaluate(parseExpression(m[1])));f.taken ||= f.active;}
      else if(/^#Else\s*$/i.test(text)){const f=frames.at(-1);if(!f||f.hadElse)throw new VBError('Unexpected #Else',1002);f.hadElse=true;f.active=f.parent&&!f.taken;f.taken=true;}
      else if(/^#End\s+If\s*$/i.test(text)){if(!frames.length)throw new VBError('Unexpected #End If',1002);frames.pop();}
      else throw new VBError('Invalid conditional compilation directive',1002);
    }catch(error){error.source=sourceName;error.line=i+1;throw error;}
    return '';
  });
  if(frames.length)throw new VBError('Expected #End If',1002,sourceName,frames.at(-1).line);
  return result.join('\n');
}

return {preprocess};
})();

/* ../language/compiler.js */
__modules[20]=(()=>{
const {bindConstants}=__modules[15];
const {defaultIdentifierType,addDefaultTypes}=__modules[16];
const {validateInterfaces}=__modules[17];
const { preprocess }=__modules[19];
const { VBError, logicalLines, splitTop, tokenize }=__modules[2];
const { parseExpression, parseCall }=__modules[18];
const { lower }=__modules[5];







const E = text => parseExpression(text);
const suffixType = defaultIdentifierType;
function parseDeclarations(text, isConst = false, defaultTypes = {}) {
  return splitTop(text).map(part => {
    const withEvents=/^WithEvents\s+/i.test(part);part=part.replace(/^WithEvents\s+/i,'');
    const m=part.match(/^([A-Za-z_]\w*[$%&!#@]?)(?:\s*\((.*?)\))?\s*(?:As\s+(New\s+)?([\w.]+)(?:\s*\*\s*(\d+))?)?\s*(?:=\s*(.+))?$/i);
    if(!m)throw new VBError(`Invalid declaration: ${part}`,1002);
    if(isConst&&(!m[6]||m[2]!==undefined||m[3]||m[5]))throw new VBError('Constant expression required',1002);
    if(/^Decimal$/i.test(m[4]||''))throw new VBError('Decimal is a Variant subtype; use CDec instead of As Decimal',1002);
    const bounds=m[2]===undefined?null:m[2].trim()===''?[]:splitTop(m[2]).map(b=>{const r=b.split(/\s+To\s+/i);return r.length===2?[E(r[0]),E(r[1])]:[null,E(r[0])];});
    if(withEvents&&(bounds!==null||m[3]||isConst))throw new VBError('WithEvents cannot be combined with arrays, New, or Const',1002);
    return {withEvents,name:m[1],type:m[4]||suffixType(m[1],defaultTypes),explicitType:!!m[4]||/[$%&!#@]$/.test(m[1]),autoNew:!!m[3],fixedLength:m[5]?Number(m[5]):null,bounds,constant:isConst,initial:m[6]?E(m[6]):null};
  });
}
function parseParameters(text,defaultTypes={}) {
  if(!text.trim())return [];
  const params=splitTop(text).map(part=>{
    let optional=false,byRef=true,paramArray=false;const modifiers=new Set();
    while(true){const m=part.match(/^(Optional|ByVal|ByRef|ParamArray)\b\s*/i);if(!m)break;
      const key=lower(m[1]);if(modifiers.has(key)||(['byval','byref'].includes(key)&&[...modifiers].some(v=>['byval','byref'].includes(v))))throw new VBError('Invalid parameter modifier',1002);
      modifiers.add(key);if(key==='optional')optional=true;if(key==='byval')byRef=false;if(key==='paramarray'){paramArray=true;byRef=false;}part=part.slice(m[0].length);
    }
    const decl=parseDeclarations(part,false,defaultTypes)[0];return {...decl,optional,byRef,paramArray};
  });
  let optionalSeen=false;const names=new Set();
  for(let i=0;i<params.length;i++){const p=params[i],key=lower(p.name);if(names.has(key))throw new VBError('Duplicate parameter: '+p.name,1002);names.add(key);
    if(p.paramArray){if(i!==params.length-1||p.optional||p.bounds?.length!==0||lower(p.type)!=='variant'||p.initial)throw new VBError('ParamArray must be the final Variant array parameter',1002);}
    else if(optionalSeen&&!p.optional)throw new VBError('Required parameter cannot follow Optional parameter',1002);
    if(p.initial&&!p.optional)throw new VBError('Default value requires Optional',1002);
    if(p.autoNew||p.fixedLength)throw new VBError('Invalid procedure parameter declaration',1002);
    optionalSeen ||= p.optional;
  }
  return params;
}

const DEBUG_SOURCE_LINES=new WeakMap();
class ProcedureCompiler {
  constructor(proc,module) { this.proc=proc;this.module=module;this.code=[];this.blocks=[];this.labels=new Map();this.patches=[];this.temp=0;this.debugStatement=null;this.debugColumns=new Map();if(!DEBUG_SOURCE_LINES.has(module))DEBUG_SOURCE_LINES.set(module,module.source.replace(/\r\n?/g,'\n').split('\n'));this.sourceLines=DEBUG_SOURCE_LINES.get(module); }
  emit(op,data={},line=0){
    const index=this.code.length,statement=this.debugStatement;
    // A VB statement may lower to several instructions. Only its first visible
    // instruction is a sequence point; declarations and synthetic jumps are not.
    const sequencePoint=!!statement&&!statement.emitted&&!data.implicit&&op!=='dim'&&data.sequencePoint!==false;
    if(sequencePoint)statement.emitted=true;
    this.code.push({op,...data,line,source:this.module.name,procedure:this.proc.name,sequencePoint,...(sequencePoint&&statement.column?{column:statement.column,endColumn:statement.endColumn}:{})});return index;
  }
  jump(target,line,hidden=false){return this.emit('jump',{target,...(hidden?{sequencePoint:false}:{})},line);}
  patch(index,target){this.code[index].target=target;}
  block(type,line){const b=this.blocks.at(-1);if(!b||b.type!==type)throw new VBError(`Expected matching ${type} block`,1002,this.module.name,line);return b;}
  compile(lines) {
    for(const {text,line,label} of lines) {
      try { if(label){this.label(text,line);continue;} this.statement(text,line); }
      catch(error){if(error instanceof VBError){error.source ||= this.module.name;error.line ||= line;}throw error;}
    }
    if(this.blocks.length)throw new VBError(`Unclosed ${this.blocks.at(-1).type} block`,1002,this.module.name,lines.at(-1)?.line||1);
    this.emit('return',{implicit:true},lines.at(-1)?.line||this.proc.line);
    for(const {index,label,field='target',slot} of this.patches){if(!this.labels.has(/^\d+$/.test(label)?String(Number(label)):lower(label)))throw new VBError(`Label not defined: ${label}`,1002,this.module.name,this.code[index].line);if(slot===undefined)this.code[index][field]=this.labels.get(/^\d+$/.test(label)?String(Number(label)):lower(label));else this.code[index].targets[slot]=this.labels.get(/^\d+$/.test(label)?String(Number(label)):lower(label));}
    return this.code;
  }
  label(name,line){const key=/^\d+$/.test(name)?String(Number(name)):lower(name);if(this.labels.has(key))throw new VBError(`Duplicate label: ${name}`,1002,this.module.name,line);this.labels.set(key,this.code.length);if(/^\d+$/.test(name)){const number=Number(name);if(number>65535)throw new VBError('Line number must be between 0 and 65535',1002,this.module.name,line);this.emit('lineNumber',{number,implicit:true},line);}}
  statement(original,line,column=null) {
    const previous=this.debugStatement,text=original.trim(),source=this.sourceLines[line-1]||'';
    const offset=column===null?source.indexOf(text,this.debugColumns.get(line)||0):column-1;
    // Continued statements keep their physical starting line; do not invent a
    // single-line span when the logical statement is absent from that line.
    const found=offset>=0&&source.slice(offset,offset+text.length)===text;
    this.debugStatement={emitted:false,column:found?offset+1:null,endColumn:found?offset+text.length+1:null};
    if(column===null&&found)this.debugColumns.set(line,offset+text.length);
    try{return this.compileStatement(original,line);}finally{this.debugStatement=previous;}
  }
  compileStatement(original,line) {
    let text=original.trim(),m;
    if(!text||/^Rem\b/i.test(text))return;
    if(/^\d+$/.test(text)){const index=this.jump(null,line);this.patches.push({index,label:text});return;}
    if((m=text.match(/^If\s+(.+?)\s+Then\s*(.*)$/i))) {
      const index=this.emit('branch',{test:E(m[1]),target:null},line);
      if(m[2]){
        const p=new RegExp('\\bElse\\b','ig');let match,at=-1,quoted=false;
        // Use tokens to distinguish an Else keyword from string contents.
        const ts=tokenize(m[2]);const et=ts.find(t=>t.type==='id'&&lower(t.value)==='else');if(et)at=et.start;
        const yes=at<0?m[2]:m[2].slice(0,at), no=at<0?'':m[2].slice(at+4);
        const origin=this.debugStatement.column,bodyOffset=text.length-m[2].length;
        if(origin)this.code[index].endColumn=origin+bodyOffset;
        const compileParts=(body,offset)=>{let cursor=0;for(const s of splitTop(body,':')){const at=body.indexOf(s,cursor);this.statement(s,line,origin===null?null:origin+offset+at);cursor=at+s.length;}};
        compileParts(yes,bodyOffset);
        if(no){const end=this.jump(null,line,true);this.patch(index,this.code.length);compileParts(no,bodyOffset+at+4);this.patch(end,this.code.length);}else this.patch(index,this.code.length);
      }else this.blocks.push({type:'If',pending:index,ends:[]});
      return;
    }
    if((m=text.match(/^ElseIf\s+(.+?)\s+Then$/i))){const b=this.block('If',line);b.ends.push(this.jump(null,line,true));this.patch(b.pending,this.code.length);b.pending=this.emit('branch',{test:E(m[1]),target:null},line);return;}
    if(/^Else$/i.test(text)){const b=this.block('If',line);b.ends.push(this.jump(null,line,true));this.patch(b.pending,this.code.length);b.pending=null;return;}
    if(/^End\s*If$/i.test(text)){const b=this.block('If',line);if(b.pending!=null)this.patch(b.pending,this.code.length);for(const i of b.ends)this.patch(i,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^For\s+Each\s+(\w+)\s+In\s+(.+)$/i))){const id=`$each${this.temp++}`,index=this.emit('eachInit',{name:m[1],expr:E(m[2]),id,target:null},line);this.blocks.push({type:'For',kind:'each',id,index,start:this.code.length,name:m[1],exits:[]});return;}
    if((m=text.match(/^For\s+([\w.$%&!#@]+)\s*=\s*(.+?)\s+To\s+(.+?)(?:\s+Step\s+(.+))?$/i))){const id=`$for${this.temp++}`,index=this.emit('forInit',{name:m[1],start:E(m[2]),end:E(m[3]),step:E(m[4]||'1'),id,target:null},line);this.blocks.push({type:'For',kind:'numeric',id,index,start:this.code.length,name:m[1],exits:[]});return;}
    if((m=text.match(/^Next(?:\s+(.+))?$/i))){const names=m[1]?splitTop(m[1]):[''];for(const name of names){const b=this.block('For',line);if(name&&lower(name)!==lower(b.name))throw new VBError('Next control variable does not match For',1002);this.emit(b.kind==='each'?'eachNext':'forNext',{id:b.id,target:b.start},line);this.patch(b.index,this.code.length);for(const i of b.exits)this.patch(i,this.code.length);this.blocks.pop();}return;}
    if((m=text.match(/^Do(?:\s+(While|Until)\s+(.+))?$/i))){const b={type:'Do',start:this.code.length,exits:[]};if(m[1])b.test=this.emit('branch',{test:E(m[2]),invert:/until/i.test(m[1]),target:null},line);this.blocks.push(b);return;}
    if((m=text.match(/^Loop(?:\s+(While|Until)\s+(.+))?$/i))){const b=this.block('Do',line);if(m[1]){const end=this.emit('branch',{test:E(m[2]),invert:/until/i.test(m[1]),target:null},line);this.jump(b.start,line);this.patch(end,this.code.length);}else this.jump(b.start,line);if(b.test!=null)this.patch(b.test,this.code.length);for(const i of b.exits)this.patch(i,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^While\s+(.+)$/i))){const start=this.code.length,test=this.emit('branch',{test:E(m[1]),target:null},line);this.blocks.push({type:'While',start,test,exits:[]});return;}
    if(/^Wend$/i.test(text)){const b=this.block('While',line);this.jump(b.start,line);this.patch(b.test,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^Select\s+Case\s+(.+)$/i))){const id=`$select${this.temp++}`;this.emit('temp',{id,expr:E(m[1])},line);this.blocks.push({type:'Select',id,pending:null,ends:[],hasCase:false});return;}
    if((m=text.match(/^Case\s+(.+)$/i))){const b=this.block('Select',line);if(b.hasCase)b.ends.push(this.jump(null,line,true));if(b.pending!=null)this.patch(b.pending,this.code.length);b.hasCase=true;if(/^Else$/i.test(m[1]))b.pending=null;else {const cases=splitTop(m[1]).map(s=>{const r=s.match(/^(.+)\s+To\s+(.+)$/i),c=s.match(/^Is\s*(<=|>=|<>|=|<|>)\s*(.+)$/i);return r?{kind:'range',low:E(r[1]),high:E(r[2])}:c?{kind:'compare',op:c[1],expr:E(c[2])}:{kind:'value',expr:E(s)};});b.pending=this.emit('case',{id:b.id,cases,target:null},line);}return;}
    if(/^End\s+Select$/i.test(text)){const b=this.block('Select',line);if(b.pending!=null)this.patch(b.pending,this.code.length);for(const i of b.ends)this.patch(i,this.code.length);this.blocks.pop();return;}
    if((m=text.match(/^With\s+(.+)$/i))){this.emit('withPush',{expr:E(m[1])},line);this.blocks.push({type:'With'});return;}
    if(/^End\s+With$/i.test(text)){this.block('With',line);this.emit('withPop',{},line);this.blocks.pop();return;}
    if((m=text.match(/^Exit\s+(Sub|Function|Property|For|Do)\b/i))){if(/^(Sub|Function|Property)$/i.test(m[1]))this.emit('return',{},line);else{const type=m[1].toLowerCase()==='for'?'For':'Do',b=[...this.blocks].reverse().find(b=>b.type===type);if(!b)throw new VBError(`Exit ${m[1]} outside block`,1002);const inner=this.blocks.slice(this.blocks.indexOf(b)+1).filter(x=>x.type==='With').length;if(inner)this.emit('withUnwind',{count:inner},line);b.exits.push(this.jump(null,line));}return;}
    if((m=text.match(/^(Dim|Static|Private|Public)\s+(.+)$/i))){this.emit('dim',{decls:parseDeclarations(m[2],false,this.module.defaultTypes).map(d=>{if(d.withEvents)throw new VBError('WithEvents is valid only at class or form module level',1002);return d;}),static:/static/i.test(m[1])},line);return;}
    if((m=text.match(/^Const\s+(.+)$/i))){this.emit('dim',{decls:parseDeclarations(m[1],true,this.module.defaultTypes)},line);return;}
    if((m=text.match(/^ReDim\s+(Preserve\s+)?(.+)$/i))){this.emit('redim',{decls:parseDeclarations(m[2],false,this.module.defaultTypes),preserve:!!m[1]},line);return;}
    if((m=text.match(/^Erase\s+(.+)$/i))){this.emit('erase',{exprs:splitTop(m[1]).map(E)},line);return;}
    if((m=text.match(/^On\s+Error\s+(.+)$/i))){if(/^Resume\s+Next$/i.test(m[1]))this.emit('onError',{mode:'next'},line);else{const g=m[1].match(/^GoTo\s+(\w+)$/i);if(!g)throw new VBError('Invalid On Error statement',1002);const index=this.emit('onError',{mode:g[1]==='0'?'off':'goto',target:null},line);if(g[1]!=='0')this.patches.push({index,label:g[1]});}return;}
    if(/^On\s+/i.test(text)){
      const tokens=tokenize(text),branch=tokens.find(t=>t.type==='id'&&/^(GoTo|GoSub)$/i.test(t.value));
      if(!branch)throw new VBError('Expected GoTo or GoSub',1002);
      const labels=splitTop(text.slice(branch.end));
      if(!labels.length||labels.some(v=>! /^(?:[A-Za-z_]\w*|\d+)$/.test(v)))throw new VBError('Expected a list of line labels',1002);
      const index=this.emit('computedJump',{expr:E(text.slice(tokens[0].end,branch.start)),gosub:/gosub/i.test(branch.value),targets:labels.map(()=>null)},line);
      labels.forEach((label,slot)=>this.patches.push({index,label,slot}));return;
    }
    if((m=text.match(/^Error\s+(.+)$/i))){this.emit('raiseError',{expr:E(m[1])},line);return;}
    if((m=text.match(/^Resume(?:\s+(\w+))?$/i))){const index=this.emit('resume',{mode:!m[1]||m[1]==='0'?'retry':/^Next$/i.test(m[1])?'next':'goto',target:null},line);if(m[1]&&m[1]!=='0'&&!/^Next$/i.test(m[1]))this.patches.push({index,label:m[1]});return;}
    if((m=text.match(/^Go(To|Sub)\s+(\w+)$/i))){const index=this.emit(/sub/i.test(m[1])?'gosub':'jump',{target:null},line);this.patches.push({index,label:m[2]});return;}
    if(/^Return$/i.test(text)){this.emit('gosubReturn',{},line);return;}
    if((m=text.match(/^Debug\.Print\s*(.*)$/i))){this.emit('print',{exprs:splitTop(m[1].replace(/;\s*$/,'').replace(/;(?=(?:[^"\n]*"[^"\n]*")*[^"\n]*$)/g,',')).filter(Boolean).map(E),newline:!m[1].endsWith(';')},line);return;}
    if((m=text.match(/^Debug\.Assert\s+(.+)$/i))){this.emit('assert',{expr:E(m[1])},line);return;}
    if(/^Stop$/i.test(text)){this.emit('stop',{},line);return;}
    if(/^End$/i.test(text)){this.emit('end',{},line);return;}
    if((m=text.match(/^(Load|Unload)\s+(.+)$/i))){this.emit('form',{action:m[1].toLowerCase(),expr:E(m[2])},line);return;}
    if((m=text.match(/^Open\s+(.+?)\s+For\s+(Input|Output|Append|Binary|Random)(?:\s+Access\s+(Read\s+Write|Read|Write))?(?:\s+(Shared|Lock\s+Read\s+Write|Lock\s+Read|Lock\s+Write))?\s+As\s+#?(.+?)(?:\s+Len\s*=\s*(.+))?$/i))){this.emit('fileOpen',{path:E(m[1]),mode:m[2].toLowerCase(),access:m[3]?.toLowerCase(),sharing:m[4]?.toLowerCase(),handle:E(m[5]),recordLength:m[6]?E(m[6]):null},line);return;}
    if((m=text.match(/^(Get|Put)\s+#?([^,]+),\s*([^,]*),\s*(.+)$/i))){const target=E(m[4]);if(!['id','member','call'].includes(target.kind))throw new VBError('Get/Put requires a variable',1002);this.emit('fileRecord',{action:m[1].toLowerCase(),handle:E(m[2]),position:m[3].trim()?E(m[3]):null,target},line);return;}
    if((m=text.match(/^Seek\s+#?([^,]+),\s*(.+)$/i))){this.emit('fileSeek',{handle:E(m[1]),position:E(m[2])},line);return;}
    if((m=text.match(/^(Lock|Unlock)\s+#?([^,]+)(?:,\s*(.+?)(?:\s+To\s+(.+))?)?$/i))){this.emit('fileLock',{unlock:/unlock/i.test(m[1]),handle:E(m[2]),start:m[3]?E(m[3]):null,end:m[4]?E(m[4]):null},line);return;}
    if((m=text.match(/^FileCopy\s+(.+?),\s*(.+)$/i))){this.emit('fileCopy',{sourcePath:E(m[1]),destination:E(m[2])},line);return;}
    if((m=text.match(/^Name\s+(.+?)\s+As\s+(.+)$/i))){this.emit('fileRename',{sourcePath:E(m[1]),destination:E(m[2])},line);return;}
    if((m=text.match(/^Close(?:\s+(.+))?$/i))){this.emit('fileClose',{handles:m[1]?splitTop(m[1]).map(s=>E(s.replace(/^#/,''))):[]},line);return;}
    if((m=text.match(/^(Print|Write)\s+#([^,]+),?\s*(.*)$/i))){this.emit('filePrint',{handle:E(m[2]),exprs:splitTop(m[3],/Write/i.test(m[1])?',':';').filter(Boolean).map(E),csv:/Write/i.test(m[1]),newline:!m[3].endsWith(';')},line);return;}
    if((m=text.match(/^(Line\s+Input|Input)\s+#([^,]+),\s*(.+)$/i))){this.emit('fileInput',{handle:E(m[2]),targets:splitTop(m[3]).map(E),whole:/Line/i.test(m[1])},line);return;}
    // VB graphics syntax: Picture1.Line (x1,y1)-(x2,y2), color, BF
    if((m=text.match(/^(?:(.+)\.)?Line\s*\(([^,]+),([^\)]+)\)\s*-\s*\(([^,]+),([^\)]+)\)(?:\s*,\s*([^,]+))?(?:\s*,\s*(B|BF))?$/i))){this.emit('graphics',{object:E(m[1]||'Me'),kind:m[7]?'rect':'line',coords:[m[2],m[3],m[4],m[5]].map(E),color:E(m[6]||'0'),fill:/bf/i.test(m[7]||'')},line);return;}
    if((m=text.match(/^(?:(.+)\.)?PSet\s*\(([^,]+),([^\)]+)\)(?:\s*,\s*(.+))?$/i))){this.emit('graphics',{object:E(m[1]||'Me'),kind:'pixel',coords:[E(m[2]),E(m[3])],color:E(m[4]||'0')},line);return;}
    if((m=text.match(/^(?:(.+)\.)?Circle\s*\(([^,]+),([^\)]+)\)\s*,\s*([^,]+)(?:\s*,\s*(.+))?$/i))){this.emit('graphics',{object:E(m[1]||'Me'),kind:'circle',coords:[E(m[2]),E(m[3]),E(m[4])],color:E(m[5]||'0')},line);return;}
    if(/^RaiseEvent\b/i.test(text)){this.emit('raiseEvent',{expr:parseCall(text.replace(/^RaiseEvent\s+/i,''))},line);return;}
    if((m=text.match(/^(LSet|RSet)\s+(.+?)\s*=\s*(.+)$/i))){const target=E(m[2]);if(!['id','member','call'].includes(target.kind))throw new VBError('Expected assignable string variable',1002);this.emit('stringAlign',{target,expr:E(m[3]),right:/rset/i.test(m[1])},line);return;}
    if(/^Mid\$?\s*\(/i.test(text)){
      const tokens=tokenize(text);let level=0,equal;for(const t of tokens){if(t.value==='(')level++;else if(t.value===')')level--;else if(t.value==='='&&level===0){equal=t;break;}}
      if(equal){const call=E(text.slice(0,equal.start));if(call.kind!=='call'||call.args.length<2||call.args.length>3||!['id','member','call'].includes(call.args[0].kind)||call.args.some(a=>['missing','named'].includes(a.kind)))throw new VBError('Invalid Mid assignment',1002);this.emit('stringMid',{target:call.args[0],start:call.args[1],length:call.args[2],expr:E(text.slice(equal.end))},line);return;}
    }
    if(/^(Declare|Implements|Get\s+#|Put\s+#|SetAttr|FileCopy|Name\s+.+\s+As|#If|#Else|#End)/i.test(text))throw new VBError(`Unsupported statement: ${text.split(/\s/)[0]}`,445);
    text=text.replace(/^(Let|Set)\s+/i,'');
    const ts=tokenize(text);let depth=0,eq=null;
    for(const t of ts){if(t.value==='(')depth++;else if(t.value===')')depth--;else if(t.value==='='&&depth===0){eq=t;break;}}
    if(eq){const target=E(text.slice(0,eq.start));if(!['id','member','call'].includes(target.kind))throw new VBError('Invalid assignment target',1002);this.emit('assign',{target,expr:E(text.slice(eq.end)),objectSet:/^Set\s/i.test(original)},line);return;}
    if(/^Call\s+/i.test(text)){this.emit('expr',{expr:parseCall(text.replace(/^Call\s+/i,''))},line);return;}
    this.emit('expr',{expr:parseCall(text)},line);
  }
}

function compileModule(input) {
  const module={name:input.name,kind:input.kind||'module',interfaces:[],defaultTypes:{},defaultMember:null,attributes:[...(input.attributes||[])],optionExplicit:false,optionBase:0,optionCompare:'binary',declarations:[],procedures:new Map(),enums:{},types:{},diagnostics:[],source:input.code||'',form:input.form||null};
  const allLines=logicalLines(preprocess(module.source,input.conditionalConstants||{},module.name));
  const lines=allLines.filter(e=>{if(/^Attribute\s+/i.test(e.text)){module.attributes.push(e.text);return false;}return true;});let current=null,body=[],enumState=null,typeState=null;
  for(const entry of lines){let {text,line}=entry,m;
    try {
      if(current){if(/^Def(?:Bool|Byte|Int|Lng|Cur|Sng|Dbl|Date|Str|Obj|Var)\b/i.test(text))throw new VBError('Default-type declarations are valid only at module level',1002);if(new RegExp(`^End\\s+${current.kind==='property'?'Property':current.kind}$`,'i').test(text)){current.code=new ProcedureCompiler(current,module).compile(body);const key=lower(current.name)+(current.kind==='property'?':'+current.accessor:'');if(module.procedures.has(key))throw new VBError(`Ambiguous name detected: ${current.name}`,1002);module.procedures.set(key,current);current=null;body=[];}else body.push(entry);continue;}
      if(enumState){if(/^End\s+Enum$/i.test(text)){if(!enumState.previous)throw new VBError('Enum requires at least one member',1002);enumState=null;continue;}const e=text.match(/^(\w+)(?:\s*=\s*(.+))?$/);if(!e)throw new VBError('Invalid Enum member',1002);const value=e[2]?E(e[2]):enumState.previous?{kind:'binary',op:'+',left:{kind:'id',name:enumState.previous},right:{kind:'literal',value:1}}:{kind:'literal',value:0};module.declarations.push({name:e[1],line,type:'Long',explicitType:true,constant:true,scope:enumState.scope,enumName:enumState.name,initial:value,bounds:null});module.enums[enumState.name].members.push(e[1]);enumState.previous=e[1];continue;}
      if(typeState){if(/^End\s+Type$/i.test(text)){typeState=null;continue;}if(splitTop(text).some(t=>! /\bAs\s+/i.test(t)))throw new VBError('User-defined type members require an explicit As type',1002);module.types[typeState].push(...parseDeclarations(text));continue;}
      if(/^Def\w+\b/i.test(text)){addDefaultTypes(module.defaultTypes,text);continue;}
      if((m=text.match(/^Implements\s+([A-Za-z_]\w*)$/i))){if(module.kind==='module')throw new VBError('Implements is valid only in a class or form module',1002);if(module.interfaces.some(i=>lower(i.name)===lower(m[1])))throw new VBError('Duplicate implemented interface: '+m[1],1002);module.interfaces.push({name:m[1],line});continue;}
      if((m=text.match(/^Option\s+(Explicit|Base\s+[01]|Compare\s+(?:Text|Binary))$/i))){if(/^Explicit/i.test(m[1]))module.optionExplicit=true;else if(/^Base/i.test(m[1]))module.optionBase=Number(m[1].at(-1));else module.optionCompare=m[1].split(/\s+/)[1].toLowerCase();continue;}
      if(/^(Attribute\s+VB_|VERSION\s+|BEGIN$|END$|MultiUse\s*=|Persistable\s*=|DataBindingBehavior\s*=|DataSourceBehavior\s*=|MTSTransactionMode\s*=)/i.test(text))continue;
      if((m=text.match(/^(?:(Public\s+Static|Private\s+Static|Friend\s+Static|Public|Private|Friend|Static)\s+)?(Sub|Function|Property\s+(Get|Let|Set))\s+([A-Za-z_]\w*[$%&!#@]?)\s*\((.*)\)\s*(?:As\s+(\w+))?$/i))){const kind=/^Property/i.test(m[2])?'property':m[2].toLowerCase();current={name:m[4],kind,accessor:m[3]?.toLowerCase(),scope:(m[1]?.toLowerCase().split(/\s+/)[0]==='static'?'public':m[1]?.toLowerCase().split(/\s+/)[0])||'public',static:/static/i.test(m[1]||''),params:parseParameters(m[5],module.defaultTypes),returnType:m[6]||suffixType(m[4],module.defaultTypes),line,source:module.name};continue;}
      if((m=text.match(/^(?:(Public|Private|Global)\s+)?Const\s+(.+)$/i))){module.declarations.push(...parseDeclarations(m[2],true,module.defaultTypes).map(d=>({...d,line,scope:lower(m[1]||'private')})));continue;}
      if((m=text.match(/^(?:Public|Private|Global|Dim)\s+(.+)$/i))){if(/^(Enum|Type|Event|Declare)\b/i.test(m[1])){/* handled below */}else{module.declarations.push(...parseDeclarations(m[1],false,module.defaultTypes).map(d=>{if(d.withEvents&&module.kind==='module')throw new VBError('WithEvents is valid only in class and form modules',1002);return {...d,line,scope:/^(Public|Global)\b/i.test(text)?'public':'private'};}));continue;}}
      if((m=text.match(/^(?:(Public|Private)\s+)?Enum\s+(\w+)$/i))){if(Object.keys(module.enums).some(n=>lower(n)===lower(m[2])))throw new VBError('Ambiguous enum name: '+m[2],1002);enumState={name:m[2],scope:lower(m[1]||'public'),previous:null};module.enums[m[2]]={name:m[2],scope:enumState.scope,members:[]};continue;}
      if((m=text.match(/^(?:Public\s+|Private\s+)?Type\s+(\w+)$/i))){typeState=m[1];module.types[typeState]=[];continue;}
      if((m=text.match(/^(?:Public\s+|Private\s+)?Event\s+(\w+)\s*\((.*)\)$/i))){if(module.kind==='module')throw new VBError('Events can be declared only in class and form modules',1002);module.events ||= new Map();const key=lower(m[1]);if(module.events.has(key))throw new VBError('Ambiguous event name: '+m[1],1002);module.events.set(key,{name:m[1],line,scope:/^Private\b/i.test(text)?'private':'public',params:parseParameters(m[2],module.defaultTypes)});continue;}
      if(/^Option\s+Private\s+Module$/i.test(text))continue;
      if(/^(?:Public\s+|Private\s+)?Declare\b/i.test(text))throw new VBError('Native DLL declarations cannot execute in this browser runtime',453);
      throw new VBError(`Invalid statement outside procedure: ${text}`,1002);
    }catch(error){if(error instanceof VBError){error.source ||= module.name;error.line ||= line;}throw error;}
  }
  for(const p of module.procedures.values())if(/^Decimal$/i.test(p.returnType))throw new VBError('Decimal is a Variant subtype; use a Variant return type',1002,module.name,p.line);
  if(current)throw new VBError(`Expected End ${current.kind}`,1002,module.name,current.line);
  if(enumState||typeState)throw new VBError('Unterminated type declaration',1002,module.name,lines.at(-1)?.line);
  for(const attribute of module.attributes){
    const a=String(attribute).match(/^Attribute\s+(\w+)\.VB_UserMemId\s*=\s*(-?\d+)$/i);
    if(a&&Number(a[2])===0){const key=lower(a[1]),proc=module.procedures.get(key+':get')||module.procedures.get(key);
      if(!proc||proc.scope!=='public'||!['function','property'].includes(proc.kind))throw new VBError('Default member must be a Public Function or Property Get',1002,module.name,proc?.line||1);
      if(module.defaultMember&&module.defaultMember!==key)throw new VBError('Only one default member is permitted',1002,module.name,proc.line);
      module.defaultMember=key;
    }
  }
  return module;
}
function compileProject(project) {
  const modules=new Map(),diagnostics=[];
  for(const input of project.modules||[]){try{const module=compileModule({...input,conditionalConstants:project.settings?.conditionalConstants||{}});const key=lower(module.name);if(modules.has(key))throw new VBError(`Duplicate module name: ${module.name}`,1002,module.name,1);modules.set(key,module);}catch(error){diagnostics.push({severity:'error',message:error.message,number:error.number||1002,source:error.source||input.name,line:error.line||1,column:error.column||1});}}
  diagnostics.push(...validateCompiledModules(modules));
  return {name:project.name,startup:project.startup,modules,diagnostics,valid:!diagnostics.length,settings:project.settings||{},sourceProject:project};
}

/** Cross-module constraints shared by execution and background diagnostics. */
function validateCompiledModules(modules) {
  const diagnostics=bindConstants(modules);
  const recordNames=new Set([...modules.values()].flatMap(m=>Object.keys(m.types).map(lower)));
  for(const module of modules.values())for(const proc of module.procedures.values())for(const param of proc.params)if(!param.byRef&&!param.paramArray&&(recordNames.has(lower(param.type))||param.bounds!==null))diagnostics.push({severity:'error',message:recordNames.has(lower(param.type))?'User-defined type may not be passed ByVal':'Array argument must be ByRef',number:1002,source:module.name,line:proc.line,column:1});
  const parents=[...modules.values()].filter(m=>m.form?.type==='MDIForm');
  if(parents.length>1)diagnostics.push({severity:'error',message:'Only one MDI Form is permitted per project',number:360,source:parents[1].name,line:1,column:1});
  for(const module of modules.values())if(module.form){if(module.form.type==='MDIForm'&&Number(module.form.properties?.MDIChild))diagnostics.push({severity:'error',message:'An MDI Form cannot also be an MDI child',number:380,source:module.name,line:1,column:1});if(Number(module.form.properties?.MDIChild)&&!parents.length)diagnostics.push({severity:'error',message:'An MDI child requires an MDI Form in the project',number:366,source:module.name,line:1,column:1});}
  diagnostics.push(...validateInterfaces(modules));
  return diagnostics;
}

return {parseDeclarations,parseParameters,compileModule,compileProject,validateCompiledModules};
})();

/* pe32.js */
__modules[21]=(()=>{

/** Deterministic PE32 linker. Browser-safe: no Node, native compiler, or binary template. */
const PE32_BASE = 0x400000;
const align = (n, a) => Math.ceil(n / a) * a;
class BinarySection {
  constructor(name, flags) { this.name = name; this.flags = flags; this.bytes = []; this.labels = new Map(); this.fixups = []; }
  get length() { return this.bytes.length; }
  emit(...values) { for (const value of values) this.bytes.push(value & 255); return this; }
  u16(n) { return this.emit(n, n >>> 8); }
  u32(n) { return this.emit(n, n >>> 8, n >>> 16, n >>> 24); }
  zero(n) { if (!Number.isInteger(n) || n < 0 || n > 16 * 1024 * 1024) throw new Error('Invalid section allocation'); for (let i = 0; i < n; i++) this.bytes.push(0); return this; }
  align(n) { return this.zero(align(this.length, n) - this.length); }
  label(name) { if (this.labels.has(name)) throw new Error('Duplicate label: ' + name); this.labels.set(name, this.length); return this; }
  reference(label, kind = 'va', addend = 0) { this.fixups.push({ offset: this.length, label, kind, addend }); return this.u32(0); }
  ascii(text) { if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('Expected ASCII'); return this.emit(...new TextEncoder().encode(text), 0); }
  utf16(text) { for (let i = 0; i < text.length; i++) this.u16(text.charCodeAt(i)); return this.u16(0); }
}
class PE32Image {
  constructor() { this.sections = []; this.imports = new Map(); this.directories = new Map(); this.finished = false; }
  section(name, flags) {
    if (!/^\.[\w]{1,7}$/.test(name) || this.sections.some(s => s.name === name) || this.finished) throw new Error('Invalid or duplicate PE section');
    const section = new BinarySection(name, flags); this.sections.push(section); return section;
  }
  import(dll, symbol) {
    if (!/^[A-Za-z0-9_.-]+\.dll$/i.test(dll) || !(typeof symbol === 'string' && /^[A-Za-z_?@$][\w?@$]*$/.test(symbol) || Number.isInteger(symbol) && symbol > 0 && symbol < 65536)) throw new Error('Invalid DLL import');
    dll = dll.toLowerCase(); const key = dll + '!' + symbol;
    if (!this.imports.has(key)) this.imports.set(key, { dll, symbol, label: 'iat:' + key });
    return this.imports.get(key).label;
  }
  manifest(xml) {
    const r = this.section('.rsrc', 0x40000040), body = new TextEncoder().encode(xml);
    // Three resource-directory levels: RT_MANIFEST -> ID 1 -> LANG_NEUTRAL.
    r.label('resource-root').zero(12).u16(0).u16(1).u32(24).u32(0x80000018);
    r.zero(12).u16(0).u16(1).u32(1).u32(0x80000030);
    r.zero(12).u16(0).u16(1).u32(0).u32(72);
    r.reference('manifest-data', 'rva').u32(body.length).u32(65001).u32(0).label('manifest-data');
    for (const byte of body) r.emit(byte);
    this.directories.set(2, { label: 'resource-root', size: r.length });
  }
  finish(entry, { subsystem = 2 } = {}) {
    if (this.finished) throw new Error('PE image already linked');
    if (!this.imports.size || ![2, 3].includes(subsystem)) throw new Error('Invalid PE executable');
    const idata = this.section('.idata', 0xc0000040), groups = new Map();
    for (const item of this.imports.values()) { if (!groups.has(item.dll)) groups.set(item.dll, []); groups.get(item.dll).push(item); }
    idata.label('imports');
    for (const [dll] of groups) idata.reference('ilt:' + dll, 'rva').u32(0).u32(0).reference('dll:' + dll, 'rva').reference('iat:' + dll, 'rva');
    idata.zero(20);
    this.directories.set(1, { label: 'imports', size: (groups.size + 1) * 20 });
    const thunk = item => typeof item.symbol === 'number' ? idata.u32(0x80000000 + item.symbol) : idata.reference('hint:' + item.label, 'rva');
    for (const [dll, items] of groups) { idata.align(4).label('ilt:' + dll); for (const item of items) thunk(item); idata.u32(0); }
    idata.align(4).label('iat-start'); const iatStart = idata.length;
    for (const [dll, items] of groups) { idata.label('iat:' + dll); for (const item of items) { idata.label(item.label); thunk(item); } idata.u32(0); }
    this.directories.set(12, { label: 'iat-start', size: idata.length - iatStart });
    for (const [dll, items] of groups) {
      idata.label('dll:' + dll).ascii(dll);
      for (const item of items) if (typeof item.symbol === 'string') idata.align(2).label('hint:' + item.label).u16(0).ascii(item.symbol);
    }
    let rva = 4096; const symbols = new Map(), relocationPages = new Map();
    const place = section => {
      if (!section.length) section.zero(1);
      section.rva = rva; rva += align(section.length, 4096);
      for (const [label, offset] of section.labels) {
        if (symbols.has(label)) throw new Error('Duplicate linker symbol: ' + label);
        symbols.set(label, section.rva + offset);
      }
      for (const fixup of section.fixups) if (fixup.kind === 'va') {
        const at = section.rva + fixup.offset, page = Math.floor(at / 4096) * 4096;
        if (!relocationPages.has(page)) relocationPages.set(page, []);
        relocationPages.get(page).push(0x3000 + at - page);
      }
    };
    for (const section of this.sections) place(section);
    const reloc = this.section('.reloc', 0x42000040); reloc.label('relocations');
    for (const [page, entries] of relocationPages) { const size = align(8 + entries.length * 2, 4); reloc.u32(page).u32(size); for (const entry of entries) reloc.u16(entry); reloc.align(4); }
    this.directories.set(5, { label: 'relocations', size: reloc.length }); place(reloc);
    if (rva > 64 * 1024 * 1024 || this.sections.length > 16) throw new Error('Native image exceeds limits');
    const entryRva = symbols.get(entry); if (entryRva === undefined) throw new Error('Missing entry point');
    const headerSize = align(0x80 + 24 + 224 + this.sections.length * 40, 512);
    let fileSize = headerSize;
    for (const section of this.sections) { section.fileOffset = fileSize; section.rawSize = align(section.length, 512); fileSize += section.rawSize; }
    const image = new Uint8Array(fileSize), view = new DataView(image.buffer);
    const word = (at, n) => view.setUint16(at, n, true), dword = (at, n) => view.setUint32(at, n, true);
    image[0] = 77; image[1] = 90; dword(0x3c, 0x80);
    // DOS stub: exit with error; text is not executed on Windows.
    image.set([0x0e, 0x1f, 0xb8, 0x01, 0x4c, 0xcd, 0x21], 0x40);
    image.set([80, 69, 0, 0], 0x80); word(0x84, 0x14c); word(0x86, this.sections.length);
    word(0x94, 224); word(0x96, 0x102);
    const optional = 0x98; word(optional, 0x10b); image[optional + 2] = 1;
    dword(optional + 4, this.sections.filter(s => s.flags & 0x20).reduce((a, s) => a + s.rawSize, 0));
    dword(optional + 8, this.sections.filter(s => !(s.flags & 0x20)).reduce((a, s) => a + s.rawSize, 0));
    dword(optional + 16, entryRva); dword(optional + 20, this.sections[0].rva);
    dword(optional + 24, this.sections.find(s => s.flags & 0x40)?.rva || 0);
    dword(optional + 28, PE32_BASE); dword(optional + 32, 4096); dword(optional + 36, 512);
    word(optional + 40, 6); word(optional + 42, 1); word(optional + 48, 6); word(optional + 50, 1);
    dword(optional + 56, rva); dword(optional + 60, headerSize); word(optional + 68, subsystem); word(optional + 70, 0x8540);
    dword(optional + 72, 1024 * 1024); dword(optional + 76, 4096); dword(optional + 80, 1024 * 1024); dword(optional + 84, 4096); dword(optional + 92, 16);
    for (const [index, directory] of this.directories) { dword(optional + 96 + index * 8, symbols.get(directory.label)); dword(optional + 100 + index * 8, directory.size); }
    for (let i = 0; i < this.sections.length; i++) {
      const section = this.sections[i], at = optional + 224 + i * 40;
      image.set(new TextEncoder().encode(section.name), at); dword(at + 8, section.length); dword(at + 12, section.rva);
      dword(at + 16, section.rawSize); dword(at + 20, section.fileOffset); dword(at + 36, section.flags);
      image.set(section.bytes, section.fileOffset);
      for (const fixup of section.fixups) {
        const target = symbols.get(fixup.label); if (target === undefined) throw new Error('Unresolved native symbol: ' + fixup.label);
        let value = target + fixup.addend;
        if (fixup.kind === 'va') value += PE32_BASE;
        else if (fixup.kind === 'rel') value -= section.rva + fixup.offset + 4;
        else if (fixup.kind !== 'rva') throw new Error('Unknown relocation type');
        dword(section.fileOffset + fixup.offset, value);
      }
    }
    this.finished = true;
    return { bytes: image, symbols: Object.fromEntries(symbols), sections: this.sections.map(s => ({ name: s.name, rva: s.rva, offset: s.fileOffset, size: s.length, rawSize: s.rawSize, flags: s.flags })), imports: [...this.imports.values()].map(({dll, symbol}) => ({dll, symbol})) };
  }
}

return {PE32_BASE,BinarySection,PE32Image};
})();

/* x86.js */
__modules[22]=(()=>{

/** Small checked x86 assembler for the native VB backend (stdcall, 32-bit registers). */
class X86 {
  constructor(section, image) { this.s = section; this.image = image; this.sequence = 0; }
  label(name) { this.s.label(name); return this; }
  unique(prefix = 'L') { return prefix + ':' + this.sequence++; }
  emit(...values) { this.s.emit(...values); return this; }
  imm(value) { if (!Number.isInteger(value) || value < -2147483648 || value > 4294967295) throw new Error('Invalid x86 immediate'); this.s.u32(value); return this; }
  addr(label, addend = 0) { this.s.reference(label, 'va', addend); return this; }
  value(value) {
    if (typeof value === 'number') return this.emit(0xb8).imm(value);
    if (typeof value === 'string') return this.emit(0xb8).addr(value);
    if (value.address !== undefined) return this.local(value.address);
    if (value.memory) return this.emit(0xa1).addr(value.memory, value.addend || 0);
    if (value.argument !== undefined) return this.emit(0x8b, 0x85).imm(value.argument);
    throw new Error('Unsupported native argument');
  }
  push(value) { if (value === undefined) return this.emit(0x50); this.value(value); return this.emit(0x50); }
  store(label, addend = 0) { return this.emit(0xa3).addr(label, addend); }
  local(offset) { return this.emit(0x8d, 0x85).imm(offset); }
  call(label) { this.emit(0xe8); this.s.reference(label, 'rel'); return this; }
  jump(label) { this.emit(0xe9); this.s.reference(label, 'rel'); return this; }
  branch(condition, label) {
    const opcode = {e:0x84, ne:0x85, l:0x8c, le:0x8e, g:0x8f, ge:0x8d, b:0x82, ae:0x83, o:0x80, no:0x81, s:0x88, ns:0x89}[condition];
    if (opcode === undefined) throw new Error('Unknown condition'); this.emit(0x0f, opcode); this.s.reference(label, 'rel'); return this;
  }
  api(dll, name, args = []) { for (const arg of [...args].reverse()) this.push(arg); return this.invoke(dll, name); }
  invoke(dll, name) { return this.emit(0xff, 0x15).addr(this.image.import(dll, name)); }
  test() { return this.emit(0x85, 0xc0); }
  compare(value) { return this.emit(0x3d).imm(value); }
  enter(bytes = 0) {
    this.emit(0x55, 0x89, 0xe5);
    // Probe every page rather than skipping Windows' stack guard with one large subtraction.
    for (let n = bytes; n > 0; n -= 4096) this.emit(0x81, 0xec).imm(Math.min(n, 4096)).emit(0x83, 0x0c, 0x24, 0);
    return this.emit(0x53, 0x56, 0x57);
  }
  leave(args = 0) { this.emit(0x5f, 0x5e, 0x5b, 0x89, 0xec, 0x5d); return args ? this.emit(0xc2).emit(args, args >>> 8) : this.emit(0xc3); }
}

return {X86};
})();

/* storage.js */
__modules[23]=(()=>{

/** Native storage lowering. BSTR ownership is explicit; no JS or VB runtime is embedded. */
const key = value => String(value).toLowerCase();
const types = new Set(['byte', 'integer', 'long', 'boolean', 'string']);
const MAX_NATIVE_STRING = 1024 * 1024;

function boundValue(compiler, node, module, proc) {
  if (node === null) return module.optionBase;
  if (node.kind === 'group') return boundValue(compiler, node.expr, module, proc);
  if (node.kind === 'literal' && Number.isInteger(node.value)) return node.value;
  if (node.kind === 'id') {
    for (const map of [proc?.constantBindings, module.constantBindings, module.importedConstantBindings, module.globalEnumMembers]) {
      if (map?.has(key(node.name))) return Number(map.get(key(node.name)));
    }
  }
  if (node.kind === 'unary') {
    const n = boundValue(compiler, node.expr, module, proc);
    if (node.op === '-') return -n;
    if (node.op === '+') return n;
  }
  if (node.kind === 'binary') {
    const a = boundValue(compiler, node.left, module, proc), b = boundValue(compiler, node.right, module, proc);
    if (node.op === '+') return a + b;
    if (node.op === '-') return a - b;
    if (node.op === '*') return a * b;
    if (node.op === '\\' && b) return Math.trunc(a / b);
  }
  compiler.fail('Native fixed-array bounds must be integral constant expressions', module);
}

function storageLayout(compiler, decl, module, proc) {
  if (!types.has(key(decl.type)) || decl.autoNew || decl.withEvents) compiler.fail('Native storage requires Byte, Integer, Long, Boolean or String: ' + decl.name, module);
  if (decl.fixedLength !== null && decl.fixedLength !== undefined && (!Number.isInteger(decl.fixedLength) || decl.fixedLength < 1 || decl.fixedLength > 65535)) compiler.fail('Invalid fixed String length: ' + decl.name, module);
  const elementBytes = key(decl.type) === 'byte' ? 1 : ['integer', 'boolean'].includes(key(decl.type)) ? 2 : 4;
  decl.nativeElementBytes = elementBytes;
  let count = 1;
  if (decl.bounds !== null && decl.bounds !== undefined) {
    decl.nativeArray = true;
    decl.nativeDynamic = !decl.bounds.length;
    if (decl.parameter && (!decl.byRef || decl.bounds.length)) compiler.fail('Native array parameters must be unsized and ByRef', module);
    if (decl.bounds.length > 8) compiler.fail('Native fixed arrays support at most eight dimensions', module);
    decl.nativeBounds = decl.bounds.map(([low, high]) => {
      const lower = boundValue(compiler, low, module, proc), upper = boundValue(compiler, high, module, proc);
      if (![lower, upper].every(n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647) || upper < lower) compiler.fail('Invalid native array bounds: ' + decl.name, module);
      const stride = count * elementBytes;
      count *= upper - lower + 1;
      if (!Number.isSafeInteger(count) || count * elementBytes > 1024 * 1024) compiler.fail('Native fixed array exceeds the one MiB storage limit', module);
      return {lower, upper, stride};
    });
  }
  decl.nativeCount = decl.nativeDynamic ? 0 : count;
  decl.nativeDataBytes = decl.nativeDynamic ? 0 : count * elementBytes;
  // Arrays own a SAFEARRAY pointer; backing storage is allocated by OleAut32.
  decl.nativeBytes = decl.nativeArray ? 4 : Math.ceil(count * elementBytes / 4) * 4;
  return decl;
}

const nativeStorageMethods = {
  allocateStorage(variable) {
    this.data.align(4).label(variable.label).zero(variable.nativeBytes || 4);
  },
  temporaryString() {
    const c = this.context;
    const variable = {name: this.x.unique('string-temp'), type: 'String', nativeCount: 1, nativeBytes: 4, temporary: true};
    if (c?.proc?.name) {
      c.size += 4;
      if (c.size > 512 * 1024) this.fail('Native procedure workspace exceeds 512 KiB');
      variable.offset = -c.size;
      (c.stringTemps ||= []).push(variable);
    } else { variable.label = variable.name; this.allocateStorage(variable); }
    return variable;
  },
  /** Adopt a freshly allocated BSTR in EAX. Each source expression has its own slot. */
  ownString() {
    const variable = this.temporaryString(), x = this.x;
    x.push(); this.address(variable); x.emit(0x89, 0xc3, 0x5f, 0xff, 0x33).invoke('oleaut32.dll', 'SysFreeString').emit(0x89, 0x3b, 0x89, 0xf8);
    return variable;
  },
  stringPointer() {
    const ready = this.x.unique(); this.x.test().branch('ne', ready).value(this.string('')).label(ready);
  },
  storageExpression(variable, node) {
    if (variable.nativeArray && !variable.elementOf) this.fail('Whole-array values require array assignment or a ByRef array parameter');
    if (key(variable.type) === 'string') this.textExpression(node); else this.numeric(node);
  },
  rawStorageAddress(variable) {
    if (variable.owner?.form) this.x.call(variable.owner.initialize);
    if (variable.label) this.x.value(variable.label);
    else if (variable.parameter && variable.byRef) this.x.value({argument: variable.offset});
    else this.x.local(variable.offset);
  },
  zeroStorage(variable) {
    this.rawStorageAddress(variable);
    this.x.emit(0x89, 0xc7, 0xb9).imm((variable.nativeBytes || 4) / 4).emit(0x31, 0xc0, 0xfc, 0xf3, 0xab);
  },
  clearStringStorage(variable) {
    if (variable.nativeArray) return this.destroyArrayStorage(variable);
    this.x.push(variable.nativeCount || 1); this.rawStorageAddress(variable); this.x.push().call('native:string:clear');
  },
  initializeFixedString(variable) {
    if (variable.nativeArray) return this.initializeArrayStorage(variable);
    if (key(variable.type) !== 'string' || !variable.fixedLength || (variable.parameter||variable.ownedParameter)) return;
    const x = this.x;
    x.push(variable.fixedLength).push(variable.nativeCount || 1); this.rawStorageAddress(variable); x.push().call('native:string:initialize-fixed');
  },
  stringBuiltin(node, name) {
    const x = this.x, args = node.args;
    if (['len','lenb','ascw','strptr'].includes(name)) {
      if (args.length !== 1 || this.type(args[0]) !== 'string') this.fail(name + ' expects one String argument');
      if(name==='strptr'){
        const variable=this.variable(args[0]);
        if(variable){if(variable.nativeBounds&&!variable.elementOf)this.fail('StrPtr requires a String element, not an array');const pin=this.address(variable);x.emit(0x8b,0x00);this.releaseArrayPin(pin);}
        else if(args[0].kind==='id'&&key(args[0].name)==='vbnullstring')x.value(0);
        else this.expression(args[0]);
        return true;
      }
      this.expression(args[0]);
      if (name === 'ascw') { x.push().push().invoke('oleaut32.dll','SysStringLen').test().branch('e','error:5').emit(0x58,0x0f,0xbf,0x00); }
      else { x.push().invoke('oleaut32.dll','SysStringLen'); if (name === 'lenb') x.emit(0xd1,0xe0); }
      return true;
    }
    if (['left','right','mid','chrw'].includes(name)) {
      if (name === 'chrw') {
        if (args.length !== 1) this.fail('ChrW expects one argument'); this.numeric(args[0]); x.push().call('native:string:chrw');
      } else {
        if (args.length < 2 || args.length > (name === 'mid' ? 3 : 2)) this.fail(name + ' argument count mismatch');
        this.textExpression(args[0]); x.push(); this.numeric(args[1]); x.push();
        if (name === 'mid') { this.numeric(args[2] || {kind:'literal',value:MAX_NATIVE_STRING}); x.emit(0x5b,0x59).push().emit(0x53,0x51).call('native:string:mid'); }
        else x.emit(0x5b,0x59,0x53,0x51).call('native:string:'+name);
      }
      this.ownString(); return true;
    }
    return false;
  }
};

function emitNativeStorageHelpers(compiler) {
  const x = compiler.x, api = 'oleaut32.dll';
  x.label('native:string:numeric-text').enter().api(api,'SysStringLen',[{argument:8}]).emit(0x89,0xc3).api('kernel32.dll','lstrlenW',[{argument:8}]).emit(0x39,0xd8).branch('ne','error:13').value({argument:8}).leave(4);
  x.label('native:string:copy').enter().api(api,'SysStringLen',[{argument:8}]).compare(MAX_NATIVE_STRING).branch('g','error:7').push().push({argument:8}).invoke(api,'SysAllocStringLen').test().branch('e','error:7').leave(4);
  x.label('native:string:assign').enter().push({argument:12}).call('native:string:copy').emit(0x89,0xc7).value({argument:8}).emit(0x89,0xc3,0xff,0x33).invoke(api,'SysFreeString').emit(0x89,0x3b,0x89,0xf8).leave(8);
  x.label('native:string:from-int').enter(4).value(0).emit(0x89,0x45,0xfc).api(api,'VarBstrFromI4',[{argument:8},0x400,0,{address:-4}]).test().branch('s','error:7').value({argument:-4}).leave(4);
  x.label('native:string:concat').enter(4).api(api,'SysStringLen',[{argument:8}]).emit(0x89,0xc3).api(api,'SysStringLen',[{argument:12}]).emit(0x01,0xd8).compare(MAX_NATIVE_STRING).branch('g','error:7').value(0).emit(0x89,0x45,0xfc).api(api,'VarBstrCat',[{argument:8},{argument:12},{address:-4}]).test().branch('s','error:7').value({argument:-4}).leave(8);
  // Compare UTF-16 code units with explicit lengths, including embedded NULs.
  const loop=x.unique(), equal=x.unique(), less=x.unique(), greater=x.unique(), compareLengths=x.unique(), done=x.unique();
  x.label('native:string:compare').enter(8).api(api,'SysStringLen',[{argument:8}]).emit(0x89,0x45,0xfc).api(api,'SysStringLen',[{argument:12}]).emit(0x89,0x45,0xf8).value({argument:8}).emit(0x89,0xc6).value({argument:12}).emit(0x89,0xc7,0x31,0xdb);
  x.label(loop).emit(0x3b,0x5d,0xfc).branch('ge',compareLengths).emit(0x3b,0x5d,0xf8).branch('ge',compareLengths).emit(0x0f,0xb7,0x04,0x5e,0x0f,0xb7,0x14,0x5f,0x39,0xd0).branch('b',less).branch('ne',greater).emit(0x43).jump(loop);
  x.label(compareLengths).value({argument:-4}).emit(0x3b,0x45,0xf8).branch('l',less).branch('g',greater).label(equal).value(0).jump(done).label(less).value(-1).jump(done).label(greater).value(1).label(done).leave(8);
  const clearLoop=x.unique(), clearDone=x.unique();
  x.label('native:string:clear').enter().value({argument:8}).emit(0x89,0xc6).value({argument:12}).emit(0x89,0xc7).label(clearLoop).emit(0x85,0xff).branch('e',clearDone).emit(0xff,0x36).invoke(api,'SysFreeString').emit(0xc7,0x06,0,0,0,0,0x83,0xc6,4,0x4f).jump(clearLoop).label(clearDone).value(0).leave(8);
  // Allocate exactly the requested fixed width; pad with spaces and copy a bounded prefix.
  const widthOK=x.unique(), fill=x.unique(), copyDone=x.unique();
  x.label('native:string:fixed').enter().value({argument:12}).compare(1).branch('l','error:5').compare(65535).branch('g','error:5').emit(0x89,0xc3).push().push(0).invoke(api,'SysAllocStringLen').test().branch('e','error:7').emit(0x89,0xc6,0x89,0xc7,0x89,0xd9,0xb8).imm(32).emit(0xfc,0xf3,0x66,0xab).api(api,'SysStringLen',[{argument:8}]).emit(0x39,0xd8).branch('le',widthOK).emit(0x89,0xd8).label(widthOK).emit(0x89,0xc1,0x89,0xf7).value({argument:8}).emit(0x56,0x89,0xc6,0xfc,0xf3,0x66,0xa5,0x58).leave(8);
  const initLoop=x.unique(), initDone=x.unique();
  x.label('native:string:initialize-fixed').enter().value({argument:8}).emit(0x89,0xc6).value({argument:12}).emit(0x89,0xc7).label(initLoop).emit(0x85,0xff).branch('e',initDone).push({argument:16}).push(0).call('native:string:fixed').emit(0x89,0xc3,0xff,0x36).invoke(api,'SysFreeString').emit(0x89,0x1e,0x83,0xc6,4,0x4f).jump(initLoop).label(initDone).value(0).leave(12);
  for (const side of ['left','right']) {
    const countOK=x.unique();
    x.label('native:string:'+side).enter().value({argument:12}).test().branch('s','error:5').emit(0x89,0xc3).api(api,'SysStringLen',[{argument:8}]).emit(0x39,0xc3).branch('le',countOK).emit(0x89,0xc3).label(countOK);
    if (side==='right') x.emit(0x29,0xd8,0x01,0xc0).emit(0x03,0x45,8); else x.value({argument:8});
    x.emit(0x53,0x50).invoke(api,'SysAllocStringLen').test().branch('e','error:7').leave(8);
  }
  const startOK=x.unique(), lengthOK=x.unique(), sliceEmpty=x.unique(), sliceEnd=x.unique();
  x.label('native:string:mid').enter().value({argument:12}).compare(1).branch('l','error:5').emit(0x48,0x89,0xc6).value({argument:16}).test().branch('s','error:5').emit(0x89,0xc3).api(api,'SysStringLen',[{argument:8}]).emit(0x39,0xc6).branch('ge',sliceEmpty).emit(0x29,0xf0,0x39,0xc3).branch('le',lengthOK).emit(0x89,0xc3).label(lengthOK).value({argument:8}).emit(0x8d,0x04,0x70,0x53,0x50).invoke(api,'SysAllocStringLen').test().branch('e','error:7').jump(sliceEnd).label(sliceEmpty).api(api,'SysAllocStringLen',[0,0]).test().branch('e','error:7').label(sliceEnd).leave(12);
  x.label('native:string:chrw').enter().value({argument:8}).compare(-32768).branch('l','error:5').compare(65535).branch('g','error:5').push(1).local(8).push().invoke(api,'SysAllocStringLen').test().branch('e','error:7').leave(4);
}

return {MAX_NATIVE_STRING,storageLayout,nativeStorageMethods,emitNativeStorageHelpers};
})();

/* arrays.js */
__modules[24]=(()=>{

/** Owned SAFEARRAY storage for fixed/dynamic native arrays. The internal array ABI
 * passes a descriptor slot by reference; it is never exposed to browser code. */
const key = value => String(value).toLowerCase();
const A = 'native:array:';
const DLL = 'oleaut32.dll';
const arg = argument => ({argument});
const addr = address => ({address});
const VT = {byte:17, integer:2, long:3, boolean:11, string:8};
const NATIVE_ARRAY_MAX_BYTES = 1024 * 1024;
const NATIVE_ARRAY_MAX_RANK = 8;
const save = (x, offset) => x.emit(0x89,0x85).imm(offset);

const nativeArrayMethods = {
  arrayWorkspace(bytes, name = 'array-work') {
    const c = this.context, variable = {name:this.x.unique(name), type:'Long', nativeBytes:bytes};
    if(c?.proc?.name) {
      c.size += bytes;
      if(c.size > 512 * 1024) this.fail('Native procedure workspace exceeds 512 KiB');
      variable.offset = -c.size;
    } else {variable.label = variable.name; this.allocateStorage(variable);}
    return variable;
  },
  arrayPin() {
    const pin = this.arrayWorkspace(4,'array-pin');
    if(this.context?.proc?.name)this.context.arrayPins.push(pin);
    return pin;
  },
  releaseArrayPin(pin) {
    if(!pin)return;
    const x=this.x;x.push();this.rawStorageAddress(pin);x.push().call(A+'unpin').emit(0x58);
  },
  arrayRef(variable) {
    this.rawStorageAddress(variable);
    this.x.emit(0x8b,0x00).test().branch('e','error:9');
  },
  elementAddress(variable) {
    const x=this.x, array=variable.elementOf, rank=variable.indices.length;
    if(rank < 1 || rank > NATIVE_ARRAY_MAX_RANK)this.fail('Native array rank must be 1..8');
    const indices=this.arrayWorkspace(rank*4), out=this.arrayWorkspace(4), pin=this.arrayPin();
    // Evaluate every subscript exactly once, left-to-right, before dereferencing
    // the current descriptor. A subscript expression may itself resize the array.
    variable.indices.forEach((node,i)=>{
      this.numeric(node);x.push();this.rawStorageAddress(indices);x.emit(0x5a,0x89,0x90).imm(i*4);
    });
    this.arrayRef(array);x.emit(0x89,0xc3,0x53).invoke(DLL,'SafeArrayGetDim').compare(rank).branch('ne','error:9');
    x.emit(0x53).invoke(DLL,'SafeArrayLock').call(A+'check');
    // Publish ownership before a fallible index lookup. Recovery and procedure
    // exit release this pin even when another argument or the callee throws.
    this.rawStorageAddress(pin);x.emit(0x89,0x18);
    this.rawStorageAddress(out);x.push();this.rawStorageAddress(indices);x.push().emit(0x53).invoke(DLL,'SafeArrayPtrOfIndex').call(A+'check');
    this.rawStorageAddress(out);x.emit(0x8b,0x00);
    return pin;
  },
  initializeArrayStorage(variable) {
    if(!variable.nativeArray || variable.parameter || variable.nativeDynamic)return;
    const x=this.x, done=x.unique(), label=x.unique('fixed-bounds');
    this.ro.align(4).label(label);
    for(const bound of variable.nativeBounds)this.ro.u32(bound.upper-bound.lower+1).u32(bound.lower);
    this.rawStorageAddress(variable);x.emit(0x83,0x38,0).branch('ne',done);
    x.push(variable.fixedLength || 0).push(0).push(label).push(variable.nativeBounds.length).push(VT[key(variable.type)]);
    this.rawStorageAddress(variable);x.push().call(A+'redim');
    this.arrayRef(variable);x.emit(0x66,0x83,0x48,2,0x10).label(done); // FADF_FIXEDSIZE
  },
  destroyArrayStorage(variable) {
    this.rawStorageAddress(variable);this.x.push().call(A+'destroy');
  },
  redimArrayStorage(decl, preserve) {
    const x=this.x, variable=this.variable({kind:'id',name:decl.name});
    if(!variable?.nativeArray || variable.elementOf)this.fail('ReDim requires a declared native array: '+decl.name);
    if(!variable.nativeDynamic)this.fail('ReDim cannot resize a fixed native array: '+decl.name);
    if(decl.explicitType && key(decl.type)!==key(variable.type))this.fail('ReDim cannot change a typed array element type');
    if(decl.fixedLength && decl.fixedLength!==variable.fixedLength)this.fail('ReDim cannot change a fixed String element length');
    const rank=decl.bounds?.length;
    if(!rank || rank>NATIVE_ARRAY_MAX_RANK)this.fail('Native ReDim requires one to eight dimensions');
    const bounds=this.arrayWorkspace(rank*8);
    // Keep a stable slot address, not a stale SAFEARRAY pointer, across bound expressions.
    this.rawStorageAddress(variable);x.push();
    for(let i=0;i<rank;i++) {
      this.numeric(decl.bounds[i][0] || {kind:'literal',value:this.context.module.module.optionBase || 0});x.push();
      this.numeric(decl.bounds[i][1]);x.emit(0x5b,0x39,0xd8).branch('l','error:9').emit(0x29,0xd8).branch('o','error:7').emit(0x40).branch('o','error:7');
      x.push();this.rawStorageAddress(bounds);x.emit(0x5a,0x89,0x90).imm(i*8).emit(0x89,0x98).imm(i*8+4);
    }
    x.emit(0x5b).push(variable.fixedLength || 0).push(preserve?1:0);
    this.rawStorageAddress(bounds);x.push().push(rank).push(VT[key(variable.type)]).emit(0x53).call(A+'redim');
  },
  arrayBoundCall(node, upper) {
    if(node.args.length<1||node.args.length>2)this.fail('LBound/UBound expects an array and optional dimension');
    const variable=this.variable(node.args[0]);
    if(!variable?.nativeArray||variable.elementOf)this.fail('LBound/UBound requires a native array');
    this.rawStorageAddress(variable);this.x.push();this.numeric(node.args[1] || {kind:'literal',value:1});
    this.x.emit(0x5b).push().emit(0x53).call(A+(upper?'upper':'lower'));
  },
  eraseStorage(node) {
    const variable=this.variable(node);
    if(!variable?.nativeArray||variable.elementOf)this.fail('Native Erase requires an array');
    this.x.push(variable.fixedLength || 0);this.rawStorageAddress(variable);this.x.push().call(A+'erase');
  },
  assignArrayStorage(variable, node) {
    const source=this.variable(node);
    if(!variable.nativeDynamic)this.fail('Whole-array assignment requires a dynamic destination');
    if(!source?.nativeArray || source.elementOf || key(variable.type)!==key(source.type) || (variable.fixedLength||0)!==(source.fixedLength||0))this.fail('Array assignment requires identical declared element types and fixed String lengths');
    this.rawStorageAddress(variable);this.x.push();this.rawStorageAddress(source);this.x.emit(0x5b).push().emit(0x53).call(A+'copy');
  }
};

/** Runtime helpers preserve EBX/ESI/EDI and return HRESULT failures through the
 * existing VB error frame, never through a native Windows callback stack. */
function emitNativeArrayHelpers(compiler) {
  const x=compiler.x;
  const checked=x.unique();
  x.label(A+'check').test().branch('ns',checked).compare(0x8002000b).branch('e','error:9')
    .compare(0x8002000d).branch('e','error:10').compare(0x8007000e).branch('e','error:7').jump('error:5').label(checked).emit(0xc3);

  const unpinned=x.unique();
  x.label(A+'unpin').enter().value(arg(8)).emit(0x89,0xc3,0x8b,0x00).test().branch('e',unpinned)
    .push().invoke(DLL,'SafeArrayUnlock').call(A+'check').emit(0xc7,0x03,0,0,0,0).label(unpinned).value(0).leave(4);
  const destroyed=x.unique();
  x.label(A+'destroy').enter().value(arg(8)).emit(0x89,0xc3,0x8b,0x00).test().branch('e',destroyed)
    .push().invoke(DLL,'SafeArrayDestroy').call(A+'check').emit(0xc7,0x03,0,0,0,0).label(destroyed).value(0).leave(4);

  // Product of counts is independent of SAFEARRAY's reversed dimension storage.
  const countLoop=x.unique(), countDone=x.unique();
  x.label(A+'count').enter().value(arg(8)).test().branch('e','error:9')
    .emit(0x0f,0xb7,0x38,0x8d,0x70,16,0xbb).imm(1).label(countLoop).emit(0x85,0xff).branch('e',countDone)
    .emit(0x0f,0xaf,0x1e).branch('o','error:7').emit(0x83,0xc6,8,0x4f).jump(countLoop)
    .label(countDone).emit(0x89,0xd8).compare(NATIVE_ARRAY_MAX_BYTES).branch('g','error:7').leave(4);

  for(const upper of [false,true]) {
    x.label(A+(upper?'upper':'lower')).enter(4).value(arg(8)).emit(0x8b,0x00).test().branch('e','error:9')
      .emit(0x89,0xc3).value(arg(12)).compare(1).branch('l','error:9');
    x.emit(0x53).invoke(DLL,'SafeArrayGetDim').emit(0x39,0x45,12).branch('g','error:9');
    x.push(addr(-4)).push(arg(12)).emit(0x53).invoke(DLL,upper?'SafeArrayGetUBound':'SafeArrayGetLBound').call(A+'check').value(arg(-4)).leave(8);
  }

  // redim(slot, vt, rank, bounds-in-declaration-order, preserve, fixedStringLength)
  const noOld=x.unique(), counts=x.unique(), counted=x.unique(), byteLimit=x.unique(), halfLimit=x.unique(), limitDone=x.unique();
  const create=x.unique(), validate=x.unique(), preserveNow=x.unique(), success=x.unique(), publish=x.unique(), finish=x.unique();
  x.label(A+'redim').enter(24).value(arg(8)).emit(0x89,0xc3,0x8b,0x00);save(x,-4);
  x.test().branch('e',noOld).emit(0x66,0xf7,0x40,2,0x10,0).branch('ne','error:10')
    .emit(0x83,0x78,8,0).branch('ne','error:10');
  x.label(noOld).value(arg(16)).compare(1).branch('l','error:9').compare(NATIVE_ARRAY_MAX_RANK).branch('g','error:9')
    .emit(0x89,0xc7).value(arg(20)).emit(0x89,0xc6).value(1);save(x,-16);
  x.label(counts).emit(0x85,0xff).branch('e',counted).emit(0x8b,0x06).compare(1).branch('l','error:9')
    .emit(0x0f,0xaf,0x45,0xf0).branch('o','error:7').compare(NATIVE_ARRAY_MAX_BYTES).branch('g','error:7');save(x,-16);
  x.emit(0x83,0xc6,8,0x4f).jump(counts).label(counted);
  x.value(arg(12)).compare(17).branch('e',byteLimit).compare(2).branch('e',halfLimit).compare(11).branch('e',halfLimit)
    .value(arg(-16)).compare(NATIVE_ARRAY_MAX_BYTES/4).branch('g','error:7').jump(limitDone);
  x.label(halfLimit).value(arg(-16)).compare(NATIVE_ARRAY_MAX_BYTES/2).branch('g','error:7').jump(limitDone);
  x.label(byteLimit).label(limitDone).value(0);save(x,-12);
  x.value(arg(-4)).test().branch('e',create).value(arg(24)).test().branch('e',create);
  x.api(DLL,'SafeArrayGetDim',[arg(-4)]).emit(0x3b,0x45,16).branch('ne','error:9');
  x.push(arg(-4)).call(A+'count');save(x,-12);
  x.value(arg(20)).emit(0x89,0xc6,0xbf).imm(1).label(validate);
  x.push(addr(-20)).emit(0x57).push(arg(-4)).invoke(DLL,'SafeArrayGetLBound').call(A+'check');
  x.value(arg(-20)).emit(0x3b,0x46,4).branch('ne','error:9').emit(0x3b,0x7d,16).branch('e',preserveNow);
  x.push(addr(-20)).emit(0x57).push(arg(-4)).invoke(DLL,'SafeArrayGetUBound').call(A+'check')
    .emit(0x8b,0x06,0x03,0x46,4,0x48,0x3b,0x45,0xec).branch('ne','error:9')
    .emit(0x83,0xc6,8,0x47).jump(validate);
  x.label(preserveNow).emit(0x56).push(arg(-4)).invoke(DLL,'SafeArrayRedim').call(A+'check').jump(success);
  x.label(create).api(DLL,'SafeArrayCreate',[arg(12),arg(16),arg(20)]).test().branch('e','error:7');save(x,-8);
  x.value(arg(-4)).test().branch('e',publish).push().invoke(DLL,'SafeArrayDestroy').test().branch('ns',publish);
  // Do not leak the new allocation or overwrite the old owner if destruction fails.
  x.push().push(arg(-8)).invoke(DLL,'SafeArrayDestroy').emit(0x58).call(A+'check');
  x.label(publish).value(arg(-8)).emit(0x89,0x03).value(0);save(x,-12);
  x.label(success).value(arg(28)).test().branch('e',finish);
  x.value(arg(-16)).emit(0x2b,0x45,0xf4).test().branch('le',finish).emit(0x89,0xc7);
  x.value(arg(-12)).emit(0xc1,0xe0,2,0x8b,0x13,0x03,0x42,12,0x89,0xc6)
    .push(arg(28)).emit(0x57,0x56).call('native:string:initialize-fixed');
  x.label(finish).value(0).leave(24);

  // Erase a dynamic array destroys its descriptor. Fixed arrays keep their shape
  // and storage; BSTR elements are released, never zeroed without being freed.
  const eraseDone=x.unique(), reset=x.unique(), numeric=x.unique();
  x.label(A+'erase').enter().value(arg(8)).emit(0x89,0xc3,0x8b,0x00).test().branch('e',eraseDone)
    .emit(0x89,0xc6,0x83,0x7e,8,0).branch('ne','error:10')
    .emit(0x66,0xf7,0x46,2,0x10,0).branch('ne',reset).push(arg(8)).call(A+'destroy').jump(eraseDone);
  x.label(reset).emit(0x56).call(A+'count').emit(0x89,0xc7,0x66,0xf7,0x46,2,0,1).branch('e',numeric)
    .emit(0x57,0xff,0x76,12).call('native:string:clear');
  x.value(arg(12)).test().branch('e',eraseDone).push().emit(0x57,0xff,0x76,12).call('native:string:initialize-fixed').jump(eraseDone);
  x.label(numeric).emit(0x89,0xf8,0x0f,0xaf,0x46,4,0x89,0xc1,0x8b,0x7e,12,0x31,0xc0,0xfc,0xf3,0xaa)
    .label(eraseDone).value(0).leave(8);

  // SafeArrayCopy deep-copies BSTRs. Validate and allocate before changing the
  // destination. Copying a fixed array into a dynamic one must not copy fixedness.
  const copyUnlocked=x.unique(), copyEmpty=x.unique(), copyDone=x.unique(), copyPublish=x.unique();
  x.label(A+'copy').enter(8).value(arg(8)).emit(0x89,0xc3,0x8b,0x00,0x89,0xc6).test().branch('e',copyUnlocked)
    .emit(0x66,0xf7,0x46,2,0x10,0).branch('ne','error:10').emit(0x83,0x7e,8,0).branch('ne','error:10');
  x.label(copyUnlocked).value(arg(12)).emit(0x8b,0x00).test().branch('e',copyEmpty).emit(0x39,0xf0).branch('e',copyDone).emit(0x89,0xc7);
  x.value(0);save(x,-4);x.push(addr(-4)).emit(0x57).invoke(DLL,'SafeArrayCopy').call(A+'check');
  x.value(arg(-4)).emit(0x66,0x83,0x60,2,0xef,0x85,0xf6).branch('e',copyPublish)
    .emit(0x56).invoke(DLL,'SafeArrayDestroy').test().branch('ns',copyPublish);
  x.push().push(arg(-4)).invoke(DLL,'SafeArrayDestroy').emit(0x58).call(A+'check');
  x.label(copyPublish).value(arg(-4)).emit(0x89,0x03).jump(copyDone);
  x.label(copyEmpty).emit(0x53).call(A+'destroy');
  x.label(copyDone).value(0).leave(8);
}

return {NATIVE_ARRAY_MAX_BYTES,NATIVE_ARRAY_MAX_RANK,nativeArrayMethods,emitNativeArrayHelpers};
})();

/* errors.js */
__modules[25]=(()=>{

/** Structured native VB error frames. Windows callback boundaries never unwind across user32. */
const NATIVE_ERROR_FRAME_BYTES = 48;
const key = value => String(value).toLowerCase();
const mem = memory => ({memory});
const arg = argument => ({argument});
const E = 'native:error:';
const DESCRIPTIONS = new Map([[5,'Invalid procedure call or argument'],[6,'Overflow'],[7,'Out of memory'],[9,'Subscript out of range'],[10,'This array is fixed or temporarily locked'],[11,'Division by zero'],[13,'Type mismatch'],[20,'Resume without error']]);
// Metadata is relative to the native VB procedure's EBP, before its user locals.
const F = {previous:-4,stack:-8,dispatch:-12,handler:-16,active:-20,current:-24,next:-28,fault:-32,resumeNext:-36,line:-40,erl:-44,source:-48};
const localStore = (x, offset) => x.emit(0x89,0x85).imm(offset);
const localImmediate = (x, offset, value) => { x.value(value);localStore(x,offset); };

const nativeErrorMethods = {
  prepareErrors() {
    for (const name of ['frame','pending','number','description','source','erl']) this.slot(E+name);
  },
  errorProperty(node) {
    if(node.kind!=='member'||node.object.kind!=='id'||key(node.object.name)!=='err')return null;
    const name=key(node.name);
    if(!['number','description','source'].includes(name))this.fail('Native Err property is not implemented: '+node.name);
    return name;
  },
  errorExpression(node) {
    const property=this.errorProperty(node),x=this.x;
    if(property){x.value(mem(E+property));if(property!=='number'){x.push().call('native:string:copy');this.ownString();}return true;}
    if(node.kind==='id'&&key(node.name)==='erl'){x.value(mem(E+'erl'));return true;}
    return false;
  },
  errorCall(node) {
    const callee=node.callee,x=this.x;
    if(callee.kind==='id'&&key(callee.name)==='erl'){
      if(node.args.length)this.fail('Erl takes no arguments');x.value(mem(E+'erl'));return true;
    }
    if(callee.kind!=='member'||callee.object.kind!=='id'||key(callee.object.name)!=='err')return false;
    const name=key(callee.name);
    if(name==='clear'&&!node.args.length){x.call(E+'clear');return true;}
    if(name==='raise'&&node.args.length===1){this.numeric(node.args[0]);x.jump(E+'raise');return true;}
    this.fail('Native Err supports Clear and Raise(number); custom source/help arguments are not yet lowered');
  },
  errorCheckpoint(context, index, instruction) {
    const x=this.x;
    localImmediate(x,F.current,context.label+':'+index);
    localImmediate(x,F.next,context.label+':'+(index+1));
    localImmediate(x,F.line,instruction.line||0);
  },
  errorInstruction(instruction,context) {
    const x=this.x;
    if(instruction.op==='lineNumber'){localImmediate(x,F.erl,instruction.number);return true;}
    if(instruction.op==='onError'){
      localImmediate(x,F.handler,instruction.mode==='goto'?context.label+':'+instruction.target:instruction.mode==='next'?-1:0);
      localImmediate(x,F.active,0);localImmediate(x,F.fault,0);
      x.call(E+'clear');return true;
    }
    if(instruction.op==='raiseError'){this.numeric(instruction.expr);x.jump(E+'raise');return true;}
    if(instruction.op==='resume'){
      x.value(arg(F.fault)).test().branch('e','error:20');
      if(instruction.mode==='next')x.value(arg(F.resumeNext));
      else if(instruction.mode==='goto')x.value(context.label+':'+instruction.target);
      x.push();localImmediate(x,F.active,0);localImmediate(x,F.fault,0);x.call(E+'clear').emit(0x58,0xff,0xe0);return true;
    }
    return false;
  },
  checkNativeError(target=this.context?.label+':error-dispatch') {
    this.x.emit(0x83,0x3d).addr(E+'pending').emit(0).branch('ne',target);
  },
  enterErrorFrame(context) {
    const x=this.x;
    for(const offset of Object.values(F))localImmediate(x,offset,0);
    x.value(mem(E+'frame'));localStore(x,F.previous);
    x.emit(0x89,0xe8).store(E+'frame');
    x.emit(0x89,0xe0);localStore(x,F.stack);
    localImmediate(x,F.dispatch,context.label+':error-dispatch');
    localImmediate(x,F.source,this.string(context.module.name));
    localImmediate(x,F.current,context.label+':0');localImmediate(x,F.next,context.label+':0');
  },
  leaveErrorFrame() {
    // EAX is the return value; restoring the prior frame must not overwrite it.
    this.x.emit(0x8b,0x95).imm(F.previous).emit(0x89,0x15).addr(E+'frame');
  },
  emitErrorDispatch(context) {
    const x=this.x,autoNext=x.unique();
    x.label(context.label+':error-dispatch');
    // A caller may have partially evaluated argument or expression stacks. Discard
    // those slots before cleanup or entering a handler; all managed values have owners.
    x.value(arg(F.stack)).emit(0x89,0xc4);
    x.value(arg(F.handler)).test().branch('e',context.label+':error-return');
    x.emit(0x83,0xbd).imm(F.active).emit(0).branch('ne',context.label+':error-return');
    x.value(arg(F.current));localStore(x,F.fault);x.value(arg(F.next));localStore(x,F.resumeNext);
    x.value(0).store(E+'pending');
    x.value(arg(F.handler)).compare(-1).branch('e',autoNext);
    x.push();localImmediate(x,F.active,1);x.emit(0x58,0xff,0xe0);
    x.label(autoNext).value(arg(F.next)).emit(0xff,0xe0);
  },
  enterCallbackBoundary(offset) {
    // A window procedure is entered through a Windows ABI frame. Never transfer
    // control non-locally across that frame into a suspended Show/SendMessage caller.
    const x=this.x;x.value(mem(E+'frame'));localStore(x,offset);x.value(0).store(E+'frame');
  },
  leaveCallbackBoundary(offset) {
    this.x.emit(0x8b,0x95).imm(offset).emit(0x89,0x15).addr(E+'frame');
  }
};

function emitNativeErrorHelpers(compiler) {
  const x=compiler.x, unknown=x.unique(),sourceDone=x.unique();
  x.label(E+'clear').value(0);
  for(const name of ['pending','number','description','source','erl'])x.store(E+name);
  x.emit(0xc3);
  for(const number of DESCRIPTIONS.keys())x.label('error:'+number).value(number).jump(E+'raise');
  x.label(E+'raise');
  // VB Error numbers are nonzero unsigned 16-bit values for this backend.
  x.compare(1).branch('l',unknown).compare(65535).branch('g',unknown);
  const valid=x.unique();x.jump(valid).label(unknown).value(5).label(valid).store(E+'number');
  x.value(compiler.string('Application-defined or object-defined error')).store(E+'description');
  const described=x.unique();
  for(const [number,text]of DESCRIPTIONS){const next=x.unique();x.value(mem(E+'number')).compare(number).branch('ne',next).value(compiler.string(text)).store(E+'description').jump(described).label(next);}
  x.label(described).value(0).store(E+'erl').value(compiler.string(compiler.project.name)).store(E+'source');
  x.value(mem(E+'frame')).test().branch('e',sourceDone).emit(0x89,0xc2,0x8b,0x42,F.source&255).store(E+'source').emit(0x8b,0x42,F.erl&255).store(E+'erl');
  x.label(sourceDone).value(1).store(E+'pending');
  x.value(mem(E+'frame')).test().branch('e',E+'fatal').emit(0x89,0xc5,0x8b,0x65,F.stack&255,0xff,0x65,F.dispatch&255);
  x.label(E+'fatal');
  // Disable non-local transfers before constructing the final diagnostic itself.
  x.value(0).store(E+'frame');
  const fatalReady=x.unique();
  for(const number of DESCRIPTIONS.keys()){const next=x.unique();x.value(mem(E+'number')).compare(number).branch('ne',next).value(compiler.string('Run-time error '+number)).jump(fatalReady).label(next);}
  x.value(compiler.string('Run-time error (application-defined)'));
  x.label(fatalReady).emit(0x89,0xc3).push(16).push(compiler.errorTitle).emit(0x53).push(0).invoke('user32.dll','MessageBoxW').api('kernel32.dll','ExitProcess',[mem(E+'number')]);
}

return {NATIVE_ERROR_FRAME_BYTES,nativeErrorMethods,emitNativeErrorHelpers};
})();

/* compiler.js */
__modules[26]=(()=>{
const {normalizeProject}=__modules[13];
const {compileProject, parseParameters}=__modules[20];
const {PE32Image, BinarySection}=__modules[21];
const {X86}=__modules[22];
const {MAX_NATIVE_STRING,storageLayout,nativeStorageMethods,emitNativeStorageHelpers}=__modules[23];
const {nativeArrayMethods,emitNativeArrayHelpers}=__modules[24];
const {NATIVE_ERROR_FRAME_BYTES,nativeErrorMethods,emitNativeErrorHelpers}=__modules[25];







const key = value => String(value).toLowerCase();
const lit = value => ({kind:'literal', value});
const mem = memory => ({memory});
const INT_TYPES = new Set(['long', 'integer', 'byte', 'boolean']);
const CLASSES = {CommandButton:'BUTTON', Label:'STATIC', TextBox:'EDIT', CheckBox:'BUTTON', OptionButton:'BUTTON', Frame:'BUTTON', ListBox:'LISTBOX', ComboBox:'COMBOBOX', Timer:null};
const BOOL_CONDITIONS = {'=':0x94, '<>':0x95, '<':0x9c, '<=':0x9e, '>':0x9f, '>=':0x9d};
const CONSTANTS = {vbtrue:-1,vbfalse:0,vbnormal:0,vbminimized:1,vbmaximized:2,vbmodal:1,vbmodeless:0,vbokonly:0,vbokcancel:1,vbyesno:4,vbyesnocancel:3,vbinformation:64,vbexclamation:48,vbcritical:16,vbquestion:32,vbok:1,vbcancel:2,vbyes:6,vbno:7,vbcrlf:'\r\n',vbnewline:'\r\n',vbtab:'\t',vbnullstring:''};
class NativeCompileError extends Error {
  constructor(message, source = '', line = 0) { super(`${source ? source + ':' + line + ': ' : ''}${message}`); this.name = 'NativeCompileError'; this.diagnostics = [{severity:'error',source,line,message}]; }
}

/** Native declarations are stripped only for this backend; the browser VM remains sandboxed. */
function extractNativeDeclarations(module) {
  const declarations = new Map();
  const code = module.code.split(/\r?\n/).map((line, index) => {
    if (!/^\s*(?:Public\s+|Private\s+)?Declare\b/i.test(line)) return line;
    const m = line.match(/^\s*(?:(Public|Private)\s+)?Declare\s+(Function|Sub)\s+(\w+)\s+Lib\s+"([\w.-]+)"(?:\s+Alias\s+"([\w?@$#]+)")?\s*\((.*)\)\s*(?:As\s+(\w+))?\s*(?:'.*)?$/i);
    if (!m) throw new NativeCompileError('Unsupported native Declare syntax; use a single-line stdcall declaration', module.name, index + 1);
    const dll = /\.dll$/i.test(m[4]) ? m[4] : m[4] + '.dll', name = key(m[3]);
    const params = parseParameters(m[6]);
    if (declarations.has(name)) throw new NativeCompileError('Duplicate native declaration: ' + m[3], module.name, index + 1);
    if (params.some(p => !INT_TYPES.has(key(p.type)) || p.bounds !== null || p.optional || p.paramArray) || (key(m[2]) === 'function' && !INT_TYPES.has(key(m[7])))) {
      throw new NativeCompileError('Native Declare supports Byte/Integer/Long/Boolean parameters and returns; use StrPtr for explicit Unicode pointers', module.name, index + 1);
    }
    declarations.set(name, {name:m[3],kind:key(m[2]),scope:key(m[1] || 'public'),params,returnType:m[7] || 'Long',dll,symbol:/^#\d+$/.test(m[5] || '') ? Number(m[5].slice(1)) : m[5] || m[3],line:index + 1});
    return ''; // Keep line numbers stable.
  }).join('\n');
  return {declarations, code};
}

class NativeCompiler {
  constructor(project) {
    this.project = normalizeProject(project); this.externals = new Map();
    if (this.project.dataSources?.connections?.length || this.project.modules.some(m => m.form?.controls?.some(c => c.properties?.DataSource || c.properties?.DataMember || /^(?:Data|Adodc)$/i.test(c.type)))) this.fail('Data-source providers and data-bound controls require the HTML or Electron desktop target; freestanding PE32 AOT does not implement the data runtime');
    if (project.resources?.entries?.length) this.fail('Native resource lowering is not yet implemented; use the classic or desktop target');
    const targetType = project.nativeProject?.entries?.find(e => key(e.key) === 'type')?.value;
    if (targetType && key(targetType) !== 'exe') this.fail('Freestanding AOT currently requires a Standard EXE project');
    for (const module of this.project.modules) { const result = extractNativeDeclarations(module); module.code = result.code; this.externals.set(key(module.name), result.declarations); }
    this.program = compileProject(this.project);
    if (!this.program.valid) { const error = new NativeCompileError('Project contains compile errors'); error.diagnostics = this.program.diagnostics; error.message = error.diagnostics.map(d => `${d.source}:${d.line}: ${d.message}`).join('\n'); throw error; }
    this.image = new PE32Image(); this.text = this.image.section('.text', 0x60000020); this.ro = this.image.section('.rdata', 0x40000040); this.data = this.image.section('.data', 0xc0000040);
    this.x = new X86(this.text, this.image); this.modules = new Map(); this.strings = new Map(); this.sourceMap = []; this.bufferCount = 0;
    this.slot('instance'); this.slot('live-forms'); this.data.align(4).label('msg').zero(32);
    this.title = this.string(project.name); this.errorTitle = this.string('VB6 native runtime error'); this.prepareErrors();
    for (const module of this.program.modules.values()) this.prepareModule(module);
    const parents = [...this.modules.values()].filter(m => m.form?.type === 'MDIForm');
    if (parents.length > 1) this.fail('Only one MDI parent is supported'); this.mdi = parents[0];
    for (const module of this.modules.values()) if (module.form?.properties.MDIChild && !this.mdi) this.fail('MDI child requires an MDIForm', module);
  }
  fail(message, context = this.context) { throw new NativeCompileError(message, context?.module?.name || context?.name || '', this.instruction?.line || 0); }
  slot(label, value = 0) { this.data.align(4).label(label).u32(value); return label; }
  string(text) { text = String(text); if (text.length > MAX_NATIVE_STRING) this.fail('Native text exceeds 1,048,576 UTF-16 units'); if (!this.strings.has(text)) { const name = 'string:' + this.strings.size; this.ro.align(4).u32(text.length * 2).label(name).utf16(text); this.strings.set(text,name); } return this.strings.get(text); }
  buffer() { if(this.context?.proc?.name) { this.context.size+=8192; if(this.context.size>512*1024)this.fail('Native procedure text workspace exceeds 512 KiB'); return {address:-this.context.size}; } if (++this.bufferCount > 1024) this.fail('Native text-buffer limit exceeded'); const name = 'buffer:' + this.bufferCount; this.data.align(4).label(name).zero(8192); return name; }
  scalar(decl) { return storageLayout(this,decl,this.preparingModule,this.preparingProcedure); }
  prepareModule(module) {
    this.preparingModule=module;this.preparingProcedure=null;
    if (!['form','module'].includes(module.kind) || module.interfaces.length || Object.keys(module.types).length) this.fail('Native AOT does not yet lower classes, interfaces or UDTs', module);
    const result = {module,name:module.name,form:module.form,globals:new Map(),procedures:new Map(),controls:new Map(),externals:this.externals.get(key(module.name))};
    this.modules.set(key(module.name), result);
    for (const decl of module.declarations) {
      if (decl.constant) continue; this.scalar(decl);
      const variable = {...decl,owner:result,label:'global:' + module.name + ':' + decl.name}; this.allocateStorage(variable); result.globals.set(key(decl.name),variable);
    }
    for (const proc of module.procedures.values()) {
      this.preparingProcedure=proc;
      if (!['sub','function'].includes(proc.kind)) this.fail('Native AOT does not lower property procedures', module);
      if (proc.kind === 'function' && !INT_TYPES.has(key(proc.returnType)) && key(proc.returnType)!=='string') this.fail('Native functions must return a supported scalar: ' + proc.name, module);
      const context = {module:result,proc,label:'proc:' + module.name + ':' + proc.name,locals:new Map(),temporaries:new Map(),loops:new Map(),size:NATIVE_ERROR_FRAME_BYTES};
      const local = (name, type = 'Long',decl={}) => { context.size += decl.nativeBytes || 4; if(context.size>512*1024)this.fail('Native procedure workspace exceeds 512 KiB',module); const variable = {...decl,name,type,offset:-context.size}; context.locals.set(key(name),variable); return variable; };
      proc.params.forEach((p,i) => { p=this.scalar({...p,parameter:true}); if (p.optional || p.paramArray) this.fail('Optional/ParamArray native parameters are not lowered',module); if(key(p.type)==='string'&&!p.byRef){const v=local(p.name,p.type,{...p,parameter:false});v.incomingOffset=8+i*4;v.ownedParameter=true;}else context.locals.set(key(p.name),{...p,offset:8+i*4,parameter:true}); });
      if (proc.kind === 'function') context.returnValue = local(proc.name,proc.returnType);
      for (const instruction of proc.code) {
        if (instruction.op === 'dim') for (const decl of instruction.decls) {
          if (decl.constant) continue; this.scalar(decl); if (context.locals.has(key(decl.name))) this.fail('Duplicate local: ' + decl.name,module);
          if (instruction.static || proc.static) { if(decl.initial) this.fail('Native static initializers are not yet lowered',module); const variable = {...decl,label:'static:' + context.label + ':' + decl.name}; this.allocateStorage(variable);if(variable.fixedLength)variable.initialized=this.slot(variable.label+':initialized'); context.locals.set(key(decl.name),variable); }
          else local(decl.name,decl.type,decl);
        }
        if (instruction.op === 'forInit') { const end = local(instruction.id + ':end'), step = local(instruction.id + ':step'); context.loops.set(instruction.id,{...instruction,endVariable:end,stepVariable:step}); }
        if (instruction.op === 'temp') context.temporaries.set(instruction.id,local(instruction.id));
      }
      result.procedures.set(key(proc.name),context);
    }
    for (const name of result.externals.keys()) if (result.procedures.has(name) || result.globals.has(name) || module.constantBindings.has(name)) this.fail('Native declaration conflicts with a project member: ' + name,module);
    if (!module.form) return;
    if (!['Form','MDIForm'].includes(module.form.type)) this.fail('Unsupported native form designer',module);
    if (module.form.properties.Picture || module.form.properties.Icon) this.fail('Native form picture/icon resources are not yet lowered',module);
    if (![1,3].includes(Number(module.form.properties.ScaleMode ?? 1))) this.fail('Native form ScaleMode currently supports Twips (1) or Pixels (3)',module);
    if (module.form.properties.KeyPreview) this.fail('Native KeyPreview is not yet lowered',module);
    result.handle = this.slot('hwnd:' + module.name); result.loaded = this.slot('loaded:' + module.name); result.create = 'create:' + module.name; result.close = 'close:' + module.name;
    result.initialized = this.slot('initialized:' + module.name); result.initialize = 'initialize:' + module.name;
    result.client = this.slot('mdi-client:' + module.name); result.menu = this.slot('menu:' + module.name);
    result.className = this.string('VB6.Native.' + module.name);
    result.rect = 'rect:' + module.name; this.data.align(4).label(result.rect).zero(16);
    let id = 100;
    for (const model of module.form.controls) {
      if (model.properties.Picture || model.properties.Icon) this.fail('Native picture/icon resources are not yet lowered',module);
      if (!Object.hasOwn(CLASSES,model.type) || model.properties.Index !== undefined) this.fail('Unsupported native control or control array: ' + model.type, module);
      const control = {model,module:result,id:id++,handle:this.slot('hwnd:' + module.name + ':' + model.name)};
      if (model.type === 'Frame') control.oldProcedure=this.slot('frame-old-procedure:'+module.name+':'+model.name);
      if (model.type === 'Timer') { control.interval = this.slot('timer-interval:' + module.name + ':' + model.name,Number(model.properties.Interval) || 0); control.enabled = this.slot('timer-enabled:' + module.name + ':' + model.name,model.properties.Enabled === 0 ? 0 : -1); }
      result.controls.set(key(model.name),control);
    }
    const supported = new Set(['load','initialize','activate','deactivate','resize','queryunload','unload']);
    for (const context of result.procedures.values()) {
      const name = key(context.proc.name), match = name.match(/^(?:mdi)?form_(.*)$/);
      if (match && !supported.has(match[1])) this.fail('Native form event is not yet routed: ' + context.proc.name,module);
      for (const [controlName,control] of result.controls) if (name.startsWith(controlName + '_')) {
        const event = name.slice(controlName.length + 1);
        const events = {CommandButton:['click'], Label:['click','dblclick'], TextBox:['change'], CheckBox:['click'],OptionButton:['click'],Frame:[], ListBox:['click','dblclick'], ComboBox:['click','change'], Timer:['timer']}[control.model.type];
        if (!events.includes(event)) this.fail('Native control event is not yet routed: ' + context.proc.name,module);
      }
    }
  }
  variable(node, context = this.context) {
    if (node.kind === 'group') return this.variable(node.expr,context);
    if (node.kind === 'call') {
      const array=this.variable(node.callee,context);
      if(array?.nativeArray){if(!node.args.length)return array;if(!array.nativeDynamic&&node.args.length!==array.nativeBounds.length)this.fail('Native array rank mismatch: '+array.name);return {type:array.type,fixedLength:array.fixedLength,elementOf:array,indices:node.args};}
      return null;
    }
    if (node.kind === 'id') return context?.locals.get(key(node.name)) || context?.module.globals.get(key(node.name)) || this.publicVariable(node.name);
    if (node.kind === 'member' && node.object.kind === 'id') { const owner=this.modules.get(key(node.object.name)), variable=owner?.globals.get(key(node.name)); if(variable && owner!==context?.module && variable.scope!=='public') this.fail('Private native variable is not accessible: '+node.name); return variable; }
    return null;
  }
  publicVariable(name) { const matches = [...this.modules.values()].flatMap(m => [...m.globals.values()].filter(v => key(v.name) === key(name) && v.scope === 'public')); if (matches.length > 1) this.fail('Ambiguous global: ' + name); return matches[0]; }
  constant(node) {
    if (node.kind !== 'id') return undefined; const name = key(node.name), c = this.context;
    for (const map of [c?.proc.constantBindings, c?.module.module.constantBindings, c?.module.module.importedConstantBindings, c?.module.module.globalEnumMembers]) if (map?.has(name)) return map.get(name);
    return CONSTANTS[name];
  }
  address(variable) { if(!variable)this.fail('Expression is not addressable'); if(variable.elementOf)return this.elementAddress(variable); this.rawStorageAddress(variable);return null; }
  load(variable) {
    if(variable.nativeArray&&!variable.elementOf)this.fail('Array requires indices: '+variable.name);
    const pin=this.address(variable); const type=key(variable.type);
    this.x.emit(...(type==='byte'?[0x0f,0xb6,0x00]:['integer','boolean'].includes(type)?[0x0f,0xbf,0x00]:[0x8b,0x00]));
    if(type==='string'){this.x.push().call('native:string:copy');this.ownString();}
    this.releaseArrayPin(pin);
  }
  check(type) { type = key(type); if (type === 'boolean') this.x.test().emit(0x0f,0x95,0xc0,0x0f,0xb6,0xc0,0xf7,0xd8); else if (type === 'integer') this.x.compare(-32768).branch('l','error:6').compare(32767).branch('g','error:6'); else if (type === 'byte') this.x.compare(255).branch('g','error:6').compare(0).branch('l','error:6'); }
  store(variable) {
    if(key(variable.type)==='string'){
      if(variable.fixedLength){this.x.emit(0x89,0xc3).push(variable.fixedLength).emit(0x53).call('native:string:fixed');this.ownString();}
      this.x.push();const pin=this.address(variable);this.x.push().call('native:string:assign');this.releaseArrayPin(pin);return;
    }
    this.check(variable.type); this.x.push(); const pin=this.address(variable); this.x.emit(0x5a); const type = key(variable.type); this.x.emit(...(type === 'byte' ? [0x88,0x10] : ['integer','boolean'].includes(type) ? [0x66,0x89,0x10] : [0x89,0x10])); this.x.emit(0x89,0xd0);this.releaseArrayPin(pin); }
  object(node) {
    if (node.kind === 'id') { if (key(node.name) === 'me') return this.context?.module.form ? this.context.module : null; return this.context?.module.controls.get(key(node.name)) || (this.modules.get(key(node.name))?.form ? this.modules.get(key(node.name)) : null); }
    if (node.kind === 'member' && node.object.kind === 'id') return this.modules.get(key(node.object.name))?.controls.get(key(node.name));
    return null;
  }
  ensure(object) { const form = object.form ? object : object.module; this.x.call(form.create); }
  handle(object) { this.ensure(object); this.x.value(mem(object.handle)); }
  type(node) {
    if (node.kind === 'group') return this.type(node.expr);
    const errorProperty=this.errorProperty(node);if(errorProperty)return errorProperty==='number'?'long':'string';
    const variable=this.variable(node);if(variable)return key(variable.type);
    if(node.kind==='call'){
      const name=node.callee.kind==='id'?key(node.callee.name).replace(/\$$/,''):'';
      if(['cstr','left','right','mid','chrw'].includes(name))return 'string';
      const proc=this.resolveProcedure(node.callee);if(proc?.proc?.kind==='function')return key(proc.proc.returnType);
    }
    if(node.kind==='id'){const proc=this.resolveProcedure(node);if(proc?.proc?.kind==='function')return key(proc.proc.returnType);}
    if (node.kind === 'id' && key(node.name)==='caption' && this.context?.module.form && !this.variable(node)) return 'string';
    if (node.kind === 'literal') return typeof node.value === 'string' ? 'string' : 'long';
    const constant = this.constant(node); if (constant !== undefined) return typeof constant === 'string' ? 'string' : 'long';
    if (node.kind==='binary' && (node.op==='&' || node.op==='+' && this.type(node.left)==='string' && this.type(node.right)==='string')) return 'string';
    if (node.kind === 'member' && ['caption','text'].includes(key(node.name)) && this.object(node.object)) return 'string';
    if (node.kind === 'call' && node.callee.kind === 'id' && key(node.callee.name) === 'cstr') return 'string';
    return 'long';
  }
  numeric(node) { if (this.type(node) === 'string') this.fail('Use CLng/CInt explicitly to convert native text to a number'); this.expression(node); }
  textExpression(node) { this.expression(node); if(this.type(node)!=='string'){this.x.push().call('native:string:from-int');this.ownString();}this.stringPointer(); }
  expression(node) {
    if (!node) this.fail('Missing expression'); const x = this.x;
    if (node.kind === 'group') return this.expression(node.expr);
    if (node.kind === 'unary' && node.op === '-' && node.expr?.kind === 'literal' && node.expr.value === 2147483648) { x.value(-2147483648); return; }
    if (node.kind === 'literal') { if (typeof node.value === 'string') x.value(this.string(node.value)); else if (typeof node.value === 'boolean') x.value(node.value ? -1 : 0); else if (Number.isInteger(node.value) && node.value >= -2147483648 && node.value <= 2147483647) x.value(node.value); else this.fail('Native AOT currently requires signed 32-bit integer or string-literal values'); return; }
    const constant = this.constant(node); if (constant !== undefined) return this.expression(lit(constant));
    const variable = this.variable(node); if (variable) return this.load(variable);
    if(this.errorExpression(node))return;
    if (node.kind === 'member') return this.getProperty(this.object(node.object),key(node.name));
    if (node.kind === 'id') { if (this.context?.module.form && ['caption','hwnd','visible','enabled','windowstate','scalewidth','scaleheight'].includes(key(node.name))) return this.getProperty(this.context.module,key(node.name)); return this.call({kind:'call',callee:node,args:[]}); }
    if (node.kind === 'call') return this.call(node);
    if (node.kind === 'unary') {
      this.numeric(node.value ?? node.expr ?? node.operand); if (node.op === '-') x.emit(0xf7,0xd8).branch('o','error:6'); else if (key(node.op) === 'not') x.emit(0xf7,0xd0); else if (node.op !== '+') this.fail('Unsupported native unary operator: ' + node.op); return;
    }
    if (node.kind !== 'binary') this.fail('Unsupported native expression: ' + node.kind);
    const op = key(node.op);
    if (op === '&' || op==='+' && this.type(node.left)==='string' && this.type(node.right)==='string') {
      this.textExpression(node.left);x.push();this.textExpression(node.right);x.emit(0x5b).push().emit(0x53).call('native:string:concat');this.ownString();return;
    }
    if (this.type(node.left) === 'string' || this.type(node.right) === 'string') {
      if (!Object.hasOwn(BOOL_CONDITIONS,op) || this.type(node.left) !== this.type(node.right)) this.fail('Unsupported native string operation: ' + op);
      if (this.context.module.module.optionCompare !== 'binary') this.fail('Native strings currently require Option Compare Binary');
      this.expression(node.left); x.push(); this.expression(node.right); x.emit(0x5b).push().emit(0x53).call('native:string:compare').compare(0); this.boolean(op); return;
    }
    this.numeric(node.left); x.push(); this.numeric(node.right); x.emit(0x89,0xc1,0x58);
    if (op === '+') x.emit(0x01,0xc8).branch('o','error:6');
    else if (op === '-') x.emit(0x29,0xc8).branch('o','error:6');
    else if (op === '*') x.emit(0x0f,0xaf,0xc1).branch('o','error:6');
    else if (op === '\\' || op === 'mod') { const safe = x.unique(); x.emit(0x85,0xc9).branch('e','error:11').compare(-2147483648).branch('ne',safe).emit(0x83,0xf9,0xff).branch('e','error:6').label(safe).emit(0x99,0xf7,0xf9); if (op === 'mod') x.emit(0x89,0xd0); }
    else if (op === 'and') x.emit(0x21,0xc8); else if (op === 'or') x.emit(0x09,0xc8); else if (op === 'xor') x.emit(0x31,0xc8);
    else if (op === 'eqv') x.emit(0x31,0xc8,0xf7,0xd0); else if (op === 'imp') x.emit(0xf7,0xd0,0x09,0xc8);
    else if (Object.hasOwn(BOOL_CONDITIONS,op)) { x.emit(0x39,0xc8); this.boolean(op); }
    else this.fail('Native operator is not lowered: ' + op);
  }
  boolean(op) { this.x.emit(0x0f,BOOL_CONDITIONS[op],0xc0,0x0f,0xb6,0xc0,0xf7,0xd8); }
  getProperty(object, property) {
    if (!object) this.fail('Unknown native object'); const x = this.x;
    if (property === 'hwnd') { if (object.model?.type === 'Timer') this.fail('Timer has no hWnd'); this.handle(object); return; }
    if (['text','caption'].includes(property)) {
      if (object.model?.type === 'Timer') this.fail('Timer has no text');
      const buffer = this.buffer(); this.handle(object); x.push().invoke('user32.dll','GetWindowTextLengthW').compare(4095).branch('g','error:7');
      x.api('user32.dll','GetWindowTextW',[mem(object.handle),buffer,4096]).push(buffer).invoke('oleaut32.dll','SysAllocString').test().branch('e','error:7');this.ownString(); return;
    }
    if (property === 'enabled' || property === 'visible') { if (object.model?.type === 'Timer') { if (property !== 'enabled') this.fail('Timer has no Visible property'); x.value(mem(object.enabled)); } else { this.handle(object); x.push().invoke('user32.dll',property === 'enabled' ? 'IsWindowEnabled' : 'IsWindowVisible').emit(0xf7,0xd8); } return; }
    if (property === 'interval' && object.model?.type === 'Timer') { x.value(mem(object.interval)); return; }
    if (property === 'value' && ['CheckBox','OptionButton'].includes(object.model?.type)) { this.ensure(object); x.api('user32.dll','SendMessageW',[mem(object.handle),0xf0,0,0]); if (object.model.type === 'OptionButton') x.emit(0xf7,0xd8); return; }
    if (['listindex','listcount'].includes(property) && ['ListBox','ComboBox'].includes(object.model?.type)) { this.ensure(object); const combo = object.model.type === 'ComboBox'; x.api('user32.dll','SendMessageW',[mem(object.handle),property === 'listindex' ? combo ? 0x147 : 0x188 : combo ? 0x146 : 0x18b,0,0]); return; }
    if (property === 'windowstate' && object.form) { const done = x.unique(), normal = x.unique(); this.ensure(object); x.api('user32.dll','IsIconic',[mem(object.handle)]).test().branch('e',normal).value(1).jump(done).label(normal).api('user32.dll','IsZoomed',[mem(object.handle)]).emit(0xd1,0xe0).label(done); return; }
    if (['scalewidth','scaleheight'].includes(property) && object.form) { this.ensure(object); x.api('user32.dll','GetClientRect',[mem(object.handle),object.rect]).value({memory:object.rect,addend:property === 'scalewidth' ? 8 : 12}); if(Number(object.form.properties.ScaleMode ?? 1)===1)x.emit(0x6b,0xc0,15); return; }
    this.fail('Native property is not lowered: ' + property);
  }
  setProperty(object, property, expr) {
    if (!object) this.fail('Unknown native assignment target'); const x = this.x;
    this.ensure(object);
    if (['text','caption'].includes(property) && object.model?.type !== 'Timer') { this.textExpression(expr); x.push().push(mem(object.handle)).invoke('user32.dll','SetWindowTextW'); return; }
    if (property === 'enabled' && object.model?.type === 'Timer' || property === 'interval' && object.model?.type === 'Timer') { this.numeric(expr); if (property === 'enabled') this.check('Boolean'); else x.compare(0).branch('l','error:5').compare(65535).branch('g','error:5'); x.store(property === 'enabled' ? object.enabled : object.interval); this.timer(object); return; }
    if (['enabled','visible'].includes(property)) { this.numeric(expr); this.check('Boolean'); x.emit(0xf7,0xd8); if (property === 'visible') x.emit(0x6b,0xc0,5); x.push().push(mem(object.handle)).invoke('user32.dll',property === 'enabled' ? 'EnableWindow' : 'ShowWindow'); return; }
    if (property === 'windowstate' && object.form) { const normal = x.unique(), minimize = x.unique(), done = x.unique(); this.numeric(expr); x.compare(0).branch('e',normal).compare(1).branch('e',minimize).compare(2).branch('ne','error:5').value(3).jump(done).label(minimize).value(6).jump(done).label(normal).value(9).label(done).push().push(mem(object.handle)).invoke('user32.dll','ShowWindow'); return; }
    if (property === 'value' && ['CheckBox','OptionButton'].includes(object.model?.type)) { this.numeric(expr); if (object.model.type === 'OptionButton') { this.check('Boolean'); x.emit(0xf7,0xd8); } x.compare(0).branch('l','error:5').compare(2).branch('g','error:5'); x.emit(0x89,0xc3).push(0).emit(0x53).push(0xf1).push(mem(object.handle)).invoke('user32.dll','SendMessageW'); return; }
    if (property === 'listindex' && ['ListBox','ComboBox'].includes(object.model?.type)) { this.numeric(expr); x.emit(0x89,0xc3).push(0).emit(0x53).push(object.model.type === 'ComboBox' ? 0x14e : 0x186).push(mem(object.handle)).invoke('user32.dll','SendMessageW'); return; }
    this.fail('Native assignment is not lowered: ' + property);
  }
  resolveProcedure(callee) {
    const current = this.context?.module;
    if (callee.kind === 'member' && callee.object.kind === 'id') {
      const m = this.modules.get(key(callee.object.name)) || (key(callee.object.name) === 'me' ? current : null);
      const target = m?.procedures.get(key(callee.name)) || m?.externals.get(key(callee.name));
      if(target && m!==current && (target.proc || target).scope!=='public')this.fail('Private native procedure is not accessible: '+callee.name);
      return target;
    }
    if (callee.kind !== 'id') return null;
    const name = key(callee.name), own = current?.procedures.get(name) || current?.externals.get(name); if (own) return own;
    const candidates = [...this.modules.values()].flatMap(m => [...m.procedures.values(),...m.externals.values()].filter(p => key((p.proc || p).name) === name && (p.proc || p).scope === 'public'));
    if (candidates.length > 1) this.fail('Ambiguous native procedure: ' + callee.name); return candidates[0];
  }
  call(node) {
    const x = this.x, args = node.args, name = node.callee.kind === 'id' ? key(node.callee.name).replace(/\$$/,'') : null;
    if(this.errorCall(node))return;
    if(this.stringBuiltin(node,name))return;
    if(name==='lbound'||name==='ubound'){this.arrayBoundCall(node,name==='ubound');return;}
    if (name === 'msgbox') {
      if (args.length < 1 || args.length > 3) this.fail('MsgBox expects one to three arguments');
      this.textExpression(args[0]); x.push(); this.numeric(args[1] || lit(0)); x.push(); this.textExpression(args[2] || lit(this.project.name)); x.emit(0x89,0xc2,0x59,0x5b,0x51,0x52,0x53).push(this.context.module.form ? mem(this.context.module.handle) : 0).invoke('user32.dll','MessageBoxW'); return;
    }
    if (['clng','cint','cbyte','cbool'].includes(name)) {
      if (args.length !== 1) this.fail(name + ' expects one argument');
      if (this.type(args[0]) === 'string') { const out = this.slot(x.unique('conversion')); this.expression(args[0]);x.push().call('native:string:numeric-text'); x.emit(0x89,0xc3).push(out).push(0).push(0x400).emit(0x53).invoke('oleaut32.dll','VarI4FromStr').compare(0x8002000a).branch('e','error:6').test().branch('s','error:13').value(mem(out)); } else this.numeric(args[0]);
      this.check({clng:'Long',cint:'Integer',cbyte:'Byte',cbool:'Boolean'}[name]); return;
    }
    if (name === 'cstr') { if (args.length !== 1) this.fail('CStr expects one argument'); this.textExpression(args[0]); return; }
    if (name === 'len') { if (args.length !== 1 || this.type(args[0]) !== 'string') this.fail('Native Len requires text'); this.expression(args[0]); x.push().invoke('kernel32.dll','lstrlenW'); return; }
    if (name === 'strptr') { if (args.length !== 1 || this.type(args[0]) !== 'string') this.fail('StrPtr requires text'); this.expression(args[0]); return; }
    if (name === 'abs' || name === 'sgn') { if (args.length !== 1) this.fail(name + ' expects one argument'); this.numeric(args[0]); const done = x.unique(); if (name === 'abs') x.test().branch('ns',done).emit(0xf7,0xd8).branch('o','error:6').label(done); else { x.emit(0x99,0x85,0xc0,0x0f,0x95,0xc0,0x0f,0xb6,0xc0,0x09,0xd0); } return; }
    if (name === 'beep') { if (args.length) this.fail('Beep takes no arguments'); x.api('user32.dll','MessageBeep',[0]); return; }
    if (node.callee.kind === 'member') {
      const object = this.object(node.callee.object), method = key(node.callee.name);
      if (object) {
        if (['show','hide','setfocus','additem','clear','removeitem'].includes(method)) this.ensure(object);
        if (method === 'show' && object.form) {
          if(args.length>2)this.fail('Native Show expects mode and optional owner');
          this.numeric(args[0] || lit(0));x.push();
          if(args[1]){const owner=this.object(args[1]);if(!owner?.form)this.fail('Native Show owner must be a form');this.handle(owner);}else x.api('user32.dll','GetActiveWindow');
          x.emit(0x59,0x50,0x51).call('show:'+object.name);return;
        }
        if (method === 'hide' && object.form && !args.length) { x.api('user32.dll','ShowWindow',[mem(object.handle),0]); return; }
        if (method === 'setfocus' && !args.length) { x.api('user32.dll','SetFocus',[mem(object.handle)]); return; }
        if (['ListBox','ComboBox'].includes(object.model?.type)) {
          const combo = object.model.type === 'ComboBox';
          if (method === 'additem' && args.length === 1) { this.textExpression(args[0]); x.push().push(0).push(combo ? 0x143 : 0x180).push(mem(object.handle)).invoke('user32.dll','SendMessageW').test().branch('s','error:7'); return; }
          if (method === 'clear' && !args.length) { x.api('user32.dll','SendMessageW',[mem(object.handle),combo ? 0x14b : 0x184,0,0]); return; }
          if (method === 'removeitem' && args.length === 1) { this.numeric(args[0]); x.emit(0x89,0xc3).push(0).emit(0x53).push(combo ? 0x144 : 0x182).push(mem(object.handle)).invoke('user32.dll','SendMessageW').test().branch('s','error:5'); return; }
        }
      }
    }
    const target = this.resolveProcedure(node.callee);
    if (!target) this.fail('Native procedure is not available: ' + (name || node.callee.name));
    const signature = target.proc || target;
    if (args.length !== signature.params.length) this.fail('Native call argument count mismatch: ' + signature.name);
    if(target.module?.form && target.module!==this.context.module)x.call(target.module.initialize);
    const callPins=[];
    for (let i = 0; i < args.length; i++) {
      const param = signature.params[i];
      if (param.bounds !== null && param.bounds !== undefined) {
        const array=this.variable(args[i]);
        if(!target.proc || !param.byRef || !array?.nativeArray || array.elementOf || key(array.type)!==key(param.type))this.fail('ByRef array argument must have the exact declared element type');
        if(array.fixedLength)this.fail('Fixed-length String whole-array arguments are not yet lowered');
        this.rawStorageAddress(array);
      } else if (param.byRef) { if(args[i].kind==='group') this.fail('Parenthesized ByRef temporaries are not yet lowered'); const v = this.variable(args[i]); if (!v || v.nativeArray&&!v.elementOf || key(v.type) !== key(param.type)) this.fail('ByRef native argument must be a scalar of the exact declared type');if(v.fixedLength)this.fail('Fixed-length String ByRef copy-back is not yet lowered');const pin=this.address(v);if(pin)callPins.push(pin); }
      else { if(key(param.type)==='string')this.textExpression(args[i]);else {this.numeric(args[i]);this.check(param.type);} }
      x.push();
    }
    // VB evaluates arguments left-to-right; reverse only their stack slots for stdcall.
    for (let i = 0; i < Math.floor(args.length / 2); i++) { const a = i * 4, b = (args.length - i - 1) * 4; x.emit(0x8b,0x84,0x24).imm(a).emit(0x8b,0x8c,0x24).imm(b).emit(0x89,0x8c,0x24).imm(a).emit(0x89,0x84,0x24).imm(b); }
    if (target.proc) {x.call(target.label);this.checkNativeError();for(const pin of callPins)this.releaseArrayPin(pin);if(key(signature.returnType)==='string'&&signature.kind==='function')this.ownString();} else { x.invoke(target.dll,target.symbol);for(const pin of callPins)this.releaseArrayPin(pin); if (['integer','boolean'].includes(key(signature.returnType))) x.emit(0x0f,0xbf,0xc0); else if (key(signature.returnType) === 'byte') x.emit(0x0f,0xb6,0xc0); }
  }
  procedure(context) {
    this.context = context; const outer=this.x, body=new BinarySection('.body',0), x=this.x=new X86(body,this.image), code=context.proc.code, end=context.label+':return';
    // Lower first so temporary text buffers are stack-local, including recursive calls.
    x.sequence=outer.sequence;context.stringTemps=[];context.arrayPins=[];
    for (let i = 0; i < code.length; i++) {
      const ins = this.instruction = code[i]; x.label(context.label + ':' + i).call(context.label+':clear-strings');this.errorCheckpoint(context,i,ins);
      this.sourceMap.push({symbol:context.label + ':' + i,source:ins.source,line:ins.line,procedure:ins.procedure});
      if(this.errorInstruction(ins,context))continue;
      if (ins.op === 'dim') { for (const decl of ins.decls) if (!decl.constant && decl.initial) { this.storageExpression(context.locals.get(key(decl.name)),decl.initial); this.store(context.locals.get(key(decl.name))); } }
      else if (ins.op === 'assign') {
        if (ins.objectSet) this.fail('Native object assignment is not lowered');
        const variable = this.variable(ins.target);
        if (variable?.nativeArray && !variable.elementOf) this.assignArrayStorage(variable,ins.expr);
        else if (variable) { this.storageExpression(variable,ins.expr); this.store(variable); }
        else if (ins.target.kind === 'member') this.setProperty(this.object(ins.target.object),key(ins.target.name),ins.expr);
        else if (ins.target.kind === 'id' && context.module.form) this.setProperty(context.module,key(ins.target.name),ins.expr);
        else this.fail('Unknown native variable: ' + (ins.target.name || ins.target.kind));
      }
      else if(ins.op==='redim'){for(const decl of ins.decls)this.redimArrayStorage(decl,ins.preserve);}
      else if(ins.op==='erase'){for(const expr of ins.exprs)this.eraseStorage(expr);}
      else if (ins.op === 'expr') this.expression(ins.expr);
      else if (ins.op === 'branch') { this.numeric(ins.test); x.test().branch('e',context.label + ':' + ins.target); }
      else if (ins.op === 'jump') x.jump(context.label + ':' + ins.target);
      else if (ins.op === 'return') {if(!ins.implicit)x.call('native:error:clear');x.jump(end);}
      else if (ins.op === 'lineNumber') { /* Debug metadata remains in the map. */ }
      else if (ins.op === 'end') x.api('kernel32.dll','ExitProcess',[0]);
      else if (ins.op === 'form') {
        const object = this.object(ins.expr); if (!object?.form) this.fail('Native Load/Unload requires a form');
        if (ins.action === 'load') this.ensure(object);
        else if (ins.action === 'unload') { const done = x.unique(); x.value(mem(object.handle)).test().branch('e',done).api('user32.dll','SendMessageW',[mem(object.handle),0x10,1,0]).label(done); }
        else this.fail('Unsupported native form operation');
      }
      else if (ins.op === 'forInit') {
        const loop = context.loops.get(ins.id), variable = this.variable({kind:'id',name:ins.name}); if (!variable) this.fail('Undeclared native For variable: ' + ins.name);
        this.numeric(ins.start); this.store(variable); this.numeric(ins.end); this.store(loop.endVariable); this.numeric(ins.step); this.store(loop.stepVariable); this.forTest(loop,variable,context.label + ':' + ins.target);
      }
      else if (ins.op === 'forNext') {
        const loop = context.loops.get(ins.id), variable = this.variable({kind:'id',name:loop.name});
        this.load(variable); x.push(); this.load(loop.stepVariable); x.emit(0x59,0x01,0xc8).branch('o','error:6'); this.store(variable);
        const done = x.unique(); this.forTest(loop,variable,done); x.jump(context.label + ':' + ins.target).label(done);
      }
      else if(ins.op==='temp'){const variable=context.temporaries.get(ins.id);variable.type=this.type(ins.expr);this.storageExpression(variable,ins.expr);this.store(variable);}
      else if(ins.op==='case'){
        const yes=x.unique(),variable=context.temporaries.get(ins.id);if(!variable)this.fail('Invalid native Select Case');
        const compare=(op,right)=>this.expression({kind:'binary',op,left:{kind:'id',name:variable.name},right});
        for(const item of ins.cases){
          if(item.kind==='value'||item.kind==='compare'){compare(item.kind==='value'?'=':item.op,item.expr);x.test().branch('ne',yes);}
          else if(item.kind==='range'){const next=x.unique();compare('>=',item.low);x.test().branch('e',next);compare('<=',item.high);x.test().branch('ne',yes).label(next);}
          else this.fail('Native Case expression is not lowered');
        }
        x.jump(context.label+':'+ins.target).label(yes);
      }
      else this.fail('Native instruction is not yet lowered: ' + ins.op);
    }
    x.label(context.label + ':' + code.length).label(end);
    if(context.returnValue&&key(context.returnValue.type)==='string'){
      this.rawStorageAddress(context.returnValue);x.emit(0x8b,0x00);x.push();this.rawStorageAddress(context.returnValue);x.emit(0xc7,0x00,0,0,0,0,0x58);
    }else if(context.returnValue)this.load(context.returnValue);else x.value(0);
    const cleanup=context.label+':cleanup';x.jump(cleanup);
    x.label(context.label+':error-return').value(0);
    x.label(cleanup).push().call(context.label+':clear-strings');
    for(const variable of context.locals.values())if(!variable.label&&!variable.parameter){if(variable.nativeArray)this.destroyArrayStorage(variable);else if(key(variable.type)==='string')this.clearStringStorage(variable);}
    x.emit(0x58);this.leaveErrorFrame();x.leave(context.proc.params.length*4);
    this.emitErrorDispatch(context);
    x.label(context.label+':clear-strings');for(const pin of context.arrayPins)this.releaseArrayPin(pin);for(const variable of context.stringTemps)this.clearStringStorage(variable);x.emit(0xc3);
    this.instruction=null;this.x=outer;outer.sequence=x.sequence;outer.label(context.label).enter(context.size);
    for(const variable of [...context.locals.values(),...context.stringTemps,...context.arrayPins])if(!variable.parameter&&!variable.label)this.zeroStorage(variable);
    this.enterErrorFrame(context);
    for(const variable of context.locals.values())if(variable.ownedParameter){
      outer.value({argument:variable.incomingOffset}).push().call('native:string:copy').emit(0x89,0x85).imm(variable.offset);
    }
    for(const variable of context.locals.values()){
      if(!variable.label || variable.nativeArray)this.initializeFixedString(variable);
      else if(variable.fixedLength){const done=outer.unique();outer.value(mem(variable.initialized)).test().branch('ne',done);this.initializeFixedString(variable);outer.value(1).store(variable.initialized).label(done);}
    }
    const base=this.text.length;for(const [name,offset]of body.labels){if(this.text.labels.has(name))this.fail('Duplicate native label');this.text.labels.set(name,base+offset);}
    for(const fixup of body.fixups)this.text.fixups.push({...fixup,offset:base+fixup.offset});
    for(const byte of body.bytes)this.text.bytes.push(byte);
  }
  forTest(loop,variable,exit) {
    const negative = this.x.unique(), done = this.x.unique(); this.load(loop.stepVariable); this.x.test().branch('s',negative);
    this.load(variable); this.x.push(); this.load(loop.endVariable); this.x.emit(0x59,0x39,0xc1).branch('g',exit).jump(done).label(negative);
    this.load(variable); this.x.push(); this.load(loop.endVariable); this.x.emit(0x59,0x39,0xc1).branch('l',exit).label(done);
  }
  handler(module, name, args = []) {
    const proc = module.procedures.get(key(name)); if (!proc) return;
    if(proc.proc.kind!=='sub') this.fail('Native event handler must be a Sub: '+name,module);
    if (proc.proc.params.length !== args.length) this.fail('Native event signature mismatch: ' + name,module);
    args.forEach((arg,i) => { const param = proc.proc.params[i]; if (arg.ref && (!param.byRef || key(param.type) !== 'integer')) this.fail('Native event requires ByRef Integer: ' + param.name,module); });
    for (const arg of [...args].reverse()) { if (arg.ref) this.x.local(arg.ref).push(); else this.x.push(arg); }
    this.x.call(proc.label);this.checkNativeError('native:error:fatal');
  }
  timer(control) {
    const x = this.x, skip = x.unique(); x.api('user32.dll','KillTimer',[mem(control.module.handle),control.id]);
    x.value(mem(control.enabled)).test().branch('e',skip).value(mem(control.interval)).test().branch('e',skip);
    x.api('user32.dll','SetTimer',[mem(control.module.handle),control.id,mem(control.interval),0]).test().branch('e','error:7').label(skip);
  }
  formStyle(module) {
    const p = module.form.properties, border = Number(p.BorderStyle ?? 2);
    if (![0,1,2,3,4,5].includes(border)) this.fail('Invalid native BorderStyle',module);
    if (border === 0) return 0x80000000;
    let style = 0xc00000;
    if (p.ControlBox !== 0) style |= 0x80000;
    if ([2,5].includes(border)) style |= 0x40000;
    if ([1,2].includes(border) && p.MinButton !== 0) style |= 0x20000;
    if (border === 2 && p.MaxButton !== 0) style |= 0x10000;
    return style | 0x02000000;
  }
  controls(module) {
    const x = this.x;
    const depth = control => {let count=0,parent=control.model.parent;while(parent){const p=module.controls.get(key(parent));if(!p||p.model.type!=='Frame'||++count>16)this.fail('Native controls currently nest only in Frames without cycles',module);parent=p.model.parent;}return count;};
    // Build containers before their children while preserving stable control IDs.
    const ordered=[...module.controls.values()].sort((a,b)=>depth(a)-depth(b));
    for (const control of ordered) {
      const model = control.model, p = model.properties;
      if (model.type === 'Timer') { this.timer(control); continue; }
      let style = 0x40000000 | (p.Visible === 0 ? 0 : 0x10000000) | (p.Enabled === 0 ? 0x08000000 : 0) | (p.TabStop === 0 ? 0 : 0x10000), ex = 0;
      if (model.type === 'TextBox') { ex = 0x200; style |= p.MultiLine ? 0x4 | 0x40 | 0x1000 : 0x80; if (p.Locked) style |= 0x800; if (p.PasswordChar) style |= 0x20; if (p.ScrollBars === 1 || p.ScrollBars === 3) style |= 0x100000; if (p.ScrollBars >= 2) style |= 0x200000; }
      if (model.type === 'CommandButton') style |= p.Default ? 1 : 0;
      if (model.type === 'Label') style = style & ~0x10000 | 0x100;
      if (model.type === 'CheckBox') style |= p.TripleState ? 6 : 3;
      if (model.type === 'OptionButton') style |= 9;
      if (model.type === 'Frame') style = style & ~0x10000 | 7 | 0x02000000;
      if (model.type === 'ListBox') { ex = 0x200; style |= 1 | 0x200000 | (p.Sorted ? 2 : 0); if (p.MultiSelect) this.fail('Native multi-selection ListBox is not lowered',module); }
      if (model.type === 'ComboBox') style |= 0x200000 | ([1,2].includes(Number(p.Style)) ? p.Style === 1 ? 1 : 3 : 2) | (p.Sorted ? 0x100 : 0);
      const left = Number(p.Left || 0), top = Number(p.Top || 0), parent = model.parent ? module.controls.get(key(model.parent)) : module;
      const width = this.pixels(p.Width ?? 1440), height = this.pixels(p.Height ?? 420) + (model.type === 'ComboBox' && p.Style !== 1 ? 160 : 0);
      x.api('user32.dll','CreateWindowExW',[ex,this.string(CLASSES[model.type]),this.string(p.Text ?? p.Caption ?? ''),style,this.pixels(left),this.pixels(top),width,height,mem(parent.handle),control.id,mem('instance'),0]).test().branch('e','error:7').store(control.handle);
      if (model.type === 'Frame') x.api('user32.dll','SetWindowLongW',[mem(control.handle),-4,'frame-procedure:'+module.name+':'+model.name]).test().branch('e','error:7').store(control.oldProcedure);
      x.api('gdi32.dll','GetStockObject',[17]).emit(0x89,0xc3).push(1).emit(0x53).push(0x30).push(mem(control.handle)).invoke('user32.dll','SendMessageW');
      if (model.type === 'TextBox' && p.MaxLength) x.api('user32.dll','SendMessageW',[mem(control.handle),0xc5,Number(p.MaxLength),0]);
      if (['CheckBox','OptionButton'].includes(model.type)) x.api('user32.dll','SendMessageW',[mem(control.handle),0xf1,p.Value ? 1 : 0,0]);
      if (['ListBox','ComboBox'].includes(model.type)) {
        for (const item of p.List || []) x.api('user32.dll','SendMessageW',[mem(control.handle),model.type === 'ListBox' ? 0x180 : 0x143,0,this.string(item)]);
        if (p.ListIndex !== undefined) x.api('user32.dll','SendMessageW',[mem(control.handle),model.type === 'ListBox' ? 0x186 : 0x14e,Number(p.ListIndex),0]);
      }
    }
  }
  pixels(value) { const n = Number(value) / 15; if (!Number.isFinite(n) || n < -32768 || n > 32767) this.fail('Native geometry is outside the supported range'); return Math.round(n); }
  menus(module) {
    const menus = module.form.menus || []; if (!menus.length) return;
    const x = this.x, used = new Set(); let next = 10000; module.menuCommands = new Map();
    const roots = menus.filter(m => !m.parent);
    const build = (items,handle,depth) => {
      if (depth > 16) this.fail('Native menu nesting limit exceeded',module);
      for (const menu of items) {
        if (used.has(key(menu.name))) this.fail('Duplicate or cyclic native menu',module); used.add(key(menu.name));
        if (menu.properties.Visible === 0) continue;
        let flags = (menu.properties.Enabled === 0 ? 1 : 0) | (menu.properties.Checked ? 8 : 0);
        const children = menus.filter(m => key(m.parent) === key(menu.name));
        if (children.length || menu.properties.WindowList) { const child = this.slot('menu:' + module.name + ':' + menu.name); x.api('user32.dll','CreatePopupMenu').test().branch('e','error:7').store(child); build(children,child,depth + 1); if (menu.properties.WindowList) module.windowMenu = child; x.api('user32.dll','AppendMenuW',[mem(handle),flags | 0x10,mem(child),this.string(menu.properties.Caption || menu.name)]); }
        else if (menu.properties.Caption === '-') x.api('user32.dll','AppendMenuW',[mem(handle),0x800,0,0]);
        else { const id = next++; if (next > 20000) this.fail('Native menu item limit exceeded',module); module.menuCommands.set(id,menu.name + '_Click'); x.api('user32.dll','AppendMenuW',[mem(handle),flags,id,this.string(menu.properties.Caption || menu.name)]); }
      }
    };
    x.api('user32.dll','CreateMenu').test().branch('e','error:7').store(module.menu); build(roots,module.menu,0);
    if (used.size < menus.filter(m => m.properties.Visible !== 0).length) this.fail('Unreachable or cyclic native menus',module);
  }
  form(module) {
    const x = this.x, prefix = module.form.type === 'MDIForm' ? 'MDIForm_' : 'Form_', p = module.form.properties;
    const done = x.unique(), wnd = 'wndproc:' + module.name, wc = 'wndclass:' + module.name;
    const style = this.formStyle(module), ex = Number(p.BorderStyle) >= 4 ? 0x80 : 0;
    this.data.align(4).label(wc).u32(3).reference(wnd).u32(0).u32(0).u32(0).u32(0).u32(0).u32(16).u32(0).reference(module.className);
    module.wc = wc;
    const initialized=x.unique();
    // Initialize a default form instance once, before window creation. Reentrant UI
    // access from Form_Initialize can load that form without recursively firing Initialize.
    x.label(module.initialize).enter().value(mem(module.initialized)).test().branch('ne',initialized).value(1).store(module.initialized);
    for (const variable of module.globals.values()) {
      this.context = {module,proc:{},locals:new Map()};if(variable.nativeArray)this.destroyArrayStorage(variable);else if(key(variable.type)==='string')this.clearStringStorage(variable);else this.zeroStorage(variable);this.initializeFixedString(variable);if(variable.initial){this.storageExpression(variable,variable.initial);this.store(variable);}
    }
    this.handler(module,prefix + 'Initialize');
    x.label(initialized).value(0).leave();
    x.label(module.create).enter().call(module.initialize).value(mem(module.handle)).test().branch('ne',done);
    this.menus(module);
    const width = this.pixels(p.ClientWidth ?? p.Width ?? 9000), height = this.pixels(p.ClientHeight ?? p.Height ?? 6000);
    x.value(0).store(module.rect).store(module.rect,4).value(width).store(module.rect,8).value(height).store(module.rect,12);
    x.api('user32.dll','AdjustWindowRectEx',[module.rect,style,module.form.menus?.length ? 1 : 0,ex]);
    if (p.MDIChild) {
      x.call(this.mdi.create);
      x.api('user32.dll','CreateMDIWindowW',[module.className,this.string(p.Caption || module.name),style,this.pixels(p.Left || 0),this.pixels(p.Top || 0),width,height,mem(this.mdi.client),mem('instance'),0]);
    } else {
      // AdjustWindowRectEx produces outer dimensions without assuming a title-bar height.
      x.value({memory:module.rect,addend:8}).emit(0x2b,0x05).addr(module.rect).emit(0x89,0xc6);
      x.value({memory:module.rect,addend:12}).emit(0x2b,0x05).addr(module.rect,4).emit(0x89,0xc7);
      x.push(0).push(mem('instance')).push(mem(module.menu)).push(0).emit(0x57,0x56);
      const position = Number(p.StartUpPosition) === 0;
      x.push(position ? this.pixels(p.Top || 0) : -2147483648).push(position ? this.pixels(p.Left || 0) : -2147483648).push(style).push(this.string(p.Caption || module.name)).push(module.className).push(ex).invoke('user32.dll','CreateWindowExW');
    }
    x.test().branch('e','error:7').store(module.handle);
    x.emit(0xff,0x05).addr('live-forms');
    if (module.form.type === 'MDIForm') {
      const clientInfo = this.slot('client-create:' + module.name,0); this.data.u32(30000); if (module.windowMenu) x.value(mem(module.windowMenu)).store(clientInfo);
      x.api('user32.dll','CreateWindowExW',[0,this.string('MDICLIENT'),this.string(''),0x50300000,0,0,width,height,mem(module.handle),1,mem('instance'),clientInfo]).test().branch('e','error:7').store(module.client);
    }
    this.controls(module); x.value(1).store(module.loaded); this.handler(module,prefix + 'Load');
    x.label(done).value(mem(module.handle)).leave();
    for(const control of module.controls.values())if(control.oldProcedure){
      const forward=x.unique();
      x.label('frame-procedure:'+module.name+':'+control.model.name).enter().value({argument:12}).compare(0x111).branch('e',forward);
      x.api('user32.dll','CallWindowProcW',[mem(control.oldProcedure),{argument:8},{argument:12},{argument:16},{argument:20}]).leave(16);
      x.label(forward).api('user32.dll','SendMessageW',[mem(module.handle),{argument:12},{argument:16},{argument:20}]).leave(16);
    }
    this.windowProcedure(module,wnd,prefix); this.showProcedure(module);
  }
  showProcedure(module) {
    const x=this.x, done=x.unique(), modeless=x.unique(), loop=x.unique(), finish=x.unique(), dispatch=x.unique(), interrupted=x.unique();
    const others=[...this.modules.values()].filter(m=>m.form&&m!==module);
    const saved=others.map((m,i)=>({module:m,hwnd:-40-i*8,enabled:-44-i*8}));
    const oldOwner=-48-others.length*8;
    x.label('show:'+module.name).enter(56+others.length*8);
    x.value({argument:8}).compare(0).branch('e',modeless).compare(1).branch('ne','error:5');
    if(module.form.properties.MDIChild)x.jump('error:5');
    // A nested message loop retains the caller's stack, VM-equivalent modal blocking.
    // Record HWND identity and enabled state so a recreated form is never modified on return.
    for(const item of saved){
      x.value(mem(item.module.handle)).emit(0x89,0x85).imm(item.hwnd).push().invoke('user32.dll','IsWindowEnabled').emit(0x89,0x85).imm(item.enabled);
      x.api('user32.dll','EnableWindow',[mem(item.module.handle),0]);
    }
    x.api('user32.dll','SetWindowLongW',[mem(module.handle),-8,{argument:12}]).emit(0x89,0x85).imm(oldOwner);
    x.api('user32.dll','ShowWindow',[mem(module.handle),5]).api('user32.dll','UpdateWindow',[mem(module.handle)]);
    x.label(loop).value(mem(module.handle)).test().branch('e',finish).push().invoke('user32.dll','IsWindowVisible').test().branch('e',finish);
    x.push(0).push(0).push(0).local(-32).push().invoke('user32.dll','GetMessageW').test().branch('e',interrupted).branch('s','error:5');
    x.local(-32).push().push(mem(module.handle)).invoke('user32.dll','IsDialogMessageW').test().branch('ne',loop);
    x.local(-32).push().invoke('user32.dll','TranslateMessage');x.local(-32).push().invoke('user32.dll','DispatchMessageW').jump(loop);
    x.label(interrupted).api('user32.dll','PostQuitMessage',[0]);
    x.label(finish);
    for(const item of saved){const skip=x.unique();x.value({argument:item.hwnd}).test().branch('e',skip).emit(0x3b,0x05).addr(item.module.handle).branch('ne',skip);x.api('user32.dll','EnableWindow',[{argument:item.hwnd},{argument:item.enabled}]).label(skip);}
    const noWindow=x.unique();x.value(mem(module.handle)).test().branch('e',noWindow).api('user32.dll','SetWindowLongW',[mem(module.handle),-8,{argument:oldOwner}]).label(noWindow);
    x.api('user32.dll','SetActiveWindow',[{argument:12}]).jump(done);
    x.label(modeless).api('user32.dll','ShowWindow',[mem(module.handle),5]).api('user32.dll','UpdateWindow',[mem(module.handle)]);
    x.label(done).value(0).leave(8);
  }
  windowProcedure(module,wnd,prefix) {
    const x = this.x, fallback = x.unique(), zero = x.unique(), exit = x.unique(), close = x.unique(), destroy = x.unique(), command = x.unique(), timer = x.unique(), size = x.unique(), focus = x.unique();
    x.label(wnd).enter(12);this.enterCallbackBoundary(-12);
    x.value({argument:12}).compare(2).branch('e',destroy).compare(0x10).branch('e',close);
    x.value(mem(module.loaded)).test().branch('e',fallback);
    x.value({argument:12}).compare(0x111).branch('e',command).compare(0x113).branch('e',timer).compare(5).branch('e',size).compare(6).branch('e',focus).jump(fallback);
    x.label(command).value({argument:16}).emit(0x89,0xc3,0x25).imm(65535);
    for (const control of module.controls.values()) {
      if (control.model.type === 'Timer') continue;
      const next = x.unique(); x.compare(control.id).branch('ne',next).emit(0xc1,0xeb,16);
      const events = control.model.type === 'TextBox' ? [[0x300,'Change']] : control.model.type === 'ComboBox' ? [[1,'Click'],[5,'Change']] : control.model.type === 'ListBox' ? [[1,'Click'],[2,'DblClick']] : [[0,'Click'],[1,'DblClick']];
      for (const [code,event] of events) { const another = x.unique(); x.emit(0x83,0xfb,code & 255); if (code > 127) { // Replace sign-extended short comparison with imm32.
          this.text.bytes.splice(this.text.bytes.length - 3,3); x.emit(0x81,0xfb).imm(code);
        } x.branch('ne',another); this.handler(module,control.model.name + '_' + event); x.jump(zero).label(another); }
      x.jump(fallback).label(next);
    }
    for (const [id,event] of module.menuCommands || []) { const next = x.unique(); x.compare(id).branch('ne',next); this.handler(module,event); x.jump(zero).label(next); }
    x.jump(fallback);
    x.label(timer).value({argument:16});
    for (const control of module.controls.values()) if (control.model.type === 'Timer') { const next = x.unique(); x.compare(control.id).branch('ne',next); this.handler(module,control.model.name + '_Timer'); x.jump(zero).label(next); }
    x.jump(fallback);
    x.label(size);
    if (module.form.type === 'MDIForm') {
      x.api('user32.dll','GetClientRect',[{argument:8},module.rect]);
      x.api('user32.dll','MoveWindow',[mem(module.client),0,0,{memory:module.rect,addend:8},{memory:module.rect,addend:12},1]);
    }
    this.handler(module,prefix + 'Resize'); x.jump(fallback);
    x.label(focus).value({argument:16}).emit(0x25).imm(65535).test(); const deactivate = x.unique(); x.branch('e',deactivate); this.handler(module,prefix + 'Activate'); x.jump(fallback).label(deactivate); this.handler(module,prefix + 'Deactivate'); x.jump(fallback);
    x.label(close).value(mem(module.loaded)).test().branch('e',fallback).value(0).emit(0x89,0x45,0xfc).value({argument:16}).emit(0x89,0x45,0xf8);
    this.handler(module,prefix + 'QueryUnload',[{ref:-4},{ref:-8}]); x.emit(0x83,0x7d,0xfc,0).branch('ne',zero);
    if(module.form.type==='MDIForm')for(const child of this.modules.values())if(child.form?.properties.MDIChild){
      const skip=x.unique();x.value(mem(child.handle)).test().branch('e',skip).api('user32.dll','SendMessageW',[mem(child.handle),0x10,2,0]);x.value(mem(child.handle)).test().branch('ne',zero).label(skip);
    }
    this.handler(module,prefix + 'Unload',[{ref:-4}]); x.emit(0x83,0x7d,0xfc,0).branch('ne',zero);
    if(module.form.properties.MDIChild)x.api('user32.dll','SendMessageW',[mem(this.mdi.client),0x221,{argument:8},0]);else x.api('user32.dll','DestroyWindow',[{argument:8}]);x.jump(zero);
    x.label(destroy).value(mem(module.handle)).test().branch('e',zero).value(0).store(module.handle).store(module.loaded).store(module.initialized).store(module.client).store(module.menu);
    for (const control of module.controls.values()) x.store(control.handle);
    x.emit(0xff,0x0d).addr('live-forms').value(mem('live-forms')).test().branch('ne',zero).api('user32.dll','PostQuitMessage',[0]).jump(zero);
    x.label(fallback);
    if (module.form.type === 'MDIForm') x.api('user32.dll','DefFrameProcW',[{argument:8},mem(module.client),{argument:12},{argument:16},{argument:20}]);
    else x.api('user32.dll',module.form.properties.MDIChild ? 'DefMDIChildProcW' : 'DefWindowProcW',[{argument:8},{argument:12},{argument:16},{argument:20}]);
    x.jump(exit).label(zero).value(0).label(exit);this.leaveCallbackBoundary(-12);x.leave(16);
  }
  helpers() {
    const x = this.x;
    emitNativeStorageHelpers(this);
    emitNativeArrayHelpers(this);
    // int-to-string(value, buffer), including INT_MIN without signed negation overflow.
    const positive = x.unique(), digits = x.unique(), copy = x.unique(), done = x.unique();
    x.label('int-to-string').enter(64).value({argument:8}).emit(0x89,0xc3).value({argument:12}).emit(0x89,0xc7,0x89,0xd8,0x85,0xc0).branch('ns',positive);
    x.emit(0x66,0xc7,0x07,45,0,0x83,0xc7,2,0xf7,0xd8);
    x.label(positive).local(-2).emit(0x89,0xc6,0x89,0xd8,0x85,0xc0); const magnitude = x.unique(); x.branch('ns',magnitude).emit(0xf7,0xd8).label(magnitude).emit(0x31,0xdb);
    x.label(digits).emit(0x31,0xd2,0xb9).imm(10).emit(0xf7,0xf1,0x80,0xc2,48,0x66,0x89,0x16,0x83,0xee,2,0x43,0x85,0xc0).branch('ne',digits);
    x.label(copy).emit(0x83,0xc6,2,0x66,0x8b,0x06,0x66,0x89,0x07,0x83,0xc7,2,0x4b).branch('ne',copy).emit(0x66,0xc7,0x07,0,0).value({argument:12}).leave(8);
    emitNativeErrorHelpers(this);
  }
  build() {
    for (const module of this.modules.values()) for (const proc of module.procedures.values()) this.procedure(proc);
    for (const module of this.modules.values()) if (module.form) this.form(module);
    this.helpers(); this.context = null; this.instruction = null;
    const x = this.x, loop = x.unique(), dispatch = x.unique(), quit = x.unique();
    x.label('entry').api('kernel32.dll','GetModuleHandleW',[0]).store('instance');
    for (const module of this.modules.values()) if (module.form) {
      x.value(mem('instance')).store(module.wc,16).api('user32.dll','LoadCursorW',[0,32512]).store(module.wc,24);
      x.api('user32.dll','RegisterClassW',[module.wc]).test().branch('e','error:7');
    }
    for(const module of this.modules.values())if(!module.form)for(const variable of module.globals.values())this.initializeFixedString(variable);
    for (const module of this.modules.values()) if (!module.form) { this.context = {module,proc:{},locals:new Map()}; for (const variable of module.globals.values()) if (variable.initial) { this.storageExpression(variable,variable.initial); this.store(variable); } }
    if (key(this.project.startup) === 'sub main') {
      const candidates = [...this.modules.values()].filter(m => !m.form).map(m => m.procedures.get('main')).filter(Boolean);
      if (candidates.length !== 1 || candidates[0].proc.params.length) this.fail('Native Sub Main startup must be unique and parameterless'); x.call(candidates[0].label);this.checkNativeError('native:error:fatal');
    } else {
      const startup = this.modules.get(key(this.project.startup)); if (!startup?.form) this.fail('Native startup form was not found');
      x.call(startup.create).api('user32.dll','ShowWindow',[mem(startup.handle),Number(startup.form.properties.WindowState) === 2 ? 3 : Number(startup.form.properties.WindowState) === 1 ? 6 : 5]);
    }
    x.value(mem('live-forms')).test().branch('e',quit);
    x.label(loop).api('user32.dll','GetMessageW',['msg',0,0,0]).test().branch('e',quit).branch('s','error:5');
    if (this.mdi) x.api('user32.dll','TranslateMDISysAccel',[mem(this.mdi.client),'msg']).test().branch('ne',loop);
    for (const module of this.modules.values()) if (module.form) { const next = x.unique(); x.value(mem(module.handle)).test().branch('e',next).api('user32.dll','IsDialogMessageW',[mem(module.handle),'msg']).test().branch('ne',loop).label(next); }
    x.label(dispatch).api('user32.dll','TranslateMessage',['msg']).api('user32.dll','DispatchMessageW',['msg']).jump(loop).label(quit).api('kernel32.dll','ExitProcess',[0]);
    this.image.manifest('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="x86" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency></assembly>');
    const linked = this.image.finish('entry');
    return {bytes:linked.bytes,report:{target:'win32-aot',architecture:'x86',format:'PE32',extraction:false,runtime:'Win32 system DLLs; no embedded JavaScript engine or VB6 runtime',graphics:'native Windows controls / GDI, not WebGPU',size:linked.bytes.length,imports:linked.imports,sections:linked.sections,sourceMap:this.sourceMap.map(s => ({...s,rva:linked.symbols[s.symbol]})),limits:['Typed integer/String storage, fixed/dynamic arrays and error recovery; unsupported VB constructs fail compilation.','Native controls use Windows theme/font metrics, not pixel-identical VB6 styling.','WebGPU remains a separate Electron target.']}};
  }
}
Object.assign(NativeCompiler.prototype,nativeStorageMethods,nativeErrorMethods,nativeArrayMethods);
function compileWin32(project, options = {}) {
  if (options.graphics && options.graphics !== 'gdi') throw new NativeCompileError('The freestanding Win32 target uses native controls/GDI; use the desktop target for WebGPU');
  if (options.arch && options.arch !== 'x86') throw new NativeCompileError('The freestanding compiler currently emits x86 PE32');
  if (!project || !Array.isArray(project.modules) || project.modules.length > 128) throw new NativeCompileError('Native project must contain at most 128 modules');
  return new NativeCompiler(project).build();
}

return {NativeCompileError,extractNativeDeclarations,compileWin32};
})();

/* entry.js */
__modules[27]=(()=>{
const {compileWin32, NativeCompileError, extractNativeDeclarations}=__modules[26];
const {PE32Image, BinarySection, PE32_BASE}=__modules[21];
const {X86}=__modules[22];
/** Standalone browser/worker SDK: no Node, DOM, compiler service or binary template. */




return {compileWin32,NativeCompileError,extractNativeDeclarations,PE32Image,BinarySection,PE32_BASE,X86};
})();
globalThis["VB6Native"]=__modules[27];
})();