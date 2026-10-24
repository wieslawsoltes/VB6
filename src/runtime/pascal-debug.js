import {VBError} from '../language/lexer.js';
import {parseExpression} from '../language/expression.js';
import {compileModule} from '../language/compiler-core.js';
import {PascalParser} from '../language/pascal/parser.js';
import {PascalLowerer} from '../language/pascal/compiler.js';
import {assignmentCompatible, isAggregate, isString} from '../language/pascal/semantics.js';
import {getPascalRuntimeSource} from '../language/pascal/runtime-library.js';
import {unbox, scalarType, tagScalar, truth} from './values.js';

const PURE_HELPERS = new Set(('ord chr upcase shortstring stringget ordinal trunc round frac real48 div mod intadd intsub intmul wordadd wordsub wordmul shiftleft shiftright copy pos setempty setnormalize setcontains setwith setwithout setrange setunion setintersect setdifference setsymmetricdifference setequal setsubset setcount debugrange debugsqr').split(' '));
const lower = value => String(value).toLowerCase();
const error = (message, number = 201) => {throw new VBError(message, number, 'Turbo Pascal');};
const boolean = value => tagScalar(value ? -1 : 0, 'boolean');
const integer = value => {value = Number(value); if (!Number.isFinite(value)) error('Invalid floating point conversion', 207); return Math.trunc(value);};
const normalizeSet = value => String(value).slice(0, 32).padEnd(32, '\0');
const setByte = (value, index, byte) => value.slice(0, index) + String.fromCharCode(byte & 255) + value.slice(index + 1);

/** Debugger intrinsics are a closed, synchronous implementation. They never
 * resolve helpers from the user program, invoke a getter, or allocate VM storage.
 * Compiled applications continue to use the portable shared-IR runtime helpers.
 */
