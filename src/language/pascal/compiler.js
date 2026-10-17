import {compileModule} from '../compiler-core.js';
import {parseExpression as parseSharedExpression} from '../expression.js';
import {parsePascalModule, PascalParser} from './parser.js';
import {PascalError} from './lexer.js';
import {PascalWorkspace, PASCAL_TYPES, isOrdinal, isString, isNumeric, isAggregate, numericType, sameType, assignmentCompatible} from './semantics.js';
import {getPascalHelper, getPascalRuntimeSource} from './runtime-library.js';

export {parsePascalModule};
export {tokenizePascal, PascalError, PASCAL_KEYWORDS} from './lexer.js';

const key = value => String(value).toLowerCase();
const identifier = name => `[${String(name).replaceAll(']', '')}]`;
const quote = value => String(value).split(/(\r|\n)/).filter(part => part !== '').map(part => part === '\r' ? 'vbCr' : part === '\n' ? 'vbLf' : `"${part.replaceAll('"', '""')}"`).join(' & ') || '""';
const number = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? `${value}&` : `${Number(value)}${Number.isInteger(value) ? '#' : ''}`;
const bool = value => value ? 'True' : 'False';
const INTRINSIC_TYPES = Object.freeze({ord: 'longint', chr: 'char', length: 'integer', copy: 'string', concat: 'string', pos: 'integer', upcase: 'char', round: 'longint', trunc: 'longint', frac: 'real', int: 'real', abs: 'real', sqr: 'real', sqrt: 'real', sin: 'real', cos: 'real', arctan: 'real', exp: 'real', ln: 'real', odd: 'boolean', random: 'real', paramcount: 'integer', paramstr: 'string', sizeof: 'integer', ioresult: 'integer', readkey: 'char', keypressed: 'boolean', low: 'longint', high: 'longint'});
const DIRECT_CALLS = Object.freeze({sqrt: 'Sqr', sin: 'Sin', cos: 'Cos', arctan: 'Atn', exp: 'Exp', ln: 'Log', int: 'Fix', length: 'Len'});

class SourceWriter {
  constructor() {this.lines = []; this.map = [];}
  emit(text, node, internal = false) {
    const loc = node?.loc || node || {line: 1, column: 1, endLine: 1, endColumn: 1};
    for (const line of String(text).split('\n')) {this.lines.push(line); this.map.push({generatedLine: this.lines.length, line: loc.line || 1, column: loc.column || 1, endLine: loc.endLine || loc.line || 1, endColumn: loc.endColumn || loc.column || 1, internal});}
  }
  append(other) {for (let i = 0; i < other.lines.length; i++) {this.lines.push(other.lines[i]); this.map.push({...other.map[i], generatedLine: this.lines.length});}}
  get source() {return this.lines.join('\n');}
}

