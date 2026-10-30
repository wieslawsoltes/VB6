import {PASCAL_TYPES} from './semantics.js';
import {pascalPointerStorage} from './pointer-lowering.js';

const identifier = name => '[' + String(name).replaceAll(']', '') + ']';
const localKinds = new Set(['variable', 'parameter', 'result']);

/** A VB call acquires each ByRef borrow before evaluating the next argument.
 * Keep expression preludes inside typed generated procedures instead of lifting
 * them ahead of that call. Captures reuse the existing nested-routine ABI. */
export function deferredForeignValue(lowerer, node, context, {ordinal = false, nothing = false} = {}) {
  const symbols = new Set(), withObjects = new Set(), visited = new Set();
  const capture = symbol => {
    if (symbol && localKinds.has(symbol.kind) && symbol.scope && symbol.scope !== lowerer.binder.scope && symbol.owner === lowerer.binder) symbols.add(symbol);
  };
  const visit = expression => {
    if (!expression || typeof expression !== 'object' || visited.has(expression)) return;
    visited.add(expression);
    if (expression.kind === 'identifier') {
      const symbol = lowerer.resolve(expression, context, false); capture(symbol);
      for (const dependency of (symbol?.kind === 'result' ? symbol.procedure : symbol)?.captures || []) capture(dependency.symbol);
      if (symbol?.objectReceiver) visit(symbol.objectReceiver);
      if (symbol?.kind === 'withField' || symbol?.objectReceiverSource) {
        const source = symbol.access || symbol.objectReceiverSource;
        for (const object of context.withObjects) if (source === object.source || source.startsWith(object.source + '.')) withObjects.add(object);
        for (let scope = context.scope; scope; scope = scope.parent) if (scope.procedure?.self) capture(scope.procedure.self.symbol);
      }
    }
    for (const [name, value] of Object.entries(expression)) {
      if (name === 'loc') continue;
      if (Array.isArray(value)) {for (const child of value) if (child?.kind) visit(child);}
      else if (value?.kind) visit(value);
    }
  };
  visit(node);
  const name = (lowerer.foreignThunkPrefix || '__PascalForeignArgument_') + lowerer.tempId++;
  const captures = [...symbols].map((symbol, index) => ({symbol, name: '__PascalCaptured_' + index}));
  const capturedWith = [...withObjects].map((object, index) => ({object, name: '__PascalWith_' + index}));
  const type = nothing ? PASCAL_TYPES.object : ordinal ? PASCAL_TYPES.longint : lowerer.typeOf(node, context);
  const resultType = type.kind === 'array' ? PASCAL_TYPES.variant : type;
  const procedure = {name, vbName: name, captures, returnType: resultType};
  const nested = lowerer.context(context.scope, procedure);
  nested.activeControls = context.activeControls;
  nested.withObjects = context.withObjects.map(object => {
    const captured = capturedWith.find(value => value.object === object);
    return captured ? {...object, source: identifier(captured.name)} : object;
  });
  const lower = selected => nothing ? 'Nothing' : ordinal ? lowerer.ordinal(node, selected) : lowerer.expression(node, selected);
  const source = lower(nested);
  if (!nested.writer.lines.length) return lower(context);
  const params = [...captures.map(capture => `ByRef ${lowerer.declaration(capture.name, capture.symbol.type, true)}`), ...capturedWith.map(capture => `ByRef ${lowerer.declaration(capture.name, capture.object.type, true)}`)];
  const wrapper = lowerer.context();
  lowerer.emit(wrapper, `Private Function ${identifier(name)}(${params.join(', ')}) As ${lowerer.storageType(resultType)}`, node, true);
  wrapper.writer.append(nested.writer);
  lowerer.emit(wrapper, `${resultType.kind === 'object' ? 'Set ' : ''}${identifier(name)} = ${source}`, node, true);
  lowerer.emit(wrapper, 'End Function', node, true);
  (lowerer.foreignThunks ||= []).push(wrapper.writer);
  const actual = [...captures.map(capture => lowerer.access(capture.symbol, context)), ...capturedWith.map(capture => capture.object.source)];
  return `${identifier(name)}(${actual.join(', ')})`;
}

/** Emit a source reference whose receiver and indices are evaluated by the
 * shared call binder. Moving them into standalone temporaries loses array
 * ownership before later argument expressions acquire or resize storage. */
export function deferredForeignReference(lowerer, node, context) {
  const indexed = lowerer.controlArrayIndex(node, context); if (indexed) return deferredForeignReference(lowerer, indexed, context);
  if (node.kind === 'identifier') return lowerer.expression(node, context, {lvalue: true});
  if (node.kind === 'member') {
    const symbol = lowerer.memberSymbol(node, context);
    if (symbol?.foreignReceiver) return `${deferredForeignValue(lowerer, symbol.foreignReceiver, context)}.${identifier(symbol.name)}`;
    if (symbol) return lowerer.access(symbol, context);
    const source = lowerer.typeOf(node.object, context).kind === 'record' ? deferredForeignReference(lowerer, node.object, context) : deferredForeignValue(lowerer, node.object, context);
    return `${source}.${identifier(node.name)}`;
  }
  if (node.kind === 'index') {
    const levels = []; let object = node;
    while (object.kind === 'index' && lowerer.typeOf(object.object, context).kind === 'array') {levels.unshift(object); object = object.object;}
    const source = deferredForeignReference(lowerer, object, context);
    const indices = levels.flatMap(level => level.indices).map(index => deferredForeignValue(lowerer, index, context, {ordinal: true}));
    if (lowerer.typeOf(object, context).open) indices[0] = `(${indices[0]} + LBound(${source}))`;
    return `${source}(${indices.join(', ')})`;
  }
  if (node.kind === 'dereference') {
    const storage = pascalPointerStorage(lowerer.typeOf(node.object, context), lowerer.binder);
    return `${storage.heap}(${storage.validate}(${deferredForeignValue(lowerer, node.object, context)}))${storage.wrapper}`;
  }
  lowerer.fail('Visual Basic ByRef argument requires a source variable', node, 'TP_VAR_PARAMETER_TYPE');
}
