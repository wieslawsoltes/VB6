/** Turbo Pascal value objects share the compiler's record storage and call ABI.
 *
 * Semantic reference: Borland, Turbo Pascal 7.0 Language Guide (1992),
 * pp. 34–41, 48, 79, 103–109. Object variables contain their fields; methods
 * receive an implicit var Self. Static inherited methods retain the lexical
 * scope and method bindings of their declaring type. An ancestor assignment
 * projects data fields and deliberately leaves the destination VMT untouched.
 *
 * The common internal header is host storage, not an emulation of an 8086
 * address. It keeps every descendant's physical record prefix compatible with
 * its ancestor, including otherwise empty object types.
 */

const key = value => String(value).toLowerCase();
const identifier = value => `[${String(value).replaceAll(']', '')}]`;
const VMT_FIELD = '__PascalTypeId';
const CONSTRUCTOR_TYPE = '__PascalConstructorType';
const CONSTRUCTOR_FAILURE = '__PascalConstructorFail';
const METHOD_KINDS = new Set(['procedure', 'function', 'constructor', 'destructor']);

export function objectReferenceCompatible(formal, actual) {
  if (!formal?.isPascalObject || !actual?.isPascalObject) return false;
  const seen = new Set();
  for (let type = actual; type && !seen.has(type); type = type.parent) {
    if (type === formal || type.identity === formal.identity) return true;
    seen.add(type);
  }
  return false;
}

export function objectMethod(type, name) {
  return type?.isPascalObject ? type.methods.get(key(name)) || null : null;
}

