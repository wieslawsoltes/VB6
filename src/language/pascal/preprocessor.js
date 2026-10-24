import {PascalError} from './lexer.js';

const normalize = name => String(name).toUpperCase();
const DEFAULT_SWITCHES = Object.freeze({A: true, B: false, D: true, E: true, F: false, G: false, I: true, L: true, N: false, O: false, P: false, Q: false, R: false, S: true, T: false, V: true, X: true});

/** Filter lexical tokens rather than rewriting Pascal source. Inactive branches
 * keep original offsets, and their lexical errors cannot poison active code. */
export function preprocessPascalTokens(tokens, {sourceName = null, defines = [], conditionalConstants = {}, targetSymbols = {}} = {}) {
  const symbols = new Set(['VER70', 'JAVASCRIPT']);
  if (Array.isArray(defines) || defines instanceof Set) for (const name of defines) symbols.add(normalize(name));
  else for (const [name, enabled] of Object.entries(defines || {})) if (enabled !== false && enabled !== null) symbols.add(normalize(name));
  for (const name of Object.keys(conditionalConstants || {})) symbols.add(normalize(name));
  for (const [name, enabled] of Object.entries(targetSymbols || {})) {
    if (enabled === true) symbols.add(normalize(name));
    else if (enabled === false) symbols.delete(normalize(name));
    else throw new TypeError('Pascal target symbols require Boolean values: ' + name);
  }
  const switches = {...DEFAULT_SWITCHES}, stack = [], output = [], retainedDirectives = [], activeRanges = [];
  let active = true, position = 0, directiveIndex = 0;
  const fail = (message, directive) => {throw new PascalError(message, directive, sourceName, 'TP_CONDITIONAL');};
  const directives = tokens.directives;
  const apply = directive => {
    if (active && directive.start > position) activeRanges.push({start: position, end: directive.start});
    const text = directive.value.slice(1).trim(), match = /^([A-Z]+)(?:\s+(.*))?$/i.exec(text), command = match?.[1].toUpperCase(), argument = match?.[2]?.trim() || '';
    if (command === 'IFDEF' || command === 'IFNDEF') {
      if (!/^[A-Z_][A-Z_0-9]*$/i.test(argument)) fail('Conditional directive requires one symbol name', directive);
      const condition = symbols.has(normalize(argument)) === (command === 'IFDEF'); stack.push({parent: active, condition, elseSeen: false, directive}); active = active && condition;
    } else if (command === 'IFOPT') {
      const option = /^([A-Z])([+-])$/i.exec(argument); if (!option || !(option[1].toUpperCase() in switches)) fail('IFOPT requires a known compiler switch and + or -', directive);
      const condition = switches[option[1].toUpperCase()] === (option[2] === '+'); stack.push({parent: active, condition, elseSeen: false, directive}); active = active && condition;
    } else if (command === 'ELSE') {
      const state = stack.at(-1); if (!state || state.elseSeen) fail('ELSE has no matching conditional or is duplicated', directive); state.elseSeen = true; active = state.parent && !state.condition;
    } else if (command === 'ENDIF') {
      const state = stack.pop(); if (!state) fail('ENDIF has no matching conditional', directive); active = state.parent;
    } else if (command === 'DEFINE' || command === 'UNDEF') {
      if (!/^[A-Z_][A-Z_0-9]*$/i.test(argument)) fail('DEFINE/UNDEF requires one symbol name', directive);
      if (active) {if (command === 'DEFINE') symbols.add(normalize(argument)); else symbols.delete(normalize(argument));}
    } else if (active) {
      retainedDirectives.push(directive);
      for (const option of text.split(/[\s,]+/)) {const switchMatch = /^([A-Z])([+-])$/i.exec(option); if (switchMatch) switches[switchMatch[1].toUpperCase()] = switchMatch[2] === '+';}
    }
    position = directive.end;
  };
  for (const token of tokens) {
    while (directiveIndex < directives.length && directives[directiveIndex].start < token.start) apply(directives[directiveIndex++]);
    if (active || token.type === 'eof') output.push(token);
  }
  while (directiveIndex < directives.length) apply(directives[directiveIndex++]);
  if (stack.length) fail('Unterminated conditional compilation block', stack.at(-1).directive);
  if (active) activeRanges.push({start: position, end: Infinity});
  const diagnostics = tokens.diagnostics.filter(diagnostic => activeRanges.some(range => diagnostic.start >= range.start && diagnostic.start < range.end));
  Object.defineProperties(output, {comments: {value: tokens.comments}, directives: {value: retainedDirectives}, allDirectives: {value: directives}, diagnostics: {value: diagnostics}, definedSymbols: {value: [...symbols]}});
  return output;
}
