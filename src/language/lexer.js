import {isDigit,isIdentifierStart,isIdentifierPart,isSpace,identifierEnd,stringEnd,dateEnd,scanSyntax,stripComment,statementParts} from './source-scanner.js';
import {asDate} from '../runtime/calendar.js';
/** VB lexical scanner. Tokens retain original source offsets for editor/debugger use. */
import {VBError} from './errors.js';
export {VBError};
export function tokenize(text) {
  const out = []; let i = 0;
  const push = (type, value, start, raw = text.slice(start, i)) => out.push({type, value, start, end: i, raw});
  while (i < text.length) {
    const start = i, c = text[i];
    if (isSpace(text.charCodeAt(i))) { i++; continue; }
    if (c === "'") break;
    if (c === '"') {
      const end = stringEnd(text, i);
      if (end < 0) throw new VBError('Expected closing quotation mark', 1002, null, 0, start + 1);
      i = end; push('string', text.slice(start + 1, end - 1).replace(/""/g, '"'), start); continue;
    }
    if (c === '#' && dateEnd(text, i) >= 0) {
      const end = dateEnd(text, i); i = end; const d = asDate(text.slice(start + 1, end - 1));
      if (isNaN(d)) throw new VBError('Invalid date literal', 13, null, 0, start + 1);
      push('date', d.toISOString(), start); continue;
    }
    if (c === '&' && /[hHoO]/.test(text[i+1] || '')) {
      const base = text[i+1].toLowerCase() === 'h' ? 16 : 8; i += 2; const digits = i;
      while (i < text.length && (base === 16 ? /[0-9a-f]/i : /[0-7]/).test(text[i])) i++;
      if (i === digits) throw new VBError('Expected digits in numeric literal', 1002);
      let n = parseInt(text.slice(digits, i), base); if (n > 2147483647) n -= 4294967296;
      if (text[i] === '&') i++; push('number', n, start); continue;
    }
    if (isDigit(text.charCodeAt(i)) || (c === '.' && isDigit(text.charCodeAt(i+1)))) {
      if (c === '.') i++;
      while (isDigit(text.charCodeAt(i))) i++;
      if (text[i] === '.' && c !== '.') { i++; while (isDigit(text.charCodeAt(i))) i++; }
      if (/[eEdD]/.test(text[i] || '\0')) {
        i++; if (text[i] === '+' || text[i] === '-') i++;
        const digits = i; while (isDigit(text.charCodeAt(i))) i++;
        if (digits === i) throw new VBError('Expected exponent digits', 1002, null, 0, i + 1);
      }
      const raw = text.slice(start, i), n = Number(raw.replace(/[dD]/, 'e'));
      if (!Number.isFinite(n)) throw new VBError('Overflow in numeric literal', 6, null, 0, start + 1);
      if (/[%&!#@]/.test(text[i] || '\0')) i++;
      push('number', n, start); continue;
    }
    if (isIdentifierStart(text.charCodeAt(i)) || c === '[') {
      let name;
      if (c === '[') { const end = text.indexOf(']', i); if (end < 0) throw new VBError('Expected ]', 1002); name = text.slice(i+1, end); i = end+1; }
      else { i = identifierEnd(text, i); name = text.slice(start,i); }
      if (c !== '[' && name.toLowerCase() === 'rem' && (!out.length || out.at(-1).value === ':')) break;
      if (!name) throw new VBError('Expected identifier', 1002, null, 0, start + 1);
      push('id', name, start); continue;
    }
    const pair = text.slice(i,i+2);
    if (['<=','>=','<>',':='].includes(pair)) { i += 2; push('op', pair, start); continue; }
    if ('+-*/\\^&=<>(),.;:#!'.includes(c)) { i++; push('op',c,start); continue; }
    throw new VBError(`Unexpected character '${c}'`, 1002, null, 0, start + 1);
  }
  out.push({type:'eof',value:'<eof>',start:i,end:i,raw:''}); return out;
}
export function splitTop(text, separator = ',') {
  const result = []; let start = 0, depth = 0;
  const end = scanSyntax(text, token => {
    if (token.kind !== 'op') return;
    if (token.value === '(') depth++;
    else if (token.value === ')') depth--;
    else if (token.value === separator && depth === 0) { result.push(text.slice(start, token.start).trim()); start = token.end; }
  });
  result.push(text.slice(start, end).trim()); return result;
}
export function logicalLines(source) {
  const out=[]; let carry='', lineStart=0;
  const physical=String(source).replace(/\r\n?/g,'\n').split('\n');
  for (let index=0; index<physical.length; index++) {
    const raw=physical[index]; if (!carry) lineStart=index+1;
    let s=stripComment(raw);
    // Only a lexical underscore after whitespace is a continuation, never one
    // inside a string, bracketed identifier, or comment.
    if (/\s_\s*$/.test(s)) { carry += s.replace(/\s_\s*$/,' '); continue; }
    s=(carry+s).trim();carry='';if(!s)continue;
    const numbered=s.match(/^(\d+)(?=\s|:|$)\s*:?\s*/);
    if(numbered){out.push({text:numbered[1],line:lineStart,label:true});s=s.slice(numbered[0].length);if(!s)continue;}
    const named=s.match(/^(\[[^\]]+\]|[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)\s*:(?!=)\s*/);
    if(named){out.push({text:named[1].replace(/^\[|\]$/g,''),line:lineStart,label:true});s=s.slice(named[0].length);if(!s)continue;}
    for(const part of statementParts(s))out.push({text:part.text,line:lineStart});
  }
  if(carry)throw new VBError('Unfinished line continuation',1002,null,lineStart);
  return out;
}