export function resolveObjectType(binder, node, scope, name, isPublic) {
  if (!name || scope !== binder.scope) binder.fail('Object types must be named in the outermost type declaration part of a program or unit', node, 'TP_OBJECT_SCOPE');
  const parent = node.parent ? binder.resolveType({kind: 'namedType', name: node.parent, loc: node.loc}, scope) : null;
  if (parent && !parent.isPascalObject) binder.fail(`Object ancestor '${node.parent}' is not an object type`, node, 'TP_OBJECT_ANCESTOR');
  const type = {
    kind: 'record', isPascalObject: true, name, vb: name,
    identity: `${key(binder.name)}.${key(name)}`, fields: new Map(parent?.fields || []),
    methods: new Map(parent?.methods || []), declaredMethods: [], parent,
    owner: binder, scope, node, public: !!isPublic, vmtField: VMT_FIELD,
    hasVmt: !!parent?.hasVmt,
  };
  if (!parent) type.fields.set(key(VMT_FIELD), {name: VMT_FIELD, type: binder.scope.symbols.get('word').type, node, internal: true, declaringType: type});
  const ownNames = new Set();
  const methodSections = new Set();
  for (const member of node.members) {
    if (member.kind === 'field') {
      if (methodSections.has(member.componentSection || 0)) binder.fail('Object data fields must be declared before methods in their component section', member, 'TP_OBJECT_FIELD_ORDER');
      const fieldType = binder.resolveType(member.type, scope);
      if (fieldType.kind === 'array' && fieldType.open) binder.fail('Object fields cannot be open arrays', member, 'TP_OBJECT_FIELD_TYPE');
      if (fieldType.kind === 'file') binder.fail('Object fields cannot contain files', member, 'TP_OBJECT_FIELD_TYPE');
      for (const fieldName of member.names) {
        const normalized = key(fieldName);
        if (normalized === 'self') binder.fail("'Self' is the implicit object parameter and cannot be redeclared", member, 'TP_OBJECT_SELF');
        if (normalized.startsWith('__pascal')) binder.fail("Identifiers beginning with '__Pascal' are reserved for compiler-generated storage", member, 'TP_RESERVED_IDENTIFIER');
        if (type.fields.has(normalized) || type.methods.has(normalized)) binder.fail(`Duplicate object component '${fieldName}'`, member, 'TP_DUPLICATE');
        ownNames.add(normalized);
        type.fields.set(normalized, {name: fieldName, type: fieldType, node: member, visibility: member.visibility || 'public', declaringType: type});
      }
    } else if (METHOD_KINDS.has(member.kind)) {
      methodSections.add(member.componentSection || 0);
      if (member.name.includes('.')) binder.fail('Object method declarations require an unqualified method name', member, 'TP_OBJECT_METHOD');
      const normalized = key(member.name);
      if (normalized === 'self') binder.fail("'Self' is the implicit object parameter and cannot be redeclared", member, 'TP_OBJECT_SELF');
      if (normalized.startsWith('__pascal')) binder.fail("Identifiers beginning with '__Pascal' are reserved for compiler-generated storage", member, 'TP_RESERVED_IDENTIFIER');
      if (type.fields.has(normalized) || ownNames.has(normalized)) binder.fail(`Duplicate object component '${member.name}'`, member, 'TP_DUPLICATE');
      const virtual = member.modifiers.find(modifier => modifier.name === 'virtual');
      if (virtual && member.kind === 'constructor') binder.fail('Constructors cannot be virtual', member, 'TP_VIRTUAL_CONSTRUCTOR');
      const inherited = type.methods.get(normalized), dynamicIndex = virtual?.expression ? binder.constant(virtual.expression, scope).value : null;
      if (dynamicIndex !== null && (!Number.isInteger(dynamicIndex) || dynamicIndex < 1 || dynamicIndex > 65535)) binder.fail('Dynamic method index must be an integer constant in 1..65535', virtual, 'TP_DYNAMIC_INDEX');
      if (inherited?.virtual && (!virtual || dynamicIndex !== inherited.dynamicIndex)) binder.fail(`Override '${member.name}' must preserve its ancestor virtual directive and dynamic method index`, member, 'TP_VIRTUAL_OVERRIDE');
      if (dynamicIndex !== null && [...type.methods.values()].some(other => other !== inherited && other.dynamicIndex === dynamicIndex)) binder.fail(`Dynamic method index ${dynamicIndex} is already used by another object method`, virtual, 'TP_DYNAMIC_INDEX');
      ownNames.add(normalized);
      const method = {name: member.name, kind: member.kind, node: member, declaringType: type, visibility: member.visibility || 'public', virtual: !!virtual, dynamicIndex, overridden: inherited || null, symbol: null};
      method.slot = virtual ? inherited?.virtual ? inherited.slot : method : null;
      type.methods.set(normalized, method); type.declaredMethods.push(method);
      if (member.kind === 'constructor' || member.kind === 'destructor' || virtual) type.hasVmt = true;
    } else binder.fail(`Unsupported object component '${member.kind}'`, member, 'TP_OBJECT_COMPONENT');
  }
  if ([...type.methods.values()].some(method => method.virtual) && ![...type.methods.values()].some(method => method.kind === 'constructor')) binder.fail('An object with virtual methods must declare or inherit a constructor', node, 'TP_OBJECT_CONSTRUCTOR');
  binder.recordTypes.push(type);
  binder.workspace.objectTypesRevision = (binder.workspace.objectTypesRevision || 0) + 1;
  return type;
}

/** Join object member headers to their out-of-line implementations before any
 * routine signature is resolved. Imported inherited methods keep their owner.
 */
export function prepareObjectMethods(binder) {
  for (const symbol of binder.scope.symbols.values()) if (symbol.kind === 'type' && symbol.node?.type.kind === 'objectType') binder.resolveSymbol(symbol);
  for (const type of binder.recordTypes) if (type.isPascalObject) for (const method of type.declaredMethods) {
    const name = `${type.name}.${method.name}`, normalized = key(name);
    const header = {...method.node, name, section: type.public ? 'interface' : 'implementation'};
    let symbol = binder.scope.symbols.get(normalized);
    if (symbol && symbol.kind !== 'procedure') binder.fail(`Object method '${name}' conflicts with another declaration`, symbol.node, 'TP_DUPLICATE');
    if (!symbol) symbol = binder.scope.define({kind: 'procedure', name, node: header, nodes: [], definition: null, public: type.public});
    if (symbol.objectMethod) continue;
    symbol.nodes.unshift(header);
    symbol.objectMethod = method;
    symbol.vbName = `__PascalMethod_${type.name.length}_${type.name}_${method.name}`;
    symbol.public = type.public && method.visibility !== 'private';
    symbol.internalPublic = true;
    method.symbol = symbol;
  }
  for (const symbol of binder.scope.symbols.values()) if (symbol.kind === 'procedure' && (symbol.name.includes('.') || ['constructor', 'destructor'].includes(symbol.node.kind)) && !symbol.objectMethod) {
    binder.fail(`Method '${symbol.name}' has no matching declaration in an object type`, symbol.node, 'TP_OBJECT_METHOD');
  }
}

