import {VBDecimal,VBCurrency} from '../runtime/values.js';
import {assertData} from './common.js';
import {sqlTokens} from './sql-parameters.js';

export function compareData(a,b){
  if(a==null||b==null)return null;
  if(a instanceof VBDecimal||b instanceof VBDecimal){
    // Integer criteria represented by safe Numbers must not take the fifteen-digit Double-to-Decimal conversion path.
    const exact=value=>value instanceof VBCurrency?new VBDecimal(value.toString()):Number.isSafeInteger(value)?VBDecimal.fromParts(BigInt(value),0):new VBDecimal(value);
    return exact(a).compare(exact(b));
  }
  if(a instanceof VBCurrency&&b instanceof VBCurrency)return a.raw<b.raw?-1:a.raw>b.raw?1:0;
  if(a instanceof Date)a=+a;if(b instanceof Date)b=+b;
  if(typeof a==='string'&&typeof b==='string'){a=a.toLocaleLowerCase('en-US');b=b.toLocaleLowerCase('en-US');}
  if(a instanceof Uint8Array||b instanceof Uint8Array){assertData(a instanceof Uint8Array&&b instanceof Uint8Array,'Incompatible binary comparison',13);for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return Math.sign(a.length-b.length);}
  return a<b?-1:a>b?1:0;
}
function wildcard(pattern){
  pattern=String(pattern).toLocaleLowerCase('en-US');assertData(pattern.length<=4096,'LIKE pattern length limit exceeded',7);
  const tokens=[];
  for(let i=0;i<pattern.length;i++){
    const c=pattern[i];if(c==='*'){if(tokens.at(-1)!=='*')tokens.push('*');}
    else if(c==='?')tokens.push(()=>true);else if(c==='#')tokens.push(c=>c>='0'&&c<='9');
    else if(c==='['){const end=pattern.indexOf(']',i+1);assertData(end>i+1,'Invalid LIKE character class',3001);let chars=pattern.slice(i+1,end),not=chars[0]==='!';if(not)chars=chars.slice(1);assertData(chars.length,'Empty LIKE class',3001);const ranges=[];
      for(let n=0;n<chars.length;n++){if(n+2<chars.length&&chars[n+1]==='-'){assertData(chars[n]<=chars[n+2],'Invalid LIKE character range',3001);ranges.push([chars[n],chars[n+2]]);n+=2;}else ranges.push([chars[n],chars[n]]);}
      tokens.push(c=>ranges.some(([a,b])=>c>=a&&c<=b)!==not);i=end;
    }else tokens.push(v=>v===c);
  }
  // Bounded glob matching; patterns never become a backtracking regular expression.
  return value=>{const text=String(value).toLocaleLowerCase('en-US');let at=0,p=0,star=-1,retry=0,work=0;
    while(at<text.length){assertData(++work<=2000000,'LIKE matching work limit exceeded',7);if(tokens[p]==='*'){star=p++;retry=at;}
      else if(typeof tokens[p]==='function'&&tokens[p](text[at])){p++;at++;}
      else if(star>=0){p=star+1;at=++retry;}else return false;}
    while(tokens[p]==='*')p++;return p===tokens.length;};
}
/** Bounded, no-eval DAO criteria with SQL null logic and explicit boolean precedence. */
export function compileCriteria(text,columns){
  text=String(text);assertData(text.length<=16384,'Criteria length limit exceeded',7);if(!text.trim())return()=>true;
  // Access date literals are tokenized separately without treating strings/comments as code.
  const dates=[];text=text.replace(/'(?:(?:'')|[^'])*'|#([^#]+)#/g,(all,date)=>{if(date===undefined)return all;const stamp=Date.parse(date);assertData(Number.isFinite(stamp),'Invalid date literal',13);dates.push(new Date(stamp));return '__DAO_DATE_'+(dates.length-1);});
  const tokens=sqlTokens(text);assertData(tokens.length<=2048,'Criteria token limit exceeded',7);let at=0,depth=0;
  const is=value=>tokens[at]?.value.toUpperCase()===value,take=()=>tokens[at++],eat=value=>is(value)?(at++,true):false;
  const expect=value=>assertData(eat(value),'Expected '+value+' in criteria',3001);
  const value=()=>{let sign=1;if(eat('-'))sign=-1;else eat('+');const t=take();assertData(t,'Expected a criteria value');
    if(t.kind==='number'){const n=Number(t.value)*sign;assertData(Number.isFinite(n),'Invalid numeric criterion',13);const exact=!Number.isSafeInteger(n)&&/^\d+$/.test(t.value)?new VBDecimal((sign<0?'-':'')+t.value):n;return()=>exact;}
    assertData(sign===1,'A sign requires a numeric literal');if(t.kind==='string')return()=>t.value;
    if(t.kind==='word'&&/^(TRUE|FALSE|NULL)$/i.test(t.value))return()=>t.value.toUpperCase()==='NULL'?null:t.value.toUpperCase()==='TRUE'?-1:0;
    if(t.kind==='word'&&/^__DAO_DATE_\d+$/.test(t.value)){const d=dates[Number(t.value.slice(11))];assertData(d,'Invalid date reference');return()=>d;}
    assertData(['word','identifier'].includes(t.kind),'Expected a field or literal');const c=columns.find(c=>c.Name.toLowerCase()===t.value.toLowerCase());assertData(c,'Field not found: '+t.value,3265);return row=>row[c.Name];
  };
  const predicate=()=>{if(eat('(')){assertData(++depth<=64,'Criteria nesting limit exceeded',7);const expr=or();expect(')');depth--;return expr;}
    const left=value();if(eat('IS')){const not=eat('NOT');expect('NULL');return row=>(left(row)==null)!==not;}
    const not=eat('NOT');if(eat('LIKE')){const right=value(),cache=new Map();return row=>{const a=left(row),b=right(row);if(a==null||b==null)return null;let match=cache.get(b);if(!match){match=wildcard(b);if(cache.size>=16)cache.clear();cache.set(b,match);}return match(a)!==not;};}
    if(eat('IN')){expect('(');const choices=[value()];while(eat(','))choices.push(value());expect(')');return row=>{const a=left(row);if(a==null)return null;let unknown=false;for(const v of choices){const n=compareData(a,v(row));if(n===0)return !not;if(n===null)unknown=true;}return unknown?null:not;};}
    if(eat('BETWEEN')){const lo=value();expect('AND');const hi=value();return row=>{const a=left(row),l=compareData(a,lo(row)),h=compareData(a,hi(row));return l===null||h===null?null:(l>=0&&h<=0)!==not;};}
    assertData(!not,'NOT must precede LIKE, IN or BETWEEN');const op=take()?.value;assertData(['=','<>','!=','<','>','<=','>='].includes(op),'Expected a comparison operator');const right=value();return row=>{const n=compareData(left(row),right(row));if(n===null)return null;return {'=':n===0,'<>':n!==0,'!=':n!==0,'<':n<0,'>':n>0,'<=':n<=0,'>=':n>=0}[op];};
  };
  const unary=()=>{if(eat('NOT')){assertData(++depth<=64,'Criteria nesting limit exceeded',7);const expr=unary();depth--;return row=>{const v=expr(row);return v==null?null:!v;};}return predicate();};
  const and=()=>{let fn=unary();while(eat('AND')){const left=fn,right=unary();fn=row=>{const a=left(row),b=right(row);return a===false||b===false?false:a==null||b==null?null:true;};}return fn;};
  const or=()=>{let fn=and();while(eat('OR')){const left=fn,right=and();fn=row=>{const a=left(row),b=right(row);return a===true||b===true?true:a==null||b==null?null:false;};}return fn;};
  const compiled=or();assertData(at===tokens.length,'Unexpected trailing criteria');return row=>compiled(row)===true;
}
