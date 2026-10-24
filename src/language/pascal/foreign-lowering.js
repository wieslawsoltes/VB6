import {PASCAL_TYPES, sameType, assignmentCompatible} from './semantics.js';

const key = value => String(value).toLowerCase();
const identifier = name => '[' + String(name).replaceAll(']', '') + ']';
const referenceKinds = new Set(['variable', 'parameter', 'result', 'withField']);

export function foreignMemberSymbol(lowerer, node, context) {
  if (node.kind !== 'member') return null;
  const receiver = node.object.kind === 'identifier' ? lowerer.resolve(node.object, context, false) : null;
  if (node.object.kind === 'identifier' && !receiver) return null;
  const type = receiver?.type || lowerer.typeOf(node.object, context);
  const symbol = lowerer.workspace.foreign.member(type, node.name, (message, location, code) => lowerer.fail(message, location, code), node);
  if (!symbol) return null;
  if (receiver?.kind === 'type' && type.kind === 'object') lowerer.fail(`Visual Basic class '${type.name}' requires an object instance`, node, 'TP_FOREIGN_RECEIVER');
  return type.kind === 'object' ? {...symbol, foreignReceiver: node.object, foreignReceiverType: type} : symbol;
}

export function foreignAccess(lowerer, symbol, context, {freeze = false} = {}) {
  if (!symbol.foreignReceiver) return lowerer.access(symbol, context);
  let receiver = lowerer.expression(symbol.foreignReceiver, context);
  if (freeze && !context.pure) {
    const temporary = lowerer.temporary(context, symbol.foreignReceiverType, symbol.foreignReceiver, 'receiver');
    lowerer.emit(context, `Set ${temporary} = ${receiver}`, symbol.foreignReceiver, true); receiver = temporary;
  }
  return `${receiver}.${identifier(symbol.vbName || symbol.name)}`;
}

function storageReference(lowerer, node, context) {
  if (node.kind === 'identifier') return referenceKinds.has(lowerer.resolve(node, context, false)?.kind);
  if (node.kind === 'member') {
    const symbol = lowerer.memberSymbol(node, context);
    return symbol ? symbol.kind === 'variable' : lowerer.typeOf(node.object, context).kind === 'record' && storageReference(lowerer, node.object, context);
  }
  if (node.kind === 'index') return lowerer.typeOf(node.object, context).kind === 'array' && storageReference(lowerer, node.object, context);
  if (node.kind === 'dereference') return true;
  return false;
}

function compatibleReference(formal, actual) {
  if (formal.kind === 'variant') return true;
  if (formal.kind === 'array') return actual.kind === 'array' && (sameType(formal.element, actual.element) || ['ordinal', 'boolean', 'real', 'string'].includes(formal.element.kind) && formal.element.foreign && actual.element.foreign && key(formal.element.vb) === key(actual.element.vb));
  if (formal.kind === 'object' && actual.kind === 'object') return assignmentCompatible(formal, actual);
  return sameType(formal, actual);
}

function snapshotValue(lowerer, arg, type, context) {
  const actual = lowerer.typeOf(arg, context);
  const source = arg.kind === 'nil' && ['object', 'variant'].includes(type.kind) ? 'Nothing' : lowerer.expression(arg, context);
  if (context.pure) return source;
  const temporary = lowerer.temporary(context, type, arg, 'foreignArgument');
  const object = actual.kind === 'object' || arg.kind === 'nil' && ['object', 'variant'].includes(type.kind);
  lowerer.emit(context, `${object ? 'Set ' : ''}${temporary} = ${source}`, arg, true);
  return temporary;
}

/** VB Optional/ParamArray and expression-valued ByRef arguments retain the
 * shared runtime ABI. Only genuine writable storage is emitted as an alias. */
export function foreignArguments(lowerer, symbol, args, context, node) {
  const params = symbol.params, variadic = params.at(-1)?.paramArray;
  const required = params.filter(param => !param.optional && !param.paramArray).length;
  if (args.length < required || !variadic && args.length > params.length)
    lowerer.fail(`Visual Basic routine '${symbol.name}' expects ${variadic ? required + ' or more' : required === params.length ? required : required + '..' + params.length} argument(s), received ${args.length}`, node, 'TP_ARGUMENT_COUNT');
  return args.map((arg, index) => {
    const param = params[index]?.paramArray ? {...params[index], type: PASCAL_TYPES.variant, byRef: false} : params[index] || {name: params.at(-1).name, type: PASCAL_TYPES.variant, byRef: false};
    const actual = lowerer.typeOf(arg, context);
    if (param.byRef && storageReference(lowerer, arg, context)) {
      lowerer.assignable(arg, context);
      if (!compatibleReference(param.type, actual)) lowerer.fail(`Visual Basic ByRef parameter '${param.name}' requires ${param.type.name}`, arg, 'TP_VAR_PARAMETER_TYPE');
      return context.pure ? lowerer.expression(arg, context, {lvalue: true}) : lowerer.freezeReference(arg, context);
    }
    if (param.type.kind === 'array') lowerer.fail(`Visual Basic array parameter '${param.name}' requires an array variable`, arg, 'TP_VAR_PARAMETER_TYPE');
    if (!assignmentCompatible(param.type, actual)) lowerer.fail(`Visual Basic argument '${param.name}' has incompatible type`, arg, 'TP_ARGUMENT_TYPE');
    return snapshotValue(lowerer, arg, param.type, context);
  });
}