export function validateObjectMethodSignature(binder, symbol, sameType) {
  const method = symbol.objectMethod;
  if (!method?.overridden?.virtual) return;
  const ancestor = method.overridden.declaringType.owner.resolveSymbol(method.overridden.symbol), expected = ancestor.params.filter(param => !param.implicit), actual = symbol.params.filter(param => !param.implicit);
  if (method.kind !== method.overridden.kind || actual.length !== expected.length || actual.some((param, i) => key(param.name) !== key(expected[i].name) || param.byRef !== expected[i].byRef || !!param.constant !== !!expected[i].constant || !sameType(param.type, expected[i].type)) || !sameType(symbol.returnType, ancestor.returnType)) binder.fail(`Virtual override '${method.name}' must match its ancestor parameter names, types, modes and result type`, symbol.node, 'TP_VIRTUAL_SIGNATURE');
}

export function validateObjectMethodLocals(binder, symbol, declaration, definition) {
  const method = symbol.objectMethod;
  if (!method) return;
  const type = method.declaringType;
  const check = (name, node) => {
    if (key(name) === 'self') binder.fail("'Self' is the implicit object parameter and cannot be redeclared", node, 'TP_OBJECT_SELF');
    if (type.fields.has(key(name)) || type.methods.has(key(name))) binder.fail(`Method local '${name}' conflicts with an object component`, node, 'TP_OBJECT_SCOPE');
  };
  for (const param of declaration.params) check(param.name, param);
  for (const local of definition.declarations) {
    if (local.kind === 'labels') continue;
    for (const name of local.names || [local.name]) if (name) check(name, local);
  }
}

function enclosingMethod(context) {
  for (let scope = context.scope; scope; scope = scope.parent) if (scope.procedure?.objectMethod) return scope.procedure;
  return null;
}

function visible(lowerer, component, node) {
  if (component.internal || component.visibility === 'private' && component.declaringType.owner !== lowerer.binder) lowerer.fail(`Object component '${component.name}' is private to unit '${component.declaringType.owner.name}'`, node, 'TP_PRIVATE_MEMBER');
}

function bindMethod(lowerer, method, receiver, receiverType, node, options = {}) {
  visible(lowerer, method, node);
  const symbol = method.declaringType.owner.resolveSymbol(method.symbol);
  return {...symbol, objectReceiver: receiver, objectReceiverType: receiverType, ...options};
}

function selfNode(method, node) {return {kind: 'identifier', name: 'Self', loc: node?.loc || method.node.loc};}

/** Scope members before module globals, while preserving real routine locals.
 * The implicit Self symbol also travels through existing nested-routine capture
 * parameters, so no second closure or object runtime is required.
 */
export function objectScopedSymbol(lowerer, node, context) {
  const method = enclosingMethod(context);
  if (!method || node.kind !== 'identifier') return null;
  for (let scope = context.scope; scope && scope !== method.scope; scope = scope.parent) if (scope.symbols.has(key(node.name))) return null;
  const type = method.objectMethod.declaringType, field = type.fields.get(key(node.name));
  if (field) {
    visible(lowerer, field, node);
    return {kind: 'withField', name: field.name, type: field.type, access: `${lowerer.access(method.self.symbol, context)}.${identifier(field.name)}`};
  }
  const member = objectMethod(type, node.name);
  return member ? bindMethod(lowerer, member, selfNode(method, node), type, node, {objectImplicitSelf: true}) : null;
}