export function pascalDebugIntrinsic(name, args) {
  const values = args.map(unbox), [a, b, c, d] = values;
  const ordinal = (value, bits = 16, signed = true, checked = false) => {
    value = integer(value); bits = integer(bits);
    if (![8, 16, 32].includes(bits)) error('Invalid ordinal width');
    const modulus = 2 ** bits, minimum = signed ? -modulus / 2 : 0, maximum = signed ? modulus / 2 - 1 : modulus - 1;
    if (checked && (value < minimum || value > maximum)) error('Ordinal range check failed');
    let result = ((value % modulus) + modulus) % modulus;
    if (signed && result >= modulus / 2) result -= modulus;
    return result;
  };
  const arithmetic = (operation, left, right, bits = 16, checked = false) => {
    const x = BigInt(integer(left)), y = BigInt(integer(right)), width = integer(bits);
    if (![8, 16, 32].includes(width)) error('Invalid ordinal width');
    const result = operation === 'intadd' ? x + y : operation === 'intsub' ? x - y : x * y;
    if (checked && (result < -(1n << BigInt(width - 1)) || result >= 1n << BigInt(width - 1))) error('Integer overflow', 215);
    return Number(BigInt.asIntN(width, result));
  };
  switch (name) {
    case 'ord': if (scalarType(args[0]) === 'boolean' || typeof a === 'boolean') return truth(args[0]) ? 1 : 0;
      if (typeof a === 'string') {if (a.length !== 1 || a.charCodeAt(0) > 255) error('Ordinal character requires exactly one byte'); return a.charCodeAt(0);} return integer(a);
    case 'chr': {const value = integer(a); if (value < 0 || value > 255) error('Character ordinal out of range'); return String.fromCharCode(value);}
    case 'upcase': {const value = String(a); if (value.length !== 1 || value.charCodeAt(0) > 255) error('Ordinal character requires exactly one byte'); return /^[a-z]$/.test(value) ? value.toUpperCase() : value;}
    case 'shortstring': if (b < 0 || b > 255) error('ShortString capacity out of range'); return String(a).slice(0, integer(b));
    case 'stringget': {const value = String(a), index = integer(b); if (index === 0) return String.fromCharCode(value.length); if (index < 1 || index > value.length) error('String index out of range'); return value[index - 1];}
    case 'ordinal': return tagScalar(ordinal(a, b, truth(args[2]), truth(args[3])), 'long');
    case 'trunc': {const value = integer(a); if (value < -2147483648 || value > 2147483647) error('Invalid floating point conversion', 207); return tagScalar(value, 'long');}
    case 'round': return pascalDebugIntrinsic('trunc', [a < 0 ? -Math.floor(-a + 0.5) : Math.floor(a + 0.5)]);
    case 'frac': return Number(a) - integer(a);
    case 'real48': {const value = Number(a), magnitude = Math.abs(value); if (!Number.isFinite(value) || magnitude >= 2 ** 127) error('Real48 overflow', 205); if (magnitude < 2 ** -128) return 0; const scale = 2 ** Math.floor(Math.log2(magnitude)), result = Math.floor(magnitude / scale * 2 ** 39 + 0.5) / 2 ** 39 * scale; if (result >= 2 ** 127) error('Real48 overflow', 205); return value < 0 ? -result : result;}
    case 'div': {const divisor = integer(b); if (!divisor) error('Division by zero', 200); const value = Math.trunc(integer(a) / divisor); if (value < -2147483648 || value > 2147483647) error('Integer division overflow', 200); return tagScalar(value, 'long');}
    case 'mod': if (!integer(b)) error('Division by zero', 200); return tagScalar(integer(a) % integer(b), 'long');
    case 'intadd': case 'intsub': case 'intmul': return tagScalar(arithmetic(name, a, b, c, truth(args[3])), 'long');
    case 'wordadd': case 'wordsub': case 'wordmul': {const x=BigInt(integer(a)),y=BigInt(integer(b)),value=name==='wordadd'?x+y:name==='wordsub'?x-y:x*y;if(truth(args[2])&&(value<0n||value>65535n))error('Integer overflow',215);return tagScalar(Number(BigInt.asUintN(16,value)),'long');}
    case 'shiftleft': case 'shiftright': {const count = integer(b), width = integer(c ?? 16); if (count < 0 || ![8, 16, 32].includes(width)) error('Invalid shift count or width'); if (count >= width) return tagScalar(0, 'long'); const value = BigInt.asUintN(width, BigInt(integer(a))), result = name === 'shiftleft' ? value << BigInt(count) : value >> BigInt(count); return tagScalar(Number(truth(args[3] ?? -1) ? BigInt.asIntN(width, result) : BigInt.asUintN(width, result)), 'long');}
    case 'copy': {const index = Math.max(1, integer(b)) - 1; return c <= 0 ? '' : String(a).slice(index, index + integer(c));}
    case 'pos': return String(a) === '' ? 0 : String(b).indexOf(String(a)) + 1;
    case 'setempty': return '\0'.repeat(32);
    case 'setnormalize': return normalizeSet(a);
    case 'setcontains': return boolean(Number.isInteger(b) && b >= 0 && b <= 255 && !!((String(a).charCodeAt(b >> 3) || 0) & 1 << (b & 7)));
    case 'setrange': {let result = '\0'.repeat(32); if (a <= b) {if (a < 0 || b > 255) error('Set range out of bounds'); for (let index = integer(a); index <= integer(b); index++) result = setByte(result, index >> 3, result.charCodeAt(index >> 3) | 1 << (index & 7));} return result;}
    case 'setwith': case 'setwithout': {if (b < 0 || b > 255) error('Set ordinal out of range'); const result = normalizeSet(a), index = integer(b), value = result.charCodeAt(index >> 3), mask = 1 << (index & 7); return setByte(result, index >> 3, name === 'setwith' ? value | mask : value & (255 ^ mask));}
    case 'setunion': case 'setintersect': case 'setdifference': case 'setsymmetricdifference': case 'setequal': case 'setsubset': {
      const left = normalizeSet(a), right = normalizeSet(b); if (name === 'setequal') return boolean(left === right); let result = '';
      for (let i = 0; i < 32; i++) {const x = left.charCodeAt(i), y = right.charCodeAt(i); if (name === 'setsubset' && (x & (255 ^ y))) return boolean(false); result += String.fromCharCode(name === 'setunion' ? x | y : name === 'setintersect' ? x & y : name === 'setdifference' ? x & (255 ^ y) : x ^ y);}
      return name === 'setsubset' ? boolean(true) : result;
    }
    case 'setcount': {let count = 0; for (const ch of normalizeSet(a)) for (let bits = ch.charCodeAt(0) & 255; bits; bits &= bits - 1) count++; return count;}
    case 'debugrange': if (a < b || a > c) error('Subrange check failed'); return args[0];
    case 'debugsqr': return c === undefined || b === 0 ? Number(a) * Number(a) : d!==undefined&&!truth(args[3]) ? pascalDebugIntrinsic('wordmul',[a,a,args[2]]) : tagScalar(arithmetic('intmul', a, a, b, truth(args[2])), 'long');
    default: error('Automatic Pascal helper evaluation is disabled: ' + name, 5);
  }
}

/** Mark only compiler-generated pure helper calls. The VM and inspector handle
 * these nodes directly, so even a helper absent from the program is inspectable.
 */
