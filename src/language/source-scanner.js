/** Shared lexical boundaries for source splitting and statement parsing.
 * This scanner does not evaluate literals, resolve names, or invoke host APIs. */
export const isDigit = c => c >= 48 && c <= 57;
export const isIdentifierStart = c => c === 95 || c >= 65 && c <= 90 || c >= 97 && c <= 122 || c >= 128 && c <= 65535;
export const isIdentifierPart = c => isIdentifierStart(c) || isDigit(c);
export const isSpace = c => c === 32 || c >= 9 && c <= 13 || c > 127 && /\s/u.test(String.fromCharCode(c));
export const isTypeSuffix = c => c === '$' || c === '%' || c === '&' || c === '!' || c === '#' || c === '@';

export function identifierEnd(text, start) {
  let end = start + 1;
  while (isIdentifierPart(text.charCodeAt(end))) end++;
  if (isTypeSuffix(text[end]) && !(text[end] === '!' && (isIdentifierStart(text.charCodeAt(end + 1)) || text[end + 1] === '['))) end++;
  return end;
}

/** Return the exclusive end, or -1 for an unterminated quoted string. */
export function stringEnd(text, start) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '"') { if (text[i + 1] === '"') i++; else return i + 1; }
    if (text[i] === '\n' || text[i] === '\r') return -1;
  }
  return -1;
}

/** A hash can be a Double suffix, file number prefix, or date delimiter.
 * Source splitting must not turn Close #1, #2 into a date literal. */
export function dateEnd(text, start) {
  const end = text.indexOf('#', start + 1);
  if (end < 0) return -1;
  const body = text.slice(start + 1, end);
  if (/[\r\n"'()[\]=;<>]/.test(body) || !/[\d]/.test(body)) return -1;
  // Date literals use numeric separators or month/AM/PM names, not arbitrary
  // statement identifiers between unrelated file-number prefixes.
  if (!/^[\d\s:/.,-]*(?:(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|AM|PM)[\d\s:/.,-]*)*$/i.test(body)) return -1;
  if (!/[/:.-]/.test(body) && !/[a-z]/i.test(body)) return -1;
  return end + 1;
}

/** Walk tokens without interpreting their values. Return the comment offset.
 * Visitor returning false stops the scan. Strings and bracketed identifiers are
 * emitted as opaque spans, so their contents never become statement keywords. */
export function scanSyntax(text, visit) {
  let i = 0, statementStart = true, previous = '';
  while (i < text.length) {
    const start = i, c = text[i], code = text.charCodeAt(i);
    if (isSpace(code)) { i++; continue; }
    if (c === "'") return i;
    let kind = 'op';
    if (c === '"') { kind = 'string'; i = stringEnd(text, i); if (i < 0) i = text.length; }
    else if (c === '[') { kind = 'bracket'; const end = text.indexOf(']', i + 1); i = end < 0 ? text.length : end + 1; }
    else if (isIdentifierStart(code)) { kind = 'id'; i = identifierEnd(text, i); }
    else if (isDigit(code)) { kind = 'number'; i++; while (isDigit(text.charCodeAt(i))) i++; if (isTypeSuffix(text[i])) i++; }
    else if (c === '#' && dateEnd(text, i) >= 0) { kind = 'date'; i = dateEnd(text, i); }
    else { i++; if (c === ':' && text[i] === '=' || (c === '<' || c === '>') && (text[i] === '=' || c === '<' && text[i] === '>')) i++; }
    const value = text.slice(start, i), word = kind === 'id' ? value.toLowerCase() : '';
    if (statementStart && word === 'rem' && (i === text.length || isSpace(text.charCodeAt(i)))) return start;
    if (visit && visit({kind, value, start, end: i}) === false) return i;
    const numbered = statementStart && kind === 'number' && /^\d+$/.test(value) && (i === text.length || isSpace(text.charCodeAt(i)));
    statementStart = value === ':' || numbered || (word === 'then' || word === 'else') && previous !== '.' && previous !== '!';
    previous = value;
  }
  return text.length;
}

export function stripComment(text) { return text.slice(0, scanSyntax(text)); }

export function syntaxTokens(text) { const tokens = []; scanSyntax(text, t => { tokens.push(t); }); return tokens; }
export function isKeyword(token, word) { return token?.kind === 'id' && token.value.toLowerCase() === word; }

/** Find a non-member keyword outside argument/group parentheses. */
export function findKeyword(text, word, from = 0) {
  let depth = 0, previous = '', found = null;
  scanSyntax(text, token => {
    if (token.kind === 'op' && token.value === '(') depth++;
    else if (token.kind === 'op' && token.value === ')') depth--;
    else if (depth === 0 && token.start >= from && previous !== '.' && previous !== '!' && isKeyword(token, word)) { found = token; return false; }
    previous = token.value;
  });
  return found;
}

/** Split statements, retaining an inline If and all of its consequent colons. */
export function statementParts(text) {
  const parts = []; let start = 0, depth = 0, ownsRest = false, first = true;
  scanSyntax(text, token => {
    if (first) { ownsRest = isKeyword(token, 'if'); first = false; }
    if (token.kind !== 'op') return;
    if (token.value === '(') depth++;
    else if (token.value === ')') depth--;
    else if (token.value === ':' && depth === 0 && !ownsRest) {
      const raw = text.slice(start, token.start), leading = raw.length - raw.trimStart().length;
      if (raw.trim()) parts.push({text: raw.trim(), start: start + leading});
      start = token.end; first = true;
    }
  });
  const raw = text.slice(start), leading = raw.length - raw.trimStart().length;
  if (raw.trim()) parts.push({text: raw.trim(), start: start + leading});
  return parts;
}