function readable(lowerer, symbol, node) {
  if (symbol.kind !== 'foreignProperty') return symbol;
  if (!symbol.get?.public) lowerer.fail(`Visual Basic property '${symbol.name}' is write-only`, node, 'TP_FOREIGN_PROPERTY');
  return {...symbol.get, foreignReceiver: symbol.foreignReceiver, foreignReceiverType: symbol.foreignReceiverType};
}

export function foreignCall(lowerer, original, args, context, node, {statement = false} = {}) {
  const symbol = readable(lowerer, original, node);
  if (symbol.kind !== 'procedure') lowerer.fail(`Visual Basic member '${symbol.name}' is not callable`, node, 'TP_FOREIGN_CALL');
  if (context.pure) lowerer.fail('Visual Basic routines and properties cannot be executed while inspecting a value', node, 'TP_DEBUG_EXPRESSION');
  if (!statement && !symbol.returnType) lowerer.fail(`Visual Basic Sub '${symbol.name}' does not return a value`, node, 'TP_FOREIGN_RESULT');
  // Receiver identity is fixed before arguments can call back and replace it.
  const receiver = foreignAccess(lowerer, symbol, context, {freeze: true});
  const argumentsSource = foreignArguments(lowerer, symbol, args, context, node);
  const call = symbol.accessor === 'get' && !symbol.params.length ? receiver : `${receiver}(${argumentsSource.join(', ')})`;
  if (statement) return call;
  const result = lowerer.temporary(context, symbol.returnType.kind === 'array' ? PASCAL_TYPES.variant : symbol.returnType, node, 'foreignResult');
  lowerer.emit(context, `${symbol.returnType.kind === 'object' ? 'Set ' : ''}${result} = ${call}`, node, true);
  return result;
}

export function foreignExpression(lowerer, symbol, context, node, {lvalue = false} = {}) {
  if (['procedure', 'foreignProperty'].includes(symbol.kind) && !lvalue) return foreignCall(lowerer, symbol, [], context, node);
  if (symbol.kind === 'constant') return lowerer.literal(symbol.value, symbol.type);
  if (['type', 'foreignNamespace'].includes(symbol.kind)) lowerer.fail(`Visual Basic ${symbol.kind === 'type' ? 'type' : 'module'} '${symbol.name}' cannot be used as a value`, node, 'TP_FOREIGN_VALUE');
  return foreignAccess(lowerer, symbol, context);
}

export function foreignAssignable(lowerer, symbol, node) {
  if (symbol.kind === 'foreignProperty') {
    if (!symbol.let?.public && !symbol.set?.public) lowerer.fail(`Visual Basic property '${symbol.name}' is read-only`, node, 'TP_FOREIGN_PROPERTY');
  } else if (symbol.kind !== 'variable') lowerer.fail(`Visual Basic member '${symbol.name}' is not assignable`, node, 'TP_ASSIGNMENT');
  return symbol;
}

export function foreignAssignment(lowerer, target, value, context, node) {
  while (target.kind === 'group') target = target.expression;
  const callee = target.kind === 'call' ? target.callee : target;
  const symbol = callee.kind === 'identifier' ? lowerer.resolve(callee, context, false) : lowerer.memberSymbol(callee, context);
  if (!symbol?.foreign || !['foreignProperty', 'variable'].includes(symbol.kind)) return false;
  foreignAssignable(lowerer, symbol, target);
  const actual = lowerer.typeOf(value, context);
  if (symbol.kind === 'variable') {
    if (target.kind === 'call') return false;
    const destination = foreignAccess(lowerer, symbol, context, {freeze: true});
    const source = value.kind === 'nil' && symbol.type.kind === 'object' ? 'Nothing' : lowerer.expression(value, context);
    if (symbol.type.kind === 'array') lowerer.copyArray(destination, source, symbol.type, context, node);
    else lowerer.emit(context, `${symbol.type.kind === 'object' ? 'Set ' : ''}${destination} = ${lowerer.range(source, symbol.type, context, node)}`, node);
    return true;
  }
  const object = actual.kind === 'object' || actual.kind === 'nil', accessor = object ? symbol.set : symbol.let;
  if (!accessor?.public) lowerer.fail(`Visual Basic property '${symbol.name}' has no accessible Property ${object ? 'Set' : 'Let'}`, target, 'TP_FOREIGN_PROPERTY');
  const expected = accessor.params.at(-1).type;
  if (!assignmentCompatible(expected, actual)) lowerer.fail(`Visual Basic property '${symbol.name}' has incompatible assignment type`, value, 'TP_ASSIGNMENT_TYPE');
  const destination = foreignAccess(lowerer, symbol, context, {freeze: true});
  const indexes = foreignArguments(lowerer, {...accessor, params: accessor.params.slice(0, -1)}, target.kind === 'call' ? target.args : [], context, target);
  const source = value.kind === 'nil' && object ? 'Nothing' : lowerer.expression(value, context);
  lowerer.emit(context, `${object ? 'Set ' : ''}${destination}${indexes.length ? '(' + indexes.join(', ') + ')' : ''} = ${source}`, node);
  return true;
}