export function pascalDebugTree(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(pascalDebugTree);
  const result = {};
  for (const [key, value] of Object.entries(node)) result[key] = pascalDebugTree(value);
  if (result.kind === 'id' && /^__Pascal_/i.test(result.name)) result.pascalStorage = true;
  if (result.kind === 'call' && result.callee.kind === 'id') {
    const name = lower(result.callee.name).replace(/^__pascal/, '');
    if (lower(result.callee.name).startsWith('__pascal')) {
      if (name === 'debugand' || name === 'debugor') return {kind: 'pascalShortCircuit', op: name === 'debugand' ? 'and' : 'or', args: result.args};
      if (PURE_HELPERS.has(name)) return {kind: 'pascalIntrinsic', name, args: result.args};
    }
  }
  return result;
}

export function parsePascalDebugExpression(source) {
  const parser = new PascalParser({name: 'Debugger', code: source}), expression = parser.expression();
  if (parser.peek().type !== 'eof') parser.fail('Unexpected trailing tokens in Pascal expression');
  return expression;
}

export function lowerPascalDebugExpression(source, frame, project) {
  const {lowerer, context} = contextFor(frame, project, true);
  return pascalDebugTree(parseExpression(lowerer.expression(parsePascalDebugExpression(source), context)));
}

function contextFor(frame, project, pure) {
  const input = {name: frame.module.name, code: frame.pinnedSource ?? frame.module.source, form: frame.module.form}, lowerer = new PascalLowerer(input, {project});
  const selected = lowerer.binder.procedures.find(value => lower(value.vbName) === lower(frame.proc.name) || lower(value.name) === lower(frame.proc.name));
  const context = lowerer.context(selected?.localScope || lowerer.binder.scope, selected); context.pure = pure;
  const line = frame.proc.code[frame.pc]?.line || frame.proc.line, start = line ? input.code.split('\n').slice(0, line - 1).reduce((n, part) => n + part.length + 1, 0) : Infinity;
  for (const name of Object.keys(lowerer.flags)) lowerer.flags[name] = lowerer.flag(name, {loc: {start}});
  lowerer.directiveFlags = [];
  return {lowerer, context};
}

export function lowerPascalDebugAssignment(expression, source, frame, project) {
  const {lowerer, context} = contextFor(frame, project, true), target = parsePascalDebugExpression(expression), value = parsePascalDebugExpression(source);
  lowerer.assignable(target, context);
  const targetType = lowerer.typeOf(target, context), valueType = lowerer.typeOf(value, context);
  if (!assignmentCompatible(targetType, valueType)) error('Assignment operands have incompatible Pascal types', 13);
  if (isAggregate(targetType)) error('Use Immediate to assign aggregate Pascal storage', 5);
  const tree = text => pascalDebugTree(parseExpression(text));
  const result = {value: tree(lowerer.range(lowerer.expression(value, context), targetType, context, target))};
  if (target.kind === 'index' && isString(lowerer.typeOf(target.object, context))) {
    result.target = {kind: 'pascalStringReference', object: tree(lowerer.expression(target.object, context, {lvalue: true})), index: tree(lowerer.ordinal(target.indices[0], context)), capacity: lowerer.typeOf(target.object, context).capacity};
  } else result.target = tree(lowerer.expression(target, context, {lvalue: true}));
  return result;
}

/** Reuse the real statement lowerer for explicit Immediate execution, including
 * compound statements and intrinsic procedures. The caller installs only missing
 * generated helpers for the duration of its bounded evaluation session.
 */
export function compilePascalImmediate(source, frame, project) {
  const {lowerer, context} = contextFor(frame, project, false), parser = new PascalParser({name: frame.module.name, code: source});
  lowerer.foreignThunkPrefix = '__PascalImmediateForeignArgument_';
  while (parser.peek().type !== 'eof') {
    if (parser.match(';')) continue;
    lowerer.statement(parser.statement(), context);
    if (parser.peek().type !== 'eof' && !parser.match(';')) parser.fail("Expected ';' between Immediate statements");
  }
  const module = compileModule({name: frame.module.name, code: `Private Sub __PascalImmediate()\n${context.writer.source}\nEnd Sub\n${(lowerer.foreignThunks || []).map(thunk => thunk.source).join('\n')}\n${getPascalRuntimeSource([...lowerer.helpers])}`});
  return {procedure: module.procedures.get('__pascalimmediate'), helpers: [...module.procedures].filter(([name]) => name !== '__pascalimmediate')};
}

export function setPascalDebugCharacter(ref, index, character, capacity = 255) {
  let value = String(unbox(ref.get())); character = String(unbox(character)); index = integer(index);
  if (character.length !== 1 || character.charCodeAt(0) > 255) error('Ordinal character requires exactly one byte');
  if (index === 0) {const length = character.charCodeAt(0); if (length > capacity) error('String length out of range'); value = value.padEnd(length, '\0').slice(0, length);}
  else {if (index < 1 || index > value.length || index > capacity) error('String index out of range'); value = value.slice(0, index - 1) + character + value.slice(index);}
  ref.set(value); return character;
}