export class PascalLowerer {
  constructor(input, options = {}) {
    this.ast = input?.kind === 'pascalModule' ? input : parsePascalModule(input, options);
    this.input = input?.kind === 'pascalModule' ? {...options.input, name: options.input?.name || input.sourceName || input.name, code: input.source} : typeof input === 'string' ? {name: this.ast.name, code: input} : input;
    this.options = options; this.workspace = options.workspace || new PascalWorkspace(options.project);
    this.binder = this.workspace.add(this.input, this.ast); this.binder.ensure();
    this.writer = new SourceWriter(); this.helpers = new Set(); this.tempId = 0; this.labels = 0;
    this.flags = {completeBoolean: false, rangeChecks: false, overflowChecks: false};
    this.directiveFlags = [];
    for (const directive of this.ast.directives) {
      const parts = directive.value.slice(1).trim().split(/[\s,]+/);
      for (const part of parts) {
        const match = /^([BRQ])([+-])$/i.exec(part);
        if (match) this.directiveFlags.push({start: directive.start, flag: {B: 'completeBoolean', R: 'rangeChecks', Q: 'overflowChecks'}[match[1].toUpperCase()], value: match[2] === '+'});
        else if (/^(?:I|INCLUDE)$/i.test(part) && parts.length > 1) this.fail('Include directives require the referenced file to be expanded by the project loader', directive, 'TP_INCLUDE_NOT_FOUND');
        else if (/^(?:IFDEF|IFNDEF|IFOPT|ELSE|ENDIF|DEFINE|UNDEF)$/i.test(part)) this.fail('Conditional compilation directives require project symbol preprocessing', directive, 'TP_UNSUPPORTED_DIRECTIVE');
        else if (/^[A-Z][+-]$/i.test(part) || /^(?:M|L|D|S|N|E|O|F|A|V|X|G|T|P|C)$/i.test(part)) {if (/^[PNV][+-]$/i.test(part)) this.fail(`Compiler directive '${part}' changes an unsupported ABI mode`, directive, 'TP_UNSUPPORTED_DIRECTIVE');}
      }
    }
    this.initializer = null;
  }
  fail(message, node = this.ast, code = 'TP_SEMANTIC') {this.binder.fail(message, node, code);}
  flag(name, node) {let value = this.flags[name]; for (const directive of this.directiveFlags) if (directive.start <= (node?.loc?.start ?? node?.start ?? Infinity) && directive.flag === name) value = directive.value; return value;}
  helper(name) {const helper = getPascalHelper(name); if (!helper) this.fail(`Missing Pascal runtime helper '${name}'`); this.helpers.add(helper.id); return identifier(helper.name);}
  callHelper(name, args) {return `${this.helper(name)}(${args.join(', ')})`;}
  context(scope = this.binder.scope, procedure = null, writer = new SourceWriter()) {return {scope, procedure, writer, loops: [], withObjects: [], activeControls: new Set(), pure: false};}
  emit(context, source, node, internal = false) {context.writer.emit(source, node, internal);}
  temporary(context, type, node, prefix = 'temp') {if (context.pure) this.fail('This Pascal expression requires executable temporary storage', node, 'TP_DEBUG_EXPRESSION'); const name = `__Pascal_${prefix}_${this.tempId++}`; this.emit(context, `Dim ${identifier(name)} As ${this.storageType(type)}`, node, true); return identifier(name);}
  storageType(type) {if (type?.kind === 'record') return type.owner === this.binder ? identifier(type.name) : `${identifier(type.owner.name)}.${identifier(type.name)}`; return type?.vb || 'Variant';}
  declaration(name, type, parameter = false) {
    if (type.kind === 'array') return `${identifier(name)}(${parameter ? '' : type.dimensions.map(d => `${number(d.low)} To ${number(d.high)}`).join(', ')}) As ${this.storageType(type.element)}`;
    return `${identifier(name)} As ${this.storageType(type)}`;
  }
  literal(value, type) {if (type.kind === 'boolean') return bool(value); if (typeof value === 'string') return quote(value); return number(value);}
  access(symbol, context) {
    if (symbol.builtIn && symbol.kind === 'constant') return this.literal(symbol.value, symbol.type);
    const capture = context.procedure?.captures.find(value => value.symbol === symbol);
    if (capture) return identifier(capture.name);
    const own = identifier(symbol.vbName || symbol.name);
    return symbol.owner && symbol.owner !== this.binder ? `${identifier(symbol.owner.name)}.${own}` : own;
  }
  resolve(node, context, required = true) {
    if (node.kind !== 'identifier') return null;
    for (let i = context.withObjects.length - 1; i >= 0; i--) {const object = context.withObjects[i], field = object.type.fields?.get(key(node.name)); if (field) return {kind: 'withField', name: field.name, type: field.type, access: `${object.source}.${identifier(field.name)}`};}
    return context.scope.resolve(node.name, required, node);
  }
  memberSymbol(node, context) {
    if (node.kind !== 'member' || node.object.kind !== 'identifier') return null;
    const binder = this.workspace.get(node.object.name);
    if (!binder) return null;
    if (binder !== this.binder && !this.binder.imports.includes(binder)) this.fail(`Unit '${node.object.name}' is not in the uses clause`, node, 'TP_UNIT_ACCESS');
    binder.ensure(); const symbol = binder.scope.symbols.get(key(node.name));
    if (!symbol || binder !== this.binder && !symbol.public) this.fail(`Unit member '${node.object.name}.${node.name}' is not exported`, node, 'TP_PRIVATE_MEMBER');
    return binder.resolveSymbol(symbol);
  }
  typeOf(node, context) {
    if (!node) return PASCAL_TYPES.variant;
    if (node.kind === 'group') return this.typeOf(node.expression, context);
    if (node.kind === 'number' || node.kind === 'string' || node.kind === 'boolean') return this.binder.constant(node, context.scope).type;
    if (node.kind === 'nil') return PASCAL_TYPES.object;
    if (node.kind === 'identifier') {
      const symbol = this.resolve(node, context, false);
      if (symbol) return symbol.kind === 'procedure' ? symbol.returnType || PASCAL_TYPES.variant : symbol.type;
      if (Object.hasOwn(INTRINSIC_TYPES, key(node.name))) return PASCAL_TYPES[INTRINSIC_TYPES[key(node.name)]];
      this.fail(`Unknown identifier '${node.name}'`, node, 'TP_UNKNOWN_IDENTIFIER');
    }
    if (node.kind === 'member') {
      const symbol = this.memberSymbol(node, context); if (symbol) return symbol.kind === 'procedure' ? symbol.returnType || PASCAL_TYPES.variant : symbol.type;
      const type = this.typeOf(node.object, context), field = type.fields?.get(key(node.name));
      if (type.kind === 'record' && !field) this.fail(`Record '${type.name}' has no field '${node.name}'`, node, 'TP_UNKNOWN_FIELD');
      return field?.type || PASCAL_TYPES.variant;
    }
    if (node.kind === 'index') {
      const type = this.typeOf(node.object, context);
      if (isString(type)) {if (node.indices.length !== 1) this.fail('String indexing requires one ordinal index', node); return PASCAL_TYPES.char;}
      if (type.kind !== 'array') this.fail('Only arrays and strings can be indexed', node, 'TP_INDEX_TYPE');
      if (node.indices.length > type.dimensions.length && !type.open) this.fail('Too many array indices', node, 'TP_INDEX_COUNT');
      return type.open || node.indices.length === type.dimensions.length ? type.element : {...type, dimensions: type.dimensions.slice(node.indices.length)};
    }
    if (node.kind === 'unary') {if (node.operator === '@') this.fail('Routine and storage addresses require procedural-pointer lowering', node, 'TP_UNSUPPORTED_POINTER'); return this.typeOf(node.operand, context);}
    if (node.kind === 'binary') {
      const left = this.typeOf(node.left, context), right = this.typeOf(node.right, context);
      if (['=', '<>', '<', '>', '<=', '>=', 'in'].includes(node.operator)) return PASCAL_TYPES.boolean;
      if (left.kind === 'set' || right.kind === 'set') return left.kind === 'set' ? left : right;
      if (node.operator === '+' && isString(left) && isString(right)) return PASCAL_TYPES.string;
      if (left.kind === 'boolean' && right.kind === 'boolean') return PASCAL_TYPES.boolean;
      return node.operator === '/' ? PASCAL_TYPES.real : numericType(left, right);
    }
    if (node.kind === 'set') {
      let base = null;
      for (const element of node.elements) {const type = this.typeOf(element.low, context); if (!isOrdinal(type)) this.fail('Set element must be ordinal', element.low); if (base && !sameType(base, type) && !(isNumeric(base) && isNumeric(type))) this.fail('Set members require compatible ordinal types', element.low); base ||= type;}
      return {kind: 'set', vb: 'String', base};
    }
    if (node.kind === 'call') {
      const name = node.callee.kind === 'identifier' ? key(node.callee.name) : null;
      const symbol = node.callee.kind === 'identifier' ? this.resolve(node.callee, context, false) : this.memberSymbol(node.callee, context);
      if (symbol?.kind === 'type') return symbol.type;
      if (symbol?.kind === 'result') return symbol.procedure.returnType;
      if (symbol?.kind === 'procedure') return symbol.returnType || PASCAL_TYPES.variant;
      if (['succ', 'pred', 'abs', 'sqr'].includes(name) && node.args.length) return this.typeOf(node.args[0], context);
      if (name === 'random' && node.args.length) return PASCAL_TYPES.integer;
      if (name && INTRINSIC_TYPES[name]) return PASCAL_TYPES[INTRINSIC_TYPES[name]];
      if (node.callee.kind === 'member' && this.typeOf(node.callee.object, context).kind !== 'record') return PASCAL_TYPES.variant;
      if (symbol?.kind === 'external') return PASCAL_TYPES.variant;
      this.fail(`Unknown Pascal function '${name || node.callee.name || '<expression>'}'`, node, 'TP_UNKNOWN_ROUTINE');
    }
    if (node.kind === 'formatted') return this.typeOf(node.value, context);
    this.fail(`Expression '${node.kind}' requires unsupported storage semantics`, node, 'TP_UNSUPPORTED_EXPRESSION');
  }
  ordinal(node, context) {const type = this.typeOf(node, context), value = this.expression(node, context); return ['char', 'boolean'].includes(type.kind) || type.kind === 'subrange' && ['char', 'boolean'].includes(type.base.kind) ? this.callHelper('ord', [value]) : value;}
  range(value, type, context, node) {
    if (type.kind === 'string') return this.callHelper('shortString', [value, number(type.capacity)]);
    if (type.kind === 'ordinal' || type.kind === 'subrange' && isNumeric(type.base)) {
      if (type.kind === 'subrange' && this.flag('rangeChecks', node)) {const temporary = this.temporary(context, PASCAL_TYPES.longint, node, 'range'); this.emit(context, `${temporary} = ${value}`, node, true); this.emit(context, `If ${temporary} < ${number(type.low)} Or ${temporary} > ${number(type.high)} Then Err.Raise 201, "Turbo Pascal", "Subrange check failed"`, node, true); value = temporary;}
      return this.callHelper('ordinal', [value, number(type.bits), bool(type.signed), bool(this.flag('rangeChecks', node))]);
    }
    if (type.kind === 'enum' && this.flag('rangeChecks', node)) {const temporary = this.temporary(context, PASCAL_TYPES.integer, node, 'enum'); this.emit(context, `${temporary} = ${value}`, node, true); this.emit(context, `If ${temporary} < ${number(type.low)} Or ${temporary} > ${number(type.high)} Then Err.Raise 201, "Turbo Pascal", "Enumeration range check failed"`, node, true); return temporary;}
    return value;
  }
  expression(node, context, {lvalue = false, forceCall = false} = {}) {
    if (node.kind === 'group') return `(${this.expression(node.expression, context, {lvalue, forceCall})})`;
    if (['number', 'string', 'boolean'].includes(node.kind)) {const constant = this.binder.constant(node, context.scope); return this.literal(constant.value, constant.type);}
    if (node.kind === 'nil') return 'Nothing';
    if (node.kind === 'identifier') {
      const symbol = this.resolve(node, context, false);
      if (!symbol && Object.hasOwn(INTRINSIC_TYPES, key(node.name))) return this.expression({...node, kind: 'call', callee: node, args: []}, context);
      if (!symbol) this.fail(`Unknown identifier '${node.name}'`, node, 'TP_UNKNOWN_IDENTIFIER');
      if (symbol.kind === 'type') this.fail('Type identifier cannot be used as a value', node);
      if (symbol.kind === 'withField') return symbol.access;
      if (symbol.kind === 'procedure' && !lvalue || symbol.kind === 'result' && forceCall) return this.routineCall(symbol.kind === 'result' ? symbol.procedure : symbol, [], context, node);
      if (symbol.kind === 'constant' || symbol.kind === 'enumMember') return this.literal(symbol.value, symbol.type);
      return this.access(symbol, context);
    }
    if (node.kind === 'member') {
      const symbol = this.memberSymbol(node, context);
      if (symbol) return symbol.kind === 'procedure' && !lvalue ? this.routineCall(symbol, [], context, node) : symbol.kind === 'constant' || symbol.kind === 'enumMember' ? this.literal(symbol.value, symbol.type) : this.access(symbol, context);
      this.typeOf(node, context);
      return `${this.expression(node.object, context, {lvalue: true})}.${identifier(node.name)}`;
    }
    if (node.kind === 'index') {
      const type = this.typeOf(node.object, context); this.typeOf(node, context);
      if (isString(type)) {if (lvalue) this.fail('String characters require the Pascal character setter', node, 'TP_STRING_LVALUE'); return this.callHelper('stringGet', [this.expression(node.object, context), this.ordinal(node.indices[0], context)]);}
      const indices = [], levels = []; let object = node;
      while (object.kind === 'index' && this.typeOf(object.object, context).kind === 'array') {levels.unshift(object); object = object.object;}
      for (const level of levels) for (const index of level.indices) {if (!isOrdinal(this.typeOf(index, context))) this.fail('Array index must be ordinal', index, 'TP_INDEX_TYPE'); indices.push(this.ordinal(index, context));}
      return `${this.expression(object, context, {lvalue: true})}(${indices.join(', ')})`;
    }
    if (node.kind === 'set') {
      let expression = '""';
      for (const element of node.elements) {const low = this.ordinal(element.low, context), range = element.high ? this.callHelper('setRange', [low, this.ordinal(element.high, context)]) : this.callHelper('setRange', [low, low]); expression = this.callHelper('setUnion', [expression, range]);}
      return expression;
    }
    if (node.kind === 'unary') {
      const type = this.typeOf(node, context), value = this.expression(node.operand, context);
      if (node.operator === 'not') {if (type.kind === 'boolean') return `(Not ${value})`; if (!isNumeric(type) || type.kind === 'real') this.fail('Not requires a Boolean or integer operand', node); return this.range(`(Not ${value})`, type, context, node);}
      if (!isNumeric(type)) this.fail('Unary sign requires a numeric operand', node);
      return node.operator === '-' && type.kind !== 'real' ? this.callHelper('intSub', ['0&', value, number(type.bits || 16), bool(this.flag('overflowChecks', node))]) : `(${node.operator}${value})`;
    }
    if (node.kind === 'binary') return this.binary(node, context);
    if (node.kind === 'call') return this.call(node, context);
    this.fail(`Unsupported expression '${node.kind}'`, node, 'TP_UNSUPPORTED_EXPRESSION');
  }
  binary(node, context) {
    const leftType = this.typeOf(node.left, context), rightType = this.typeOf(node.right, context), resultType = this.typeOf(node, context), op = node.operator;
    if (['and', 'or'].includes(op) && leftType.kind === 'boolean' && rightType.kind === 'boolean' && !this.flag('completeBoolean', node)) {
      if (context.pure) return `(${this.expression(node.left, context)} ${op} ${this.expression(node.right, context)})`;
      const temporary = this.temporary(context, PASCAL_TYPES.boolean, node, 'boolean'); this.emit(context, `${temporary} = ${this.expression(node.left, context)}`, node, true);
      this.emit(context, `If ${op === 'and' ? temporary : `Not ${temporary}`} Then`, node, true); this.emit(context, `${temporary} = ${this.expression(node.right, context)}`, node, true); this.emit(context, 'End If', node, true); return temporary;
    }
    const left = this.expression(node.left, context), right = this.expression(node.right, context);
    if (leftType.kind === 'set' || rightType.kind === 'set') {
      if (op === 'in') {if (!isOrdinal(leftType) || rightType.kind !== 'set') this.fail('In requires an ordinal value and a set', node); return this.callHelper('setContains', [right, ['char', 'boolean'].includes(leftType.kind) ? this.callHelper('ord', [left]) : left]);}
      if (leftType.kind !== 'set' || rightType.kind !== 'set') this.fail('Set operator requires two sets', node);
      const helpers = {'+': 'setUnion', '*': 'setIntersect', '-': 'setDifference', '=': 'setEqual', '<>': 'setEqual', '<=': 'setSubset', '>=': 'setSubset'};
      if (!helpers[op]) this.fail(`Operator '${op}' is not defined for sets`, node, 'TP_OPERATOR_TYPE');
      const value = this.callHelper(helpers[op], op === '>=' ? [right, left] : [left, right]); return op === '<>' ? `(Not ${value})` : value;
    }
    if (op === 'in') this.fail('Right operand of In must be a set', node);
    if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
      if (!assignmentCompatible(leftType, rightType) && !assignmentCompatible(rightType, leftType) || isAggregate(leftType)) this.fail('Comparison operands have incompatible types', node, 'TP_OPERATOR_TYPE');
      if (leftType.kind === 'boolean' && rightType.kind === 'boolean' && !['=', '<>'].includes(op)) return `(${this.callHelper('ord', [left])} ${op} ${this.callHelper('ord', [right])})`;
      return `(${left} ${op} ${right})`;
    }
    if (op === '+' && isString(leftType) && isString(rightType)) return `(${left} & ${right})`;
    if (leftType.kind === 'boolean' || rightType.kind === 'boolean') {if (leftType.kind !== 'boolean' || rightType.kind !== 'boolean' || !['and', 'or', 'xor'].includes(op)) this.fail('Invalid Boolean operator', node, 'TP_OPERATOR_TYPE'); return `(${left} ${op} ${right})`;}
    if (!isNumeric(leftType) || !isNumeric(rightType)) this.fail(`Operator '${op}' requires numeric operands`, node, 'TP_OPERATOR_TYPE');
    if (['div', 'mod', 'and', 'or', 'xor', 'shl', 'shr'].includes(op) && (leftType.kind === 'real' || rightType.kind === 'real')) this.fail(`Operator '${op}' requires integer operands`, node, 'TP_OPERATOR_TYPE');
    if (['+', '-', '*'].includes(op) && resultType.kind !== 'real') return this.callHelper({'+': 'intAdd', '-': 'intSub', '*': 'intMul'}[op], [left, right, number(resultType.bits || 16), bool(this.flag('overflowChecks', node))]);
    if (op === 'div' || op === 'mod') return this.callHelper(op, [left, right]);
    if (op === 'shl' || op === 'shr') return this.callHelper(op === 'shl' ? 'shiftLeft' : 'shiftRight', [left, right, number(leftType.bits || 16), bool(leftType.signed !== false)]);
    return `(${left} ${op} ${right})`;
  }
  count(node, minimum, maximum = minimum) {if (node.args.length < minimum || node.args.length > maximum) this.fail(`'${node.callee.name}' expects ${minimum === maximum ? minimum : `${minimum}..${maximum}`} argument(s)`, node, 'TP_ARGUMENT_COUNT');}
  call(node, context) {
    const name = node.callee.kind === 'identifier' ? key(node.callee.name) : null;
    const symbol = name ? this.resolve(node.callee, context, false) : this.memberSymbol(node.callee, context);
    if (symbol?.kind === 'type') {this.count(node, 1); const value = this.expression(node.args[0], context); if (symbol.type.kind === 'char') return this.callHelper('chr', [value]); if (symbol.type.kind === 'boolean') return `(${value} <> 0&)`; if (isNumeric(symbol.type)) return this.range(symbol.type.kind === 'real' ? `CDbl(${value})` : `Fix(${value})`, symbol.type, context, node); this.fail('This type cast requires storage reinterpretation', node, 'TP_UNSUPPORTED_CAST');}
    if (symbol?.kind === 'procedure' || symbol?.kind === 'result') return this.routineCall(symbol.kind === 'result' ? symbol.procedure : symbol, node.args, context, node);
    if (!symbol && name) {
      if (['ord', 'chr', 'upcase', 'round', 'trunc', 'frac'].includes(name)) {this.count(node, 1); return this.callHelper(name, [this.expression(node.args[0], context)]);}
      if (name === 'copy' || name === 'pos') {this.count(node, name === 'copy' ? 3 : 2); return this.callHelper(name, node.args.map(arg => this.expression(arg, context)));}
      if (DIRECT_CALLS[name]) {this.count(node, 1); return `${DIRECT_CALLS[name]}(${this.expression(node.args[0], context)})`;}
      if (name === 'abs') {this.count(node, 1); return `Abs(${this.expression(node.args[0], context)})`;}
      if (name === 'sqr') {this.count(node, 1); const type = this.typeOf(node.args[0], context), value = this.temporary(context, type, node); this.emit(context, `${value} = ${this.expression(node.args[0], context)}`, node, true); return type.kind === 'real' ? `(${value} * ${value})` : this.callHelper('intMul', [value, value, number(type.bits || 16), bool(this.flag('overflowChecks', node))]);}
      if (name === 'odd') {this.count(node, 1); if (!isNumeric(this.typeOf(node.args[0], context))) this.fail('Odd requires an integer', node); return `((${this.expression(node.args[0], context)} And 1&) <> 0&)`;}
      if (name === 'succ' || name === 'pred') {this.count(node, 1); const type = this.typeOf(node.args[0], context); if (!isOrdinal(type)) this.fail('Succ/Pred require an ordinal argument', node); const value = `(${this.ordinal(node.args[0], context)} ${name === 'succ' ? '+' : '-'} 1&)`; return type.kind === 'char' ? this.callHelper('chr', [value]) : type.kind === 'boolean' ? `(${value} <> 0&)` : this.range(value, type, context, node);}
      if (name === 'concat') return `(${node.args.map(arg => this.expression(arg, context)).join(' & ') || '""'})`;
      if (name === 'low' || name === 'high') {
        this.count(node, 1); const type = this.typeOf(node.args[0], context); let value = type[name];
        if (type.kind === 'array') {if (type.open) return `${name === 'low' ? 'LBound' : 'UBound'}(${this.expression(node.args[0], context, {lvalue: true})})`; value = type.dimensions[0][name];}
        if (type.kind === 'string') value = name === 'low' ? 0 : type.capacity;
        if (value === undefined) this.fail('Low/High require an ordinal type, string, or array', node); return number(value);
      }
      if (name === 'sizeof') {this.count(node, 1); return number(this.sizeOf(this.typeOf(node.args[0], context), node));}
      if (name === 'random') {this.count(node, 0, 1); return node.args.length ? `Int(Rnd() * ${this.expression(node.args[0], context)})` : 'Rnd()';}
      if (name === 'paramcount') {this.count(node, 0); return '0&';}
      if (name === 'paramstr') {this.count(node, 1); this.fail('Command-line arguments require the host parameter adapter', node, 'TP_UNSUPPORTED_HOST_IO');}
      if (name === 'ioresult') {this.count(node, 0); return '0&';}
      if (name === 'keypressed' || name === 'readkey') this.fail('Crt keyboard polling requires a terminal host adapter', node, 'TP_UNSUPPORTED_CRT');
    }
    if (node.callee.kind === 'member' || symbol?.kind === 'external') return `${this.expression(node.callee, context, {lvalue: true})}(${node.args.map(arg => this.expression(arg, context)).join(', ')})`;
    this.fail(`Unknown Pascal routine '${name || node.callee.name}'`, node, 'TP_UNKNOWN_ROUTINE');
  }
  sizeOf(type, node) {
    if (type.kind === 'ordinal') return type.bits / 8;
    if (['char', 'boolean', 'enum'].includes(type.kind)) return 1;
    if (type.kind === 'subrange') return type.low >= 0 && type.high <= 255 ? 1 : type.low >= -32768 && type.high <= 32767 ? 2 : 4;
    if (type.kind === 'real') return {Real: 6, Single: 4, Double: 8, Extended: 10}[type.name];
    if (type.kind === 'string') return type.capacity + 1;
    if (type.kind === 'set') return Math.ceil((type.base.high + 1) / 8) - Math.floor(type.base.low / 8);
    if (type.kind === 'array') return type.dimensions.reduce((total, dimension) => total * (dimension.high - dimension.low + 1), this.sizeOf(type.element, node));
    if (type.kind === 'record') return [...type.fields.values()].reduce((total, field) => total + this.sizeOf(field.type, node), 0);
    this.fail('SizeOf requires a statically sized Turbo Pascal type', node, 'TP_SIZEOF');
  }
  routineCall(symbol, args, context, node) {
    if (args.length !== symbol.params.length) this.fail(`Routine '${symbol.name}' expects ${symbol.params.length} argument(s), received ${args.length}`, node, 'TP_ARGUMENT_COUNT');
    const values = args.map((arg, index) => {
      const param = symbol.params[index], actual = this.typeOf(arg, context);
      if (param.byRef) {this.assignable(arg, context); if (!sameType(param.type, actual) && !(param.type.kind === 'array' && param.type.open && actual.kind === 'array' && sameType(param.type.element, actual.element))) this.fail(`Var parameter '${param.name}' requires exactly ${param.type.name}`, arg, 'TP_VAR_PARAMETER_TYPE'); return this.expression(arg, context, {lvalue: true});}
      if (!assignmentCompatible(param.type, actual)) this.fail(`Argument '${param.name}' has incompatible type`, arg, 'TP_ARGUMENT_TYPE');
      return isAggregate(param.type) ? this.expression(arg, context, {lvalue: true}) : this.range(this.expression(arg, context), param.type, context, arg);
    });
    for (const capture of symbol.captures) values.push(this.access(capture.symbol, context));
    return `${this.access(symbol, context)}(${values.join(', ')})`;
  }
  assignable(node, context) {
    if (node.kind === 'group') return this.assignable(node.expression, context);
    if (node.kind === 'identifier') {const symbol = this.resolve(node, context); if (!['variable', 'parameter', 'result', 'withField', 'control', 'external'].includes(symbol.kind)) this.fail(`Cannot assign to '${node.name}'`, node, 'TP_ASSIGNMENT'); if (symbol.kind === 'parameter' && symbol.param.constant) this.fail(`Cannot modify const parameter '${node.name}'`, node, 'TP_ASSIGNMENT'); if (context.activeControls.has(symbol)) this.fail('For control variable cannot be modified inside its loop', node, 'TP_FOR_VARIABLE'); return symbol;}
    if (node.kind === 'member') {const symbol = this.memberSymbol(node, context); if (symbol && !['variable', 'parameter'].includes(symbol.kind)) this.fail('Exported member is not assignable', node, 'TP_ASSIGNMENT'); if (!symbol) this.assignable(node.object, context); return symbol;}
    if (node.kind === 'index') {this.assignable(node.object, context); this.typeOf(node, context); return null;}
    this.fail('Variable reference required', node, 'TP_ASSIGNMENT');
  }
  assign(target, value, context, node, {allowControl = false} = {}) {
    if (!allowControl) this.assignable(target, context);
    const targetType = this.typeOf(target, context), valueType = this.typeOf(value, context);
    if (!assignmentCompatible(targetType, valueType)) this.fail(`Cannot assign ${valueType.name || valueType.kind} to ${targetType.name || targetType.kind}`, node, 'TP_ASSIGNMENT_TYPE');
    if (target.kind === 'index' && isString(this.typeOf(target.object, context))) {const objectType = this.typeOf(target.object, context); this.emit(context, `Call ${this.helper('stringSet')}(${this.expression(target.object, context, {lvalue: true})}, ${this.ordinal(target.indices[0], context)}, ${this.expression(value, context)}, ${number(objectType.capacity)})`, node); return;}
    const destination = this.expression(target, context, {lvalue: true}), source = this.expression(value, context, {lvalue: isAggregate(valueType)});
    if (targetType.kind === 'array') this.copyArray(destination, source, targetType, context, node);
    else this.emit(context, `${targetType.kind === 'object' ? 'Set ' : ''}${destination} = ${this.range(source, targetType, context, node)}`, node);
  }
  copyArray(destination, source, type, context, node, sourceType = type) {
    if (type.open) this.fail('Assignment to a whole open array requires a fixed target shape', node, 'TP_OPEN_ARRAY_ASSIGNMENT');
    const indices = type.dimensions.map(() => this.temporary(context, PASCAL_TYPES.longint, node, 'index'));
    for (let i = 0; i < indices.length; i++) this.emit(context, `For ${indices[i]} = ${number(type.dimensions[i].low)} To ${number(type.dimensions[i].high)}`, node, true);
    this.emit(context, `${destination}(${indices.join(', ')}) = ${source}(${indices.map((name, i) => sourceType.open ? `${name} - ${number(type.dimensions[i].low)} + LBound(${source}, ${i + 1})` : name).join(', ')})`, node, true);
    for (let i = indices.length - 1; i >= 0; i--) this.emit(context, `Next ${indices[i]}`, node, true);
  }
  statement(node, context) {
    switch (node.kind) {
      case 'empty': return;
      case 'block': for (const statement of node.statements) this.statement(statement, context); return;
      case 'assignment': this.assign(node.target, node.value, context, node); return;
      case 'callStatement': this.callStatement(node.expression, context, node); return;
      case 'if': {const type = this.typeOf(node.test, context); if (type.kind !== 'boolean' && type.kind !== 'variant') this.fail('If condition must be Boolean', node.test); this.emit(context, `If ${this.expression(node.test, context)} Then`, node.test); this.statement(node.consequent, context); if (node.alternate) {this.emit(context, 'Else', node.alternate, true); this.statement(node.alternate, context);} this.emit(context, 'End If', node, true); return;}
      case 'while': case 'repeat': this.loop(node, context); return;
      case 'for': this.forLoop(node, context); return;
      case 'case': this.caseStatement(node, context); return;
      case 'with': {
        const count = context.withObjects.length;
        for (const object of node.objects) {const type = this.typeOf(object, context); if (type.kind !== 'record') this.fail('With requires a record variable', object); this.assignable(object, context); context.withObjects.push({type, source: this.freezeReference(object, context)});}
        this.statement(node.body, context); context.withObjects.length = count; return;
      }
      case 'goto': this.emit(context, `GoTo ${identifier(`__PascalLabel_${node.label}`)}`, node); return;
      case 'label': this.emit(context, `${identifier(`__PascalLabel_${node.label}`)}:`, node, true); this.statement(node.statement, context); return;
      case 'assembly': this.fail('Inline 8086 assembly requires a machine-code emulator and cannot be silently translated to JavaScript or native host instructions', node, 'TP_UNSUPPORTED_ASM'); break;
      default: this.fail(`Unsupported statement '${node.kind}'`, node);
    }
  }
  freezeReference(node, context) {
    if (node.kind === 'identifier') return this.expression(node, context, {lvalue: true});
    if (node.kind === 'member') return `${this.freezeReference(node.object, context)}.${identifier(node.name)}`;
    if (node.kind === 'index') {const source = this.freezeReference(node.object, context), indices = node.indices.map(index => {const temporary = this.temporary(context, PASCAL_TYPES.longint, index, 'reference'); this.emit(context, `${temporary} = ${this.ordinal(index, context)}`, index, true); return temporary;}); return `${source}(${indices.join(', ')})`;}
    this.fail('Stable variable reference required', node);
  }
  loop(node, context) {
    const id = this.labels++, start = `__PascalLoop${id}`, next = `__PascalContinue${id}`, end = `__PascalBreak${id}`;
    context.loops.push({next, end}); this.emit(context, `${identifier(start)}:`, node, true);
    if (node.kind === 'while') {if (this.typeOf(node.test, context).kind !== 'boolean') this.fail('While condition must be Boolean', node.test); this.emit(context, `If Not (${this.expression(node.test, context)}) Then GoTo ${identifier(end)}`, node.test); this.statement(node.body, context); this.emit(context, `${identifier(next)}:`, node, true); this.emit(context, `GoTo ${identifier(start)}`, node, true);}
    else {for (const statement of node.statements) this.statement(statement, context); this.emit(context, `${identifier(next)}:`, node, true); if (this.typeOf(node.test, context).kind !== 'boolean') this.fail('Until condition must be Boolean', node.test); this.emit(context, `If Not (${this.expression(node.test, context)}) Then GoTo ${identifier(start)}`, node.test);}
    this.emit(context, `${identifier(end)}:`, node, true); context.loops.pop();
  }
  forLoop(node, context) {
    if (node.variable.kind !== 'identifier') this.fail('For control variable must be a simple local ordinal variable', node.variable, 'TP_FOR_VARIABLE');
    const symbol = this.assignable(node.variable, context), type = this.typeOf(node.variable, context);
    if (!isOrdinal(type)) this.fail('For control variable must be ordinal', node.variable);
    if (!assignmentCompatible(type, this.typeOf(node.initial, context)) || !assignmentCompatible(type, this.typeOf(node.limit, context))) this.fail('For bounds must match the ordinal control variable', node);
    const first = this.temporary(context, PASCAL_TYPES.longint, node.initial, 'forValue'), limit = this.temporary(context, PASCAL_TYPES.longint, node.limit, 'forLimit');
    this.emit(context, `${first} = ${this.ordinal(node.initial, context)}`, node.initial, true); this.emit(context, `${limit} = ${this.ordinal(node.limit, context)}`, node.limit, true);
    const id = this.labels++, start = `__PascalFor${id}`, next = `__PascalContinue${id}`, end = `__PascalBreak${id}`, descending = node.direction === 'downto';
    this.emit(context, `If ${first} ${descending ? '<' : '>'} ${limit} Then GoTo ${identifier(end)}`, node);
    this.emit(context, `${identifier(start)}:`, node, true); this.emit(context, `${this.access(symbol, context)} = ${type.kind === 'char' ? this.callHelper('chr', [first]) : type.kind === 'boolean' ? `(${first} <> 0&)` : first}`, node, true);
    context.loops.push({next, end}); context.activeControls.add(symbol); this.statement(node.body, context); context.activeControls.delete(symbol); context.loops.pop();
    this.emit(context, `${identifier(next)}:`, node, true); this.emit(context, `If ${first} = ${limit} Then GoTo ${identifier(end)}`, node, true); this.emit(context, `${first} = ${first} ${descending ? '-' : '+'} 1&`, node, true); this.emit(context, `GoTo ${identifier(start)}`, node, true); this.emit(context, `${identifier(end)}:`, node, true);
  }
  caseStatement(node, context) {
    const type = this.typeOf(node.selector, context); if (!isOrdinal(type)) this.fail('Case selector must be ordinal', node.selector);
    const intervals = [];
    this.emit(context, `Select Case ${this.ordinal(node.selector, context)}`, node);
    for (const arm of node.cases) {
      const labels = arm.labels.map(label => {
        const low = this.binder.constant(label.low, context.scope), high = label.high ? this.binder.constant(label.high, context.scope) : low;
        if (!assignmentCompatible(type, low.type) || !assignmentCompatible(type, high.type)) this.fail('Case label type does not match selector', label.low);
        const first = this.binder.ordinalValue(low), last = this.binder.ordinalValue(high);
        if (first > last) this.fail('Case range lower bound exceeds upper bound', label.low);
        if (intervals.some(range => first <= range.high && last >= range.low)) this.fail('Duplicate or overlapping case labels', label.low, 'TP_DUPLICATE_CASE'); intervals.push({low: first, high: last});
        return label.high ? `${number(first)} To ${number(last)}` : number(first);
      });
      this.emit(context, `Case ${labels.join(', ')}`, arm, true); this.statement(arm.body, context);
    }
    if (node.alternate.length) {this.emit(context, 'Case Else', node, true); for (const statement of node.alternate) this.statement(statement, context);}
    this.emit(context, 'End Select', node, true);
  }
  callStatement(expression, context, node) {
    const call = expression.kind === 'call' ? expression : {...expression, kind: 'call', callee: expression, args: []}, name = call.callee.kind === 'identifier' ? key(call.callee.name) : null, symbol = name ? this.resolve(call.callee, context, false) : this.memberSymbol(call.callee, context);
    if (!symbol && name) {
      if (name === 'write' || name === 'writeln') {
        const values = call.args.map(arg => {
          const value = arg.kind === 'formatted' ? arg.value : arg, type = this.typeOf(value, context);
          if (isAggregate(type) || type.kind === 'set' || type.kind === 'object') this.fail('Write requires scalar values', value);
          const text = this.expression(value, context);
          if (arg.kind !== 'formatted' && isString(type)) return text;
          return this.callHelper('format', [text, arg.kind === 'formatted' ? this.expression(arg.width, context) : '-1&', arg.kind === 'formatted' && arg.precision ? this.expression(arg.precision, context) : '-1&', quote(type.kind === 'boolean' ? 'boolean' : type.kind === 'real' ? 'real' : isString(type) ? 'string' : 'integer')]);
        });
        this.emit(context, `Debug.Print ${values.length ? values.map(value => `(${value})`).join(' & ') : '""'}${name === 'write' ? ';' : ''}`, node); return;
      }
      if (name === 'inc' || name === 'dec') {
        this.count(call, 1, 2); const target = call.args[0], type = this.typeOf(target, context); this.assignable(target, context); if (!isOrdinal(type)) this.fail('Inc/Dec require an ordinal variable', target);
        const destination = this.freezeReference(target, context), change = call.args[1] ? this.expression(call.args[1], context) : '1&';
        const ordinal = ['char', 'boolean'].includes(type.kind) ? this.callHelper('ord', [destination]) : destination;
        const value = `(${ordinal} ${name === 'inc' ? '+' : '-'} ${change})`; this.emit(context, `${destination} = ${type.kind === 'char' ? this.callHelper('chr', [value]) : type.kind === 'boolean' ? `(${value} <> 0&)` : this.range(value, type, context, node)}`, node); return;
      }
      if (name === 'break' || name === 'continue') {this.count(call, 0); const loop = context.loops.at(-1); if (!loop) this.fail(`${name} is valid only inside a loop`, node); this.emit(context, `GoTo ${identifier(name === 'break' ? loop.end : loop.next)}`, node); return;}
      if (name === 'exit') {this.count(call, 0); this.emit(context, `Exit ${context.procedure?.returnType ? 'Function' : 'Sub'}`, node); return;}
      if (name === 'halt') {this.count(call, 0, 1); if (call.args.length) {const code = this.binder.constant(call.args[0], context.scope).value; if (code !== 0) this.fail('Nonzero Halt exit codes require the native/console process adapter', node, 'TP_UNSUPPORTED_HOST_IO');} this.emit(context, 'End', node); return;}
      if (name === 'include' || name === 'exclude') {this.count(call, 2); this.assignable(call.args[0], context); if (this.typeOf(call.args[0], context).kind !== 'set') this.fail('Include/Exclude require a set variable', node); this.emit(context, `Call ${this.helper(name === 'include' ? 'setInclude' : 'setExclude')}(${this.expression(call.args[0], context, {lvalue: true})}, ${this.ordinal(call.args[1], context)})`, node); return;}
      if (name === 'insert') {this.count(call, 3); this.assignable(call.args[1], context); const type = this.typeOf(call.args[1], context); if (type.kind !== 'string') this.fail('Insert requires a string destination', call.args[1]); this.emit(context, `Call ${this.helper('insert')}(${this.expression(call.args[0], context)}, ${this.expression(call.args[1], context, {lvalue: true})}, ${this.expression(call.args[2], context)}, ${number(type.capacity)})`, node); return;}
      if (name === 'delete') {this.count(call, 3); this.assignable(call.args[0], context); this.emit(context, `Call ${this.helper('delete')}(${call.args.map((arg, i) => this.expression(arg, context, {lvalue: i === 0})).join(', ')})`, node); return;}
      if (name === 'str') {this.count(call, 2); const arg = call.args[0], value = arg.kind === 'formatted' ? arg.value : arg, target = call.args[1], targetType = this.typeOf(target, context); this.assignable(target, context); if (targetType.kind !== 'string') this.fail('Str requires a string destination', target); const formatted = this.callHelper('format', [this.expression(value, context), arg.kind === 'formatted' ? this.expression(arg.width, context) : '-1&', arg.kind === 'formatted' && arg.precision ? this.expression(arg.precision, context) : '-1&', quote(this.typeOf(value, context).kind === 'real' ? 'real' : 'integer')]); this.emit(context, `${this.expression(target, context, {lvalue: true})} = ${this.range(formatted, targetType, context, node)}`, node); return;}
      if (name === 'randomize') {this.count(call, 0); this.emit(context, 'Call Randomize()', node); return;}
      if (name === 'read' || name === 'readln' || name === 'val') this.fail(`${call.callee.name} requires the Pascal input/token conversion adapter`, node, 'TP_UNSUPPORTED_INPUT');
      if (['clrscr', 'gotoxy', 'textcolor', 'textbackground', 'window', 'delay', 'sound', 'nosound'].includes(name)) this.fail(`Crt.${call.callee.name} requires a terminal host adapter`, node, 'TP_UNSUPPORTED_CRT');
    }
    const compiled = this.call(call, context); this.emit(context, `Call ${compiled}`, node);
  }
  emitVariable(symbol, context, modifier = 'Dim') {
    if (symbol.type.kind === 'array' && symbol.type.open) this.fail('Open arrays are allowed only as routine parameters', symbol.node);
    this.emit(context, `${modifier} ${this.declaration(symbol.vbName, symbol.type)}`, symbol.node, true);
  }
  initializeValue(destination, type, value, context, node) {
    if (type.kind === 'array') {
      if (value.kind !== 'aggregate') this.fail('Array typed constant requires a parenthesized initializer', value);
      const shape = type.dimensions.map(d => d.high - d.low + 1), walk = (aggregate, depth, indices) => {
        if (aggregate.kind !== 'aggregate' || aggregate.entries.length !== shape[depth]) this.fail('Array typed constant initializer does not match its bounds', aggregate, 'TP_INITIALIZER');
        aggregate.entries.forEach((entry, index) => {const next = [...indices, type.dimensions[depth].low + index]; if (depth + 1 < shape.length) walk(entry.value, depth + 1, next); else this.initializeValue(`${destination}(${next.map(number).join(', ')})`, type.element, entry.value, context, entry.value);});
      }; walk(value, 0, []); return;
    }
    if (type.kind === 'record') {
      if (value.kind !== 'aggregate') this.fail('Record typed constant requires a field initializer', value); const initialized = new Set();
      for (const entry of value.entries) {const field = type.fields.get(key(entry.field)); if (!field || initialized.has(key(entry.field))) this.fail('Invalid or duplicate record initializer field', entry.value, 'TP_INITIALIZER'); initialized.add(key(entry.field)); this.initializeValue(`${destination}.${identifier(field.name)}`, field.type, entry.value, context, entry.value);}
      if (initialized.size !== type.fields.size) this.fail('Record typed constant must initialize every field', value, 'TP_INITIALIZER'); return;
    }
    if (!assignmentCompatible(type, this.typeOf(value, context))) this.fail('Typed initializer does not match its declared type', value, 'TP_INITIALIZER');
    this.emit(context, `${destination} = ${this.range(this.expression(value, context), type, context, node)}`, node, true);
  }
  lower() {
    const root = this.context(); root.writer.emit('Option Explicit', this.ast, true); root.writer.emit('Option Compare Binary', this.ast, true);
    for (const type of this.binder.recordTypes) {
      root.writer.emit(`${type.public && !this.input.form ? 'Public' : 'Private'} Type ${identifier(type.name)}`, type.node, true);
      for (const field of type.fields.values()) root.writer.emit(this.declaration(field.name, field.type), field.node, true);
      root.writer.emit('End Type', type.node, true);
    }
    const initial = this.context(), moduleValues = [...this.binder.scope.symbols.values()].filter(symbol => !symbol.builtIn);
    for (const symbol of moduleValues) {
      if (symbol.kind === 'constant' || symbol.kind === 'enumMember') root.writer.emit(`${symbol.public && !this.input.form ? 'Public' : 'Private'} Const ${identifier(symbol.name)} As ${this.storageType(symbol.type)} = ${this.literal(symbol.value, symbol.type)}`, symbol.node, true);
      else if (symbol.kind === 'variable') {this.emitVariable(symbol, root, symbol.public ? 'Public' : 'Private'); const value = symbol.typedConstant ? symbol.node.value : symbol.node.initial; if (value) this.initializeValue(this.access(symbol, initial), symbol.type, value, initial, symbol.node);}
    }
    if (this.ast.moduleKind === 'unit' && this.ast.body) this.statement(this.ast.body, initial);
    if (initial.writer.lines.length) {
      this.initializer = '__PascalInitialize'; root.writer.emit('Private __PascalInitialized As Boolean', this.ast, true); root.writer.emit('Public Sub __PascalInitialize()', this.ast, true); root.writer.emit('If __PascalInitialized Then Exit Sub', this.ast, true); root.writer.emit('__PascalInitialized = True', this.ast, true); root.writer.append(initial.writer); root.writer.emit('End Sub', this.ast, true);
    }
    for (const procedure of this.binder.procedures) root.writer.append(this.lowerProcedure(procedure));
    if (this.ast.moduleKind !== 'unit' && this.ast.body) {
      if (this.binder.scope.symbols.has('main')) this.fail('Program block conflicts with an explicitly declared Main routine', this.ast.body, 'TP_MAIN_CONFLICT');
      const main = this.context(); main.writer.emit('Public Sub Main()', this.ast.body, true); this.statement(this.ast.body, main); main.writer.emit('End Sub', this.ast.body, true); root.writer.append(main.writer);
    }
    const helperSource = getPascalRuntimeSource(this.helpers);
    if (helperSource) root.writer.emit(helperSource, this.ast, true);
    this.writer = root.writer;
    const allUses = this.ast.uses.flatMap(use => use.units.map(unit => unit.name));
    return {name: this.input.name || this.ast.name, code: this.writer.source, generatedSource: this.writer.source, source: this.ast.source, sourceMap: this.writer.map, ast: this.ast, pascalAst: this.ast, language: 'pascal', pascal: {version: '7.0', kind: this.ast.moduleKind, unitName: this.ast.name, uses: allUses, interfaceUses: this.ast.uses.filter(use => use.section === 'interface').flatMap(use => use.units.map(unit => unit.name)), implementationUses: this.ast.uses.filter(use => use.section !== 'interface').flatMap(use => use.units.map(unit => unit.name)), initializer: this.initializer, helpers: [...this.helpers], symbols: this.symbolMetadata()}};
  }
  lowerProcedure(procedure) {
    const context = this.context(procedure.localScope, procedure), kind = procedure.returnType ? 'Function' : 'Sub';
    const params = procedure.params.map(param => `${param.byRef || isAggregate(param.type) ? 'ByRef' : 'ByVal'} ${this.declaration(!param.byRef && isAggregate(param.type) ? `__value_${param.name}` : param.name, param.type, true)}`);
    for (const capture of procedure.captures) params.push(`ByRef ${this.declaration(capture.name, capture.symbol.type, true)}`);
    this.emit(context, `${procedure.public ? 'Public' : 'Private'} ${kind} ${identifier(procedure.vbName)}(${params.join(', ')})${procedure.returnType ? ` As ${this.storageType(procedure.returnType)}` : ''}`, procedure.node, true);
    for (const param of procedure.params) if (!param.byRef && isAggregate(param.type)) {
      if (param.type.kind === 'array' && param.type.open) this.fail('By-value open array parameters require dynamic copy lowering', param, 'TP_OPEN_ARRAY_VALUE');
      this.emit(context, `Dim ${this.declaration(param.name, param.type)}`, param, true);
      if (param.type.kind === 'array') this.copyArray(identifier(param.name), identifier(`__value_${param.name}`), param.type, context, param);
      else this.emit(context, `${identifier(param.name)} = ${identifier(`__value_${param.name}`)}`, param, true);
    }
    for (const symbol of procedure.localScope.symbols.values()) {
      if (symbol.kind === 'constant' || symbol.kind === 'enumMember') this.emit(context, `Const ${identifier(symbol.name)} As ${this.storageType(symbol.type)} = ${this.literal(symbol.value, symbol.type)}`, symbol.node, true);
      else if (symbol.kind === 'variable') {
        this.emitVariable(symbol, context, symbol.typedConstant ? 'Static' : 'Dim'); const value = symbol.typedConstant ? symbol.node.value : symbol.node.initial;
        if (value) {
          if (symbol.typedConstant) {const guard = identifier(`__PascalInit_${symbol.name}`); this.emit(context, `Static ${guard} As Boolean`, symbol.node, true); this.emit(context, `If Not ${guard} Then`, symbol.node, true); this.emit(context, `${guard} = True`, symbol.node, true); this.initializeValue(this.access(symbol, context), symbol.type, value, context, symbol.node); this.emit(context, 'End If', symbol.node, true);}
          else this.initializeValue(this.access(symbol, context), symbol.type, value, context, symbol.node);
        }
      }
    }
    this.statement(procedure.definition.body, context); this.emit(context, `End ${kind}`, procedure.definition, true); return context.writer;
  }
  symbolMetadata() {
    const summarize = scope => [...scope.symbols.values()].filter(symbol => !symbol.builtIn && symbol.kind !== 'type').map(symbol => ({name: symbol.name, kind: symbol.kind, vbName: symbol.vbName || symbol.name, type: symbol.type?.name || symbol.type?.kind || symbol.returnType?.name || null, line: symbol.node?.loc?.line || 1, column: symbol.node?.loc?.column || 1, public: !!symbol.public}));
    return {module: summarize(this.binder.scope), procedures: Object.fromEntries(this.binder.procedures.map(procedure => [key(procedure.name), summarize(procedure.localScope)]))};
  }
}