/** Resolve both fields and methods of a frozen Pascal object in a with scope. */
export function objectWithSymbol(lowerer, object, node, context) {
  if (!object.type.isPascalObject) return null;
  const field = object.type.fields.get(key(node.name));
  if (field) {
    visible(lowerer, field, node);
    return {kind: 'withField', name: field.name, type: field.type, access: `${object.source}.${identifier(field.name)}`};
  }
  const method = objectMethod(object.type, node.name);
  const enclosing = enclosingMethod(context), implicitSelf = !!enclosing && object.source === lowerer.access(enclosing.self.symbol, context);
  return method ? bindMethod(lowerer, method, null, object.type, node, {objectReceiverSource: object.source, objectImplicitSelf: implicitSelf}) : null;
}

/** A method designator may be instance-qualified, ancestor-qualified, or use
 * inherited within a method. A bare type name is never a static instance.
 */
export function objectMemberSymbol(lowerer, node, context) {
  if (node.kind === 'inherited') {
    const enclosing = enclosingMethod(context), type = enclosing?.objectMethod.declaringType.parent;
    if (!type) lowerer.fail('Inherited requires an enclosing method with an ancestor object type', node, 'TP_INHERITED');
    const method = objectMethod(type, node.name || enclosing.objectMethod.name);
    if (!method) lowerer.fail(`Ancestor object '${type.name}' has no method '${node.name || enclosing.objectMethod.name}'`, node, 'TP_OBJECT_METHOD');
    return bindMethod(lowerer, method, selfNode(enclosing, node), enclosing.objectMethod.declaringType, node, {objectQualified: true, objectForwardArguments: node.name ? null : enclosing.params.filter(param => !param.implicit).map(param => ({kind: 'identifier', name: param.name, loc: node.loc}))});
  }
  if (node.kind !== 'member') return null;
  let symbol = null;
  if (node.object.kind === 'identifier') {
    symbol = lowerer.resolve(node.object, context, false);
    if (!symbol) return null; // The shared resolver handles unit qualification.
  } else if (node.object.kind === 'member') symbol = lowerer.memberSymbol(node.object, context);
  const type = symbol?.kind === 'type' ? symbol.type : lowerer.typeOf(node.object, context);
  if (!type?.isPascalObject) return null;
  if (symbol?.kind === 'type') {
    const enclosing = enclosingMethod(context);
    if (!enclosing || !objectReferenceCompatible(type, enclosing.objectMethod.declaringType)) lowerer.fail('A qualified method activation requires Self of the same object type or a descendant', node, 'TP_OBJECT_RECEIVER');
    const method = objectMethod(type, node.name);
    if (!method) lowerer.fail(`Object '${type.name}' has no method '${node.name}'`, node, 'TP_OBJECT_METHOD');
    return bindMethod(lowerer, method, selfNode(enclosing, node), enclosing.objectMethod.declaringType, node, {objectQualified: true});
  }
  const field = type.fields.get(key(node.name));
  if (field) {visible(lowerer, field, node); return null;}
  const method = objectMethod(type, node.name);
  if (!method) lowerer.fail(`Object '${type.name}' has no component '${node.name}'`, node, 'TP_OBJECT_METHOD');
  return bindMethod(lowerer, method, node.object, type, node);
}

function objectCatalog(workspace) {
  const revision = workspace.objectTypesRevision || 0;
  if (workspace.objectCatalog?.revision === revision) return workspace.objectCatalog;
  const types = [...new Set(workspace.binders.values())].flatMap(binder => binder.recordTypes.filter(value => value.isPascalObject)).sort((a, b) => a.identity.localeCompare(b.identity));
  if (types.length > 65535) types[0].owner.fail('Project exceeds the object type identifier limit', types[0].node, 'TP_LIMIT');
  workspace.objectCatalog = {revision, types, tags: new Map(types.map((type, i) => [type.identity, i + 1]))};
  return workspace.objectCatalog;
}
function objectTypeTag(type) {return objectCatalog(type.owner.workspace).tags.get(type.identity);}
function dispatcherName(method) {const slot = method.slot; return `__PascalDispatch_${slot.declaringType.name.length}_${slot.declaringType.name}_${slot.name}`;}
function dispatcherAccess(lowerer, method) {const slot = method.slot, name = identifier(dispatcherName(slot)); return slot.declaringType.owner === lowerer.binder ? name : `${identifier(slot.declaringType.owner.name)}.${name}`;}

