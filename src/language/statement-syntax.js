import {findKeyword, scanSyntax, isKeyword} from './source-scanner.js';
import {VBError} from './errors.js';

/** The Then delimiter is a keyword token, never text within a literal/member. */
export function parseIfHeader(text) {
  const first = /^(If|ElseIf)\b/i.exec(text);
  if (!first) return null;
  const then = findKeyword(text, 'then', first[0].length);
  if (!then) throw new VBError('Expected Then', 1002);
  const condition = text.slice(first[0].length, then.start).trim();
  if (!condition) throw new VBError('Expected If condition', 1002);
  const tail = text.slice(then.end), leading = tail.length - tail.trimStart().length;
  return {condition, body: tail.trim(), bodyStart: then.end + leading};
}

/** An Else binds to the closest preceding unmatched inline If. */
export function inlineElse(text) {
  let depth = 0, nested = 0, first = true, previous = '', result = null;
  scanSyntax(text, token => {
    if (token.kind === 'op' && token.value === '(') depth++;
    else if (token.kind === 'op' && token.value === ')') depth--;
    if (depth === 0) {
      const keyword = token.kind === 'id' && previous !== '.' && previous !== '!';
      if (first && isKeyword(token, 'if')) nested++;
      if (keyword && isKeyword(token, 'else')) {
        if (!nested) { result = token; return false; }
        nested--;
      }
      first = token.kind === 'op' && token.value === ':' || keyword && (isKeyword(token, 'then') || isKeyword(token, 'else'));
    }
    previous = token.value;
  });
  return result;
}
