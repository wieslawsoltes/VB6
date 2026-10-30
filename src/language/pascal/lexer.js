import {VBError} from '../errors.js';

export class PascalError extends VBError {
  constructor(message, token = {}, source = null, code = 'TP_SYNTAX') {
    super(message, 1002, source, token.line || 1, token.column || 1);
    this.name = 'PascalError';
    this.code = code;
    this.endLine = token.endLine || this.line;
    this.endColumn = token.endColumn || this.column + 1;
  }
}

export const PASCAL_KEYWORDS = new Set(('absolute and array asm assembler begin case const constructor destructor div do downto else end external far file for forward function goto if implementation in inherited inline interface interrupt label mod near nil not object of or packed private procedure program public record repeat set shl shr string then to type unit until uses var virtual while with xor').split(' '));

/** A lossless UTF-16 scanner. Comments/directives retain their physical spans so
 * IDE consumers can rename symbols without rewriting strings or comments. */
export function tokenizePascal(source, {sourceName = null, tolerant = false, maxTokens = 250000} = {}) {
  source = String(source ?? '');
  const tokens = [], comments = [], directives = [], diagnostics = [];
  let offset = 0, line = 1, column = 1;
  const location = () => ({start: offset, line, column});
  const advance = () => {
    const c = source[offset++];
    if (c === '\r') {if (source[offset] === '\n') offset++; line++; column = 1;}
    else if (c === '\n') {line++; column = 1;}
    else column++;
    return c;
  };
  const span = start => ({...start, end: offset, endLine: line, endColumn: column});
  const report = (message, start, code = 'TP_LEXICAL') => {
    const error = new PascalError(message, span(start), sourceName, code);
    if (!tolerant) throw error;
    diagnostics.push({severity: 'error', message, number: error.number, code, source: sourceName, ...span(start)});
  };
  const add = (type, value, start) => {
    const raw = source.slice(start.start, offset);
    tokens.push({type, value, lower: typeof value === 'string' ? value.toLowerCase() : String(value), raw, ...span(start)});
    if (tokens.length > maxTokens) throw new PascalError('Pascal token limit exceeded', span(start), sourceName, 'TP_LIMIT');
  };
  while (offset < source.length) {
    const c = source[offset], next = source[offset + 1], start = location();
    if (/\s/.test(c) || offset === 0 && c === '\uFEFF') {advance(); continue;}
    if (c === '{' || c === '(' && next === '*') {
      const closing = c === '{' ? '}' : '*)';
      advance(); if (c === '(') advance();
      const contentStart = offset;
      while (offset < source.length && !source.startsWith(closing, offset)) advance();
      const contentEnd = offset;
      if (offset === source.length) report('Unterminated Pascal comment', start);
      else for (let i = 0; i < closing.length; i++) advance();
      const content = source.slice(contentStart, contentEnd);
      const token = {type: content.startsWith('$') ? 'directive' : 'comment', value: content, raw: source.slice(start.start, offset), ...span(start)};
      comments.push(token); if (token.type === 'directive') directives.push(token);
      continue;
    }
    if (c === '/' && next === '/') {
      while (offset < source.length && !/[\r\n]/.test(source[offset])) advance();
      comments.push({type: 'comment', raw: source.slice(start.start, offset), ...span(start)}); continue;
    }
    if (c === "'") {
      advance(); let value = '', closed = false;
      while (offset < source.length && !/[\r\n]/.test(source[offset])) {
        const character = advance();
        if (character === "'") {if (source[offset] === "'") {advance(); value += "'";} else {closed = true; break;}}
        else value += character;
      }
      if (!closed) report('Unterminated Pascal string literal', start);
      add('string', value, start); continue;
    }
    if (c === '#' || c === '$' || /[0-9]/.test(c)) {
      let radix = 10, character = false;
      if (c === '#') {character = true; advance();}
      if (source[offset] === '$') {radix = 16; advance();}
      const digitsStart = offset;
      while (offset < source.length && (radix === 16 ? /[0-9a-f]/i : /[0-9]/).test(source[offset])) advance();
      if (digitsStart === offset) {report(character ? 'Expected ordinal after #' : 'Expected hexadecimal digits after $', start); add(character ? 'charCode' : 'number', 0, start); continue;}
      if (radix === 10 && !character) {
        if (source[offset] === '.' && source[offset + 1] !== '.') {advance(); while (/[0-9]/.test(source[offset] || 'x')) advance();}
        if (/[eE]/.test(source[offset] || 'x')) {
          advance(); if (/[+-]/.test(source[offset] || 'x')) advance();
          const exponentStart = offset; while (/[0-9]/.test(source[offset] || 'x')) advance();
          if (exponentStart === offset) report('Expected exponent digits', start);
        }
      }
      const numericText = source.slice(digitsStart, offset), value = radix === 16 ? parseInt(numericText, 16) : Number(numericText);
      if (!Number.isFinite(value)) report('Numeric literal is outside the supported finite range', start);
      if (character && (!Number.isInteger(value) || value < 0 || value > 255)) report('Character ordinal must be between 0 and 255 in Turbo Pascal 7', start);
      add(character ? 'charCode' : 'number', value, start); continue;
    }
    if (/[A-Za-z_\u0080-\uFFFF]/.test(c)) {
      advance(); while (offset < source.length && /[A-Za-z_0-9\u0080-\uFFFF]/.test(source[offset])) advance();
      add('id', source.slice(start.start, offset), start); continue;
    }
    if ([':=', '<=', '>=', '<>', '..', '(.', '.)'].includes(c + next)) {advance(); advance(); add('symbol', c + next === '(.' ? '[' : c + next === '.)' ? ']' : c + next, start); continue;}
    if ('+-*/=<>[]().,;:^@'.includes(c)) {advance(); add('symbol', c, start); continue;}
    advance(); report(`Unexpected character '${c}'`, start); if (tolerant) add('invalid', c, start);
  }
  const end = location(); add('eof', '', end);
  Object.defineProperties(tokens, {comments: {value: comments}, directives: {value: directives}, diagnostics: {value: diagnostics}});
  return tokens;
}