function ungroup(node) {while (node?.kind === 'group') node = node.expression; return node;}

export function objectRoutineCall(lowerer, symbol, args, context, node) {
  if (!symbol.objectMethod) return null;
  if (context.pure) lowerer.fail('Object methods cannot be executed while inspecting a value', node, 'TP_DEBUG_EXPRESSION');
  let receiver = symbol.objectReceiver, receiverType = symbol.objectReceiverType;
  if (!receiver && !symbol.objectReceiverSource) {
    const enclosing = enclosingMethod(context);
    if (!enclosing || !objectReferenceCompatible(symbol.objectMethod.declaringType, enclosing.objectMethod.declaringType)) lowerer.fail(`Object method '${symbol.name}' requires an instance variable`, node, 'TP_OBJECT_RECEIVER');
    receiver = selfNode(enclosing, node); receiverType = enclosing.objectMethod.declaringType;
  }
  if (!objectReferenceCompatible(symbol.objectMethod.declaringType, receiverType)) lowerer.fail(`Method '${symbol.name}' requires a compatible object instance`, node, 'TP_OBJECT_RECEIVER');
  if (receiver) lowerer.assignable(receiver, context);
  const source = symbol.objectReceiverSource || lowerer.freezeReference(ungroup(receiver), context);
  const values = lowerer.routineArguments({...symbol, params: symbol.params.filter(param => !param.implicit)}, symbol.objectForwardArguments || args, context, node);
  const implicitSelf = receiver && ungroup(receiver).kind === 'identifier' && lowerer.resolve(ungroup(receiver), context, false)?.param?.implicit;
  if (symbol.objectMethod.kind === 'constructor') values.push(`${symbol.objectQualified || symbol.objectImplicitSelf || implicitSelf ? 0 : objectTypeTag(receiverType)}&`);
  const callable = symbol.objectMethod.virtual && !symbol.objectQualified ? dispatcherAccess(lowerer, symbol.objectMethod) : lowerer.access(symbol, context);
  return `${callable}(${[source, ...values].join(', ')})`;
}

function copyData(lowerer, destination, source, type, context, node, valueParameter = false) {
  if (type.kind === 'record') {
    if (valueParameter && type.isPascalObject) {
      // An object value parameter is projected to its formal type, including
      // its methods. Never retain a descendant VMT on ancestor-sized storage.
      lowerer.emit(context, `If ${source}.${identifier(VMT_FIELD)} <> 0& Then`, node, true);
      lowerer.emit(context, `${destination}.${identifier(VMT_FIELD)} = ${objectTypeTag(type)}&`, node, true);
      lowerer.emit(context, 'Else', node, true);
      lowerer.emit(context, `${destination}.${identifier(VMT_FIELD)} = 0&`, node, true);
      lowerer.emit(context, 'End If', node, true);
    }
    for (const field of type.fields.values()) if (!field.internal) copyData(lowerer, `${destination}.${identifier(field.name)}`, `${source}.${identifier(field.name)}`, field.type, context, node, valueParameter);
  } else if (type.kind === 'array') {
    const integer = lowerer.binder.scope.symbols.get('longint').type;
    const indices = type.dimensions.map(() => lowerer.temporary(context, integer, node, 'objectIndex'));
    for (let i = 0; i < indices.length; i++) lowerer.emit(context, `For ${indices[i]} = ${type.dimensions[i].low}& To ${type.dimensions[i].high}&`, node, true);
    copyData(lowerer, `${destination}(${indices.join(', ')})`, `${source}(${indices.join(', ')})`, type.element, context, node, valueParameter);
    for (let i = indices.length - 1; i >= 0; i--) lowerer.emit(context, `Next ${indices[i]}`, node, true);
  } else lowerer.emit(context, `${type.kind === 'object' ? 'Set ' : ''}${destination} = ${source}`, node);
}