export function lowerPascalModule(input, options = {}) {return new PascalLowerer(input, options).lower();}

export function compilePascalModule(input, options = {}) {
  input = typeof input === 'string' ? {name: options.name || 'PascalModule', code: input} : input;
  const lowered = lowerPascalModule(input, options); let module;
  try {module = compileModule({...input, code: lowered.generatedSource, retainSyntax: input.retainSyntax ?? options.retainSyntax});}
  catch (error) {const mapped = lowered.sourceMap[(error.line || 1) - 1]; if (mapped) {error.line = mapped.line; error.column = mapped.column; error.endLine = mapped.endLine; error.endColumn = mapped.endColumn;} error.source = input.name; throw error;}
  const remap = value => {if (!value || !value.line) return; const mapped = lowered.sourceMap[value.line - 1]; if (!mapped) return; value.generatedLine = value.line; value.line = mapped.line; value.column = mapped.column; value.endColumn = mapped.endLine === mapped.line ? mapped.endColumn : undefined; if (mapped.internal && value.sequencePoint !== undefined) value.sequencePoint = false;};
  for (const declaration of module.declarations) remap(declaration);
  for (const fields of Object.values(module.types)) for (const field of fields) remap(field);
  for (const procedure of module.procedures.values()) {remap(procedure); for (const instruction of procedure.code) {remap(instruction); for (const declaration of instruction.decls || []) remap(declaration);} if (procedure.statements) for (const statement of procedure.statements) remap(statement);}
  Object.assign(module, {source: lowered.source, generatedSource: lowered.generatedSource, sourceMap: lowered.sourceMap, pascalAst: lowered.ast, language: 'pascal', pascal: lowered.pascal});
  return module;
}

/** Read-only debugger bridge; never executes the authored expression. */
export function lowerPascalExpression(source, {module = null, procedure = null, project = null} = {}) {
  const input = {name: module?.name || 'PascalExpression', code: module?.source || module?.code || '', form: module?.form}, lowerer = new PascalLowerer(input, {project});
  const selected = typeof procedure === 'string' ? lowerer.binder.procedures.find(value => key(value.name) === key(procedure) || key(value.vbName) === key(procedure)) : lowerer.binder.procedures.find(value => key(value.vbName) === key(procedure?.name || ''));
  const parser = new PascalParser({name: input.name, code: source}); const expression = parser.expression(); if (parser.peek().type !== 'eof') parser.fail('Unexpected trailing tokens in Pascal expression');
  const context = lowerer.context(selected?.localScope || lowerer.binder.scope, selected); context.pure = true;
  return parseSharedExpression(lowerer.expression(expression, context));
}
