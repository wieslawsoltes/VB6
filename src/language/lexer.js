import {asDate} from '../runtime/calendar.js';
/** VB lexical scanner. Tokens retain original source offsets for editor/debugger use. */
import {VBError} from './errors.js';
export {VBError};
export function tokenize(text) {
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
export function splitTop(text, separator = ',') {
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
export function logicalLines(source) {
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
