/** Tolerant VB lexical context. Offsets always refer to the original UTF-16
 * buffer, including CRLF and explicit continuations; no code is evaluated. */
export const IDENTIFIER = '(?:\\[[^\\]\\r\\n]+\\]|[A-Za-z_\\u0080-\\uffff][\\w\\u0080-\\uffff]*[$%&!#@]?)';
export const TYPE_NAME = IDENTIFIER + '(?:\\s*\\.\\s*' + IDENTIFIER + ')*';
export const symbolKey = value => String(value || '').replace(/\[([^\]]+)\]/g, '$1').replace(/[$%&!#@]$/, '').toLowerCase();
export const typeSuffix = Object.freeze({'%':'Integer','&':'Long','!':'Single','#':'Double','@':'Currency','$':'String'});

export function lexicalContext(source) {
  source = String(source || '');
  const chars = source.split('');
  let state = 'code', statementStart = true, bracket = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\n' || c === '\r') { state = 'code'; bracket = false; statementStart = true; continue; }
    if (state === 'comment') { chars[i] = ' '; continue; }
    if (state === 'string') {
      chars[i] = ' ';
      if (c === '"') {
        if (source[i + 1] === '"') chars[++i] = ' ';
        else state = 'code';
      }
      continue;
    }
    if (state === 'date') { chars[i] = ' '; if (c === '#') state = 'code'; continue; }
    if (bracket) { if (c === ']') bracket = false; continue; }
    if (c === '[') { bracket = true; statementStart = false; continue; }
    if (c === "'" || statementStart && /^Rem(?=\s|$)/i.test(source.slice(i, i + 4))) {
      state = 'comment'; chars[i] = ' '; continue;
    }
    if (c === '"') { state = 'string'; chars[i] = ' '; statementStart = false; continue; }
    // A type suffix/file channel/directive is not a date delimiter. An open
    // date literal is masked too, so incomplete typing cannot trigger a list.
    if (c === '#' && !/[\w\u0080-\uffff\]]/.test(source[i - 1] || '') &&
        !/^\s*#(?:If|ElseIf|Else|End|Const)\b/i.test(source.slice(source.lastIndexOf('\n', i - 1) + 1, i + 10))) {
      const tail = source.slice(i + 1).split(/[\r\n]/, 1)[0];
      if (tail.includes('#') || /^\s*\d+[/:-]/.test(tail)) { state = 'date'; chars[i] = ' '; statementStart = false; continue; }
    }
    if (c === ':' && source[i + 1] !== '=') statementStart = true;
    else if (!/\s/.test(c)) statementStart = false;
  }
  return {masked: chars.join(''), state, bracket};
}
export const maskSource = source => lexicalContext(source).masked;

export function splitArguments(source, keepEmpty = false) {
  const masked = maskSource(source), result = [];
  let depth = 0, bracket = false, start = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '[') bracket = true;
    else if (c === ']') bracket = false;
    if (bracket) continue;
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && !depth) { result.push(source.slice(start, i).trim()); start = i + 1; }
  }
  if (keepEmpty || source.slice(start).trim()) result.push(source.slice(start).trim());
  return result;
}

/** Split colon statements and continuations once per module revision. */
export function sourceStatements(source) {
  const masked = maskSource(source), statements = [];
  let start = 0, line = 1, firstLine = 1, bracket = false;
  const add = end => {
    const text = source.slice(start, end).replace(/[ \t]+_[ \t]*\r?\n/g, ' ');
    const clean = masked.slice(start, end).replace(/[ \t]+_[ \t]*\r?\n/g, ' ');
    if (clean.trim()) statements.push({text, clean, line:firstLine, endLine:line, start, end});
  };
  for (let i = 0; i < source.length; i++) {
    const c = masked[i];
    if (c === '[') bracket = true;
    else if (c === ']') bracket = false;
    if (c === '\n') {
      const continued = /[ \t]_[ \t]*\r?$/.test(masked.slice(start, i));
      if (!continued) { add(i); start = i + 1; firstLine = line + 1; }
      line++; bracket = false;
    } else if (c === ':' && !bracket && masked[i + 1] !== '=') {
      add(i); start = i + 1; firstLine = line;
    }
  }
  add(source.length);
  return {masked, statements, lineCount:line};
}

export function statementBefore(text, offset = text.length) {
  offset = Math.max(0, Math.min(text.length, offset));
  let start = text.lastIndexOf('\n', offset - 1) + 1;
  while (start > 0) {
    const previous = text.lastIndexOf('\n', start - 2) + 1;
    if (!/[ \t]_[ \t]*\r?$/.test(maskSource(text.slice(previous, start - 1)))) break;
    start = previous;
  }
  const original = text.slice(start, offset), context = lexicalContext(original);
  let last = 0, bracket = false;
  for (let i = 0; i < context.masked.length; i++) {
    const c = context.masked[i];
    if (c === '[') bracket = true;
    else if (c === ']') bracket = false;
    else if (!bracket && c === ':' && context.masked[i + 1] !== '=') last = i + 1;
  }
  return {start:start + last, text:original.slice(last), masked:context.masked.slice(last).replace(/_([ \t]*\r?\n)/g, ' $1'), state:context.state};
}

/** Complete access expression ending at `end`, including indexed/call results.
 * Operators and statement keywords to its left are deliberately excluded. */
export function expressionBefore(text, end = text.length) {
  const statement = statementBefore(text, end), base = statement.start;
  text = statement.text; end = text.length;
  const masked = statement.masked; let i = end - 1, depth = 0, bracket = false;
  while (i >= 0 && /\s/.test(masked[i])) i--;
  const stop = i + 1;
  for (; i >= 0; i--) {
    const c = masked[i];
    if (c === ']') bracket = true;
    if (bracket) { if (c === '[') bracket = false; continue; }
    if (c === ')') { depth++; continue; }
    if (c === '(') { if (!depth) break; depth--; continue; }
    if (depth) continue;
    if (/\s/.test(c)) {
      const left = masked.slice(0, i).trimEnd().at(-1), right = masked.slice(i + 1, stop).trimStart()[0];
      if (left === '.' || right === '.' || right === '(') continue;
      break;
    }
    if (!/[\w\u0080-\uffff.$%&!#@]/.test(c)) break;
  }
  return {start:base + i + 1, end:base + stop, text:text.slice(i + 1, stop).trim()};
}

export function wordAt(text, offset) {
  offset = Math.max(0, Math.min(text.length, offset));
  let end = offset;
  while (end < text.length && /[\w\u0080-\uffff$%&!#@\]]/.test(text[end])) end++;
  const word = expressionBefore(text, end);
  return word;
}

export function completionSpan(text, offset) {
  const before = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset), prefix = before.match(/(?:\[[^\]\r\n]*|[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*[$%&!#@]?)$/)?.[0] || '';
  let end = offset;
  while (end < text.length && /[\w\u0080-\uffff$%&!#@]/.test(text[end])) end++;
  if (prefix.startsWith('[') && text[end] === ']') end++;
  return {start:offset - prefix.length, end, prefix};
}