export function lowerObjectAssignment(lowerer, target, value, context, node) {
  const type = lowerer.typeOf(target, context);
  if (!type.isPascalObject) return false;
  const destination = lowerer.freezeReference(ungroup(target), context), source = lowerer.freezeReference(ungroup(value), context);
  copyData(lowerer, destination, source, type, context, node);
  return true;
}

export function lowerObjectValueParameter(lowerer, param, source, context) {
  if (!param.type.isPascalObject) return false;
  copyData(lowerer, identifier(param.vbName || param.name), source, param.type, context, param, true);
  return true;
}

export function lowerObjectInitializer(lowerer, destination, type, value, context, node) {
  if (!type.isPascalObject) return false;
  if (value.kind !== 'aggregate') lowerer.fail('Object typed constant requires a field initializer', value, 'TP_INITIALIZER');
  const initialized = new Set();
  for (const entry of value.entries) {
    const field = type.fields.get(key(entry.field));
    if (!field || field.internal || initialized.has(key(entry.field))) lowerer.fail('Invalid or duplicate object initializer field', entry.value, 'TP_INITIALIZER');
    initialized.add(key(entry.field));
    lowerer.initializeValue(`${destination}.${identifier(field.name)}`, field.type, entry.value, context, node);
  }
  if (initialized.size !== [...type.fields.values()].filter(field => !field.internal).length) lowerer.fail('Object typed constant must initialize every data field', value, 'TP_INITIALIZER');
  return true;
}

export function objectTypeSizeOf(lowerer, type, node) {
  if (!type.isPascalObject) return null;
  return [...type.fields.values()].filter(field => !field.internal).reduce((size, field) => size + lowerer.sizeOf(field.type, node), type.hasVmt ? 2 : 0);
}

/** Emit a closed-world VMT thunk for every virtual slot declared by this unit.
 * The original Self variable is forwarded, preserving aliasing and private
 * ancestor state. Native backends verify the serialized view and type tag
 * before narrowing an ancestor record reference to an override receiver.
 */
export function emitObjectDispatchers(lowerer, context) {
  lowerer.objectDispatchers = [];
  for (const type of lowerer.binder.recordTypes) if (type.isPascalObject) for (const method of type.declaredMethods) {
    if (!method.virtual || method.slot !== method) continue;
    const procedure = method.symbol, name = dispatcherName(method), result = !!procedure.returnType, kind = result ? 'Function' : 'Sub';
    const params = procedure.params.map(param => `${param.byRef || ['array', 'record'].includes(param.type.kind) ? 'ByRef' : 'ByVal'} ${lowerer.declaration(param.vbName || param.name, param.type, true)}`);
    const self = identifier(procedure.self.vbName), args = procedure.params.filter(param => !param.implicit).map(param => identifier(param.vbName || param.name));
    const metadata = {name, receiver: {parameter: procedure.self.vbName, identity: type.identity, vmtField: VMT_FIELD}, branches: []};
    lowerer.emit(context, `Public ${kind} ${identifier(name)}(${params.join(', ')})${result ? ` As ${lowerer.storageType(procedure.returnType)}` : ''}`, method.node, true);
    lowerer.emit(context, `Select Case ${self}.${identifier(VMT_FIELD)}`, method.node, true);
    for (const runtimeType of objectCatalog(lowerer.workspace).types) {
      if (!objectReferenceCompatible(type, runtimeType)) continue;
      const implementation = objectMethod(runtimeType, method.name);
      if (implementation?.slot !== method) continue;
      const typeId = objectTypeTag(runtimeType), target = implementation.symbol;
      metadata.branches.push({typeId, runtimeType: runtimeType.identity, targetModule: target.owner.name, targetProcedure: target.vbName, viewType: implementation.declaringType.identity});
      lowerer.emit(context, `Case ${typeId}&`, method.node, true);
      const call = `${lowerer.access(target, context)}(${[self, ...args].join(', ')})`;
      lowerer.emit(context, result ? `${identifier(name)} = ${call}` : `Call ${call}`, method.node, true);
      lowerer.emit(context, `Exit ${kind}`, method.node, true);
    }
    lowerer.emit(context, 'Case Else', method.node, true);
    lowerer.emit(context, 'Err.Raise 210, "Turbo Pascal", "Object not initialized or incompatible virtual receiver"', method.node, true);
    lowerer.emit(context, 'End Select', method.node, true);
    lowerer.emit(context, `End ${kind}`, method.node, true);
    lowerer.objectDispatchers.push(metadata);
  }
}

export function objectDispatcherMetadata(lowerer) {return lowerer.objectDispatchers || [];}

export function initializeObjectMethod(lowerer, procedure, context) {
  if (procedure.objectMethod?.kind !== 'constructor') return;
  const self = lowerer.access(procedure.self.symbol, context), type = identifier(CONSTRUCTOR_TYPE);
  lowerer.emit(context, 'On Error GoTo [__PascalCtorFailure]', procedure.node, true);
  lowerer.emit(context, `If ${type} <> 0& Then ${self}.${identifier(VMT_FIELD)} = ${type}`, procedure.node, true);
  lowerer.emit(context, `${identifier(procedure.vbName)} = True`, procedure.node, true);
}

export function finalizeObjectMethod(lowerer, procedure, context) {
  if (procedure.objectMethod?.kind !== 'constructor') return;
  const self = lowerer.access(procedure.self.symbol, context);
  lowerer.emit(context, 'Exit Function', procedure.definition, true);
  lowerer.emit(context, '[__PascalCtorFailure]:', procedure.definition, true);
  lowerer.emit(context, `If Err.Number = 210 And Err.Source = "${CONSTRUCTOR_FAILURE}" Then`, procedure.definition, true);
  lowerer.emit(context, `${self}.${identifier(VMT_FIELD)} = 0&`, procedure.definition, true);
  lowerer.emit(context, `${identifier(procedure.vbName)} = False`, procedure.definition, true);
  lowerer.emit(context, 'Err.Clear', procedure.definition, true);
  lowerer.emit(context, 'Exit Function', procedure.definition, true);
  lowerer.emit(context, 'End If', procedure.definition, true);
  lowerer.emit(context, 'Err.Raise Err.Number, Err.Source, Err.Description', procedure.definition, true);
}

export function objectFailStatement(lowerer, call, context, node) {
  if (call.callee.kind !== 'identifier' || key(call.callee.name) !== 'fail') return false;
  const method = enclosingMethod(context);
  if (method?.objectMethod.kind !== 'constructor') lowerer.fail('Fail can be called only within a constructor', node, 'TP_FAIL_CONTEXT');
  lowerer.count(call, 0);
  lowerer.emit(context, `Err.Raise 210, "${CONSTRUCTOR_FAILURE}", "Constructor failed"`, node);
  return true;
}

export function objectTypeMetadata(binder) {
  const storageName = type => type.kind === 'array' ? storageName(type.element) : type.kind === 'record' ? type.owner === binder ? type.name : `${type.owner.name}.${type.name}` : type.vb;
  return binder.recordTypes.filter(type => type.isPascalObject).map(type => ({
    name: type.name, identity: type.identity,
    parent: type.parent ? {module: type.parent.owner.name, name: type.parent.name, identity: type.parent.identity} : null,
    fields: [...type.fields.values()].map(field => ({name: field.name, type: storageName(field.type), internal: !!field.internal})),
    vmtField: type.vmtField, hasVmt: type.hasVmt, typeId: objectTypeTag(type),
    methods: [...type.methods.values()].map(method => ({name: method.name, kind: method.kind, module: method.declaringType.owner.name, declaringType: method.declaringType.name, vbName: method.symbol.vbName, visibility: method.visibility, virtual: method.virtual, dynamicIndex: method.dynamicIndex, dispatcher: method.virtual ? dispatcherName(method) : null})),
  }));
}
